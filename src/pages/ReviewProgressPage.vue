<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import { CaretRightOutlined, ReloadOutlined } from '@ant-design/icons-vue';
import { getReviewProgress, retryFile } from '@/api/review';
import { readableError } from '@/api/http';
import {
  reportHostError,
  requestHostResize,
  startHostBridge,
  stopHostBridge,
} from '@/bridge/hostBridge';
import type { ProcessStatus, ProgressFile, ReviewProgressData } from '@/types/review';
import { parseProgressEntry } from '@/utils/entry';

const route = useRoute();
const reviewId = ref('');
const progress = ref<ReviewProgressData | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const collapsed = ref(false);
const expanded = ref(new Set(['fileParsing']));
const retrying = ref(new Set<string>());
let pollingTimer: number | undefined;

const tenderFiles = computed(() =>
  (progress.value?.fileParsing.files ?? []).filter((file) => file.fileType === 'TENDER_FILE'),
);
const bidFiles = computed(() =>
  (progress.value?.fileParsing.files ?? []).filter((file) => file.fileType === 'BID_FILE'),
);

function statusText(status: ProcessStatus): string {
  const mapping: Record<ProcessStatus, string> = {
    PENDING: '待开始',
    PROCESSING: '进行中',
    AI_REVIEWING: '进行中',
    COMPLETED: '已完成',
    FAILED: '处理异常',
  };
  return mapping[status];
}

function statusClass(status: ProcessStatus): string {
  return `is-${status.toLowerCase().replace('_', '-')}`;
}

function clearPolling() {
  window.clearTimeout(pollingTimer);
  pollingTimer = undefined;
}

function schedulePolling() {
  clearPolling();
  const data = progress.value;
  // 是否轮询及间隔均由后端返回；页面隐藏时暂停，避免后台标签持续请求。
  if (!data?.pollingRequired || document.hidden) return;
  pollingTimer = window.setTimeout(
    () => void loadProgress(false),
    Math.max(3, data.pollingIntervalSeconds) * 1000,
  );
}

async function loadProgress(showLoading = true) {
  if (!reviewId.value) return;
  if (showLoading) loading.value = true;
  errorMessage.value = '';
  try {
    progress.value = await getReviewProgress(reviewId.value);
    schedulePolling();
  } catch (error) {
    errorMessage.value = readableError(error);
    reportHostError(errorMessage.value);
    clearPolling();
  } finally {
    loading.value = false;
  }
}

async function handleRetry(file: ProgressFile) {
  if (!file.retryable || retrying.value.has(file.fileId)) return;
  // 使用Set记录进行中的文件，防止用户连续点击产生重复重试任务。
  retrying.value.add(file.fileId);
  retrying.value = new Set(retrying.value);
  try {
    await retryFile(reviewId.value, file.fileId);
    message.success('重新解析已受理');
    await loadProgress(false);
  } catch (error) {
    message.error(readableError(error));
  } finally {
    retrying.value.delete(file.fileId);
    retrying.value = new Set(retrying.value);
  }
}

function toggleSection(section: string) {
  const next = new Set(expanded.value);
  if (next.has(section)) next.delete(section);
  else next.add(section);
  expanded.value = next;
}

function setCollapsed(value: boolean) {
  collapsed.value = value;
  // iframe宽度由宿主Loader控制，子页面只提出期望宽度。
  requestHostResize(value ? 52 : 376);
}

function onVisibilityChange() {
  // 页面重新可见时立即刷新一次，避免等待旧定时器造成进度滞后。
  if (document.hidden) clearPolling();
  else void loadProgress(false);
}

onMounted(async () => {
  startHostBridge(() => undefined);
  try {
    reviewId.value = parseProgressEntry(route.query).reviewId;
    await loadProgress();
  } catch (error) {
    errorMessage.value = readableError(error);
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  clearPolling();
  stopHostBridge();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <button
    v-if="collapsed"
    type="button"
    class="progress-mini"
    aria-label="展开AI评审进度"
    @click="setCollapsed(false)"
  >
    <span class="mini-spinner"></span>
    <span class="mini-text">AI评审进度</span>
    <b class="mini-percent">{{ progress?.overallProgress ?? 0 }}%</b>
  </button>

  <aside v-else class="progress-panel" aria-label="AI评审进度">
    <header class="progress-header">
      <div class="progress-title">
        <span class="status-dot"></span>
        <strong>AI评审进度</strong>
        <div v-if="progress" class="header-progress">
          <span class="header-progress-track">
            <i :style="{ width: `${progress.overallProgress}%` }"></i>
          </span>
          <span>{{ progress.overallProgress >= 100 ? '已完成' : `${progress.overallProgress}%` }}</span>
        </div>
      </div>
      <button type="button" aria-label="收起AI评审进度" @click="setCollapsed(true)">
        »
      </button>
    </header>

    <div class="progress-body">
      <a-spin v-if="loading && !progress" tip="正在查询进度…" class="progress-loading" />
      <a-alert
        v-else-if="errorMessage"
        type="error"
        show-icon
        :message="errorMessage"
        class="progress-error"
      >
        <template #action>
          <a-button size="small" @click="loadProgress()">重试</a-button>
        </template>
      </a-alert>

      <template v-else-if="progress">
        <section class="progress-stage">
          <button type="button" class="stage-heading" @click="toggleSection('fileParsing')">
            <span>文件解析</span>
            <small>{{ progress.fileParsing.completedCount }}/{{ progress.fileParsing.totalCount }}</small>
            <b :class="statusClass(progress.fileParsing.status)">
              {{ statusText(progress.fileParsing.status) }}
            </b>
            <CaretRightOutlined :class="{ expanded: expanded.has('fileParsing') }" />
          </button>

          <div v-if="expanded.has('fileParsing')" class="stage-content">
            <h3>招标文件</h3>
            <div
              v-for="file in tenderFiles"
              :key="file.fileId"
              class="file-row"
              :class="statusClass(file.status)"
              :title="file.failureReason || file.fileName"
            >
              <span class="file-icon">PDF</span>
              <div class="file-main">
                <span :title="file.fileName">{{ file.fileName }}</span>
              </div>
              <span class="file-status" :class="statusClass(file.status)">
                {{ file.status === 'PROCESSING' ? `解析中 ${file.progress}%` : statusText(file.status) }}
              </span>
              <a-button
                v-if="file.retryable"
                type="link"
                size="small"
                :loading="retrying.has(file.fileId)"
                @click="handleRetry(file)"
              >
                <template #icon><ReloadOutlined /></template>
                重新解析
              </a-button>
            </div>

            <h3>投标文件（{{ bidFiles.length }}家）</h3>
            <div
              v-for="file in bidFiles"
              :key="file.fileId"
              class="file-row"
              :class="statusClass(file.status)"
              :title="file.failureReason || file.fileName"
            >
              <span class="file-icon">PDF</span>
              <div class="file-main">
                <span :title="file.fileName">{{ file.bidderName || file.fileName }}</span>
              </div>
              <span class="file-status" :class="statusClass(file.status)">
                {{ file.status === 'PROCESSING' ? `解析中 ${file.progress}%` : statusText(file.status) }}
              </span>
              <a-button
                v-if="file.retryable"
                type="link"
                size="small"
                :loading="retrying.has(file.fileId)"
                @click="handleRetry(file)"
              >
                <template #icon><ReloadOutlined /></template>
                重新解析
              </a-button>
            </div>
          </div>
        </section>

        <section class="progress-stage">
          <button type="button" class="stage-heading" @click="toggleSection('preliminaryReview')">
            <span>初步评审</span>
            <b :class="statusClass(progress.preliminaryReview.status)">
              {{ statusText(progress.preliminaryReview.status) }}
            </b>
            <CaretRightOutlined :class="{ expanded: expanded.has('preliminaryReview') }" />
          </button>
          <div v-if="expanded.has('preliminaryReview')" class="stage-content stage-list">
            <div
              v-for="stage in progress.preliminaryReview.stages"
              :key="stage.reviewStage"
              :class="statusClass(stage.status)"
            >
              <span>{{ stage.reviewStageName }}</span>
              <b :class="statusClass(stage.status)">{{ statusText(stage.status) }}</b>
            </div>
          </div>
        </section>

        <section class="progress-stage">
          <div class="stage-heading static">
            <span>详细评审</span>
            <b :class="statusClass(progress.detailedReview.status)">
              {{ statusText(progress.detailedReview.status) }}
            </b>
          </div>
        </section>

        <p class="updated-at">更新时间：{{ new Date(progress.updatedAt).toLocaleString() }}</p>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.progress-panel {
  position: absolute;
  top: 50%;
  right: 14px;
  display: flex;
  width: 348px;
  max-height: 76vh;
  flex-direction: column;
  transform: translateY(-50%);
  overflow: hidden;
  border: 1px solid var(--ai-border);
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
}

.progress-header {
  display: flex;
  height: 44px;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ai-border-light);
}

.progress-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ai-primary);
}

.progress-header strong {
  flex-shrink: 0;
  color: #222;
  font-size: 14px;
}

.header-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
  border: 1px solid var(--ai-border-light);
  border-radius: 10px;
  background: #f2f5fa;
  padding: 2px 8px;
  color: var(--ai-text-3);
  font-size: 11px;
  font-weight: 600;
}

.header-progress-track {
  width: 56px;
  height: 5px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 3px;
  background: #e6ebf3;
}

.header-progress-track i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--ai-primary), #4d8bff);
  transition: width 0.4s ease;
}

.progress-header button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  margin-left: auto;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: var(--ai-text-3);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.progress-header button:hover {
  background: var(--ai-border-light);
  color: #333;
}

.progress-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 14px 14px;
}

.progress-loading {
  display: grid;
  min-height: 280px;
  place-items: center;
}

.progress-error {
  margin-top: 8px;
}

.progress-stage {
  overflow: hidden;
  margin-bottom: 8px;
  border: 1px solid var(--ai-border-light);
  border-radius: 8px;
  background: #fff;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.progress-stage:hover {
  border-color: #b7d3ff;
  box-shadow: 0 1px 6px rgb(47 111 237 / 6%);
}

.stage-heading {
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  border: 0;
  background: #fff;
  padding: 9px 10px;
  color: #1f2d3d;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.stage-heading:hover {
  background: var(--ai-primary-tint);
}

.stage-heading.static {
  cursor: default;
}

.stage-heading > span:first-child {
  flex: 1;
}

.stage-heading small {
  flex-shrink: 0;
  border: 1px solid var(--ai-border-light);
  border-radius: 10px;
  background: #f4f6fa;
  padding: 1px 7px;
  color: var(--ai-text-2);
  font-size: 11px;
  font-weight: 600;
}

.stage-heading b,
.file-status,
.stage-list b {
  border-radius: 10px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.stage-heading b.is-completed,
.file-status.is-completed,
.stage-list b.is-completed {
  background: #e8f7ee;
  color: var(--ai-success);
}

.stage-heading b.is-processing,
.stage-heading b.is-ai-reviewing,
.file-status.is-processing,
.file-status.is-ai-reviewing,
.stage-list b.is-processing,
.stage-list b.is-ai-reviewing {
  background: #eaf1ff;
  color: var(--ai-primary);
}

.stage-heading b.is-pending,
.file-status.is-pending,
.stage-list b.is-pending {
  background: #f1f4f7;
  color: var(--ai-text-3);
}

.stage-heading b.is-failed,
.file-status.is-failed,
.stage-list b.is-failed {
  background: #fdeeee;
  color: var(--ai-danger);
}

.stage-heading :deep(.anticon) {
  width: 12px;
  flex-shrink: 0;
  color: #a0aab2;
  font-size: 10px;
  transition: transform 0.2s ease;
}

.stage-heading :deep(.anticon.expanded) {
  transform: rotate(90deg);
}

.stage-content {
  border-top: 1px solid var(--ai-border-light);
  padding: 4px 10px 10px;
}

.stage-content h3 {
  margin: 6px 0 2px;
  color: var(--ai-text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.file-row {
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 5px 0 5px 20px;
  color: #333;
  font-size: 12.5px;
}

.file-row::after {
  position: absolute;
  z-index: 0;
  top: -5px;
  bottom: -5px;
  left: 8px;
  width: 1px;
  background: var(--ai-border-light);
  content: '';
}

.file-row::before {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 0;
  display: inline-flex;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #c6ccd6;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  content: '';
}

.file-row.is-completed::before {
  background: var(--ai-success);
  content: '✓';
}

.file-row.is-failed::before {
  background: var(--ai-danger);
  content: '✕';
}

.file-row.is-processing::before {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--ai-primary);
  border-top-color: transparent;
  background: #fff;
  animation: timeline-spin 0.8s linear infinite;
}

@keyframes timeline-spin {
  from {
    transform: translateY(-50%) rotate(0deg);
  }

  to {
    transform: translateY(-50%) rotate(360deg);
  }
}

.file-icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #e34f4f;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
}

.file-main {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.file-main > span {
  overflow: hidden;
  color: #333;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-row.is-completed .file-status,
.file-row.is-failed .file-status {
  display: none;
}

.stage-list {
  display: grid;
}

.stage-list > div {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0 5px 20px;
  color: #333;
  font-size: 12.5px;
}

.stage-list > div::before {
  position: absolute;
  top: 50%;
  left: 0;
  display: inline-flex;
  width: 14px;
  height: 14px;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  border: 1.5px solid #c6ccd6;
  border-radius: 50%;
  background: #fff;
  font-size: 9px;
  font-weight: 700;
  content: '';
}

.stage-list > div.is-completed::before {
  border-color: var(--ai-success);
  background: var(--ai-success);
  color: #fff;
  content: '✓';
}

.stage-list > div.is-failed::before {
  border-color: var(--ai-danger);
  background: var(--ai-danger);
  color: #fff;
  content: '✕';
}

.stage-list > div.is-processing::before {
  border-color: var(--ai-primary);
  border-top-color: transparent;
  animation: timeline-spin 0.8s linear infinite;
}

.updated-at {
  display: none;
}

.progress-mini {
  position: absolute;
  top: 50%;
  right: 14px;
  display: flex;
  width: 38px;
  transform: translateY(-50%);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--ai-border);
  border-radius: 4px;
  background: #fff;
  padding: 10px 4px;
  color: var(--ai-primary);
  box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
  cursor: pointer;
  user-select: none;
}

.mini-spinner {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: 2px solid var(--ai-primary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: mini-spin 1.2s linear infinite;
}

@keyframes mini-spin {
  to {
    transform: rotate(360deg);
  }
}

.mini-text {
  writing-mode: vertical-rl;
  color: var(--ai-text-2);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
}

.mini-percent {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid #cfe4ff;
  border-radius: 50%;
  background: var(--ai-primary-tint);
  color: var(--ai-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
}
</style>
