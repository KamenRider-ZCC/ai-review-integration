import axios, { AxiosError } from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { ApiEnvelope } from '@/types/review';
import { getCookie } from '@/utils/cookie';

/** 统一保留后端业务码和requestId，页面可直接展示，联调时也便于后端查日志。 */
export class AiReviewApiError extends Error {
  code: string;
  requestId?: string;
  data: unknown;

  constructor(message: string, code: string, requestId?: string, data: unknown = null) {
    super(message);
    this.name = 'AiReviewApiError';
    this.code = code;
    this.requestId = requestId;
    this.data = data;
  }
}

// 默认使用相对地址，开发环境可由Vite代理转发，生产环境则由部署网关处理。
const apiBase = import.meta.env.VITE_AI_REVIEW_API_BASE?.trim() || '/ai-review-api/v1';

const client = axios.create({
  baseURL: apiBase,
  timeout: 20_000,
  headers: {
    Accept: 'application/json',
  },
});

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function apiRequest<T>(config: AxiosRequestConfig): Promise<T> {
  // 接口契约要求传原始Access-Token值，不添加Bearer前缀。
  const accessToken = getCookie('Access-Token');
  if (!accessToken) {
    throw new AiReviewApiError('未取得 Access-Token，请从一体化平台登录后进入', 'TOKEN_INVALID');
  }

  try {
    const response = await client.request<ApiEnvelope<T>>({
      ...config,
      headers: {
        ...config.headers,
        'Access-Token': accessToken,
        'X-Request-Id': createRequestId(),
      },
    });
    // HTTP 200只代表传输成功，还必须继续判断统一响应包络中的success和data。
    const envelope = response.data;
    if (!envelope || typeof envelope.success !== 'boolean') {
      throw new AiReviewApiError('后端响应格式不符合接口契约', 'INVALID_RESPONSE');
    }
    if (!envelope.success) {
      throw new AiReviewApiError(envelope.message, envelope.code, envelope.requestId, envelope.data);
    }
    if (envelope.data === null) {
      throw new AiReviewApiError('成功响应缺少 data', 'INVALID_RESPONSE', envelope.requestId);
    }
    return envelope.data;
  } catch (error) {
    // 业务错误保持原始code/requestId；传输层错误统一转换，避免页面依赖Axios细节。
    if (error instanceof AiReviewApiError) throw error;
    const axiosError = error as AxiosError;
    if (axiosError.code === 'ECONNABORTED') {
      throw new AiReviewApiError('请求超时，请稍后重试', 'NETWORK_TIMEOUT');
    }
    throw new AiReviewApiError('网络连接失败，请检查服务地址或跨域配置', 'NETWORK_ERROR');
  }
}

export function readableError(error: unknown): string {
  if (error instanceof AiReviewApiError) {
    return error.requestId ? `${error.message}（requestId：${error.requestId}）` : error.message;
  }
  return error instanceof Error ? error.message : '未知错误';
}
