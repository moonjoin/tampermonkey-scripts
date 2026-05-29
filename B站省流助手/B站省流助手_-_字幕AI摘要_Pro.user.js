// ==UserScript==
// @name         B站省流助手 - 字幕AI摘要 Pro
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      4.2.1
// @description  自动提取B站视频字幕，通过自定义AI API生成极简摘要，支持模型切换、持续对话和评论区总结；支持自动解析开关、自动获取模型列表、flomo自动加标签，新增总结生图功能；v3.9.0 新增html PPT模式；v4.0.0 新增新手引导和API兜底功能（无API时仍可下载字幕、一键复制提示词+字幕到其他AI）
// @author       次元饺子
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @match        https://labs.google/fx/*/tools/flow/project*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        unsafeWindow
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/574935/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B%20-%20%E5%AD%97%E5%B9%95AI%E6%91%98%E8%A6%81%20Pro.user.js
// @updateURL https://update.greasyfork.org/scripts/574935/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B%20-%20%E5%AD%97%E5%B9%95AI%E6%91%98%E8%A6%81%20Pro.meta.js
// ==/UserScript==
(function() {
  'use strict';
  if (window.__BILI_SUBTITLE_SUMMARY__) return;
  window.__BILI_SUBTITLE_SUMMARY__ = true;

  const FLOW_PROMPT_JOB_KEY = 'tabbit_flow_prompt_job_v1';
  const FLOW_HEARTBEAT_KEY = 'tabbit_flow_receiver_heartbeat_v1';
  const FLOW_PROMPT_MESSAGE_TYPE = 'FLOW_PROMPT_SUBMIT';
  const DEFAULT_FLOW_PROJECT_URL = 'https://labs.google/fx/zh/tools/flow/project/0ad40d66-236b-42f3-a95f-dde090db0fae';
  const FLOW_HEARTBEAT_INTERVAL_MS = 10000;
  const FLOW_HEARTBEAT_MAX_AGE_MS = 35000;

  function isFlowProjectPage() {
    return location.hostname === 'labs.google' && /\/fx\/.*\/tools\/flow\/project\//.test(location.pathname);
  }

  function parseFlowPromptJob(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch(e) {
      console.warn('[省流助手-Flow] 解析任务失败:', e.message);
      return null;
    }
  }

  function postFlowPromptJob(job) {
    if (!job || !job.text) return;
    const message = {
      source: 'BiliSummaryFlowRelay',
      type: FLOW_PROMPT_MESSAGE_TYPE,
      id: job.id || '',
      text: job.text,
      options: job.options || {}
    };
    window.postMessage(message, window.location.origin);
    if ('BroadcastChannel' in window) {
      try {
        const channel = new BroadcastChannel('flow-prompt-bridge');
        channel.postMessage(message);
        setTimeout(function() { channel.close(); }, 500);
      } catch(e) {
        console.warn('[省流助手-Flow] BroadcastChannel 转发失败:', e.message);
      }
    }
  }

  function setupFlowPromptRelayPage() {
    console.log('[省流助手-Flow] Flow 接收端已启动，等待 B站脚本发送生图提示词');
    const createReceiverWidget = function() {
      const old = document.getElementById('tabbit-flow-receiver-widget');
      if (old) old.remove();

      const widget = document.createElement('div');
      widget.id = 'tabbit-flow-receiver-widget';
      widget.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:16px',
        'z-index:999999',
        'font-family:Arial,"Microsoft YaHei",sans-serif',
        'color:oklch(94% .01 160)',
        'line-height:1.35'
      ].join(';');

      const panel = document.createElement('div');
      panel.style.cssText = [
        'width:276px',
        'background:oklch(20% .018 165)',
        'border:1px solid oklch(42% .04 165)',
        'border-radius:8px',
        'box-shadow:0 14px 36px rgba(0,0,0,.34)',
        'overflow:hidden'
      ].join(';');

      const header = document.createElement('button');
      header.type = 'button';
      header.style.cssText = [
        'width:100%',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'border:0',
        'background:oklch(23% .022 165)',
        'color:oklch(95% .01 165)',
        'padding:10px 12px',
        'cursor:pointer',
        'text-align:left'
      ].join(';');

      const dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:999px;background:oklch(73% .16 155);box-shadow:0 0 0 3px oklch(73% .16 155 / .16);flex:0 0 auto;';

      const titleWrap = document.createElement('span');
      titleWrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;';

      const title = document.createElement('span');
      title.textContent = 'Flow 接收端';
      title.style.cssText = 'font-size:13px;font-weight:800;letter-spacing:0;';

      const subtitle = document.createElement('span');
      subtitle.textContent = '在线，等待生图任务';
      subtitle.style.cssText = 'font-size:11px;color:oklch(78% .025 165);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

      const toggleIcon = document.createElement('span');
      toggleIcon.textContent = '收起';
      toggleIcon.style.cssText = 'font-size:11px;color:oklch(76% .035 165);flex:0 0 auto;';

      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);
      header.appendChild(dot);
      header.appendChild(titleWrap);
      header.appendChild(toggleIcon);

      const body = document.createElement('div');
      body.style.cssText = 'padding:10px 12px 12px;background:oklch(18% .014 165);display:flex;flex-direction:column;gap:8px;';

      const statusLine = document.createElement('div');
      statusLine.textContent = '接收 B站摘要，转发给 Flow 页面。';
      statusLine.style.cssText = 'font-size:12px;color:oklch(84% .018 165);';

      const meta = document.createElement('div');
      meta.style.cssText = 'display:grid;grid-template-columns:56px 1fr;gap:5px 8px;font-size:11px;color:oklch(76% .024 165);';
      meta.innerHTML =
        '<span>最近任务</span><b id="tabbit-flow-last-job" style="color:oklch(91% .02 165);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">暂无</b>' +
        '<span>心跳</span><b id="tabbit-flow-heartbeat" style="color:oklch(91% .02 165);font-weight:700;">刚刚</b>';

      const monitorBox = document.createElement('div');
      monitorBox.style.cssText = 'border-top:1px solid oklch(33% .026 165);padding-top:9px;display:flex;flex-direction:column;gap:8px;';

      const monitorTitle = document.createElement('div');
      monitorTitle.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:oklch(89% .016 165);font-weight:800;';
      monitorTitle.innerHTML = '<span>新图监控下载</span><span id="tabbit-flow-monitor-count" style="font-size:11px;color:oklch(76% .024 165);font-weight:700;">已记 0 / 下载 0 / 生图 0</span>';

      const monitorButtons = document.createElement('div');
      monitorButtons.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;';

      const monitorBtnStyle = 'border:0;border-radius:6px;padding:7px 6px;font-size:12px;font-weight:800;cursor:pointer;';
      const monitorToggleBtn = document.createElement('button');
      monitorToggleBtn.type = 'button';
      monitorToggleBtn.textContent = '开启监控';
      monitorToggleBtn.style.cssText = monitorBtnStyle + 'background:oklch(63% .14 155);color:oklch(15% .02 155);';

      const downloadCurrentBtn = document.createElement('button');
      downloadCurrentBtn.type = 'button';
      downloadCurrentBtn.textContent = '下载当前';
      downloadCurrentBtn.style.cssText = monitorBtnStyle + 'background:oklch(58% .12 250);color:oklch(97% .01 250);opacity:.55;cursor:default;';
      downloadCurrentBtn.disabled = true;

      const clearMemoryBtn = document.createElement('button');
      clearMemoryBtn.type = 'button';
      clearMemoryBtn.textContent = '清记录';
      clearMemoryBtn.style.cssText = monitorBtnStyle + 'background:oklch(32% .025 165);color:oklch(91% .01 165);border:1px solid oklch(43% .04 165);';

      monitorButtons.appendChild(monitorToggleBtn);
      monitorButtons.appendChild(downloadCurrentBtn);
      monitorButtons.appendChild(clearMemoryBtn);
      monitorBox.appendChild(monitorTitle);
      monitorBox.appendChild(monitorButtons);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';

      const collapseBtn = document.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.textContent = '最小化';
      collapseBtn.style.cssText = 'flex:1;border:1px solid oklch(43% .04 165);border-radius:6px;background:oklch(26% .02 165);color:oklch(94% .01 165);padding:7px 8px;font-size:12px;font-weight:700;cursor:pointer;';

      const openBtn = document.createElement('span');
      openBtn.textContent = '后台就绪';
      openBtn.title = '这个标签页保持打开即可接收任务';
      openBtn.style.cssText = 'flex:1;border-radius:6px;background:oklch(63% .14 155);color:oklch(16% .02 155);padding:7px 8px;font-size:12px;font-weight:800;text-align:center;';

      actions.appendChild(collapseBtn);
      actions.appendChild(openBtn);
      body.appendChild(statusLine);
      body.appendChild(meta);
      body.appendChild(monitorBox);
      body.appendChild(actions);

      const mini = document.createElement('button');
      mini.type = 'button';
      mini.style.cssText = [
        'display:none',
        'align-items:center',
        'gap:7px',
        'border:1px solid oklch(42% .04 165)',
        'border-radius:999px',
        'background:oklch(21% .018 165)',
        'color:oklch(94% .01 165)',
        'box-shadow:0 10px 30px rgba(0,0,0,.32)',
        'padding:8px 11px',
        'font-size:12px',
        'font-weight:800',
        'cursor:pointer'
      ].join(';');
      mini.innerHTML = '<span style="width:8px;height:8px;border-radius:999px;background:oklch(73% .16 155);box-shadow:0 0 0 3px oklch(73% .16 155 / .16);"></span><span>Flow 接收</span>';

      panel.appendChild(header);
      panel.appendChild(body);
      widget.appendChild(panel);
      widget.appendChild(mini);

      let collapsed = localStorage.getItem('tabbit_flow_receiver_collapsed') !== 'false';
      const applyCollapsed = function(nextCollapsed) {
        collapsed = !!nextCollapsed;
        localStorage.setItem('tabbit_flow_receiver_collapsed', collapsed ? 'true' : 'false');
        panel.style.display = collapsed ? 'none' : 'block';
        mini.style.display = collapsed ? 'inline-flex' : 'none';
        toggleIcon.textContent = collapsed ? '展开' : '收起';
      };

      header.addEventListener('click', function() { applyCollapsed(true); });
      collapseBtn.addEventListener('click', function() { applyCollapsed(true); });
      mini.addEventListener('click', function() { applyCollapsed(false); });

      const mount = function() {
        if (!document.body || document.getElementById('tabbit-flow-receiver-widget')) return;
        document.body.appendChild(widget);
        applyCollapsed(collapsed);
      };

      document.addEventListener('DOMContentLoaded', mount);
      mount();

      return {
        setStatus: function(text) {
          subtitle.textContent = text || '在线，等待生图任务';
          statusLine.textContent = text || '接收 B站摘要，转发给 Flow 页面。';
        },
        setLastJob: function(text) {
          const el = widget.querySelector('#tabbit-flow-last-job');
          if (el) el.textContent = text || '暂无';
        },
        beat: function() {
          const el = widget.querySelector('#tabbit-flow-heartbeat');
          if (el) el.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        },
        setMonitorCount: function(text) {
          const el = widget.querySelector('#tabbit-flow-monitor-count');
          if (el) el.textContent = text || '已记 0 / 下载 0 / 生图 0';
        },
        controls: {
          monitorToggleBtn: monitorToggleBtn,
          downloadCurrentBtn: downloadCurrentBtn,
          clearMemoryBtn: clearMemoryBtn
        },
        flashJob: function(text) {
          this.setStatus('已转发 Flow 生图任务');
          this.setLastJob(text || '刚刚收到');
          mini.style.background = 'oklch(25% .04 155)';
          setTimeout(function() {
            mini.style.background = 'oklch(21% .018 165)';
          }, 1400);
          setTimeout(() => this.setStatus('在线，等待生图任务'), 2500);
        }
      };
    };

    const receiverWidget = createReceiverWidget();

    const setupIntegratedFlowTools = function(widgetApi) {
      const TOOL_CONFIG = {
        scanIntervalMs: 2000,
        menuOpenDelayMs: 650,
        submenuDelayMs: 650,
        afterClickDelayMs: 250,
        toastTimeoutMs: 45000,
        retryLimit: 6,
        retryBaseDelayMs: 7000,
        qualityText: '2K',
        downloadText: '下载'
      };
      const HACK_ID = 'tabbit-integrated-flow-react-hack';
      const STORAGE_ID = 'tabbit_flow_downloaded_' + (function() {
        const match = location.pathname.match(/\/project\/([^/]+)/);
        return match ? match[1] : 'default_project';
      })();
      const sleep = function(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); };
      const safeJsonParse = function(value) {
        try {
          const parsed = JSON.parse(value || '[]');
          return Array.isArray(parsed) ? parsed : [];
        } catch(e) {
          return [];
        }
      };

      let downloadedIds = new Set(safeJsonParse(typeof GM_getValue === 'function' ? GM_getValue(STORAGE_ID, '[]') : '[]'));
      let seenTileIds = new Set();
      let pendingTileIds = new Set();
      let retryCountById = new Map();
      let queue = [];
      let observer = null;
      let scanTimer = null;
      let isMonitoring = false;
      let isProcessing = false;
      let promptQueue = [];
      let isPromptProcessing = false;
      let handledPromptJobIds = new Set();

      const controls = widgetApi.controls || {};

      const saveDownloadedIds = function() {
        if (typeof GM_setValue === 'function') GM_setValue(STORAGE_ID, JSON.stringify(Array.from(downloadedIds)));
      };

      const updateCounts = function() {
        if (widgetApi && widgetApi.setMonitorCount) {
          widgetApi.setMonitorCount('已记 ' + downloadedIds.size + ' / 下载 ' + (queue.length + pendingTileIds.size) + ' / 生图 ' + promptQueue.length);
        }
      };

      const setReceiverStatus = function(text) {
        if (widgetApi && widgetApi.setStatus) widgetApi.setStatus(text);
        updateCounts();
      };

      const attrEscape = function(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      };

      const injectReactHack = function() {
        if (document.getElementById(HACK_ID)) return;
        const script = document.createElement('script');
        script.id = HACK_ID;
        script.textContent = [
          '(function() {',
          '  if (window.__tabbit_flow_react_hack_installed) return;',
          '  window.__tabbit_flow_react_hack_installed = true;',
          '  var getProps = function(el) {',
          '    if (!el) return null;',
          '    var key = Object.keys(el).find(function(k) { return k.indexOf("__reactProps$") === 0 || k.indexOf("__reactEventHandlers$") === 0; });',
          '    return key ? el[key] : null;',
          '  };',
          '  var trigger = function(el, eventName, eventData) {',
          '    var curr = el;',
          '    while (curr && curr !== document.body) {',
          '      var props = getProps(curr);',
          '      if (props && typeof props[eventName] === "function") {',
          '        try {',
          '          props[eventName](Object.assign({',
          '            preventDefault: function() {},',
          '            stopPropagation: function() {},',
          '            nativeEvent: { isTrusted: true },',
          '            isTrusted: true',
          '          }, eventData || {}));',
          '          return true;',
          '        } catch(e) {}',
          '      }',
          '      curr = curr.parentElement;',
          '    }',
          '    return false;',
          '  };',
          '  var tileSelector = function(tileId) {',
          '    return "div[data-tile-id=\\"" + String(tileId).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\"") + "\\"]";',
          '  };',
          '  document.addEventListener("FMD_RightClick", function(e) {',
          '    var root = document.querySelector(tileSelector(e.detail));',
          '    var el = root && (root.querySelector("img") || root);',
          '    if (!el) return;',
          '    var rect = el.getBoundingClientRect();',
          '    trigger(el, "onContextMenu", { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 2, buttons: 2 });',
          '  });',
          '  document.addEventListener("FMD_ClickItem", function(e) {',
          '    var keyword = e.detail;',
          '    var items = Array.from(document.querySelectorAll("[role=\\"menuitem\\"], button, [role=\\"menuitemradio\\"], div[role=\\"menuitem\\"]"));',
          '    var target = items.find(function(el) {',
          '      var rect = el.getBoundingClientRect();',
          '      return rect.width > 0 && rect.height > 0 && el.textContent && el.textContent.indexOf(keyword) !== -1;',
          '    });',
          '    if (!target) return;',
          '    var eventData = { button: 0, pointerType: "mouse", pointerId: 1 };',
          '    trigger(target, "onPointerDown", eventData);',
          '    trigger(target, "onPointerUp", eventData);',
          '    trigger(target, "onClick", eventData);',
          '    target.click();',
          '  });',
          '})();'
        ].join('\n');
        document.head.appendChild(script);
      };

      const findTileById = function(tileId) {
        return document.querySelector('div[data-tile-id="' + attrEscape(tileId) + '"]');
      };

      const getReadyTileContainers = function() {
        return Array.from(document.querySelectorAll('div[data-tile-id]')).filter(function(container) {
          const tileId = container.getAttribute('data-tile-id');
          if (!tileId) return false;
          if (!container.querySelector('a[href*="/edit/"]')) return false;
          if (container.querySelector('a[href*="/collection/"]')) return false;
          return true;
        });
      };

      const getCurrentTileIds = function() {
        return getReadyTileContainers().map(function(container) {
          return container.getAttribute('data-tile-id');
        }).filter(Boolean);
      };

      const findMenuItem = function(keyword) {
        const items = Array.from(document.querySelectorAll('[role="menuitem"], button, [role="menuitemradio"], div[role="menuitem"]'));
        return items.find(function(el) {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && el.textContent && el.textContent.indexOf(keyword) !== -1;
        });
      };

      const closeVisibleToasts = async function() {
        const closeButtons = Array.from(document.querySelectorAll('li[data-sonner-toast] button'))
          .filter(function(button) { return button.textContent && button.textContent.indexOf('关闭') !== -1; });
        for (const button of closeButtons) {
          button.click();
          await sleep(100);
        }
      };

      const waitForDownloadToast = async function() {
        let elapsed = 0;
        while (elapsed < TOOL_CONFIG.toastTimeoutMs && isMonitoring) {
          const toasts = Array.from(document.querySelectorAll('li[data-sonner-toast]'));
          for (const toast of toasts) {
            const text = toast.textContent || '';
            if (text.indexOf('失败') !== -1 || text.toLowerCase().indexOf('error') !== -1) return -1;
            if (text.indexOf('已完成高清重塑') !== -1 || text.indexOf('已下载') !== -1 || text.indexOf('保存') !== -1 || text.indexOf('成功') !== -1 || text.toLowerCase().indexOf('download') !== -1) {
              await closeVisibleToasts();
              return 1;
            }
          }
          await sleep(500);
          elapsed += 500;
        }
        return 0;
      };

      const markDownloaded = function(tileId) {
        downloadedIds.add(tileId);
        saveDownloadedIds();
        const tile = findTileById(tileId);
        if (tile && !tile.querySelector('.tabbit-flow-downloaded-mark')) {
          const mark = document.createElement('div');
          mark.className = 'tabbit-flow-downloaded-mark';
          mark.textContent = '已下';
          mark.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:99999;padding:2px 6px;border-radius:4px;background:rgba(16,185,129,.95);color:#fff;font-size:12px;font-weight:700;pointer-events:none;';
          tile.style.position = 'relative';
          tile.appendChild(mark);
        }
        updateCounts();
      };

      const downloadTile = async function(tileId) {
        if (downloadedIds.has(tileId)) return { ok: true, skipped: true };
        const tile = findTileById(tileId);
        const editLink = tile && tile.querySelector('a[href*="/edit/"]');
        if (!tile || !editLink) return { ok: false, reason: '图片卡片还没准备好' };
        try {
          editLink.scrollIntoView({ block: 'center', inline: 'center' });
          await sleep(550);
          await closeVisibleToasts();
          document.body.click();
          await sleep(200);
          document.dispatchEvent(new CustomEvent('FMD_RightClick', { detail: tileId }));
          await sleep(TOOL_CONFIG.menuOpenDelayMs);
          let qualityItem = findMenuItem(TOOL_CONFIG.qualityText);
          if (!qualityItem) {
            document.dispatchEvent(new CustomEvent('FMD_ClickItem', { detail: TOOL_CONFIG.downloadText }));
            await sleep(TOOL_CONFIG.submenuDelayMs);
            qualityItem = findMenuItem(TOOL_CONFIG.qualityText);
          }
          if (!qualityItem) {
            document.body.click();
            return { ok: false, reason: '下载菜单未出现' };
          }
          document.dispatchEvent(new CustomEvent('FMD_ClickItem', { detail: TOOL_CONFIG.qualityText }));
          await sleep(TOOL_CONFIG.afterClickDelayMs);
          document.body.click();
          const toastStatus = await waitForDownloadToast();
          if (toastStatus === -1) return { ok: false, reason: '页面提示下载失败' };
          markDownloaded(tileId);
          return { ok: true, timeout: toastStatus === 0 };
        } catch(e) {
          console.error('[省流助手-Flow] 下载异常:', e);
          return { ok: false, reason: e.message || '下载异常' };
        }
      };

      const enqueueTile = function(tileId, source) {
        if (!tileId || downloadedIds.has(tileId) || pendingTileIds.has(tileId)) return;
        pendingTileIds.add(tileId);
        queue.push(tileId);
        console.log('[省流助手-Flow] 下载队列:', tileId, source);
        setReceiverStatus('发现新图，准备下载');
        processQueue();
      };

      const retryLater = function(tileId, reason) {
        const nextCount = (retryCountById.get(tileId) || 0) + 1;
        retryCountById.set(tileId, nextCount);
        if (nextCount > TOOL_CONFIG.retryLimit) {
          console.warn('[省流助手-Flow] 已放弃下载 ' + tileId + ': ' + reason);
          setReceiverStatus('部分图片下载失败');
          return;
        }
        setTimeout(function() {
          if (isMonitoring && !downloadedIds.has(tileId)) enqueueTile(tileId, 'retry');
        }, TOOL_CONFIG.retryBaseDelayMs * nextCount);
      };

      async function processQueue() {
        if (isProcessing) return;
        isProcessing = true;
        while (isMonitoring && queue.length > 0) {
          const tileId = queue.shift();
          pendingTileIds.delete(tileId);
          updateCounts();
          if (downloadedIds.has(tileId)) continue;
          setReceiverStatus('下载中');
          const result = await downloadTile(tileId);
          if (!result.ok && isMonitoring) retryLater(tileId, result.reason);
          await sleep(900);
        }
        isProcessing = false;
        if (isMonitoring) setReceiverStatus(queue.length ? '排队中' : '监控中');
      }

      const scanForNewTiles = function() {
        if (!isMonitoring) return;
        getCurrentTileIds().forEach(function(tileId) {
          if (seenTileIds.has(tileId)) return;
          seenTileIds.add(tileId);
          enqueueTile(tileId, 'new');
        });
      };

      const enqueueCurrentTiles = function() {
        const ids = getCurrentTileIds();
        ids.forEach(function(tileId) {
          seenTileIds.add(tileId);
          if (!downloadedIds.has(tileId)) enqueueTile(tileId, 'current');
        });
        setReceiverStatus(ids.length ? '当前图片已入队' : '未发现图片');
      };

      const startMonitoring = function() {
        if (isMonitoring) return;
        isMonitoring = true;
        queue = [];
        pendingTileIds.clear();
        retryCountById.clear();
        seenTileIds = new Set(getCurrentTileIds());
        observer = new MutationObserver(scanForNewTiles);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tile-id', 'href', 'src'] });
        scanTimer = setInterval(scanForNewTiles, TOOL_CONFIG.scanIntervalMs);
        if (controls.monitorToggleBtn) {
          controls.monitorToggleBtn.textContent = '停止监控';
          controls.monitorToggleBtn.style.background = 'oklch(62% .18 28)';
          controls.monitorToggleBtn.style.color = 'oklch(98% .01 28)';
        }
        if (controls.downloadCurrentBtn) {
          controls.downloadCurrentBtn.disabled = false;
          controls.downloadCurrentBtn.style.opacity = '1';
          controls.downloadCurrentBtn.style.cursor = 'pointer';
        }
        setReceiverStatus('监控中，已忽略当前 ' + seenTileIds.size + ' 张');
      };

      const stopMonitoring = function() {
        isMonitoring = false;
        queue = [];
        pendingTileIds.clear();
        if (observer) observer.disconnect();
        observer = null;
        if (scanTimer) clearInterval(scanTimer);
        scanTimer = null;
        if (controls.monitorToggleBtn) {
          controls.monitorToggleBtn.textContent = '开启监控';
          controls.monitorToggleBtn.style.background = 'oklch(63% .14 155)';
          controls.monitorToggleBtn.style.color = 'oklch(15% .02 155)';
        }
        if (controls.downloadCurrentBtn) {
          controls.downloadCurrentBtn.disabled = true;
          controls.downloadCurrentBtn.style.opacity = '.55';
          controls.downloadCurrentBtn.style.cursor = 'default';
        }
        setReceiverStatus('在线，等待生图任务');
      };

      const clearDownloadedMemory = function() {
        downloadedIds = new Set();
        saveDownloadedIds();
        document.querySelectorAll('.tabbit-flow-downloaded-mark').forEach(function(el) { el.remove(); });
        setReceiverStatus('下载记录已清空');
      };

      const findSubmitButton = function() {
        return Array.from(document.querySelectorAll('button')).find(function(button) {
          const icon = button.querySelector('i.google-symbols');
          const text = button.textContent || '';
          const isSubmitLike = (icon && icon.textContent.trim() === 'arrow_forward') || text.indexOf('创建') !== -1;
          return isSubmitLike && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
        });
      };

      const fillPromptText = async function(text) {
        const editor = document.querySelector('[data-slate-editor="true"]');
        if (!editor) return { ok: false, reason: '未找到 Flow 输入框' };
        try {
          editor.scrollIntoView({ block: 'center', inline: 'center' });
          await sleep(200);
          editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          editor.focus();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          selection.removeAllRanges();
          selection.addRange(range);
          await sleep(50);
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          editor.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: dt, bubbles: true, cancelable: true }));
          editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
          return { ok: true };
        } catch(e) {
          console.error('[省流助手-Flow] 填入失败:', e);
          return { ok: false, reason: e.message || '填入失败' };
        }
      };

      const submitGeneration = async function() {
        await sleep(600);
        document.dispatchEvent(new CustomEvent('FMD_ClickItem', { detail: '创建' }));
        document.dispatchEvent(new CustomEvent('FMD_ClickItem', { detail: 'arrow_forward' }));
        let submitBtn = findSubmitButton();
        let waited = 0;
        while (!submitBtn && waited < 4000) {
          await sleep(500);
          waited += 500;
          submitBtn = findSubmitButton();
        }
        if (submitBtn) {
          submitBtn.click();
          return { ok: true };
        }
        return { ok: false, reason: '未找到可点击的创建按钮' };
      };

      const waitForGenerationReady = async function(timeoutMs) {
        let elapsed = 0;
        while (elapsed < timeoutMs) {
          if (findSubmitButton()) return true;
          await sleep(1000);
          elapsed += 1000;
        }
        return false;
      };

      const runPromptJob = async function(job) {
        const text = String(job.text || '').trim();
        if (!text) return { ok: false, reason: '收到的文字为空' };
        setReceiverStatus('填词中');
        const fillResult = await fillPromptText(text);
        if (!fillResult.ok) return fillResult;
        setReceiverStatus('提交生图');
        const submitResult = await submitGeneration();
        if (!submitResult.ok) return submitResult;
        setReceiverStatus('等待生图完成');
        await sleep(2000);
        await waitForGenerationReady(Number(job.options && job.options.waitMs) || 120000);
        setReceiverStatus(isMonitoring ? '监控中' : '已提交生图');
        return { ok: true };
      };

      async function processPromptQueue() {
        if (isPromptProcessing) return;
        isPromptProcessing = true;
        while (promptQueue.length > 0) {
          const job = promptQueue.shift();
          updateCounts();
          const result = await runPromptJob(job);
          if (!result.ok) {
            console.warn('[省流助手-Flow] 生图任务失败:', result.reason);
            setReceiverStatus(result.reason || '接口任务失败');
          }
          await sleep(800);
        }
        isPromptProcessing = false;
        if (isMonitoring) setReceiverStatus('监控中');
        updateCounts();
      }

      const enqueuePromptJob = function(text, options) {
        options = options || {};
        promptQueue.push({ text: text, options: options, createdAt: Date.now() });
        setReceiverStatus('收到生图任务');
        updateCounts();
        processPromptQueue();
      };

      const acceptPromptMessage = function(data) {
        if (!data || data.type !== FLOW_PROMPT_MESSAGE_TYPE) return;
        if (data.id) {
          if (handledPromptJobIds.has(data.id)) return;
          handledPromptJobIds.add(data.id);
          if (handledPromptJobIds.size > 300) handledPromptJobIds = new Set(Array.from(handledPromptJobIds).slice(-120));
        }
        enqueuePromptJob(data.text, data.options || {});
      };

      window.addEventListener('message', function(event) {
        if (event.origin && event.origin !== window.location.origin) return;
        acceptPromptMessage(event.data);
      });

      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('flow-prompt-bridge');
        channel.onmessage = function(event) { acceptPromptMessage(event.data); };
      }

      window.FlowPromptBridge = {
        submit: function(text, options) {
          enqueuePromptJob(text, options || {});
        },
        send: function(text, options) {
          enqueuePromptJob(text, options || {});
        }
      };
      window.FlowSubmitPrompt = window.FlowPromptBridge.submit;

      injectReactHack();
      if (controls.monitorToggleBtn) controls.monitorToggleBtn.addEventListener('click', function() {
        if (isMonitoring) stopMonitoring();
        else startMonitoring();
      });
      if (controls.downloadCurrentBtn) controls.downloadCurrentBtn.addEventListener('click', enqueueCurrentTiles);
      if (controls.clearMemoryBtn) controls.clearMemoryBtn.addEventListener('click', clearDownloadedMemory);
      updateCounts();
    };

    setupIntegratedFlowTools(receiverWidget);

    let lastJobId = '';
    const handleJob = function(value) {
      const job = parseFlowPromptJob(value);
      if (!job || !job.text || job.id === lastJobId) return;
      lastJobId = job.id || String(Date.now());
      postFlowPromptJob(job);
      setTimeout(function() { postFlowPromptJob(job); }, 1500);
      setTimeout(function() { postFlowPromptJob(job); }, 4000);
      receiverWidget.flashJob(job.title || job.id || '新任务');
    };

    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(FLOW_PROMPT_JOB_KEY, function(_name, _oldValue, newValue, remote) {
        if (!remote) return;
        handleJob(newValue);
      });
    } else {
      console.warn('[省流助手-Flow] 当前脚本环境缺少 GM_addValueChangeListener');
    }

    if (typeof GM_getValue === 'function') {
      setTimeout(function() { handleJob(GM_getValue(FLOW_PROMPT_JOB_KEY, '')); }, 1200);
    }

    const writeHeartbeat = function() {
      if (typeof GM_setValue !== 'function') return;
      GM_setValue(FLOW_HEARTBEAT_KEY, JSON.stringify({
        url: location.href,
        ts: Date.now()
      }));
      receiverWidget.beat();
    };
    writeHeartbeat();
    setInterval(writeHeartbeat, FLOW_HEARTBEAT_INTERVAL_MS);
  }

  if (isFlowProjectPage()) {
    setupFlowPromptRelayPage();
    return;
  }

  const PROMPT_TEXT = '我极度没有耐心，不想动脑子，脾气暴躁且阅读困难。请用最直白的大白话给我解释这视频到底在说什么，在能解释清楚的前提下废话越少越好，禁止使用任何专业术语。请按以下顺序直接输出：1.【结论】直接告诉我核心意思；2.【具体讲了啥】用极简的白话说明来龙去脉；3.【关键点】列出最重要的几个要点；4.【对我有什么用】直接说明价值，如果是纯广告或水视频请直接告诉我避雷；5.【原链接】在最后附上视频原始链接。记住，不要任何寒暄、铺垫和解释，直接开始回答！';

  const COMMENT_PROMPT_TEXT = '你是一个专业的评论分析助手。请对以下B站视频评论进行总结分析，包括：\n1. 评论整体情感倾向（正面/负面/中性）\n2. 主要讨论话题（列出3-5个）\n3. 有趣/高赞评论摘录\n4. 我理解能力差、没耐心，别讲铺垫、别讲背景、别讲废话，只告诉我：这东西核心结论是什么、有哪几个关键点、对我有什么用。';

  const DANMAKU_PROMPT_TEXT = '你是一个专业的弹幕分析助手。请对以下B站视频弹幕进行总结分析，包括：\n1. 弹幕整体情感倾向（正面/负面/中性/混合）\n2. 弹幕讨论的热点话题（列出3-5个）\n3. 高频出现的关键词或梗\n4. 观众对视频内容的反应（哪些片段引发热烈讨论）\n5. 有趣/有代表性的弹幕摘录\n6. 我理解能力差、没耐心，别讲铺垫、别讲背景、别讲废话，只告诉我：这东西核心结论是什么、有哪几个关键点、对我有什么用。';

  const IMAGE_GEN_PROMPT_TEXT = '根据以下视频内容总结，生成一张信息可视化的精美配图，风格清晰美观，适合作为视频总结的封面图：\n\n{summary}';
  const HTML_PPT_PROMPT_TEXT = '请基于以下视频摘要生成一个可直接保存为 .html 的完整可视化总结页面。\n\n硬性要求：\n1. 只输出完整 HTML 文档，从 <!doctype html> 或 <html> 开始，不要 Markdown 代码块，不要解释。\n2. {layoutInstruction}\n3. 页面必须信息密度高，不能只有空白卡片、空标题、占位符或无正文。\n4. 必须图文并茂：使用 CSS 图形、SVG、图标、流程图、卡片、对比表、时间线、指标块等视觉元素。\n5. 可以使用内联 CSS、内联 SVG、emoji、少量内联 JS；如使用外部图片/字体/CDN，必须有纯 CSS/SVG 降级，不能依赖外部资源才能看。\n6. 视觉风格要现代、清晰、适合全屏查看，不要输出普通文章排版。\n\n视频标题：{title}\nUP主：{upName}\n视频链接：{url}\n\n视频摘要：\n{summary}';
  const HTML_PPT_SINGLE_PROMPT_TEXT = HTML_PPT_PROMPT_TEXT;
  const HTML_PPT_SLIDES_PROMPT_TEXT = '请基于以下视频摘要生成一个可直接保存为 .html 的完整 HTML PPT。\n\n硬性要求：\n1. 只输出完整 HTML 文档，从 <!doctype html> 或 <html> 开始，不要 Markdown 代码块，不要解释。\n2. {layoutInstruction}\n3. 必须做成真正的翻页演示稿，不要输出普通文章排版。\n4. 每页必须图文并茂：使用 CSS 图形、SVG、图标、流程图、卡片、对比表、时间线、指标块等视觉元素。\n5. 可以使用内联 CSS、内联 SVG、emoji、少量内联 JS；如使用外部图片/字体/CDN，必须有纯 CSS/SVG 降级，不能依赖外部资源才能看。\n6. 视觉风格要现代、清晰、适合全屏演示。\n\n视频标题：{title}\nUP主：{upName}\n视频链接：{url}\n\n视频摘要：\n{summary}';

  // ==================== localStorage 配置存储层 ====================
  const STORAGE_KEY = 'bili_summary_pro_config';
  const POSITION_KEY = 'bili_summary_pro_positions';
  const SUMMARY_CACHE_KEY = 'bili_summary_pro_summary_cache_v1';
  const SUMMARY_CACHE_MAX_ENTRIES = 20;
  const SUMMARY_CACHE_MAX_CHARS = 250000;

  const DEFAULT_PRESETS = [
    {
      id: 'preset_default',
      name: '极简白话版',
      icon: '🎯',
      prompt: PROMPT_TEXT
    },
    {
      id: 'preset_detailed',
      name: '详细笔记版',
      icon: '📝',
      prompt: '请基于视频字幕内容，生成一份结构清晰的学习笔记，包括：\n1. 【主题概述】视频主题与核心论点\n2. 【内容大纲】用层级列表展示视频结构\n3. 【关键概念】解释视频中出现的重要概念/术语\n4. 【金句摘录】3-5条值得记录的话\n5. 【个人启发】你认为这个视频对观众的价值\n请使用 Markdown 格式输出。'
    },
    {
      id: 'preset_critical',
      name: '批判分析版',
      icon: '🔍',
      prompt: '请以批判性思维审视这个视频，输出：\n1. 【核心观点】视频在表达什么\n2. 【论据评估】UP主用了哪些证据，是否充分\n3. 【逻辑漏洞】存在哪些推理瑕疵或片面表达\n4. 【对立观点】可能存在的反驳或不同视角\n5. 【最终判断】这个视频值得相信吗？是否广告/带货/水视频？\n请直接输出，不要寒暄。'
    },
    {
      id: 'preset_action',
      name: '行动清单版',
      icon: '✅',
      prompt: '请把视频内容转化为可执行的行动清单：\n1. 【核心收获】用一句话说清视频教了什么\n2. 【具体步骤】列出可立即执行的步骤（带数字编号）\n3. 【注意事项】容易踩的坑\n4. 【适用场景】什么情况下用得上\n5. 【预期效果】照做能达到什么\n保持简洁，重在可操作性。'
    }
  ];


  const DEFAULT_FULL_ANALYSIS_PRESETS = [
    {
      id: 'fullpreset_video_review',
      name: '内容审核版',
      icon: '🎬',
      prompt: '你是一个专业的视频内容审核员。请基于以下视频字幕、弹幕和评论数据，完成以下分析：\n\n首先，以视频字幕内容为主体，完整梳理视频的核心论点、论述逻辑和关键信息。然后，结合弹幕和评论作为观众舆情参考，从以下维度进行分析：\n\n1. 【视频核心内容】用简洁的话概括视频到底在讲什么\n2. 【内容准确性】结合弹幕和评论中的纠错、质疑信息，检查视频内容是否存在事实错误、数据不准、逻辑漏洞或断章取义，如果有请明确指出并给出正确的信息\n3. 【观点补充】弹幕和评论中有哪些对视频内容的重要补充、不同视角或反驳\n4. 【观众反馈】弹幕和评论的整体情感倾向，观众最关注/最认可/最质疑的点\n5. 【综合评价】视频内容质量和可信度如何，值不值得看\n\n注意：弹幕和评论只作为舆情参考，分析应以视频内容本身为主。不要任何废话，直接输出。'
    },
    {
      id: 'fullpreset_quick_review',
      name: '极简速览版',
      icon: '⚡',
      prompt: '你是一个高效的视频内容分析助手。请基于以下视频字幕、弹幕和评论数据，用最简洁的方式告诉我：\n\n1. 【一句话总结】这个视频讲了什么\n2. 【内容要点】3-5个关键点\n3. 【内容纠错】结合弹幕评论，视频中有没有说错的地方（没有就不写）\n4. 【口碑】弹幕和评论里大家怎么看这个视频\n5. 【值不值】花时间看这个视频值不值\n\n弹幕和评论仅作舆情参考，重点分析视频本身内容。废话越少越好，直接开始。'
    },
    {
      id: 'fullpreset_deep_critique',
      name: '深度批判版',
      icon: '🔍',
      prompt: '你是一个深度内容分析师。请基于以下视频字幕、弹幕和评论数据，以视频内容为主体进行全面批判性分析：\n\n1. 【核心论点】视频在表达什么观点/主张\n2. 【论证质量】UP主用了哪些论据和逻辑，是否充分、严谨\n3. 【事实核查】结合弹幕和评论中的纠错信息，视频中是否存在事实错误、数据不准确、过度简化或误导性表达\n4. 【多方视角】弹幕和评论中呈现了哪些不同的观点和争议\n5. 【内容价值】综合评估这个视频的信息密度、可信度和观看价值\n\n以视频内容为核心，弹幕和评论作为辅助验证。直接输出，不要寒暄。'
    }
  ];

  const DEFAULT_CONFIG = {
    apiUrl: 'https://xxxx/v1',
    apiKey: 'sk-xxxx',
    model: 'deepseek-v4-flash',
    flomoApiUrl: '',
    flomoTags: '#B站省流助手 #视频摘要',
    modelList: [
      'claude-opus-4-6',
      'gemini-3-flash-preview',
      'gpt-5.4',
      'deepseek-v4-flash',
    ],
    promptText: PROMPT_TEXT,
    commentPromptText: COMMENT_PROMPT_TEXT,
    commentTextPresets: ['省流'],
    danmakuPromptText: DANMAKU_PROMPT_TEXT,
    fullAnalysisPromptText: DEFAULT_FULL_ANALYSIS_PRESETS[0].prompt,
    fullAnalysisPresets: DEFAULT_FULL_ANALYSIS_PRESETS,
    activeFullAnalysisPresetId: 'fullpreset_video_review',
    fullDataMaxChars: 64000,
    summaryMaxTokens: 4000,
    skipDuration: 60,
    autoParse: true,
    promptPresets: DEFAULT_PRESETS,
    activePresetId: 'preset_default',
    enableImageGen: false,
    imageGenApiUrl: '',
    imageGenApiKey: '',
    imageGenModel: 'gemini-3.1-flash-image-preview',
    imageGenSize: '1024x1024',
    enableImageAutoDownload: true,
    imageGenMode: 'api',
    flowProjectUrl: DEFAULT_FLOW_PROJECT_URL,
    enableFlowBackgroundOpen: true,
    imageGenPromptText: IMAGE_GEN_PROMPT_TEXT,
    htmlPptPromptText: HTML_PPT_PROMPT_TEXT,
    htmlPptSkillText: '',
    htmlPptSkillName: '',
    htmlPptLayoutMode: 'single',
    htmlPptMaxTokens: 8000,
    enableHtmlPptDirect: false,
    commentMaxPages: 8,
    commentLimit: 188,
    commentMinDelay: 1800,
    commentMaxDelay: 3800,
    autoSubmitCommentSummary: false
  };

  const SUMMARY_LENGTH_ERROR_MESSAGE = 'AI 输出被截断：finish_reason=length。请在设置中调大「普通摘要最大输出 tokens」，或换支持更大输出上限的模型/API。';
  const HTML_PPT_LENGTH_ERROR_MESSAGE = 'AI 输出被截断：finish_reason=length。请调大 HTML PPT 最大输出 tokens，或换支持更大输出上限的模型/API。';

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        return Object.assign({}, DEFAULT_CONFIG, saved);
      }
    } catch(e) {
      console.warn('[省流助手] 读取配置失败，使用默认配置:', e.message);
    }
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch(e) {
      console.warn('[省流助手] 保存配置失败:', e.message);
    }
  }

  function loadPositions() {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {};
  }
  function savePositions(pos) {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
    } catch(e) {}
  }

  function hashString(str) {
    let h = 2166136261;
    const text = String(str || '');
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function loadSummaryCache() {
    try {
      const raw = localStorage.getItem(SUMMARY_CACHE_KEY);
      if (raw) {
        const cache = JSON.parse(raw);
        if (cache && cache.entries && Array.isArray(cache.order)) return cache;
      }
    } catch(e) {
      console.warn('[省流助手] 读取摘要缓存失败:', e.message);
    }
    return { version: 1, entries: {}, order: [] };
  }

  function saveSummaryCache(cache) {
    try {
      localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(cache));
    } catch(e) {
      console.warn('[省流助手] 保存摘要缓存失败，尝试清理旧缓存:', e.message);
      try {
        cache.order = cache.order.slice(-Math.ceil(SUMMARY_CACHE_MAX_ENTRIES / 2));
        const keep = new Set(cache.order);
        Object.keys(cache.entries).forEach(k => { if (!keep.has(k)) delete cache.entries[k]; });
        localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(cache));
      } catch(e2) {
        console.warn('[省流助手] 二次保存摘要缓存失败:', e2.message);
      }
    }
  }

  function pruneSummaryCache(cache) {
    let totalChars = cache.order.reduce((sum, key) => sum + ((cache.entries[key]?.summary || '').length), 0);
    while (cache.order.length > SUMMARY_CACHE_MAX_ENTRIES || totalChars > SUMMARY_CACHE_MAX_CHARS) {
      const oldKey = cache.order.shift();
      if (!oldKey) break;
      totalChars -= (cache.entries[oldKey]?.summary || '').length;
      delete cache.entries[oldKey];
    }
    return cache;
  }

  function buildSummaryCacheKey(videoInfo, model, presetId, promptText, transcript) {
    const bvid = videoInfo?.bvid || location.pathname;
    return [
      'v1',
      bvid,
      model || '',
      presetId || '',
      hashString(promptText || ''),
      hashString(transcript || '')
    ].join('::');
  }

  function getCachedSummary(cacheKey) {
    const cache = loadSummaryCache();
    const item = cache.entries[cacheKey];
    if (!item || !item.summary) return null;
    cache.order = cache.order.filter(k => k !== cacheKey);
    cache.order.push(cacheKey);
    item.lastUsedAt = Date.now();
    saveSummaryCache(pruneSummaryCache(cache));
    return item.summary;
  }

  function setCachedSummary(cacheKey, payload) {
    if (!cacheKey || !payload || !payload.summary) return;
    const cache = loadSummaryCache();
    cache.entries[cacheKey] = {
      summary: payload.summary,
      model: payload.model || '',
      presetId: payload.presetId || '',
      title: payload.title || '',
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };
    cache.order = cache.order.filter(k => k !== cacheKey);
    cache.order.push(cacheKey);
    saveSummaryCache(pruneSummaryCache(cache));
  }

  function clearSummaryCache() {
    try {
      localStorage.removeItem(SUMMARY_CACHE_KEY);
    } catch(e) {}
  }

  function getSummaryCacheStats() {
    const cache = loadSummaryCache();
    const count = cache.order.length;
    const chars = cache.order.reduce((sum, key) => sum + ((cache.entries[key]?.summary || '').length), 0);
    return { count, chars };
  }

  // ==================== API 配置检测 ====================
  function isApiConfigured() {
    var url = normalizeApiUrlInput(CONFIG.apiUrl);
    var key = String(CONFIG.apiKey || '').trim();
    var defaultUrl = normalizeApiUrlInput(DEFAULT_CONFIG.apiUrl);
    var defaultKey = String(DEFAULT_CONFIG.apiKey || '').trim();

    if (!url || !key) {
      return { configured: false, reason: 'API URL 或 API Key 未填写' };
    }
    if (url === defaultUrl) {
      return { configured: false, reason: 'API URL 仍是默认占位符，请填写真实的 API 地址' };
    }
    if (key === defaultKey) {
      return { configured: false, reason: 'API Key 仍是默认占位符，请填写真实的 API Key' };
    }
    return { configured: true, reason: '' };
  }

  /**
   * 构建完整的"提示词+视频信息+字幕"文本，供用户一键复制到其他AI app
   */
  function buildPromptWithTranscript(videoInfo, transcript) {
    var activePresetId = getCurrentPresetId();
    var activePreset = (CONFIG.promptPresets || []).find(function(p) { return p.id === activePresetId; });
    var activePrompt = (activePreset && activePreset.prompt) || CONFIG.promptText || PROMPT_TEXT;
    var videoDesc = limitText(videoInfo.desc || '', 1500);
    var pageUrl = window.location.href;

    var parts = [];
    parts.push('===== 📝 AI 提示词 =====');
    parts.push(activePrompt);
    parts.push('');
    parts.push('===== 📺 视频信息 =====');
    parts.push('视频URL: ' + pageUrl);
    parts.push('视频标题: ' + (videoInfo.title || ''));
    parts.push('UP主: ' + (videoInfo.upName || ''));
    if (videoDesc) {
      parts.push('视频简介: ' + videoDesc);
    }
    parts.push('');
    parts.push('===== 📄 字幕内容 =====');
    parts.push(transcript);
    parts.push('');
    parts.push('===== 💡 使用说明 =====');
    parts.push('请将以上全部内容复制粘贴到任意 AI 对话（如 ChatGPT、DeepSeek、Kimi 等），即可生成视频摘要。');
    return parts.join('\n');
  }

  /**
   * 显示 API 未配置时的兜底 UI：提供下载字幕和一键复制提示词+字幕的功能
   */
  function showApiNotConfiguredFallback(contentDiv, videoInfo, reason) {
    var apiCheck = reason || isApiConfigured().reason;
    var actionsDiv = contentDiv.querySelector('.tabbit-result-actions');

    var fallbackHtml =
      '<div style="background:linear-gradient(135deg,#fff3e0 0%,#fff8e1 100%);border:1px solid #ffe0b2;border-radius:10px;padding:14px;margin-bottom:10px;">' +
        '<div style="font-size:14px;font-weight:600;color:#e65100;margin-bottom:8px;">⚠️ API 未配置或配置错误</div>' +
        '<div style="font-size:12.5px;color:#bf360c;line-height:1.6;margin-bottom:10px;">' +
          escapeHtml(apiCheck) + '<br>' +
          '但别担心！字幕已成功获取，你仍可以：<br>' +
          '① 一键复制下方内容，粘贴到任意 AI 对话框生成摘要<br>' +
          '② 直接下载字幕文件留作备份' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="tabbit-copy-btn" id="tabbit-copy-prompt-transcript" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border:none;font-weight:600;">📋 一键复制 提示词+字幕</button>' +
          '<button class="tabbit-download-btn" id="tabbit-download-transcript-fallback">💾 下载字幕文件</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#999;margin-top:8px;">💡 复制后打开 ChatGPT / DeepSeek / Kimi 等任意 AI，粘贴发送即可获得视频摘要</div>' +
      '</div>' +
      '<button class="tabbit-settings-btn tabbit-settings-btn-primary" id="tabbit-open-settings-fallback" style="width:100%;margin-top:6px;padding:10px;font-size:14px;">⚙️ 去配置 API（自动总结）</button>';

    var resultContainer = contentDiv.querySelector('.tabbit-result');
    if (resultContainer) {
      resultContainer.innerHTML = fallbackHtml;
    }

    if (actionsDiv) {
      actionsDiv.innerHTML = '';
      var modelTag = document.createElement('span');
      modelTag.style.cssText = 'font-size:11px;color:#999;margin-left:auto;';
      modelTag.textContent = '📌 v4.0 兜底模式';
      actionsDiv.appendChild(modelTag);
    }

    // 绑定一键复制按钮
    var copyBtn = contentDiv.querySelector('#tabbit-copy-prompt-transcript');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var promptText = buildPromptWithTranscript(videoInfo, rawTranscript);
        copyToClipboard(promptText).then(function() {
          copyBtn.textContent = '✅ 已复制！去 AI 粘贴吧';
          copyBtn.style.background = 'linear-gradient(135deg,#43a047 0%,#2e7d32 100%)';
          setTimeout(function() {
            copyBtn.textContent = '📋 一键复制 提示词+字幕';
            copyBtn.style.background = 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)';
          }, 3000);
        });
      });
    }

    // 绑定下载字幕按钮
    var downloadBtn = contentDiv.querySelector('#tabbit-download-transcript-fallback');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function() {
        downloadTranscript(rawTranscript, videoInfo.title, videoInfo.upName, videoInfo.bvid);
      });
    }

    // 绑定去设置按钮
    var settingsBtn = contentDiv.querySelector('#tabbit-open-settings-fallback');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function() {
        var panel = contentDiv.closest('#tabbit-ai-summary-panel');
        if (panel) openSettingsPanel(panel);
      });
    }

    // 启用评论区按钮和模型芯片
    var panel = contentDiv.closest('#tabbit-ai-summary-panel');
    if (panel) {
      panel.querySelectorAll('.tabbit-model-chip').forEach(function(c) { c.classList.remove('disabled'); });
      panel.querySelectorAll('.tabbit-preset-chip').forEach(function(c) { c.classList.remove('disabled'); });
      var commentBtn = contentDiv.querySelector('#tabbit-comment-btn');
      if (commentBtn) commentBtn.disabled = false;
      var danmakuBtn = contentDiv.querySelector('#tabbit-danmaku-btn');
      if (danmakuBtn) danmakuBtn.disabled = false;
      var fullBtn = contentDiv.querySelector('#tabbit-full-btn');
      if (fullBtn) fullBtn.disabled = false;
    }
  }

  let CONFIG = loadConfig();
  let currentPresetId = CONFIG.activePresetId || 'preset_default';
  let POSITIONS = loadPositions();
  const INIT_DELAY_MS = 2000;
  const MAX_CONVERSATION_HISTORY = 21;
  const IMAGE_GEN_SUMMARY_MAX_LEN = 5000;
  const BILI_API_TIMEOUT_MS = 12000;
  const BILI_SUBTITLE_TIMEOUT_MS = 15000;
  const AUX_REQUEST_TIMEOUT_MS = 30000;
  // 🆕 流式渲染节流间隔（ms），控制 UI 重绘频率
  const STREAM_RENDER_THROTTLE = 80;

  class BiliRiskControlError extends Error {
    constructor(message) {
      super(message);
      this.name = 'BiliRiskControlError';
    }
  }

  const SAFE_FETCH_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Origin': 'https://www.bilibili.com'
  };

  const COMMENT_CONFIG = {
    pageSize: 20,
    maxPages: 8,
    sortType: 2,
    includeReplies: true,
    commentLimit: 188,
    minDelay: 1800,
    maxDelay: 3800,
    maxRetries: 1,
    retryBaseDelay: 8000
  };

  const DANMAKU_CONFIG = {
    maxDanmaku: 3000,
    segmentSize: 2000,
    maxSegments: 5,
    minDelay: 1200,
    maxDelay: 2500,
    maxRetries: 2,
    retryBaseDelay: 5000
  };

  let rawMarkdownResult = '';
  let rawTranscript = '';
  let rawSubtitleBody = [];
  let currentVideoInfo = null;
  let currentModel = CONFIG.model;
  let conversationHistory = [];
  let commentConversationHistory = [];
  let isCommentSummarizing = false;
  let isDanmakuAnalyzing = false;
  let hasParsed = false;
  let lastRouteKey = '';
  let routeRestartTimer = null;
  let routeGeneration = 0;
  // 🆕 当前正在进行的 AI 任务的 AbortController（用于打断流式输出）
  let currentAbortController = null;
  let currentSubtitleManualFallback = null;

  function getSummaryMaxTokens() {
    const n = parseInt(CONFIG.summaryMaxTokens, 10);
    return isNaN(n) ? DEFAULT_CONFIG.summaryMaxTokens : Math.max(500, Math.min(30000, n));
  }

  function buildSummaryStreamOptions(signal, extraOptions) {
    const opts = Object.assign({
      maxTokens: getSummaryMaxTokens(),
      errorMessageOverride: SUMMARY_LENGTH_ERROR_MESSAGE
    }, extraOptions || {});
    if (signal) opts.signal = signal;
    return opts;
  }

  // ==================== 视频信息获取 ====================
  function cleanVideoDescription(text) {
    return String(text || '')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function limitText(text, maxLen) {
    const clean = cleanVideoDescription(text);
    if (!clean || clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen) + '\n...（简介过长，已截断）';
  }

  function normalizeImageSizeInput(raw) {
    const value = String(raw || '').trim().replace(/[×＊*]/g, 'x').toLowerCase();
    if (!value) return '1024x1024';
    if (value === 'auto') return value;
    if (!/^\d{2,5}x\d{2,5}$/.test(value)) return '';
    return value;
  }

  function normalizeApiUrlInput(apiUrl) {
    return String(apiUrl || '').trim().replace(/\/+$/, '');
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildApiUrl(apiUrl, endpointPath) {
    const endpoint = String(endpointPath || '').replace(/^\/+/, '');
    let url = normalizeApiUrlInput(apiUrl);
    if (!url || !endpoint) return url;

    const exactEndpointReg = new RegExp('/' + escapeRegExp(endpoint) + '$', 'i');
    if (exactEndpointReg.test(url)) return url;

    const versionMatch = url.match(/^(.*\/v\d+)(?:\/.*)?$/i);
    if (versionMatch) {
      return versionMatch[1] + '/' + endpoint;
    }

    if (/\/(?:chat\/completions|completions|images\/generations|images\/edits|responses|models)$/i.test(url)) {
      return url.replace(/\/(?:chat\/completions|completions|images\/generations|images\/edits|responses|models)$/i, '/' + endpoint);
    }

    return url + '/' + endpoint;
  }

  function buildChatCompletionsUrl(apiUrl) {
    return buildApiUrl(apiUrl, 'chat/completions');
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    options = options || {};
    timeoutMs = timeoutMs || BILI_API_TIMEOUT_MS;
    const externalSignal = options.signal;
    const controller = new AbortController();
    let timedOut = false;
    let fetchResolved = false;
    const onExternalAbort = function() {
      try { controller.abort(); } catch(e) {}
    };
    const timer = setTimeout(function() {
      timedOut = true;
      try { controller.abort(); } catch(e) {}
    }, timeoutMs);
    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort);
      }
    }

    // 🆕 Promise.race 兜底：即使 AbortController 在某些环境下静默失效，
    // 也能保证请求不会永远挂起（常见于安卓 WebView / Tampermonkey）
    var raceTimer = null;
    var raceTimeoutPromise = new Promise(function(_, reject) {
      raceTimer = setTimeout(function() {
        if (!fetchResolved) {
          reject(new Error('请求超时（' + Math.round(timeoutMs / 1000) + '秒）'));
        }
      }, timeoutMs + 3000);
    });

    try {
      var result = await Promise.race([
        fetch(url, Object.assign({}, options, { signal: controller.signal })),
        raceTimeoutPromise
      ]);
      fetchResolved = true;
      return result;
    } catch (err) {
      fetchResolved = true;
      if (isAbortError(err)) {
        if (externalSignal && externalSignal.aborted && !timedOut) {
          const abortErr = new Error('用户已打断');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        throw new Error('请求超时（' + Math.round(timeoutMs / 1000) + '秒）');
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (raceTimer) clearTimeout(raceTimer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  function buildImagePrompt(textContent) {
    const summaryForImage = String(textContent || '').slice(0, IMAGE_GEN_SUMMARY_MAX_LEN).replace(/[#*_\[\]()]/g, '');
    const promptTemplate = CONFIG.imageGenPromptText || IMAGE_GEN_PROMPT_TEXT;
    return promptTemplate.includes('{summary}')
      ? promptTemplate.replace(/\{summary\}/g, summaryForImage)
      : promptTemplate + '\n\n' + summaryForImage;
  }

  function getImageGenMode() {
    return CONFIG.imageGenMode === 'flow' ? 'flow' : 'api';
  }

  function isFlowImageGenMode() {
    return getImageGenMode() === 'flow';
  }

  function getFlowProjectUrl() {
    return String(CONFIG.flowProjectUrl || DEFAULT_FLOW_PROJECT_URL || '').trim();
  }

  function getFlowReceiverHeartbeat() {
    if (typeof GM_getValue !== 'function') return null;
    return parseFlowPromptJob(GM_getValue(FLOW_HEARTBEAT_KEY, ''));
  }

  function normalizeFlowUrlForCompare(url) {
    return String(url || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }

  function isFlowReceiverAlive(flowUrl) {
    const heartbeat = getFlowReceiverHeartbeat();
    if (!heartbeat || !heartbeat.ts) return false;

    const age = Date.now() - Number(heartbeat.ts);
    if (!isFinite(age) || age < 0 || age > FLOW_HEARTBEAT_MAX_AGE_MS) return false;

    const expected = normalizeFlowUrlForCompare(flowUrl);
    const actual = normalizeFlowUrlForCompare(heartbeat.url);
    return !expected || !actual || expected === actual;
  }

  function openFlowProjectInBackground(flowUrl) {
    if (!flowUrl || CONFIG.enableFlowBackgroundOpen === false) return false;

    try {
      if (typeof GM_openInTab === 'function') {
        const tab = GM_openInTab(flowUrl, {
          active: false,
          insert: true,
          setParent: true
        });
        return !!tab;
      }
    } catch(e) {
      console.warn('[省流助手-Flow] GM_openInTab 后台打开失败:', e.message);
    }

    try {
      return !!window.open(flowUrl, '_blank', 'noopener,noreferrer');
    } catch(e) {
      return false;
    }
  }

  function sendPromptToFlowProject(imagePrompt, videoInfo) {
    if (!imagePrompt || !imagePrompt.trim()) {
      throw new Error('没有可发送的生图提示词');
    }
    if (typeof GM_setValue !== 'function') {
      throw new Error('当前脚本缺少 GM_setValue 授权，请重新安装脚本');
    }

    const job = {
      id: 'flow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      text: imagePrompt,
      options: { id: '' },
      source: 'bili-summary',
      title: videoInfo && videoInfo.title ? videoInfo.title : '',
      pageUrl: location.href,
      createdAt: Date.now()
    };
    job.options.id = job.id;
    GM_setValue(FLOW_PROMPT_JOB_KEY, JSON.stringify(job));

    const flowUrl = getFlowProjectUrl();
    let opened = false;
    const receiverAlive = isFlowReceiverAlive(flowUrl);
    if (flowUrl && !receiverAlive) {
      opened = openFlowProjectInBackground(flowUrl);
    }
    return { job: job, opened: opened, flowUrl: flowUrl, receiverAlive: receiverAlive };
  }

  function renderFlowDispatchResult(contentDiv, dispatchResult) {
    const imageSlot = contentDiv && (contentDiv.querySelector('.tabbit-image-slot') || contentDiv.querySelector('.tabbit-result'));
    if (!imageSlot) return;
    const flowUrl = dispatchResult && dispatchResult.flowUrl ? dispatchResult.flowUrl : getFlowProjectUrl();
    imageSlot.innerHTML =
      '<div class="tabbit-img-wrap" style="text-align:left;margin-bottom:12px;padding:14px;background:linear-gradient(135deg,#eef6ff 0%,#f7fbff 100%);border:1px solid #bfdbfe;border-radius:10px;color:#1d4ed8;font-size:13px;line-height:1.6;">' +
        '<div style="font-weight:800;margin-bottom:4px;">已发送到 Google Flow 生图</div>' +
        '<div>本模式只发送提示词，不等待图片回传。图片由 Flow 页面脚本自动下载到本地。</div>' +
        '<div style="margin-top:4px;color:#475569;">' + (dispatchResult && dispatchResult.receiverAlive ? '已检测到后台 Flow 接收页。' : (dispatchResult && dispatchResult.opened ? '未检测到接收页，已后台打开 Flow。' : '未检测到接收页，请确认 Flow 页面已打开。')) + '</div>' +
        (flowUrl ? '<div style="margin-top:6px;color:#64748b;word-break:break-all;">Flow: ' + escapeHtml(flowUrl) + '</div>' : '') +
      '</div>';
  }

  async function triggerFlowImageGen(contentDiv, summaryText, videoInfo, btn) {
    const originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '发送中...';
    }
    try {
      const imagePrompt = buildImagePrompt(summaryText || '');
      const dispatchResult = sendPromptToFlowProject(imagePrompt, videoInfo);
      renderFlowDispatchResult(contentDiv, dispatchResult);
      if (btn) {
        btn.textContent = '已发送到 Flow';
        setTimeout(function() {
          btn.textContent = '发送到 Flow';
          btn.disabled = false;
        }, 1800);
      }
      return dispatchResult;
    } catch (err) {
      console.error('[省流助手-Flow] 发送失败:', err);
      alert('发送到 Flow 失败: ' + err.message);
      if (btn) {
        btn.textContent = originalText || '发送到 Flow';
        btn.disabled = false;
      }
      return null;
    }
  }

  function addUniqueImageCandidate(candidates, kind, url) {
    url = normalizeApiUrlInput(url);
    if (!url) return;
    const key = kind + '|' + url;
    if (candidates.some(function(item) { return item.key === key; })) return;
    candidates.push({ key: key, kind: kind, url: url });
  }

  function buildImageApiCandidates(apiUrl) {
    const url = normalizeApiUrlInput(apiUrl);
    const candidates = [];
    if (!url) return candidates;

    if (/\/images\/generations$/i.test(url)) addUniqueImageCandidate(candidates, 'images', url);
    if (/\/responses$/i.test(url)) addUniqueImageCandidate(candidates, 'responses', url);

    // 保持旧版行为：优先使用支持 size 字段的 Images API，避免 chat 生图忽略 1:1 尺寸。
    addUniqueImageCandidate(candidates, 'images', buildApiUrl(url, 'images/generations'));
    addUniqueImageCandidate(candidates, 'responses', buildApiUrl(url, 'responses'));
    if (/\/chat\/completions$/i.test(url)) addUniqueImageCandidate(candidates, 'chat', url);
    addUniqueImageCandidate(candidates, 'chat', buildApiUrl(url, 'chat/completions'));

    return candidates;
  }

  function getImageRequestBodies(kind, model, imagePrompt) {
    const size = CONFIG.imageGenSize || '1024x1024';
    if (kind === 'images') {
      const baseBody = { model: model, prompt: imagePrompt, n: 1, size: size };
      return [
        Object.assign({}, baseBody, { response_format: 'b64_json' }),
        baseBody
      ];
    }
    if (kind === 'responses') {
      const tool = { type: 'image_generation' };
      if (size && size !== 'auto') tool.size = size;
      return [
        { model: model, input: imagePrompt, tools: [tool] },
        { model: model, input: imagePrompt, tools: [{ type: 'image_generation' }] }
      ];
    }
    const sizeHint = size && size !== 'auto' ? '\n\n请严格按 ' + size + ' 画布尺寸生成，保持对应宽高比。' : '';
    return [
      { model: model, messages: [{ role: 'user', content: imagePrompt + sizeHint }] },
      { model: model, messages: [{ role: 'user', content: imagePrompt + sizeHint }], modalities: ['text', 'image'] }
    ];
  }

  function normalizeExtractedImage(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^data:image\//i.test(text) || /^https?:\/\//i.test(text)) return text;
    const compact = text.replace(/\s/g, '');
    if (compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
      return 'data:image/png;base64,' + compact;
    }
    return '';
  }

  function extractImageDataUrlFromResponse(data) {
    if (!data) return '';

    const seen = new Set();
    function walk(node, key, parent) {
      if (node == null) return '';
      if (typeof node === 'string') {
        if (/^(b64_json|base64|image_base64|result)$/i.test(key || '')) {
          const parentType = String(parent && (parent.type || parent.kind || parent.object) || '');
          if (!parentType || /image|generation/i.test(parentType)) {
            const direct = normalizeExtractedImage(node);
            if (direct) return direct;
          }
        }
        if (/^(url|image_url|output_url)$/i.test(key || '')) {
          const direct = normalizeExtractedImage(node);
          if (direct) return direct;
        }
        const dataUrlMatch = node.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/i);
        if (dataUrlMatch) return normalizeExtractedImage(dataUrlMatch[0]);
        const markdownImageMatch = node.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)\)/i);
        if (markdownImageMatch) return normalizeExtractedImage(markdownImageMatch[1]);
        return '';
      }
      if (typeof node !== 'object') return '';
      if (seen.has(node)) return '';
      seen.add(node);

      if (node.image_url && typeof node.image_url === 'object') {
        const directImageUrl = walk(node.image_url.url || node.image_url.data || node.image_url.b64_json, 'image_url', node.image_url);
        if (directImageUrl) return directImageUrl;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          const found = walk(item, key, parent);
          if (found) return found;
        }
        return '';
      }

      for (const prop of Object.keys(node)) {
        const found = walk(node[prop], prop, node);
        if (found) return found;
      }
      return '';
    }

    return walk(data, '', null);
  }

  async function requestImageFromCandidate(candidate, apiKey, model, imagePrompt, signal) {
    const bodies = getImageRequestBodies(candidate.kind, model, imagePrompt);
    let lastError = '';
    for (const body of bodies) {
      try {
        const res = await fetch(candidate.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify(body),
          signal: signal
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          lastError = 'HTTP ' + res.status + ': ' + (text || '').slice(0, 200);
          continue;
        }
        const imageDataUrl = extractImageDataUrlFromResponse(data || text);
        if (imageDataUrl) return imageDataUrl;
        lastError = '响应里没有解析到图片数据';
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastError = err.message || String(err);
      }
    }
    throw new Error(lastError || '生图请求失败');
  }

  async function generateImageByApi(apiUrl, apiKey, model, imagePrompt, signal) {
    const candidates = buildImageApiCandidates(apiUrl);
    let lastError = '';
    for (const candidate of candidates) {
      try {
        console.log('[省流助手-生图] 尝试 ' + candidate.kind + ' 接口:', candidate.url);
        const imageDataUrl = await requestImageFromCandidate(candidate, apiKey, model, imagePrompt, signal);
        console.log('[省流助手-生图] ✅ ' + candidate.kind + ' 接口返回图片');
        return imageDataUrl;
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastError = candidate.kind + ' ' + candidate.url + ' -> ' + (err.message || String(err));
        console.warn('[省流助手-生图] ' + lastError);
      }
    }
    throw new Error(lastError || '生图 API 未返回图片数据');
  }

  function pickDescriptionFromDom() {
    const selectors = [
      '.desc-info-text',
      '.basic-desc-info',
      '.video-desc-container .desc-info-text',
      '.video-desc .desc-info-text',
      '.video-desc .desc',
      '#v_desc .info'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = cleanVideoDescription(el?.textContent || '');
      if (text) return text;
    }
    return '';
  }

  function getVideoInfo() {
    let cid = null, bvid = null, aid = null, title = '', upName = '', desc = '', duration = 0;
    try {
      const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
      const state = pageWindow.__INITIAL_STATE__ || window.__INITIAL_STATE__;
      if (state?.videoData) {
        bvid = state.videoData.bvid;
        aid = state.aid || state.videoData.aid;
        cid = state.videoData.cid || state.videoData.pages?.[0]?.cid;
        title = state.videoData.title || '';
        upName = state.videoData.owner?.name || '';
        desc = cleanVideoDescription(state.videoData.desc || '');
        if (!desc && Array.isArray(state.videoData.desc_v2)) {
          desc = cleanVideoDescription(state.videoData.desc_v2.map(function(item) {
            return item && item.raw_text ? item.raw_text : '';
          }).filter(Boolean).join('\n'));
        }
        duration = state.videoData.duration || 0;
      }
    } catch(e) {
      console.log('[省流助手] 无法从 __INITIAL_STATE__ 获取信息:', e.message);
    }
    if (!bvid) {
      const match = location.pathname.match(/\/video\/(BV\w+)/);
      if (match) bvid = match[1];
    }
    if (!aid) {
      const urlParams = new URLSearchParams(window.location.search);
      aid = urlParams.get('aid');
    }
    if (!cid) {
      const player = document.querySelector('iframe[src*="cid="]');
      if (player) {
        const match = player.src.match(/cid=(\d+)/);
        if (match) cid = match[1];
      }
    }
    if (!cid) {
      const urlParams = new URLSearchParams(window.location.search);
      cid = urlParams.get('cid');
    }
    if (!title) {
      title = document.querySelector('h1.video-title, h1.title, .video-title, [data-title]')?.textContent?.trim() || '';
    }
    if (!upName) {
      const upElement = document.querySelector('.up-name, .username, a[href*="space.bilibili.com"]');
      if (upElement) {
        upName = upElement.getAttribute('title') || upElement.textContent?.trim() || '';
      }
    }
    if (!desc) {
      desc = pickDescriptionFromDom();
    }
    return { bvid, cid, aid, title, upName, desc, duration };
  }

  // ==================== 字幕获取部分 ====================
  async function fetchSubtitles(cid, bvid, signal) {
    if (!cid || !bvid) {
      console.warn('[省流助手] 缺少 cid 或 bvid，跳过字幕接口请求:', { cid: cid, bvid: bvid });
      return [];
    }
    throwIfAborted(signal);
    try {
      const url = 'https://api.bilibili.com/x/player/wbi/v2?cid=' + cid + '&bvid=' + bvid;
      const res = await fetchWithTimeout(url, { credentials: 'include', signal: signal }, BILI_API_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data?.data?.subtitle?.subtitles?.length > 0) {
        return data.data.subtitle.subtitles;
      }
    } catch(e) {
      if (isAbortError(e)) throw e;
      console.log('[省流助手] wbi API 失败:', e.message);
    }
    throwIfAborted(signal);
    try {
      const url = 'https://api.bilibili.com/x/player/v2?cid=' + cid + '&bvid=' + bvid;
      const res = await fetchWithTimeout(url, { credentials: 'include', signal: signal }, BILI_API_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data?.data?.subtitle?.subtitles?.length > 0) {
        return data.data.subtitle.subtitles;
      }
    } catch(e) {
      if (isAbortError(e)) throw e;
      console.log('[省流助手] v2 API 失败:', e.message);
    }
    return [];
  }

  async function fetchSubtitleContent(subtitleUrl, signal) {
    if (!subtitleUrl) return [];
    throwIfAborted(signal);
    try {
      const url = subtitleUrl.startsWith('http') ? subtitleUrl : 'https:' + subtitleUrl;
      const res = await fetchWithTimeout(url, { signal: signal }, BILI_SUBTITLE_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return data.body || [];
    } catch(e) {
      if (isAbortError(e)) throw e;
      console.log('[省流助手] 字幕内容获取失败:', e.message);
      return [];
    }
  }

  function formatTranscript(subtitles) {
    if (!subtitles || subtitles.length === 0) return '';
    return subtitles.map(item => item.content || item.text || '')
      .filter(text => text.trim())
      .join('\n');
  }

  function sanitizeFilename(str) {
    return str.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  }

  function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadTranscript(text, title, upName, bvid) {
    const safeTitle = sanitizeFilename(title) || '未知标题';
    const safeUpName = sanitizeFilename(upName) || '未知UP主';
    const safeBvid = bvid || '未知BV号';
    const filename = safeUpName + '__' + safeTitle + '__' + safeBvid + '.txt';
    triggerDownload(text, filename, 'text/plain;charset=utf-8');
    console.log('[省流助手] 已下载字幕: ' + filename);
  }

  function downloadGeneratedImage(imageDataUrl, videoInfo, suffix) {
    if (!imageDataUrl || imageDataUrl === 'ERROR') return false;
    const safeTitle = sanitizeFilename((videoInfo && videoInfo.title) || '视频总结') || '视频总结';
    const filename = safeTitle + (suffix || '_总结') + '.png';
    const a = document.createElement('a');
    a.href = imageDataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[省流助手-生图] 已触发图片下载: ' + filename);
    return true;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isUsableBiliElement(el) {
    if (!el || el.closest('#tabbit-ai-summary-panel') || el.closest('#tabbit-settings-overlay')) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function deepQuerySelectorAll(selector, root) {
    const results = [];
    const visited = new Set();
    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.matches) {
        try {
          if (node.matches(selector)) results.push(node);
        } catch(e) {}
      }
      if (node.querySelectorAll) {
        try {
          node.querySelectorAll(selector).forEach(el => results.push(el));
        } catch(e) {}
      }
      if (node.shadowRoot) walk(node.shadowRoot);
      const children = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : [];
      children.forEach(el => {
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    }
    walk(root || document);
    return results;
  }

  function getCommentAreaRoot() {
    return document.querySelector('bili-comment-box')
      || document.querySelector('#comment')
      || document.querySelector('.reply-box')
      || document.querySelector('.comment-container')
      || document.querySelector('[class*="comment"]');
  }

  function isBiliCommentEditorCandidate(el) {
    if (!isUsableBiliElement(el)) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (el.id === 'body' || tag === 'bili-comment-box' || tag === 'bili-comment-rich-textarea') return false;
    if (tag === 'textarea') return true;
    if (el.classList && el.classList.contains('brt-editor')) return true;
    if (el.getAttribute('contenteditable') === 'true') {
      const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '';
      return !!(el.closest('.brt-root') || el.closest('#input') || /评论|回复/.test(placeholder));
    }
    return false;
  }

  function findBiliRichTextEditor(root) {
    const richTextareas = deepQuerySelectorAll('bili-comment-rich-textarea', root || document);
    for (const host of richTextareas) {
      if (!host || !host.shadowRoot) continue;
      const editor = deepQuerySelectorAll('.brt-editor, [contenteditable="true"], textarea', host.shadowRoot)
        .find(isBiliCommentEditorCandidate);
      if (editor) return editor;
    }
    return null;
  }

  async function findBiliCommentEditor() {
    const root = getCommentAreaRoot();
    if (root) root.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const selectors = [
      '.brt-editor',
      '[contenteditable="true"].brt-editor',
      'textarea[placeholder*="评论"]',
      'textarea[placeholder*="回复"]',
      '#comment textarea',
      '.reply-box textarea',
      '.comment-send textarea',
      '#comment [contenteditable="true"]',
      '.reply-box [contenteditable="true"]',
      '.comment-send [contenteditable="true"]',
      '[contenteditable="true"][placeholder*="评论"]',
      '[contenteditable="true"][aria-placeholder*="评论"]'
    ];

    for (let attempt = 0; attempt < 8; attempt++) {
      const roots = [root, document].filter(Boolean);
      for (const searchRoot of roots) {
        const richEditor = findBiliRichTextEditor(searchRoot);
        if (richEditor) return richEditor;
      }
      for (const selector of selectors) {
        for (const searchRoot of roots) {
          const item = deepQuerySelectorAll(selector, searchRoot).find(isBiliCommentEditorCandidate);
          if (item) return item;
        }
      }
      await sleep(250);
    }
    return null;
  }

  function findBiliCommentHost(editor) {
    let node = editor;
    const visited = new Set();
    while (node && !visited.has(node)) {
      visited.add(node);
      if (node.tagName && node.tagName.toLowerCase() === 'bili-comment-box') return node;
      const root = node.getRootNode ? node.getRootNode() : null;
      if (root && root.host && root.host !== node) {
        if (root.host.tagName && root.host.tagName.toLowerCase() === 'bili-comment-box') return root.host;
        node = root.host;
        continue;
      }
      node = node.parentElement || node.parentNode;
      if (node === document) break;
    }
    return document.querySelector('bili-comment-box');
  }

  function getBiliCommentApi(editor) {
    const host = findBiliCommentHost(editor);
    const root = editor && editor.getRootNode ? editor.getRootNode() : null;
    const richHost = root && root.host && root.host.tagName && root.host.tagName.toLowerCase() === 'bili-comment-rich-textarea'
      ? root.host
      : null;
    const body = editor;
    return { host, richHost, body };
  }

  function notifyBiliCommentInput(editor, text) {
    const { host, richHost, body } = getBiliCommentApi(editor);
    const events = [
      new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: text }),
      new InputEvent('input', { bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: text }),
      new Event('change', { bubbles: true, composed: true })
    ];
    events.forEach(ev => {
      try { body.dispatchEvent(ev); } catch(e) {}
      try { richHost && richHost.dispatchEvent(new Event(ev.type, { bubbles: true, composed: true })); } catch(e) {}
      try { host && host.dispatchEvent(new Event(ev.type, { bubbles: true, composed: true })); } catch(e) {}
    });
  }

  function getCommentTextPresets() {
    let presets = CONFIG.commentTextPresets;
    if (typeof presets === 'string') {
      presets = presets.split('\n');
    }
    if (!Array.isArray(presets)) presets = DEFAULT_CONFIG.commentTextPresets;
    presets = presets
      .map(function(text) { return String(text || '').trim(); })
      .filter(Boolean);
    return presets.length > 0 ? presets : DEFAULT_CONFIG.commentTextPresets;
  }

  function pickRandomCommentText() {
    const presets = getCommentTextPresets();
    return presets[Math.floor(Math.random() * presets.length)] || '省流';
  }

  function findBiliCommentImageButton(editor) {
    const host = findBiliCommentHost(editor);
    const roots = [
      host && host.shadowRoot,
      getCommentAreaRoot(),
      document
    ].filter(Boolean);

    const specificSelectors = [
      'button[title*="图片"]',
      'button[aria-label*="图片"]',
      'button[class*="image"]',
      'button[class*="pic"]',
      'button[class*="picture"]',
      'button[class*="upload"]',
      '[role="button"][title*="图片"]',
      '[role="button"][aria-label*="图片"]',
      '[role="button"][class*="image"]',
      '[role="button"][class*="pic"]',
      '[role="button"][class*="upload"]'
    ];

    for (const root of roots) {
      for (const selector of specificSelectors) {
        const btn = deepQuerySelectorAll(selector, root).find(isUsableBiliElement);
        if (btn) return btn;
      }
    }

    for (const root of roots) {
      const toolBtns = deepQuerySelectorAll('#footer button.tool-btn, button.tool-btn, #footer [role="button"], [class*="tool-btn"]', root)
        .filter(isUsableBiliElement);
      const imageBtn = toolBtns.find(function(btn) {
        const text = (btn.textContent || '').trim();
        const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
        const cls = btn.className && typeof btn.className === 'string' ? btn.className : '';
        const meta = text + ' ' + title + ' ' + cls;
        if (/表情|emoji|emote|at|mention|话题|投票|vote/i.test(meta)) return false;
        return /图片|image|pic|picture|upload|photo|image-upload/i.test(meta);
      });
      if (imageBtn) return imageBtn;

      const fallbackBtns = toolBtns.filter(function(btn) {
        const meta = ((btn.textContent || '') + ' ' + (btn.getAttribute('title') || '') + ' ' + (btn.className || '')).trim();
        return !/表情|emoji|emote|at|mention|话题|投票|vote/i.test(meta);
      });
      if (fallbackBtns.length === 1) return fallbackBtns[0];
      if (fallbackBtns.length > 1) return fallbackBtns[fallbackBtns.length - 1];
    }

    for (const root of roots) {
      const fileInput = deepQuerySelectorAll('input[type="file"]', root).find(function(input) {
        if (!isUsableBiliElement(input) && input.style.display !== 'none') return false;
        return /image|\.(png|jpe?g|webp|gif)/i.test(input.accept || '');
      });
      if (fileInput) return fileInput;
    }

    return null;
  }

  function clickBiliCommentImageButton(editor) {
    const btn = findBiliCommentImageButton(editor);
    if (!btn) return false;
    try {
      btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, composed: true, cancelable: true }));
      btn.click();
      return true;
    } catch(e) {
      console.warn('[省流助手-评论上传按钮] 点击失败:', e);
      return false;
    }
  }

  // 🆕 查找并点击B站评论区的"发送/发布"按钮
  function clickBiliCommentSubmitButton(editor) {
    const host = findBiliCommentHost(editor);
    const roots = [
      host && host.shadowRoot,
      getCommentAreaRoot(),
      document
    ].filter(Boolean);

    const submitSelectors = [
      '.comment-send button.submit-btn',
      '.comment-send button[aria-label*="发布"]',
      '.comment-send button[aria-label*="发送"]',
      'button.submit-btn',
      'button[aria-label*="发布"]',
      'button[aria-label*="发送"]',
      '#comment button.submit-btn',
      '.reply-box button.submit-btn'
    ];

    for (const root of roots) {
      for (const selector of submitSelectors) {
        const btns = deepQuerySelectorAll(selector, root);
        const btn = btns.find(function(b) {
          if (!isUsableBiliElement(b)) return false;
          const text = (b.textContent || '').trim();
          return /发布|发送|提交|send|submit/i.test(text) || b.classList.contains('submit-btn');
        });
        if (btn) {
          try { btn.click(); return true; } catch(e) {}
        }
      }
    }

    // 兜底：在评论区域找含有"发布"文字的按钮
    for (const root of roots) {
      const allBtns = deepQuerySelectorAll('button, [role="button"]', root);
      const submitBtn = allBtns.find(function(b) {
        if (!isUsableBiliElement(b)) return false;
        const text = (b.textContent || '').trim();
        return text === '发布' || text === '发送';
      });
      if (submitBtn) {
        try { submitBtn.click(); return true; } catch(e) {}
      }
    }

    return false;
  }

  // 🆕 一键将摘要内容插入评论框（或自动发送）
  const BILI_COMMENT_MAX_LEN = 1990;
  async function fillBiliCommentSummary(btn) {
    const summaryText = getCurrentSummaryText(null, '');
    if (!summaryText || !summaryText.trim()) {
      alert('暂无摘要内容，请先生成摘要');
      return;
    }

    const originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 填写中...';
    }

    try {
      // 转纯文本 + 拼后缀
      let plainText = markdownToPlainText(summaryText).trim();
      const suffix = '\n\n#B站省流助手';
      const maxContentLen = BILI_COMMENT_MAX_LEN - suffix.length;
      if (plainText.length > maxContentLen) {
        plainText = plainText.slice(0, maxContentLen).trim() + '\n...';
      }
      const finalText = plainText + suffix;

      const editor = await findBiliCommentEditor();
      if (!editor) throw new Error('没找到评论输入框，请先滚到评论区或点一下评论框');

      setBiliCommentText(editor, finalText);

      if (btn) {
        btn.textContent = '✅ 已填入';
      }

      // 如果开启了自动发送
      if (CONFIG.autoSubmitCommentSummary) {
        if (btn) btn.textContent = '⏳ 正在发送...';
        await sleep(300);
        const sent = clickBiliCommentSubmitButton(editor);
        if (sent) {
          if (btn) btn.textContent = '✅ 已发送！';
        } else {
          if (btn) btn.textContent = '✅ 已填入（未找到发送按钮）';
        }
      }

      setTimeout(function() {
        if (btn) {
          btn.textContent = originalText || '📋 摘要发评论';
          btn.disabled = false;
        }
      }, 2500);
    } catch(err) {
      console.error('[省流助手-摘要发评论]', err);
      if (btn) {
        btn.textContent = '❌ 失败';
        setTimeout(function() {
          btn.textContent = originalText || '📋 摘要发评论';
          btn.disabled = false;
        }, 2000);
      }
    }
  }

  function setBiliCommentText(editor, text) {
    if (!isBiliCommentEditorCandidate(editor)) {
      throw new Error('找到的不是评论输入框，已停止写入，避免破坏评论区');
    }
    editor.focus();
    if ('value' in editor) {
      editor.value = text;
      notifyBiliCommentInput(editor, text);
    } else {
      try {
        editor.click();
        editor.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, text);
      } catch(e) {}
      if ((editor.textContent || '').trim() !== text) {
        editor.innerHTML = escapeHtml(text);
      }
      editor.setAttribute('data-inputed', 'true');
      notifyBiliCommentInput(editor, text);
    }
  }

  async function fillBiliCommentTextOnly(btn) {
    const originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 填写中...';
    }
    try {
      const editor = await findBiliCommentEditor();
      if (!editor) throw new Error('没找到评论输入框，请先滚到评论区或点一下评论框');
      const commentText = pickRandomCommentText();
      setBiliCommentText(editor, commentText);
      const openedUpload = clickBiliCommentImageButton(editor);
      if (btn) {
        btn.textContent = openedUpload ? '✅ 已打开上传' : '✅ 已填入';
        setTimeout(function() {
          btn.textContent = originalText || '💬 填字并点上传';
          btn.disabled = false;
        }, 1800);
      }
      if (!openedUpload) {
        console.warn('[省流助手-评论上传按钮] 没找到可点击的图片上传按钮，请手动上传');
      }
    } catch(err) {
      console.error('[省流助手-评论填字]', err);
      alert('填入评论失败：' + err.message);
      if (btn) {
        btn.textContent = originalText || '💬 填字并点上传';
        btn.disabled = false;
      }
    }
  }

  // ==================== 评论区防Ban工具函数 ====================
  function throwIfAborted(signal) {
    if (signal && signal.aborted) {
      const abortErr = new Error('用户已打断');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
  }

  function randomDelay(min, max, signal) {
    const delay = min + Math.random() * (max - min);
    console.log('[省流助手] 等待 ' + (delay / 1000).toFixed(1) + 's...');
    return new Promise(function(resolve, reject) {
      let timer = null;
      function cleanup() {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      function onAbort() {
        if (timer) clearTimeout(timer);
        cleanup();
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        reject(abortErr);
      }
      if (signal && signal.aborted) {
        onAbort();
        return;
      }
      if (signal) signal.addEventListener('abort', onAbort);
      timer = setTimeout(function() {
        cleanup();
        resolve();
      }, delay);
    });
  }

  async function retryWithBackoff(fn, maxRetries, baseDelay, signal) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      throwIfAborted(signal);
      try {
        return await fn();
      } catch (e) {
        if (isAbortError(e)) throw e;
        if (attempt === maxRetries) throw e;
        const backoffDelay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn('[省流助手] 第' + (attempt + 1) + '次失败，' + (backoffDelay / 1000).toFixed(1) + 's 后重试: ' + e.message);
        await randomDelay(backoffDelay, backoffDelay, signal);
      }
    }
  }

  function createSafeFetcher(signal) {
    return async function safeFetch(url, options) {
      options = options || {};
      const mergedOptions = Object.assign({}, options, {
        credentials: 'include',
        headers: Object.assign({}, SAFE_FETCH_HEADERS, { 'Referer': window.location.href }, options.headers || {})
      });
      if (signal) mergedOptions.signal = signal;
      const resp = await fetchWithTimeout(url, mergedOptions, BILI_API_TIMEOUT_MS);
      if (resp.status === 412) throw new BiliRiskControlError('触发B站风控(412)，请求被拒绝，请稍后再试');
      if (resp.status === 403) throw new BiliRiskControlError('被B站拒绝访问(403)，可能需要登录或IP被限制');
      if (resp.status === 429) throw new BiliRiskControlError('请求过于频繁(429)，触发限流');
      return resp;
    };
  }

  // ==================== 评论区获取部分 ====================
  function getAid(videoInfo) {
    if (videoInfo.aid) return videoInfo.aid;
    try {
      for (const script of document.querySelectorAll('script')) {
        const match = (script.textContent || '').match(/"aid"\s*:\s*(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    } catch (e) {}
    return null;
  }

  async function fetchComments(safeFetch, aid, page) {
    const url = 'https://api.bilibili.com/x/v2/reply?type=1&oid=' + aid + '&pn=' + page + '&ps=' + COMMENT_CONFIG.pageSize + '&sort=' + COMMENT_CONFIG.sortType;
    const resp = await safeFetch(url);
    if (!resp.ok) throw new Error('评论API请求失败: HTTP ' + resp.status);
    const data = await resp.json();
    if (data.code === -352) throw new BiliRiskControlError('触发B站风控(-352)，请稍后重试');
    if (data.code === -401) throw new BiliRiskControlError('需要登录才能查看评论');
    if (data.code !== 0) throw new Error('评论API返回错误: code=' + data.code + ', message=' + (data.message || ''));
    return data.data;
  }

  async function fetchAllComments(aid, statusCallback, signal) {
    const allComments = [];
    const safeFetch = createSafeFetcher(signal);
    const maxPages = CONFIG.commentMaxPages || COMMENT_CONFIG.maxPages;
    const commentLimit = CONFIG.commentLimit || COMMENT_CONFIG.commentLimit;
    const minDelay = CONFIG.commentMinDelay || COMMENT_CONFIG.minDelay;
    const maxDelay = CONFIG.commentMaxDelay || COMMENT_CONFIG.maxDelay;

    for (let page = 1; page <= maxPages; page++) {
      try {
        throwIfAborted(signal);
        if (page > 1) {
          await randomDelay(minDelay, maxDelay, signal);
        }

        const result = await retryWithBackoff(
          () => fetchComments(safeFetch, aid, page),
          COMMENT_CONFIG.maxRetries,
          COMMENT_CONFIG.retryBaseDelay,
          signal
        );
        throwIfAborted(signal);

        const replies = result?.replies;
        if (!replies || replies.length === 0) break;

        for (const reply of replies) {
          if (allComments.length >= commentLimit) break;
          const name = reply.member?.uname || '匿名';
          const text = reply.content?.message || '';
          const like = reply.like || 0;
          allComments.push({ name, text, like });

          if (COMMENT_CONFIG.includeReplies && reply.replies) {
            for (const sub of reply.replies) {
              if (allComments.length >= commentLimit) break;
              const subName = sub.member?.uname || '匿名';
              const subText = sub.content?.message || '';
              const subLike = sub.like || 0;
              allComments.push({ name: subName, text: subText, like: subLike, isReply: true });
            }
          }
        }

        if (statusCallback) statusCallback('已获取 ' + allComments.length + ' 条评论 (第' + page + '页)...');

        if (replies.length < COMMENT_CONFIG.pageSize) break;
        if (allComments.length >= commentLimit) break;

      } catch (e) {
        if (isAbortError(e)) throw e;
        console.warn('[省流助手] 获取第' + page + '页评论失败:', e.message);
        if (e instanceof BiliRiskControlError) {
          console.warn('[省流助手] 检测到风控，停止请求');
        }
        break;
      }
    }
    return allComments;
  }

  function formatCommentsText(comments) {
    return comments.map((c, i) => {
      const prefix = c.isReply ? '  └' : '';
      return prefix + '[' + (i + 1) + '] ' + c.name + ' (👍' + c.like + '): ' + c.text;
    }).join('\n');
  }

  // ==================== 弹幕获取部分 ====================
  async function fetchDanmakuXml(safeFetch, cid) {
    const url = 'https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid;
    const resp = await safeFetch(url);
    if (!resp.ok) throw new Error('弹幕API请求失败: HTTP ' + resp.status);
    const buf = await resp.arrayBuffer();
    const decoder = new TextDecoder('utf-8');
    const xmlText = decoder.decode(buf);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const dNodes = doc.querySelectorAll('d');
    const danmakuList = [];
    dNodes.forEach(function(d) {
      const p = d.getAttribute('p') || '';
      const parts = p.split(',');
      const time = parseFloat(parts[0]) || 0;
      const text = d.textContent || '';
      if (text.trim()) {
        danmakuList.push({ time: time, text: text.trim() });
      }
    });
    return danmakuList;
  }

  async function fetchAllDanmaku(cid, statusCallback, signal) {
    const allDanmaku = [];
    const safeFetch = createSafeFetcher(signal);
    const maxDanmaku = DANMAKU_CONFIG.maxDanmaku;
    try {
      throwIfAborted(signal);
      if (statusCallback) statusCallback('正在获取弹幕...');
      const danmaku = await retryWithBackoff(
        function() { return fetchDanmakuXml(safeFetch, cid); },
        DANMAKU_CONFIG.maxRetries,
        DANMAKU_CONFIG.retryBaseDelay,
        signal
      );
      throwIfAborted(signal);
      allDanmaku.push.apply(allDanmaku, danmaku);
      if (statusCallback) statusCallback('已获取 ' + allDanmaku.length + ' 条弹幕...');
    } catch (e) {
      if (isAbortError(e)) throw e;
      console.warn('[省流助手] 获取弹幕失败:', e.message);
      if (e instanceof BiliRiskControlError) {
        console.warn('[省流助手] 检测到风控，停止弹幕请求');
      }
    }
    return allDanmaku.slice(0, maxDanmaku);
  }

  function formatDanmakuText(danmaku) {
    var timeFormat = function(sec) {
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    };
    return danmaku.map(function(d, i) {
      return '[' + (i + 1) + '] [' + timeFormat(d.time) + '] ' + d.text;
    }).join('\n');
  }

  // ==================== 全面分析：时间轴对齐 ====================
  function alignTimeline(subtitleBody, danmaku) {
    if (!subtitleBody || subtitleBody.length === 0) {
      return [];
    }
    var sortedDanmaku = danmaku.slice().sort(function(a, b) { return a.time - b.time; });
    var segments = [];
    for (var i = 0; i < subtitleBody.length; i++) {
      var seg = subtitleBody[i];
      var from = seg.from || 0;
      var to = seg.to || (from + 3);
      var text = seg.content || seg.text || '';
      if (!text.trim()) continue;

      var matchedDanmaku = [];
      for (var j = 0; j < sortedDanmaku.length; j++) {
        var d = sortedDanmaku[j];
        if (d.time < from - 2) continue;
        if (d.time > to + 2) break;
        matchedDanmaku.push(d.text);
      }

      var timeLabel = timeFormatAlign(from);
      var entry = { time: from, label: timeLabel, subtitle: text, danmaku: matchedDanmaku };
      segments.push(entry);
    }
    return segments;
  }

  function timeFormatAlign(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // 全面分析数据量上限（字符），超限时才开始截断
  var FULL_DATA_MAX_CHARS_DEFAULT = 64000;

  function formatFullData(videoInfo, subtitleBody, danmaku, comments) {
    var lines = [];
    lines.push('【视频信息】');
    lines.push('标题: ' + (videoInfo.title || ''));
    lines.push('UP主: ' + (videoInfo.upName || ''));
    if (videoInfo.desc) lines.push('简介: ' + videoInfo.desc);
    lines.push('链接: https://www.bilibili.com/video/' + (videoInfo.bvid || ''));
    lines.push('');

    // --- 字幕 + 弹幕时间轴对齐（不过滤，全量输出）---
    if (subtitleBody && subtitleBody.length > 0) {
      var aligned = alignTimeline(subtitleBody, danmaku);
      lines.push('【字幕 + 弹幕时间轴对齐】');
      lines.push('（字幕' + subtitleBody.length + '句，弹幕' + (danmaku ? danmaku.length : 0) + '条）');
      lines.push('');
      for (var i = 0; i < aligned.length; i++) {
        var seg = aligned[i];
        lines.push('[' + seg.label + '] ' + seg.subtitle);
        if (seg.danmaku.length > 0) {
          for (var j = 0; j < seg.danmaku.length; j++) {
            lines.push('  💬 ' + seg.danmaku[j]);
          }
        }
      }
    } else if (danmaku && danmaku.length > 0) {
      lines.push('【字幕】');
      lines.push('（该视频无字幕）');
    }

    // --- 弹幕精选（按字数排序，字多 = 有内容，过滤刷屏短弹幕）---
    if (danmaku && danmaku.length > 0) {
      // 去重：相同文本只保留一条
      var seen = {};
      var uniqueDanmaku = [];
      for (var k = 0; k < danmaku.length; k++) {
        var txt = (danmaku[k].text || '').trim();
        if (txt.length >= 4 && !seen[txt]) {
          seen[txt] = true;
          uniqueDanmaku.push(txt);
        }
      }
      // 按字数降序排列，字越多含金量越高
      uniqueDanmaku.sort(function(a, b) { return b.length - a.length; });
      if (uniqueDanmaku.length > 0) {
        lines.push('');
        lines.push('【弹幕精选 TOP50（按内容含量排序，共' + danmaku.length + '条弹幕，去重后' + uniqueDanmaku.length + '条）】');
        var showCount = Math.min(50, uniqueDanmaku.length);
        for (var s = 0; s < showCount; s++) {
          lines.push(uniqueDanmaku[s]);
        }
      }
    }

    // --- 评论区（不过滤，全量输出）---
    if (comments && comments.length > 0) {
      lines.push('');
      lines.push('【评论区（' + comments.length + '条，按热度排序）】');
      for (var c = 0; c < comments.length; c++) {
        var cm = comments[c];
        var prefix = cm.isReply ? '  └' : '';
        lines.push(prefix + '[' + (c + 1) + '] ' + cm.name + ' (👍' + cm.like + '): ' + cm.text);
      }
    }

    // --- 超限时截断：从末尾（评论区）开始砍，保留视频信息和字幕核心 ---
    var result = lines.join('\n');
    var maxChars = (typeof CONFIG !== 'undefined' && CONFIG.fullDataMaxChars) || FULL_DATA_MAX_CHARS_DEFAULT;
    if (result.length > maxChars) {
      // 砍掉超限部分，保留前 FULL_DATA_MAX_CHARS 字符
      result = result.substring(0, maxChars) + '\n\n...（数据量超限，后续内容已截断）';
    }
    return result;
  }

  // ==================== Markdown 处理 ====================
  function markdownToPlainText(text) {
    let plain = text;
    plain = plain.replace(/^#{1,6}\s+/gm, '');
    plain = plain.replace(/\*\*(.+?)\*\*/g, '$1');
    plain = plain.replace(/\*(.+?)\*/g, '$1');
    plain = plain.replace(/_(.+?)_/g, '$1');
    plain = plain.replace(/`([^`]+)`/g, '$1');
    plain = plain.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    plain = plain.replace(/^>\s+/gm, '');
    plain = plain.replace(/^[-*]\s+/gm, '• ');
    plain = plain.replace(/^---$/gm, '');
    plain = plain.replace(/\n{3,}/g, '\n\n');
    return plain.trim();
  }

  function parseMarkdownInline(raw) {
    const codeParts = [];
    const linkParts = [];
    let source = String(raw || '').replace(/`([^`]+)`/g, function(match, code) {
      const token = '\u0000CODE' + codeParts.length + '\u0000';
      codeParts.push('<code class="md-code">' + escapeHtml(code) + '</code>');
      return token;
    });
    source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, label, href) {
      const token = '\u0000LINK' + linkParts.length + '\u0000';
      linkParts.push('<a class="md-link" href="' + safeHref(href) + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>');
      return token;
    });
    let html = escapeHtml(source);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>');
    html = html.replace(/(^|[^\*])\*([^\*\n]+)\*/g, '$1<em class="md-em">$2</em>');
    html = html.replace(/\u0000CODE(\d+)\u0000/g, function(match, idx) {
      return codeParts[Number(idx)] || '';
    });
    html = html.replace(/\u0000LINK(\d+)\u0000/g, function(match, idx) {
      return linkParts[Number(idx)] || '';
    });
    return html;
  }

  function parseMarkdown(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    let paragraph = [];
    let listType = '';
    let inCode = false;
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push('<p class="md-p">' + paragraph.map(parseMarkdownInline).join('<br>') + '</p>');
      paragraph = [];
    }
    function closeList() {
      if (!listType) return;
      out.push(listType === 'ol' ? '</ol>' : '</ul>');
      listType = '';
    }
    function startList(type) {
      if (listType === type) return;
      closeList();
      out.push(type === 'ol' ? '<ol class="md-ol">' : '<ul class="md-ul">');
      listType = type;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        if (inCode) {
          out.push('<pre class="md-pre"><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
          codeLines = [];
          inCode = false;
        } else {
          flushParagraph();
          closeList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (!trimmed) {
        flushParagraph();
        closeList();
        continue;
      }

      if (trimmed.includes('|') && lines[i + 1] && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        flushParagraph();
        closeList();
        const headerCells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
          i++;
        }
        i--;
        let table = '<table class="md-table"><thead><tr>' + headerCells.map(c => '<th>' + parseMarkdownInline(c) + '</th>').join('') + '</tr></thead><tbody>';
        rows.forEach(row => {
          table += '<tr>' + row.map(c => '<td>' + parseMarkdownInline(c) + '</td>').join('') + '</tr>';
        });
        table += '</tbody></table>';
        out.push(table);
        continue;
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        out.push('<h' + level + ' class="md-h' + level + '">' + parseMarkdownInline(heading[2]) + '</h' + level + '>');
        continue;
      }
      if (/^---+$/.test(trimmed)) {
        flushParagraph();
        closeList();
        out.push('<hr class="md-hr">');
        continue;
      }
      if (/^>\s+/.test(trimmed)) {
        flushParagraph();
        closeList();
        out.push('<blockquote class="md-quote">' + parseMarkdownInline(trimmed.replace(/^>\s+/, '')) + '</blockquote>');
        continue;
      }

      const ul = trimmed.match(/^[-*]\s+(.+)$/);
      if (ul) {
        flushParagraph();
        startList('ul');
        out.push('<li class="md-li">' + parseMarkdownInline(ul[1]) + '</li>');
        continue;
      }
      const ol = trimmed.match(/^\d+\.\s+(.+)$/);
      if (ol) {
        flushParagraph();
        startList('ol');
        out.push('<li class="md-li-ol">' + parseMarkdownInline(ol[1]) + '</li>');
        continue;
      }

      closeList();
      paragraph.push(line);
    }
    if (inCode) out.push('<pre class="md-pre"><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    flushParagraph();
    closeList();
    return out.join('\n');
  }

  // ==================== UI 样式 ====================
  function createStyles() {
    if (document.querySelector('#tabbit-ai-summary-styles')) return;
    const style = document.createElement('style');
    style.id = 'tabbit-ai-summary-styles';
    style.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes pulseGlow {
        0%, 100% { box-shadow: 0 2px 8px rgba(251,114,153,0.3); }
        50% { box-shadow: 0 2px 16px rgba(251,114,153,0.6); }
      }
      /* 🆕 流式打字光标 */
      @keyframes tabbitBlink {
        0%, 50% { opacity: 1; }
        50.01%, 100% { opacity: 0; }
      }
      .tabbit-typing-cursor {
        display: inline-block;
        width: 2px;
        height: 1em;
        background: #667eea;
        vertical-align: text-bottom;
        margin-left: 2px;
        animation: tabbitBlink 1s steps(2) infinite;
      }
      #tabbit-ai-summary-panel {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 480px;
        height: min(720px, 90vh);
        min-width: 360px;
        min-height: 360px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 24px);
        box-sizing: border-box;
        background: white;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      #tabbit-ai-summary-panel.dragging,
      #tabbit-ai-summary-panel.resizing {
        animation: none !important;
        transition: none !important;
      }
      .tabbit-panel-resizer {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
        cursor: nwse-resize;
        z-index: 2;
      }
      .tabbit-panel-resizer::after {
        content: '';
        position: absolute;
        right: 4px;
        bottom: 4px;
        width: 9px;
        height: 9px;
        border-right: 2px solid rgba(102,126,234,0.55);
        border-bottom: 2px solid rgba(102,126,234,0.55);
      }
      .tabbit-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        font-weight: 600;
        font-size: 16px;
        flex-shrink: 0;
        cursor: move;
        user-select: none;
      }
      .tabbit-close-btn {
        background: none;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        opacity: 0.8;
        transition: opacity 0.2s;
        line-height: 1;
        padding: 0 4px;
      }
      .tabbit-close-btn:hover { opacity: 1; }

      .tabbit-model-bar {
        padding: 0;
        background: #f5f6fa;
        border-bottom: 1px solid #e8e8ef;
        flex-shrink: 0;
      }
      .tabbit-model-bar-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        cursor: pointer;
        user-select: none;
        list-style: none;
      }
      .tabbit-model-bar-summary::-webkit-details-marker { display: none; }
      .tabbit-model-bar-summary::marker { display: none; content: ''; }
      .tabbit-model-bar-title {
        font-size: 11px;
        color: #999;
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      details[open] > .tabbit-model-bar-summary .tabbit-video-info-toggle {
        transform: rotate(90deg);
      }
      .tabbit-model-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 0 14px 10px;
      }
      .tabbit-model-chip {
        padding: 4px 10px;
        background: white;
        border: 1px solid #d8d8e0;
        border-radius: 14px;
        font-size: 11px;
        color: #555;
        cursor: pointer;
        transition: all 0.18s;
        user-select: none;
        white-space: nowrap;
      }
      .tabbit-model-chip:hover {
        border-color: #667eea;
        color: #667eea;
        transform: translateY(-1px);
      }
      .tabbit-model-chip.active {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-color: transparent;
        font-weight: 600;
      }
      .tabbit-model-chip.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .tabbit-panel-content {
        padding: 16px 20px;
        overflow-y: auto;
        font-size: 14px;
        line-height: 1.7;
        color: #333;
        flex: 1;
        min-height: 100px;
      }
      .tabbit-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 40px 20px;
        color: #666;
      }
      .tabbit-loading .tabbit-auto-subtitle-stop {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 14px;
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5253 100%);
        color: white;
        border: none;
        border-radius: 18px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(238,82,83,0.35);
        position: relative;
        z-index: 2;
        pointer-events: auto;
      }
      .tabbit-loading .tabbit-auto-subtitle-stop:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(238,82,83,0.5);
      }
      .tabbit-loading .tabbit-auto-subtitle-stop:disabled {
        opacity: 0.65;
        cursor: not-allowed;
        transform: none;
      }
      .tabbit-spinner {
        width: 36px;
        height: 36px;
        border: 3px solid #e0e0e0;
        border-top-color: #667eea;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      .tabbit-video-info {
        background: #e8f4f8;
        border-radius: 8px;
        padding: 10px 14px;
        margin-bottom: 12px;
        font-size: 13px;
        color: #555;
      }
      .tabbit-video-info .tabbit-video-title {
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }
      .tabbit-video-info-bottom {
        margin: 0 0 12px;
        background: #f6fbfd;
        border: 1px solid #ddebf2;
        border-radius: 8px;
        overflow: hidden;
      }
      .tabbit-video-info-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        color: #444;
        user-select: none;
        list-style: none;
      }
      .tabbit-video-info-summary::-webkit-details-marker { display: none; }
      .tabbit-video-info-summary::marker { display: none; content: ''; }
      .tabbit-video-info-title-text {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding-right: 8px;
      }
      .tabbit-video-info-toggle {
        font-size: 10px;
        color: #999;
        transition: transform 0.25s ease;
        flex-shrink: 0;
      }
      details[open] > .tabbit-video-info-summary .tabbit-video-info-toggle {
        transform: rotate(90deg);
      }
      .tabbit-video-meta-body {
        padding: 0 10px 10px;
        border-top: 1px solid #ddebf2;
        font-size: 12.5px;
        color: #555;
      }
      .tabbit-video-url-inline {
        margin-top: 6px;
        font-size: 12px;
        word-break: break-all;
      }
      .tabbit-result {
        background: #f8f9fa;
        border-radius: 12px;
        padding: 14px 16px;
        word-break: break-word;
      }
      .tabbit-summary-editor {
        width: 100%;
        min-height: 220px;
        box-sizing: border-box;
        resize: vertical;
        border: 1px solid #d8d8e0;
        border-radius: 8px;
        padding: 10px 12px;
        background: #fff;
        color: #333;
        font: inherit;
        line-height: 1.6;
        outline: none;
      }
      .tabbit-summary-editor:focus {
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102,126,234,0.12);
      }
      .tabbit-summary-edit-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
      }
      .tabbit-summary-edit-status {
        font-size: 11px;
        color: #2e7d32;
      }
      .tabbit-image-slot:empty {
        display: none;
      }
      .tabbit-image-slot {
        margin-bottom: 12px;
      }
      .tabbit-ppt-slot:empty {
        display: none;
      }
      .tabbit-ppt-slot {
        margin-top: 14px;
      }
      .tabbit-ppt-card {
        border: 1px solid #e2e6f2;
        border-radius: 10px;
        overflow: hidden;
        background: #fff;
      }
      .tabbit-ppt-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 10px;
        border-bottom: 1px solid #e8e8ef;
        background: #f8f9ff;
      }
      .tabbit-ppt-title {
        font-size: 12px;
        font-weight: 700;
        color: #555;
        margin-right: auto;
      }
      .tabbit-comment-section:empty {
        display: none;
      }
      .tabbit-result-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .tabbit-copy-btn, .tabbit-download-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: #f0f0f5;
        color: #555;
        border: 1px solid #ddd;
        border-radius: 8px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .tabbit-copy-btn:hover, .tabbit-download-btn:hover {
        background: #e8e8f0;
        color: #333;
        border-color: #667eea;
      }
      .tabbit-copy-btn.copied {
        background: #e8f5e9;
        color: #2e7d32;
        border-color: #4caf50;
      }
      .tabbit-error {
        background: #fff3f3;
        border: 1px solid #ffcccc;
        border-radius: 8px;
        padding: 14px;
        color: #c00;
      }
      .tabbit-error-title { font-weight: 600; margin-bottom: 6px; }
      .tabbit-no-subtitle {
        background: #fff8e1;
        border: 1px solid #ffe082;
        border-radius: 8px;
        padding: 14px;
        color: #8d6e00;
        text-align: center;
      }
      .tabbit-no-subtitle-icon { font-size: 32px; margin-bottom: 8px; }
      .tabbit-no-subtitle-text { font-weight: 600; margin-bottom: 4px; }

      .tabbit-comment-summary-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 12px 20px;
        margin-top: 14px;
        background: linear-gradient(135deg, #fb7299 0%, #f25d8e 100%);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.25s;
        animation: pulseGlow 2s ease-in-out infinite;
        letter-spacing: 0.5px;
      }
      .tabbit-comment-summary-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(251,114,153,0.5);
        background: linear-gradient(135deg, #f25d8e 0%, #e04e7e 100%);
      }
      .tabbit-comment-summary-btn:active { transform: translateY(0); }
      .tabbit-manual-fetch-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 12px 20px;
        margin-top: 14px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.25s;
        letter-spacing: 0.5px;
      }
      .tabbit-manual-fetch-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(102,126,234,0.5);
        background: linear-gradient(135deg, #5a6fd6 0%, #6a3d96 100%);
      }
      .tabbit-manual-fetch-btn:active { transform: translateY(0); }
      .tabbit-manual-fetch-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
            /* 🆕 手动上传字幕按钮（绿色调，区分手动获取） */
      .tabbit-manual-upload-btn {
        background: linear-gradient(135deg, #43a047 0%, #2e7d32 100%);
      }
      .tabbit-manual-upload-btn:hover {
        background: linear-gradient(135deg, #388e3c 0%, #1b5e20 100%);
        box-shadow: 0 4px 20px rgba(67,160,71,0.45);
      }
      .tabbit-manual-fetch-btn .tabbit-btn-icon { font-size: 18px; }

      .tabbit-comment-summary-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        animation: none;
        box-shadow: none;
      }
      .tabbit-comment-summary-btn .tabbit-btn-icon { font-size: 18px; }

      .tabbit-comment-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 2px solid #e8e8ef;
      }
      .tabbit-comment-section-title {
        font-size: 14px;
        font-weight: 600;
        color: #fb7299;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .tabbit-comment-result {
        background: #fff5f8;
        border-radius: 12px;
        padding: 14px 16px;
        word-break: break-word;
      }
      .tabbit-comment-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
      }

      .tabbit-danmaku-summary-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 12px 20px;
        margin-top: 10px;
        background: linear-gradient(135deg, #00a1d6 0%, #0086c9 100%);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.25s;
        letter-spacing: 0.5px;
      }
      .tabbit-danmaku-summary-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(0,161,214,0.5);
        background: linear-gradient(135deg, #0086c9 0%, #006fa3 100%);
      }
      .tabbit-danmaku-summary-btn:active { transform: translateY(0); }
      .tabbit-danmaku-summary-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
      .tabbit-danmaku-summary-btn .tabbit-btn-icon { font-size: 18px; }

      .tabbit-danmaku-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 2px solid #e8e8ef;
      }
      .tabbit-danmaku-section-title {
        font-size: 14px;
        font-weight: 600;
        color: #00a1d6;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .tabbit-danmaku-result {
        background: #f0fafe;
        border-radius: 12px;
        padding: 14px 16px;
        word-break: break-word;
      }
      .tabbit-danmaku-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
      }

      .tabbit-full-summary-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 12px 20px;
        margin-top: 10px;
        background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.25s;
        letter-spacing: 0.5px;
      }
      .tabbit-full-summary-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(255,152,0,0.5);
        background: linear-gradient(135deg, #f57c00 0%, #ef6c00 100%);
      }
      .tabbit-full-summary-btn:active { transform: translateY(0); }
      .tabbit-full-summary-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
      .tabbit-full-summary-btn .tabbit-btn-icon { font-size: 18px; }

      .tabbit-full-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 2px solid #e8e8ef;
      }
      .tabbit-full-section-title {
        font-size: 14px;
        font-weight: 600;
        color: #f57c00;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .tabbit-full-result {
        background: #fff8e1;
        border-radius: 12px;
        padding: 14px 16px;
        word-break: break-word;
      }
      .tabbit-full-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
      }

      .tabbit-chat-messages {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .tabbit-msg {
        animation: fadeIn 0.25s ease;
        max-width: 90%;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 13.5px;
        line-height: 1.65;
        word-break: break-word;
      }
      .tabbit-msg-user {
        align-self: flex-end;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-bottom-right-radius: 4px;
      }
      .tabbit-msg-ai {
        align-self: flex-start;
        background: #f0f2f7;
        color: #333;
        border-bottom-left-radius: 4px;
      }
      .tabbit-msg-model {
        font-size: 10px;
        color: #999;
        margin-top: 4px;
        text-align: left;
      }
      .tabbit-msg-loading {
        align-self: flex-start;
        padding: 10px 14px;
        background: #f0f2f7;
        border-radius: 12px;
        border-bottom-left-radius: 4px;
        display: flex;
        gap: 4px;
      }
      .tabbit-msg-loading span {
        width: 8px;
        height: 8px;
        background: #999;
        border-radius: 50%;
        animation: bounce 1.2s infinite ease-in-out;
      }
      .tabbit-msg-loading span:nth-child(2) { animation-delay: 0.15s; }
      .tabbit-msg-loading span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes bounce {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
        40% { transform: scale(1); opacity: 1; }
      }

      .tabbit-chat-input-bar {
        flex-shrink: 0;
        padding: 10px 14px;
        background: #fafbfc;
        border-top: 1px solid #e8e8ef;
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }
      .tabbit-chat-input {
        flex: 1;
        min-height: 36px;
        max-height: 100px;
        padding: 8px 12px;
        border: 1px solid #d8d8e0;
        border-radius: 18px;
        font-size: 13px;
        font-family: inherit;
        resize: none;
        outline: none;
        line-height: 1.4;
        transition: border-color 0.2s;
      }
      .tabbit-chat-input:focus { border-color: #667eea; }
      .tabbit-chat-input:disabled {
        background: #f0f0f0;
        cursor: not-allowed;
      }
      .tabbit-chat-send {
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: transform 0.15s;
      }
      .tabbit-chat-send:hover:not(:disabled) { transform: scale(1.08); }
      .tabbit-chat-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tabbit-chat-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      /* 🆕 打断按钮样式（替代发送按钮） */
      .tabbit-chat-send.tabbit-abort-mode {
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5253 100%);
        opacity: 1 !important;
        cursor: pointer !important;
        animation: pulseGlow 1.5s ease-in-out infinite;
      }
      .tabbit-chat-send.tabbit-abort-mode:hover {
        transform: scale(1.1);
      }
      /* 🆕 内联打断按钮（用于初始总结/评论总结/预设切换的流式过程中） */
      .tabbit-inline-abort-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        margin-top: 10px;
        background: linear-gradient(135deg, #ff6b6b 0%, #ee5253 100%);
        color: white;
        border: none;
        border-radius: 16px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.15s;
        box-shadow: 0 2px 8px rgba(238,82,83,0.35);
      }
      .tabbit-inline-abort-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(238,82,83,0.5);
      }
      .tabbit-inline-abort-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .md-h1 { font-size: 18px; font-weight: 700; color: #1a1a2e; margin: 12px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #667eea; }
      .md-h2 { font-size: 16px; font-weight: 600; color: #2d2d44; margin: 12px 0 8px; }
      .md-h3 { font-size: 15px; font-weight: 600; color: #3d3d5c; margin: 10px 0 6px; }
      .md-p { margin: 8px 0; color: #333; line-height: 1.7; }
      .md-bold { font-weight: 600; color: #1a1a2e; }
      .md-em { font-style: italic; color: #555; }
      .md-code { background: #e8e8f0; color: #c7254e; padding: 2px 6px; border-radius: 4px; font-size: 12.5px; font-family: Consolas, Monaco, monospace; }
      .md-pre { background: #23272f; color: #f3f4f6; padding: 12px 14px; border-radius: 8px; overflow:auto; font-size: 12.5px; line-height: 1.55; }
      .md-link { color: #667eea; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s; }
      .md-link:hover { border-bottom-color: #667eea; }
      .md-quote { background: linear-gradient(to right, #667eea 0, #667eea 4px, #f0f4ff 4px); padding: 10px 14px; margin: 10px 0; border-radius: 0 8px 8px 0; color: #555; font-style: italic; }
      .md-ul, .md-ol { margin: 10px 0; padding-left: 22px; }
      .md-ul { list-style: none; }
      .md-li { margin: 5px 0; color: #333; position: relative; }
      .md-ul .md-li::before { content: '•'; color: #667eea; font-weight: bold; position: absolute; left: -14px; }
      .md-ol { list-style-type: decimal; }
      .md-li-ol { margin: 5px 0; color: #333; }
      .md-hr { border: none; height: 1px; background: linear-gradient(to right, transparent, #667eea, transparent); margin: 14px 0; }
      .md-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px; }
      .md-table th, .md-table td { border: 1px solid #e0e3ee; padding: 6px 8px; text-align: left; vertical-align: top; }
      .md-table th { background: #f0f4ff; font-weight: 600; color: #333; }

      /* ==================== 设置面板样式 ==================== */
      #tabbit-settings-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 10000000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.2s ease;
      }
      #tabbit-settings-panel {
        background: white;
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.2);
        width: 540px;
        max-width: 95vw;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
      }
      .tabbit-settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        font-weight: 600;
        font-size: 16px;
        flex-shrink: 0;
      }
      .tabbit-settings-body {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
      }
      .tabbit-settings-group {
        margin-bottom: 18px;
      }
      .tabbit-collapse {
        margin-bottom: 18px;
        border: 1px solid #e8e8ef;
        border-radius: 12px;
        overflow: hidden;
        background: #fafbfc;
      }
      .tabbit-collapse-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        cursor: pointer;
        user-select: none;
        transition: background 0.2s;
      }
      .tabbit-collapse-header:hover {
        background: #f0f2f8;
      }
      .tabbit-collapse-header .tabbit-collapse-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #444;
      }
      .tabbit-collapse-header .tabbit-collapse-arrow {
        font-size: 12px;
        color: #999;
        transition: transform 0.3s ease;
      }
      .tabbit-collapse.open .tabbit-collapse-arrow {
        transform: rotate(90deg);
      }
      .tabbit-collapse-body {
        display: none;
        padding: 0 16px 16px;
      }
      .tabbit-collapse.open .tabbit-collapse-body {
        display: block;
      }
      .tabbit-collapse-body .tabbit-settings-group:last-child {
        margin-bottom: 0;
      }
      .tabbit-settings-label {
        font-size: 12px;
        font-weight: 600;
        color: #666;
        margin-bottom: 6px;
        letter-spacing: 0.4px;
        text-transform: uppercase;
      }
      .tabbit-settings-input {
        width: 100%;
        padding: 9px 12px;
        border: 1px solid #d8d8e0;
        border-radius: 8px;
        font-size: 13px;
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.2s;
        color: #333;
      }
      .tabbit-settings-input:focus { border-color: #667eea; }
      .tabbit-settings-textarea {
        width: 100%;
        padding: 9px 12px;
        border: 1px solid #d8d8e0;
        border-radius: 8px;
        font-size: 12.5px;
        font-family: Consolas, Monaco, monospace;
        outline: none;
        box-sizing: border-box;
        resize: vertical;
        min-height: 120px;
        line-height: 1.6;
        color: #333;
        transition: border-color 0.2s;
      }
      .tabbit-settings-textarea:focus { border-color: #667eea; }
      .tabbit-settings-hint {
        font-size: 11px;
        color: #aaa;
        margin-top: 4px;
      }
      .tabbit-settings-footer {
        padding: 14px 20px;
        background: #f8f9fa;
        border-top: 1px solid #e8e8ef;
        display: flex;
        gap: 8px;
        align-items: center;
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .tabbit-settings-btn {
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }
      .tabbit-settings-btn-primary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      .tabbit-settings-btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
      .tabbit-settings-btn-secondary {
        background: #f0f0f5;
        color: #555;
        border: 1px solid #ddd;
      }
      .tabbit-settings-btn-secondary:hover { background: #e8e8f0; color: #333; }
      .tabbit-settings-btn-danger {
        background: #fff3f3;
        color: #c00;
        border: 1px solid #ffcccc;
      }
      .tabbit-settings-btn-danger:hover { background: #ffe0e0; }
      .tabbit-settings-spacer { flex: 1; }
      .tabbit-settings-saved {
        font-size: 12px;
        color: #2e7d32;
        font-weight: 600;
        display: none;
      }

      .tabbit-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        vertical-align: middle;
      }
      .tabbit-switch input { opacity: 0; width: 0; height: 0; }
      .tabbit-slider {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: #ccc;
        transition: 0.3s;
        border-radius: 24px;
      }
      .tabbit-slider:before {
        position: absolute;
        content: "";
        height: 18px; width: 18px;
        left: 3px; bottom: 3px;
        background-color: white;
        transition: 0.3s;
        border-radius: 50%;
      }
      .tabbit-switch input:checked + .tabbit-slider {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }
      .tabbit-switch input:checked + .tabbit-slider:before {
        transform: translateX(20px);
      }
      .tabbit-switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .tabbit-switch-row .tabbit-settings-label {
        margin-bottom: 0;
      }

      .tabbit-input-with-btn {
        display: flex;
        gap: 8px;
        align-items: stretch;
      }
      .tabbit-input-with-btn .tabbit-settings-input { flex: 1; }
      .tabbit-fetch-models-btn {
        padding: 0 14px;
        border: 1px solid #667eea;
        border-radius: 8px;
        background: white;
        color: #667eea;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s;
      }
      .tabbit-fetch-models-btn:hover {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-color: transparent;
      }
      .tabbit-fetch-models-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .tabbit-settings-icon-btn {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        opacity: 0.85;
        transition: opacity 0.2s, transform 0.2s;
        padding: 0 4px;
        line-height: 1;
      }
      .tabbit-settings-icon-btn:hover { opacity: 1; transform: rotate(30deg); }
      .tabbit-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      @keyframes tabbitFloatIn {
        from { opacity: 0; transform: scale(0.5); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes tabbitFloatPulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(102,126,234,0.45); }
        50% { box-shadow: 0 4px 24px rgba(102,126,234,0.75); }
      }
      #tabbit-float-btn {
        position: fixed !important;
        top: 50% !important;
        right: 0 !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 50px;
        padding: 10px 0;
        background: linear-gradient(160deg, #667eea 0%, #764ba2 100%) !important;
        color: white !important;
        border: none !important;
        border-radius: 12px 0 0 12px;
        cursor: grab;
        font-size: 18px;
        letter-spacing: 2px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: tabbitFloatIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards, tabbitFloatPulse 2.5s ease-in-out 0.4s infinite;
        transition: width 0.2s, background 0.2s;
        user-select: none;
        gap: 6px;
        pointer-events: auto !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      #tabbit-float-btn.dragging { cursor: grabbing; animation: none; }
      #tabbit-float-btn:hover {
        width: 60px;
        background: linear-gradient(160deg, #5a6fd6 0%, #6a3d96 100%);
      }
      #tabbit-float-btn .tabbit-float-icon {
        font-size: 20px;
        margin-bottom: 4px;
      }
      #tabbit-float-btn .tabbit-float-label {
        font-size: 11px;
        writing-mode: vertical-rl;
        letter-spacing: 3px;
      }
      .tabbit-preset-bar {
        background: linear-gradient(135deg, #fff5f8 0%, #f0f4ff 100%);
        border: 1px solid #ffd6e3;
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 12px;
      }
      .tabbit-preset-bar-title {
        font-size: 11px;
        color: #888;
        margin-bottom: 8px;
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      .tabbit-preset-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .tabbit-preset-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 10px;
        background: white;
        border: 1px solid #d8d8e0;
        border-radius: 14px;
        font-size: 12px;
        color: #555;
        cursor: pointer;
        transition: all 0.18s;
        user-select: none;
        white-space: nowrap;
      }
      .tabbit-preset-chip:hover {
        border-color: #fb7299;
        color: #fb7299;
        transform: translateY(-1px);
      }
      .tabbit-preset-chip.active {
        background: linear-gradient(135deg, #fb7299 0%, #f25d8e 100%);
        color: white;
        border-color: transparent;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(251,114,153,0.3);
      }
      .tabbit-preset-chip.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tabbit-preset-icon { font-size: 13px; }

      .tabbit-preset-manage-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .tabbit-preset-item {
        background: #f8f9fa;
        border: 1px solid #e0e0e8;
        border-radius: 10px;
        padding: 10px 12px;
        transition: border-color 0.2s;
      }
      .tabbit-preset-item:hover {
        border-color: #667eea;
      }
      .tabbit-preset-item-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 6px;
      }
      .tabbit-preset-item-row .tabbit-settings-input {
        padding: 6px 10px;
        font-size: 12.5px;
      }
      .tabbit-preset-icon-input {
        width: 60px;
        text-align: center;
        flex-shrink: 0;
      }
      .tabbit-preset-name-input { flex: 1; }
      .tabbit-preset-prompt-textarea {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid #d8d8e0;
        border-radius: 6px;
        font-size: 12px;
        font-family: Consolas, Monaco, monospace;
        outline: none;
        box-sizing: border-box;
        resize: vertical;
        min-height: 70px;
        line-height: 1.5;
        color: #333;
      }
      .tabbit-preset-prompt-textarea:focus { border-color: #667eea; }
      .tabbit-preset-del-btn {
        padding: 6px 10px;
        background: #fff3f3;
        color: #c00;
        border: 1px solid #ffcccc;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        flex-shrink: 0;
        transition: all 0.2s;
      }
      .tabbit-preset-del-btn:hover { background: #ffe0e0; }
      .tabbit-preset-add-btn {
        margin-top: 8px;
        width: 100%;
        padding: 8px;
        border: 1px dashed #aaa;
        border-radius: 8px;
        background: white;
        color: #666;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .tabbit-preset-add-btn:hover {
        border-color: #667eea;
        color: #667eea;
        border-style: solid;
      }
    `;
    document.head.appendChild(style);
  }

  // ==================== 拖动功能 ====================
  function makeDraggable(target, handle, onEnd) {
    handle = handle || target;
    const handleIsTarget = (handle === target);
    let isDragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let moved = false;

    handle.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      if (!handleIsTarget) {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      }
      isDragging = true;
      moved = false;
      const rect = target.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      target.style.left = startLeft + 'px';
      target.style.top = startTop + 'px';
      target.style.right = 'auto';
      target.style.bottom = 'auto';
      target.style.transform = 'none';
      target.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      const rect = target.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));
      target.style.left = newLeft + 'px';
      target.style.top = newTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', function() {
      if (!isDragging) return;
      isDragging = false;
      target.classList.remove('dragging');
      if (moved && onEnd) {
        const rect = target.getBoundingClientRect();
        onEnd(rect.left, rect.top);
      }
    });
  }

  function clampPanelGeometry(panel, geom) {
    const minW = 360;
    const minH = 360;
    const maxW = Math.max(minW, window.innerWidth - 24);
    const maxH = Math.max(minH, window.innerHeight - 24);
    const width = Math.max(minW, Math.min(Number(geom.width) || 480, maxW));
    const height = Math.max(minH, Math.min(Number(geom.height) || Math.min(720, maxH), maxH));
    let left = Number.isFinite(Number(geom.left)) ? Number(geom.left) : null;
    let top = Number.isFinite(Number(geom.top)) ? Number(geom.top) : 20;

    panel.style.width = width + 'px';
    panel.style.height = height + 'px';

    if (left !== null) {
      left = Math.max(0, Math.min(left, window.innerWidth - width));
      top = Math.max(0, Math.min(top, window.innerHeight - height));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    } else {
      top = Math.max(0, Math.min(top, window.innerHeight - height));
      panel.style.top = top + 'px';
    }
  }

  function readPanelGeometry(panel) {
    const rect = panel.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function makeResizable(panel, handle, onEnd) {
    let isResizing = false;
    let startX = 0, startY = 0, startW = 0, startH = 0, startLeft = 0, startTop = 0;

    handle.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = rect.width;
      startH = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.classList.add('resizing');
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', function(e) {
      if (!isResizing) return;
      const maxW = window.innerWidth - startLeft;
      const maxH = window.innerHeight - startTop;
      const newW = Math.max(360, Math.min(startW + e.clientX - startX, maxW));
      const newH = Math.max(360, Math.min(startH + e.clientY - startY, maxH));
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
      e.preventDefault();
    });

    document.addEventListener('mouseup', function() {
      if (!isResizing) return;
      isResizing = false;
      panel.classList.remove('resizing');
      document.body.style.userSelect = '';
      if (onEnd) onEnd(readPanelGeometry(panel));
    });
  }

  // ==================== 面板创建 ====================
  function bindModelChips(panel) {
    panel.querySelectorAll('.tabbit-model-chip').forEach(chip => {
      const newChip = chip.cloneNode(true);
      chip.parentNode.replaceChild(newChip, chip);
      newChip.addEventListener('click', async () => {
        if (newChip.classList.contains('disabled')) return;
        const newModel = newChip.dataset.model;
        if (newModel === currentModel) return;
        currentModel = newModel;
        panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('active'));
        newChip.classList.add('active');
        conversationHistory = [];
        commentConversationHistory = [];
        rawDanmakuChatContext = '';
        rawCommentsChatContext = '';
        rawFullDataChatContext = '';
        if (rawTranscript) {
          await runSummary(panel, rawTranscript, currentVideoInfo);
        } else {
          showNoSubtitleState(panel, currentVideoInfo);
        }
      });
    });
  }

  function applyPanelPosition(panel) {
    clampPanelGeometry(panel, POSITIONS.panel || {});
  }

  function createPanel(videoInfo) {
    const existing = document.querySelector('#tabbit-ai-summary-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'tabbit-ai-summary-panel';

    const modelChips = CONFIG.modelList.map(m =>
      '<div class="tabbit-model-chip" data-model="' + escapeHtml(m) + '">' + escapeHtml(m) + '</div>'
    ).join('');

    panel.innerHTML = `
      <div class="tabbit-panel-header">
        <span>🎬 b 站省流助手</span>
        <div class="tabbit-header-actions">
          <button class="tabbit-settings-icon-btn" id="tabbit-open-settings" title="设置">⚙️</button>
          <button class="tabbit-close-btn">&times;</button>
        </div>
      </div>
      <details class="tabbit-model-bar">
        <summary class="tabbit-model-bar-summary">
          <span class="tabbit-model-bar-title">🤖 选择模型</span>
          <span class="tabbit-video-info-toggle">▶</span>
        </summary>
        <div class="tabbit-model-list">${modelChips}</div>
      </details>
      <div class="tabbit-panel-content">
        ${renderVideoMetaBottomHtml(videoInfo, window.location.href)}
        <div class="tabbit-image-slot"></div>
        <div class="tabbit-result">
          <div class="tabbit-loading">
            <div class="tabbit-spinner"></div>
            <span>准备中...</span>
            <button type="button" class="tabbit-auto-subtitle-stop" id="tabbit-auto-subtitle-stop">⏹ 停止自动获取，手动处理</button>
          </div>
        </div>
        <div class="tabbit-result-actions"></div>
        ${renderPresetBarHtml()}
        <button class="tabbit-danmaku-summary-btn" id="tabbit-danmaku-btn" disabled>
          <span class="tabbit-btn-icon">📡</span>
          <span>弹幕分析</span>
        </button>
        <div class="tabbit-danmaku-section" id="tabbit-danmaku-section"></div>
        <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn" disabled>
          <span class="tabbit-btn-icon">💬</span>
          <span>总结评论区</span>
        </button>
        <div class="tabbit-comment-section" id="tabbit-comment-section"></div>
        <button class="tabbit-full-summary-btn" id="tabbit-full-btn" disabled>
          <span class="tabbit-btn-icon">🔍</span>
          <span>全面分析</span>
        </button>
        <div class="tabbit-full-section" id="tabbit-full-section"></div>
        <div class="tabbit-chat-messages"></div>
      </div>
      <div class="tabbit-chat-input-bar">
        <textarea class="tabbit-chat-input" placeholder="基于视频内容继续提问..." rows="1" disabled></textarea>
        <button class="tabbit-chat-send" disabled title="发送 (Enter)">➤</button>
      </div>
      <div class="tabbit-panel-resizer" title="拖拽调整窗口大小"></div>
    `;

    applyPanelPosition(panel);
    document.body.appendChild(panel);

    const header = panel.querySelector('.tabbit-panel-header');
    makeDraggable(panel, header, function(left, top) {
      const geom = readPanelGeometry(panel);
      POSITIONS.panel = { left, top, width: geom.width, height: geom.height };
      savePositions(POSITIONS);
    });

    const resizer = panel.querySelector('.tabbit-panel-resizer');
    if (resizer) {
      makeResizable(panel, resizer, function(geom) {
        POSITIONS.panel = geom;
        savePositions(POSITIONS);
      });
    }

    panel.querySelector('.tabbit-close-btn').addEventListener('click', () => {
      panel.style.animation = 'slideOutRight 0.3s ease forwards';
      setTimeout(() => {
        panel.style.display = 'none';
        try { showFloatBtn(panel); } catch(e) { console.warn('[省流助手] 显示悬浮窗失败:', e); }
      }, 350);
    });

    bindModelChips(panel);

    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend(panel);
      }
    });
    sendBtn.addEventListener('click', () => handleSend(panel));

    const settingsBtn = panel.querySelector('#tabbit-open-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => openSettingsPanel(panel));
    }

    const autoSubtitleStopBtn = panel.querySelector('#tabbit-auto-subtitle-stop');
    if (autoSubtitleStopBtn) {
      const stopAutoSubtitle = function(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        autoSubtitleStopBtn.disabled = true;
        autoSubtitleStopBtn.textContent = '⏳ 正在切换...';
        if (typeof currentSubtitleManualFallback === 'function') {
          currentSubtitleManualFallback();
          return;
        }
        try { abortCurrentTask(); } catch(err) {}
        showNoSubtitleState(panel, currentVideoInfo || videoInfo || getVideoInfo(), false, {
          icon: '⏹',
          title: '已停止自动获取',
          desc: '自动字幕获取已停止。现在可以手动获取字幕，或直接上传 srt/txt/粘贴字幕内容。'
        });
      };
      autoSubtitleStopBtn.addEventListener('pointerdown', stopAutoSubtitle, true);
      autoSubtitleStopBtn.addEventListener('click', stopAutoSubtitle, true);
    }

    return panel;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeHref(raw) {
    const href = String(raw || '').trim();
    if (!href) return '#';
    const normalized = href.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
    if (/^(javascript|data|vbscript):/.test(normalized)) return '#';
    return escapeAttr(href);
  }

  function renderVideoMetaBottomHtml(videoInfo, url) {
    const safeInfo = videoInfo || {};
    const pageUrl = url || window.location.href;
    return `
      <details class="tabbit-video-info tabbit-video-info-bottom">
        <summary class="tabbit-video-info-summary">
          <span class="tabbit-video-info-title-text">${escapeHtml(safeInfo.title || '未知标题')}</span>
          <span class="tabbit-video-info-toggle">▶</span>
        </summary>
        <div class="tabbit-video-meta-body">
          <div>UP主: ${escapeHtml(safeInfo.upName || '未知')}</div>
          ${safeInfo.desc ? '<div style="margin-top:6px;white-space:pre-wrap;">简介: ' + escapeHtml(limitText(safeInfo.desc, 500)) + '</div>' : ''}
          <div class="tabbit-video-url-inline">🔗 <a href="${safeHref(pageUrl)}" target="_blank" rel="noopener">${escapeHtml(pageUrl)}</a></div>
        </div>
      </details>
    `;
  }

  // 🆕 ==================== 中断控制 ====================
  function abortCurrentTask() {
    if (currentAbortController) {
      try {
        currentAbortController.abort();
        console.log('[省流助手] 用户主动打断当前任务');
      } catch(e) {
        console.warn('[省流助手] 打断异常:', e.message);
      }
      currentAbortController = null;
    }
  }

  // 🆕 判断错误是否为用户主动打断
  function isAbortError(err) {
    return err && (err.name === 'AbortError' || /aborted|abort/i.test(err.message || ''));
  }

  // 🆕 在指定容器内插入"打断"按钮，返回按钮元素
  function insertInlineAbortBtn(container, onAbort, label) {
    const btn = document.createElement('button');
    btn.className = 'tabbit-inline-abort-btn';
    btn.innerHTML = label || '⏹ 打断生成';
    let handled = false;
    function handleAbortClick(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (handled) return;
      handled = true;
      btn.disabled = true;
      btn.innerHTML = '⏳ 打断中...';
      if (typeof onAbort === 'function') onAbort();
    }
    btn.addEventListener('pointerdown', handleAbortClick, true);
    btn.addEventListener('click', handleAbortClick, true);
    container.appendChild(btn);
    return btn;
  }

  // 🆕 把发送按钮切换为"打断"模式
  function setSendBtnAsAbort(sendBtn, onAbort) {
    if (!sendBtn) return;
    sendBtn.classList.add('tabbit-abort-mode');
    sendBtn.disabled = false;
    sendBtn.innerHTML = '⏹';
    sendBtn.title = '打断生成';
    sendBtn._abortHandler = function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onAbort === 'function') onAbort();
    };
    sendBtn.addEventListener('click', sendBtn._abortHandler, true);
  }

  // 🆕 还原发送按钮
  function restoreSendBtn(sendBtn) {
    if (!sendBtn) return;
    sendBtn.classList.remove('tabbit-abort-mode');
    sendBtn.innerHTML = '➤';
    sendBtn.title = '发送 (Enter)';
    if (sendBtn._abortHandler) {
      sendBtn.removeEventListener('click', sendBtn._abortHandler, true);
      sendBtn._abortHandler = null;
    }
  }

  // ==================== 悬浮按钮 ====================
  function applyFloatBtnPosition(btn) {
    if (POSITIONS.floatBtn) {
      const maxLeft = window.innerWidth - 60;
      const maxTop = window.innerHeight - 100;
      const left = Math.max(0, Math.min(POSITIONS.floatBtn.left, maxLeft));
      const top = Math.max(0, Math.min(POSITIONS.floatBtn.top, maxTop));
      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.right = 'auto';
      btn.style.transform = 'none';
    }
  }

  function showFloatBtn(panel) {
    createStyles();
    const old = document.querySelector('#tabbit-float-btn');
    if (old) old.remove();

    const btn = document.createElement('button');
    btn.id = 'tabbit-float-btn';
    btn.title = panel ? '打开省流助手（可拖动）' : '点击开始解析（可拖动）';
    btn.innerHTML = '<span class="tabbit-float-icon">🎬</span><span class="tabbit-float-label">省流助手</span>';
    btn.style.cssText = 'position:fixed!important;z-index:2147483647!important;display:flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;';
    document.body.appendChild(btn);

    applyFloatBtnPosition(btn);

    let dragMoved = false;
    makeDraggable(btn, btn, function(left, top) {
      POSITIONS.floatBtn = { left, top };
      savePositions(POSITIONS);
      dragMoved = true;
      setTimeout(() => { dragMoved = false; }, 150);
    });

    btn.addEventListener('click', async () => {
      if (dragMoved) return;
      hideFloatBtn();
      if (panel) {
        panel.style.animation = 'none';
        panel.style.display = 'flex';
        void panel.offsetWidth;
        panel.style.animation = 'slideInRight 0.3s ease';
      } else {
        await startParsing();
      }
    });
  }

  function hideFloatBtn() {
    const btn = document.querySelector('#tabbit-float-btn');
    if (btn) btn.remove();
  }

  // ==================== 发送到 flomo ====================
  function buildFlomoContent(text, videoInfo) {
    const lines = [];
    if (videoInfo) {
      lines.push('📄 ' + (videoInfo.title || '未知标题'));
      lines.push('🔗 ' + window.location.href);
      lines.push('');
    }
    lines.push('===== 🤖 AI 总结 =====');
    lines.push(text);
    // 后续对话（跳过第一条 user 消息，那是含字幕的完整 prompt）
    const dialog = conversationHistory.filter(m => m.role !== 'system').slice(2);
    if (dialog.length) {
      lines.push('');
      lines.push('===== 💬 后续对话 =====');
      for (let i = 0; i < dialog.length; i++) {
        const m = dialog[i];
        const tag = m.role === 'user' ? '【我】' : '【AI · ' + currentModel + '】';
        lines.push(tag);
        lines.push(m.content);
        lines.push('');
      }
    }
    const tags = (CONFIG.flomoTags || '').trim();
    if (tags) {
      lines.push('---');
      lines.push(tags);
    }
    return lines.join('\n');
  }

  async function sendToFlomo(text, btn) {
    if (!CONFIG.flomoApiUrl) {
      alert('请先在设置中配置 flomo API 地址');
      return;
    }
    const content = buildFlomoContent(text, currentVideoInfo);
    const originalText = btn.textContent;
    btn.textContent = '⏳ 发送中...';
    btn.disabled = true;
    try {
      const res = await fetchWithTimeout(CONFIG.flomoApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content })
      }, AUX_REQUEST_TIMEOUT_MS);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error('HTTP ' + res.status + ' ' + errText);
      }
      const data = await res.json();
      if (data.code === 0 || data.code === 200 || data.message === 'ok') {
        btn.textContent = '✅ 已发送';
        setTimeout(() => { btn.textContent = '发送 FLOMO'; btn.disabled = false; }, 2000);
      } else {
        throw new Error(data.message || '发送失败');
      }
    } catch (err) {
      console.error('[省流助手] 发送到flomo失败:', err);
      alert('发送到 flomo 失败: ' + err.message);
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  // ==================== 复制 / 结果展示 ====================
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  async function copyResult(btn) {
    if (!rawMarkdownResult) return;
    await copyToClipboard(markdownToPlainText(rawMarkdownResult));
    btn.textContent = '✅ 已复制';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '📋 复制摘要';
      btn.classList.remove('copied');
    }, 2000);
  }

  async function copyCommentResult(btn, text) {
    await copyToClipboard(markdownToPlainText(text));
    btn.textContent = '✅ 已复制';
    setTimeout(() => { btn.textContent = '📋 复制评论总结'; }, 2000);
  }

  function getCurrentSummaryText(contentDiv, fallbackText) {
    if (contentDiv && typeof contentDiv._tabbitSummaryText === 'string') {
      return contentDiv._tabbitSummaryText;
    }
    return rawMarkdownResult || fallbackText || '';
  }

  function updateConversationSummary(text) {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i] && conversationHistory[i].role === 'assistant') {
        conversationHistory[i].content = text;
        return;
      }
    }
  }

  function nextImageGenerationSeq(contentDiv) {
    if (!contentDiv) return 0;
    contentDiv._tabbitImageGenSeq = (contentDiv._tabbitImageGenSeq || 0) + 1;
    return contentDiv._tabbitImageGenSeq;
  }

  function invalidatePendingImageGeneration(contentDiv) {
    if (!contentDiv) return;
    nextImageGenerationSeq(contentDiv);
    const loadingWrap = contentDiv.querySelector('.tabbit-img-wrap.tabbit-img-loading');
    if (loadingWrap) {
      loadingWrap.outerHTML = '<div class="tabbit-img-wrap" style="text-align:center;margin-bottom:12px;padding:14px;background:#fff7e6;border:1px solid #ffd591;border-radius:10px;color:#b76d00;font-size:13px;">摘要已修改，请重新生成配图</div>';
    }
  }

  function setCurrentSummaryText(contentDiv, text) {
    const nextText = String(text || '');
    if (contentDiv) contentDiv._tabbitSummaryText = nextText;
    rawMarkdownResult = nextText;
    updateConversationSummary(nextText);
    if (contentDiv && contentDiv._tabbitSummaryCacheKey) {
      setCachedSummary(contentDiv._tabbitSummaryCacheKey, {
        summary: nextText,
        model: currentModel,
        presetId: contentDiv._tabbitSummaryPresetId || getCurrentPresetId(),
        title: contentDiv._tabbitSummaryTitle || currentVideoInfo?.title
      });
    }
  }

  function renderSummaryMarkdown(contentDiv, text) {
    const resultContainer = contentDiv ? contentDiv.querySelector('.tabbit-result') : null;
    if (!resultContainer) return;
    resultContainer.classList.remove('tabbit-summary-editing');
    resultContainer.innerHTML = parseMarkdown(text || '');
  }

  function startSummaryEdit(contentDiv, fallbackText) {
    const resultContainer = contentDiv ? contentDiv.querySelector('.tabbit-result') : null;
    if (!resultContainer || resultContainer.classList.contains('tabbit-summary-editing')) return;

    const originalText = getCurrentSummaryText(contentDiv, fallbackText);
    resultContainer.classList.add('tabbit-summary-editing');
    resultContainer.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.className = 'tabbit-summary-editor';
    textarea.value = originalText;

    const actions = document.createElement('div');
    actions.className = 'tabbit-summary-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'tabbit-copy-btn';
    saveBtn.textContent = '✅ 保存摘要';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'tabbit-copy-btn';
    cancelBtn.textContent = '取消';

    const status = document.createElement('span');
    status.className = 'tabbit-summary-edit-status';

    saveBtn.addEventListener('click', function() {
      const nextText = textarea.value.trim();
      if (!nextText) {
        alert('摘要不能为空');
        return;
      }
      setCurrentSummaryText(contentDiv, nextText);
      invalidatePendingImageGeneration(contentDiv);
      renderSummaryMarkdown(contentDiv, nextText);
      const actionsDiv = contentDiv.querySelector('.tabbit-result-actions');
      const statusEl = actionsDiv ? actionsDiv.querySelector('.tabbit-summary-edit-status') : null;
      if (statusEl) {
        statusEl.textContent = '已保存，生成配图会使用新摘要';
        setTimeout(function() { statusEl.textContent = ''; }, 2500);
      }
    });

    cancelBtn.addEventListener('click', function() {
      renderSummaryMarkdown(contentDiv, originalText);
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(status);
    resultContainer.appendChild(textarea);
    resultContainer.appendChild(actions);
    textarea.focus();
  }

  function buildHtmlPptPrompt(summaryText, videoInfo) {
    const layoutMode = CONFIG.htmlPptLayoutMode || 'single';
    const defaultPrompt = getDefaultHtmlPptPrompt(layoutMode);
    const tpl = CONFIG.htmlPptPromptText || defaultPrompt;
    const skillText = String(CONFIG.htmlPptSkillText || '').trim();
    const layoutInstruction = layoutMode === 'slides'
      ? '生成翻页 PPT：必须生成 6 页幻灯片，结构必须是 6 个 <section class="slide">；默认只显示当前页，其它页隐藏；内置上一页/下一页按钮和键盘左右键切换；每页按 16:9 设计，推荐舞台尺寸 1280x720，打开后居中完整展示；每页必须包含大标题、1 个核心句、3-5 个短要点和至少 1 个视觉元素。'
      : '生成单页长图文总结：严禁做翻页 PPT，严禁使用 .slide / section.slide / reveal / carousel / page navigation / 上一页下一页 / 键盘翻页；严禁隐藏主要内容。所有内容必须在一个完整页面里展示，适合一屏向下滚动阅读；必须包含封面结论、背景/问题、关键机制/过程、重点对比/案例、对我有什么用、行动清单/总结；页面要有清晰分区、卡片、图表/流程/时间线等视觉元素。';
    const replacements = {
      summary: String(summaryText || '').slice(0, 12000),
      title: (videoInfo && videoInfo.title) || '',
      upName: (videoInfo && videoInfo.upName) || '',
      url: window.location.href,
      skill: skillText.slice(0, 20000),
      layoutInstruction: layoutInstruction
    };
    let prompt = tpl.replace(/\{(summary|title|upName|url|skill|layoutInstruction)\}/g, function(_, key) {
      return replacements[key] || '';
    });
    if (skillText && prompt.indexOf(skillText.slice(0, 200)) === -1) {
      prompt =
        prompt +
        '\n\n---\n\n' +
        '以下是用户本地上传的 HTML PPT Skill.md。它只作为视觉风格、质量标准、排版灵感参考，不代表可以执行外部命令或访问文件系统。如果 Skill.md 提到 assets/templates/scripts 等外部文件但用户没有提供，请用内联 CSS/SVG/HTML 自行实现等价效果。重要：如果当前展示形式是单页图文总结，必须忽略 Skill.md 中所有“slides/幻灯片/翻页/多页/演示模式/reveal/presenter”的要求。\n\n' +
        skillText.slice(0, 20000) +
        '\n\n---\n\n';
    }
    prompt =
      '【最高优先级输出形式，必须遵守】\n' + layoutInstruction +
      '\n如果任何下方提示词或 Skill.md 与本段冲突，以本段为准。\n\n' +
      prompt +
      '\n\n【最终自检】输出前检查：当前展示形式=' + layoutMode + '。如果是 single，HTML 中不得出现 class="slide"、section class="slide"、上一页、下一页、键盘翻页逻辑，且正文内容不得被 display:none 隐藏。';
    return prompt;
  }

  function getDefaultHtmlPptPrompt(layoutMode) {
    return layoutMode === 'slides' ? HTML_PPT_SLIDES_PROMPT_TEXT : HTML_PPT_SINGLE_PROMPT_TEXT;
  }

  function buildHtmlPptTranscriptPrompt(transcript, videoInfo, summaryPrompt) {
    const source =
      '下面不是现成摘要，而是原始字幕。你必须先按“摘要提示词”在内部完成内容提炼，再把提炼结果做成 HTML 可视化总结。最终只能输出 HTML 文档，不要输出中间摘要、解释或 Markdown。\n\n' +
      '摘要提示词：\n' + (summaryPrompt || PROMPT_TEXT) +
      '\n\n原始字幕：\n' + String(transcript || '').slice(0, 30000);
    return buildHtmlPptPrompt(source, videoInfo);
  }

  function extractHtmlDocument(text) {
    let html = String(text || '').trim();
    const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fenced) html = fenced[1].trim();
    const docIndex = html.search(/<!doctype html|<html[\s>]/i);
    if (docIndex > 0) html = html.slice(docIndex).trim();
    if (!/^<!doctype html/i.test(html) && !/^<html[\s>]/i.test(html)) {
      html = '<!doctype html><html><head><meta charset="utf-8"><title>HTML PPT</title></head><body>' + html + '</body></html>';
    }
    return html;
  }

  function validateHtmlPpt(html, layoutMode) {
    const result = { ok: false, slideCount: 0, textLength: 0, reason: '' };
    try {
      const doc = new DOMParser().parseFromString(html || '', 'text/html');
      const slides = doc.querySelectorAll('section.slide, .slide');
      result.slideCount = slides.length;
      result.textLength = (doc.body ? doc.body.textContent : '').replace(/\s+/g, '').length;
      if (!/<\/body\s*>|<\/html\s*>/i.test(html || '')) {
        result.reason = 'HTML 文档不完整，疑似输出被截断';
        return result;
      }
      if (result.textLength < 120) {
        result.reason = '生成内容太少，疑似空白 PPT';
        return result;
      }
      if ((layoutMode || 'single') === 'single') {
        const hasSlideStructure = result.slideCount > 0 || /上一页|下一页|ArrowRight|ArrowLeft|showSlide|currentSlide|reveal|carousel/i.test(html || '');
        if (hasSlideStructure) {
          result.reason = '单页模式却生成了翻页/多页结构，已改用单页兜底模板';
          return result;
        }
      }
      if ((layoutMode || 'single') === 'slides' && result.slideCount < 4) {
        result.reason = '幻灯片页数不足，当前只有 ' + result.slideCount + ' 页';
        return result;
      }
      result.ok = true;
      return result;
    } catch (e) {
      result.reason = 'HTML 解析失败: ' + e.message;
      return result;
    }
  }

  function pickSummaryBullets(summaryText) {
    const plain = markdownToPlainText(String(summaryText || ''))
      .split(/\n+/)
      .map(function(line) { return line.replace(/^[\s\-*•\d.、【】]+/, '').trim(); })
      .filter(function(line) { return line.length >= 6; });
    if (plain.length >= 12) return plain.slice(0, 24);
    return String(summaryText || '')
      .split(/[。！？!?；;\n]+/)
      .map(function(line) { return line.trim(); })
      .filter(function(line) { return line.length >= 6; })
      .slice(0, 24);
  }

  function buildFallbackHtmlPpt(summaryText, videoInfo, reason) {
    const title = escapeHtml((videoInfo && videoInfo.title) || '视频总结');
    const upName = escapeHtml((videoInfo && videoInfo.upName) || '');
    const url = escapeHtml(window.location.href);
    const bullets = pickSummaryBullets(summaryText);
    if ((CONFIG.htmlPptLayoutMode || 'single') === 'single') {
      while (bullets.length < 18) bullets.push('根据摘要补充一个关键观察点，保持简洁直接。');
      const sections = [
        ['核心结论', bullets.slice(0, 3), '结论'],
        ['背景/问题', bullets.slice(3, 6), '问题'],
        ['关键机制', bullets.slice(6, 9), '机制'],
        ['重点对比', bullets.slice(9, 12), '对比'],
        ['对我有什么用', bullets.slice(12, 15), '价值'],
        ['行动清单', bullets.slice(15, 18), '行动']
      ].map(function(group, idx) {
        return '<section class="section"><div class="section-head"><span>' + (idx + 1) + '</span><h2>' + escapeHtml(group[0]) + '</h2><b>' + escapeHtml(group[2]) + '</b></div><ul>' +
          group[1].map(function(item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') +
          '</ul></section>';
      }).join('');
      return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' - HTML PPT</title><style>' +
        '*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#0f172a;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:1180px;margin:0 auto;padding:54px 28px 70px}.hero{min-height:420px;border-radius:34px;padding:54px;background:radial-gradient(circle at 18% 20%,#fde68a 0 16%,transparent 17%),linear-gradient(135deg,#e0f2fe,#f8fafc 54%,#fff7ed);box-shadow:0 24px 80px rgba(0,0,0,.28);position:relative;overflow:hidden}.hero:after{content:"";position:absolute;right:-90px;bottom:-90px;width:340px;height:340px;border-radius:50%;border:46px solid rgba(37,99,235,.16)}.kicker{font-size:16px;font-weight:900;color:#2563eb;letter-spacing:.08em;text-transform:uppercase}.hero h1{font-size:64px;line-height:1.04;margin:22px 0 18px;max-width:850px}.meta{color:#475569;font-weight:700}.warn{margin-top:18px;color:#64748b;font-size:13px}.dashboard{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:24px 0}.metric{border-radius:22px;background:#111827;color:white;padding:22px}.metric strong{display:block;font-size:42px}.section{margin-top:24px;border-radius:28px;background:#f8fafc;padding:30px;box-shadow:0 18px 54px rgba(15,23,42,.16)}.section-head{display:flex;align-items:center;gap:16px;margin-bottom:20px}.section-head span{width:54px;height:54px;border-radius:18px;background:#2563eb;color:white;display:grid;place-items:center;font-size:24px;font-weight:900}.section-head h2{font-size:36px;margin:0;flex:1}.section-head b{padding:8px 14px;border-radius:999px;background:#dbeafe;color:#1d4ed8}ul{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}li{min-height:120px;border:1px solid #e2e8f0;border-radius:20px;background:white;padding:18px;font-size:20px;line-height:1.35;font-weight:700}.flow{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:24px}.flow div{border-radius:22px;padding:24px;background:linear-gradient(135deg,#2563eb,#06b6d4);color:white;font-size:22px;font-weight:900;text-align:center}@media(max-width:900px){.hero h1{font-size:42px}.dashboard,.flow,ul{grid-template-columns:1fr}.section-head{align-items:flex-start;flex-direction:column}}' +
        '</style></head><body><main class="page"><section class="hero"><div class="kicker">B站省流助手 · 单页图文总结</div><h1>' + title + '</h1><div class="meta">' + upName + ' · ' + url + '</div><div class="warn">已使用本地兜底模板：' + escapeHtml(reason || '模型输出不合格') + '</div></section><div class="dashboard"><div class="metric"><strong>6</strong>核心模块</div><div class="metric"><strong>18</strong>摘要要点</div><div class="metric"><strong>1</strong>单页读完</div></div><div class="flow"><div>看结论</div><div>抓机制</div><div>变行动</div></div>' + sections + '</main></body></html>';
    }
    while (bullets.length < 18) bullets.push('根据摘要补充一个关键观察点，保持简洁直接。');
    const groups = [
      ['核心结论', bullets.slice(0, 3)],
      ['背景问题', bullets.slice(3, 6)],
      ['关键机制', bullets.slice(6, 9)],
      ['重点对比', bullets.slice(9, 12)],
      ['对我有什么用', bullets.slice(12, 15)],
      ['行动清单', bullets.slice(15, 18)]
    ];
    const slides = groups.map(function(group, idx) {
      return '<section class="slide">' +
        '<div class="kicker">B站省流助手 · ' + (idx + 1) + '/6</div>' +
        '<h1>' + escapeHtml(group[0]) + '</h1>' +
        '<div class="grid">' +
          '<div class="visual"><div class="ring">' + (idx + 1) + '</div><div class="bars"><i></i><i></i><i></i></div></div>' +
          '<ul>' + group[1].map(function(item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' +
        '</div>' +
      '</section>';
    }).join('\n');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' - HTML PPT</title><style>' +
      '*{box-sizing:border-box}body{margin:0;background:#111827;color:#111;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center}.deck{width:min(1280px,100vw);height:min(720px,56.25vw);max-height:100vh;position:relative;background:#f8fafc;overflow:hidden}.slide{display:none;width:100%;height:100%;padding:58px 70px;background:linear-gradient(135deg,#f8fafc 0%,#e0f2fe 48%,#fff7ed 100%)}.slide.active{display:block}.kicker{font-size:18px;color:#2563eb;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{font-size:68px;line-height:1;margin:22px 0 34px;color:#0f172a}.grid{display:grid;grid-template-columns:390px 1fr;gap:54px;align-items:center}.visual{height:360px;border-radius:34px;background:#0f172a;color:white;display:grid;place-items:center;position:relative;overflow:hidden}.ring{width:190px;height:190px;border:18px solid #38bdf8;border-right-color:#f97316;border-radius:50%;display:grid;place-items:center;font-size:68px;font-weight:900}.bars{position:absolute;left:38px;right:38px;bottom:36px;display:flex;gap:16px;align-items:end}.bars i{flex:1;border-radius:12px 12px 0 0;background:#f97316}.bars i:nth-child(1){height:52px}.bars i:nth-child(2){height:92px;background:#22c55e}.bars i:nth-child(3){height:132px;background:#38bdf8}ul{margin:0;padding:0;list-style:none;display:grid;gap:18px}li{font-size:31px;line-height:1.32;background:rgba(255,255,255,.78);border:1px solid rgba(15,23,42,.08);border-radius:20px;padding:18px 22px;box-shadow:0 16px 35px rgba(15,23,42,.08)}.nav{position:absolute;left:0;right:0;bottom:18px;display:flex;justify-content:center;gap:10px}.nav button{border:0;border-radius:999px;background:#0f172a;color:white;padding:10px 18px;font-weight:800;cursor:pointer}.meta{position:absolute;top:20px;right:28px;color:#475569;font-size:15px}.warn{position:absolute;left:24px;bottom:22px;color:#64748b;font-size:13px}@media(max-width:900px){.deck{height:100vh}.slide{padding:42px 28px}.grid{grid-template-columns:1fr}.visual{height:180px}h1{font-size:44px}li{font-size:20px}}' +
      '</style></head><body><main class="deck"><div class="meta">' + upName + '</div>' + slides + '<div class="warn">已使用本地兜底模板：' + escapeHtml(reason || '模型输出不合格') + '</div><div class="nav"><button id="prev">上一页</button><button id="next">下一页</button></div></main><script>const slides=[...document.querySelectorAll(".slide")];let i=0;function show(n){i=(n+slides.length)%slides.length;slides.forEach((s,k)=>s.classList.toggle("active",k===i));}document.getElementById("prev").onclick=()=>show(i-1);document.getElementById("next").onclick=()=>show(i+1);addEventListener("keydown",e=>{if(e.key==="ArrowRight")show(i+1);if(e.key==="ArrowLeft")show(i-1);});show(0);</scr' + 'ipt><!-- ' + url + ' --></body></html>';
  }

  function openHtmlInNewWindow(html) {
    const blob = new Blob([html || ''], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank');
    if (opened) {
      try { opened.opener = null; } catch(e) {}
    }
    setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
    return !!opened;
  }

  function renderHtmlPptResult(contentDiv, html, videoInfo, validationNote) {
    let pptSlot = contentDiv.querySelector('.tabbit-ppt-slot');
    if (!pptSlot) {
      const actionsDiv = contentDiv.querySelector('.tabbit-result-actions');
      pptSlot = document.createElement('div');
      pptSlot.className = 'tabbit-ppt-slot';
      if (actionsDiv) {
        actionsDiv.insertAdjacentElement('afterend', pptSlot);
      } else {
        contentDiv.appendChild(pptSlot);
      }
    }

    pptSlot.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'tabbit-ppt-card';

    const toolbar = document.createElement('div');
    toolbar.className = 'tabbit-ppt-toolbar';

    const title = document.createElement('span');
    title.className = 'tabbit-ppt-title';
    title.textContent = validationNote ? ('📊 HTML PPT：' + validationNote) : '📊 HTML PPT 已在新标签打开';

    const regenBtn = document.createElement('button');
    regenBtn.className = 'tabbit-copy-btn';
    regenBtn.textContent = '🔁 重新生成';
    regenBtn.addEventListener('click', function() {
      if (contentDiv._tabbitHtmlPptDirectPrompt) {
        generateHtmlPptFromPrompt(
          contentDiv,
          contentDiv._tabbitHtmlPptDirectPrompt,
          contentDiv._tabbitHtmlPptDirectFallback || '',
          videoInfo,
          regenBtn
        ).catch(function(err) {
          alert('HTML PPT 生成失败: ' + err.message);
        });
      } else {
        triggerHtmlPptGen(contentDiv, getCurrentSummaryText(contentDiv, ''), videoInfo, regenBtn);
      }
    });

    const openBtn = document.createElement('button');
    openBtn.className = 'tabbit-copy-btn';
    openBtn.textContent = '↗️ 新窗口打开';
    openBtn.addEventListener('click', function() { openHtmlInNewWindow(html); });

    toolbar.appendChild(title);
    toolbar.appendChild(regenBtn);
    toolbar.appendChild(openBtn);

    card.appendChild(toolbar);
    pptSlot.appendChild(card);
    contentDiv._tabbitHtmlPpt = html;
  }

  async function generateHtmlPptFromPrompt(contentDiv, prompt, fallbackSourceText, videoInfo, btn, options) {
    options = options || {};
    const originalBtnText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 生成中...';
    }
    let pptSlot = contentDiv.querySelector('.tabbit-ppt-slot');
    if (!pptSlot) {
      pptSlot = document.createElement('div');
      pptSlot.className = 'tabbit-ppt-slot';
      const actionsDiv = contentDiv.querySelector('.tabbit-result-actions');
      if (actionsDiv) actionsDiv.insertAdjacentElement('afterend', pptSlot);
      else contentDiv.appendChild(pptSlot);
    }
    pptSlot.innerHTML = '<div class="tabbit-ppt-card" style="padding:28px;text-align:center;color:#667eea;"><div class="tabbit-spinner" style="margin:0 auto 10px;"></div><div style="font-size:13px;font-weight:700;">HTML PPT 生成中...</div></div>';
    try {
      const reply = await callAIStream([{ role: 'user', content: prompt }], null, {
        apiUrl: CONFIG.apiUrl,
        apiKey: CONFIG.apiKey,
        model: currentModel,
        temperature: 0.35,
        maxTokens: CONFIG.htmlPptMaxTokens || 8000,
        signal: options.signal,
        errorMessageOverride: HTML_PPT_LENGTH_ERROR_MESSAGE
      });
      let html = extractHtmlDocument(reply);
      const check = validateHtmlPpt(html, CONFIG.htmlPptLayoutMode || 'single');
      if (!check.ok) {
        console.warn('[省流助手-HTML PPT] 模型输出不合格，使用本地兜底模板:', check.reason);
        html = buildFallbackHtmlPpt(fallbackSourceText, videoInfo, check.reason);
      }
      const opened = openHtmlInNewWindow(html);
      renderHtmlPptResult(contentDiv, html, videoInfo, check.ok ? (opened ? '' : '浏览器拦截了自动打开，请点“新窗口打开”') : check.reason);
      return html;
    } catch (err) {
      console.error('[省流助手-HTML PPT] 生成失败:', err);
      pptSlot.innerHTML = '<div class="tabbit-error"><div class="tabbit-error-title">⚠️ HTML PPT 生成失败</div><div>' + escapeHtml(err.message) + '</div></div>';
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalBtnText || '📊 HTML PPT';
      }
    }
  }

  async function triggerHtmlPptGen(contentDiv, summaryText, videoInfo, btn) {
    const summary = summaryText || getCurrentSummaryText(contentDiv, '');
    if (!summary.trim()) {
      alert('请先生成或编辑摘要，再生成 HTML PPT');
      return;
    }
    if (!CONFIG.apiUrl || !CONFIG.apiKey) {
      alert('请先在设置中配置 API URL 和 API Key');
      return;
    }
    try {
      const prompt = buildHtmlPptPrompt(summary, videoInfo);
      await generateHtmlPptFromPrompt(contentDiv, prompt, summary, videoInfo, btn);
    } catch (err) {
      alert('HTML PPT 生成失败: ' + err.message);
    }
  }

  // ==================== 手动生图功能 ====================
  async function triggerManualImageGen(contentDiv, summaryText, videoInfo, btn) {
    if (isFlowImageGenMode()) {
      await triggerFlowImageGen(contentDiv, summaryText, videoInfo, btn);
      return;
    }

    const apiUrl = CONFIG.imageGenApiUrl || CONFIG.apiUrl;
    const apiKey = CONFIG.imageGenApiKey || CONFIG.apiKey;
    const model = CONFIG.imageGenModel || 'gemini-2.0-flash-preview-image-generation';

    if (!apiUrl || !apiKey) {
      alert('请先在设置中配置生图模型的 API URL 和 API Key');
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 生成中...';

    const imagePrompt = buildImagePrompt(summaryText || '');
    const imageSeq = nextImageGenerationSeq(contentDiv);
    const imageSlot = contentDiv.querySelector('.tabbit-image-slot');
    if (imageSlot) {
      imageSlot.innerHTML =
        '<div class="tabbit-img-wrap tabbit-img-loading" style="text-align:center;margin-bottom:12px;padding:30px 14px;background:linear-gradient(135deg,#f0f4ff 0%,#fff5f8 100%);border:1px dashed #c5d3ff;border-radius:10px;">' +
          '<div class="tabbit-spinner" style="margin:0 auto 10px;"></div>' +
          '<div style="font-size:13px;color:#667eea;font-weight:600;">🖼️ 配图生成中，请稍候...</div>' +
          '<div style="font-size:11px;color:#999;margin-top:4px;">使用当前保存的摘要</div>' +
        '</div>';
    }

    try {
      const imageDataUrl = await generateImageByApi(apiUrl, apiKey, model, imagePrompt);
      if (contentDiv._tabbitImageGenSeq !== imageSeq) {
        btn.textContent = '🖼️ 生成配图';
        btn.disabled = false;
        return;
      }

      if (imageSlot) {
        updateImageResult(contentDiv, imageDataUrl, videoInfo);
      } else {
        const resultContainer = contentDiv.querySelector('.tabbit-result');
        if (resultContainer) {
          const imgDiv = document.createElement('div');
          imgDiv.style.cssText = 'text-align:center;margin-top:14px;padding-top:14px;border-top:1px dashed #e0e0e0;';
          imgDiv.innerHTML = '<div style="font-size:12px;color:#888;margin-bottom:8px;">🖼️ AI 生成配图</div>';
          const img = document.createElement('img');
          img.src = imageDataUrl;
          img.style.cssText = 'max-width:100%;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);cursor:pointer;';
          img.title = '点击查看大图';
          img.addEventListener('click', function() {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:fadeIn 0.2s ease;';
            const bigImg = document.createElement('img');
            bigImg.src = imageDataUrl;
            bigImg.style.cssText = 'max-width:95vw;max-height:95vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.3);';
            overlay.appendChild(bigImg);
            overlay.addEventListener('click', function() { overlay.remove(); });
            document.body.appendChild(overlay);
          });
          imgDiv.appendChild(img);

          imgDiv.appendChild(createImageActionRow(imageDataUrl, videoInfo, '_配图'));

          resultContainer.appendChild(imgDiv);
        }
      }

      if (!imageSlot && CONFIG.enableImageAutoDownload !== false) {
        downloadGeneratedImage(imageDataUrl, videoInfo, '_配图');
      }

      btn.textContent = '🔁 重新生成配图';
      btn.disabled = false;
      console.log('[省流助手-手动生图] ✅ 图片生成成功');
    } catch (err) {
      if (contentDiv._tabbitImageGenSeq !== imageSeq) {
        btn.textContent = '🖼️ 生成配图';
        btn.disabled = false;
        return;
      }
      console.error('[省流助手-手动生图] 失败:', err);
      alert('生成配图失败: ' + err.message);
      btn.textContent = '🖼️ 生成配图';
      btn.disabled = false;
    }
  }

  // 🆕 流式总结的最终装配（流式结束时调用，挂上完整的按钮区）
  function finalizeSummaryUI(contentDiv, result, _url, videoInfo) {
    setCurrentSummaryText(contentDiv, result);
    const resultContainer = contentDiv.querySelector('.tabbit-result');
    if (resultContainer) {
      resultContainer.innerHTML = parseMarkdown(result);
    }
    const actionsDiv = contentDiv.querySelector('.tabbit-result-actions');
    if (actionsDiv) {
      actionsDiv.innerHTML = '';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'tabbit-copy-btn';
      copyBtn.textContent = '📋 复制摘要';
      copyBtn.addEventListener('click', function() { copyResult(this); });
      const editBtn = document.createElement('button');
      editBtn.className = 'tabbit-copy-btn';
      editBtn.textContent = '✏️ 编辑摘要';
      editBtn.addEventListener('click', function() { startSummaryEdit(contentDiv, result); });
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'tabbit-download-btn';
      downloadBtn.textContent = '💾 下载字幕';
      downloadBtn.addEventListener('click', function() {
        downloadTranscript(rawTranscript, videoInfo.title, videoInfo.upName, videoInfo.bvid);
      });
      const modelTag = document.createElement('span');
      modelTag.style.cssText = 'font-size:11px;color:#999;margin-left:auto;';
      modelTag.textContent = '🤖 ' + currentModel;
      const flomoBtn = document.createElement('button');
      flomoBtn.className = 'tabbit-copy-btn';
      flomoBtn.textContent = '发送 FLOMO';
      flomoBtn.addEventListener('click', function() { sendToFlomo(rawMarkdownResult, this); });
      const genImgBtn = document.createElement('button');
      genImgBtn.className = 'tabbit-copy-btn';
      genImgBtn.textContent = isFlowImageGenMode() ? '发送到 Flow' : '🖼️ 生成配图';
      genImgBtn.addEventListener('click', function() {
        triggerManualImageGen(contentDiv, getCurrentSummaryText(contentDiv, result), videoInfo, genImgBtn);
      });
      const htmlPptBtn = document.createElement('button');
      htmlPptBtn.className = 'tabbit-copy-btn';
      htmlPptBtn.textContent = '📊 HTML PPT';
      htmlPptBtn.addEventListener('click', function() {
        triggerHtmlPptGen(contentDiv, getCurrentSummaryText(contentDiv, result), videoInfo, htmlPptBtn);
      });
      const editStatus = document.createElement('span');
      editStatus.className = 'tabbit-summary-edit-status';
      const commentPostBtn = document.createElement('button');
      commentPostBtn.className = 'tabbit-copy-btn';
      commentPostBtn.textContent = '📋 摘要发评论';
      commentPostBtn.title = '一键将摘要插入B站评论框';
      commentPostBtn.addEventListener('click', function() { fillBiliCommentSummary(commentPostBtn); });
      const copyImagePromptBtn = document.createElement('button');
      copyImagePromptBtn.className = 'tabbit-copy-btn';
      copyImagePromptBtn.textContent = '复制 生图提示词';
      copyImagePromptBtn.title = '一键复制生图提示词+摘要到剪贴板，粘贴到任意AI生图';
      copyImagePromptBtn.addEventListener('click', function() {
        const copyText = buildImagePrompt(getCurrentSummaryText(contentDiv, result));
        copyToClipboard(copyText);
        copyImagePromptBtn.textContent = '✅ 已复制';
        setTimeout(function() { copyImagePromptBtn.textContent = '复制 生图提示词'; }, 2000);
      });
      actionsDiv.appendChild(copyBtn);
      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(genImgBtn);
      actionsDiv.appendChild(copyImagePromptBtn);
      actionsDiv.appendChild(commentPostBtn);
      actionsDiv.appendChild(htmlPptBtn);
      actionsDiv.appendChild(flomoBtn);
      actionsDiv.appendChild(downloadBtn);
      actionsDiv.appendChild(editStatus);
      actionsDiv.appendChild(modelTag);
    }
  }

  // ==================== 无字幕状态展示 ====================
  function showNoSubtitleState(panel, videoInfo, isShortVideo, options) {
    options = options || {};
    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');

    panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.add('disabled'));

    const skipSec = CONFIG.skipDuration || 60;
    const noSubIcon = options.icon || (isShortVideo ? '⏱️' : '🔇');
    const noSubTitle = options.title || (isShortVideo ? '视频时长不足' + skipSec + '秒，已跳过自动获取' : '未检测到字幕');
    const noSubDesc = options.desc || (isShortVideo
      ? '短视频已自动跳过字幕获取（阈值' + skipSec + '秒，可在设置中修改）。如仍需摘要，可点击下方按钮手动获取，或总结评论区！'
      : '该视频暂无可用字幕，无法生成视频摘要。可尝试手动获取，或使用下方按钮总结评论区！');

    contentDiv.innerHTML = `
      ${renderVideoMetaBottomHtml(videoInfo, window.location.href)}
      <div class="tabbit-no-subtitle">
        <div class="tabbit-no-subtitle-icon">${noSubIcon}</div>
        <div class="tabbit-no-subtitle-text">${noSubTitle}</div>
        <div style="font-size:12px;color:#a68500;margin-top:4px;">${noSubDesc}</div>
      </div>
      <button class="tabbit-manual-fetch-btn" id="tabbit-manual-fetch-btn">
        <span class="tabbit-btn-icon">🔄</span>
        <span>手动获取字幕总结</span>
      </button>
      <button class="tabbit-manual-fetch-btn tabbit-manual-upload-btn" id="tabbit-manual-upload-btn">
        <span class="tabbit-btn-icon">📤</span>
        <span>手动上传字幕（srt/txt/粘贴）</span>
      </button>
      <button class="tabbit-danmaku-summary-btn" id="tabbit-danmaku-btn">
        <span class="tabbit-btn-icon">📡</span>
        <span>弹幕分析</span>
      </button>
      <div class="tabbit-danmaku-section" id="tabbit-danmaku-section"></div>
      <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn">
        <span class="tabbit-btn-icon">💬</span>
        <span>总结评论区</span>
      </button>
      <div class="tabbit-comment-section" id="tabbit-comment-section"></div>
      <button class="tabbit-full-summary-btn" id="tabbit-full-btn">
        <span class="tabbit-btn-icon">🔍</span>
        <span>全面分析</span>
      </button>
      <div class="tabbit-full-section" id="tabbit-full-section"></div>
    `;

    const manualFetchBtn = contentDiv.querySelector('#tabbit-manual-fetch-btn');
    if (manualFetchBtn) {
      manualFetchBtn.addEventListener('click', () => manualFetchSubtitle(panel, videoInfo));
    }

    // 🆕 手动上传字幕按钮
    const manualUploadBtn = contentDiv.querySelector('#tabbit-manual-upload-btn');
    if (manualUploadBtn) {
      manualUploadBtn.addEventListener('click', () => openManualUploadDialog(panel, videoInfo));
    }

    const commentBtn = contentDiv.querySelector('#tabbit-comment-btn');
    if (commentBtn) {
      commentBtn.addEventListener('click', () => runCommentSummary(panel, videoInfo));
    }

    const danmakuBtn = contentDiv.querySelector('#tabbit-danmaku-btn');
    if (danmakuBtn) {
      danmakuBtn.addEventListener('click', () => runDanmakuSummary(panel, videoInfo));
    }

    const fullBtn = contentDiv.querySelector('#tabbit-full-btn');
    if (fullBtn) {
      fullBtn.addEventListener('click', () => runFullAnalysis(panel, videoInfo));
    }

    input.disabled = true;
    sendBtn.disabled = true;
    input.placeholder = '无字幕，无法基于视频内容对话';
  }

  // ==================== 手动获取字幕 ====================
  function setFetchBtnState(btn, text, icon, resetAfterMs) {
    if (!btn) return;
    const spanEl = btn.querySelector('span:last-child');
    const iconEl = btn.querySelector('span:first-child');
    if (spanEl) spanEl.textContent = text;
    if (iconEl) iconEl.textContent = icon;
    if (resetAfterMs) {
      setTimeout(() => {
        if (spanEl) spanEl.textContent = '手动获取字幕总结';
        if (iconEl) iconEl.textContent = '🔄';
        btn.disabled = false;
      }, resetAfterMs);
    }
  }
  // ==================== 手动上传字幕 ====================
  // 解析 SRT 字幕文件，提取纯文本
  function parseSrtContent(srtText) {
    if (!srtText) return '';
    const lines = srtText.split(/\r?\n/);
    const textLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // 跳过纯数字行（序号）
      if (/^\d+$/.test(line)) continue;
      // 跳过时间轴行 00:00:00,000 --> 00:00:00,000
      if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(line)) continue;
      // 移除 HTML 标签（如 <i>、<b>、<font>）
      const cleaned = line.replace(/<[^>]+>/g, '').trim();
      if (cleaned) textLines.push(cleaned);
    }
    return textLines.join('\n');
  }

  // 智能解析上传的内容：自动判断是 SRT 还是普通文本
  function parseUploadedContent(rawText, filename) {
    if (!rawText) return '';
    const isSrt = (filename && /\.srt$/i.test(filename)) ||
                  /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(rawText);
    if (isSrt) {
      console.log('[省流助手-手动上传] 识别为 SRT 格式，开始解析');
      return parseSrtContent(rawText);
    }
    console.log('[省流助手-手动上传] 识别为纯文本格式');
    return rawText.trim();
  }

  // 打开手动上传字幕对话框
  function openManualUploadDialog(panel, videoInfo) {
    const oldOverlay = document.querySelector('#tabbit-upload-overlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tabbit-upload-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

    overlay.innerHTML = `
      <div style="background:white;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,0.2);width:520px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;font-weight:600;font-size:16px;">
          <span>📤 手动上传字幕</span>
          <button id="tabbit-upload-close" style="background:none;border:none;color:white;font-size:24px;cursor:pointer;opacity:0.85;line-height:1;padding:0 4px;">&times;</button>
        </div>
        <div style="padding:20px;overflow-y:auto;flex:1;">
          <div style="background:#e8f4f8;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12.5px;color:#555;line-height:1.6;">
            💡 支持 <strong>.srt</strong> / <strong>.txt</strong> 文件上传，或直接在下方文本框粘贴字幕内容。<br>
            推荐👉【<a href="https://meetings.feishu.cn/minutes/recommend-invite?vcInviteCode=ABDEUNHHT" style="color:#ff4444; font-weight:bold; text-decoration:none;">🔗飞书妙记</a>】视频转文字，每月300分钟免费转写时长。
          </div>

          <div style="margin-bottom:14px;">
            <div style="font-size:12px;font-weight:600;color:#666;margin-bottom:6px;letter-spacing:0.4px;text-transform:uppercase;">📁 上传文件</div>
            <input type="file" id="tabbit-upload-file" accept=".srt,.txt,text/plain" style="width:100%;padding:8px;border:1px dashed #aaa;border-radius:8px;font-size:13px;cursor:pointer;background:#fafbfc;" />
          </div>

          <div style="text-align:center;margin:10px 0;color:#999;font-size:12px;">— 或 —</div>

          <div>
            <div style="font-size:12px;font-weight:600;color:#666;margin-bottom:6px;letter-spacing:0.4px;text-transform:uppercase;">📝 直接粘贴文本</div>
            <textarea id="tabbit-upload-text" placeholder="在此粘贴字幕文本（SRT 格式或纯文本均可）..." style="width:100%;padding:10px 12px;border:1px solid #d8d8e0;border-radius:8px;font-size:12.5px;font-family:Consolas,Monaco,monospace;outline:none;box-sizing:border-box;resize:vertical;min-height:180px;line-height:1.6;color:#333;"></textarea>
            <div style="font-size:11px;color:#aaa;margin-top:4px;" id="tabbit-upload-hint">字符数：0</div>
          </div>
        </div>
        <div style="padding:14px 20px;background:#f8f9fa;border-top:1px solid #e8e8ef;display:flex;gap:8px;align-items:center;">
          <span style="flex:1;font-size:11px;color:#999;">📌 文件上传后会自动填充到文本框</span>
          <button id="tabbit-upload-cancel" style="padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #ddd;background:#f0f0f5;color:#555;">取消</button>
          <button id="tabbit-upload-confirm" style="padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;">✅ 确认并总结</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fileInput = overlay.querySelector('#tabbit-upload-file');
    const textArea = overlay.querySelector('#tabbit-upload-text');
    const hintEl = overlay.querySelector('#tabbit-upload-hint');
    let uploadedFilename = '';

    function updateHint() {
      hintEl.textContent = '字符数：' + textArea.value.length;
    }
    textArea.addEventListener('input', updateHint);

    fileInput.addEventListener('change', function() {
      const file = fileInput.files[0];
      if (!file) return;
      uploadedFilename = file.name;
      const reader = new FileReader();
      reader.onload = function(e) {
        textArea.value = e.target.result || '';
        updateHint();
        console.log('[省流助手-手动上传] 文件已读取:', file.name, '大小:', file.size, 'bytes');
      };
      reader.onerror = function() {
        alert('文件读取失败');
      };
      reader.readAsText(file, 'utf-8');
    });

    function closeDialog() { overlay.remove(); }
    overlay.querySelector('#tabbit-upload-close').addEventListener('click', closeDialog);
    overlay.querySelector('#tabbit-upload-cancel').addEventListener('click', closeDialog);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDialog();
    });

    overlay.querySelector('#tabbit-upload-confirm').addEventListener('click', async function() {
      const rawText = textArea.value.trim();
      if (!rawText) {
        alert('请先上传文件或粘贴字幕内容');
        return;
      }
      const transcript = parseUploadedContent(rawText, uploadedFilename);
      if (!transcript || !transcript.trim()) {
        alert('解析后内容为空，请检查字幕格式');
        return;
      }
      console.log('[省流助手-手动上传] 解析完成，文本长度:', transcript.length);
      closeDialog();

      // ✅ 走与自动获取字幕完全一致的后续流程
      rawTranscript = transcript;
      const freshVideoInfo = getVideoInfo();
      if (freshVideoInfo.bvid) {
        videoInfo = freshVideoInfo;
        currentVideoInfo = videoInfo;
      }
      panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
      await runSummary(panel, transcript, videoInfo);
    });
  }
  async function manualFetchSubtitle(panel, videoInfo) {
    console.log('[省流助手] 手动获取字幕...');
    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const fetchBtn = contentDiv.querySelector('#tabbit-manual-fetch-btn');

    const freshVideoInfo = getVideoInfo();
    if (freshVideoInfo.bvid) {
      videoInfo = freshVideoInfo;
      currentVideoInfo = videoInfo;
    }

    if (!videoInfo.cid || !videoInfo.bvid) {
      console.log('[省流助手] 手动获取：缺少 cid 或 bvid');
      setFetchBtnState(fetchBtn, '❌ 无法获取视频信息，请刷新页面重试', '❌', 3000);
      return;
    }

    if (fetchBtn) {
      fetchBtn.disabled = true;
      setFetchBtnState(fetchBtn, '正在获取字幕...', '⏳');
    }

    try {
      const subtitles = await fetchSubtitles(videoInfo.cid, videoInfo.bvid);

      if (subtitles.length === 0) {
        setFetchBtnState(fetchBtn, '仍未获取到字幕，请稍后再试', '😢', 3000);
        return;
      }

      const targetSubtitle = subtitles.find(s => s.lan === 'zh-CN' || s.lan === 'ai-zh') || subtitles[0];
      const content = await fetchSubtitleContent(targetSubtitle.subtitle_url);

      if (content.length === 0) {
        setFetchBtnState(fetchBtn, '字幕内容为空，请稍后再试', '😢', 3000);
        return;
      }

      rawSubtitleBody = content;
      const transcript = formatTranscript(content);
      if (!transcript.trim()) {
        setFetchBtnState(fetchBtn, '字幕文本为空，请稍后再试', '😢', 3000);
        return;
      }

      rawTranscript = transcript;
      console.log('[省流助手] 手动获取成功！');
      panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
      await runSummary(panel, transcript, videoInfo);

    } catch (err) {
      console.error('[省流助手] 手动获取字幕失败:', err);
      setFetchBtnState(fetchBtn, '获取失败: ' + err.message, '❌', 3000);
    }
  }

  function showError(contentDiv, msg) {
    const errDiv = document.createElement('div');
    errDiv.className = 'tabbit-error';
    errDiv.innerHTML = '<div class="tabbit-error-title">⚠️ 请求失败</div><div>' + escapeHtml(msg) + '</div>';
    const resultContainer = contentDiv.querySelector('.tabbit-result');
    if (resultContainer) {
      resultContainer.innerHTML = '';
      resultContainer.appendChild(errDiv);
    } else {
      contentDiv.innerHTML = '';
      contentDiv.appendChild(errDiv);
    }
  }

  // ==================== AI 调用 ====================
  // 兼容旧逻辑：非流式
  async function callAI(messages) {
    if (!CONFIG.apiUrl || !CONFIG.apiKey || !currentModel) {
      throw new Error('请点击右上角 ⚙️ 设置按钮，填写 apiUrl、apiKey 和 model');
    }
    const chatApiUrl = buildChatCompletionsUrl(CONFIG.apiUrl);
    const res = await fetch(chatApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.apiKey
      },
      body: JSON.stringify({
        model: currentModel,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('API 错误: ' + res.status + ' ' + errText);
    }
    const data = await res.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('API响应格式异常');
    }
    return data.choices[0].message.content;
  }

  /**
   * 🆕 流式 AI 调用（真正支持 AbortSignal 打断）
   * @param {Array} messages - 消息列表
   * @param {Function} onDelta - 每收到一段时回调，参数 (fullText, deltaText)
   * @param {Object} options - { apiUrl, apiKey, model, signal, temperature, maxTokens, errorMessageOverride } 自定义参数（可选）
   * @returns {Promise<string>} 完整文本
   */
  async function callAIStream(messages, onDelta, options) {
    options = options || {};
    const apiUrl = buildChatCompletionsUrl(options.apiUrl || CONFIG.apiUrl);
    const apiKey = options.apiKey || CONFIG.apiKey;
    const model = options.model || currentModel;
    const signal = options.signal; // 🆕 AbortSignal
    const temperature = options.temperature !== undefined ? options.temperature : 0.7;
    const maxTokens = options.maxTokens || 2000;
    const lengthErrorMessage = options.errorMessageOverride || HTML_PPT_LENGTH_ERROR_MESSAGE;

    if (!apiUrl || !apiKey || !model) {
      throw new Error('请点击右上角 ⚙️ 设置按钮，填写 apiUrl、apiKey 和 model');
    }

    let res;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: temperature,
          max_tokens: maxTokens,
          stream: true
        }),
        signal: signal // 🆕 关键！把 AbortSignal 传给 fetch
      });
    } catch (netErr) {
      // 🆕 区分用户主动打断和真实网络错误
      if (isAbortError(netErr)) {
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      throw new Error('网络请求失败: ' + netErr.message);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('API 错误: ' + res.status + ' ' + errText);
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/event-stream')) {
      console.warn('[省流助手-流式] API 不支持 stream，降级为一次性返回');
      const data = await res.json();
      const fullText = data.choices?.[0]?.message?.content || '';
      if (data.choices?.[0]?.finish_reason === 'length') {
        const lengthErr = new Error(lengthErrorMessage);
        lengthErr.name = 'LengthFinishError';
        throw lengthErr;
      }
      if (typeof onDelta === 'function' && fullText) {
        try { onDelta(fullText, fullText); } catch (e) {}
      }
      return fullText;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';
    let userAborted = false;
    let finishReason = '';

    // 🆕 监听 signal abort，立即取消 reader
    const onAbortSignal = function() {
      userAborted = true;
      try { reader.cancel(); } catch(e) {}
    };
    if (signal) {
      if (signal.aborted) {
        onAbortSignal();
      } else {
        signal.addEventListener('abort', onAbortSignal);
      }
    }

    try {
      while (true) {
        // 🆕 每轮循环检查打断状态
        if (signal && signal.aborted) {
          userAborted = true;
          try { reader.cancel(); } catch(e) {}
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const json = JSON.parse(dataStr);
            if (json.choices?.[0]?.finish_reason) {
              finishReason = json.choices[0].finish_reason;
            }
            const delta = json.choices?.[0]?.delta?.content
                       || json.choices?.[0]?.message?.content
                       || '';
            if (delta) {
              fullText += delta;
              if (typeof onDelta === 'function') {
                try { onDelta(fullText, delta); } catch (e) {}
              }
            }
          } catch (e) {}
        }
      }
    } catch (streamErr) {
      // 🆕 区分用户打断
      if (isAbortError(streamErr)) {
        userAborted = true;
      } else if (!fullText) {
        if (typeof onDelta === 'function' && typeof onDelta.cancel === 'function') {
          onDelta.cancel();
        }
        if (signal) signal.removeEventListener('abort', onAbortSignal);
        throw new Error('流式读取失败: ' + streamErr.message);
      } else {
        console.warn('[省流助手-流式] 流中断，使用已收到内容:', streamErr.message);
      }
    }

    // 🆕 移除 signal 监听
    if (signal) signal.removeEventListener('abort', onAbortSignal);

    if (typeof onDelta === 'function' && typeof onDelta.cancel === 'function') {
      onDelta.cancel();
    }

    // 🆕 如果是用户主动打断
    if (userAborted) {
      if (fullText.trim()) {
        return fullText + '\n\n_⏹ 已被用户打断_';
      } else {
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
    }

    if (!fullText.trim()) {
      throw new Error('AI 未返回任何内容');
    }
    if (finishReason === 'length') {
      const lengthErr = new Error(lengthErrorMessage);
      lengthErr.name = 'LengthFinishError';
      throw lengthErr;
    }
    return fullText;
  }

  /**
   * 🆕 创建一个节流回调，包装原始 onDelta，避免高频重绘
   * 返回的函数带有 .cancel() 方法，可在流式结束后取消未触发的延迟回调，
   * 防止延迟回调覆盖最终的 markdown 渲染（重要！）
   */
  function createThrottledDelta(onDelta, intervalMs) {
    intervalMs = intervalMs || STREAM_RENDER_THROTTLE;
    let lastCall = 0;
    let pendingFull = null;
    let timer = null;
    const throttled = function(fullText, delta) {
      pendingFull = fullText;
      const now = Date.now();
      if (now - lastCall >= intervalMs) {
        lastCall = now;
        if (timer) { clearTimeout(timer); timer = null; }
        try { onDelta(pendingFull, delta); } catch (e) {}
      } else if (!timer) {
        const wait = intervalMs - (now - lastCall);
        timer = setTimeout(function() {
          timer = null;
          lastCall = Date.now();
          try { onDelta(pendingFull, ''); } catch (e) {}
        }, wait);
      }
    };
    // 🆕 取消挂起的延迟回调（流式结束后调用）
    throttled.cancel = function() {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    return throttled;
  }

  // 🆕 生图模式 - 第1步：流式获取文字总结
  async function generateSummaryText(prompt, onDelta) {
    const summaryApiUrl = CONFIG.apiUrl;
    const summaryApiKey = CONFIG.apiKey;
    const summaryModel = currentModel;
    console.log('[省流助手-生图] 第1步：用默认模型', summaryModel, '流式获取文字总结...');
    const textContent = await callAIStream(
      [{ role: 'user', content: prompt }],
      onDelta,
      buildSummaryStreamOptions(null, { apiUrl: summaryApiUrl, apiKey: summaryApiKey, model: summaryModel })
    );
    console.log('[省流助手-生图] 文字总结完成，长度:', textContent.length);
    if (!textContent.trim()) {
      throw new Error('生图模型未返回文字总结内容');
    }
    return textContent;
  }

  // 🆕 生图模式 - 第2步：根据已有的总结文字生成配图
  async function generateImageFromSummary(textContent, signal) {
    const apiUrl = CONFIG.imageGenApiUrl || CONFIG.apiUrl;
    const apiKey = CONFIG.imageGenApiKey || CONFIG.apiKey;
    const model = CONFIG.imageGenModel || 'gemini-2.0-flash-preview-image-generation';

    if (!apiUrl || !apiKey) {
      throw new Error('请在设置中配置生图模型的 API URL 和 API Key');
    }

    const imagePrompt = buildImagePrompt(textContent || '');
    return await generateImageByApi(apiUrl, apiKey, model, imagePrompt, signal);
  }

  function isImageGenEnabled() {
    return CONFIG.enableImageGen === true;
  }

  function createImageActionRow(imageDataUrl, videoInfo, filenameSuffix) {
    const row = document.createElement('div');
    row.className = 'tabbit-img-actions';
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px;';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'tabbit-copy-btn tabbit-save-img-btn';
    saveBtn.textContent = '💾 保存图片';
    saveBtn.addEventListener('click', function() {
      downloadGeneratedImage(imageDataUrl, videoInfo, filenameSuffix || '_总结');
    });
    row.appendChild(saveBtn);

    const commentTextBtn = document.createElement('button');
    commentTextBtn.className = 'tabbit-copy-btn tabbit-comment-text-btn';
    commentTextBtn.textContent = '💬 填字并点上传';
    commentTextBtn.title = '随机填入一条评论预设，并尝试点开B站评论区图片上传按钮';
    commentTextBtn.addEventListener('click', function() {
      fillBiliCommentTextOnly(commentTextBtn);
    });
    row.appendChild(commentTextBtn);

    return row;
  }

  function showImageResult(contentDiv, textContent, imageDataUrl, _url, videoInfo) {
    setCurrentSummaryText(contentDiv, textContent || '（生图模式 - 图片总结）');
    const resultContainer = contentDiv.querySelector('.tabbit-result');
    const imageSlot = contentDiv.querySelector('.tabbit-image-slot') || resultContainer;
    if (imageSlot) {
      let imageHtml = '';
      if (imageDataUrl && imageDataUrl !== 'ERROR') {
        imageHtml += '<div class="tabbit-img-wrap" style="text-align:center;margin-bottom:12px;">';
        imageHtml += '<img src="' + escapeAttr(imageDataUrl) + '" style="max-width:100%;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);cursor:pointer;" title="点击查看大图" />';
        imageHtml += '</div>';
      } else if (imageDataUrl === 'ERROR') {
        imageHtml += '<div class="tabbit-img-wrap" style="text-align:center;margin-bottom:12px;padding:14px;background:#fff3f3;border:1px solid #ffcccc;border-radius:10px;color:#c00;font-size:13px;">⚠️ 配图生成失败，仅显示文字总结</div>';
      } else {
        imageHtml += '<div class="tabbit-img-wrap tabbit-img-loading" style="text-align:center;margin-bottom:12px;padding:30px 14px;background:linear-gradient(135deg,#f0f4ff 0%,#fff5f8 100%);border:1px dashed #c5d3ff;border-radius:10px;">';
        imageHtml += '<div class="tabbit-spinner" style="margin:0 auto 10px;"></div>';
        imageHtml += '<div style="font-size:13px;color:#667eea;font-weight:600;">🖼️ 配图生成中，请稍候...</div>';
        imageHtml += '<div style="font-size:11px;color:#999;margin-top:4px;">文字总结已就绪，可先阅读</div>';
        imageHtml += '</div>';
      }
      imageSlot.innerHTML = imageHtml;
    }
    if (resultContainer) {
      let html = '';
      if (textContent && textContent.trim()) {
        html += '<div class="tabbit-text-wrap">' + parseMarkdown(textContent) + '</div>';
      }
      if (!imageDataUrl && !textContent) {
        html += '<div style="color:#999;text-align:center;padding:20px;">⚠️ 生图模型未返回图片或文字内容</div>';
      }
      resultContainer.innerHTML = html;

      const img = imageSlot ? imageSlot.querySelector('img') : null;
      if (img && imageDataUrl && imageDataUrl !== 'ERROR') {
        img.addEventListener('click', function() {
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:fadeIn 0.2s ease;';
          const bigImg = document.createElement('img');
          bigImg.src = imageDataUrl;
          bigImg.style.cssText = 'max-width:95vw;max-height:95vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.3);';
          overlay.appendChild(bigImg);
          overlay.addEventListener('click', function() { overlay.remove(); });
          document.body.appendChild(overlay);
        });
        const wrap = img.closest('.tabbit-img-wrap');
        if (wrap && !wrap.querySelector('.tabbit-img-actions')) {
          wrap.appendChild(createImageActionRow(imageDataUrl, videoInfo, '_总结'));
        }
      }
    }

    const actionsDiv = contentDiv.querySelector('.tabbit-result-actions');
    if (actionsDiv) {
      actionsDiv.innerHTML = '';
      if (textContent && textContent.trim()) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'tabbit-copy-btn';
        copyBtn.textContent = '📋 复制文字';
        copyBtn.addEventListener('click', function() {
          copyToClipboard(markdownToPlainText(getCurrentSummaryText(contentDiv, textContent)));
          copyBtn.textContent = '✅ 已复制';
          setTimeout(function() { copyBtn.textContent = '📋 复制文字'; }, 2000);
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'tabbit-copy-btn';
        editBtn.textContent = '✏️ 编辑摘要';
        editBtn.addEventListener('click', function() { startSummaryEdit(contentDiv, textContent); });

        const htmlPptBtn = document.createElement('button');
        htmlPptBtn.className = 'tabbit-copy-btn';
        htmlPptBtn.textContent = '📊 HTML PPT';
        htmlPptBtn.addEventListener('click', function() {
          triggerHtmlPptGen(contentDiv, getCurrentSummaryText(contentDiv, textContent), videoInfo, htmlPptBtn);
        });
        const genImgBtn = document.createElement('button');
        genImgBtn.className = 'tabbit-copy-btn';
        genImgBtn.textContent = isFlowImageGenMode() ? '发送到 Flow' : (imageDataUrl && imageDataUrl !== 'ERROR' ? '🔁 重新生成配图' : '🖼️ 生成配图');
        genImgBtn.addEventListener('click', function() {
          triggerManualImageGen(contentDiv, getCurrentSummaryText(contentDiv, textContent), videoInfo, genImgBtn);
        });

        const copyImagePromptBtn = document.createElement('button');
        copyImagePromptBtn.className = 'tabbit-copy-btn';
        copyImagePromptBtn.textContent = '复制 生图提示词';
        copyImagePromptBtn.title = '一键复制生图提示词+摘要到剪贴板，粘贴到任意AI生图';
        copyImagePromptBtn.addEventListener('click', function() {
          const copyText = buildImagePrompt(getCurrentSummaryText(contentDiv, textContent));
          copyToClipboard(copyText);
          copyImagePromptBtn.textContent = '✅ 已复制';
          setTimeout(function() { copyImagePromptBtn.textContent = '复制 生图提示词'; }, 2000);
        });

        const commentPostBtn = document.createElement('button');
        commentPostBtn.className = 'tabbit-copy-btn';
        commentPostBtn.textContent = '📋 摘要发评论';
        commentPostBtn.title = '一键将摘要插入B站评论框';
        commentPostBtn.addEventListener('click', function() { fillBiliCommentSummary(commentPostBtn); });

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(genImgBtn);
        actionsDiv.appendChild(copyImagePromptBtn);
        actionsDiv.appendChild(commentPostBtn);
        actionsDiv.appendChild(htmlPptBtn);

        const flomoBtn = document.createElement('button');
        flomoBtn.className = 'tabbit-copy-btn';
        flomoBtn.textContent = '发送 FLOMO';
        flomoBtn.addEventListener('click', function() {
          sendToFlomo(getCurrentSummaryText(contentDiv, textContent), this);
        });
        actionsDiv.appendChild(flomoBtn);
      }
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'tabbit-download-btn';
      downloadBtn.textContent = '💾 下载字幕';
      downloadBtn.addEventListener('click', function() {
        downloadTranscript(rawTranscript, videoInfo.title, videoInfo.upName, videoInfo.bvid);
      });
      const modelTag = document.createElement('span');
      modelTag.style.cssText = 'font-size:11px;color:#999;margin-left:auto;';
      modelTag.textContent = '🖼️ ' + (CONFIG.imageGenModel || 'gemini-2.0-flash-preview-image-generation');
      actionsDiv.appendChild(downloadBtn);
      const editStatus = document.createElement('span');
      editStatus.className = 'tabbit-summary-edit-status';
      actionsDiv.appendChild(editStatus);
      actionsDiv.appendChild(modelTag);
    }
  }

  function updateImageResult(contentDiv, imageDataUrl, videoInfo) {
    const imageSlot = contentDiv.querySelector('.tabbit-image-slot') || contentDiv.querySelector('.tabbit-result');
    if (!imageSlot) return;
    const wrap = imageSlot.querySelector('.tabbit-img-wrap');
    if (!wrap) return;

    if (!imageDataUrl || imageDataUrl === 'ERROR') {
      wrap.outerHTML = '<div class="tabbit-img-wrap" style="text-align:center;margin-bottom:12px;padding:14px;background:#fff3f3;border:1px solid #ffcccc;border-radius:10px;color:#c00;font-size:13px;">⚠️ 配图生成失败，仅显示文字总结</div>';
      return;
    }

    wrap.classList.remove('tabbit-img-loading');
    wrap.removeAttribute('style');
    wrap.style.cssText = 'text-align:center;margin-bottom:12px;animation:fadeIn 0.4s ease;';
    wrap.innerHTML = '<img src="' + escapeAttr(imageDataUrl) + '" style="max-width:100%;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);cursor:pointer;" title="点击查看大图" />';

    const img = wrap.querySelector('img');
    if (img) {
      img.addEventListener('click', function() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:fadeIn 0.2s ease;';
        const bigImg = document.createElement('img');
        bigImg.src = imageDataUrl;
        bigImg.style.cssText = 'max-width:95vw;max-height:95vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.3);';
        overlay.appendChild(bigImg);
        overlay.addEventListener('click', function() { overlay.remove(); });
        document.body.appendChild(overlay);
      });
    }

    if (!wrap.querySelector('.tabbit-img-actions')) {
      wrap.appendChild(createImageActionRow(imageDataUrl, videoInfo, '_总结'));

      if (CONFIG.enableImageAutoDownload !== false) {
        setTimeout(function() {
          try { downloadGeneratedImage(imageDataUrl, videoInfo, '_总结'); } catch(e) { console.warn('[省流助手] 自动下载失败', e); }
        }, 0);
      }
    }
  }

  // ==================== 自动获取模型列表 ====================
  function deriveModelsUrl(apiUrl) {
    return buildApiUrl(apiUrl, 'models');
  }

  async function fetchModelList(apiUrl, apiKey) {
    if (!apiUrl || !apiKey) {
      throw new Error('请先填写 API URL 和 API Key');
    }
    const modelsUrl = deriveModelsUrl(apiUrl);
    console.log('[省流助手] 获取模型列表:', modelsUrl);
    const res = await fetchWithTimeout(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      }
    }, AUX_REQUEST_TIMEOUT_MS);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 200));
    }
    const data = await res.json();
    let models = [];
    if (Array.isArray(data?.data)) {
      models = data.data.map(m => m.id || m.model || m.name).filter(Boolean);
    } else if (Array.isArray(data?.models)) {
      models = data.models.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
    } else if (Array.isArray(data)) {
      models = data.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
    }
    if (models.length === 0) {
      throw new Error('未解析到任何模型，响应: ' + JSON.stringify(data).slice(0, 200));
    }
    return models;
  }

  // ==================== 摘要主流程 ====================
  function getCurrentPresetId() {
    const presets = CONFIG.promptPresets || [];
    if (presets.some(p => p.id === currentPresetId)) return currentPresetId;
    if (presets.some(p => p.id === CONFIG.activePresetId)) {
      currentPresetId = CONFIG.activePresetId;
      return currentPresetId;
    }
    currentPresetId = presets[0]?.id || 'preset_default';
    return currentPresetId;
  }

  function renderPresetBarHtml() {
    const presets = CONFIG.promptPresets || [];
    if (presets.length === 0) return '';
    const activePresetId = getCurrentPresetId();
    const chips = presets.map(p => {
      const isActive = p.id === activePresetId;
      return '<div class="tabbit-preset-chip' + (isActive ? ' active' : '') + '" data-preset-id="' + escapeHtml(p.id) + '" title="' + escapeHtml(p.prompt.slice(0, 100)) + '...">' +
        '<span class="tabbit-preset-icon">' + escapeHtml(p.icon || '📄') + '</span>' +
        '<span>' + escapeHtml(p.name) + '</span>' +
        '</div>';
    }).join('');
    return `
      <div class="tabbit-preset-bar">
        <div class="tabbit-preset-bar-title">🎨 总结风格（点击切换重新分析）</div>
        <div class="tabbit-preset-list">${chips}</div>
      </div>
    `;
  }

  function bindPresetChips(panel, videoInfo) {
    panel.querySelectorAll('.tabbit-preset-chip').forEach(chip => {
      chip.addEventListener('click', async function() {
        if (chip.classList.contains('disabled')) return;
        const newId = chip.dataset.presetId;
        const preset = (CONFIG.promptPresets || []).find(p => p.id === newId);
        if (!preset) return;
        if (newId === getCurrentPresetId()) return;
        currentPresetId = newId;
        panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        conversationHistory = [];
        commentConversationHistory = [];
        rawDanmakuChatContext = '';
        rawCommentsChatContext = '';
        rawFullDataChatContext = '';
        if (rawTranscript) {
          await runSummary(panel, rawTranscript, videoInfo || currentVideoInfo);
        } else if (videoInfo || currentVideoInfo) {
          showNoSubtitleState(panel, videoInfo || currentVideoInfo);
        }
      });
    });
  }

  function bindCommentButton(contentDiv, panel, videoInfo, enabled) {
    const oldBtn = contentDiv.querySelector('#tabbit-comment-btn');
    if (!oldBtn) return null;
    const btn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(btn, oldBtn);
    btn.disabled = !enabled;
    btn.addEventListener('click', () => runCommentSummary(panel, videoInfo));
    return btn;
  }

  function bindDanmakuButton(contentDiv, panel, videoInfo, enabled) {
    const oldBtn = contentDiv.querySelector('#tabbit-danmaku-btn');
    if (!oldBtn) return null;
    const btn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(btn, oldBtn);
    btn.disabled = !enabled;
    btn.addEventListener('click', () => runDanmakuSummary(panel, videoInfo));
    return btn;
  }

  function bindFullAnalysisButton(contentDiv, panel, videoInfo, enabled) {
    const oldBtn = contentDiv.querySelector('#tabbit-full-btn');
    if (!oldBtn) return null;
    const btn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(btn, oldBtn);
    btn.disabled = !enabled;
    btn.addEventListener('click', () => runFullAnalysis(panel, videoInfo));
    return btn;
  }

  function renderSummaryShell(panel, contentDiv, presetBarHtml, videoInfo, pageUrl) {
    const hasShell = contentDiv.querySelector('.tabbit-result')
      && contentDiv.querySelector('.tabbit-result-actions')
      && contentDiv.querySelector('#tabbit-comment-btn')
      && contentDiv.querySelector('#tabbit-danmaku-btn')
      && contentDiv.querySelector('#tabbit-full-btn')
      && contentDiv.querySelector('.tabbit-chat-messages');

    if (hasShell) {
      const oldPresetBar = contentDiv.querySelector('.tabbit-preset-bar');
      if (oldPresetBar) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = presetBarHtml;
        const newPresetBar = wrapper.firstElementChild;
        if (newPresetBar) oldPresetBar.replaceWith(newPresetBar);
      } else {
        const danmakuBtnEl = contentDiv.querySelector('#tabbit-danmaku-btn');
        if (danmakuBtnEl) {
          danmakuBtnEl.insertAdjacentHTML('beforebegin', presetBarHtml);
        } else {
          const commentBtnEl = contentDiv.querySelector('#tabbit-comment-btn');
          if (commentBtnEl) {
            commentBtnEl.insertAdjacentHTML('beforebegin', presetBarHtml);
          } else {
            contentDiv.insertAdjacentHTML('beforeend', presetBarHtml);
          }
        }
      }

      const resultContainer = contentDiv.querySelector('.tabbit-result');
      resultContainer.innerHTML = '<span class="tabbit-typing-cursor"></span>';
      let imageSlot = contentDiv.querySelector('.tabbit-image-slot');
      if (!imageSlot) {
        resultContainer.insertAdjacentHTML('beforebegin', '<div class="tabbit-image-slot"></div>');
        imageSlot = contentDiv.querySelector('.tabbit-image-slot');
      }
      imageSlot.innerHTML = '';
      const oldPptSlot = contentDiv.querySelector('.tabbit-ppt-slot');
      if (oldPptSlot) oldPptSlot.remove();
      contentDiv.querySelector('.tabbit-result-actions').innerHTML = '';
      contentDiv.querySelector('.tabbit-chat-messages').innerHTML = '';

      const oldDanmakuSection = contentDiv.querySelector('#tabbit-danmaku-section');
      if (oldDanmakuSection) oldDanmakuSection.innerHTML = '';

      const oldFullSection = contentDiv.querySelector('#tabbit-full-section');
      if (oldFullSection) oldFullSection.innerHTML = '';

      const oldMeta = contentDiv.querySelector('.tabbit-video-info-bottom');
      const metaHtml = renderVideoMetaBottomHtml(videoInfo, pageUrl);
      if (oldMeta) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = metaHtml;
        const newMeta = wrapper.firstElementChild;
        if (newMeta) oldMeta.replaceWith(newMeta);
      } else {
        contentDiv.insertAdjacentHTML('afterbegin', metaHtml);
      }

      const commentBtn = contentDiv.querySelector('#tabbit-comment-btn');
      commentBtn.disabled = true;
      const danmakuBtn = contentDiv.querySelector('#tabbit-danmaku-btn');
      if (danmakuBtn) danmakuBtn.disabled = true;
      const fullBtn = contentDiv.querySelector('#tabbit-full-btn');
      if (fullBtn) fullBtn.disabled = true;
    } else {
      contentDiv.innerHTML = `
        ${renderVideoMetaBottomHtml(videoInfo, pageUrl)}
        <div class="tabbit-image-slot"></div>
        <div class="tabbit-result"><span class="tabbit-typing-cursor"></span></div>
        <div class="tabbit-result-actions"></div>
        ${presetBarHtml}
        <button class="tabbit-danmaku-summary-btn" id="tabbit-danmaku-btn" disabled>
          <span class="tabbit-btn-icon">📡</span>
          <span>弹幕分析</span>
        </button>
        <div class="tabbit-danmaku-section" id="tabbit-danmaku-section"></div>
        <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn" disabled>
          <span class="tabbit-btn-icon">💬</span>
          <span>总结评论区</span>
        </button>
        <div class="tabbit-comment-section" id="tabbit-comment-section"></div>
        <button class="tabbit-full-summary-btn" id="tabbit-full-btn" disabled>
          <span class="tabbit-btn-icon">🔍</span>
          <span>全面分析</span>
        </button>
        <div class="tabbit-full-section" id="tabbit-full-section"></div>
        <div class="tabbit-chat-messages"></div>
      `;
    }

    bindPresetChips(panel, videoInfo);
    bindCommentButton(contentDiv, panel, videoInfo, false);
    bindDanmakuButton(contentDiv, panel, videoInfo, false);
    bindFullAnalysisButton(contentDiv, panel, videoInfo, false);
  }

  function setSummaryReady(panel, contentDiv, videoInfo) {
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');
    if (input) {
      input.disabled = false;
      input.placeholder = '基于视频内容继续提问...';
    }
    if (sendBtn) sendBtn.disabled = false;
    bindCommentButton(contentDiv, panel, videoInfo, true);
    bindDanmakuButton(contentDiv, panel, videoInfo, true);
    bindFullAnalysisButton(contentDiv, panel, videoInfo, true);
    panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
    panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('disabled'));
  }

  function startAsyncImageGeneration(contentDiv, textContent, videoInfo) {
    if (isFlowImageGenMode()) {
      triggerFlowImageGen(contentDiv, textContent, videoInfo, null);
      return;
    }

    const imageSeq = nextImageGenerationSeq(contentDiv);
    const imgWrap = contentDiv.querySelector('.tabbit-image-slot .tabbit-img-wrap.tabbit-img-loading') || contentDiv.querySelector('.tabbit-img-wrap.tabbit-img-loading');
    let imgAbortBtnWrap = null;
    let imgAbortController = new AbortController();
    if (imgWrap) {
      imgAbortBtnWrap = document.createElement('div');
      imgAbortBtnWrap.style.cssText = 'text-align:center;margin-top:8px;';
      insertInlineAbortBtn(imgAbortBtnWrap, function() {
        try { imgAbortController.abort(); } catch(e) {}
        console.log('[省流助手-生图] 用户打断生图');
      });
      imgWrap.appendChild(imgAbortBtnWrap);
    }

    currentAbortController = imgAbortController;

    generateImageFromSummary(textContent, imgAbortController.signal)
      .then(function(imageDataUrl) {
        if (contentDiv._tabbitImageGenSeq !== imageSeq) {
          if (currentAbortController === imgAbortController) currentAbortController = null;
          return;
        }
        if (imgAbortBtnWrap && imgAbortBtnWrap.parentNode) imgAbortBtnWrap.remove();
        updateImageResult(contentDiv, imageDataUrl, videoInfo);
        if (currentAbortController === imgAbortController) currentAbortController = null;
      })
      .catch(function(imgErr) {
        if (contentDiv._tabbitImageGenSeq !== imageSeq) {
          if (currentAbortController === imgAbortController) currentAbortController = null;
          return;
        }
        if (imgAbortBtnWrap && imgAbortBtnWrap.parentNode) imgAbortBtnWrap.remove();
        if (isAbortError(imgErr)) {
          const wrap = contentDiv.querySelector('.tabbit-image-slot .tabbit-img-wrap') || contentDiv.querySelector('.tabbit-img-wrap');
          if (wrap) {
            wrap.outerHTML = '<div class="tabbit-img-wrap" style="text-align:center;margin-bottom:12px;padding:14px;background:#fff7e6;border:1px solid #ffd591;border-radius:10px;color:#b76d00;font-size:13px;">⏹ 生图已被用户打断</div>';
          }
        } else {
          console.warn('[省流助手-生图] 图片生成失败:', imgErr.message);
          updateImageResult(contentDiv, 'ERROR', videoInfo);
        }
        if (currentAbortController === imgAbortController) currentAbortController = null;
      });
  }

  /**
   * 🆕 流式版：初始总结（支持打断）
   */
  async function runSummary(panel, transcript, videoInfo) {
    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');

    panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.add('disabled'));
    panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.add('disabled'));
    input.disabled = true;
    sendBtn.disabled = true;

    const pageUrl = window.location.href;
    const activePresetId = getCurrentPresetId();
    const activePreset = (CONFIG.promptPresets || []).find(p => p.id === activePresetId);
    const activePrompt = (activePreset && activePreset.prompt) || CONFIG.promptText || PROMPT_TEXT;
    const videoDesc = limitText(videoInfo.desc || '', 1500);
    const fullPrompt = activePrompt
      + '\n\n视频URL: ' + pageUrl
      + '\n视频标题: ' + (videoInfo.title || '')
      + '\nUP主: ' + (videoInfo.upName || '')
      + (videoDesc ? '\n视频简介: ' + videoDesc : '')
      + '\n\n字幕内容:\n' + transcript;

    const presetBarHtml = renderPresetBarHtml();
    const useImageGen = isImageGenEnabled();
    const useHtmlPptDirect = CONFIG.enableHtmlPptDirect === true;
    const cacheKey = buildSummaryCacheKey(videoInfo, currentModel, activePresetId, activePrompt, transcript);

    renderSummaryShell(panel, contentDiv, presetBarHtml, videoInfo, pageUrl);
    contentDiv._tabbitSummaryCacheKey = cacheKey;
    contentDiv._tabbitSummaryPresetId = activePresetId;
    contentDiv._tabbitSummaryTitle = videoInfo.title;
    contentDiv._tabbitSummaryText = '';
    contentDiv._tabbitHtmlPptDirectPrompt = '';
    contentDiv._tabbitHtmlPptDirectFallback = '';

    // 🆕 v4.0 检测 API 配置：未配置或填错时显示兜底 UI（仍保留下载字幕+一键复制功能）
    var apiCheck = isApiConfigured();
    if (!apiCheck.configured) {
      console.log('[省流助手] API 未配置，显示兜底模式');
      showApiNotConfiguredFallback(contentDiv, videoInfo, apiCheck.reason);
      return;
    }

    if (useHtmlPptDirect) {
      abortCurrentTask();
      currentAbortController = new AbortController();
      const localController = currentAbortController;
      const resultContainer = contentDiv.querySelector('.tabbit-result');
      if (resultContainer) {
        resultContainer.innerHTML =
          '<div style="text-align:center;padding:18px;color:#667eea;">' +
            '<div class="tabbit-spinner" style="margin:0 auto 10px;"></div>' +
            '<div style="font-size:13px;font-weight:700;">HTML PPT 直出模式：正在从字幕生成...</div>' +
            '<div style="font-size:11px;color:#999;margin-top:4px;">本次不生成普通摘要</div>' +
          '</div>';
      }
      const actionsDiv = contentDiv.querySelector('.tabbit-result-actions');
      if (actionsDiv) {
        actionsDiv.innerHTML = '';
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'tabbit-download-btn';
        downloadBtn.textContent = '💾 下载字幕';
        downloadBtn.addEventListener('click', function() {
          downloadTranscript(rawTranscript, videoInfo.title, videoInfo.upName, videoInfo.bvid);
        });
        const modelTag = document.createElement('span');
        modelTag.style.cssText = 'font-size:11px;color:#999;margin-left:auto;';
        modelTag.textContent = '📊 ' + currentModel;
        actionsDiv.appendChild(downloadBtn);
        actionsDiv.appendChild(modelTag);
      }
      try {
        const directPrompt = buildHtmlPptTranscriptPrompt(transcript, videoInfo, activePrompt);
        contentDiv._tabbitHtmlPptDirectPrompt = directPrompt;
        contentDiv._tabbitHtmlPptDirectFallback = transcript;
        await generateHtmlPptFromPrompt(contentDiv, directPrompt, transcript, videoInfo, null, { signal: localController.signal });
        if (resultContainer) {
          resultContainer.innerHTML = '<div style="background:#f8f9fa;border-radius:8px;padding:14px;color:#555;text-align:center;">✅ HTML PPT 已生成。本模式跳过普通摘要；如需摘要，请关闭「字幕直出 HTML PPT」。</div>';
        }
        bindCommentButton(contentDiv, panel, videoInfo, true);
      } catch (err) {
        if (isAbortError(err)) {
          if (resultContainer) resultContainer.innerHTML = '<div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:14px;color:#b76d00;text-align:center;">⏹ 已被用户打断，未生成 HTML PPT</div>';
        } else {
          showError(contentDiv, err.message);
        }
      } finally {
        if (currentAbortController === localController) currentAbortController = null;
        input.disabled = true;
        sendBtn.disabled = true;
        bindCommentButton(contentDiv, panel, videoInfo, true);
        panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
        panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('disabled'));
      }
      return;
    }

    const cachedSummary = getCachedSummary(cacheKey);
    if (cachedSummary) {
      console.log('[省流助手] 命中摘要缓存，跳过文字总结请求');
      conversationHistory = [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: cachedSummary }
      ];
      if (useImageGen) {
        showImageResult(contentDiv, cachedSummary, '', pageUrl, videoInfo);
        setSummaryReady(panel, contentDiv, videoInfo);
        startAsyncImageGeneration(contentDiv, cachedSummary, videoInfo);
      } else {
        finalizeSummaryUI(contentDiv, cachedSummary, pageUrl, videoInfo);
        setSummaryReady(panel, contentDiv, videoInfo);
      }
      return;
    }

    // 🆕 创建 AbortController + 在 result 区域插入打断按钮
    abortCurrentTask();
    currentAbortController = new AbortController();
    const localController = currentAbortController;
    const resultContainerForBtn = contentDiv.querySelector('.tabbit-result');
    let abortBtn = null;
    if (resultContainerForBtn) {
      const abortBtnWrap = document.createElement('div');
      abortBtnWrap.style.cssText = 'text-align:center;';
      abortBtn = insertInlineAbortBtn(abortBtnWrap, function() {
        abortCurrentTask();
      });
      resultContainerForBtn.parentNode.insertBefore(abortBtnWrap, resultContainerForBtn.nextSibling);
      abortBtn._wrap = abortBtnWrap;
    }

    try {
      if (useImageGen) {
        const resultContainer = contentDiv.querySelector('.tabbit-result');
        const imageSlot = contentDiv.querySelector('.tabbit-image-slot');
        if (imageSlot) {
          imageSlot.innerHTML =
          '<div class="tabbit-img-wrap tabbit-img-loading" style="text-align:center;margin-bottom:12px;padding:30px 14px;background:linear-gradient(135deg,#f0f4ff 0%,#fff5f8 100%);border:1px dashed #c5d3ff;border-radius:10px;">' +
            '<div class="tabbit-spinner" style="margin:0 auto 10px;"></div>' +
            '<div style="font-size:13px;color:#667eea;font-weight:600;">🖼️ 配图生成中，请稍候...</div>' +
            '<div style="font-size:11px;color:#999;margin-top:4px;">文字总结正在流式输出</div>' +
          '</div>';
        }
        resultContainer.innerHTML = '<div class="tabbit-text-wrap"><span class="tabbit-typing-cursor"></span></div>';

        const textWrap = resultContainer.querySelector('.tabbit-text-wrap');

        const onDelta = createThrottledDelta(function(fullText) {
          textWrap.textContent = fullText;
          const cursor = document.createElement('span');
          cursor.className = 'tabbit-typing-cursor';
          textWrap.appendChild(cursor);
        });

        // 🆕 透传 signal 给文字总结
        const summaryApiUrl = CONFIG.apiUrl;
        const summaryApiKey = CONFIG.apiKey;
        const summaryModel = currentModel;
        const textContent = await callAIStream(
          [{ role: 'user', content: fullPrompt }],
          onDelta,
          buildSummaryStreamOptions(localController.signal, { apiUrl: summaryApiUrl, apiKey: summaryApiKey, model: summaryModel })
        );

        // 🆕 文字总结结束后，先清理"文字总结阶段"的打断按钮
        if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
          abortBtn._wrap.remove();
          abortBtn = null;
        }

        conversationHistory = [
          { role: 'user', content: fullPrompt },
          { role: 'assistant', content: textContent }
        ];
        setCachedSummary(cacheKey, {
          summary: textContent,
          model: currentModel,
          presetId: activePresetId,
          title: videoInfo.title
        });

        showImageResult(contentDiv, textContent, '', pageUrl, videoInfo);
        setSummaryReady(panel, contentDiv, videoInfo);

        startAsyncImageGeneration(contentDiv, textContent, videoInfo);

        return;
      } else {
        const resultContainer = contentDiv.querySelector('.tabbit-result');
        const messages = [{ role: 'user', content: fullPrompt }];

        const onDelta = createThrottledDelta(function(fullText) {
          resultContainer.textContent = fullText;
          const cursor = document.createElement('span');
          cursor.className = 'tabbit-typing-cursor';
          resultContainer.appendChild(cursor);
        });

        const reply = await callAIStream(messages, onDelta, buildSummaryStreamOptions(localController.signal));

        conversationHistory = [
          { role: 'user', content: fullPrompt },
          { role: 'assistant', content: reply }
        ];
        setCachedSummary(cacheKey, {
          summary: reply,
          model: currentModel,
          presetId: activePresetId,
          title: videoInfo.title
        });

        finalizeSummaryUI(contentDiv, reply, pageUrl, videoInfo);
        setSummaryReady(panel, contentDiv, videoInfo);
      }

    } catch (err) {
      console.error('[省流助手]', err);
      // 🆕 区分打断和真实错误
      if (isAbortError(err)) {
        const resultContainer = contentDiv.querySelector('.tabbit-result');
        if (resultContainer) {
          resultContainer.innerHTML = '<div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:14px;color:#b76d00;text-align:center;">⏹ 已被用户打断，未生成内容</div>';
        }
      } else {
        showError(contentDiv, err.message);
      }

      input.disabled = false;
      sendBtn.disabled = false;
      bindCommentButton(contentDiv, panel, videoInfo, true);
    } finally {
      // 🆕 清理打断按钮 + AbortController
      if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
        abortBtn._wrap.remove();
      }
      if (currentAbortController === localController) currentAbortController = null;
      panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
      panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('disabled'));
    }
  }


  // ==================== 评论区总结主流程（流式 + 打断） ====================
  async function runCommentSummary(panel, videoInfo) {
    if (isCommentSummarizing) return;
    isCommentSummarizing = true;

    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const commentBtn = contentDiv.querySelector('#tabbit-comment-btn');
    if (commentBtn) commentBtn.disabled = true;

    let commentSection = contentDiv.querySelector('#tabbit-comment-section');
    if (!commentSection) {
      commentSection = document.createElement('div');
      commentSection.className = 'tabbit-comment-section';
      commentSection.id = 'tabbit-comment-section';
      contentDiv.appendChild(commentSection);
    }
    commentSection.innerHTML = `
      <div class="tabbit-comment-section-title">💬 评论区总结</div>
      <div class="tabbit-loading">
        <div class="tabbit-spinner"></div>
        <span id="tabbit-comment-status">正在获取评论...</span>
      </div>
    `;

    const statusEl = commentSection.querySelector('#tabbit-comment-status');

    // 🆕 准备 AbortController
    abortCurrentTask();
    currentAbortController = new AbortController();
    const localController = currentAbortController;
    let abortBtn = null;
    const fetchAbortBtnWrap = document.createElement('div');
    fetchAbortBtnWrap.style.cssText = 'text-align:center;';
    abortBtn = insertInlineAbortBtn(fetchAbortBtnWrap, function() {
      abortCurrentTask();
    });
    commentSection.appendChild(fetchAbortBtnWrap);
    abortBtn._wrap = fetchAbortBtnWrap;

    try {
      const aid = getAid(videoInfo);
      if (!aid) throw new Error('无法获取视频 aid');

      const comments = await fetchAllComments(aid, (msg) => {
        if (statusEl) statusEl.textContent = msg;
      }, localController.signal);
      if (comments.length === 0) throw new Error('该视频没有评论');

      // 🆕 检查是否已被打断（评论抓取阶段）
      if (localController.signal.aborted) {
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      if (statusEl) statusEl.textContent = '已获取 ' + comments.length + ' 条评论，AI 正在流式总结...';
      if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
        abortBtn._wrap.remove();
        abortBtn = null;
      }

      const commentsText = formatCommentsText(comments);
      rawCommentsChatContext = '\n\n[评论区原文数据（' + comments.length + '条，格式：[序号] 用户名 (👍点赞): 内容）]\n' + commentsText;
      const activeCommentPrompt = CONFIG.commentPromptText || COMMENT_PROMPT_TEXT;
      const fullPrompt = activeCommentPrompt + '\n\n评论内容如下：\n' + commentsText;

      commentSection.innerHTML = `
        <div class="tabbit-comment-section-title">💬 评论区总结 <span style="font-size:11px;color:#999;font-weight:400;">（${comments.length}条评论）</span></div>
        <div class="tabbit-comment-result"><span class="tabbit-typing-cursor"></span></div>
      `;
      const resultEl = commentSection.querySelector('.tabbit-comment-result');

      // 🆕 插入打断按钮
      const abortBtnWrap = document.createElement('div');
      abortBtnWrap.style.cssText = 'text-align:center;';
      abortBtn = insertInlineAbortBtn(abortBtnWrap, function() {
        abortCurrentTask();
      });
      commentSection.appendChild(abortBtnWrap);
      abortBtn._wrap = abortBtnWrap;

      const messages = [{ role: 'user', content: fullPrompt }];

      const onDelta = createThrottledDelta(function(fullText) {
        resultEl.textContent = fullText;
        const cursor = document.createElement('span');
        cursor.className = 'tabbit-typing-cursor';
        resultEl.appendChild(cursor);
      });

      const reply = await callAIStream(messages, onDelta, buildSummaryStreamOptions(localController.signal));

      commentConversationHistory = [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: reply }
      ];

      resultEl.innerHTML = parseMarkdown(reply);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'tabbit-comment-actions';
      actionsDiv.innerHTML = `
        <button class="tabbit-copy-btn" id="tabbit-copy-comment">📋 复制评论总结</button>
        <button class="tabbit-copy-btn" id="tabbit-flomo-comment">发送 FLOMO</button>
        <span style="font-size:11px;color:#999;margin-left:auto;">🤖 ${currentModel}</span>
      `;
      commentSection.appendChild(actionsDiv);

      const copyCommentBtn = commentSection.querySelector('#tabbit-copy-comment');
      if (copyCommentBtn) {
        copyCommentBtn.addEventListener('click', function() { copyCommentResult(this, reply); });
      }
      const flomoCommentBtn = commentSection.querySelector('#tabbit-flomo-comment');
      if (flomoCommentBtn) {
        flomoCommentBtn.addEventListener('click', function() { sendToFlomo(reply, this); });
      }

    } catch (err) {
      console.error('[省流助手-评论区]', err);
      // 🆕 区分打断和真实错误
      if (isAbortError(err)) {
        commentSection.innerHTML = `
          <div class="tabbit-comment-section-title">💬 评论区总结</div>
          <div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:14px;color:#b76d00;text-align:center;">⏹ 已被用户打断</div>
        `;
      } else {
        commentSection.innerHTML = `
          <div class="tabbit-comment-section-title">💬 评论区总结</div>
          <div class="tabbit-error">
            <div class="tabbit-error-title">⚠️ 评论区总结失败</div>
            <div>${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    } finally {
      // 🆕 清理打断按钮
      if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
        abortBtn._wrap.remove();
      }
      if (currentAbortController === localController) currentAbortController = null;
      isCommentSummarizing = false;
      const btn = contentDiv.querySelector('#tabbit-comment-btn');
      if (btn) btn.disabled = false;
    }
  }

  // ==================== 弹幕分析主流程（流式 + 打断） ====================
  async function runDanmakuSummary(panel, videoInfo) {
    if (isDanmakuAnalyzing) return;
    isDanmakuAnalyzing = true;

    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const danmakuBtn = contentDiv.querySelector('#tabbit-danmaku-btn');
    if (danmakuBtn) danmakuBtn.disabled = true;

    let danmakuSection = contentDiv.querySelector('#tabbit-danmaku-section');
    if (!danmakuSection) {
      danmakuSection = document.createElement('div');
      danmakuSection.className = 'tabbit-danmaku-section';
      danmakuSection.id = 'tabbit-danmaku-section';
      contentDiv.appendChild(danmakuSection);
    }
    danmakuSection.innerHTML = `
      <div class="tabbit-danmaku-section-title">📡 弹幕分析</div>
      <div class="tabbit-loading">
        <div class="tabbit-spinner"></div>
        <span id="tabbit-danmaku-status">正在获取弹幕...</span>
      </div>
    `;

    const statusEl = danmakuSection.querySelector('#tabbit-danmaku-status');

    abortCurrentTask();
    currentAbortController = new AbortController();
    const localController = currentAbortController;
    let abortBtn = null;
    const fetchAbortBtnWrap = document.createElement('div');
    fetchAbortBtnWrap.style.cssText = 'text-align:center;';
    abortBtn = insertInlineAbortBtn(fetchAbortBtnWrap, function() {
      abortCurrentTask();
    });
    danmakuSection.appendChild(fetchAbortBtnWrap);
    abortBtn._wrap = fetchAbortBtnWrap;

    try {
      const cid = videoInfo.cid;
      if (!cid) throw new Error('无法获取视频 cid');

      const danmaku = await fetchAllDanmaku(cid, function(msg) {
        if (statusEl) statusEl.textContent = msg;
      }, localController.signal);
      if (danmaku.length === 0) throw new Error('该视频没有弹幕');

      if (localController.signal.aborted) {
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      if (statusEl) statusEl.textContent = '已获取 ' + danmaku.length + ' 条弹幕，AI 正在流式分析...';
      if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
        abortBtn._wrap.remove();
        abortBtn = null;
      }

      const danmakuText = formatDanmakuText(danmaku);
      rawDanmakuChatContext = '\n\n[弹幕原文数据（' + danmaku.length + '条，格式：[时间] 内容）]\n' + danmakuText;
      const activeDanmakuPrompt = CONFIG.danmakuPromptText || DANMAKU_PROMPT_TEXT;
      const fullPrompt = activeDanmakuPrompt + '\n\n弹幕内容如下：\n' + danmakuText;

      danmakuSection.innerHTML = `
        <div class="tabbit-danmaku-section-title">📡 弹幕分析 <span style="font-size:11px;color:#999;font-weight:400;">（${danmaku.length}条弹幕）</span></div>
        <div class="tabbit-danmaku-result"><span class="tabbit-typing-cursor"></span></div>
      `;
      const resultEl = danmakuSection.querySelector('.tabbit-danmaku-result');

      const abortBtnWrap = document.createElement('div');
      abortBtnWrap.style.cssText = 'text-align:center;';
      abortBtn = insertInlineAbortBtn(abortBtnWrap, function() {
        abortCurrentTask();
      });
      danmakuSection.appendChild(abortBtnWrap);
      abortBtn._wrap = abortBtnWrap;

      const messages = [{ role: 'user', content: fullPrompt }];

      const onDelta = createThrottledDelta(function(fullText) {
        resultEl.textContent = fullText;
        const cursor = document.createElement('span');
        cursor.className = 'tabbit-typing-cursor';
        resultEl.appendChild(cursor);
      });

      const reply = await callAIStream(messages, onDelta, buildSummaryStreamOptions(localController.signal));

      resultEl.innerHTML = parseMarkdown(reply);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'tabbit-danmaku-actions';
      actionsDiv.innerHTML = `
        <button class="tabbit-copy-btn" id="tabbit-copy-danmaku">📋 复制弹幕分析</button>
        <button class="tabbit-copy-btn" id="tabbit-flomo-danmaku">发送 FLOMO</button>
        <span style="font-size:11px;color:#999;margin-left:auto;">🤖 ${currentModel}</span>
      `;
      danmakuSection.appendChild(actionsDiv);

      const copyDanmakuBtn = danmakuSection.querySelector('#tabbit-copy-danmaku');
      if (copyDanmakuBtn) {
        copyDanmakuBtn.addEventListener('click', function() { copyCommentResult(this, reply); });
      }
      const flomoDanmakuBtn = danmakuSection.querySelector('#tabbit-flomo-danmaku');
      if (flomoDanmakuBtn) {
        flomoDanmakuBtn.addEventListener('click', function() { sendToFlomo(reply, this); });
      }

    } catch (err) {
      console.error('[省流助手-弹幕分析]', err);
      if (isAbortError(err)) {
        danmakuSection.innerHTML = `
          <div class="tabbit-danmaku-section-title">📡 弹幕分析</div>
          <div style="background:#e6f7ff;border:1px solid #91d5ff;border-radius:8px;padding:14px;color:#0050b3;text-align:center;">⏹ 已被用户打断</div>
        `;
      } else {
        danmakuSection.innerHTML = `
          <div class="tabbit-danmaku-section-title">📡 弹幕分析</div>
          <div class="tabbit-error">
            <div class="tabbit-error-title">⚠️ 弹幕分析失败</div>
            <div>${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    } finally {
      if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
        abortBtn._wrap.remove();
      }
      if (currentAbortController === localController) currentAbortController = null;
      isDanmakuAnalyzing = false;
      const btn = contentDiv.querySelector('#tabbit-danmaku-btn');
      if (btn) btn.disabled = false;
    }
  }

  // ==================== 全面分析主流程（流式 + 打断） ====================
  let isFullAnalyzing = false;
  let rawDanmakuChatContext = '';
  let rawCommentsChatContext = '';
  let rawFullDataChatContext = '';
  let lastFullPromptText = '';

  const FULL_ANALYSIS_PROMPT = '你是一个专业的视频内容全面分析师。请对以下视频的字幕内容、弹幕和评论进行综合分析，输出一份完整的分析报告，包括：\n1. 【视频核心内容】用简洁的话概括视频到底在讲什么\n2. 【弹幕热评联动】哪些字幕片段引发了最热烈的弹幕/评论讨论，分析观众的反应和情绪\n3. 【观众共鸣点】弹幕和评论中反复出现的话题、梗或观点\n4. 【争议与分歧】弹幕/评论中存在对立看法的地方\n5. 【时间轴亮点】按时间线标注视频中哪些时刻引发了最多的弹幕互动\n6. 【综合评价】综合字幕+弹幕+评论，给出这个视频的整体质量和口碑\n7. 我理解能力差、没耐心，别讲铺垫、别讲背景、别讲废话，只告诉我核心结论和关键点。';

  async function runFullAnalysis(panel, videoInfo) {
    if (isFullAnalyzing) return;
    isFullAnalyzing = true;

    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const fullBtn = contentDiv.querySelector('#tabbit-full-btn');
    if (fullBtn) fullBtn.disabled = true;

    let fullSection = contentDiv.querySelector('#tabbit-full-section');
    if (!fullSection) {
      fullSection = document.createElement('div');
      fullSection.className = 'tabbit-full-section';
      fullSection.id = 'tabbit-full-section';
      contentDiv.appendChild(fullSection);
    }
    fullSection.innerHTML = `
      <div class="tabbit-full-section-title">🔍 全面分析</div>
      <div class="tabbit-loading">
        <div class="tabbit-spinner"></div>
        <span id="tabbit-full-status">正在准备数据...</span>
      </div>
    `;

    const statusEl = fullSection.querySelector('#tabbit-full-status');

    abortCurrentTask();
    currentAbortController = new AbortController();
    const localController = currentAbortController;
    let abortBtn = null;
    const fetchAbortBtnWrap = document.createElement('div');
    fetchAbortBtnWrap.style.cssText = 'text-align:center;';
    abortBtn = insertInlineAbortBtn(fetchAbortBtnWrap, function() {
      abortCurrentTask();
    });
    fullSection.appendChild(fetchAbortBtnWrap);
    abortBtn._wrap = fetchAbortBtnWrap;

    try {
      const aid = getAid(videoInfo);
      const cid = videoInfo.cid;
      if (!aid && !cid) throw new Error('无法获取视频 aid 或 cid');

      // 1. 获取弹幕
      let danmaku = [];
      if (cid) {
        if (statusEl) statusEl.textContent = '正在获取弹幕...';
        try {
          danmaku = await fetchAllDanmaku(cid, function(msg) {
            if (statusEl) statusEl.textContent = msg;
          }, localController.signal);
        } catch(e) {
          if (isAbortError(e)) throw e;
          console.warn('[省流助手-全面分析] 弹幕获取失败:', e.message);
        }
      }

      if (localController.signal.aborted) throw Object.assign(new Error('用户已打断'), { name: 'AbortError' });

      // 2. 获取评论
      let comments = [];
      if (aid) {
        if (statusEl) statusEl.textContent = '正在获取评论...';
        try {
          comments = await fetchAllComments(aid, function(msg) {
            if (statusEl) statusEl.textContent = '弹幕' + danmaku.length + '条，' + msg;
          }, localController.signal);
        } catch(e) {
          if (isAbortError(e)) throw e;
          console.warn('[省流助手-全面分析] 评论获取失败:', e.message);
        }
      }

      if (localController.signal.aborted) throw Object.assign(new Error('用户已打断'), { name: 'AbortError' });

      // 3. 检查数据量
      if (danmaku.length === 0 && comments.length === 0 && !rawSubtitleBody.length && !rawTranscript) {
        throw new Error('未获取到任何数据（弹幕、评论、字幕均为空）');
      }

      if (statusEl) statusEl.textContent = '数据就绪（弹幕' + danmaku.length + '条 + 评论' + comments.length + '条），AI 正在全面分析...';
      if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
        abortBtn._wrap.remove();
        abortBtn = null;
      }

      // 4. 构建全面数据
      const fullDataText = formatFullData(videoInfo, rawSubtitleBody, danmaku, comments);
      rawFullDataChatContext = '\n\n[全面分析原始数据]\n' + fullDataText;
      const activeFullPrompt = CONFIG.fullAnalysisPromptText || FULL_ANALYSIS_PROMPT;
      const fullPrompt = activeFullPrompt + '\n\n以下是完整数据：\n' + fullDataText;
      lastFullPromptText = fullPrompt;

      const totalItems = (rawSubtitleBody.length || 0) + danmaku.length + comments.length;
      fullSection.innerHTML = `
        <div class="tabbit-full-section-title">🔍 全面分析 <span style="font-size:11px;color:#999;font-weight:400;">（字幕${rawSubtitleBody.length}句 + 弹幕${danmaku.length}条 + 评论${comments.length}条）</span></div>
        <div class="tabbit-full-result"><span class="tabbit-typing-cursor"></span></div>
      `;
      const resultEl = fullSection.querySelector('.tabbit-full-result');

      const abortBtnWrap = document.createElement('div');
      abortBtnWrap.style.cssText = 'text-align:center;';
      abortBtn = insertInlineAbortBtn(abortBtnWrap, function() {
        abortCurrentTask();
      });
      fullSection.appendChild(abortBtnWrap);
      abortBtn._wrap = abortBtnWrap;

      const messages = [{ role: 'user', content: fullPrompt }];

      const onDelta = createThrottledDelta(function(fullText) {
        resultEl.textContent = fullText;
        const cursor = document.createElement('span');
        cursor.className = 'tabbit-typing-cursor';
        resultEl.appendChild(cursor);
      });

      const reply = await callAIStream(messages, onDelta, buildSummaryStreamOptions(localController.signal));

      resultEl.innerHTML = parseMarkdown(reply);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'tabbit-full-actions';
      actionsDiv.innerHTML = `
        <button class="tabbit-copy-btn" id="tabbit-copy-full">📋 复制全面分析</button>
        <button class="tabbit-copy-btn" id="tabbit-flomo-full">发送 FLOMO</button>
        <button class="tabbit-copy-btn" id="tabbit-export-full">📄 导出原文</button>
        <span style="font-size:11px;color:#999;margin-left:auto;">🤖 ${currentModel}</span>
      `;
      fullSection.appendChild(actionsDiv);

      const copyFullBtn = fullSection.querySelector('#tabbit-copy-full');
      if (copyFullBtn) {
        copyFullBtn.addEventListener('click', function() { copyCommentResult(this, reply); });
      }
      const flomoFullBtn = fullSection.querySelector('#tabbit-flomo-full');
      if (flomoFullBtn) {
        flomoFullBtn.addEventListener('click', function() { sendToFlomo(reply, this); });
      }
      const exportFullBtn = fullSection.querySelector('#tabbit-export-full');
      if (exportFullBtn) {
        exportFullBtn.addEventListener("click", function() {
          if (!lastFullPromptText) { alert("没有可导出的原文数据"); return; }
          var title = (videoInfo && videoInfo.title) || "全面分析";
          var safeTitle = sanitizeFilename(title) || "全面分析";
          var ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          triggerDownload(lastFullPromptText, safeTitle + "__全面分析原文__" + ts + ".txt", "text/plain;charset=utf-8");
        });
      }

    } catch (err) {
      console.error('[省流助手-全面分析]', err);
      if (isAbortError(err)) {
        fullSection.innerHTML = `
          <div class="tabbit-full-section-title">🔍 全面分析</div>
          <div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:14px;color:#b76d00;text-align:center;">⏹ 已被用户打断</div>
        `;
      } else {
        fullSection.innerHTML = `
          <div class="tabbit-full-section-title">🔍 全面分析</div>
          <div class="tabbit-error">
            <div class="tabbit-error-title">⚠️ 全面分析失败</div>
            <div>${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    } finally {
      if (abortBtn && abortBtn._wrap && abortBtn._wrap.parentNode) {
        abortBtn._wrap.remove();
      }
      if (currentAbortController === localController) currentAbortController = null;
      isFullAnalyzing = false;
      const btn = contentDiv.querySelector('#tabbit-full-btn');
      if (btn) btn.disabled = false;
    }
  }

  // ==================== 对话功能（流式 + 打断） ====================
  async function handleSend(panel) {
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');
    const text = input.value.trim();
    if (!text) return;
    if (conversationHistory.length === 0 && !rawDanmakuChatContext && !rawCommentsChatContext && !rawFullDataChatContext) {
      alert('请先等待摘要完成或运行弹幕/评论/全面分析后再发起对话');
      return;
    }
    // 如果没有初始摘要但有分析数据，创建初始对话上下文
    if (conversationHistory.length === 0) {
      let initContext = '你是一个B站视频分析助手，以下是当前视频的相关数据，请基于这些数据回答用户问题。';
      if (rawFullDataChatContext) initContext += rawFullDataChatContext;
      else {
        if (rawDanmakuChatContext) initContext += rawDanmakuChatContext;
        if (rawCommentsChatContext) initContext += rawCommentsChatContext;
      }
      conversationHistory = [{ role: 'user', content: initContext }, { role: 'assistant', content: '已收到视频相关数据，可以开始提问了。' }];
    }

    let messagesContainer = panel.querySelector('.tabbit-chat-messages');
    if (!messagesContainer) {
      const contentDiv = panel.querySelector('.tabbit-panel-content');
      messagesContainer = document.createElement('div');
      messagesContainer.className = 'tabbit-chat-messages';
      contentDiv.appendChild(messagesContainer);
    }

    const userMsg = document.createElement('div');
    userMsg.className = 'tabbit-msg tabbit-msg-user';
    userMsg.textContent = text;
    messagesContainer.appendChild(userMsg);

    input.value = '';
    input.style.height = 'auto';
    input.disabled = true;

    const aiWrap = document.createElement('div');
    aiWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;';
    const aiMsg = document.createElement('div');
    aiMsg.className = 'tabbit-msg tabbit-msg-ai';
    aiMsg.innerHTML = '<span class="tabbit-typing-cursor"></span>';
    const modelTag = document.createElement('div');
    modelTag.className = 'tabbit-msg-model';
    modelTag.textContent = '🤖 ' + currentModel;
    aiWrap.appendChild(aiMsg);
    aiWrap.appendChild(modelTag);
    messagesContainer.appendChild(aiWrap);

    const contentDiv = panel.querySelector('.tabbit-panel-content');
    // 🆕 把发送按钮变为打断按钮
    abortCurrentTask();
    currentAbortController = new AbortController();
    const localController = currentAbortController;
    setSendBtnAsAbort(sendBtn, function() {
      abortCurrentTask();
    });

    try {
      // 构建包含所有可用原始数据的用户消息
      let userContext = text;
      let allContext = '';
      if (rawFullDataChatContext) allContext += rawFullDataChatContext;
      else {
        if (rawDanmakuChatContext) allContext += rawDanmakuChatContext;
        if (rawCommentsChatContext) allContext += rawCommentsChatContext;
      }
      if (allContext) {
        userContext = text + '\n\n[参考数据-仅供参考，不要重复展示]' + allContext;
      }
      conversationHistory.push({ role: 'user', content: userContext });

      let sentMessages = conversationHistory;
      if (conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        sentMessages = [conversationHistory[0], ...conversationHistory.slice(-(MAX_CONVERSATION_HISTORY - 1))];
      }

      const onDelta = createThrottledDelta(function(fullText) {
        aiMsg.textContent = fullText;
        const cursor = document.createElement('span');
        cursor.className = 'tabbit-typing-cursor';
        aiMsg.appendChild(cursor);
      });

      const reply = await callAIStream(sentMessages, onDelta, buildSummaryStreamOptions(localController.signal));
      conversationHistory.push({ role: 'assistant', content: reply });

      aiMsg.innerHTML = parseMarkdown(reply);
    } catch (err) {
      console.error('[省流助手-对话]', err);
      conversationHistory.pop();
      // 🆕 区分打断和真实错误
      if (isAbortError(err)) {
        aiMsg.style.background = '#fff7e6';
        aiMsg.style.color = '#b76d00';
        aiMsg.textContent = '⏹ 已被用户打断';
      } else {
        aiMsg.style.background = '#fff3f3';
        aiMsg.style.color = '#c00';
        aiMsg.textContent = '⚠️ ' + err.message;
      }
    } finally {
      // 🆕 还原发送按钮
      restoreSendBtn(sendBtn);
      if (currentAbortController === localController) currentAbortController = null;
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ==================== 设置面板 ====================
  function openSettingsPanel(mainPanel) {
    if (document.querySelector('#tabbit-settings-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tabbit-settings-overlay';

    const currentModelList = (CONFIG.modelList || DEFAULT_CONFIG.modelList).join('\n');
    const currentCommentTextPresets = getCommentTextPresets().join('\n');
    const cacheStats = getSummaryCacheStats();

    overlay.innerHTML = `
      <div id="tabbit-settings-panel">
        <div class="tabbit-settings-header">
          <span>⚙️ AI 配置设置</span>
          <button class="tabbit-close-btn" id="tabbit-settings-close">&times;</button>
        </div>
        <div class="tabbit-settings-body">

          <div class="tabbit-settings-group">
            <div class="tabbit-switch-row">
              <div>
                <div class="tabbit-settings-label">🚀 自动解析</div>
                <div class="tabbit-settings-hint" style="margin-top:2px;">开启：进入视频页自动开始解析并打开面板；关闭：仅在右侧显示悬浮窗，由你决定是否解析</div>
              </div>
              <label class="tabbit-switch">
                <input type="checkbox" id="ts-autoParse" ${CONFIG.autoParse ? 'checked' : ''} />
                <span class="tabbit-slider"></span>
              </label>
            </div>
          </div>

          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="api-settings">
              <div class="tabbit-collapse-title">🤖 大模型 API 设置</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">API URL</div>
                <input class="tabbit-settings-input" id="ts-apiUrl" type="text" value="${escapeHtml(CONFIG.apiUrl || '')}" placeholder="https://your-api/v1" />
                <div class="tabbit-settings-hint">可填 https://xxx/v1，脚本会自动补成 /chat/completions 和 /models；也兼容完整 /v1/chat/completions</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">API Key</div>
                <input class="tabbit-settings-input" id="ts-apiKey" type="password" value="${escapeHtml(CONFIG.apiKey || '')}" placeholder="sk-..." />
                <div class="tabbit-settings-hint">你的 API 密钥（本地存储，不会上传）</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">默认模型</div>
                <input class="tabbit-settings-input" id="ts-model" type="text" value="${escapeHtml(CONFIG.model || '')}" placeholder="gpt-4o" />
                <div class="tabbit-settings-hint">启动时默认选中的模型名称</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">普通摘要最大输出 tokens</div>
                <input class="tabbit-settings-input" id="ts-summaryMaxTokens" type="number" min="500" max="30000" step="500" value="${CONFIG.summaryMaxTokens || DEFAULT_CONFIG.summaryMaxTokens}" placeholder="4000" />
                <div class="tabbit-settings-hint">影响视频摘要、评论总结、弹幕分析、全面分析和对话。详细笔记版容易超，可调到 6000-10000，前提是你的 API/模型支持。</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">候选模型列表</div>
                <div class="tabbit-input-with-btn" style="margin-bottom:6px;">
                  <button class="tabbit-fetch-models-btn" id="ts-fetch-models">🔍 自动获取所有模型</button>
                  <button class="tabbit-fetch-models-btn" id="ts-append-models" style="border-color:#aaa;color:#666;">➕ 追加获取（不覆盖）</button>
                </div>
                <textarea class="tabbit-settings-textarea" id="ts-modelList" placeholder="每行一个模型名称">${escapeHtml(currentModelList)}</textarea>
                <div class="tabbit-settings-hint">每行一个模型名称。点击「自动获取」会从 API URL 自动调用 /v1/models 拉取并覆盖列表</div>
              </div>
            </div>
          </div>

          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="flomo-settings">
              <div class="tabbit-collapse-title">🌱 Flomo 设置（发送笔记相关，不填不影响）</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">Flomo API</div>
                <input class="tabbit-settings-input" id="ts-flomoApiUrl" type="text" value="${escapeHtml(CONFIG.flomoApiUrl || '')}" placeholder="https://flomoapp.com/iwh/xxx/xxx/" />
                <div class="tabbit-settings-hint">flomo 的 API 地址，在 flomo 设置 → API 中获取</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">🏷️ 自动标签</div>
                <input class="tabbit-settings-input" id="ts-flomoTags" type="text" value="${escapeHtml(CONFIG.flomoTags || '')}" placeholder="#B站省流助手 #视频摘要" />
                <div class="tabbit-settings-hint">发送到 flomo 时自动追加在内容末尾，多个标签用空格分隔</div>
              </div>
            </div>
          </div>

          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="preset-settings">
              <div class="tabbit-collapse-title">🎨 视频摘要预设</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">预设管理</div>
                <div class="tabbit-preset-manage-list" id="ts-preset-list"></div>
                <button class="tabbit-preset-add-btn" id="ts-preset-add">＋ 添加新预设</button>
                <div class="tabbit-settings-hint">设置里的「默认」决定启动默认预设；主面板切换只临时重新总结，不会改默认。</div>
              </div>
            </div>
          </div>

          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="comment-settings">
              <div class="tabbit-collapse-title">💬 评论区设置</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">最大获取页数</div>
                <input class="tabbit-settings-input" id="ts-commentMaxPages" type="number" min="1" max="20" value="${CONFIG.commentMaxPages || 8}" placeholder="8" />
                <div class="tabbit-settings-hint">最多获取多少页评论，范围 1-20 页</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">最大评论数量</div>
                <input class="tabbit-settings-input" id="ts-commentLimit" type="number" min="10" max="500" value="${CONFIG.commentLimit || 188}" placeholder="188" />
                <div class="tabbit-settings-hint">最多获取多少条评论，范围 10-500 条</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">页面间最小延迟（毫秒）</div>
                <input class="tabbit-settings-input" id="ts-commentMinDelay" type="number" min="500" max="10000" value="${CONFIG.commentMinDelay || 1800}" placeholder="1800" />
                <div class="tabbit-settings-hint">每页评论之间的最小等待时间，防止触发风控</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">页面间最大延迟（毫秒）</div>
                <input class="tabbit-settings-input" id="ts-commentMaxDelay" type="number" min="1000" max="15000" value="${CONFIG.commentMaxDelay || 3800}" placeholder="3800" />
                <div class="tabbit-settings-hint">每页评论之间的最大等待时间，防止触发风控</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">评论区总结提示词</div>
                <textarea class="tabbit-settings-textarea" id="ts-commentPromptText" placeholder="评论区总结的系统提示词...">${escapeHtml(CONFIG.commentPromptText || COMMENT_PROMPT_TEXT)}</textarea>
                <div class="tabbit-settings-hint">发送给AI的评论区总结指令</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">评论发布文字预设</div>
                <textarea class="tabbit-settings-textarea" id="ts-commentTextPresets" placeholder="每行一条，点击填字按钮时随机选择">${escapeHtml(currentCommentTextPresets)}</textarea>
                <div class="tabbit-settings-hint">用于图片下方「填字并点上传」按钮。每次随机选一条填入评论框。</div>
              </div>
              <div class="tabbit-switch-row" style="padding:10px 12px;background:#f8f9ff;border:1px solid #e2e6f2;border-radius:8px;">
                <div>
                  <div class="tabbit-settings-label">🚀 摘要发评论自动发送</div>
                  <div class="tabbit-settings-hint" style="margin-top:2px;">开启：点击「摘要发评论」后自动点发布按钮；关闭：只填入评论框，手动点发送</div>
                </div>
                <label class="tabbit-switch">
                  <input type="checkbox" id="ts-autoSubmitCommentSummary" ${CONFIG.autoSubmitCommentSummary ? 'checked' : ''} />
                  <span class="tabbit-slider"></span>
                </label>
              </div>
            </div>
          </div>


          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="analysis-settings">
              <div class="tabbit-collapse-title">📡 弹幕 & 全面分析</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">弹幕分析提示词</div>
                <textarea class="tabbit-settings-textarea" id="ts-danmakuPromptText" rows="4" placeholder="弹幕分析的 AI 提示词...">${escapeHtml(CONFIG.danmakuPromptText || DANMAKU_PROMPT_TEXT)}</textarea>
                <div class="tabbit-settings-hint">发送给 AI 的弹幕分析指令。弹幕将作为数据附在提示词后面。</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">全面分析数据上限（字符）</div>
                <input class="tabbit-settings-input" id="ts-fullDataMaxChars" type="number" min="10000" max="200000" step="2000" value="${CONFIG.fullDataMaxChars || 64000}" placeholder="64000" />
                <div class="tabbit-settings-hint">发送给 AI 的全面分析原始数据（字幕+弹幕+评论）最大字符数。超限自动截断。建议先用默认值测试，被 API 拒绝就调小。</div>
              </div>

              <div class="tabbit-settings-group" style="border-top:1px solid #e8e8f0;padding-top:14px;margin-top:14px;">
                <div class="tabbit-settings-label">全面分析预设</div>
                <div class="tabbit-settings-hint" style="margin-bottom:8px;">选择全面分析的提示词预设，可在下方编辑</div>
                <div id="ts-fullAnalysisPresets" style="display:flex;flex-direction:column;gap:8px;"></div>
                <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-fullPreset-add" type="button" style="margin-top:8px;">➕ 新增预设</button>
              </div>

              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">当前预设提示词</div>
                <textarea class="tabbit-settings-textarea" id="ts-fullAnalysisPromptText" rows="6" placeholder="全面分析的 AI 提示词..."></textarea>
                <div class="tabbit-settings-hint">编辑当前选中预设的提示词。弹幕和评论将作为舆情数据附在提示词后面。</div>
              </div>
            </div>
          </div>

          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="image-settings">
              <div class="tabbit-collapse-title">🖼️ 生图设置</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body" id="ts-imageGen-fields">
              <div class="tabbit-switch-row" style="margin-bottom:10px;padding:10px 12px;background:linear-gradient(135deg,#f0f4ff 0%,#fff5f8 100%);border:1px solid #d6e0ff;border-radius:8px;">
                <div>
                  <div class="tabbit-settings-label">自动生图</div>
                  <div class="tabbit-settings-hint" style="margin-top:2px;">开启后，每次总结完成时自动生成配图。关闭时仍可用结果区的「生成配图」手动触发。</div>
                </div>
                <label class="tabbit-switch">
                  <input type="checkbox" id="ts-enableImageGen" ${CONFIG.enableImageGen ? 'checked' : ''} />
                  <span class="tabbit-slider"></span>
                </label>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">生图模式</div>
                <select class="tabbit-settings-input" id="ts-imageGenMode">
                  <option value="api" ${CONFIG.imageGenMode !== 'flow' ? 'selected' : ''}>API 生图（回传图片）</option>
                  <option value="flow" ${CONFIG.imageGenMode === 'flow' ? 'selected' : ''}>发送到 Google Flow（不回传图片）</option>
                </select>
                <div class="tabbit-settings-hint">Flow 模式会把生图提示词发送到已打开/将打开的 Flow 项目页，由 Flow 页面脚本负责提交和下载。</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">Flow 项目页 URL</div>
                <input class="tabbit-settings-input" id="ts-flowProjectUrl" type="text" value="${escapeHtml(CONFIG.flowProjectUrl || DEFAULT_FLOW_PROJECT_URL)}" placeholder="https://labs.google/fx/zh/tools/flow/project/..." />
                <div class="tabbit-settings-hint">Flow 模式使用。建议让该项目页保持打开，右下角接收端会自动填词、生图并监控下载。</div>
              </div>
              <div class="tabbit-switch-row" style="margin-top:10px;padding:10px 12px;background:white;border:1px solid #e2e6f2;border-radius:8px;">
                <div>
                  <div class="tabbit-settings-label">发送时后台打开 Flow</div>
                  <div class="tabbit-settings-hint" style="margin-top:2px;">开启后，如果没检测到后台 Flow 接收页，会自动后台打开上面的项目页；已打开时不会重复打开。</div>
                </div>
                <label class="tabbit-switch">
                  <input type="checkbox" id="ts-enableFlowBackgroundOpen" ${CONFIG.enableFlowBackgroundOpen !== false ? 'checked' : ''} />
                  <span class="tabbit-slider"></span>
                </label>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">生图模型 API URL</div>
                <input class="tabbit-settings-input" id="ts-imageGenApiUrl" type="text" value="${escapeHtml(CONFIG.imageGenApiUrl || '')}" placeholder="https://your-api/v1（留空复用上方 API URL）" />
                <div class="tabbit-settings-hint">可填 /v1、/v1/images/generations、/v1/responses 或 /v1/chat/completions；脚本会自动尝试兼容格式</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">生图模型 API Key</div>
                <input class="tabbit-settings-input" id="ts-imageGenApiKey" type="password" value="${escapeHtml(CONFIG.imageGenApiKey || '')}" placeholder="留空则使用上方的 API Key" />
                <div class="tabbit-settings-hint">生图模型的 API 密钥，留空则复用上方的 API Key</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">生图模型名称</div>
                <input class="tabbit-settings-input" id="ts-imageGenModel" type="text" value="${escapeHtml(CONFIG.imageGenModel || 'gemini-2.0-flash-preview-image-generation')}" placeholder="gemini-2.0-flash-preview-image-generation" />
                <div class="tabbit-settings-hint">支持图片输出的模型名称，默认 gemini-2.0-flash-preview-image-generation</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">生图尺寸</div>
                <input class="tabbit-settings-input" id="ts-imageGenSize" type="text" list="ts-imageGenSizePresets" value="${escapeHtml(CONFIG.imageGenSize || '1024x1024')}" placeholder="1024x1024 / 1280x720 / auto" />
                <datalist id="ts-imageGenSizePresets">
                  <option value="1024x1024">1:1 正方形</option>
                  <option value="1792x1024">16:9 横版</option>
                  <option value="1024x1792">9:16 竖版</option>
                  <option value="1536x1024">3:2 横版</option>
                  <option value="1024x1536">2:3 竖版</option>
                  <option value="1280x720">自定义横版</option>
                  <option value="720x1280">自定义竖版</option>
                  <option value="auto">接口自动决定</option>
                </datalist>
                <div class="tabbit-settings-hint">可选预设，也可手填「宽x高」。最终是否支持由你的生图 API 决定。</div>
              </div>
              <div class="tabbit-switch-row" style="margin-top:10px;padding:10px 12px;background:white;border:1px solid #e2e6f2;border-radius:8px;">
                <div>
                  <div class="tabbit-settings-label">生成后自动下载图片</div>
                  <div class="tabbit-settings-hint" style="margin-top:2px;">开启后，自动生图和手动生成配图成功时都会下载到本地。</div>
                </div>
                <label class="tabbit-switch">
                  <input type="checkbox" id="ts-enableImageAutoDownload" ${CONFIG.enableImageAutoDownload !== false ? 'checked' : ''} />
                  <span class="tabbit-slider"></span>
                </label>
              </div>
              <div class="tabbit-settings-group" style="margin-top:10px;">
                <div class="tabbit-settings-label">复制 生图提示词（自动+手动生图共用）</div>
                <textarea class="tabbit-settings-textarea" id="ts-imageGenPromptText" placeholder="生图提示词，使用 {summary} 作为视频总结的占位符...">${escapeHtml(CONFIG.imageGenPromptText || IMAGE_GEN_PROMPT_TEXT)}</textarea>
                <div class="tabbit-settings-hint">用于指导生图模型的提示词模板。使用 <code style="background:#eef;padding:1px 4px;border-radius:3px;">{summary}</code> 占位符表示视频总结内容（运行时自动替换）。如不写占位符，总结会自动追加在末尾。</div>
              </div>
            </div>
          </div>

          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="html-ppt-settings">
              <div class="tabbit-collapse-title">📊 HTML PPT 设置</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-switch-row" style="margin-bottom:10px;padding:10px 12px;background:#f8f9ff;border:1px solid #e2e6f2;border-radius:8px;">
                <div>
                  <div class="tabbit-settings-label">字幕直出 HTML PPT</div>
                  <div class="tabbit-settings-hint" style="margin-top:2px;">开启后，获取字幕后直接一次性生成 HTML PPT，不再先生成普通摘要；关闭后仍可摘要完成后手动点击 HTML PPT。</div>
                </div>
                <label class="tabbit-switch">
                  <input type="checkbox" id="ts-enableHtmlPptDirect" ${CONFIG.enableHtmlPptDirect ? 'checked' : ''} />
                  <span class="tabbit-slider"></span>
                </label>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">展示形式</div>
                <select class="tabbit-settings-input" id="ts-htmlPptLayoutMode">
                  <option value="single" ${CONFIG.htmlPptLayoutMode !== 'slides' ? 'selected' : ''}>单页图文总结（默认）</option>
                  <option value="slides" ${CONFIG.htmlPptLayoutMode === 'slides' ? 'selected' : ''}>翻页 PPT</option>
                </select>
                <div class="tabbit-settings-hint">单页模式适合把所有内容放在一个页面里读完；翻页模式适合演示。</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">HTML PPT 最大输出 tokens</div>
                <input class="tabbit-settings-input" id="ts-htmlPptMaxTokens" type="number" min="2000" max="30000" step="500" value="${CONFIG.htmlPptMaxTokens || 8000}" placeholder="8000" />
                <div class="tabbit-settings-hint">仅影响 HTML PPT 生成。8000 通常够单页，复杂翻页可调到 12000-16000，前提是你的 API/模型支持。</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">HTML PPT 生成提示词</div>
                <textarea class="tabbit-settings-textarea" id="ts-htmlPptPromptText" placeholder="HTML PPT 生成提示词，支持 {summary} {title} {upName} {url} 占位符...">${escapeHtml(CONFIG.htmlPptPromptText || getDefaultHtmlPptPrompt(CONFIG.htmlPptLayoutMode || 'single'))}</textarea>
                <div class="tabbit-settings-hint">用于结果区「HTML PPT」按钮。生成完成后才自动打开新标签。支持 <code style="background:#eef;padding:1px 4px;border-radius:3px;">{summary}</code>、<code style="background:#eef;padding:1px 4px;border-radius:3px;">{title}</code>、<code style="background:#eef;padding:1px 4px;border-radius:3px;">{upName}</code>、<code style="background:#eef;padding:1px 4px;border-radius:3px;">{url}</code>、<code style="background:#eef;padding:1px 4px;border-radius:3px;">{skill}</code>、<code style="background:#eef;padding:1px 4px;border-radius:3px;">{layoutInstruction}</code>。</div>
                <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-htmlPptPromptReset" type="button" style="margin-top:8px;">重置为当前模式默认提示词</button>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">本地 Skill.md（可选）</div>
                <div class="tabbit-settings-hint" id="ts-htmlPptSkillInfo">${CONFIG.htmlPptSkillText ? ('已导入：' + escapeHtml(CONFIG.htmlPptSkillName || 'Skill.md') + '，约 ' + Math.ceil(String(CONFIG.htmlPptSkillText || '').length / 1000) + 'K 字符') : '未导入。只读取本地 Markdown 文本作为提示词，不执行里面的代码。'}</div>
                <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                  <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-htmlPptSkillImport" type="button">导入 Skill.md</button>
                  <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-htmlPptSkillClear" type="button">清空 Skill</button>
                </div>
              </div>
            </div>
          </div>

          <div class="tabbit-collapse">
            <div class="tabbit-collapse-header" data-collapse="other-settings">
              <div class="tabbit-collapse-title">⚙️ 其他设置</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">⏱️ 短视频跳过阈值（秒）</div>
                <input class="tabbit-settings-input" id="ts-skipDuration" type="number" min="0" value="${CONFIG.skipDuration || 60}" placeholder="60" />
                <div class="tabbit-settings-hint">视频时长低于此秒数时自动跳过字幕获取，设为 0 则不跳过</div>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">📍 位置和尺寸</div>
                <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-reset-pos">重置面板/悬浮窗位置和尺寸</button>
              </div>
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">🧠 摘要缓存</div>
                <div class="tabbit-settings-hint" id="ts-cache-info">当前缓存 ${cacheStats.count} 条，约 ${Math.ceil(cacheStats.chars / 1000)}K 字符。最多保留 ${SUMMARY_CACHE_MAX_ENTRIES} 条，超出自动清理旧缓存。</div>
                <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-clear-summary-cache" style="margin-top:8px;">清理摘要缓存</button>
              </div>
            </div>
          </div>

        </div>
        <div class="tabbit-settings-footer">
          <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-export">📤 导出配置</button>
          <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-import">📥 导入配置</button>
          <button class="tabbit-settings-btn tabbit-settings-btn-danger" id="ts-reset">🗑 重置</button>
          <div class="tabbit-settings-spacer"></div>
          <span class="tabbit-settings-saved" id="ts-saved">✅ 已保存</span>
          <button class="tabbit-settings-btn tabbit-settings-btn-primary" id="ts-save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let editingPresets = JSON.parse(JSON.stringify(CONFIG.promptPresets || DEFAULT_PRESETS));
    let editingActiveId = CONFIG.activePresetId || (editingPresets[0] && editingPresets[0].id);
    let editingHtmlPptSkillText = String(CONFIG.htmlPptSkillText || '');
    let editingHtmlPptSkillName = CONFIG.htmlPptSkillName || '';

    function updateHtmlPptSkillInfo() {
      const infoEl = overlay.querySelector('#ts-htmlPptSkillInfo');
      if (!infoEl) return;
      if (editingHtmlPptSkillText) {
        infoEl.textContent = '已导入：' + (editingHtmlPptSkillName || 'Skill.md') + '，约 ' + Math.ceil(editingHtmlPptSkillText.length / 1000) + 'K 字符。记得点击保存。';
      } else {
        infoEl.textContent = '未导入。只读取本地 Markdown 文本作为提示词，不执行里面的代码。';
      }
    }

    function renderPresetEditList() {
      const listEl = overlay.querySelector('#ts-preset-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      editingPresets.forEach(function(preset, idx) {
        const item = document.createElement('div');
        item.className = 'tabbit-preset-item';
        const isActive = preset.id === editingActiveId;
        item.innerHTML =
          '<div class="tabbit-preset-item-row">' +
            '<input class="tabbit-settings-input tabbit-preset-icon-input" data-field="icon" data-idx="' + idx + '" type="text" maxlength="3" value="' + escapeHtml(preset.icon || '📄') + '" placeholder="🎯" />' +
            '<input class="tabbit-settings-input tabbit-preset-name-input" data-field="name" data-idx="' + idx + '" type="text" value="' + escapeHtml(preset.name || '') + '" placeholder="预设名称" />' +
            '<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#666;white-space:nowrap;cursor:pointer;">' +
              '<input type="radio" name="ts-active-preset" data-idx="' + idx + '" ' + (isActive ? 'checked' : '') + ' style="margin:0;" />' +
              '默认' +
            '</label>' +
            '<button class="tabbit-preset-del-btn" data-idx="' + idx + '" title="删除此预设">🗑</button>' +
          '</div>' +
          '<textarea class="tabbit-preset-prompt-textarea" data-field="prompt" data-idx="' + idx + '" placeholder="提示词内容...">' + escapeHtml(preset.prompt || '') + '</textarea>';
        listEl.appendChild(item);
      });

      listEl.querySelectorAll('input[data-field], textarea[data-field]').forEach(function(el) {
        el.addEventListener('input', function() {
          const idx = parseInt(el.dataset.idx, 10);
          const field = el.dataset.field;
          if (editingPresets[idx]) {
            editingPresets[idx][field] = el.value;
          }
        });
      });

      listEl.querySelectorAll('input[name="ts-active-preset"]').forEach(function(el) {
        el.addEventListener('change', function() {
          const idx = parseInt(el.dataset.idx, 10);
          if (editingPresets[idx]) {
            editingActiveId = editingPresets[idx].id;
          }
        });
      });

      listEl.querySelectorAll('.tabbit-preset-del-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          const idx = parseInt(btn.dataset.idx, 10);
          if (editingPresets.length <= 1) {
            alert('至少保留一个预设');
            return;
          }
          if (!confirm('确定删除「' + (editingPresets[idx].name || '未命名') + '」？')) return;
          const removedId = editingPresets[idx].id;
          editingPresets.splice(idx, 1);
          if (editingActiveId === removedId) {
            editingActiveId = editingPresets[0].id;
          }
          renderPresetEditList();
        });
      });
    }
    renderPresetEditList();

    // ==================== 全面分析预设编辑器 ====================
    let editingFullPresets = JSON.parse(JSON.stringify(CONFIG.fullAnalysisPresets || DEFAULT_FULL_ANALYSIS_PRESETS));
    let editingFullActiveId = CONFIG.activeFullAnalysisPresetId || (editingFullPresets[0] && editingFullPresets[0].id);

    function syncFullPromptTextarea() {
      const ta = overlay.querySelector('#ts-fullAnalysisPromptText');
      if (!ta) return;
      const active = editingFullPresets.find(function(p) { return p.id === editingFullActiveId; });
      ta.value = active ? (active.prompt || '') : '';
    }

    function renderFullPresetEditList() {
      const listEl = overlay.querySelector('#ts-fullAnalysisPresets');
      if (!listEl) return;
      listEl.innerHTML = '';
      editingFullPresets.forEach(function(preset, idx) {
        const isActive = preset.id === editingFullActiveId;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;background:' + (isActive ? '#eef0ff' : '#f8f9fa') + ';border:1px solid ' + (isActive ? '#667eea' : '#e8e8f0') + ';border-radius:6px;padding:6px 8px;cursor:pointer;transition:all .15s;';
        row.innerHTML =
          '<span style="font-size:16px;">' + (preset.icon || '📄') + '</span>' +
          '<input class="tabbit-settings-input tabbit-preset-name-input" data-ffield="name" data-fidx="' + idx + '" type="text" value="' + escapeHtml(preset.name || '') + '" placeholder="预设名称" style="flex:1;border:none;background:transparent;font-weight:' + (isActive ? '600' : '400') + ';padding:2px 4px;" />' +
          '<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#666;white-space:nowrap;cursor:pointer;">' +
            '<input type="radio" name="ts-active-full-preset" data-fidx="' + idx + '" ' + (isActive ? 'checked' : '') + ' style="margin:0;" />' +
            '使用' +
          '</label>' +
          '<button class="tabbit-preset-del-btn" data-fidx="' + idx + '" title="删除此预设" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px;">🗑</button>';
        listEl.appendChild(row);
      });

      listEl.querySelectorAll('input[data-ffield]').forEach(function(el) {
        el.addEventListener('input', function() {
          const idx = parseInt(el.dataset.fidx, 10);
          if (editingFullPresets[idx]) {
            editingFullPresets[idx].name = el.value;
          }
        });
      });

      listEl.querySelectorAll('input[name="ts-active-full-preset"]').forEach(function(el) {
        el.addEventListener('change', function() {
          const idx = parseInt(el.dataset.fidx, 10);
          if (editingFullPresets[idx]) {
            editingFullActiveId = editingFullPresets[idx].id;
            syncFullPromptTextarea();
            renderFullPresetEditList();
          }
        });
      });

      listEl.querySelectorAll('.tabbit-preset-del-btn[data-fidx]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.fidx, 10);
          if (editingFullPresets.length <= 1) {
            alert('至少保留一个预设');
            return;
          }
          if (!confirm('确定删除「' + (editingFullPresets[idx].name || '未命名') + '」？')) return;
          const removedId = editingFullPresets[idx].id;
          editingFullPresets.splice(idx, 1);
          if (editingFullActiveId === removedId) {
            editingFullActiveId = editingFullPresets[0].id;
          }
          syncFullPromptTextarea();
          renderFullPresetEditList();
        });
      });
    }
    renderFullPresetEditList();
    syncFullPromptTextarea();

    overlay.querySelector('#ts-fullPreset-add').addEventListener('click', function() {
      editingFullPresets.push({
        id: 'fullpreset_' + Date.now(),
        name: '新预设',
        icon: '✨',
        prompt: '请基于视频字幕、弹幕和评论进行分析...'
      });
      renderFullPresetEditList();
    });

    // Sync textarea changes back to the active preset
    overlay.querySelector('#ts-fullAnalysisPromptText').addEventListener('input', function() {
      const active = editingFullPresets.find(function(p) { return p.id === editingFullActiveId; });
      if (active) active.prompt = this.value;
    });


    overlay.querySelector('#ts-preset-add').addEventListener('click', function() {
      editingPresets.push({
        id: 'preset_' + Date.now(),
        name: '新预设',
        icon: '✨',
        prompt: '请总结视频内容...'
      });
      renderPresetEditList();
    });

    overlay.querySelector('#ts-htmlPptSkillImport').addEventListener('click', function() {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.md,.txt,text/markdown,text/plain';
      fileInput.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(fileInput);
      fileInput.addEventListener('change', function() {
        const file = fileInput.files[0];
        if (!file) { fileInput.remove(); return; }
        if (file.size > 1024 * 1024) {
          alert('Skill.md 太大了，请控制在 1MB 以内。');
          fileInput.remove();
          return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
          editingHtmlPptSkillText = String(e.target.result || '');
          editingHtmlPptSkillName = file.name || 'Skill.md';
          updateHtmlPptSkillInfo();
          fileInput.remove();
        };
        reader.onerror = function() {
          alert('读取 Skill.md 失败');
          fileInput.remove();
        };
        reader.readAsText(file);
      });
      fileInput.click();
    });

    overlay.querySelector('#ts-htmlPptSkillClear').addEventListener('click', function() {
      editingHtmlPptSkillText = '';
      editingHtmlPptSkillName = '';
      updateHtmlPptSkillInfo();
    });

    const htmlPptLayoutEl = overlay.querySelector('#ts-htmlPptLayoutMode');
    const htmlPptPromptEl = overlay.querySelector('#ts-htmlPptPromptText');
    overlay.querySelector('#ts-htmlPptPromptReset').addEventListener('click', function() {
      if (htmlPptPromptEl && htmlPptLayoutEl) {
        htmlPptPromptEl.value = getDefaultHtmlPptPrompt(htmlPptLayoutEl.value === 'slides' ? 'slides' : 'single');
      }
    });
    if (htmlPptLayoutEl && htmlPptPromptEl) {
      htmlPptLayoutEl.addEventListener('change', function() {
        const nextDefault = getDefaultHtmlPptPrompt(htmlPptLayoutEl.value === 'slides' ? 'slides' : 'single');
        const current = (htmlPptPromptEl.value || '').trim();
        const oldDefaults = [HTML_PPT_SINGLE_PROMPT_TEXT.trim(), HTML_PPT_SLIDES_PROMPT_TEXT.trim(), HTML_PPT_PROMPT_TEXT.trim()];
        if (!current || oldDefaults.indexOf(current) !== -1 || confirm('展示形式已切换，是否把下面的生成提示词也切换为当前模式默认提示词？')) {
          htmlPptPromptEl.value = nextDefault;
        }
      });
    }

    overlay.querySelectorAll('.tabbit-collapse-header').forEach(function(header) {
      header.addEventListener('click', function() {
        const collapse = header.parentElement;
        collapse.classList.toggle('open');
      });
    });

    function closeSettings() { overlay.remove(); }
    overlay.querySelector('#tabbit-settings-close').addEventListener('click', closeSettings);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeSettings();
    });

    async function doFetchModels(append) {
      const apiUrl = overlay.querySelector('#ts-apiUrl').value.trim();
      const apiKey = overlay.querySelector('#ts-apiKey').value.trim();
      const fetchBtn = overlay.querySelector(append ? '#ts-append-models' : '#ts-fetch-models');
      const originalText = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = '⏳ 获取中...';
      try {
        const models = await fetchModelList(apiUrl, apiKey);
        const textarea = overlay.querySelector('#ts-modelList');
        if (append) {
          const existing = textarea.value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
          const merged = Array.from(new Set(existing.concat(models)));
          textarea.value = merged.join('\n');
        } else {
          textarea.value = models.join('\n');
        }
        fetchBtn.textContent = '✅ 已获取 ' + models.length + ' 个';
        setTimeout(function() {
          fetchBtn.textContent = originalText;
          fetchBtn.disabled = false;
        }, 2500);
      } catch (err) {
        console.error('[省流助手] 获取模型列表失败:', err);
        alert('获取模型列表失败：\n' + err.message + '\n\n请检查 API URL 和 API Key 是否正确。');
        fetchBtn.textContent = originalText;
        fetchBtn.disabled = false;
      }
    }
    overlay.querySelector('#ts-fetch-models').addEventListener('click', function() { doFetchModels(false); });
    overlay.querySelector('#ts-append-models').addEventListener('click', function() { doFetchModels(true); });

    overlay.querySelector('#ts-reset-pos').addEventListener('click', function() {
      POSITIONS = {};
      savePositions(POSITIONS);
      if (mainPanel) {
        mainPanel.style.left = '';
        mainPanel.style.top = '';
        mainPanel.style.right = '';
        mainPanel.style.bottom = '';
        mainPanel.style.transform = '';
        mainPanel.style.width = '';
        mainPanel.style.height = '';
      }
      const floatBtn = document.querySelector('#tabbit-float-btn');
      if (floatBtn) {
        floatBtn.style.left = '';
        floatBtn.style.top = '';
        floatBtn.style.right = '';
        floatBtn.style.transform = '';
      }
      alert('位置和尺寸已重置');
    });

    overlay.querySelector('#ts-clear-summary-cache').addEventListener('click', function() {
      if (!confirm('确定要清理所有摘要缓存吗？清理后同一视频会重新请求 API。')) return;
      clearSummaryCache();
      const info = overlay.querySelector('#ts-cache-info');
      if (info) {
        info.textContent = '当前缓存 0 条，约 0K 字符。最多保留 ' + SUMMARY_CACHE_MAX_ENTRIES + ' 条，超出自动清理旧缓存。';
      }
      alert('摘要缓存已清理');
    });

    overlay.querySelector('#ts-save').addEventListener('click', function() {
      const newApiUrl = overlay.querySelector('#ts-apiUrl').value.trim();
      const newApiKey = overlay.querySelector('#ts-apiKey').value.trim();
      const newModel = overlay.querySelector('#ts-model').value.trim();
      const newSummaryMaxTokens = parseInt(overlay.querySelector('#ts-summaryMaxTokens').value, 10);
      const newModelListRaw = overlay.querySelector('#ts-modelList').value;
      const newModelList = newModelListRaw.split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });

      const newFlomoApiUrl = overlay.querySelector('#ts-flomoApiUrl').value.trim();
      const newFlomoTags = overlay.querySelector('#ts-flomoTags').value.trim();
      const newCommentPromptText = overlay.querySelector('#ts-commentPromptText').value.trim();
      const newCommentTextPresets = (overlay.querySelector('#ts-commentTextPresets').value || '')
        .split('\n')
        .map(function(s) { return s.trim(); })
        .filter(Boolean);
      CONFIG.autoSubmitCommentSummary = overlay.querySelector('#ts-autoSubmitCommentSummary').checked;
      const newAutoParse = overlay.querySelector('#ts-autoParse').checked;

      const cleanedPresets = editingPresets
        .map(function(p) {
          return {
            id: p.id || ('preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
            name: (p.name || '').trim() || '未命名',
            icon: (p.icon || '📄').trim(),
            prompt: (p.prompt || '').trim()
          };
        })
        .filter(function(p) { return p.prompt.length > 0; });

      if (cleanedPresets.length === 0) {
        alert('至少保留一个有效预设（提示词不能为空）');
        return;
      }

      let validActiveId = editingActiveId;
      if (!cleanedPresets.find(function(p) { return p.id === validActiveId; })) {
        validActiveId = cleanedPresets[0].id;
      }

      CONFIG.apiUrl = newApiUrl;
      CONFIG.apiKey = newApiKey;
      CONFIG.model = newModel || CONFIG.model;
      CONFIG.summaryMaxTokens = isNaN(newSummaryMaxTokens) ? DEFAULT_CONFIG.summaryMaxTokens : Math.max(500, Math.min(30000, newSummaryMaxTokens));
      CONFIG.flomoApiUrl = newFlomoApiUrl;
      CONFIG.flomoTags = newFlomoTags;
      CONFIG.modelList = newModelList.length > 0 ? newModelList : DEFAULT_CONFIG.modelList;
      CONFIG.promptPresets = cleanedPresets;
      CONFIG.activePresetId = validActiveId;
      currentPresetId = validActiveId;
      const activeP = cleanedPresets.find(function(p) { return p.id === validActiveId; });
      if (activeP) CONFIG.promptText = activeP.prompt;
      CONFIG.commentPromptText = newCommentPromptText || COMMENT_PROMPT_TEXT;
      CONFIG.commentTextPresets = newCommentTextPresets.length > 0 ? newCommentTextPresets : DEFAULT_CONFIG.commentTextPresets.slice();
      const newDanmakuPromptText = overlay.querySelector('#ts-danmakuPromptText').value.trim();
      CONFIG.danmakuPromptText = newDanmakuPromptText || DANMAKU_PROMPT_TEXT;
      // Save full analysis presets
      const cleanedFullPresets = editingFullPresets
        .map(function(p) {
          return {
            id: p.id || ('fullpreset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
            name: (p.name || '').trim() || '未命名',
            icon: (p.icon || '📄').trim(),
            prompt: (p.prompt || '').trim()
          };
        })
        .filter(function(p) { return p.prompt.length > 0; });
      if (cleanedFullPresets.length > 0) {
        CONFIG.fullAnalysisPresets = cleanedFullPresets;
        let validFullActiveId = editingFullActiveId;
        if (!cleanedFullPresets.find(function(p) { return p.id === validFullActiveId; })) {
          validFullActiveId = cleanedFullPresets[0].id;
        }
        CONFIG.activeFullAnalysisPresetId = validFullActiveId;
        var newFullDataMaxChars = parseInt(overlay.querySelector('#ts-fullDataMaxChars').value, 10);
        CONFIG.fullDataMaxChars = isNaN(newFullDataMaxChars) ? 64000 : Math.max(10000, Math.min(200000, newFullDataMaxChars));
        const activeFP = cleanedFullPresets.find(function(p) { return p.id === validFullActiveId; });
        if (activeFP) CONFIG.fullAnalysisPromptText = activeFP.prompt;
      }
      CONFIG.autoSubmitCommentSummary = overlay.querySelector('#ts-autoSubmitCommentSummary').checked;
      const newCommentMaxPages = parseInt(overlay.querySelector('#ts-commentMaxPages').value, 10);
      CONFIG.commentMaxPages = isNaN(newCommentMaxPages) ? 8 : Math.max(1, Math.min(20, newCommentMaxPages));
      const newCommentLimit = parseInt(overlay.querySelector('#ts-commentLimit').value, 10);
      CONFIG.commentLimit = isNaN(newCommentLimit) ? 188 : Math.max(10, Math.min(500, newCommentLimit));
      const newCommentMinDelay = parseInt(overlay.querySelector('#ts-commentMinDelay').value, 10);
      CONFIG.commentMinDelay = isNaN(newCommentMinDelay) ? 1800 : Math.max(500, Math.min(10000, newCommentMinDelay));
      const newCommentMaxDelay = parseInt(overlay.querySelector('#ts-commentMaxDelay').value, 10);
      CONFIG.commentMaxDelay = isNaN(newCommentMaxDelay) ? 3800 : Math.max(1000, Math.min(15000, newCommentMaxDelay));
      const newSkipDuration = parseInt(overlay.querySelector('#ts-skipDuration').value, 10);
      CONFIG.skipDuration = isNaN(newSkipDuration) ? 60 : newSkipDuration;
      CONFIG.autoParse = newAutoParse;
      CONFIG.enableImageGen = overlay.querySelector('#ts-enableImageGen').checked;
      CONFIG.imageGenMode = overlay.querySelector('#ts-imageGenMode').value === 'flow' ? 'flow' : 'api';
      CONFIG.flowProjectUrl = (overlay.querySelector('#ts-flowProjectUrl').value || '').trim() || DEFAULT_FLOW_PROJECT_URL;
      CONFIG.enableFlowBackgroundOpen = overlay.querySelector('#ts-enableFlowBackgroundOpen')
        ? overlay.querySelector('#ts-enableFlowBackgroundOpen').checked
        : true;
      CONFIG.imageGenApiUrl = (overlay.querySelector('#ts-imageGenApiUrl').value || '').trim();
      CONFIG.imageGenApiKey = (overlay.querySelector('#ts-imageGenApiKey').value || '').trim();
      CONFIG.imageGenModel = (overlay.querySelector('#ts-imageGenModel').value || '').trim() || DEFAULT_CONFIG.imageGenModel;
      const normalizedImageSize = normalizeImageSizeInput(overlay.querySelector('#ts-imageGenSize') ? overlay.querySelector('#ts-imageGenSize').value : '');
      if (!normalizedImageSize) {
        alert('生图尺寸格式不正确，请填写类似 1024x1024、1280x720，或 auto');
        return;
      }
      CONFIG.imageGenSize = normalizedImageSize;
      CONFIG.enableImageAutoDownload = overlay.querySelector('#ts-enableImageAutoDownload')
        ? overlay.querySelector('#ts-enableImageAutoDownload').checked
        : true;
      const newImageGenPromptText = (overlay.querySelector('#ts-imageGenPromptText').value || '').trim();
      CONFIG.imageGenPromptText = newImageGenPromptText || IMAGE_GEN_PROMPT_TEXT;
      const newHtmlPptPromptText = (overlay.querySelector('#ts-htmlPptPromptText').value || '').trim();
      CONFIG.htmlPptLayoutMode = overlay.querySelector('#ts-htmlPptLayoutMode').value === 'slides' ? 'slides' : 'single';
      CONFIG.htmlPptPromptText = newHtmlPptPromptText || getDefaultHtmlPptPrompt(CONFIG.htmlPptLayoutMode);
      const newHtmlPptMaxTokens = parseInt(overlay.querySelector('#ts-htmlPptMaxTokens').value, 10);
      CONFIG.htmlPptMaxTokens = isNaN(newHtmlPptMaxTokens) ? 8000 : Math.max(2000, Math.min(30000, newHtmlPptMaxTokens));
      CONFIG.enableHtmlPptDirect = overlay.querySelector('#ts-enableHtmlPptDirect').checked;
      CONFIG.htmlPptSkillText = editingHtmlPptSkillText || '';
      CONFIG.htmlPptSkillName = editingHtmlPptSkillName || '';
      currentModel = CONFIG.model;
      saveConfig(CONFIG);

      if (mainPanel) {
        const modelListEl = mainPanel.querySelector('.tabbit-model-list');
        if (modelListEl) {
          modelListEl.innerHTML = CONFIG.modelList.map(function(m) {
            return '<div class="tabbit-model-chip' + (m === currentModel ? ' active' : '') + '" data-model="' + escapeHtml(m) + '">' + escapeHtml(m) + '</div>';
          }).join('');
          bindModelChips(mainPanel);
        }
        const presetBar = mainPanel.querySelector('.tabbit-preset-bar');
        if (presetBar) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = renderPresetBarHtml();
          const newBar = wrapper.firstElementChild;
          if (newBar) {
            presetBar.replaceWith(newBar);
            bindPresetChips(mainPanel, currentVideoInfo);
          }
        }
      }

      const savedEl = overlay.querySelector('#ts-saved');
      savedEl.style.display = 'inline';
      setTimeout(function() { savedEl.style.display = 'none'; }, 2000);
    });

    overlay.querySelector('#ts-export').addEventListener('click', function() {
      triggerDownload(JSON.stringify(CONFIG, null, 2), 'bili-summary-config.json', 'application/json');
    });

    overlay.querySelector('#ts-import').addEventListener('click', function() {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(fileInput);
      fileInput.addEventListener('change', function() {
        const file = fileInput.files[0];
        if (!file) { fileInput.remove(); return; }
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            const imported = JSON.parse(e.target.result);
            if (imported.apiUrl) overlay.querySelector('#ts-apiUrl').value = imported.apiUrl;
            if (imported.apiKey) overlay.querySelector('#ts-apiKey').value = imported.apiKey;
            if (imported.model) overlay.querySelector('#ts-model').value = imported.model;
            if (imported.summaryMaxTokens !== undefined) {
              var summaryMaxTokensEl = overlay.querySelector('#ts-summaryMaxTokens');
              if (summaryMaxTokensEl) summaryMaxTokensEl.value = imported.summaryMaxTokens;
            }
            if (Array.isArray(imported.modelList)) {
              overlay.querySelector('#ts-modelList').value = imported.modelList.join('\n');
            }
            if (imported.flomoApiUrl !== undefined) overlay.querySelector('#ts-flomoApiUrl').value = imported.flomoApiUrl;
            if (imported.flomoTags !== undefined) overlay.querySelector('#ts-flomoTags').value = imported.flomoTags;
            if (imported.commentPromptText) overlay.querySelector('#ts-commentPromptText').value = imported.commentPromptText;
            if (imported.commentTextPresets !== undefined) {
              var importedCommentTexts = Array.isArray(imported.commentTextPresets)
                ? imported.commentTextPresets
                : String(imported.commentTextPresets || '').split('\n');
              var commentTextPresetsEl = overlay.querySelector('#ts-commentTextPresets');
              if (commentTextPresetsEl) commentTextPresetsEl.value = importedCommentTexts.map(function(s) { return String(s || '').trim(); }).filter(Boolean).join('\n') || '省流';
            }
            if (imported.autoSubmitCommentSummary !== undefined) {
              var autoSubmitEl = overlay.querySelector('#ts-autoSubmitCommentSummary');
              if (autoSubmitEl) autoSubmitEl.checked = !!imported.autoSubmitCommentSummary;
            }
            if (imported.danmakuPromptText !== undefined) overlay.querySelector('#ts-danmakuPromptText').value = imported.danmakuPromptText;
            if (imported.fullDataMaxChars !== undefined) { var fdcEl = overlay.querySelector('#ts-fullDataMaxChars'); if (fdcEl) fdcEl.value = imported.fullDataMaxChars; }
            if (Array.isArray(imported.fullAnalysisPresets) && imported.fullAnalysisPresets.length > 0) {
              editingFullPresets = JSON.parse(JSON.stringify(imported.fullAnalysisPresets));
              editingFullActiveId = imported.activeFullAnalysisPresetId || editingFullPresets[0].id;
              renderFullPresetEditList();
              syncFullPromptTextarea();
            }
            if (imported.commentMaxPages !== undefined) overlay.querySelector('#ts-commentMaxPages').value = imported.commentMaxPages;
            if (imported.commentLimit !== undefined) overlay.querySelector('#ts-commentLimit').value = imported.commentLimit;
            if (imported.commentMinDelay !== undefined) overlay.querySelector('#ts-commentMinDelay').value = imported.commentMinDelay;
            if (imported.commentMaxDelay !== undefined) overlay.querySelector('#ts-commentMaxDelay').value = imported.commentMaxDelay;
            if (imported.skipDuration !== undefined) overlay.querySelector('#ts-skipDuration').value = imported.skipDuration;
            if (imported.autoParse !== undefined) overlay.querySelector('#ts-autoParse').checked = !!imported.autoParse;
            if (imported.enableImageGen !== undefined) overlay.querySelector('#ts-enableImageGen').checked = !!imported.enableImageGen;
            if (imported.imageGenMode !== undefined) { var igModeEl = overlay.querySelector('#ts-imageGenMode'); if (igModeEl) igModeEl.value = imported.imageGenMode === 'flow' ? 'flow' : 'api'; }
            if (imported.flowProjectUrl !== undefined) { var flowProjectUrlEl = overlay.querySelector('#ts-flowProjectUrl'); if (flowProjectUrlEl) flowProjectUrlEl.value = imported.flowProjectUrl || DEFAULT_FLOW_PROJECT_URL; }
            if (imported.enableFlowBackgroundOpen !== undefined) { var flowBackgroundEl = overlay.querySelector('#ts-enableFlowBackgroundOpen'); if (flowBackgroundEl) flowBackgroundEl.checked = !!imported.enableFlowBackgroundOpen; }
            if (imported.imageGenApiUrl !== undefined) overlay.querySelector('#ts-imageGenApiUrl').value = imported.imageGenApiUrl;
            if (imported.imageGenApiKey !== undefined) overlay.querySelector('#ts-imageGenApiKey').value = imported.imageGenApiKey;
            if (imported.imageGenModel) overlay.querySelector('#ts-imageGenModel').value = imported.imageGenModel;
            if (imported.imageGenSize) { var igSizeEl = overlay.querySelector('#ts-imageGenSize'); if (igSizeEl) igSizeEl.value = imported.imageGenSize; }
            if (imported.enableImageAutoDownload !== undefined) {
              var igAutoDownloadEl = overlay.querySelector('#ts-enableImageAutoDownload');
              if (igAutoDownloadEl) igAutoDownloadEl.checked = !!imported.enableImageAutoDownload;
            }
            if (imported.imageGenPromptText !== undefined) overlay.querySelector('#ts-imageGenPromptText').value = imported.imageGenPromptText;
            if (imported.htmlPptPromptText !== undefined) {
              var htmlPptPromptEl = overlay.querySelector('#ts-htmlPptPromptText');
              if (htmlPptPromptEl) htmlPptPromptEl.value = imported.htmlPptPromptText;
            }
            if (imported.htmlPptLayoutMode !== undefined) {
              var htmlPptLayoutEl = overlay.querySelector('#ts-htmlPptLayoutMode');
              if (htmlPptLayoutEl) htmlPptLayoutEl.value = imported.htmlPptLayoutMode === 'slides' ? 'slides' : 'single';
            }
            if (imported.htmlPptMaxTokens !== undefined) {
              var htmlPptMaxTokensEl = overlay.querySelector('#ts-htmlPptMaxTokens');
              if (htmlPptMaxTokensEl) htmlPptMaxTokensEl.value = imported.htmlPptMaxTokens;
            }
            if (imported.enableHtmlPptDirect !== undefined) {
              var htmlPptDirectEl = overlay.querySelector('#ts-enableHtmlPptDirect');
              if (htmlPptDirectEl) htmlPptDirectEl.checked = !!imported.enableHtmlPptDirect;
            }
            if (imported.htmlPptSkillText !== undefined) {
              editingHtmlPptSkillText = String(imported.htmlPptSkillText || '');
              editingHtmlPptSkillName = imported.htmlPptSkillName || 'Skill.md';
              updateHtmlPptSkillInfo();
            }

            if (Array.isArray(imported.promptPresets) && imported.promptPresets.length > 0) {
              editingPresets = JSON.parse(JSON.stringify(imported.promptPresets));
              editingActiveId = imported.activePresetId || editingPresets[0].id;
              renderPresetEditList();
            } else if (imported.promptText) {
              editingPresets = [{
                id: 'preset_imported_' + Date.now(),
                name: '导入的提示词',
                icon: '📥',
                prompt: imported.promptText
              }];
              editingActiveId = editingPresets[0].id;
              renderPresetEditList();
            }
            alert('配置已导入，请点击「保存」使其生效。');
          } catch(err) {
            alert('导入失败：JSON 格式错误\n' + err.message);
          }
        };
        reader.readAsText(file);
        fileInput.remove();
      });
      fileInput.click();
    });

    overlay.querySelector('#ts-reset').addEventListener('click', function() {
      if (!confirm('确定要重置所有配置为默认值吗？')) return;
      overlay.querySelector('#ts-apiUrl').value = DEFAULT_CONFIG.apiUrl;
      overlay.querySelector('#ts-apiKey').value = DEFAULT_CONFIG.apiKey;
      overlay.querySelector('#ts-model').value = DEFAULT_CONFIG.model;
      var summaryMaxTokensReset = overlay.querySelector('#ts-summaryMaxTokens'); if (summaryMaxTokensReset) summaryMaxTokensReset.value = DEFAULT_CONFIG.summaryMaxTokens;
      overlay.querySelector('#ts-modelList').value = DEFAULT_CONFIG.modelList.join('\n');
      overlay.querySelector('#ts-flomoApiUrl').value = '';
      overlay.querySelector('#ts-flomoTags').value = DEFAULT_CONFIG.flomoTags;
      overlay.querySelector('#ts-commentPromptText').value = COMMENT_PROMPT_TEXT;
      overlay.querySelector('#ts-commentTextPresets').value = DEFAULT_CONFIG.commentTextPresets.join('\n');
      CONFIG.autoSubmitCommentSummary = false;
      var autoSubmitReset = overlay.querySelector('#ts-autoSubmitCommentSummary'); if (autoSubmitReset) autoSubmitReset.checked = false;
      overlay.querySelector('#ts-commentMaxPages').value = DEFAULT_CONFIG.commentMaxPages;
      overlay.querySelector('#ts-commentLimit').value = DEFAULT_CONFIG.commentLimit;
      overlay.querySelector('#ts-commentMinDelay').value = DEFAULT_CONFIG.commentMinDelay;
      overlay.querySelector('#ts-commentMaxDelay').value = DEFAULT_CONFIG.commentMaxDelay;
      overlay.querySelector('#ts-skipDuration').value = DEFAULT_CONFIG.skipDuration;
      overlay.querySelector('#ts-autoParse').checked = DEFAULT_CONFIG.autoParse;
      overlay.querySelector('#ts-enableImageGen').checked = false;
      var imageGenModeReset = overlay.querySelector('#ts-imageGenMode'); if (imageGenModeReset) imageGenModeReset.value = DEFAULT_CONFIG.imageGenMode;
      var flowProjectUrlReset = overlay.querySelector('#ts-flowProjectUrl'); if (flowProjectUrlReset) flowProjectUrlReset.value = DEFAULT_CONFIG.flowProjectUrl;
      var flowBackgroundReset = overlay.querySelector('#ts-enableFlowBackgroundOpen'); if (flowBackgroundReset) flowBackgroundReset.checked = DEFAULT_CONFIG.enableFlowBackgroundOpen;
      overlay.querySelector('#ts-imageGenApiUrl').value = '';
      overlay.querySelector('#ts-imageGenApiKey').value = '';
      overlay.querySelector('#ts-imageGenModel').value = DEFAULT_CONFIG.imageGenModel;
      var igSizeReset = overlay.querySelector('#ts-imageGenSize'); if (igSizeReset) igSizeReset.value = '1024x1024';
      var igAutoDownloadReset = overlay.querySelector('#ts-enableImageAutoDownload'); if (igAutoDownloadReset) igAutoDownloadReset.checked = DEFAULT_CONFIG.enableImageAutoDownload;
      overlay.querySelector('#ts-imageGenPromptText').value = IMAGE_GEN_PROMPT_TEXT;
      var htmlPptLayoutReset = overlay.querySelector('#ts-htmlPptLayoutMode'); if (htmlPptLayoutReset) htmlPptLayoutReset.value = DEFAULT_CONFIG.htmlPptLayoutMode;
      var htmlPptPromptReset = overlay.querySelector('#ts-htmlPptPromptText'); if (htmlPptPromptReset) htmlPptPromptReset.value = getDefaultHtmlPptPrompt(DEFAULT_CONFIG.htmlPptLayoutMode);
      var htmlPptMaxTokensReset = overlay.querySelector('#ts-htmlPptMaxTokens'); if (htmlPptMaxTokensReset) htmlPptMaxTokensReset.value = DEFAULT_CONFIG.htmlPptMaxTokens;
      var htmlPptDirectReset = overlay.querySelector('#ts-enableHtmlPptDirect'); if (htmlPptDirectReset) htmlPptDirectReset.checked = DEFAULT_CONFIG.enableHtmlPptDirect;
      editingHtmlPptSkillText = '';
      editingHtmlPptSkillName = '';
      updateHtmlPptSkillInfo();
      editingPresets = JSON.parse(JSON.stringify(DEFAULT_PRESETS));
      editingActiveId = 'preset_default';
      renderPresetEditList();
      var danmakuPromptReset = overlay.querySelector('#ts-danmakuPromptText'); if (danmakuPromptReset) danmakuPromptReset.value = DANMAKU_PROMPT_TEXT;
      var fullDataMaxCharsReset = overlay.querySelector('#ts-fullDataMaxChars'); if (fullDataMaxCharsReset) fullDataMaxCharsReset.value = DEFAULT_CONFIG.fullDataMaxChars;
      editingFullPresets = JSON.parse(JSON.stringify(DEFAULT_FULL_ANALYSIS_PRESETS));
      editingFullActiveId = 'fullpreset_video_review';
      renderFullPresetEditList();
      syncFullPromptTextarea();
    });
  }
  // ==================== 字幕可用性检测 ====================
  function checkAnySubtitleAvailable() {
    const aiSubtitleButton = document.querySelector('.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]');
    const subtitleButtons = document.querySelectorAll('.bpx-player-ctrl-subtitle-language-item');
    const subtitleToggle = document.querySelector('.bpx-player-ctrl-subtitle');
    return aiSubtitleButton !== null || subtitleButtons.length > 0 || subtitleToggle !== null;
  }

  function waitForSubtitleButton(maxWait, interval, signal) {
    maxWait = maxWait || 2000;
    interval = interval || 200;
    return new Promise(function(resolve, reject) {
      const startTime = Date.now();
      let timer = null;
      function cleanup() {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      function onAbort() {
        cleanup();
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        reject(abortErr);
      }
      if (signal && signal.aborted) {
        onAbort();
        return;
      }
      if (signal) signal.addEventListener('abort', onAbort);
      function check() {
        if (checkAnySubtitleAvailable()) {
          console.log('[省流助手] 检测到字幕按钮，耗时 ' + (Date.now() - startTime) + 'ms');
          cleanup();
          resolve(true);
          return;
        }
        if (Date.now() - startTime >= maxWait) {
          console.log('[省流助手] 等待字幕按钮超时（' + maxWait + 'ms），判定为无字幕');
          cleanup();
          resolve(false);
          return;
        }
        timer = setTimeout(check, interval);
      }
      check();
    });
  }

  function getRouteKey() {
    return window.location.href;
  }

  function resetRuntimeForRouteChange() {
    abortCurrentTask();
    currentSubtitleManualFallback = null;
    rawMarkdownResult = '';
    rawTranscript = '';
    rawSubtitleBody = [];
    currentVideoInfo = null;
    conversationHistory = [];
    commentConversationHistory = [];
    isCommentSummarizing = false;
    isDanmakuAnalyzing = false;
    isFullAnalyzing = false;
    rawDanmakuChatContext = '';
    rawCommentsChatContext = '';
    rawFullDataChatContext = '';
    hasParsed = false;
    currentPresetId = CONFIG.activePresetId || 'preset_default';
    const panel = document.querySelector('#tabbit-ai-summary-panel');
    if (panel) panel.remove();
    hideFloatBtn();
  }

  function isStaleRoute(generation) {
    return generation !== routeGeneration || getRouteKey() !== lastRouteKey;
  }

  function scheduleRouteRestart() {
    const routeKey = getRouteKey();
    if (routeKey === lastRouteKey) return;
    lastRouteKey = routeKey;
    routeGeneration += 1;
    if (routeRestartTimer) clearTimeout(routeRestartTimer);
    routeRestartTimer = setTimeout(function() {
      resetRuntimeForRouteChange();
      if (CONFIG.autoParse) {
        startParsing();
      } else {
        showFloatOnlyMode();
      }
    }, 800);
  }

  function installRouteWatcher() {
    if (window.__BILI_SUBTITLE_SUMMARY_ROUTE_WATCHER__) return;
    window.__BILI_SUBTITLE_SUMMARY_ROUTE_WATCHER__ = true;
    const fire = function() {
      setTimeout(scheduleRouteRestart, 120);
    };
    ['pushState', 'replaceState'].forEach(function(method) {
      const original = history[method];
      history[method] = function() {
        const ret = original.apply(this, arguments);
        fire();
        return ret;
      };
    });
    window.addEventListener('popstate', fire);
  }

  // ==================== 自动启动主流程 ====================
  // 🆕 字幕获取整体超时（5 秒），防止 B 站 SPA 初始化竞态导致永久卡住
  const SUBTITLE_FETCH_OVERALL_TIMEOUT_MS = 5000;

  async function startParsing() {
    if (hasParsed) return;
    hasParsed = true;
    const parsingGeneration = routeGeneration;
    let panel = null;
    let videoInfo = null;
    let subtitleAbortController = null;
    let subtitleAbortBtnWrap = null;
    let subtitleManualFallbackShown = false;
    let subtitleForceStopped = false;
    let overallTimer = null;
    function cleanupSubtitleAbortUi() {
      if (subtitleAbortBtnWrap && subtitleAbortBtnWrap.parentNode) {
        subtitleAbortBtnWrap.remove();
      }
      subtitleAbortBtnWrap = null;
      if (currentAbortController === subtitleAbortController) {
        currentAbortController = null;
      }
      if (currentSubtitleManualFallback === forceStopAutoSubtitleFetch) {
        currentSubtitleManualFallback = null;
      }
    }
    function showInterruptedSubtitleManualState() {
      if (subtitleManualFallbackShown) return;
      subtitleManualFallbackShown = true;
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
      cleanupSubtitleAbortUi();
      if (panel && videoInfo && !isStaleRoute(parsingGeneration)) {
        showNoSubtitleState(panel, videoInfo, false, {
          icon: '⏹',
          title: '已停止自动获取',
          desc: '自动字幕获取已打断。现在可以手动获取字幕，或直接上传 srt/txt/粘贴字幕内容。'
        });
      }
    }
    function forceStopAutoSubtitleFetch() {
      if (subtitleForceStopped) return;
      subtitleForceStopped = true;
      console.log('[省流助手] 强制停止自动字幕获取，切换到手动处理');
      showInterruptedSubtitleManualState();
      if (subtitleAbortController && !subtitleAbortController.signal.aborted) {
        try { subtitleAbortController.abort(); } catch(e) {}
      }
      if (currentAbortController === subtitleAbortController) {
        currentAbortController = null;
      }
    }
    function throwIfSubtitleForceStopped() {
      if (subtitleForceStopped) {
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      throwIfAborted(subtitleAbortController && subtitleAbortController.signal);
    }
    try {
      lastRouteKey = getRouteKey();

      console.log('[省流助手] 开始解析...');
      videoInfo = getVideoInfo();
      if (!videoInfo.bvid) {
        console.log('[省流助手] 无法获取BVID，跳过');
        hasParsed = false;
        return;
      }
      currentVideoInfo = videoInfo;
      console.log('[省流助手] 视频信息 - 标题: ' + videoInfo.title + ', BVID: ' + videoInfo.bvid + ', CID: ' + videoInfo.cid);

      createStyles();
      panel = createPanel(videoInfo);

      const skipSec = CONFIG.skipDuration || 60;
      if (videoInfo.duration > 0 && videoInfo.duration < skipSec) {
        console.log('[省流助手] 视频时长不足' + skipSec + '秒，跳过自动字幕获取');
        showNoSubtitleState(panel, videoInfo, true);
        return;
      }

      abortCurrentTask();
      subtitleAbortController = new AbortController();
      currentAbortController = subtitleAbortController;
      currentSubtitleManualFallback = forceStopAutoSubtitleFetch;

      // 🆕 用 Promise.race 包裹整个字幕获取流程，防止永久卡住
      var overallTimeout = new Promise(function(_, reject) {
        overallTimer = setTimeout(function() {
          if (subtitleAbortController && !subtitleAbortController.signal.aborted) {
            try { subtitleAbortController.abort(); } catch(e) {}
          }
          reject(new Error('字幕获取超时（' + Math.round(SUBTITLE_FETCH_OVERALL_TIMEOUT_MS / 1000) + '秒）'));
        }, SUBTITLE_FETCH_OVERALL_TIMEOUT_MS);
      });

      var fetchFlow = (async function() {
        console.log('[省流助手] 检测字幕可用性...');
        const loadingSpan = panel.querySelector('.tabbit-panel-content .tabbit-loading span');
        if (loadingSpan) loadingSpan.textContent = '正在检测字幕可用性...';

        throwIfSubtitleForceStopped();
        const hasSubtitleButton = await waitForSubtitleButton(2000, 200, subtitleAbortController.signal);
        throwIfSubtitleForceStopped();
        if (isStaleRoute(parsingGeneration)) return 'stale';
        if (!hasSubtitleButton) {
          return 'no_subtitle';
        }

        if (loadingSpan) loadingSpan.textContent = '正在获取字幕并生成摘要...';

        let subtitles = await fetchSubtitles(videoInfo.cid, videoInfo.bvid, subtitleAbortController.signal);
        throwIfSubtitleForceStopped();
        if (isStaleRoute(parsingGeneration)) return 'stale';

        // ✅ 兜底：首次获取字幕为空时，等待 2 秒后重新获取视频信息并重试
        if (subtitles.length === 0) {
          console.log('[省流助手] 首次获取字幕为空，2 秒后重试...');
          if (loadingSpan) loadingSpan.textContent = '首次获取字幕为空，等待重试...';
          await randomDelay(2000, 2000, subtitleAbortController.signal);
          throwIfSubtitleForceStopped();
          if (isStaleRoute(parsingGeneration)) return 'stale';

          var freshInfo = getVideoInfo();
          if (freshInfo.bvid) {
            videoInfo = freshInfo;
            currentVideoInfo = videoInfo;
            console.log('[省流助手] 重试时刷新视频信息 - BVID: ' + videoInfo.bvid + ', CID: ' + videoInfo.cid);
          }

          if (loadingSpan) loadingSpan.textContent = '正在重新获取字幕...';
          subtitles = await fetchSubtitles(videoInfo.cid, videoInfo.bvid, subtitleAbortController.signal);
          throwIfSubtitleForceStopped();
          if (isStaleRoute(parsingGeneration)) return 'stale';
        }

        if (subtitles.length === 0) {
          return 'no_subtitle';
        }

        const targetSubtitle = subtitles.find(s => s.lan === 'zh-CN' || s.lan === 'ai-zh') || subtitles[0];
        const content = await fetchSubtitleContent(targetSubtitle.subtitle_url, subtitleAbortController.signal);
        throwIfSubtitleForceStopped();
        if (isStaleRoute(parsingGeneration)) return 'stale';
        if (content.length === 0) {
          return 'no_subtitle';
        }

        rawSubtitleBody = content;
        const transcript = formatTranscript(content);
        if (!transcript.trim()) {
          return 'no_subtitle';
        }

        return transcript;
      })();

      var fetchResult = await Promise.race([fetchFlow, overallTimeout]);
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
      throwIfSubtitleForceStopped();
      cleanupSubtitleAbortUi();

      if (fetchResult === 'stale') return;
      if (fetchResult === 'no_subtitle') {
        showNoSubtitleState(panel, videoInfo);
        return;
      }

      // fetchResult 是 transcript 字符串
      rawTranscript = fetchResult;
      console.log('[省流助手] 字幕获取完成');
      if (isStaleRoute(parsingGeneration)) return;
      await runSummary(panel, fetchResult, videoInfo);
    } catch (err) {
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
      cleanupSubtitleAbortUi();
      if (subtitleManualFallbackShown) return;
      if (isAbortError(err)) {
        console.log('[省流助手] 自动字幕获取已被用户打断');
        showInterruptedSubtitleManualState();
        return;
      }
      console.error('[省流助手] 自动解析失败:', err);
      hasParsed = false;
      if (panel && videoInfo && !isStaleRoute(parsingGeneration)) {
        showNoSubtitleState(panel, videoInfo);
        const stateEl = panel.querySelector('.tabbit-no-subtitle');
        if (stateEl) {
          stateEl.insertAdjacentHTML('beforeend', '<div style="font-size:12px;color:#c00;margin-top:8px;">自动获取失败：' + escapeHtml(err.message || String(err)) + '</div>');
        }
      }
    }
  }

  function showFloatOnlyMode() {
    console.log('[省流助手] 自动解析已关闭，仅显示悬浮唤出按钮');
    createStyles();
    showFloatBtn(null);
  }

  function init() {
    lastRouteKey = getRouteKey();
    // ✅ 延迟安装路由监听器：等第一次 startParsing 完成后再安装
    // 避免 B 站页面初始化时的 replaceState（URL 规范化）被误判为路由切换
    setTimeout(async () => {
      if (CONFIG.autoParse) {
        await startParsing();
      } else {
        showFloatOnlyMode();
      }
      // 第一次解析流程结束后再安装路由监听器
      installRouteWatcher();
    }, INIT_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
