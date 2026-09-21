import type {
  AiDecisionFeedback,
  DifferenceCurrentItem,
  DifferencesData,
  DifferenceItem,
  FeedbackPayload,
  FeedbackSaveData,
  FilePreviewData,
  PageAction,
  ProgressFile,
  RetryFileData,
  ReviewDecision,
  ReviewProgressData,
  ReviewResultData,
  ReviewStage,
} from '@/types/review';

// 开发期同契约Mock：直接返回业务data，不经过Axios和统一响应包络。
// 因此它用于验证页面流程，Access-Token、代理和HTTP错误仍需在真实联调时验证。
const wait = (duration = 260) => new Promise((resolve) => window.setTimeout(resolve, duration));

const stageNames: Record<ReviewStage, string> = {
  FORMAL_REVIEW: '形式评审',
  QUALIFICATION_REVIEW: '资格评审',
  RESPONSIVENESS_REVIEW: '响应性评审',
  DETAILED_REVIEW: '详细评审',
};

// 在当前页面会话内保存反馈和进度变化，使保存、刷新、轮询和重试形成完整闭环。
const feedbackStore = new Map<string, FeedbackPayload & { createdAt: string; updatedAt: string }>();
let progressRequestCount = 0;

// 同时覆盖已完成、处理中和可重试失败文件三种进度场景。
const files: ProgressFile[] = [
  {
    fileId: 'FILE-TENDER-001',
    fileType: 'TENDER_FILE',
    fileTypeName: '招标文件',
    fileName: '中核集团电子采购平台供应商招标文件.pdf',
    bidderId: null,
    bidderName: null,
    status: 'COMPLETED',
    progress: 100,
    failureReason: null,
    retryable: false,
  },
  {
    fileId: 'FILE-BID-001',
    fileType: 'BID_FILE',
    fileTypeName: '投标文件',
    fileName: '江苏测试华博创意产业有限公司.pdf',
    bidderId: 'BIDDER001',
    bidderName: '江苏测试华博创意产业有限公司',
    status: 'COMPLETED',
    progress: 100,
    failureReason: null,
    retryable: false,
  },
  {
    fileId: 'FILE-BID-002',
    fileType: 'BID_FILE',
    fileTypeName: '投标文件',
    fileName: '连云港市衡凯园林景观工程有限公司.pdf',
    bidderId: 'BIDDER002',
    bidderName: '连云港市衡凯园林景观工程有限公司',
    status: 'PROCESSING',
    progress: 72,
    failureReason: null,
    retryable: false,
  },
  {
    fileId: 'FILE-BID-003',
    fileType: 'BID_FILE',
    fileTypeName: '投标文件',
    fileName: '上海建工昆山中环建设有限公司.pdf',
    bidderId: 'BIDDER003',
    bidderName: '上海建工昆山中环建设有限公司',
    status: 'FAILED',
    progress: 34,
    failureReason: '文件页数异常，解析任务未能完成',
    retryable: true,
  },
];

function feedbackKey(
  reviewId: string,
  reviewStage: ReviewStage,
  reviewItemId: string,
  bidderId: string,
) {
  return [reviewId, reviewStage, reviewItemId, bidderId].join('|');
}

function currentFeedback(
  reviewId: string,
  reviewStage: ReviewStage,
  reviewItemId: string,
  bidderId: string,
  options: string[],
): AiDecisionFeedback {
  const saved = feedbackStore.get(feedbackKey(reviewId, reviewStage, reviewItemId, bidderId));
  return {
    required: true,
    completed: Boolean(saved),
    problemTypeOptions: options,
    problemTypes: saved?.problemTypes ?? [],
    problemDescription: saved?.problemDescription ?? null,
    createdAt: saved?.createdAt ?? null,
    updatedAt: saved?.updatedAt ?? null,
  };
}

function makeResult(input: {
  reviewId: string;
  reviewStage: ReviewStage;
  reviewItemId: string;
  bidderId: string;
  action: PageAction;
}): ReviewResultData {
  // 详细评审生成评分型结果，其它阶段生成合格/不合格判定型结果。
  const detailed = input.reviewStage === 'DETAILED_REVIEW';
  const itemIndex = Math.max(1, Number(input.reviewItemId.match(/\d+/)?.[0] ?? 1));
  const bidderIndex = Math.max(1, Number(input.bidderId.match(/\d+/)?.[0] ?? 1));
  const aiDecision: ReviewDecision = itemIndex % 2 === 0 ? 'UNQUALIFIED' : 'QUALIFIED';
  const expertDecision: ReviewDecision = aiDecision === 'QUALIFIED' ? 'UNQUALIFIED' : 'QUALIFIED';
  const problemOptions = detailed
    ? ['引用材料有误', '评分理由有误', '其他']
    : ['引用材料有误', '评审理由有误', '其他'];
  const showFeedback = input.action === 'AI_FEEDBACK';

  return {
    reviewId: input.reviewId,
    action: input.action,
    resultType: detailed ? 'SCORE' : 'DECISION',
    reviewStage: input.reviewStage,
    reviewStageName: stageNames[input.reviewStage],
    reviewItem: {
      reviewItemId: input.reviewItemId,
      reviewItemName: detailed ? `技术方案完整性评分项 ${itemIndex}` : `评审项 ${itemIndex}`,
      reviewItemOrder: itemIndex,
      reviewCategory: detailed ? '技术评审' : null,
      reviewContent: detailed ? '根据投标文件中的实施方案、项目进度和质量保证措施进行综合评分。' : null,
      reviewRule: detailed ? null : '投标文件应完整响应招标文件要求，相关材料真实有效。',
      maxScore: detailed ? '10.00' : null,
    },
    bidder: {
      bidderId: input.bidderId,
      bidderName: `测试投标人 ${bidderIndex}`,
    },
    aiReviewStatus: 'COMPLETED',
    aiResult: {
      aiReviewResult: detailed ? null : aiDecision,
      aiScore: detailed ? '8.50' : null,
      scoreType: detailed ? (itemIndex % 2 === 0 ? 'SUBJECTIVE' : 'OBJECTIVE') : null,
    },
    expertResult: {
      expertReviewResult: detailed ? null : expertDecision,
      expertScore: detailed ? '6.50' : null,
    },
    aiExpertReviewInconsistent: true,
    differenceDescription: detailed
      ? 'AI评分与专家评分不在同一评分档位'
      : 'AI判定与专家判定不一致',
    aiReviewSummary: {
      summaryName: detailed ? 'AI评分总结' : 'AI评审总结',
      ruleText: detailed
        ? '重点核对实施计划、人员配置和质量保障措施。'
        : '核对投标文件是否完整响应本评审项。',
      conclusion: detailed
        ? '投标人提供了较完整的实施方案和进度计划，但部分风险控制措施描述不够具体。'
        : '投标文件已提供本项要求的证明材料，AI根据引用内容给出相应判定。',
      evidenceItems: [
        {
          evidenceId: `EVI-${input.reviewItemId}-001`,
          fileId: 'FILE-BID-001',
          fileName: '测试投标文件.pdf',
          pageNumber: 13,
          locationText: '投标文件技术部分 第3项',
          quote: '项目计划分为准备、实施和验收三个阶段，并配置相应质量保证措施。',
        },
        {
          evidenceId: `EVI-${input.reviewItemId}-002`,
          fileId: 'FILE-TENDER-001',
          fileName: '测试招标文件.pdf',
          pageNumber: 7,
          locationText: '招标文件 第3.2条 评分办法',
          quote: '根据投标文件响应程度和实施方案完整性进行评审。',
        },
      ],
    },
    showAiDecisionFeedback: showFeedback,
    aiDecisionFeedback: showFeedback
      ? currentFeedback(
          input.reviewId,
          input.reviewStage,
          input.reviewItemId,
          input.bidderId,
          problemOptions,
        )
      : null,
    navigation: {
      currentIndex: itemIndex,
      totalCount: 6,
      previous:
        itemIndex > 1
          ? {
              reviewStage: input.reviewStage,
              reviewItemId: `${detailed ? 'DR' : 'FR'}${String(itemIndex - 1).padStart(3, '0')}`,
              bidderId: input.bidderId,
            }
          : null,
      next:
        itemIndex < 6
          ? {
              reviewStage: input.reviewStage,
              reviewItemId: `${detailed ? 'DR' : 'FR'}${String(itemIndex + 1).padStart(3, '0')}`,
              bidderId: input.bidderId,
            }
          : null,
    },
  };
}

function differenceItems(reviewId: string): DifferenceItem[] {
  // 第一条属于当前专家并可编辑，第二条属于其他专家并保持只读。
  const definitions = [
    {
      id: 'DIFF-001',
      cursor: 'mock-cursor-1',
      stage: 'FORMAL_REVIEW' as const,
      itemId: 'FR001',
      itemName: '投标文件格式检查',
      bidderId: 'BIDDER001',
      bidderName: '测试投标人 1',
      expertNo: 'expert-current',
      expertName: '当前专家',
    },
    {
      id: 'DIFF-002',
      cursor: 'mock-cursor-2',
      stage: 'DETAILED_REVIEW' as const,
      itemId: 'DR002',
      itemName: '实施方案完整性',
      bidderId: 'BIDDER002',
      bidderName: '测试投标人 2',
      expertNo: 'expert-other',
      expertName: '其他专家',
    },
  ];

  return definitions.map((item) => ({
    differenceId: item.id,
    cursor: item.cursor,
    reviewStage: item.stage,
    reviewStageName: stageNames[item.stage],
    reviewItemId: item.itemId,
    reviewItemName: item.itemName,
    bidderId: item.bidderId,
    bidderName: item.bidderName,
    appAccountAccountNo: item.expertNo,
    appAccountAccountName: item.expertName,
    resultType: item.stage === 'DETAILED_REVIEW' ? 'SCORE' : 'DECISION',
    aiReviewResult: item.stage === 'DETAILED_REVIEW' ? null : 'QUALIFIED',
    expertReviewResult: item.stage === 'DETAILED_REVIEW' ? null : 'UNQUALIFIED',
    aiScore: item.stage === 'DETAILED_REVIEW' ? '8.50' : null,
    expertScore: item.stage === 'DETAILED_REVIEW' ? '6.50' : null,
    feedbackCompleted: feedbackStore.has(feedbackKey(reviewId, item.stage, item.itemId, item.bidderId)),
    feedbackEditable: item.expertNo === 'expert-current',
  }));
}

function makeDifferenceCurrent(reviewId: string, item: DifferenceItem): DifferenceCurrentItem {
  const result = makeResult({
    reviewId,
    reviewStage: item.reviewStage,
    reviewItemId: item.reviewItemId,
    bidderId: item.bidderId,
    action: 'AI_FEEDBACK',
  });
  return {
    ...result,
    expert: {
      appAccountAccountNo: item.appAccountAccountNo,
      appAccountAccountName: item.appAccountAccountName,
    },
    feedbackEditable: item.feedbackEditable,
  };
}

/** 与src/api/review.ts六个业务方法一一对应的开发期实现。 */
export const mockReviewApi = {
  async getProgress(reviewId: string): Promise<ReviewProgressData> {
    await wait();
    progressRequestCount += 1;
    // 每次轮询推进处理中任务，模拟后端异步解析进度。
    const processingFile = files.find((file) => file.status === 'PROCESSING');
    if (processingFile) {
      processingFile.progress = Math.min(100, processingFile.progress + 8);
      if (processingFile.progress >= 100) processingFile.status = 'COMPLETED';
    }
    const completedCount = files.filter((file) => file.status === 'COMPLETED').length;
    const active = files.some((file) => file.status === 'PROCESSING');
    return {
      reviewId,
      overallStatus: active ? 'PROCESSING' : 'FAILED',
      overallProgress: active ? Math.min(64, 44 + progressRequestCount * 4) : 52,
      pollingRequired: active,
      pollingIntervalSeconds: 3,
      fileParsing: {
        status: files.some((file) => file.status === 'FAILED') ? 'FAILED' : active ? 'PROCESSING' : 'COMPLETED',
        progress: Math.round(files.reduce((total, file) => total + file.progress, 0) / files.length),
        completedCount,
        totalCount: files.length,
        files: files.map((file) => ({ ...file })),
      },
      preliminaryReview: {
        status: 'PROCESSING',
        progress: 45,
        completedBidderCount: 1,
        totalBidderCount: 3,
        stages: [
          { reviewStage: 'FORMAL_REVIEW', reviewStageName: '形式评审', status: 'COMPLETED', progress: 100 },
          {
            reviewStage: 'QUALIFICATION_REVIEW',
            reviewStageName: '资格评审',
            status: 'PROCESSING',
            progress: 45,
          },
          {
            reviewStage: 'RESPONSIVENESS_REVIEW',
            reviewStageName: '响应性评审',
            status: 'PENDING',
            progress: 0,
          },
        ],
      },
      detailedReview: { status: 'PENDING', progress: 0 },
      updatedAt: new Date().toISOString(),
    };
  },

  async retryFile(reviewId: string, fileId: string): Promise<RetryFileData> {
    await wait();
    // 重试受理后将失败文件恢复为处理中，下一次轮询继续推进。
    const file = files.find((item) => item.fileId === fileId);
    if (file) {
      file.status = 'PROCESSING';
      file.progress = 3;
      file.failureReason = null;
      file.retryable = false;
    }
    return {
      accepted: true,
      retryTaskId: `MOCK-RETRY-${Date.now()}`,
      reviewId,
      fileId,
      fileStatus: 'PROCESSING',
      acceptedAt: new Date().toISOString(),
    };
  },

  async getResult(input: Parameters<typeof makeResult>[0]): Promise<ReviewResultData> {
    await wait();
    return makeResult(input);
  },

  async getDifferences(reviewId: string, cursor?: string): Promise<DifferencesData> {
    await wait();
    const items = differenceItems(reviewId);
    // cursor由服务端生成，页面只透传并使用前后cursor导航。
    const requestedIndex = cursor ? Math.max(0, items.findIndex((item) => item.cursor === cursor)) : 0;
    const current = items[requestedIndex] ?? null;
    return {
      reviewId,
      currentExpert: {
        appAccountAccountNo: 'expert-current',
        appAccountAccountName: '当前专家',
      },
      listVersion: 'mock-list-v1',
      totalCount: items.length,
      completedFeedbackCount: items.filter((item) => item.feedbackCompleted).length,
      incompleteFeedbackCount: items.filter((item) => !item.feedbackCompleted).length,
      items,
      currentCursor: current?.cursor ?? null,
      currentIndex: current ? requestedIndex + 1 : 0,
      previousCursor: requestedIndex > 0 ? items[requestedIndex - 1]?.cursor ?? null : null,
      nextCursor: requestedIndex < items.length - 1 ? items[requestedIndex + 1]?.cursor ?? null : null,
      currentItem: current ? makeDifferenceCurrent(reviewId, current) : null,
    };
  },

  async saveFeedback(reviewId: string, payload: FeedbackPayload): Promise<FeedbackSaveData> {
    await wait();
    const key = feedbackKey(reviewId, payload.reviewStage, payload.reviewItemId, payload.bidderId);
    const old = feedbackStore.get(key);
    const now = new Date().toISOString();
    // 保留首次创建时间，重复提交按“修改反馈”更新updatedAt。
    feedbackStore.set(key, {
      ...payload,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    });
    return {
      reviewId,
      ...payload,
      appAccountAccountNo: 'expert-current',
      appAccountAccountName: '当前专家',
      completed: true,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      stageIncompleteFeedbackCount: 0,
      totalIncompleteFeedbackCount: 1,
    };
  },

  async getPreview(
    reviewId: string,
    fileId: string,
    evidenceId: string,
  ): Promise<FilePreviewData> {
    await wait();
    // mock-document仅用于演示定位；正式环境由后端返回短期有效的客户预览地址。
    return {
      reviewId,
      fileId,
      fileName: fileId === 'FILE-TENDER-001' ? '测试招标文件.pdf' : '测试投标文件.pdf',
      mimeType: 'text/html',
      previewUrl: `${window.location.origin}/mock-document.html?evidenceId=${encodeURIComponent(evidenceId)}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      currentPosition: {
        evidenceId,
        positionIndex: evidenceId.endsWith('002') ? 2 : 1,
        positionCount: 2,
        pageNumber: evidenceId.endsWith('002') ? 7 : 13,
        locationText: evidenceId.endsWith('002') ? '招标文件 第3.2条' : '投标文件技术部分 第3项',
        quote: evidenceId.endsWith('002')
          ? '根据投标文件响应程度和实施方案完整性进行评审。'
          : '项目计划分为准备、实施和验收三个阶段，并配置相应质量保证措施。',
      },
      previousPosition: evidenceId.endsWith('002')
        ? { fileId: 'FILE-BID-001', evidenceId: evidenceId.replace(/002$/, '001') }
        : null,
      nextPosition: evidenceId.endsWith('002')
        ? null
        : { fileId: 'FILE-TENDER-001', evidenceId: evidenceId.replace(/001$/, '002') },
    };
  },
};
