// 订阅与通知（公共薄页面）：只保留订阅对象、频率、渠道与退订。
// 当前无通知接口；设置为本地演示，不发送真实通知，不收集联系方式。

import { toast } from "../lib.js";

const { computed, reactive, ref } = Vue;

function loadSubscriptions() {
  try {
    const raw = localStorage.getItem("hh.subscriptions");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        reportStatus: Boolean(parsed.reportStatus),
        publicity: Boolean(parsed.publicity),
      };
    }
  } catch { /* progressive enhancement */ }
  return { reportStatus: true, publicity: false };
}

export const SubscribeView = {
  name: "SubscribeView",
  props: {
    route: { type: Object, default: () => ({}) },
    navigate: { type: Function, default: () => {} },
  },
  setup() {
    const subscriptions = reactive(loadSubscriptions());
    const lastSaved = ref("");

    function save() {
      try { localStorage.setItem("hh.subscriptions", JSON.stringify(subscriptions)); } catch { /* ignore */ }
      lastSaved.value = new Date().toISOString().slice(0, 10);
      toast("演示订阅设置已保存；当前不会发送真实通知", { tone: "success" });
    }

    function unsubscribeAll() {
      subscriptions.reportStatus = false;
      subscriptions.publicity = false;
      save();
      toast("已全部退订（演示设置）", { tone: "info" });
    }

    const activeCount = computed(() => Number(subscriptions.reportStatus) + Number(subscriptions.publicity));

    return { subscriptions, activeCount, lastSaved, save, unsubscribeAll };
  },
  template: `
    <section class="page-shell subscribe-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '订阅与通知' }]" />
      <PageHeader eyebrow="订阅与通知" title="只在你需要的时候提醒"
        description="订阅只针对上报状态变化与本公示更新；不发送营销，不做每日推送。当前为演示设置，不会发送真实通知。">
        <template #meta>
          <AppBadge label="演示设置" tone="warning" icon-name="alert" />
          <AppBadge label="不收集联系方式" tone="good" icon-name="shield" />
          <AppBadge :label="'已开启 ' + activeCount + ' 项'" tone="neutral" icon-name="check" />
        </template>
      </PageHeader>

      <SectionCard title="订阅对象" description="最多两项；在状态变化或新公示发布时提醒。">
        <div class="subscription-list">
          <label class="subscription-row">
            <span><strong>我的上报状态变化</strong><small>仅在已收到、处理中、已办结等状态变化时提醒；不承诺具体时限。</small></span>
            <input v-model="subscriptions.reportStatus" type="checkbox" @change="save" />
          </label>
          <label class="subscription-row">
            <span><strong>本期公示更新</strong><small>仅在新的周期公示发布时提醒；未发布、样本不足的内容不推送。</small></span>
            <input v-model="subscriptions.publicity" type="checkbox" @change="save" />
          </label>
        </div>
        <div class="chip-row">
          <button class="btn btn-ghost btn-sm" type="button" @click="unsubscribeAll">全部退订</button>
          <span v-if="lastSaved" class="muted">最近保存：{{ lastSaved }}（本地）</span>
        </div>
      </SectionCard>

      <div class="two-col">
        <SectionCard title="频率与渠道" description="薄页面：只写必要规则。">
          <dl class="def-list compact">
            <dt>频率</dt><dd>仅在状态变化或新公示时提醒；不发送营销信息</dd>
            <dt>渠道</dt><dd>站内为主；邮件/短信待运营配置，当前不收集联系方式</dd>
            <dt>退订</dt><dd>一键退订，立即生效；不影响已提交上报与公开查询</dd>
            <dt>隐私</dt><dd>不保存原始定位、不展示联系人信息</dd>
          </dl>
        </SectionCard>

        <SectionCard title="现在还没有通知" description="空态说明，不伪造未读消息。">
          <StatePanel tone="empty" icon-name="list" title="本期暂无站内通知"
            description="正式接入通知后，这里会显示服务端返回的消息；当前不展示假未读数，也不发送真实订阅。" compact />
          <div class="chip-row">
            <a class="btn btn-secondary btn-sm" href="#/profile">查看我的上报</a>
            <a class="btn btn-ghost btn-sm" href="#/help">帮助中心</a>
          </div>
        </SectionCard>
      </div>

      <div class="column-foot-note">
        <i class="ri-information-line" aria-hidden="true"></i>
        订阅为演示设置，保存在本机浏览器；清除浏览器数据或更换设备后不会保留，也不会向你发送真实通知。
      </div>
    </section>
  `,
};
