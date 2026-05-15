// ==UserScript==
// @name         饺子 AI 网页摘要助手
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      2.7.1
// @description  指定网站自动弹出 AI 网页摘要，支持连续对话、多预设、多模板、SPA路由，flomo、坚果云双文件云同步。
// @author       次元饺子
// @icon         https://img.icons8.com/?size=100&id=90385&format=png&color=000000
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/575620/%E9%A5%BA%E5%AD%90%20AI%20%E7%BD%91%E9%A1%B5%E6%91%98%E8%A6%81%E5%8A%A9%E6%89%8B.user.js
// @updateURL https://update.greasyfork.org/scripts/575620/%E9%A5%BA%E5%AD%90%20AI%20%E7%BD%91%E9%A1%B5%E6%91%98%E8%A6%81%E5%8A%A9%E6%89%8B.meta.js
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * 0. 常量
   ******************************************************************/
  const STORAGE_KEY = 'tabbit_ai_summary_config_v2';
  const PANEL_ID = 'tabbit-ai-panel';
  const FLOAT_BTN_ID = 'tabbit-ai-float-btn';
  const SETTINGS_ID = 'tabbit-ai-settings';
  const STYLE_ID = 'tabbit-ai-style';

  const DEFAULT_PROMPT_TEXT =
    '请阅读这个网页，并为我提供一份结构化的中文摘要。' +
    '\n\n请按以下格式输出：' +
    '\n\n## 一句话总结\n用一句话说明这个网页讲了什么。' +
    '\n\n## 核心要点\n用 3-5 个要点列出这个网页的核心信息。' +
    '\n\n## 值得关注的细节\n如果有数据、案例、引用、关键人物，请单独列出。' +
    '\n\n## 我的解读建议\n如果可能，给出一段独立思考或建议（可选）。';

  const DEFAULT_PROFILE = {
    id: 'default',
    name: '默认配置',
    apiUrl: 'https://api.xiaomimimo.com/v1/chat/completions',
    apiKey: '',
    currentModel: 'mimo-v2-flash',
    temperature: 0.7,
    maxTokens: 2000,
    models: [
      { name: 'mimo-v2-flash', value: 'mimo-v2-flash', temperature: '', maxTokens: '' }
    ]
  };

  const DEFAULT_CONFIG = {
    profiles: [clone(DEFAULT_PROFILE)],
    currentProfileId: 'default',
    flomoApiUrl: '',
    promptTemplates: [
      { id: 'default', name: '默认总结', text: DEFAULT_PROMPT_TEXT },
      { id: 'plain', name: '大白话解释', text: '请用非常简单、直白、短句的方式解释这个网页。\n\n请输出：\n1. 一句话说明它在说什么\n2. 三个最重要的点\n3. 普通人应该怎么理解' },
      { id: 'forum', name: '论坛讨论总结', text: '请总结这个帖子或讨论页面。重点提炼楼主观点、主要争议、支持方观点、反对方观点，以及最后值得关注的结论。' },
      { id: 'investment', name: '投资视角', text: '请从投资和商业角度总结这个网页。重点关注公司、行业、数据、增长、风险、市场预期，以及对普通投资者有什么参考价值。' }
    ],
    defaultPromptTemplateId: 'default',
    urlRules: [
      'https://mp.weixin.qq.com/*',
      'https://nga.178.com/read.php*',
      'https://www.jisilu.cn/*',
      'https://www.gelonghui.com/*',
      'https://bbs.nga.cn/read.php*',
      'https://sspai.com/post/*',
      'https://www.ifanr.com/*'
    ],
    rulePromptBindings: [],
    autoRun: true,
    floatButton: { side: 'right', y: null, opacity: 0.55 },
    panel: { width: 460, height: null, heightRatio: 0.82, left: null, top: null },
    extractMaxChars: 16000,
    cloudSync: { account: '', appPassword: '', lastSyncAt: 0, lastSyncDirection: '' },
    autoCopy: { enabled: true, withSource: false }
  };

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  /******************************************************************
   * 1. 内联 Markdown 渲染器
   ******************************************************************/
  const _md = (function () {
    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function renderInline(text) {
      let s = escapeHtml(text);
      s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px">');
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
      s = s.replace(/\*\*([^\*]+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\*])\*([^\*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
      s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');
      s = s.replace(/~~([^~]+?)~~/g, '<s>$1</s>');
      return s;
    }

    // ★ 新增:解析表格行 "| a | b | c |" -> ["a","b","c"]
    function parseTableRow(line) {
      let s = line.trim();
      if (s.startsWith('|')) s = s.slice(1);
      if (s.endsWith('|'))   s = s.slice(0, -1);
      const cells = [];
      let buf = '';
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue; }
        if (ch === '|') { cells.push(buf.trim()); buf = ''; continue; }
        buf += ch;
      }
      cells.push(buf.trim());
      return cells;
    }
    // ★ 新增:判断是否是分隔行 |---|:--:|---:|
    function isTableSeparator(line) {
      if (!/\|/.test(line)) return false;
      const cells = parseTableRow(line);
      if (cells.length === 0) return false;
      return cells.every(c => /^:?-{1,}:?$/.test(c.trim()));
    }
    // ★ 新增:从分隔行解析每列对齐方式
    function parseAligns(sepLine) {
      return parseTableRow(sepLine).map(c => {
        const t = c.trim();
        const left = t.startsWith(':');
        const right = t.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
      });
    }

    return function parse(md) {
      if (!md) return '';
      md = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = md.split('\n');
      let html = '', i = 0, inCode = false, codeLang = '', codeBuf = [];
      let listStack = [];
      function closeAllLists() { while (listStack.length) html += '</li></' + listStack.pop().type + '>'; }
      while (i < lines.length) {
        const line = lines[i];
        const fence = line.match(/^```(\w*)\s*$/);
        if (fence) {
          if (!inCode) { closeAllLists(); inCode = true; codeLang = fence[1] || ''; codeBuf = []; }
          else { html += '<pre><code' + (codeLang ? ' class="language-' + escapeHtml(codeLang) + '"' : '') + '>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'; inCode = false; codeLang = ''; codeBuf = []; }
          i++; continue;
        }
        if (inCode) { codeBuf.push(line); i++; continue; }
        if (/^\s*$/.test(line)) { closeAllLists(); i++; continue; }

        // ★ 新增:GFM 表格识别
        if (/\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
          closeAllLists();
          const headers = parseTableRow(line);
          const aligns = parseAligns(lines[i + 1]);
          i += 2;
          const rows = [];
          while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
            if (/^```/.test(lines[i]) || /^#{1,6}\s+/.test(lines[i])) break;
            rows.push(parseTableRow(lines[i]));
            i++;
          }
          let t = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
          headers.forEach((h, idx) => {
            const a = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
            t += `<th${a}>${renderInline(h)}</th>`;
          });
          t += '</tr></thead><tbody>';
          rows.forEach(r => {
            t += '<tr>';
            for (let c = 0; c < headers.length; c++) {
              const cell = r[c] != null ? r[c] : '';
              const a = aligns[c] ? ` style="text-align:${aligns[c]}"` : '';
              t += `<td${a}>${renderInline(cell)}</td>`;
            }
            t += '</tr>';
          });
          t += '</tbody></table></div>';
          html += t;
          continue;
        }

        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) { closeAllLists(); const lv = h[1].length; html += '<h' + lv + '>' + renderInline(h[2].trim()) + '</h' + lv + '>'; i++; continue; }
        if (/^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(line)) { closeAllLists(); html += '<hr/>'; i++; continue; }
        if (/^\s*>\s?/.test(line)) {
          closeAllLists();
          let buf = [];
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
          html += '<blockquote>' + parse(buf.join('\n')) + '</blockquote>';
          continue;
        }
        const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
        const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
        if (ul || ol) {
          const m = ul || ol;
          const type = ul ? 'ul' : 'ol';
          const indent = m[1].length;
          const content = m[2];
          while (listStack.length && listStack[listStack.length - 1].indent > indent) html += '</li></' + listStack.pop().type + '>';
          if (listStack.length && listStack[listStack.length - 1].indent === indent && listStack[listStack.length - 1].type !== type) html += '</li></' + listStack.pop().type + '>';
          if (!listStack.length || listStack[listStack.length - 1].indent < indent) { html += '<' + type + '><li>'; listStack.push({ type: type, indent: indent }); }
          else html += '</li><li>';
          html += renderInline(content);
          i++; continue;
        }
        closeAllLists();
        let pBuf = [line];
        i++;
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^(\s*)[-*+]\s+/.test(lines[i]) && !/^(\s*)\d+\.\s+/.test(lines[i])) {
          // ★ 段落收集时也要避让表格
          if (/\|/.test(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
          pBuf.push(lines[i]); i++;
        }
        html += '<p>' + renderInline(pBuf.join(' ').trim()) + '</p>';
      }
      if (inCode) html += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>';
      closeAllLists();
      return html;
    };
  })();

  /******************************************************************
   * 2. 工具函数
   ******************************************************************/
  function makeId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function escapeAttr(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function buildModelsUrl(apiUrl) {
    if (apiUrl.includes('/chat/completions')) return apiUrl.replace(/\/chat\/completions.*$/, '/models');
    if (apiUrl.endsWith('/')) return apiUrl + 'models';
    return apiUrl + '/v1/models';
  }
  function formatApiError(status, body) {
    let msg = `HTTP ${status}`;
    try {
      const data = JSON.parse(body);
      if (data?.error?.message) msg += `\n${data.error.message}`;
      else msg += `\n${body.substring(0, 200)}`;
    } catch (e) { msg += `\n${(body || '').substring(0, 200)}`; }
    return msg;
  }
  function urlPatternToRegExp(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  }
  function matchUrl(url, patterns) {
    return patterns.some(p => {
      try { return urlPatternToRegExp(p).test(url); } catch (e) { return false; }
    });
  }

  /******************************************************************
   * 3. 配置加载 / 保存 / 归一化
   ******************************************************************/
  function normalizeModels(models) {
    if (!Array.isArray(models)) return [];
    return models.filter(m => m && m.value).map(m => ({
      name: String(m.name || m.value).trim(),
      value: String(m.value).trim(),
      temperature: m.temperature === '' || m.temperature == null ? '' : String(m.temperature),
      maxTokens: m.maxTokens === '' || m.maxTokens == null ? '' : String(m.maxTokens)
    }));
  }
  function normalizeUrlRules(rules) {
    if (!Array.isArray(rules)) return [];
    const seen = new Set(), out = [];
    rules.forEach(r => {
      const v = String(r || '').trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out;
  }
  function normalizePromptTemplates(templates) {
    if (!Array.isArray(templates)) return [];
    const out = [], usedIds = new Set();
    templates.forEach(t => {
      if (!t) return;
      const name = String(t.name || '').trim();
      const text = String(t.text || '').trim();
      if (!name || !text) return;
      let id = String(t.id || '').trim();
      if (!id || usedIds.has(id)) id = makeId('tpl');
      usedIds.add(id);
      out.push({ id, name, text });
    });
    return out;
  }
  function normalizeRulePromptBindings(bindings) {
    if (!Array.isArray(bindings)) return [];
    const out = [], seen = new Set();
    bindings.forEach(b => {
      if (!b) return;
      const rule = String(b.rule || '').trim();
      const templateId = String(b.templateId || '').trim();
      if (!rule || !templateId || seen.has(rule)) return;
      seen.add(rule);
      out.push({ rule, templateId });
    });
    return out;
  }
  function normalizeProfiles(profiles) {
    if (!Array.isArray(profiles) || !profiles.length) return [clone(DEFAULT_PROFILE)];
    const result = [];
    profiles.forEach(p => {
      if (!p || typeof p !== 'object') return;
      const id = String(p.id || '').trim() || makeId('prof');
      const item = {
        id,
        name: String(p.name || '').trim() || '未命名配置',
        apiUrl: String(p.apiUrl || '').trim(),
        apiKey: String(p.apiKey || '').trim(),
        currentModel: String(p.currentModel || '').trim(),
        temperature: Number(p.temperature ?? 0.7),
        maxTokens: Number(p.maxTokens ?? 2000),
        models: normalizeModels(p.models)
      };
      if (!item.currentModel && item.models.length) item.currentModel = item.models[0].value;
      if (!result.some(x => x.id === id)) result.push(item);
    });
    if (!result.length) result.push(clone(DEFAULT_PROFILE));
    return result;
  }

  function mergeConfig(base, saved) {
    const result = { ...base, ...saved };
    if (!Array.isArray(result.urlRules)) result.urlRules = base.urlRules;
    if (!Array.isArray(result.promptTemplates)) result.promptTemplates = base.promptTemplates;
    if (!Array.isArray(result.rulePromptBindings)) result.rulePromptBindings = [];

    if (saved.promptText && !saved.promptTemplates) {
      result.promptTemplates = [
        { id: 'default', name: '默认总结', text: saved.promptText },
        ...base.promptTemplates.filter(t => t.id !== 'default')
      ];
    }

    if (!Array.isArray(saved.profiles)) {
      const legacyHasApi = !!(saved.apiUrl || saved.apiKey || saved.models);
      if (legacyHasApi) {
        result.profiles = [{
          id: 'default',
          name: '默认配置（已迁移）',
          apiUrl: saved.apiUrl || '',
          apiKey: saved.apiKey || '',
          currentModel: saved.currentModel || '',
          temperature: Number(saved.temperature ?? 0.7),
          maxTokens: Number(saved.maxTokens ?? 2000),
          models: normalizeModels(saved.models)
        }];
        result.currentProfileId = 'default';
      } else {
        result.profiles = base.profiles;
        result.currentProfileId = base.currentProfileId;
      }
    }

    result.profiles = normalizeProfiles(result.profiles);
    if (!result.profiles.some(p => p.id === result.currentProfileId)) {
      result.currentProfileId = result.profiles[0].id;
    }
    result.urlRules = normalizeUrlRules(result.urlRules);
    result.promptTemplates = normalizePromptTemplates(result.promptTemplates);
    result.rulePromptBindings = normalizeRulePromptBindings(result.rulePromptBindings);
    result.floatButton = { ...base.floatButton, ...(saved.floatButton || {}) };
    result.panel = { ...base.panel, ...(saved.panel || {}) };

    const savedCloud = saved.cloudSync || {};
    result.cloudSync = {
      account: typeof savedCloud.account === 'string' ? savedCloud.account : '',
      appPassword: typeof savedCloud.appPassword === 'string' ? savedCloud.appPassword : '',
      lastSyncAt: Number(savedCloud.lastSyncAt || 0),
      lastSyncDirection: savedCloud.lastSyncDirection || ''
    };
    if (!result.defaultPromptTemplateId || !result.promptTemplates.some(t => t.id === result.defaultPromptTemplateId)) {
      result.defaultPromptTemplateId = result.promptTemplates[0]?.id || 'default';
    }
    result.extractMaxChars = Number(result.extractMaxChars || 16000);
    result.autoCopy = { ...base.autoCopy, ...(saved.autoCopy || {}) };
    return result;
  }

  function loadConfig() {
    try {
      if (typeof GM_getValue !== 'function') return clone(DEFAULT_CONFIG);
      const raw = GM_getValue(STORAGE_KEY, '');
      if (!raw) return clone(DEFAULT_CONFIG);
      return mergeConfig(clone(DEFAULT_CONFIG), JSON.parse(raw));
    } catch (err) {
      console.warn('[饺子 AI] 配置加载失败：', err);
      return clone(DEFAULT_CONFIG);
    }
  }

  function saveConfig() {
    try {
      if (typeof GM_setValue !== 'function') { alert('当前环境不支持 GM_setValue。'); return; }
      config.urlRules = normalizeUrlRules(config.urlRules);
      config.rulePromptBindings = normalizeRulePromptBindings(config.rulePromptBindings);
      config.promptTemplates = normalizePromptTemplates(config.promptTemplates);
      config.profiles = normalizeProfiles(config.profiles);
      if (!config.profiles.some(p => p.id === config.currentProfileId)) {
        config.currentProfileId = config.profiles[0].id;
      }
      GM_setValue(STORAGE_KEY, JSON.stringify(config));
    } catch (err) {
      console.warn('[饺子 AI] 配置保存失败：', err);
    }
  }

  let config = loadConfig();

  /******************************************************************
   * 4. Profiles 管理
   ******************************************************************/
  function getCurrentProfile() {
    return config.profiles.find(x => x.id === config.currentProfileId) || config.profiles[0];
  }
  function setCurrentProfile(id) {
    if (!config.profiles.some(p => p.id === id)) return false;
    config.currentProfileId = id;
    saveConfig();
    return true;
  }
  function addProfile(name, fromCurrent) {
    const base = fromCurrent ? clone(getCurrentProfile()) : clone(DEFAULT_PROFILE);
    base.id = makeId('prof');
    base.name = String(name || '').trim() || '新配置';
    config.profiles.push(base);
    config.currentProfileId = base.id;
    saveConfig();
    return base;
  }
  function deleteProfile(id) {
    if (config.profiles.length <= 1) { alert('至少保留一个配置预设。'); return false; }
    const idx = config.profiles.findIndex(p => p.id === id);
    if (idx === -1) return false;
    config.profiles.splice(idx, 1);
    if (config.currentProfileId === id) config.currentProfileId = config.profiles[0].id;
    saveConfig();
    return true;
  }
  function renameProfile(id, newName) {
    const p = config.profiles.find(x => x.id === id);
    if (!p) return false;
    p.name = String(newName || '').trim() || p.name;
    saveConfig();
    return true;
  }

  function getCurrentModelConfig() {
    const profile = getCurrentProfile();
    return profile.models.find(m => m.value === profile.currentModel) || profile.models[0] || {};
  }
  function getCurrentModelDisplayName() {
    const m = getCurrentModelConfig();
    return m?.name || m?.value || getCurrentProfile().currentModel || '未知模型';
  }
  function getCurrentTemperature() {
    const profile = getCurrentProfile();
    const model = getCurrentModelConfig();
    const v = (model?.temperature !== '' && model?.temperature != null) ? model.temperature : profile.temperature;
    return Number(v || 0.7);
  }
  function getCurrentMaxTokens() {
    const profile = getCurrentProfile();
    const model = getCurrentModelConfig();
    const v = (model?.maxTokens !== '' && model?.maxTokens != null) ? model.maxTokens : profile.maxTokens;
    return Number(v || 2000);
  }
  function checkApiConfig() {
    const profile = getCurrentProfile();
    if (!profile.apiUrl || !profile.apiKey || !profile.currentModel) {
      openSettings();
      setStatus(`请先配置 API（当前预设：${profile.name}）`, 'error', 2500);
      return false;
    }
    return true;
  }

  function getDefaultTemplate() {
    return config.promptTemplates.find(t => t.id === config.defaultPromptTemplateId) || config.promptTemplates[0];
  }
  function getTemplateForUrl(url) {
    if (!url || !config.rulePromptBindings?.length) return getDefaultTemplate();
    for (const bind of config.rulePromptBindings) {
      try {
        if (urlPatternToRegExp(bind.rule).test(url)) {
          const tpl = config.promptTemplates.find(t => t.id === bind.templateId);
          if (tpl) return tpl;
        }
      } catch (e) {}
    }
    return getDefaultTemplate();
  }

  /******************************************************************
   * 5. 网页正文提取
   ******************************************************************/
  function getPageText() {
    try {
      const cloned = document.body.cloneNode(true);
      cloned.querySelectorAll('script, style, noscript, iframe, svg, nav, header, footer, aside, .nav, .navbar, .header, .footer, .sidebar, .comment, .comments, .ad, .ads').forEach(el => el.remove());
      let mainNode =
        cloned.querySelector('article') ||
        cloned.querySelector('[itemprop="articleBody"]') ||
        cloned.querySelector('.post-content, .entry-content, .article-content, .article-body, .markdown-body, .rich_media_content') ||
        cloned.querySelector('main') || cloned;
      let text = (mainNode.innerText || mainNode.textContent || '').trim();
      text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ');
      const max = Number(config.extractMaxChars || 16000);
      if (text.length > max) text = text.substring(0, max) + `\n\n（已截断到 ${max} 字符）`;
      return text;
    } catch (err) {
      return document.body?.innerText || '';
    }
  }

  /******************************************************************
   * 6. 调用 Chat API
   ******************************************************************/
  let currentRequest = null;
  let currentReject = null;

  function callChatApi(messages, onDelta) {
    const profile = getCurrentProfile();
    const useStream = typeof onDelta === 'function';
    const apiUrl = profile.apiUrl;
    const apiKey = profile.apiKey;
    const body = {
      model: profile.currentModel,
      messages,
      temperature: getCurrentTemperature(),
      max_tokens: getCurrentMaxTokens()
    };

    return new Promise((resolve, reject) => {
      currentReject = reject;

      // ============ 非流式：保留原逻辑 ============
      if (!useStream) {
        currentRequest = GM_xmlhttpRequest({
          method: 'POST',
          url: apiUrl,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          data: JSON.stringify(body),
          timeout: 120000,
          onload(res) {
            currentRequest = null; currentReject = null;
            try {
              if (res.status < 200 || res.status >= 300) {
                reject(new Error(formatApiError(res.status, res.responseText))); return;
              }
              const data = JSON.parse(res.responseText);
              const content = data?.choices?.[0]?.message?.content;
              if (!content) { reject(new Error('API 响应格式异常')); return; }
              resolve(content);
            } catch (err) { reject(err); }
          },
          onerror(err) {
            currentRequest = null; currentReject = null;
            reject(new Error('网络请求失败：' + JSON.stringify(err)));
          },
          ontimeout() {
            currentRequest = null; currentReject = null;
            reject(new Error('API 请求超时。'));
          }
        });
        return;
      }

      // ============ 流式：优先 fetch + ReadableStream ============
      let fullText = '';

      const doFetchStream = async () => {
        const controller = new AbortController();
        // 暴露 abort 句柄,让 abortCurrentRequest 能停掉
        currentRequest = { abort: () => controller.abort() };

        let buffer = '';

        const processLine = (line) => {
          line = line.replace(/\r$/, '').trim();
          if (!line) return true;
          if (line.startsWith(':')) return true;          // SSE 注释行
          if (!line.startsWith('data:')) return true;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return false;
          try {
            const obj = JSON.parse(payload);
            if (obj.error) {
              throw new Error(obj.error.message || JSON.stringify(obj.error));
            }
            const delta = obj.choices?.[0]?.delta?.content
                       ?? obj.choices?.[0]?.message?.content
                       ?? obj.choices?.[0]?.delta?.reasoning_content
                       ?? '';
            if (delta) {
              fullText += delta;
              try { onDelta(delta, fullText); } catch (e) { console.warn(e); }
            }
          } catch (e) {
            if (e.message && e.message.indexOf('JSON') === -1) throw e;
            // 非合法 JSON 行,忽略
          }
          return true;
        };

        try {
          const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey,
              'Accept': 'text/event-stream'
            },
            body: JSON.stringify({ ...body, stream: true }),
            signal: controller.signal
          });

          if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(formatApiError(resp.status, errText));
          }

          const ctype = resp.headers.get('content-type') || '';
          // 服务端没返回 SSE → 一次性 JSON 兜底
          if (!ctype.includes('text/event-stream') && !resp.body) {
            const text = await resp.text();
            try {
              const data = JSON.parse(text);
              const content = data?.choices?.[0]?.message?.content || '';
              if (content) {
                try { onDelta(content, content); } catch (e) {}
                currentRequest = null; currentReject = null;
                resolve(content);
                return true;
              }
            } catch (e) {}
            throw new Error('服务端未返回流式响应');
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let done = false;
          while (!done) {
            const { value, done: rDone } = await reader.read();
            done = rDone;
            if (value) {
              buffer += decoder.decode(value, { stream: !done });
              let idx;
              while ((idx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                const cont = processLine(line);
                if (!cont) { done = true; break; }
              }
            }
          }
          // flush 残余
          if (buffer.trim()) processLine(buffer);

          currentRequest = null; currentReject = null;
          if (fullText) {
            resolve(fullText);
          } else {
            reject(new Error('流式响应为空'));
          }
          return true;
        } catch (e) {
          if (e.name === 'AbortError') {
            currentRequest = null; currentReject = null;
            reject(new Error('已取消'));
            return true;
          }
          console.warn('[饺子AI] fetch 流式失败,尝试降级 GM_xmlhttpRequest:', e);
          return { fallback: true, error: e };
        }
      };

      // ============ 兜底：GM_xmlhttpRequest 流式（多数环境不真流式,但能拿结果）============
      const doGMFallback = () => {
        let receivedLen = 0;
        let buffer = '';
        let aborted = false;

        const flushBuffer = () => {
          let idx;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            line = line.replace(/\r$/, '').trim();
            if (!line) continue;
            if (line.startsWith(':')) continue;
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') { aborted = true; return; }
            try {
              const obj = JSON.parse(payload);
              if (obj.error) {
                reject(new Error('API Error: ' + (obj.error.message || JSON.stringify(obj.error))));
                aborted = true;
                return;
              }
              const delta = obj.choices?.[0]?.delta?.content
                         ?? obj.choices?.[0]?.message?.content
                         ?? '';
              if (delta) {
                fullText += delta;
                try { onDelta(delta, fullText); } catch (e) { console.warn(e); }
              }
            } catch (e) {}
          }
        };

        currentRequest = GM_xmlhttpRequest({
          method: 'POST',
          url: apiUrl,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'Accept': 'text/event-stream'
          },
          data: JSON.stringify({ ...body, stream: true }),
          responseType: 'stream',
          timeout: 180000,
          onprogress: (e) => {
            if (aborted) return;
            const text = e.responseText || '';
            if (text.length <= receivedLen) return;
            const newChunk = text.substring(receivedLen);
            receivedLen = text.length;
            buffer += newChunk;
            flushBuffer();
          },
          onload: (res) => {
            currentRequest = null; currentReject = null;
            if (aborted && fullText) { resolve(fullText); return; }
            const text = res.responseText || '';
            if (text.length > receivedLen) {
              buffer += text.substring(receivedLen);
              receivedLen = text.length;
              flushBuffer();
            }
            if (fullText) { resolve(fullText); return; }
            // 全部失败 → 试试当成普通 JSON
            if (text.trim().startsWith('<')) {
              reject(new Error('URL 错误（返回了 HTML）')); return;
            }
            try {
              const data = JSON.parse(text);
              if (data.error) { reject(new Error('API Error: ' + data.error.message)); return; }
              const content = data?.choices?.[0]?.message?.content || '';
              if (content) {
                try { onDelta(content, content); } catch (e) {}
                resolve(content);
              } else {
                reject(new Error('流式响应为空'));
              }
            } catch (e) {
              reject(new Error('流式解析失败'));
            }
          },
          onerror: () => {
            currentRequest = null; currentReject = null;
            reject(new Error('网络请求失败'));
          },
          ontimeout: () => {
            currentRequest = null; currentReject = null;
            reject(new Error('API 请求超时'));
          }
        });
      };

      // 先 fetch,失败再降级
      doFetchStream().then(result => {
        if (result && result.fallback) {
          doGMFallback();
        }
      });
    });
  }

  function abortCurrentRequest() {
    try { currentRequest?.abort?.(); } catch (e) {}
    if (currentReject) { try { currentReject(new Error('已取消')); } catch (e) {} }
    currentRequest = null;
    currentReject = null;
  }

  /******************************************************************
   * 7. 💬 对话状态管理（新核心）
   ******************************************************************/
  // 对话历史：[{role:'system'|'user'|'assistant', content:'...', meta?}]
  let conversation = [];
  let pageContextLoaded = false;  // 是否已经把页面正文塞到 system 中

  function resetConversation(reason) {
    conversation = [];
    pageContextLoaded = false;
    if (panelEl) {
      const body = panelEl.querySelector('#tabbit-body');
      if (body) {
        body.innerHTML = `<p class="tabbit-placeholder">${reason || '点击「✨ 总结当前页面」开始，或在下方输入框直接提问。'}</p>`;
      }
      const input = panelEl.querySelector('#tabbit-chat-input');
      if (input) input.value = '';
    }
  }

  function buildPageSystemPrompt() {
    const pageText = getPageText();
    return (
      'You are a helpful assistant that summarizes and discusses web pages in Chinese. ' +
      'All page content is provided directly below — you do not have web access. ' +
      'When the user asks follow-up questions, answer based on this page content and prior conversation.\n\n' +
      '==== 网页元信息 ====\n' +
      `标题：${document.title}\n` +
      `URL：${location.href}\n\n` +
      '==== 网页正文 ====\n' +
      pageText
    );
  }

  function ensurePageContext() {
    if (pageContextLoaded) return;
    conversation.unshift({ role: 'system', content: buildPageSystemPrompt() });
    pageContextLoaded = true;
  }

  function renderConversation() {
    if (!panelEl) return;
    const body = panelEl.querySelector('#tabbit-body');
    if (!body) return;
    const visibleMsgs = conversation.filter(m => m.role !== 'system' && !m.meta?.hidden);
    if (!visibleMsgs.length) {
      body.innerHTML = `<p class="tabbit-placeholder">点击「✨ 总结当前页面」开始，或在下方输入框直接提问。</p>`;
      return;
    }
    body.innerHTML = visibleMsgs.map(m => {
      if (m.role === 'user') {
        return `<div class="tabbit-msg tabbit-msg-user"><div class="tabbit-msg-role">🙋 我</div><div class="tabbit-msg-content">${_md(m.content)}</div></div>`;
      } else {
        const cursor = m.meta?.streaming ? '<span class="tabbit-cursor">▍</span>' : '';
        return `<div class="tabbit-msg tabbit-msg-assistant"><div class="tabbit-msg-role">🤖 ${escapeAttr(m.meta?.model || 'AI')}${m.meta?.streaming ? ' · 输出中…' : ''}</div><div class="tabbit-msg-content">${_md(m.content)}${cursor}</div></div>`;
      }
    }).join('');
    body.scrollTop = body.scrollHeight;
  }

  function appendMessage(role, content, meta) {
    conversation.push({ role, content, meta: meta || {} });
    renderConversation();
  }

  /******************************************************************
   * 8. ☁️ 坚果云同步（保留原逻辑，省略相同部分）
   ******************************************************************/
  const JGY_BASE = 'https://dav.jianguoyun.com/dav/';
  const JGY_SHARED_DIR = 'tabbit-shared/';
  const JGY_PROFILES_FILE = 'ai-profiles.json';
  const PROFILES_SCHEMA = 'tabbit-ai-profiles-v1';
  const JGY_DIR = 'tabbit-ai-summary/';
  const JGY_FILE = 'config.json';

  function jgyUrl(path) { return JGY_BASE + (path || ''); }
  function jgyAuthHeader() {
    const cs = config.cloudSync || {};
    return 'Basic ' + btoa(unescape(encodeURIComponent(cs.account + ':' + cs.appPassword)));
  }
  function jgyRequest(method, url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const reqOpts = {
        method, url,
        headers: { Authorization: jgyAuthHeader(), ...(opts.headers || {}) },
        timeout: opts.timeout || 30000,
        onload(res) {
          if (res.status >= 200 && res.status < 300) resolve(res);
          else if (res.status === 404 && opts.allow404) resolve(res);
          else if (res.status === 405 && opts.allow405) resolve(res);
          else reject(new Error(`坚果云返回 ${res.status}：${(res.responseText || '').substring(0, 200)}`));
        },
        onerror() { reject(new Error('坚果云网络错误')); },
        ontimeout() { reject(new Error('坚果云请求超时')); }
      };
      if (opts.data !== undefined && opts.data !== null) reqOpts.data = opts.data;
      GM_xmlhttpRequest(reqOpts);
    });
  }
  async function jgyMkcolIfNeeded(dirPath) {
    try { await jgyRequest('MKCOL', jgyUrl(dirPath), { allow404: true, allow405: true }); }
    catch (e) { if (e.message?.includes('401')) throw e; }
  }
  async function jgyDownloadJson(filePath) {
    const res = await jgyRequest('GET', jgyUrl(filePath), { allow404: true });
    if (res.status === 404) return null;
    try { return JSON.parse(res.responseText); }
    catch (err) { throw new Error(`云端文件解析失败：${err.message}`); }
  }
  async function jgyUploadJson(filePath, payload) {
    await jgyRequest('PUT', jgyUrl(filePath), {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload, null, 2)
    });
  }
  async function downloadProfilesFile() { return jgyDownloadJson(JGY_SHARED_DIR + JGY_PROFILES_FILE); }
  async function uploadProfilesFile(profiles, currentProfileId) {
    await jgyMkcolIfNeeded(JGY_SHARED_DIR);
    await jgyUploadJson(JGY_SHARED_DIR + JGY_PROFILES_FILE, {
      version: 1, schema: PROFILES_SCHEMA, updatedAt: Date.now(),
      profiles: normalizeProfiles(profiles), currentProfileId
    });
  }
  async function downloadAppFile() { return jgyDownloadJson(JGY_DIR + JGY_FILE); }
  async function uploadAppFile(payload) {
    await jgyMkcolIfNeeded(JGY_DIR);
    await jgyUploadJson(JGY_DIR + JGY_FILE, payload);
  }

  function pickCloudCredsFromForm() {
    if (!settingsEl) return;
    config.cloudSync = {
      ...(config.cloudSync || {}),
      account: settingsEl.querySelector('#tabbit-set-jgy-account').value.trim(),
      appPassword: settingsEl.querySelector('#tabbit-set-jgy-password').value.trim()
    };
  }
  function readSyncScopeFromForm() {
    if (!settingsEl) return { profiles: true, app: true };
    return {
      profiles: settingsEl.querySelector('#tabbit-sync-profiles')?.checked !== false,
      app: settingsEl.querySelector('#tabbit-sync-app')?.checked !== false
    };
  }
  function mergeTemplates(local, remote, prefer) {
    const map = new Map();
    const order = prefer === 'remote' ? [local, remote] : [remote, local];
    order.forEach(arr => arr.forEach(t => map.set(t.name, t)));
    return Array.from(map.values());
  }
  function mergeBindings(local, remote, prefer) {
    const map = new Map();
    const order = prefer === 'remote' ? [local, remote] : [remote, local];
    order.forEach(arr => arr.forEach(b => map.set(b.rule, b)));
    return Array.from(map.values());
  }
  function mergeProfiles(local, remote, prefer) {
    const map = new Map();
    const order = prefer === 'remote' ? [local, remote] : [remote, local];
    order.forEach(arr => arr.forEach(p => map.set(p.id, p)));
    return Array.from(map.values());
  }

  async function cloudTest() {
    setStatus('正在测试坚果云连接…', 'loading');
    await jgyMkcolIfNeeded(JGY_SHARED_DIR);
    await jgyMkcolIfNeeded(JGY_DIR);
    await jgyRequest('PROPFIND', jgyUrl(JGY_DIR), {
      headers: { Depth: '0' },
      data: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><allprop/></propfind>',
      allow404: true
    });
  }

  async function cloudPull(scope) {
    scope = scope || { profiles: true, app: true };
    const result = { profilesCount: 0, tplsCount: 0, rulesCount: 0, hasProfiles: false, hasApp: false };
    if (scope.profiles) {
      setStatus('正在拉取 API 预设…', 'loading');
      const remote = await downloadProfilesFile();
      if (remote && Array.isArray(remote.profiles)) {
        result.hasProfiles = true;
        const merged = mergeProfiles(normalizeProfiles(config.profiles), normalizeProfiles(remote.profiles), 'remote');
        config.profiles = merged;
        if (remote.currentProfileId && merged.some(p => p.id === remote.currentProfileId)) {
          config.currentProfileId = remote.currentProfileId;
        } else if (!merged.some(p => p.id === config.currentProfileId)) {
          config.currentProfileId = merged[0].id;
        }
        result.profilesCount = merged.length;
      }
    }
    if (scope.app) {
      setStatus('正在拉取模板和规则…', 'loading');
      const remoteApp = await downloadAppFile();
      if (remoteApp) {
        result.hasApp = true;
        const mergedTpls = mergeTemplates(normalizePromptTemplates(config.promptTemplates), normalizePromptTemplates(remoteApp.promptTemplates || []), 'remote');
        const mergedRules = Array.from(new Set([...normalizeUrlRules(remoteApp.urlRules || []), ...normalizeUrlRules(config.urlRules)]));
        const mergedBinds = mergeBindings(normalizeRulePromptBindings(config.rulePromptBindings), normalizeRulePromptBindings(remoteApp.rulePromptBindings || []), 'remote');
        config.promptTemplates = mergedTpls;
        config.urlRules = mergedRules;
        config.rulePromptBindings = mergedBinds;
        result.tplsCount = mergedTpls.length;
        result.rulesCount = mergedRules.length;
      }
    }
    config.cloudSync.lastSyncAt = Date.now();
    config.cloudSync.lastSyncDirection = 'pull';
    saveConfig();
    return result;
  }

  async function cloudPush(scope) {
    scope = scope || { profiles: true, app: true };
    if (scope.profiles) {
      setStatus('正在合并并上传 API 预设…', 'loading');
      let remote = null;
      try { remote = await downloadProfilesFile(); } catch (e) {}
      let mergedProfiles = normalizeProfiles(config.profiles);
      if (remote?.profiles) mergedProfiles = mergeProfiles(mergedProfiles, normalizeProfiles(remote.profiles), 'local');
      await uploadProfilesFile(mergedProfiles, config.currentProfileId);
      config.profiles = mergedProfiles;
    }
    if (scope.app) {
      setStatus('正在合并并上传模板/规则…', 'loading');
      let remote = null;
      try { remote = await downloadAppFile(); } catch (e) {}
      let mergedTpls = normalizePromptTemplates(config.promptTemplates);
      let mergedRules = normalizeUrlRules(config.urlRules);
      let mergedBinds = normalizeRulePromptBindings(config.rulePromptBindings);
      if (remote) {
        mergedTpls = mergeTemplates(mergedTpls, normalizePromptTemplates(remote.promptTemplates || []), 'local');
        mergedRules = Array.from(new Set([...mergedRules, ...normalizeUrlRules(remote.urlRules || [])]));
        mergedBinds = mergeBindings(mergedBinds, normalizeRulePromptBindings(remote.rulePromptBindings || []), 'local');
      }
      await uploadAppFile({
        version: 1, source: 'tabbit-ai-summary', updatedAt: Date.now(),
        promptTemplates: mergedTpls, urlRules: mergedRules, rulePromptBindings: mergedBinds
      });
      config.promptTemplates = mergedTpls;
      config.urlRules = mergedRules;
      config.rulePromptBindings = mergedBinds;
    }
    config.cloudSync.lastSyncAt = Date.now();
    config.cloudSync.lastSyncDirection = 'push';
    saveConfig();
  }

  async function cloudForcePush(scope) {
    scope = scope || { profiles: true, app: true };
    if (scope.profiles) {
      setStatus('正在强制覆盖 API 预设…', 'loading');
      await uploadProfilesFile(config.profiles, config.currentProfileId);
    }
    if (scope.app) {
      setStatus('正在强制覆盖模板/规则…', 'loading');
      await uploadAppFile({
        version: 1, source: 'tabbit-ai-summary', updatedAt: Date.now(), forcePush: true,
        promptTemplates: normalizePromptTemplates(config.promptTemplates),
        urlRules: normalizeUrlRules(config.urlRules),
        rulePromptBindings: normalizeRulePromptBindings(config.rulePromptBindings)
      });
    }
    config.cloudSync.lastSyncAt = Date.now();
    config.cloudSync.lastSyncDirection = 'force-push';
    saveConfig();
  }

  async function handleCloudTest() {
    pickCloudCredsFromForm();
    if (!config.cloudSync.account || !config.cloudSync.appPassword) { alert('请先填写坚果云账号和应用密码。'); return; }
    const btn = settingsEl?.querySelector('#tabbit-cloud-test');
    if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
    try {
      await cloudTest();
      alert('✅ 坚果云连接成功。');
      setStatus('坚果云连接成功', 'ok', 2000);
    } catch (err) {
      alert('❌ 坚果云连接失败：\n' + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔌 测试连接'; }
    }
  }
  async function handleCloudPull() {
    pickCloudCredsFromForm();
    if (!config.cloudSync.account || !config.cloudSync.appPassword) { alert('请先填写坚果云账号和应用密码。'); return; }
    const scope = readSyncScopeFromForm();
    if (!scope.profiles && !scope.app) { alert('请至少勾选一项。'); return; }
    if (!confirm('从云端拉取并合并？（同名/同 ID 以云端为准）')) return;
    const btn = settingsEl?.querySelector('#tabbit-cloud-pull');
    if (btn) { btn.disabled = true; btn.textContent = '拉取中…'; }
    try {
      const r = await cloudPull(scope);
      const lines = [];
      if (scope.profiles) lines.push(r.hasProfiles ? `✅ API 预设：${r.profilesCount} 个` : '⚠️ 云端无 API 预设');
      if (scope.app) lines.push(r.hasApp ? `✅ 模板：${r.tplsCount}，规则：${r.rulesCount}` : '⚠️ 云端无模板/规则');
      alert('拉取完成：\n\n' + lines.join('\n'));
      fillSettingsForm();
      renderModelSelect();
    } catch (err) { alert('❌ 拉取失败：\n' + (err.message || err)); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '⬇️ 从云端拉取'; } }
  }
  async function handleCloudPush() {
    pickCloudCredsFromForm();
    if (!config.cloudSync.account || !config.cloudSync.appPassword) { alert('请先填写坚果云账号和应用密码。'); return; }
    const scope = readSyncScopeFromForm();
    if (!scope.profiles && !scope.app) { alert('请至少勾选一项。'); return; }
    if (settingsEl && !settingsEl.classList.contains('tabbit-hidden')) {
      syncCurrentProfileFromForm(); syncTemplatesFromSettings(); syncUrlRulesFromSettings();
    }
    const btn = settingsEl?.querySelector('#tabbit-cloud-push');
    if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
    try { await cloudPush(scope); alert('✅ 已增量上传到云端。'); }
    catch (err) { alert('❌ 上传失败：\n' + (err.message || err)); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '⬆️ 增量上传'; } }
  }
  async function handleCloudForcePush() {
    pickCloudCredsFromForm();
    if (!config.cloudSync?.account || !config.cloudSync?.appPassword) { alert('请先填写坚果云账号和应用密码'); return; }
    const scope = readSyncScopeFromForm();
    if (!scope.profiles && !scope.app) { alert('请至少勾选一项。'); return; }
    if (!confirm('⚠️ 强制覆盖云端，云端独有数据将丢失，确认？')) return;
    if (!confirm('再次确认：此操作不可恢复，是否继续？')) return;
    if (settingsEl && !settingsEl.classList.contains('tabbit-hidden')) {
      syncCurrentProfileFromForm(); syncTemplatesFromSettings(); syncUrlRulesFromSettings();
    }
    const btn = settingsEl?.querySelector('#tabbit-cloud-force-push');
    if (btn) { btn.disabled = true; btn.textContent = '覆盖中…'; }
    try { await cloudForcePush(scope); alert('✅ 已强制覆盖云端。'); }
    catch (err) { alert('❌ 强制覆盖失败：\n' + (err.message || err)); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '⚠️ 强制覆盖上传'; } }
  }

  /******************************************************************
   * 9. 状态条
   ******************************************************************/
  let statusTimer = null;
  function setStatus(msg, level, duration) {
    if (!panelEl) return;
    const el = panelEl.querySelector('#tabbit-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'tabbit-status ' + (level || '');
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (duration) statusTimer = setTimeout(() => {
      el.textContent = ''; el.className = 'tabbit-status';
    }, duration);
  }

  /******************************************************************
   * 10. 样式
   ******************************************************************/
  function createStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${FLOAT_BTN_ID} {
        position: fixed; z-index: 2147483646;
        width: 44px; height: 44px; border-radius: 50%;
        background: linear-gradient(135deg, #8b5cf6, #3b82f6);
        color: white; font-size: 20px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25);
        user-select: none; transition: opacity .2s, transform .2s;
      }
      #${FLOAT_BTN_ID}:hover { opacity: 1 !important; transform: scale(1.08); }

      #${PANEL_ID} {
        position: fixed; top: 5vh; right: 16px;
        width: 460px; height: 82vh;
        min-width: 340px; min-height: 360px;
        max-width: 96vw; max-height: 96vh;
        background: #fff; color: #222;
        border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.25);
        display: flex; flex-direction: column;
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        overflow: hidden;
      }
      .tabbit-hidden { display: none !important; }

      .tabbit-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px;
        background: linear-gradient(135deg, #8b5cf6, #3b82f6);
        color: white; cursor: move; flex-shrink: 0;
      }
      .tabbit-title { font-weight: 700; font-size: 14px; }
      .tabbit-header-actions { display: flex; gap: 6px; align-items: center; }
      .tabbit-icon-btn {
        background: rgba(255,255,255,.18); color: #fff; border: none;
        width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px;
      }
      .tabbit-icon-btn:hover { background: rgba(255,255,255,.32); }
      .tabbit-model-select, .tabbit-prompt-select, .tabbit-profile-select {
        max-width: 130px; border: none; border-radius: 8px;
        padding: 5px 8px; font-size: 12px;
        background: rgba(255,255,255,.92); color: #333; cursor: pointer;
      }
      .tabbit-profile-select { font-weight: 600; }

      .tabbit-toolbar {
        display: flex; gap: 6px; padding: 8px 12px;
        border-bottom: 1px solid #eee; flex-wrap: wrap; align-items: center;
        flex-shrink: 0;
      }
      .tabbit-primary-btn {
        background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: #fff; border: none;
        padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;
      }
      .tabbit-primary-btn:disabled { opacity: .55; cursor: not-allowed; }
      .tabbit-secondary-btn {
        background: #f5f5f7; color: #333; border: 1px solid #e5e5ea;
        padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 12px;
      }
      .tabbit-secondary-btn:hover { background: #ececf0; }
      .tabbit-danger-btn {
        background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;
        padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600;
      }
      .tabbit-danger-btn:hover { background: #fecaca; }

      .tabbit-status {
        font-size: 12px; color: #888; padding: 0 12px 6px; flex-shrink: 0;
      }
      .tabbit-status.loading { color: #8b5cf6; }
      .tabbit-status.ok { color: #16a34a; }
      .tabbit-status.error { color: #dc2626; }

      .tabbit-body {
        flex: 1; overflow-y: auto;
        padding: 10px 14px;
        font-size: 14px; line-height: 1.7;
        min-height: 0;
      }
      .tabbit-placeholder { color: #888; }

      /* 💬 消息气泡 */
      .tabbit-msg { margin: 12px 0; }
      .tabbit-msg-role {
        font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 4px;
      }
      .tabbit-msg-user .tabbit-msg-role { color: #2563eb; }
      .tabbit-msg-assistant .tabbit-msg-role { color: #7c3aed; }
      .tabbit-msg-content {
        padding: 10px 14px; border-radius: 12px;
        background: #f7f8fc;
      }
      .tabbit-msg-user .tabbit-msg-content {
        background: linear-gradient(135deg, #eef2ff, #e0e7ff);
        border: 1px solid #c7d2fe;
      }
      .tabbit-msg-assistant .tabbit-msg-content {
        background: #fafafa;
        border: 1px solid #eee;
      }
      .tabbit-msg-content > *:first-child { margin-top: 0; }
      .tabbit-msg-content > *:last-child { margin-bottom: 0; }

      .tabbit-body h1, .tabbit-body h2, .tabbit-body h3 { font-weight: 700; margin: .8em 0 .4em; color: #5a43c8; }
      .tabbit-body h1 { font-size: 1.2rem; } .tabbit-body h2 { font-size: 1.1rem; } .tabbit-body h3 { font-size: 1rem; }
      .tabbit-body p { margin: .4em 0; }
      .tabbit-body strong { color: #7c3aed; }
      .tabbit-body ul, .tabbit-body ol { padding-left: 1.5em; margin: .4em 0; }
      .tabbit-body code { background: rgba(139,92,246,.12); padding: 1px 6px; border-radius: 4px; font-size: .88em; color: #be185d; }
      .tabbit-body pre { background: rgba(15,23,42,.05); padding: .7em; border-radius: 8px; overflow-x: auto; }
      .tabbit-body blockquote { border-left: 3px solid #7c3aed; padding: .3em .8em; background: rgba(139,92,246,.08); margin: .5em 0; border-radius: 0 6px 6px 0; }
      .tabbit-body a { color: #2563eb; text-decoration: underline; }

      /* 💬 输入区 */
      .tabbit-input-area {
        flex-shrink: 0;
        border-top: 1px solid #eee;
        padding: 8px 10px 10px;
        background: #fafafa;
      }
      .tabbit-input-row {
        display: flex; gap: 6px; align-items: flex-end;
      }
      #tabbit-chat-input {
        flex: 1;
        border: 1px solid #ddd; border-radius: 10px;
        padding: 8px 10px; font-size: 13px;
        font-family: inherit; resize: none;
        min-height: 38px; max-height: 140px;
        line-height: 1.5;
        outline: none;
        transition: border-color .15s;
      }
      #tabbit-chat-input:focus { border-color: #8b5cf6; }
      .tabbit-send-btn {
        background: linear-gradient(135deg, #8b5cf6, #3b82f6);
        color: #fff; border: none;
        width: 60px; height: 38px; border-radius: 10px;
        cursor: pointer; font-size: 13px; font-weight: 600;
        flex-shrink: 0;
      }
      .tabbit-send-btn:disabled { opacity: .5; cursor: not-allowed; }
      .tabbit-input-hint {
        font-size: 11px; color: #999; margin-top: 4px; text-align: right;
      }

      /* 🪟 调整大小手柄 */
      .tabbit-resize-handle {
        position: absolute; right: 0; bottom: 0;
        width: 16px; height: 16px;
        cursor: nwse-resize;
        background: linear-gradient(135deg, transparent 50%, rgba(139,92,246,0.4) 50%);
        border-bottom-right-radius: 14px;
        z-index: 10;
      }
      .tabbit-resize-handle:hover {
        background: linear-gradient(135deg, transparent 50%, rgba(139,92,246,0.7) 50%);
      }

      /* 设置弹窗 */
      #${SETTINGS_ID} {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.45); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
      }
      .tabbit-settings-content {
        background: #fff; color: #222;
        width: 600px; max-width: 96vw; max-height: 90vh; overflow-y: auto;
        border-radius: 14px; padding: 18px 20px;
      }
      .tabbit-settings-header {
        display: flex; justify-content: space-between; align-items: center;
        font-weight: 700; font-size: 16px;
        border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 12px;
      }
      .tabbit-section-title {
        font-weight: 700; margin: 14px 0 6px; color: #5a43c8;
        border-top: 1px dashed #e5e5ea; padding-top: 12px;
      }
      .tabbit-help { display:block; color: #888; font-size: 12px; margin-bottom: 8px; line-height: 1.6; }
      .tabbit-help code {
        background: rgba(139,92,246,.12); padding: 1px 5px;
        border-radius: 3px; font-size: 11px; color: #be185d;
      }
      .tabbit-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 13px; }
      .tabbit-field span { color: #555; font-weight: 600; }
      .tabbit-field input, .tabbit-field textarea, .tabbit-field select {
        border: 1px solid #ddd; border-radius: 8px; padding: 7px 9px; font-size: 13px;
        font-family: inherit;
      }
      .tabbit-field small { color: #888; font-size: 11px; }
      .tabbit-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .tabbit-profile-row {
        display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;
      }
      .tabbit-profile-select-wide {
        flex: 1; min-width: 180px;
        border: 1px solid #ddd; border-radius: 10px;
        padding: 8px 9px; font-size: 13px; background: #fff;
        font-weight: 600; color: #5a43c8;
      }
      .tabbit-sync-scope {
        display: flex; flex-direction: column; gap: 4px;
        padding: 8px 10px; background: #f9fafb;
        border: 1px solid #e5e5ea; border-radius: 8px;
        margin: 8px 0; font-size: 12px;
      }
      .tabbit-sync-scope-title { font-weight: 600; color: #5a43c8; margin-bottom: 2px; }
      .tabbit-sync-scope label { display: flex; align-items: center; gap: 6px; cursor: pointer; }

      .tabbit-settings-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
      .tabbit-model-row {
        display: grid;
        grid-template-columns: 1.6fr .7fr .8fr auto auto;
        gap: 6px; margin-bottom: 6px; align-items: center;
      }
      .tabbit-model-row input { padding: 5px 7px; font-size: 12px; border: 1px solid #ddd; border-radius: 6px; }
      .tabbit-current-model { font-size: 11px; display: flex; align-items: center; gap: 3px; }
      .tabbit-remove-model { background: #fee2e2; color: #b91c1c; border: none; border-radius: 6px; cursor: pointer; padding: 4px 8px; }
      .tabbit-tpl-row {
        display: grid;
        grid-template-columns: 1.2fr 3fr auto auto;
        gap: 6px; margin-bottom: 8px; align-items: start;
      }
      .tabbit-tpl-row input, .tabbit-tpl-row textarea {
        border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; font-size: 12px; font-family: inherit;
      }
      .tabbit-tpl-row textarea { min-height: 60px; resize: vertical; }
      .tabbit-tpl-default { font-size: 11px; display: flex; align-items: center; gap: 3px; }
      .tabbit-rule-row {
        display: grid;
        grid-template-columns: 2fr 1.3fr auto;
        gap: 6px; margin-bottom: 6px; align-items: center;
      }
      .tabbit-rule-row input, .tabbit-rule-row select {
        padding: 5px 7px; font-size: 12px; border: 1px solid #ddd; border-radius: 6px;
      }
      .tabbit-modal-footer {
        display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
        padding-top: 12px; border-top: 1px solid #eee;
      }
            /* 📌 加规则小卡片 */
      #tabbit-addrule-card {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .tabbit-addrule-mask {
        position: absolute; inset: 0;
        background: rgba(0,0,0,.4); backdrop-filter: blur(3px);
      }
      .tabbit-addrule-panel {
        position: relative;
        background: #fff; color: #222;
        width: 460px; max-width: 92vw;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0,0,0,.3);
        padding: 16px 18px;
        animation: tabbitAddruleIn .18s ease-out;
      }
      @keyframes tabbitAddruleIn {
        from { opacity: 0; transform: translateY(-8px) scale(.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      .tabbit-addrule-header {
        display: flex; align-items: center; justify-content: space-between;
        font-weight: 700; font-size: 15px; color: #5a43c8;
        margin-bottom: 10px;
      }
      .tabbit-addrule-url {
        font-size: 12px; color: #666;
        background: #f5f5f7; border: 1px solid #e5e5ea;
        border-radius: 8px; padding: 6px 10px;
        margin-bottom: 12px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .tabbit-addrule-list {
        display: flex; flex-direction: column; gap: 8px;
      }
      .tabbit-addrule-option {
        display: flex; flex-direction: column; align-items: stretch;
        gap: 4px; text-align: left;
        padding: 10px 12px;
        background: #fafafa;
        border: 1.5px solid #e5e5ea; border-radius: 10px;
        cursor: pointer; transition: all .15s;
        font-family: inherit;
      }
      .tabbit-addrule-option:hover:not(:disabled) {
        background: linear-gradient(135deg, #eef2ff, #ede9fe);
        border-color: #8b5cf6;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139,92,246,.18);
      }
      .tabbit-addrule-option:disabled,
      .tabbit-addrule-option.is-existing {
        opacity: .5; cursor: not-allowed;
      }
      .tabbit-addrule-option-main {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 8px;
      }
      .tabbit-addrule-option-label {
        font-weight: 600; font-size: 14px; color: #222;
      }
      .tabbit-addrule-option-desc {
        font-size: 11px; color: #888;
      }
      .tabbit-addrule-option-pattern {
        font-size: 11px; color: #be185d;
        background: rgba(139,92,246,.08);
        padding: 2px 6px; border-radius: 4px;
        word-break: break-all;
        align-self: flex-start;
      }
      .tabbit-addrule-footer {
        margin-top: 12px; padding-top: 10px;
        border-top: 1px dashed #e5e5ea;
        font-size: 11px; color: #999;
      }
      .tabbit-addrule-footer code {
        background: rgba(139,92,246,.12);
        padding: 1px 5px; border-radius: 3px;
        font-size: 11px; color: #be185d;
      }
            /* ★ Markdown 表格样式（适配饺子 AI 面板配色） */
      .tabbit-body .md-table-wrap,
      .tabbit-msg-content .md-table-wrap {
        overflow-x: auto;
        margin: .8em 0;
        border-radius: 8px;
        border: 1px solid rgba(139, 92, 246, .25);
        background: rgba(255, 255, 255, .6);
      }
      .tabbit-body .md-table,
      .tabbit-msg-content .md-table {
        width: 100%;
        border-collapse: collapse;
        font-size: .88em;
        line-height: 1.55;
      }
      .tabbit-body .md-table th,
      .tabbit-body .md-table td,
      .tabbit-msg-content .md-table th,
      .tabbit-msg-content .md-table td {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(139, 92, 246, .15);
        border-right: 1px solid rgba(139, 92, 246, .10);
        vertical-align: top;
        text-align: left;
        word-break: break-word;
      }
      .tabbit-body .md-table th:last-child,
      .tabbit-body .md-table td:last-child,
      .tabbit-msg-content .md-table th:last-child,
      .tabbit-msg-content .md-table td:last-child { border-right: none; }
      .tabbit-body .md-table thead th,
      .tabbit-msg-content .md-table thead th {
        background: linear-gradient(135deg, rgba(124, 58, 237, .12), rgba(59, 130, 246, .10));
        color: #5a43c8;
        font-weight: 700;
        white-space: nowrap;
        border-bottom: 2px solid rgba(124, 58, 237, .35);
      }
      .tabbit-body .md-table tbody tr:nth-child(even),
      .tabbit-msg-content .md-table tbody tr:nth-child(even) {
        background: rgba(139, 92, 246, .04);
      }
      .tabbit-body .md-table tbody tr:hover,
      .tabbit-msg-content .md-table tbody tr:hover {
        background: rgba(124, 58, 237, .08);
      }
      .tabbit-body .md-table tbody tr:last-child td,
      .tabbit-msg-content .md-table tbody tr:last-child td {
        border-bottom: none;
      }
      .tabbit-body .md-table code,
      .tabbit-msg-content .md-table code {
        font-size: .85em;
        padding: 1px 5px;
      }
              /* 🌊 流式光标 */
      .tabbit-cursor {
        display: inline-block;
        width: 6px; margin-left: 2px;
        animation: tabbitBlink 1s steps(2, start) infinite;
        color: #8b5cf6; font-weight: bold;
      }
      @keyframes tabbitBlink { to { visibility: hidden; } }

      .tabbit-copy-toast {
        position: fixed;
        bottom: 90px; right: 16px;
        background: rgba(0, 0, 0, 0.82);
        color: #fff;
        padding: 8px 18px;
        border-radius: 8px;
        font-size: 13px;
        z-index: 2147483647;
        pointer-events: none;
        opacity: 0;
        transform: translateY(8px);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(4px);
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .tabbit-copy-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
      .tabbit-copy-ctx {
        position: fixed;
        z-index: 2147483647;
        background: rgba(30, 30, 30, 0.95);
        backdrop-filter: blur(8px);
        border-radius: 10px;
        padding: 10px 14px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        min-width: 160px;
        animation: tabbitCtxIn 0.15s ease-out;
      }
      @keyframes tabbitCtxIn {
        from { opacity: 0; transform: scale(0.95); }
        to   { opacity: 1; transform: scale(1); }
      }
      .tabbit-copy-ctx-row {
        display: flex; align-items: center; gap: 8px;
        color: #eee; font-size: 13px;
        cursor: pointer; padding: 4px 0;
        transition: color 0.15s;
      }
      .tabbit-copy-ctx-row:hover { color: #fff; }
      .tabbit-copy-ctx-chk {
        width: 14px; height: 14px;
        border: 1.5px solid #888; border-radius: 3px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: all 0.15s ease;
      }
      .tabbit-copy-ctx-chk.on {
        background: #4fc3f7; border-color: #4fc3f7;
      }
      .tabbit-copy-ctx-chk.on::after {
        content: '';
        display: block;
        width: 4px; height: 7px;
        border: solid #fff;
        border-width: 0 1.5px 1.5px 0;
        transform: rotate(45deg) translateY(-1px);
      }
      .tabbit-copy-ctx-hint {
        margin-top: 6px; padding-top: 6px;
        border-top: 1px solid rgba(255,255,255,0.1);
        color: #888; font-size: 11px;
      }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  /******************************************************************
   * 11. 浮动按钮（任何网站点击都能打开 + 自动总结）
   ******************************************************************/
  let floatBtn = null;

  function createFloatButton() {
    if (document.getElementById(FLOAT_BTN_ID)) return;
    floatBtn = document.createElement('div');
    floatBtn.id = FLOAT_BTN_ID;
    floatBtn.title = '打开 AI 摘要（点击自动总结）';
    floatBtn.textContent = '🥟';
    floatBtn.style.opacity = config.floatButton.opacity;
    document.body.appendChild(floatBtn);
    applyFloatButtonPosition();

    let dragging = false, startY = 0, startTop = 0, moved = false;
    floatBtn.addEventListener('mousedown', e => {
      dragging = true; moved = false;
      startY = e.clientY;
      startTop = floatBtn.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 5) moved = true;
      const newTop = Math.max(0, Math.min(window.innerHeight - 44, startTop + dy));
      floatBtn.style.top = newTop + 'px';
      floatBtn.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        if (moved) { config.floatButton.y = floatBtn.getBoundingClientRect().top; saveConfig(); }
      }
    });
    floatBtn.addEventListener('click', () => {
      if (moved) return;
      // 🚀 点击浮窗：如果面板关闭则打开+自动总结，已开则关闭
      if (!panelEl || panelEl.classList.contains('tabbit-hidden')) {
        openPanel(true); // 自动总结
      } else {
        closePanel();
      }
    });
  }

  function applyFloatButtonPosition() {
    if (!floatBtn) return;
    floatBtn.style.right = '12px';
    if (config.floatButton.y != null) {
      floatBtn.style.top = config.floatButton.y + 'px';
      floatBtn.style.bottom = 'auto';
    } else {
      floatBtn.style.bottom = '80px';
      floatBtn.style.top = 'auto';
    }
  }

  /******************************************************************
   * 11.5 📋 自动复制模块
   ******************************************************************/
  const AC_MIN_LEN = 2;
  const AC_COOLDOWN = 2000;
  let acLastCopyTime = 0;
  let acCtxEl = null;
  let acToastEl = null;
  let acToastTimer = null;

  function acShowToast(text) {
    if (!acToastEl) {
      acToastEl = document.createElement('div');
      acToastEl.className = 'tabbit-copy-toast';
      document.body.appendChild(acToastEl);
    }
    clearTimeout(acToastTimer);
    acToastEl.textContent = text || '✅ 已复制';
    acToastEl.classList.add('show');
    acToastTimer = setTimeout(() => acToastEl.classList.remove('show'), 1500);
  }

  function acBuildCtxMenu() {
    if (acCtxEl) acCtxEl.remove();
    const menu = document.createElement('div');
    menu.className = 'tabbit-copy-ctx';
    const enabled = config.autoCopy?.enabled !== false;
    const withSrc = !!config.autoCopy?.withSource;
    menu.innerHTML = `
      <div class="tabbit-copy-ctx-row" data-ac="toggle">
        <div class="tabbit-copy-ctx-chk ${enabled ? 'on' : ''}"></div>
        <span>自动复制</span>
      </div>
      <div class="tabbit-copy-ctx-row" data-ac="source">
        <div class="tabbit-copy-ctx-chk ${withSrc ? 'on' : ''}"></div>
        <span>附带出处信息</span>
      </div>
      <div class="tabbit-copy-ctx-hint">快捷键 Alt+X</div>
    `;
    if (floatBtn) {
      const rect = floatBtn.getBoundingClientRect();
      let left = rect.left - 130;
      let top = rect.top;
      if (left < 8) left = rect.right + 8;
      if (top + 100 > window.innerHeight) top = window.innerHeight - 100;
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }
    menu.addEventListener('click', e => {
      e.stopPropagation();
      const row = e.target.closest('[data-ac]');
      if (!row) return;
      if (row.dataset.ac === 'toggle') {
        config.autoCopy.enabled = config.autoCopy.enabled === false ? true : false;
        saveConfig();
        acBuildCtxMenu();
        acShowToast(config.autoCopy.enabled ? '✅ 自动复制已开启' : '⏸️ 自动复制已关闭');
      } else if (row.dataset.ac === 'source') {
        config.autoCopy.withSource = !config.autoCopy.withSource;
        saveConfig();
        acBuildCtxMenu();
        acShowToast(config.autoCopy.withSource ? '📎 出处信息已开启' : '📄 出处信息已关闭');
      }
    });
    document.body.appendChild(menu);
    acCtxEl = menu;
  }

  function acCloseCtxMenu() {
    if (acCtxEl) { acCtxEl.remove(); acCtxEl = null; }
  }

  function acIsInsideEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function acCopySelectedText() {
    if (config.autoCopy?.enabled === false) return;
    if (acIsInsideEditable(document.activeElement)) return;
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (!text || text.length < AC_MIN_LEN) return;
    if (Date.now() - acLastCopyTime < AC_COOLDOWN) return;
    acLastCopyTime = Date.now();
    let content = text;
    if (config.autoCopy?.withSource) {
      content += `\n—————\n${document.title}\n${window.location.href}`;
    }
    navigator.clipboard.writeText(content).then(() => {
      acShowToast('✅ 已复制');
    }).catch(() => {});
  }

  function acToggleAutoCopy() {
    if (!config.autoCopy) config.autoCopy = { enabled: true, withSource: false };
    config.autoCopy.enabled = config.autoCopy.enabled === false ? true : false;
    saveConfig();
    acShowToast(config.autoCopy.enabled ? '✅ 自动复制已开启' : '⏸️ 自动复制已关闭');
  }

  function acInit() {
    document.addEventListener('mouseup', acCopySelectedText);
    let acSelTimer = null;
    document.addEventListener('selectionchange', () => {
      clearTimeout(acSelTimer);
      acSelTimer = setTimeout(() => {
        const sel = window.getSelection();
        const t = sel.toString().trim();
        if (t.length >= AC_MIN_LEN) acCopySelectedText();
      }, 500);
    });
    document.addEventListener('touchend', () => setTimeout(acCopySelectedText, 100));
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        acToggleAutoCopy();
      }
    });
    document.addEventListener('click', acCloseCtxMenu);
    if (floatBtn) {
      floatBtn.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        if (acCtxEl) { acCloseCtxMenu(); }
        else { acBuildCtxMenu(); }
      });
    }
  }

  /******************************************************************
   * 12. 主面板
   ******************************************************************/
  let panelEl = null;

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.classList.add('tabbit-hidden');
    panelEl.innerHTML = `
      <div class="tabbit-header" id="tabbit-drag-handle">
        <div class="tabbit-title">🥟 饺子 AI 摘要</div>
        <div class="tabbit-header-actions">
          <select id="tabbit-profile-select" class="tabbit-profile-select" title="切换 API 配置预设"></select>
          <select id="tabbit-model-select" class="tabbit-model-select" title="切换模型"></select>
          <button id="tabbit-settings-btn" class="tabbit-icon-btn" title="设置">⚙️</button>
          <button id="tabbit-close-btn" class="tabbit-icon-btn" title="关闭">×</button>
        </div>
      </div>

        <div class="tabbit-toolbar">
        <button id="tabbit-run-btn" class="tabbit-primary-btn">✨ 总结</button>
        <select id="tabbit-prompt-select" class="tabbit-prompt-select" title="选择提示词模板"></select>
        <button id="tabbit-preview-btn" class="tabbit-secondary-btn" title="预览抓取到的正文">👁</button>
        <button id="tabbit-addrule-btn" class="tabbit-secondary-btn" title="把当前网址加入规则">📌</button>
        <button id="tabbit-copy-btn" class="tabbit-secondary-btn" title="复制全部对话">📋</button>
        <button id="tabbit-flomo-btn" class="tabbit-secondary-btn" title="发送到 flomo">🌱</button>
        <button id="tabbit-clear-btn" class="tabbit-danger-btn" title="清空对话">🗑</button>
      </div>

      <div id="tabbit-status" class="tabbit-status"></div>

      <div id="tabbit-body" class="tabbit-body">
        <p class="tabbit-placeholder">点击「✨ 总结」开始，或在下方输入框直接提问。</p>
      </div>

      <div class="tabbit-input-area">
        <div class="tabbit-input-row">
          <textarea id="tabbit-chat-input" placeholder="追问或自由提问… (Enter 发送 / Shift+Enter 换行)" rows="1"></textarea>
          <button id="tabbit-send-btn" class="tabbit-send-btn">发送</button>
        </div>
        <div class="tabbit-input-hint">Enter 发送 · Shift+Enter 换行</div>
      </div>

      <div class="tabbit-resize-handle" id="tabbit-resize-handle" title="拖动调整大小"></div>
    `;
    document.body.appendChild(panelEl);

    // 应用持久化的尺寸/位置
    panelEl.style.width = (config.panel?.width || 460) + 'px';
    if (config.panel?.height) {
      panelEl.style.height = config.panel.height + 'px';
    } else {
      panelEl.style.height = ((config.panel?.heightRatio || 0.82) * 100) + 'vh';
    }
    if (config.panel?.left != null && config.panel?.top != null) {
      panelEl.style.left = config.panel.left + 'px';
      panelEl.style.top = config.panel.top + 'px';
      panelEl.style.right = 'auto';
    }

    panelEl.querySelector('#tabbit-close-btn').addEventListener('click', closePanel);
    panelEl.querySelector('#tabbit-settings-btn').addEventListener('click', openSettings);
    panelEl.querySelector('#tabbit-run-btn').onclick = () => runSummary(false);
    panelEl.querySelector('#tabbit-preview-btn').addEventListener('click', showPagePreview);
    panelEl.querySelector('#tabbit-addrule-btn').addEventListener('click', quickAddCurrentUrlToRules);
    panelEl.querySelector('#tabbit-copy-btn').addEventListener('click', copyAllConversation);
    panelEl.querySelector('#tabbit-flomo-btn').addEventListener('click', sendToFlomo);
    panelEl.querySelector('#tabbit-clear-btn').addEventListener('click', handleClearConversation);
    panelEl.querySelector('#tabbit-send-btn').addEventListener('click', handleSendChat);

    // 💬 输入框：Enter 发送，Shift+Enter 换行，自动伸高
    const input = panelEl.querySelector('#tabbit-chat-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        handleSendChat();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(140, input.scrollHeight) + 'px';
    });

    enablePanelDrag();
    enablePanelResize();
    renderModelSelect();
  }

  function enablePanelDrag() {
    const handle = panelEl.querySelector('#tabbit-drag-handle');
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = panelEl.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      panelEl.style.right = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panelEl.style.left = (startLeft + (e.clientX - startX)) + 'px';
      panelEl.style.top = (startTop + (e.clientY - startY)) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        const rect = panelEl.getBoundingClientRect();
        config.panel = { ...config.panel, left: rect.left, top: rect.top };
        saveConfig();
      }
    });
  }

  function enablePanelResize() {
    const handle = panelEl.querySelector('#tabbit-resize-handle');
    let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
    handle.addEventListener('mousedown', e => {
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      const rect = panelEl.getBoundingClientRect();
      startW = rect.width; startH = rect.height;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const newW = Math.max(340, Math.min(window.innerWidth - 20, startW + (e.clientX - startX)));
      const newH = Math.max(360, Math.min(window.innerHeight - 20, startH + (e.clientY - startY)));
      panelEl.style.width = newW + 'px';
      panelEl.style.height = newH + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        const rect = panelEl.getBoundingClientRect();
        config.panel = { ...config.panel, width: Math.round(rect.width), height: Math.round(rect.height) };
        saveConfig();
      }
    });
  }

  function openPanel(autoRun) {
    if (!panelEl) createPanel();
    panelEl.classList.remove('tabbit-hidden');
    renderModelSelect();
    if (autoRun) runSummary(true);
  }

  function closePanel() {
    if (panelEl) panelEl.classList.add('tabbit-hidden');
  }

  function togglePanel() {
    if (!panelEl || panelEl.classList.contains('tabbit-hidden')) openPanel(false);
    else closePanel();
  }

  function renderProfileSelect() {
    if (!panelEl) return;
    const select = panelEl.querySelector('#tabbit-profile-select');
    if (!select) return;
    select.innerHTML = '';
    config.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      if (p.id === config.currentProfileId) opt.selected = true;
      select.appendChild(opt);
    });
    select.onchange = function () {
      setCurrentProfile(this.value);
      renderModelSelect();
      setStatus(`已切换到「${getCurrentProfile().name}」`, 'ok', 1500);
    };
  }

  function renderModelSelect() {
    if (!panelEl) return;
    renderProfileSelect();
    const select = panelEl.querySelector('#tabbit-model-select');
    if (!select) return;
    const profile = getCurrentProfile();
    select.innerHTML = '';
    normalizeModels(profile.models).forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.name || model.value;
      if (model.value === profile.currentModel) option.selected = true;
      select.appendChild(option);
    });
    select.onchange = function () { profile.currentModel = this.value; saveConfig(); };
    renderPromptSelect();
  }

  function renderPromptSelect() {
    if (!panelEl) return;
    const select = panelEl.querySelector('#tabbit-prompt-select');
    if (!select) return;
    const matchedTpl = getTemplateForUrl(window.location.href);
    select.innerHTML = '';
    config.promptTemplates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name;
      if (t.id === matchedTpl.id) opt.selected = true;
      select.appendChild(opt);
    });
    // 🆕 切换提示词预设后追加总结（保留之前的对话内容，不修改全局默认提示词）
    select.onchange = function () {
      const tpl = config.promptTemplates.find(t => t.id === this.value);
      if (!tpl) return;
      setStatus(`已切换到「${tpl.name}」，正在追加总结…`, 'loading');
      // 如果有正在进行的请求，先中断
      abortCurrentRequest();
      // 稍延迟，确保中断完成后再发起追加总结
      setTimeout(() => runSummaryAppend(tpl), 100);
    };
  }
  /******************************************************************
   * 13. 📋 复制 / 🌱 flomo / 🗑 清空
   ******************************************************************/
  function buildConversationText() {
    return conversation
      .filter(m => m.role !== 'system' && !m.meta?.hidden)   // ← 加上 && !m.meta?.hidden
      .map(m => {
        const tag = m.role === 'user' ? '【我】' : `【AI · ${m.meta?.model || ''}】`;
        return `${tag}\n${m.content}`;
      })
      .join('\n\n---\n\n');
  }

  function copyAllConversation() {
    const text = buildConversationText();
    if (!text.trim()) { setStatus('没有可复制的内容', 'error', 1500); return; }
    if (typeof GM_setClipboard === 'function') GM_setClipboard(text);
    else navigator.clipboard?.writeText(text);
    setStatus('已复制全部对话到剪贴板', 'ok', 1500);
  }

  function sendToFlomo() {
    if (!config.flomoApiUrl) {
      alert('请先在设置中配置 flomo API 地址。');
      openSettings(); return;
    }
    const text = buildConversationText();
    if (!text.trim()) { setStatus('没有可发送的内容', 'error', 1500); return; }

    const content =
      `${text}\n\n---\n📄 ${document.title}\n🔗 ${location.href}\n#饺子AI摘要`;

    const btn = panelEl.querySelector('#tabbit-flomo-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    setStatus('正在发送到 flomo…', 'loading');

    GM_xmlhttpRequest({
      method: 'POST',
      url: config.flomoApiUrl,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ content }),
      timeout: 30000,
      onload(res) {
        try {
          const data = JSON.parse(res.responseText || '{}');
          const ok = res.status >= 200 && res.status < 300 &&
                     (data.code === 0 || data.code === 200 || data.message === 'ok' || data.message === 'success');
          if (ok) {
            setStatus('已发送到 flomo', 'ok', 2000);
            if (btn) {
              btn.textContent = '✅';
              setTimeout(() => { btn.textContent = '🌱'; btn.disabled = false; }, 2000);
            }
          } else throw new Error(data.message || `HTTP ${res.status}`);
        } catch (err) {
          setStatus('发送失败：' + err.message, 'error', 3000);
          if (btn) { btn.textContent = '🌱'; btn.disabled = false; }
        }
      },
      onerror() {
        setStatus('发送失败：网络错误', 'error', 3000);
        if (btn) { btn.textContent = '🌱'; btn.disabled = false; }
      },
      ontimeout() {
        setStatus('发送超时', 'error', 3000);
        if (btn) { btn.textContent = '🌱'; btn.disabled = false; }
      }
    });
  }

  function handleClearConversation() {
    const visibleCount = conversation.filter(m => m.role !== 'system').length;
    if (!visibleCount) { setStatus('对话已是空的', '', 1500); return; }
    if (!confirm(`确定清空当前 ${visibleCount} 条对话吗？\n（不会影响页面正文上下文，下次提问将基于当前页面重新开始）`)) return;
    resetConversation();
    setStatus('对话已清空', 'ok', 1500);
  }

  /******************************************************************
   * 👁 预览抓取到的正文
   ******************************************************************/
  function showPagePreview() {
    if (!panelEl) return;
    const text = getPageText();
    const len = text.length;
    const max = Number(config.extractMaxChars || 16000);

    // 把预览作为一条"系统提示"消息塞进对话区显示，但不进 conversation 上下文
    const body = panelEl.querySelector('#tabbit-body');
    if (!body) return;

    const previewHtml = `
      <div class="tabbit-msg tabbit-msg-assistant" id="tabbit-preview-block">
        <div class="tabbit-msg-role" style="display:flex;justify-content:space-between;align-items:center;">
          <span>👁 正文预览（${len.toLocaleString()} / ${max.toLocaleString()} 字符）</span>
          <span style="display:flex;gap:6px;">
            <button class="tabbit-secondary-btn" id="tabbit-preview-copy" style="padding:2px 8px;font-size:11px;">复制</button>
            <button class="tabbit-secondary-btn" id="tabbit-preview-close" style="padding:2px 8px;font-size:11px;">关闭</button>
          </span>
        </div>
        <div class="tabbit-msg-content">
          <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6;max-height:400px;overflow:auto;margin:0;background:transparent;padding:0;">${escapeAttr(text) || '（未抓取到正文）'}</pre>
        </div>
      </div>
    `;

    // 移除已有预览块，避免重复
    const old = body.querySelector('#tabbit-preview-block');
    if (old) old.remove();

    body.insertAdjacentHTML('beforeend', previewHtml);
    body.scrollTop = body.scrollHeight;

    body.querySelector('#tabbit-preview-copy').addEventListener('click', () => {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text);
      else navigator.clipboard?.writeText(text);
      setStatus('正文已复制', 'ok', 1500);
    });
    body.querySelector('#tabbit-preview-close').addEventListener('click', () => {
      body.querySelector('#tabbit-preview-block')?.remove();
    });

    setStatus(`已抓取 ${len.toLocaleString()} 字符`, 'ok', 1500);
  }

  /******************************************************************
   * 📌 把当前网址快捷加入规则列表（小卡片版）
   ******************************************************************/
  function quickAddCurrentUrlToRules() {
    // 已存在的卡片先关掉，避免叠加
    document.getElementById('tabbit-addrule-card')?.remove();

    const origin = location.origin;
    const path = location.pathname;
    const dir = path.replace(/[^/]+$/, '');

    const candidates = [
      { label: '仅这个页面', desc: '当前精确路径', value: origin + path },
      { label: '当前目录下全部', desc: '推荐 ⭐', value: origin + dir + '*' },
      { label: '整站全部页面', desc: '范围最大', value: origin + '/*' }
    ];

    // 当前已有的规则，标记一下
    const existing = new Set(config.urlRules);

    const card = document.createElement('div');
    card.id = 'tabbit-addrule-card';
    card.innerHTML = `
      <div class="tabbit-addrule-mask"></div>
      <div class="tabbit-addrule-panel">
        <div class="tabbit-addrule-header">
          <span>📌 把当前网址加入规则</span>
          <button class="tabbit-icon-btn" id="tabbit-addrule-close" style="background:#eee;color:#333;">×</button>
        </div>
        <div class="tabbit-addrule-url" title="${escapeAttr(location.href)}">
          🔗 ${escapeAttr(location.href)}
        </div>
        <div class="tabbit-addrule-list">
          ${candidates.map((c, i) => `
            <button class="tabbit-addrule-option ${existing.has(c.value) ? 'is-existing' : ''}"
                    data-pattern="${escapeAttr(c.value)}"
                    ${existing.has(c.value) ? 'disabled' : ''}>
              <div class="tabbit-addrule-option-main">
                <span class="tabbit-addrule-option-label">${c.label}</span>
                <span class="tabbit-addrule-option-desc">${c.desc}${existing.has(c.value) ? ' · 已存在' : ''}</span>
              </div>
              <code class="tabbit-addrule-option-pattern">${escapeAttr(c.value)}</code>
            </button>
          `).join('')}
        </div>
        <div class="tabbit-addrule-footer">
          <small>提示：支持通配符 <code>*</code>，添加后可在设置中绑定提示词模板</small>
        </div>
      </div>
    `;
    document.body.appendChild(card);

    const close = () => card.remove();
    card.querySelector('#tabbit-addrule-close').addEventListener('click', close);
    card.querySelector('.tabbit-addrule-mask').addEventListener('click', close);

    // ESC 关闭
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);

    card.querySelectorAll('.tabbit-addrule-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const pattern = btn.dataset.pattern;
        if (!pattern || existing.has(pattern)) return;

        config.urlRules.push(pattern);
        saveConfig();
        renderPromptSelect();
        setStatus(`✅ 已添加规则：${pattern}`, 'ok', 2500);

        if (settingsEl && !settingsEl.classList.contains('tabbit-hidden')) {
          renderSettingsUrlRules();
        }
        close();
      });
    });
  }
  /******************************************************************
   * 14. 总结 + 💬 连续对话
   ******************************************************************/
  async function runSummary(isAuto) {
    if (!panelEl) createPanel();
    if (panelEl.classList.contains('tabbit-hidden')) panelEl.classList.remove('tabbit-hidden');
    if (!checkApiConfig()) return;

    const tplSelect = panelEl.querySelector('#tabbit-prompt-select');
    const tplId = tplSelect.value;
    const template = config.promptTemplates.find(t => t.id === tplId) || getDefaultTemplate();

    const pageText = getPageText();
    if (!pageText || pageText.length < 30) {
      setStatus('页面正文过短', 'error', 2500); return;
    }

    conversation = [];
    pageContextLoaded = false;
    ensurePageContext();

    const userPrompt = `请按以下要求总结当前页面：\n\n${template.text}`;
    conversation.push({ role: 'user', content: userPrompt, meta: { hidden: true } });

    const runBtn = panelEl.querySelector('#tabbit-run-btn');
    runBtn.disabled = false;
    runBtn.textContent = '⏹ 停止';
    runBtn.onclick = abortCurrentRequest;
    setStatus(`使用「${template.name}」模板，模型 ${getCurrentModelDisplayName()}…`, 'loading');

    // 🌊 流式占位
    const streamingMsg = { role: 'assistant', content: '', meta: { model: getCurrentModelDisplayName(), streaming: true } };
    conversation.push(streamingMsg);
    renderConversation();

    // 节流渲染（避免每个 token 都全量重渲）
    let renderTimer = null;
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => { renderTimer = null; renderConversation(); }, 60);
    };

    try {
      const messagesForApi = conversation
        .filter(m => !m.meta?.streaming)
        .map(m => ({ role: m.role, content: m.content }));

      const finalText = await callChatApi(messagesForApi, (delta, full) => {
        streamingMsg.content = full;
        scheduleRender();
      });

      streamingMsg.content = finalText;
      streamingMsg.meta.streaming = false;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      renderConversation();
      setStatus('完成', 'ok', 1500);
    } catch (err) {
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      // 已有部分输出则保留 + 追加错误；否则替换
      if (streamingMsg.content) {
        streamingMsg.content += `\n\n❌ ${err.message || err}`;
      } else {
        streamingMsg.content = `❌ ${err.message || err}`;
      }
      streamingMsg.meta.streaming = false;
      renderConversation();
      setStatus('生成失败', 'error', 2500);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '✨ 总结';
      runBtn.onclick = () => runSummary(false);
    }
  }

  /**
   * 🆕 追加总结：切换预设时调用，保留现有对话，用新模板追加一次总结
   * 不修改 config.defaultPromptTemplateId（全局默认提示词只在设置窗口修改）
   */
  async function runSummaryAppend(template) {
    if (!panelEl) createPanel();
    if (panelEl.classList.contains('tabbit-hidden')) panelEl.classList.remove('tabbit-hidden');
    if (!checkApiConfig()) return;

    const pageText = getPageText();
    if (!pageText || pageText.length < 30) {
      setStatus('页面正文过短', 'error', 2500); return;
    }

    ensurePageContext();

    const userPrompt = `请按以下要求重新总结当前页面（使用「${template.name}」风格）：\n\n${template.text}`;
    conversation.push({ role: 'user', content: userPrompt, meta: { hidden: true } });

    const runBtn = panelEl.querySelector('#tabbit-run-btn');
    runBtn.disabled = false;
    runBtn.textContent = '⏹ 停止';
    runBtn.onclick = abortCurrentRequest;
    setStatus(`使用「${template.name}」模板追加总结，模型 ${getCurrentModelDisplayName()}…`, 'loading');

    const streamingMsg = { role: 'assistant', content: '', meta: { model: `${getCurrentModelDisplayName()} · ${template.name}`, streaming: true } };
    conversation.push(streamingMsg);
    renderConversation();

    let renderTimer = null;
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => { renderTimer = null; renderConversation(); }, 60);
    };

    try {
      const messagesForApi = conversation
        .filter(m => !m.meta?.streaming)
        .map(m => ({ role: m.role, content: m.content }));

      const finalText = await callChatApi(messagesForApi, (delta, full) => {
        streamingMsg.content = full;
        scheduleRender();
      });

      streamingMsg.content = finalText;
      streamingMsg.meta.streaming = false;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      renderConversation();
      setStatus('完成', 'ok', 1500);
    } catch (err) {
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      if (streamingMsg.content) {
        streamingMsg.content += `\n\n❌ ${err.message || err}`;
      } else {
        streamingMsg.content = `❌ ${err.message || err}`;
      }
      streamingMsg.meta.streaming = false;
      renderConversation();
      setStatus('生成失败', 'error', 2500);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '✨ 总结';
      runBtn.onclick = () => runSummary(false);
    }
  }

  async function handleSendChat() {
    if (!panelEl) return;
    if (!checkApiConfig()) return;
    const input = panelEl.querySelector('#tabbit-chat-input');
    const sendBtn = panelEl.querySelector('#tabbit-send-btn');
    const text = (input.value || '').trim();
    if (!text) return;

    ensurePageContext();
    appendMessage('user', text);
    input.value = '';
    input.style.height = 'auto';

    sendBtn.disabled = true; sendBtn.textContent = '...';
    setStatus(`AI 思考中（${getCurrentModelDisplayName()}）…`, 'loading');

    const streamingMsg = { role: 'assistant', content: '', meta: { model: getCurrentModelDisplayName(), streaming: true } };
    conversation.push(streamingMsg);
    renderConversation();

    let renderTimer = null;
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => { renderTimer = null; renderConversation(); }, 60);
    };

    try {
      const messagesForApi = conversation
        .filter(m => !m.meta?.streaming)
        .map(m => ({ role: m.role, content: m.content }));

      const finalText = await callChatApi(messagesForApi, (delta, full) => {
        streamingMsg.content = full;
        scheduleRender();
      });

      streamingMsg.content = finalText;
      streamingMsg.meta.streaming = false;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      renderConversation();
      setStatus('完成', 'ok', 1200);
    } catch (err) {
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      if (streamingMsg.content) {
        streamingMsg.content += `\n\n❌ ${err.message || err}`;
      } else {
        streamingMsg.content = `❌ ${err.message || err}`;
      }
      streamingMsg.meta.streaming = false;
      renderConversation();
      setStatus('生成失败', 'error', 2500);
    } finally {
      sendBtn.disabled = false; sendBtn.textContent = '发送';
      input.focus();
    }
  }

  /******************************************************************
   * 15. 设置弹窗
   ******************************************************************/
  let settingsEl = null;

  function createSettingsModal() {
    if (document.getElementById(SETTINGS_ID)) return;
    settingsEl = document.createElement('div');
    settingsEl.id = SETTINGS_ID;
    settingsEl.classList.add('tabbit-hidden');
    settingsEl.innerHTML = `
      <div class="tabbit-settings-content">
        <div class="tabbit-settings-header">
          <span>⚙️ 饺子 AI 设置</span>
          <button id="tabbit-set-close" class="tabbit-icon-btn" style="background:#eee;color:#333;">×</button>
        </div>

        <div class="tabbit-section-title" style="margin-top:0;border-top:none;padding-top:0;">📦 API 配置预设</div>
        <small class="tabbit-help">不同 API 服务商可建多个预设，一键切换。提示词模板和网址规则跨预设共用。</small>
        <div class="tabbit-profile-row">
          <select id="tabbit-set-profile-select" class="tabbit-profile-select-wide"></select>
          <button id="tabbit-profile-add" class="tabbit-secondary-btn" type="button">➕ 新建</button>
          <button id="tabbit-profile-clone" class="tabbit-secondary-btn" type="button">📋 复制</button>
          <button id="tabbit-profile-rename" class="tabbit-secondary-btn" type="button">✏️ 改名</button>
          <button id="tabbit-profile-delete" class="tabbit-danger-btn" type="button">🗑️</button>
        </div>

        <label class="tabbit-field"><span>预设名称</span>
          <input id="tabbit-set-profile-name" type="text" placeholder="如：DeepSeek、OpenAI">
        </label>
        <label class="tabbit-field"><span>API 地址</span>
          <input id="tabbit-set-api-url" type="text" placeholder="https://api.openai.com/v1/chat/completions">
        </label>
        <label class="tabbit-field"><span>API Key</span>
          <input id="tabbit-set-api-key" type="password" placeholder="sk-xxxx">
        </label>

        <div class="tabbit-settings-actions">
          <button id="tabbit-test-api" class="tabbit-secondary-btn" type="button">⚡ 测试 API</button>
          <button id="tabbit-fetch-models" class="tabbit-secondary-btn" type="button">🔄 获取模型列表</button>
        </div>

        <div class="tabbit-row-2">
          <label class="tabbit-field"><span>默认 temperature</span>
            <input id="tabbit-set-temperature" type="number" step="0.1" min="0" max="2">
          </label>
          <label class="tabbit-field"><span>默认 max_tokens</span>
            <input id="tabbit-set-max-tokens" type="number" min="100">
          </label>
        </div>

        <div class="tabbit-section-title">🤖 模型预设</div>
        <div id="tabbit-model-list"></div>
        <div class="tabbit-settings-actions">
          <button id="tabbit-add-model" class="tabbit-secondary-btn" type="button">➕ 添加模型</button>
        </div>

        <div class="tabbit-section-title">📝 提示词模板（全局共用）</div>
        <div id="tabbit-tpl-list"></div>
        <div class="tabbit-settings-actions">
          <button id="tabbit-add-tpl" class="tabbit-secondary-btn" type="button">➕ 添加模板</button>
        </div>

        <div class="tabbit-section-title">🌐 网址规则（自动弹出 + 模板绑定）</div>
        <small class="tabbit-help">支持通配符 *。匹配的页面打开时自动弹出面板（需勾选自动弹出）。每条规则可绑定一个提示词模板。</small>
        <div id="tabbit-rule-list"></div>
        <div class="tabbit-settings-actions">
          <button id="tabbit-add-rule" class="tabbit-secondary-btn" type="button">➕ 添加规则</button>
          <button id="tabbit-add-current-url" class="tabbit-secondary-btn" type="button">📌 加入当前网址</button>
        </div>

        <div class="tabbit-section-title">🔧 通用</div>
        <div class="tabbit-row-2">
          <label class="tabbit-field"><span>面板宽度（px）</span>
            <input id="tabbit-set-panel-width" type="number" min="320">
          </label>
          <label class="tabbit-field"><span>正文最大字符数</span>
            <input id="tabbit-set-extract-max" type="number" min="2000">
          </label>
        </div>
        <label class="tabbit-field">
          <span><input id="tabbit-set-auto-run" type="checkbox"> 命中网址规则时自动弹出并总结</span>
        </label>
        <label class="tabbit-field"><span>flomo API（可选，PRO 会员功能）</span>
          <input id="tabbit-set-flomo-api" type="text" placeholder="https://flomoapp.com/iwh/...">
        </label>

        <div class="tabbit-section-title">📋 自动复制</div>
        <small class="tabbit-help">选中文本后自动复制到剪贴板，可选择是否附带页面标题和链接作为出处。也可右键点击浮动按钮快速切换。</small>
        <label class="tabbit-field">
          <span><input id="tabbit-set-auto-copy" type="checkbox"> 开启自动复制（选中文本自动复制）</span>
        </label>
        <label class="tabbit-field">
          <span><input id="tabbit-set-auto-copy-source" type="checkbox"> 复制时附带出处信息（页面标题 + 链接）</span>
        </label>

        <div class="tabbit-section-title">☁️ 坚果云 WebDAV 云同步</div>
        <small class="tabbit-help">
          • <code>tabbit-shared/ai-profiles.json</code> — API 预设（多脚本共享）<br>
          • <code>tabbit-ai-summary/config.json</code> — 模板 + 网址规则（本脚本专属）<br>
          ⚠️ <b>API Key 会上传到云端</b>，请确保账号安全。
        </small>
        <div class="tabbit-row-2">
          <label class="tabbit-field"><span>坚果云账号（邮箱）</span>
            <input id="tabbit-set-jgy-account" type="text" placeholder="you@example.com">
          </label>
          <label class="tabbit-field"><span>应用密码</span>
            <input id="tabbit-set-jgy-password" type="password" placeholder="坚果云应用密码">
          </label>
        </div>

        <div class="tabbit-sync-scope">
          <span class="tabbit-sync-scope-title">同步范围：</span>
          <label><input type="checkbox" id="tabbit-sync-profiles" checked> 📦 API 预设（含 Key）</label>
          <label><input type="checkbox" id="tabbit-sync-app" checked> 📝 模板 + 网址规则</label>
        </div>

        <div id="tabbit-cloud-status" style="font-size:12px;color:#888;margin:4px 0 6px;"></div>
        <div class="tabbit-settings-actions">
          <button id="tabbit-cloud-test" class="tabbit-secondary-btn" type="button">🔌 测试连接</button>
          <button id="tabbit-cloud-pull" class="tabbit-secondary-btn" type="button">⬇️ 从云端拉取</button>
          <button id="tabbit-cloud-push" class="tabbit-secondary-btn" type="button">⬆️ 增量上传</button>
          <button id="tabbit-cloud-force-push" class="tabbit-danger-btn" type="button">⚠️ 强制覆盖上传</button>
        </div>

        <div class="tabbit-modal-footer">
          <button id="tabbit-set-cancel" class="tabbit-secondary-btn">取消</button>
          <button id="tabbit-set-save" class="tabbit-primary-btn">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(settingsEl);

    settingsEl.querySelector('#tabbit-set-close').addEventListener('click', closeSettings);
    settingsEl.querySelector('#tabbit-set-cancel').addEventListener('click', closeSettings);
    settingsEl.querySelector('#tabbit-set-save').addEventListener('click', saveSettingsFromForm);
    settingsEl.querySelector('#tabbit-set-profile-select').addEventListener('change', handleProfileSwitch);
    settingsEl.querySelector('#tabbit-profile-add').addEventListener('click', handleProfileAdd);
    settingsEl.querySelector('#tabbit-profile-clone').addEventListener('click', handleProfileClone);
    settingsEl.querySelector('#tabbit-profile-rename').addEventListener('click', handleProfileRename);
    settingsEl.querySelector('#tabbit-profile-delete').addEventListener('click', handleProfileDelete);
    settingsEl.querySelector('#tabbit-test-api').addEventListener('click', testApiConnection);
    settingsEl.querySelector('#tabbit-fetch-models').addEventListener('click', fetchModelsFromApi);
    settingsEl.querySelector('#tabbit-add-model').addEventListener('click', () => {
      syncModelsFromSettings();
      getCurrentProfile().models.push({ name: '', value: '', temperature: '', maxTokens: '' });
      renderSettingsModels();
    });
    settingsEl.querySelector('#tabbit-add-tpl').addEventListener('click', () => {
      syncTemplatesFromSettings();
      config.promptTemplates.push({ id: makeId('tpl'), name: '新模板', text: '' });
      renderSettingsTemplates();
    });
    settingsEl.querySelector('#tabbit-add-rule').addEventListener('click', () => {
      syncUrlRulesFromSettings();
      config.urlRules.push('https://example.com/*');
      renderSettingsUrlRules();
    });
    settingsEl.querySelector('#tabbit-add-current-url').addEventListener('click', () => {
      syncUrlRulesFromSettings();
      const cur = location.origin + location.pathname.replace(/[^/]+$/, '*');
      if (!config.urlRules.includes(cur)) config.urlRules.push(cur);
      renderSettingsUrlRules();
    });
    settingsEl.querySelector('#tabbit-cloud-test').addEventListener('click', handleCloudTest);
    settingsEl.querySelector('#tabbit-cloud-pull').addEventListener('click', handleCloudPull);
    settingsEl.querySelector('#tabbit-cloud-push').addEventListener('click', handleCloudPush);
    settingsEl.querySelector('#tabbit-cloud-force-push').addEventListener('click', handleCloudForcePush);
  }

  function openSettings() {
    if (!settingsEl) createSettingsModal();
    settingsEl.classList.remove('tabbit-hidden');
    fillSettingsForm();
  }
  function closeSettings() {
    if (settingsEl) settingsEl.classList.add('tabbit-hidden');
  }

  function syncCurrentProfileFromForm() {
    if (!settingsEl) return;
    const profile = getCurrentProfile();
    if (!profile) return;
    profile.name = settingsEl.querySelector('#tabbit-set-profile-name').value.trim() || profile.name;
    profile.apiUrl = settingsEl.querySelector('#tabbit-set-api-url').value.trim();
    profile.apiKey = settingsEl.querySelector('#tabbit-set-api-key').value.trim();
    profile.temperature = Number(settingsEl.querySelector('#tabbit-set-temperature').value || 0.7);
    profile.maxTokens = Number(settingsEl.querySelector('#tabbit-set-max-tokens').value || 2000);
    syncModelsFromSettings();
  }
  function handleProfileSwitch(e) { syncCurrentProfileFromForm(); setCurrentProfile(e.target.value); fillSettingsForm(); }
  function handleProfileAdd() {
    const name = prompt('新预设名称：', '新配置'); if (!name) return;
    syncCurrentProfileFromForm(); addProfile(name, false); fillSettingsForm();
  }
  function handleProfileClone() {
    const cur = getCurrentProfile();
    const name = prompt('复制为新预设：', cur.name + '（副本）'); if (!name) return;
    syncCurrentProfileFromForm(); addProfile(name, true); fillSettingsForm();
  }
  function handleProfileRename() {
    const cur = getCurrentProfile();
    const name = prompt('重命名当前预设：', cur.name); if (!name) return;
    renameProfile(cur.id, name); fillSettingsForm();
  }
  function handleProfileDelete() {
    const cur = getCurrentProfile();
    if (config.profiles.length <= 1) { alert('至少保留一个预设。'); return; }
    if (!confirm(`确定删除预设「${cur.name}」？`)) return;
    deleteProfile(cur.id); fillSettingsForm();
  }

  function fillSettingsForm() {
    if (!settingsEl) return;
    const ps = settingsEl.querySelector('#tabbit-set-profile-select');
    ps.innerHTML = '';
    config.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      if (p.id === config.currentProfileId) opt.selected = true;
      ps.appendChild(opt);
    });
    const profile = getCurrentProfile();
    settingsEl.querySelector('#tabbit-set-profile-name').value = profile.name || '';
    settingsEl.querySelector('#tabbit-set-api-url').value = profile.apiUrl || '';
    settingsEl.querySelector('#tabbit-set-api-key').value = profile.apiKey || '';
    settingsEl.querySelector('#tabbit-set-temperature').value = profile.temperature ?? 0.7;
    settingsEl.querySelector('#tabbit-set-max-tokens').value = profile.maxTokens ?? 2000;
    settingsEl.querySelector('#tabbit-set-panel-width').value = config.panel?.width || 460;
    settingsEl.querySelector('#tabbit-set-extract-max').value = config.extractMaxChars || 16000;
    settingsEl.querySelector('#tabbit-set-auto-run').checked = !!config.autoRun;
    settingsEl.querySelector('#tabbit-set-flomo-api').value = config.flomoApiUrl || '';
    settingsEl.querySelector('#tabbit-set-auto-copy').checked = config.autoCopy?.enabled !== false;
    settingsEl.querySelector('#tabbit-set-auto-copy-source').checked = !!config.autoCopy?.withSource;
    settingsEl.querySelector('#tabbit-set-jgy-account').value = config.cloudSync?.account || '';
    settingsEl.querySelector('#tabbit-set-jgy-password').value = config.cloudSync?.appPassword || '';

    const cs = settingsEl.querySelector('#tabbit-cloud-status');
    if (cs) {
      const t = config.cloudSync?.lastSyncAt;
      if (t) {
        const d = new Date(t);
        const pad = n => String(n).padStart(2, '0');
        const dirMap = { 'pull': '从云端拉取', 'push': '增量上传', 'force-push': '强制覆盖上传' };
        const dir = dirMap[config.cloudSync.lastSyncDirection] || '';
        cs.textContent = `最近同步：${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}（${dir}）`;
      } else cs.textContent = '尚未进行过云同步';
    }
    renderSettingsModels();
    renderSettingsTemplates();
    renderSettingsUrlRules();
  }

  function renderSettingsModels() {
    if (!settingsEl) return;
    const profile = getCurrentProfile();
    const box = settingsEl.querySelector('#tabbit-model-list');
    box.innerHTML = '';
    profile.models.forEach((model, index) => {
      const row = document.createElement('div');
      row.className = 'tabbit-model-row';
      row.innerHTML = `
        <input class="tabbit-model-value" type="text" placeholder="模型名" value="${escapeAttr(model.value || '')}">
        <input class="tabbit-model-temp" type="number" step="0.1" placeholder="temp" value="${escapeAttr(model.temperature ?? '')}">
        <input class="tabbit-model-tokens" type="number" placeholder="tokens" value="${escapeAttr(model.maxTokens ?? '')}">
        <label class="tabbit-current-model">
          <input type="radio" name="tabbit-current-model" ${model.value === profile.currentModel ? 'checked' : ''}>
          当前
        </label>
        <button class="tabbit-remove-model" type="button">×</button>
      `;
      row.querySelector('.tabbit-remove-model').addEventListener('click', () => {
        syncModelsFromSettings();
        profile.models.splice(index, 1);
        if (!profile.models.length) profile.models.push({ name: '', value: '', temperature: '', maxTokens: '' });
        if (!profile.models.some(m => m.value === profile.currentModel)) profile.currentModel = profile.models[0].value;
        renderSettingsModels();
      });
      box.appendChild(row);
    });
  }

  function syncModelsFromSettings() {
    if (!settingsEl) return;
    const profile = getCurrentProfile();
    const rows = [...settingsEl.querySelectorAll('.tabbit-model-row')];
    let nextCurrent = profile.currentModel;
    const models = rows.map(row => {
      const value = row.querySelector('.tabbit-model-value').value.trim();
      const temperature = row.querySelector('.tabbit-model-temp').value.trim();
      const maxTokens = row.querySelector('.tabbit-model-tokens').value.trim();
      const checked = row.querySelector('input[type="radio"]').checked;
      if (checked && value) nextCurrent = value;
      return { name: value, value, temperature, maxTokens };
    }).filter(m => m.value);
    profile.models = normalizeModels(models);
    if (!profile.models.some(m => m.value === nextCurrent)) nextCurrent = profile.models[0]?.value || '';
    profile.currentModel = nextCurrent;
  }

  function renderSettingsTemplates() {
    if (!settingsEl) return;
    const box = settingsEl.querySelector('#tabbit-tpl-list');
    box.innerHTML = '';
    config.promptTemplates.forEach((tpl, index) => {
      const row = document.createElement('div');
      row.className = 'tabbit-tpl-row';
      row.innerHTML = `
        <input class="tabbit-tpl-name" type="text" placeholder="模板名" value="${escapeAttr(tpl.name)}">
        <textarea class="tabbit-tpl-text" placeholder="提示词内容">${escapeAttr(tpl.text)}</textarea>
        <label class="tabbit-tpl-default">
          <input type="radio" name="tabbit-default-tpl" ${tpl.id === config.defaultPromptTemplateId ? 'checked' : ''}>
          默认
        </label>
        <button class="tabbit-remove-model" type="button">×</button>
      `;
      row.dataset.id = tpl.id;
      row.querySelector('.tabbit-remove-model').addEventListener('click', () => {
        syncTemplatesFromSettings();
        config.promptTemplates.splice(index, 1);
        if (!config.promptTemplates.length) config.promptTemplates.push({ id: makeId('tpl'), name: '默认总结', text: DEFAULT_PROMPT_TEXT });
        if (!config.promptTemplates.some(t => t.id === config.defaultPromptTemplateId)) config.defaultPromptTemplateId = config.promptTemplates[0].id;
        renderSettingsTemplates();
      });
      box.appendChild(row);
    });
  }

  function syncTemplatesFromSettings() {
    if (!settingsEl) return;
    const rows = [...settingsEl.querySelectorAll('.tabbit-tpl-row')];
    let nextDefault = config.defaultPromptTemplateId;
    const tpls = rows.map(row => {
      const id = row.dataset.id || makeId('tpl');
      const name = row.querySelector('.tabbit-tpl-name').value.trim();
      const text = row.querySelector('.tabbit-tpl-text').value.trim();
      const checked = row.querySelector('input[type="radio"]').checked;
      if (checked) nextDefault = id;
      return { id, name, text };
    }).filter(t => t.name && t.text);
    config.promptTemplates = normalizePromptTemplates(tpls);
    if (!config.promptTemplates.some(t => t.id === nextDefault)) nextDefault = config.promptTemplates[0]?.id || 'default';
    config.defaultPromptTemplateId = nextDefault;
  }

  function renderSettingsUrlRules() {
    if (!settingsEl) return;
    const box = settingsEl.querySelector('#tabbit-rule-list');
    box.innerHTML = '';
    config.urlRules.forEach((rule, index) => {
      const binding = config.rulePromptBindings.find(b => b.rule === rule);
      const row = document.createElement('div');
      row.className = 'tabbit-rule-row';
      const tplOptions = config.promptTemplates.map(t =>
        `<option value="${t.id}" ${binding?.templateId === t.id ? 'selected' : ''}>${escapeAttr(t.name)}</option>`
      ).join('');
      row.innerHTML = `
        <input class="tabbit-rule-pattern" type="text" value="${escapeAttr(rule)}">
        <select class="tabbit-rule-tpl">
          <option value="">（默认模板）</option>
          ${tplOptions}
        </select>
        <button class="tabbit-remove-model" type="button">×</button>
      `;
      row.querySelector('.tabbit-remove-model').addEventListener('click', () => {
        syncUrlRulesFromSettings();
        config.urlRules.splice(index, 1);
        renderSettingsUrlRules();
      });
      box.appendChild(row);
    });
  }

  function syncUrlRulesFromSettings() {
    if (!settingsEl) return;
    const rows = [...settingsEl.querySelectorAll('.tabbit-rule-row')];
    const rules = [], bindings = [];
    rows.forEach(row => {
      const pattern = row.querySelector('.tabbit-rule-pattern').value.trim();
      const tplId = row.querySelector('.tabbit-rule-tpl').value;
      if (!pattern) return;
      rules.push(pattern);
      if (tplId) bindings.push({ rule: pattern, templateId: tplId });
    });
    config.urlRules = normalizeUrlRules(rules);
    config.rulePromptBindings = normalizeRulePromptBindings(bindings);
  }

  function saveSettingsFromForm() {
    syncCurrentProfileFromForm();
    syncTemplatesFromSettings();
    syncUrlRulesFromSettings();
    config.autoRun = settingsEl.querySelector('#tabbit-set-auto-run').checked;
    config.extractMaxChars = Number(settingsEl.querySelector('#tabbit-set-extract-max').value || 16000);
    config.flomoApiUrl = settingsEl.querySelector('#tabbit-set-flomo-api').value.trim();
    config.autoCopy = {
      enabled: settingsEl.querySelector('#tabbit-set-auto-copy').checked,
      withSource: settingsEl.querySelector('#tabbit-set-auto-copy-source').checked
    };
    config.cloudSync = {
      ...(config.cloudSync || {}),
      account: settingsEl.querySelector('#tabbit-set-jgy-account').value.trim(),
      appPassword: settingsEl.querySelector('#tabbit-set-jgy-password').value.trim()
    };
    config.panel = {
      ...config.panel,
      width: Math.max(320, Number(settingsEl.querySelector('#tabbit-set-panel-width').value || 460))
    };
    saveConfig();
    renderModelSelect();
    applyFloatButtonPosition();
    if (panelEl) panelEl.style.width = config.panel.width + 'px';
    closeSettings();
    setStatus('设置已保存', 'ok', 1200);
  }

  /******************************************************************
   * 16. 测试 API / 获取模型
   ******************************************************************/
  async function testApiConnection() {
    syncCurrentProfileFromForm();
    const profile = getCurrentProfile();
    if (!profile.apiUrl || !profile.apiKey || !profile.currentModel) {
      alert('请先填写 API 地址、API Key，并选择当前模型。'); return;
    }
    const btn = settingsEl.querySelector('#tabbit-test-api');
    btn.disabled = true; btn.textContent = '测试中…';
    try {
      await callChatApi([{ role: 'user', content: '请只回复 OK' }]);
      alert(`✅ 预设「${profile.name}」API 测试成功。`);
    } catch (err) {
      alert('❌ API 测试失败：\n\n' + (err.message || String(err)));
    } finally {
      btn.disabled = false; btn.textContent = '⚡ 测试 API';
    }
  }

  function fetchModelsFromApi() {
    syncCurrentProfileFromForm();
    const profile = getCurrentProfile();
    if (!profile.apiUrl || !profile.apiKey) { alert('请先填写 API 地址和 Key。'); return; }
    let modelsUrl = '';
    try { modelsUrl = buildModelsUrl(profile.apiUrl); } catch (err) { alert('API 地址格式不正确。'); return; }
    const btn = settingsEl.querySelector('#tabbit-fetch-models');
    btn.disabled = true; btn.textContent = '获取中…';
    GM_xmlhttpRequest({
      method: 'GET', url: modelsUrl,
      headers: { Authorization: `Bearer ${profile.apiKey}` },
      timeout: 60000,
      onload(res) {
        btn.disabled = false; btn.textContent = '🔄 获取模型列表';
        try {
          if (res.status < 200 || res.status >= 300) { alert(`获取失败：${res.status}`); return; }
          const data = JSON.parse(res.responseText);
          const ids = Array.isArray(data?.data) ? data.data.map(x => x.id || x.name || x.model).filter(Boolean) : [];
          if (!ids.length) { alert('没有从响应中识别到模型列表。'); return; }
          syncModelsFromSettings();
          ids.forEach(id => {
            if (!profile.models.some(m => m.value === id)) {
              profile.models.push({ name: id, value: id, temperature: '', maxTokens: '' });
            }
          });
          if (!profile.currentModel) profile.currentModel = profile.models[0]?.value || '';
          renderSettingsModels();
          alert(`✅ 已为预设「${profile.name}」获取 ${ids.length} 个模型。`);
        } catch (err) { alert('解析失败：' + err.message); }
      },
      onerror() { btn.disabled = false; btn.textContent = '🔄 获取模型列表'; alert('获取失败'); },
      ontimeout() { btn.disabled = false; btn.textContent = '🔄 获取模型列表'; alert('超时'); }
    });
  }

  /******************************************************************
   * 17. 导入 / 导出 / 重置
   ******************************************************************/
  function exportConfigToFile() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tabbit-ai-config-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function importConfigFromFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = e => {
      const file = e.target.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const saved = JSON.parse(reader.result);
          if (!confirm('确认导入？这将覆盖现有配置。')) return;
          config = mergeConfig(clone(DEFAULT_CONFIG), saved);
          saveConfig();
          if (panelEl) renderModelSelect();
          if (settingsEl && !settingsEl.classList.contains('tabbit-hidden')) fillSettingsForm();
          alert('✅ 导入成功');
        } catch (err) { alert('导入失败：' + err.message); }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  function resetConfig() {
    if (!confirm('确认重置所有配置？')) return;
    config = clone(DEFAULT_CONFIG);
    saveConfig();
    if (panelEl) renderModelSelect();
    if (settingsEl && !settingsEl.classList.contains('tabbit-hidden')) fillSettingsForm();
    alert('已重置。');
  }
  function openAddUrlRuleModal() {
    openSettings();
    setTimeout(() => {
      syncUrlRulesFromSettings();
      const cur = location.origin + location.pathname.replace(/[^/]+$/, '*');
      if (!config.urlRules.includes(cur)) config.urlRules.push(cur);
      renderSettingsUrlRules();
    }, 100);
  }

  /******************************************************************
   * 18. 油猴菜单
   ******************************************************************/
  function registerMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('打开面板', () => openPanel(false));
    GM_registerMenuCommand('立即总结当前页', () => openPanel(true));
    GM_registerMenuCommand('设置', openSettings);
    GM_registerMenuCommand(`🔀 切换预设（当前：${getCurrentProfile().name}）`, switchProfileQuick);
    GM_registerMenuCommand('☁️ 一键拉取云端配置', quickCloudPull);
    GM_registerMenuCommand('☁️ 一键上传到云端', quickCloudPush);
    GM_registerMenuCommand('加入当前网址', () => openAddUrlRuleModal());
    GM_registerMenuCommand('导出配置文件', exportConfigToFile);
    GM_registerMenuCommand('导入配置文件', importConfigFromFile);
    GM_registerMenuCommand('重置配置', resetConfig);
  }
  function switchProfileQuick() {
    const list = config.profiles.map((p, i) => `${i + 1}. ${p.name}${p.id === config.currentProfileId ? ' ✓' : ''}`).join('\n');
    const input = prompt(`输入要切换到的预设序号：\n\n${list}`, '1');
    if (!input) return;
    const idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= config.profiles.length) { alert('无效的序号'); return; }
    setCurrentProfile(config.profiles[idx].id);
    if (panelEl) renderModelSelect();
    alert(`✅ 已切换到「${config.profiles[idx].name}」`);
  }
  async function quickCloudPull() {
    if (!config.cloudSync?.account || !config.cloudSync?.appPassword) { alert('请先在设置中填写坚果云账号'); openSettings(); return; }
    if (!confirm('从云端拉取所有配置？')) return;
    try {
      const r = await cloudPull({ profiles: true, app: true });
      alert(`拉取完成：\nAPI预设 ${r.profilesCount} 个\n模板 ${r.tplsCount} 条\n规则 ${r.rulesCount} 条`);
      if (panelEl) renderModelSelect();
    } catch (err) { alert('❌ ' + (err.message || err)); }
  }
  async function quickCloudPush() {
    if (!config.cloudSync?.account || !config.cloudSync?.appPassword) { alert('请先在设置中填写坚果云账号'); openSettings(); return; }
    if (!confirm('上传所有配置到云端？')) return;
    try { await cloudPush({ profiles: true, app: true }); alert('✅ 已上传'); }
    catch (err) { alert('❌ ' + (err.message || err)); }
  }

  /******************************************************************
   * 19. 🔁 SPA 路由切换监听
   ******************************************************************/
  let __lastUrl = location.href;

  function handleUrlChanged() {
    const newUrl = location.href;
    if (newUrl === __lastUrl) return;
    __lastUrl = newUrl;

    // 🔁 SPA 路由切换：自动重置对话 + 重新检查规则
    resetConversation('🔁 页面已切换，对话已重置。\n\n点击「✨ 总结」开始，或在下方直接提问。');
    renderPromptSelect();

    if (config.autoRun && matchUrl(newUrl, config.urlRules)) {
      setTimeout(() => openPanel(true), 600);
    }
  }

  function watchUrlChange() {
    // 1. 轮询兜底
    setInterval(handleUrlChanged, 1000);

    // 2. 拦截 history API（更即时）
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const r = origPush.apply(this, args);
      setTimeout(handleUrlChanged, 50);
      return r;
    };
    history.replaceState = function (...args) {
      const r = origReplace.apply(this, args);
      setTimeout(handleUrlChanged, 50);
      return r;
    };
    window.addEventListener('popstate', () => setTimeout(handleUrlChanged, 50));
    window.addEventListener('hashchange', () => setTimeout(handleUrlChanged, 50));
  }

  /******************************************************************
   * 20. 入口
   ******************************************************************/
  function bootstrap() {
    createStyles();
    createFloatButton();
    acInit();
    registerMenus();

    // 📜 规则自动总结：首次加载即匹配
    if (config.autoRun && matchUrl(location.href, config.urlRules)) {
      setTimeout(() => openPanel(true), 800);
    }

    // 🔁 SPA 路由切换监听
    watchUrlChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();