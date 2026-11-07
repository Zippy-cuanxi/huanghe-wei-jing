// F2-01 垃圾分布热力叠加层。
//
// 数据来源：页面中已有的垃圾分布记录（MAP-01 的 sections：coarse_lat / coarse_lng /
// heat_value / cleanup_kg_total 等），不新增接口、不补造点位、不改后端热力口径。
// 口径优先级：可用数量 / 权重字段（cleanup_kg_total、heat_value …）→ 缺失时退化为
// 「位置记录密度」。颜色是局部核密度强度，不是单条记录的业务分级。
//
// 本模块分两层：
//   · buildHeatPoints 是纯函数，不碰 DOM，可直接被 Node 单测；
//   · createLeafletHeatLayer 依赖浏览器 Canvas，只在组件 mounted 后调用。
// 坐标：粗化坐标为 WGS84，传入 transform（WGS84→GCJ-02）后另存 gcjLat/gcjLng 供高德底图对齐。
// 合规：只产出透明数据叠加层，不含底图、境界线、审图号；底图仍为合规白名单内的高德瓦片。

/** 春彩虹系连续色带：嫩芽绿 → 迎春黄 → 杏橙 → 桃粉 → 淡紫。 */
export const SPRING_STOPS = Object.freeze([
  { t: 0.00, rgb: [158, 219, 122] }, // 嫩芽绿
  { t: 0.28, rgb: [240, 226, 106] }, // 迎春黄
  { t: 0.52, rgb: [246, 178, 107] }, // 杏橙
  { t: 0.76, rgb: [242, 154, 181] }, // 桃粉
  { t: 1.00, rgb: [199, 166, 232] }, // 淡紫
]);

export const HEAT_TIERS = Object.freeze([
  { key: "low", label: "少", hint: "记录较少", color: "#9edb7a" },
  { key: "mid", label: "中", hint: "记录较集中", color: "#f6b26b" },
  { key: "high", label: "多", hint: "记录较密集", color: "#c7a6e8" },
]);

export const HEAT_GRADIENT_CSS =
  "linear-gradient(90deg, #9edb7a 0%, #f0e26a 28%, #f6b26b 52%, #f29ab5 76%, #c7a6e8 100%)";

/** 把 0–1 的强度映射到春彩虹连续色带；不做分段取色。 */
export function springColor(value) {
  const t = Math.max(0, Math.min(1, Number(value) || 0));
  let lo = SPRING_STOPS[0];
  let hi = SPRING_STOPS[SPRING_STOPS.length - 1];
  for (let i = 1; i < SPRING_STOPS.length; i += 1) {
    if (t <= SPRING_STOPS[i].t) { lo = SPRING_STOPS[i - 1]; hi = SPRING_STOPS[i]; break; }
  }
  const span = hi.t - lo.t || 1;
  const k = Math.max(0, Math.min(1, (t - lo.t) / span));
  const rgb = lo.rgb.map((channel, i) => Math.round(channel + (hi.rgb[i] - channel) * k));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** 数量 / 权重候选字段，按业务含义优先；全部缺失才用位置记录密度。 */
const WEIGHT_FIELDS = Object.freeze([
  { key: "cleanup_kg_total", label: "清理量（kg）" },
  { key: "heat_value", label: "审核通过记录数" },
  { key: "total_kg", label: "重量（kg）" },
  { key: "weight_kg", label: "重量（kg）" },
  { key: "weight", label: "权重" },
  { key: "quantity", label: "数量" },
  { key: "count", label: "记录数" },
  { key: "record_count", label: "记录数" },
  { key: "amount", label: "数量" },
]);

const LAT_FIELDS = ["coarse_lat", "lat", "latitude", "y"];
const LNG_FIELDS = ["coarse_lng", "lng", "lon", "longitude", "x"];
const ID_FIELDS = ["section_id", "id", "record_id", "report_id"];
const MAX_POINTS = 2000;            // 防止异常大数据把主线程拖住
const COORD_PRECISION = 5;          // 约 1 米；粗化坐标同点合并的判定精度

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // 后端偶尔会把数值序列化成字符串；只接受能严格转成有限数的情形
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickCoord(record, fields) {
  for (const key of fields) {
    const value = finiteNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickId(record) {
  for (const key of ID_FIELDS) {
    const value = record[key];
    if (value === null || value === undefined || value === "") continue;
    return `${key}:${String(value)}`;
  }
  return null;
}

/**
 * 按「当前实际参与渲染的点集」重新归一化强度与档位（纯函数，不改入参）。
 * 用途：Leaflet 视图受「仅支持甘肃省」约束只画省内记录，不能让省外高权重记录
 *       压低省内热点的相对强度；SVG 示意网格显示全部记录，直接用全量结果即可。
 */
export function renormalizeHeatPoints(points, mode = "weight") {
  const list = (Array.isArray(points) ? points : []).filter(Boolean);
  const maxWeight = list.reduce((max, p) => Math.max(max, Number(p.weight) || 0), 0);
  const maxCount = list.reduce((max, p) => Math.max(max, Number(p.count) || 1), 1);
  return list.map((point) => {
    const weight = Number(point.weight) || 0;
    const ratio = mode === "density"
      ? (Number(point.count) || 1) / maxCount
      : (maxWeight > 0 ? weight / maxWeight : 0);
    const t = Math.max(0, Math.min(1, ratio));
    return {
      ...point,
      // 单点基础强度 + 归一化权重；重叠时 alpha 累积 → 自然呈现更热的区域。
      // 权重为 0 的记录仍保留最低强度，表示「有记录但暂无垃圾量」。
      intensity: weight > 0 ? Math.min(0.88, 0.16 + 0.68 * Math.sqrt(t)) : 0.10,
      level: t >= 0.66 ? "high" : t >= 0.30 ? "mid" : "low",
    };
  });
}

/**
 * 把任意「垃圾分布记录」清洗成可渲染的热力点。
 * 稳妥处理：非对象 / 缺字段 / NaN / Infinity / 越界 / (0,0) 哨兵 → 丢弃；
 *           section_id 等主键重复 → 视为冗余记录剔除；
 *           不同记录落在同一粗化坐标 → 合并为一个位置并累加权重/计数；
 *           权重非有限或为负 → 该条按 1（记录密度基线）处理；
 *           超过 MAX_POINTS → 截断，保证页面稳定。
 * @param {Array} records MAP-01 sections 或同构记录
 * @param {object} [options]
 * @param {Function} [options.transform] (lng, lat) => [lng, lat]，WGS84→GCJ-02
 * @param {Array} [options.bounds] [[south,west],[north,east]]，可选的范围过滤
 * @returns {{points:Array, metric:string|null, metricLabel:string, mode:string, maxWeight:number, stats:object}}
 */
export function buildHeatPoints(records, options = {}) {
  const rows = Array.isArray(records) ? records : [];
  const transform = typeof options.transform === "function" ? options.transform : null;
  const bounds = Array.isArray(options.bounds) && options.bounds.length === 2 ? options.bounds : null;

  let dropped = 0, duplicates = 0, truncated = 0, invalidWeight = 0;
  const seenIds = new Set();
  const valid = [];

  for (const record of rows) {
    if (!record || typeof record !== "object" || Array.isArray(record)) { dropped += 1; continue; }
    const lat = pickCoord(record, LAT_FIELDS);
    const lng = pickCoord(record, LNG_FIELDS);
    if (lat === null || lng === null) { dropped += 1; continue; }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { dropped += 1; continue; }
    if (lat === 0 && lng === 0) { dropped += 1; continue; }   // 明显的空值哨兵
    if (bounds) {
      const [[south, west], [north, east]] = bounds;
      if (lat < south || lat > north || lng < west || lng > east) { dropped += 1; continue; }
    }
    const id = pickId(record);
    if (id !== null) {
      if (seenIds.has(id)) { duplicates += 1; continue; }
      seenIds.add(id);
    }
    if (valid.length >= MAX_POINTS) { truncated += 1; continue; }

    const weights = {};
    for (const field of WEIGHT_FIELDS) {
      const value = finiteNumber(record[field.key]);
      weights[field.key] = value !== null && value >= 0 ? value : null;
    }
    valid.push({ lat, lng, weights });
  }

  // 选口径：第一个至少在一条记录里给出有效数值的字段；否则退化为密度。
  let metric = null, metricLabel = "位置记录密度", mode = "density", coverage = 0;
  for (const field of WEIGHT_FIELDS) {
    const n = valid.reduce((acc, row) => acc + (row.weights[field.key] !== null ? 1 : 0), 0);
    if (n > 0) { metric = field.key; metricLabel = field.label; mode = "weight"; coverage = n; break; }
  }

  // 同坐标合并：重复位置不人为放大斑点数量，但总量/计数累加，保留分布差异。
  const byCoord = new Map();
  for (const row of valid) {
    const key = `${row.lat.toFixed(COORD_PRECISION)},${row.lng.toFixed(COORD_PRECISION)}`;
    let weight = 1;
    if (mode === "weight") {
      const value = row.weights[metric];
      if (value === null) invalidWeight += 1;
      else weight = value;
    }
    let point = byCoord.get(key);
    if (!point) {
      point = { lat: row.lat, lng: row.lng, weight: 0, count: 0 };
      byCoord.set(key, point);
    }
    point.weight += weight;
    point.count += 1;
  }

  const points = renormalizeHeatPoints(Array.from(byCoord.values()), mode);
  const maxWeight = points.reduce((max, p) => Math.max(max, p.weight), 0);

  for (const point of points) {
    point.key = `${point.lat},${point.lng}`;
    if (transform) {
      const [glng, glat] = transform(point.lng, point.lat);
      point.gcjLng = Number.isFinite(glng) ? glng : point.lng;
      point.gcjLat = Number.isFinite(glat) ? glat : point.lat;
    } else {
      point.gcjLng = point.lng;
      point.gcjLat = point.lat;
    }
  }

  return {
    points,
    metric,
    metricLabel,
    mode,
    maxWeight,
    stats: {
      sourceCount: rows.length,
      validCount: valid.length,
      pointCount: points.length,
      coordMerged: valid.length - points.length,
      coverage,
      dropped,
      duplicates,
      truncated,
      invalidWeight,
    },
  };
}

export function tierColor(level) {
  const tier = HEAT_TIERS.find((item) => item.key === level);
  return tier ? tier.color : HEAT_TIERS[0].color;
}

/**
 * 二维空间网格聚合（纯函数）：把岸段记录落入网格单元，按单元内记录聚合值连续着色。
 * 这是「聚合」，不是插值：没有记录的格子不生成颜色，由界面单独表达为空白。
 * @param {Array} records MAP-01 sections
 * @param {object} [options] { columns=14, rows=9, paddingRatio=0.35 }
 * @returns {{cells:Array, columns:number, rows:number, maxValue:number, metricLabel:string, stats:object}}
 */
export function buildGridHeat(records, options = {}) {
  const rows = Math.max(1, Math.round(options.rows ?? 9));
  const columns = Math.max(1, Math.round(options.columns ?? 14));
  const paddingRatio = Number.isFinite(options.paddingRatio) ? options.paddingRatio : 0.35;
  const list = (Array.isArray(records) ? records : []).filter((record) => record && typeof record === "object");
  const valid = [];
  const seen = new Set();

  for (const record of list) {
    const lat = pickCoord(record, LAT_FIELDS);
    const lng = pickCoord(record, LNG_FIELDS);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (lat === 0 && lng === 0) continue;
    const id = record.section_id ?? record.id ?? record.report_id;
    if (id !== undefined && id !== null && id !== "") {
      if (seen.has(String(id))) continue;
      seen.add(String(id));
    }
    const heat = finiteNumber(record.heat_value);
    const kg = finiteNumber(record.cleanup_kg_total);
    const weight = heat !== null && heat >= 0 ? heat : (kg !== null && kg >= 0 ? kg : 1);
    valid.push({ lat, lng, weight, record });
  }

  if (!valid.length) {
    return {
      cells: [], columns, rows, maxValue: 0, metricLabel: "记录聚合程度",
      stats: { sourceCount: list.length, validCount: 0, cellCount: 0 },
    };
  }

  let minLat = Math.min(...valid.map((item) => item.lat));
  let maxLat = Math.max(...valid.map((item) => item.lat));
  let minLng = Math.min(...valid.map((item) => item.lng));
  let maxLng = Math.max(...valid.map((item) => item.lng));
  const latSpan = Math.max(maxLat - minLat, 0.04);
  const lngSpan = Math.max(maxLng - minLng, 0.04);
  minLat -= latSpan * paddingRatio;
  maxLat += latSpan * paddingRatio;
  minLng -= lngSpan * paddingRatio;
  maxLng += lngSpan * paddingRatio;

  const byCell = new Map();
  for (const item of valid) {
    const col = Math.max(0, Math.min(columns - 1, Math.floor(((item.lng - minLng) / (maxLng - minLng)) * columns)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((maxLat - item.lat) / (maxLat - minLat)) * rows)));
    const key = `${row}:${col}`;
    if (!byCell.has(key)) byCell.set(key, { row, col, value: 0, count: 0, sectionIds: [] });
    const cell = byCell.get(key);
    cell.value += item.weight;
    cell.count += 1;
    if (item.record.section_id) cell.sectionIds.push(item.record.section_id);
  }

  const maxValue = Math.max(0, ...Array.from(byCell.values()).map((cell) => cell.value));
  const cells = Array.from(byCell.values()).map((cell) => {
    const t = maxValue > 0 ? Math.max(0, Math.min(1, cell.value / maxValue)) : 0;
    return {
      ...cell,
      t,
      color: springColor(t),
      x: cell.col / columns,
      y: cell.row / rows,
      w: 1 / columns,
      h: 1 / rows,
    };
  });

  return {
    cells, columns, rows, maxValue,
    metricLabel: "记录聚合程度",
    stats: { sourceCount: list.length, validCount: valid.length, cellCount: cells.length },
  };
}

// ---------------------------------------------------------------------------
// Canvas 核密度热力层（Leaflet 1.9.4）
// ---------------------------------------------------------------------------

// alpha → RGBA 查色表。春彩虹系连续色带：嫩芽绿 → 迎春黄 → 杏橙 → 桃粉 → 淡紫。
// alpha 越大越不透明；低 alpha 仍是绿色，不出现离散蓝色斑点。
const COLOR_STOPS = [
  { t: 0.00, rgb: [158, 219, 122], a: 0 },
  { t: 0.14, rgb: [158, 219, 122], a: 92 },
  { t: 0.30, rgb: [240, 226, 106], a: 160 },
  { t: 0.50, rgb: [246, 178, 107], a: 204 },
  { t: 0.72, rgb: [242, 154, 181], a: 236 },
  { t: 1.00, rgb: [199, 166, 232], a: 250 },
];

function buildColorLut() {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let a = 0; a < 256; a += 1) {
    const t = a / 255;
    let lo = COLOR_STOPS[0], hi = COLOR_STOPS[COLOR_STOPS.length - 1];
    for (let i = 1; i < COLOR_STOPS.length; i += 1) {
      if (t <= COLOR_STOPS[i].t) { lo = COLOR_STOPS[i - 1]; hi = COLOR_STOPS[i]; break; }
    }
    const span = hi.t - lo.t || 1;
    const k = Math.max(0, Math.min(1, (t - lo.t) / span));
    const o = a * 4;
    for (let c = 0; c < 3; c += 1) lut[o + c] = lo.rgb[c] + (hi.rgb[c] - lo.rgb[c]) * k;
    lut[o + 3] = lo.a + (hi.a - lo.a) * k;
  }
  return lut;
}

function makeDisc(radius) {
  const size = radius * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.45, "rgba(0,0,0,0.62)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * 在 Leaflet 地图上挂一层 Canvas 热力图。
 * 层级：自定义 pane（默认 610），位于瓦片(200) 之上、岸段标记(620) / 弹窗(700) 之下。
 * 同步：监听 move / moveend / viewreset / resize / zoomend 并用 rAF 合帧重绘；
 *       每次重绘都重新 latLngToContainerPoint，缩放与平移后点位始终跟底图对齐；
 *       缩放动画期间短暂隐藏，避免 CSS transform 与容器坐标不一致造成可见错位。
 * 隔离：canvas 与 pane 均 pointer-events:none，不拦截拖拽、滚轮、标记点击与弹窗。
 * @returns {{setPoints:Function, setEnabled:Function, redraw:Function, destroy:Function, getCanvas:Function}}
 */
export function createLeafletHeatLayer(map, options = {}) {
  const paneName = options.paneName || "trashHeat";
  const pane = map.getPane(paneName) || map.createPane(paneName);
  pane.style.zIndex = String(options.zIndex ?? 610);
  pane.style.pointerEvents = "none";

  const canvas = L.DomUtil.create("canvas", "trash-heat-canvas", pane);
  canvas.style.pointerEvents = "none";
  const ctx = canvas.getContext("2d");
  const buffer = document.createElement("canvas");
  const bufferCtx = buffer.getContext("2d", { willReadFrequently: true });
  const lut = buildColorLut();

  let points = [];
  let enabled = options.enabled !== false;
  let destroyed = false;
  let frame = 0;
  let discRadius = 0;
  let disc = null;

  function radiusFor(zoom) {
    const base = options.baseRadius ?? 30;
    const reference = options.referenceZoom ?? 8;
    return Math.max(18, Math.min(64, Math.round(base + (zoom - reference) * 3)));
  }

  function redraw() {
    if (destroyed) return;
    const size = map.getSize();
    const width = Math.max(1, Math.round(size.x));
    const height = Math.max(1, Math.round(size.y));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      buffer.width = width; buffer.height = height;
    }
    // canvas 落在 map pane 内；把它的原点对齐到当前容器左上角，抵消平移 transform
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.clearRect(0, 0, width, height);
    if (!enabled || !points.length) return;

    const radius = radiusFor(map.getZoom());
    if (!disc || discRadius !== radius) { disc = makeDisc(radius); discRadius = radius; }
    const span = radius * 2;
    bufferCtx.clearRect(0, 0, width, height);
    bufferCtx.globalCompositeOperation = "source-over";
    for (const point of points) {
      const lat = Number.isFinite(point.gcjLat) ? point.gcjLat : point.lat;
      const lng = Number.isFinite(point.gcjLng) ? point.gcjLng : point.lng;
      const c = map.latLngToContainerPoint([lat, lng]);
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      if (c.x < -radius || c.y < -radius || c.x > width + radius || c.y > height + radius) continue;
      bufferCtx.globalAlpha = Math.max(0.04, Math.min(1, Number(point.intensity) || 0.1));
      bufferCtx.drawImage(disc, Math.round(c.x - radius), Math.round(c.y - radius), span, span);
    }
    bufferCtx.globalAlpha = 1;

    const image = bufferCtx.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;
      const o = alpha * 4;
      data[i] = lut[o]; data[i + 1] = lut[o + 1]; data[i + 2] = lut[o + 2]; data[i + 3] = lut[o + 3];
    }
    ctx.putImageData(image, 0, 0);
  }

  function schedule() {
    if (destroyed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!destroyed) redraw();
    });
  }

  // 缩放动画走 CSS transform；期间不重绘也不显示，动画结束立即按新级别重绘
  const onZoomAnim = () => { if (!destroyed) canvas.style.opacity = "0"; };
  const onZoomEnd = () => {
    if (destroyed) return;
    canvas.style.opacity = "";
    schedule();
  };
  map.on("move", schedule);
  map.on("moveend", schedule);
  map.on("viewreset", schedule);
  map.on("resize", schedule);
  map.on("zoomanim", onZoomAnim);
  map.on("zoomend", onZoomEnd);

  redraw();

  return {
    setPoints(list) {
      points = Array.isArray(list) ? list : [];
      schedule();
    },
    setEnabled(value) {
      enabled = Boolean(value);
      schedule();
    },
    redraw: schedule,
    getCanvas: () => canvas,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      map.off("move", schedule);
      map.off("moveend", schedule);
      map.off("viewreset", schedule);
      map.off("resize", schedule);
      map.off("zoomanim", onZoomAnim);
      map.off("zoomend", onZoomEnd);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      points = [];
      disc = null;
    },
  };
}
