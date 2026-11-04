// 通用 Vue 组件：图标、徽标、状态面板、分页、进度、弹窗、Toast。
// 后端文本一律按文本插值呈现，不解析 message，不推导业务状态。

import {
  HEAT_BINS,
  PROGRESS_ORDER,
  enumLabel,
  formatKg,
  formatNumber,
  mapError,
  statusTone,
} from "./lib.js";
import { ICON_FILLED, ICON_PATHS } from "./icons.js";
import { copyText, dismissToast, toast, ui } from "./lib.js";

const { computed } = Vue;

export const Icon = {
  name: "Icon",
  props: {
    name: { type: String, default: "info" },
    size: { type: [Number, String], default: 18 },
    title: { type: String, default: "" },
  },
  computed: {
    paths() { return ICON_PATHS[this.name] ?? ICON_PATHS.info; },
    filled() { return ICON_FILLED.has(this.name); },
  },
  template: `
    <svg :viewBox="'0 0 24 24'" :width="size" :height="size"
      :fill="filled ? 'currentColor' : 'none'" stroke="currentColor"
      :stroke-width="filled ? 1 : 1.8" stroke-linecap="round" stroke-linejoin="round"
      class="icon-svg" :role="title ? 'img' : null" :aria-hidden="title ? 'false' : 'true'"
      focusable="false">
      <title v-if="title">{{ title }}</title>
      <path v-for="(d, i) in paths" :key="i" :d="d" />
    </svg>
  `,
};

export const AppBadge = {
  name: "AppBadge",
  props: {
    label: { type: [String, Number], default: "" },
    tone: { type: String, default: "neutral" },
    iconName: { type: String, default: "" },
    code: { type: Boolean, default: false },
  },
  computed: {
    icon() {
      if (this.iconName) return this.iconName;
      return { good: "check", warning: "alert", serious: "alert", critical: "ban", info: "info" }[this.tone] ?? "list";
    },
  },
  template: `
    <span class="badge" :class="['badge-' + tone, code ? 'badge-code' : '']">
      <span class="icon"><Icon :name="icon" :size="13" /></span>
      <span>{{ label }}</span>
    </span>
  `,
};

export const StatusBadge = {
  name: "StatusBadge",
  props: {
    enumName: { type: String, required: true },
    value: { type: [String, Number], default: null },
  },
  computed: {
    label() { return enumLabel(this.enumName, this.value); },
    tone() { return statusTone(this.enumName, this.value); },
    isCode() { return this.label.isCode; },
    title() {
      return this.isCode ? "字典未下发，当前显示枚举 code（ADM-01 权限缺口，CR-001）" : "";
    },
  },
  template: `
    <span class="badge" :class="['badge-' + tone, isCode ? 'badge-code' : '']" :title="title">
      <span class="icon"><Icon :name="{good:'check',warning:'alert',serious:'alert',critical:'ban',info:'info'}[tone] || 'list'" :size="13" /></span>
      <span>{{ label.text }}</span>
    </span>
  `,
};

export const AuditBadge = {
  name: "AuditBadge",
  props: { auditNo: { type: String, default: null } },
  computed: {
    sampleOnly() { return typeof this.auditNo === "string" && this.auditNo.startsWith("SAMPLE-ONLY"); },
  },
  template: `
    <span v-if="auditNo" class="badge audit-badge" :class="sampleOnly ? 'badge-warning' : 'badge-info'">
      <span class="icon"><Icon name="shield" :size="14" /></span>
      <span>审图号：{{ auditNo }}</span>
    </span>
    <span v-else class="badge badge-warning audit-badge">
      <span class="icon"><Icon name="alert" :size="14" /></span>
      <span>审图号未配置</span>
    </span>
  `,
};

export const LoadingBlock = {
  name: "LoadingBlock",
  props: { label: { type: String, default: "加载中" }, lines: { type: Number, default: 3 }, cards: { type: Number, default: 0 } },
  template: `
    <div class="loading-block" role="status" :aria-label="label">
      <div v-if="cards" class="skeleton-cards">
        <div v-for="i in cards" :key="'c' + i" class="skeleton skeleton-card" />
      </div>
      <div class="skeleton skeleton-title" />
      <div v-for="i in lines" :key="'l' + i" class="skeleton skeleton-line" :class="{ 'skeleton-line-lg': i === 1 }" />
      <span class="sr-only">{{ label }}</span>
    </div>
  `,
};

export const StatePanel = {
  name: "StatePanel",
  props: {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    tone: { type: String, default: "empty" }, // empty | blocked | refusal | error
    iconName: { type: String, default: "info" },
    code: { type: String, default: "" },
    traceId: { type: String, default: "" },
    hint: { type: String, default: "" },
    compact: { type: Boolean, default: false },
  },
  methods: {
    async copyTrace() {
      const ok = await copyText(this.traceId);
      toast(ok ? "trace_id 已复制" : "复制失败，请手动选择", { tone: ok ? "success" : "warning" });
    },
  },
  template: `
    <div class="state-panel" :class="['state-' + tone, compact ? 'is-compact' : '']">
      <span class="icon"><Icon :name="iconName" :size="26" /></span>
      <h3 class="state-title">{{ title }}</h3>
      <p v-if="description" class="state-desc">{{ description }}</p>
      <div v-if="code || hint" class="state-code-row">
        <code v-if="code" class="code-chip">{{ code }}</code>
        <span v-if="hint" class="muted">{{ hint }}</span>
      </div>
      <div v-if="traceId" class="trace-line">
        <span class="trace-label">trace_id</span>
        <code class="trace-value">{{ traceId }}</code>
        <button class="btn btn-ghost btn-xs" type="button" @click="copyTrace"><Icon name="copy" :size="13" />复制</button>
      </div>
      <slot />
      <div v-if="$slots.actions" class="state-actions"><slot name="actions" /></div>
    </div>
  `,
};

export const ErrorPanel = {
  name: "ErrorPanel",
  props: {
    error: { type: Object, required: true },
    retryLabel: { type: String, default: "重试" },
    context: { type: String, default: "" },
  },
  emits: ["retry", "login", "refresh", "local-clear"],
  computed: {
    kind() {
      const name = this.error?.name;
      if (name === "BackendError") return "backend";
      if (name === "TransportError") return "transport";
      if (name === "ContractError") return "contract";
      return "unexpected";
    },
    title() {
      if (this.kind === "transport") return "无法连接后端服务";
      if (this.kind === "contract") return "响应不符合契约";
      if (this.kind === "unexpected") return "页面发生异常";
      const behavior = mapError(this.error.code);
      if (behavior.domain === "PERM") return "操作被拒绝";
      if (behavior.domain === "AUTH") return "需要重新登录";
      if (behavior.refreshState) return "后端状态已变化";
      if (behavior.domain === "RATE") return "请求过于频繁";
      if (behavior.domain === "DEP") return "外部能力暂不可用";
      if (behavior.domain === "INTERNAL") return "服务暂不可用";
      return "请求未完成";
    },
    description() {
      if (this.kind === "transport") return this.error.message;
      if (this.kind === "contract") return this.error.message;
      if (this.kind === "unexpected") return "页面遇到未处理异常；请刷新重试，并保留浏览器控制台信息。";
      return this.error.message;
    },
    hint() {
      if (this.kind === "backend") {
        const behavior = mapError(this.error.code);
        return behavior.isUnknownCode ? "未识别的错误码，已按降级处理。" : behavior.hint;
      }
      if (this.kind === "transport") return "请确认 server.py 已运行，且页面与接口同源。";
      if (this.kind === "contract") return "前端未按猜测继续；请检查后端响应是否严格符合四字段信封。";
      return "";
    },
    tone() {
      if (this.kind === "backend") {
        const domain = mapError(this.error.code).domain;
        if (domain === "PERM") return "refusal";
        return mapError(this.error.code).severity === "error" ? "error" : "blocked";
      }
      return "error";
    },
    code() { return this.kind === "backend" ? this.error.code : ""; },
    traceId() { return this.error?.traceId || ""; },
    isAuth() { return this.kind === "backend" && mapError(this.error.code).domain === "AUTH"; },
    canRefresh() { return this.kind === "backend" && mapError(this.error.code).refreshState; },
    canRetry() {
      if (this.kind === "backend") return mapError(this.error.code).retryable;
      return true;
    },
  },
  template: `
    <StatePanel :title="title" :description="description" :tone="tone"
      :icon-name="tone === 'refusal' ? 'shield' : 'alert'" :code="code" :trace-id="traceId" :hint="hint">
      <template #actions>
        <button v-if="canRetry" class="btn btn-secondary btn-sm" type="button" @click="$emit('retry')">
          <Icon name="refresh" :size="15" />{{ retryLabel }}
        </button>
        <button v-if="canRefresh" class="btn btn-primary btn-sm" type="button" @click="$emit('refresh')">
          <Icon name="refresh" :size="15" />重新拉取状态
        </button>
        <button v-if="isAuth" class="btn btn-primary btn-sm" type="button" @click="$emit('login')">
          <Icon name="lock" :size="15" />去登录
        </button>
        <button v-if="context" class="btn btn-ghost btn-sm" type="button" @click="$emit('local-clear')">
          仅清理本地凭证
        </button>
      </template>
    </StatePanel>
  `,
};

export const SectionCard = {
  name: "SectionCard",
  props: { title: { type: String, default: "" }, description: { type: String, default: "" }, className: { type: String, default: "" } },
  template: `
    <section class="card" :class="className">
      <div v-if="title || $slots.actions" class="card-head">
        <div>
          <h2 v-if="title" class="card-title">{{ title }}</h2>
          <p v-if="description" class="card-desc">{{ description }}</p>
        </div>
        <div v-if="$slots.actions" class="card-actions"><slot name="actions" /></div>
      </div>
      <div class="card-body"><slot /></div>
    </section>
  `,
};

export const PageHeader = {
  name: "PageHeader",
  props: { eyebrow: { type: String, default: "" }, title: { type: String, required: true }, description: { type: String, default: "" } },
  template: `
    <header class="page-header">
      <div class="page-header-copy">
        <div v-if="eyebrow" class="eyebrow">{{ eyebrow }}</div>
        <h1 class="page-title">{{ title }}</h1>
        <p v-if="description" class="page-desc">{{ description }}</p>
        <div v-if="$slots.meta" class="page-meta"><slot name="meta" /></div>
      </div>
      <div v-if="$slots.actions" class="page-actions"><slot name="actions" /></div>
    </header>
  `,
};

export const Pager = {
  name: "Pager",
  props: {
    page: { type: Number, default: 1 },
    total: { type: Number, default: 0 },
    pageSize: { type: Number, default: 20 },
    loading: { type: Boolean, default: false },
  },
  emits: ["update:page"],
  computed: {
    pages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    status() { return `第 ${this.page} / ${this.pages} 页 · 共 ${this.total} 条`; },
  },
  template: `
    <div class="pagination">
      <div class="pagination-status"><span>{{ status }}</span><span v-if="loading" class="muted">加载中…</span></div>
      <div class="chip-row">
        <button class="btn btn-ghost btn-sm" type="button" :disabled="page <= 1 || loading" @click="$emit('update:page', page - 1)">
          <Icon name="arrowLeft" :size="15" />上一页
        </button>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="page >= pages || loading" @click="$emit('update:page', page + 1)">
          下一页<Icon name="arrowRight" :size="15" />
        </button>
      </div>
    </div>
  `,
};

export const ProgressSteps = {
  name: "ProgressSteps",
  props: { stage: { type: String, default: null } },
  computed: {
    index() { return PROGRESS_ORDER.indexOf(this.stage); },
    steps() {
      return PROGRESS_ORDER.map((code, i) => ({
        code,
        label: enumLabel("progress_stage", code).text,
        done: this.index >= 0 && i < this.index,
        current: this.index === i,
      }));
    },
    unknown() { return this.stage && this.index < 0; },
  },
  template: `
    <div class="progress-steps" role="list" aria-label="处理进度">
      <div v-for="(step, i) in steps" :key="step.code" class="progress-step"
        :class="{ 'is-done': step.done, 'is-current': step.current }" role="listitem">
        <span class="progress-dot"><Icon v-if="step.done" name="check" :size="11" /><span v-else>{{ i + 1 }}</span></span>
        <span class="progress-label">{{ step.label }}</span>
        <span v-if="i < steps.length - 1" class="progress-line" aria-hidden="true" />
      </div>
      <span v-if="unknown" class="progress-unknown badge badge-code">未知阶段：{{ stage }}</span>
    </div>
  `,
};

export const HeatLegend = {
  name: "HeatLegend",
  template: `
    <div class="heat-legend">
      <span class="legend-title">热力值（后端字段，仅分档着色）</span>
      <div class="legend-scale">
        <span v-for="bin in bins" :key="bin.className" class="legend-item">
          <span class="legend-swatch" :class="bin.className" />{{ bin.range }}
        </span>
      </div>
      <span class="legend-note">颜色只用于展示；数值以 heat_value 为准。</span>
    </div>
  `,
  data() { return { bins: HEAT_BINS }; },
};

export const CopyCode = {
  name: "CopyCode",
  props: { value: { type: String, required: true }, label: { type: String, default: "复制" } },
  methods: {
    async copy() {
      const ok = await copyText(this.value);
      toast(ok ? `已复制：${this.value}` : "复制失败，请手动选择", { tone: ok ? "success" : "warning" });
    },
  },
  template: `
    <span class="chip-row">
      <code class="code-chip">{{ value }}</code>
      <button class="btn btn-ghost btn-xs" type="button" @click="copy"><Icon name="copy" :size="13" />{{ label }}</button>
    </span>
  `,
};

export const Modal = {
  name: "Modal",
  props: { title: { type: String, required: true }, description: { type: String, default: "" }, size: { type: String, default: "md" } },
  emits: ["close"],
  mounted() { document.body.classList.add("no-scroll"); },
  beforeUnmount() { document.body.classList.remove("no-scroll"); },
  template: `
    <teleport to="body">
      <div class="modal-backdrop" @click.self="$emit('close')">
        <div class="modal" :class="size === 'lg' ? 'modal-lg' : ''" role="dialog" aria-modal="true" :aria-label="title">
          <div class="modal-head">
            <div><h2 class="modal-title">{{ title }}</h2><p v-if="description" class="modal-desc">{{ description }}</p></div>
            <button class="btn btn-ghost btn-icon" type="button" aria-label="关闭" @click="$emit('close')"><Icon name="close" :size="18" /></button>
          </div>
          <div class="modal-body"><slot /></div>
          <div v-if="$slots.footer" class="modal-actions"><slot name="footer" /></div>
        </div>
      </div>
    </teleport>
  `,
};

export const ToastHost = {
  name: "ToastHost",
  computed: {
    items() { return ui.toasts; },
  },
  methods: {
    toneClass(tone) {
      return { success: "toast-success", warning: "toast-warning", error: "toast-error" }[tone] || "";
    },
    iconFor(tone) {
      return tone === "success" ? "check" : (tone === "error" || tone === "warning" ? "alert" : "info");
    },
    dismiss(id) { dismissToast(id); },
    async copyTrace(traceId) {
      const ok = await copyText(traceId);
      toast(ok ? "trace_id 已复制" : "复制失败", { tone: ok ? "success" : "warning" });
    },
  },
  template: `
    <div class="toast-region" aria-live="polite" aria-label="提示">
      <div v-for="item in items" :key="item.id" class="toast" :class="toneClass(item.tone)">
        <span class="icon"><Icon :name="iconFor(item.tone)" :size="17" /></span>
        <div class="toast-body">
          <span class="toast-message">{{ item.message }}</span>
          <span v-if="item.traceId" class="toast-trace">trace_id <code>{{ item.traceId }}</code>
            <button class="btn btn-ghost btn-xs" type="button" @click="copyTrace(item.traceId)">复制</button>
          </span>
        </div>
        <button class="btn btn-ghost btn-icon btn-xs" type="button" aria-label="关闭提示" @click="dismiss(item.id)"><Icon name="close" :size="14" /></button>
      </div>
    </div>
  `,
};

export const FieldError = {
  name: "FieldError",
  props: { message: { type: String, default: "" } },
  template: `<div v-if="message" class="field-error" role="alert"><Icon name="alert" :size="14" /><span>{{ message }}</span></div>`,
};

export const HeatCell = {
  name: "HeatCell",
  props: { value: { type: Number, default: 0 } },
  computed: {
    cls() {
      if (!Number.isFinite(this.value) || this.value <= 0) return "heat-0";
      if (this.value <= 2) return "heat-low";
      if (this.value <= 5) return "heat-mid";
      return "heat-high";
    },
  },
  template: `<span class="heat-cell"><span class="heat-dot" :class="cls" />{{ formatNumber(value) }}</span>`,
  methods: { formatNumber },
};

export const KgCell = {
  name: "KgCell",
  props: { value: { type: Number, default: 0 } },
  template: `<span class="tabular">{{ formatKg(value) }}</span>`,
  methods: { formatKg },
};
