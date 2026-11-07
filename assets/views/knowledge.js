// 分类科普：四类判别、危害说明与小测。示例内容用于公众阅读，标注「示例」；
// 上报时的类别归属仍以后端字典与审核结论为准。

import { copyText, toast } from "../lib.js";
import { CATEGORIES, COLUMN_SCOPE, KNOWLEDGE_DEFAULT_IMAGE, QUIZ } from "../content.js";

const { computed, reactive, ref } = Vue;

export const KnowledgeView = {
  name: "KnowledgeView",
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const slug = computed(() => String(props.params?.slug || ""));
    const selected = computed(() => CATEGORIES.find((item) => item.slug === slug.value) || null);
    const isDetail = computed(() => Boolean(slug.value));
    const answers = reactive({});
    const submitted = ref(false);
    const query = ref("");
    const categoryFilter = ref("all");
    const defaultImage = KNOWLEDGE_DEFAULT_IMAGE;

    // 图片缺失或加载失败时回退到通用封面，避免卡片出现破图。
    function onImageError(event) {
      const img = event.target;
      if (!img || img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = "1";
      img.src = defaultImage;
    }

    function choose(questionIndex, optionIndex) {
      if (submitted.value) return;
      answers[questionIndex] = optionIndex;
    }

    function submitQuiz() {
      submitted.value = true;
    }

    function resetQuiz() {
      for (const key of Object.keys(answers)) delete answers[key];
      submitted.value = false;
    }

    const filteredCategories = computed(() => {
      const key = query.value.trim().toLowerCase();
      return CATEGORIES.filter((item) => {
        const inCategory = categoryFilter.value === "all" || item.slug === categoryFilter.value;
        if (!inCategory) return false;
        if (!key) return true;
        return [item.label, item.summary, ...item.points, ...item.examples].join(" ").toLowerCase().includes(key);
      });
    });
    const filterCount = computed(() => (categoryFilter.value !== "all" ? 1 : 0) + (query.value.trim() ? 1 : 0));
    const shareTitle = computed(() => `黄河戍境｜${selected.value?.label || "分类科普"}：先判断风险，再判断去向（示例）`);
    const shareSummary = computed(() => "四类岸线垃圾的判别与处理方式；示例科普内容需人工审核，分类归属以后端字典与审核结论为准。");
    const sourceSteps = [
      { label: "科普要点", desc: "本页判别要点为编辑整理的示例内容，需人工审核。" },
      { label: "来源与版本", desc: "科普来源、版本与更新时间待接入；示例内容标注示例。" },
      { label: "分类口径", desc: "上报类别是声明值；最终归属以后端字典与审核结论为准。" },
    ];

    const knowledgeProvenance = [
      "四类科普为编辑整理的示例内容，需人工审核；分类归属以后端字典与审核结论为准。",
      "风险提示是一般性科普，不替代专业处置与执法结论。",
      "小测只用于阅读反馈，不记录成绩、不上报个人信息。",
      "示例内容不含机构名、政策条文与未核验数字。",
    ];
    function clearFilters() {
      query.value = "";
      categoryFilter.value = "all";
    }

    const score = computed(() => QUIZ.reduce((total, item, index) => total + (answers[index] === item.answer ? 1 : 0), 0));
    const answeredCount = computed(() => QUIZ.reduce((total, item, index) => total + (answers[index] !== undefined ? 1 : 0), 0));

    async function share() {
      const ok = await copyText(window.location.href);
      toast(ok ? "页面地址已复制" : "复制失败，请手动复制地址", { tone: ok ? "success" : "warning" });
    }

    return {
      CATEGORIES, QUIZ, slug, selected, isDetail, answers, submitted, score, answeredCount,
      query, categoryFilter, filteredCategories, filterCount, knowledgeProvenance, clearFilters, shareTitle, shareSummary, sourceSteps, columnScope: COLUMN_SCOPE.knowledge,
      defaultImage, onImageError,
      choose, submitQuiz, resetQuiz, share,
    };
  },
  template: `
    <section class="page-shell knowledge-page">
      <Breadcrumb :items="isDetail ? [{ label: '首页', path: '/' }, { label: '分类科普', path: '/knowledge' }, { label: selected?.label || '科普详情' }] : [{ label: '首页', path: '/' }, { label: '分类科普' }]" />

      <template v-if="!isDetail">
        <PageHeader eyebrow="分类科普" title="先认清它，再决定怎么处理"
          description="四类岸线垃圾的快速判别、风险提示与处理方式。">
          <template #meta>
            <AppBadge label="示例科普内容" tone="warning" icon-name="alert" />
            <AppBadge label="需人工审核" tone="neutral" icon-name="shield" />
          </template>
        </PageHeader>

        <div class="knowledge-principle">
          <div class="knowledge-principle-icon"><i class="ri-shield-check-line" aria-hidden="true"></i></div>
          <div>
            <strong>先判断风险，再判断去向</strong>
            <p>遇到废电池、废灯管、过期药品等可能带来直接风险的物品，不要徒手捡拾；先保持距离并上报，由专业人员处置。</p>
          </div>
        </div>

        <div class="column-layout">
          <div class="column-main">
            <FilterShell :active-count="filterCount" label="筛选科普">
              <div class="column-toolbar">
                <label class="column-search">
                  <i class="ri-search-line" aria-hidden="true"></i>
                  <input v-model="query" type="search" placeholder="搜索类别、例子或处理方式" aria-label="搜索科普内容" />
                </label>
                <div class="filter-chip-row" role="group" aria-label="按类别筛选">
                  <button class="filter-chip" :class="{ 'is-active': categoryFilter === 'all' }" type="button" @click="categoryFilter = 'all'">全部</button>
                  <button v-for="category in CATEGORIES" :key="category.slug" class="filter-chip" :class="{ 'is-active': categoryFilter === category.slug }" type="button" @click="categoryFilter = category.slug">{{ category.label }}</button>
                </div>
                <div class="column-toolbar-foot">
                  <span class="muted">共 {{ filteredCategories.length }} 类</span>
                  <button v-if="filterCount" class="btn btn-ghost btn-sm" type="button" @click="clearFilters">清除筛选</button>
                </div>
              </div>
            </FilterShell>

            <div v-if="filteredCategories.length" class="category-grid">
              <a v-for="category in filteredCategories" :key="category.slug" class="category-card category-card-link" :href="'#/knowledge/' + category.slug">
                <img :src="category.image || defaultImage" :alt="category.imageAlt || category.label" class="category-card-image" loading="lazy" @error="onImageError" />
                <span class="category-icon" :class="'tone-' + category.tone"><i :class="category.icon" aria-hidden="true"></i></span>
                <span class="category-copy">
                  <strong class="category-label">{{ category.label }}</strong>
                  <span class="category-desc">{{ category.summary }}</span>
                  <span class="category-examples">{{ category.examples.join(' · ') }}</span>
                  <span class="category-status">示例 · 需人工审核</span>
                </span>
                <i class="ri-arrow-right-line category-arrow" aria-hidden="true"></i>
              </a>
            </div>
            <StatePanel v-else tone="empty" icon-name="book" title="没有找到匹配的科普内容"
              description="试试更短的关键词，或切换类别；也可以直接浏览四类科普。">
              <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="clearFilters">清除筛选</button></template>
            </StatePanel>

            <section class="knowledge-flow">
              <h2>看到一件岸线垃圾，按这个顺序判断</h2>
              <div class="knowledge-flow-steps">
                <div class="knowledge-flow-step"><span>1</span><div><strong>看风险</strong><p>是否有尖锐、腐蚀、带电或不明容器？有风险就不接触。</p></div></div>
                <div class="knowledge-flow-step"><span>2</span><div><strong>看污染</strong><p>是否被油污、食物残渣污染？被污染的包装通常不再可回收。</p></div></div>
                <div class="knowledge-flow-step"><span>3</span><div><strong>看材质</strong><p>纸、塑料、金属、玻璃等尽可能分类；不确定时按其他垃圾描述。</p></div></div>
                <div class="knowledge-flow-step"><span>4</span><div><strong>看行动</strong><p>能安全带走就带到收集点；不能处理就拍照上报。</p></div></div>
              </div>
            </section>

            <div class="knowledge-actions">
              <a class="btn btn-primary" href="#/knowledge/recyclable"><i class="ri-book-open-line" aria-hidden="true"></i>从可回收物开始读</a>
              <a class="btn btn-secondary" href="#/report"><i class="ri-camera-line" aria-hidden="true"></i>我看到了垃圾，去上报</a>
            </div>
          </div>

          <aside class="column-aside">
            <Provenance title="科普口径与来源" :items="knowledgeProvenance" />
            <div class="aside-card">
              <h3>相关栏目</h3>
              <a class="aside-related" href="#/map"><span>查看地图上的公开记录</span><i class="ri-map-2-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/report"><span>我看到了垃圾，去上报</span><i class="ri-camera-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/help"><span>帮助中心：参与流程</span><i class="ri-question-line" aria-hidden="true"></i></a>
            </div>
            <ColumnScope :can="columnScope.can" :cannot="columnScope.cannot" />
            <div class="aside-card">
              <h3>阅读提示</h3>
              <p class="muted">分类不确定时，按其他垃圾描述并拍照上报，比强行归类更稳妥。</p>
            </div>
          </aside>
        </div>
      </template>

      <template v-else-if="selected">
        <PageHeader :eyebrow="'分类科普 · ' + selected.code" :title="selected.label" :description="selected.summary">
          <template #meta>
            <AppBadge label="示例科普内容" tone="warning" icon-name="alert" />
            <AppBadge label="上报类别以后端字典为准" tone="neutral" icon-name="shield" />
          </template>
          <template #actions><button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button></template>
        </PageHeader>

        <figure class="content-figure detail-figure">
          <img :src="selected.image || defaultImage" :alt="selected.imageAlt || selected.label" @error="onImageError" />
          <figcaption>示意图 · 非真实照片 · 用于科普阅读</figcaption>
        </figure>

        <div class="detail-layout">
          <article class="detail-main">
            <div class="knowledge-detail-lead">
              <span class="category-icon" :class="'tone-' + selected.tone"><i :class="selected.icon" aria-hidden="true"></i></span>
              <div>
                <strong>常见例子</strong>
                <div class="chip-row"><span v-for="example in selected.examples" :key="example" class="badge badge-neutral">{{ example }}</span></div>
              </div>
            </div>
            <div class="detail-block">
              <h2>怎么判断</h2>
              <ul class="plain-list">
                <li v-for="(point, i) in selected.points" :key="i">{{ point }}</li>
              </ul>
            </div>
            <div class="detail-block">
              <h2>为什么这样分类</h2>
              <p>分类的目的不是让页面看起来整齐，而是让后续处置更安全、更高效。可回收物需要尽量保持干净；有害垃圾需要单独收集；厨余垃圾容易腐烂并吸引动物；其他垃圾则需要按一般生活垃圾处理。</p>
              <p>如果你不确定，按其他垃圾描述并拍照，由审核人员判断，比强行归类更稳妥。</p>
            </div>

            <section class="quiz-card">
              <div class="quiz-head">
                <div><div class="eyebrow">判别小测</div><h2>三题，看看你是否读懂了</h2></div>
                <span class="badge badge-neutral">示例练习 · 不记录成绩</span>
              </div>
              <div v-for="(item, qIndex) in QUIZ" :key="qIndex" class="quiz-question">
                <p class="quiz-question-title">{{ qIndex + 1 }}. {{ item.question }}</p>
                <div class="quiz-options">
                  <button v-for="(option, oIndex) in item.options" :key="oIndex" class="quiz-option"
                    :class="{
                      'is-selected': answers[qIndex] === oIndex,
                      'is-correct': submitted && item.answer === oIndex,
                      'is-wrong': submitted && answers[qIndex] === oIndex && item.answer !== oIndex
                    }"
                    type="button" @click="choose(qIndex, oIndex)">
                    <span class="quiz-option-key">{{ String.fromCharCode(65 + oIndex) }}</span>
                    <span>{{ option }}</span>
                  </button>
                </div>
                <p v-if="submitted" class="quiz-explain"><strong>说明：</strong>{{ item.explain }}</p>
              </div>
              <div class="quiz-actions">
                <button v-if="!submitted" class="btn btn-primary btn-sm" type="button" :disabled="answeredCount < QUIZ.length" @click="submitQuiz">
                  <i class="ri-check-line" aria-hidden="true"></i>提交答案（{{ answeredCount }}/{{ QUIZ.length }}）
                </button>
                <template v-else>
                  <span class="quiz-score">答对 {{ score }} / {{ QUIZ.length }} 题</span>
                  <button class="btn btn-secondary btn-sm" type="button" @click="resetQuiz"><i class="ri-refresh-line" aria-hidden="true"></i>再做一次</button>
                </template>
              </div>
            </section>

            <div class="detail-source-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              <div><strong>来源与审核</strong><p>科普内容为编辑整理的示例，不包含具体机构、政策条文与未核验数字；正式发布前须由专业人员审核。上报时的类别归属以后端字典与审核结论为准。</p></div>
            </div>
          </article>

          <aside class="detail-aside">
            <div class="aside-card">
              <h3>内容信息</h3>
              <dl class="def-list compact">
                <dt>更新时间</dt><dd>2026-11-07 · 演示内容</dd>
                <dt>审核状态</dt><dd><span class="badge badge-warning">示例 · 需人工审核</span></dd>
                <dt>分类口径</dt><dd>以后端字典与审核结论为准</dd>
              </dl>
            </div>
            <SourceTrail title="从科普要点回到来源" :steps="sourceSteps" />
            <ShareBlock :title="shareTitle" :summary="shareSummary" />
            <div class="aside-card">
              <h3>其他类别</h3>
              <a v-for="category in CATEGORIES.filter(c => c.slug !== selected.slug)" :key="category.slug" class="aside-related" :href="'#/knowledge/' + category.slug">
                <span>{{ category.label }}</span><i class="ri-arrow-right-line" aria-hidden="true"></i>
              </a>
            </div>
            <div class="aside-card">
              <h3>下一步</h3>
              <a class="aside-related" href="#/report"><span>我看到了岸线垃圾</span><i class="ri-camera-line" aria-hidden="true"></i></a>
              <a class="aside-related" href="#/map"><span>看看地图上的公开记录</span><i class="ri-map-2-line" aria-hidden="true"></i></a>
            </div>
          </aside>
        </div>
      </template>

      <StatePanel v-else tone="empty" icon-name="book" title="该内容已下架或不再公开"
        description="它可能尚未发布、已撤回，或链接已失效；可以返回栏目页查看四类科普。">
        <template #actions><a class="btn btn-primary btn-sm" href="#/knowledge">返回分类科普</a></template>
      </StatePanel>
    </section>
  `,
};
