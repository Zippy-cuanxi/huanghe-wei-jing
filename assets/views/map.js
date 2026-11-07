// 垃圾地图栏目：只渲染 MAP-01 的粗化岸段、heat_value、cleanup_kg_total。
// 公众线不展示原始/粗化坐标数值；二维网格为聚合示意，不做插值，空白单独表达。
// 真实底图与河道能力保留（用户确认），但公开文案将其视为地理语境，不作测绘成果。

import {
  api,
  copyText,
  currentPeriodMonth,
  formatKg,
  formatNumber,
  formatPeriod,
  periodError,
  rememberSections,
  sectionOptions,
  toast,
} from "../lib.js";
import { RiverMap, wgs84ToGcj02 } from "./river-map.js";
import { SectionSatellite } from "./section-satellite.js";
import { buildGridHeat, buildHeatPoints, HEAT_GRADIENT_CSS, HEAT_TIERS, springColor } from "./trash-heat.js";
import { COLUMN_SCOPE, PROVENANCE } from "../content.js";

const { computed, onMounted, ref } = Vue;

const VIEW_MODES = [
  { key: "grid", label: "示意网格", icon: "ri-grid-line" },
  { key: "standard", label: "标准地图（演示）", icon: "ri-map-2-line" },
  { key: "satellite", label: "卫星影像（演示）", icon: "ri-earth-line" },
];

function buildMatrixPeriods(anchor) {
  const text = String(anchor || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return [text || currentPeriodMonth()];
  const [year, month] = text.split("-").map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (5 - index), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export const MapView = {
  name: "MapView",
  components: { RiverMap, SectionSatellite },
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const period = ref(props.route.query.period || currentPeriodMonth());
    const sectionId = ref(props.route.query.section_id || "");
    const page = ref(Number(props.route.query.page) || 1);
    const pageSize = 100;
    const loading = ref(false);
    const error = ref(null);
    const data = ref(null);
    const selectedId = ref("");
    const localPeriodError = ref("");
    const viewMode = ref("grid");
    const layoutMode = ref("map"); // matrix | map；默认打开即「示意地图」
    // 演示增强视图（标准地图 / 卫星影像 / 真实河道）默认可见；?demo-map=0 可显式关闭。
    const demoMapEnabled = new URLSearchParams(window.location.search).get("demo-map") !== "0";
    const availableViewModes = computed(() => demoMapEnabled ? VIEW_MODES : VIEW_MODES.slice(0, 1));
    const heatEnabled = ref(true);
    const isDemoMap = computed(() => viewMode.value !== "grid");
    const matrixPeriods = ref([]);

    const sections = computed(() => Array.isArray(data.value?.sections) ? data.value.sections : []);
    const heatStat = computed(() => buildHeatPoints(sections.value, { transform: wgs84ToGcj02 }));
    const gridHeat = computed(() => buildGridHeat(sections.value, { columns: 14, rows: 9 }));
    const heatSummary = computed(() => {
      const s = heatStat.value.stats;
      const skipped = s.dropped + s.duplicates + s.truncated;
      const parts = [`本页 ${s.sourceCount} 条岸段记录，聚合为 ${gridHeat.value.stats.cellCount} 个有记录的网格`];
      if (skipped) parts.push(`稳妥剔除 ${skipped} 条无效 / 重复 / 超限记录`);
      if (s.coordMerged) parts.push(`合并 ${s.coordMerged} 处同坐标记录`);
      parts.push("颜色表示记录聚合程度，不代表污染浓度；空白表示无公开记录");
      return parts.join("；") + "。";
    });
    const auditNo = computed(() => data.value?.map_audit_no ?? null);
    const coarsenDegree = computed(() => data.value?.coarsen_degree ?? null);
    const isGate = computed(() => !loading.value && !error.value && data.value !== null && auditNo.value === null);
    const isEmpty = computed(() => !loading.value && !error.value && data.value !== null && auditNo.value !== null && sections.value.length === 0);
    const selected = computed(() => sections.value.find((s) => s.section_id === selectedId.value) || sections.value[0] || null);
    const options = computed(() => sectionOptions());
    const sampleOnly = computed(() => typeof auditNo.value === "string" && auditNo.value.startsWith("SAMPLE-ONLY"));
    const columnScope = COLUMN_SCOPE.map;

    const filterCount = computed(() => {
      let count = 0;
      if (period.value !== currentPeriodMonth()) count += 1;
      if (sectionId.value) count += 1;
      return count;
    });

    const provenanceItems = computed(() => {
      const items = [...PROVENANCE.map.items];
      if (sampleOnly.value) items.push("当前审图号为演示占位，正式上线前须替换为授权审图号。");
      return items;
    });

    const matrixRows = computed(() => {
      const byId = new Map();
      for (const entry of matrixPeriods.value) {
        for (const section of entry.sections || []) {
          if (!byId.has(section.section_id)) {
            byId.set(section.section_id, {
              section_id: section.section_id,
              name: section.name,
              shortName: String(section.name || section.section_id).replace(/^示例岸段/, "岸段"),
              anchorCleanup: Number(section.cleanup_kg_total) || 0,
              cells: [],
            });
          }
        }
      }
      const rows = [...byId.values()];
      const max = Math.max(0, ...matrixPeriods.value.flatMap((entry) => entry.sections || [])
        .map((section) => Number(section.heat_value) || 0));
      for (const row of rows) {
        row.cells = matrixPeriods.value.map((entry) => {
          const section = (entry.sections || []).find((item) => item.section_id === row.section_id) || null;
          const heat = section ? Number(section.heat_value) : null;
          const cleanup = section ? Number(section.cleanup_kg_total) : null;
          const hasHeat = Number.isFinite(heat) && heat > 0;
          const zero = Boolean(section) && Number.isFinite(heat) && heat === 0
            && Number.isFinite(cleanup) && cleanup > 0;
          const insufficient = Boolean(section) && !Number.isFinite(heat);
          const blank = !section || (!hasHeat && !zero && !insufficient);
          const t = max > 0 && hasHeat ? heat / max : 0;
          return {
            period: entry.period, section, heat, cleanup, hasHeat, zero, insufficient, blank, t,
            color: hasHeat ? springColor(t) : null,
          };
        });
        const anchorCell = row.cells.find((cell) => cell.period === period.value);
        row.anchorCleanup = anchorCell?.cleanup ?? null;
        row.anchorHasHeat = Boolean(anchorCell?.hasHeat);
      }
      return rows.filter((row) => !sectionId.value || row.section_id === sectionId.value);
    });

    const matrixPeriodsLatestFirst = computed(() => [...matrixPeriods.value].reverse());

    function cellFor(row, periodValue) {
      return row.cells.find((cell) => cell.period === periodValue) || {
        period: periodValue, section: null, blank: true, zero: false, insufficient: false, hasHeat: false,
      };
    }

    const matrixStats = computed(() => {
      let record = 0, zero = 0, blank = 0, insufficient = 0;
      for (const row of matrixRows.value) {
        for (const cell of row.cells) {
          if (cell.hasHeat) record += 1;
          else if (cell.zero) zero += 1;
          else if (cell.insufficient) insufficient += 1;
          else blank += 1;
        }
      }
      return { rows: matrixRows.value.length, periods: matrixPeriods.value.length, record, zero, blank, insufficient };
    });

    const matrixNote = computed(() => {
      if (!matrixPeriods.value.length) return "";
      const withRecords = matrixPeriods.value.filter((entry) =>
        (entry.sections || []).some((section) => Number(section.heat_value) > 0)).length;
      const failed = matrixPeriods.value.filter((entry) => entry.error).length;
      const parts = [];
      if (withRecords === 0) parts.push("当前矩阵中没有公开记录；空白不代表干净，也不代表没有垃圾。");
      else if (matrixPeriods.value.length === 1) parts.push("当前只显示 1 个周期；历史周期待数据接入。");
      else if (withRecords === 1) parts.push("最近 6 个月中只有 1 个周期有公开记录；其余列显示为空白，不拼接、不补造。");
      else parts.push("矩阵按当前筛选周期回溯最近 6 个月；空白表示该周期暂无公开记录。");
      if (failed) parts.push(`有 ${failed} 个历史周期加载失败，已保留为空白列。`);
      parts.push("颜色表示记录聚合程度，不是污染浓度。");
      return parts.join("");
    });

    const summaryRecordCells = computed(() =>
      layoutMode.value === "matrix" ? matrixStats.value.record : gridHeat.value.stats.cellCount);

    function activeSectionCount(entry) {
      return (entry.sections || []).filter((section) => Number(section.heat_value) > 0).length;
    }

    function matrixCellClass(cell) {
      return {
        "is-zero": cell.zero,
        "is-blank": cell.blank,
        "is-insufficient": cell.insufficient,
      };
    }

    function matrixCellStyle(cell) {
      return cell.color ? { background: cell.color } : null;
    }

    function matrixCellTitle(row, cell) {
      const periodLabel = formatPeriod(cell.period);
      if (cell.insufficient) return `${row.name} · ${periodLabel}：数据不足，暂不做强度结论`;
      if (cell.zero) return `${row.name} · ${periodLabel}：有记录，聚合值为零；清理量 ${formatKg(cell.cleanup)}`;
      if (!cell.hasHeat) return `${row.name} · ${periodLabel}：暂无公开记录`;
      return `${row.name} · ${periodLabel}：记录聚合程度 ${formatNumber(cell.heat)}；清理量 ${formatKg(cell.cleanup)}`;
    }

    function openMatrixCell(cell) {
      if (!cell.section || cell.blank) return;
      props.navigate(`/map/section/${encodeURIComponent(cell.section.section_id)}?period=${encodeURIComponent(cell.period)}`);
    }

    function openSection(row) {
      const withData = row.cells.filter((cell) => cell.section);
      const latest = withData.length ? withData[withData.length - 1] : null;
      if (latest) props.navigate(`/map/section/${encodeURIComponent(row.section_id)}?period=${encodeURIComponent(latest.period)}`);
    }

    function openPeriod(value) {
      props.navigate(`/publicity/${encodeURIComponent(value)}`);
    }

    const geometry = computed(() => {
      const items = sections.value;
      const width = 820;
      const height = 460;
      const padX = 56;
      const padY = 44;
      if (!items.length) return { width, height, points: [], cells: [], river: "", cellW: 0, cellH: 0, padX, padY };
      const lats = items.map((s) => s.coarse_lat);
      const lngs = items.map((s) => s.coarse_lng);
      let minLat = Math.min(...lats);
      let maxLat = Math.max(...lats);
      let minLng = Math.min(...lngs);
      let maxLng = Math.max(...lngs);
      const latSpan = Math.max(maxLat - minLat, 0.04);
      const lngSpan = Math.max(maxLng - minLng, 0.04);
      const latPad = latSpan * 0.35;
      const lngPad = lngSpan * 0.35;
      minLat -= latPad; maxLat += latPad; minLng -= lngPad; maxLng += lngPad;
      const project = (lat, lng) => {
        const x = padX + ((lng - minLng) / (maxLng - minLng || 1)) * (width - padX * 2);
        const y = padY + ((maxLat - lat) / (maxLat - minLat || 1)) * (height - padY * 2);
        return [x, y];
      };
      const points = items.map((section) => {
        const [x, y] = project(section.coarse_lat, section.coarse_lng);
        return {
          ...section,
          x, y,
          label: section.name.length > 10 ? `${section.name.slice(0, 9)}…` : section.name,
        };
      });
      const cellW = (width - padX * 2) / gridHeat.value.columns;
      const cellH = (height - padY * 2) / gridHeat.value.rows;
      const cells = gridHeat.value.cells.map((cell) => ({
        ...cell,
        x: padX + cell.col * cellW,
        y: padY + cell.row * cellH,
        w: cellW,
        h: cellH,
      }));
      return {
        width, height, points, cells, cellW, cellH, padX, padY,
        river: `M40 ${height * 0.3}C${width * 0.28} ${height * 0.1}, ${width * 0.36} ${height * 0.62}, ${width * 0.58} ${height * 0.44}S${width * 0.84} ${height * 0.2}, ${width - 20} ${height * 0.38}`,
      };
    });

    async function fetchPeriodData(value) {
      const result = await api("MAP-01", {
        query: { period: value, page_no: 1, page_size: 100 },
      });
      return {
        period: value,
        result,
        sections: Array.isArray(result.sections) ? result.sections : [],
      };
    }

    async function load() {
      if (!period.value.trim()) { localPeriodError.value = "请输入统计周期"; return; }
      const pErr = periodError(period.value);
      if (pErr) { localPeriodError.value = pErr; return; }
      localPeriodError.value = "";
      const anchorPeriod = period.value.trim();
      const periods = buildMatrixPeriods(anchorPeriod);
      loading.value = true;
      error.value = null;
      try {
        const settled = await Promise.allSettled(periods.map(fetchPeriodData));
        const entries = settled.map((result, index) => (
          result.status === "fulfilled"
            ? result.value
            : { period: periods[index], sections: [], error: result.reason }
        ));
        matrixPeriods.value = entries;
        const anchor = entries.find((entry) => entry.period === anchorPeriod);
        if (!anchor || anchor.error) throw anchor?.error || new Error("当前周期加载失败");
        const filteredSections = (anchor.sections || []).filter((section) =>
          !sectionId.value || section.section_id === sectionId.value);
        data.value = { ...anchor.result, sections: filteredSections, total: filteredSections.length };
        rememberSections(entries.flatMap((entry) => entry.sections || []));
        if (!filteredSections.some((section) => section.section_id === selectedId.value)) {
          selectedId.value = filteredSections[0]?.section_id ?? "";
        }
      } catch (err) {
        error.value = err;
        data.value = null;
        matrixPeriods.value = [];
      } finally {
        loading.value = false;
      }
    }
    function applyFilter() { page.value = 1; load(); }
    function resetFilter() { period.value = currentPeriodMonth(); sectionId.value = ""; page.value = 1; load(); }
    function goPage(next) { page.value = next; load(); }
    function refresh() { load(); }
    function login() { props.navigate(`/auth?mode=login&returnTo=${encodeURIComponent("/map")}`); }

    async function share() {
      const ok = await copyText(window.location.href);
      toast(ok ? "页面地址已复制" : "复制失败，请手动复制地址", { tone: ok ? "success" : "warning" });
    }

    onMounted(load);

    return {
      period, sectionId, page, pageSize, loading, error, data, selectedId, localPeriodError,
      viewMode, viewModes: availableViewModes, layoutMode, demoMapEnabled, isDemoMap, heatEnabled, heatStat, gridHeat, heatSummary,
      heatGradient: HEAT_GRADIENT_CSS, heatTiers: HEAT_TIERS, springColor,
      sections, auditNo, coarsenDegree, isGate, isEmpty, selected, options, sampleOnly, geometry,
      columnScope, provenanceItems, filterCount, matrixPeriods, matrixPeriodsLatestFirst, matrixRows, matrixStats, matrixNote, summaryRecordCells, cellFor,
      activeSectionCount, matrixCellClass, matrixCellStyle, matrixCellTitle, openMatrixCell, openSection, openPeriod,
      formatPeriod, formatKg, formatNumber, currentPeriodMonth,
      applyFilter, resetFilter, goPage, refresh, login, share, navigate: props.navigate,
    };
  },
  template: `
    <section class="page-shell map-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '垃圾地图' }]" />
      <PageHeader eyebrow="垃圾地图" title="问题在哪，一眼看见"
        description="按岸段查看审核通过的公开记录；颜色表示记录聚合程度，不是污染浓度。">
        <template #meta>
          <AppBadge :label="'周期：' + formatPeriod(period)" tone="info" icon-name="clock" />
          <AppBadge label="仅审核通过数据" tone="good" icon-name="check" />
          <AppBadge :label="layoutMode === 'matrix' ? '岸段 × 周期 · 非插值' : '示意网格 · 非插值'" tone="neutral" icon-name="grid" />
          <AppBadge label="演示数据" tone="neutral" icon-name="info" />
          <AppBadge v-if="demoMapEnabled" label="演示增强 · G3 待确认" tone="warning" icon-name="alert" />
        </template>
        <template #actions>
          <div class="view-switch" role="group" aria-label="地图主视图切换">
            <button class="view-switch-btn" :class="{ 'is-active': layoutMode === 'matrix' }" type="button" :aria-pressed="layoutMode === 'matrix'" @click="layoutMode = 'matrix'"><i class="ri-grid-line" aria-hidden="true"></i>分布矩阵</button>
            <button class="view-switch-btn" :class="{ 'is-active': layoutMode === 'map' }" type="button" :aria-pressed="layoutMode === 'map'" @click="layoutMode = 'map'"><i class="ri-map-2-line" aria-hidden="true"></i>示意地图</button>
          </div>
          <button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button>
          <button class="btn btn-secondary" type="button" @click="refresh"><i class="ri-refresh-line" aria-hidden="true"></i>刷新</button>
        </template>
      </PageHeader>

      <section class="map-summary-strip" aria-label="本期地图概况">
        <div class="map-summary-item"><span>岸段</span><strong>{{ matrixRows.length || (data ? sections.length : '—') }}</strong><em>个</em></div>
        <div class="map-summary-item"><span>有记录格子</span><strong>{{ summaryRecordCells }}</strong><em>格</em></div>
        <div class="map-summary-item"><span>周期</span><strong>{{ matrixPeriods.length || '—' }}</strong><em>列</em></div>
        <Provenance title="地图口径与来源" :items="provenanceItems" />
      </section>

      <SectionCard class-name="filter-card" title="筛选" description="周期支持 YYYY-MM 或 YYYY-Www；默认当月。">
        <FilterShell :active-count="filterCount">
        <form class="filter-form" novalidate @submit.prevent="applyFilter">
          <label class="field field-inline">
            <span class="field-label">统计周期</span>
            <div class="input-with-action">
              <input v-model="period" class="input" placeholder="YYYY-MM 或 YYYY-Www" autocomplete="off" :aria-invalid="localPeriodError ? 'true' : null" />
              <button class="btn btn-ghost btn-sm" type="button" @click="period = currentPeriodMonth(); applyFilter()"><i class="ri-calendar-line" aria-hidden="true"></i>本月</button>
            </div>
            <FieldError :message="localPeriodError" />
          </label>
          <label class="field field-inline">
            <span class="field-label">岸段筛选</span>
            <select v-if="options.length" v-model="sectionId" class="select">
              <option value="">全部岸段</option>
              <option v-for="item in options" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <span v-else class="muted">岸段列表尚未加载；先查询一次即可缓存本页岸段。</span>
          </label>
          <div class="filter-actions">
            <button class="btn btn-primary" type="submit"><i class="ri-search-line" aria-hidden="true"></i>查询</button>
            <button class="btn btn-ghost" type="button" @click="resetFilter"><i class="ri-refresh-line" aria-hidden="true"></i>重置</button>
          </div>
        </form>
        </FilterShell>
      </SectionCard>

      <div v-if="loading" class="card"><div class="card-body"><LoadingBlock label="加载地图岸段" :cards="2" :lines="3" /></div></div>
      <PublicErrorPanel v-else-if="error" :error="error" @retry="refresh" />

      <SectionCard v-else-if="isGate" title="地图暂不可用" description="点位展示需要完成地图合规配置；当前后端未下发任何点位。">
        <StatePanel tone="blocked" icon-name="shield" title="当前不展示任何点位"
          description="这是地图合规闸门，不是「没有垃圾」。配置完成前，本站不补造审图号、不反推坐标，也不渲染岸段标记。">
          <template #actions>
            <button class="btn btn-secondary btn-sm" type="button" @click="refresh"><i class="ri-refresh-line" aria-hidden="true"></i>重新查询</button>
            <a class="btn btn-ghost btn-sm" href="#/publicity">查看成效公示</a>
          </template>
        </StatePanel>
      </SectionCard>

      <SectionCard v-else-if="isEmpty" title="该周期暂无公开岸段记录">
        <StatePanel tone="empty" icon-name="map" title="暂无公开记录"
          description="空白不代表干净，也不代表没有垃圾；只表示本期暂无审核通过的公开记录。你可以换一个周期，或查看其他栏目。" />
      </SectionCard>

      <template v-else-if="data">
        <div class="map-layout">
          <div class="map-main">
            <SectionCard v-if="layoutMode === 'matrix'" class-name="matrix-card"
              title="岸段 × 周期 · 分布矩阵"
              description="纵轴为岸段，横轴为周期；颜色表示审核通过的公开记录聚合程度，不是污染浓度。空白表示该周期暂无公开记录。">
              <template #actions>
                <AppBadge label="仅审核通过记录" tone="good" icon-name="check" />
                <AppBadge label="非插值" tone="neutral" icon-name="grid" />
              </template>
              <div v-if="matrixRows.length" class="matrix-block">
                <div class="matrix-scroll">
                  <div class="matrix-grid matrix-grid-desktop" :style="{ gridTemplateColumns: 'minmax(150px, 1.4fr) repeat(' + matrixPeriods.length + ', minmax(72px, 1fr))' }">
                    <div class="matrix-corner">岸段 \ 周期</div>
                    <button v-for="entry in matrixPeriods" :key="entry.period" class="matrix-col-head" :class="{ 'is-current': entry.period === period }" type="button" @click="openPeriod(entry.period)">
                      <span>{{ formatPeriod(entry.period) }}</span>
                      <small>{{ entry.period === period ? '当前 · ' : '' }}{{ activeSectionCount(entry) ? activeSectionCount(entry) + ' 段有记录' : '无公开记录' }}</small>
                    </button>
                    <template v-for="row in matrixRows" :key="row.section_id">
                      <button class="matrix-row-head" :class="{ 'is-selected': row.section_id === selectedId }" type="button" @click="openSection(row)">
                        <strong>{{ row.name }}</strong><span>{{ row.section_id }}</span>
                        <small class="matrix-row-meta">{{ row.anchorHasHeat ? '本期 ' + formatKg(row.anchorCleanup) : '本期无公开记录' }}</small>
                      </button>
                      <component :is="cell.blank ? 'div' : 'button'" v-for="cell in row.cells" :key="row.section_id + cell.period"
                        class="matrix-cell" :class="matrixCellClass(cell)" :style="matrixCellStyle(cell)"
                        :title="matrixCellTitle(row, cell)" :aria-label="matrixCellTitle(row, cell)"
                        :type="cell.blank ? null : 'button'" @click="!cell.blank && openMatrixCell(cell)">
                        <span v-if="cell.zero" class="matrix-zero">0</span>
                        <span v-else-if="cell.insufficient" class="matrix-insufficient">?</span>
                      </component>
                    </template>
                  </div>
                </div>
                <div class="matrix-grid matrix-grid-mobile" :style="{ gridTemplateColumns: 'minmax(96px, 1.1fr) repeat(' + matrixRows.length + ', minmax(58px, 1fr))' }">
                  <div class="matrix-corner">周期 \ 岸段</div>
                  <button v-for="row in matrixRows" :key="'mh-' + row.section_id" class="matrix-col-head" type="button" @click="openSection(row)">
                    <span>{{ row.shortName || row.name }}</span><small>{{ row.section_id }}</small>
                  </button>
                  <template v-for="entry in matrixPeriodsLatestFirst" :key="'mp-' + entry.period">
                    <button class="matrix-row-head" :class="{ 'is-current': entry.period === period }" type="button" @click="openPeriod(entry.period)"><strong>{{ formatPeriod(entry.period) }}</strong></button>
                    <component :is="cellFor(row, entry.period).blank ? 'div' : 'button'" v-for="row in matrixRows" :key="'mc-' + entry.period + '-' + row.section_id"
                      class="matrix-cell" :class="matrixCellClass(cellFor(row, entry.period))" :style="matrixCellStyle(cellFor(row, entry.period))"
                      :title="matrixCellTitle(row, cellFor(row, entry.period))" :aria-label="matrixCellTitle(row, cellFor(row, entry.period))"
                      :type="cellFor(row, entry.period).blank ? null : 'button'" @click="!cellFor(row, entry.period).blank && openMatrixCell(cellFor(row, entry.period))">
                      <span v-if="cellFor(row, entry.period).zero" class="matrix-zero">0</span>
                      <span v-else-if="cellFor(row, entry.period).insufficient" class="matrix-insufficient">?</span>
                    </component>
                  </template>
                </div>
                <p class="matrix-scroll-hint">左右滑动查看岸段；周期从上到下由新到旧</p>
                <div class="matrix-legend">
                  <div class="matrix-legend-head"><strong>记录聚合程度</strong><span>同一矩阵内相对归一化，非污染浓度</span></div>
                  <div class="heat-gradient" :style="{ background: heatGradient }" aria-hidden="true"></div>
                  <div class="heat-gradient-labels"><span>少</span><span>空白 = 暂无公开记录</span><span>多</span></div>
                  <div class="matrix-state-chips">
                    <span><i class="matrix-chip matrix-chip-zero" aria-hidden="true"></i>空心 = 有记录，值为零</span>
                    <span><i class="matrix-chip matrix-chip-blank" aria-hidden="true"></i>空白 = 暂无公开记录</span>
                    <span><i class="matrix-chip matrix-chip-insufficient" aria-hidden="true"></i>斜纹 = 数据不足</span>
                  </div>
                </div>
                <p class="matrix-note">{{ matrixNote }}</p>
              </div>
              <StatePanel v-else tone="empty" icon-name="grid" title="矩阵暂无公开记录"
                description="当前筛选下没有可展示的岸段；可以换一个周期，或查看示意地图。">
                <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="layoutMode = 'map'">查看示意地图</button></template>
              </StatePanel>
            </SectionCard>

            <SectionCard v-if="layoutMode === 'map'" class-name="map-card"
              :title="viewMode === 'grid' ? '岸线垃圾分布 · 二维网格' : (viewMode === 'satellite' ? '示例岸段 · 卫星影像' : '示例岸段 · 标准地图')"
              :description="viewMode === 'grid' ? '二维网格是空间聚合示意，行列仅为示意纬向/经向，不是公开坐标；有记录的格子连续着色，空白表示暂无公开记录。' : '仅支持甘肃省：影像与岸段标注限于省内；仍只使用后端粗化岸段位置。'">
              <template #actions>
                <div v-if="demoMapEnabled" class="river-basemap-switch" role="group" aria-label="岸段展示视图切换">
                  <button v-for="opt in viewModes" :key="opt.key" class="river-basemap-btn" type="button"
                    :class="{ 'is-active': viewMode === opt.key }" :aria-pressed="viewMode === opt.key ? 'true' : 'false'"
                    @click="viewMode = opt.key">
                    <i class="river-basemap-icon" :class="opt.icon" aria-hidden="true"></i>{{ opt.label }}
                  </button>
                </div>
                <button class="trash-heat-toggle" type="button" :class="{ 'is-on': heatEnabled }"
                  :aria-pressed="heatEnabled ? 'true' : 'false'"
                  :title="heatEnabled ? '关闭分布热力' : '开启分布热力'"
                  @click="heatEnabled = !heatEnabled">
                  <i class="ri-fire-line" aria-hidden="true"></i>{{ heatEnabled ? '热力已开' : '热力已关' }}
                </button>
                <span v-if="viewMode !== 'grid'" class="gansu-scope-badge" title="卫星/标准地图视图仅支持甘肃省">
                  <i class="ri-map-pin-2-line" aria-hidden="true"></i>仅支持甘肃省
                </span>
              </template>
              <div v-if="isDemoMap" class="notice notice-warning map-demo-notice">
                <i class="ri-alert-line notice-icon" aria-hidden="true"></i>
                <div class="notice-body">
                  <div class="notice-title">演示增强 · 非正式地图</div>
                  <div class="notice-text">标准地图/卫星影像是演示增强视图，不属于示意网格；G3 豁免待项目方书面确认。本视图不作为正式地图、测绘成果或公开地理依据。</div>
                </div>
              </div>

              <svg v-if="viewMode === 'grid'" :viewBox="'0 0 ' + geometry.width + ' ' + geometry.height" class="map-svg" role="group" aria-label="岸线垃圾二维网格分布示意；颜色表示记录聚合程度，空白表示暂无公开记录">
                <defs>
                  <pattern id="map-grid-app" width="64" height="64" patternUnits="userSpaceOnUse">
                    <path d="M64 0H0V64" class="map-grid-line" fill="none" />
                  </pattern>
                  <pattern v-if="geometry.cellW" id="heat-grid-app" :width="geometry.cellW" :height="geometry.cellH" patternUnits="userSpaceOnUse" :x="geometry.padX" :y="geometry.padY">
                    <rect :width="geometry.cellW" :height="geometry.cellH" class="heat-grid-cell-empty" />
                  </pattern>
                </defs>
                <rect :width="geometry.width" :height="geometry.height" class="map-bg" />
                <rect :width="geometry.width" :height="geometry.height" fill="url(#map-grid-app)" />
                <path :d="geometry.river" class="map-river" />
                <path :d="'M20 ' + geometry.height * 0.72 + 'C' + geometry.width * 0.22 + ' ' + geometry.height * 0.56 + ', ' + geometry.width * 0.4 + ' ' + geometry.height * 0.92 + ', ' + geometry.width * 0.62 + ' ' + geometry.height * 0.74 + 'S' + geometry.width * 0.84 + ' ' + geometry.height * 0.6 + ', ' + (geometry.width - 10) + ' ' + geometry.height * 0.7" class="map-river map-river-2" />
                <text x="20" y="24" class="heat-axis-label" aria-hidden="true">示意纬向 ↓</text>
                <text :x="geometry.width - 20" :y="geometry.height - 12" text-anchor="end" class="heat-axis-label" aria-hidden="true">示意经向 →</text>
                <g v-if="heatEnabled && geometry.cellW" class="heat-grid-layer" aria-hidden="true">
                  <rect v-if="heatEnabled" :x="geometry.padX" :y="geometry.padY" :width="geometry.width - geometry.padX * 2" :height="geometry.height - geometry.padY * 2" fill="url(#heat-grid-app)" />
                  <rect v-for="cell in geometry.cells" :key="cell.row + ':' + cell.col"
                    :x="cell.x + 1" :y="cell.y + 1" :width="Math.max(0, cell.w - 2)" :height="Math.max(0, cell.h - 2)"
                    rx="4" :fill="cell.color" :opacity="0.72" />
                </g>
                <g v-for="point in geometry.points" :key="point.section_id"
                  class="map-marker" :class="{ 'is-selected': selected?.section_id === point.section_id }"
                  tabindex="0" role="button"
                  :aria-label="point.name + '，分布程度 ' + formatNumber(point.heat_value) + '，清理量 ' + formatKg(point.cleanup_kg_total)"
                  @click="selectedId = point.section_id" @keydown.enter.prevent="selectedId = point.section_id" @keydown.space.prevent="selectedId = point.section_id">
                  <circle class="map-marker-halo" :cx="point.x" :cy="point.y" r="18" />
                  <circle class="map-marker-dot" :cx="point.x" :cy="point.y" r="7" />
                  <text class="map-label" :x="point.x" :y="point.y + 25" text-anchor="middle">{{ point.label }}</text>
                </g>
              </svg>
              <SectionSatellite v-else :sections="sections" :selected-id="selectedId" :base-key="viewMode"
                :heat-points="heatStat.points" :heat-enabled="heatEnabled" :heat-mode="heatStat.mode"
                @select="selectedId = $event" />
              <div v-if="heatEnabled" class="trash-heat-legend">
                <div class="trash-heat-legend-head">
                  <i class="ri-fire-line" aria-hidden="true"></i>
                  <strong>二维网格 · 连续色带</strong>
                  <span class="trash-heat-mode">记录聚合 · 非污染浓度</span>
                </div>
                <div class="trash-heat-scale" :style="{ background: heatGradient }" aria-hidden="true"></div>
                <div class="trash-heat-scale-labels">
                  <span>少 · 记录较少</span>
                  <span>空白 = 无公开记录</span>
                  <span>多 · 记录较密集</span>
                </div>
                <p class="trash-heat-note">{{ heatSummary }}</p>
              </div>
            </SectionCard>

            <SectionCard title="岸段一览" description="仅展示审核通过的公开汇总；分布程度不是污染浓度，记录条数不代表垃圾总量。">
              <div class="table-wrap">
                <table class="data-table section-table">
                  <thead><tr><th>岸段</th><th class="align-right">分布程度</th><th class="align-right">清理量</th><th>责任段</th><th></th></tr></thead>
                  <tbody>
                    <tr v-for="section in sections" :key="section.section_id" :class="{ 'is-selected': selected?.section_id === section.section_id }" @click="selectedId = section.section_id">
                      <td data-label="岸段"><span class="table-primary">{{ section.name }}</span><br /><code class="code-chip">{{ section.section_id }}</code></td>
                      <td class="align-right" data-label="分布程度"><HeatCell :value="section.heat_value" /></td>
                      <td class="align-right" data-label="清理量"><KgCell :value="section.cleanup_kg_total" /></td>
                      <td data-label="责任段">{{ section.responsible_org }}</td>
                      <td class="align-right" data-label="档案"><a class="table-link" :href="'#/map/section/' + encodeURIComponent(section.section_id) + '?period=' + encodeURIComponent(period)" @click.stop>岸段档案<i class="ri-arrow-right-line" aria-hidden="true"></i></a></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Pager :page="page" :total="data.total" :page-size="pageSize" :loading="loading" @update:page="goPage" />
            </SectionCard>

            <details v-if="demoMapEnabled" class="context-map">
              <summary><span><i class="ri-route-line" aria-hidden="true"></i>黄河干流地理示意（演示增强）</span><span class="muted">仅呈现河道，不含垃圾点位</span></summary>
              <div class="notice notice-warning map-demo-notice">
                <i class="ri-alert-line notice-icon" aria-hidden="true"></i>
                <div class="notice-body"><div class="notice-text">演示增强视图；G3 豁免待项目方书面确认。不作为正式地图或公开地理依据。</div></div>
              </div>
              <RiverMap />
            </details>
          </div>

          <aside class="map-side">
            <div v-if="selected" class="map-detail">
              <div class="map-detail-head">
                <div class="eyebrow">岸段档案 · 摘要</div>
                <h2 class="map-detail-title">{{ selected.name }}</h2>
                <div class="chip-row">
                  <code class="code-chip">{{ selected.section_id }}</code>
                  <AppBadge :label="'责任段 ' + selected.responsible_org" tone="neutral" icon-name="user" />
                </div>
              </div>
              <div class="detail-metrics">
                <div class="detail-metric">
                  <span class="detail-label">分布程度（记录聚合）</span>
                  <span class="detail-value"><span class="heat-dot" :class="'heat-' + (selected.heat_value > 5 ? 'high' : selected.heat_value > 2 ? 'mid' : selected.heat_value > 0 ? 'low' : '0')" />{{ formatNumber(selected.heat_value) }}</span>
                </div>
                <div class="detail-metric">
                  <span class="detail-label">清理量（kg）</span>
                  <span class="detail-value">{{ formatKg(selected.cleanup_kg_total) }}</span>
                </div>
              </div>
              <dl class="def-list compact">
                <dt>责任段</dt><dd>{{ selected.responsible_org }}</dd>
                <dt>数据口径</dt><dd>仅统计审核通过记录与已办结工单</dd>
                <dt>位置</dt><dd>岸段中心粗化示意，不展示坐标</dd>
              </dl>
              <p class="detail-note">分布程度不是污染浓度；空白或低值不代表干净，也不代表没有垃圾。</p>
              <a class="btn btn-secondary btn-sm map-detail-link" :href="'#/map/section/' + encodeURIComponent(selected.section_id) + '?period=' + encodeURIComponent(period)"><i class="ri-file-list-3-line" aria-hidden="true"></i>打开完整岸段档案</a>
            </div>
            <StatePanel v-else tone="empty" icon-name="pin" title="选择一个岸段" description="点击网格旁的岸段标记或表格行查看公开汇总。" compact />
            <div class="notice notice-info">
              <i class="ri-information-line notice-icon" aria-hidden="true"></i>
              <div class="notice-body">
                <div class="notice-title">为什么地图上会空白</div>
                <div class="notice-text">空白表示该网格暂无公开记录，可能因为还没有上报、尚未审核，或样本量未达发布门槛；它不等于「这里干净」。</div>
              </div>
            </div>
            <ColumnScope :can="columnScope.can" :cannot="columnScope.cannot" />
            <Provenance title="数据来源与口径" :items="provenanceItems" />
          </aside>
        </div>
      </template>
    </section>
  `,
};
