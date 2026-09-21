/**
 * AI页面与宿主Loader之间的最小通信桥。
 * 这里只传递初始化、关闭、尺寸和错误等容器事件，不传Token或评审业务数据。
 */
type CloseHandler = () => void;

interface HostMessage {
  source?: string;
  type?: string;
  payload?: unknown;
}

let parentOrigin: string | null = null;
let closeHandler: CloseHandler | null = null;
let started = false;

function allowedParentOrigins(): Set<string> {
  const configured = (import.meta.env.VITE_ALLOWED_PARENT_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (import.meta.env.DEV) {
    configured.push(window.location.origin, 'http://127.0.0.1:4176', 'http://localhost:4176');
  }
  return new Set(configured);
}

function isAllowedOrigin(origin: string): boolean {
  return allowedParentOrigins().has(origin);
}

function post(type: string, payload: unknown = null) {
  if (window.parent === window || !parentOrigin) return;
  window.parent.postMessage({ source: 'ai-review-app', type, payload }, parentOrigin);
}

function handleMessage(event: MessageEvent<HostMessage>) {
  if (event.source !== window.parent) return;
  const message = event.data ?? {};
  if (message.source !== 'ai-review-loader') return;

  if (message.type === 'AI_REVIEW_HOST_INIT') {
    // 只有首次初始化通过来源白名单后，后续消息才会绑定到该父页面origin。
    if (!isAllowedOrigin(event.origin)) return;
    parentOrigin = event.origin;
    post('AI_REVIEW_READY', { appVersion: '0.1.0' });
    return;
  }

  if (!parentOrigin || event.origin !== parentOrigin) return;
  if (message.type === 'AI_REVIEW_CLOSE') closeHandler?.();
}

export function startHostBridge(onClose: CloseHandler) {
  closeHandler = onClose;
  if (!started) {
    window.addEventListener('message', handleMessage);
    started = true;
  }
  if (window.parent !== window) {
    // 主动通知Loader当前页面已注册监听器，避免Loader过早发送HOST_INIT而丢失握手。
    window.parent.postMessage(
      { source: 'ai-review-app', type: 'AI_REVIEW_BOOTSTRAP', payload: null },
      '*',
    );
  }
}

export function stopHostBridge() {
  // message监听器只注册一次，页面卸载时清空页面级回调即可。
  closeHandler = null;
}

/** 请求宿主销毁iframe并恢复其滚动状态。 */
export function requestHostClose() {
  post('AI_REVIEW_CLOSE_REQUEST');
}

/** 仅进度页使用，通知宿主在展开和收起宽度之间切换。 */
export function requestHostResize(width: number) {
  post('AI_REVIEW_RESIZE', { width });
}

/** 将页面级错误上报给宿主，便于宿主提供统一提示或埋点。 */
export function reportHostError(message: string) {
  post('AI_REVIEW_ERROR', { message });
}
