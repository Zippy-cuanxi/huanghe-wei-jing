<!--
  EmptyState.vue — SFC 源文件（设计源）。
  本工程使用 Vue 3 全局构建、无打包器，浏览器运行时由同目录下的
  empty-state.js 提供等价组件；样式在 assets/styles.css 中同一份维护。
  约束：零 SVG；图标走 Remix Icon 字体；颜色只用 CSS 变量；动效支持 prefers-reduced-motion。
-->
<template>
  <div class="empty-state" role="status">
    <div class="empty-state__stage" aria-hidden="true">
      <span class="empty-state__glow"></span>
      <span class="empty-state__ring"></span>
      <i class="empty-state__icon" :class="icon"></i>
    </div>

    <h3 class="empty-state__title">{{ title }}</h3>
    <p v-if="desc" class="empty-state__desc">{{ desc }}</p>

    <!-- 承载原有的 CR-FE-10 / CR-004 等标签，不新增 prop -->
    <slot />

    <div class="empty-state__river" aria-hidden="true">
      <span class="empty-state__wave empty-state__wave--back"></span>
      <span class="empty-state__wave empty-state__wave--front"></span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  icon:  { type: String, default: "ri-information-line" }, // 完整 Remix Icon 类名
  title: { type: String, required: true },
  desc:  { type: String, default: "" },
});
</script>

<!-- 刻意不加 scoped：类名已 BEM 隔离，无构建工程可直接复用同一份 CSS -->
<style>
.empty-state {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 32px 20px 52px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-2);
  text-align: center;
}

.empty-state__stage {
  position: relative;
  display: grid;
  place-items: center;
  width: 104px;
  height: 104px;
  margin: 0 auto 18px;
}

/* 圆形光晕：颜色只引用 CSS 变量，深浅主题由 :root / [data-theme="dark"] 自动切换 */
.empty-state__glow {
  position: absolute;
  inset: -28%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%,
    color-mix(in srgb, var(--brand) 22%, transparent) 0%,
    color-mix(in srgb, var(--brand) 8%, transparent) 46%,
    transparent 72%);
  filter: blur(6px);
  animation: empty-state-breathe 8s ease-in-out infinite;
}

/* 虚线旋转环 */
.empty-state__ring {
  position: absolute;
  inset: 0;
  border: 2px dashed var(--brand);
  border-radius: 50%;
  opacity: 0.55;
  animation: empty-state-spin 24s linear infinite;
}

.empty-state__icon {
  position: relative;
  z-index: 1;
  font-size: 2.25rem;
  line-height: 1;
  font-style: normal;
  color: var(--brand-strong);
}

.empty-state__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  color: var(--ink);
}

.empty-state__desc {
  max-width: 42ch;
  margin: 8px auto 0;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--ink-2);
}

/* 默认插槽里的契约标签（CR-FE-10 / CR-004 等） */
.empty-state > .code-chip { display: inline-block; margin-top: 12px; }

/* 底部两层缓慢横移的河流波纹：纯 CSS 渐变平铺，不含任何 SVG */
.empty-state__river {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: -1;
  height: 42px;
  overflow: hidden;
}

.empty-state__wave {
  position: absolute;
  inset: 0;
  background-repeat: repeat-x;
  background-position-y: bottom;
}

.empty-state__wave--back {
  background-image: radial-gradient(ellipse 34px 15px at 34px 100%,
    color-mix(in srgb, var(--brand) 14%, transparent) 0 62%, transparent 64%);
  background-size: 68px 30px;
  animation: empty-state-drift-back 26s linear infinite;
}

.empty-state__wave--front {
  background-image: radial-gradient(ellipse 26px 11px at 26px 100%,
    color-mix(in srgb, var(--brand) 26%, transparent) 0 62%, transparent 64%);
  background-size: 52px 24px;
  animation: empty-state-drift-front 17s linear infinite;
}

@keyframes empty-state-breathe {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50%      { transform: scale(1.08); opacity: 1; }
}
@keyframes empty-state-spin         { to { transform: rotate(360deg); } }
@keyframes empty-state-drift-back  { to { background-position-x: 68px; } }
@keyframes empty-state-drift-front { to { background-position-x: 52px; } }

/* 减弱动效：动画全停，静态视觉完整保留 */
@media (prefers-reduced-motion: reduce) {
  .empty-state__glow,
  .empty-state__ring,
  .empty-state__wave { animation: none; }
}
</style>
