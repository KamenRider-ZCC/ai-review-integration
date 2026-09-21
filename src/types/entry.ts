import type { PageAction, ReviewStage } from './review';

// 页面入口使用kind作为判别字段，避免在业务页面中反复猜测URL参数组合。
export interface ProgressEntry {
  reviewId: string;
}

export interface MatrixEntry {
  kind: 'matrix';
  reviewId: string;
  action: PageAction;
  reviewStage: ReviewStage;
  reviewItemId: string;
  bidderId: string;
}

export interface DifferencesEntry {
  // 无矩阵坐标时固定进入全部专家不一致项反馈模式。
  kind: 'differences';
  reviewId: string;
  action: 'AI_FEEDBACK';
}

export type ReviewEntry = MatrixEntry | DifferencesEntry;
