// 成效公示：所有指标来自 STAT-01；不本地聚合、不排名、不补 0。
// 公众线只展示 published=true 的数值；未发布指标给出中性说明，不展示后端缺口代码。

import {
  api,
  copyText,
  currentPeriodMonth,
  formatCount,
  formatKg,
  formatNumber,
  formatPeriod,
  periodError,
  sectionOptions,
  toast,
} from "../lib.js";
import { MetricTile } from "../components.js";
import { COLUMN_SCOPE, METRIC_COPY, PROVENANCE } from "../content.js";

const { computed, onMounted, ref } = Vue;

export const PublicityView = {
  name: "PublicityView",
  components: { MetricTile },
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const period = ref(String(props.route.query.period || props.params?.period || currentPeriodMonth()));
    const sectionId = ref(props.route.query.section_id || "");
    const loading = ref(false);
    const error = ref(null);
    const data = ref(null);
    const localPeriodError = ref("");
    const viewMode = ref("cards"); // cards | table

    const metrics = computed(() => (Array.isArray(data.value?.metrics) ? data.value.metrics : []));
    const options = computed(() => sectionOptions());
    const allUnpublished = computed(() => metrics.value.length > 0 && metrics.value.every((m) => !m.published));
    const publishedCount = computed(() => metrics.value.filter((m) => m.published).length);
    const filterCount = computed(() => {
      let count = 0;
      if (period.value !== currentPeriodMonth()) count += 1;
      if (sectionId.value) count += 1;
      return count;
    });

    function metricMeta(key) {
      if (METRIC_COPY[key]) return METRIC_COPY[key];
      const metric = metrics.value.find((item) => item.metric_key === key);
      return {
        label: key,
        unit: metric?.unit === "kg" ? "kg" : "条 / 单",
        short: "指标口径见说明",
        scope: "该指标由后端统计接口返回；详细口径以接口字典为准。",
        not: "请结合统计范围阅读，不要单独用作排名或强度结论。",
        icon: "ri-bar-chart-line",
      };
    }

    function metricValue(metric) {
      if (!metric.published) return "—";
      if (metric.unit === "kg") return formatKg(metric.value).replace(/\s*kg$/, "");
      if (metric.unit === "count") return formatCount(metric.value);
      return formatNumber(metric.value);
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
      period, sectionId, loading, error, data, localPeriodError, metrics, options, viewMode, filterCount,
      allUnpublished, publishedCount, metricMeta, metricValue,
      formatPeriod, currentPeriodMonth, applyFilter, resetFilter, share,
      navigate: props.navigate, sourceItems: PROVENANCE.publicity.items, columnScope: COLUMN_SCOPE.publicity,
    };
  },
  template: `
    <section class="page-shell publicity-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '成效公示' }]" />
      <PageHeader eyebrow="成效公示" title="改变了什么，凭什么是这样"
        description="本期可以公开的清理量、审核通过上报与办结情况。">
        <template #meta>
          <AppBadge :label="'周期：' + formatPeriod(period)" tone="info" icon-name="clock" />
          <AppBadge label="仅已发布指标" tone="good" icon-name="check" />
          <AppBadge label="不排名 · 不补 0" tone="neutral" icon-name="shield" />
        </template>
        <template #actions>
          <a class="btn btn-secondary" :href="'#/publicity/' + encodeURIComponent(period)"><i class="ri-file-list-3-line" aria-hidden="true"></i>本期详情</a>
          <div class="view-switch" role="group" aria-label="指标视图切换">
            <button class="view-switch-btn" :class="{ 'is-active': viewMode === 'cards' }" type="button" :aria-pressed="viewMode === 'cards'" @click="viewMode = 'cards'"><i class="ri-layout-grid-line" aria-hidden="true"></i>卡片</button>
            <button class="view-switch-btn" :class="{ 'is-active': viewMode === 'table' }" type="button" :aria-pressed="viewMode === 'table'" @click="viewMode = 'table'"><i class="ri-table-line" aria-hidden="true"></i>数据表</button>
          </div>
          <button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button>
          <button class="btn btn-secondary" type="button" @click="load"><i class="ri-refresh-line" aria-hidden="true"></i>刷新</button>
        </template>
      </PageHeader>

      <SectionCard class-name="filter-card" title="筛选" description="按周期与岸段查看公开指标；未发布的指标不会显示数值。">
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
            <span v-else class="muted">岸段列表尚未加载；可先访问垃圾地图加载岸段。</span>
          </label>
          <div class="filter-actions">
            <button class="btn btn-primary" type="submit"><i class="ri-search-line" aria-hidden="true"></i>查询</button>
            <button class="btn btn-ghost" type="button" @click="resetFilter"><i class="ri-refresh-line" aria-hidden="true"></i>重置</button>
          </div>
        </form>
        </FilterShell>
      </SectionCard>

      <div v-if="loading" class="card"><div class="card-body"><LoadingBlock label="加载成效指标" :cards="3" :lines="2" /></div></div>
      <PublicErrorPanel v-else-if="error" :error="error" @retry="load" />

      <template v-else-if="data">
        <div class="publicity-head">
          <div>
            <div class="eyebrow">本期可公开指标</div>
            <h2>{{ formatPeriod(period) }} · 成效摘要</h2>
          </div>
          <p>{{ publishedCount }} / {{ metrics.length }} 个指标已发布。未发布指标只说明「暂未发布」，不显示数值，也不补 0。</p>
        </div>

        <section v-if="metrics.length" v-show="viewMode === 'cards'" class="kpi-row publicity-kpi-row">
          <MetricTile v-for="metric in metrics" :key="metric.metric_key"
            :label="metricMeta(metric.metric_key).label"
            :value="metricValue(metric)"
            :unit="metricMeta(metric.metric_key).unit"
            :short="metricMeta(metric.metric_key).short"
            :scope="metricMeta(metric.metric_key).scope"
            :not="metricMeta(metric.metric_key).not"
            :icon-name="metricMeta(metric.metric_key).icon"
            :published="metric.published"
            demo />
        </section>
        <div v-if="metrics.length && viewMode === 'table'" class="table-wrap publicity-table-wrap">
          <table class="data-table publicity-table">
            <thead><tr><th>指标</th><th>单位</th><th>本期值</th><th>样本量</th><th>发布状态</th><th>口径短句</th></tr></thead>
            <tbody>
              <tr v-for="metric in metrics" :key="metric.metric_key">
                <td data-label="指标"><span class="table-primary">{{ metricMeta(metric.metric_key).label }}</span></td>
                <td data-label="单位">{{ metricMeta(metric.metric_key).unit }}</td>
                <td data-label="本期值">{{ metric.published ? metricValue(metric) : '暂未发布' }}</td>
                <td data-label="样本量">{{ metric.sample_size ?? '—' }}</td>
                <td data-label="发布状态"><AppBadge :label="metric.published ? '已发布' : '暂未发布'" :tone="metric.published ? 'good' : 'warning'" /></td>
                <td data-label="口径">{{ metricMeta(metric.metric_key).short }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <StatePanel v-else-if="!metrics.length" tone="empty" icon-name="chart" title="本期暂无可公开指标"
          description="统计接口本期没有返回指标；空白不代表零，也不代表没有垃圾。你可以换一个周期或岸段查看。" />

        <div v-if="allUnpublished" class="notice notice-warning">
          <i class="ri-alert-line notice-icon" aria-hidden="true"></i>
          <div class="notice-body"><div class="notice-title">本期指标暂未发布</div><div class="notice-text">样本量或审核进度尚未达到发布门槛；对外页面不展示未发布数值。你可以稍后再看，或先阅读口径说明。</div></div>
        </div>

        <div class="publicity-lower-grid">
          <SectionCard title="本期说明" description="先看统计范围，再看数字。">
            <dl class="def-list">
              <dt>统计周期</dt><dd>{{ formatPeriod(period) }}</dd>
              <dt>数据来源</dt><dd>后端统计接口聚合；前端不自行拼接</dd>
              <dt>发布规则</dt><dd>仅已发布指标展示数值；未发布、样本不足的数据不展示</dd>
              <dt>单位</dt><dd>清理量 kg；计数条 / 单；吨与立方米分列，不换算</dd>
            </dl>
            <Provenance title="公示口径与来源" :items="sourceItems" />
          </SectionCard>

          <SectionCard title="公示档案" description="历史周期与趋势需要后端序列数据。">
            <div class="publicity-archive-note">
              <i class="ri-archive-line" aria-hidden="true"></i>
              <div>
                <strong>历史档案整理中</strong>
                <p>当前版本只展示本期可公开指标，不拼接多周期数据，也不虚构趋势。历史周期档案与前后对比将在数据接入后另行公开。</p>
              </div>
            </div>
            <div class="chip-row">
              <span class="badge badge-neutral">不排名</span>
              <span class="badge badge-neutral">不做红黑榜</span>
              <span class="badge badge-neutral">不展示未审核数据</span>
            </div>
            <a class="aside-related" href="#/publicity/event/example-shoreline-event"><span>事件记录示例：证据与公开边界</span><i class="ri-arrow-right-line" aria-hidden="true"></i></a>
          </SectionCard>
        </div>

        <ColumnScope :can="columnScope.can" :cannot="columnScope.cannot" />

        <div class="column-foot-note">
          <i class="ri-information-line" aria-hidden="true"></i>
          本期数字不是历史趋势，也不构成区域排名。需要引用时，请连同统计周期、统计范围与「不代表什么」一起引用。
        </div>
      </template>
    </section>
  `,
};
