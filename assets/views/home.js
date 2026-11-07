// 首页：品牌与分流。先讲价值，再给三条行动入口；不把地图当首页。
// 指标只来自 STAT-01；未发布或不可用时显示「暂无可公示数据」，不补 0。

import {
  api,
  currentPeriodMonth,
  formatCount,
  formatKg,
  formatPeriod,
} from "../lib.js";
import { MetricTile } from "../components.js";
import { springColor } from "./trash-heat.js";
import {
  ACTIONS,
  HOME,
  METRIC_COPY,
  NEWS,
  SITE,
} from "../content.js";

const { computed, onMounted, ref } = Vue;

function buildHeroGrid() {
  const cols = 13;
  const rows = 9;
  const cellW = 38;
  const cellH = 30;
  const gap = 5;
  const startX = 64;
  const startY = 74;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = startX + col * (cellW + gap);
      const y = startY + row * (cellH + gap);
      const centerX = x + cellW / 2;
      const centerY = y + cellH / 2;
      // 抽象水带沿一条柔和的正弦曲线穿过画面；只有靠近水带的网格被点亮，
      // 其余格子保留为空白网格，避免把首页画成满屏数据仪表盘。
      const riverY = 248 + Math.sin((centerX - 20) / 145) * 56;
      const distance = Math.abs(centerY - riverY);
      const wave = Math.sin((col + 1) * 0.72 + row * 0.55) * 0.5 + 0.5;
      const ridge = Math.cos((row + 1) * 0.9 - col * 0.38) * 0.5 + 0.5;
      const nearRiver = Math.max(0, 1 - distance / 145);
      const t = Math.max(0, Math.min(1, nearRiver * 0.78 + wave * 0.14 + ridge * 0.1 - 0.06));
      const blank = t < 0.40 || ((row * 7 + col * 11) % 17 === 0);
      cells.push({
        key: `${row}-${col}`,
        x, y,
        w: cellW,
        h: cellH,
        color: blank ? "transparent" : springColor(t),
        opacity: blank ? 0.22 : 0.52 + t * 0.4,
        blank,
      });
    }
  }
  return cells;
}

export const HomeView = {
  name: "HomeView",
  components: { MetricTile },
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup() {
    const period = ref(currentPeriodMonth());
    const stats = ref(null);
    const statsLoading = ref(true);
    const statsError = ref(null);
    const heroGrid = buildHeroGrid();
    const updates = [
      {
        key: "news-heat",
        path: `/news/${NEWS[0].slug}`,
        tag: "方法",
        tagTone: "info",
        title: NEWS[0].title,
        desc: NEWS[0].summary,
        meta: "示例内容 · 编辑整理",
        icon: "ri-compass-3-line",
        image: "assets/img/section-shoreline.webp",
      },
      {
        key: "action-photo",
        path: `/actions/${ACTIONS[0].slug}`,
        tag: "行动",
        tagTone: "good",
        title: ACTIONS[0].title,
        desc: ACTIONS[0].summary,
        meta: "示例内容 · 需人工审核",
        icon: "ri-camera-3-line",
        image: "assets/img/story-report.webp",
      },
      {
        key: "publicity",
        path: "/publicity",
        tag: "公示",
        tagTone: "warning",
        title: "本期成效公示",
        desc: "查看本期可以公开的清理量与办结情况；未发布指标不展示数值。",
        meta: "数据来自统计接口 · 口径就近可查",
        icon: "ri-bar-chart-line",
        image: "assets/img/topic-blank.webp",
      },
    ];

    const metrics = computed(() => (Array.isArray(stats.value?.metrics) ? stats.value.metrics : []));

    function metricMeta(key) {
      if (METRIC_COPY[key]) return METRIC_COPY[key];
      const metric = metrics.value.find((item) => item.metric_key === key);
      return {
        label: key,
        unit: metric?.unit === "kg" ? "kg" : "条 / 单",
        short: "指标口径见说明",
        scope: "该指标由后端统计接口返回；详细口径以接口字典为准。",
        not: "请结合统计范围阅读，不要单独用作排名或强度结论。",
        icon: "ri-bar-chart-line",
      };
    }

    function metricValue(metric) {
      if (!metric.published) return "—";
      if (metric.unit === "kg") return formatKg(metric.value).replace(/\s*kg$/, "");
      if (metric.unit === "count") return formatCount(metric.value);
      return String(metric.value);
    }

    async function loadStats() {
      statsLoading.value = true;
      statsError.value = null;
      try {
        stats.value = await api("STAT-01", { query: { period: period.value, metric_keys: [] } });
      } catch (error) {
        statsError.value = error;
        stats.value = null;
      } finally {
        statsLoading.value = false;
      }
    }

    onMounted(loadStats);

    return {
      SITE, HOME, period, stats, statsLoading, statsError, metrics, updates, heroGrid, formatPeriod,
      metricMeta, metricValue, loadStats,
      navigate: (path) => { window.location.hash = `#${path}`; },
    };
  },
  template: `
    <div class="home-page">
      <section class="home-hero" aria-labelledby="home-hero-title">
        <div class="home-hero-copy">
          <div class="hero-eyebrow"><span class="hero-dot"></span>{{ HOME.hero.eyebrow }}</div>
          <h1 id="home-hero-title" class="home-title">让每一段岸线<br /><span>都有人看见</span></h1>
          <p class="home-lead">{{ HOME.hero.lead }}</p>
          <div class="home-actions" aria-label="首页主要行动">
            <a v-for="action in HOME.hero.actions" :key="action.path" class="home-action" :class="'home-action-' + action.tone" :href="'#' + action.path">
              <span class="home-action-label">{{ action.label }}</span>
              <span class="home-action-note">{{ action.note }}</span>
              <i class="ri-arrow-right-line" aria-hidden="true"></i>
            </a>
          </div>
          <p class="home-position">{{ SITE.positioningShort }}</p>
          <p class="home-hero-note"><i class="ri-shield-check-line" aria-hidden="true"></i>匿名可浏览公开内容 · 登录后可提交并追踪上报</p>
        </div>
        <div class="home-hero-art" aria-hidden="true">
          <div class="hero-art-frame">
            <div class="hero-art-topline"><span><i class="ri-grid-line"></i>空间网格 · 公开记录</span><span>护河行动</span></div>
            <svg viewBox="0 0 720 460" class="hero-art-svg">
              <defs>
                <linearGradient id="hero-river" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="currentColor" stop-opacity="0.24" />
                  <stop offset="1" stop-color="currentColor" stop-opacity="0.06" />
                </linearGradient>
              </defs>
              <path class="hero-art-contour" d="M-30 134C140 56 258 152 392 96S610 32 758 92" />
              <path class="hero-art-contour hero-art-contour-2" d="M-40 176C114 108 250 198 410 140S632 84 770 138" />
              <path class="hero-art-river" d="M-40 316C110 250 190 368 330 292S540 174 760 238" />
              <path class="hero-art-river hero-art-river-2" d="M-50 388C120 330 240 432 380 356S570 260 770 318" />
              <g class="hero-art-grid" aria-hidden="true">
                <rect v-for="cell in heroGrid" :key="cell.key" :x="cell.x" :y="cell.y" :width="cell.w" :height="cell.h" rx="5"
                  :fill="cell.color" :opacity="cell.opacity" :class="{ 'hero-grid-blank': cell.blank }" />
              </g>
              <circle class="hero-art-pulse" cx="558" cy="286" r="18" />
              <circle class="hero-art-pin" cx="558" cy="286" r="5" />
            </svg>
            <div class="hero-art-footer"><span class="hero-art-caption">示意图 · 非真实地理 · 空白 = 无公开记录</span><span class="hero-art-legend"><i></i>记录聚合</span></div>
          </div>
          <div class="hero-art-flow">
            <template v-for="(step, i) in HOME.flow" :key="step.step"><span><b>{{ step.step }}</b>{{ step.title }}</span><i v-if="i < HOME.flow.length - 1" class="ri-arrow-right-line"></i></template>
          </div>
        </div>
      </section>

      <section class="home-trust" aria-label="本站的三条承诺">
        <div class="home-trust-item"><i class="ri-eye-line" aria-hidden="true"></i><div><strong>公开记录看得懂</strong><span>地图、图例与统计口径同屏呈现</span></div></div>
        <div class="home-trust-item"><i class="ri-hand-heart-line" aria-hidden="true"></i><div><strong>公众参与有入口</strong><span>从拍照上报到进度回看，路径清楚</span></div></div>
        <div class="home-trust-item"><i class="ri-shield-check-line" aria-hidden="true"></i><div><strong>治理成效可追溯</strong><span>每个公开数字都保留来源与边界</span></div></div>
      </section>

      <section class="home-section home-entry-section" aria-labelledby="home-entry-title">
        <div class="home-section-head">
          <div>
            <div class="eyebrow">公众服务</div>
            <h2 id="home-entry-title" class="home-section-title">从这里开始，参与护河</h2>
          </div>
          <p class="home-section-desc">四项高频服务，按你的访问目的直接进入；公开内容无需登录。</p>
        </div>
        <div class="home-entry-grid">
          <a v-for="(card, index) in HOME.actionCards" :key="card.path" class="home-entry-card" :href="'#' + card.path">
            <span class="home-entry-index">0{{ index + 1 }}</span>
            <span class="home-entry-icon"><i :class="card.icon" aria-hidden="true"></i></span>
            <span class="home-entry-copy"><strong>{{ card.title }}</strong><span>{{ card.desc }}</span></span>
            <span class="home-entry-link">{{ card.link }}<i class="ri-arrow-right-line" aria-hidden="true"></i></span>
          </a>
        </div>
      </section>

      <section class="home-section home-metrics-section">
        <div class="home-section-head">
          <div>
            <div class="eyebrow">本期可以公开的数据</div>
            <h2 class="home-section-title">改变了什么，凭什么是这样</h2>
          </div>
          <p class="home-section-desc">只展示本期已发布指标；每个指标都带统计范围与「不代表什么」。<span class="home-period">统计周期：{{ formatPeriod(period) }}</span><a href="#/publicity">查看完整公示</a></p>
        </div>
        <div v-if="statsLoading" class="home-metric-skeletons" aria-label="正在加载本期指标">
          <div v-for="i in 3" :key="i" class="skeleton skeleton-card"></div>
        </div>
        <div v-else-if="statsError" class="home-metrics-fallback">
          <div class="state-panel is-compact">
            <h3 class="state-title">本期数据暂不可用</h3>
            <p class="state-desc">统计接口暂时没有返回可公开的数据；页面不补 0，也不推测。你仍可以先看地图或了解参与方式。</p>
            <div class="state-actions">
              <button class="btn btn-secondary btn-sm" type="button" @click="loadStats"><i class="ri-refresh-line" aria-hidden="true"></i>重试</button>
              <a class="btn btn-ghost btn-sm" href="#/map">去看地图</a>
            </div>
          </div>
        </div>
        <div v-else-if="metrics.length" class="kpi-row home-kpi-row">
          <MetricTile v-for="metric in metrics" :key="metric.metric_key"
            :label="metricMeta(metric.metric_key).label"
            :value="metricValue(metric)"
            :unit="metricMeta(metric.metric_key).unit"
            :short="metricMeta(metric.metric_key).short"
            :scope="metricMeta(metric.metric_key).scope"
            :not="metricMeta(metric.metric_key).not"
            :icon-name="metricMeta(metric.metric_key).icon"
            :published="metric.published"
            demo />
        </div>
        <div v-else class="home-metrics-fallback">
          <div class="state-panel is-compact">
            <h3 class="state-title">本期暂无可公示指标</h3>
            <p class="state-desc">数据整理或发布门槛未满足时，本站不展示数值，也不补 0。你仍可以查看地图上的公开记录。</p>
          </div>
        </div>
        <p class="home-data-note"><i class="ri-information-line" aria-hidden="true"></i>指标由后端统计接口聚合；演示环境中的数据仅用于展示，需人工审核后使用。<a href="#/publicity">口径与来源</a></p>
      </section>

      <section class="home-section home-flow-section">
        <div class="home-section-head">
          <div>
            <div class="eyebrow">拍 · 派 · 清 · 晒</div>
            <h2 class="home-section-title">一次参与，怎样走到结果</h2>
          </div>
          <p class="home-section-desc">不是每一个上报都会成为公示数字。</p>
        </div>
        <p class="home-flow-sentence">{{ HOME.flowSentence }}</p>
        <div class="home-flow">
          <div v-for="(step, i) in HOME.flow" :key="step.step" class="home-flow-step">
            <span class="home-flow-num">{{ step.step }}</span>
            <div class="home-flow-copy"><strong>{{ step.title }}</strong><span>{{ step.desc }}</span></div>
            <i v-if="i < HOME.flow.length - 1" class="ri-arrow-right-line home-flow-arrow" aria-hidden="true"></i>
          </div>
        </div>
        <div class="home-flow-note"><i class="ri-shield-check-line" aria-hidden="true"></i>只有审核通过并办结的记录，才会进入公开统计；三审三校与职责分离保留在后端。</div>
      </section>

      <section class="home-section home-updates-section" aria-labelledby="home-updates-title">
        <div class="home-section-head">
          <div>
            <div class="eyebrow">行动与阅读</div>
            <h2 id="home-updates-title" class="home-section-title">了解一件事，再迈出一步</h2>
          </div>
          <p class="home-section-desc">从方法、行动到公示，形成连续阅读路径。示例内容正式上线前需人工审核与替换。</p>
        </div>
        <div v-if="updates.length" class="home-update-grid">
          <a v-for="(item, index) in updates" :key="item.key" class="home-update-card" :class="{ 'is-featured': index === 0 }" :href="'#' + item.path">
            <div class="home-update-media">
              <img v-if="item.image" :src="item.image" :alt="item.title" class="home-update-image" decoding="async" />
              <span class="home-update-tag" :class="'tag-' + item.tagTone">{{ item.tag }}</span>
            </div>
            <div class="home-update-body">
              <span class="home-update-kicker"><i :class="item.icon" aria-hidden="true"></i>{{ index === 0 ? '护河方法' : '继续了解' }}</span>
              <strong>{{ item.title }}</strong>
              <span class="home-update-desc">{{ item.desc }}</span>
              <span class="home-update-meta">{{ item.meta }}</span>
              <span class="home-update-more">阅读详情<i class="ri-arrow-right-line" aria-hidden="true"></i></span>
            </div>
          </a>
        </div>
        <div v-else class="home-updates-empty">
          <i class="ri-newspaper-line" aria-hidden="true"></i>
          <div><strong>最新动态整理中。</strong><p>你可以先看地图，或了解如何参与；这里不补造动态，也不展示未审核内容。</p></div>
        </div>
      </section>

      <section class="home-cta-band">
        <div>
          <div class="eyebrow">{{ SITE.brand }} · 公众参与</div>
          <h2>如果你正好路过一段岸线，<br />可以顺手拍一张。</h2>
          <p>不用先写长文，也不用先注册；匿名可以先把流程走一遍。</p>
        </div>
        <div class="home-cta-actions">
          <a class="btn btn-primary btn-lg" href="#/report"><i class="ri-camera-line" aria-hidden="true"></i>开始随手拍</a>
          <a class="btn btn-secondary btn-lg" href="#/map">先看地图</a>
        </div>
      </section>
    </div>
  `,
};
