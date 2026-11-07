// 与 EmptyState.vue 等价的全局构建版；本工程无打包器，浏览器实际加载的是本文件。
// 约束：零 SVG；图标走 Remix Icon 字体；颜色只用 CSS 变量；动效支持 prefers-reduced-motion。

export const EmptyState = {
  name: "EmptyState",
  props: {
    icon:  { type: String, default: "ri-information-line" },
    title: { type: String, required: true },
    desc:  { type: String, default: "" },
  },
  template: `
    <div class="empty-state" role="status">
      <div class="empty-state__stage" aria-hidden="true">
        <span class="empty-state__glow"></span>
        <span class="empty-state__ring"></span>
        <i class="empty-state__icon" :class="icon"></i>
      </div>
      <h3 class="empty-state__title">{{ title }}</h3>
      <p v-if="desc" class="empty-state__desc">{{ desc }}</p>
      <slot />
      <div class="empty-state__river" aria-hidden="true">
        <span class="empty-state__wave empty-state__wave--back"></span>
        <span class="empty-state__wave empty-state__wave--front"></span>
      </div>
    </div>
  `,
};
