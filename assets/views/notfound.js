export const NotFoundView = {
  name: "NotFoundView",
  props: {
    route: { type: Object, default: () => ({}) },
    navigate: { type: Function, default: () => {} },
  },
  template: `
    <section class="page-shell">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '页面不存在' }]" />
      <StatePanel tone="empty" icon-name="map" title="这个页面不存在" description="可以回首页，或去看地图。">
        <template #actions>
          <button class="btn btn-primary btn-sm" type="button" @click="navigate('/')">返回首页</button>
          <button class="btn btn-secondary btn-sm" type="button" @click="navigate('/map')">去看地图</button>
        </template>
      </StatePanel>
    </section>
  `,
};
