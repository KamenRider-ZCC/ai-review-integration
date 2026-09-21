// 本文件是前端对《AI评标前后端接口设计说明书》的类型映射，字段变更应先与后端契约对齐。
export type ReviewStage =
  | 'FORMAL_REVIEW'
  | 'QUALIFICATION_REVIEW'
  | 'RESPONSIVENESS_REVIEW'
  | 'DETAILED_REVIEW';

export type PageAction = 'AI' | 'AI_FEEDBACK';
export type ResultType = 'DECISION' | 'SCORE';
export type ReviewDecision = 'QUALIFIED' | 'UNQUALIFIED';
export type ScoreType = 'OBJECTIVE' | 'SUBJECTIVE';
export type ProcessStatus = 'PENDING' | 'PROCESSING' | 'AI_REVIEWING' | 'COMPLETED' | 'FAILED';
export type FileType = 'TENDER_FILE' | 'BID_FILE';

/** 后端统一响应包络；success为false时data允许携带错误上下文。 */
export interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  message: string;
  requestId: string;
  data: T | null;
}

// 单个矩阵坐标对应一个评审项和一个投标人，结果可能是判定型或评分型。
export interface ReviewItem {
  reviewItemId: string;
  reviewItemName: string;
  reviewItemOrder: number;
  reviewCategory: string | null;
  reviewContent: string | null;
  reviewRule: string | null;
  maxScore: string | null;
}

export interface Bidder {
  bidderId: string;
  bidderName: string;
}

export interface AiResult {
  aiReviewResult: ReviewDecision | null;
  aiScore: string | null;
  scoreType: ScoreType | null;
}

export interface ExpertResult {
  expertReviewResult: ReviewDecision | null;
  expertScore: string | null;
}

export interface EvidenceItem {
  evidenceId: string;
  fileId: string;
  fileName: string;
  pageNumber: number | null;
  locationText: string;
  quote: string;
}

export interface AiReviewSummary {
  summaryName: string;
  ruleText: string;
  conclusion: string;
  evidenceItems: EvidenceItem[];
}

export interface AiDecisionFeedback {
  required: boolean;
  completed: boolean;
  problemTypeOptions: string[];
  problemTypes: string[];
  problemDescription: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MatrixCoordinate {
  reviewStage: ReviewStage;
  reviewItemId: string;
  bidderId: string;
}

export interface MatrixNavigation {
  currentIndex: number;
  totalCount: number;
  previous: MatrixCoordinate | null;
  next: MatrixCoordinate | null;
}

export interface ReviewResultData {
  reviewId: string;
  action: PageAction;
  resultType: ResultType;
  reviewStage: ReviewStage;
  reviewStageName: string;
  reviewItem: ReviewItem;
  bidder: Bidder;
  aiReviewStatus: 'AI_REVIEWING' | 'COMPLETED' | 'FAILED';
  aiResult: AiResult;
  expertResult: ExpertResult;
  aiExpertReviewInconsistent: boolean | null;
  differenceDescription: string | null;
  aiReviewSummary: AiReviewSummary | null;
  showAiDecisionFeedback: boolean;
  aiDecisionFeedback: AiDecisionFeedback | null;
  navigation: MatrixNavigation;
}

// “全部专家不一致项”由后端cursor驱动，并明确返回当前记录是否允许登录专家编辑。
export interface ExpertIdentity {
  appAccountAccountNo: string;
  appAccountAccountName: string;
}

export interface DifferenceItem {
  differenceId: string;
  cursor: string;
  reviewStage: ReviewStage;
  reviewStageName: string;
  reviewItemId: string;
  reviewItemName: string;
  bidderId: string;
  bidderName: string;
  appAccountAccountNo: string;
  appAccountAccountName: string;
  resultType: ResultType;
  aiReviewResult: ReviewDecision | null;
  expertReviewResult: ReviewDecision | null;
  aiScore: string | null;
  expertScore: string | null;
  feedbackCompleted: boolean;
  feedbackEditable: boolean;
}

export interface DifferenceCurrentItem
  extends Omit<ReviewResultData, 'action' | 'navigation'> {
  expert: ExpertIdentity;
  feedbackEditable: boolean;
}

export interface DifferencesData {
  reviewId: string;
  currentExpert: ExpertIdentity;
  listVersion: string;
  totalCount: number;
  completedFeedbackCount: number;
  incompleteFeedbackCount: number;
  items: DifferenceItem[];
  currentCursor: string | null;
  currentIndex: number;
  previousCursor: string | null;
  nextCursor: string | null;
  currentItem: DifferenceCurrentItem | null;
}

// 进度接口由后端决定是否继续轮询以及轮询间隔，前端不自行推断任务完成状态。
export interface ProgressFile {
  fileId: string;
  fileType: FileType;
  fileTypeName: string;
  fileName: string;
  bidderId: string | null;
  bidderName: string | null;
  status: Exclude<ProcessStatus, 'AI_REVIEWING'>;
  progress: number;
  failureReason: string | null;
  retryable: boolean;
}

export interface ProgressStage {
  reviewStage: ReviewStage;
  reviewStageName: string;
  status: Exclude<ProcessStatus, 'AI_REVIEWING'>;
  progress: number;
}

export interface ReviewProgressData {
  reviewId: string;
  overallStatus: Exclude<ProcessStatus, 'AI_REVIEWING'>;
  overallProgress: number;
  pollingRequired: boolean;
  pollingIntervalSeconds: number;
  fileParsing: {
    status: Exclude<ProcessStatus, 'AI_REVIEWING'>;
    progress: number;
    completedCount: number;
    totalCount: number;
    files: ProgressFile[];
  };
  preliminaryReview: {
    status: Exclude<ProcessStatus, 'AI_REVIEWING'>;
    progress: number;
    completedBidderCount: number;
    totalBidderCount: number;
    stages: ProgressStage[];
  };
  detailedReview: {
    status: Exclude<ProcessStatus, 'AI_REVIEWING'>;
    progress: number;
  };
  updatedAt: string;
}

export interface RetryFileData {
  accepted: boolean;
  retryTaskId: string;
  reviewId: string;
  fileId: string;
  fileStatus: string;
  acceptedAt: string;
}

// 反馈归属当前登录专家，因此payload不允许前端指定专家账号。
export interface FeedbackPayload {
  reviewStage: ReviewStage;
  reviewItemId: string;
  bidderId: string;
  problemTypes: string[];
  problemDescription: string | null;
}

export interface FeedbackSaveData extends FeedbackPayload {
  reviewId: string;
  appAccountAccountNo: string;
  appAccountAccountName: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  stageIncompleteFeedbackCount: number;
  totalIncompleteFeedbackCount: number;
}

// 预览地址可能短期失效，相邻证据位置通过fileId + evidenceId重新向后端获取。
export interface PreviewPosition {
  evidenceId: string;
  positionIndex: number;
  positionCount: number;
  pageNumber: number | null;
  locationText: string;
  quote: string;
}

export interface PreviewAdjacentPosition {
  fileId: string;
  evidenceId: string;
}

export interface FilePreviewData {
  reviewId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  expiresAt: string;
  currentPosition: PreviewPosition;
  previousPosition: PreviewAdjacentPosition | null;
  nextPosition: PreviewAdjacentPosition | null;
}
