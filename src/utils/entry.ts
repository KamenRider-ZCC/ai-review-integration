import type { LocationQuery } from 'vue-router';
import type { DifferencesEntry, MatrixEntry, ProgressEntry, ReviewEntry } from '@/types/entry';
import type { PageAction, ReviewStage } from '@/types/review';

// 页面入口只接受接口契约中定义的评审阶段和动作，未知值在发起请求前直接拦截。
const stages = new Set<ReviewStage>([
  'FORMAL_REVIEW',
  'QUALIFICATION_REVIEW',
  'RESPONSIVENESS_REVIEW',
  'DETAILED_REVIEW',
]);

const actions = new Set<PageAction>(['AI', 'AI_FEEDBACK']);

function first(query: LocationQuery, key: string): string {
  const value = query[key];
  if (Array.isArray(value)) return value[0]?.trim() ?? '';
  return typeof value === 'string' ? value.trim() : '';
}

export function parseProgressEntry(query: LocationQuery): ProgressEntry {
  const reviewId = first(query, 'reviewId');
  if (!reviewId) throw new Error('入口参数不完整：缺少 reviewId');
  return { reviewId };
}

export function parseReviewEntry(query: LocationQuery): ReviewEntry {
  const reviewId = first(query, 'reviewId');
  const actionValue = first(query, 'action') as PageAction;
  const reviewStageValue = first(query, 'reviewStage');
  const reviewItemId = first(query, 'reviewItemId');
  const bidderId = first(query, 'bidderId');

  if (!reviewId) throw new Error('入口参数不完整：缺少 reviewId');
  if (!actions.has(actionValue)) throw new Error('入口参数错误：action 仅支持 AI 或 AI_FEEDBACK');

  // 支持两种评标入口：完整矩阵坐标定位单项，或无坐标进入“全部专家不一致项”。
  // 三个坐标只传一部分时无法唯一定位业务数据，因此按无效入口处理。
  const coordinateCount = [reviewStageValue, reviewItemId, bidderId].filter(Boolean).length;
  if (coordinateCount !== 0 && coordinateCount !== 3) {
    throw new Error('入口参数不完整：reviewStage、reviewItemId、bidderId 必须同时传递');
  }

  if (coordinateCount === 0) {
    // 无坐标模式只用于反馈列表；纯AI查看必须从一个明确的评审项进入。
    if (actionValue !== 'AI_FEEDBACK') {
      throw new Error('入口参数错误：无矩阵坐标时 action 必须为 AI_FEEDBACK');
    }
    const entry: DifferencesEntry = { kind: 'differences', reviewId, action: actionValue };
    return entry;
  }

  if (!stages.has(reviewStageValue as ReviewStage)) {
    throw new Error('入口参数错误：reviewStage 不受支持');
  }

  const entry: MatrixEntry = {
    kind: 'matrix',
    reviewId,
    action: actionValue,
    reviewStage: reviewStageValue as ReviewStage,
    reviewItemId,
    bidderId,
  };
  return entry;
}
