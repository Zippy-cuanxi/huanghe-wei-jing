// 资讯与政策栏目：方法型内容与科普短文；不编造政策条文，只讲「怎么读」。
// 所有示例内容标注「示例」，正文不引用未核验的文件名、机构名与数字。

import { copyText, toast } from "../lib.js";
import { COLUMN_SCOPE, NEWS } from "../content.js";

const { computed, ref } = Vue;

export const NewsView = {
  name: "NewsView",
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const slug = computed(() => String(props.params?.slug || ""));
    const selected = computed(() => NEWS.find((item) => item.slug === slug.value) || null);
    const isDetail = computed(() => Boolean(slug.value));
    const query = ref("");
    const typeFilter = ref("all");

    const typeOptions = computed(() => {
      const seen = new Set();
      for (const item of NEWS) {
        for (const tag of item.tags) {
          if (tag !== "示例") seen.add(tag);
        }
      }
      return Array.from(seen);
    });
    const filteredNews = computed(() => {
      const key = query.value.trim().toLowerCase();
      return NEWS.filter((item) => {
        if (typeFilter.value !== "all" && !item.tags.includes(typeFilter.value)) return false;
        if (!key) return true;
        const headings = item.body.map((block) => block.heading);
        return [item.title, item.summary, ...item.tags, ...headings].join(" ").toLowerCase().includes(key);
      });
    });
    const filterCount = computed(() => (typeFilter.value !== "all" ? 1 : 0) + (query.value.trim() ? 1 : 0));
    const shareTitle = computed(() => `黄河戍境｜${selected.value?.title || "资讯与政策"}（示例）`);
    const shareSummary = computed(() => `${selected.value?.summary || "方法型短文"} 示例内容需人工审核；不转载政策原文，不替读者下结论。`);
    const sourceSteps = [
      { label: "文章结论", desc: "本页为方法型示例内容，不写政策条文与官方解释结论。" },
      { label: "来源与日期", desc: "编辑来源、原文链接与发布日期待补；示例内容标注示例。" },
      { label: "阅读方法", desc: "涉及政策时以权威发布为准；本站只讲怎么读，不替读者下结论。" },
    ];

    const newsProvenance = [
      "栏目只写方法型内容，不转载政策原文，也不替读者下结论。",
      "示例文章由编辑整理，需人工审核；正式发布前须补充来源、日期与授权。",
      "涉及政策时，以权威发布为准；本站不编造条文、文号与机构名。",
      "不把单一案例或未核验数字写成普遍结论。",
    ];
    function clearFilters() {
      query.value = "";
      typeFilter.value = "all";
    }

    async function share() {
      const ok = await copyText(window.location.href);
      toast(ok ? "页面地址已复制" : "复制失败，请手动复制地址", { tone: ok ? "success" : "warning" });
    }

    return { NEWS, slug, selected, isDetail, share, query, typeFilter, typeOptions, filteredNews, filterCount, newsProvenance, clearFilters, shareTitle, shareSummary, sourceSteps, columnScope: COLUMN_SCOPE.news };
  },
  template: `
    <section class="page-shell column-page news-page">
      <Breadcrumb :items="isDetail ? [{ label: '首页', path: '/' }, { label: '资讯与政策', path: '/news' }, { label: selected?.title || '文章详情' }] : [{ label: '首页', path: '/' }, { label: '资讯与政策' }]" />

      <template v-if="!isDetail">
        <PageHeader eyebrow="资讯与政策" title="与护河有关的信息，怎么读" description="方法型短文与科普内容；不转载政策原文，不替读者下结论。">
          <template #meta>
            <AppBadge label="示例内容" tone="warning" icon-name="alert" />
            <AppBadge label="不引用政策条文" tone="neutral" icon-name="shield" />
          </template>
        </PageHeader>

        <div class="column-intro-card">
          <div class="column-intro-icon"><i class="ri-newspaper-line" aria-hidden="true"></i></div>
          <div>
            <strong>先读方法，再读结论</strong>
            <p>资讯栏目优先提供「怎么读」：怎么读一张图、怎么读一份公示、怎么判断一条信息是否可追溯。政策解读只写方法，不编造条文与文号。</p>
          </div>
        </div>

        <div class="column-layout">
          <div class="column-main">
            <FilterShell :active-count="filterCount" label="筛选资讯">
              <div class="column-toolbar">
                <label class="column-search">
                  <i class="ri-search-line" aria-hidden="true"></i>
                  <input v-model="query" type="search" placeholder="搜索标题、摘要或类型" aria-label="搜索资讯与政策内容" />
                </label>
                <div class="filter-chip-row" role="group" aria-label="按类型筛选">
                  <button class="filter-chip" :class="{ 'is-active': typeFilter === 'all' }" type="button" @click="typeFilter = 'all'">全部</button>
                  <button v-for="type in typeOptions" :key="type" class="filter-chip" :class="{ 'is-active': typeFilter === type }" type="button" @click="typeFilter = type">{{ type }}</button>
                </div>
                <div class="column-toolbar-foot">
                  <span class="muted">共 {{ filteredNews.length }} 篇</span>
                  <button v-if="filterCount" class="btn btn-ghost btn-sm" type="button" @click="clearFilters">清除筛选</button>
                </div>
              </div>
            </FilterShell>

            <div v-if="filteredNews.length" class="content-card-grid">
              <a v-for="item in filteredNews" :key="item.slug" class="content-card" :href="'#/news/' + item.slug">
                <img v-if="item.image" :src="item.image" :alt="item.imageAlt || item.title" class="content-card-image" loading="lazy" />
                <span class="content-card-icon"><i :class="item.icon" aria-hidden="true"></i></span>
                <div class="content-card-body">
                  <div class="chip-row">
                    <span v-for="tag in item.tags" :key="tag" class="badge" :class="tag === '示例' ? 'badge-warning' : 'badge-info'">{{ tag }}</span>
                  </div>
                  <h2 class="content-card-title">{{ item.title }}</h2>
                  <p class="content-card-desc">{{ item.summary }}</p>
                  <div class="content-card-meta"><span>{{ item.date }}</span><span>{{ item.source }}</span></div>
                </div>
                <i class="ri-arrow-right-line content-card-arrow" aria-hidden="true"></i>
              </a>
            </div>
            <StatePanel v-else tone="empty" icon-name="search" title="没有找到匹配的资讯"
              description="试试更短的关键词，或切换类型；也可以清除筛选查看全部示例内容。">
              <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="clearFilters">清除筛选</button></template>
            </StatePanel>

            <div class="column-foot-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              本栏目当前为示例内容；正式上线时，文章来源、发布日期、授权与审核结论须逐条登记。
            </div>
          </div>

          <aside class="column-aside">
            <Provenance title="资讯与政策边界" :items="newsProvenance" />
            <div class="aside-card">
              <h3>相关栏目</h3>
              <a class="aside-related" href="#/map"><span>垃圾地图：问题在哪</span><i class="ri-map-2-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/publicity"><span>成效公示：改变了什么</span><i class="ri-bar-chart-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/help"><span>帮助中心：怎么参与</span><i class="ri-question-line" aria-hidden="true"></i></a>
            </div>
            <ColumnScope :can="columnScope.can" :cannot="columnScope.cannot" />
          </aside>
        </div>
      </template>

      <template v-else-if="selected">
        <PageHeader :eyebrow="'资讯与政策 · ' + selected.date" :title="selected.title" :description="selected.summary">
          <template #meta>
            <span v-for="tag in selected.tags" :key="tag" class="badge" :class="tag === '示例' ? 'badge-warning' : 'badge-info'">{{ tag }}</span>
            <AppBadge :label="selected.source" tone="neutral" icon-name="file" />
          </template>
          <template #actions><button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button></template>
        </PageHeader>

        <figure v-if="selected.image" class="content-figure detail-figure">
          <img :src="selected.image" :alt="selected.imageAlt || selected.title" />
          <figcaption>示意图 · 示例内容 · 非真实政策原文</figcaption>
        </figure>

        <div class="detail-layout">
          <article class="detail-main">
            <div v-for="(block, i) in selected.body" :key="i" class="detail-block">
              <h2>{{ block.heading }}</h2>
              <p v-for="(paragraph, j) in block.paragraphs" :key="j">{{ paragraph }}</p>
            </div>
            <div class="detail-source-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              <div><strong>来源与审核</strong><p>示例文章由编辑整理，不包含政策条文、机构名与具体数字；正式发布前须补充来源、授权与人工审核结论。涉及政策时，请以权威发布为准。</p></div>
            </div>
          </article>
          <aside class="detail-aside">
            <Provenance title="资讯与政策边界" :items="newsProvenance" />
            <div class="aside-card">
              <h3>文章信息</h3>
              <dl class="def-list compact">
                <dt>日期</dt><dd>{{ selected.date }}</dd>
                <dt>来源</dt><dd>{{ selected.source }}</dd>
                <dt>内容类型</dt><dd>方法型短文（示例）</dd>
                <dt>审核状态</dt><dd><span class="badge badge-warning">需人工审核</span></dd>
                <dt>更新时间</dt><dd>2026-11-07 · 演示内容</dd>
              </dl>
            </div>
            <SourceTrail title="从文章结论回到来源" :steps="sourceSteps" />
            <ShareBlock :title="shareTitle" :summary="shareSummary" />
            <div class="aside-card">
              <h3>相关阅读</h3>
              <a v-for="item in NEWS.filter(n => n.slug !== selected.slug)" :key="item.slug" class="aside-related" :href="'#/news/' + item.slug">
                <span>{{ item.title }}</span><i class="ri-arrow-right-line" aria-hidden="true"></i>
              </a>
              <a class="aside-related" href="#/knowledge"><span>分类科普：四类垃圾怎么分</span><i class="ri-arrow-right-line" aria-hidden="true"></i></a>
            </div>
          </aside>
        </div>
      </template>

      <StatePanel v-else tone="empty" icon-name="file" title="该内容已下架或不再公开"
        description="它可能尚未发布、已撤回，或链接已失效；可以返回栏目页查看其他内容。">
        <template #actions><a class="btn btn-primary btn-sm" href="#/news">返回资讯与政策</a></template>
      </StatePanel>
    </section>
  `,
};
