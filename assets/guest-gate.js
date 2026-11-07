// 首次访问登录闸门：游客登录 / 账号登录 / 注册账号。
// 闸门只承载登录相关操作，不提供任何站内页面入口；
// 准入成功后的路由恢复与内容渲染由 app.js 统一处理。

import {
  accountError,
  credentialError,
  demo,
  loadDemoTargets,
  login,
  register,
  toast,
  verifyTokenError,
} from "./lib.js";
import { SITE } from "./content.js";

const { computed, nextTick, onMounted, reactive, ref, watch } = Vue;

const MODE_COPY = {
  guest: {
    title: "游客登录",
    desc: "无需注册账号。完成游客登录后即可进入黄河戍境，浏览公开地图、科普与成效公示。",
  },
  login: {
    title: "账号登录",
    desc: "使用已有账号登录，可提交上报并查看「我的参与」；登录状态仅保存在当前标签页。",
  },
  register: {
    title: "注册账号",
    desc: "注册公众账号后即可提交上报、查看进度；角色与权限以系统返回为准。",
  },
};

export const GuestGate = {
  name: "GuestGate",
  props: {
    // checking：正在校验已有真实会话；locked：必须完成登录后才能进入站点。
    state: { type: String, default: "locked" },
  },
  emits: ["guest"],
  setup(props) {
    const mode = ref("guest"); // guest | login | register
    const card = ref(null);
    const guestPrimary = ref(null);
    const loginAccount = ref(null);
    const registerAccount = ref(null);
    const account = ref("");
    const credential = ref("");
    const confirm = ref("");
    const verifyToken = ref("");
    const agreement = ref(false);
    const showCredential = ref(false);
    const loading = ref(false);
    const error = ref(null);
    const success = ref("");
    const local = reactive({});

    const copy = computed(() => MODE_COPY[mode.value]);
    const demoPassword = computed(() => demo.data?.demo_password || "Demo#Pass2026");
    const demoAccounts = computed(() => (demo.data?.accounts ?? []).filter((item) => item.account_id !== "auditor"));

    onMounted(() => { loadDemoTargets(); });

    function clearLocal() {
      for (const key of Object.keys(local)) delete local[key];
    }

    function resetFeedback() {
      error.value = null;
      success.value = "";
      clearLocal();
    }

    function focusPrimary() {
      if (props.state !== "locked") return;
      const target = mode.value === "guest"
        ? guestPrimary.value
        : (mode.value === "login" ? loginAccount.value : registerAccount.value);
      target?.focus?.();
    }

    function switchMode(next) {
      if (loading.value || mode.value === next) return;
      mode.value = next;
      resetFeedback();
    }

    // 登录成功会立即把 session 置为 active，闸门组件可能先于后续代码被卸载；
    // 因此用全局事件通知 App 恢复首页路由，避免依赖已卸载组件的 emit。
    function notifyAuthenticated(data) {
      window.dispatchEvent(new CustomEvent("hh:gate-authenticated", {
        detail: { account_id: data?.account_profile?.account_id ?? "" },
      }));
    }

    function useDemo(accountId) {
      account.value = accountId;
      credential.value = demoPassword.value;
      confirm.value = demoPassword.value;
      clearLocal();
      toast(`已填入演示账号 ${accountId}`, { tone: "info" });
    }

    async function submitLogin() {
      resetFeedback();
      local.account_id = accountError(account.value);
      local.credential = credentialError(credential.value, { strength: false });
      if (local.account_id || local.credential) return;
      loading.value = true;
      try {
        const data = await login(account.value.trim(), credential.value);
        toast(`登录成功：${data.account_profile?.account_id ?? account.value}`, { tone: "success" });
        notifyAuthenticated(data);
      } catch (err) {
        error.value = err;
      } finally {
        loading.value = false;
      }
    }

    async function submitRegister() {
      resetFeedback();
      local.account_id = accountError(account.value);
      local.credential = credentialError(credential.value, { strength: true });
      local.confirm = confirm.value !== credential.value ? "两次输入的凭证不一致" : "";
      local.verify_token = verifyTokenError(verifyToken.value);
      local.agreement = agreement.value ? "" : "必须先同意用户协议";
      if (Object.values(local).some(Boolean)) return;

      loading.value = true;
      let registered = false;
      try {
        const data = await register({
          account_id: account.value.trim(),
          credential: credential.value,
          verify_token: verifyToken.value,
          agreement_accepted: true,
        });
        registered = true;
        const accountId = data.account_id ?? account.value.trim();
        toast(`注册成功：${accountId}，正在登录…`, { tone: "success" });
        // 注册接口不签发会话；注册成功后立即用同一凭证登录，避免重复输入。
        const auth = await login(accountId, credential.value);
        toast(`已登录：${auth.account_profile?.account_id ?? accountId}`, { tone: "success" });
        notifyAuthenticated(auth);
      } catch (err) {
        error.value = err;
        if (registered) {
          // 注册已成功、仅自动登录失败：保留账号与凭证，切到账号登录。
          success.value = `注册成功：${account.value.trim()}。自动登录未完成，请使用刚设置的凭证登录。`;
          mode.value = "login";
          clearLocal();
        }
      } finally {
        loading.value = false;
      }
    }

    function retry() {
      if (mode.value === "register") submitRegister();
      else if (mode.value === "login") submitLogin();
    }

    // 闸门不可关闭：Esc 不生效，Tab 焦点始终限制在登录卡片内。
    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      const root = card.value;
      if (!root) return;
      const focusables = [...root.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    watch([() => props.state, mode], () => {
      if (props.state === "locked") nextTick(focusPrimary);
    }, { immediate: true });

    return {
      SITE, mode, copy, card, guestPrimary, loginAccount, registerAccount,
      account, credential, confirm, verifyToken, agreement, showCredential,
      loading, error, success, local, demoAccounts, demoPassword,
      switchMode, useDemo, submitLogin, submitRegister, retry, onKeydown,
    };
  },
  template: `
    <div class="guest-gate" role="dialog" aria-modal="true" aria-label="登录黄河戍境" @keydown="onKeydown">
      <div class="guest-gate-scene" aria-hidden="true">
        <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <path class="river-line" d="M-80 720C220 560 420 760 760 600S1160 380 1520 520" />
          <path class="river-line river-line-2" d="M-60 240C240 140 460 340 800 220S1200 80 1520 200" />
          <path class="river-line river-line-3" d="M-120 860C260 740 480 940 900 760" />
        </svg>
      </div>

      <div ref="card" class="guest-gate-card">
        <div class="guest-gate-brand">
          <img src="assets/img/logo-mark.png" alt="" class="guest-gate-logo" />
          <span class="guest-gate-brand-copy">
            <strong>{{ SITE.brand }}</strong>
            <span>黄河上游岸线垃圾治理参与平台</span>
          </span>
        </div>

        <div v-if="state === 'checking'" class="guest-gate-checking" role="status">
          <span class="guest-gate-spinner" aria-hidden="true"></span>
          <p>正在校验登录状态…</p>
          <p class="guest-gate-muted">校验完成后将自动进入站点。</p>
        </div>

        <template v-else>
          <div class="guest-gate-copy">
            <p class="eyebrow">首次访问 · 身份验证</p>
            <h1 id="guest-gate-title" class="guest-gate-title">{{ copy.title }}</h1>
            <p class="guest-gate-desc">{{ copy.desc }}</p>
          </div>

          <div class="guest-gate-tabs" role="tablist" aria-label="登录方式">
            <button class="guest-gate-tab" :class="{ 'is-active': mode === 'guest' }" type="button" role="tab"
              :aria-selected="mode === 'guest' ? 'true' : 'false'" @click="switchMode('guest')">游客登录</button>
            <button class="guest-gate-tab" :class="{ 'is-active': mode === 'login' }" type="button" role="tab"
              :aria-selected="mode === 'login' ? 'true' : 'false'" @click="switchMode('login')">账号登录</button>
            <button class="guest-gate-tab" :class="{ 'is-active': mode === 'register' }" type="button" role="tab"
              :aria-selected="mode === 'register' ? 'true' : 'false'" @click="switchMode('register')">注册账号</button>
          </div>

          <div v-if="success" class="notice notice-good" role="status">
            <Icon name="check" :size="17" />
            <div class="notice-body"><div class="notice-text">{{ success }}</div></div>
          </div>

          <div v-if="error" class="guest-gate-error">
            <ErrorPanel :error="error" @retry="retry" @login="switchMode('login')" />
          </div>

          <div v-if="mode === 'guest'" class="guest-gate-panel" role="tabpanel" aria-label="游客登录">
            <ul class="guest-gate-points">
              <li><Icon name="eye" :size="16" />浏览公开的地图、科普、行动与公示内容</li>
              <li><Icon name="clock" :size="16" />登录状态仅保留在当前标签页，关闭标签页后失效</li>
              <li><Icon name="lock" :size="16" />未完成登录前，站内页面与地址跳转均不可用</li>
            </ul>
            <button ref="guestPrimary" class="btn btn-primary guest-gate-submit" type="button" @click="$emit('guest')">
              <Icon name="user" :size="17" />游客登录
            </button>
            <p class="guest-gate-note">游客身份不授予上报、审核等操作权限；提交上报需使用公众账号登录。</p>
          </div>

          <form v-else-if="mode === 'login'" class="auth-form guest-gate-form" role="tabpanel" aria-label="账号登录" novalidate @submit.prevent="submitLogin">
            <label class="field">
              <span class="field-label">账号<span class="req">*</span></span>
              <input ref="loginAccount" v-model="account" class="input" autocomplete="username" maxlength="32"
                placeholder="4–32 位字母、数字或下划线" :aria-invalid="local.account_id ? 'true' : null" />
              <FieldError :message="local.account_id" />
            </label>
            <label class="field">
              <span class="field-label">密码<span class="req">*</span></span>
              <div class="input-with-action">
                <input v-model="credential" class="input" :type="showCredential ? 'text' : 'password'"
                  autocomplete="current-password" maxlength="128" :aria-invalid="local.credential ? 'true' : null" />
                <button class="btn btn-ghost btn-icon" type="button" :aria-label="showCredential ? '隐藏密码' : '显示密码'" @click="showCredential = !showCredential">
                  <Icon :name="showCredential ? 'eyeOff' : 'eye'" :size="17" />
                </button>
              </div>
              <FieldError :message="local.credential" />
            </label>
            <button class="btn btn-primary guest-gate-submit" type="submit" :disabled="loading">
              <Icon name="lock" :size="16" />{{ loading ? '登录中…' : '登录' }}
            </button>
            <p class="guest-gate-note">还没有账号？<button class="btn btn-link guest-gate-inline-link" type="button" @click="switchMode('register')">注册账号</button></p>

            <details v-if="demoAccounts.length" class="guest-gate-demo">
              <summary>演示账号（仅本地）</summary>
              <p class="guest-gate-tip">统一口令 <code>{{ demoPassword }}</code>；点击账号即可填入。</p>
              <div class="guest-gate-demo-grid">
                <button v-for="item in demoAccounts" :key="item.account_id" class="guest-gate-demo-chip" type="button" @click="useDemo(item.account_id)">
                  <strong>{{ item.account_id }}</strong>
                  <span>{{ (item.roles || []).join(' / ') }}</span>
                </button>
              </div>
            </details>
          </form>

          <form v-else class="auth-form guest-gate-form" role="tabpanel" aria-label="注册账号" novalidate @submit.prevent="submitRegister">
            <div class="guest-gate-field-row">
              <div class="field">
                <span class="field-label">账号<span class="req">*</span></span>
                <input ref="registerAccount" v-model="account" class="input" autocomplete="username" maxlength="32"
                  placeholder="4–32 位字母、数字或下划线" :aria-invalid="local.account_id ? 'true' : null" />
                <FieldError :message="local.account_id" />
              </div>
              <div class="field">
                <span class="field-label">验证码<span class="req">*</span></span>
                <input v-model="verifyToken" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                  placeholder="6 位数字" :aria-invalid="local.verify_token ? 'true' : null" />
                <FieldError :message="local.verify_token" />
              </div>
            </div>
            <div class="guest-gate-field-row">
              <div class="field">
                <span class="field-label">密码<span class="req">*</span></span>
                <input v-model="credential" class="input" type="password" autocomplete="new-password" maxlength="128"
                  placeholder="8–128 位，含字母与数字" :aria-invalid="local.credential ? 'true' : null" />
                <FieldError :message="local.credential" />
              </div>
              <div class="field">
                <span class="field-label">确认密码<span class="req">*</span></span>
                <input v-model="confirm" class="input" type="password" autocomplete="new-password" maxlength="128"
                  :aria-invalid="local.confirm ? 'true' : null" />
                <FieldError :message="local.confirm" />
              </div>
            </div>
            <label class="check-row">
              <input v-model="agreement" type="checkbox" />
              <span>我已阅读并同意用户协议与隐私说明<span class="req">*</span></span>
            </label>
            <FieldError :message="local.agreement" />
            <button class="btn btn-primary guest-gate-submit" type="submit" :disabled="loading">
              <Icon name="user" :size="16" />{{ loading ? '注册中…' : '注册并登录' }}
            </button>
            <p class="guest-gate-note">已有账号？<button class="btn btn-link guest-gate-inline-link" type="button" @click="switchMode('login')">返回登录</button></p>
            <p class="guest-gate-tip">演示环境验证码：在终端运行 <code>python tools/issue_verify_token.py --account-id 账号</code> 获取 6 位数字。</p>
          </form>
        </template>
      </div>
    </div>
  `,
};
