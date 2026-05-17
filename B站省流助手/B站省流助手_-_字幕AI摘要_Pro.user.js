// ==UserScript==
// @name         B站省流助手 - 字幕AI摘要 Pro
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      3.8.3
// @description  自动提取B站视频字幕，通过自定义AI API生成极简摘要，支持模型切换、持续对话和评论区总结；支持自动解析开关、自动获取模型列表、flomo自动加标签，新增总结生图功能；v3.7.1 增加打断总结功能，在"无字幕"状态下，新增"手动上传字幕"按钮；v3.8.3 修复首次打开视频页字幕获取失败的bug
// @author       次元饺子
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/574935/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B%20-%20%E5%AD%97%E5%B9%95AI%E6%91%98%E8%A6%81%20Pro.user.js
// @updateURL https://update.greasyfork.org/scripts/574935/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B%20-%20%E5%AD%97%E5%B9%95AI%E6%91%98%E8%A6%81%20Pro.meta.js
// ==/UserScript==
(function() {
  'use strict';
  if (window.__BILI_SUBTITLE_SUMMARY__) return;
  window.__BILI_SUBTITLE_SUMMARY__ = true;

  const PROMPT_TEXT = '我极度没有耐心，不想动脑子，脾气暴躁且阅读困难。请用最直白的大白话给我解释这视频到底在说什么，在能解释清楚的前提下废话越少越好，禁止使用任何专业术语。请按以下顺序直接输出：1.【结论】直接告诉我核心意思；2.【具体讲了啥】用极简的白话说明来龙去脉；3.【关键点】列出最重要的几个要点；4.【对我有什么用】直接说明价值，如果是纯广告或水视频请直接告诉我避雷；5.【原链接】在最后附上视频原始链接。记住，不要任何寒暄、铺垫和解释，直接开始回答！';

  const COMMENT_PROMPT_TEXT = '你是一个专业的评论分析助手。请对以下B站视频评论进行总结分析，包括：\n1. 评论整体情感倾向（正面/负面/中性）\n2. 主要讨论话题（列出3-5个）\n3. 有趣/高赞评论摘录\n4. 我理解能力差、没耐心，别讲铺垫、别讲背景、别讲废话，只告诉我：这东西核心结论是什么、有哪几个关键点、对我有什么用。';

  const IMAGE_GEN_PROMPT_TEXT = '根据以下视频内容总结，生成一张信息可视化的精美配图，风格清晰美观，适合作为视频总结的封面图：\n\n{summary}';

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

  const DEFAULT_CONFIG = {
    apiUrl: 'https://xxxx/v1/chat/completions',
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
    imageGenPromptText: IMAGE_GEN_PROMPT_TEXT,
    commentMaxPages: 8,
    commentLimit: 188,
    commentMinDelay: 1800,
    commentMaxDelay: 3800
  };

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

  let CONFIG = loadConfig();
  let POSITIONS = loadPositions();
  const INIT_DELAY_MS = 2000;
  const MAX_CONVERSATION_HISTORY = 21;
  const IMAGE_GEN_SUMMARY_MAX_LEN = 5000;
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

  let rawMarkdownResult = '';
  let rawTranscript = '';
  let currentVideoInfo = null;
  let currentModel = CONFIG.model;
  let conversationHistory = [];
  let commentConversationHistory = [];
  let isCommentSummarizing = false;
  let hasParsed = false;
  let lastRouteKey = '';
  let routeRestartTimer = null;
  let routeGeneration = 0;
  // 🆕 当前正在进行的 AI 任务的 AbortController（用于打断流式输出）
  let currentAbortController = null;

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
      const state = window.__INITIAL_STATE__;
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
  async function fetchSubtitles(cid, bvid) {
    try {
      const url = 'https://api.bilibili.com/x/player/wbi/v2?cid=' + cid + '&bvid=' + bvid;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (data?.data?.subtitle?.subtitles?.length > 0) {
        return data.data.subtitle.subtitles;
      }
    } catch(e) {
      console.log('[省流助手] wbi API 失败:', e.message);
    }
    try {
      const url = 'https://api.bilibili.com/x/player/v2?cid=' + cid + '&bvid=' + bvid;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (data?.data?.subtitle?.subtitles?.length > 0) {
        return data.data.subtitle.subtitles;
      }
    } catch(e) {
      console.log('[省流助手] v2 API 失败:', e.message);
    }
    return [];
  }

  async function fetchSubtitleContent(subtitleUrl) {
    try {
      const url = subtitleUrl.startsWith('http') ? subtitleUrl : 'https:' + subtitleUrl;
      const res = await fetch(url);
      const data = await res.json();
      return data.body || [];
    } catch(e) {
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
  function randomDelay(min, max) {
    const delay = min + Math.random() * (max - min);
    console.log('[省流助手] 等待 ' + (delay / 1000).toFixed(1) + 's...');
    return new Promise(r => setTimeout(r, delay));
  }

  async function retryWithBackoff(fn, maxRetries, baseDelay) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (attempt === maxRetries) throw e;
        const backoffDelay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn('[省流助手] 第' + (attempt + 1) + '次失败，' + (backoffDelay / 1000).toFixed(1) + 's 后重试: ' + e.message);
        await new Promise(r => setTimeout(r, backoffDelay));
      }
    }
  }

  function createSafeFetcher() {
    return async function safeFetch(url, options) {
      options = options || {};
      const mergedOptions = Object.assign({}, options, {
        credentials: 'include',
        headers: Object.assign({}, SAFE_FETCH_HEADERS, { 'Referer': window.location.href }, options.headers || {})
      });
      const resp = await fetch(url, mergedOptions);
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

  async function fetchAllComments(aid, statusCallback) {
    const allComments = [];
    const safeFetch = createSafeFetcher();
    const maxPages = CONFIG.commentMaxPages || COMMENT_CONFIG.maxPages;
    const commentLimit = CONFIG.commentLimit || COMMENT_CONFIG.commentLimit;
    const minDelay = CONFIG.commentMinDelay || COMMENT_CONFIG.minDelay;
    const maxDelay = CONFIG.commentMaxDelay || COMMENT_CONFIG.maxDelay;

    for (let page = 1; page <= maxPages; page++) {
      try {
        if (page > 1) {
          await randomDelay(minDelay, maxDelay);
        }

        const result = await retryWithBackoff(
          () => fetchComments(safeFetch, aid, page),
          COMMENT_CONFIG.maxRetries,
          COMMENT_CONFIG.retryBaseDelay
        );

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
        padding: 10px 14px;
        background: #f5f6fa;
        border-bottom: 1px solid #e8e8ef;
        flex-shrink: 0;
      }
      .tabbit-model-bar-title {
        font-size: 11px;
        color: #999;
        margin-bottom: 6px;
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      .tabbit-model-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
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
        margin: 12px 0 0;
        padding: 8px 10px 10px;
        background: #f6fbfd;
        border: 1px solid #ddebf2;
      }
      .tabbit-video-meta-body {
        padding-top: 8px;
        border-top: 1px solid #ddebf2;
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
      .tabbit-image-slot:empty {
        display: none;
      }
      .tabbit-image-slot {
        margin-bottom: 12px;
      }
      .tabbit-result-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
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
      <div class="tabbit-model-bar">
        <div class="tabbit-model-bar-title">🤖 选择模型（点击切换并重新分析）</div>
        <div class="tabbit-model-list">${modelChips}</div>
      </div>
      <div class="tabbit-panel-content">
        ${renderPresetBarHtml()}
        <div class="tabbit-image-slot"></div>
        <div class="tabbit-result">
          <div class="tabbit-loading">
            <div class="tabbit-spinner"></div>
            <span>准备中...</span>
          </div>
        </div>
        <div class="tabbit-result-actions"></div>
        <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn" disabled>
          <span class="tabbit-btn-icon">💬</span>
          <span>总结评论区</span>
        </button>
        ${renderVideoMetaBottomHtml(videoInfo, window.location.href)}
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
      <div class="tabbit-video-info tabbit-video-info-bottom">
        <div style="font-size:12px;color:#666;font-weight:600;margin-bottom:6px;">📌 视频信息 / 原链接</div>
        <div class="tabbit-video-meta-body">
          <div class="tabbit-video-title">${escapeHtml(safeInfo.title || '未知标题')}</div>
          <div>UP主: ${escapeHtml(safeInfo.upName || '未知')}</div>
          ${safeInfo.desc ? '<div style="margin-top:6px;white-space:pre-wrap;">简介: ' + escapeHtml(limitText(safeInfo.desc, 500)) + '</div>' : ''}
          <div class="tabbit-video-url-inline">🔗 <a href="${safeHref(pageUrl)}" target="_blank" rel="noopener">${escapeHtml(pageUrl)}</a></div>
        </div>
      </div>
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
  function insertInlineAbortBtn(container, onAbort) {
    const btn = document.createElement('button');
    btn.className = 'tabbit-inline-abort-btn';
    btn.innerHTML = '⏹ 打断生成';
    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.innerHTML = '⏳ 打断中...';
      if (typeof onAbort === 'function') onAbort();
    });
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
  function buildFlomoContent(text) {
    const plainText = markdownToPlainText(text);
    const tags = (CONFIG.flomoTags || '').trim();
    if (!tags) return plainText;
    return plainText + '\n\n' + tags;
  }

  async function sendToFlomo(text, btn) {
    if (!CONFIG.flomoApiUrl) {
      alert('请先在设置中配置 flomo API 地址');
      return;
    }
    const content = buildFlomoContent(text);
    const originalText = btn.textContent;
    btn.textContent = '⏳ 发送中...';
    btn.disabled = true;
    try {
      const res = await fetch(CONFIG.flomoApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error('HTTP ' + res.status + ' ' + errText);
      }
      const data = await res.json();
      if (data.code === 0 || data.code === 200 || data.message === 'ok') {
        btn.textContent = '✅ 已发送';
        setTimeout(() => { btn.textContent = '🌱 flomo'; btn.disabled = false; }, 2000);
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

  // ==================== 手动生图功能 ====================
  async function triggerManualImageGen(contentDiv, summaryText, videoInfo, btn) {
    const apiUrl = CONFIG.imageGenApiUrl || CONFIG.apiUrl;
    const apiKey = CONFIG.imageGenApiKey || CONFIG.apiKey;
    const model = CONFIG.imageGenModel || 'gemini-2.0-flash-preview-image-generation';

    if (!apiUrl || !apiKey) {
      alert('请先在设置中配置生图模型的 API URL 和 API Key');
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 生成中...';

    const summaryForImage = (summaryText || '').slice(0, IMAGE_GEN_SUMMARY_MAX_LEN).replace(/[#*_\[\]()]/g, '');
    const promptTemplate = CONFIG.imageGenPromptText || IMAGE_GEN_PROMPT_TEXT;
    const imagePrompt = promptTemplate.includes('{summary}')
      ? promptTemplate.replace('{summary}', summaryForImage)
      : promptTemplate + '\n\n' + summaryForImage;

    let imageApiUrl = apiUrl.trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(imageApiUrl)) {
      imageApiUrl = imageApiUrl.replace(/\/chat\/completions$/, '/images/generations');
    } else if (/\/completions$/.test(imageApiUrl)) {
      imageApiUrl = imageApiUrl.replace(/\/completions$/, '/images/generations');
    } else {
      imageApiUrl = imageApiUrl.replace(/\/v1\/.*$/, '/v1/images/generations');
    }

    console.log('[省流助手-手动生图] 调用:', imageApiUrl, '| 模型:', model);

    let imageDataUrl = '';

    try {
      const imageRes = await fetch(imageApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: model, prompt: imagePrompt, n: 1, size: CONFIG.imageGenSize || '1024x1024', response_format: 'b64_json' })
      });

      if (imageRes.ok) {
        const imageData = await imageRes.json();
        if (imageData.data && imageData.data.length > 0) {
          const imgItem = imageData.data[0];
          if (imgItem.b64_json) imageDataUrl = 'data:image/png;base64,' + imgItem.b64_json;
          else if (imgItem.url) imageDataUrl = imgItem.url;
        }
      }

      if (!imageDataUrl) {
        const imageRes2 = await fetch(imageApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          body: JSON.stringify({ model: model, prompt: imagePrompt, n: 1, size: CONFIG.imageGenSize || '1024x1024' })
        });
        if (imageRes2.ok) {
          const imageData2 = await imageRes2.json();
          if (imageData2.data && imageData2.data.length > 0) {
            const imgItem2 = imageData2.data[0];
            if (imgItem2.url) imageDataUrl = imgItem2.url;
            else if (imgItem2.b64_json) imageDataUrl = 'data:image/png;base64,' + imgItem2.b64_json;
          }
        }
      }

      if (!imageDataUrl) {
        throw new Error('生图 API 未返回图片数据');
      }

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

      if (CONFIG.enableImageAutoDownload !== false) {
        downloadGeneratedImage(imageDataUrl, videoInfo, '_配图');
      }

      btn.textContent = '✅ 已生成';
      btn.disabled = true;
      console.log('[省流助手-手动生图] ✅ 图片生成成功');
    } catch (err) {
      console.error('[省流助手-手动生图] 失败:', err);
      alert('生成配图失败: ' + err.message);
      btn.textContent = '🖼️ 生成配图';
      btn.disabled = false;
    }
  }

  // 🆕 流式总结的最终装配（流式结束时调用，挂上完整的按钮区）
  function finalizeSummaryUI(contentDiv, result, _url, videoInfo) {
    rawMarkdownResult = result;
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
      flomoBtn.textContent = '🌱 flomo';
      flomoBtn.addEventListener('click', function() { sendToFlomo(rawMarkdownResult, this); });
      const genImgBtn = document.createElement('button');
      genImgBtn.className = 'tabbit-copy-btn';
      genImgBtn.textContent = '🖼️ 生成配图';
      genImgBtn.addEventListener('click', function() {
        triggerManualImageGen(contentDiv, result, videoInfo, genImgBtn);
      });
      actionsDiv.appendChild(copyBtn);
      actionsDiv.appendChild(flomoBtn);
      actionsDiv.appendChild(genImgBtn);
      actionsDiv.appendChild(downloadBtn);
      actionsDiv.appendChild(modelTag);
    }
  }

  // ==================== 无字幕状态展示 ====================
  function showNoSubtitleState(panel, videoInfo, isShortVideo) {
    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');

    panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.add('disabled'));

    const skipSec = CONFIG.skipDuration || 60;
    const noSubIcon = isShortVideo ? '⏱️' : '🔇';
    const noSubTitle = isShortVideo ? '视频时长不足' + skipSec + '秒，已跳过自动获取' : '未检测到字幕';
    const noSubDesc = isShortVideo
      ? '短视频已自动跳过字幕获取（阈值' + skipSec + '秒，可在设置中修改）。如仍需摘要，可点击下方按钮手动获取，或总结评论区！'
      : '该视频暂无可用字幕，无法生成视频摘要。可尝试手动获取，或使用下方按钮总结评论区！';

    contentDiv.innerHTML = `
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
      <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn">
        <span class="tabbit-btn-icon">💬</span>
        <span>总结评论区</span>
      </button>
      ${renderVideoMetaBottomHtml(videoInfo, window.location.href)}
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
    const res = await fetch(CONFIG.apiUrl, {
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
   * @param {Object} options - { apiUrl, apiKey, model, signal } 自定义参数（可选）
   * @returns {Promise<string>} 完整文本
   */
  async function callAIStream(messages, onDelta, options) {
    options = options || {};
    const apiUrl = options.apiUrl || CONFIG.apiUrl;
    const apiKey = options.apiKey || CONFIG.apiKey;
    const model = options.model || currentModel;
    const signal = options.signal; // 🆕 AbortSignal

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
          temperature: 0.7,
          max_tokens: 2000,
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
      { apiUrl: summaryApiUrl, apiKey: summaryApiKey, model: summaryModel }
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

    const summaryForImage = textContent.slice(0, IMAGE_GEN_SUMMARY_MAX_LEN).replace(/[#*_\[\]()]/g, '');
    const promptTemplate = CONFIG.imageGenPromptText || IMAGE_GEN_PROMPT_TEXT;
    const imagePrompt = promptTemplate.includes('{summary}')
      ? promptTemplate.replace('{summary}', summaryForImage)
      : promptTemplate + '\n\n' + summaryForImage;

    let imageApiUrl = apiUrl.trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(imageApiUrl)) {
      imageApiUrl = imageApiUrl.replace(/\/chat\/completions$/, '/images/generations');
    } else if (/\/completions$/.test(imageApiUrl)) {
      imageApiUrl = imageApiUrl.replace(/\/completions$/, '/images/generations');
    } else {
      imageApiUrl = imageApiUrl.replace(/\/v1\/.*$/, '/v1/images/generations');
    }
    console.log('[省流助手-生图] 第2步：调用生图端点:', imageApiUrl);

    let imageDataUrl = '';
    try {
      const imageRes = await fetch(imageApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: model,
          prompt: imagePrompt,
          n: 1,
          size: CONFIG.imageGenSize || '1024x1024',
          response_format: 'b64_json'
        }),
        signal: signal  // 🆕 加这一行
      });

      if (imageRes.ok) {
        const imageData = await imageRes.json();
        if (imageData.data && imageData.data.length > 0) {
          const imgItem = imageData.data[0];
          if (imgItem.b64_json) imageDataUrl = 'data:image/png;base64,' + imgItem.b64_json;
          else if (imgItem.url) imageDataUrl = imgItem.url;
        }
      } else {
        console.warn('[省流助手-生图] 生图端点返回错误:', imageRes.status);
      }
    } catch (imgErr) {
      if (isAbortError(imgErr)) throw imgErr; // 🆕 打断直接抛出
      console.warn('[省流助手-生图] 生图请求异常:', imgErr.message);
    }

    if (!imageDataUrl) {
      try {
        const imageRes2 = await fetch(imageApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: model,
            prompt: imagePrompt,
            n: 1,
            size: CONFIG.imageGenSize || '1024x1024'
          }),
          signal: signal  // 🆕 加这一行
        });
        if (imageRes2.ok) {
          const imageData2 = await imageRes2.json();
          if (imageData2.data && imageData2.data.length > 0) {
            const imgItem2 = imageData2.data[0];
            if (imgItem2.url) imageDataUrl = imgItem2.url;
            else if (imgItem2.b64_json) imageDataUrl = 'data:image/png;base64,' + imgItem2.b64_json;
          }
        }
      } catch (e) {
        if (isAbortError(e)) throw e; // 🆕 打断直接抛出
        console.warn('[省流助手-生图] 第二次生图尝试也失败:', e.message);
      }
    }

    if (!imageDataUrl) {
      throw new Error('生图 API 未返回图片数据');
    }
    console.log('[省流助手-生图] ✅ 图片生成成功');
    return imageDataUrl;
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
    rawMarkdownResult = textContent || '（生图模式 - 图片总结）';
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
          copyToClipboard(markdownToPlainText(textContent));
          copyBtn.textContent = '✅ 已复制';
          setTimeout(function() { copyBtn.textContent = '📋 复制文字'; }, 2000);
        });
        actionsDiv.appendChild(copyBtn);

        const flomoBtn = document.createElement('button');
        flomoBtn.className = 'tabbit-copy-btn';
        flomoBtn.textContent = '🌱 flomo';
        flomoBtn.addEventListener('click', function() { sendToFlomo(textContent, this); });
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
    if (!apiUrl) return '';
    let url = apiUrl.trim();
    url = url.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(url)) {
      return url.replace(/\/chat\/completions$/, '/models');
    }
    if (/\/completions$/.test(url)) {
      return url.replace(/\/completions$/, '/models');
    }
    if (/\/v\d+$/.test(url)) {
      return url + '/models';
    }
    return url + '/models';
  }

  async function fetchModelList(apiUrl, apiKey) {
    if (!apiUrl || !apiKey) {
      throw new Error('请先填写 API URL 和 API Key');
    }
    const modelsUrl = deriveModelsUrl(apiUrl);
    console.log('[省流助手] 获取模型列表:', modelsUrl);
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      }
    });
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
  function renderPresetBarHtml() {
    const presets = CONFIG.promptPresets || [];
    if (presets.length === 0) return '';
    const chips = presets.map(p => {
      const isActive = p.id === CONFIG.activePresetId;
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
        if (newId === CONFIG.activePresetId) return;
        CONFIG.activePresetId = newId;
        saveConfig(CONFIG);
        panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        conversationHistory = [];
        commentConversationHistory = [];
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

  function renderSummaryShell(panel, contentDiv, presetBarHtml, videoInfo, pageUrl) {
    const hasShell = contentDiv.querySelector('.tabbit-result')
      && contentDiv.querySelector('.tabbit-result-actions')
      && contentDiv.querySelector('#tabbit-comment-btn')
      && contentDiv.querySelector('.tabbit-chat-messages');

    if (hasShell) {
      const oldPresetBar = contentDiv.querySelector('.tabbit-preset-bar');
      if (oldPresetBar) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = presetBarHtml;
        const newPresetBar = wrapper.firstElementChild;
        if (newPresetBar) oldPresetBar.replaceWith(newPresetBar);
      } else {
        contentDiv.insertAdjacentHTML('afterbegin', presetBarHtml);
      }

      const resultContainer = contentDiv.querySelector('.tabbit-result');
      resultContainer.innerHTML = '<span class="tabbit-typing-cursor"></span>';
      let imageSlot = contentDiv.querySelector('.tabbit-image-slot');
      if (!imageSlot) {
        resultContainer.insertAdjacentHTML('beforebegin', '<div class="tabbit-image-slot"></div>');
        imageSlot = contentDiv.querySelector('.tabbit-image-slot');
      }
      imageSlot.innerHTML = '';
      contentDiv.querySelector('.tabbit-result-actions').innerHTML = '';
      contentDiv.querySelector('.tabbit-chat-messages').innerHTML = '';

      const oldMeta = contentDiv.querySelector('.tabbit-video-info-bottom');
      const metaHtml = renderVideoMetaBottomHtml(videoInfo, pageUrl);
      if (oldMeta) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = metaHtml;
        const newMeta = wrapper.firstElementChild;
        if (newMeta) oldMeta.replaceWith(newMeta);
      } else {
        const chatMessages = contentDiv.querySelector('.tabbit-chat-messages');
        if (chatMessages) chatMessages.insertAdjacentHTML('beforebegin', metaHtml);
      }

      const commentBtn = contentDiv.querySelector('#tabbit-comment-btn');
      commentBtn.disabled = true;
    } else {
      contentDiv.innerHTML = `
      ${presetBarHtml}
      <div class="tabbit-image-slot"></div>
      <div class="tabbit-result"><span class="tabbit-typing-cursor"></span></div>
        <div class="tabbit-result-actions"></div>
        <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn" disabled>
          <span class="tabbit-btn-icon">💬</span>
          <span>总结评论区</span>
        </button>
        ${renderVideoMetaBottomHtml(videoInfo, pageUrl)}
        <div class="tabbit-chat-messages"></div>
      `;
    }

    bindPresetChips(panel, videoInfo);
    bindCommentButton(contentDiv, panel, videoInfo, false);
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
    panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
    panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('disabled'));
  }

  function startAsyncImageGeneration(contentDiv, textContent, videoInfo) {
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
        if (imgAbortBtnWrap && imgAbortBtnWrap.parentNode) imgAbortBtnWrap.remove();
        updateImageResult(contentDiv, imageDataUrl, videoInfo);
        if (currentAbortController === imgAbortController) currentAbortController = null;
      })
      .catch(function(imgErr) {
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
    const activePreset = (CONFIG.promptPresets || []).find(p => p.id === CONFIG.activePresetId);
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
    const cacheKey = buildSummaryCacheKey(videoInfo, currentModel, CONFIG.activePresetId, activePrompt, transcript);

    renderSummaryShell(panel, contentDiv, presetBarHtml, videoInfo, pageUrl);

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
          { apiUrl: summaryApiUrl, apiKey: summaryApiKey, model: summaryModel, signal: localController.signal }
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
          presetId: CONFIG.activePresetId,
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

        const reply = await callAIStream(messages, onDelta, { signal: localController.signal });

        conversationHistory = [
          { role: 'user', content: fullPrompt },
          { role: 'assistant', content: reply }
        ];
        setCachedSummary(cacheKey, {
          summary: reply,
          model: currentModel,
          presetId: CONFIG.activePresetId,
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

    const oldSection = contentDiv.querySelector('.tabbit-comment-section');
    if (oldSection) oldSection.remove();

    let commentSection = document.createElement('div');
    commentSection.className = 'tabbit-comment-section';
    commentSection.innerHTML = `
      <div class="tabbit-comment-section-title">💬 评论区总结</div>
      <div class="tabbit-loading">
        <div class="tabbit-spinner"></div>
        <span id="tabbit-comment-status">正在获取评论...</span>
      </div>
    `;

    const chatMessages = contentDiv.querySelector('.tabbit-chat-messages');
    if (chatMessages) {
      contentDiv.insertBefore(commentSection, chatMessages);
    } else {
      contentDiv.appendChild(commentSection);
    }

    const statusEl = commentSection.querySelector('#tabbit-comment-status');

    // 🆕 准备 AbortController
    abortCurrentTask();
    currentAbortController = new AbortController();
    const localController = currentAbortController;
    let abortBtn = null;

    try {
      const aid = getAid(videoInfo);
      if (!aid) throw new Error('无法获取视频 aid');

      const comments = await fetchAllComments(aid, (msg) => {
        if (statusEl) statusEl.textContent = msg;
      });
      if (comments.length === 0) throw new Error('该视频没有评论');

      // 🆕 检查是否已被打断（评论抓取阶段）
      if (localController.signal.aborted) {
        const abortErr = new Error('用户已打断');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      if (statusEl) statusEl.textContent = '已获取 ' + comments.length + ' 条评论，AI 正在流式总结...';

      const commentsText = formatCommentsText(comments);
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

      const reply = await callAIStream(messages, onDelta, { signal: localController.signal });

      commentConversationHistory = [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: reply }
      ];

      resultEl.innerHTML = parseMarkdown(reply);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'tabbit-comment-actions';
      actionsDiv.innerHTML = `
        <button class="tabbit-copy-btn" id="tabbit-copy-comment">📋 复制评论总结</button>
        <button class="tabbit-copy-btn" id="tabbit-flomo-comment">🌱 flomo</button>
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

  // ==================== 对话功能（流式 + 打断） ====================
  async function handleSend(panel) {
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');
    const text = input.value.trim();
    if (!text) return;
    if (conversationHistory.length === 0) {
      alert('请等待初始摘要完成后再发起对话');
      return;
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
      conversationHistory.push({ role: 'user', content: text });

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

      const reply = await callAIStream(sentMessages, onDelta, { signal: localController.signal });
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

          <div class="tabbit-collapse open">
            <div class="tabbit-collapse-header" data-collapse="api-settings">
              <div class="tabbit-collapse-title">🤖 大模型 API 设置</div>
              <span class="tabbit-collapse-arrow">▶</span>
            </div>
            <div class="tabbit-collapse-body">
              <div class="tabbit-settings-group">
                <div class="tabbit-settings-label">API URL</div>
                <input class="tabbit-settings-input" id="ts-apiUrl" type="text" value="${escapeHtml(CONFIG.apiUrl || '')}" placeholder="https://your-api/v1/chat/completions" />
                <div class="tabbit-settings-hint">OpenAI 兼容接口地址</div>
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

          <div class="tabbit-settings-group">
            <div class="tabbit-settings-label">🎨 视频摘要预设（多个总结风格，可在面板中切换）</div>
            <div class="tabbit-preset-manage-list" id="ts-preset-list"></div>
            <button class="tabbit-preset-add-btn" id="ts-preset-add">＋ 添加新预设</button>
            <div class="tabbit-settings-hint">每个预设有独立的提示词，在主面板可一键切换并重新分析</div>
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
            </div>
          </div>

          <div class="tabbit-settings-group" style="background:linear-gradient(135deg,#f0f4ff 0%,#fff5f8 100%);border:1px solid #d6e0ff;border-radius:10px;padding:14px 16px;">
            <div class="tabbit-switch-row">
              <div>
                <div class="tabbit-settings-label">🖼️ 总结生图模式</div>
                <div class="tabbit-settings-hint" style="margin-top:2px;">开启后，每次总结完成时会自动调用生图模型生成配图。<br>关闭时仍可通过结果区的「生成配图」按钮手动触发生图。</div>
              </div>
              <label class="tabbit-switch">
                <input type="checkbox" id="ts-enableImageGen" ${CONFIG.enableImageGen ? 'checked' : ''} />
                <span class="tabbit-slider"></span>
              </label>
            </div>
            <div id="ts-imageGen-fields" style="margin-top:12px;${CONFIG.enableImageGen ? '' : 'display:none;'}">
              <div style="margin-bottom:10px;">
                <div class="tabbit-settings-label">生图模型 API URL</div>
                <input class="tabbit-settings-input" id="ts-imageGenApiUrl" type="text" value="${escapeHtml(CONFIG.imageGenApiUrl || '')}" placeholder="留空则使用上方的 API URL" />
                <div class="tabbit-settings-hint">生图模型的 API 地址（OpenAI 兼容格式），留空则复用上方的 API URL</div>
              </div>
              <div style="margin-bottom:10px;">
                <div class="tabbit-settings-label">生图模型 API Key</div>
                <input class="tabbit-settings-input" id="ts-imageGenApiKey" type="password" value="${escapeHtml(CONFIG.imageGenApiKey || '')}" placeholder="留空则使用上方的 API Key" />
                <div class="tabbit-settings-hint">生图模型的 API 密钥，留空则复用上方的 API Key</div>
              </div>
              <div style="margin-bottom:10px;">
                <div class="tabbit-settings-label">生图模型名称</div>
                <input class="tabbit-settings-input" id="ts-imageGenModel" type="text" value="${escapeHtml(CONFIG.imageGenModel || 'gemini-2.0-flash-preview-image-generation')}" placeholder="gemini-2.0-flash-preview-image-generation" />
                <div class="tabbit-settings-hint">支持图片输出的模型名称，默认 gemini-2.0-flash-preview-image-generation</div>
              </div>
              <div>
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
              <div style="margin-top:10px;">
                <div class="tabbit-settings-label">🎨 生图提示词（自动+手动生图共用）</div>
                <textarea class="tabbit-settings-textarea" id="ts-imageGenPromptText" placeholder="生图提示词，使用 {summary} 作为视频总结的占位符...">${escapeHtml(CONFIG.imageGenPromptText || IMAGE_GEN_PROMPT_TEXT)}</textarea>
                <div class="tabbit-settings-hint">用于指导生图模型的提示词模板。使用 <code style="background:#eef;padding:1px 4px;border-radius:3px;">{summary}</code> 占位符表示视频总结内容（运行时自动替换）。如不写占位符，总结会自动追加在末尾。</div>
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

    overlay.querySelector('#ts-preset-add').addEventListener('click', function() {
      editingPresets.push({
        id: 'preset_' + Date.now(),
        name: '新预设',
        icon: '✨',
        prompt: '请总结视频内容...'
      });
      renderPresetEditList();
    });

    const imageGenToggle = overlay.querySelector('#ts-enableImageGen');
    const imageGenFields = overlay.querySelector('#ts-imageGen-fields');
    if (imageGenToggle && imageGenFields) {
      imageGenToggle.addEventListener('change', function() {
        imageGenFields.style.display = imageGenToggle.checked ? '' : 'none';
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
      const newModelListRaw = overlay.querySelector('#ts-modelList').value;
      const newModelList = newModelListRaw.split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });

      const newFlomoApiUrl = overlay.querySelector('#ts-flomoApiUrl').value.trim();
      const newFlomoTags = overlay.querySelector('#ts-flomoTags').value.trim();
      const newCommentPromptText = overlay.querySelector('#ts-commentPromptText').value.trim();
      const newCommentTextPresets = (overlay.querySelector('#ts-commentTextPresets').value || '')
        .split('\n')
        .map(function(s) { return s.trim(); })
        .filter(Boolean);
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
      CONFIG.flomoApiUrl = newFlomoApiUrl;
      CONFIG.flomoTags = newFlomoTags;
      CONFIG.modelList = newModelList.length > 0 ? newModelList : DEFAULT_CONFIG.modelList;
      CONFIG.promptPresets = cleanedPresets;
      CONFIG.activePresetId = validActiveId;
      const activeP = cleanedPresets.find(function(p) { return p.id === validActiveId; });
      if (activeP) CONFIG.promptText = activeP.prompt;
      CONFIG.commentPromptText = newCommentPromptText || COMMENT_PROMPT_TEXT;
      CONFIG.commentTextPresets = newCommentTextPresets.length > 0 ? newCommentTextPresets : DEFAULT_CONFIG.commentTextPresets.slice();
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
            if (imported.commentMaxPages !== undefined) overlay.querySelector('#ts-commentMaxPages').value = imported.commentMaxPages;
            if (imported.commentLimit !== undefined) overlay.querySelector('#ts-commentLimit').value = imported.commentLimit;
            if (imported.commentMinDelay !== undefined) overlay.querySelector('#ts-commentMinDelay').value = imported.commentMinDelay;
            if (imported.commentMaxDelay !== undefined) overlay.querySelector('#ts-commentMaxDelay').value = imported.commentMaxDelay;
            if (imported.skipDuration !== undefined) overlay.querySelector('#ts-skipDuration').value = imported.skipDuration;
            if (imported.autoParse !== undefined) overlay.querySelector('#ts-autoParse').checked = !!imported.autoParse;
            if (imported.enableImageGen !== undefined) overlay.querySelector('#ts-enableImageGen').checked = !!imported.enableImageGen;
            if (imported.imageGenApiUrl !== undefined) overlay.querySelector('#ts-imageGenApiUrl').value = imported.imageGenApiUrl;
            if (imported.imageGenApiKey !== undefined) overlay.querySelector('#ts-imageGenApiKey').value = imported.imageGenApiKey;
            if (imported.imageGenModel) overlay.querySelector('#ts-imageGenModel').value = imported.imageGenModel;
            if (imported.imageGenSize) { var igSizeEl = overlay.querySelector('#ts-imageGenSize'); if (igSizeEl) igSizeEl.value = imported.imageGenSize; }
            if (imported.enableImageAutoDownload !== undefined) {
              var igAutoDownloadEl = overlay.querySelector('#ts-enableImageAutoDownload');
              if (igAutoDownloadEl) igAutoDownloadEl.checked = !!imported.enableImageAutoDownload;
            }
            if (imported.imageGenPromptText !== undefined) overlay.querySelector('#ts-imageGenPromptText').value = imported.imageGenPromptText;
            var igFields = overlay.querySelector('#ts-imageGen-fields');
            if (igFields) igFields.style.display = overlay.querySelector('#ts-enableImageGen').checked ? '' : 'none';

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
      overlay.querySelector('#ts-modelList').value = DEFAULT_CONFIG.modelList.join('\n');
      overlay.querySelector('#ts-flomoApiUrl').value = '';
      overlay.querySelector('#ts-flomoTags').value = DEFAULT_CONFIG.flomoTags;
      overlay.querySelector('#ts-commentPromptText').value = COMMENT_PROMPT_TEXT;
      overlay.querySelector('#ts-commentTextPresets').value = DEFAULT_CONFIG.commentTextPresets.join('\n');
      overlay.querySelector('#ts-commentMaxPages').value = DEFAULT_CONFIG.commentMaxPages;
      overlay.querySelector('#ts-commentLimit').value = DEFAULT_CONFIG.commentLimit;
      overlay.querySelector('#ts-commentMinDelay').value = DEFAULT_CONFIG.commentMinDelay;
      overlay.querySelector('#ts-commentMaxDelay').value = DEFAULT_CONFIG.commentMaxDelay;
      overlay.querySelector('#ts-skipDuration').value = DEFAULT_CONFIG.skipDuration;
      overlay.querySelector('#ts-autoParse').checked = DEFAULT_CONFIG.autoParse;
      overlay.querySelector('#ts-enableImageGen').checked = false;
      overlay.querySelector('#ts-imageGenApiUrl').value = '';
      overlay.querySelector('#ts-imageGenApiKey').value = '';
      overlay.querySelector('#ts-imageGenModel').value = DEFAULT_CONFIG.imageGenModel;
      var igSizeReset = overlay.querySelector('#ts-imageGenSize'); if (igSizeReset) igSizeReset.value = '1024x1024';
      var igAutoDownloadReset = overlay.querySelector('#ts-enableImageAutoDownload'); if (igAutoDownloadReset) igAutoDownloadReset.checked = DEFAULT_CONFIG.enableImageAutoDownload;
      overlay.querySelector('#ts-imageGenPromptText').value = IMAGE_GEN_PROMPT_TEXT;
      var igFieldsReset = overlay.querySelector('#ts-imageGen-fields');
      if (igFieldsReset) igFieldsReset.style.display = 'none';
      editingPresets = JSON.parse(JSON.stringify(DEFAULT_PRESETS));
      editingActiveId = 'preset_default';
      renderPresetEditList();
    });
  }
  // ==================== 字幕可用性检测 ====================
  function checkAnySubtitleAvailable() {
    const aiSubtitleButton = document.querySelector('.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]');
    const subtitleButtons = document.querySelectorAll('.bpx-player-ctrl-subtitle-language-item');
    const subtitleToggle = document.querySelector('.bpx-player-ctrl-subtitle');
    return aiSubtitleButton !== null || subtitleButtons.length > 0 || subtitleToggle !== null;
  }

  function waitForSubtitleButton(maxWait, interval) {
    maxWait = maxWait || 100;
    interval = interval || 50;
    return new Promise(function(resolve) {
      const startTime = Date.now();
      function check() {
        if (checkAnySubtitleAvailable()) {
          console.log('[省流助手] 检测到字幕按钮，耗时 ' + (Date.now() - startTime) + 'ms');
          resolve(true);
          return;
        }
        if (Date.now() - startTime >= maxWait) {
          console.log('[省流助手] 等待字幕按钮超时（' + maxWait + 'ms），判定为无字幕');
          resolve(false);
          return;
        }
        setTimeout(check, interval);
      }
      check();
    });
  }

  function getRouteKey() {
    return window.location.href;
  }

  function resetRuntimeForRouteChange() {
    abortCurrentTask();
    rawMarkdownResult = '';
    rawTranscript = '';
    currentVideoInfo = null;
    conversationHistory = [];
    commentConversationHistory = [];
    isCommentSummarizing = false;
    hasParsed = false;
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
  async function startParsing() {
    if (hasParsed) return;
    hasParsed = true;
    const parsingGeneration = routeGeneration;
    lastRouteKey = getRouteKey();

    console.log('[省流助手] 开始解析...');
    const videoInfo = getVideoInfo();
    if (!videoInfo.bvid) {
      console.log('[省流助手] 无法获取BVID，跳过');
      hasParsed = false;
      return;
    }
    currentVideoInfo = videoInfo;
    console.log('[省流助手] 视频信息 - 标题: ' + videoInfo.title + ', BVID: ' + videoInfo.bvid + ', CID: ' + videoInfo.cid);

    createStyles();
    const panel = createPanel(videoInfo);

    const skipSec = CONFIG.skipDuration || 60;
    if (videoInfo.duration > 0 && videoInfo.duration < skipSec) {
      console.log('[省流助手] 视频时长不足' + skipSec + '秒，跳过自动字幕获取');
      showNoSubtitleState(panel, videoInfo, true);
      return;
    }

    console.log('[省流助手] 检测字幕可用性...');
    const loadingSpan = panel.querySelector('.tabbit-panel-content .tabbit-loading span');
    if (loadingSpan) loadingSpan.textContent = '正在检测字幕可用性...';

    const hasSubtitleButton = await waitForSubtitleButton(1000, 500);
    if (isStaleRoute(parsingGeneration)) return;
    if (!hasSubtitleButton) {
      showNoSubtitleState(panel, videoInfo);
      return;
    }

    if (loadingSpan) loadingSpan.textContent = '正在获取字幕并生成摘要...';

    let subtitles = await fetchSubtitles(videoInfo.cid, videoInfo.bvid);
    if (isStaleRoute(parsingGeneration)) return;

    // ✅ 兜底：首次获取字幕为空时，等待 2 秒后重新获取视频信息并重试
    // 解决 B 站 SPA 页面初始化时 __INITIAL_STATE__ 数据尚未就绪的问题
    if (subtitles.length === 0) {
      console.log('[省流助手] 首次获取字幕为空，2 秒后重试...');
      if (loadingSpan) loadingSpan.textContent = '首次获取字幕为空，等待重试...';
      await new Promise(function(r) { setTimeout(r, 2000); });
      if (isStaleRoute(parsingGeneration)) return;

      // 重新获取最新视频信息（此时 B 站数据可能已更新）
      var freshInfo = getVideoInfo();
      if (freshInfo.bvid) {
        videoInfo = freshInfo;
        currentVideoInfo = videoInfo;
        console.log('[省流助手] 重试时刷新视频信息 - BVID: ' + videoInfo.bvid + ', CID: ' + videoInfo.cid);
      }

      if (loadingSpan) loadingSpan.textContent = '正在重新获取字幕...';
      subtitles = await fetchSubtitles(videoInfo.cid, videoInfo.bvid);
      if (isStaleRoute(parsingGeneration)) return;
    }

    if (subtitles.length === 0) {
      showNoSubtitleState(panel, videoInfo);
      return;
    }

    const targetSubtitle = subtitles.find(s => s.lan === 'zh-CN' || s.lan === 'ai-zh') || subtitles[0];
    const content = await fetchSubtitleContent(targetSubtitle.subtitle_url);
    if (isStaleRoute(parsingGeneration)) return;
    if (content.length === 0) {
      showNoSubtitleState(panel, videoInfo);
      return;
    }

    const transcript = formatTranscript(content);
    if (!transcript.trim()) {
      showNoSubtitleState(panel, videoInfo);
      return;
    }

    rawTranscript = transcript;
    console.log('[省流助手] 字幕获取完成，共 ' + content.length + ' 条');
    if (isStaleRoute(parsingGeneration)) return;
    await runSummary(panel, transcript, videoInfo);
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
