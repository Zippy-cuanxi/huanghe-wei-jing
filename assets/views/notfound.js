export const NotFoundView = {
  name: "NotFoundView",
  props: { navigate: { type: Function, required: true } },
  template: `
    <section class="page-shell">
      <StatePanel tone="empty" icon-name="map" title="页面不存在" description="请检查地址，或返回地图首页。">
        <template #actions><button class="btn btn-primary btn-sm" type="button" @click="navigate('/map')">返回地图</button></template>
      </StatePanel>
    </section>
  `,
};
