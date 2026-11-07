// 周期公示详情：数据式叙事。先说怎么读，再逐指标讲「测什么/为何重要/什么算正常/异常意味着什么」，
// 最后给结论与限定。只展示已发布指标；来源与口径放侧栏，不铺陈进正文。

import {
  api,
  copyText,
  currentPeriodMonth,
  formatCount,
  formatKg,
  formatNumber,
  formatPeriod,
  periodError,
  toast,
} from "../lib.js";
import { METRIC_COPY, NEWS, PROVENANCE } from "../content.js";

const { computed, onMounted, ref } = Vue;

const GENERIC_READING = {
  what: "该指标由后端统计接口返回。",
  why: "帮助读者理解本期可以公开的统计结果。",
  normal: "本站不设统一正常值；需结合统计周期、样本量与岸段背景阅读。",
  abnormal: "数值变化只提示复核，不直接等于治理好或治理差。",
};

export const PublicityDetailView = {
  name: "PublicityDetailView",
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const period = ref(String(props.params?.period || props.route.query.period || currentPeriodMonth()));
    const loading = ref(false);
    const error = ref(null);
    const data = ref(null);
    const localPeriodError = ref("");

    const metrics = computed(() => (Array.isArray(data.value?.metrics) ? data.value.metrics : []));
    const publishedCount = computed(() => metrics.value.filter((metric) => metric.published).length);
    const allUnpublished = computed(() => metrics.value.length > 0 && metrics.value.every((metric) => !metric.published));

    function metricMeta(key) {
      return METRIC_COPY[key] || {
        label: key,
        unit: "—",
        short: "指标口径见说明",
        ...GENERIC_READING,
      };
    }

    function metricValue(metric) {
      if (!metric.published) return "暂未发布";
      if (metric.unit === "kg") return formatKg(metric.value).replace(/\s*kg$/, "");
      if (metric.unit === "count") return formatCount(metric.value);
      return formatNumber(metric.value);
    }

    const sourceSteps = computed(() => ([
      { label: "本期指标值", desc: "来自统计接口的已发布指标；未发布指标不展示数值，也不补 0。" },
      { label: "统计口径", desc: "统计范围、单位、样本量与更新时间；吨与立方米分列，不做换算。" },
      { label: "来源台账", desc: "公开来源摘要；原始记录仅在公开范围内展示，不展示内部备注与原始坐标。" },
    ]));

    const shareTitle = computed(() => `黄河戍境｜${formatPeriod(period.value)} 只公开已发布指标（示例）`);
    const shareSummary = computed(() => (
      "本期指标按发布状态展示；统计周期与来源随文呈现，未发布不展示、不做排名。示例内容需人工审核。"
    ));

    const readingArticle = computed(() => NEWS.find((item) => item.slug === "how-to-read-a-heat-map") || NEWS[0]);

    async function load() {
      const pErr = periodError(period.value);
      if (pErr) { localPeriodError.value = pErr; return; }
      localPeriodError.value = "";
      loading.value = true;
      error.value = null;
      try {
        data.value = await api("STAT-01", { query: { period: period.value.trim(), metric_keys: [] } });
      } catch (err) {
        error.value = err;
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    async function share() {
      const ok = await copyText(window.location.href);
      toast(ok ? "页面地址已复制" : "复制失败，请手动复制地址", { tone: ok ? "success" : "warning" });
    }

    onMounted(load);

    return {
      period, loading, error, data, localPeriodError, metrics, publishedCount, allUnpublished,
      metricMeta, metricValue, sourceSteps, shareTitle, shareSummary, readingArticle,
      sourceItems: PROVENANCE.publicity.items,
      formatPeriod, load, share, navigate: props.navigate,
    };
  },
  template: `
    <section class="page-shell publicity-detail-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '成效公示', path: '/publicity' }, { label: formatPeriod(period) + ' 详情' }]" />
      <PageHeader :eyebrow="'成效公示 · ' + formatPeriod(period)" title="本期成效公示"
        description="先看统计范围，再看数字；每个指标都说明「测什么、为何重要、什么算正常、异常意味着什么」。">
        <template #meta>
          <AppBadge :label="'周期：' + formatPeriod(period)" tone="info" icon-name="clock" />
          <AppBadge label="仅已发布指标" tone="good" icon-name="check" />
          <AppBadge label="演示数据" tone="neutral" icon-name="info" />
          <AppBadge label="更新时间：以接口返回为准" tone="neutral" icon-name="refresh" />
        </template>
        <template #actions>
          <button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button>
          <a class="btn btn-secondary" href="#/publicity"><i class="ri-arrow-left-line" aria-hidden="true"></i>返回公示栏目</a>
        </template>
      </PageHeader>

      <div v-if="loading" class="card"><div class="card-body"><LoadingBlock label="加载周期公示" :cards="3" :lines="3" /></div></div>
      <PublicErrorPanel v-else-if="error" :error="error" @retry="load" />

      <template v-else-if="data">
        <div v-if="allUnpublished" class="notice notice-warning">
          <i class="ri-alert-line notice-icon" aria-hidden="true"></i>
          <div class="notice-body"><div class="notice-title">本期指标暂未发布</div><div class="notice-text">样本量或审核进度尚未达到发布门槛；页面不展示未发布数值，也不补 0。</div></div>
        </div>

        <div class="detail-layout">
          <article class="detail-main">
            <section class="detail-block">
              <h2>先说怎么读</h2>
              <ul class="plain-list">
                <li>先看统计周期、单位、样本量与发布状态，再看数字。</li>
                <li>只展示已发布指标；未发布、样本不足的数据不展示数值，也不补 0。</li>
                <li>本期数字不是历史趋势，也不构成区域排名；引用时请连同统计范围与「不代表什么」一起引用。</li>
              </ul>
            </section>

            <section class="detail-block">
              <h2>指标逐项说明</h2>
              <div class="metric-reading-list">
                <article v-for="metric in metrics" :key="metric.metric_key" class="metric-reading" :class="{ 'is-unpublished': !metric.published }">
                  <header class="metric-reading-head">
                    <div><div class="eyebrow">指标</div><h3>{{ metricMeta(metric.metric_key).label }}</h3></div>
                    <div class="metric-reading-value">
                      <strong>{{ metricValue(metric) }}</strong>
                      <span>{{ metricMeta(metric.metric_key).unit }}</span>
                      <AppBadge :label="metric.published ? '已发布' : '暂未发布'" :tone="metric.published ? 'good' : 'warning'" />
                    </div>
                  </header>
                  <p class="metric-reading-meta">样本量：{{ metric.sample_size ?? '—' }} · 统计周期：{{ formatPeriod(period) }} · {{ metricMeta(metric.metric_key).short }}</p>
                  <dl class="metric-reading-questions">
                    <template v-for="key in ['what', 'why', 'normal', 'abnormal']" :key="key">
                      <dt>{{ { what: '测什么', why: '为何重要', normal: '什么算正常', abnormal: '异常意味着什么' }[key] }}</dt>
                      <dd>{{ metricMeta(metric.metric_key)[key] }}</dd>
                    </template>
                  </dl>
                </article>
              </div>
              <StatePanel v-if="!metrics.length" tone="empty" icon-name="chart" title="本期暂无可公开指标"
                description="统计接口本期没有返回指标；空白不代表零，也不代表没有行动。" />
            </section>

            <section class="detail-block">
              <h2>结论与限定</h2>
              <p>本期只呈现可以公开的统计结果。所有指标都来自后端统计接口，前端不自行拼接、不补 0、不做排名。</p>
              <p class="muted">未发布指标不展示数值；清理量单位为 kg，计数单位为条或单，吨与立方米分列，不做换算。本期数字不代表历史趋势，也不代表全部岸线情况。</p>
            </section>

            <div class="detail-source-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              <div><strong>来源与审核</strong><p>指标由统计接口聚合；来源台账、原始记录与更新时间以正式接入为准。示例内容与演示数据需人工审核，不构成正式业务结论。</p></div>
            </div>
          </article>

          <aside class="detail-aside">
            <SourceTrail title="从指标回到来源" :steps="sourceSteps" />
            <ShareBlock :title="shareTitle" :summary="shareSummary" />
            <div class="aside-card">
              <h3>相关阅读</h3>
              <a class="aside-related" :href="'#/news/' + readingArticle.slug"><span>{{ readingArticle.title }}</span><i class="ri-arrow-right-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/map"><span>垃圾地图：问题在哪</span><i class="ri-map-2-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/publicity/event/example-shoreline-event"><span>事件记录示例：证据与边界</span><i class="ri-file-list-3-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/disclaimer"><span>免责与口径</span><i class="ri-shield-check-line" aria-hidden="true"></i></a>
            </div>
          </aside>
        </div>
      </template>

      <StatePanel v-else tone="empty" icon-name="chart" title="暂无可展示的公示"
        description="该周期可能暂无已发布指标，或链接已失效；可以返回公示栏目换一个周期。">
        <template #actions><a class="btn btn-primary btn-sm" href="#/publicity">返回公示栏目</a></template>
      </StatePanel>
    </section>
  `,
};
