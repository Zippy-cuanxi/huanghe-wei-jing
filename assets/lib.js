// 统一 API / 凭证 / 错误映射 / 格式化 / 共享状态。
// 只消费契约字段；不推导 closed/progress_stage/heat_value 等业务结论。

const { reactive } = Vue;

export const CONTRACT_VERSION = "1.0.0";

export const API_ROUTES = Object.freeze({
  "AUTH-01": { method: "POST", path: "/api/auth/register", auth: false },
  "AUTH-02": { method: "POST", path: "/api/auth/login", auth: false },
  "AUTH-03": { method: "POST", path: "/api/auth/logout", auth: true },
  "AUTH-04": { method: "GET", path: "/api/auth/session", auth: true },
  "FILE-01": { method: "POST", path: "/api/media/tickets", auth: true },
  "RPT-01": { method: "POST", path: "/api/reports", auth: true },
  "RPT-02": { method: "GET", path: "/api/reports/mine", auth: true },
  "MAP-01": { method: "GET", path: "/api/map/sections", auth: false },
  "WO-01": { method: "POST", path: "/api/work-orders/dispatch", auth: true },
  "WO-02": { method: "POST", path: "/api/work-orders/close", auth: true },
  "REV-01": { method: "POST", path: "/api/reviews", auth: true },
  "STAT-01": { method: "GET", path: "/api/statistics", auth: false },
  "FB-01": { method: "POST", path: "/api/feedback", auth: true },
  "ADM-01": { method: "GET", path: "/api/admin/config", auth: true },
});

export const API_IDS = Object.freeze(Object.keys(API_ROUTES));
export const PUBLIC_APIS = new Set(["AUTH-01", "AUTH-02", "MAP-01", "STAT-01"]);
export const ERROR_DOMAINS = ["PARAM", "AUTH", "PERM", "STATE", "RATE", "DEP", "INTERNAL"];

/* ---------------------------- 本地错误类型 ---------------------------- */

export class TransportError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransportError";
  }
}

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}

export class BackendError extends Error {
  constructor(envelope, status) {
    super(envelope.message || "请求失败");
    this.name = "BackendError";
    this.code = envelope.code;
    this.message = envelope.message;
    this.traceId = envelope.trace_id;
    this.status = status;
    this.behavior = mapError(envelope.code);
  }
}

/* ---------------------------- 凭证层 ---------------------------- */

const SESSION_KEY = "hh.session_handle";
const DEVICE_KEY = "hh.device_tag";

function safeSessionStorage() {
  try {
    const probe = "__hh_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    const memory = new Map();
    return {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    };
  }
}

function randomToken() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2);
}

export class CredentialStore {
  constructor() {
    this.storage = safeSessionStorage();
  }

  getSessionHandle() {
    return this.storage.getItem(SESSION_KEY);
  }

  setSessionHandle(handle) {
    if (typeof handle === "string" && handle) this.storage.setItem(SESSION_KEY, handle);
  }

  clearSession() {
    this.storage.removeItem(SESSION_KEY);
  }

  getDeviceTag() {
    let tag = this.storage.getItem(DEVICE_KEY);
    if (!tag) {
      tag = `web-${randomToken()}`;
      this.storage.setItem(DEVICE_KEY, tag);
    }
    return tag;
  }
}

export const credentials = new CredentialStore();

/* ---------------------------- 公共状态 ---------------------------- */

export const session = reactive({
  status: "checking", // checking | anonymous | active
  handle: credentials.getSessionHandle(),
  profile: null,
  permissions: [],
  roles: [],
  expiresAt: null,
  error: null,
});

export const dict = reactive({
  status: "idle", // idle | loading | ready | unavailable | error
  available: false,
  reason: "",
  categories: [],
  sections: [],
  enums: {},
  coarsenDegree: null,
  auditNo: null,
  leaderboardEnabled: false,
  error: null,
});

export const publicSections = reactive({ items: [] });

export const demo = reactive({
  status: "idle", // idle | loading | ready | unavailable | error
  data: null,
  error: null,
});

export const ui = reactive({
  toasts: [],
  netBusy: 0,
});

let toastSeq = 0;
export function toast(message, { tone = "info", traceId = null, timeout = 5200 } = {}) {
  const id = ++toastSeq;
  ui.toasts.push({ id, message, tone, traceId });
  window.setTimeout(() => {
    const index = ui.toasts.findIndex((item) => item.id === id);
    if (index >= 0) ui.toasts.splice(index, 1);
  }, timeout);
}

export function dismissToast(id) {
  const index = ui.toasts.findIndex((item) => item.id === id);
  if (index >= 0) ui.toasts.splice(index, 1);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = String(text);
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ---------------------------- 会话操作 ---------------------------- */

export function clearAuth({ notify = false } = {}) {
  credentials.clearSession();
  session.handle = null;
  session.profile = null;
  session.permissions = [];
  session.roles = [];
  session.expiresAt = null;
  session.status = "anonymous";
  session.error = null;
  resetDictionary();
  if (notify) window.dispatchEvent(new CustomEvent("hh:auth-cleared"));
}

export function applyAuth(data) {
  if (!data || typeof data.session_handle !== "string") {
    throw new ContractError("登录响应缺少 session_handle");
  }
  credentials.setSessionHandle(data.session_handle);
  session.handle = data.session_handle;
  session.profile = data.account_profile ?? null;
  session.permissions = Array.isArray(data.permission_summary?.permissions)
    ? data.permission_summary.permissions
    : [];
  session.roles = Array.isArray(data.permission_summary?.roles)
    ? data.permission_summary.roles
    : (data.account_profile?.roles ?? []);
  session.expiresAt = data.expires_at ?? null;
  session.status = "active";
  session.error = null;
}

export async function login(accountId, credential) {
  const data = await api("AUTH-02", {
    payload: {
      account_id: accountId,
      credential,
      device_tag: credentials.getDeviceTag(),
    },
  });
  applyAuth(data);
  resetDictionary();
  if (hasPermission("ADM-01")) await loadDictionary().catch(() => {});
  return data;
}

export async function register(payload) {
  return api("AUTH-01", { payload, idem: newIdem("register") });
}

export async function refreshSession() {
  if (!credentials.getSessionHandle()) {
    session.status = "anonymous";
    return null;
  }
  try {
    const data = await api("AUTH-04", { payload: {} });
    applyAuth({ ...data, session_handle: credentials.getSessionHandle() });
    return data;
  } catch (error) {
    if (error instanceof BackendError && error.behavior.domain === "AUTH") {
      clearAuth({ notify: true });
    } else {
      session.status = "anonymous";
      session.error = error;
    }
    throw error;
  }
}

export async function logout(scope = "CURRENT") {
  const data = await api("AUTH-03", { payload: { scope } });
  clearAuth();
  return data;
}

export function hasPermission(apiId) {
  if (PUBLIC_APIS.has(apiId)) return true;
  return session.status === "active" && session.permissions.includes(apiId);
}

export function isActive() {
  return session.status === "active";
}

/* ---------------------------- API 客户端 ---------------------------- */

export async function api(apiId, { payload = {}, query = null, idem = null } = {}) {
  const route = API_ROUTES[apiId];
  if (!route) throw new ContractError(`未知接口编号：${apiId}`);
  const url = new URL(route.path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const headers = { Accept: "application/json" };
  if (route.method === "POST") headers["Content-Type"] = "application/json";
  if (route.auth && credentials.getSessionHandle()) {
    headers["X-Session-Handle"] = credentials.getSessionHandle();
  }
  if (idem) headers["Idempotency-Key"] = idem;

  let response;
  try {
    response = await fetch(url.toString(), {
      method: route.method,
      headers,
      body: route.method === "POST" ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    throw new TransportError("无法连接后端服务；请确认 server.py 正在运行。");
  }

  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new ContractError("后端响应不是合法 JSON（统一信封解析失败）");
  }
  validateEnvelope(envelope);

  if (envelope.code !== "OK") {
    const behavior = mapError(envelope.code);
    if (behavior.clearCredentials) {
      clearAuth({ notify: true });
    }
    throw new BackendError(envelope, response.status);
  }
  return envelope.data;
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new ContractError("响应信封必须是对象");
  }
  const keys = Object.keys(envelope).sort().join(",");
  if (keys !== "code,data,message,trace_id") {
    throw new ContractError(`响应信封字段不符合契约：${keys}`);
  }
  if (typeof envelope.code !== "string" || !envelope.code) {
    throw new ContractError("响应 code 必须是非空字符串");
  }
  if (typeof envelope.message !== "string") {
    throw new ContractError("响应 message 必须是字符串");
  }
  if (typeof envelope.trace_id !== "string" || !/^[0-9a-f]{32}$/.test(envelope.trace_id)) {
    throw new ContractError("响应 trace_id 必须是 32 位十六进制");
  }
  if (envelope.code === "OK") {
    if (envelope.data === null || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
      throw new ContractError("成功响应的 data 必须是对象");
    }
  } else if (envelope.data !== null) {
    throw new ContractError("错误响应的 data 必须为 null");
  }
}

/* ---------------------------- 错误映射（40 码） ---------------------------- */

export const BACKEND_ERROR_CODES = Object.freeze([
  "PARAM_MISSING_FIELD", "PARAM_INVALID_TYPE", "PARAM_INVALID_VALUE", "PARAM_INVALID_ENUM",
  "PARAM_UNKNOWN_FIELD", "PARAM_UNKNOWN_API", "PARAM_INVALID_PAGINATION",
  "PARAM_INVALID_IDEMPOTENCY_KEY", "PARAM_IDEMPOTENCY_KEY_REUSED",
  "PARAM_INVALID_COORDINATE", "PARAM_INVALID_WEIGHT", "PARAM_INVALID_MEDIA_TYPE",
  "PARAM_MEDIA_SIZE_EXCEEDED", "PARAM_INVALID_CHECKSUM", "PARAM_INVALID_PERIOD",
  "PARAM_INVALID_RATING", "PARAM_UNKNOWN_METRIC_KEY", "PARAM_INVALID_SCOPE",
  "PARAM_TARGET_NOT_FOUND", "PARAM_TARGET_ORG_NOT_FOUND", "PARAM_AGREEMENT_REQUIRED",
  "AUTH_INVALID", "AUTH_LOCKED", "AUTH_SESSION_REQUIRED", "AUTH_SESSION_INVALID",
  "AUTH_SESSION_EXPIRED", "AUTH_SESSION_REVOKED", "AUTH_ACCOUNT_EXISTS",
  "AUTH_CREDENTIAL_TOO_WEAK", "AUTH_VERIFY_FAILED",
  "PERM_ROLE_REQUIRED", "PERM_RESOURCE_FORBIDDEN", "PERM_SOD_VIOLATION",
  "STATE_INVALID_TRANSITION", "STATE_REVIEW_LEVEL_MISMATCH",
  "STATE_CLOSED_REQUIRED", "STATE_FEEDBACK_DUPLICATE",
  "RATE_LIMITED",
  "DEP_EXTERNAL_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

const DOMAIN_BEHAVIOR = {
  PARAM: { action: "request_error", clearCredentials: false, retryable: false, refreshState: false, severity: "warning",
    hint: "请按提示修正请求后重试。" },
  AUTH: { action: "clear_credentials", clearCredentials: true, retryable: true, refreshState: false, severity: "warning",
    hint: "登录状态或凭证已失效，请重新登录。" },
  PERM: { action: "refusal", clearCredentials: false, retryable: false, refreshState: false, severity: "error",
    hint: "当前操作不被允许；界面裁剪不构成安全边界，以后端裁决为准。" },
  STATE: { action: "refresh_state", clearCredentials: false, retryable: true, refreshState: true, severity: "warning",
    hint: "状态已变化，请以重新拉取的后端状态为准。" },
  RATE: { action: "degrade", clearCredentials: false, retryable: true, refreshState: false, severity: "warning",
    hint: "请求过于频繁，请稍后再试；保留 trace_id 供联调。" },
  DEP: { action: "degrade", clearCredentials: false, retryable: true, refreshState: false, severity: "warning",
    hint: "外部能力暂不可用，系统已安全降级；请稍后重试。" },
  INTERNAL: { action: "degrade", clearCredentials: false, retryable: true, refreshState: false, severity: "error",
    hint: "服务暂不可用；请保留 trace_id 供联调定位。" },
};

const OVERRIDES = {
  AUTH_INVALID: { action: "auth_failed", clearCredentials: true, retryable: true,
    hint: "账号或凭证不正确；为保护账号，系统不会区分账号是否存在。" },
  AUTH_LOCKED: { action: "auth_locked", clearCredentials: true, retryable: true,
    hint: "尝试次数过多，账号暂时锁定；请稍后再试。" },
  AUTH_SESSION_REQUIRED: { action: "session_lost", clearCredentials: true, retryable: false, hint: "请先登录后再操作。" },
  AUTH_SESSION_INVALID: { action: "session_lost", clearCredentials: true, retryable: false, hint: "会话无效或已注销；请重新登录。" },
  AUTH_SESSION_EXPIRED: { action: "session_lost", clearCredentials: true, retryable: false, hint: "会话已过期；请重新登录。" },
  AUTH_SESSION_REVOKED: { action: "session_lost", clearCredentials: true, retryable: false, hint: "会话已失效；请重新登录。" },
  AUTH_ACCOUNT_EXISTS: { action: "account_exists", clearCredentials: true, retryable: false, hint: "账号已存在；请直接登录。" },
  AUTH_CREDENTIAL_TOO_WEAK: { action: "fix_form", clearCredentials: true, retryable: false, hint: "凭证需 8–128 位，且至少包含字母与数字。" },
  AUTH_VERIFY_FAILED: { action: "verify_failed", clearCredentials: true, retryable: true, hint: "验证码不正确或已失效；请重新获取。" },
  PERM_ROLE_REQUIRED: { action: "refusal", clearCredentials: false, retryable: false, hint: "当前角色无权执行该操作；请勿尝试通过界面绕过。" },
  PERM_RESOURCE_FORBIDDEN: { action: "refusal", clearCredentials: false, retryable: false, hint: "无权访问该资源；系统不会区分资源是否存在。" },
  PERM_SOD_VIOLATION: { action: "refusal", clearCredentials: false, retryable: false, hint: "审核职责分离限制：同一人不得连续审核两级，系统管理员不得终审。" },
  STATE_INVALID_TRANSITION: { action: "refresh_state", clearCredentials: false, retryable: true, refreshState: true, hint: "当前状态不允许该流转；请重新拉取后端状态。" },
  STATE_REVIEW_LEVEL_MISMATCH: { action: "refresh_state", clearCredentials: false, retryable: true, refreshState: true, hint: "审核级别与当前流程不一致；请按后端状态重新操作。" },
  STATE_CLOSED_REQUIRED: { action: "refresh_state", clearCredentials: false, retryable: true, refreshState: true, hint: "工单尚未办结，暂不能评价。" },
  STATE_FEEDBACK_DUPLICATE: { action: "refresh_state", clearCredentials: false, retryable: true, refreshState: true, hint: "该工单已提交过评价；同一工单同一账号仅一次。" },
  PARAM_IDEMPOTENCY_KEY_REUSED: { action: "request_error", clearCredentials: false, retryable: true, hint: "同一幂等键被用于不同请求内容；请生成新的幂等键后重试。" },
  PARAM_INVALID_COORDINATE: { action: "request_error", clearCredentials: false, retryable: true, hint: "定位超出有效范围；请重新定位。" },
  PARAM_INVALID_WEIGHT: { action: "request_error", clearCredentials: false, retryable: true, hint: "清理量必须大于 0 kg、最多 3 位小数且不超过 1,000,000 kg。" },
  PARAM_INVALID_PERIOD: { action: "request_error", clearCredentials: false, retryable: true, hint: "周期格式应为 YYYY-MM 或 YYYY-Www。" },
  RATE_LIMITED: { action: "degrade", clearCredentials: false, retryable: true, severity: "warning", hint: "请求过于频繁；请延后重试，并保留 trace_id。" },
  DEP_EXTERNAL_UNAVAILABLE: { action: "degrade", clearCredentials: false, retryable: true, severity: "warning", hint: "外部能力暂不可用；系统不会因降级而绕过鉴权、粗化或审核。" },
  INTERNAL_ERROR: { action: "degrade", clearCredentials: false, retryable: true, severity: "error", hint: "服务暂不可用；请保留 trace_id 供联调定位。" },
};

const ACTIONS = {
  request_error: { label: "修正请求", icon: "alert" },
  clear_credentials: { label: "重新登录", icon: "lock" },
  auth_failed: { label: "重新登录", icon: "lock" },
  auth_locked: { label: "稍后重试", icon: "clock" },
  session_lost: { label: "重新登录", icon: "lock" },
  account_exists: { label: "去登录", icon: "user" },
  fix_form: { label: "修正表单", icon: "alert" },
  verify_failed: { label: "重新获取验证码", icon: "refresh" },
  refusal: { label: "无权操作", icon: "shield" },
  refresh_state: { label: "重新拉取状态", icon: "refresh" },
  degrade: { label: "稍后重试", icon: "alert" },
};

export function mapError(code) {
  const domain = typeof code === "string" ? code.split("_")[0] : "INTERNAL";
  const base = DOMAIN_BEHAVIOR[domain] ?? DOMAIN_BEHAVIOR.INTERNAL;
  const behavior = { ...base, ...(OVERRIDES[code] ?? {}) };
  const actionMeta = ACTIONS[behavior.action] ?? ACTIONS.degrade;
  return {
    code,
    domain: ERROR_DOMAINS.includes(domain) ? domain : "INTERNAL",
    action: behavior.action,
    clearCredentials: Boolean(behavior.clearCredentials),
    retryable: Boolean(behavior.retryable),
    refreshState: Boolean(behavior.refreshState),
    severity: behavior.severity ?? "warning",
    hint: behavior.hint,
    actionLabel: actionMeta.label,
    icon: actionMeta.icon,
    isUnknownCode: !DOMAIN_BEHAVIOR[domain],
  };
}

/* ---------------------------- 字典 ---------------------------- */

export function resetDictionary() {
  dict.status = "idle";
  dict.available = false;
  dict.reason = "";
  dict.categories = [];
  dict.sections = [];
  dict.enums = {};
  dict.coarsenDegree = null;
  dict.auditNo = null;
  dict.leaderboardEnabled = false;
  dict.error = null;
}

export async function loadDictionary({ force = false } = {}) {
  if (!force && dict.status === "ready") return dict;
  if (!isActive()) {
    dict.status = "unavailable";
    dict.reason = "未登录：ADM-01 仅运营管理员（R6）/系统管理员（R7）可读取。";
    return dict;
  }
  if (!hasPermission("ADM-01")) {
    dict.status = "unavailable";
    dict.reason = "当前角色没有 ADM-01 权限（CR-001）；界面回退显示枚举 code。";
    return dict;
  }
  dict.status = "loading";
  dict.error = null;
  try {
    const data = await api("ADM-01", { payload: { config_scope: "ALL" } });
    dict.categories = Array.isArray(data.waste_categories) ? data.waste_categories : [];
    dict.sections = Array.isArray(data.sections) ? data.sections : [];
    dict.enums = {};
    for (const entry of data.status_enums ?? []) {
      if (entry && typeof entry.enum_name === "string") {
        dict.enums[entry.enum_name] = Array.isArray(entry.values) ? entry.values : [];
      }
    }
    dict.coarsenDegree = data.coarsen_degree ?? null;
    dict.auditNo = data.map_audit_no ?? null;
    dict.leaderboardEnabled = Boolean(data.leaderboard_enabled);
    dict.available = true;
    dict.status = "ready";
    rememberSections(dict.sections);
    return dict;
  } catch (error) {
    dict.status = "error";
    dict.available = false;
    dict.error = error;
    dict.reason = error instanceof BackendError
      ? `${error.code}：${error.message}`
      : (error?.message || "字典加载失败");
    throw error;
  }
}

export function enumValues(enumName) {
  return dict.enums?.[enumName] ?? [];
}

export function enumLabel(enumName, value) {
  if (value === null || value === undefined || value === "") return { text: "—", isCode: false };
  const found = enumValues(enumName).find((item) => item.value === value);
  if (found) return { text: found.label, isCode: false };
  return { text: String(value), isCode: true };
}

export function roleLabel(role) {
  return enumLabel("role_code", role);
}

export function rememberSections(sections) {
  if (!Array.isArray(sections)) return;
  const seen = new Set(publicSections.items.map((item) => item.section_id));
  for (const item of sections) {
    if (item && typeof item.section_id === "string" && !seen.has(item.section_id)) {
      publicSections.items.push({
        section_id: item.section_id,
        name: item.name ?? item.section_id,
        responsible_org: item.responsible_org ?? null,
      });
      seen.add(item.section_id);
    }
  }
}

export function sectionOptions() {
  return publicSections.items.map((item) => ({
    value: item.section_id,
    label: item.name ? `${item.name}（${item.section_id}）` : item.section_id,
  }));
}

export function orgOptions() {
  const ids = new Set();
  for (const item of dict.sections) {
    if (item.responsible_org) ids.add(item.responsible_org);
  }
  return [...ids].sort().map((id) => ({ value: id, label: id }));
}

/* ---------------------------- 演示辅助数据 ---------------------------- */

export async function loadDemoTargets({ force = false } = {}) {
  if (!force && (demo.status === "ready" || demo.status === "unavailable")) return demo;
  demo.status = "loading";
  demo.error = null;
  try {
    const response = await fetch("/demo/demo_ids.json", { cache: "no-store" });
    if (!response.ok) {
      demo.status = "unavailable";
      demo.data = null;
      return demo;
    }
    const data = await response.json();
    demo.data = data;
    demo.status = "ready";
    return demo;
  } catch (error) {
    demo.status = "error";
    demo.error = error;
    return demo;
  }
}

export function demoTargets(kind) {
  return demo.data?.targets?.[kind] ?? [];
}

/* ---------------------------- 幂等/校验 ---------------------------- */

export function newIdem(prefix) {
  const prefixSafe = String(prefix || "hh").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 24);
  return `${prefixSafe}-${Date.now().toString(36)}-${randomToken()}`.slice(0, 128);
}

export class SubmitIntent {
  constructor(prefix) {
    this.prefix = prefix;
    this.key = newIdem(prefix);
  }

  reset() {
    this.key = newIdem(this.prefix);
    return this.key;
  }
}

export function accountError(value) {
  const text = String(value ?? "").trim();
  if (!text) return "请输入账号";
  if (!/^[A-Za-z0-9_]{4,32}$/.test(text)) return "账号需为 4–32 位字母、数字或下划线";
  return "";
}

export function credentialError(value, { strength = true } = {}) {
  const text = String(value ?? "");
  if (!text) return "请输入凭证";
  if (strength) {
    if (text.length < 8 || text.length > 128) return "凭证长度需为 8–128 个字符";
    if (!/[A-Za-z]/.test(text) || !/\d/.test(text)) return "凭证需同时包含字母与数字";
    if (text.trim() !== text || !text.trim()) return "凭证不能以空白字符开头或结尾";
  } else if (text.length > 128) {
    return "凭证长度不能超过 128 个字符";
  }
  return "";
}

export function verifyTokenError(value) {
  return /^\d{6}$/.test(String(value ?? "")) ? "" : "验证码应为 6 位数字";
}

export function periodError(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return "";
  if (/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(text)) return "";
  return "周期格式应为 YYYY-MM 或 YYYY-Www";
}

export function weightError(value) {
  if (value === "" || value === null || value === undefined) return "请输入清理量（kg）";
  const number = Number(value);
  if (!Number.isFinite(number)) return "清理量必须是数字";
  if (number <= 0) return "清理量必须大于 0 kg";
  if (number > 1000000) return "清理量不能超过 1,000,000 kg";
  if (!/^\d+(\.\d{1,3})?$/.test(String(value).trim())) return "清理量最多保留 3 位小数";
  return "";
}

export function ratingError(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5 ? "" : "评分必须为 1–5 的整数";
}

export function contentError(value) {
  const length = [...String(value ?? "")].length;
  if (length < 1) return "请填写评价内容";
  if (length > 500) return "评价内容不能超过 500 字";
  return "";
}

export function commentError(value, result) {
  const length = [...String(value ?? "")].length;
  if (length > 1000) return "审核意见不能超过 1000 字";
  if ((result === "REJECTED" || result === "RETURNED") && !String(value ?? "").trim()) {
    return "不通过或退回时必须填写审核意见";
  }
  return "";
}

export function opaqueIdError(value, label = "编号") {
  const text = String(value ?? "").trim();
  if (!text) return `请填写${label}`;
  if (text.length > 64) return `${label}不能超过 64 个字符`;
  return "";
}

export const MEDIA_LIMITS = {
  "image/jpeg": { type: "IMAGE_JPEG", limit: 10 * 1024 * 1024, label: "JPEG 图片" },
  "image/png": { type: "IMAGE_PNG", limit: 10 * 1024 * 1024, label: "PNG 图片" },
  "video/mp4": { type: "VIDEO_MP4", limit: 100 * 1024 * 1024, label: "MP4 视频" },
};

export function fileError(file) {
  if (!file) return "请选择文件";
  const meta = MEDIA_LIMITS[file.type];
  if (!meta) return "仅支持 JPEG、PNG 或 MP4 文件";
  if (file.size <= 0) return "文件为空";
  if (file.size > meta.limit) return `${meta.label} 不能超过 ${formatBytes(meta.limit)}`;
  return "";
}

export function mediaTypeFor(file) {
  return MEDIA_LIMITS[file?.type]?.type ?? null;
}

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------------------- 展示格式 ---------------------------- */

export function formatNumber(value, maxDigits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: maxDigits }).format(value);
}

export function formatKg(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 3)} kg`;
}

export function formatCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return formatNumber(value, 0);
}

export function formatTimeUtc(value) {
  if (typeof value !== "string" || !value) return "—";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})Z$/);
  if (!match) return value;
  return `${match[1]} ${match[2]} UTC`;
}

export function formatPeriod(period) {
  if (typeof period !== "string") return "—";
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split("-");
    return `${year} 年 ${Number(month)} 月`;
  }
  if (/^\d{4}-W\d{2}$/.test(period)) return `${period.slice(0, 4)} 年第 ${period.slice(6)} 周`;
  return period;
}

export function currentPeriodMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function pageCount(total, pageSize) {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_TONES = {
  report_status: { SUBMITTED: "info", UNDER_REVIEW: "warning", APPROVED: "good", REJECTED: "critical", RETURNED: "serious" },
  review_status: { PENDING: "warning", IN_PROGRESS: "info", APPROVED: "good", REJECTED: "critical", RETURNED: "serious" },
  work_order_status: { PENDING_DISPATCH: "warning", DISPATCHED: "info", CLOSED: "good", CANCELLED: "neutral" },
  progress_stage: { SUBMITTED: "info", IN_PROGRESS: "warning", COMPLETED: "good" },
  session_status: { ACTIVE: "good", EXPIRED: "warning", REVOKED: "critical" },
  account_status: { ACTIVE: "good", DISABLED: "neutral" },
  media_status: { RESERVED: "warning", UPLOADED: "good", REJECTED: "critical" },
};

export function statusTone(enumName, value) {
  return STATUS_TONES[enumName]?.[value] ?? "neutral";
}

export function heatClass(heatValue) {
  if (typeof heatValue !== "number" || !Number.isFinite(heatValue) || heatValue <= 0) return "heat-0";
  if (heatValue <= 2) return "heat-low";
  if (heatValue <= 5) return "heat-mid";
  return "heat-high";
}

export const HEAT_BINS = [
  { className: "heat-0", label: "0", range: "0" },
  { className: "heat-low", label: "1–2", range: "1–2" },
  { className: "heat-mid", label: "3–5", range: "3–5" },
  { className: "heat-high", label: "6+", range: "6+" },
];

export const PROGRESS_ORDER = ["SUBMITTED", "IN_PROGRESS", "COMPLETED"];

export function progressIndex(stage) {
  const index = PROGRESS_ORDER.indexOf(stage);
  return index < 0 ? -1 : index;
}

export function display(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function traceOrDash(value) {
  return value || "—";
}
