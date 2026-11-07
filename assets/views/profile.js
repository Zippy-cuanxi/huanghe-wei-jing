// 个人中心：RPT-02 我的上报、三段进度、办结评价（FB-01）。
// closed/progress_stage 直接渲染后端值，不做本地推导或乐观推进。
// 公众文案不复述接口编号；技术缺口收进「演示说明」，不占据首屏。

import {
  SubmitIntent,
  api,
  contentError,
  copyText,
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

const { computed, onMounted, reactive, ref, watch } = Vue;

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
    const correctionOpen = ref(false);
    const correctionItem = ref(null);
    const correctionType = ref("result");
    const correctionText = ref("");
    const correctionTypes = [
      { value: "location", label: "位置信息有误" },
      { value: "category", label: "类型/规模有误" },
      { value: "result", label: "处置结果有误" },
      { value: "other", label: "其他" },
    ];
    const subscriptions = reactive(loadSubscriptions());

    function loadSubscriptions() {
      try {
        const raw = localStorage.getItem("hh.subscriptions");
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            reportStatus: Boolean(parsed.reportStatus),
            publicity: Boolean(parsed.publicity),
          };
        }
      } catch { /* fall through */ }
      return { reportStatus: true, publicity: false };
    }

    function saveSubscriptions() {
      try { localStorage.setItem("hh.subscriptions", JSON.stringify(subscriptions)); } catch { /* ignore */ }
      toast("演示订阅设置已保存；当前不会发送真实通知", { tone: "success" });
    }

    function unsubscribeAll() {
      subscriptions.reportStatus = false;
      subscriptions.publicity = false;
      saveSubscriptions();
      toast("已全部退订（演示设置）", { tone: "info" });
    }

    function openCorrection(item) {
      correctionOpen.value = true;
      correctionItem.value = item;
      correctionType.value = "result";
      correctionText.value = "";
    }

    function closeCorrection() { correctionOpen.value = false; }

    async function copyCorrectionId() {
      const value = correctionItem.value?.report_id || "";
      const ok = await copyText(value);
      toast(ok ? "受理编号已复制" : "复制失败，请手动选择", { tone: ok ? "success" : "warning" });
    }

    function phaseBadge(item) {
      if (!item) return { label: "—", tone: "neutral", icon: "clock" };
      if (item.closed) return { label: "已办结", tone: "good", icon: "check" };
      if (item.report_status === "REJECTED") return { label: "未通过", tone: "critical", icon: "ban" };
      if (item.report_status === "RETURNED") return { label: "已退回", tone: "serious", icon: "alert" };
      if (item.work_order_status === "CANCELLED") return { label: "已取消", tone: "neutral", icon: "ban" };
      return { label: "处理中", tone: "neutral", icon: "clock" };
    }

    function progressNote(item) {
      if (!item) return "";
      if (item.report_status === "REJECTED") return "本次线索未通过审核；可提交纠错，或重新提交新的线索。";
      if (item.report_status === "RETURNED") return "需要补充信息；按回告补充后重新提交，原受理编号保留。";
      if (item.work_order_status === "CANCELLED") return "该工单已取消；如现场仍有问题，可以重新上报。";
      return "后续状态会在这里更新；不承诺具体办理时限。";
    }

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

    function goPage(next) { page.value = next; load(); }
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
    watch(canView, (allowed) => { if (allowed) load(); });

    return {
      session, dict, canView, page, pageSize, status, loading, error, data, items, statusOptions,
      feedbackOpen, feedbackItem, feedbackWo, feedbackRating, feedbackContent, feedbackLoading,
      feedbackError, feedbackLocal, demoFeedback, demo, formatTimeUtc, roleLabel,
      correctionOpen, correctionItem, correctionType, correctionText, correctionTypes, subscriptions,
      saveSubscriptions, unsubscribeAll, openCorrection, closeCorrection, copyCorrectionId,
      load, goPage, refresh, login, openFeedback, closeFeedback, fillDemoWorkOrder, submitFeedback, phaseBadge, progressNote,
      navigate: props.navigate,
    };
  },
  template: `
    <section class="page-shell profile-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '我的参与' }]" />
      <PageHeader eyebrow="我的参与" title="我上报之后呢"
        description="跟踪本人上报的三段进度；办结后可以提交评价。状态以系统记录为准，页面不做本地推进。">
        <template #meta>
          <AppBadge v-if="session.profile" :label="'账号：' + session.profile.account_id" tone="info" icon-name="user" />
          <AppBadge v-for="role in (session.roles || [])" :key="role" :label="roleLabel(role).text" tone="neutral" icon-name="shield" :code="roleLabel(role).isCode" />
          <AppBadge :label="'会话到期 ' + formatTimeUtc(session.expiresAt)" tone="neutral" icon-name="clock" />
        </template>
        <template #actions>
          <button class="btn btn-secondary" type="button" @click="refresh"><i class="ri-refresh-line" aria-hidden="true"></i>刷新</button>
          <button class="btn btn-secondary" type="button" @click="navigate('/report')"><i class="ri-camera-line" aria-hidden="true"></i>去上报</button>
        </template>
      </PageHeader>

      <StatePanel v-if="!canView && session.status !== 'active'" tone="blocked" icon-name="lock" title="登录后查看我的上报"
        description="这里只展示你本人的上报进度；未登录无法查询。">
        <template #actions><button class="btn btn-primary btn-sm" type="button" @click="login">去登录</button></template>
      </StatePanel>
      <StatePanel v-else-if="!canView" tone="refusal" icon-name="shield" title="当前账号暂无查看权限"
        description="你的账号没有「我的上报」权限；可以返回首页，或使用有权限的账号。" />

      <template v-else>
        <SectionCard title="我的上报" description="三段进度：已收到 → 处理中 → 已办结。状态以后端字段为准，不承诺具体办理时限。">
          <template #actions>
            <select v-if="statusOptions.length" v-model="status" class="select" aria-label="按上报状态筛选" @change="page = 1; load()">
              <option value="">全部状态</option>
              <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </template>

          <div v-if="loading" class="loading-block"><LoadingBlock label="加载我的上报" :lines="2" :cards="2" /></div>
          <PublicErrorPanel v-else-if="error" :error="error" @retry="refresh" />
          <StatePanel v-else-if="!items.length" tone="empty" icon-name="camera" title="还没有上报记录"
            description="你可以去「随手拍上报」提交第一条；匿名也能先预览流程。">
            <template #actions><button class="btn btn-primary btn-sm" type="button" @click="navigate('/report')">去上报</button></template>
          </StatePanel>
          <template v-else>
            <article v-for="item in items" :key="item.report_id" class="report-item" :class="{ 'is-closed': item.closed }">
              <div class="report-item-head">
                <div class="report-id-row">
                  <CopyCode :value="item.report_id" />
                  <StatusBadge enum-name="report_status" :value="item.report_status" />
                  <AppBadge :label="phaseBadge(item).label" :tone="phaseBadge(item).tone" :icon-name="phaseBadge(item).icon" />
                </div>
                <span class="report-time">提交于 {{ formatTimeUtc(item.submitted_at) }}</span>
              </div>
              <div class="report-item-body">
                <div class="chip-row">
                  <span class="muted">工单状态</span>
                  <StatusBadge enum-name="work_order_status" :value="item.work_order_status" />
                </div>
                <ProgressSteps :stage="item.progress_stage" />
                <div v-if="item.closed" class="report-result-block">
                  <div>
                    <strong>结果回告</strong>
                    <p>本次上报已办结。处置详情以公开汇总为准；原始照片、原始坐标与内部工单不公开。</p>
                  </div>
                  <div class="chip-row">
                    <button class="btn btn-ghost btn-sm" type="button" @click="navigate('/publicity')"><i class="ri-bar-chart-line" aria-hidden="true"></i>查看公开汇总</button>
                    <button class="btn btn-ghost btn-sm" type="button" @click="openCorrection(item)"><i class="ri-edit-line" aria-hidden="true"></i>信息有误？提交纠错</button>
                  </div>
                </div>
                <div v-else class="report-next-note"><i class="ri-information-line" aria-hidden="true"></i>{{ progressNote(item) }}</div>
              </div>
              <div class="report-item-foot">
                <span class="muted">办结后可以提交评价；评价准入以后端状态为准。</span>
                <button v-if="item.closed" class="btn btn-secondary btn-sm" type="button" @click="openFeedback(item)">
                  <i class="ri-star-line" aria-hidden="true"></i>提交评价
                </button>
                <button v-else-if="item.report_status === 'REJECTED' || item.report_status === 'RETURNED'" class="btn btn-ghost btn-sm" type="button" @click="openCorrection(item)">
                  <i class="ri-edit-line" aria-hidden="true"></i>提交纠错
                </button>
              </div>
            </article>
            <Pager :page="page" :total="data.total" :page-size="pageSize" :loading="loading" @update:page="goPage" />
          </template>
        </SectionCard>

        <div class="two-col">
          <SectionCard title="订阅与通知" description="薄页面：3 个开关以内，不写长文。">
            <div class="subscription-list">
              <label class="subscription-row">
                <span><strong>我的上报状态变化</strong><small>仅在状态变化时提醒；不发送营销信息。</small></span>
                <input v-model="subscriptions.reportStatus" type="checkbox" @change="saveSubscriptions" />
              </label>
              <label class="subscription-row">
                <span><strong>本期公示更新</strong><small>仅在新的公示发布时提醒；频率由运营配置。</small></span>
                <input v-model="subscriptions.publicity" type="checkbox" @change="saveSubscriptions" />
              </label>
            </div>
            <div class="chip-row">
              <button class="btn btn-ghost btn-sm" type="button" @click="unsubscribeAll">全部退订</button>
              <span class="badge badge-neutral">演示设置</span>
            </div>
            <p class="muted">当前为演示设置，不会发送真实通知；正式接入后支持一键退订，立即生效。</p>
          </SectionCard>
          <SectionCard title="账户与安全" description="只读展示当前会话信息。">
            <dl class="def-list compact">
              <dt>账号</dt><dd>{{ session.profile?.account_id || '—' }}</dd>
              <dt>角色</dt><dd>{{ (session.roles || []).map(r => roleLabel(r).text).join(' / ') || '—' }}</dd>
              <dt>会话到期</dt><dd>{{ formatTimeUtc(session.expiresAt) }}</dd>
              <dt>隐私</dt><dd>原始定位只随上报上行；页面不展示、不缓存</dd>
            </dl>
            <p class="muted">修改资料、凭证与通知偏好暂未开放；如需帮助，请查看帮助中心。</p>
          </SectionCard>
        </div>

        <div class="column-foot-note">
          <i class="ri-information-line" aria-hidden="true"></i>
          三段进度用于回答「后来呢」，不承诺具体办理时限；如状态与现场不符，请保留受理编号并联系运营方（联系方式待配置）。
        </div>
      </template>

      <Modal v-if="feedbackOpen" title="办结评价" :description="'上报 ' + (feedbackItem?.report_id || '') + '；评价准入以后端状态为准。'" @close="closeFeedback">
        <div v-if="feedbackItem && !feedbackItem.closed" class="notice notice-warning">
          <i class="ri-alert-line notice-icon" aria-hidden="true"></i><div class="notice-body"><div class="notice-text">该上报尚未办结，暂时不能评价。</div></div>
        </div>
        <div class="notice notice-info">
          <i class="ri-information-line notice-icon" aria-hidden="true"></i>
          <div class="notice-body">
            <div class="notice-title">评价需要工单编号</div>
            <div class="notice-text">我的上报列表没有直接返回工单编号。演示环境可展开下方「演示辅助」填入；正式环境请从办结通知中获取。</div>
          </div>
        </div>
        <details class="advanced">
          <summary>演示辅助（仅本地演示）</summary>
          <div v-if="demoFeedback.length" class="demo-inline">
            <span class="badge badge-neutral">演示数据</span>
            <button class="btn btn-ghost btn-sm" type="button" @click="fillDemoWorkOrder"><i class="ri-file-copy-line" aria-hidden="true"></i>填入演示工单</button>
          </div>
        </details>
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
                <i class="ri-star-fill" aria-hidden="true"></i>
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
        <div v-if="feedbackError" class="form-api-slot"><PublicErrorPanel :error="feedbackError" @retry="submitFeedback" /></div>
        <template #footer>
          <button class="btn btn-ghost" type="button" @click="closeFeedback">取消</button>
          <button class="btn btn-primary" type="button" :disabled="feedbackLoading" @click="submitFeedback">
            <i class="ri-star-line" aria-hidden="true"></i>{{ feedbackLoading ? '提交中…' : '提交评价' }}
          </button>
        </template>
      </Modal>

      <Modal v-if="correctionOpen" title="提交纠错"
        :description="'上报 ' + (correctionItem?.report_id || '') + '；纠错会进入审核，不会直接修改公示数字。'" @close="closeCorrection">
        <div class="notice notice-info">
          <i class="ri-information-line notice-icon" aria-hidden="true"></i>
          <div class="notice-body">
            <div class="notice-title">纠错入口保留</div>
            <div class="notice-text">当前版本尚未接入纠错提交接口；正式接入后，纠错会进入审核，并由人工核实。演示阶段请复制受理编号，联系运营方（联系方式待配置）。</div>
          </div>
        </div>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">纠错类型</span>
            <select v-model="correctionType" class="select">
              <option v-for="item in correctionTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <div class="field">
            <span class="field-label">受理编号</span>
            <code class="code-chip">{{ correctionItem?.report_id || '—' }}</code>
          </div>
        </div>
        <label class="field">
          <span class="field-label">说明</span>
          <textarea v-model="correctionText" class="textarea" rows="3" maxlength="500" placeholder="请简要说明需要纠正的信息；请勿填写敏感信息" />
        </label>
        <div class="form-actions">
          <button class="btn btn-secondary btn-sm" type="button" @click="copyCorrectionId"><i class="ri-file-copy-line" aria-hidden="true"></i>复制受理编号</button>
          <a class="btn btn-ghost btn-sm" href="#/publicity">查看公开汇总</a>
        </div>
        <template #footer>
          <button class="btn btn-primary" type="button" @click="closeCorrection">知道了</button>
        </template>
      </Modal>
    </section>
  `,
};
