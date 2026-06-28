// ==UserScript==
// @name         饺子 AI 网页摘要跳转助手
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      0.4.2
// @description  精简跳转模式：抓取网页正文，套提示词模板，发送到常驻 ChatGPT 接收端自动提交。
// @author       次元饺子
// @icon         https://img.icons8.com/?size=100&id=90385&format=png&color=000000
// @match        *://*/*
// @require      https://cdn.jsdelivr.net/npm/@mozilla/readability@0.6.0/Readability.js
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'tabbit_ai_jump_summary_config_v1';
  const PENDING_TASK_KEY = 'tabbit_ai_jump_pending_task_v1';
  const CHATGPT_HEARTBEAT_KEY = 'tabbit_ai_jump_chatgpt_heartbeat_v1';
  const CHATGPT_OPENING_KEY = 'tabbit_ai_jump_chatgpt_opening_v1';
  const TASK_LOG_KEY = 'tabbit_ai_jump_task_log_v1';
  const AUTO_RUN_STATE_KEY = 'tabbit_ai_jump_auto_run_state_v1';
  const PANEL_ID = 'tabbit-ai-jump-panel';
  const FLOAT_BTN_ID = 'tabbit-ai-jump-float-btn';
  const STYLE_ID = 'tabbit-ai-jump-style';
  const CHATGPT_TASK_TTL_MS = 5 * 60 * 1000;
  const CHATGPT_HEARTBEAT_INTERVAL_MS = 10000;
  const CHATGPT_HEARTBEAT_MAX_AGE_MS = 35000;
  const CHATGPT_OPENING_COOLDOWN_MS = 45000;
  const READABILITY_MIN_TEXT_LENGTH = 160;

  const LEGACY_DEFAULT_PROMPT_PREFIX = '请阅读下面网页内容，并用中文给我一份结构化摘要。';

  const DEFAULT_PROMPT_TEXT =
    '你是我的网页阅读助手。请基于下面材料，用中文给出一份紧凑、有用的摘要。\n\n' +
    '请输出：\n' +
    '- 一句话结论\n' +
    '- 关键点：3-5 条\n' +
    '- 重要细节：只列数据、人物、时间、因果、风险\n' +
    '- 对我有什么用：用大白话说明';

  const DEFAULT_CONFIG = {
    targetAiUrl: 'https://chatgpt.com/',
    focusChatGptOnSend: false,
    actionMode: 'send',
    extractMaxChars: 16000,
    autoRunEnabled: false,
    autoRunRules: [
      'https://www.bilibili.com/opus/*',
      'https://mp.weixin.qq.com/*',
      'https://nga.178.com/read.php*',
      'https://bbs.nga.cn/read.php*',
      'https://www.jisilu.cn/*',
      'https://www.gelonghui.com/*',
      'https://sspai.com/post/*'
    ],
    autoRunCooldownMinutes: 30,
    floatButton: { offsetX: null, offsetY: null },
    panel: { width: null, height: null, left: null, top: null },
    defaultPromptTemplateId: 'default',
    promptTemplates: [
      { id: 'default', name: '默认总结', text: DEFAULT_PROMPT_TEXT },
      { id: 'plain', name: '大白话解释', text: '请用非常简单、直白、短句的方式解释下面网页。\n\n请输出：\n1. 它在说什么\n2. 最重要的 3 个点\n3. 普通人应该怎么理解\n4. 这件事对我有什么用' },
      { id: 'investment', name: '投资视角', text: '请从投资和商业角度总结下面网页。\n\n重点关注：\n1. 公司、行业、产品或商业模式\n2. 关键数据和变化趋势\n3. 市场预期和分歧\n4. 风险点\n5. 对普通投资者有什么参考价值' },
      { id: 'forum', name: '论坛讨论', text: '请总结下面帖子或讨论页。\n\n重点输出：\n1. 楼主核心观点\n2. 主要争议点\n3. 支持方观点\n4. 反对方观点\n5. 最值得关注的结论' }
    ]
  };

  let config = loadConfig();
  let panelEl = null;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncateText(text, maxLen) {
    const value = String(text || '').trim();
    const max = Number(maxLen || 0);
    if (!max || value.length <= max) return value;
    return value.slice(0, max) + `\n\n（网页正文已截断到 ${max} 字符）`;
  }

  function isChatGptUrl(url) {
    try {
      const host = new URL(url, location.href).hostname.toLowerCase();
      return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com' || host.endsWith('.chat.openai.com');
    } catch (err) {
      return false;
    }
  }

  function isCurrentChatGptPage() {
    return isChatGptUrl(location.href);
  }

  function getChatGptReceiverId() {
    const key = 'tabbit_chatgpt_receiver_id';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `receiver_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  }

  function normalizeAiUrlForCompare(url) {
    return String(url || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }

  function shouldRequireExactChatGptUrl(expectedUrl) {
    try {
      const parsed = new URL(expectedUrl || DEFAULT_CONFIG.targetAiUrl, location.href);
      const path = parsed.pathname.replace(/\/+$/, '');
      return !!path && path !== '/' && path !== '/';
    } catch (err) {
      return false;
    }
  }

  function normalizePromptTemplates(templates) {
    const result = [];
    const used = new Set();
    (Array.isArray(templates) ? templates : []).forEach((item) => {
      const name = String(item?.name || '').trim();
      const text = String(item?.text || '').trim();
      if (!name || !text) return;
      let id = String(item?.id || '').trim().replace(/[^\w-]/g, '');
      if (!id || used.has(id)) id = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      used.add(id);
      result.push({ id, name, text });
    });
    return result.length ? result : clone(DEFAULT_CONFIG.promptTemplates);
  }

  function normalizeUrlRules(rules) {
    const seen = new Set();
    const result = [];
    (Array.isArray(rules) ? rules : []).forEach((rule) => {
      const value = String(rule || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push(value);
    });
    return result;
  }

  function urlPatternToRegExp(pattern) {
    const escaped = String(pattern || '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  }

  function matchUrlRules(url, rules) {
    return normalizeUrlRules(rules).some((rule) => {
      try { return urlPatternToRegExp(rule).test(url); } catch (err) { return false; }
    });
  }

  function loadConfig() {
    try {
      const raw = typeof GM_getValue === 'function' ? GM_getValue(STORAGE_KEY, '') : '';
      const saved = raw ? JSON.parse(raw) : {};
      const merged = { ...clone(DEFAULT_CONFIG), ...saved };
      merged.promptTemplates = normalizePromptTemplates(merged.promptTemplates);
      merged.promptTemplates = merged.promptTemplates.map((tpl) => {
        if (tpl.id === 'default' && String(tpl.text || '').trim().startsWith(LEGACY_DEFAULT_PROMPT_PREFIX)) {
          return { ...tpl, text: DEFAULT_PROMPT_TEXT };
        }
        return tpl;
      });
      if (!merged.promptTemplates.some((tpl) => tpl.id === merged.defaultPromptTemplateId)) {
        merged.defaultPromptTemplateId = merged.promptTemplates[0].id;
      }
      merged.extractMaxChars = Number(merged.extractMaxChars || DEFAULT_CONFIG.extractMaxChars);
      merged.targetAiUrl = String(merged.targetAiUrl || DEFAULT_CONFIG.targetAiUrl).trim();
      merged.focusChatGptOnSend = false;
      merged.actionMode = ['copy', 'send', 'open'].includes(saved.actionMode) ? saved.actionMode : DEFAULT_CONFIG.actionMode;
      merged.autoRunEnabled = saved.autoRunEnabled === true;
      merged.autoRunRules = normalizeUrlRules(saved.autoRunRules || DEFAULT_CONFIG.autoRunRules);
      merged.autoRunCooldownMinutes = Math.max(1, Number(saved.autoRunCooldownMinutes || DEFAULT_CONFIG.autoRunCooldownMinutes));
      merged.floatButton = { ...clone(DEFAULT_CONFIG.floatButton), ...(saved.floatButton || {}) };
      merged.panel = { ...clone(DEFAULT_CONFIG.panel), ...(saved.panel || {}) };
      return merged;
    } catch (err) {
      console.warn('[饺子AI跳转] 配置读取失败，使用默认配置：', err);
      return clone(DEFAULT_CONFIG);
    }
  }

  function saveConfig() {
    config.promptTemplates = normalizePromptTemplates(config.promptTemplates);
    if (!config.promptTemplates.some((tpl) => tpl.id === config.defaultPromptTemplateId)) {
      config.defaultPromptTemplateId = config.promptTemplates[0].id;
    }
    if (typeof GM_setValue === 'function') {
      GM_setValue(STORAGE_KEY, JSON.stringify(config));
    }
  }

  function getDefaultTemplate() {
    return config.promptTemplates.find((tpl) => tpl.id === config.defaultPromptTemplateId) || config.promptTemplates[0];
  }

  function removeNoiseNodes(root) {
    root.querySelectorAll([
      'script',
      'style',
      'noscript',
      'iframe',
      'svg',
      'canvas',
      'nav',
      'header',
      'footer',
      'aside',
      'form',
      'button',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="navigation"]',
      '[role="dialog"]',
      '[aria-hidden="true"]',
      '[id^="tabbit-"]',
      '[class*="tabbit-"]',
      '[id^="mpush-"]',
      '[class*="mpush-"]',
      '[id*="web-summary"]',
      '[class*="web-summary"]',
      '.nav',
      '.navbar',
      '.header',
      '.footer',
      '.sidebar',
      '.comment',
      '.comments',
      '.ad',
      '.ads'
    ].join(',')).forEach((el) => el.remove());
  }

  function normalizeExtractedText(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .filter((line) => !/^(网页浏览记录助手|AI 网页摘要跳转助手|饺子 AI 网页摘要助手)$/.test(line))
      .filter((line) => !/^(读取同步状态中|Enter 发送|Shift\+Enter 换行|开启自动保存记录|推送功能已移到|坚果云账号与历史同步)/.test(line))
      .filter((line) => !/^(API URL|API Key|Temperature|Max Tokens|模型|模板ID|图标|名称|描述|提示词内容|账号（邮箱）|应用密码)$/.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getSiteSpecificContentNode(root) {
    const host = location.hostname.toLowerCase();
    const selectorGroups = [];

    if (host.includes('bilibili.com')) {
      selectorGroups.push(
        '.opus-module-content',
        '.bili-rich-text__content',
        '.bili-rich-text',
        '.bili-dyn-content',
        '.dyn-card-opus__content',
        '[class*="opus"][class*="content"]'
      );
    } else if (host === 'mp.weixin.qq.com') {
      selectorGroups.push('#js_content', '.rich_media_content');
    } else if (host.includes('nga.cn') || host.includes('nga.178.com')) {
      selectorGroups.push('#postcontent', '.postcontent', '.forumbox', '.read-content', '[id^="postcontent"]');
    } else if (host.includes('jisilu.cn')) {
      selectorGroups.push('.aw-question-detail', '.aw-item', '.markitup-box', '.aw-mod-body');
    } else if (host.includes('gelonghui.com')) {
      selectorGroups.push('article', '.article-content', '.detail-content', '.news-detail-content');
    } else if (host.includes('sspai.com')) {
      selectorGroups.push('article', '.article-body', '.content', '.post-content');
    }

    for (const selector of selectorGroups) {
      const node = root.querySelector(selector);
      if (node && normalizeExtractedText(node.innerText || node.textContent || '').length > 20) return node;
    }
    return null;
  }

  function extractWithReadability() {
    const ReadabilityCtor =
      typeof Readability === 'function'
        ? Readability
        : (typeof window !== 'undefined' && typeof window.Readability === 'function' ? window.Readability : null);
    if (!ReadabilityCtor) return '';
    try {
      const clonedDoc = document.cloneNode(true);
      clonedDoc.querySelectorAll([
        '[id^="tabbit-"]',
        '[class*="tabbit-"]',
        '[id^="mpush-"]',
        '[class*="mpush-"]',
        '[id*="web-summary"]',
        '[class*="web-summary"]'
      ].join(',')).forEach((el) => el.remove());

      const article = new ReadabilityCtor(clonedDoc, {
        charThreshold: READABILITY_MIN_TEXT_LENGTH
      }).parse();
      const text = normalizeExtractedText(article?.textContent || '');
      if (text.length >= READABILITY_MIN_TEXT_LENGTH) return text;
      return '';
    } catch (err) {
      return '';
    }
  }

  function extractWithCurrentSelectors() {
    try {
      const cloned = document.body.cloneNode(true);
      removeNoiseNodes(cloned);

      const mainNode =
        getSiteSpecificContentNode(cloned) ||
        cloned.querySelector('article') ||
        cloned.querySelector('[itemprop="articleBody"]') ||
        cloned.querySelector('.post-content, .entry-content, .article-content, .article-body, .markdown-body, .rich_media_content') ||
        cloned.querySelector('main') ||
        cloned;

      const text = normalizeExtractedText(mainNode.innerText || mainNode.textContent || '');

      return text;
    } catch (err) {
      return '';
    }
  }

  function getPageText() {
    const readabilityText = extractWithReadability();
    if (readabilityText) return truncateText(readabilityText, config.extractMaxChars);

    const selectorText = extractWithCurrentSelectors();
    if (selectorText) return truncateText(selectorText, config.extractMaxChars);

    const fallback = normalizeExtractedText(document.body?.innerText || document.body?.textContent || '');
    return truncateText(fallback, config.extractMaxChars);
  }

  function buildFinalPrompt(templateText) {
    const pageText = getPageText();
    const title = String(document.title || '').replace(/\s+/g, ' ').trim() || '无标题';
    const url = location.href;

    return [
      String(templateText || DEFAULT_PROMPT_TEXT).trim(),
      '',
      '补充约束：只根据下面材料回答；忽略导航、按钮、广告、登录提示和油猴面板文字；材料不足就直说。',
      '',
      `【标题】${title}`,
      `【链接】${url}`,
      '',
      '【正文】',
      pageText || '（没有抓到有效正文）'
    ].join('\n');
  }

  function savePendingChatGptTask(prompt, options) {
    if (typeof GM_setValue !== 'function') return null;
    const opts = options || {};
    const task = {
      id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      prompt,
      options: { focusOnSend: config.focusChatGptOnSend !== false },
      targetReceiverId: opts.targetReceiverId || '',
      createdAt: Date.now(),
      sourceTitle: String(document.title || '').replace(/\s+/g, ' ').trim(),
      sourceUrl: location.href
    };
    GM_setValue(PENDING_TASK_KEY, JSON.stringify(task));
    return task;
  }

  function readPendingChatGptTask() {
    if (typeof GM_getValue !== 'function') return null;
    try {
      const raw = GM_getValue(PENDING_TASK_KEY, '');
      return parsePendingChatGptTask(raw, true);
    } catch (err) {
      clearPendingChatGptTask();
      return null;
    }
  }

  function parsePendingChatGptTask(value, clearExpired) {
    if (!value) return null;
    try {
      const task = typeof value === 'object' ? value : JSON.parse(value);
      if (!task?.id || !task?.prompt) return null;
      if (Date.now() - Number(task.createdAt || 0) > CHATGPT_TASK_TTL_MS) {
        if (clearExpired) clearPendingChatGptTask();
        return null;
      }
      return task;
    } catch (err) {
      return null;
    }
  }

  function clearPendingChatGptTask(taskId) {
    if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') return;
    if (taskId) {
      const current = readPendingChatGptTask();
      if (current && current.id !== taskId) return;
    }
    GM_setValue(PENDING_TASK_KEY, '');
  }

  function readTaskLog() {
    if (typeof GM_getValue !== 'function') return [];
    try {
      const raw = GM_getValue(TASK_LOG_KEY, '[]');
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((item) => item && item.id) : [];
    } catch (err) {
      return [];
    }
  }

  function writeTaskLog(list) {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(TASK_LOG_KEY, JSON.stringify((Array.isArray(list) ? list : []).slice(0, 12)));
  }

  function upsertTaskLog(taskId, patch) {
    if (!taskId) return;
    const list = readTaskLog();
    const idx = list.findIndex((item) => item.id === taskId);
    const base = idx >= 0 ? list[idx] : { id: taskId, createdAt: Date.now() };
    const next = { ...base, ...(patch || {}), updatedAt: Date.now() };
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(next);
    writeTaskLog(list);
    refreshDiagnostics();
  }

  function createTaskLogFromTask(task, patch) {
    if (!task?.id) return;
    upsertTaskLog(task.id, {
      title: task.sourceTitle || '无标题',
      url: task.sourceUrl || '',
      createdAt: task.createdAt || Date.now(),
      openedReceiver: false,
      receiverAlive: false,
      status: '已创建',
      ...(patch || {})
    });
  }

  function readChatGptReceiverHeartbeat() {
    if (typeof GM_getValue !== 'function') return null;
    try {
      const raw = GM_getValue(CHATGPT_HEARTBEAT_KEY, '');
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function isChatGptReceiverAlive(expectedUrl) {
    const heartbeat = readChatGptReceiverHeartbeat();
    if (!heartbeat?.ts || !isChatGptUrl(heartbeat.url)) return false;

    const age = Date.now() - Number(heartbeat.ts);
    if (!isFinite(age) || age < 0 || age > CHATGPT_HEARTBEAT_MAX_AGE_MS) return false;

    if (!shouldRequireExactChatGptUrl(expectedUrl)) return true;
    return normalizeAiUrlForCompare(heartbeat.url) === normalizeAiUrlForCompare(expectedUrl);
  }

  function markChatGptOpening() {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(CHATGPT_OPENING_KEY, JSON.stringify({ ts: Date.now(), url: config.targetAiUrl || DEFAULT_CONFIG.targetAiUrl }));
  }

  function isChatGptOpeningRecently() {
    if (typeof GM_getValue !== 'function') return false;
    try {
      const raw = GM_getValue(CHATGPT_OPENING_KEY, '');
      if (!raw) return false;
      const data = JSON.parse(raw);
      const age = Date.now() - Number(data.ts || 0);
      return isFinite(age) && age >= 0 && age < CHATGPT_OPENING_COOLDOWN_MS;
    } catch (err) {
      return false;
    }
  }

  function ensureChatGptReceiverOpen() {
    if (isChatGptReceiverAlive(config.targetAiUrl)) return 'alive';
    if (isChatGptOpeningRecently()) return 'opening';
    markChatGptOpening();
    openTargetAi({ active: false });
    return 'opened';
  }

  async function writeClipboard(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw new Error('当前浏览器不支持自动写入剪贴板');
  }

  function openTargetAi(options) {
    const opts = options || {};
    const url = String(config.targetAiUrl || DEFAULT_CONFIG.targetAiUrl).trim();
    if (isChatGptUrl(url) && opts.active !== false) {
      const opened = window.open(url, 'tabbit_chatgpt_target');
      if (opened) {
        try { opened.focus(); } catch (err) {}
        return;
      }
    }
    if (typeof GM_openInTab === 'function') {
      GM_openInTab(url, { active: opts.active !== false, insert: true, setParent: true });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function setStatus(message, type) {
    const el = panelEl?.querySelector('.tabbit-jump-status');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.type = type || '';
  }

  function getSelectedTemplate() {
    const select = panelEl?.querySelector('#tabbit-jump-template-select');
    const id = select?.value || config.defaultPromptTemplateId;
    return config.promptTemplates.find((tpl) => tpl.id === id) || getDefaultTemplate();
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function keepElementInViewport(el, minVisible) {
    if (!el) return;
    const visible = minVisible || 32;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - visible;
    const maxTop = window.innerHeight - visible;
    const left = clampNumber(rect.left, visible - rect.width, maxLeft);
    const top = clampNumber(rect.top, 0, maxTop);
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function applyPanelGeometry() {
    if (!panelEl) return;
    if (config.panel?.width) panelEl.style.width = config.panel.width + 'px';
    if (config.panel?.height) panelEl.style.height = config.panel.height + 'px';
    if (config.panel?.left != null && config.panel?.top != null) {
      panelEl.style.left = config.panel.left + 'px';
      panelEl.style.top = config.panel.top + 'px';
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
      requestAnimationFrame(() => keepElementInViewport(panelEl, 42));
    }
  }

  function resetPanelGeometry() {
    if (!panelEl) return;
    config.panel = { ...config.panel, left: null, top: null, width: null, height: null };
    saveConfig();
    panelEl.style.left = '';
    panelEl.style.top = '';
    panelEl.style.right = '18px';
    panelEl.style.bottom = '140px';
    panelEl.style.width = '';
    panelEl.style.height = '';
    setStatus('面板位置已重置', 'ok');
  }

  function refreshPreview() {
    if (!panelEl) return '';
    const templateText = panelEl.querySelector('#tabbit-jump-template-text')?.value || getSelectedTemplate().text;
    const prompt = buildFinalPrompt(templateText);
    const preview = panelEl.querySelector('#tabbit-jump-preview');
    if (preview) preview.value = prompt;
    setStatus(`已生成 Prompt：${prompt.length} 字符`, 'ok');
    return prompt;
  }

  function flashFloatButton(text, isError) {
    const btn = document.getElementById(FLOAT_BTN_ID);
    if (!btn) return;
    const oldText = btn.textContent;
    btn.textContent = text;
    btn.dataset.state = isError ? 'error' : 'ok';
    setTimeout(() => {
      btn.textContent = oldText || 'AI 跳转';
      delete btn.dataset.state;
    }, 1600);
  }

  function openReceiverOnly(options) {
    const opts = options || {};
    const state = isChatGptUrl(config.targetAiUrl)
      ? ensureChatGptReceiverOpen()
      : (openTargetAi({ active: opts.active === true }), 'opened');
    if (state === 'alive') {
      setStatus('ChatGPT 接收端已在线', 'ok');
      if (opts.flash) flashFloatButton('已在线', false);
    } else if (state === 'opening') {
      setStatus('ChatGPT 接收页正在打开中', 'ok');
      if (opts.flash) flashFloatButton('打开中', false);
    } else {
      setStatus('已后台打开 ChatGPT 接收页', 'ok');
      if (opts.flash) flashFloatButton('已打开', false);
    }
    refreshDiagnostics();
  }

  function runPrimaryAction(options) {
    const opts = options || {};
    if (config.actionMode === 'copy') return copyPrompt({ open: false, fresh: true, flash: opts.flash !== false });
    if (config.actionMode === 'open') return openReceiverOnly({ flash: opts.flash !== false });
    return copyPrompt({ open: true, fresh: true, flash: opts.flash !== false });
  }

  function readAutoRunState() {
    if (typeof GM_getValue !== 'function') return {};
    try {
      const raw = GM_getValue(AUTO_RUN_STATE_KEY, '{}');
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function writeAutoRunState(state) {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(AUTO_RUN_STATE_KEY, JSON.stringify(state || {}));
  }

  function shouldAutoRunCurrentPage() {
    if (!config.autoRunEnabled) return false;
    if (!matchUrlRules(location.href, config.autoRunRules)) return false;
    const state = readAutoRunState();
    const key = location.href.replace(/[?#].*$/, '');
    const last = Number(state[key] || 0);
    const cooldownMs = Math.max(1, Number(config.autoRunCooldownMinutes || 30)) * 60 * 1000;
    return !last || Date.now() - last > cooldownMs;
  }

  function markAutoRunCurrentPage() {
    const state = readAutoRunState();
    const key = location.href.replace(/[?#].*$/, '');
    state[key] = Date.now();
    writeAutoRunState(state);
  }

  function maybeAutoRunCurrentPage() {
    if (!shouldAutoRunCurrentPage()) return;
    markAutoRunCurrentPage();
    setTimeout(() => {
      copyPrompt({ open: true, fresh: true, flash: true, silent: true });
    }, 900);
  }

  async function copyPrompt(options) {
    const opts = options || {};
    const preview = panelEl?.querySelector('#tabbit-jump-preview');
    const prompt = opts.fresh
      ? buildFinalPrompt(getDefaultTemplate().text)
      : (preview?.value.trim() || refreshPreview() || buildFinalPrompt(getDefaultTemplate().text));
    if (!prompt) {
      setStatus('没有可复制的 Prompt', 'error');
      return;
    }
    try {
      await writeClipboard(prompt);
      setStatus(opts.open ? '已复制 Prompt，正在发送到 AI' : '已复制 Prompt', 'ok');
      if (opts.open) {
        if (isChatGptUrl(config.targetAiUrl)) {
          const heartbeat = readChatGptReceiverHeartbeat();
          const receiverAlive = isChatGptReceiverAlive(config.targetAiUrl);
          const targetReceiverId = receiverAlive && heartbeat?.receiverId ? heartbeat.receiverId : '';
          const task = savePendingChatGptTask(prompt, { targetReceiverId });
          if (task) {
            createTaskLogFromTask(task, {
              status: receiverAlive ? '已发送到接收端' : '已排队，等待接收端',
              receiverAlive,
              receiverUrl: heartbeat?.url || '',
              openedReceiver: false
            });
          }
          if (receiverAlive) {
            if (!targetReceiverId) {
              setStatus('已发送到 ChatGPT 接收页', 'ok');
              if (opts.flash) flashFloatButton('已发送', false);
              return;
            }
            if (config.focusChatGptOnSend !== false) {
              openTargetAi({ active: true });
              setStatus('已发送到现有 ChatGPT 接收页，正在切换', 'ok');
              if (opts.flash) flashFloatButton('已切换', false);
            } else {
              setStatus('已发送到现有 ChatGPT 接收页', 'ok');
              if (opts.flash) flashFloatButton('已发送', false);
            }
            return;
          }
        }
        const openState = isChatGptUrl(config.targetAiUrl)
          ? ensureChatGptReceiverOpen()
          : (openTargetAi({ active: opts.active !== false }), 'opened');
        if (openState === 'opening') {
          setStatus('已发送任务，ChatGPT 接收页正在打开中', 'ok');
          const task = readPendingChatGptTask();
          if (task) upsertTaskLog(task.id, { status: '已排队，接收页正在打开', openedReceiver: false });
          if (opts.flash) flashFloatButton('已排队', false);
          return;
        }
        if (openState === 'opened') {
          setStatus('已发送任务，已后台打开 ChatGPT 接收页', 'ok');
          const task = readPendingChatGptTask();
          if (task) upsertTaskLog(task.id, { status: '已后台打开接收页', openedReceiver: true });
          if (opts.flash) flashFloatButton('已发送', false);
          return;
        }
      }
      if (opts.flash) flashFloatButton(opts.open ? '已打开' : '已复制', false);
    } catch (err) {
      if (opts.flash) flashFloatButton('复制失败', true);
      if (opts.openOnError !== false) {
        openPanel();
      }
      setStatus(`复制失败：${err.message || err}`, 'error');
    }
  }

  function saveFormConfig() {
    if (!panelEl) return;
    const targetInput = panelEl.querySelector('#tabbit-jump-target-url');
    const maxInput = panelEl.querySelector('#tabbit-jump-max-chars');
    const actionInput = panelEl.querySelector('#tabbit-jump-action-mode');
    const autoRunInput = panelEl.querySelector('#tabbit-jump-auto-run');
    const autoRulesInput = panelEl.querySelector('#tabbit-jump-auto-rules');
    const autoCooldownInput = panelEl.querySelector('#tabbit-jump-auto-cooldown');
    const focusInput = panelEl.querySelector('#tabbit-jump-focus-chatgpt');
    const selected = getSelectedTemplate();
    const templateText = panelEl.querySelector('#tabbit-jump-template-text')?.value.trim();

    config.targetAiUrl = String(targetInput?.value || DEFAULT_CONFIG.targetAiUrl).trim();
    config.extractMaxChars = Math.max(1000, Number(maxInput?.value || DEFAULT_CONFIG.extractMaxChars));
    config.actionMode = ['copy', 'send', 'open'].includes(actionInput?.value) ? actionInput.value : 'send';
    config.autoRunEnabled = !!autoRunInput?.checked;
    config.autoRunRules = normalizeUrlRules(String(autoRulesInput?.value || '').split('\n'));
    config.autoRunCooldownMinutes = Math.max(1, Number(autoCooldownInput?.value || DEFAULT_CONFIG.autoRunCooldownMinutes));
    config.focusChatGptOnSend = false;
    config.defaultPromptTemplateId = selected.id;
    if (templateText) selected.text = templateText;
    saveConfig();
    setStatus('设置已保存', 'ok');
  }

  function renderTemplateOptions() {
    return config.promptTemplates
      .map((tpl) => `<option value="${escapeHtml(tpl.id)}"${tpl.id === config.defaultPromptTemplateId ? ' selected' : ''}>${escapeHtml(tpl.name)}</option>`)
      .join('');
  }

  function formatTime(ts) {
    const time = Number(ts || 0);
    if (!time) return '无';
    const date = new Date(time);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatRelativeSeconds(ts) {
    const time = Number(ts || 0);
    if (!time) return '';
    const diff = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (diff < 60) return `${diff} 秒前`;
    return `${Math.round(diff / 60)} 分钟前`;
  }

  function refreshDiagnostics() {
    if (!panelEl) return;
    const heartbeat = readChatGptReceiverHeartbeat();
    const alive = isChatGptReceiverAlive(config.targetAiUrl);
    const latestTask = readTaskLog()[0];
    const statusEl = panelEl.querySelector('#tabbit-jump-receiver-status');
    if (statusEl) {
      statusEl.innerHTML = `
        <div class="tabbit-jump-status-line">
          <b class="${alive ? 'ok' : 'warn'}">${alive ? 'ChatGPT 接收端在线' : 'ChatGPT 接收端离线'}</b>
          <span>${heartbeat?.ts ? `最近心跳 ${formatTime(heartbeat.ts)}（${formatRelativeSeconds(heartbeat.ts)}）` : '尚未收到心跳'}</span>
        </div>
        <div class="tabbit-jump-status-line">
          <b>最近任务</b>
          <span>${latestTask ? `${escapeHtml(latestTask.status || '未知状态')}，${formatTime(latestTask.updatedAt || latestTask.createdAt)}` : '暂无'}</span>
        </div>
        <div class="tabbit-jump-muted">${heartbeat?.url ? escapeHtml(heartbeat.url) : '保持一个 ChatGPT 标签打开，刷新后会自动成为接收端。'}</div>
      `;
    }

    const taskEl = panelEl.querySelector('#tabbit-jump-task-log');
    if (taskEl) {
      const list = readTaskLog();
      if (!list.length) {
        taskEl.textContent = '暂无任务';
      } else {
        taskEl.innerHTML = list.slice(0, 6).map((item) => `
          <div class="tabbit-jump-task-item">
            <div class="tabbit-jump-task-title">${escapeHtml(item.title || '无标题')}</div>
            <div class="tabbit-jump-task-meta">
              <span>${formatTime(item.createdAt)}</span>
              <span>${escapeHtml(item.status || '未知状态')}</span>
              <span>${item.openedReceiver ? '已打开接收页' : '未新开接收页'}</span>
            </div>
          </div>
        `).join('');
      }
    }
  }

  function createPanel() {
    if (panelEl) return panelEl;

    injectStyle();
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.innerHTML = `
      <div class="tabbit-jump-head">
        <div class="tabbit-jump-title">
          <strong>AI 网页摘要跳转助手</strong>
          <span>生成 Prompt，发送到 ChatGPT</span>
        </div>
        <button type="button" class="tabbit-jump-icon-btn" data-action="close" title="关闭">×</button>
      </div>
      <div class="tabbit-jump-body">
        <div class="tabbit-jump-diagnostics">
          <div class="tabbit-jump-section-head">
            <span>接收端状态</span>
            <button type="button" data-action="open-receiver">打开接收端</button>
          </div>
          <div id="tabbit-jump-receiver-status" class="tabbit-jump-status-box">读取中...</div>
        </div>
        <div class="tabbit-jump-row">
          <label class="tabbit-jump-field">
            <span>默认动作</span>
            <select id="tabbit-jump-action-mode">
              <option value="send" ${config.actionMode === 'send' ? 'selected' : ''}>后台发送</option>
              <option value="copy" ${config.actionMode === 'copy' ? 'selected' : ''}>仅复制</option>
              <option value="open" ${config.actionMode === 'open' ? 'selected' : ''}>打开接收端</option>
            </select>
          </label>
          <label class="tabbit-jump-field">
            <span>提示词模板</span>
            <select id="tabbit-jump-template-select">${renderTemplateOptions()}</select>
          </label>
        </div>
        <details class="tabbit-jump-advanced">
          <summary>
            <span>低频设置</span>
            <small>接收页、正文上限、自动触发</small>
          </summary>
          <div class="tabbit-jump-advanced-body">
            <label class="tabbit-jump-field">
              <span>目标 AI 网页</span>
              <input id="tabbit-jump-target-url" type="url" value="${escapeHtml(config.targetAiUrl)}" placeholder="https://chatgpt.com/">
            </label>
            <label class="tabbit-jump-check">
              <input id="tabbit-jump-focus-chatgpt" type="checkbox" checked disabled>
              <span>后台稳定模式：发送后不自动切换标签</span>
            </label>
            <div class="tabbit-jump-row tabbit-jump-row-small">
              <label class="tabbit-jump-field tabbit-jump-max">
                <span>正文上限</span>
                <input id="tabbit-jump-max-chars" type="number" min="1000" step="1000" value="${escapeHtml(config.extractMaxChars)}">
              </label>
              <label class="tabbit-jump-field tabbit-jump-max">
                <span>自动冷却（分钟）</span>
                <input id="tabbit-jump-auto-cooldown" type="number" min="1" step="1" value="${escapeHtml(config.autoRunCooldownMinutes)}">
              </label>
            </div>
            <label class="tabbit-jump-check">
              <input id="tabbit-jump-auto-run" type="checkbox" ${config.autoRunEnabled ? 'checked' : ''}>
              <span>命中规则时自动后台发送（默认关闭）</span>
            </label>
            <label class="tabbit-jump-field">
              <span>自动触发规则（每行一个，支持 *）</span>
              <textarea id="tabbit-jump-auto-rules" rows="4">${escapeHtml((config.autoRunRules || []).join('\n'))}</textarea>
            </label>
          </div>
        </details>
        <label class="tabbit-jump-field">
          <span>模板内容</span>
          <textarea id="tabbit-jump-template-text" rows="7">${escapeHtml(getDefaultTemplate().text)}</textarea>
        </label>
        <div class="tabbit-jump-actions">
          <button type="button" class="tabbit-jump-primary" data-action="copy-open">后台发送</button>
          <button type="button" data-action="copy">只复制</button>
          <button type="button" data-action="open-receiver">打开接收端</button>
          <button type="button" data-action="refresh">重新生成</button>
          <button type="button" data-action="save">保存设置</button>
        </div>
        <div class="tabbit-jump-diagnostics">
          <div class="tabbit-jump-section-head"><span>最近任务</span></div>
          <div id="tabbit-jump-task-log" class="tabbit-jump-task-log">暂无任务</div>
        </div>
        <label class="tabbit-jump-field">
          <span>最终 Prompt</span>
          <textarea id="tabbit-jump-preview" rows="11" placeholder="点击“重新生成”后可在这里预览和微调最终 Prompt"></textarea>
        </label>
        <div class="tabbit-jump-status"></div>
      </div>
      <div class="tabbit-jump-resize-handle" title="拖动调整大小"></div>
    `;

    document.documentElement.appendChild(panelEl);
    applyPanelGeometry();
    bindPanelEvents();
    enablePanelDrag();
    enablePanelResize();
    refreshPreview();
    refreshDiagnostics();
    if (!panelEl.dataset.diagTimer) {
      panelEl.dataset.diagTimer = '1';
      setInterval(refreshDiagnostics, 5000);
    }
    return panelEl;
  }

  function bindPanelEvents() {
    panelEl.querySelector('[data-action="close"]').addEventListener('click', () => {
      panelEl.classList.add('tabbit-jump-hidden');
    });
    panelEl.querySelector('[data-action="copy-open"]').addEventListener('click', () => copyPrompt({ open: true }));
    panelEl.querySelector('[data-action="copy"]').addEventListener('click', () => copyPrompt({ open: false }));
    panelEl.querySelectorAll('[data-action="open-receiver"]').forEach((btn) => {
      btn.addEventListener('click', () => openReceiverOnly({ flash: false }));
    });
    panelEl.querySelector('[data-action="refresh"]').addEventListener('click', refreshPreview);
    panelEl.querySelector('[data-action="save"]').addEventListener('click', saveFormConfig);
    panelEl.querySelector('#tabbit-jump-action-mode').addEventListener('change', saveFormConfig);
    panelEl.querySelector('#tabbit-jump-auto-run').addEventListener('change', saveFormConfig);
    panelEl.querySelector('#tabbit-jump-auto-rules').addEventListener('change', saveFormConfig);
    panelEl.querySelector('#tabbit-jump-auto-cooldown').addEventListener('change', saveFormConfig);
    panelEl.querySelector('#tabbit-jump-template-select').addEventListener('change', () => {
      const tpl = getSelectedTemplate();
      const textarea = panelEl.querySelector('#tabbit-jump-template-text');
      if (textarea) textarea.value = tpl.text;
      refreshPreview();
    });
    panelEl.querySelector('#tabbit-jump-template-text').addEventListener('input', () => {
      setStatus('模板已修改，点击“重新生成”更新 Prompt', '');
    });
    panelEl.querySelector('#tabbit-jump-target-url').addEventListener('change', saveFormConfig);
    panelEl.querySelector('#tabbit-jump-focus-chatgpt').addEventListener('change', saveFormConfig);
    panelEl.querySelector('#tabbit-jump-max-chars').addEventListener('change', () => {
      saveFormConfig();
      refreshPreview();
    });
  }

  function enablePanelDrag() {
    const handle = panelEl?.querySelector('.tabbit-jump-head');
    if (!handle || handle.dataset.dragReady === '1') return;
    handle.dataset.dragReady = '1';

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button, input, select, textarea, a')) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panelEl.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panelEl.classList.add('tabbit-jump-dragging');
      panelEl.style.left = startLeft + 'px';
      panelEl.style.top = startTop + 'px';
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
      event.preventDefault();
    });

    handle.addEventListener('dblclick', (event) => {
      if (event.target.closest('button, input, select, textarea, a')) return;
      resetPanelGeometry();
    });

    document.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      const rect = panelEl.getBoundingClientRect();
      const nextLeft = clampNumber(startLeft + event.clientX - startX, 8 - rect.width + 42, window.innerWidth - 42);
      const nextTop = clampNumber(startTop + event.clientY - startY, 0, window.innerHeight - 42);
      panelEl.style.left = Math.round(nextLeft) + 'px';
      panelEl.style.top = Math.round(nextTop) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      panelEl.classList.remove('tabbit-jump-dragging');
      keepElementInViewport(panelEl, 42);
      const rect = panelEl.getBoundingClientRect();
      config.panel = { ...config.panel, left: Math.round(rect.left), top: Math.round(rect.top) };
      saveConfig();
    });
  }

  function enablePanelResize() {
    const handle = panelEl?.querySelector('.tabbit-jump-resize-handle');
    if (!handle || handle.dataset.resizeReady === '1') return;
    handle.dataset.resizeReady = '1';

    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      resizing = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panelEl.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      panelEl.classList.add('tabbit-jump-resizing');
      event.preventDefault();
      event.stopPropagation();
    });

    document.addEventListener('mousemove', (event) => {
      if (!resizing) return;
      const nextW = clampNumber(startW + event.clientX - startX, 360, window.innerWidth - 20);
      const nextH = clampNumber(startH + event.clientY - startY, 420, window.innerHeight - 20);
      panelEl.style.width = Math.round(nextW) + 'px';
      panelEl.style.height = Math.round(nextH) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      panelEl.classList.remove('tabbit-jump-resizing');
      keepElementInViewport(panelEl, 42);
      const rect = panelEl.getBoundingClientRect();
      config.panel = {
        ...config.panel,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top)
      };
      saveConfig();
    });
  }

  function openPanel() {
    createPanel();
    panelEl.classList.remove('tabbit-jump-hidden');
    refreshPreview();
    refreshDiagnostics();
  }

  function applyFloatButtonPosition(btn) {
    if (!btn) return;
    if (config.floatButton?.offsetX != null && config.floatButton?.offsetY != null) {
      btn.style.right = config.floatButton.offsetX + 'px';
      btn.style.bottom = config.floatButton.offsetY + 'px';
      btn.style.left = 'auto';
      btn.style.top = 'auto';
    }
  }

  function enableFloatButtonDrag(btn) {
    if (!btn || btn.dataset.dragReady === '1') return;
    btn.dataset.dragReady = '1';

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    btn.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
      const rect = btn.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      btn.classList.add('tabbit-jump-float-dragging');
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      const nextLeft = clampNumber(startLeft + dx, 0, window.innerWidth - btn.offsetWidth);
      const nextTop = clampNumber(startTop + dy, 0, window.innerHeight - btn.offsetHeight);
      btn.style.left = Math.round(nextLeft) + 'px';
      btn.style.top = Math.round(nextTop) + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      btn.classList.remove('tabbit-jump-float-dragging');
      if (!moved) return;
      const rect = btn.getBoundingClientRect();
      config.floatButton = {
        ...config.floatButton,
        offsetX: Math.round(window.innerWidth - rect.right),
        offsetY: Math.round(window.innerHeight - rect.bottom)
      };
      saveConfig();
      const blocker = (event) => {
        event.stopPropagation();
        event.preventDefault();
        btn.removeEventListener('click', blocker, true);
      };
      btn.addEventListener('click', blocker, true);
    });
  }

  function createFloatButton() {
    if (document.getElementById(FLOAT_BTN_ID)) return;
    injectStyle();
    const btn = document.createElement('button');
    btn.id = FLOAT_BTN_ID;
    btn.type = 'button';
    btn.textContent = 'AI 跳转';
    btn.title = '左键：发送到 ChatGPT；右键：设置';
    btn.addEventListener('click', () => runPrimaryAction({ flash: true }));
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openPanel();
    });
    document.documentElement.appendChild(btn);
    applyFloatButtonPosition(btn);
    enableFloatButtonDrag(btn);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(getter, timeoutMs, intervalMs) {
    const deadline = Date.now() + (timeoutMs || 25000);
    while (Date.now() < deadline) {
      const value = getter();
      if (value) return value;
      await sleep(intervalMs || 250);
    }
    return null;
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function showChatGptAdapterToast(message, type) {
    injectStyle();
    let toast = document.getElementById('tabbit-chatgpt-adapter-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'tabbit-chatgpt-adapter-toast';
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type || '';
    setTimeout(() => {
      if (toast?.parentNode) toast.parentNode.removeChild(toast);
    }, type === 'error' ? 5000 : 2200);
  }

  function findChatGptPromptInput() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'textarea[placeholder]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][id="prompt-textarea"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    return candidates.find((el) => isVisibleElement(el) && !el.closest('[aria-hidden="true"]')) || null;
  }

  function setNativeInputValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fillChatGptPromptInput(input, prompt) {
    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setNativeInputValue(input, prompt);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    input.textContent = '';
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: prompt }));
    input.textContent = prompt;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findChatGptSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]',
      'form button[type="submit"]',
      'button[type="submit"]'
    ];
    const buttons = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    return buttons.find((btn) =>
      isVisibleElement(btn) &&
      !btn.disabled &&
      btn.getAttribute('aria-disabled') !== 'true' &&
      !btn.closest('[aria-hidden="true"]')
    ) || null;
  }

  async function sendPendingTaskToChatGpt(task) {
    showChatGptAdapterToast('正在填入网页摘要 Prompt...', 'ok');
    if (task.options?.focusOnSend !== false) {
      try { window.focus(); } catch (err) {}
    }

    const input = await waitFor(findChatGptPromptInput, 30000, 300);
    if (!input) {
      showChatGptAdapterToast('没有找到 ChatGPT 输入框，Prompt 已在剪贴板里', 'error');
      upsertTaskLog(task.id, { status: '接收失败：未找到输入框', receiverUrl: location.href });
      return false;
    }

    fillChatGptPromptInput(input, task.prompt);
    await sleep(500);

    const sendButton = await waitFor(findChatGptSendButton, 10000, 250);
    if (!sendButton) {
      showChatGptAdapterToast('已填入 Prompt，但没有找到可点击的发送按钮', 'error');
      sessionStorage.setItem('tabbit_chatgpt_sent_task_id', task.id);
      upsertTaskLog(task.id, { status: '已填入，等待手动发送', sentAt: Date.now(), receiverUrl: location.href });
      clearPendingChatGptTask(task.id);
      return false;
    }

    sendButton.click();
    showChatGptAdapterToast('已发送网页摘要任务', 'ok');
    upsertTaskLog(task.id, { status: 'ChatGPT 已发送', sentAt: Date.now(), receiverUrl: location.href });
    return true;
  }

  async function runChatGptAdapter() {
    const task = readPendingChatGptTask();
    if (!task) return;
    const receiverId = getChatGptReceiverId();
    if (task.targetReceiverId && task.targetReceiverId !== receiverId) return;
    if (sessionStorage.getItem('tabbit_chatgpt_sent_task_id') === task.id) return;

    try {
      const ok = await sendPendingTaskToChatGpt(task);
      if (ok) {
        sessionStorage.setItem('tabbit_chatgpt_sent_task_id', task.id);
        clearPendingChatGptTask(task.id);
      }
    } catch (err) {
      console.warn('[饺子AI跳转] ChatGPT 自动发送失败：', err);
      if (task?.id) upsertTaskLog(task.id, { status: '接收失败：' + (err.message || err), receiverUrl: location.href });
      showChatGptAdapterToast(`自动发送失败：${err.message || err}`, 'error');
    }
  }

  function writeChatGptReceiverHeartbeat() {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(CHATGPT_HEARTBEAT_KEY, JSON.stringify({
      receiverId: getChatGptReceiverId(),
      url: location.href,
      title: String(document.title || '').replace(/\s+/g, ' ').trim(),
      ts: Date.now()
    }));
  }

  function setupChatGptReceiver() {
    try {
      window.name = 'tabbit_chatgpt_target';
    } catch (err) {}
    writeChatGptReceiverHeartbeat();
    setInterval(writeChatGptReceiverHeartbeat, CHATGPT_HEARTBEAT_INTERVAL_MS);

    const handleTaskValue = (value) => {
      const task = parsePendingChatGptTask(value, true);
      if (!task) return;
      const receiverId = getChatGptReceiverId();
      if (task.targetReceiverId && task.targetReceiverId !== receiverId) return;
      if (sessionStorage.getItem('tabbit_chatgpt_sent_task_id') === task.id) return;
      runChatGptAdapter();
    };

    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(PENDING_TASK_KEY, (_name, _oldValue, newValue) => {
        handleTaskValue(newValue);
      });
    } else {
      console.warn('[饺子AI跳转] 当前脚本环境缺少 GM_addValueChangeListener，ChatGPT 接收端只能在页面打开时消费一次任务');
    }

    setTimeout(() => handleTaskValue(typeof GM_getValue === 'function' ? GM_getValue(PENDING_TASK_KEY, '') : ''), 900);
  }

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('打开跳转摘要面板', openPanel);
    GM_registerMenuCommand('发送到 ChatGPT', async () => {
      openPanel();
      await copyPrompt({ open: true });
    });
    GM_registerMenuCommand('只复制摘要 Prompt', async () => {
      openPanel();
      await copyPrompt({ open: false });
    });
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${FLOAT_BTN_ID} {
        position: fixed;
        right: 18px;
        bottom: 96px;
        z-index: 2147483646;
        border: none;
        background: linear-gradient(135deg, #8b5cf6, #3b82f6);
        color: #fff;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 8px 24px rgba(59, 130, 246, .28);
        cursor: pointer;
        transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease;
      }
      #${FLOAT_BTN_ID}:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 30px rgba(99, 102, 241, .34);
      }
      #${FLOAT_BTN_ID}.tabbit-jump-float-dragging {
        transition: none !important;
        transform: scale(1.06);
        cursor: grabbing;
      }
      #${FLOAT_BTN_ID}[data-state="ok"] {
        background: linear-gradient(135deg, #22c55e, #14b8a6);
      }
      #${FLOAT_BTN_ID}[data-state="error"] {
        background: linear-gradient(135deg, #ef4444, #b91c1c);
      }
      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        bottom: 140px;
        z-index: 2147483647;
        width: min(540px, calc(100vw - 28px));
        max-height: min(760px, calc(100vh - 40px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(139, 92, 246, .18);
        border-radius: 14px;
        background: #fff;
        color: #222;
        box-shadow: 0 20px 60px rgba(0, 0, 0, .25);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      #${PANEL_ID}.tabbit-jump-hidden {
        display: none;
      }
      #${PANEL_ID}.tabbit-jump-dragging,
      #${PANEL_ID}.tabbit-jump-resizing {
        user-select: none;
      }
      #${PANEL_ID} .tabbit-jump-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        background: linear-gradient(135deg, #8b5cf6, #3b82f6);
        color: #fff;
        cursor: move;
      }
      #${PANEL_ID} .tabbit-jump-title {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      #${PANEL_ID} .tabbit-jump-title strong {
        font-size: 14px;
        line-height: 1.25;
        letter-spacing: 0;
      }
      #${PANEL_ID} .tabbit-jump-title span {
        font-size: 11px;
        line-height: 1.25;
        color: rgba(255, 255, 255, .78);
      }
      #${PANEL_ID} .tabbit-jump-icon-btn {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        background: rgba(255, 255, 255, .12);
        color: #fff;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        flex: 0 0 auto;
        transition: background .16s ease, transform .16s ease;
      }
      #${PANEL_ID} .tabbit-jump-icon-btn:hover {
        background: rgba(255, 255, 255, .28);
        transform: translateY(-1px);
      }
      #${PANEL_ID} .tabbit-jump-body {
        overflow: auto;
        padding: 14px;
        background: linear-gradient(180deg, #fff 0%, #fafaff 100%);
      }
      #${PANEL_ID} .tabbit-jump-row {
        display: grid;
        grid-template-columns: 1fr 116px;
        gap: 12px;
      }
      #${PANEL_ID} .tabbit-jump-row-small {
        grid-template-columns: 1fr 1fr;
      }
      #${PANEL_ID} .tabbit-jump-advanced {
        margin: 0 0 12px;
        border: 1px solid rgba(139, 92, 246, .14);
        border-radius: 10px;
        background: rgba(255, 255, 255, .72);
        overflow: hidden;
      }
      #${PANEL_ID} .tabbit-jump-advanced summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        list-style: none;
        cursor: pointer;
        padding: 9px 10px;
        color: #4c1d95;
        font-size: 12px;
        font-weight: 800;
        background: linear-gradient(135deg, rgba(139, 92, 246, .10), rgba(59, 130, 246, .08));
        user-select: none;
      }
      #${PANEL_ID} .tabbit-jump-advanced summary::-webkit-details-marker {
        display: none;
      }
      #${PANEL_ID} .tabbit-jump-advanced summary::after {
        content: "展开";
        flex: 0 0 auto;
        border: 1px solid rgba(139, 92, 246, .18);
        border-radius: 999px;
        background: rgba(255, 255, 255, .76);
        color: #6d28d9;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
      }
      #${PANEL_ID} .tabbit-jump-advanced[open] summary::after {
        content: "收起";
      }
      #${PANEL_ID} .tabbit-jump-advanced summary small {
        flex: 1;
        min-width: 0;
        color: #7c8491;
        font-size: 11px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .tabbit-jump-advanced-body {
        padding: 10px 10px 0;
      }
      #${PANEL_ID} .tabbit-jump-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
        font-size: 12px;
        color: #5b6472;
        font-weight: 600;
      }
      #${PANEL_ID} .tabbit-jump-check {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: -2px 0 12px;
        color: #4b5563;
        font-size: 13px;
        background: linear-gradient(135deg, rgba(139, 92, 246, .08), rgba(59, 130, 246, .06));
        border: 1px solid rgba(139, 92, 246, .14);
        border-radius: 10px;
        padding: 8px 10px;
      }
      #${PANEL_ID} .tabbit-jump-check input {
        width: 16px;
        height: 16px;
        margin: 0;
        padding: 0;
      }
      #${PANEL_ID} input,
      #${PANEL_ID} select,
      #${PANEL_ID} textarea {
        box-sizing: border-box;
        width: 100%;
        border: 1.5px solid #e5e5ea;
        border-radius: 10px;
        background: #fff;
        color: #222;
        padding: 8px 9px;
        font-size: 13px;
        line-height: 1.45;
        outline: none;
        font-family: inherit;
        transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
      }
      #${PANEL_ID} textarea {
        resize: vertical;
        font-family: ui-monospace, "SF Mono", Consolas, "Microsoft YaHei", monospace;
        font-size: 12px;
        line-height: 1.55;
        background: #fafafa;
      }
      #${PANEL_ID} input:focus,
      #${PANEL_ID} select:focus,
      #${PANEL_ID} textarea:focus {
        border-color: #8b5cf6;
        box-shadow: 0 0 0 3px rgba(139, 92, 246, .14);
        background: #fff;
      }
      #${PANEL_ID} .tabbit-jump-actions {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
        margin: 4px 0 12px;
      }
      #${PANEL_ID} button {
        border: 1px solid #e5e5ea;
        border-radius: 8px;
        background: #f5f5f7;
        color: #333;
        padding: 8px 9px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: background .16s ease, border-color .16s ease, color .16s ease, transform .16s ease;
      }
      #${PANEL_ID} button:hover {
        background: #ececf0;
        border-color: #d8d8e3;
        transform: translateY(-1px);
      }
      #${PANEL_ID} .tabbit-jump-primary {
        border: none;
        background: linear-gradient(135deg, #8b5cf6, #3b82f6);
        color: #fff;
        box-shadow: 0 4px 14px rgba(99, 102, 241, .24);
      }
      #${PANEL_ID} .tabbit-jump-primary:hover {
        background: linear-gradient(135deg, #7c3aed, #2563eb);
        color: #fff;
        box-shadow: 0 7px 18px rgba(99, 102, 241, .28);
      }
      #${PANEL_ID} .tabbit-jump-status {
        min-height: 20px;
        margin-top: -2px;
        padding: 2px 1px;
        font-size: 12px;
        color: #6b7280;
      }
      #${PANEL_ID} .tabbit-jump-status[data-type="ok"] {
        color: #16a34a;
      }
      #${PANEL_ID} .tabbit-jump-status[data-type="error"] {
        color: #b91c1c;
      }
      #${PANEL_ID} .tabbit-jump-diagnostics {
        margin: 0 0 12px;
        border: 1px solid rgba(139, 92, 246, .14);
        border-radius: 10px;
        background: rgba(255, 255, 255, .72);
        overflow: hidden;
      }
      #${PANEL_ID} .tabbit-jump-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        background: linear-gradient(135deg, rgba(139, 92, 246, .10), rgba(59, 130, 246, .08));
        color: #4c1d95;
        font-size: 12px;
        font-weight: 800;
      }
      #${PANEL_ID} .tabbit-jump-section-head button {
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 700;
      }
      #${PANEL_ID} .tabbit-jump-status-box,
      #${PANEL_ID} .tabbit-jump-task-log {
        padding: 8px 10px;
        color: #475569;
        font-size: 12px;
        line-height: 1.55;
      }
      #${PANEL_ID} .tabbit-jump-status-line {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 3px;
      }
      #${PANEL_ID} .tabbit-jump-status-line b.ok { color: #16a34a; }
      #${PANEL_ID} .tabbit-jump-status-line b.warn { color: #b45309; }
      #${PANEL_ID} .tabbit-jump-muted {
        color: #7c8491;
        word-break: break-all;
      }
      #${PANEL_ID} .tabbit-jump-task-item {
        padding: 7px 0;
        border-top: 1px dashed rgba(148, 163, 184, .45);
      }
      #${PANEL_ID} .tabbit-jump-task-item:first-child {
        border-top: 0;
        padding-top: 0;
      }
      #${PANEL_ID} .tabbit-jump-task-title {
        color: #1f2937;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${PANEL_ID} .tabbit-jump-task-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 3px;
        color: #64748b;
      }
      #${PANEL_ID} .tabbit-jump-task-meta span {
        border-radius: 999px;
        background: rgba(139, 92, 246, .08);
        padding: 1px 6px;
      }
      #${PANEL_ID} .tabbit-jump-resize-handle {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
        cursor: nwse-resize;
        background: linear-gradient(135deg, transparent 50%, rgba(139, 92, 246, .46) 50%);
      }
      #${PANEL_ID} .tabbit-jump-resize-handle:hover {
        background: linear-gradient(135deg, transparent 50%, rgba(139, 92, 246, .72) 50%);
      }
      #tabbit-chatgpt-adapter-toast {
        position: fixed;
        right: 18px;
        bottom: 24px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 36px));
        border: 1px solid rgba(139, 92, 246, .18);
        border-radius: 10px;
        background: linear-gradient(135deg, #1f2937, #312e81);
        color: #fff;
        box-shadow: 0 12px 34px rgba(15, 23, 42, .28);
        padding: 10px 12px;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      #tabbit-chatgpt-adapter-toast[data-type="ok"] {
        background: linear-gradient(135deg, #16a34a, #0f766e);
      }
      #tabbit-chatgpt-adapter-toast[data-type="error"] {
        background: linear-gradient(135deg, #ef4444, #b91c1c);
      }
      @media (max-width: 560px) {
        #${PANEL_ID} {
          right: 10px;
          bottom: 74px;
          width: calc(100vw - 20px);
        }
        #${PANEL_ID} .tabbit-jump-row,
        #${PANEL_ID} .tabbit-jump-actions {
          grid-template-columns: 1fr;
        }
        #${FLOAT_BTN_ID} {
          right: 10px;
          bottom: 24px;
        }
      }
    `;
    if (typeof GM_addStyle === 'function') {
      const style = GM_addStyle(css);
      if (style) style.id = STYLE_ID;
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function bootstrap() {
    if (isCurrentChatGptPage()) {
      setupChatGptReceiver();
      return;
    }
    registerMenus();
    createFloatButton();
    maybeAutoRunCurrentPage();
  }

  window.addEventListener('resize', () => {
    const btn = document.getElementById(FLOAT_BTN_ID);
    if (btn && btn.style.left) {
      keepElementInViewport(btn, 24);
      const rect = btn.getBoundingClientRect();
      config.floatButton = {
        ...config.floatButton,
        offsetX: Math.round(window.innerWidth - rect.right),
        offsetY: Math.round(window.innerHeight - rect.bottom)
      };
      saveConfig();
    }
    if (panelEl && !panelEl.classList.contains('tabbit-jump-hidden') && panelEl.style.left) {
      keepElementInViewport(panelEl, 42);
      const rect = panelEl.getBoundingClientRect();
      config.panel = { ...config.panel, left: Math.round(rect.left), top: Math.round(rect.top) };
      saveConfig();
    }
  });

  bootstrap();
})();
