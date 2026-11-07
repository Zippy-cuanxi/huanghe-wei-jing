// 站内检索：检索站内示例内容、帮助问答与已加载的公开岸段。
// 不做全文后端检索、不生成内容；结果均指向现有页面，空结果给出中性提示。

import { api, currentPeriodMonth, publicSections, rememberSections } from "../lib.js";
import { ACTIONS, CATEGORIES, HELP_QA, NEWS } from "../content.js";

const { computed, onMounted, ref, watch } = Vue;

const STATIC_PAGES = [
  { label: "垃圾地图", path: "/map", desc: "按岸段查看审核通过的公开记录与二维网格分布。", tag: "栏目" },
  { label: "分类科普", path: "/knowledge", desc: "四类岸线垃圾的判别、风险提示与处理方式。", tag: "栏目" },
  { label: "护河行动", path: "/actions", desc: "行动案例、专题与活动记录。", tag: "栏目" },
  { label: "成效公示", path: "/publicity", desc: "本期可公开的清理量、审核通过上报与办结情况。", tag: "栏目" },
  { label: "资讯与政策", path: "/news", desc: "方法型短文：怎么读图、怎么读公示。", tag: "栏目" },
  { label: "随手拍上报", path: "/report", desc: "三步参与；匿名可以先把流程走一遍。", tag: "参与" },
  { label: "我的参与", path: "/profile", desc: "查看本人上报的三段进度。", tag: "参与" },
  { label: "关于本站", path: "/about", desc: "站点定位、名称体系、数据与方法。", tag: "关于" },
  { label: "帮助中心", path: "/help", desc: "常见问题、参与路径与进度说明。", tag: "帮助" },
  { label: "免责与口径", path: "/disclaimer", desc: "地图、公示与参与数据的口径边界。", tag: "口径" },
];

export const SearchView = {
  name: "SearchView",
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const q = ref(String(props.route.query.q || ""));
    watch(() => props.route.query.q, (value) => { q.value = String(value || ""); });

    const keyword = computed(() => q.value.trim().toLowerCase());

    const results = computed(() => {
      const key = keyword.value;
      if (!key) return [];
      const hit = (value) => String(value || "").toLowerCase().includes(key);
      const rows = [];

      for (const page of STATIC_PAGES) {
        if (hit(page.label) || hit(page.desc) || hit(page.tag)) {
          rows.push({ ...page, title: page.label, summary: page.desc, meta: "栏目入口", href: "#" + page.path });
        }
      }
      for (const item of CATEGORIES) {
        const haystack = [item.label, item.summary, ...item.points, ...item.examples].join(" ");
        if (hit(haystack)) {
          rows.push({ tag: "科普", title: item.label, summary: item.summary, meta: "示例科普", href: "#/knowledge/" + item.slug });
        }
      }
      for (const item of ACTIONS) {
        const haystack = [item.title, item.summary, ...item.tags].join(" ");
        if (hit(haystack)) {
          rows.push({ tag: "行动", title: item.title, summary: item.summary, meta: item.period + " · " + item.section, href: "#/actions/" + item.slug });
        }
      }
      for (const item of NEWS) {
        const haystack = [item.title, item.summary, ...item.tags, ...item.body.map((block) => block.heading)].join(" ");
        if (hit(haystack)) {
          rows.push({ tag: "资讯", title: item.title, summary: item.summary, meta: item.date + " · " + item.source, href: "#/news/" + item.slug });
        }
      }
      for (const item of HELP_QA) {
        if (hit(item.q) || hit(item.a)) {
          rows.push({ tag: "帮助", title: item.q, summary: item.a, meta: "帮助问答", href: "#/help" });
        }
      }
      for (const section of publicSections.items) {
        if (hit(section.name) || hit(section.section_id)) {
          rows.push({
            tag: "岸段",
            title: section.name,
            summary: "查看该岸段当前可以公开的汇总；不展示原始坐标。",
            meta: "公开岸段汇总",
            href: "#/map/section/" + encodeURIComponent(section.section_id),
          });
        }
      }
      return rows.slice(0, 30);
    });

    onMounted(async () => {
      try {
        const data = await api("MAP-01", { query: { period: currentPeriodMonth(), page_no: 1, page_size: 100 } });
        rememberSections(data.sections ?? []);
      } catch {
        // 岸段检索是渐进增强；地图接口不可用时仍可检索站内示例内容。
      }
    });

    const groups = computed(() => {
      const order = ["栏目", "科普", "行动", "资讯", "帮助", "岸段"];
      return order
        .map((tag) => ({ tag, items: results.value.filter((item) => item.tag === tag) }))
        .filter((group) => group.items.length);
    });

    function submit() {
      const value = q.value.trim();
      props.navigate(`/search${value ? "?q=" + encodeURIComponent(value) : ""}`);
    }

    function clear() {
      q.value = "";
      props.navigate("/search");
    }

    return { q, keyword, results, groups, submit, clear, STATIC_PAGES };
  },
  template: `
    <section class="page-shell search-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '站内检索' }]" />
      <PageHeader eyebrow="站内检索" title="找一段你想看的内容"
        description="检索站内示例内容、帮助问答与已加载的公开岸段。不做全文后端检索，也不生成未发布内容。">
        <template #meta>
          <AppBadge label="示例内容 + 公开岸段" tone="info" icon-name="search" />
          <AppBadge label="不检索未发布数据" tone="neutral" icon-name="shield" />
        </template>
      </PageHeader>

      <form class="search-bar" role="search" @submit.prevent="submit">
        <i class="ri-search-line search-bar-icon" aria-hidden="true"></i>
        <input v-model="q" class="search-input" type="search" placeholder="输入关键词，例如：岸段、分类、公示、上报" autocomplete="off" aria-label="站内检索关键词" />
        <button v-if="q" class="btn btn-ghost btn-sm" type="button" @click="clear">清除</button>
        <button class="btn btn-primary" type="submit"><i class="ri-search-line" aria-hidden="true"></i>检索</button>
      </form>

      <template v-if="keyword">
        <div class="search-result-head">
          <div><div class="eyebrow">检索结果</div><h2>「{{ q.trim() }}」</h2></div>
          <span class="muted">{{ results.length }} 条结果</span>
        </div>
        <div v-if="results.length" class="search-groups">
          <section v-for="group in groups" :key="group.tag" class="search-group">
            <div class="search-group-head">
              <span class="search-group-title">{{ group.tag }}</span>
              <span class="muted">{{ group.items.length }} 条</span>
            </div>
            <div class="search-result-list">
              <a v-for="(item, i) in group.items" :key="group.tag + '-' + i" class="search-result" :href="item.href">
                <span class="search-result-tag">{{ item.tag }}</span>
                <span class="search-result-copy"><strong>{{ item.title }}</strong><span>{{ item.summary }}</span><span class="search-result-meta">{{ item.meta }}</span></span>
                <i class="ri-arrow-right-line" aria-hidden="true"></i>
              </a>
            </div>
          </section>
        </div>
        <StatePanel v-else tone="empty" icon-name="search" title="没有找到匹配内容"
          description="试试更短的关键词，或直接浏览五个栏目；检索范围只包含站内示例内容、帮助问答与已加载的公开岸段。" />
      </template>

      <template v-else>
        <section class="search-suggest">
          <h2>可以这样开始</h2>
          <div class="search-suggest-grid">
            <a class="search-suggest-card" href="#/map"><i class="ri-map-2-line" aria-hidden="true"></i><strong>看地图</strong><span>按岸段查看公开记录</span></a>
            <a class="search-suggest-card" href="#/knowledge"><i class="ri-book-open-line" aria-hidden="true"></i><strong>读科普</strong><span>四类垃圾怎么分</span></a>
            <a class="search-suggest-card" href="#/publicity"><i class="ri-bar-chart-line" aria-hidden="true"></i><strong>看公示</strong><span>本期可公开的指标</span></a>
            <a class="search-suggest-card" href="#/help"><i class="ri-question-line" aria-hidden="true"></i><strong>问帮助</strong><span>参与流程与常见问题</span></a>
          </div>
        </section>
        <div class="search-scope-note">
          <i class="ri-information-line" aria-hidden="true"></i>
          检索范围：站内栏目、示例科普/行动/资讯、帮助问答与地图页已加载的公开岸段；不检索未发布内容、内部备注与原始坐标。
        </div>
      </template>
    </section>
  `,
};
