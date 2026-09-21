(function (window, document) {
  'use strict';

  /**
   * 宿主侧接入脚本。
   *
   * 宿主只负责创建/销毁iframe和转发容器级事件，业务数据仍由AI页面通过后端接口取得。
   * 正式接入时先调用 AIReview.init，再通过 AIReview.open 打开进度页或评标页；不要通过
   * postMessage传递Token、评审结果或文件内容。
   *
   * 示例：
   *   AIReview.init({ appBaseUrl: '/ai-review/' });
   *   AIReview.open({
   *     page: 'page', reviewId: 'REV001', action: 'AI_FEEDBACK',
   *     reviewStage: 'FORMAL_REVIEW', reviewItemId: 'ITEM001', bidderId: 'BIDDER001'
   *   });
   */
  if (window.AIReview) return;

  // 消息方向：HOST_INIT/CLOSE 由宿主发出，其余消息由AI页面发出。
  var MESSAGE = {
    HOST_INIT: 'AI_REVIEW_HOST_INIT',
    BOOTSTRAP: 'AI_REVIEW_BOOTSTRAP',
    READY: 'AI_REVIEW_READY',
    CLOSE: 'AI_REVIEW_CLOSE',
    CLOSE_REQUEST: 'AI_REVIEW_CLOSE_REQUEST',
    RESIZE: 'AI_REVIEW_RESIZE',
    ERROR: 'AI_REVIEW_ERROR',
  };

  var options = null;
  var frame = null;
  var frameOrigin = '';
  var currentMode = '';
  var hostScrollState = null;
  var closeTimer = 0;

  // file协议和沙箱iframe的origin可能为null，此时postMessage只能使用通配目标来源。
  function normalizeOrigin(origin) {
    return !origin || origin === 'null' || origin === 'file://' ? 'null' : origin;
  }

  function hostOrigin() {
    return window.location.protocol === 'file:' ? 'null' : normalizeOrigin(window.location.origin);
  }

  function targetOrigin(origin) {
    return origin === 'null' ? '*' : origin;
  }

  function invoke(name, payload) {
    if (!options || typeof options[name] !== 'function') return;
    try {
      options[name](payload);
    } catch (error) {
      window.setTimeout(function () {
        throw error;
      }, 0);
    }
  }

  function lockHostScroll() {
    if (hostScrollState || !document.body || !document.documentElement) return;
    var root = document.documentElement;
    var body = document.body;
    var scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    var paddingRight = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    // 保存宿主原始内联样式，关闭iframe后必须原样恢复，避免影响宿主其它弹窗。
    hostScrollState = {
      rootOverflow: root.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = paddingRight + scrollbarWidth + 'px';
  }

  function unlockHostScroll() {
    if (!hostScrollState || !document.body || !document.documentElement) return;
    document.documentElement.style.overflow = hostScrollState.rootOverflow;
    document.body.style.overflow = hostScrollState.bodyOverflow;
    document.body.style.paddingRight = hostScrollState.bodyPaddingRight;
    hostScrollState = null;
  }

  function requireString(payload, name) {
    var value = payload && payload[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('AIReview.open 缺少 ' + name);
    }
    return value.trim();
  }

  function validateOpenPayload(payload) {
    if (!payload || (payload.page !== 'page' && payload.page !== 'progress')) {
      throw new Error('AIReview.open 的 page 仅支持 page 或 progress');
    }
    requireString(payload, 'reviewId');
    if (payload.page === 'progress') return;

    var action = requireString(payload, 'action');
    if (action !== 'AI' && action !== 'AI_FEEDBACK') {
      throw new Error('AIReview.open 的 action 仅支持 AI 或 AI_FEEDBACK');
    }
    // 矩阵坐标必须全传或全不传；无坐标仅表示“全部专家不一致项”入口。
    var coordinateCount = ['reviewStage', 'reviewItemId', 'bidderId'].filter(function (key) {
      return typeof payload[key] === 'string' && payload[key].trim();
    }).length;
    if (coordinateCount !== 0 && coordinateCount !== 3) {
      throw new Error('reviewStage、reviewItemId、bidderId 必须同时传递');
    }
    if (action === 'AI' && coordinateCount !== 3) {
      throw new Error('action=AI 时必须传递完整矩阵坐标');
    }
  }

  function buildFrameUrl(payload) {
    var baseUrl = new URL(options.appBaseUrl, document.baseURI);
    if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
    var url = new URL(payload.page === 'progress' ? 'progress' : 'page', baseUrl);
    url.searchParams.set('reviewId', payload.reviewId.trim());
    if (payload.page === 'page') {
      // URL只承载页面定位参数，敏感信息和业务结果不放入查询字符串。
      url.searchParams.set('action', payload.action.trim());
      ['reviewStage', 'reviewItemId', 'bidderId'].forEach(function (key) {
        if (payload[key]) url.searchParams.set(key, payload[key].trim());
      });
    }
    return url;
  }

  function applyFrameLayout(mode, width) {
    if (!frame) return;
    var zIndex = options.zIndex || 99999;
    if (mode === 'progress') {
      // 进度页是右侧窄面板，可由子页面请求收起；它不阻塞宿主页面滚动。
      frame.style.cssText = [
        'position:fixed',
        'top:0',
        'right:0',
        'bottom:0',
        'width:' + (width || options.progressWidth || 376) + 'px',
        'height:100%',
        'border:0',
        'background:transparent',
        'display:block',
        'z-index:' + zIndex,
      ].join(';');
      unlockHostScroll();
      return;
    }
    // 评标页自身创建抽屉和遮罩，因此iframe需要覆盖完整视口。
    frame.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:100%',
      'height:100%',
      'border:0',
      'background:transparent',
      'display:block',
      'z-index:' + zIndex,
    ].join(';');
    lockHostScroll();
  }

  function post(type, payload) {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { source: 'ai-review-loader', type: type, payload: payload },
      targetOrigin(frameOrigin),
    );
  }

  function destroyFrame() {
    window.clearTimeout(closeTimer);
    unlockHostScroll();
    if (frame) frame.remove();
    frame = null;
    frameOrigin = '';
    currentMode = '';
  }

  function finalizeClose(payload) {
    var closedMode = currentMode;
    destroyFrame();
    invoke('onClosed', payload || { page: closedMode });
  }

  function open(payload) {
    if (!options) throw new Error('请先调用 AIReview.init(options)');
    validateOpenPayload(payload);
    destroyFrame();

    var frameUrl = buildFrameUrl(payload);
    frameOrigin = normalizeOrigin(frameUrl.origin);
    currentMode = payload.page;
    frame = document.createElement('iframe');
    frame.id = options.frameId || 'ai-review-runtime-frame';
    frame.title = payload.page === 'progress' ? 'AI评审进度' : 'AI评标';
    frame.src = frameUrl.href;
    frame.setAttribute('aria-label', frame.title);
    frame.setAttribute('allow', 'fullscreen');
    frame.addEventListener('load', function () {
      // load后主动初始化；子页面还会发送BOOTSTRAP兜底，避免监听器注册时序造成消息丢失。
      post(MESSAGE.HOST_INIT, {
        hostOrigin: hostOrigin(),
        loaderVersion: '2.0.0',
        page: payload.page,
      });
    });
    applyFrameLayout(payload.page);
    document.body.appendChild(frame);
    invoke('onOpened', payload);
    return api;
  }

  function close() {
    if (!frame) return;
    post(MESSAGE.CLOSE, null);
    // 正常情况下由子页面回发CLOSE_REQUEST；超时兜底保证iframe一定可以被回收。
    closeTimer = window.setTimeout(function () {
      finalizeClose();
    }, 200);
  }

  function isTrustedMessage(event) {
    if (!frame || event.source !== frame.contentWindow) return false;
    return normalizeOrigin(event.origin) === frameOrigin;
  }

  function handleMessage(event) {
    if (!isTrustedMessage(event)) return;
    var message = event.data || {};
    if (message.source !== 'ai-review-app') return;

    if (message.type === MESSAGE.BOOTSTRAP) {
      // 子页面监听器就绪后重新请求初始化，解决首次HOST_INIT早于监听器的问题。
      post(MESSAGE.HOST_INIT, {
        hostOrigin: hostOrigin(),
        loaderVersion: '2.0.0',
        page: currentMode,
      });
      return;
    }
    if (message.type === MESSAGE.READY) {
      invoke('onReady', message.payload);
      return;
    }
    if (message.type === MESSAGE.CLOSE_REQUEST) {
      finalizeClose(message.payload);
      return;
    }
    if (message.type === MESSAGE.RESIZE && currentMode === 'progress') {
      var requestedWidth = Number(message.payload && message.payload.width);
      if (Number.isFinite(requestedWidth)) {
        // 限制子页面可申请的宽度，防止异常消息覆盖整个宿主页面。
        applyFrameLayout('progress', Math.max(48, Math.min(720, requestedWidth)));
      }
      return;
    }
    if (message.type === MESSAGE.ERROR) invoke('onError', message.payload);
  }

  function init(nextOptions) {
    if (!nextOptions || !nextOptions.appBaseUrl) {
      throw new Error('AIReview.init 必须配置 appBaseUrl');
    }
    options = nextOptions;
    return api;
  }

  function destroy() {
    destroyFrame();
    options = null;
  }

  window.addEventListener('message', handleMessage);

  // 对外仅暴露稳定的生命周期API，内部iframe引用不允许宿主直接修改。
  var api = Object.freeze({
    init: init,
    open: open,
    close: close,
    destroy: destroy,
    version: '2.0.0',
  });

  window.AIReview = api;
})(window, document);
