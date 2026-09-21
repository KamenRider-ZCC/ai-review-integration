<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import SectionTitle from '@/components/SectionTitle.vue';
import PreviewPanel from '@/components/PreviewPanel.vue';
import {
  getDifferences,
  getFilePreview,
  getReviewResult,
  saveFeedback,
} from '@/api/review';
import { readableError } from '@/api/http';
import {
  reportHostError,
  requestHostClose,
  startHostBridge,
  stopHostBridge,
} from '@/bridge/hostBridge';
import type { ReviewEntry } from '@/types/entry';
import type {
  DifferenceCurrentItem,
  DifferencesData,
  EvidenceItem,
  FilePreviewData,
  MatrixCoordinate,
  ReviewDecision,
  ReviewResultData,
} from '@/types/review';
import { parseReviewEntry } from '@/utils/entry';

const route = useRoute();
const router = useRouter();

const drawerVisible = ref(true);
const entry = ref<ReviewEntry | null>(null);
// 单项矩阵和全部不一致项使用不同接口返回，detail把两种模式统一为模板所需的当前记录。
const result = ref<ReviewResultData | null>(null);
const differences = ref<DifferencesData | null>(null);
const loading = ref(false);
const saving = ref(false);
const pageError = ref('');
const problemTypes = ref<string[]>([]);
const problemDescription = ref('');
// 反馈项的“是否存在问题”与“是否展开”是两个独立状态，行为与原型一致。
const feedbackSelected = ref(false);
const feedbackExpanded = ref(false);
const preview = ref<FilePreviewData | null>(null);
const previewLoading = ref(false);

const detail = computed<ReviewResultData | DifferenceCurrentItem | null>(() => {
  if (entry.value?.kind === 'differences') return differences.value?.currentItem ?? null;
  return result.value;
});

const isDifferencesMode = computed(() => entry.value?.kind === 'differences');
const feedback = computed(() => detail.value?.aiDecisionFeedback ?? null);
const feedbackEditable = computed(() => {
  if (!detail.value?.showAiDecisionFeedback) return false;
  if (isDifferencesMode.value) {
    // 可编辑权限以后端返回值为准，不能仅凭“当前专家”名称在前端推断。
    return Boolean((detail.value as DifferenceCurrentItem).feedbackEditable);
  }
  return true;
});

const isDetailed = computed(() => detail.value?.resultType === 'SCORE');
const drawerTitle = computed(() => detail.value?.reviewStageName || 'AI评标');
const drawerSubtitle = computed(() => {
  if (!detail.value) return '';
  return `${detail.value.bidder.bidderName} · 第 ${detail.value.reviewItem.reviewItemOrder} 项`;
});

const problemDescriptionRequired = computed(() => problemTypes.value.includes('其他'));
const canSave = computed(() => {
  if (
    !feedbackEditable.value ||
    !feedbackSelected.value ||
    saving.value ||
    problemTypes.value.length === 0
  ) return false;
  return !problemDescriptionRequired.value || Boolean(problemDescription.value.trim());
});

const previousDisabled = computed(() => {
  if (isDifferencesMode.value) return !differences.value?.previousCursor;
  return !result.value?.navigation.previous;
});

const nextDisabled = computed(() => {
  if (isDifferencesMode.value) return !differences.value?.nextCursor;
  return !result.value?.navigation.next;
});

function decisionLabel(value: ReviewDecision | null): string {
  if (value === 'QUALIFIED') return '合格';
  if (value === 'UNQUALIFIED') return '不合格';
  return '待评审';
}

function decisionClass(value: ReviewDecision | null): string {
  if (value === 'QUALIFIED') return 'is-pass';
  if (value === 'UNQUALIFIED') return 'is-fail';
  return 'is-pending';
}

function syncFeedbackForm() {
  problemTypes.value = [...(feedback.value?.problemTypes ?? [])];
  problemDescription.value = feedback.value?.problemDescription ?? '';
  const hasFeedback = Boolean(
    feedback.value?.completed ||
    problemTypes.value.length ||
    problemDescription.value.trim(),
  );
  feedbackSelected.value = hasFeedback;
  feedbackExpanded.value = hasFeedback;
}

function handleFeedbackSelection(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  feedbackSelected.value = checked;
  // 勾选表示准备填写反馈，原型会自动展开；取消勾选不会清空尚未提交的内容。
  if (checked) feedbackExpanded.value = true;
}

function toggleFeedbackExpanded() {
  feedbackExpanded.value = !feedbackExpanded.value;
}

function closePreview() {
  preview.value = null;
  previewLoading.value = false;
}

async function loadEntry(targetEntry = entry.value) {
  if (!targetEntry) return;
  loading.value = true;
  pageError.value = '';
  closePreview();
  try {
    // 有矩阵坐标查询单项结果；无坐标则加载后端维护的全部专家不一致项列表。
    if (targetEntry.kind === 'matrix') {
      result.value = await getReviewResult(targetEntry);
      differences.value = null;
    } else {
      differences.value = await getDifferences(targetEntry.reviewId);
      result.value = null;
    }
    syncFeedbackForm();
  } catch (error) {
    pageError.value = readableError(error);
    reportHostError(pageError.value);
  } finally {
    loading.value = false;
  }
}

async function loadDifferenceCursor(cursor: string) {
  if (entry.value?.kind !== 'differences') return;
  loading.value = true;
  pageError.value = '';
  closePreview();
  try {
    differences.value = await getDifferences(entry.value.reviewId, cursor);
    syncFeedbackForm();
  } catch (error) {
    pageError.value = readableError(error);
  } finally {
    loading.value = false;
  }
}

async function loadCoordinate(coordinate: MatrixCoordinate) {
  if (entry.value?.kind !== 'matrix') return;
  const nextEntry = { ...entry.value, ...coordinate };
  loading.value = true;
  pageError.value = '';
  closePreview();
  try {
    result.value = await getReviewResult(nextEntry);
    entry.value = nextEntry;
    // 同步URL便于刷新后仍停留在当前评审项，也方便现场联调复现问题。
    await router.replace({
      path: '/ai-review/page',
      query: {
        reviewId: nextEntry.reviewId,
        action: nextEntry.action,
        reviewStage: nextEntry.reviewStage,
        reviewItemId: nextEntry.reviewItemId,
        bidderId: nextEntry.bidderId,
      },
    });
    syncFeedbackForm();
  } catch (error) {
    pageError.value = readableError(error);
  } finally {
    loading.value = false;
  }
}

async function navigate(direction: 'previous' | 'next') {
  if (loading.value) return;
  // 不一致项按cursor翻页；普通矩阵模式按后端给出的前后坐标导航。
  if (isDifferencesMode.value) {
    const cursor =
      direction === 'previous' ? differences.value?.previousCursor : differences.value?.nextCursor;
    if (cursor) await loadDifferenceCursor(cursor);
    return;
  }
  const coordinate =
    direction === 'previous' ? result.value?.navigation.previous : result.value?.navigation.next;
  if (coordinate) await loadCoordinate(coordinate);
}

async function submitFeedback() {
  const current = detail.value;
  if (!current || !canSave.value) return;
  saving.value = true;
  try {
    await saveFeedback(current.reviewId, {
      reviewStage: current.reviewStage,
      reviewItemId: current.reviewItem.reviewItemId,
      bidderId: current.bidder.bidderId,
      problemTypes: [...problemTypes.value],
      problemDescription: problemDescription.value.trim() || null,
    });
    message.success(feedback.value?.completed ? 'AI判定反馈已更新' : 'AI判定反馈已保存');
    // 保存后重新读取服务端数据，以服务端统计数、完成状态和权限为准。
    if (entry.value?.kind === 'differences') {
      await loadDifferenceCursor(differences.value?.currentCursor ?? '');
    } else {
      await loadEntry();
    }
  } catch (error) {
    message.error(readableError(error));
  } finally {
    saving.value = false;
  }
}

async function openEvidence(item: EvidenceItem) {
  const current = detail.value;
  if (!current) return;
  previewLoading.value = true;
  preview.value = null;
  try {
    preview.value = await getFilePreview(current.reviewId, item.fileId, item.evidenceId);
  } catch (error) {
    message.error(readableError(error));
  } finally {
    previewLoading.value = false;
  }
}

async function navigateEvidence(direction: 'previous' | 'next') {
  const current = preview.value;
  const adjacent = direction === 'previous' ? current?.previousPosition : current?.nextPosition;
  if (!current || !adjacent || !detail.value) return;
  previewLoading.value = true;
  try {
    preview.value = await getFilePreview(
      detail.value.reviewId,
      adjacent.fileId,
      adjacent.evidenceId,
    );
  } catch (error) {
    message.error(readableError(error));
  } finally {
    previewLoading.value = false;
  }
}

function closeDrawer() {
  drawerVisible.value = false;
  // 抽屉动画和DOM属于AI页面，iframe的最终销毁及宿主滚动恢复由Loader完成。
  requestHostClose();
}

onMounted(async () => {
  startHostBridge(() => {
    drawerVisible.value = false;
  });
  try {
    // 在任何接口调用前验证入口参数，避免用不完整坐标请求后端。
    entry.value = parseReviewEntry(route.query);
    await nextTick();
    await loadEntry();
  } catch (error) {
    pageError.value = readableError(error);
    reportHostError(pageError.value);
  }
});

onUnmounted(() => stopHostBridge());
</script>

<template>
  <PreviewPanel
    v-if="preview || previewLoading"
    :preview="preview"
    :loading="previewLoading"
    :title="detail?.bidder.bidderName"
    @close="closePreview"
    @navigate="navigateEvidence"
  />

  <a-drawer
    :visible="drawerVisible"
    :width="560"
    :body-style="{ padding: '0', overflow: 'hidden' }"
    :mask-closable="true"
    :closable="false"
    placement="right"
    class="ai-review-drawer"
    @close="closeDrawer"
  >
    <template #title>
      <div class="drawer-title">
        <strong>{{ drawerTitle }}</strong>
        <span>{{ drawerSubtitle }}</span>
        <button type="button" aria-label="关闭AI评标" @click.stop="closeDrawer">
          ×
        </button>
      </div>
    </template>

    <div class="drawer-layout">
      <main class="drawer-body">
        <a-spin v-if="loading && !detail" class="center-spin" tip="正在加载AI评审结果…" />

        <a-alert
          v-else-if="pageError"
          type="error"
          show-icon
          :message="pageError"
          class="state-alert"
        >
          <template #action>
            <a-button size="small" @click="loadEntry()">重新加载</a-button>
          </template>
        </a-alert>

        <a-empty
          v-else-if="isDifferencesMode && differences && !differences.currentItem"
          description="暂无需要反馈的评审项"
          class="empty-state"
        />

        <template v-else-if="detail">
          <a-alert
            v-if="isDifferencesMode && differences"
            type="info"
            show-icon
            class="difference-overview"
          >
            <template #message>
              全部专家不一致项 {{ differences.completedFeedbackCount }}/{{ differences.totalCount }} 已完成反馈
            </template>
            <template #description>
              当前记录：{{ (detail as DifferenceCurrentItem).expert.appAccountAccountName }}；
              {{ feedbackEditable ? '您可以编辑本人反馈。' : '其他专家记录仅供查看。' }}
            </template>
          </a-alert>

          <section class="review-section">
            <SectionTitle :title="isDetailed ? '评审内容' : '评审项'" />
            <div class="rule-card">
              {{ detail.reviewItem.reviewContent || detail.reviewItem.reviewRule || detail.reviewItem.reviewItemName }}
            </div>
          </section>

          <section v-if="detail.aiReviewStatus === 'AI_REVIEWING'" class="review-section">
            <SectionTitle title="AI 评审" />
            <div class="ai-running">
              <i class="spinner" aria-hidden="true"></i>
              <span>
                {{ isDetailed
                  ? 'AI 正在评分中，请稍候…（可先进行专家评分）'
                  : 'AI 正在评审中，请稍候…（可先进行专家评审）' }}
              </span>
            </div>
          </section>

          <section v-else-if="detail.aiReviewStatus === 'FAILED'" class="review-section">
            <SectionTitle title="AI 评审" />
            <a-alert type="error" show-icon message="AI评审未能完成，请稍后重新进入查看" />
          </section>

          <template v-else>
            <section class="review-section">
              <SectionTitle :title="isDetailed ? 'AI 建议评分结果' : 'AI 建议评审结果'" />
              <div class="result-card ai-result-card">
                <span>{{ isDetailed ? 'AI 评分：' : 'AI 判定：' }}</span>
                <span v-if="isDetailed" class="detail-ai-score">
                  {{ detail.aiResult.aiScore ?? '—' }}
                </span>
                <span
                  v-else
                  class="result-badge"
                  :class="decisionClass(detail.aiResult.aiReviewResult)"
                >
                  {{ decisionLabel(detail.aiResult.aiReviewResult) }}
                </span>
                <span
                  v-if="isDetailed && detail.aiResult.scoreType"
                  class="score-type"
                  :class="detail.aiResult.scoreType === 'SUBJECTIVE' ? 'is-subjective' : 'is-objective'"
                >
                  {{ detail.aiResult.scoreType === 'SUBJECTIVE' ? '主观项' : '客观项' }}
                </span>
              </div>
            </section>

            <section v-if="detail.aiReviewSummary" class="review-section">
              <SectionTitle :title="detail.aiReviewSummary.summaryName.replace(/^AI/, 'AI ')" />
              <div class="evidence-list">
                <article
                  v-for="(evidence, index) in detail.aiReviewSummary.evidenceItems"
                  :key="evidence.evidenceId"
                  class="evidence-card"
                >
                  <header>
                    <span class="evidence-index">
                      {{ detail.aiReviewSummary.evidenceItems.length > 1 ? `评审项 ${index + 1}` : '评审项' }}
                    </span>
                    <a-button type="link" size="small" @click="openEvidence(evidence)">
                      查看投标文件原文 ›
                    </a-button>
                  </header>
                  <div class="evidence-body">
                    <div class="evidence-row">
                      <span>评审细则</span>
                      <p>{{ detail.aiReviewSummary.ruleText }}</p>
                    </div>
                    <div class="evidence-row">
                      <span>评审依据</span>
                      <blockquote>
                        {{ evidence.quote }}（定位：{{ evidence.locationText }}）
                      </blockquote>
                    </div>
                    <div class="evidence-row">
                      <span>评审结论</span>
                      <p>{{ detail.aiReviewSummary.conclusion }}</p>
                    </div>
                  </div>
                </article>
              </div>
            </section>
          </template>
        </template>
      </main>

      <section
        v-if="detail?.showAiDecisionFeedback && feedback"
        class="feedback-section fixed-feedback"
      >
        <SectionTitle title="AI判定反馈" />
        <a-alert
          v-if="!feedbackEditable"
          type="info"
          show-icon
          message="该反馈属于其他专家，仅可查看"
          class="readonly-alert"
        />
        <div class="feedback-tip"><b>*</b> 请选择存在问题的评审项（可多选）</div>
        <p class="feedback-sub">仅需选择您认为AI判定存在问题的评审项。</p>
        <div class="feedback-list">
          <div class="feedback-item">
            <div
              class="feedback-item-head"
              role="button"
              :aria-expanded="feedbackExpanded"
              tabindex="0"
              @click="toggleFeedbackExpanded"
              @keydown.enter.prevent="toggleFeedbackExpanded"
              @keydown.space.prevent="toggleFeedbackExpanded"
            >
              <a-checkbox
                :checked="feedbackSelected"
                :disabled="!feedbackEditable"
                @click.stop
                @change="handleFeedbackSelection"
              >
                评审项
              </a-checkbox>
              <button
                type="button"
                class="feedback-toggle"
                :title="feedbackExpanded ? '收起' : '展开'"
                :aria-label="feedbackExpanded ? '收起评审项反馈' : '展开评审项反馈'"
                @click.stop="toggleFeedbackExpanded"
              >
                {{ feedbackExpanded ? '⌄' : '›' }}
              </button>
            </div>
            <div v-show="feedbackExpanded" class="feedback-item-body">
              <label class="field-label"><b>*</b> 问题类型（可多选）</label>
              <a-checkbox-group
                v-model:value="problemTypes"
                :options="feedback.problemTypeOptions"
                :disabled="!feedbackEditable"
                class="problem-options"
              />
              <label class="field-label">
                <b v-if="problemDescriptionRequired">*</b>
                问题说明
              </label>
              <textarea
                v-model="problemDescription"
                class="feedback-note"
                :disabled="!feedbackEditable"
                maxlength="200"
                :placeholder="problemDescriptionRequired
                  ? '（必填）请填写具体问题说明，您的反馈将帮助我们持续优化。'
                  : '（选填）请指出AI评审中的不足之处，您的反馈将帮助我们持续优化。如：AI识别链接文件错误、资质证明漏判或误判等。'"
              />
              <div class="feedback-count">{{ problemDescription.length }}/200</div>
            </div>
          </div>
        </div>
        <div
          v-if="detail.differenceDescription"
          class="difference-alert"
        >
          ⚠ {{ detail.differenceDescription }}
        </div>
      </section>

      <section v-if="detail" class="expert-fixed">
        <div class="result-card expert-result-card">
          <span>{{ isDetailed ? '专家打分：' : '专家评审：' }}</span>
          <strong v-if="isDetailed" class="score-text expert-score">
            {{ detail.expertResult.expertScore ?? '待评分' }}
          </strong>
          <span v-if="isDetailed && detail.expertResult.expertScore" class="score-unit">分</span>
          <span
            v-else
            class="result-badge"
            :class="decisionClass(detail.expertResult.expertReviewResult)"
          >
            {{ decisionLabel(detail.expertResult.expertReviewResult) }}
          </span>
        </div>
      </section>

      <footer class="drawer-footer">
        <a-button @click="closeDrawer">
          关闭
        </a-button>
        <a-button :disabled="previousDisabled || loading" @click="navigate('previous')">
          上一项
        </a-button>
        <a-button :disabled="nextDisabled || loading" @click="navigate('next')">
          下一项
        </a-button>
        <a-button
          type="primary"
          :disabled="!detail?.showAiDecisionFeedback || !canSave"
          :loading="saving"
          @click="submitFeedback"
        >
          保存
        </a-button>
      </footer>
    </div>
  </a-drawer>
</template>

<style scoped>
.drawer-title {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.drawer-title strong {
  flex-shrink: 0;
  color: #222;
  font-size: 15px;
}

.drawer-title span {
  min-width: 0;
  overflow: hidden;
  color: var(--ai-text-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-title button {
  display: grid;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  place-items: center;
  margin-left: auto;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #999;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.drawer-title button:hover {
  background: var(--ai-border-light);
  color: #333;
}

.drawer-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.drawer-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px 24px;
}

.center-spin,
.empty-state {
  display: grid;
  min-height: 360px;
  place-items: center;
}

.state-alert,
.difference-overview {
  margin-bottom: 18px;
}

.review-section {
  margin-bottom: 20px;
}

.rule-card,
.summary-card {
  border: 1px solid var(--ai-border-light);
  border-radius: 2px;
  background: var(--ai-bg);
  padding: 10px 12px;
  color: var(--ai-text-2);
  font-size: 13px;
  line-height: 1.7;
}

.result-card {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--ai-border-light);
  border-radius: 2px;
  padding: 12px 14px;
  color: var(--ai-text-2);
  font-size: 13px;
}

.ai-result-card {
  background: var(--ai-primary-tint);
}

.ai-running {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px dashed #91caff;
  border-radius: 2px;
  background: var(--ai-primary-tint);
  padding: 14px;
  color: var(--ai-primary);
  font-size: 13px;
}

.spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 2px solid #bae0ff;
  border-top-color: var(--ai-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.expert-result-card {
  background: #fbfcff;
}

.result-badge,
.score-type {
  display: inline-flex;
  height: 24px;
  align-items: center;
  border: 1px solid;
  border-radius: 2px;
  padding: 0 12px;
  font-weight: 500;
}

.result-badge.is-pass {
  border-color: #b7eb8f;
  background: #f6ffed;
  color: var(--ai-success);
}

.result-badge.is-fail {
  border-color: #ffccc7;
  background: #fff1f0;
  color: var(--ai-danger);
}

.result-badge.is-pending {
  border-color: var(--ai-border-light);
  background: #f1f4f9;
  color: var(--ai-text-3);
}

.score-text {
  color: var(--ai-primary);
  font-size: 20px;
}

.detail-ai-score {
  display: inline-flex;
  height: 24px;
  align-items: center;
  padding: 0 12px;
  color: #333;
  font-size: 13px;
  font-weight: 500;
}

.expert-score {
  color: var(--ai-primary);
}

.score-type {
  height: 22px;
  margin-left: auto;
  font-size: 12px;
}

.score-type.is-subjective {
  border-color: #f5d9a8;
  background: #fff7e6;
  color: #d97706;
}

.score-type.is-objective {
  border-color: #b3d9f7;
  background: #e6f7ff;
  color: #2563eb;
}

.evidence-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.evidence-card {
  overflow: hidden;
  border: 1px solid var(--ai-border-light);
  border-radius: 2px;
  background: #fff;
}

.evidence-card header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ai-border-light);
  background: var(--ai-table-head);
}

.evidence-index {
  display: inline-flex;
  height: 18px;
  flex-shrink: 0;
  align-items: center;
  border: 1px solid #91caff;
  border-radius: 2px;
  background: var(--ai-primary-soft);
  padding: 1px 6px;
  color: var(--ai-primary);
  font-size: 11px;
}

.evidence-card header :deep(.ant-btn-link) {
  height: auto;
  margin-left: auto;
  padding: 0;
  font-size: 12px;
}

.evidence-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
}

.evidence-row {
  display: flex;
  gap: 8px;
  color: #333;
  font-size: 13px;
  line-height: 1.65;
}

.evidence-row > span {
  width: 62px;
  flex-shrink: 0;
  color: var(--ai-text-3);
}

.evidence-row p {
  flex: 1;
  margin: 0;
  color: #333;
}

.evidence-row blockquote {
  flex: 1;
  margin: 0;
  border-left: 3px solid var(--ai-primary);
  background: var(--ai-bg);
  padding: 8px 10px;
  color: var(--ai-text-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.feedback-section {
  margin: 0;
}

.fixed-feedback {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  background: #fff;
  padding: 14px 20px 16px;
  box-shadow: 0 -6px 14px rgb(0 0 0 / 7%);
}

.fixed-feedback :deep(.section-title) {
  margin-bottom: 8px;
}

.readonly-alert {
  margin-bottom: 14px;
}

.feedback-tip {
  color: #222;
  font-size: 13px;
  font-weight: 500;
}

.feedback-tip b {
  color: var(--ai-danger);
}

.feedback-sub {
  margin: 3px 0 10px;
  color: var(--ai-text-2);
  font-size: 12px;
}

.feedback-list {
  max-height: 220px;
  overflow-y: auto;
}

.feedback-item {
  overflow: hidden;
  border: 1px solid var(--ai-border-light);
  border-radius: 2px;
  margin-bottom: 8px;
}

.feedback-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--ai-table-head);
  padding: 6px 10px;
  color: var(--ai-text-2);
  cursor: pointer;
}

.feedback-item-head :deep(.ant-checkbox-wrapper) {
  min-width: 0;
  overflow: hidden;
  color: #333;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feedback-toggle {
  border: 0;
  background: transparent;
  padding: 0 4px;
  color: var(--ai-text-2);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.feedback-toggle:hover {
  color: var(--ai-primary);
}

.feedback-item-body {
  border-top: 1px dashed var(--ai-border-light);
  background: #fafbfc;
  padding: 8px 10px 10px;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 6px 0;
  color: var(--ai-text-2);
  font-size: 12px;
}

.field-label b {
  color: var(--ai-danger);
}

.problem-options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.problem-options :deep(.ant-checkbox-wrapper) {
  margin: 0;
  color: #333;
  font-size: 12.5px;
}

.feedback-note {
  width: 100%;
  min-height: 54px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--ai-border);
  border-radius: 2px;
  outline: none;
  padding: 6px 8px;
  color: #333;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.6;
}

.feedback-note:focus {
  border-color: var(--ai-primary);
}

.feedback-note:disabled {
  background: #f5f5f5;
  color: var(--ai-text-3);
}

.feedback-count {
  margin-top: 2px;
  color: var(--ai-text-3);
  font-size: 11px;
  text-align: right;
}

.score-unit {
  margin-left: -6px;
  color: var(--ai-text-2);
  font-size: 13px;
}

.difference-alert {
  margin-top: 10px;
  border: 1px solid #ffd591;
  border-radius: 2px;
  background: #fff7e6;
  padding: 8px 10px;
  color: var(--ai-warning);
  font-size: 12.5px;
  line-height: 1.6;
}

.expert-fixed {
  flex-shrink: 0;
  border-top: 1px solid var(--ai-border-light);
  background: #fff;
  padding: 14px 20px 0;
}

.expert-fixed .expert-result-card {
  margin-bottom: 14px;
}

.drawer-footer {
  display: flex;
  height: 56px;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--ai-border);
  background: #fff;
  padding: 0 20px;
}

.drawer-footer :deep(.ant-btn) {
  height: 30px;
  border-radius: 2px;
  padding: 0 18px;
  font-size: 13px;
}

.drawer-footer :deep(.ant-btn-primary:disabled) {
  border-color: #bfdcf7;
  background: #bfdcf7;
  color: #fff;
}
</style>

<style>
.ai-review-drawer .ant-drawer-content-wrapper {
  max-width: 92vw;
}

.ai-review-drawer .ant-drawer-header {
  height: 52px;
  padding: 0 20px;
}

.ai-review-drawer .ant-drawer-title {
  min-width: 0;
}

.ai-review-drawer .ant-drawer-body {
  height: calc(100% - 52px);
}

.ai-review-drawer .ant-drawer-content-wrapper {
  box-shadow: -4px 0 16px rgb(0 0 0 / 12%);
}
</style>
