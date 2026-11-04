// F2-02 垃圾分类科普：类别来自 ADM-01；正文/答题接口未在 14 接口内。
// 不硬编码分类字典，不以静态内容替代后端内容接口。

import { dict, loadDictionary, session } from "../lib.js";

const { computed, onMounted, ref } = Vue;

export const KnowledgeView = {
  name: "KnowledgeView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const selectedCode = ref("");
    const loading = ref(false);
    const error = ref(null);

    const categories = computed(() => dict.categories ?? []);
    const selected = computed(() => categories.value.find((item) => item.code === selectedCode.value) || categories.value[0] || null);
    const unavailable = computed(() => !loading.value && !error.value && (!dict.available || dict.status === "unavailable"));

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        await loadDictionary({ force: true });
        if (!selectedCode.value && categories.value.length) selectedCode.value = categories.value[0].code;
      } catch (err) {
        error.value = err;
      } finally {
        loading.value = false;
      }
    }

    onMounted(async () => {
      if (session.status === "active") {
        await load();
      } else if (dict.status === "ready") {
        selectedCode.value = categories.value[0]?.code ?? "";
      }
    });

    return { selectedCode, loading, error, categories, selected, unavailable, dict, session, load, navigate: props.navigate };
  },
  template: `
    <section class="page-shell knowledge-page">
      <PageHeader eyebrow="F2-02 垃圾分类科普" title="了解四类垃圾，做对一次判断"
        description="类别名称与说明来自后端 ADM-01 字典。科普正文、判别链与闯关答题接口未在 14 个关键接口内。">
        <template #meta>
          <AppBadge label="类别来自 ADM-01" tone="info" icon-name="book" />
          <AppBadge label="正文/答题接口缺失" tone="warning" icon-name="alert" />
        </template>
        <template #actions>
          <button v-if="session.status !== 'active'" class="btn btn-secondary" type="button" @click="navigate('/auth?mode=login')"><Icon name="lock" :size="16" />登录查看字典</button>
          <button v-else class="btn btn-secondary" type="button" @click="load"><Icon name="refresh" :size="16" />刷新字典</button>
        </template>
      </PageHeader>

      <div v-if="loading" class="card"><div class="card-body"><LoadingBlock label="加载科普类别" :cards="4" :lines="2" /></div></div>
      <ErrorPanel v-else-if="error" :error="error" @retry="load" @login="navigate('/auth?mode=login')" />

      <StatePanel v-else-if="unavailable" tone="blocked" icon-name="book" title="类别字典未下发"
        description="ADM-01 仅运营管理员（R6）/系统管理员（R7）可读；公众与审核员无法取科普类别。前端不以硬编码标签替代，这是契约缺口 CR-001。"
        code="CR-001">
        <template #actions>
          <button class="btn btn-secondary btn-sm" type="button" @click="navigate('/auth?mode=login')">登录运营账号</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="navigate('/map')">返回地图</button>
        </template>
      </StatePanel>

      <template v-else-if="dict.available">
        <SectionCard title="四类垃圾" description="点击类别查看后端下发的说明；前端不改变分类归属。">
          <div class="category-grid">
            <button v-for="category in categories" :key="category.code" class="category-card" :class="{ 'is-active': selected?.code === category.code }" type="button" @click="selectedCode = category.code">
              <span class="category-icon"><Icon :name="{RECYCLABLE:'recycle',HAZARDOUS:'alert',KITCHEN:'leaf',OTHER:'trash'}[category.code] || 'trash'" :size="21" /></span>
              <span class="category-copy"><strong class="category-label">{{ category.label }}</strong><span class="category-desc">{{ category.description }}</span><code class="category-code">{{ category.code }}</code></span>
            </button>
          </div>
        </SectionCard>

        <div v-if="selected" class="two-col">
          <SectionCard title="类别说明" :description="'来源：ADM-01 waste_categories · ' + selected.code">
            <dl class="def-list">
              <dt>名称</dt><dd>{{ selected.label }}</dd>
              <dt>编码</dt><dd><code>{{ selected.code }}</code></dd>
              <dt>说明</dt><dd>{{ selected.description }}</dd>
            </dl>
            <div class="notice notice-info">
              <Icon name="info" :size="18" />
              <div class="notice-body"><div class="notice-title">分类归属由后端裁决</div><div class="notice-text">上报时的垃圾类别是用户声明；AI 初判与审核结论不由前端推断。</div></div>
            </div>
          </SectionCard>

          <SectionCard title="判别链与闯关答题">
            <StatePanel tone="blocked" icon-name="book" title="内容/答题接口缺失"
              description="B3/B9 要求内容版本与答题结果记录，但 14 接口没有科普内容/答题接口（CR-003）。本页不硬编码题目或伪造答题记录。"
              code="CR-FE-05 / CR-003" compact />
            <div class="chain-shell" aria-hidden="true">
              <div class="chain-step"><span class="chain-num">1</span><span class="chain-title">辨认</span><span class="chain-body">待内容接口</span></div>
              <span class="chain-arrow"><Icon name="arrowRight" :size="18" /></span>
              <div class="chain-step"><span class="chain-num">2</span><span class="chain-title">判断</span><span class="chain-body">待内容接口</span></div>
              <span class="chain-arrow"><Icon name="arrowRight" :size="18" /></span>
              <div class="chain-step"><span class="chain-num">3</span><span class="chain-title">投放</span><span class="chain-body">待内容接口</span></div>
            </div>
          </SectionCard>
        </div>
      </template>
    </section>
  `,
};
