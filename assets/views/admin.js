// F4 运营后台：审核动作、工单转派/办结、看板、字典与合规。
// 前端只提交动作并渲染后端结果；不本地推进状态、不绕过 SoD、不伪造队列/列表。

import {
  SubmitIntent,
  api,
  commentError,
  copyText,
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
import { PROMO, REPORT_TEMPLATES } from "../content.js";

const { computed, onMounted, reactive, ref, watch } = Vue;

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
      <SectionCard title="审核状态分组与退回原因" description="队列接口未接入；以下为信息结构，不伪造待办数量。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>状态分组</th><th>包含状态</th><th>默认视图</th></tr></thead>
            <tbody>
              <tr><td>待处理</td><td>待初审 / 待复审 / 待终审</td><td>按当前审核级别的「我的待办」</td></tr>
              <tr><td>已留痕</td><td>已通过 / 已退回 / 已驳回</td><td>只读；不提供删除或跳过入口</td></tr>
            </tbody>
          </table>
        </div>
        <p class="muted">退回原因分类：信息不足 / 图片不清晰 / 重复线索 / 不在受理范围 / 其他。内部原文与操作人不公开；公众只看到「需要补充信息」的归纳。</p>
        <StatePanel tone="blocked" icon-name="list" title="审核队列 / 上报详情 / 媒体访问接口缺失"
          description="14 个接口只有 REV-01；没有待审列表、上报详情与媒体访问接口。审核员只能按已知目标编号操作；不伪造队列数量。"
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

      <SectionCard title="工单状态分组" description="列表接口未接入；以下为信息结构，不伪造工单数量。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>状态分组</th><th>包含状态</th><th>默认视图</th></tr></thead>
            <tbody>
              <tr><td>待派单</td><td>待派单</td><td>运营管理员按责任段查看</td></tr>
              <tr><td>处理中</td><td>已派单</td><td>组织操作员只看本组织</td></tr>
              <tr><td>已结束</td><td>已办结 / 已取消</td><td>只读；办结需清理量与证据</td></tr>
            </tbody>
          </table>
        </div>
        <StatePanel tone="blocked" icon-name="list" title="工单列表/详情/组织名称接口缺失"
          description="WO-01/02 只接受已知工单编号；没有列表、详情与组织名称字典。页面不伪造工单列表。" code="CR-FE-04" compact />
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

/* ------------------------------ 内容区 · 传播素材 ------------------------------ */

const PromoPanel = {
  name: "PromoPanel",
  setup() {
    return { promo: PROMO, templates: REPORT_TEMPLATES };
  },
  methods: {
    async copyCard(card) {
      const text = [card.claim, card.action, card.example].join("\n");
      const ok = await copyText(text);
      toast(ok ? "分享卡文案已复制" : "复制失败，请手动选择", { tone: ok ? "success" : "warning" });
    },
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="传播口径" description="示例文案；不写未核验数字、机构名、办理时限与排名。">
        <template #actions><AppBadge label="示例 · 需人工审核" tone="warning" icon-name="alert" /></template>
        <p class="promo-lead">{{ promo.wechat.scope }}</p>
      </SectionCard>

      <SectionCard title="公众号推文提纲" description="标题备选、导语、三个小标题与行动引导。">
        <div class="promo-block">
          <strong class="promo-label">标题备选</strong>
          <ol class="promo-title-list"><li v-for="title in promo.wechat.titles" :key="title">{{ title }}</li></ol>
        </div>
        <div class="promo-block"><strong class="promo-label">导语</strong><p>{{ promo.wechat.intro }}</p></div>
        <div class="table-wrap">
          <table class="data-table"><thead><tr><th>小标题</th><th>内容方向</th></tr></thead>
            <tbody><tr v-for="section in promo.wechat.sections" :key="section.heading"><td>{{ section.heading }}</td><td>{{ section.body }}</td></tr></tbody>
          </table>
        </div>
        <div class="promo-block"><strong class="promo-label">行动引导</strong><p>{{ promo.wechat.cta }}</p></div>
      </SectionCard>

      <SectionCard title="45 秒短视频分镜" description="6 个镜头；不出现真实地图、机构标识、人脸与未核验数字。">
        <div class="table-wrap">
          <table class="data-table promo-video-table">
            <thead><tr><th>镜头</th><th>时间</th><th>画面</th><th>旁白</th><th>字幕</th><th>备注</th></tr></thead>
            <tbody><tr v-for="shot in promo.video" :key="shot.shot"><td>{{ shot.shot }}</td><td>{{ shot.time }}</td><td>{{ shot.visual }}</td><td>{{ shot.voiceover }}</td><td>{{ shot.subtitle }}</td><td>{{ shot.note }}</td></tr></tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="三张分享卡文案" description="一句主张 + 一句行动 + 示例声明；可复制。">
        <div class="promo-share-grid">
          <article v-for="card in promo.shareCards" :key="card.key" class="promo-share-card">
            <span class="promo-share-title">{{ card.title }}</span>
            <strong>{{ card.claim }}</strong>
            <p>{{ card.action }}</p>
            <span class="promo-share-source">{{ card.source }}</span>
            <small>{{ card.example }}</small>
            <button class="btn btn-secondary btn-sm" type="button" @click="copyCard(card)"><i class="ri-file-copy-line" aria-hidden="true"></i>复制文案</button>
          </article>
        </div>
      </SectionCard>

      <SectionCard title="两类语气版本" description="普通公众 / 评审与答辩；同一事实，不同表达密度。">
        <div class="two-col">
          <article v-for="tone in promo.tones" :key="tone.audience" class="promo-tone">
            <h3>{{ tone.audience }}</h3>
            <p v-for="(paragraph, i) in tone.paragraphs" :key="i">{{ paragraph }}</p>
          </article>
        </div>
      </SectionCard>

      <SectionCard title="周期通报模板" description="周 / 月 / 年报；数字占位，不排名。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>类型</th><th>标题</th><th>周期</th><th>指标占位</th><th>分享句</th></tr></thead>
            <tbody><tr v-for="template in templates" :key="template.id"><td>{{ template.label }}</td><td>{{ template.title }}</td><td>{{ template.period }}</td><td>{{ template.metrics }}</td><td>{{ template.share }}</td></tr></tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  `,
};

/* ------------------------------ 页面 ------------------------------ */


/* ------------------------------ 内容区 ------------------------------ */

const ContentPanel = {
  name: "ContentPanel",
  setup() {
    const columns = [
      { label: "首页", note: "品牌、三条行动入口与最新动态" },
      { label: "垃圾地图", note: "岸段 × 周期矩阵、岸段档案、来源说明" },
      { label: "分类科普", note: "四类判别、小测、审核状态" },
      { label: "护河行动", note: "案例、专题、活动记录" },
      { label: "成效公示", note: "周期战报、指标卡、来源台账" },
      { label: "资讯与政策", note: "方法型短文、政策阅读方法" },
      { label: "关于 / 帮助 / 免责", note: "定位、口径、合规与待补信息" },
    ];
    const states = [
      { state: "草稿", action: "编辑 / 提交审核", rule: "不对外可见" },
      { state: "待审", action: "查看 / 撤回待审", rule: "不可直接发布" },
      { state: "审核中", action: "查看 / 补充材料", rule: "不可绕过审核" },
      { state: "已发布", action: "查看 / 申请撤回", rule: "撤回需审核并留痕" },
      { state: "已撤回", action: "查看 / 重新提交审核", rule: "再发布必须重新审核" },
      { state: "已下架", action: "查看 / 归档", rule: "不硬删除" },
    ];
    return { columns, states, templates: REPORT_TEMPLATES };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="栏目树" description="只读示例：栏目结构与公众线一致；内容管理接口尚未接入。">
        <template #actions><AppBadge label="只读 · 示例" tone="neutral" icon-name="file" /></template>
        <ul class="content-tree">
          <li v-for="item in columns" :key="item.label"><strong>{{ item.label }}</strong><span>{{ item.note }}</span></li>
        </ul>
      </SectionCard>

      <SectionCard title="稿件状态" description="发布必须经过审核；不提供跳过审核的直接发布入口。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>状态</th><th>可执行动作</th><th>规则</th></tr></thead>
            <tbody><tr v-for="item in states" :key="item.state"><td>{{ item.state }}</td><td>{{ item.action }}</td><td>{{ item.rule }}</td></tr></tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="周期战报模板" description="周 / 月 / 年报的策划模板；发布前需审核，不进入公开统计。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>类型</th><th>标题</th><th>周期</th><th>指标占位</th><th>口径</th><th>分享句</th></tr></thead>
            <tbody><tr v-for="template in templates" :key="template.id"><td>{{ template.label }}</td><td>{{ template.title }}</td><td>{{ template.period }}</td><td>{{ template.metrics }}</td><td>{{ template.scope }}</td><td>{{ template.share }}</td></tr></tbody>
          </table>
        </div>
      </SectionCard>

      <StatePanel tone="blocked" icon-name="file" title="内容编辑与内容审核接口未接入"
        description="本区保留栏目、稿件、媒体、专题与发布记录的信息结构；正式接入前不提供发布、撤回或定时发布写操作。" compact />
    </div>
  `,
};

const MediaPanel = {
  name: "MediaPanel",
  setup() {
    return {
      mediaRows: [
        { label: "来源", note: "自采 / 授权 / 公开资料（占位）" },
        { label: "授权类型", note: "使用范围、期限、署名要求（待配置）" },
        { label: "版权归属", note: "版权方占位，不写真实机构名" },
        { label: "关联内容", note: "稿件 / 专题 / 案例" },
        { label: "公开署名", note: "与授权一致；未授权不发布" },
      ],
      topics: [
        { label: "专题主题", note: "主题、栏目归属、关联内容" },
        { label: "发布节奏", note: "审核通过后设置计划窗口，不承诺具体时点" },
        { label: "版本与撤回", note: "版本号、变更摘要、撤回原因、恢复记录" },
        { label: "发布记录", note: "审核人、生效时间、公开状态；无记录时显示空态" },
      ],
    };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="媒体授权与来源" description="媒体只登记来源、授权与公开范围；未授权不得发布。">
        <template #actions><AppBadge label="接口未接入" tone="warning" icon-name="alert" /></template>
        <div class="table-wrap">
          <table class="data-table"><thead><tr><th>信息项</th><th>内容要求</th></tr></thead>
            <tbody><tr v-for="item in mediaRows" :key="item.label"><td>{{ item.label }}</td><td>{{ item.note }}</td></tr></tbody>
          </table>
        </div>
        <StatePanel tone="empty" icon-name="image" title="暂无媒体条目" description="接入媒体库后，这里显示来源、授权与关联内容；当前不伪造媒体。" compact />
      </SectionCard>

      <SectionCard title="专题与发布节奏" description="专题、节奏、版本与撤回都需审核与留痕。">
        <div class="table-wrap">
          <table class="data-table"><thead><tr><th>信息项</th><th>内容要求</th></tr></thead>
            <tbody><tr v-for="item in topics" :key="item.label"><td>{{ item.label }}</td><td>{{ item.note }}</td></tr></tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="发布记录" description="发布必须经过审核；撤回与再发布均留痕。">
        <StatePanel tone="empty" icon-name="file" title="暂无发布记录" description="正式接入后显示稿件、版本、审核人、生效时间与撤回原因。" compact />
      </SectionCard>
    </div>
  `,
};

/* ------------------------------ 数据区 ------------------------------ */

const DataPanel = {
  name: "DataPanel",
  setup() {
    return { dict };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="来源台账" description="无来源不入库；公开范围与更新时间随来源登记。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>来源名称</th><th>权威等级</th><th>获取时间</th><th>更新频率</th><th>公开范围</th></tr></thead>
            <tbody><tr><td colspan="5" class="table-empty">暂无来源条目；来源台账接口尚未接入</td></tr></tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="事件证据" description="只呈现公开范围内的证据句；原始照片与内部记录不公开。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>事件摘要</th><th>证据句</th><th>来源</th><th>获取时间</th><th>公开范围</th></tr></thead>
            <tbody><tr><td colspan="5" class="table-empty">暂无事件证据；事件接口尚未接入</td></tr></tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="岸段主数据" description="只展示编号、名称与责任段；不展示原始坐标与联系方式。">
        <div v-if="dict.available && dict.sections.length" class="table-wrap">
          <table class="data-table">
            <thead><tr><th>岸段编号</th><th>名称</th><th>责任段</th></tr></thead>
            <tbody><tr v-for="section in dict.sections" :key="section.section_id"><td><code>{{ section.section_id }}</code></td><td>{{ section.name }}</td><td>{{ section.responsible_org }}</td></tr></tbody>
          </table>
        </div>
        <StatePanel v-else tone="empty" icon-name="map" title="暂无岸段字典" description="当前角色无法读取岸段字典，或字典尚未加载。" compact />
      </SectionCard>

      <SectionCard title="指标口径与版本" description="指标名称、单位、范围、样本门槛与版本；变更需复核。">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>指标名</th><th>单位</th><th>统计范围</th><th>版本</th><th>生效时间</th><th>变更原因</th></tr></thead>
            <tbody><tr><td colspan="6" class="table-empty">暂无口径台账；指标版本接口尚未接入</td></tr></tbody>
          </table>
        </div>
        <StatePanel tone="empty" icon-name="chart" title="口径台账接口未接入" description="当前只展示字典中的状态枚举；指标版本与变更原因待接入后显示。" compact />
      </SectionCard>
    </div>
  `,
};

const ExportsPanel = {
  name: "ExportsPanel",
  setup() {
    return {
      rows: [
        { type: "岸段主数据", scope: "编号 / 名称 / 责任段", rule: "不含原始坐标与联系方式" },
        { type: "来源台账", scope: "公开来源摘要", rule: "受控导出，留痕" },
        { type: "指标口径", scope: "指标名 / 单位 / 范围 / 版本", rule: "版本化，需复核" },
        { type: "事件证据", scope: "公开证据句与来源", rule: "不含内部备注与原始照片" },
      ],
    };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="导入导出分类" description="导出受控；不导出原始坐标、内部备注与未审核内容。">
        <template #actions><AppBadge label="接口未接入" tone="warning" icon-name="alert" /></template>
        <div class="table-wrap">
          <table class="data-table"><thead><tr><th>数据类型</th><th>导出范围</th><th>规则</th></tr></thead>
            <tbody><tr v-for="row in rows" :key="row.type"><td>{{ row.type }}</td><td>{{ row.scope }}</td><td>{{ row.rule }}</td></tr></tbody>
          </table>
        </div>
      </SectionCard>
      <StatePanel tone="blocked" icon-name="download" title="导入导出接口未接入"
        description="正式接入后，导入失败不覆盖现有数据，导出需审批并加水印；当前不提供写操作入口。" compact />
    </div>
  `,
};

/* ------------------------------ 系统区 ------------------------------ */

const SystemPanel = {
  name: "SystemPanel",
  setup() {
    return {
      session, dict,
      matrix: [
        { role: "R2 组织操作员", business: "本组织工单 / 办结", content: "—", data: "本责任段只读", system: "—", review: "办结证据抽检" },
        { role: "R3 初审员", business: "初审", content: "—", data: "只读", system: "—", review: "越级审核禁止" },
        { role: "R4 复审员", business: "复审", content: "—", data: "只读", system: "—", review: "不得复审本人初审内容" },
        { role: "R5 终审员", business: "终审", content: "—", data: "只读", system: "—", review: "不得终审本人参与级别" },
        { role: "R6 运营管理员", business: "派单 / 队列管理", content: "发布需审核", data: "来源 / 指标（复核）", system: "部分配置", review: "发布 / 撤回 / 口径 / 导出" },
        { role: "R7 系统管理员", business: "只读（不可终审）", content: "只读（不可终审）", data: "字典 / 版本", system: "角色 / 环境", review: "角色提升 / 环境切换" },
        { role: "R8 审计员", business: "全量只读", content: "全量只读", data: "来源 / 版本只读", system: "审计日志只读", review: "无写操作" },
        { role: "内容编辑（权限组）", business: "—", content: "起草 / 媒体 / 专题", data: "—", system: "—", review: "发布需审核" },
      ],
    };
  },
  template: `
    <div class="admin-panel">
      <SectionCard title="角色可见范围" description="只读示例；角色变更与权限提升需双人复核。">
        <template #actions><AppBadge label="只读" tone="neutral" icon-name="shield" /></template>
        <div class="table-wrap">
          <table class="data-table role-matrix">
            <thead><tr><th>角色</th><th>业务</th><th>内容</th><th>数据</th><th>系统</th><th>需复核</th></tr></thead>
            <tbody><tr v-for="row in matrix" :key="row.role"><td>{{ row.role }}</td><td>{{ row.business }}</td><td>{{ row.content }}</td><td>{{ row.data }}</td><td>{{ row.system }}</td><td>{{ row.review }}</td></tr></tbody>
          </table>
        </div>
        <p class="muted">内容编辑为权限组，不新增角色层级；待组织确认。</p>
      </SectionCard>

      <SectionCard title="环境与合规" description="演示态与正式态必须显式区分；切换需双人复核。">
        <div class="detail-metrics">
          <div class="detail-metric"><span class="detail-label">当前环境</span><strong>演示环境</strong></div>
          <div class="detail-metric"><span class="detail-label">审图号</span><strong>{{ dict.auditNo || '未配置' }}</strong></div>
          <div class="detail-metric"><span class="detail-label">榜首开关</span><strong>{{ dict.leaderboardEnabled ? '开启' : '默认关闭' }}</strong></div>
          <div class="detail-metric"><span class="detail-label">正式上线</span><strong>需双人复核</strong></div>
        </div>
        <div class="notice notice-warning">
          <i class="ri-alert-line notice-icon" aria-hidden="true"></i>
          <div class="notice-body"><div class="notice-title">演示态不对外发布</div><div class="notice-text">示例内容与演示数据不得作为正式结论；正式环境须替换审图号、底图与示例内容。</div></div>
        </div>
      </SectionCard>

      <SectionCard title="通知与订阅配置" description="只在状态变化或新公示时提醒；不发送营销信息。">
        <div class="table-wrap">
          <table class="data-table"><thead><tr><th>信息分类</th><th>约束</th></tr></thead>
            <tbody>
              <tr><td>通知模板</td><td>状态变化 / 公示更新 / 审核待办；文案中性，不承诺时限</td></tr>
              <tr><td>渠道</td><td>站内为主；邮件 / 短信占位，待运营配置</td></tr>
              <tr><td>退订</td><td>一键退订，立即生效；不影响上报与公开查询</td></tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="审计日志" description="只追加，不修改、不删除。">
        <StatePanel tone="empty" icon-name="file" title="审计日志接口未接入" description="正式接入后显示角色变更、发布、撤回、口径变更与导出留痕。" compact />
      </SectionCard>
    </div>
  `,
};

const PANELS = {
  reviews: ReviewPanel, workorders: WorkordersPanel,
  content: ContentPanel, media: MediaPanel, promo: PromoPanel,
  dashboard: DashboardPanel, dictionary: DictionaryPanel, data: DataPanel, exports: ExportsPanel,
  system: SystemPanel,
};

export const AdminView = {
  name: "AdminView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const tabs = computed(() => [
      { id: "reviews", group: "业务", label: "审核队列", icon: "ri-shield-check-line", note: "三审三校 · 职责分离", show: hasPermission("REV-01") },
      { id: "workorders", group: "业务", label: "工单", icon: "ri-task-line", note: "派单 / 办结 / 证据", show: hasPermission("WO-01") || hasPermission("WO-02") },
      { id: "content", group: "内容", label: "栏目与稿件", icon: "ri-file-text-line", note: "状态 / 版本 / 撤回", show: hasPermission("ADM-01") },
      { id: "media", group: "内容", label: "媒体与发布", icon: "ri-image-line", note: "授权 / 专题 / 发布记录", show: hasPermission("ADM-01") },
      { id: "promo", group: "内容", label: "传播素材", icon: "ri-megaphone-line", note: "推文 / 视频 / 分享卡", show: hasPermission("ADM-01") },
      { id: "dashboard", group: "数据", label: "数据看板", icon: "ri-bar-chart-line", note: "内部指标，仅内部使用", show: hasPermission("ADM-01") },
      { id: "dictionary", group: "数据", label: "字典与口径", icon: "ri-book-2-line", note: "类别 / 岸段 / 口径", show: hasPermission("ADM-01") },
      { id: "data", group: "数据", label: "来源与岸段", icon: "ri-database-2-line", note: "来源台账 / 证据 / 岸段", show: hasPermission("ADM-01") },
      { id: "exports", group: "数据", label: "导入导出", icon: "ri-download-2-line", note: "受控导出与留痕", show: hasPermission("ADM-01") },
      { id: "system", group: "系统", label: "角色与环境", icon: "ri-settings-3-line", note: "权限 / 通知 / 审计", show: hasPermission("ADM-01") },
    ].filter((tab) => tab.show));
    const groups = computed(() => {
      const order = ["业务", "内容", "数据", "系统"];
      return order
        .map((title) => ({ title, items: tabs.value.filter((tab) => tab.group === title) }))
        .filter((group) => group.items.length);
    });
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
    watch(canAdmin, (allowed) => { if (allowed) ensure(); });

    return {
      tabs, groups, active, panel, canAdmin, session, dict, roleLabel, loadingDict, navigate: props.navigate,
      switchTab(id) { props.navigate(`/admin?tab=${id}`); },
      login() { props.navigate(`/auth?mode=login&returnTo=${encodeURIComponent("/admin")}`); },
      reloadDict: ensure,
    };
  },
  template: `
    <section class="admin-page work-page">
      <div class="work-page-head">
        <div>
          <div class="eyebrow">工作线 · 仅对有权限者显示</div>
          <h1 class="work-page-title">运营工作台</h1>
          <p class="work-page-desc">业务、内容、数据、系统四区。公众线与工作线分离，状态流转、职责分离与权限均由后端裁决。</p>
        </div>
        <div class="work-page-meta">
          <AppBadge :label="'账号：' + (session.profile?.account_id || '—')" tone="info" icon-name="user" />
          <AppBadge v-for="role in (session.roles || [])" :key="role" :label="roleLabel(role).text" tone="neutral" icon-name="shield" :code="roleLabel(role).isCode" />
          <button class="btn btn-secondary btn-sm" type="button" @click="reloadDict"><Icon name="refresh" :size="14" />刷新字典</button>
        </div>
      </div>

      <StatePanel v-if="!canAdmin" tone="refusal" icon-name="shield" title="当前账号无运营后台权限"
        description="当前账号未获得审核、工单或字典能力；界面不展示后台入口，后端仍会拒绝越权请求。">
        <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="login">切换账号</button></template>
      </StatePanel>

      <div v-else class="work-layout">
        <aside class="work-sidebar" aria-label="工作区导航">
          <div v-for="group in groups" :key="group.title" class="work-sidebar-group">
            <div class="work-sidebar-title">{{ group.title }}</div>
            <button v-for="tab in group.items" :key="tab.id" class="work-nav-item" :class="{ 'is-active': tab.id === active }" type="button" @click="switchTab(tab.id)">
              <i :class="tab.icon" aria-hidden="true"></i>
              <span><strong>{{ tab.label }}</strong><small>{{ tab.note }}</small></span>
            </button>
          </div>
          <div class="work-sidebar-note">
            <i class="ri-shield-check-line" aria-hidden="true"></i>
            <p>同一审核人不得连续审核两级；系统管理员不得终审。所有写操作留痕。</p>
          </div>
        </aside>
        <div class="work-content">
          <div v-if="loadingDict" class="card"><div class="card-body"><LoadingBlock label="加载字典" :lines="2" /></div></div>
          <component v-else-if="panel" :is="panel" :key="active" :navigate="navigate" />
          <StatePanel v-else tone="blocked" icon-name="settings" title="无可用工作区" description="当前权限摘要没有对应后台能力。" />
        </div>
      </div>
    </section>
  `,
};
