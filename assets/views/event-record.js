// 事件记录详情（示例）：用「事件—证据—来源—边界」结构呈现一条公开事件记录。
// 没有事件接口时，本页只作为结构与文案示例，不伪造真实事件、地点、机构与数字。

import { copyText, toast } from "../lib.js";
import { EVENT_EXAMPLE } from "../content.js";

const { computed } = Vue;

export const EventRecordView = {
  name: "EventRecordView",
  props: {
    route: { type: Object, required: true },
    navigate: { type: Function, required: true },
    params: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const event = computed(() => {
      const slug = String(props.params?.slug || "");
      return slug === EVENT_EXAMPLE.slug ? EVENT_EXAMPLE : null;
    });

    const sourceSteps = computed(() => ([
      { label: "事件结论", desc: "本页只呈现公开范围内的事件摘要，不展示内部处置备注。" },
      { label: "证据与来源", desc: "证据句、来源等级与获取时间；来源待接入时明确标注。" },
      { label: "原始记录", desc: "原始照片、原始坐标与内部工单不在公开范围；页面不反推、不补造。" },
    ]));

    const shareTitle = computed(() => "黄河戍境｜事件记录示例：证据与公开边界（示例）");
    const shareSummary = computed(() => "示例事件记录：呈现事件、证据、来源与不公开范围；不含真实地点、机构与数字。示例内容需人工审核。");

    async function share() {
      const ok = await copyText(window.location.href);
      toast(ok ? "页面地址已复制" : "复制失败，请手动复制地址", { tone: ok ? "success" : "warning" });
    }

    return { event, sourceSteps, shareTitle, shareSummary, share };
  },
  template: `
    <section class="page-shell event-record-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '成效公示', path: '/publicity' }, { label: event?.title || '事件记录' }]" />

      <template v-if="event">
        <PageHeader eyebrow="事件记录 · 示例" :title="event.title" :description="event.summary">
          <template #meta>
            <AppBadge label="示例" tone="warning" icon-name="alert" />
            <AppBadge label="需人工审核" tone="neutral" icon-name="shield" />
            <AppBadge :label="'周期：' + event.period" tone="info" icon-name="clock" />
            <AppBadge :label="'岸段：' + event.section" tone="neutral" icon-name="pin" />
          </template>
          <template #actions>
            <button class="btn btn-secondary" type="button" @click="share"><i class="ri-share-forward-line" aria-hidden="true"></i>分享本页</button>
            <a class="btn btn-secondary" href="#/publicity"><i class="ri-arrow-left-line" aria-hidden="true"></i>返回公示栏目</a>
          </template>
        </PageHeader>

        <div class="detail-layout">
          <article class="detail-main">
            <section class="detail-block">
              <h2>事件是什么</h2>
              <p>{{ event.summary }}</p>
              <p class="muted">本页是事件记录的结构示例，用于说明如何呈现证据、来源与公开边界；不包含真实事件、地点、机构与数字。</p>
            </section>

            <section class="detail-block">
              <h2>公开证据</h2>
              <div class="evidence-quote">
                <i class="ri-file-text-line" aria-hidden="true"></i>
                <p>{{ event.evidence }}</p>
              </div>
              <p class="muted">证据只呈现公开范围内的一句话；原始照片、原始坐标与内部处置记录不公开。</p>
            </section>

            <section class="detail-block">
              <h2>来源与时间</h2>
              <p>{{ event.source }}</p>
              <ul class="plain-list">
                <li v-for="(item, i) in event.limits" :key="i">{{ item }}</li>
              </ul>
            </section>

            <div class="detail-source-note">
              <i class="ri-information-line" aria-hidden="true"></i>
              <div><strong>阅读提示</strong><p>事件记录不构成执法、考核或责任认定依据；它只回答「发生了什么、证据是什么、来源在哪里、哪些不公开」。</p></div>
            </div>
          </article>

          <aside class="detail-aside">
            <div class="aside-card">
              <h3>内容信息</h3>
              <dl class="def-list compact">
                <template v-for="fact in event.facts" :key="fact.label">
                  <dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd>
                </template>
              </dl>
            </div>
            <SourceTrail title="从事件回到来源" :steps="sourceSteps" />
            <ShareBlock :title="shareTitle" :summary="shareSummary" />
            <div class="aside-card">
              <h3>相关阅读</h3>
              <a v-for="item in event.related" :key="item.href" class="aside-related" :href="item.href"><span>{{ item.label }}</span><i class="ri-arrow-right-line" aria-hidden="true"></i></a>
            </div>
          </aside>
        </div>
      </template>

      <StatePanel v-else tone="empty" icon-name="file" title="该内容已下架或不再公开"
        description="它可能尚未发布、已撤回，或链接已失效；可以返回公示栏目查看其他内容。">
        <template #actions><a class="btn btn-primary btn-sm" href="#/publicity">返回公示栏目</a></template>
      </StatePanel>
    </section>
  `,
};
