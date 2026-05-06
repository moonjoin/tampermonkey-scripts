// ==UserScript==
// @name         B站省流助手 - 字幕AI摘要 Pro
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      3.5.6
// @description  自动提取B站视频字幕，通过自定义AI API生成极简摘要，支持模型切换、持续对话和评论区总结；配置项（API/模型列表）存储于localStorage，支持设置界面导入导出；支持自动解析开关、悬浮窗/面板可拖动、自动获取模型列表、flomo自动加标签
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

  // ==================== localStorage 配置存储层 ====================
  const STORAGE_KEY = 'bili_summary_pro_config';
  const POSITION_KEY = 'bili_summary_pro_positions';

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
    skipDuration: 60,
    autoParse: true,
    // ===== 提示词预设系统 =====
    promptPresets: DEFAULT_PRESETS,
    activePresetId: 'preset_default'
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

  // ===== 位置存储（面板和悬浮按钮的拖动位置）=====
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

  // 运行时配置
  let CONFIG = loadConfig();
  let POSITIONS = loadPositions();
  const INIT_DELAY_MS = 2000;
  const MAX_CONVERSATION_HISTORY = 21;

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

  // ==================== 评论区防Ban配置 ====================
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
  let hasParsed = false; // 是否已执行过解析

  // ==================== 视频信息获取 ====================
  function getVideoInfo() {
    let cid = null, bvid = null, aid = null, title = '', upName = '', duration = 0;
    try {
      const state = window.__INITIAL_STATE__;
      if (state?.videoData) {
        bvid = state.videoData.bvid;
        aid = state.aid || state.videoData.aid;
        cid = state.videoData.cid || state.videoData.pages?.[0]?.cid;
        title = state.videoData.title || '';
        upName = state.videoData.owner?.name || '';
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
    return { bvid, cid, aid, title, upName, duration };
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

    for (let page = 1; page <= COMMENT_CONFIG.maxPages; page++) {
      try {
        if (page > 1) {
          await randomDelay(COMMENT_CONFIG.minDelay, COMMENT_CONFIG.maxDelay);
        }

        const result = await retryWithBackoff(
          () => fetchComments(safeFetch, aid, page),
          COMMENT_CONFIG.maxRetries,
          COMMENT_CONFIG.retryBaseDelay
        );

        const replies = result?.replies;
        if (!replies || replies.length === 0) break;

        for (const reply of replies) {
          if (allComments.length >= COMMENT_CONFIG.commentLimit) break;
          const name = reply.member?.uname || '匿名';
          const text = reply.content?.message || '';
          const like = reply.like || 0;
          allComments.push({ name, text, like });

          if (COMMENT_CONFIG.includeReplies && reply.replies) {
            for (const sub of reply.replies) {
              if (allComments.length >= COMMENT_CONFIG.commentLimit) break;
              const subName = sub.member?.uname || '匿名';
              const subText = sub.content?.message || '';
              const subLike = sub.like || 0;
              allComments.push({ name: subName, text: subText, like: subLike, isReply: true });
            }
          }
        }

        if (statusCallback) statusCallback('已获取 ' + allComments.length + ' 条评论 (第' + page + '页)...');

        if (replies.length < COMMENT_CONFIG.pageSize) break;
        if (allComments.length >= COMMENT_CONFIG.commentLimit) break;

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

  function parseMarkdown(text) {
    let html = text;
    html = html.replace(/&/g, '&amp;');
    html = html.replace(/</g, '&lt;');
    html = html.replace(/>/g, '&gt;');
    html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em class="md-em">$1</em>');
    html = html.replace(/_(.+?)_/g, '<em class="md-em">$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');
    html = html.replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>');
    html = html.replace(/(<li class="md-li">.+<\/li>\n?)+/g, function(match) {
      return '<ul class="md-ul">' + match + '</ul>';
    });
    html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-li-ol">$1</li>');
    html = html.replace(/(<li class="md-li-ol">.+<\/li>\n?)+/g, function(match) {
      return '<ol class="md-ol">' + match + '</ol>';
    });
    html = html.replace(/^---$/gm, '<hr class="md-hr">');

    const lines = html.split('\n');
    const processedLines = [];
    let paragraphContent = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isSpecial = /^<(h[1-6]|ul|ol|li|blockquote|hr)/.test(line) || line.trim() === '';
      if (isSpecial) {
        if (paragraphContent.length > 0) {
          processedLines.push('<p class="md-p">' + paragraphContent.join(' ') + '</p>');
          paragraphContent = [];
        }
        processedLines.push(line);
      } else {
        paragraphContent.push(line);
      }
    }
    if (paragraphContent.length > 0) {
      processedLines.push('<p class="md-p">' + paragraphContent.join(' ') + '</p>');
    }
    html = processedLines.join('\n');
    html = html.replace(/<p class="md-p">\s*<\/p>/g, '');
    return html;
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
      #tabbit-ai-summary-panel {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 480px;
        max-height: 90vh;
        background: white;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
        animation: slideInRight 0.3s ease;
        display: flex;
        flex-direction: column;
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
      .tabbit-result {
        background: #f8f9fa;
        border-radius: 12px;
        padding: 14px 16px;
        word-break: break-word;
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
      .tabbit-url {
        margin-top: 10px;
        padding: 10px;
        background: #e8f4f8;
        border-radius: 8px;
        font-size: 12px;
        word-break: break-all;
      }
      .tabbit-url a { color: #667eea; text-decoration: none; }
      .tabbit-url a:hover { text-decoration: underline; }
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

      .md-h1 { font-size: 18px; font-weight: 700; color: #1a1a2e; margin: 12px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #667eea; }
      .md-h2 { font-size: 16px; font-weight: 600; color: #2d2d44; margin: 12px 0 8px; }
      .md-h3 { font-size: 15px; font-weight: 600; color: #3d3d5c; margin: 10px 0 6px; }
      .md-p { margin: 8px 0; color: #333; line-height: 1.7; }
      .md-bold { font-weight: 600; color: #1a1a2e; }
      .md-em { font-style: italic; color: #555; }
      .md-code { background: #e8e8f0; color: #c7254e; padding: 2px 6px; border-radius: 4px; font-size: 12.5px; font-family: Consolas, Monaco, monospace; }
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

      /* 开关样式 */
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

      /* 输入+按钮组合 */
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

      /* ==================== 悬浮唤出按钮 ==================== */
      @keyframes tabbitFloatIn {
        from { opacity: 0; transform: scale(0.5); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes tabbitFloatPulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(102,126,234,0.45); }
        50% { box-shadow: 0 4px 24px rgba(102,126,234,0.75); }
      }
      #tabbit-float-btn {
        position: fixed;
        top: 50%;
        right: 0;
        z-index: 9999998;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 50px;
        padding: 10px 0;
        background: linear-gradient(160deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
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
            /* ==================== 预设切换栏 ==================== */
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

      /* ==================== 预设管理列表（设置面板内）==================== */
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
  // 让目标元素 target 通过 handle（默认 = target）拖动；拖动结束后调用 onEnd(left, top)
  // 当 handle === target 时，认为整个元素都是拖动手柄（不忽略按钮）
  // 当 handle !== target 时（比如 header），会自动忽略 handle 内部的按钮区域
  function makeDraggable(target, handle, onEnd) {
    handle = handle || target;
    const handleIsTarget = (handle === target);
    let isDragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let moved = false;

    handle.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      // 仅当 handle 不是 target 本身时，忽略 handle 内部按钮等可交互元素
      // （避免点击面板 header 上的关闭/设置按钮时触发拖动）
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
      // 切换为 left/top 定位（去掉 right/bottom/transform，避免位置突变）
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
      // 限制在视口内
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
    if (POSITIONS.panel) {
      panel.style.left = POSITIONS.panel.left + 'px';
      panel.style.top = POSITIONS.panel.top + 'px';
      panel.style.right = 'auto';
    }
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
        <div class="tabbit-video-info">
          <div class="tabbit-video-title">${escapeHtml(videoInfo.title || '未知标题')}</div>
          <div>UP主: ${escapeHtml(videoInfo.upName || '未知UP主')}</div>
        </div>
        <div class="tabbit-loading">
          <div class="tabbit-spinner"></div>
          <span>准备中...</span>
        </div>
      </div>
      <div class="tabbit-chat-input-bar">
        <textarea class="tabbit-chat-input" placeholder="基于视频内容继续提问..." rows="1" disabled></textarea>
        <button class="tabbit-chat-send" disabled title="发送 (Enter)">➤</button>
      </div>
    `;
    document.body.appendChild(panel);

    // 应用保存的位置
    applyPanelPosition(panel);

    // 绑定拖动
    const header = panel.querySelector('.tabbit-panel-header');
    makeDraggable(panel, header, function(left, top) {
      POSITIONS.panel = { left, top };
      savePositions(POSITIONS);
    });

    panel.querySelector('.tabbit-close-btn').addEventListener('click', () => {
      panel.style.animation = 'slideOutRight 0.3s ease forwards';
      setTimeout(() => {
        panel.style.display = 'none';
        showFloatBtn(panel);
      }, 300);
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

  // ==================== 悬浮按钮 ====================
  function applyFloatBtnPosition(btn) {
    if (POSITIONS.floatBtn) {
      btn.style.left = POSITIONS.floatBtn.left + 'px';
      btn.style.top = POSITIONS.floatBtn.top + 'px';
      btn.style.right = 'auto';
      btn.style.transform = 'none';
    }
  }

  // showFloatBtn(panelOrNull) ：当 panel=null 时表示纯悬浮模式（未解析过），点击会触发解析
  function showFloatBtn(panel) {
    const old = document.querySelector('#tabbit-float-btn');
    if (old) old.remove();

    const btn = document.createElement('button');
    btn.id = 'tabbit-float-btn';
    btn.title = panel ? '打开省流助手（可拖动）' : '点击开始解析（可拖动）';
    btn.innerHTML = '<span class="tabbit-float-icon">🎬</span><span class="tabbit-float-label">省流助手</span>';
    document.body.appendChild(btn);

    applyFloatBtnPosition(btn);

    let dragMoved = false;
    makeDraggable(btn, btn, function(left, top) {
      POSITIONS.floatBtn = { left, top };
      savePositions(POSITIONS);
      dragMoved = true;
      // 短暂屏蔽 click，避免拖动后误触
      setTimeout(() => { dragMoved = false; }, 150);
    });

    btn.addEventListener('click', async () => {
      if (dragMoved) return;
      hideFloatBtn();
      if (panel) {
        // 已解析：恢复面板显示
        panel.style.animation = 'none';
        panel.style.display = 'flex';
        void panel.offsetWidth;
        panel.style.animation = 'slideInRight 0.3s ease';
      } else {
        // 未解析：触发解析流程
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

  function showResult(contentDiv, result, url, videoInfo) {
    rawMarkdownResult = result;
    const parsedHtml = parseMarkdown(result);
    const resultContainer = contentDiv.querySelector('.tabbit-result');
    if (resultContainer) {
      resultContainer.innerHTML = parsedHtml;
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
      actionsDiv.appendChild(copyBtn);
      actionsDiv.appendChild(flomoBtn);
      actionsDiv.appendChild(downloadBtn);
      actionsDiv.appendChild(modelTag);
    }
    const urlDiv = contentDiv.querySelector('.tabbit-url');
    if (urlDiv) {
      const link = urlDiv.querySelector('a');
      if (link) {
        link.href = url;
        link.textContent = url;
      }
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
      <div class="tabbit-video-info">
        <div class="tabbit-video-title">${escapeHtml(videoInfo.title || '未知标题')}</div>
        <div>UP主: ${escapeHtml(videoInfo.upName || '未知')}</div>
      </div>
      <div class="tabbit-no-subtitle">
        <div class="tabbit-no-subtitle-icon">${noSubIcon}</div>
        <div class="tabbit-no-subtitle-text">${noSubTitle}</div>
        <div style="font-size:12px;color:#a68500;margin-top:4px;">${noSubDesc}</div>
      </div>
      <button class="tabbit-manual-fetch-btn" id="tabbit-manual-fetch-btn">
        <span class="tabbit-btn-icon">🔄</span>
        <span>手动获取字幕总结</span>
      </button>
      <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn">
        <span class="tabbit-btn-icon">💬</span>
        <span>总结评论区</span>
      </button>
    `;

    const manualFetchBtn = contentDiv.querySelector('#tabbit-manual-fetch-btn');
    if (manualFetchBtn) {
      manualFetchBtn.addEventListener('click', () => manualFetchSubtitle(panel, videoInfo));
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

  // ==================== 自动获取模型列表 ====================
  // 从 apiUrl 推导出 /v1/models 接口地址
  function deriveModelsUrl(apiUrl) {
    if (!apiUrl) return '';
    // 常见格式: https://xxxx/v1/chat/completions  -> https://xxxx/v1/models
    let url = apiUrl.trim();
    // 去掉 trailing slash
    url = url.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(url)) {
      return url.replace(/\/chat\/completions$/, '/models');
    }
    if (/\/completions$/.test(url)) {
      return url.replace(/\/completions$/, '/models');
    }
    // 如果用户填的是 base url，例如 https://xxx/v1
    if (/\/v\d+$/.test(url)) {
      return url + '/models';
    }
    // 兜底：直接拼 /models
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
    // 兼容 OpenAI 标准格式: { data: [ { id: 'xxx' }, ... ] }
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
  // 渲染预设切换栏的 HTML
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

  // 绑定预设切换事件
  // 🆕 切换预设时：保留之前的对话内容，追加新预设的总结；不修改全局配置
  function bindPresetChips(panel, videoInfo) {
    panel.querySelectorAll('.tabbit-preset-chip').forEach(chip => {
      chip.addEventListener('click', async function() {
        if (chip.classList.contains('disabled')) return;
        const newId = chip.dataset.presetId;
        const preset = (CONFIG.promptPresets || []).find(p => p.id === newId);
        if (!preset) return;
        // 只切换 UI 高亮，不修改全局 CONFIG.activePresetId / CONFIG.promptText，不 saveConfig
        panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        // 用新预设追加总结（保留之前的对话内容）
        if (rawTranscript) {
          await appendPresetSummary(panel, preset, videoInfo || currentVideoInfo);
        }
      });
    });
  }

  /**
   * 🆕 追加预设总结：切换预设时调用，保留现有对话，用新预设的提示词追加一次总结
   * 不修改 CONFIG.activePresetId / CONFIG.promptText，不调用 saveConfig
   */
  async function appendPresetSummary(panel, preset, videoInfo) {
    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');

    // 禁用交互
    panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.add('disabled'));
    panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.add('disabled'));
    input.disabled = true;
    sendBtn.disabled = true;

    const pageUrl = window.location.href;
    const fullPrompt = preset.prompt + '\n\n视频URL: ' + pageUrl + '\n视频标题: ' + (videoInfo.title || '') + '\nUP主: ' + (videoInfo.upName || '') + '\n\n字幕内容:\n' + rawTranscript;

    // 确保有对话消息容器
    let messagesContainer = contentDiv.querySelector('.tabbit-chat-messages');
    if (!messagesContainer) {
      messagesContainer = document.createElement('div');
      messagesContainer.className = 'tabbit-chat-messages';
      contentDiv.appendChild(messagesContainer);
    }

    // 显示加载状态
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'tabbit-msg-loading';
    loadingMsg.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(loadingMsg);
    contentDiv.scrollTop = contentDiv.scrollHeight;

    // 添加一个分隔标识
    const dividerMsg = document.createElement('div');
    dividerMsg.style.cssText = 'text-align:center;font-size:11px;color:#999;margin:8px 0;padding:4px 0;border-top:1px dashed #e0e0e0;';
    dividerMsg.textContent = '🎨 切换风格：' + (preset.icon || '') + ' ' + preset.name;
    messagesContainer.insertBefore(dividerMsg, loadingMsg);

    try {
      // 用新预设的提示词发起请求（不清空 conversationHistory，但这次请求独立使用新 prompt）
      const messages = [{ role: 'user', content: fullPrompt }];
      const reply = await callAI(messages);

      // 将新的对话追加到 conversationHistory（这样后续追问可以基于最新的总结）
      conversationHistory.push({ role: 'user', content: fullPrompt });
      conversationHistory.push({ role: 'assistant', content: reply });

      // 移除加载动画
      loadingMsg.remove();

      // 追加 AI 回复到对话区域
      const aiWrap = document.createElement('div');
      aiWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;';
      const aiMsg = document.createElement('div');
      aiMsg.className = 'tabbit-msg tabbit-msg-ai';
      aiMsg.innerHTML = parseMarkdown(reply);
      const modelTag = document.createElement('div');
      modelTag.className = 'tabbit-msg-model';
      modelTag.textContent = '🤖 ' + currentModel + ' · ' + preset.name;
      aiWrap.appendChild(aiMsg);
      aiWrap.appendChild(modelTag);
      messagesContainer.appendChild(aiWrap);

      // 更新 rawMarkdownResult 为最新的总结
      rawMarkdownResult = reply;

      contentDiv.scrollTop = contentDiv.scrollHeight;
    } catch (err) {
      console.error('[省流助手-预设切换]', err);
      loadingMsg.remove();
      const errMsg = document.createElement('div');
      errMsg.className = 'tabbit-msg tabbit-msg-ai';
      errMsg.style.background = '#fff3f3';
      errMsg.style.color = '#c00';
      errMsg.textContent = '⚠️ ' + err.message;
      messagesContainer.appendChild(errMsg);
      contentDiv.scrollTop = contentDiv.scrollHeight;
    } finally {
      panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
      panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('disabled'));
      input.disabled = false;
      sendBtn.disabled = false;
    }
  }

  async function runSummary(panel, transcript, videoInfo) {
    const contentDiv = panel.querySelector('.tabbit-panel-content');
    const input = panel.querySelector('.tabbit-chat-input');
    const sendBtn = panel.querySelector('.tabbit-chat-send');

    panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.add('disabled'));
    panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.add('disabled'));
    input.disabled = true;
    sendBtn.disabled = true;

    const pageUrl = window.location.href;
    // 优先用当前激活的预设；fallback 到 promptText
    const activePreset = (CONFIG.promptPresets || []).find(p => p.id === CONFIG.activePresetId);
    const activePrompt = (activePreset && activePreset.prompt) || CONFIG.promptText || PROMPT_TEXT;
    const activePresetName = activePreset ? activePreset.name : '默认';
    const fullPrompt = activePrompt + '\n\n视频URL: ' + pageUrl + '\n视频标题: ' + (videoInfo.title || '') + '\nUP主: ' + (videoInfo.upName || '') + '\n\n字幕内容:\n' + transcript;

    const presetBarHtml = renderPresetBarHtml();

    contentDiv.innerHTML = `
      <div class="tabbit-video-info">
        <div class="tabbit-video-title">${escapeHtml(videoInfo.title || '未知标题')}</div>
        <div>UP主: ${escapeHtml(videoInfo.upName || '未知')}</div>
      </div>
      ${presetBarHtml}
      <div class="tabbit-loading">
        <div class="tabbit-spinner"></div>
        <span>🤖 ${currentModel} 正在用「${escapeHtml(activePresetName)}」分析字幕...</span>
      </div>
    `;
    bindPresetChips(panel, videoInfo);

    try {
      const messages = [{ role: 'user', content: fullPrompt }];
      const reply = await callAI(messages);

      conversationHistory = [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: reply }
      ];

      contentDiv.innerHTML = `
        <div class="tabbit-video-info">
          <div class="tabbit-video-title">${escapeHtml(videoInfo.title || '未知标题')}</div>
          <div>UP主: ${escapeHtml(videoInfo.upName || '未知')}</div>
        </div>
        ${presetBarHtml}
        <div class="tabbit-result"></div>
        <div class="tabbit-result-actions"></div>
        <div class="tabbit-url">🔗 <a href="" target="_blank"></a></div>
        <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn">
          <span class="tabbit-btn-icon">💬</span>
          <span>总结评论区</span>
        </button>
        <div class="tabbit-chat-messages"></div>
      `;
      bindPresetChips(panel, videoInfo);
      showResult(contentDiv, reply, pageUrl, videoInfo);

      const commentBtn = contentDiv.querySelector('#tabbit-comment-btn');
      if (commentBtn) {
        commentBtn.addEventListener('click', () => runCommentSummary(panel, videoInfo));
      }

      input.disabled = false;
      sendBtn.disabled = false;
      input.placeholder = '基于视频内容继续提问...';
    } catch (err) {
      console.error('[省流助手]', err);
      contentDiv.innerHTML = `
        <div class="tabbit-video-info">
          <div class="tabbit-video-title">${escapeHtml(videoInfo.title || '未知标题')}</div>
          <div>UP主: ${escapeHtml(videoInfo.upName || '未知')}</div>
        </div>
        ${presetBarHtml}
        <div class="tabbit-result"></div>
        <button class="tabbit-comment-summary-btn" id="tabbit-comment-btn">
          <span class="tabbit-btn-icon">💬</span>
          <span>总结评论区</span>
        </button>
      `;
      bindPresetChips(panel, videoInfo);
      showError(contentDiv, err.message);

      const commentBtn = contentDiv.querySelector('#tabbit-comment-btn');
      if (commentBtn) {
        commentBtn.addEventListener('click', () => runCommentSummary(panel, videoInfo));
      }
    } finally {
      panel.querySelectorAll('.tabbit-model-chip').forEach(c => c.classList.remove('disabled'));
      panel.querySelectorAll('.tabbit-preset-chip').forEach(c => c.classList.remove('disabled'));
    }
  }

  // ==================== 评论区总结主流程 ====================
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

    try {
      const aid = getAid(videoInfo);
      if (!aid) throw new Error('无法获取视频 aid');

      const comments = await fetchAllComments(aid, (msg) => {
        if (statusEl) statusEl.textContent = msg;
      });
      if (comments.length === 0) throw new Error('该视频没有评论');

      if (statusEl) statusEl.textContent = '已获取 ' + comments.length + ' 条评论，正在AI总结...';

      const commentsText = formatCommentsText(comments);
      const activeCommentPrompt = CONFIG.commentPromptText || COMMENT_PROMPT_TEXT;
      const fullPrompt = activeCommentPrompt + '\n\n评论内容如下：\n' + commentsText;

      const messages = [{ role: 'user', content: fullPrompt }];
      const reply = await callAI(messages);

      commentConversationHistory = [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: reply }
      ];

      const parsedHtml = parseMarkdown(reply);
      commentSection.innerHTML = `
        <div class="tabbit-comment-section-title">💬 评论区总结 <span style="font-size:11px;color:#999;font-weight:400;">（${comments.length}条评论）</span></div>
        <div class="tabbit-comment-result">${parsedHtml}</div>
        <div class="tabbit-comment-actions">
          <button class="tabbit-copy-btn" id="tabbit-copy-comment">📋 复制评论总结</button>
          <button class="tabbit-copy-btn" id="tabbit-flomo-comment">🌱 flomo</button>
          <span style="font-size:11px;color:#999;margin-left:auto;">🤖 ${currentModel}</span>
        </div>
      `;

      const copyCommentBtn = commentSection.querySelector('#tabbit-copy-comment');
      if (copyCommentBtn) {
        copyCommentBtn.addEventListener('click', function() { copyCommentResult(this, reply); });
      }
      const flomoCommentBtn = commentSection.querySelector('#tabbit-flomo-comment');
      if (flomoCommentBtn) {
        flomoCommentBtn.addEventListener('click', function() { sendToFlomo(reply, this); });
      }

      contentDiv.scrollTop = contentDiv.scrollHeight;
    } catch (err) {
      console.error('[省流助手-评论区]', err);
      commentSection.innerHTML = `
        <div class="tabbit-comment-section-title">💬 评论区总结</div>
        <div class="tabbit-error">
          <div class="tabbit-error-title">⚠️ 评论区总结失败</div>
          <div>${escapeHtml(err.message)}</div>
        </div>
      `;
    } finally {
      isCommentSummarizing = false;
      const btn = contentDiv.querySelector('#tabbit-comment-btn');
      if (btn) btn.disabled = false;
    }
  }

  // ==================== 对话功能 ====================
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
    sendBtn.disabled = true;

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'tabbit-msg-loading';
    loadingMsg.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(loadingMsg);

    const contentDiv = panel.querySelector('.tabbit-panel-content');
    contentDiv.scrollTop = contentDiv.scrollHeight;

    try {
      conversationHistory.push({ role: 'user', content: text });

      let sentMessages = conversationHistory;
      if (conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        sentMessages = [conversationHistory[0], ...conversationHistory.slice(-(MAX_CONVERSATION_HISTORY - 1))];
      }

      const reply = await callAI(sentMessages);
      conversationHistory.push({ role: 'assistant', content: reply });

      loadingMsg.remove();
      const aiWrap = document.createElement('div');
      aiWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;';
      const aiMsg = document.createElement('div');
      aiMsg.className = 'tabbit-msg tabbit-msg-ai';
      aiMsg.innerHTML = parseMarkdown(reply);
      const modelTag = document.createElement('div');
      modelTag.className = 'tabbit-msg-model';
      modelTag.textContent = '🤖 ' + currentModel;
      aiWrap.appendChild(aiMsg);
      aiWrap.appendChild(modelTag);
      messagesContainer.appendChild(aiWrap);

      contentDiv.scrollTop = contentDiv.scrollHeight;
    } catch (err) {
      console.error('[省流助手-对话]', err);
      loadingMsg.remove();
      conversationHistory.pop();

      const errMsg = document.createElement('div');
      errMsg.className = 'tabbit-msg tabbit-msg-ai';
      errMsg.style.background = '#fff3f3';
      errMsg.style.color = '#c00';
      errMsg.textContent = '⚠️ ' + err.message;
      messagesContainer.appendChild(errMsg);
      contentDiv.scrollTop = contentDiv.scrollHeight;
    } finally {
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
          <div class="tabbit-settings-group">
            <div class="tabbit-settings-label">🌱 Flomo API</div>
            <input class="tabbit-settings-input" id="ts-flomoApiUrl" type="text" value="${escapeHtml(CONFIG.flomoApiUrl || '')}" placeholder="https://flomoapp.com/iwh/xxx/xxx/" />
            <div class="tabbit-settings-hint">flomo 的 API 地址，在 flomo 设置 → API 中获取</div>
          </div>
          <div class="tabbit-settings-group">
            <div class="tabbit-settings-label">🏷️ Flomo 自动标签</div>
            <input class="tabbit-settings-input" id="ts-flomoTags" type="text" value="${escapeHtml(CONFIG.flomoTags || '')}" placeholder="#B站省流助手 #视频摘要" />
            <div class="tabbit-settings-hint">发送到 flomo 时自动追加在内容末尾，多个标签用空格分隔</div>
          </div>
          <div class="tabbit-settings-group">
            <div class="tabbit-settings-label">⏱️ 短视频跳过阈值（秒）</div>
            <input class="tabbit-settings-input" id="ts-skipDuration" type="number" min="0" value="${CONFIG.skipDuration || 60}" placeholder="60" />
            <div class="tabbit-settings-hint">视频时长低于此秒数时自动跳过字幕获取，设为 0 则不跳过</div>
          </div>

          <div class="tabbit-settings-group">
            <div class="tabbit-settings-label">🎨 视频摘要预设（多个总结风格，可在面板中切换）</div>
            <div class="tabbit-preset-manage-list" id="ts-preset-list"></div>
            <button class="tabbit-preset-add-btn" id="ts-preset-add">＋ 添加新预设</button>
            <div class="tabbit-settings-hint">每个预设有独立的提示词，在主面板可一键切换并重新分析</div>
          </div>

          <div class="tabbit-settings-group">
            <div class="tabbit-settings-label">💬 评论区总结提示词</div>
            <textarea class="tabbit-settings-textarea" id="ts-commentPromptText" placeholder="评论区总结的系统提示词...">${escapeHtml(CONFIG.commentPromptText || COMMENT_PROMPT_TEXT)}</textarea>
            <div class="tabbit-settings-hint">发送给AI的评论区总结指令</div>
          </div>

          <div class="tabbit-settings-group">
            <div class="tabbit-settings-label">📍 位置</div>
            <button class="tabbit-settings-btn tabbit-settings-btn-secondary" id="ts-reset-pos">重置面板/悬浮窗位置</button>
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

    // ===== 预设编辑区 =====
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

    function closeSettings() { overlay.remove(); }
    overlay.querySelector('#tabbit-settings-close').addEventListener('click', closeSettings);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeSettings();
    });

    // ===== 自动获取模型 =====
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

    // ===== 重置位置 =====
    overlay.querySelector('#ts-reset-pos').addEventListener('click', function() {
      POSITIONS = {};
      savePositions(POSITIONS);
      if (mainPanel) {
        mainPanel.style.left = '';
        mainPanel.style.top = '';
        mainPanel.style.right = '';
        mainPanel.style.bottom = '';
        mainPanel.style.transform = '';
      }
      const floatBtn = document.querySelector('#tabbit-float-btn');
      if (floatBtn) {
        floatBtn.style.left = '';
        floatBtn.style.top = '';
        floatBtn.style.right = '';
        floatBtn.style.transform = '';
      }
      alert('位置已重置');
    });

    // ===== 保存 =====
    overlay.querySelector('#ts-save').addEventListener('click', function() {
      const newApiUrl = overlay.querySelector('#ts-apiUrl').value.trim();
      const newApiKey = overlay.querySelector('#ts-apiKey').value.trim();
      const newModel = overlay.querySelector('#ts-model').value.trim();
      const newModelListRaw = overlay.querySelector('#ts-modelList').value;
      const newModelList = newModelListRaw.split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });

      const newFlomoApiUrl = overlay.querySelector('#ts-flomoApiUrl').value.trim();
      const newFlomoTags = overlay.querySelector('#ts-flomoTags').value.trim();
      const newCommentPromptText = overlay.querySelector('#ts-commentPromptText').value.trim();
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
      const newSkipDuration = parseInt(overlay.querySelector('#ts-skipDuration').value, 10);
      CONFIG.skipDuration = isNaN(newSkipDuration) ? 60 : newSkipDuration;
      CONFIG.autoParse = newAutoParse;
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

    // ===== 导出 =====
    overlay.querySelector('#ts-export').addEventListener('click', function() {
      triggerDownload(JSON.stringify(CONFIG, null, 2), 'bili-summary-config.json', 'application/json');
    });

    // ===== 导入 =====
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
            if (imported.skipDuration !== undefined) overlay.querySelector('#ts-skipDuration').value = imported.skipDuration;
            if (imported.autoParse !== undefined) overlay.querySelector('#ts-autoParse').checked = !!imported.autoParse;

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

    // ===== 重置默认 =====
    overlay.querySelector('#ts-reset').addEventListener('click', function() {
      if (!confirm('确定要重置所有配置为默认值吗？')) return;
      overlay.querySelector('#ts-apiUrl').value = DEFAULT_CONFIG.apiUrl;
      overlay.querySelector('#ts-apiKey').value = DEFAULT_CONFIG.apiKey;
      overlay.querySelector('#ts-model').value = DEFAULT_CONFIG.model;
      overlay.querySelector('#ts-modelList').value = DEFAULT_CONFIG.modelList.join('\n');
      overlay.querySelector('#ts-flomoApiUrl').value = '';
      overlay.querySelector('#ts-flomoTags').value = DEFAULT_CONFIG.flomoTags;
      overlay.querySelector('#ts-commentPromptText').value = COMMENT_PROMPT_TEXT;
      overlay.querySelector('#ts-skipDuration').value = DEFAULT_CONFIG.skipDuration;
      overlay.querySelector('#ts-autoParse').checked = DEFAULT_CONFIG.autoParse;
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

  // ==================== 自动启动主流程 ====================
  // 真正执行解析的函数（开启面板 + 开始解析）
  async function startParsing() {
    if (hasParsed) return;
    hasParsed = true;

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
    if (!hasSubtitleButton) {
      showNoSubtitleState(panel, videoInfo);
      return;
    }

    if (loadingSpan) loadingSpan.textContent = '正在获取字幕并生成摘要...';

    const subtitles = await fetchSubtitles(videoInfo.cid, videoInfo.bvid);
    if (subtitles.length === 0) {
      showNoSubtitleState(panel, videoInfo);
      return;
    }

    const targetSubtitle = subtitles.find(s => s.lan === 'zh-CN' || s.lan === 'ai-zh') || subtitles[0];
    const content = await fetchSubtitleContent(targetSubtitle.subtitle_url);
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
    await runSummary(panel, transcript, videoInfo);
  }

  // 仅显示悬浮窗，不解析（autoParse=false 时使用）
  function showFloatOnlyMode() {
    console.log('[省流助手] 自动解析已关闭，仅显示悬浮唤出按钮');
    createStyles();
    showFloatBtn(null); // 传 null 表示点击会触发解析
  }

  function init() {
    setTimeout(() => {
      if (CONFIG.autoParse) {
        startParsing();
      } else {
        showFloatOnlyMode();
      }
    }, INIT_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();