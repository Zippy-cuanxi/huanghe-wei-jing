// 岸段档案：一个岸段的公开画像。只消费 MAP-01 的公开汇总字段；
// 不展示粗化/原始坐标，不做强度结论，不补造记录。

import {
  api,
  currentPeriodMonth,
  copyText,
  formatKg,
  formatNumber,
  formatPeriod,
  toast,
} from "../lib.js";
import { PROVENANCE } from "../content.js";

const { computed, onMounted, ref } = Vue;

export const SectionProfileView = {
  name: "SectionProfileView",
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const sectionId = computed(() => decodeURIComponent(String(props.params?.sectionId || "")));
    const period = ref(String(props.route.query.period || currentPeriodMonth()));
    const loading = ref(true);
    const error = ref(null);
    const data = ref(null);

    const section = computed(() => {
      const items = Array.isArray(data.value?.sections) ? data.value.sections : [];
      return items.find((item) => item.section_id === sectionId.value) || null;
    });
    const auditMissing = computed(() => !loading.value && !error.value && data.value !== null && data.value.map_audit_no === null);
    const shareTitle = computed(() => `黄河戍境｜${section.value?.name || "岸段档案"}：本期只有公开汇总（示例）`);
    const shareSummary = computed(() => "本期分布程度与清理量来自审核通过的公开记录；不展示原始坐标，空白不代表干净。示例内容需人工审核。");
    const sourceSteps = [
      { label: "岸段公开汇总", desc: "分布程度、清理量与责任段来自地图接口的公开汇总。" },
      { label: "统计口径", desc: "仅审核通过记录；清理量仅已办结工单；不展示原始坐标。" },
      { label: "原始记录", desc: "单条事件与原始证据不在公开范围；页面不反推、不补造。" },
    ];

    const provenanceItems = computed(() => [
      ...PROVENANCE.map.items,
      "岸段档案只呈现公开汇总；事件时间线、原始记录与责任单位联系方式不在公开范围。",
    ]);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        data.value = await api("MAP-01", {
          query: { period: period.value, page_no: 1, page_size: 100, section_id: sectionId.value },
        });
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
      sectionId, period, loading, error, data, section, auditMissing, provenanceItems, shareTitle, shareSummary, sourceSteps,
      formatPeriod, formatKg, formatNumber, load, share,
      navigate: props.navigate,
    };
  },
  template: `
    <section class="page-shell section-profile-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '垃圾地图', path: '/map' }, { label: section?.name || '岸段档案' }]" />

      <div v-if="loading" class="card"><div class="card-body"><LoadingBlock label="加载岸段档案" :cards="2" :lines="3" /></div></div>
      <PublicErrorPanel v-else-if="error" :error="error" @retry="load" />

      <StatePanel v-else-if="auditMissing" tone="blocked" icon-name="shield" title="岸段档案暂不可用"
        description="地图合规配置未完成，后端当前不下发任何岸段点位；这不是「没有记录」。">
        <template #actions><a class="btn btn-secondary btn-sm" href="#/map">返回地图</a></template>
      </StatePanel>

      <template v-else-if="section">
        <PageHeader :eyebrow="'岸段档案 · ' + formatPeriod(period)" :title="section.name"
          description="这里汇总该岸段当前可以公开的记录与清理情况；不展示原始坐标，也不对记录数量做污染强度结论。">
          <template #meta>
            <code class="code-chip">{{ section.section_id }}</code>
            <AppBadge label="本期有公开汇总" tone="good" icon-name="check" />
            <AppBadge label="仅公开汇总" tone="info" icon-name="file" />
            <AppBadge label="无原始坐标" tone="good" icon-name="shield" />
            <AppBadge label="演示数据" tone="neutral" icon-name="info" />
          </template>
          <template #actions>
            <button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button>
            <a class="btn btn-secondary" :href="'#/map?period=' + encodeURIComponent(period) + '&section_id=' + encodeURIComponent(sectionId)"><i class="ri-map-2-line" aria-hidden="true"></i>在地图上查看</a>
          </template>
        </PageHeader>

        <div class="profile-metrics kpi-row">
          <div class="stat-tile">
            <div class="stat-top"><span class="icon"><i class="ri-fire-line" aria-hidden="true"></i></span><span class="stat-label">分布程度</span><AppBadge label="记录聚合" tone="neutral" /></div>
            <div class="stat-value-row"><span class="stat-value">{{ formatNumber(section.heat_value) }}</span></div>
            <p class="stat-short">仅统计审核通过的公开记录；不是污染浓度。</p>
          </div>
          <div class="stat-tile">
            <div class="stat-top"><span class="icon"><i class="ri-scales-3-line" aria-hidden="true"></i></span><span class="stat-label">清理量</span><AppBadge label="kg" tone="neutral" /></div>
            <div class="stat-value-row"><span class="stat-value">{{ formatKg(section.cleanup_kg_total) }}</span></div>
            <p class="stat-short">仅统计已办结工单录入的清理量；吨与立方米分列，不做换算。</p>
          </div>
          <div class="stat-tile">
            <div class="stat-top"><span class="icon"><i class="ri-user-3-line" aria-hidden="true"></i></span><span class="stat-label">责任段</span><AppBadge label="公开信息" tone="neutral" /></div>
            <div class="stat-value-row"><span class="section-org-value">{{ section.responsible_org }}</span></div>
            <p class="stat-short">责任段信息为公开字段；责任单位联系方式不在公开范围。</p>
          </div>
          <div class="stat-tile">
            <div class="stat-top"><span class="icon"><i class="ri-calendar-line" aria-hidden="true"></i></span><span class="stat-label">统计周期</span><AppBadge label="本期" tone="info" /></div>
            <div class="stat-value-row"><span class="section-period-value">{{ formatPeriod(period) }}</span></div>
            <p class="stat-short">周期与统计范围由后端返回；历史趋势在数据接入后另行公开。</p>
          </div>
        </div>

        <figure class="content-figure detail-figure">
          <img src="assets/img/section-shoreline.webp" alt="岸段示意插画，非真实地理" loading="lazy" />
          <figcaption>示意图 · 非真实地理 · 不展示原始坐标</figcaption>
        </figure>

        <div class="detail-layout">
          <article class="detail-main">
            <section class="about-block">
              <h2>这个岸段目前知道什么</h2>
              <p>当前页面只呈现一个经过审核的公开汇总，不展示单条上报的原始记录、原始定位与内部处置备注。记录数量少时，我们不做「问题严重」或「已经干净」的强度结论。</p>
              <p>如果你在现场看到与公开记录不一致的情况，可以拍照上报；新的线索会进入审核流程，而不是直接改写本页数字。</p>
            </section>

            <section class="about-block">
              <h2>公开记录清单</h2>
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>项目</th><th>公开值</th><th>口径</th></tr></thead>
                  <tbody>
                    <tr><td>分布程度</td><td>{{ formatNumber(section.heat_value) }}</td><td>审核通过的公开记录聚合；不是污染浓度</td></tr>
                    <tr><td>清理量</td><td>{{ formatKg(section.cleanup_kg_total) }}</td><td>已办结工单录入的 kg；不含未办结数据</td></tr>
                    <tr><td>责任段</td><td>{{ section.responsible_org }}</td><td>公开字段；不含联系方式</td></tr>
                    <tr><td>位置</td><td>岸段中心粗化示意</td><td>不展示原始坐标，不可反推</td></tr>
                    <tr><td>数据状态</td><td>有公开汇总</td><td>仅审核通过记录；空白不代表干净</td></tr>
                    <tr><td>来源等级</td><td>公开汇总（示例）</td><td>需人工审核；来源台账待接入</td></tr>
                    <tr><td>更新时间</td><td>以本期统计接口返回为准</td><td>不承诺实时；历史趋势待数据接入</td></tr>
                  </tbody>
                </table>
              </div>
              <p class="muted">单条事件时间线与证据下钻需要额外的公开记录接口；当前版本不拼接、不虚构。</p>
            </section>

            <div class="detail-source-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              <div><strong>阅读提示</strong><p>空白、低值或「无公开记录」都不等于干净。地图与档案的目标是让问题可被看见、让行动可被追踪，而不是给岸段排名。</p></div>
            </div>
          </article>

          <aside class="detail-aside">
            <Provenance title="这个岸段的口径与来源" :items="provenanceItems" />
            <SourceTrail title="从岸段摘要回到来源" :steps="sourceSteps" />
            <ShareBlock :title="shareTitle" :summary="shareSummary" />
            <div class="aside-card">
              <h3>继续了解</h3>
              <a class="aside-related" href="#/map"><span>返回垃圾地图</span><i class="ri-arrow-right-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/publicity"><span>查看本期成效公示</span><i class="ri-arrow-right-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/report"><span>我发现了新的线索</span><i class="ri-camera-line" aria-hidden="true"></i></a>
            </div>
          </aside>
        </div>
      </template>

      <StatePanel v-else tone="empty" icon-name="pin" title="暂无这个岸段的公开记录"
        description="可能是本期暂无审核通过的汇总，或岸段编号不存在。空白不代表干净；可以返回地图换一个周期查看。">
        <template #actions><a class="btn btn-primary btn-sm" href="#/map">返回地图</a></template>
      </StatePanel>
    </section>
  `,
};
