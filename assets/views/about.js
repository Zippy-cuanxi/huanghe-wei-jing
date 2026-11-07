// 关于 / 帮助 / 免责与口径：可信度落点。只写定位、方法、口径与占位，不编造主体与联系方式。

import {
  ABOUT_SECTIONS,
  DISCLAIMER_POINTS,
  HELP_QA,
  PROVENANCE,
  SITE,
} from "../content.js";

export const AboutView = {
  name: "AboutView",
  props: { route: { type: Object, default: () => ({}) }, navigate: { type: Function, default: () => {} } },
  setup() {
    return { SITE, ABOUT_SECTIONS };
  },
  template: `
    <section class="page-shell about-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '关于本站' }]" />
      <div class="about-brand-lockup">
        <img src="assets/img/logo-lockup.png" alt="黄河戍境" />
        <div><div class="eyebrow">品牌标识</div><p class="muted">示例视觉资产 · 需人工审核后正式使用</p></div>
      </div>
      <PageHeader eyebrow="关于本站" title="一座把可信能力，讲给公众听的站点"
        description="我们不做「最干净」的承诺，只把问题、行动与结果放在同一条可追溯的链路上。">
        <template #meta>
          <AppBadge label="演示／试点" tone="warning" icon-name="alert" />
          <AppBadge label="示例内容需人工审核" tone="neutral" icon-name="shield" />
        </template>
      </PageHeader>

      <div class="about-positioning">
        <div class="about-positioning-mark"><i class="ri-water-flash-line" aria-hidden="true"></i></div>
        <div>
          <div class="eyebrow">站点定位</div>
          <p class="about-positioning-text">{{ SITE.positioning }}</p>
          <p class="muted">短品牌名：{{ SITE.brand }} · 标语：{{ SITE.tagline }}</p>
        </div>
      </div>

      <div class="about-section-grid">
        <article v-for="section in ABOUT_SECTIONS" :key="section.heading" class="about-section-card">
          <h2>{{ section.heading }}</h2>
          <p v-for="(paragraph, i) in section.paragraphs" :key="i">{{ paragraph }}</p>
        </article>
      </div>

      <section class="about-block">
        <h2>数据与方法</h2>
        <div class="about-method-grid">
          <div class="about-method-card"><h3>数据从哪里来</h3><p>地图与公示数据来自后端地图／统计接口；示例内容来自编辑整理，均标注「示例」。前端不生成业务数字，不自行聚合。</p></div>
          <div class="about-method-card"><h3>地图怎么表达</h3><p>岸段使用粗化中心，二维网格为聚合示意；不展示原始坐标，不做插值、不做预测。空白表示暂无公开记录，不代表干净。</p></div>
          <div class="about-method-card"><h3>公示怎么发布</h3><p>仅审核通过的数据进入公开统计；未发布、样本不足的数据不展示数值。吨与立方米分列，不做换算。</p></div>
          <div class="about-method-card"><h3>参与怎么闭环</h3><p>拍—派—清—晒。审核、工单、办结与评价均由后端裁决；前端只展示后端状态，不承诺具体时限。</p></div>
        </div>
      </section>

      <section class="about-block">
        <h2>名称体系</h2>
        <dl class="def-list about-name-list">
          <dt>短品牌名</dt><dd>{{ SITE.brand }}（用于导航、分享标题与首页主视觉）</dd>
          <dt>一句话标语</dt><dd>{{ SITE.tagline }}</dd>
          <dt>定稿全称</dt><dd>{{ SITE.fullName }}（用于页脚、关于与合规位）</dd>
          <dt>演示声明</dt><dd>{{ SITE.demoNote }}</dd>
        </dl>
      </section>

      <section class="about-block about-placeholder-block">
        <h2>待补充信息</h2>
        <p>以下内容在正式上线前由运营方补充，当前保留占位，不虚构：运营主体与授权范围、审图号与底图授权、联系方式、影像版权清单、隐私与数据保留要求。</p>
        <div class="chip-row">
          <span class="badge badge-neutral">运营主体：待配置</span>
          <span class="badge badge-neutral">审图号：待配置</span>
          <span class="badge badge-neutral">联系方式：待配置</span>
          <span class="badge badge-neutral">版权清单：待配置</span>
        </div>
      </section>

      <div class="about-links">
        <a class="btn btn-secondary" href="#/disclaimer"><i class="ri-shield-check-line" aria-hidden="true"></i>免责与口径</a>
        <a class="btn btn-ghost" href="#/help"><i class="ri-question-line" aria-hidden="true"></i>帮助中心</a>
      </div>
    </section>
  `,
};

export const HelpView = {
  name: "HelpView",
  props: { route: { type: Object, default: () => ({}) }, navigate: { type: Function, default: () => {} } },
  template: `
    <section class="page-shell help-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '帮助中心' }]" />
      <PageHeader eyebrow="帮助中心" title="第一次来，可以这样开始"
        description="匿名可以浏览全部公开栏目；提交上报、查看「我的上报」等写操作需要登录。">
        <template #meta>
          <AppBadge label="三步参与" tone="info" icon-name="route" />
          <AppBadge label="不承诺办理时限" tone="neutral" icon-name="clock" />
        </template>
      </PageHeader>

      <div class="help-entry-grid">
        <a class="help-entry" href="#/map"><i class="ri-map-2-line" aria-hidden="true"></i><strong>先看地图</strong><span>了解问题在哪，再决定做什么</span></a>
        <a class="help-entry" href="#/report"><i class="ri-camera-line" aria-hidden="true"></i><strong>去上报</strong><span>拍照 → 选类型与规模 → 确认提交</span></a>
        <a class="help-entry" href="#/publicity"><i class="ri-bar-chart-line" aria-hidden="true"></i><strong>看公示</strong><span>每个数字都能找到来源与口径</span></a>
      </div>

      <section class="help-block">
        <h2>你是哪一种？</h2>
        <div class="help-audience-grid">
          <article v-for="flow in audiences" :key="flow.title" class="help-audience-card">
            <h3>{{ flow.title }}</h3>
            <ol class="help-audience-steps"><li v-for="(step, i) in flow.steps" :key="i">{{ step }}</li></ol>
            <a class="btn btn-secondary btn-sm" :href="flow.href">{{ flow.cta }}</a>
          </article>
        </div>
      </section>

      <section class="help-qa-block">
        <h2>常见问题</h2>
        <details v-for="(item, i) in qa" :key="i" class="help-qa">
          <summary><span class="help-qa-index">{{ String(i + 1).padStart(2, '0') }}</span><span>{{ item.q }}</span><i class="ri-add-line" aria-hidden="true"></i></summary>
          <p>{{ item.a }}</p>
        </details>
      </section>

      <section class="help-block">
        <h2>三段进度怎么看</h2>
        <div class="help-progress-grid">
          <div><strong>已收到</strong><p>上报已提交，等待审核；你会得到受理编号。</p></div>
          <div><strong>处理中</strong><p>审核通过后可能转为工单并派给责任单位；状态以系统记录为准。</p></div>
          <div><strong>已办结</strong><p>处置完成并录入清理量；只有审核通过且办结的数据进入公开统计。</p></div>
        </div>
      </section>

      <section class="help-block">
        <h2>还是要找人？</h2>
        <p>联系方式与运营主体为占位，正式上线前补充。演示阶段可通过项目文档中的说明联系维护者；本站不提供真实热线、公众号或举报电话。</p>
        <div class="about-links">
          <a class="btn btn-secondary btn-sm" href="#/about">了解本站</a>
          <a class="btn btn-ghost btn-sm" href="#/subscribe">订阅与通知</a>
        </div>
      </section>
    </section>
  `,
  setup() {
    const audiences = [
      { title: "路过的人", steps: ["读首页主张", "打开垃圾地图", "点一个岸段看公开摘要"], href: "#/map", cta: "去看地图" },
      { title: "想上报的人", steps: ["点「去上报」", "拍照或选图", "登录后提交，得到受理编号"], href: "#/report", cta: "开始随手拍" },
      { title: "想核实数据的人", steps: ["点指标旁「口径」", "看统计范围与「不代表什么」", "查看公示或免责与口径"], href: "#/publicity", cta: "查看公示" },
    ];
    return { qa: HELP_QA, audiences };
  },
};

export const DisclaimerView = {
  name: "DisclaimerView",
  props: { route: { type: Object, default: () => ({}) }, navigate: { type: Function, default: () => {} } },
  template: `
    <section class="page-shell disclaimer-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '免责与口径' }]" />
      <PageHeader eyebrow="免责与口径" title="每个数字，都要说得清边界"
        description="这份页面集中说明本站做什么、不做什么，以及地图、公示与参与数据的口径。">
        <template #meta>
          <AppBadge label="仅审核通过数据公开" tone="good" icon-name="check" />
          <AppBadge label="演示／试点" tone="warning" icon-name="alert" />
        </template>
      </PageHeader>

      <section class="disclaimer-points">
        <div v-for="(point, i) in points" :key="i" class="disclaimer-point">
          <span class="disclaimer-num">{{ String(i + 1).padStart(2, '0') }}</span>
          <p>{{ point }}</p>
        </div>
      </section>

      <section class="disclaimer-block">
        <h2>口径速查</h2>
        <div class="disclaimer-provenance-grid">
          <Provenance title="地图与分布程度" :items="provenance.map.items" />
          <Provenance title="公示指标" :items="provenance.publicity.items" />
          <Provenance title="上报与定位" :items="provenance.report.items" />
        </div>
      </section>

      <section class="disclaimer-block">
        <h2>本站不做什么</h2>
        <ul class="plain-list">
          <li>不做排行榜、红黑榜与区域排名。</li>
          <li>不做报名、支付、保险与执法调度。</li>
          <li>不做插值热力、污染预测与未核验的空间结论。</li>
          <li>不展示原始坐标、真实行政边界或污染浓度。</li>
          <li>不用 AI 生成业务数据，不替业务系统做判断。</li>
        </ul>
      </section>

      <section class="disclaimer-block disclaimer-pending">
        <h2>尚待确认的信息</h2>
        <p>运营主体、授权范围、审图号与合规底图路径、联系方式、影像版权、隐私与数据保留要求，均以正式上线配置为准；当前页面保留占位，不编造。</p>
        <div class="chip-row">
          <span class="badge badge-neutral">运营主体：待配置</span>
          <span class="badge badge-neutral">审图号：待配置</span>
          <span class="badge badge-neutral">隐私与保留：待配置</span>
        </div>
      </section>

      <div class="about-links">
        <a class="btn btn-secondary" href="#/about"><i class="ri-information-line" aria-hidden="true"></i>关于本站</a>
        <a class="btn btn-ghost" href="#/help"><i class="ri-question-line" aria-hidden="true"></i>帮助中心</a>
      </div>
    </section>
  `,
  setup() {
    return { points: DISCLAIMER_POINTS, provenance: PROVENANCE };
  },
};
