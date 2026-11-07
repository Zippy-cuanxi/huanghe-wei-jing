// 护河行动栏目：案例、专题与行动记录。示例内容均标注「示例」，不虚构机构、地名与成效数字。

import { copyText, toast } from "../lib.js";
import { ACTIONS, COLUMN_SCOPE } from "../content.js";

const { computed, ref } = Vue;

export const ActionsView = {
  name: "ActionsView",
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const slug = computed(() => String(props.params?.slug || ""));
    const selected = computed(() => ACTIONS.find((item) => item.slug === slug.value) || null);
    const isDetail = computed(() => Boolean(slug.value));
    const query = ref("");
    const typeFilter = ref("all");

    const typeOptions = computed(() => {
      const seen = new Set();
      for (const item of ACTIONS) {
        for (const tag of item.tags) {
          if (tag !== "示例") seen.add(tag);
        }
      }
      return Array.from(seen);
    });
    const filteredActions = computed(() => {
      const key = query.value.trim().toLowerCase();
      return ACTIONS.filter((item) => {
        if (typeFilter.value !== "all" && !item.tags.includes(typeFilter.value)) return false;
        if (!key) return true;
        return [item.title, item.summary, ...item.tags].join(" ").toLowerCase().includes(key);
      });
    });
    const filterCount = computed(() => (typeFilter.value !== "all" ? 1 : 0) + (query.value.trim() ? 1 : 0));
    const shareTitle = computed(() => `黄河戍境｜${selected.value?.title || "行动案例"}（示例）`);
    const shareSummary = computed(() => `${selected.value?.summary || "行动案例与专题"} 示例内容需人工审核；数字待接入，不写成未核验的成效结论。`);
    const sourceSteps = [
      { label: "行动结果摘要", desc: "本页只呈现公开范围内的过程与结果，不展示内部工单。" },
      { label: "来源与授权", desc: "案例来源、影像授权与审核结论待补；示例内容标注示例。" },
      { label: "公开汇总", desc: "涉及数字时只引用公开汇总与口径；未核验数字不进入正文。" },
    ];

    const actionsProvenance = [
      "行动案例与专题为示例内容，需人工审核；正式发布前须补充来源、授权与审核结论。",
      "本栏目只呈现过程与结果，不做排名、评优与红黑榜。",
      "不承接报名、保险、支付与执法调度；活动信息只做记录，不构成参与指引。",
      "未核验的成效数字不进入正文；示例内容不含真实机构名与地名。",
    ];
    function clearFilters() {
      query.value = "";
      typeFilter.value = "all";
    }

    async function share() {
      const ok = await copyText(window.location.href);
      toast(ok ? "页面地址已复制" : "复制失败，请手动复制地址", { tone: ok ? "success" : "warning" });
    }

    return { ACTIONS, slug, selected, isDetail, share, query, typeFilter, typeOptions, filteredActions, filterCount, actionsProvenance, clearFilters, shareTitle, shareSummary, sourceSteps, columnScope: COLUMN_SCOPE.actions };
  },
  template: `
    <section class="page-shell column-page actions-page">
      <Breadcrumb :items="isDetail ? [{ label: '首页', path: '/' }, { label: '护河行动', path: '/actions' }, { label: selected?.title || '行动详情' }] : [{ label: '首页', path: '/' }, { label: '护河行动' }]" />

      <template v-if="!isDetail">
        <PageHeader eyebrow="护河行动" title="谁在做，做了什么" description="行动案例、专题与活动记录；讲清过程与结果，不做排名。">
          <template #meta>
            <AppBadge label="示例内容" tone="warning" icon-name="alert" />
            <AppBadge label="需人工审核" tone="neutral" icon-name="shield" />
          </template>
        </PageHeader>

        <div class="column-intro-card">
          <div class="column-intro-icon"><i class="ri-hand-heart-line" aria-hidden="true"></i></div>
          <div>
            <strong>行动不是榜单</strong>
            <p>本站不排名、不评优、不做红黑榜。行动记录的价值在于讲清一件事：问题如何被发现、由谁处置、结果如何被公开。</p>
          </div>
        </div>

        <div class="column-layout">
          <div class="column-main">
            <FilterShell :active-count="filterCount" label="筛选行动">
              <div class="column-toolbar">
                <label class="column-search">
                  <i class="ri-search-line" aria-hidden="true"></i>
                  <input v-model="query" type="search" placeholder="搜索标题、摘要或类型" aria-label="搜索行动案例" />
                </label>
                <div class="filter-chip-row" role="group" aria-label="按类型筛选">
                  <button class="filter-chip" :class="{ 'is-active': typeFilter === 'all' }" type="button" @click="typeFilter = 'all'">全部</button>
                  <button v-for="type in typeOptions" :key="type" class="filter-chip" :class="{ 'is-active': typeFilter === type }" type="button" @click="typeFilter = type">{{ type }}</button>
                </div>
                <div class="column-toolbar-foot">
                  <span class="muted">共 {{ filteredActions.length }} 条</span>
                  <button v-if="filterCount" class="btn btn-ghost btn-sm" type="button" @click="clearFilters">清除筛选</button>
                </div>
              </div>
            </FilterShell>

            <div v-if="filteredActions.length" class="content-card-grid">
              <a v-for="item in filteredActions" :key="item.slug" class="content-card" :href="'#/actions/' + item.slug">
                <img v-if="item.image" :src="item.image" :alt="item.imageAlt || item.title" class="content-card-image" loading="lazy" />
                <span class="content-card-icon"><i :class="item.icon" aria-hidden="true"></i></span>
                <div class="content-card-body">
                  <div class="chip-row">
                    <span v-for="tag in item.tags" :key="tag" class="badge" :class="tag === '示例' ? 'badge-warning' : 'badge-info'">{{ tag }}</span>
                  </div>
                  <h2 class="content-card-title">{{ item.title }}</h2>
                  <p class="content-card-desc">{{ item.summary }}</p>
                  <div class="content-card-meta"><span>{{ item.period }}</span><span>{{ item.section }}</span></div>
                </div>
                <i class="ri-arrow-right-line content-card-arrow" aria-hidden="true"></i>
              </a>
            </div>
            <StatePanel v-else tone="empty" icon-name="search" title="没有找到匹配的行动记录"
              description="试试更短的关键词，或切换类型；也可以清除筛选查看全部示例内容。">
              <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="clearFilters">清除筛选</button></template>
            </StatePanel>

            <div class="column-foot-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              本栏目的案例与专题为示例骨架，正式发布前须补充来源、授权与人工审核；不引用未核验的成效数字。
            </div>
          </div>

          <aside class="column-aside">
            <Provenance title="行动栏目边界" :items="actionsProvenance" />
            <div class="aside-card">
              <h3>相关栏目</h3>
              <a class="aside-related" href="#/knowledge"><span>分类科普：先认清再处理</span><i class="ri-book-open-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/publicity"><span>本期成效公示</span><i class="ri-bar-chart-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/report"><span>我发现了新的线索</span><i class="ri-camera-line" aria-hidden="true"></i></a>
            </div>
            <ColumnScope :can="columnScope.can" :cannot="columnScope.cannot" />
          </aside>
        </div>
      </template>

      <template v-else-if="selected">
        <PageHeader :eyebrow="'护河行动 · ' + selected.period" :title="selected.title" :description="selected.summary">
          <template #meta>
            <span v-for="tag in selected.tags" :key="tag" class="badge" :class="tag === '示例' ? 'badge-warning' : 'badge-info'">{{ tag }}</span>
            <AppBadge v-if="selected.period && selected.period.includes('演示数据')" label="演示数据" tone="neutral" icon-name="info" />
            <AppBadge label="需人工审核" tone="neutral" icon-name="shield" />
          </template>
          <template #actions><button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button></template>
        </PageHeader>

        <figure v-if="selected.image" class="content-figure detail-figure">
          <img :src="selected.image" :alt="selected.imageAlt || selected.title" />
          <figcaption>示意图 · 示例内容 · 非真实照片</figcaption>
        </figure>

        <div class="detail-layout">
          <article class="detail-main">
            <div v-for="(block, i) in selected.body" :key="i" class="detail-block">
              <h2>{{ block.heading }}</h2>
              <p v-for="(paragraph, j) in block.paragraphs" :key="j">{{ paragraph }}</p>
            </div>
            <div class="detail-source-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              <div><strong>来源与审核</strong><p>示例内容由编辑整理，用于呈现叙事结构；正式发布前须补充事实来源、影像授权与人工审核结论。文中不包含未核验的机构名、地名与成效数字。</p></div>
            </div>
          </article>
          <aside class="detail-aside">
            <Provenance title="行动栏目边界" :items="actionsProvenance" />
            <div class="aside-card">
              <h3>内容信息</h3>
              <dl class="def-list compact">
                <template v-for="fact in selected.facts" :key="fact.label">
                  <dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd>
                </template>
                <dt>更新时间</dt><dd>2026-11-07 · 演示数据</dd>
              </dl>
            </div>
            <SourceTrail title="从行动结果回到来源" :steps="sourceSteps" />
            <ShareBlock :title="shareTitle" :summary="shareSummary" />
            <div class="aside-card">
              <h3>相关阅读</h3>
              <a v-for="item in ACTIONS.filter(a => a.slug !== selected.slug)" :key="item.slug" class="aside-related" :href="'#/actions/' + item.slug">
                <span>{{ item.title }}</span><i class="ri-arrow-right-line" aria-hidden="true"></i>
              </a>
              <a class="aside-related" href="#/news"><span>怎么读一张岸线垃圾分布图</span><i class="ri-arrow-right-line" aria-hidden="true"></i></a>
            </div>
          </aside>
        </div>
      </template>

      <StatePanel v-else tone="empty" icon-name="handHeart" title="该内容已下架或不再公开"
        description="它可能尚未发布、已撤回，或链接已失效；可以返回栏目页查看其他内容。">
        <template #actions><a class="btn btn-primary btn-sm" href="#/actions">返回护河行动</a></template>
      </StatePanel>
    </section>
  `,
};
