// F2-01 垃圾地图：只渲染 MAP-01 的粗化点位、heat_value、cleanup_kg_total。
// 审图号缺失时完全不渲染 sections/标记/坐标。

import {
  HEAT_BINS,
  api,
  currentPeriodMonth,
  dict,
  formatKg,
  formatNumber,
  formatPeriod,
  heatClass,
  periodError,
  publicSections,
  rememberSections,
  sectionOptions,
  toast,
} from "../lib.js";

const { computed, onMounted, ref } = Vue;

export const MapView = {
  name: "MapView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const period = ref(props.route.query.period || currentPeriodMonth());
    const sectionId = ref(props.route.query.section_id || "");
    const page = ref(Number(props.route.query.page) || 1);
    const pageSize = 20;
    const loading = ref(false);
    const error = ref(null);
    const data = ref(null);
    const selectedId = ref("");
    const localPeriodError = ref("");

    const sections = computed(() => Array.isArray(data.value?.sections) ? data.value.sections : []);
    const auditNo = computed(() => data.value?.map_audit_no ?? null);
    const coarsenDegree = computed(() => data.value?.coarsen_degree ?? null);
    const isGate = computed(() => !loading.value && !error.value && data.value !== null && auditNo.value === null);
    const isEmpty = computed(() => !loading.value && !error.value && data.value !== null && auditNo.value !== null && sections.value.length === 0);
    const selected = computed(() => sections.value.find((s) => s.section_id === selectedId.value) || sections.value[0] || null);
    const options = computed(() => sectionOptions());
    const sampleOnly = computed(() => typeof auditNo.value === "string" && auditNo.value.startsWith("SAMPLE-ONLY"));

    const geometry = computed(() => {
      const items = sections.value;
      if (!items.length) return { width: 820, height: 460, points: [], river: "" };
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
      const width = 820;
      const height = 460;
      const padX = 56;
      const padY = 44;
      const project = (lat, lng) => {
        const x = padX + ((lng - minLng) / (maxLng - minLng || 1)) * (width - padX * 2);
        const y = padY + ((maxLat - lat) / (maxLat - minLat || 1)) * (height - padY * 2);
        return [x, y];
      };
      const points = items.map((section) => {
        const [x, y] = project(section.coarse_lat, section.coarse_lng);
        return {
          ...section,
          x,
          y,
          label: section.name.length > 10 ? `${section.name.slice(0, 9)}…` : section.name,
        };
      });
      return { width, height, points, river: `M40 ${height * 0.3}C${width * 0.28} ${height * 0.1}, ${width * 0.36} ${height * 0.62}, ${width * 0.58} ${height * 0.44}S${width * 0.84} ${height * 0.2}, ${width - 20} ${height * 0.38}` };
    });

    async function load() {
      if (!period.value.trim()) { localPeriodError.value = "请输入统计周期"; return; }
      const pErr = periodError(period.value);
      if (pErr) { localPeriodError.value = pErr; return; }
      localPeriodError.value = "";
      loading.value = true;
      error.value = null;
      try {
        const query = { period: period.value.trim(), page_no: page.value, page_size: pageSize };
        if (sectionId.value) query.section_id = sectionId.value;
        const result = await api("MAP-01", { query });
        data.value = result;
        rememberSections(result.sections ?? []);
        if (!result.sections?.some((s) => s.section_id === selectedId.value)) {
          selectedId.value = result.sections?.[0]?.section_id ?? "";
        }
      } catch (err) {
        error.value = err;
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    function applyFilter() {
      page.value = 1;
      load();
    }

    function resetFilter() {
      period.value = currentPeriodMonth();
      sectionId.value = "";
      page.value = 1;
      load();
    }

    function goPage(next) {
      page.value = next;
      load();
    }

    async function refresh() {
      if (error.value?.behavior?.refreshState) {
        await load();
      } else {
        load();
      }
    }

    function login() {
      props.navigate(`/auth?mode=login&returnTo=${encodeURIComponent("/map")}`);
    }

    onMounted(load);

    return {
      period, sectionId, page, pageSize, loading, error, data, selectedId, localPeriodError,
      sections, auditNo, coarsenDegree, isGate, isEmpty, selected, options, sampleOnly, geometry,
      formatPeriod, formatKg, formatNumber, heatClass, HEAT_BINS, publicSections, currentPeriodMonth,
      applyFilter, resetFilter, goPage, refresh, login, navigate: props.navigate,
      dict,
    };
  },
  template: `
    <section class="page-shell map-page">
      <PageHeader eyebrow="F2-01 垃圾地图" title="黄河岸线垃圾热力地图"
        description="岸段热力、清理量与责任段均来自后端 MAP-01；只展示粗化坐标。审图号缺失时不渲染任何点位。">
        <template #meta>
          <AppBadge :label="'周期：' + formatPeriod(period)" tone="info" icon-name="clock" />
          <AppBadge :label="'粗化度：' + (coarsenDegree ?? '—') + '°'" tone="neutral" icon-name="pin" />
          <AuditBadge v-if="data" :audit-no="auditNo" />
          <AppBadge v-else label="审图号待查询" tone="neutral" icon-name="shield" />
        </template>
        <template #actions>
          <button class="btn btn-secondary" type="button" @click="refresh"><Icon name="refresh" :size="16" />刷新</button>
        </template>
      </PageHeader>

      <SectionCard title="筛选" description="周期支持 YYYY-MM 或 YYYY-Www；默认当月。">
        <form class="filter-form" novalidate @submit.prevent="applyFilter">
          <label class="field field-inline">
            <span class="field-label">统计周期</span>
            <div class="input-with-action">
              <input v-model="period" class="input" placeholder="YYYY-MM 或 YYYY-Www" autocomplete="off" :aria-invalid="localPeriodError ? 'true' : null" />
              <button class="btn btn-ghost btn-sm" type="button" @click="period = currentPeriodMonth(); applyFilter()"><Icon name="clock" :size="14" />本月</button>
            </div>
            <FieldError :message="localPeriodError" />
          </label>
          <label class="field field-inline">
            <span class="field-label">岸段筛选</span>
            <select v-if="options.length" v-model="sectionId" class="select">
              <option value="">全部岸段</option>
              <option v-for="item in options" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <span v-else class="muted">岸段字典尚未加载；先查询一次即可缓存本页岸段。</span>
          </label>
          <div class="filter-actions">
            <button class="btn btn-primary" type="submit"><Icon name="search" :size="16" />查询</button>
            <button class="btn btn-ghost" type="button" @click="resetFilter"><Icon name="refresh" :size="16" />重置</button>
          </div>
        </form>
      </SectionCard>

      <div v-if="loading" class="card"><div class="card-body"><LoadingBlock label="加载地图岸段" :cards="2" :lines="3" /></div></div>
      <ErrorPanel v-else-if="error" :error="error" @retry="refresh" @login="login" @refresh="refresh" />

      <SectionCard v-else-if="isGate" title="合规闸门：审图号缺失" description="H4：对外点位必须粗化并标注审图号；缺失时后端不下发任何点位。">
        <StatePanel tone="blocked" icon-name="shield" title="当前不展示任何点位"
          description="MAP-01 返回 map_audit_no=null 且 sections=[]。前端不补造审图号、不反推坐标，也不渲染任何岸段标记或表格。"
          code="map_audit_no = null">
          <template #actions>
            <button class="btn btn-secondary btn-sm" type="button" @click="refresh"><Icon name="refresh" :size="15" />重新查询</button>
            <button class="btn btn-ghost btn-sm" type="button" @click="navigate('/publicity')">查看成效公示</button>
          </template>
        </StatePanel>
        <div class="gate-meta">
          <AppBadge label="后端不下发点位" tone="warning" icon-name="alert" />
          <AppBadge label="前端不补审图号" tone="neutral" icon-name="ban" />
          <AppBadge label="粗化说明仍下发" tone="info" icon-name="pin" />
        </div>
        <p class="muted">配置生产审图号与标准底图属于上线合规前置项（CR-013 / Q7 / T8）。</p>
      </SectionCard>

      <SectionCard v-else-if="isEmpty" title="暂无岸段数据">
        <StatePanel tone="empty" icon-name="map" title="该周期没有可展示的岸段"
          description="MAP-01 返回 sections=[]（审图号存在）。前端不补 0、不猜测岸段。" />
      </SectionCard>

      <template v-else-if="data">
        <div v-if="sampleOnly" class="notice notice-warning">
          <Icon name="alert" :size="18" />
          <div class="notice-body">
            <div class="notice-title">当前审图号为演示占位</div>
            <div class="notice-text">SAMPLE-ONLY 审图号仅用于本地联调，不是正式审图号；生产必须替换为授权审图号。</div>
          </div>
        </div>
        <div class="map-layout">
          <div class="map-main">
            <SectionCard class-name="map-card" title="岸段示意网格" description="示意网格不是标准地图；仅使用后端粗化坐标。">
              <svg :viewBox="'0 0 ' + geometry.width + ' ' + geometry.height" class="map-svg" role="group" aria-label="岸段热力示意地图；仅使用后端粗化坐标">
                <defs>
                  <pattern id="map-grid-app" width="64" height="64" patternUnits="userSpaceOnUse">
                    <path d="M64 0H0V64" class="map-grid-line" fill="none" />
                  </pattern>
                </defs>
                <rect :width="geometry.width" :height="geometry.height" class="map-bg" />
                <rect :width="geometry.width" :height="geometry.height" fill="url(#map-grid-app)" />
                <path :d="geometry.river" class="map-river" />
                <path :d="'M20 ' + geometry.height * 0.72 + 'C' + geometry.width * 0.22 + ' ' + geometry.height * 0.56 + ', ' + geometry.width * 0.4 + ' ' + geometry.height * 0.92 + ', ' + geometry.width * 0.62 + ' ' + geometry.height * 0.74 + 'S' + geometry.width * 0.84 + ' ' + geometry.height * 0.6 + ', ' + (geometry.width - 10) + ' ' + geometry.height * 0.7" class="map-river map-river-2" />
                <g v-for="point in geometry.points" :key="point.section_id"
                  class="map-marker" :class="{ 'is-selected': selected?.section_id === point.section_id }"
                  tabindex="0" role="button"
                  :aria-label="point.name + '，热力值 ' + formatNumber(point.heat_value) + '，清理量 ' + formatKg(point.cleanup_kg_total)"
                  @click="selectedId = point.section_id" @keydown.enter.prevent="selectedId = point.section_id" @keydown.space.prevent="selectedId = point.section_id">
                  <circle class="map-marker-halo" :cx="point.x" :cy="point.y" r="18" />
                  <circle class="map-marker-dot" :class="heatClass(point.heat_value)" :cx="point.x" :cy="point.y" r="10" />
                  <text class="map-label" :x="point.x" :y="point.y + 28" text-anchor="middle">{{ point.label }}</text>
                </g>
              </svg>
              <div class="map-card-foot">
                <p class="map-foot-note">点位为岸段中心粗化坐标（coarsen_degree={{ coarsenDegree }}°），不代表垃圾原始位置；不展示原始坐标。</p>
                <HeatLegend />
              </div>
            </SectionCard>

            <SectionCard title="岸段明细" description="热力仅统计审核通过记录；清理量仅统计已办结工单的 kg 合计。">
              <div class="table-wrap">
                <table class="data-table section-table">
                  <thead><tr><th>岸段</th><th class="align-right">热力</th><th class="align-right">清理量</th><th>责任单位</th><th>粗化坐标</th></tr></thead>
                  <tbody>
                    <tr v-for="section in sections" :key="section.section_id" :class="{ 'is-selected': selected?.section_id === section.section_id }" @click="selectedId = section.section_id">
                      <td><span class="table-primary">{{ section.name }}</span><br /><code class="code-chip">{{ section.section_id }}</code></td>
                      <td class="align-right"><HeatCell :value="section.heat_value" /></td>
                      <td class="align-right"><KgCell :value="section.cleanup_kg_total" /></td>
                      <td>{{ section.responsible_org }}</td>
                      <td><span class="muted">{{ section.coarse_lat }}, {{ section.coarse_lng }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Pager :page="page" :total="data.total" :page-size="pageSize" :loading="loading" @update:page="goPage" />
            </SectionCard>
          </div>

          <aside class="map-side">
            <div v-if="selected" class="map-detail">
              <div class="map-detail-head">
                <div class="eyebrow">岸段详情</div>
                <h2 class="map-detail-title">{{ selected.name }}</h2>
                <div class="chip-row">
                  <code class="code-chip">{{ selected.section_id }}</code>
                  <AppBadge :label="'责任单位 ' + selected.responsible_org" tone="neutral" icon-name="user" />
                </div>
              </div>
              <div class="detail-metrics">
                <div class="detail-metric">
                  <span class="detail-label">热力值（后端）</span>
                  <span class="detail-value"><span class="heat-dot" :class="heatClass(selected.heat_value)" />{{ formatNumber(selected.heat_value) }}</span>
                </div>
                <div class="detail-metric">
                  <span class="detail-label">清理量（kg）</span>
                  <span class="detail-value">{{ formatKg(selected.cleanup_kg_total) }}</span>
                </div>
              </div>
              <dl class="def-list compact">
                <dt>粗化坐标</dt><dd>{{ selected.coarse_lat }}, {{ selected.coarse_lng }}</dd>
                <dt>责任单位</dt><dd>{{ selected.responsible_org }}</dd>
                <dt>数据口径</dt><dd>heat_value 仅计 APPROVED；cleanup 仅计 CLOSED 工单</dd>
              </dl>
              <p class="detail-note">本卡不显示原始坐标；点位按后端 coarsen_degree 粗化。</p>
            </div>
            <StatePanel v-else tone="empty" icon-name="pin" title="选择一个岸段" description="点击地图标记或表格行查看后端汇总值。" compact />
            <div class="notice notice-info">
              <Icon name="info" :size="18" />
              <div class="notice-body">
                <div class="notice-title">为什么不显示原始坐标</div>
                <div class="notice-text">原始坐标只允许随 RPT-01 上行；MAP-01 只下发 coarse_lat/coarse_lng。前端不请求、不缓存、不反推。</div>
              </div>
            </div>
          </aside>
        </div>
      </template>
    </section>
  `,
};
