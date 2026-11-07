// F2-01 垃圾地图 · 黄河干流河道 Leaflet 图层。
// 数据：assets/data/huanghe_sections.geojson（Natural Earth 1:10m 公开中心线，WGS84，7 个真实区段）。
// 底图：使用合规白名单内的高德矢量 / 影像瓦片（GCJ-02），不直连境外 OSM 瓦片。
// 滚轮缩放：以鼠标指针为焦点的 3–13 级平滑缩放，事件只在地图容器内生效、不触发页面滚动。
// 生命周期：组件销毁时调用 map.remove() 释放图层、事件监听与容器引用。

const { onMounted, onUnmounted, ref } = Vue;

// 用 import.meta.url 解析，避免 fetch 的相对路径被解析成文档相对路径。
const GEOJSON_URL = new URL("../data/huanghe_sections.geojson", import.meta.url).href;

// 底图切换配置。生产上线需按合规要求接入标准地图底图与授权审图号（CR-013 / Q7 / T8）。
// 导出供「示例岸段 · 甘肃省卫星视图」复用，保证两张图用同一套合规瓦片源。
export const BASE_LAYERS = {
  standard: {
    label: "标准地图",
    icon: "ri-map-2-line",
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    attribution: "底图 &copy; 高德地图（GCJ-02）｜河道 Natural Earth 1:10m（公有领域）",
  },
  satellite: {
    label: "卫星影像",
    icon: "ri-earth-line",
    url: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
    attribution: "影像 &copy; 高德地图（GCJ-02）｜河道 Natural Earth 1:10m（公有领域）",
  },
};
const BASE_OPTIONS = Object.entries(BASE_LAYERS).map(([key, cfg]) => ({ key, label: cfg.label, icon: cfg.icon }));

// 顺序蓝色阶（上游 → 下游），与项目 dataviz 规范一致；明暗主题由 CSS 变量提供。
const RIVER_VARS = ["--river-1", "--river-2", "--river-3", "--river-4", "--river-5", "--river-6", "--river-7"];
const RIVER_FALLBACK = ["#a9c9ee", "#8cb8e8", "#6ea3e0", "#4f8ed7", "#3987e5", "#2a6ec4", "#1c5cab"];
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// ---- WGS84 → GCJ-02：把 WGS84 中心线对齐到 GCJ-02 底图，避免数百米错位 ----
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}
export function wgs84ToGcj02(lng, lat) {
  if (lng < 73.66 || lng > 135.05 || lat < 3.86 || lat > 53.55) return [lng, lat];
  const radLat = lat / 180.0 * Math.PI;
  let magic = 1 - GCJ_EE * Math.sin(radLat) * Math.sin(radLat);
  const sqrtMagic = Math.sqrt(magic);
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}
function toGcj02(collection) {
  return {
    ...collection,
    features: (collection.features || []).map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: feature.geometry.coordinates.map(([lng, lat]) => wgs84ToGcj02(lng, lat)),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// 滚轮缩放控制器
// 为什么不直接用 Leaflet 内置的 scrollWheelZoom：
//   内置处理器虽也以指针为焦点，但用 sigmoid 把滚轮增量映射成 0~4 级，
//   触控板连续滚动容易一次跳多级、且 Ctrl+滚轮会被劫持；这里改成
//   「累积增量 → 整数级 → 单次动画」，级别恒定、瓦片清晰、动画不被打断。
// ---------------------------------------------------------------------------
const WHEEL_ZOOM = {
  minZoom: 3,        // 约可见中国全域，再缩小只剩空白底图
  maxZoom: 13,       // 低于瓦片可用上限(17)，放大后仍是原生分辨率
  pxPerLevel: 120,   // 归一化后约 120px 滚动 = 1 级，慢速滚动也能逐级响应
  settleMs: 60,      // 停止滚动 60ms 后统一应用，避免连续事件打断缩放动画
  maxWaitMs: 220,    // 长时间连续滚动最多等 220ms 也应用一次，不会「滚了没反应」
  retryMs: 32,       // 上一次缩放动画结束后，再应用排队余量的间隔
  maxStep: 3,        // 单次最多跨 3 级（≤ zoomAnimationThreshold 4，动画不会被跳过）
};

/**
 * 在地图容器上挂载滚轮缩放，返回卸载函数。
 * @param {L.Map} map        Leaflet 地图实例
 * @param {HTMLElement} container 地图容器（事件仅绑定到它，不碰 document/window）
 * @param {() => boolean} isDisposed 组件是否已销毁
 */
export function attachWheelZoom(map, container, isDisposed) {
  let acc = 0;            // 累积缩放级数，正 = 放大；保留小数余量供慢速滚动继续累积
  let point = null;       // 最近一次滚轮指针的容器坐标（缩放焦点）
  let settleTimer = null;
  let firstAt = 0;
  let animating = false;  // Leaflet 动画进行中若再次 setView 会被静默丢弃，必须排队
  let animGuard = null;   // zoomend 兜底，防止后台标签页动画帧被节流时滚轮「卡住」
  let detached = false;
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const clearAnimGuard = () => { if (animGuard) { clearTimeout(animGuard); animGuard = null; } };

  function schedule(retry) {
    if (settleTimer) clearTimeout(settleTimer);
    const now = Date.now();
    if (!firstAt) firstAt = now;
    const wait = retry ? WHEEL_ZOOM.retryMs
      : Math.min(WHEEL_ZOOM.settleMs, Math.max(0, WHEEL_ZOOM.maxWaitMs - (now - firstAt)));
    settleTimer = setTimeout(apply, wait);
  }

  function apply() {
    settleTimer = null;
    firstAt = 0;
    if (detached || isDisposed()) { acc = 0; point = null; return; }
    if (animating) { schedule(true); return; } // 等 zoomend 后再应用，不打断当前动画
    const total = Math.trunc(acc);
    if (!total || !point) return; // 不足一级：余量保留，不触发缩放也不抖动

    // 单次跨越限幅，剩余级数留到下一次应用；整数级保证瓦片不被拉伸模糊
    const step = clamp(total, -WHEEL_ZOOM.maxStep, WHEEL_ZOOM.maxStep);
    acc -= step;
    const min = Math.max(Math.ceil(map.getMinZoom()), WHEEL_ZOOM.minZoom);
    const max = Math.min(Math.floor(map.getMaxZoom()), WHEEL_ZOOM.maxZoom);
    const current = map.getZoom();
    const target = clamp(current + step, min, max);
    if (target === current) { acc = 0; return; }
    // setZoomAround 会保持该容器坐标对应的地理点在原处 → 指针即缩放焦点
    animating = true;
    // 正常 250ms 动画结束即由 zoomend 解锁；这里再兜一层，避免后台标签页
    // rAF 被节流、动画事件迟迟不来时排队请求永久卡住。
    clearAnimGuard();
    animGuard = setTimeout(() => {
      animGuard = null;
      if (animating) onZoomEnd();
    }, 400);
    map.setZoomAround(point, target, { animate: true });
  }

  function onZoomEnd() {
    clearAnimGuard();
    animating = false;
    if (!detached && !isDisposed() && Math.abs(acc) >= 1 && point) schedule(true);
  }
  map.on("zoomend", onZoomEnd);

  function onWheel(event) {
    if (detached || isDisposed()) return;
    // Ctrl / ⌘ + 滚轮保留给浏览器自身缩放，不劫持
    if (event.ctrlKey || event.metaKey) return;

    // 关键：阻止默认滚动与向祖先滚动容器传播 → 滚轮只作用于地图，页面不整体滚动
    event.preventDefault();
    event.stopPropagation();

    // Leaflet 控件 / 弹窗内部不缩放（仍已阻止页面滚动），避免干扰既有操作
    const target = event.target;
    if (target && typeof target.closest === "function" &&
        target.closest(".leaflet-control, .leaflet-popup")) return;

    // 归一化 deltaMode：0 = 像素 / 1 = 行 / 2 = 页；取负号使「向上滚」为正（放大）
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
    const delta = -event.deltaY * unit;
    if (!Number.isFinite(delta) || delta === 0) return;

    acc += delta / WHEEL_ZOOM.pxPerLevel;
    point = map.mouseEventToContainerPoint(event);
    // 防抖 + 最长等待：连续滚动合帧成一次动画，长滚动也不会迟迟不响应
    schedule(false);
  }

  // passive: false 是 preventDefault 生效的前提（Chrome 对 wheel 有被动监听默认规则）
  container.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    detached = true;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    clearAnimGuard();
    acc = 0;
    point = null;
    animating = false;
    map.off("zoomend", onZoomEnd);
    container.removeEventListener("wheel", onWheel);
  };
}

export const RiverMap = {
  name: "RiverMap",
  setup() {
    const mapEl = ref(null);
    const baseKey = ref("standard");
    const loadState = ref("loading"); // loading | ready | error
    const loadError = ref("");
    const tileOffline = ref(false);
    const legend = ref([]);
    const hoverLabel = ref("");

    let map = null;
    let riverLayer = null;
    let baseLayer = null;
    let tileLayers = {};
    let themeObserver = null;
    let detachWheelZoom = null;
    let disposed = false;
    let tileErrors = 0;

    const palette = () => RIVER_VARS.map((name, i) => cssVar(name, RIVER_FALLBACK[i]));
    function baseStyle(feature) {
      const colors = palette();
      const index = ((feature?.properties?.order || 1) - 1) % colors.length;
      return { color: colors[index], weight: 5, opacity: 0.94, lineCap: "round", lineJoin: "round" };
    }
    function highlightStyle() {
      return {
        color: cssVar("--river-highlight", "#0f5c5c"),
        weight: 10, opacity: 1, lineCap: "round", lineJoin: "round",
      };
    }
    function popupHtml(p) {
      return `<div class="river-popup">
        <div class="river-popup-title">${esc(p.full_name || p.name)}</div>
        <dl class="river-popup-list">
          <dt>区段名称</dt><dd>${esc(p.name)}</dd>
          <dt>区段长度</dt><dd><strong>${esc(p.length_km)} km</strong></dd>
          <dt>所属河段</dt><dd>${esc(p.zone)} · ${esc(p.description)}</dd>
          <dt>起讫</dt><dd>${esc(p.start)} → ${esc(p.end)}</dd>
        </dl>
        <p class="river-popup-note">长度按 WGS84 中心线球面量算，与官方河长口径不同。</p>
      </div>`;
    }

    function switchBase(key) {
      if (disposed || !map || !tileLayers[key] || key === baseKey.value) return;
      if (baseLayer) map.removeLayer(baseLayer);
      baseLayer = tileLayers[key].addTo(map);
      baseLayer.bringToBack();
      baseKey.value = key;
      tileErrors = 0;
      tileOffline.value = false;
    }

    const onResize = () => { if (!disposed && map) map.invalidateSize(); };

    async function init() {
      if (!window.L) {
        loadState.value = "error";
        loadError.value = "Leaflet 未加载：请确认 assets/vendor/leaflet/leaflet.js 可访问。";
        return;
      }
      if (!mapEl.value) return;

      map = L.map(mapEl.value, {
        preferCanvas: true,
        center: [36.4, 106.5], zoom: 5,
        minZoom: WHEEL_ZOOM.minZoom, maxZoom: WHEEL_ZOOM.maxZoom,
        // 整数级缩放：瓦片始终以原生分辨率呈现，放大后不模糊
        zoomSnap: 1, zoomDelta: 1,
        zoomAnimation: true, zoomAnimationThreshold: 4,
        // 内置滚轮处理器保持关闭，改由 attachWheelZoom 接管（精确控制焦点 / 限幅 / 合帧）
        scrollWheelZoom: false,
        zoomControl: true, attributionControl: true,
      });
      detachWheelZoom = attachWheelZoom(map, mapEl.value, () => disposed);

      for (const [key, cfg] of Object.entries(BASE_LAYERS)) {
        const layer = L.tileLayer(cfg.url, {
          subdomains: "1234", minZoom: 3, maxZoom: 17,
          attribution: cfg.attribution, crossOrigin: true,
        });
        layer.on("tileerror", () => {
          tileErrors += 1;
          if (tileErrors >= 4 && !disposed) tileOffline.value = true;
        });
        tileLayers[key] = layer;
      }
      baseLayer = tileLayers[baseKey.value].addTo(map);

      themeObserver = new MutationObserver(() => {
        if (!disposed && riverLayer) riverLayer.setStyle(baseStyle);
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      window.addEventListener("resize", onResize);

      try {
        const response = await fetch(GEOJSON_URL, { cache: "no-cache" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const raw = await response.json();
        if (disposed || !map) return;

        const collection = toGcj02(raw);
        riverLayer = L.geoJSON(collection, {
          style: baseStyle,
          onEachFeature(feature, layer) {
            const props = feature.properties || {};
            layer.bindPopup(popupHtml(props), { maxWidth: 300 });
            layer.on("mouseover", () => {
              hoverLabel.value = props.full_name || props.name || "";
              layer.setStyle(highlightStyle());
            });
            layer.on("mouseout", () => {
              hoverLabel.value = "";
              if (riverLayer) riverLayer.resetStyle(layer);
            });
          },
        }).addTo(map);

        legend.value = collection.features.map((f) => ({
          order: f.properties.order, name: f.properties.name,
        }));
        map.fitBounds(riverLayer.getBounds(), { padding: [26, 26], maxZoom: 7 });
        loadState.value = "ready";
      } catch (error) {
        if (!disposed) {
          loadState.value = "error";
          loadError.value = "河道数据加载失败：" + (error?.message || String(error));
        }
      }
    }

    onMounted(init);
    onUnmounted(() => {
      disposed = true;
      // 先摘掉滚轮监听与待应用的定时器，避免对已 remove() 的地图发起缩放
      if (detachWheelZoom) { detachWheelZoom(); detachWheelZoom = null; }
      if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
      window.removeEventListener("resize", onResize);
      if (map) {
        map.remove(); // 释放图层、事件监听与容器引用
        map = null;
      }
      riverLayer = null;
      baseLayer = null;
      tileLayers = {};
    });

    return {
      mapEl, baseKey, baseOptions: BASE_OPTIONS, loadState, loadError,
      tileOffline, legend, hoverLabel, switchBase,
    };
  },
  template: `
    <SectionCard class-name="river-card" title="黄河干流河道 · 地理示意"
      description="黄河干流走向示意，7 个区段；悬停高亮，点击查看区段名称与长度。仅呈现河道，不含垃圾点位或坐标。">
      <template #actions>
        <div class="river-basemap-switch" role="group" aria-label="底图切换">
          <button v-for="opt in baseOptions" :key="opt.key" class="river-basemap-btn" type="button"
            :class="{ 'is-active': baseKey === opt.key }" :aria-pressed="baseKey === opt.key ? 'true' : 'false'"
            @click="switchBase(opt.key)">
            <i class="river-basemap-icon" :class="opt.icon" aria-hidden="true"></i>{{ opt.label }}
          </button>
        </div>
      </template>

      <div class="river-map-frame">
        <div ref="mapEl" class="river-map-canvas" role="application"
          aria-label="黄河干流河道交互地图；滚轮以指针为中心缩放（3–13 级），可切换标准地图与卫星影像底图"></div>
        <div v-if="loadState === 'loading'" class="river-map-status">正在加载河道数据…</div>
        <div v-else-if="loadState === 'error'" class="river-map-status is-error">{{ loadError }}</div>
        <div v-if="hoverLabel" class="river-map-hover">{{ hoverLabel }}</div>
      </div>

      <div v-if="tileOffline" class="notice notice-warning river-map-notice">
        <Icon name="alert" :size="16" />
        <div class="notice-body">
          <div class="notice-text">底图瓦片未能加载（离线或网络受限）；河道图层与交互仍可用。演示底图，正式上线须替换为授权标准地图与审图号。</div>
        </div>
      </div>

      <div class="river-map-foot">
        <div class="river-legend" aria-label="区段图例">
          <span v-for="item in legend" :key="item.order" class="river-legend-item">
            <i class="river-legend-swatch" :style="{ background: 'var(--river-' + item.order + ')' }" aria-hidden="true"></i>{{ item.name }}
          </span>
        </div>
        <p class="river-compliance">滚轮在地图内以指针为中心缩放（3–13 级），不会带动页面滚动；Ctrl/⌘ + 滚轮仍由浏览器处理。河道为概化中心线，非测绘成果，不含国界与行政区划，不作为正式地图使用；底图 &copy; 高德地图。</p>
      </div>
    </SectionCard>
  `,
};
