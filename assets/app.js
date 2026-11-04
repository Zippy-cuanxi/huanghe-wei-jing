// Vue3 单页应用：路由、会话引导、导航、主题、全局错误处理。
// 页面组件只消费契约字段；后端是状态与权限的唯一权威。

import {
  clearAuth,
  hasPermission,
  loadDictionary,
  logout,
  refreshSession,
  roleLabel,
  session,
  toast,
} from "./lib.js";
import {
  Icon, ToastHost, AppBadge, AuditBadge, LoadingBlock, StatePanel, ErrorPanel,
  SectionCard, PageHeader, Pager, ProgressSteps, HeatLegend, CopyCode, Modal,
  StatusBadge, FieldError, HeatCell, KgCell,
} from "./components.js";
import { AuthView } from "./views/auth.js";
import { MapView } from "./views/map.js";
import { PublicityView } from "./views/publicity.js";
import { KnowledgeView } from "./views/knowledge.js";
import { ReportView } from "./views/report.js";
import { ProfileView } from "./views/profile.js";
import { AdminView } from "./views/admin.js";
import { NotFoundView } from "./views/notfound.js";

const { computed, nextTick, onMounted, reactive, ref, watch } = Vue;

const VIEWS = {
  "/map": MapView,
  "/knowledge": KnowledgeView,
  "/publicity": PublicityView,
  "/report": ReportView,
  "/profile": ProfileView,
  "/admin": AdminView,
  "/auth": AuthView,
};

const route = reactive({ path: "/map", query: {} });

function parseHash() {
  const raw = (window.location.hash || "#/map").slice(1) || "/map";
  const [path, qs = ""] = raw.split("?");
  route.path = path || "/map";
  route.query = Object.fromEntries(new URLSearchParams(qs));
}

function navigate(to) {
  const target = to.startsWith("#") ? to.slice(1) : to;
  const next = `#${target}`;
  if (window.location.hash === next) {
    parseHash();
    // 同一地址重复点击时仍刷新一次视图状态。
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = next;
}

const TITLES = {
  "/map": "垃圾地图",
  "/knowledge": "垃圾分类科普",
  "/publicity": "成效公示",
  "/report": "随手拍上报",
  "/profile": "个人中心",
  "/admin": "运营后台",
  "/auth": "登录 / 注册",
};

const App = {
  name: "App",
  setup() {
    const theme = ref(document.documentElement.dataset.theme || "light");
    const navOpen = ref(false);
    const logoutBusy = ref(false);
    const logoutError = ref(null);
    const bootError = ref(null);

    const view = computed(() => VIEWS[route.path] || NotFoundView);
    const isActive = (path) => route.path === path;
    const isAdmin = computed(() => session.status === "active" && (
      hasPermission("REV-01") || hasPermission("WO-01") || hasPermission("WO-02") || hasPermission("ADM-01")
    ));
    const navItems = computed(() => [
      { path: "/map", label: "垃圾地图", icon: "map", show: true },
      { path: "/knowledge", label: "分类科普", icon: "book", show: true },
      { path: "/publicity", label: "成效公示", icon: "chart", show: true },
      { path: "/report", label: "随手拍", icon: "camera", show: session.status === "active" && hasPermission("RPT-01") },
      { path: "/profile", label: "个人中心", icon: "user", show: session.status === "active" && hasPermission("RPT-02") },
      { path: "/admin", label: "运营后台", icon: "settings", show: isAdmin.value },
    ].filter((item) => item.show));
    const isAuthed = computed(() => session.status === "active");
    const roleText = computed(() => (session.roles || []).map((role) => roleLabel(role).text).join(" / ") || "—");

    function toggleTheme() {
      theme.value = theme.value === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme.value;
      try { localStorage.setItem("hh.theme", theme.value); } catch { /* progressive enhancement */ }
    }

    function go(path) {
      navOpen.value = false;
      navigate(path);
    }

    async function doLogout(scope = "CURRENT") {
      logoutBusy.value = true;
      logoutError.value = null;
      try {
        await logout(scope);
        toast("已退出登录", { tone: "success" });
        go("/map");
      } catch (error) {
        logoutError.value = error;
        const isAuth = error?.behavior?.domain === "AUTH";
        if (isAuth) {
          toast("会话已失效，已回到匿名态", { tone: "warning" });
          go("/map");
        } else {
          toast("登出请求未完成；本地凭证仍保留", { tone: "error", traceId: error?.traceId });
        }
      } finally {
        logoutBusy.value = false;
      }
    }

    function localClear() {
      clearAuth();
      logoutError.value = null;
      toast("已仅清理本地凭证；服务端会话可能仍有效", { tone: "warning" });
      go("/map");
    }

    function loginLink() {
      const returnTo = route.path === "/auth" ? "/map" : route.path;
      navigate(`/auth?mode=login&returnTo=${encodeURIComponent(returnTo)}`);
    }

    function registerLink() {
      navigate("/auth?mode=register");
    }

    function updateTitle() {
      const label = TITLES[route.path] || "页面不存在";
      document.title = `${label} · 黄河垃圾热力地图`;
    }

    function focusMain() {
      nextTick(() => {
        const heading = document.querySelector("main h1");
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        }
        window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
      });
    }

    function onHashChange() {
      parseHash();
      navOpen.value = false;
      updateTitle();
      focusMain();
    }

    function onAuthCleared() {
      if (route.path === "/auth") return;
      toast("登录状态已失效，请重新登录", { tone: "warning" });
      const returnTo = route.path;
      navigate(`/auth?mode=login&returnTo=${encodeURIComponent(returnTo)}`);
    }

    onMounted(async () => {
      parseHash();
      updateTitle();
      window.addEventListener("hashchange", onHashChange);
      window.addEventListener("hh:auth-cleared", onAuthCleared);
      try {
        if (session.handle) {
          await refreshSession();
          if (session.status === "active" && hasPermission("ADM-01")) {
            await loadDictionary().catch(() => {});
          }
        } else {
          session.status = "anonymous";
        }
      } catch (error) {
        // AUTH_* 已由客户端清理；DEP/INTERNAL 保留提示，不伪装登录成功。
        if (error?.behavior?.domain !== "AUTH") {
          bootError.value = error;
          toast("会话恢复失败；可稍后重试", { tone: "warning", traceId: error?.traceId });
        }
      }
    });

    watch(() => route.path, updateTitle);

    return {
      route, view, isActive, navItems, session, isAuthed, roleText, theme, navOpen,
      logoutBusy, logoutError, bootError,
      go, navigate, toggleTheme, doLogout, localClear, loginLink, registerLink, updateTitle,
    };
  },
  template: `
    <a class="skip-link" href="#main">跳到主内容</a>
    <header class="site-header" :class="{ 'nav-open': navOpen }">
      <div class="header-inner">
        <a class="brand" href="#/map" @click.prevent="go('/map')">
          <span class="brand-mark"><Icon name="map" :size="22" /></span>
          <span class="brand-copy"><span class="brand-title">黄河垃圾热力地图</span><span class="brand-sub">拍 · 派 · 清 · 晒</span></span>
        </a>
        <nav class="primary-nav" aria-label="主导航">
          <a v-for="item in navItems" :key="item.path" class="nav-link" :class="{ 'is-active': isActive(item.path) }" :href="'#' + item.path" @click.prevent="go(item.path)">
            <Icon :name="item.icon" :size="16" />{{ item.label }}
          </a>
        </nav>
        <div class="header-tools">
          <button class="btn btn-ghost btn-icon" type="button" aria-label="打开导航" @click="navOpen = !navOpen"><Icon :name="navOpen ? 'close' : 'menu'" :size="20" /></button>
        </div>
        <div class="header-right">
          <button class="btn btn-ghost btn-icon" type="button" :aria-label="theme === 'dark' ? '切换为浅色' : '切换为深色'" @click="toggleTheme">
            <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" />
          </button>
          <template v-if="isAuthed">
            <details class="session-menu">
              <summary class="session-summary">
                <span class="avatar"><Icon name="user" :size="16" /></span>
                <span class="session-copy"><span class="session-account">{{ session.profile?.account_id }}</span><span class="session-role">{{ roleText }}</span></span>
                <Icon name="chevronDown" :size="14" />
              </summary>
              <div class="session-popover">
                <div class="session-popover-head">
                  <div><strong>{{ session.profile?.account_id }}</strong><div class="muted">{{ session.profile?.account_status }} · {{ roleText }}</div></div>
                  <AppBadge label="已登录" tone="good" icon-name="check" />
                </div>
                <dl class="def-list compact">
                  <dt>会话到期</dt><dd>{{ session.expiresAt || '—' }}</dd>
                  <dt>权限项</dt><dd>{{ (session.permissions || []).length }} 项（仅界面裁剪）</dd>
                </dl>
                <div class="session-popover-actions">
                  <button class="btn btn-ghost btn-sm" type="button" @click="go('/profile')"><Icon name="user" :size="15" />个人中心</button>
                  <button class="btn btn-ghost btn-sm" type="button" :disabled="logoutBusy" @click="doLogout('CURRENT')"><Icon name="logout" :size="15" />{{ logoutBusy ? '登出中…' : '退出当前会话' }}</button>
                  <button class="btn btn-ghost btn-sm" type="button" :disabled="logoutBusy" @click="doLogout('ALL')"><Icon name="logout" :size="15" />退出全部会话</button>
                </div>
                <div v-if="logoutError" class="notice notice-warning">
                  <Icon name="alert" :size="16" />
                  <div class="notice-body"><div class="notice-text">登出请求未完成（{{ logoutError.code || '本地异常' }}）；服务端会话可能仍有效。</div></div>
                  <div class="notice-actions"><button class="btn btn-ghost btn-xs" type="button" @click="localClear">仅清理本地凭证</button></div>
                </div>
              </div>
            </details>
          </template>
          <template v-else>
            <button class="btn btn-secondary btn-sm" type="button" @click="loginLink"><Icon name="lock" :size="15" /><span class="btn-label">登录</span></button>
            <button class="btn btn-primary btn-sm" type="button" @click="registerLink"><Icon name="user" :size="15" /><span class="btn-label">注册</span></button>
          </template>
        </div>
      </div>
    </header>

    <main id="main" tabindex="-1">
      <component :is="view" :key="route.path" :route="route" :navigate="navigate" />
    </main>

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <strong>黄河戍境 · 黄河垃圾热力地图</strong>
          <span class="muted">面向公众的岸线垃圾治理宣传与参与平台</span>
        </div>
        <div class="footer-meta">
          <span>契约版本 <code>1.0.0</code></span>
          <span>单位 <code>kg</code> / <code>count</code></span>
          <span>原始坐标仅上行</span>
          <span>审图号缺失不下发点位</span>
        </div>
        <div class="footer-links">
          <a class="footer-link" href="#/map" @click.prevent="go('/map')"><Icon name="map" :size="15" />地图</a>
          <a class="footer-link" href="#/publicity" @click.prevent="go('/publicity')"><Icon name="chart" :size="15" />公示</a>
          <a class="footer-link" href="#/knowledge" @click.prevent="go('/knowledge')"><Icon name="book" :size="15" />科普</a>
        </div>
      </div>
    </footer>

    <ToastHost />
  `,
};

const app = Vue.createApp(App);
for (const [name, component] of Object.entries({
  Icon, ToastHost, AppBadge, AuditBadge, LoadingBlock, StatePanel, ErrorPanel,
  SectionCard, PageHeader, Pager, ProgressSteps, HeatLegend, CopyCode, Modal,
  StatusBadge, FieldError, HeatCell, KgCell,
})) {
  app.component(name, component);
}
app.config.errorHandler = (error) => {
  console.error("[vue]", error);
  toast("页面发生未处理异常；请刷新重试", { tone: "error" });
};
window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled]", event.reason);
});
app.mount("#app");
