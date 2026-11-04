// F3 个人中心：RPT-02 我的上报、三段进度、办结评价（FB-01）。
// closed/progress_stage 直接渲染后端值，不做本地推导或乐观推进。

import {
  SubmitIntent,
  api,
  contentError,
  demo,
  demoTargets,
  dict,
  formatTimeUtc,
  hasPermission,
  loadDemoTargets,
  opaqueIdError,
  ratingError,
  roleLabel,
  session,
  toast,
} from "../lib.js";

const { computed, onMounted, reactive, ref } = Vue;

export const ProfileView = {
  name: "ProfileView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const page = ref(1);
    const pageSize = 10;
    const status = ref("");
    const loading = ref(false);
    const error = ref(null);
    const data = ref(null);
    const items = computed(() => data.value?.items ?? []);
    const statusOptions = computed(() => dict.enums.report_status ?? []);
    const canView = computed(() => session.status === "active" && hasPermission("RPT-02"));
    const feedbackOpen = ref(false);
    const feedbackItem = ref(null);
    const feedbackWo = ref("");
    const feedbackRating = ref(0);
    const feedbackContent = ref("");
    const feedbackLoading = ref(false);
    const feedbackError = ref(null);
    const feedbackLocal = reactive({});
    let feedbackIntent = new SubmitIntent("FB-01");
    let feedbackFingerprint = "";
    const demoFeedback = computed(() => demoTargets("feedback"));

    async function load() {
      if (!canView.value) return;
      loading.value = true;
      error.value = null;
      try {
        const query = { page_no: page.value, page_size: pageSize };
        if (status.value) query.report_status = status.value;
        data.value = await api("RPT-02", { query });
        if (!data.value.items?.length && page.value > 1) {
          page.value = 1;
          await load();
        }
      } catch (err) {
        error.value = err;
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    function goPage(next) {
      page.value = next;
      load();
    }

    function refresh() { load(); }

    function login() { props.navigate(`/auth?mode=login&returnTo=${encodeURIComponent("/profile")}`); }

    function openFeedback(item) {
      if (!item?.closed) return;
      feedbackOpen.value = true;
      feedbackItem.value = item;
      feedbackWo.value = "";
      feedbackRating.value = 0;
      feedbackContent.value = "";
      feedbackError.value = null;
      for (const key of Object.keys(feedbackLocal)) delete feedbackLocal[key];
      feedbackIntent = new SubmitIntent("FB-01");
      feedbackFingerprint = "";
    }

    function closeFeedback() { feedbackOpen.value = false; }

    function fillDemoWorkOrder() {
      const target = demoFeedback.value.find((t) => t.report_id === feedbackItem.value?.report_id)
        || demoFeedback.value[0];
      if (target) feedbackWo.value = target.work_order_id;
    }

    async function submitFeedback() {
      for (const key of Object.keys(feedbackLocal)) delete feedbackLocal[key];
      feedbackLocal.work_order_id = opaqueIdError(feedbackWo.value, "工单编号");
      feedbackLocal.rating = ratingError(feedbackRating.value);
      feedbackLocal.content = contentError(feedbackContent.value);
      if (Object.values(feedbackLocal).some(Boolean)) return;
      const payload = {
        work_order_id: feedbackWo.value.trim(),
        rating: feedbackRating.value,
        content: feedbackContent.value,
      };
      const nextFp = JSON.stringify(payload);
      if (nextFp !== feedbackFingerprint) {
        feedbackIntent = new SubmitIntent("FB-01");
        feedbackFingerprint = nextFp;
      }
      feedbackLoading.value = true;
      feedbackError.value = null;
      try {
        const res = await api("FB-01", { payload, idem: feedbackIntent.key });
        toast(`评价已提交：${res.feedback_id}`, { tone: "success" });
        feedbackOpen.value = false;
      } catch (err) {
        if (err?.code === "PARAM_IDEMPOTENCY_KEY_REUSED") {
          feedbackIntent = new SubmitIntent("FB-01");
          feedbackFingerprint = "";
        }
        feedbackError.value = err;
      } finally {
        feedbackLoading.value = false;
      }
    }

    onMounted(() => {
      loadDemoTargets();
      if (canView.value) load();
    });

    return {
      session, dict, canView, page, pageSize, status, loading, error, data, items, statusOptions,
      feedbackOpen, feedbackItem, feedbackWo, feedbackRating, feedbackContent, feedbackLoading,
      feedbackError, feedbackLocal, demoFeedback, demo, formatTimeUtc, roleLabel,
      load, goPage, refresh, login, openFeedback, closeFeedback, fillDemoWorkOrder, submitFeedback,
      navigate: props.navigate,
    };
  },
  template: `
    <section class="page-shell profile-page">
      <PageHeader eyebrow="F3 个人中心" title="我的参与"
        description="跟踪本人上报的三段进度；closed=true 后可提交办结评价。所有状态以后端为准。">
        <template #meta>
          <AppBadge v-if="session.profile" :label="'账号：' + session.profile.account_id" tone="info" icon-name="user" />
          <AppBadge v-for="role in (session.roles || [])" :key="role" :label="roleLabel(role).text" tone="neutral" icon-name="shield" :code="roleLabel(role).isCode" />
          <AppBadge :label="'会话到期 ' + formatTimeUtc(session.expiresAt)" tone="neutral" icon-name="clock" />
        </template>
        <template #actions>
          <button class="btn btn-secondary" type="button" @click="refresh"><Icon name="refresh" :size="16" />刷新</button>
          <button class="btn btn-secondary" type="button" @click="navigate('/report')"><Icon name="camera" :size="16" />去上报</button>
        </template>
      </PageHeader>

      <StatePanel v-if="!canView && session.status !== 'active'" tone="blocked" icon-name="lock" title="请先登录"
        description="RPT-02 只返回本人上报；未登录无法查询。">
        <template #actions><button class="btn btn-primary btn-sm" type="button" @click="login">去登录</button></template>
      </StatePanel>
      <StatePanel v-else-if="!canView" tone="refusal" icon-name="shield" title="当前账号无个人中心权限"
        description="permission_summary 未包含 RPT-02；以后端裁决为准。" />

      <template v-else>
        <SectionCard title="我的上报" description="列表来自 RPT-02；进度/闭环不做本地推导。">
          <template #actions>
            <select v-if="statusOptions.length" v-model="status" class="select" aria-label="按上报状态筛选" @change="page = 1; load()">
              <option value="">全部状态</option>
              <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}（{{ item.value }}）</option>
            </select>
            <AppBadge label="单位：kg / count" tone="neutral" icon-name="list" />
          </template>

          <div v-if="loading" class="loading-block"><LoadingBlock label="加载我的上报" :lines="2" :cards="2" /></div>
          <ErrorPanel v-else-if="error" :error="error" @retry="refresh" @refresh="refresh" @login="login" />
          <StatePanel v-else-if="!items.length" tone="empty" icon-name="camera" title="还没有上报记录"
            description="RPT-02 返回空列表；可前往“随手拍上报”提交第一条。">
            <template #actions><button class="btn btn-primary btn-sm" type="button" @click="navigate('/report')">去上报</button></template>
          </StatePanel>
          <template v-else>
            <article v-for="item in items" :key="item.report_id" class="report-item" :class="{ 'is-closed': item.closed }">
              <div class="report-item-head">
                <div class="report-id-row">
                  <CopyCode :value="item.report_id" />
                  <StatusBadge enum-name="report_status" :value="item.report_status" />
                  <AppBadge :label="item.closed ? '已闭环' : '未闭环'" :tone="item.closed ? 'good' : 'neutral'" :icon-name="item.closed ? 'check' : 'clock'" />
                </div>
                <span class="report-time">提交于 {{ formatTimeUtc(item.submitted_at) }}</span>
              </div>
              <div class="report-item-body">
                <div class="chip-row">
                  <span class="muted">工单状态</span>
                  <StatusBadge enum-name="work_order_status" :value="item.work_order_status" />
                  <span class="muted">进度/闭环均为后端字段</span>
                </div>
                <ProgressSteps :stage="item.progress_stage" />
              </div>
              <div class="report-item-foot">
                <span class="muted">评价准入以后端 closed=true 为准；按钮禁用仅作体验。</span>
                <button class="btn btn-secondary btn-sm" type="button" :disabled="!item.closed" :title="item.closed ? '提交办结评价' : '仅 closed=true 后允许评价'" @click="openFeedback(item)">
                  <Icon name="star" :size="15" />提交评价
                </button>
              </div>
            </article>
            <Pager :page="page" :total="data.total" :page-size="pageSize" :loading="loading" @update:page="goPage" />
          </template>
        </SectionCard>

        <div class="two-col">
          <SectionCard title="通知">
            <StatePanel tone="blocked" icon-name="list" title="通知接口缺失"
              description="B7 通知列表/已读接口未在 14 个关键接口内（CR-020）；本页不伪造未读数或消息。" code="CR-FE-06" compact />
          </SectionCard>
          <SectionCard title="账户设置">
            <StatePanel tone="blocked" icon-name="settings" title="账户设置写接口缺失"
              description="修改资料/凭证/通知偏好没有契约接口（CR-FE-07）；当前只读展示会话信息。" code="CR-FE-07" compact />
          </SectionCard>
        </div>
      </template>

      <Modal v-if="feedbackOpen" title="办结评价" :description="'上报 ' + (feedbackItem?.report_id || '') + '；评价准入以后端 closed=true 为准。'" @close="closeFeedback">
        <div v-if="feedbackItem && !feedbackItem.closed" class="notice notice-warning">
          <Icon name="alert" :size="18" /><div class="notice-body"><div class="notice-text">该上报未闭环，后端会拒绝评价。</div></div>
        </div>
        <div class="notice notice-warning">
          <Icon name="alert" :size="18" />
          <div class="notice-body">
            <div class="notice-title">RPT-02 未下发 work_order_id（CR-FE-02）</div>
            <div class="notice-text">FB-01 需要 work_order_id，但我的上报列表只有 report_id。请从通知/运营后台获取；前端不从 report_id 推导。下方“演示辅助”可填入本地演示数据中的工单编号。</div>
          </div>
        </div>
        <div v-if="demoFeedback.length" class="demo-inline">
          <span class="badge badge-neutral">演示辅助（非契约字段）</span>
          <button class="btn btn-ghost btn-sm" type="button" @click="fillDemoWorkOrder"><Icon name="copy" :size="14" />填入演示工单</button>
        </div>
        <label class="field">
          <span class="field-label">工单编号<span class="req">*</span></span>
          <input v-model="feedbackWo" class="input" maxlength="64" placeholder="work_order_id" :aria-invalid="feedbackLocal.work_order_id ? 'true' : null" />
          <FieldError :message="feedbackLocal.work_order_id" />
        </label>
        <div class="field">
          <span class="field-label">评分<span class="req">*</span></span>
          <div class="rating" role="radiogroup" aria-label="评分 1–5">
            <template v-for="n in 5" :key="n">
              <button class="rating-star" type="button" :class="{ 'is-selected': feedbackRating >= n }" :aria-label="n + ' 分'" @click="feedbackRating = n">
                <Icon name="star" :size="23" />
              </button>
            </template>
            <span class="muted">{{ feedbackRating ? feedbackRating + ' 分' : '请选择 1–5 分' }}</span>
          </div>
          <FieldError :message="feedbackLocal.rating" />
        </div>
        <label class="field">
          <span class="field-label">评价内容<span class="req">*</span></span>
          <textarea v-model="feedbackContent" class="textarea" rows="4" maxlength="500" placeholder="1–500 字；请勿填写敏感信息" :aria-invalid="feedbackLocal.content ? 'true' : null" />
          <FieldError :message="feedbackLocal.content" />
        </label>
        <div v-if="feedbackError" class="form-api-slot"><ErrorPanel :error="feedbackError" @retry="submitFeedback" @login="login" @refresh="refresh" /></div>
        <template #footer>
          <button class="btn btn-ghost" type="button" @click="closeFeedback">取消</button>
          <button class="btn btn-primary" type="button" :disabled="feedbackLoading" @click="submitFeedback">
            <Icon name="star" :size="15" />{{ feedbackLoading ? '提交中…' : '提交评价' }}
          </button>
        </template>
      </Modal>
    </section>
  `,
};
