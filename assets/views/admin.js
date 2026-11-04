// F4 运营后台：审核动作、工单转派/办结、看板、字典与合规。
// 前端只提交动作并渲染后端结果；不本地推进状态、不绕过 SoD、不伪造队列/列表。

import {
  SubmitIntent,
  api,
  commentError,
  currentPeriodMonth,
  demo,
  demoTargets,
  dict,
  enumLabel,
  fileError,
  formatBytes,
  formatCount,
  formatKg,
  formatNumber,
  formatPeriod,
  formatTimeUtc,
  hasPermission,
  loadDemoTargets,
  loadDictionary,
  mediaTypeFor,
  newIdem,
  opaqueIdError,
  orgOptions,
  periodError,
  roleLabel,
  sectionOptions,
  session,
  sha256Hex,
  toast,
  weightError,
} from "../lib.js";

const { computed, onMounted, reactive, ref } = Vue;

const DemoTargetList = {
  name: "DemoTargetList",
  props: { kind: { type: String, required: true }, title: { type: String, default: "演示待办" } },
  emits: ["pick"],
  setup(props) {
    const items = computed(() => demoTargets(props.kind));
    return { items, demo };
  },
  template: `
    <div v-if="items.length" class="demo-targets">
      <div class="chip-row"><span class="badge badge-neutral">演示辅助（非契约接口）</span><span class="muted">{{ title }}</span></div>
      <div class="chip-row">
        <button v-for="item in items" :key="(item.report_id || '') + (item.work_order_id || '')" class="btn btn-ghost btn-sm" type="button" @click="$emit('pick', item)">
          <code>{{ item.report_id || item.work_order_id }}</code>
          <span v-if="item.work_order_id && item.report_id" class="muted">/ {{ item.work_order_id }}</span>
        </button>
      </div>
      <p class="muted">来自 /demo/demo_ids.json，仅本地演示；生产不会提供该文件。</p>
    </div>
  `,
};

/* ------------------------------ 审核 ------------------------------ */

const ReviewPanel = {
  name: "ReviewPanel",
  components: { DemoTargetList },
  props: { navigate: { type: Function, required: true } },
  setup(props) {
    const targetType = ref("REPORT");
    const targetId = ref("");
    const level = ref(defaultLevel());
    const result = ref("APPROVED");
    const comment = ref("");
    const loading = ref(false);
    const error = ref(null);
    const resultData = ref(null);
    const local = reactive({});
    let intent = new SubmitIntent("REV-01");
    let fingerprint = "";

    const levels = computed(() => dict.enums.review_level?.length
      ? dict.enums.review_level
      : ["LEVEL_1", "LEVEL_2", "LEVEL_3"].map((value) => ({ value, label: value })));
    const results = computed(() => dict.enums.review_result?.length
      ? dict.enums.review_result
      : ["APPROVED", "REJECTED", "RETURNED"].map((value) => ({ value, label: value })));
    const demoKind = computed(() => `review_level_${level.value.slice(-1)}`);

    function defaultLevel() {
      if (session.roles.includes("R5")) return "LEVEL_3";
      if (session.roles.includes("R4")) return "LEVEL_2";
      return "LEVEL_1";
    }

    function fillTarget(item) { targetId.value = item.report_id; }

    async function submit() {
      for (const key of Object.keys(local)) delete local[key];
      error.value = null;
      resultData.value = null;
      local.target_id = opaqueIdError(targetId.value, "目标编号");
      local.comment = commentError(comment.value, result.value);
      if (Object.values(local).some(Boolean)) return;
      const payload = {
        target_type: "REPORT",
        target_id: targetId.value.trim(),
        review_level: level.value,
        review_result: result.value,
        comment: comment.value,
      };
      const nextFp = JSON.stringify(payload);
      if (nextFp !== fingerprint) { intent = new SubmitIntent("REV-01"); fingerprint = nextFp; }
      loading.value = true;
      try {
        resultData.value = await api("REV-01", { payload, idem: intent.key });
        toast("审核已记录", { tone: "success" });
        intent.reset();
        fingerprint = "";
      } catch (err) {
        if (err?.code === "PARAM_IDEMPOTENCY_KEY_REUSED") { intent.reset(); fingerprint = ""; }
        error.value = err;
      } finally {
        loading.value = false;
      }
    }

    async function refresh() {
      await loadDemoTargets({ force: true });
      resultData.value = null;
      error.value = null;
    }

    onMounted(() => { loadDemoTargets(); });

    return {
      targetType, targetId, level, result, comment, loading, error, resultData, local,
      levels, results, demoKind, dict, session, submit, refresh, fillTarget, enumLabel,
      navigate: props.navigate,
    };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="按目标编号审核" description="REV-01 只做审核动作；三审三校与 SoD 由后端强制。">
        <template #actions><AppBadge label="REV-01" tone="neutral" icon-name="shield" /></template>
        <div v-if="!dict.enums.review_level" class="notice notice-warning">
          <Icon name="alert" :size="18" />
          <div class="notice-body"><div class="notice-title">字典未下发，显示枚举 code</div><div class="notice-text">ADM-01 仅 R6/R7 可读（CR-001）；审核员页面回退显示 code，不硬编码业务标签。</div></div>
        </div>
        <DemoTargetList :kind="demoKind" title="当前级别的演示目标" @pick="fillTarget" />
        <div class="form-grid">
          <label class="field"><span class="field-label">目标类型<span class="req">*</span></span>
            <select v-model="targetType" class="select" disabled><option value="REPORT">上报线索（REPORT）</option></select>
            <span class="field-hint">v1.0.0 仅支持 REPORT；内容审核目标缺失（CR-010）。</span>
          </label>
          <label class="field"><span class="field-label">目标编号<span class="req">*</span></span>
            <input v-model="targetId" class="input" maxlength="64" placeholder="report_id" :aria-invalid="local.target_id ? 'true' : null" />
            <FieldError :message="local.target_id" />
            <span class="field-hint">没有审核队列/详情接口（CR-FE-03），需手工输入或从演示辅助选择。</span>
          </label>
          <label class="field"><span class="field-label">审核级别<span class="req">*</span></span>
            <select v-model="level" class="select"><option v-for="item in levels" :key="item.value" :value="item.value">{{ item.label }}（{{ item.value }}）</option></select>
            <span class="field-hint">角色/级别由后端裁决；默认值仅作体验。</span>
          </label>
          <label class="field"><span class="field-label">审核结果<span class="req">*</span></span>
            <select v-model="result" class="select"><option v-for="item in results" :key="item.value" :value="item.value">{{ item.label }}（{{ item.value }}）</option></select>
          </label>
        </div>
        <label class="field">
          <span class="field-label">审核意见</span>
          <textarea v-model="comment" class="textarea" rows="4" maxlength="1000" placeholder="不通过/退回时必填；不超过 1000 字" :aria-invalid="local.comment ? 'true' : null" />
          <FieldError :message="local.comment" />
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" type="button" :disabled="loading" @click="submit"><Icon name="check" :size="16" />{{ loading ? '提交中…' : '提交审核' }}</button>
          <button class="btn btn-ghost" type="button" @click="refresh"><Icon name="refresh" :size="16" />刷新演示目标</button>
        </div>
        <div v-if="error" class="form-api-slot"><ErrorPanel :error="error" @retry="submit" @login="navigate('/auth?mode=login')" @refresh="refresh" /></div>
        <div v-if="resultData" class="success-panel">
          <div class="success-icon"><Icon name="check" :size="22" /></div>
          <div class="success-copy">
            <h3>审核已记录</h3>
            <div class="chip-row">
              <StatusBadge enum-name="review_status" :value="resultData.review_status" />
              <AppBadge v-if="resultData.next_review_level" :label="'下一级：' + enumLabel('review_level', resultData.next_review_level).text" tone="info" icon-name="arrowRight" />
              <AppBadge v-else label="流程无下一级" tone="neutral" icon-name="check" />
            </div>
            <p class="muted">review_record_id：<code>{{ resultData.review_record_id }}</code></p>
            <p class="muted">审核状态以后端为准；页面不维护队列，不推进目标状态。</p>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="待审队列 / 目标详情" description="审核工作台需要的列表与详情数据。">
        <StatePanel tone="blocked" icon-name="list" title="审核队列/上报详情/媒体访问接口缺失"
          description="14 个接口只有 REV-01；没有待审列表、上报详情与媒体访问接口。审核员只能按已知 target_id 操作。"
          code="CR-FE-03 / CR-004" compact />
      </SectionCard>
      <div class="notice notice-info">
        <Icon name="shield" :size="18" />
        <div class="notice-body"><div class="notice-title">职责分离</div><div class="notice-text">同一审核人不得连续审核两级；系统管理员不得终审。前端不提供换号绕过或本地推进。</div></div>
      </div>
    </div>
  `,
};

/* ------------------------------ 工单 ------------------------------ */

const WorkordersPanel = {
  name: "WorkordersPanel",
  components: { DemoTargetList },
  props: { navigate: { type: Function, required: true } },
  setup(props) {
    const canDispatch = hasPermission("WO-01");
    const canClose = hasPermission("WO-02");

    const dispatchId = ref("");
    const dispatchOrg = ref("");
    const dispatchLoading = ref(false);
    const dispatchError = ref(null);
    const dispatchLocal = reactive({});
    const dispatchResult = ref(null);
    let dispatchIntent = new SubmitIntent("WO-01");
    let dispatchFp = "";

    const closeId = ref("");
    const weight = ref("");
    const evidence = ref([]);
    const evidenceBusy = ref(false);
    const evidenceError = ref("");
    const closeLoading = ref(false);
    const closeError = ref(null);
    const closeLocal = reactive({});
    const closeResult = ref(null);
    let closeIntent = new SubmitIntent("WO-02");
    let closeFp = "";
    const orgs = computed(() => orgOptions());

    function fillDispatch(item) { dispatchId.value = item.work_order_id; }
    function fillClose(item) { closeId.value = item.work_order_id; }

    async function submitDispatch() {
      for (const key of Object.keys(dispatchLocal)) delete dispatchLocal[key];
      dispatchError.value = null;
      dispatchResult.value = null;
      dispatchLocal.work_order_id = opaqueIdError(dispatchId.value, "工单编号");
      dispatchLocal.target_org_id = dispatchOrg.value ? "" : "请选择目标责任单位";
      if (Object.values(dispatchLocal).some(Boolean)) return;
      const payload = { work_order_id: dispatchId.value.trim(), target_org_id: dispatchOrg.value };
      const fp = JSON.stringify(payload);
      if (fp !== dispatchFp) { dispatchIntent = new SubmitIntent("WO-01"); dispatchFp = fp; }
      dispatchLoading.value = true;
      try {
        dispatchResult.value = await api("WO-01", { payload, idem: dispatchIntent.key });
        toast("工单已转派", { tone: "success" });
        dispatchIntent.reset(); dispatchFp = "";
      } catch (err) {
        if (err?.code === "PARAM_IDEMPOTENCY_KEY_REUSED") { dispatchIntent.reset(); dispatchFp = ""; }
        dispatchError.value = err;
      } finally {
        dispatchLoading.value = false;
      }
    }

    async function addEvidence(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      evidenceError.value = "";
      if (evidence.value.length >= 9) { evidenceError.value = "证据最多 9 个（契约上限）。"; return; }
      const check = fileError(file);
      if (check) { evidenceError.value = check; return; }
      evidenceBusy.value = true;
      try {
        const buffer = await file.arrayBuffer();
        const checksum = await sha256Hex(buffer);
        const data = await api("FILE-01", {
          payload: { media_type: mediaTypeFor(file), size_bytes: file.size, checksum },
          idem: newIdem("FILE-01"),
        });
        evidence.value.push({ mediaRef: data.media_ref, name: file.name, size: file.size });
        toast("证据已登记（未上传）", { tone: "success" });
      } catch (err) {
        evidenceError.value = err?.message || "证据登记失败";
      } finally {
        evidenceBusy.value = false;
        event.target.value = "";
      }
    }

    function removeEvidence(index) { evidence.value.splice(index, 1); }

    async function submitClose() {
      for (const key of Object.keys(closeLocal)) delete closeLocal[key];
      closeError.value = null;
      closeResult.value = null;
      closeLocal.work_order_id = opaqueIdError(closeId.value, "工单编号");
      closeLocal.weight = weightError(weight.value);
      closeLocal.evidence = evidence.value.length ? "" : "请至少登记 1 个证据";
      if (Object.values(closeLocal).some(Boolean)) return;
      const payload = {
        work_order_id: closeId.value.trim(),
        cleanup_weight_kg: Number(weight.value),
        evidence_refs: evidence.value.map((item) => item.mediaRef),
      };
      const fp = JSON.stringify(payload);
      if (fp !== closeFp) { closeIntent = new SubmitIntent("WO-02"); closeFp = fp; }
      closeLoading.value = true;
      try {
        closeResult.value = await api("WO-02", { payload, idem: closeIntent.key });
        toast("工单已办结", { tone: "success" });
        closeIntent.reset(); closeFp = "";
      } catch (err) {
        if (err?.code === "PARAM_IDEMPOTENCY_KEY_REUSED") { closeIntent.reset(); closeFp = ""; }
        closeError.value = err;
      } finally {
        closeLoading.value = false;
      }
    }

    async function refresh() {
      await loadDemoTargets({ force: true });
      dispatchResult.value = null;
      closeResult.value = null;
    }

    onMounted(() => { loadDemoTargets(); });

    return {
      canDispatch, canClose, dispatchId, dispatchOrg, dispatchLoading, dispatchError, dispatchLocal, dispatchResult,
      closeId, weight, evidence, evidenceBusy, evidenceError, closeLoading, closeError, closeLocal, closeResult,
      orgs, dict, fillDispatch, fillClose, submitDispatch, addEvidence, removeEvidence, submitClose, refresh,
      formatBytes, weightError, navigate: props.navigate,
    };
  },
  template: `
    <div class="admin-panel">
      <div v-if="canDispatch">
        <SectionCard title="转派 / 派单" description="WO-01；目标组织必须是后端已存在的组织。">
          <template #actions><AppBadge label="WO-01" tone="neutral" icon-name="send" /></template>
          <DemoTargetList kind="dispatch" title="待派单演示工单" @pick="fillDispatch" />
          <div class="form-grid">
            <label class="field"><span class="field-label">工单编号<span class="req">*</span></span>
              <input v-model="dispatchId" class="input" maxlength="64" placeholder="work_order_id" :aria-invalid="dispatchLocal.work_order_id ? 'true' : null" />
              <FieldError :message="dispatchLocal.work_order_id" />
              <span class="field-hint">没有工单列表/详情接口（CR-FE-04）；可手工输入或从演示辅助选择。</span>
            </label>
            <label class="field"><span class="field-label">目标责任单位<span class="req">*</span></span>
              <select v-if="orgs.length" v-model="dispatchOrg" class="select"><option value="">请选择组织编号</option><option v-for="item in orgs" :key="item.value" :value="item.value">{{ item.label }}</option></select>
              <input v-else v-model="dispatchOrg" class="input" maxlength="64" placeholder="target_org_id（无组织名称字典）" />
              <FieldError :message="dispatchLocal.target_org_id" />
              <span class="field-hint">组织编号来自 ADM-01 sections.responsible_org；没有组织名称字典（CR-FE-04）。</span>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" :disabled="dispatchLoading" @click="submitDispatch"><Icon name="send" :size="16" />{{ dispatchLoading ? '提交中…' : '提交转派' }}</button>
            <button class="btn btn-ghost" type="button" @click="refresh"><Icon name="refresh" :size="16" />刷新演示目标</button>
          </div>
          <div v-if="dispatchError" class="form-api-slot"><ErrorPanel :error="dispatchError" @retry="submitDispatch" @login="navigate('/auth?mode=login')" @refresh="refresh" /></div>
          <div v-if="dispatchResult" class="success-panel">
            <div class="success-icon"><Icon name="check" :size="22" /></div>
            <div class="success-copy"><h3>转派已记录</h3><div class="chip-row"><CopyCode :value="dispatchResult.work_order_id" /><StatusBadge enum-name="work_order_status" :value="dispatchResult.work_order_status" /></div><p class="muted">状态流转由后端裁决；页面不维护工单列表或本地状态。</p></div>
          </div>
        </SectionCard>
      </div>

      <div v-if="canClose">
        <SectionCard title="办结录入" description="WO-02；只有 DISPATCHED → CLOSED 且 cleanup_weight_kg>0 才 closed=true。">
          <template #actions><AppBadge label="WO-02" tone="neutral" icon-name="check" /></template>
          <DemoTargetList kind="close" title="已派单演示工单" @pick="fillClose" />
          <div class="form-grid">
            <label class="field"><span class="field-label">工单编号<span class="req">*</span></span>
              <input v-model="closeId" class="input" maxlength="64" placeholder="work_order_id" :aria-invalid="closeLocal.work_order_id ? 'true' : null" />
              <FieldError :message="closeLocal.work_order_id" />
            </label>
            <label class="field"><span class="field-label">清理量（kg）<span class="req">*</span></span>
              <input v-model="weight" class="input" type="number" min="0.001" max="1000000" step="0.001" inputmode="decimal" placeholder="例如 12.5" :aria-invalid="closeLocal.weight ? 'true' : null" />
              <FieldError :message="closeLocal.weight" />
              <span class="field-hint">大于 0 kg、最多 3 位小数、≤1,000,000 kg；单位 kg。</span>
            </label>
          </div>
          <div class="field">
            <span class="field-label">证据<span class="req">*</span></span>
            <div class="location-actions">
              <label class="btn btn-secondary btn-sm"><Icon name="upload" :size="15" />{{ evidenceBusy ? '登记中…' : '登记证据文件' }}<input class="sr-only" type="file" accept="image/jpeg,image/png,video/mp4" :disabled="evidenceBusy" @change="addEvidence" /></label>
              <span class="muted">1–9 个；FILE-01 只登记 media_ref，真实上传完成接口缺失（CR-004）。</span>
            </div>
            <FieldError :message="evidenceError || closeLocal.evidence" />
            <ul v-if="evidence.length" class="evidence-list">
              <li v-for="(item, index) in evidence" :key="item.mediaRef" class="evidence-item">
                <Icon name="file" :size="16" /><span>{{ item.name }} · {{ formatBytes(item.size) }}</span><code class="code-chip">{{ item.mediaRef }}</code>
                <button class="btn btn-ghost btn-sm" type="button" @click="removeEvidence(index)"><Icon name="close" :size="14" />移除</button>
              </li>
            </ul>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" :disabled="closeLoading" @click="submitClose"><Icon name="check" :size="16" />{{ closeLoading ? '提交中…' : '提交办结' }}</button>
          </div>
          <div v-if="closeError" class="form-api-slot"><ErrorPanel :error="closeError" @retry="submitClose" @login="navigate('/auth?mode=login')" @refresh="refresh" /></div>
          <div v-if="closeResult" class="success-panel">
            <div class="success-icon"><Icon name="check" :size="22" /></div>
            <div class="success-copy">
              <h3>工单已办结</h3>
              <div class="chip-row"><CopyCode :value="closeResult.work_order_id" /><StatusBadge enum-name="work_order_status" :value="closeResult.work_order_status" /><AppBadge :label="'closed=' + closeResult.closed" :tone="closeResult.closed ? 'good' : 'warning'" /><StatusBadge enum-name="progress_stage" :value="closeResult.progress_stage" /></div>
              <p class="muted">closed/progress_stage 为后端字段；页面不本地推导。</p>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="工单列表 / 详情 / 组织名称">
        <StatePanel tone="blocked" icon-name="list" title="工单列表/详情/组织名称接口缺失"
          description="WO-01/02 只接受已知 work_order_id；没有列表、详情与组织名称字典。页面不伪造工单列表。" code="CR-FE-04" compact />
      </SectionCard>
    </div>
  `,
};

/* ------------------------------ 看板 ------------------------------ */

const DashboardPanel = {
  name: "DashboardPanel",
  setup() {
    const period = ref(currentPeriodMonth());
    const sectionId = ref("");
    const loading = ref(false);
    const error = ref(null);
    const data = ref(null);
    const localPeriod = ref("");
    const options = computed(() => sectionOptions());
    const metrics = computed(() => data.value?.metrics ?? []);

    function metricLabel(key) { return enumLabel("metric_key", key).text; }
    function metricValue(metric) {
      if (metric.unit === "kg") return formatKg(metric.value);
      if (metric.unit === "count") return formatCount(metric.value);
      return formatNumber(metric.value);
    }

    async function load() {
      const pErr = periodError(period.value);
      if (pErr) { localPeriod.value = pErr; return; }
      localPeriod.value = "";
      loading.value = true;
      error.value = null;
      try {
        const query = { period: period.value.trim(), metric_keys: [] };
        if (sectionId.value) query.section_id = sectionId.value;
        data.value = await api("STAT-01", { query });
      } catch (err) {
        error.value = err; data.value = null;
      } finally {
        loading.value = false;
      }
    }

    onMounted(load);
    return { period, sectionId, loading, error, data, localPeriod, options, metrics, metricLabel, metricValue, load, formatPeriod, currentPeriodMonth };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="数据看板（内部）" description="KPI 来自 STAT-01；内部页可显示未发布数值，但会明确标注“仅内部”。">
        <template #actions><AppBadge label="内部视图" tone="warning" icon-name="shield" /></template>
        <form class="filter-form" novalidate @submit.prevent="load">
          <label class="field field-inline"><span class="field-label">统计周期</span><input v-model="period" class="input" placeholder="YYYY-MM 或 YYYY-Www" /><FieldError :message="localPeriod" /></label>
          <label class="field field-inline"><span class="field-label">岸段筛选</span>
            <select v-if="options.length" v-model="sectionId" class="select"><option value="">全部岸段</option><option v-for="item in options" :key="item.value" :value="item.value">{{ item.label }}</option></select>
            <span v-else class="muted">岸段字典加载后可筛选。</span>
          </label>
          <div class="filter-actions"><button class="btn btn-primary" type="submit"><Icon name="search" :size="16" />查询</button></div>
        </form>
        <div v-if="loading" class="loading-block"><LoadingBlock label="加载看板" :cards="3" :lines="2" /></div>
        <ErrorPanel v-else-if="error" :error="error" @retry="load" @refresh="load" />
        <template v-else-if="data">
          <section v-if="metrics.length" class="kpi-row">
            <article v-for="metric in metrics" :key="metric.metric_key" class="stat-tile" :class="{ 'is-unpublished': !metric.published }">
              <div class="stat-top"><span class="icon"><Icon name="chart" :size="18" /></span><span class="stat-label">{{ metricLabel(metric.metric_key) }}</span>
                <AppBadge :label="metric.published ? '已发布' : '未发布 · 仅内部'" :tone="metric.published ? 'good' : 'warning'" />
              </div>
              <div class="stat-value-row"><span class="stat-value">{{ metricValue(metric) }}</span><span v-if="metric.unit === 'count'" class="stat-unit">条 / 单</span></div>
              <div class="stat-meta"><span>样本量：{{ metric.sample_size }}</span><span>指标键：{{ metric.metric_key }}</span></div>
            </article>
          </section>
          <StatePanel v-else tone="empty" icon-name="chart" title="本期暂无指标" description="STAT-01 返回空 metrics；前端不补 0。" />
          <div class="notice notice-warning">
            <Icon name="alert" :size="18" />
            <div class="notice-body"><div class="notice-title">未发布指标只允许内部查看</div><div class="notice-text">对外公示页会隐藏 published=false 的数值；本内部页显示并标注“仅内部”，不得对外传播。</div></div>
          </div>
        </template>
      </SectionCard>
      <SectionCard title="运营指标" description="积压/时效/趋势等排班与调度指标。">
        <StatePanel tone="blocked" icon-name="chart" title="运营指标接口缺失"
          description="STAT-01 只提供公众成效指标，没有待审积压、审核时效、工单积压/办结率与趋势字段（CR-FE-18）。前端不从列表自行统计。" code="CR-FE-18" compact />
      </SectionCard>
    </div>
  `,
};

/* ------------------------------ 字典 ------------------------------ */

const DictionaryPanel = {
  name: "DictionaryPanel",
  props: { navigate: { type: Function, required: true } },
  setup(props) {
    const loading = ref(false);
    const error = ref(null);
    const enumName = ref("account_status");
    const enums = computed(() => Object.keys(dict.enums).map((name) => ({ name })));
    const values = computed(() => dict.enums[enumName.value] ?? []);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        await loadDictionary({ force: true });
      } catch (err) {
        error.value = err;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => { if (dict.status !== "ready") load(); });
    return { loading, error, enumName, enums, values, dict, load, formatTimeUtc, navigate: props.navigate };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="字典与合规配置" description="ADM-01 只读；字典/配置写接口未在 14 接口内（CR-016）。">
        <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="load"><Icon name="refresh" :size="14" />刷新</button></template>
        <div v-if="loading" class="loading-block"><LoadingBlock label="加载字典" :lines="3" /></div>
        <ErrorPanel v-else-if="error" :error="error" @retry="load" @login="navigate('/auth?mode=login')" />
        <template v-else-if="dict.available">
          <div class="form-grid">
            <div class="detail-metric"><span class="detail-label">审图号 map_audit_no</span><strong>{{ dict.auditNo || 'null（不下发点位）' }}</strong></div>
            <div class="detail-metric"><span class="detail-label">粗化度 coarsen_degree</span><strong>{{ dict.coarsenDegree }}°</strong></div>
            <div class="detail-metric"><span class="detail-label">榜单 leaderboard_enabled</span><strong>{{ dict.leaderboardEnabled ? 'true' : 'false（默认关闭）' }}</strong></div>
            <div class="detail-metric"><span class="detail-label">状态枚举</span><strong>{{ Object.keys(dict.enums).length }} 组</strong></div>
          </div>
          <div v-if="dict.auditNo && dict.auditNo.startsWith('SAMPLE-ONLY')" class="notice notice-warning">
            <Icon name="alert" :size="18" />
            <div class="notice-body"><div class="notice-title">演示审图号</div><div class="notice-text">SAMPLE-ONLY 仅用于本地演示；生产必须替换为授权审图号。清除后 MAP-01 将不下发任何点位。</div></div>
          </div>
          <div class="two-col">
            <SectionCard title="垃圾类别" description="waste_categories">
              <div class="table-wrap"><table class="data-table"><thead><tr><th>code</th><th>label</th><th>description</th></tr></thead><tbody>
                <tr v-for="item in dict.categories" :key="item.code"><td><code>{{ item.code }}</code></td><td>{{ item.label }}</td><td>{{ item.description }}</td></tr>
              </tbody></table></div>
            </SectionCard>
            <SectionCard title="岸段字典" description="sections（不含坐标）">
              <div class="table-wrap"><table class="data-table"><thead><tr><th>section_id</th><th>name</th><th>responsible_org</th></tr></thead><tbody>
                <tr v-for="item in dict.sections" :key="item.section_id"><td><code>{{ item.section_id }}</code></td><td>{{ item.name }}</td><td>{{ item.responsible_org }}</td></tr>
              </tbody></table></div>
            </SectionCard>
          </div>
          <SectionCard title="状态枚举" description="标签全部来自 ADM-01；前端不硬编码业务含义。">
            <div class="filter-form">
              <label class="field field-inline"><span class="field-label">枚举组</span>
                <select v-model="enumName" class="select"><option v-for="item in enums" :key="item.name" :value="item.name">{{ item.name }}</option></select>
              </label>
            </div>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>value</th><th>label</th></tr></thead><tbody>
              <tr v-for="item in values" :key="item.value"><td><code>{{ item.value }}</code></td><td>{{ item.label }}</td></tr>
            </tbody></table></div>
          </SectionCard>
          <p class="muted">字典/合规配置由运维配给工具修改并写审计；页面不提供写操作。</p>
        </template>
        <StatePanel v-else tone="blocked" icon-name="shield" title="无 ADM-01 字典权限" :description="dict.reason || '当前角色无法读取字典。'" code="CR-001" />
      </SectionCard>
    </div>
  `,
};

/* ------------------------------ 页面 ------------------------------ */

const PANELS = { reviews: ReviewPanel, workorders: WorkordersPanel, dashboard: DashboardPanel, dictionary: DictionaryPanel };

export const AdminView = {
  name: "AdminView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const tabs = computed(() => [
      { id: "reviews", label: "三审三校", show: hasPermission("REV-01") },
      { id: "workorders", label: "工单", show: hasPermission("WO-01") || hasPermission("WO-02") },
      { id: "dashboard", label: "看板", show: hasPermission("ADM-01") },
      { id: "dictionary", label: "字典与合规", show: hasPermission("ADM-01") },
    ].filter((tab) => tab.show));
    const active = computed(() => {
      const wanted = props.route.query.tab;
      return tabs.value.find((tab) => tab.id === wanted)?.id || tabs.value[0]?.id || "";
    });
    const panel = computed(() => PANELS[active.value] || null);
    const canAdmin = computed(() => tabs.value.length > 0);
    const loadingDict = ref(false);

    async function ensure() {
      loadingDict.value = true;
      try {
        if (session.status === "active" && hasPermission("ADM-01") && dict.status !== "ready") {
          await loadDictionary({ force: true });
        }
      } catch { /* 子面板显示错误 */ }
      finally { loadingDict.value = false; }
    }

    onMounted(() => {
      loadDemoTargets();
      ensure();
    });

    return {
      tabs, active, panel, canAdmin, session, dict, roleLabel, loadingDict, navigate: props.navigate,
      switchTab(id) { props.navigate(`/admin?tab=${id}`); },
      login() { props.navigate(`/auth?mode=login&returnTo=${encodeURIComponent("/admin")}`); },
      reloadDict: ensure,
    };
  },
  template: `
    <section class="page-shell admin-page">
      <PageHeader eyebrow="F4 运营后台" title="运营工作台"
        description="审核动作、工单转派/办结、内部看板与字典。所有状态流转、SoD 与权限均由后端裁决。">
        <template #meta>
          <AppBadge :label="'账号：' + (session.profile?.account_id || '—')" tone="info" icon-name="user" />
          <AppBadge v-for="role in (session.roles || [])" :key="role" :label="roleLabel(role).text" tone="neutral" icon-name="shield" :code="roleLabel(role).isCode" />
        </template>
        <template #actions><button class="btn btn-secondary" type="button" @click="reloadDict"><Icon name="refresh" :size="16" />刷新字典</button></template>
      </PageHeader>

      <StatePanel v-if="!canAdmin" tone="refusal" icon-name="shield" title="当前账号无运营后台权限"
        description="permission_summary 未包含 WO-01/02、REV-01 或 ADM-01；界面不展示后台入口，后端仍会拒绝越权请求。">
        <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="login">切换账号</button></template>
      </StatePanel>

      <template v-else>
        <div class="tabs" role="tablist" aria-label="运营后台标签">
          <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ 'is-active': tab.id === active }" type="button" role="tab" :aria-selected="tab.id === active" @click="switchTab(tab.id)">{{ tab.label }}</button>
        </div>
        <div v-if="loadingDict" class="card"><div class="card-body"><LoadingBlock label="加载字典" :lines="2" /></div></div>
        <component v-else-if="panel" :is="panel" :key="active" :navigate="navigate" />
        <StatePanel v-else tone="blocked" icon-name="settings" title="无可用标签" description="当前权限摘要没有对应后台能力。" />
      </template>
    </section>
  `,
};
