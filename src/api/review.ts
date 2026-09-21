import type {
  DifferencesData,
  FeedbackPayload,
  FeedbackSaveData,
  FilePreviewData,
  PageAction,
  RetryFileData,
  ReviewProgressData,
  ReviewResultData,
  ReviewStage,
} from '@/types/review';
import { apiRequest } from './http';

// Mock只允许在开发构建中启用；生产构建始终请求真实后端。
const useMock = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false';

async function mockApi() {
  // 动态导入避免开发用Mock数据进入生产首屏包。
  return (await import('@/mocks/review')).mockReviewApi;
}

/** 查询文件解析、初评和详评的总体进度。 */
export async function getReviewProgress(reviewId: string): Promise<ReviewProgressData> {
  if (useMock) return (await mockApi()).getProgress(reviewId);
  return apiRequest({ method: 'GET', url: `/reviews/${encodeURIComponent(reviewId)}/progress` });
}

/** 对后端标记为retryable的失败文件重新提交解析任务。 */
export async function retryFile(reviewId: string, fileId: string): Promise<RetryFileData> {
  if (useMock) return (await mockApi()).retryFile(reviewId, fileId);
  return apiRequest({
    method: 'POST',
    url: `/reviews/${encodeURIComponent(reviewId)}/files/${encodeURIComponent(fileId)}/retry`,
    data: {},
  });
}

/** 按评审阶段、评审项和投标人坐标取得单项AI评审结果。 */
export async function getReviewResult(input: {
  reviewId: string;
  reviewStage: ReviewStage;
  reviewItemId: string;
  bidderId: string;
  action: PageAction;
}): Promise<ReviewResultData> {
  if (useMock) return (await mockApi()).getResult(input);
  return apiRequest({
    method: 'GET',
    url: `/reviews/${encodeURIComponent(input.reviewId)}/result`,
    params: {
      reviewStage: input.reviewStage,
      reviewItemId: input.reviewItemId,
      bidderId: input.bidderId,
      action: input.action,
    },
  });
}

/** 以服务端cursor遍历全部专家的不一致项，避免前端自行拼接矩阵坐标。 */
export async function getDifferences(reviewId: string, cursor?: string): Promise<DifferencesData> {
  if (useMock) return (await mockApi()).getDifferences(reviewId, cursor);
  return apiRequest({
    method: 'GET',
    url: `/reviews/${encodeURIComponent(reviewId)}/differences`,
    params: cursor ? { cursor } : undefined,
  });
}

/** 保存当前登录专家对AI判定或评分理由的反馈。 */
export async function saveFeedback(
  reviewId: string,
  payload: FeedbackPayload,
): Promise<FeedbackSaveData> {
  if (useMock) return (await mockApi()).saveFeedback(reviewId, payload);
  return apiRequest({
    method: 'PUT',
    url: `/reviews/${encodeURIComponent(reviewId)}/feedback`,
    data: payload,
  });
}

/** 取得短期有效的预览地址以及当前证据相邻位置。 */
export async function getFilePreview(
  reviewId: string,
  fileId: string,
  evidenceId: string,
): Promise<FilePreviewData> {
  if (useMock) return (await mockApi()).getPreview(reviewId, fileId, evidenceId);
  return apiRequest({
    method: 'GET',
    url: `/reviews/${encodeURIComponent(reviewId)}/files/${encodeURIComponent(fileId)}/preview`,
    params: { evidenceId },
  });
}
