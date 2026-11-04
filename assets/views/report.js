// F2-03 随手拍上报：FILE-01 登记媒体 + RPT-01 创建上报。
// 原始坐标只在内存中短暂驻留并上行；不显示、不持久化、不写 URL/日志/草稿。

import {
  SubmitIntent,
  api,
  dict,
  fileError,
  formatBytes,
  hasPermission,
  loadDictionary,
  mediaTypeFor,
  session,
  sha256Hex,
  toast,
} from "../lib.js";

const { computed, onBeforeUnmount, onMounted, reactive, ref } = Vue;

export const ReportView = {
  name: "ReportView",
  props: { route: { type: Object, required: true }, navigate: { type: Function, required: true } },
  setup(props) {
    const loading = ref(false);
    const dictLoading = ref(false);
    const error = ref(null);
    const fileApiError = ref(null);
    const local = reactive({});
    const file = ref(null);
    const previewUrl = ref("");
    const reading = ref(false);
    const readProgress = ref(0);
    const mediaRef = ref("");
    const ticketExpires = ref("");
    let uploadTicket = ""; // 仅内存；不渲染、不写存储
    const fileIntent = new SubmitIntent("FILE-01");
    const submitIntent = new SubmitIntent("RPT-01");
    let fingerprint = "";
    const location = ref(null); // {lat,lng} 仅内存
    const locating = ref(false);
    const locationError = ref("");
    const category = ref("");
    const scale = ref("");
    const success = ref(null);
    const fileInput = ref(null);

    const canReport = computed(() => session.status === "active" && hasPermission("RPT-01"));
    const categories = computed(() => dict.categories ?? []);
    const scales = computed(() => dict.enums.scale_level ?? []);
    const dictReady = computed(() => dict.available && categories.value.length > 0 && scales.value.length > 0);
    const currentFingerprint = computed(() => JSON.stringify({
      mediaRef: mediaRef.value,
      category: category.value,
      scale: scale.value,
      lat: location.value?.lat ?? null,
      lng: location.value?.lng ?? null,
    }));

    async function loadDict() {
      dictLoading.value = true;
      try {
        await loadDictionary({ force: true });
        if (!category.value && categories.value.length) category.value = categories.value[0].code;
        if (!scale.value && scales.value.length) scale.value = scales.value[0].value;
      } catch (err) {
        error.value = err;
      } finally {
        dictLoading.value = false;
      }
    }

    function clearLocal() {
      for (const key of Object.keys(local)) delete local[key];
    }

    function resetFileState() {
      file.value = null;
      mediaRef.value = "";
      ticketExpires.value = "";
      uploadTicket = "";
      readProgress.value = 0;
      if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
      previewUrl.value = "";
      if (fileInput.value) fileInput.value.value = "";
    }

    async function registerFile() {
      fileApiError.value = null;
      if (!file.value) return;
      const check = fileError(file.value);
      if (check) { local.file = check; return; }
      clearLocal();
      reading.value = true;
      readProgress.value = 8;
      try {
        const buffer = await file.value.arrayBuffer();
        readProgress.value = 55;
        const checksum = await sha256Hex(buffer);
        readProgress.value = 75;
        const data = await api("FILE-01", {
          payload: {
            media_type: mediaTypeFor(file.value),
            size_bytes: file.value.size,
            checksum,
          },
          idem: fileIntent.key,
        });
        readProgress.value = 100;
        mediaRef.value = data.media_ref ?? "";
        ticketExpires.value = data.expires_at ?? "";
        uploadTicket = data.upload_ticket ?? ""; // 仅内存；界面不展示
        toast("媒体已登记（未上传）", { tone: "success" });
      } catch (err) {
        if (err?.code === "PARAM_IDEMPOTENCY_KEY_REUSED") fileIntent.reset();
        fileApiError.value = err;
        readProgress.value = 0;
        mediaRef.value = "";
      } finally {
        reading.value = false;
      }
    }

    async function onFileChange(event) {
      const selected = event.target.files?.[0] ?? null;
      clearLocal();
      resetFileState();
      fileApiError.value = null;
      if (!selected) return;
      const check = fileError(selected);
      if (check) { local.file = check; return; }
      file.value = selected;
      if (selected.type.startsWith("image/")) {
        previewUrl.value = URL.createObjectURL(selected);
      }
      await registerFile();
    }

    function removeFile() {
      clearLocal();
      resetFileState();
      fileApiError.value = null;
    }

    function requestLocation() {
      locationError.value = "";
      if (!navigator.geolocation) {
        locationError.value = "当前浏览器不支持定位；请更换浏览器后重试。";
        return;
      }
      locating.value = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
            || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            locationError.value = "定位结果超出有效范围；请重新定位。";
            locating.value = false;
            return;
          }
          location.value = { lat: latitude, lng: longitude };
          locating.value = false;
          toast("定位已获取（仅上行）", { tone: "success" });
        },
        (geoError) => {
          locating.value = false;
          const messages = {
            1: "定位权限被拒绝；请在浏览器设置中允许定位后重试。",
            2: "暂时无法获取定位；请检查设备定位服务。",
            3: "定位超时；请重试。",
          };
          locationError.value = messages[geoError.code] || "定位失败；请重试。";
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      );
    }

    function clearLocation() {
      location.value = null;
      locationError.value = "";
    }

    function resetSubmitIntentIfChanged() {
      if (fingerprint !== currentFingerprint.value) {
        submitIntent.reset();
        fingerprint = currentFingerprint.value;
      }
    }

    async function submit() {
      clearLocal();
      error.value = null;
      local.file = mediaRef.value ? "" : "请先选择文件并完成媒体登记";
      local.location = location.value ? "" : "请先获取定位";
      local.category = category.value ? "" : "请选择垃圾类别";
      local.scale = scale.value ? "" : "请选择规模";
      if (Object.values(local).some(Boolean)) return;
      resetSubmitIntentIfChanged();
      loading.value = true;
      try {
        const data = await api("RPT-01", {
          payload: {
            raw_lat: location.value.lat,
            raw_lng: location.value.lng,
            waste_category: category.value,
            scale_level: scale.value,
            media_refs: [mediaRef.value],
          },
          idem: submitIntent.key,
        });
        success.value = data;
        location.value = null; // 立即清除原始坐标
        resetFileState();
        toast("上报已受理", { tone: "success" });
        submitIntent.reset();
        fingerprint = "";
      } catch (err) {
        if (err?.code === "PARAM_IDEMPOTENCY_KEY_REUSED") {
          submitIntent.reset();
          fingerprint = "";
        }
        error.value = err;
      } finally {
        loading.value = false;
      }
    }

    function retry() { submit(); }
    function login() { props.navigate(`/auth?mode=login&returnTo=${encodeURIComponent("/report")}`); }

    onMounted(() => {
      if (canReport.value) loadDict();
    });
    onBeforeUnmount(() => {
      if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
      location.value = null;
    });

    return {
      session, canReport, dict, dictLoading, dictReady, categories, scales,
      file, previewUrl, reading, readProgress, mediaRef, ticketExpires, fileInput,
      location, locating, locationError, category, scale, loading, error, fileApiError, local, success,
      formatBytes, loadDict, onFileChange, removeFile, requestLocation, clearLocation, submit, retry, login,
      navigate: props.navigate,
    };
  },
  template: `
    <section class="page-shell report-page">
      <PageHeader eyebrow="F2-03 随手拍上报" title="发现岸线垃圾，拍下来"
        description="拍照/选择文件、获取定位、填写类别与规模后上报。原始坐标只随 RPT-01 上行，页面不显示、不缓存。">
        <template #meta>
          <AppBadge label="原始坐标仅上行" tone="good" icon-name="shield" />
          <AppBadge label="重量单位 kg" tone="neutral" icon-name="list" />
          <AppBadge label="上传完成接口缺失" tone="warning" icon-name="alert" />
        </template>
      </PageHeader>

      <StatePanel v-if="session.status !== 'active'" tone="blocked" icon-name="lock" title="上报需要登录"
        description="Q1 参考默认“上报需登录”；当前未登录。登录后可提交上报，角色权限仍由后端裁决。">
        <template #actions><button class="btn btn-primary btn-sm" type="button" @click="login">去登录</button></template>
      </StatePanel>

      <StatePanel v-else-if="!canReport" tone="refusal" icon-name="shield" title="当前账号无上报权限"
        description="permission_summary 未包含 RPT-01；界面裁剪只是体验，后端仍会裁决。" />

      <template v-else>
        <div v-if="dictLoading" class="card"><div class="card-body"><LoadingBlock label="加载上报字典" :lines="3" /></div></div>
        <ErrorPanel v-else-if="dict.status === 'error'" :error="dict.error" @retry="loadDict" @login="login" />
        <StatePanel v-else-if="!dictReady" tone="blocked" icon-name="book" title="字典未下发，无法选择类别/规模"
          description="ADM-01 仅 R6/R7 可读（CR-001）。当前角色无法取得 waste_categories/scale_level 字典，前端不以硬编码替代。请使用运营管理员演示账号或等待权限口径调整。"
          code="CR-001">
          <template #actions>
            <button class="btn btn-secondary btn-sm" type="button" @click="loadDict">重试字典</button>
            <button class="btn btn-ghost btn-sm" type="button" @click="navigate('/auth?mode=login')">切换账号</button>
          </template>
        </StatePanel>

        <template v-else>
          <div class="step-rail">
            <span class="step-rail-item"><span class="step-rail-num">1</span>选择文件并登记</span>
            <span class="step-rail-item"><span class="step-rail-num">2</span>获取定位</span>
            <span class="step-rail-item"><span class="step-rail-num">3</span>填写类别/规模</span>
            <span class="step-rail-item"><span class="step-rail-num">4</span>提交上报</span>
          </div>

          <div class="two-col">
            <SectionCard title="1. 照片/视频" description="JPEG/PNG ≤10MB，MP4 ≤100MB；本地计算 SHA-256 后向 FILE-01 登记。">
              <div v-if="!file" class="upload-drop">
                <span class="upload-icon"><Icon name="camera" :size="24" /></span>
                <div>
                  <strong>选择现场文件</strong>
                  <p class="muted">支持拍照或从相册选择；文件仅用于取证登记，不显示原始位置信息。</p>
                </div>
                <label class="btn btn-secondary btn-sm">
                  <Icon name="upload" :size="15" />选择文件
                  <input ref="fileInput" class="sr-only" type="file" accept="image/jpeg,image/png,video/mp4" @change="onFileChange" />
                </label>
              </div>
              <div v-else class="photo-file">
                <Icon name="file" :size="18" />
                <div class="file-meta">
                  <strong>{{ file.name }}</strong>
                  <span class="muted">{{ formatBytes(file.size) }} · {{ file.type }}</span>
                </div>
                <div class="photo-actions">
                  <label class="btn btn-ghost btn-sm">更换<input class="sr-only" type="file" accept="image/jpeg,image/png,video/mp4" @change="onFileChange" /></label>
                  <button class="btn btn-ghost btn-sm" type="button" @click="removeFile"><Icon name="close" :size="14" />移除</button>
                </div>
              </div>
              <FieldError :message="local.file" />
              <img v-if="previewUrl" :src="previewUrl" class="photo-media" alt="本地文件预览（不上传）" />
              <div v-if="reading" class="progress-track" role="progressbar" :aria-valuenow="readProgress" aria-valuemin="0" aria-valuemax="100">
                <span class="progress-fill" :style="{ width: readProgress + '%' }" />
              </div>
              <div v-if="mediaRef" class="media-ref-row">
                <AppBadge label="已登记 media_ref" tone="good" icon-name="check" />
                <code class="code-chip">{{ mediaRef }}</code>
                <span v-if="ticketExpires" class="muted">凭证到期 {{ ticketExpires }}</span>
              </div>
              <div v-if="fileApiError" class="form-api-slot"><ErrorPanel :error="fileApiError" retry-label="重新登记" @retry="registerFile" @login="login" /></div>
              <div class="notice notice-warning">
                <Icon name="alert" :size="18" />
                <div class="notice-body"><div class="notice-title">只登记，不声称已上传</div><div class="notice-text">FILE-01 只签发上传凭证；上传完成/媒体访问接口未在契约内（CR-004）。本页不会显示“已上传”或伪造进度。</div></div>
              </div>
            </SectionCard>

            <SectionCard title="2. 定位" description="定位仅保存在内存，随后由 RPT-01 上行；不显示经纬度。">
              <div v-if="!location" class="location-actions">
                <button class="btn btn-secondary" type="button" :disabled="locating" @click="requestLocation">
                  <Icon name="pin" :size="16" />{{ locating ? '定位中…' : '获取定位' }}
                </button>
                <span class="muted">浏览器会请求定位权限；拒绝后无法提交。</span>
              </div>
              <div v-else class="location-ready">
                <Icon name="check" :size="20" />
                <div><strong>定位已获取</strong><p class="muted">仅用于 RPT-01 上行；不显示、不写 URL、不写存储。提交成功后立即清除。</p></div>
                <button class="btn btn-ghost btn-sm" type="button" @click="clearLocation">清除</button>
              </div>
              <FieldError :message="locationError || local.location" />
              <div class="notice notice-info">
                <Icon name="shield" :size="18" />
                <div class="notice-body"><div class="notice-title">原始坐标只上行</div><div class="notice-text">MAP-01 下行只有 coarse_lat/coarse_lng；后端按 coarsen_degree 粗化。前端不反推原始坐标。</div></div>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="3. 类别与规模" description="选项来自 ADM-01；前端不判定归属，不修改后端枚举。">
            <div class="form-grid">
              <label class="field">
                <span class="field-label">垃圾类别<span class="req">*</span></span>
                <select v-model="category" class="select">
                  <option v-for="item in categories" :key="item.code" :value="item.code">{{ item.label }}（{{ item.code }}）</option>
                </select>
                <FieldError :message="local.category" />
              </label>
              <label class="field">
                <span class="field-label">规模<span class="req">*</span></span>
                <select v-model="scale" class="select">
                  <option v-for="item in scales" :key="item.value" :value="item.value">{{ item.label }}（{{ item.value }}）</option>
                </select>
                <FieldError :message="local.scale" />
              </label>
            </div>
            <div class="notice notice-info">
              <Icon name="info" :size="18" />
              <div class="notice-body"><div class="notice-title">声明与裁决分离</div><div class="notice-text">类别/规模是本次上报的声明值；AI 初判、岸段匹配与审核结论全部由后端处理，前端不预测。</div></div>
            </div>
          </SectionCard>

          <SectionCard title="4. 提交">
            <div class="form-actions">
              <button class="btn btn-primary btn-lg" type="button" :disabled="loading || !mediaRef || !location" @click="submit">
                <Icon name="send" :size="17" />{{ loading ? '提交中…' : '提交上报' }}
              </button>
              <button class="btn btn-ghost" type="button" @click="navigate('/profile')">查看我的上报</button>
            </div>
            <div v-if="error" class="form-api-slot"><ErrorPanel :error="error" @retry="retry" @login="login" @refresh="retry" /></div>
            <div v-if="success" class="success-panel">
              <div class="success-icon"><Icon name="check" :size="22" /></div>
              <div class="success-copy">
                <h3>上报已受理</h3>
                <div class="chip-row">
                  <CopyCode :value="success.report_id" />
                  <StatusBadge enum-name="report_status" :value="success.report_status" />
                  <AppBadge v-if="success.matched_section_id" :label="'匹配岸段 ' + success.matched_section_id" tone="info" icon-name="pin" />
                </div>
                <p class="muted">状态/闭环以后端为准；请到个人中心查看后续进度。原始坐标已清除。</p>
              </div>
              <div class="success-actions">
                <button class="btn btn-secondary btn-sm" type="button" @click="navigate('/profile')"><Icon name="list" :size="15" />我的上报</button>
              </div>
            </div>
          </SectionCard>
        </template>
      </template>
    </section>
  `,
};
