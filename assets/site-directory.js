// 顶部目录菜单：集中展示与顶部导航一致的完整栏目列表。
// 受控组件：open 由 App 统一管理，便于在滚动收起、路由切换时同步关闭。

const { nextTick, onBeforeUnmount, onMounted, ref, watch } = Vue;

export const SiteDirectory = {
  name: "SiteDirectory",
  props: {
    items: { type: Array, default: () => [] },
    active: { type: String, default: "" },
    open: { type: Boolean, default: false },
  },
  emits: ["update:open", "select"],
  setup(props, { emit }) {
    const root = ref(null);
    const trigger = ref(null);
    const panel = ref(null);

    function setOpen(next) {
      if (props.open !== next) emit("update:open", next);
    }

    function toggle() {
      setOpen(!props.open);
    }

    function close() {
      setOpen(false);
    }

    function select(path) {
      close();
      emit("select", path);
    }

    function onDocumentPointer(event) {
      if (!props.open || !root.value) return;
      if (!root.value.contains(event.target)) close();
    }

    function onDocumentKeydown(event) {
      if (event.key !== "Escape" || !props.open) return;
      event.preventDefault();
      close();
      trigger.value?.focus();
    }

    onMounted(() => {
      document.addEventListener("pointerdown", onDocumentPointer);
      document.addEventListener("keydown", onDocumentKeydown);
    });

    onBeforeUnmount(() => {
      document.removeEventListener("pointerdown", onDocumentPointer);
      document.removeEventListener("keydown", onDocumentKeydown);
    });

    watch(() => props.open, (open) => {
      if (!open) return;
      nextTick(() => {
        const target = panel.value?.querySelector(".directory-item.is-active")
          || panel.value?.querySelector(".directory-item");
        target?.focus();
      });
    });

    watch(() => props.active, () => close());

    return { root, trigger, panel, toggle, close, select };
  },
  template: `
    <div ref="root" class="site-directory">
      <button ref="trigger" class="btn btn-ghost btn-sm directory-trigger" type="button"
        aria-controls="site-directory-panel" :aria-expanded="open ? 'true' : 'false'"
        aria-label="目录：切换站内页面" @click="toggle">
        <i class="ri-list-check-2" aria-hidden="true"></i><span class="btn-label">目录</span>
      </button>

      <transition name="directory-pop">
        <nav v-if="open" id="site-directory-panel" ref="panel" class="directory-panel" aria-label="站点目录">
          <div class="directory-head">
            <span class="directory-title">站点目录</span>
            <span class="directory-count">{{ items.length }} 个栏目</span>
          </div>
          <ul class="directory-list">
            <li v-for="item in items" :key="item.path">
              <a class="directory-item" :class="{ 'is-active': item.path === active }"
                :href="'#' + item.path" :aria-current="item.path === active ? 'page' : null"
                @click.prevent="select(item.path)">
                <span class="directory-item-icon"><i :class="item.icon" aria-hidden="true"></i></span>
                <span class="directory-item-label">{{ item.label }}</span>
                <span v-if="item.path === active" class="directory-item-current">当前</span>
                <i v-else class="ri-arrow-right-s-line directory-item-arrow" aria-hidden="true"></i>
              </a>
            </li>
          </ul>
        </nav>
      </transition>
    </div>
  `,
};
