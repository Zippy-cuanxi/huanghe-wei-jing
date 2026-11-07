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

const PUBLIC_PROGRESS_LABELS = { SUBMITTED: "已收到", IN_PROGRESS: "处理中", COMPLETED: "已办结" };

export const ProgressSteps = {
  name: "ProgressSteps",
  props: { stage: { type: String, default: null } },
  computed: {
    index() { return PROGRESS_ORDER.indexOf(this.stage); },
    steps() {
      return PROGRESS_ORDER.map((code, i) => ({
        code,
        label: PUBLIC_PROGRESS_LABELS[code] || enumLabel("progress_stage", code).text,
        done: this.index >= 0 && i < this.index,
        current: this.index === i,
      }));
    },
    unknown() { return this.stage && this.index < 0; },
  },
  template: `
    <div class="progress-wrap">
      <div class="progress-steps" role="list" aria-label="处理进度">
        <template v-for="(step, i) in steps" :key="step.code">
          <div class="progress-step"
            :class="{ 'is-done': step.done, 'is-current': step.current }" role="listitem">
            <span class="progress-dot"><Icon v-if="step.done" name="check" :size="11" /><span v-else>{{ i + 1 }}</span></span>
            <span class="progress-label">{{ step.label }}</span>
          </div>
          <span v-if="i < steps.length - 1" class="progress-line" role="presentation" aria-hidden="true"></span>
        </template>
      </div>
      <span v-if="unknown" class="progress-unknown badge badge-code">未知阶段：{{ stage }}</span>
    </div>
  `,
};

export const HeatLegend = {
  name: "HeatLegend",
  template: `
    <div class="heat-legend heat-legend-continuous">
      <span class="legend-title">分布程度 · 连续色带</span>
      <div class="heat-gradient" role="img" aria-label="从嫩芽绿到淡紫的连续色带，表示记录聚合程度由低到高"></div>
      <div class="heat-gradient-labels">
        <span>少</span>
        <span class="heat-empty-key">空白 = 无公开记录</span>
        <span>多</span>
      </div>
      <span class="legend-note">颜色表示记录聚合程度，不是污染浓度；未做插值。</span>
    </div>
  `,
};

export const Breadcrumb = {
  name: "Breadcrumb",
  props: { items: { type: Array, default: () => [] } },
  template: `
    <nav class="breadcrumb" aria-label="面包屑">
      <ol>
        <li v-for="(item, i) in items" :key="i">
          <a v-if="item.path && i < items.length - 1" :href="'#' + item.path">{{ item.label }}</a>
          <span v-else aria-current="page">{{ item.label }}</span>
        </li>
      </ol>
    </nav>
  `,
};

export const Provenance = {
  name: "Provenance",
  props: {
    title: { type: String, default: "口径与来源" },
    items: { type: Array, default: () => [] },
  },
  template: `
    <details class="provenance">
      <summary>
        <span class="provenance-summary-icon"><i class="ri-information-line" aria-hidden="true"></i></span>
        <span class="provenance-summary-text">{{ title }}</span>
        <span class="provenance-toggle"><i class="ri-arrow-down-s-line" aria-hidden="true"></i></span>
      </summary>
      <ul class="provenance-list">
        <li v-for="(item, i) in items" :key="i">{{ item }}</li>
      </ul>
    </details>
  `,
};

export const MetricTile = {
  name: "MetricTile",
  props: {
    label: { type: String, required: true },
    value: { type: String, default: "—" },
    unit: { type: String, default: "" },
    short: { type: String, default: "" },
    scope: { type: String, default: "" },
    not: { type: String, default: "" },
    iconName: { type: String, default: "chart" },
    published: { type: Boolean, default: false },
    demo: { type: Boolean, default: false },
  },
  template: `
    <article class="stat-tile public-metric" :class="{ 'is-unpublished': !published }">
      <div class="stat-top">
        <span class="icon"><i :class="iconName" aria-hidden="true"></i></span>
        <span class="stat-label">{{ label }}</span>
        <AppBadge v-if="demo && published" label="演示数据" tone="neutral" icon-name="info" />
        <AppBadge v-else :label="published ? '本期已发布' : '暂未发布'" :tone="published ? 'good' : 'warning'" />
      </div>
      <div class="stat-value-row">
        <span v-if="published" class="stat-value">{{ value }}</span>
        <span v-else class="stat-value stat-value-empty">暂无可公示数据</span>
        <span v-if="published && unit" class="stat-unit">{{ unit }}</span>
      </div>
      <p class="stat-short">{{ short }}</p>
      <details v-if="scope || not" class="metric-info">
        <summary><i class="ri-information-line" aria-hidden="true"></i>口径与来源</summary>
        <p>{{ scope }}</p>
        <p v-if="not" class="muted">{{ not }}</p>
      </details>
    </article>
  `,
};

export const ColumnScope = {
  name: "ColumnScope",
  props: {
    can: { type: Array, default: () => [] },
    cannot: { type: Array, default: () => [] },
  },
  template: `
    <div class="column-scope">
      <div class="column-scope-head"><strong>这个栏目能回答</strong><span class="badge badge-neutral">示例</span></div>
      <ul class="column-scope-list is-can">
        <li v-for="(item, i) in can" :key="'c' + i"><i class="ri-check-line" aria-hidden="true"></i><span>{{ item }}</span></li>
      </ul>
      <div class="column-scope-sub">不能回答</div>
      <ul class="column-scope-list is-cannot">
        <li v-for="(item, i) in cannot" :key="'n' + i"><i class="ri-close-line" aria-hidden="true"></i><span>{{ item }}</span></li>
      </ul>
    </div>
  `,
};

export const SourceTrail = {
  name: "SourceTrail",
  props: {
    title: { type: String, default: "来源下钻" },
    steps: { type: Array, default: () => [] },
  },
  template: `
    <div class="source-trail">
      <div class="source-trail-head">
        <i class="ri-route-line" aria-hidden="true"></i>
        <strong>{{ title }}</strong>
      </div>
      <ol class="source-trail-list">
        <li v-for="(step, i) in steps" :key="i">
          <span class="source-trail-num">{{ i + 1 }}</span>
          <div class="source-trail-copy"><strong>{{ step.label }}</strong><p>{{ step.desc }}</p></div>
        </li>
      </ol>
      <p class="source-trail-note">原始记录仅在公开范围内展示；不公开时说明原因，不用内部备注代替。</p>
      <slot />
    </div>
  `,
};

export const ShareBlock = {
  name: "ShareBlock",
  props: {
    title: { type: String, required: true },
    summary: { type: String, default: "" },
  },
  methods: {
    async copy() {
      const text = [this.title, this.summary].filter(Boolean).join("\n");
      const ok = await copyText(text);
      toast(ok ? "分享文案已复制" : "复制失败，请手动选择", { tone: ok ? "success" : "warning" });
    },
  },
  template: `
    <div class="share-block">
      <div class="share-block-head"><i class="ri-share-forward-line" aria-hidden="true"></i><strong>分享这一段</strong></div>
      <p class="share-block-title">{{ title }}</p>
      <p class="share-block-summary">{{ summary }}</p>
      <button class="btn btn-secondary btn-sm" type="button" @click="copy"><i class="ri-file-copy-line" aria-hidden="true"></i>复制分享文案</button>
    </div>
  `,
};

export const FilterShell = {
  name: "FilterShell",
  props: {
    activeCount: { type: Number, default: 0 },
    label: { type: String, default: "筛选" },
  },
  data() { return { open: false }; },
  template: `
    <div class="filter-shell" :class="{ 'is-open': open }">
      <button class="filter-shell-toggle" type="button" :aria-expanded="open" @click="open = !open">
        <i class="ri-filter-3-line" aria-hidden="true"></i>
        <span>{{ open ? '收起筛选' : label }}</span>
        <span v-if="activeCount" class="filter-shell-count">{{ activeCount }}</span>
        <i class="ri-arrow-down-s-line filter-shell-chevron" aria-hidden="true"></i>
      </button>
      <div class="filter-shell-body"><slot /></div>
    </div>
  `,
};

export const PublicErrorPanel = {
  name: "PublicErrorPanel",
  props: {
    error: { type: Object, default: null },
    context: { type: String, default: "" },
  },
  emits: ["retry"],
  computed: {
    title() {
      const name = this.error?.name;
      if (name === "TransportError") return "暂时无法连接服务";
      if (name === "ContractError") return "内容暂时无法加载";
      const domain = this.error?.behavior?.domain;
      if (domain === "RATE") return "请求过于频繁";
      if (domain === "DEP") return "外部能力暂不可用";
      return "加载失败，可重试";
    },
    description() {
      const name = this.error?.name;
      if (name === "TransportError") return "请确认服务已启动，或稍后重试；当前筛选条件会保留。";
      if (name === "ContractError") return "页面没有继续猜测数据；请稍后重试。";
      return "请稍后重试；当前筛选条件会保留。";
    },
  },
  template: `
    <StatePanel tone="blocked" icon-name="alert" :title="title" :description="description">
      <template #actions>
        <button class="btn btn-secondary btn-sm" type="button" @click="$emit('retry')">
          <i class="ri-refresh-line" aria-hidden="true"></i>重试
        </button>
        <slot name="actions" />
      </template>
    </StatePanel>
  `,
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
