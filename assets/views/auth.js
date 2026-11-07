// F1 认证与账户：登录、注册、登出入口、会话态展示。
// 凭证只放 sessionStorage；校验失败显示后端 code/message/trace_id。

import {
  accountError,
  credentialError,
  demo,
  loadDemoTargets,
  register,
  login,
  session,
  toast,
  verifyTokenError,
  roleLabel,
} from "../lib.js";

const { computed, onMounted, reactive, ref, watch } = Vue;

export const AuthView = {
  name: "AuthView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const isRegister = computed(() => props.route.query.mode === "register");
    const isRecover = computed(() => props.route.query.mode === "recover");
    const account = ref("");
    const credential = ref("");
    const confirm = ref("");
    const verifyToken = ref("");
    const agreement = ref(false);
    const showCredential = ref(false);
    const loading = ref(false);
    const error = ref(null);
    const local = reactive({});
    const success = ref(null);
    const demoPassword = computed(() => demo.data?.demo_password || "Demo#Pass2026");
    const demoAccounts = computed(() => (demo.data?.accounts ?? []).filter((item) => item.account_id !== "auditor"));

    onMounted(() => { loadDemoTargets(); });
    watch(() => props.route.query.mode, () => {
      error.value = null;
      success.value = null;
      clearLocal();
    });

    function clearLocal() {
      for (const key of Object.keys(local)) delete local[key];
    }

    function useDemo(accountId) {
      account.value = accountId;
      credential.value = demoPassword.value;
      confirm.value = demoPassword.value;
      toast(`已填入演示账号 ${accountId}`, { tone: "info" });
    }

    async function submitLogin() {
      clearLocal();
      error.value = null;
      local.account_id = accountError(account.value);
      local.credential = credentialError(credential.value, { strength: false });
      if (local.account_id || local.credential) return;
      loading.value = true;
      try {
        const data = await login(account.value.trim(), credential.value);
        toast(`登录成功：${data.account_profile?.account_id ?? account.value}`, { tone: "success" });
        const returnTo = props.route.query.returnTo;
        props.navigate(returnTo && returnTo.startsWith("/") ? returnTo : "/");
      } catch (err) {
        error.value = err;
      } finally {
        loading.value = false;
      }
    }

    async function submitRegister() {
      clearLocal();
      error.value = null;
      success.value = null;
      local.account_id = accountError(account.value);
      local.credential = credentialError(credential.value, { strength: true });
      local.confirm = confirm.value !== credential.value ? "两次输入的凭证不一致" : "";
      local.verify_token = verifyTokenError(verifyToken.value);
      local.agreement = agreement.value ? "" : "必须先同意用户协议";
      if (Object.values(local).some(Boolean)) return;
      loading.value = true;
      try {
        const data = await register({
          account_id: account.value.trim(),
          credential: credential.value,
          verify_token: verifyToken.value,
          agreement_accepted: true,
        });
        success.value = data;
        toast("注册成功", { tone: "success" });
      } catch (err) {
        error.value = err;
      } finally {
        loading.value = false;
      }
    }

    function retry() {
      if (isRegister.value) submitRegister(); else submitLogin();
    }

    return {
      isRegister, isRecover, account, credential, confirm, verifyToken, agreement, showCredential,
      loading, error, local, success, demoAccounts, demoPassword,
      submitLogin, submitRegister, useDemo, retry, roleLabel, session,
    };
  },
  template: `
    <section class="auth-page page-shell">
      <aside class="auth-aside">
        <div class="auth-aside-pattern" aria-hidden="true">
          <svg viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice">
            <path class="river-line" d="M-40 680C160 560 220 720 390 610S620 420 860 520" />
            <path class="river-line river-line-2" d="M-20 250C150 160 300 310 470 220S700 120 860 210" />
            <path class="river-line river-line-3" d="M-60 800C180 700 260 860 520 720" />
          </svg>
        </div>
        <div class="auth-aside-copy">
          <img src="assets/img/logo-mark.png" alt="" class="auth-aside-logo" />
          <div class="eyebrow">黄河戍境 · 公众参与</div>
          <p class="auth-brand">黄河戍境<br />让岸线被看见</p>
          <p class="auth-lead">拍—派—清—晒。一次简单的上报，连接一次真实的清理行动。</p>
          <ul class="auth-points">
            <li><Icon name="pin" :size="16" />匿名也能先看地图、读公示、预览上报流程</li>
            <li><Icon name="shield" :size="16" />审核通过才进入公开统计；每个数字都带口径</li>
            <li><Icon name="leaf" :size="16" />空白表示暂无公开记录，不代表干净</li>
          </ul>
          <p class="auth-aside-note">演示／试点站点。示例内容与演示数据需人工审核；正式上线前须完成运营主体、审图号与隐私配置。</p>
        </div>
      </aside>

      <div class="auth-main">
        <div class="auth-card">
          <div class="auth-card-head">
            <h1 class="auth-card-title">{{ isRegister ? '注册公众账号' : '登录' }}</h1>
            <p class="auth-card-desc">
              {{ isRegister ? '注册后可以提交上报、查看进度；角色与权限以系统返回为准。' : '登录后可以提交上报、查看进度；会话仅保存在本标签页。' }}
            </p>
          </div>

          <div v-if="session.status === 'active' && !isRegister" class="notice notice-info">
            <Icon name="user" :size="18" />
            <div class="notice-body">
              <div class="notice-title">当前已登录：{{ session.profile?.account_id }}</div>
              <div class="notice-text">角色 {{ (session.roles || []).map(r => roleLabel(r).text).join(' / ') || '—' }}。可继续切换账号，或前往个人中心。</div>
            </div>
            <div class="notice-actions">
              <button class="btn btn-secondary btn-sm" type="button" @click="navigate('/profile')">个人中心</button>
            </div>
          </div>

          <template v-if="!isRegister && !isRecover">
            <form class="auth-form" novalidate @submit.prevent="submitLogin">
              <label class="field">
                <span class="field-label">账号<span class="req">*</span></span>
                <input v-model="account" class="input" autocomplete="username" maxlength="32" placeholder="4–32 位字母、数字或下划线" :aria-invalid="local.account_id ? 'true' : null" />
                <FieldError :message="local.account_id" />
              </label>
              <label class="field">
                <span class="field-label">密码<span class="req">*</span></span>
                <div class="input-with-action">
                  <input v-model="credential" class="input" :type="showCredential ? 'text' : 'password'" autocomplete="current-password" maxlength="128" :aria-invalid="local.credential ? 'true' : null" />
                  <button class="btn btn-ghost btn-icon" type="button" :aria-label="showCredential ? '隐藏凭证' : '显示凭证'" @click="showCredential = !showCredential">
                    <Icon :name="showCredential ? 'eyeOff' : 'eye'" :size="17" />
                  </button>
                </div>
                <FieldError :message="local.credential" />
              </label>
              <div class="form-actions">
                <button class="btn btn-primary" type="submit" :disabled="loading">
                  <Icon name="lock" :size="16" />{{ loading ? '登录中…' : '登录' }}
                </button>
                <button class="btn btn-link" type="button" @click="navigate('/auth?mode=register')">注册账号</button>
              </div>
            </form>
            <div class="auth-links">
              <button class="btn btn-link" type="button" @click="navigate('/auth?mode=recover')">忘记凭证？</button>
              <span class="muted">凭证找回暂未开放；如需帮助，请联系运营方（联系方式待配置）。</span>
            </div>
          </template>

          <template v-else-if="isRecover">
            <StatePanel title="凭证找回入口" tone="blocked" icon-name="lock"
              description="凭证找回暂未开放。演示阶段可使用演示账号；正式上线后的找回方式以运营方配置为准。">
              <template #actions><button class="btn btn-secondary btn-sm" type="button" @click="navigate('/auth?mode=login')">返回登录</button></template>
            </StatePanel>
          </template>

          <template v-else>
            <form class="auth-form" novalidate @submit.prevent="submitRegister">
              <div class="form-grid">
                <label class="field">
                  <span class="field-label">账号<span class="req">*</span></span>
                  <input v-model="account" class="input" autocomplete="username" maxlength="32" placeholder="4–32 位字母、数字或下划线" :aria-invalid="local.account_id ? 'true' : null" />
                  <FieldError :message="local.account_id" />
                </label>
                <label class="field">
                  <span class="field-label">验证码<span class="req">*</span></span>
                  <input v-model="verifyToken" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位数字" :aria-invalid="local.verify_token ? 'true' : null" />
                  <FieldError :message="local.verify_token" />
                </label>
              </div>
              <label class="field">
                <span class="field-label">密码<span class="req">*</span></span>
                <input v-model="credential" class="input" type="password" autocomplete="new-password" maxlength="128" placeholder="8–128 位，至少包含字母与数字" :aria-invalid="local.credential ? 'true' : null" />
                <FieldError :message="local.credential" />
              </label>
              <label class="field">
                <span class="field-label">确认密码<span class="req">*</span></span>
                <input v-model="confirm" class="input" type="password" autocomplete="new-password" maxlength="128" :aria-invalid="local.confirm ? 'true' : null" />
                <FieldError :message="local.confirm" />
              </label>
              <label class="check-row">
                <input v-model="agreement" type="checkbox" />
                <span>我已阅读并同意用户协议与隐私说明<span class="req">*</span></span>
              </label>
              <FieldError :message="local.agreement" />
              <div class="form-actions">
                <button class="btn btn-primary" type="submit" :disabled="loading">
                  <Icon name="user" :size="16" />{{ loading ? '提交中…' : '注册' }}
                </button>
                <button class="btn btn-link" type="button" @click="navigate('/auth?mode=login')">返回登录</button>
              </div>
            </form>
            <div class="notice notice-info">
              <Icon name="key" :size="18" />
              <div class="notice-body">
                <div class="notice-title">演示验证码（仅本地）</div>
                <div class="notice-text">演示环境的验证码由本地工具签发。请在终端运行 <code>python tools/issue_verify_token.py --account-id 账号</code>，再填入 6 位验证码。</div>
              </div>
            </div>
          </template>

          <div v-if="error" class="form-api-slot"><ErrorPanel :error="error" @retry="retry" @login="navigate('/auth?mode=login')" /></div>

          <div v-if="success" class="success-panel">
            <div class="success-icon"><Icon name="check" :size="22" /></div>
            <div class="success-copy">
              <h3>注册成功</h3>
              <p class="muted">账号 {{ success.account_id }} · 状态 {{ success.account_status }} · 默认角色 {{ roleLabel(success.default_role).text }}</p>
              <p class="muted">注册不返回会话，请使用新账号登录。</p>
            </div>
            <div class="success-actions">
              <button class="btn btn-primary btn-sm" type="button" @click="navigate('/auth?mode=login')">去登录</button>
            </div>
          </div>

          <div class="auth-foot">
            <span class="muted">演示环境 · 会话保存在本标签页</span>
            <button class="btn btn-link" type="button" @click="navigate('/')">返回首页</button>
          </div>
        </div>

        <div v-if="demoAccounts.length" class="demo-card card">
          <div class="card-body">
            <div class="chip-row"><strong>演示账号</strong><span class="badge badge-neutral">仅本地演示</span></div>
            <p class="muted">演示口令统一为 <code>{{ demoPassword }}</code>；不同账号演示不同角色。R1 公众账号使用通用选项即可完成上报预览。</p>
            <div class="demo-account-grid">
              <button v-for="item in demoAccounts" :key="item.account_id" class="demo-account" type="button" @click="useDemo(item.account_id)">
                <span class="demo-account-id">{{ item.account_id }}</span>
                <span class="muted">{{ (item.roles || []).join(' / ') }}<template v-if="item.org_ids?.length"> · {{ item.org_ids.join(' / ') }}</template></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
};
