// Vue3 单页应用：路由、会话引导、公共线 / 工作线布局、主题与全局错误处理。
// 页面组件只消费契约字段；后端是状态与权限的唯一权威。
// 公共线：首页 → 五栏目 → 详情 → 参与；工作线：独立后台版式。

import {
  clearAuth,
  guest,
  hasPermission,
  loadDictionary,
  logout,
  refreshSession,
  roleLabel,
  session,
  startGuestSession,
  toast,
} from "./lib.js";
import {
  Icon, ToastHost, AppBadge, AuditBadge, LoadingBlock, StatePanel, ErrorPanel,
  SectionCard, PageHeader, Pager, ProgressSteps, HeatLegend, CopyCode, Modal,
  StatusBadge, FieldError, HeatCell, KgCell,
  Breadcrumb, Provenance, MetricTile, FilterShell, PublicErrorPanel, SourceTrail, ShareBlock, ColumnScope,
} from "./components.js";
import { EmptyState } from "./empty-state.js";
import { GuestGate } from "./guest-gate.js";
import { SiteDirectory } from "./site-directory.js";
import { SITE, PUBLIC_NAV, PARTICIPATE_ENTRY, FOOTER_LINKS } from "./content.js";
import { AuthView } from "./views/auth.js";
import { HomeView } from "./views/home.js";
import { MapView } from "./views/map.js";
import { SectionProfileView } from "./views/section-profile.js";
import { PublicityView } from "./views/publicity.js";
import { PublicityDetailView } from "./views/publicity-detail.js";
import { EventRecordView } from "./views/event-record.js";
import { KnowledgeView } from "./views/knowledge.js";
import { ActionsView } from "./views/actions.js";
import { NewsView } from "./views/news.js";
import { SearchView } from "./views/search.js";
import { SubscribeView } from "./views/subscribe.js";
import { ReportView } from "./views/report.js";
import { ProfileView } from "./views/profile.js";
import { AdminView } from "./views/admin.js";
import { AboutView, HelpView, DisclaimerView } from "./views/about.js";
import { NotFoundView } from "./views/notfound.js";

const { computed, nextTick, onMounted, reactive, ref, watch } = Vue;

const STATIC_VIEWS = {
  "/": HomeView,
  "/map": MapView,
  "/knowledge": KnowledgeView,
  "/actions": ActionsView,
  "/publicity": PublicityView,
  "/news": NewsView,
  "/search": SearchView,
  "/subscribe": SubscribeView,
  "/report": ReportView,
  "/profile": ProfileView,
  "/admin": AdminView,
  "/auth": AuthView,
  "/about": AboutView,
  "/help": HelpView,
  "/disclaimer": DisclaimerView,
};

const DYNAMIC_ROUTES = [
  { pattern: /^\/map\/section\/([^/]+)\/?$/, view: SectionProfileView, key: "sectionId" },
  { pattern: /^\/knowledge\/([^/]+)\/?$/, view: KnowledgeView, key: "slug" },
  { pattern: /^\/actions\/([^/]+)\/?$/, view: ActionsView, key: "slug" },
  { pattern: /^\/news\/([^/]+)\/?$/, view: NewsView, key: "slug" },
  { pattern: /^\/publicity\/event\/([^/]+)\/?$/, view: EventRecordView, key: "slug" },
  { pattern: /^\/publicity\/([^/]+)\/?$/, view: PublicityDetailView, key: "period" },
];

function matchView(path) {
  if (STATIC_VIEWS[path]) return { view: STATIC_VIEWS[path], params: {} };
  for (const route of DYNAMIC_ROUTES) {
    const match = path.match(route.pattern);
    if (match) {
      return {
        view: route.view,
        params: { [route.key]: decodeURIComponent(match[1]) },
      };
    }
  }
  return { view: NotFoundView, params: {} };
}

const route = reactive({ path: "/", query: {} });

function parseHash() {
  const raw = (window.location.hash || "#/").slice(1) || "/";
  const [path, qs = ""] = raw.split("?");
  route.path = path || "/";
  route.query = Object.fromEntries(new URLSearchParams(qs));
}

// 游客登录闸门：未准入时禁止一切站内跳转。
// checking + 已有会话句柄表示正在校验真实登录态，此时不拦截，以免误伤已登录用户的深链接。
function guestGateLocked() {
  if (guest.status === "admitted") return false;
  if (session.status === "active") return false;
  if (session.status === "checking" && session.handle) return false;
  return true;
}

function enforceGuestGate() {
  if (!guestGateLocked()) return false;
  const { pathname, search, hash } = window.location;
  if (hash && hash !== "#/") {
    try {
      history.replaceState(null, "", `${pathname}${search}#/`);
    } catch {
      window.location.hash = "#/";
    }
  }
  if (route.path !== "/" || Object.keys(route.query).length) {
    route.path = "/";
    route.query = {};
  }
  // route 可能在一轮刷新内先变为深链接又回到 "/"，监听器会因值去重而不触发，
  // 因此这里主动刷新一次标题，确保未登录时标题也停留在登录界面。
  updateTitle();
  return true;
}

function navigate(to) {
  if (guestGateLocked()) {
    enforceGuestGate();
    return;
  }
  const target = to.startsWith("#") ? to.slice(1) : to;
  const next = `#${target}`;
  if (window.location.hash === next) {
    parseHash();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = next;
}

function titleFor(path) {
  if (path === "/") return "首页";
  if (path.startsWith("/map/section/")) return "岸段档案";
  if (path.startsWith("/knowledge/")) return "分类科普";
  if (path.startsWith("/actions/")) return "护河行动";
  if (path.startsWith("/news/")) return "资讯与政策";
  if (path.startsWith("/publicity/event/")) return "事件记录";
  if (path.startsWith("/publicity/")) return "成效公示";
  const labels = {
    "/map": "垃圾地图",
    "/knowledge": "分类科普",
    "/actions": "护河行动",
    "/publicity": "成效公示",
    "/news": "资讯与政策",
    "/search": "站内检索",
    "/subscribe": "订阅与通知",
    "/report": "随手拍上报",
    "/profile": "我的参与",
    "/admin": "运营工作台",
    "/auth": "登录 / 注册",
    "/about": "关于本站",
    "/help": "帮助中心",
    "/disclaimer": "免责与口径",
  };
  return labels[path] || "页面不存在";
}

function updateTitle() {
  document.title = guestGateLocked()
    ? `游客登录 · ${SITE.brand}`
    : `${titleFor(route.path)} · ${SITE.brand}`;
}

const FOOTER_GROUPS = [
  { title: "发现", links: FOOTER_LINKS.look },
  { title: "参与", links: FOOTER_LINKS.act },
  { title: "了解", links: FOOTER_LINKS.about },
];

const MOBILE_QUICK_NAV = [
  { path: "/", label: "首页", icon: "ri-home-5-line" },
  { path: "/map", label: "地图", icon: "ri-map-2-line" },
  { path: "/report", label: "上报", icon: "ri-camera-line" },
  { path: "/profile", label: "我的", icon: "ri-user-3-line" },
];

const App = {
  name: "App",
  setup() {
    const theme = ref(document.documentElement.dataset.theme || "light");
    const navOpen = ref(false);
    const headerHidden = ref(false);
    const directoryOpen = ref(false);
    const logoutBusy = ref(false);
    const logoutError = ref(null);
    const bootError = ref(null);

    const matched = computed(() => matchView(route.path));
    const view = computed(() => matched.value.view);
    const viewParams = computed(() => matched.value.params);
    const hasViewParams = computed(() => Object.keys(viewParams.value).length > 0);
    const isWorkLine = computed(() => route.path.startsWith("/admin"));
    const activeSection = computed(() => {
      const path = route.path;
      if (path === "/") return "/";
      for (const item of PUBLIC_NAV) {
        if (item.path === path || path.startsWith(item.path + "/")) return item.path;
      }
      if (path.startsWith("/report")) return "/report";
      if (path.startsWith("/profile")) return "/profile";
      if (path.startsWith("/admin")) return "/admin";
      return "";
    });
    const isAdmin = computed(() => session.status === "active" && (
      hasPermission("REV-01") || hasPermission("WO-01") || hasPermission("WO-02") || hasPermission("ADM-01")
    ));
    const isAuthed = computed(() => session.status === "active");
    // 游客登录闸门：open 表示已准入；checking 表示正在校验已有会话；
    // locked 表示必须完成游客登录后才能渲染站点内容。
    const gateState = computed(() => {
      if (guest.status === "admitted") return "open";
      if (session.status === "active") return "open";
      if (session.status === "checking" && session.handle) return "checking";
      return "locked";
    });
    const roleText = computed(() => (session.roles || []).map((role) => roleLabel(role).text).join(" / ") || "—");
    const publicNav = PUBLIC_NAV;
    const participateEntry = PARTICIPATE_ENTRY;
    const footerGroups = FOOTER_GROUPS;

    function toggleTheme() {
      theme.value = theme.value === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme.value;
      try { localStorage.setItem("hh.theme", theme.value); } catch { /* progressive enhancement */ }
    }

    // 顶部导航滚动收起：向下滚动隐藏，向上滚动或回到顶部恢复。
    // 用 rAF 合并滚动事件，阈值避免触控板细微抖动导致反复收放。
    let lastScrollY = 0;
    let scrollFrame = 0;

    function onWindowScroll() {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        const y = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
        const delta = y - lastScrollY;
        if (y <= 16) {
          headerHidden.value = false;
        } else if (delta > 6 && y > 120) {
          headerHidden.value = true;
          navOpen.value = false;
          directoryOpen.value = false;
        } else if (delta < -6) {
          headerHidden.value = false;
        }
        lastScrollY = y;
      });
    }

    function go(path) {
      navOpen.value = false;
      directoryOpen.value = false;
      navigate(path);
    }

    function doGuestLogin() {
      const profile = startGuestSession();
      // 准入后统一进入首页，清除登录前可能残留在地址栏中的站内目标。
      try {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
      } catch {
        window.location.hash = "#/";
      }
      route.path = "/";
      route.query = {};
      navOpen.value = false;
      updateTitle();
      toast(`游客登录成功：${profile.guest_id}`, { tone: "success" });
      focusMain();
    }

    // 账号登录 / 注册成功后：清除登录前的地址栏目标，统一进入首页。
    function onGateAuthenticated() {
      try {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
      } catch {
        window.location.hash = "#/";
      }
      route.path = "/";
      route.query = {};
      navOpen.value = false;
      updateTitle();
      focusMain();
    }

    function mobileNavActive(path) {
      if (path === "/") return route.path === "/";
      return route.path === path || route.path.startsWith(`${path}/`);
    }

    async function doLogout(scope = "CURRENT") {
      logoutBusy.value = true;
      logoutError.value = null;
      try {
        await logout(scope);
        toast("已退出登录", { tone: "success" });
        go("/");
      } catch (error) {
        logoutError.value = error;
        const isAuth = error?.behavior?.domain === "AUTH";
        if (isAuth) {
          toast("会话已失效，已回到匿名态", { tone: "warning" });
          go("/");
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
      go("/");
    }

    function loginLink() {
      const returnTo = route.path === "/auth" ? "/" : route.path;
      navigate(`/auth?mode=login&returnTo=${encodeURIComponent(returnTo)}`);
    }

    function registerLink() {
      navigate("/auth?mode=register");
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
      if (guestGateLocked()) {
        enforceGuestGate();
        navOpen.value = false;
        return;
      }
      parseHash();
      navOpen.value = false;
      directoryOpen.value = false;
      headerHidden.value = false;
      updateTitle();
      focusMain();
    }

    function onAuthCleared() {
      if (guest.status === "admitted") {
        toast("登录状态已失效，已切换为游客浏览", { tone: "warning" });
        return;
      }
      if (guestGateLocked()) {
        enforceGuestGate();
        toast("登录状态已失效，请重新完成游客登录", { tone: "warning" });
      }
    }

    onMounted(async () => {
      parseHash();
      updateTitle();
      window.addEventListener("hashchange", onHashChange);
      window.addEventListener("hh:auth-cleared", onAuthCleared);
      window.addEventListener("hh:gate-authenticated", onGateAuthenticated);
      lastScrollY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
      window.addEventListener("scroll", onWindowScroll, { passive: true });
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
        if (error?.behavior?.domain !== "AUTH") {
          bootError.value = error;
          toast("会话恢复失败；可稍后重试", { tone: "warning", traceId: error?.traceId });
        }
      }
      // 登录态校验完成后，未准入的深链接统一回到游客登录界面。
      enforceGuestGate();
    });

    watch(() => route.path, updateTitle);
    watch(directoryOpen, (open) => {
      if (open) navOpen.value = false;
    });
    watch(navOpen, (open) => {
      if (open) directoryOpen.value = false;
    });

    return {
      SITE, route, view, viewParams, hasViewParams, isWorkLine, activeSection, publicNav, participateEntry,
      footerGroups, mobileQuickNav: MOBILE_QUICK_NAV, session, guest, gateState, isAuthed, isAdmin, roleText,
      theme, navOpen, headerHidden, directoryOpen, logoutBusy, logoutError, bootError,
      go, navigate, mobileNavActive, toggleTheme, doLogout, localClear, loginLink, registerLink, updateTitle,
      doGuestLogin,
    };
  },
  template: `
    <GuestGate v-if="gateState !== 'open'" :state="gateState" @guest="doGuestLogin" />

    <template v-else>
    <a class="skip-link" href="#main">跳到主内容</a>

    <header v-if="!isWorkLine" class="site-header public-header" :class="{ 'nav-open': navOpen, 'is-hidden': headerHidden }">
      <div class="header-inner">
        <a class="brand" href="#/" @click.prevent="go('/')">
          <span class="brand-mark brand-mark--logo" aria-hidden="true"><img src="assets/img/logo-mark.png" alt="" /></span>
          <span class="brand-copy">
            <span class="brand-title-line"><span class="brand-title">{{ SITE.brand }}</span><span class="header-env-badge">演示</span></span>
            <span class="brand-sub">黄河上游岸线垃圾治理参与平台</span>
          </span>
        </a>
        <nav id="public-navigation" class="primary-nav" aria-label="主导航">
          <a v-for="item in publicNav" :key="item.path" class="nav-link" :class="{ 'is-active': activeSection === item.path }" :href="'#' + item.path" @click.prevent="go(item.path)">
            <i class="nav-icon" :class="item.icon" aria-hidden="true"></i>{{ item.label }}
          </a>
          <button class="nav-link nav-theme-item" type="button" @click="toggleTheme">
            <i class="theme-icon" :class="theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'" aria-hidden="true"></i>{{ theme === 'dark' ? '切换为浅色' : '切换为深色' }}
          </button>
          <a class="nav-link nav-search-mobile" href="#/search" @click.prevent="go('/search')"><i class="ri-search-line nav-icon" aria-hidden="true"></i>站内检索</a>
        </nav>
        <div class="header-tools">
          <button class="btn btn-ghost btn-icon" type="button" :aria-label="navOpen ? '收起导航' : '打开导航'" :aria-expanded="navOpen ? 'true' : 'false'" aria-controls="public-navigation" @click="navOpen = !navOpen"><Icon :name="navOpen ? 'close' : 'menu'" :size="20" /></button>
        </div>
        <div class="header-right">
          <a class="btn btn-ghost btn-icon header-search-btn" href="#/search" aria-label="站内检索" @click.prevent="go('/search')"><i class="ri-search-line" aria-hidden="true"></i></a>
          <a class="btn btn-primary btn-sm header-report-btn" :href="'#' + participateEntry.path" :aria-label="participateEntry.label" @click.prevent="go(participateEntry.path)">
            <i :class="participateEntry.icon" aria-hidden="true"></i><span class="btn-label">{{ participateEntry.label }}</span>
          </a>
          <button class="btn btn-ghost btn-icon header-theme-toggle" type="button" :aria-label="theme === 'dark' ? '切换为浅色' : '切换为深色'" @click="toggleTheme">
            <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" />
          </button>
          <span v-if="guest.status === 'admitted' && !isAuthed" class="guest-chip" title="游客浏览：登录状态仅保留在当前标签页">
            <i class="ri-user-smile-line" aria-hidden="true"></i><span>游客</span>
          </span>
          <template v-if="isAuthed">
            <details class="session-menu">
              <summary class="session-summary">
                <span class="avatar"><Icon name="user" :size="16" /></span>
                <span class="session-copy"><span class="session-account">{{ session.profile?.account_id }}</span><span class="session-role">{{ roleText }}</span></span>
                <Icon name="chevronDown" :size="14" class="session-chevron" />
              </summary>
              <div class="session-popover">
                <div class="session-popover-head">
                  <div><strong>{{ session.profile?.account_id }}</strong><div class="muted">{{ roleText }}</div></div>
                  <AppBadge label="已登录" tone="good" icon-name="check" />
                </div>
                <dl class="def-list compact">
                  <dt>会话到期</dt><dd>{{ session.expiresAt || '—' }}</dd>
                </dl>
                <div class="session-popover-actions">
                  <button class="btn btn-ghost btn-sm popover-theme-item" type="button" @click="toggleTheme">
                    <i class="theme-icon" :class="theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'" aria-hidden="true"></i>{{ theme === 'dark' ? '切换为浅色' : '切换为深色' }}
                  </button>
                  <button class="btn btn-ghost btn-sm" type="button" @click="go('/profile')"><Icon name="user" :size="15" />我的上报</button>
                  <button v-if="isAdmin" class="btn btn-ghost btn-sm" type="button" @click="go('/admin')"><Icon name="settings" :size="15" />运营工作台</button>
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
            <button class="btn btn-ghost btn-sm" type="button" aria-label="登录" @click="loginLink"><Icon name="lock" :size="15" /><span class="btn-label">登录</span></button>
            <button class="btn btn-secondary btn-sm" type="button" aria-label="注册" @click="registerLink"><Icon name="user" :size="15" /><span class="btn-label">注册</span></button>
          </template>
          <SiteDirectory v-model:open="directoryOpen" :items="publicNav" :active="activeSection" @select="go" />
        </div>
      </div>
    </header>

    <header v-else class="site-header work-header" :class="{ 'is-hidden': headerHidden }">
      <div class="work-header-inner">
        <a class="work-brand" href="#/admin" @click.prevent="go('/admin')">
          <span class="brand-mark brand-mark--sm brand-mark--logo" aria-hidden="true"><img src="assets/img/logo-mark.png" alt="" /></span>
          <span class="work-brand-copy"><strong>{{ SITE.brand }}</strong><span>运营工作台</span></span>
        </a>
        <div class="work-header-actions">
          <span class="work-env-badge"><i class="ri-flask-line" aria-hidden="true"></i>演示环境</span>
          <a class="btn btn-ghost btn-sm work-back-btn" href="#/" aria-label="返回公众站" @click.prevent="go('/')"><i class="ri-arrow-left-line" aria-hidden="true"></i><span class="btn-label">返回公众站</span></a>
          <button class="btn btn-ghost btn-icon" type="button" :aria-label="theme === 'dark' ? '切换为浅色' : '切换为深色'" @click="toggleTheme">
            <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" />
          </button>
          <template v-if="isAuthed">
            <span class="work-user" :title="session.profile?.account_id"><i class="ri-user-3-line" aria-hidden="true"></i><span class="work-user-name">{{ session.profile?.account_id }}</span></span>
            <button class="btn btn-ghost btn-sm work-logout-btn" type="button" aria-label="退出当前会话" :disabled="logoutBusy" @click="doLogout('CURRENT')"><i class="ri-logout-box-line" aria-hidden="true"></i><span class="btn-label">退出</span></button>
          </template>
          <template v-else>
            <button class="btn btn-primary btn-sm" type="button" @click="loginLink">登录</button>
          </template>
          <SiteDirectory v-model:open="directoryOpen" :items="publicNav" :active="activeSection" @select="go" />
        </div>
      </div>
    </header>

    <main id="main" tabindex="-1" :class="{ 'work-main': isWorkLine }">
      <component v-if="hasViewParams" :is="view" :key="route.path" :route="route" :params="viewParams" :navigate="navigate" />
      <component v-else :is="view" :key="route.path" :route="route" :navigate="navigate" />
    </main>

    <footer v-if="!isWorkLine" class="site-footer public-footer">
      <div class="public-footer-inner">
        <div class="footer-brand-block">
          <a class="footer-brand-link" href="#/" @click.prevent="go('/')">
            <span class="brand-mark brand-mark--sm brand-mark--logo footer-brand-mark" aria-hidden="true"><img src="assets/img/logo-mark.png" alt="" /></span>
            <span><strong>{{ SITE.brand }}</strong><span>{{ SITE.tagline }}</span></span>
          </a>
          <p class="footer-full-name">{{ SITE.fullName }}</p>
          <p class="footer-demo-note">{{ SITE.demoNote }}</p>
        </div>
        <div v-for="group in footerGroups" :key="group.title" class="footer-link-col">
          <span class="footer-col-title">{{ group.title }}</span>
          <a v-for="link in group.links" :key="link.path" :href="'#' + link.path">{{ link.label }}</a>
        </div>
      </div>
      <div class="public-footer-bottom">
        <span>{{ SITE.positioning }}</span>
        <span class="footer-bottom-links"><a href="#/disclaimer">口径与来源</a><span>示例站点 · 数据需人工审核 · 不构成正式测绘或政务结论</span></span>
      </div>
    </footer>

    <nav v-if="!isWorkLine" class="mobile-quick-nav" aria-label="移动端快捷导航">
      <a v-for="item in mobileQuickNav" :key="item.path" class="mobile-quick-link"
        :class="{ 'is-active': mobileNavActive(item.path), 'is-report': item.path === '/report' }"
        :href="'#' + item.path" :aria-current="mobileNavActive(item.path) ? 'page' : null" @click.prevent="go(item.path)">
        <span class="mobile-quick-icon"><i :class="item.icon" aria-hidden="true"></i></span>
        <span>{{ item.label }}</span>
      </a>
    </nav>
    </template>

    <ToastHost />
  `,
};

const app = Vue.createApp(App);
for (const [name, component] of Object.entries({
  Icon, ToastHost, AppBadge, AuditBadge, LoadingBlock, StatePanel, ErrorPanel,
  SectionCard, PageHeader, Pager, ProgressSteps, HeatLegend, CopyCode, Modal,
  StatusBadge, FieldError, HeatCell, KgCell, EmptyState, GuestGate, SiteDirectory,
  Breadcrumb, Provenance, MetricTile, FilterShell, PublicErrorPanel, SourceTrail, ShareBlock, ColumnScope,
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
