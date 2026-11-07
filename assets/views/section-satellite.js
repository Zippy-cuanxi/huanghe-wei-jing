// F2-01 示例岸段 · 甘肃省卫星 / 标准地图视图。
//
// 范围硬约束（GANSU_SCOPE.label = 「仅支持甘肃省」）：
//   · 影像/矢量瓦片只请求与甘肃省外接矩形相交的瓦片（GridLayer 的 bounds 选项）；
//   · 默认定位落在省内示例岸段一带，平移被 maxBounds 锁在省内；
//   · minZoom 按容器尺寸动态收紧，保证任何缩放级别下视口都不会越出甘肃省；
//   · 落在省外的岸段不落点、不弹窗、不参与选中（上游 sections 数据本身不改）。
//
// 数据：仍只消费 MAP-01 的 coarse_lat/coarse_lng / heat_value / cleanup_kg_total /
//       responsible_org，不改后端字段、不改热力口径、不改审图号闸门。
// 坐标：粗化坐标按 WGS84 口径，运行时转 GCJ-02 与高德瓦片对齐（与河道图同一套算法）。
// 底图：合规白名单内的高德标准 / 影像瓦片，复用 RiverMap 的 BASE_LAYERS。
// 层级：底图 tilePane(200) → 垃圾热力 trashHeat(610) → 岸段标记 gansuMarkers(620)
//       → 弹窗(700) → 控件(1000)。热力层 pointer-events:none，不拦截任何地图操作。
// 生命周期：卸载时先摘滚轮监听与热力层，再 map.remove()。

import { formatKg, formatNumber, heatClass } from "../lib.js";
import { BASE_LAYERS, attachWheelZoom, wgs84ToGcj02 } from "./river-map.js";
import { createLeafletHeatLayer, renormalizeHeatPoints } from "./trash-heat.js";

const { computed, onMounted, onUnmounted, ref, watch } = Vue;

/** 唯一范围配置：界面徽标、aria 说明与地图约束都从这里取值。 */
export const GANSU_SCOPE = Object.freeze({
  region: "甘肃省",
  label: "仅支持甘肃省",
  // 甘肃省外接矩形（约 92°13′E–108°46′E / 32°31′N–42°57′N）。
  // 仅作「浏览 / 缩放范围」约束，不是行政区界线，也不作为正式地图使用。
  bounds: [[32.5, 92.2], [42.95, 108.8]],
  center: [36.1, 103.5],   // 省内兜底中心（兰州一带，示例岸段所在区域）
  defaultZoom: 8,
  minZoom: 6,              // 静态兜底；init/resize 时按 getBoundsZoom(bounds, true) 再收紧
  maxZoom: 13,             // 低于影像瓦片可用上限(17)，放大后仍是原生分辨率
  crs: "GCJ-02",
  coordNote: "MAP-01 粗化坐标按 WGS84 口径，运行时转 GCJ-02 对齐底图",
  note: "仅支持甘肃省：卫星影像与岸段标注只对应省内范围；默认定位、平移与缩放范围以甘肃省外接矩形为边界（非行政界线、非测绘成果）；省外区域不加载、不展示、不参与交互。",
  layerNote: "叠加层级：底图（底层）→ 省内岸段标记（中层）→ 弹窗与控件（上层）；演示底图，正式上线须替换为授权标准地图与审图号。",
});

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const isNum = (value) => typeof value === "number" && Number.isFinite(value);

function hasValidCoord(lat, lng) {
  return isNum(lat) && isNum(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

function insideGansu(lat, lng) {
  const [[south, west], [north, east]] = GANSU_SCOPE.bounds;
  return hasValidCoord(lat, lng) && lat >= south && lat <= north && lng >= west && lng <= east;
}

export const SectionSatellite = {
  name: "SectionSatellite",
  props: {
    sections: { type: Array, default: () => [] },
    selectedId: { type: String, default: "" },
    // "standard" | "satellite"，与 RiverMap 的 BASE_LAYERS 键一致
    baseKey: { type: String, default: "satellite" },
    // 父级统一清洗后的垃圾分布热力点（含 WGS84 原始坐标与 GCJ-02 对齐坐标）
    heatPoints: { type: Array, default: () => [] },
    heatEnabled: { type: Boolean, default: true },
    heatMode: { type: String, default: "weight" },
  },
  emits: ["select"],
  setup(props, { emit }) {
    const mapEl = ref(null);
    const tileOffline = ref(false);
    const loadError = ref("");
    const markersPlaced = ref(0);
    const minZoom = ref(GANSU_SCOPE.minZoom);
    const inScope = computed(() => props.sections.filter((s) => s && insideGansu(s.coarse_lat, s.coarse_lng)));
    // 只统计「坐标有效但确实落在省外」的记录；无效/缺失坐标不属于省外，
    // 已在父级热力清洗里被稳妥剔除，不混进这条范围提示。
    const outsideCount = computed(() => (Array.isArray(props.sections) ? props.sections : [])
      .filter((s) => s && hasValidCoord(s.coarse_lat, s.coarse_lng) &&
                     !insideGansu(s.coarse_lat, s.coarse_lng)).length);
    // 热力点与岸段标记共用同一条「仅支持甘肃省」范围约束；
    // 再按省内点集重新归一化，避免省外高权重记录压低省内热点、导致梯度分不开。
    const heatInScope = computed(() => renormalizeHeatPoints(
      (Array.isArray(props.heatPoints) ? props.heatPoints : [])
        .filter((p) => p && insideGansu(p.lat, p.lng)),
      props.heatMode
    ));

    let map = null;
    let scopeBounds = null;
    let baseLayer = null;
    let markerLayer = null;
    let heatLayer = null;
    let resetControl = null;
    let tileLayers = {};
    let markerById = new Map();
    let detachWheelZoom = null;
    let tileErrors = 0;
    let disposed = false;
    let autoFitDone = false;
    let defaultCenter = GANSU_SCOPE.center.slice();
    let defaultZoom = GANSU_SCOPE.defaultZoom;

    function markerHtml(section) {
      return `<div class="gansu-marker">
        <span class="gansu-marker-halo"></span>
        <span class="gansu-marker-dot heat-dot ${heatClass(section.heat_value)}"></span>
        <span class="gansu-marker-label">${esc(section.name)}</span>
      </div>`;
    }

    function popupHtml(section) {
      return `<div class="gansu-popup">
        <div class="river-popup-title">${esc(section.name)}</div>
        <dl class="river-popup-list">
          <dt>岸段编号</dt><dd><code>${esc(section.section_id)}</code></dd>
          <dt>热力值</dt><dd>${esc(formatNumber(section.heat_value))}</dd>
          <dt>清理量</dt><dd>${esc(formatKg(section.cleanup_kg_total))}</dd>
          <dt>责任单位</dt><dd>${esc(section.responsible_org ?? "—")}</dd>
          <dt>粗化坐标</dt><dd>${esc(section.coarse_lat)}, ${esc(section.coarse_lng)}</dd>
        </dl>
        <p class="river-popup-note">仅支持甘肃省；点位为 MAP-01 粗化中心，非原始坐标。</p>
      </div>`;
    }

    // 视口永远落在甘肃省外接矩形内：
    // getBoundsZoom(bounds, true) 返回「视口完整落入 bounds」所需的最小级别。
    function limitToGansu() {
      if (!map || !scopeBounds) return;
      map.setMaxBounds(scopeBounds);
      map.setMaxZoom(GANSU_SCOPE.maxZoom);
      // 先回到静态下限再量算，避免上一次收紧的结果把 getBoundsZoom 钳住
      map.setMinZoom(GANSU_SCOPE.minZoom);
      const needed = Math.ceil(map.getBoundsZoom(scopeBounds, true));
      const min = Math.max(GANSU_SCOPE.minZoom, Number.isFinite(needed) ? needed : GANSU_SCOPE.minZoom);
      map.setMinZoom(min);
      minZoom.value = min;
      if (map.getZoom() < min) map.setZoom(min, { animate: false });
      map.panInsideBounds(scopeBounds, { animate: false });
    }

    function fitToSamples() {
      if (!map || !inScope.value.length) return;
      const points = inScope.value.map((s) => {
        const [lng, lat] = wgs84ToGcj02(s.coarse_lng, s.coarse_lat);
        return [lat, lng];
      });
      if (points.length === 1) {
        map.setView(points[0], Math.max(map.getMinZoom(), GANSU_SCOPE.defaultZoom), { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(points), {
          padding: [44, 44],
          maxZoom: Math.max(map.getMinZoom() + 1, 9),
          animate: false,
        });
      }
      map.panInsideBounds(scopeBounds, { animate: false });
      defaultCenter = map.getCenter();
      defaultZoom = map.getZoom();
    }

    function syncSelection() {
      if (!map) return;
      for (const [id, marker] of markerById) {
        const el = marker.getElement();
        const node = el && el.querySelector(".gansu-marker");
        if (node) node.classList.toggle("is-selected", id === props.selectedId);
      }
    }

    function renderMarkers() {
      if (!map || disposed) return;
      if (!markerLayer) markerLayer = L.layerGroup().addTo(map);
      else markerLayer.clearLayers();
      markerById = new Map();

      for (const section of inScope.value) {
        // WGS84 粗化坐标 → GCJ-02，保证标记压在高德影像的同一地物上
        const [lng, lat] = wgs84ToGcj02(section.coarse_lng, section.coarse_lat);
        const marker = L.marker([lat, lng], {
          pane: "gansuMarkers",
          keyboard: true,
          title: section.name || section.section_id,
          icon: L.divIcon({
            className: "gansu-marker-wrap",
            html: markerHtml(section),
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
        });
        marker.bindPopup(popupHtml(section), { maxWidth: 280 });
        marker.on("click", () => {
          // 与示意网格 / 表格行共用同一个 selectedId，详情卡与表格保持联动
          emit("select", section.section_id);
          marker.openPopup();
        });
        markerLayer.addLayer(marker);
        markerById.set(section.section_id, marker);
      }
      markersPlaced.value = markerById.size;
      syncSelection();

      // 首次拿到数据时把默认视图定位到省内示例岸段（此后数据刷新不抢用户视角）
      if (!autoFitDone && markerById.size) {
        autoFitDone = true;
        fitToSamples();
      }
    }

    function switchBase(key) {
      if (disposed || !map) return;
      const layer = tileLayers[key] || tileLayers[props.baseKey] || tileLayers.satellite;
      if (!layer) return;
      if (baseLayer && baseLayer !== layer) map.removeLayer(baseLayer);
      if (!map.hasLayer(layer)) layer.addTo(map);
      baseLayer = layer;
      baseLayer.bringToBack(); // 底图恒在标记之下
      tileErrors = 0;
      tileOffline.value = false;
    }

    function resetView() {
      if (disposed || !map) return;
      limitToGansu();
      map.setView(defaultCenter, Math.max(map.getMinZoom(), defaultZoom), { animate: true });
      map.panInsideBounds(scopeBounds, { animate: false });
    }

    function addResetControl() {
      if (resetControl || !map) return;
      const ResetControl = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd() {
          const button = L.DomUtil.create("button", "gansu-reset-control");
          button.type = "button";
          button.title = "复位到甘肃省默认视图";
          button.setAttribute("aria-label", "复位到甘肃省默认视图");
          button.innerHTML = '<i class="ri-focus-3-line" aria-hidden="true"></i><span>复位视图</span>';
          L.DomEvent.disableClickPropagation(button);
          L.DomEvent.on(button, "click", (event) => { L.DomEvent.preventDefault(event); resetView(); });
          return button;
        },
      });
      resetControl = new ResetControl().addTo(map);
    }

    const onResize = () => {
      if (disposed || !map) return;
      map.invalidateSize();
      limitToGansu();
    };

    function init() {
      if (!window.L) {
        loadError.value = "Leaflet 未加载：请确认 assets/vendor/leaflet/leaflet.js 可访问。";
        return;
      }
      if (!mapEl.value) return;
      scopeBounds = L.latLngBounds(GANSU_SCOPE.bounds);

      map = L.map(mapEl.value, {
        preferCanvas: true,
        center: GANSU_SCOPE.center,
        zoom: GANSU_SCOPE.defaultZoom,
        minZoom: GANSU_SCOPE.minZoom,
        maxZoom: GANSU_SCOPE.maxZoom,
        maxBounds: scopeBounds,
        maxBoundsViscosity: 1.0, // 拖动到省界即被硬性拉回
        zoomSnap: 1, zoomDelta: 1,
        zoomAnimation: true, zoomAnimationThreshold: 4,
        // 内置滚轮处理器保持关闭，与河道图共用 attachWheelZoom（指针焦点 / 不滚页面）
        scrollWheelZoom: false,
        worldCopyJump: false,
        zoomControl: true, attributionControl: true,
      });

      // 岸段标记单独一个窗格：底图(200) 之下不可能，弹窗(700) 之上也不遮挡控件
      const markerPane = map.createPane("gansuMarkers");
      markerPane.style.zIndex = 620;
      // 垃圾分布热力层（610）：高于底图、低于标记；随缩放/平移重绘，不拦截交互
      heatLayer = createLeafletHeatLayer(map, {
        paneName: "trashHeat",
        zIndex: 610,
        baseRadius: 30,
        referenceZoom: GANSU_SCOPE.defaultZoom,
        enabled: props.heatEnabled,
      });
      heatLayer.setPoints(heatInScope.value);
      detachWheelZoom = attachWheelZoom(map, mapEl.value, () => disposed);

      for (const [key, cfg] of Object.entries(BASE_LAYERS)) {
        const layer = L.tileLayer(cfg.url, {
          subdomains: "1234", minZoom: 3, maxZoom: 17, crossOrigin: true,
          // 省外瓦片一律不请求、不显示（只加载与甘肃省外接矩形相交的瓦片）
          bounds: scopeBounds,
          attribution: `${cfg.label} &copy; 高德地图（GCJ-02）｜仅支持甘肃省｜示例演示，生产须换标准地图与授权审图号`,
        });
        layer.on("tileerror", () => {
          tileErrors += 1;
          if (tileErrors >= 4 && !disposed) tileOffline.value = true;
        });
        tileLayers[key] = layer;
      }

      switchBase(props.baseKey);
      limitToGansu();
      renderMarkers();
      addResetControl();
      window.addEventListener("resize", onResize);
    }

    watch(() => props.baseKey, (key) => switchBase(key));
    watch(() => props.selectedId, () => syncSelection());
    watch(inScope, () => renderMarkers());
    watch(heatInScope, (list) => { if (heatLayer) heatLayer.setPoints(list); });
    watch(() => props.heatEnabled, (value) => { if (heatLayer) heatLayer.setEnabled(value); });

    onMounted(init);
    onUnmounted(() => {
      disposed = true;
      if (detachWheelZoom) { detachWheelZoom(); detachWheelZoom = null; }
      if (heatLayer) { heatLayer.destroy(); heatLayer = null; }
      window.removeEventListener("resize", onResize);
      if (map) {
        map.remove();
        map = null;
      }
      baseLayer = null;
      markerLayer = null;
      resetControl = null;
      tileLayers = {};
      markerById = new Map();
    });

    return {
      mapEl, tileOffline, loadError, markersPlaced, outsideCount, minZoom,
      heatPointCount: computed(() => heatInScope.value.length),
      heatOn: computed(() => props.heatEnabled),
      scopeLabel: GANSU_SCOPE.label,
      scopeNote: GANSU_SCOPE.note,
      layerNote: GANSU_SCOPE.layerNote,
      coordNote: GANSU_SCOPE.coordNote,
      maxZoomLabel: GANSU_SCOPE.maxZoom,
      resetView,
    };
  },
  template: `
    <div class="gansu-view">
      <div class="gansu-map-frame">
        <div ref="mapEl" class="gansu-map-canvas" role="application"
          :aria-label="'仅支持甘肃省：示例岸段' + (baseKey === 'satellite' ? '卫星影像' : '标准地图') + '；默认定位与浏览、缩放范围均以甘肃省为边界'"></div>
        <div class="gansu-scope-tag" aria-hidden="true"><i class="ri-map-pin-2-line"></i>{{ scopeLabel }}</div>
        <div v-if="loadError" class="gansu-map-status is-error">{{ loadError }}</div>
      </div>

      <div v-if="tileOffline" class="notice notice-warning gansu-notice">
        <Icon name="alert" :size="16" />
        <div class="notice-body">
          <div class="notice-text">影像瓦片未能加载（离线或网络受限）；甘肃省内岸段标记与交互仍可用。演示底图，正式上线须替换为授权标准地图与审图号。</div>
        </div>
      </div>
      <div v-if="outsideCount" class="notice notice-info gansu-notice">
        <Icon name="info" :size="16" />
        <div class="notice-body">
          <div class="notice-text">有 {{ outsideCount }} 个岸段位于甘肃省外接矩形之外，按「{{ scopeLabel }}」规则不在本视图落点、不参与交互；示意网格与明细数据保持不变。</div>
        </div>
      </div>

      <div class="gansu-view-foot">
        <div class="gansu-layer-legend" aria-label="叠加层级与范围说明">
          <span class="gansu-layer-chip"><i class="ri-earth-line" aria-hidden="true"></i>底图：甘肃省内影像</span>
          <span class="gansu-layer-chip"><i class="ri-fire-line" aria-hidden="true"></i>热力：{{ heatOn ? '已开启' : '已关闭' }} · 省内 {{ heatPointCount }} 处</span>
          <span class="gansu-layer-chip"><i class="ri-map-pin-2-line" aria-hidden="true"></i>标记：省内 {{ markersPlaced }} 个示例岸段</span>
          <span class="gansu-layer-chip"><i class="ri-focus-3-line" aria-hidden="true"></i>缩放：{{ minZoom }}–{{ maxZoomLabel }} 级 · 省内</span>
        </div>
        <p class="river-compliance">{{ scopeNote }}</p>
        <p class="river-compliance">{{ coordNote }}。{{ layerNote }}</p>
      </div>
    </div>
  `,
};
