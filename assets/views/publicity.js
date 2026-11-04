// F2-05 成效公示：所有指标来自 STAT-01；不本地聚合、不排名、不补字段。
// 对外页面在 published=false 时隐藏数值。

import {
  api,
  copyText,
  currentPeriodMonth,
  dict,
  enumLabel,
  formatCount,
  formatKg,
  formatNumber,
  formatPeriod,
  periodError,
  publicSections,
  sectionOptions,
  toast,
} from "../lib.js";

const { computed, onMounted, ref } = Vue;

export const PublicityView = {
  name: "PublicityView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const period = ref(props.route.query.period || currentPeriodMonth());
    const sectionId = ref(props.route.query.section_id || "");
    const loading = ref(false);
    const error = ref(null);
    const data = ref(null);
    const localPeriodError = ref("");

    const metrics = computed(() => data.value?.metrics ?? []);
    const options = computed(() => sectionOptions());
    const allUnpublished = computed(() => metrics.value.length > 0 && metrics.value.every((m) => !m.published));

    function metricLabel(key) {
      const label = enumLabel("metric_key", key);
      return label.text;
    }

    function metricValue(metric) {
      if (!metric.published) return "未发布";
      if (metric.unit === "kg") return formatKg(metric.value);
      if (metric.unit === "count") return formatCount(metric.value);
      return formatNumber(metric.value);
    }

    function metricBadge(key) {
      return { cleanup_kg_total: "trash", approved_report_count: "check", closed_work_order_count: "list" }[key] || "chart";
    }

    async function load() {
      const pErr = periodError(period.value);
      if (pErr) { localPeriodError.value = pErr; return; }
      localPeriodError.value = "";
      loading.value = true;
      error.value = null;
      try {
        const query = { period: period.value.trim(), metric_keys: [] };
        if (sectionId.value) query.section_id = sectionId.value;
        data.value = await api("STAT-01", { query });
      } catch (err) {
        error.value = err;
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    function applyFilter() { load(); }
    function resetFilter() { period.value = currentPeriodMonth(); sectionId.value = ""; load(); }

    async function share() {
      const ok = await copyText(window.location.href);
      toast(ok ? "页面地址已复制" : "复制失败，请手动复制地址", { tone: ok ? "success" : "warning" });
    }

    onMounted(load);

    return {
      period, sectionId, loading, error, data, localPeriodError, metrics, options, allUnpublished,
      metricLabel, metricValue, metricBadge, formatPeriod, formatKg, formatCount, formatNumber, currentPeriodMonth,
      applyFilter, resetFilter, share, navigate: props.navigate, publicSections, dict,
    };
  },
  template: `
    <section class="page-shell publicity-page">
      <PageHeader eyebrow="F2-05 成效公示" title="成效公示"
        description="周/月清理量、审核通过上报与办结工单；所有指标由后端聚合。未发布的指标不展示数值。">
        <template #meta>
          <AppBadge :label="'周期：' + formatPeriod(period)" tone="info" icon-name="clock" />
          <AppBadge label="单位：kg / count" tone="neutral" icon-name="list" />
          <AppBadge label="榜单默认关闭" tone="warning" icon-name="shield" />
        </template>
        <template #actions>
          <button class="btn btn-secondary" type="button" @click="share"><Icon name="send" :size="16" />分享本页</button>
          <button class="btn btn-secondary" type="button" @click="load"><Icon name="refresh" :size="16" />刷新</button>
        </template>
      </PageHeader>

      <SectionCard title="筛选" description="指标周期与岸段筛选；榜单是否开放由后端配置决定。">
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
            <span v-else class="muted">岸段字典尚未加载；可先访问地图页加载岸段。</span>
          </label>
          <div class="filter-actions">
            <button class="btn btn-primary" type="submit"><Icon name="search" :size="16" />查询</button>
            <button class="btn btn-ghost" type="button" @click="resetFilter"><Icon name="refresh" :size="16" />重置</button>
          </div>
        </form>
      </SectionCard>

      <div v-if="!dict.available" class="notice notice-info">
        <Icon name="info" :size="18" />
        <div class="notice-body">
          <div class="notice-title">指标标签未下发，当前显示指标键 code</div>
          <div class="notice-text">ADM-01 仅 R6/R7 可读（CR-001）；数值与发布状态仍来自 STAT-01，不受标签缺口影响。</div>
        </div>
      </div>

      <div v-if="loading" class="card"><div class="card-body"><LoadingBlock label="加载成效指标" :cards="3" :lines="2" /></div></div>
      <ErrorPanel v-else-if="error" :error="error" @retry="load" @refresh="load" @login="navigate('/auth?mode=login')" />
      <template v-else-if="data">
        <section v-if="metrics.length" class="kpi-row">
          <article v-for="metric in metrics" :key="metric.metric_key" class="stat-tile" :class="{ 'is-unpublished': !metric.published }">
            <div class="stat-top">
              <span class="icon"><Icon :name="metricBadge(metric.metric_key)" :size="18" /></span>
              <span class="stat-label">{{ metricLabel(metric.metric_key) }}</span>
              <AppBadge :label="metric.published ? '已发布' : '未发布'" :tone="metric.published ? 'good' : 'warning'" />
            </div>
            <div class="stat-value-row">
              <span v-if="metric.published" class="stat-value">{{ metricValue(metric) }}</span>
              <span v-else class="stat-value muted">未发布</span>
              <span v-if="metric.published && metric.unit === 'count'" class="stat-unit">条 / 单</span>
            </div>
            <div class="stat-meta">
              <span>样本量：{{ metric.sample_size }}</span>
              <span v-if="!metric.published">样本未达发布门槛；数值不对外展示</span>
              <span v-else>指标键：{{ metric.metric_key }}</span>
            </div>
          </article>
        </section>
        <StatePanel v-else tone="empty" icon-name="chart" title="本期暂无指标" description="STAT-01 返回空 metrics；前端不自行补 0 或推算。" />

        <div v-if="allUnpublished" class="notice notice-warning">
          <Icon name="alert" :size="18" />
          <div class="notice-body"><div class="notice-title">本期指标均未发布</div><div class="notice-text">样本量未达到发布门槛；对外页面不展示未发布数值。请联系运营方核实样本量。</div></div>
        </div>

        <SectionCard title="受控榜单" description="红黑榜默认关闭；开启需人工核实样本量。">
          <StatePanel v-if="!data.leaderboard_enabled" tone="blocked" icon-name="shield" title="榜单默认关闭"
            description="后端 leaderboard_enabled=false。前端不展示未发布榜单，也不自行排名。" compact />
          <StatePanel v-else tone="empty" icon-name="chart" title="榜单已开启，但无榜单数据字段"
            description="STAT-01 只有 leaderboard_enabled，没有榜单条目/排名/样本明细字段（CR-002）。前端不拼造排名。" code="CR-002" compact />
        </SectionCard>

        <div class="two-col">
          <SectionCard title="治理前后对比" description="F2-05 需要的前后对比滑块。">
            <StatePanel tone="blocked" icon-name="camera" title="前后影像/记录接口缺失"
              description="14 个接口没有治理前后影像或记录数据；本页不伪造对比图。" code="CR-FE-10 / CR-004" compact />
          </SectionCard>
          <SectionCard title="历史趋势" description="多周期趋势需要后端序列接口。">
            <StatePanel tone="blocked" icon-name="chart" title="历史/趋势数据接口缺失"
              description="STAT-01 只返回当前周期；前端不拼接多周期请求冒充官方口径。" code="CR-FE-10" compact />
          </SectionCard>
        </div>

        <div class="notice notice-info">
          <Icon name="info" :size="18" />
          <div class="notice-body">
            <div class="notice-title">口径说明</div>
            <div class="notice-text">cleanup_kg_total 仅计已办结工单；approved_report_count 仅计审核通过上报；closed_work_order_count 仅计已办结工单。单位 kg / count；计数仅用于上报数与工单数。</div>
          </div>
        </div>
      </template>
    </section>
  `,
};
