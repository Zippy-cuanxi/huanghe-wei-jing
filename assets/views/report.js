// 随手拍上报：三步参与。匿名可预览与本地选图；提交仍需登录。
// 原始坐标只在内存中短暂驻留并随 RPT-01 上行；不显示、不持久化、不写 URL/日志/草稿。

import {
  SubmitIntent,
  accountError,
  api,
  credentialError,
  dict,
  fileError,
  formatBytes,
  hasPermission,
  loadDictionary,
  login as loginApi,
  mediaTypeFor,
  session,
  sha256Hex,
  toast,
} from "../lib.js";
import {
  PROVENANCE,
  PUBLIC_CATEGORY_OPTIONS,
  PUBLIC_SCALE_OPTIONS,
} from "../content.js";

const { computed, onBeforeUnmount, onMounted, reactive, ref, watch } = Vue;

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
    let uploadTicket = "";
    const fileIntent = new SubmitIntent("FILE-01");
    const submitIntent = new SubmitIntent("RPT-01");
    let fingerprint = "";
    const location = ref(null);
    const locating = ref(false);
    const locationError = ref("");
    const category = ref("");
    const scale = ref("");
    const success = ref(null);
    const fileInput = ref(null);
    const step = ref(1);
    const loginAccount = ref("");
    const loginPassword = ref("");
    const loginBusy = ref(false);
    const loginError = ref(null);
    const loginLocal = reactive({});

    const canReport = computed(() => session.status === "active" && hasPermission("RPT-01"));
    const isAnonymous = computed(() => session.status !== "active");
    const dictReady = computed(() => dict.available && Array.isArray(dict.categories) && dict.categories.length > 0);
    const categories = computed(() => dictReady.value ? dict.categories : PUBLIC_CATEGORY_OPTIONS);
    const scales = computed(() => (dictReady.value && dict.enums.scale_level?.length) ? dict.enums.scale_level : PUBLIC_SCALE_OPTIONS);
    const usingFallbackOptions = computed(() => !dictReady.value);
    const currentFingerprint = computed(() => JSON.stringify({
      mediaRef: mediaRef.value,
      category: category.value,
      scale: scale.value,
      lat: location.value?.lat ?? null,
      lng: location.value?.lng ?? null,
    }));

    function ensureDefaults() {
      const categoryCodes = new Set(categories.value.map((item) => item.code));
      const scaleCodes = new Set(scales.value.map((item) => item.value));
      if ((!category.value || !categoryCodes.has(category.value)) && categories.value.length) {
        category.value = categories.value[0].code;
      }
      if ((!scale.value || !scaleCodes.has(scale.value)) && scales.value.length) {
        scale.value = scales.value[0].value;
      }
    }

    async function loadDict() {
      dictLoading.value = true;
      try {
        await loadDictionary({ force: true });
      } catch {
        // 字典不可用时回退到通用选项；不阻塞公众预览。
      } finally {
        ensureDefaults();
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
      if (!canReport.value) {
        toast("文件已选择；登录后可完成媒体登记", { tone: "info" });
        return;
      }
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
        uploadTicket = data.upload_ticket ?? "";
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
      step.value = 2;
    }

    function removeFile() {
      clearLocal();
      resetFileState();
      fileApiError.value = null;
      step.value = 1;
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
      if (!canReport.value) { login(); return; }
      if (!file.value) local.file = "请先选择现场照片或视频";
      if (!mediaRef.value) local.file = "文件尚未完成登记；请重新选择文件";
      local.location = location.value ? "" : "请先获取定位，用于匹配岸段";
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
        location.value = null;
        resetFileState();
        toast("上报已收到", { tone: "success" });
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

    async function inlineLogin() {
      for (const key of Object.keys(loginLocal)) delete loginLocal[key];
      loginError.value = null;
      loginLocal.account_id = accountError(loginAccount.value);
      loginLocal.credential = credentialError(loginPassword.value, { strength: false });
      if (Object.values(loginLocal).some(Boolean)) return;
      loginBusy.value = true;
      try {
        await loginApi(loginAccount.value.trim(), loginPassword.value);
        loginPassword.value = "";
        toast("登录成功，已填写的内容会保留", { tone: "success" });
        await loadDict();
        if (file.value && !mediaRef.value) await registerFile();
      } catch (err) {
        loginError.value = err;
      } finally {
        loginBusy.value = false;
      }
    }

    function retry() { submit(); }
    function login() { props.navigate(`/auth?mode=login&returnTo=${encodeURIComponent("/report")}`); }

    onMounted(() => {
      if (session.status === "active") loadDict();
      else ensureDefaults();
    });
    watch(canReport, (allowed) => { if (allowed) loadDict(); });
    onBeforeUnmount(() => {
      if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
      location.value = null;
    });

    return {
      session, canReport, isAnonymous, dict, dictLoading, dictReady, categories, scales, usingFallbackOptions,
      file, previewUrl, reading, readProgress, mediaRef, ticketExpires, fileInput,
      location, locating, locationError, category, scale, loading, error, fileApiError, local, success, step,
      loginAccount, loginPassword, loginBusy, loginError, loginLocal,
      boundaries: PROVENANCE.report.items,
      formatBytes, loadDict, onFileChange, removeFile, requestLocation, clearLocation, submit, retry, login, inlineLogin,
      navigate: props.navigate,
    };
  },
  template: `
    <section class="page-shell report-page">
      <Breadcrumb :items="[{ label: '首页', path: '/' }, { label: '随手拍上报' }]" />
      <PageHeader eyebrow="随手拍上报" title="发现岸线垃圾，拍下来"
        description="拍照 → 选类型与规模 → 确认提交。匿名可以先把流程走一遍；登录后才能提交。">
        <template #meta>
          <AppBadge label="三步参与" tone="info" icon-name="route" />
          <AppBadge label="原始定位仅上行" tone="good" icon-name="shield" />
          <AppBadge label="不承诺办理时限" tone="neutral" icon-name="clock" />
        </template>
      </PageHeader>

      <div class="report-steps" aria-label="参与步骤">
        <button v-for="n in 3" :key="n" class="report-step-chip" :class="{ 'is-active': step === n }" type="button" @click="step = n">
          <span>{{ n }}</span>{{ ['拍照 / 选图', '选类型与规模', '确认提交'][n - 1] }}
        </button>
        <span class="report-steps-hint">{{ isAnonymous ? '匿名预览模式：登录后才能提交' : '登录状态：可以提交' }}</span>
      </div>

      <div class="report-layout">
        <div class="report-main">
          <SectionCard v-show="step === 1" title="1. 拍照 / 选图" description="支持 JPEG、PNG、MP4；照片越清晰，越容易匹配岸段。">
            <div v-if="!file" class="upload-drop">
              <span class="upload-icon"><i class="ri-camera-3-line" aria-hidden="true"></i></span>
              <div>
                <strong>选择现场照片或视频</strong>
                <p class="muted">可以拍照或从相册选择；匿名选图仅本地预览，不会上传。</p>
              </div>
              <label class="btn btn-secondary btn-sm">
                <i class="ri-upload-2-line" aria-hidden="true"></i>选择文件
                <input ref="fileInput" class="sr-only" type="file" accept="image/jpeg,image/png,video/mp4" @change="onFileChange" />
              </label>
            </div>
            <div v-else class="photo-file">
              <i class="ri-file-image-line" aria-hidden="true"></i>
              <div class="file-meta">
                <strong>{{ file.name }}</strong>
                <span class="muted">{{ formatBytes(file.size) }} · {{ file.type }}</span>
              </div>
              <div class="photo-actions">
                <label class="btn btn-ghost btn-sm">更换<input class="sr-only" type="file" accept="image/jpeg,image/png,video/mp4" @change="onFileChange" /></label>
                <button class="btn btn-ghost btn-sm" type="button" @click="removeFile"><i class="ri-close-line" aria-hidden="true"></i>移除</button>
              </div>
            </div>
            <FieldError :message="local.file" />
            <img v-if="previewUrl" :src="previewUrl" class="photo-media" alt="本地文件预览（未上传）" />
            <div v-if="reading" class="progress-track" role="progressbar" :aria-valuenow="readProgress" aria-valuemin="0" aria-valuemax="100">
              <span class="progress-fill" :style="{ width: readProgress + '%' }" />
            </div>
            <div v-if="mediaRef" class="media-ref-row">
              <AppBadge label="媒体已登记" tone="good" icon-name="check" />
              <code class="code-chip">{{ mediaRef }}</code>
              <span v-if="ticketExpires" class="muted">凭证到期 {{ ticketExpires }}</span>
            </div>
            <div v-if="fileApiError" class="form-api-slot"><PublicErrorPanel :error="fileApiError" @retry="registerFile" /></div>
            <div v-if="isAnonymous" class="notice notice-info">
              <i class="ri-information-line notice-icon" aria-hidden="true"></i>
              <div class="notice-body"><div class="notice-title">匿名预览</div><div class="notice-text">你可以先选图、看流程；登录后才会进行媒体登记并允许提交。原始定位不会写入浏览器存储。</div></div>
            </div>

            <details class="report-boundary-inline">
              <summary><i class="ri-information-line" aria-hidden="true"></i>受理边界（短版）</summary>
              <ul class="plain-list">
                <li v-for="(item, i) in boundaries" :key="i">{{ item }}</li>
              </ul>
            </details>

            <div class="location-block">
              <div class="location-head"><strong>定位</strong><span class="muted">用于匹配岸段；页面不显示经纬度</span></div>
              <div v-if="!location" class="location-actions">
                <button class="btn btn-secondary" type="button" :disabled="locating" @click="requestLocation">
                  <i class="ri-map-pin-line" aria-hidden="true"></i>{{ locating ? '定位中…' : '获取定位' }}
                </button>
                <span class="muted">定位仅保存在内存；提交成功后立即清除。</span>
              </div>
              <div v-else class="location-ready">
                <i class="ri-checkbox-circle-line" aria-hidden="true"></i>
                <div><strong>定位已获取</strong><p class="muted">仅用于匹配岸段；不显示、不写地址栏、不写本地存储。</p></div>
                <button class="btn btn-ghost btn-sm" type="button" @click="clearLocation">清除</button>
              </div>
              <FieldError :message="locationError || local.location" />
            </div>

            <div class="form-actions">
              <button class="btn btn-primary" type="button" :disabled="!file" @click="step = 2">下一步：选类型与规模<i class="ri-arrow-right-line" aria-hidden="true"></i></button>
            </div>
          </SectionCard>

          <SectionCard v-show="step === 2" title="2. 选类型与规模" description="类别是本次上报的声明值；最终归属由审核人员判断。">
            <div v-if="usingFallbackOptions" class="notice notice-info">
              <i class="ri-information-line notice-icon" aria-hidden="true"></i>
              <div class="notice-body"><div class="notice-title">通用选项</div><div class="notice-text">当前账号未能读取业务字典，先用通用选项呈现；提交时仍由后端校验。登录运营账号后可看到完整字典。</div></div>
            </div>
            <div class="form-grid">
              <label class="field">
                <span class="field-label">垃圾类别<span class="req">*</span></span>
                <select v-model="category" class="select">
                  <option v-for="item in categories" :key="item.code" :value="item.code">{{ item.label }}</option>
                </select>
                <FieldError :message="local.category" />
              </label>
              <label class="field">
                <span class="field-label">规模<span class="req">*</span></span>
                <select v-model="scale" class="select">
                  <option v-for="item in scales" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
                <FieldError :message="local.scale" />
              </label>
            </div>
            <div class="form-actions">
              <button class="btn btn-ghost" type="button" @click="step = 1"><i class="ri-arrow-left-line" aria-hidden="true"></i>上一步</button>
              <button class="btn btn-primary" type="button" @click="step = 3">下一步：确认提交<i class="ri-arrow-right-line" aria-hidden="true"></i></button>
            </div>
            <p class="muted">定位可以在下一步补充；提交前需要完成，用于匹配岸段。</p>
          </SectionCard>

          <SectionCard v-show="step === 3" title="3. 确认提交" description="提交后你会得到受理编号；可以在「我的上报」查看三段进度。">
            <div v-if="!success" class="submit-summary">
              <div class="summary-row"><span class="summary-label">照片 / 视频</span><span>{{ file ? file.name : '未选择' }}</span></div>
              <div class="summary-row"><span class="summary-label">类型</span><span>{{ categories.find(c => c.code === category)?.label || '未选择' }}</span></div>
              <div class="summary-row"><span class="summary-label">规模</span><span>{{ scales.find(s => s.value === scale)?.label || '未选择' }}</span></div>
              <div class="summary-row"><span class="summary-label">定位</span><span>{{ location ? '已获取（仅上行）' : '未获取' }}</span></div>
            </div>
            <div v-if="!location" class="report-confirm-location is-missing">
              <div><strong>还差定位</strong><span>定位用于匹配岸段，不显示经纬度；提交前需要完成。</span></div>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="locating" @click="requestLocation">
                <i class="ri-map-pin-line" aria-hidden="true"></i>{{ locating ? '定位中…' : '获取定位' }}
              </button>
            </div>
            <div v-else class="report-confirm-location is-ready">
              <div><strong>定位已获取</strong><span>仅用于匹配岸段，提交成功后立即清除。</span></div>
              <i class="ri-checkbox-circle-line" aria-hidden="true"></i>
            </div>

            <form v-if="isAnonymous" class="report-inline-login" novalidate @submit.prevent="inlineLogin">
              <div class="report-inline-login-head">
                <i class="ri-lock-line" aria-hidden="true"></i>
                <div><strong>登录后提交</strong><p>登录会保留本页已填写的内容；不显示定位，也不改变匿名浏览。</p></div>
              </div>
              <div class="report-inline-login-grid">
                <label class="field">
                  <span class="field-label">账号<span class="req">*</span></span>
                  <input v-model="loginAccount" class="input" autocomplete="username" maxlength="32" placeholder="4–32 位字母、数字或下划线" :aria-invalid="loginLocal.account_id ? 'true' : null" />
                  <FieldError :message="loginLocal.account_id" />
                </label>
                <label class="field">
                  <span class="field-label">密码<span class="req">*</span></span>
                  <input v-model="loginPassword" class="input" type="password" autocomplete="current-password" maxlength="128" :aria-invalid="loginLocal.credential ? 'true' : null" />
                  <FieldError :message="loginLocal.credential" />
                </label>
              </div>
              <div class="form-actions">
                <button class="btn btn-primary" type="submit" :disabled="loginBusy">
                  <i class="ri-lock-line" aria-hidden="true"></i>{{ loginBusy ? '登录中…' : '登录并继续' }}
                </button>
                <button class="btn btn-link" type="button" @click="login">使用登录页</button>
              </div>
              <div v-if="loginError" class="form-error">{{ loginError.message }}</div>
              <p class="muted">没有账号？<a href="#/auth?mode=register">注册</a>。登录只用于提交，不改变匿名浏览。</p>
            </form>

            <div v-if="!isAnonymous && !canReport" class="notice notice-warning">
              <i class="ri-shield-line notice-icon" aria-hidden="true"></i>
              <div class="notice-body"><div class="notice-title">当前账号暂无上报权限</div><div class="notice-text">请使用有上报权限的账号，或返回首页继续浏览公开内容。</div></div>
            </div>

            <p class="report-submit-note">请确认信息据实、图片不含他人隐私；提交后进入审核，不承诺具体办理时限。</p>

            <div v-if="!success" class="form-actions">
              <button class="btn btn-ghost" type="button" @click="step = 2"><i class="ri-arrow-left-line" aria-hidden="true"></i>上一步</button>
              <button v-if="canReport" class="btn btn-primary btn-lg" type="button" :disabled="loading || !location || !file || !mediaRef" @click="submit">
                <i class="ri-send-plane-line" aria-hidden="true"></i>{{ loading ? '提交中…' : '确认提交' }}
              </button>
            </div>
            <div v-if="error" class="form-api-slot"><PublicErrorPanel :error="error" @retry="retry" /></div>
            <div v-if="success" class="success-panel report-success">
              <div class="success-icon"><i class="ri-check-line" aria-hidden="true"></i></div>
              <div class="success-copy">
                <h3>上报已收到</h3>
                <div class="chip-row">
                  <CopyCode :value="success.report_id" />
                  <StatusBadge enum-name="report_status" :value="success.report_status" />
                  <AppBadge v-if="success.matched_section_id" :label="'已匹配岸段 ' + success.matched_section_id" tone="info" icon-name="pin" />
                </div>
                <p class="muted">接下来会先审核，再视情况派单处置；状态以系统记录为准。原始定位已清除。</p>
              </div>
              <div class="success-actions">
                <button class="btn btn-secondary btn-sm" type="button" @click="navigate('/profile')"><i class="ri-list-check-2" aria-hidden="true"></i>我的上报</button>
              </div>
            </div>
          </SectionCard>
        </div>

        <aside class="report-aside">
          <Provenance title="受理范围与不予受理" :items="boundaries" />
          <div class="aside-card">
            <h3>提交前请确认</h3>
            <ul class="plain-list">
              <li>照片能看清垃圾与环境，不包含他人隐私信息。</li>
              <li>同一位置、同一类型的线索不要重复提交。</li>
              <li>遇到有害或危险物品，保持距离并上报，不要徒手处理。</li>
              <li>本站不承诺具体办理时限，也不替代执法与应急渠道。</li>
            </ul>
          </div>
          <div class="aside-card">
            <h3>接下来</h3>
            <div class="report-next-steps">
              <div><span>1</span><p><strong>已收到</strong>提交后得到受理编号。</p></div>
              <div><span>2</span><p><strong>处理中</strong>审核通过后可能转为工单。</p></div>
              <div><span>3</span><p><strong>已办结</strong>办结并录入清理量后进入公开统计。</p></div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  `,
};
