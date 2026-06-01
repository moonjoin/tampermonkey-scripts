// ==UserScript==
// @name        网页浏览记录助手
// @namespace   https://github.com/moonjoin/tampermonkey-scripts
// @version     1.9.1
// @description  浏览记录自动存储 + AI 浏览行为分析 + 用户画像生成，支持坚果云增量云同步（和饺子AI网页摘要助手+Folo网站增强工具数据互通）
// @author       次元饺子
// @icon         https://img.icons8.com/?size=100&id=90385&format=png&color=000000
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * 0. 常量与配置
   ******************************************************************/
  const CONFIG_KEY = 'multi_push_config_v1';
  const HISTORY_KEY = 'browsing_history_v1';

  const DEFAULT_EXCLUDE_DOMAINS = [
    'chrome-extension://',
    'about:blank',
    'localhost',
    '127.0.0.1',
    'file://'
  ];
  const USER_PROFILE_TEMPLATE_ID = 'profile';
  const USER_PROFILE_SCHEMA = 'tabbit-user-profile-v1';

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
    common: {
      autoSendOnLoad: false,
      delayMs: 3000,
      cooldownMs: 5 * 60 * 1000,
      minDwellMs: 2000,
      includeTitle: true,
      includeUrl: true,
      includeTime: false,
    },
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
    },
    feishu: {
      enabled: false,
      webhookUrl: '',
      secret: '',
    },
    profiles: [clone(DEFAULT_PROFILE)],
    currentProfileId: 'default',
    history: {
      enabled: true,
      maxRecords: 50000,
      autoCleanDays: 180,
      excludeDomains: [...DEFAULT_EXCLUDE_DOMAINS],
      blacklistedUrls: [],
    },
    cloudSync: {
      account: '',
      appPassword: '',
      lastSyncAt: 0,
      lastSyncDirection: '',
      autoSyncHours: 4,
      autoSyncMinutes: 240,
    },
    userProfile: {
      autoUploadToCloud: true,
    },
    extractMaxChars: 16000,
    analysisTemplates: [],
    customAnalysisTemplates: [],
    legacyPushMigratedToOptional: true,
  };

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // 获取合并后的分析模板列表（默认 + 自定义）
  function getAllAnalysisTemplates() {
    const custom = cfg.analysisTemplates || [];
    const defaultIds = ANALYSIS_TEMPLATES.map(t => t.id);
    // 合并：自定义覆盖同ID默认模板，新模板追加
    const merged = [...ANALYSIS_TEMPLATES];
    custom.forEach(ct => {
      const idx = merged.findIndex(t => t.id === ct.id);
      if (idx >= 0) merged[idx] = ct; else merged.push(ct);
    });
    return merged;
  }

  function deepMerge(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(patch)) {
      const pv = patch[k];
      if (pv && typeof pv === 'object' && !Array.isArray(pv) && base && typeof base[k] === 'object') {
        out[k] = deepMerge(base[k], pv);
      } else {
        out[k] = pv;
      }
    }
    return out;
  }

  function loadConfig() {
    try {
      const raw = (typeof GM_getValue === 'function') ? GM_getValue(CONFIG_KEY, '') : '';
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged = deepMerge(DEFAULT_CONFIG, parsed);
        if (parsed.cloudSync && parsed.cloudSync.autoSyncMinutes === undefined && parsed.cloudSync.autoSyncHours !== undefined) {
          merged.cloudSync.autoSyncMinutes = Math.max(0, Math.round(Number(parsed.cloudSync.autoSyncHours || 0) * 60));
        }
        if (parsed.legacyPushMigratedToOptional !== true) {
          merged.common.autoSendOnLoad = false;
          merged.telegram.enabled = false;
          merged.feishu.enabled = false;
          merged.legacyPushMigratedToOptional = true;
          if (typeof GM_setValue === 'function') GM_setValue(CONFIG_KEY, JSON.stringify(merged));
        }
        return merged;
      }
    } catch (e) { toast('⚠️ 配置数据损坏，已恢复默认设置'); }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  function saveConfig(c) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(CONFIG_KEY, JSON.stringify(c));
    } catch (e) {}
  }

  let cfg = loadConfig();

  function loadHistory() {
    try {
      const raw = (typeof GM_getValue === 'function') ? GM_getValue(HISTORY_KEY, '') : '';
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.records)) return data;
      }
    } catch (e) {}
    return { records: [], lastReadAt: 0 };
  }

  function saveHistory(store) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(HISTORY_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  let historyStore = loadHistory();

  function historyRecordKey(url, ts) {
    return String(url || '') + '|' + Number(ts || 0);
  }

  /******************************************************************
   * 1. Markdown 渲染器
   ******************************************************************/
  const _md = (function () {
    function escapeHtml(str) {
      return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, '&#39;');
    }
    function renderInline(text) {
      let s = escapeHtml(text);
      s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px">');
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      s = s.replace(/\*\*([^\*]+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\*])\*([^\*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
      s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');
      s = s.replace(/~~([^~]+?)~~/g, '<s>$1</s>');
      return s;
    }
    function parseTableRow(line) {
      let s = line.trim();
      if (s.startsWith('|')) s = s.slice(1);
      if (s.endsWith('|')) s = s.slice(0, -1);
      const cells = []; let buf = '';
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue; }
        if (ch === '|') { cells.push(buf.trim()); buf = ''; continue; }
        buf += ch;
      }
      cells.push(buf.trim());
      return cells;
    }
    function isTableSeparator(line) {
      if (!/\|/.test(line)) return false;
      const cells = parseTableRow(line);
      return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c.trim()));
    }
    function parseAligns(sepLine) {
      return parseTableRow(sepLine).map(c => {
        const t = c.trim();
        const left = t.startsWith(':'), right = t.endsWith(':');
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
          headers.forEach((h, idx) => { const a = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''; t += `<th${a}>${renderInline(h)}</th>`; });
          t += '</tr></thead><tbody>';
          rows.forEach(r => { t += '<tr>'; for (let c = 0; c < headers.length; c++) { const cell = r[c] != null ? r[c] : ''; const a = aligns[c] ? ` style="text-align:${aligns[c]}"` : ''; t += `<td${a}>${renderInline(cell)}</td>`; } t += '</tr>'; });
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
          const m = ul || ol; const type = ul ? 'ul' : 'ol'; const indent = m[1].length; const content = m[2];
          while (listStack.length && listStack[listStack.length - 1].indent > indent) html += '</li></' + listStack.pop().type + '>';
          if (listStack.length && listStack[listStack.length - 1].indent === indent && listStack[listStack.length - 1].type !== type) html += '</li></' + listStack.pop().type + '>';
          if (!listStack.length || listStack[listStack.length - 1].indent < indent) { html += '<' + type + '><li>'; listStack.push({ type, indent }); }
          else html += '</li><li>';
          html += renderInline(content); i++; continue;
        }
        closeAllLists();
        let pBuf = [line]; i++;
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^(\s*)[-*+]\s+/.test(lines[i]) && !/^(\s*)\d+\.\s+/.test(lines[i])) {
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
  function makeId(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function escapeAttr(v) { return String(v ?? '').replace(/&/g, '&').replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>'); }
  function buildModelsUrl(apiUrl) {
    if (apiUrl.includes('/chat/completions')) return apiUrl.replace(/\/chat\/completions.*$/, '/models');
    if (apiUrl.endsWith('/')) return apiUrl + 'models';
    return apiUrl + '/v1/models';
  }
  function formatApiError(status, body) {
    let msg = `HTTP ${status}`;
    try { const data = JSON.parse(body); if (data?.error?.message) msg += `\n${data.error.message}`; else msg += `\n${body.substring(0, 200)}`; } catch (e) { msg += `\n${(body || '').substring(0, 200)}`; }
    return msg;
  }
  function extractDomain(url) { try { return new URL(url).hostname; } catch { return ''; } }
  function getDisplayPath(url) { try { const u = new URL(url); return u.hostname + u.pathname; } catch { return url.substring(0, 80); } }
  function cleanUrlForAI(url) { try { const u = new URL(url); return u.origin + u.pathname; } catch { return url.substring(0, 100); } }
  const FILTERED_KEYWORDS = ['reCAPTCHA', 'Content from', 'Twitter Embed', 'Sign In', '嵌入', 'Local Storage', 'Leader Iframe', 'header sync', 'Just a moment'];
  function shouldFilterTitle(title) { if (!title || title.trim() === '') return true; return FILTERED_KEYWORDS.some(kw => title.includes(kw)); }
  function el(tag, attrs, html) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    if (html != null) node.innerHTML = html;
    return node;
  }
  let toastTimer = null;
  function toast(msg, ms) {
    const t = document.getElementById(UI.toastId); if (!t) return;
    t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
  }
  function downloadText(text, filename) {
    try { const blob = new Blob([text], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); } catch (e) {}
  }
  function formatTime(ts) { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
  function formatDate(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function setByPath(obj, path, value) {
    const parts = path.split('.'); let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) { const k = parts[i]; if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
    cur[parts[parts.length - 1]] = value;
  }
  function getByPath(obj, path) {
    const parts = path.split('.'); let cur = obj;
    for (const k of parts) { if (!cur || typeof cur !== 'object') return undefined; cur = cur[k]; }
    return cur;
  }

  /******************************************************************
   * 3. AI 模块
   ******************************************************************/
  function normalizeModels(models) {
    if (!Array.isArray(models)) return [];
    return models.filter(m => m && m.value).map(m => ({
      name: String(m.name || m.value).trim(), value: String(m.value).trim(),
      temperature: m.temperature === '' || m.temperature == null ? '' : String(m.temperature),
      maxTokens: m.maxTokens === '' || m.maxTokens == null ? '' : String(m.maxTokens)
    }));
  }
  function normalizeProfiles(profiles) {
    if (!Array.isArray(profiles) || !profiles.length) return [clone(DEFAULT_PROFILE)];
    const result = [];
    profiles.forEach(p => {
      if (!p || typeof p !== 'object') return;
      const id = String(p.id || '').trim() || makeId('prof');
      const item = { id, name: String(p.name || '').trim() || '未命名配置', apiUrl: String(p.apiUrl || '').trim(), apiKey: String(p.apiKey || '').trim(), currentModel: String(p.currentModel || '').trim(), temperature: Number(p.temperature ?? 0.7), maxTokens: Number(p.maxTokens ?? 2000), models: normalizeModels(p.models) };
      if (!item.currentModel && item.models.length) item.currentModel = item.models[0].value;
      if (!result.some(x => x.id === id)) result.push(item);
    });
    if (!result.length) result.push(clone(DEFAULT_PROFILE));
    return result;
  }
  function getCurrentProfile() { return cfg.profiles.find(x => x.id === cfg.currentProfileId) || cfg.profiles[0]; }
  function setCurrentProfile(id) { if (!cfg.profiles.some(p => p.id === id)) return false; cfg.currentProfileId = id; saveConfig(cfg); return true; }
  function getCurrentModelConfig() { const p = getCurrentProfile(); return p.models.find(m => m.value === p.currentModel) || p.models[0] || {}; }
  function getCurrentModelDisplayName() { const m = getCurrentModelConfig(); return m?.name || m?.value || getCurrentProfile().currentModel || '未知模型'; }
  function getCurrentTemperature() { const p = getCurrentProfile(); const m = getCurrentModelConfig(); return Number((m?.temperature !== '' && m?.temperature != null ? m.temperature : p.temperature) || 0.7); }
  function getCurrentMaxTokens() { const p = getCurrentProfile(); const m = getCurrentModelConfig(); return Number((m?.maxTokens !== '' && m?.maxTokens != null ? m.maxTokens : p.maxTokens) || 2000); }
  function checkApiConfig() { const p = getCurrentProfile(); if (!p.apiUrl || !p.apiKey || !p.currentModel) { switchTab('settings'); toast('请先配置 API'); return false; } return true; }

  let currentRequest = null, currentReject = null;
  function callChatApi(messages, onDelta) {
    const profile = getCurrentProfile(); const useStream = typeof onDelta === 'function';
    const apiUrl = profile.apiUrl, apiKey = profile.apiKey;
    const body = { model: profile.currentModel, messages, temperature: getCurrentTemperature(), max_tokens: getCurrentMaxTokens() };
    return new Promise((resolve, reject) => {
      currentReject = reject;
      if (!useStream) {
        currentRequest = GM_xmlhttpRequest({ method: 'POST', url: apiUrl, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, data: JSON.stringify(body), timeout: 120000,
          onload(res) { currentRequest = null; currentReject = null; try { if (res.status < 200 || res.status >= 300) { reject(new Error(formatApiError(res.status, res.responseText))); return; } const data = JSON.parse(res.responseText); const content = data?.choices?.[0]?.message?.content; if (!content) { reject(new Error('API 响应格式异常')); return; } resolve(content); } catch (err) { reject(err); } },
          onerror(err) { currentRequest = null; currentReject = null; reject(new Error('网络请求失败')); },
          ontimeout() { currentRequest = null; currentReject = null; reject(new Error('API 请求超时')); }
        });
        return;
      }
      let fullText = '';
      const doFetchStream = async () => {
        const controller = new AbortController(); currentRequest = { abort: () => controller.abort() }; let buffer = '';
        const processLine = (line) => { line = line.replace(/\r$/, '').trim(); if (!line || line.startsWith(':') || !line.startsWith('data:')) return true; const payload = line.slice(5).trim(); if (payload === '[DONE]') return false; try { const obj = JSON.parse(payload); if (obj.error) throw new Error(obj.error.message || JSON.stringify(obj.error)); const delta = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content ?? ''; if (delta) { fullText += delta; try { onDelta(delta, fullText); } catch (e) {} } } catch (e) { if (e.message && e.message.indexOf('JSON') === -1) throw e; } return true; };
        try {
          const resp = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Accept': 'text/event-stream' }, body: JSON.stringify({ ...body, stream: true }), signal: controller.signal });
          if (!resp.ok) { const errText = await resp.text(); throw new Error(formatApiError(resp.status, errText)); }
          const reader = resp.body.getReader(); const decoder = new TextDecoder('utf-8'); let done = false;
          while (!done) { const { value, done: rDone } = await reader.read(); done = rDone; if (value) { buffer += decoder.decode(value, { stream: !done }); let idx; while ((idx = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1); if (!processLine(line)) { done = true; break; } } } }
          if (buffer.trim()) processLine(buffer);
          currentRequest = null; currentReject = null;
          if (fullText) resolve(fullText); else reject(new Error('流式响应为空'));
          return true;
        } catch (e) {
          if (e.name === 'AbortError') { currentRequest = null; currentReject = null; reject(new Error('已取消')); return true; }
          return { fallback: true, error: e };
        }
      };
      const doGMFallback = () => {
        let receivedLen = 0, buffer = '', aborted = false;
        const flushBuffer = () => { let idx; while ((idx = buffer.indexOf('\n')) !== -1) { let line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1); line = line.replace(/\r$/, '').trim(); if (!line || line.startsWith(':') || !line.startsWith('data:')) continue; const payload = line.slice(5).trim(); if (payload === '[DONE]') { aborted = true; return; } try { const obj = JSON.parse(payload); if (obj.error) { reject(new Error('API Error: ' + (obj.error.message || JSON.stringify(obj.error)))); aborted = true; return; } const delta = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content ?? ''; if (delta) { fullText += delta; try { onDelta(delta, fullText); } catch (e) {} } } catch (e) {} } };
        currentRequest = GM_xmlhttpRequest({ method: 'POST', url: apiUrl, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Accept': 'text/event-stream' }, data: JSON.stringify({ ...body, stream: true }), responseType: 'stream', timeout: 180000,
          onprogress: (e) => { if (aborted) return; const text = e.responseText || ''; if (text.length <= receivedLen) return; buffer += text.substring(receivedLen); receivedLen = text.length; flushBuffer(); },
          onload: (res) => { currentRequest = null; currentReject = null; if (aborted && fullText) { resolve(fullText); return; } const text = res.responseText || ''; if (text.length > receivedLen) { buffer += text.substring(receivedLen); receivedLen = text.length; flushBuffer(); } if (fullText) { resolve(fullText); return; } try { const data = JSON.parse(text); if (data.error) { reject(new Error('API Error: ' + data.error.message)); return; } const content = data?.choices?.[0]?.message?.content || ''; if (content) { try { onDelta(content, content); } catch (e) {} resolve(content); } else reject(new Error('流式响应为空')); } catch (e) { reject(new Error('流式解析失败')); } },
          onerror: () => { currentRequest = null; currentReject = null; reject(new Error('网络请求失败')); },
          ontimeout: () => { currentRequest = null; currentReject = null; reject(new Error('API 请求超时')); }
        });
      };
      doFetchStream().then(result => { if (result && result.fallback) doGMFallback(); });
    });
  }
  function abortCurrentRequest() { try { currentRequest?.abort?.(); } catch (e) {} if (currentReject) { try { currentReject(new Error('已取消')); } catch (e) {} } currentRequest = null; currentReject = null; }

  /******************************************************************
   * 4. 浏览记录存储
   ******************************************************************/
  function isUnread(record) { return record.ts > historyStore.lastReadAt; }
  function getUnreadCount() { return historyStore.records.filter(r => isUnread(r)).length; }
  function markAllAsRead() { historyStore.lastReadAt = Date.now(); saveHistory(historyStore); }
  function markRecordSyncDirty(record, at) {
    if (!record) return;
    record.syncUpdatedAt = Math.max(Number(record.syncUpdatedAt || 0), Number(at || Date.now()));
  }
  function isDomainExcluded(domain) { return (cfg.history?.excludeDomains || DEFAULT_EXCLUDE_DOMAINS).some(d => domain.includes(d)); }
  function normalizeUrlForBlock(url) {
    try { const u = new URL(url); u.hash = ''; return u.href; } catch { return String(url || '').trim(); }
  }
  function escapeRegExp(str) {
    return String(str || '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  function isUrlMatchingBlacklistRule(url, rule) {
    const target = normalizeUrlForBlock(url);
    const pattern = String(rule || '').trim();
    if (!target || !pattern) return false;
    if (pattern.includes('*')) {
      const re = new RegExp('^' + escapeRegExp(pattern).replace(/\*/g, '.*') + '$');
      return re.test(target);
    }
    return target === normalizeUrlForBlock(pattern);
  }
  function mergeBlacklistedUrls() {
    const out = [];
    Array.from(arguments).flat().forEach(url => {
      const normalized = normalizeUrlForBlock(url);
      if (normalized && !out.includes(normalized)) out.push(normalized);
    });
    return out.slice(-5000);
  }
  function getBlacklistedUrls() { return mergeBlacklistedUrls(cfg.history?.blacklistedUrls || []); }
  function setBlacklistedUrls(urls) {
    cfg.history = cfg.history || {};
    cfg.history.blacklistedUrls = mergeBlacklistedUrls(urls);
    cfg.history.blacklistUpdatedAt = Date.now();
    saveConfig(cfg);
  }
  function isUrlBlacklisted(url) { return getBlacklistedUrls().some(rule => isUrlMatchingBlacklistRule(url, rule)); }
  function pruneBlacklistedRecords() {
    if (!getBlacklistedUrls().length) return 0;
    const before = historyStore.records.length;
    historyStore.records = historyStore.records.filter(r => !isUrlBlacklisted(r.url));
    return before - historyStore.records.length;
  }
  function mergeDeletedHistoryRecords() {
    const map = new Map();
    Array.from(arguments).flat().forEach(item => {
      if (!item || !item.url || !item.ts) return;
      const deletedAt = Number(item.deletedAt || Date.now());
      const key = historyRecordKey(item.url, item.ts);
      const prev = map.get(key);
      if (!prev || deletedAt > Number(prev.deletedAt || 0)) {
        map.set(key, { url: item.url, ts: Number(item.ts), deletedAt });
      }
    });
    return Array.from(map.values()).sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0)).slice(0, 50000);
  }
  function getDeletedHistoryRecords() {
    return mergeDeletedHistoryRecords(historyStore.deletedRecords || []);
  }
  function setDeletedHistoryRecords(records) {
    historyStore.deletedRecords = mergeDeletedHistoryRecords(records);
  }
  function addDeletedHistoryRecords(records, deletedAt) {
    const tombstones = (records || []).map(r => ({ url: r.url, ts: r.ts, deletedAt: deletedAt || Date.now() }));
    setDeletedHistoryRecords(mergeDeletedHistoryRecords(getDeletedHistoryRecords(), tombstones));
    return tombstones.length;
  }
  function applyDeletedHistoryRecords() {
    const deleted = new Set(getDeletedHistoryRecords().map(d => historyRecordKey(d.url, d.ts)));
    if (!deleted.size) return 0;
    const before = historyStore.records.length;
    historyStore.records = historyStore.records.filter(r => !deleted.has(historyRecordKey(r.url, r.ts)));
    return before - historyStore.records.length;
  }

  function getRecordDwellSec(record) {
    return Math.max(0, Math.floor(Number(record?.dwellSec || 0)));
  }
  function formatDuration(sec) {
    sec = Math.max(0, Math.floor(Number(sec || 0)));
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return `${h}小时${m ? `${m}分` : ''}`;
    if (m > 0) return `${m}分${s && m < 10 ? `${s}秒` : ''}`;
    return `${s}秒`;
  }
  function isDwellActive() {
    return document.visibilityState !== 'hidden';
  }
  function shouldBindDwellRecord(url, ts) {
    return _dwellSession.url === url && Math.abs(Number(ts || 0) - Number(_dwellSession.ts || 0)) < 30000;
  }
  function bindDwellRecord(record, url, ts) {
    if (record && shouldBindDwellRecord(url, ts)) _dwellSession.record = record;
  }

  // ── 停留时间统计：事件驱动，按秒落库，不做高频定时写入 ──
  const _dwellSession = { url: '', title: '', ts: 0, activeSince: 0, pendingMs: 0, record: null };
  let _historySaveTimer = null;
  function saveHistoryDeferred() {
    if (_historySaveTimer) return;
    _historySaveTimer = setTimeout(() => {
      _historySaveTimer = null;
      saveHistory(historyStore);
    }, 1200);
  }
  function startDwellSession(url, title, ts) {
    finishDwellSession(true);
    _dwellSession.url = url;
    _dwellSession.title = title || '';
    _dwellSession.ts = ts || Date.now();
    _dwellSession.pendingMs = 0;
    _dwellSession.record = null;
    _dwellSession.activeSince = isDwellActive() ? Date.now() : 0;
  }
  function pauseDwellSession() {
    if (!_dwellSession.activeSince) return;
    const now = Date.now();
    if (now > _dwellSession.activeSince) _dwellSession.pendingMs += now - _dwellSession.activeSince;
    _dwellSession.activeSince = 0;
  }
  function resumeDwellSession() {
    if (!_dwellSession.url || _dwellSession.activeSince || !isDwellActive()) return;
    _dwellSession.activeSince = Date.now();
  }
  function findDwellRecord() {
    if (_dwellSession.record) return _dwellSession.record;
    const records = historyStore.records;
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.url === _dwellSession.url && Math.abs(Number(r.ts || 0) - _dwellSession.ts) < 30000) {
        _dwellSession.record = r;
        return r;
      }
    }
    return null;
  }
  function commitDwellSession(forceSave) {
    if (!_dwellSession.url) return;
    pauseDwellSession();
    const addSec = Math.floor(_dwellSession.pendingMs / 1000);
    if (addSec > 0) {
      const record = findDwellRecord();
      if (record) {
        record.dwellSec = getRecordDwellSec(record) + addSec;
        markRecordSyncDirty(record);
        _dwellSession.pendingMs -= addSec * 1000;
        if (forceSave) saveHistory(historyStore); else saveHistoryDeferred();
      }
    }
    resumeDwellSession();
  }
  function finishDwellSession(forceSave) {
    commitDwellSession(forceSave);
    _dwellSession.url = '';
    _dwellSession.title = '';
    _dwellSession.ts = 0;
    _dwellSession.activeSince = 0;
    _dwellSession.pendingMs = 0;
    _dwellSession.record = null;
  }

  // ── minDwellMs 待确认记录机制 ──
  const _pendingRecords = new Map(); // key: url, value: { timer, url, title, domain, ts }

  function addHistoryRecord(url, title, skipDwellCheck, visitTs) {
    if (!cfg.history?.enabled) return;
    if (isUrlBlacklisted(url)) return;
    const domain = extractDomain(url); if (isDomainExcluded(domain) || shouldFilterTitle(title)) return;
    const minDwell = Number(cfg.common?.minDwellMs || 0);
    const now = visitTs || Date.now(); const records = historyStore.records;

    // 冷却内同 URL 不重复记录（5分钟）
    const existing = records.find(r => r.url === url && (now - r.ts) < 5 * 60 * 1000);
    if (existing) { existing.lastVisit = now; existing.visits = (existing.visits || 1) + 1; markRecordSyncDirty(existing, now); bindDwellRecord(existing, url, now); saveHistory(historyStore); return; }

    // 如果需要停留检测且不是跳过检测的情况
    if (minDwell > 0 && !skipDwellCheck) {
      // 取消该 URL 之前的待确认计时器
      if (_pendingRecords.has(url)) {
        clearTimeout(_pendingRecords.get(url).timer);
      }
      const entry = { url, title: title || document.title || '', domain, ts: now };
      entry.timer = setTimeout(() => {
        _pendingRecords.delete(url);
        _confirmHistoryRecord(entry.url, entry.title, entry.domain, entry.ts);
      }, minDwell);
      _pendingRecords.set(url, entry);
      return;
    }

    _confirmRecordToStore(url, title || document.title || '', domain, now);
  }

  function _confirmHistoryRecord(url, title, domain, ts) {
    _confirmRecordToStore(url, title, domain, ts);
    // 记录确认后触发旧版推送（如果启用）
    triggerPendingPush(url, title);
  }

  function _confirmRecordToStore(url, title, domain, ts) {
    if (isUrlBlacklisted(url)) return;
    const records = historyStore.records;
    const existing = records.find(r => r.url === url && (ts - r.ts) < 5 * 60 * 1000);
    if (existing) { existing.lastVisit = ts; existing.visits = (existing.visits || 1) + 1; markRecordSyncDirty(existing, ts); bindDwellRecord(existing, url, ts); saveHistory(historyStore); return existing; }
    const record = { url, title, domain, ts, lastVisit: ts, visits: 1, syncUpdatedAt: Date.now() };
    records.push(record);
    bindDwellRecord(record, url, ts);
    enforceMaxRecords(); saveHistory(historyStore);
    return record;
  }

  // 移除页面离开前未达阈值的待确认记录
  function removePendingRecord(url) {
    if (_pendingRecords.has(url)) {
      clearTimeout(_pendingRecords.get(url).timer);
      _pendingRecords.delete(url);
    }
  }

  // 待确认记录的旧版推送触发
  async function triggerPendingPush(url, title) {
    cfg = loadConfig();
    if (!cfg.common.autoSendOnLoad) return;
    if (isUrlBlacklisted(url)) return;
    if (shouldFilterTitle(title)) return;
    const cooldownMs = Number(cfg.common.cooldownMs || 0);
    if (cooldownMs > 0 && isUrlInCooldown(url, cooldownMs)) return;
    if (!(cfg.telegram.enabled || cfg.feishu.enabled)) return;
    if ((cfg.telegram.enabled && (!cfg.telegram.botToken || !cfg.telegram.chatId)) || (cfg.feishu.enabled && !cfg.feishu.webhookUrl)) return;
    markUrlPushed(url);
    const tasks = []; if (cfg.telegram.enabled) tasks.push(sendToTelegram(title, url)); if (cfg.feishu.enabled) tasks.push(sendToFeishu(title, url));
    await Promise.allSettled(tasks);
  }
  function enforceMaxRecords() { const max = cfg.history?.maxRecords || 50000; if (historyStore.records.length > max) historyStore.records.splice(0, historyStore.records.length - max); }
  function cleanExpiredRecords() { const days = cfg.history?.autoCleanDays || 0; if (days <= 0) return; const cutoff = Date.now() - days * 24 * 60 * 60 * 1000; historyStore.records = historyStore.records.filter(r => r.ts >= cutoff); saveHistory(historyStore); }
  function getRecordsByTimeRange(start, end) { return historyStore.records.filter(r => r.ts >= start && r.ts < end); }
  function getTodayRecords() { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); return getRecordsByTimeRange(start, start + 86400000); }
  function getYesterdayRecords() { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime(); return getRecordsByTimeRange(start, start + 86400000); }
  function getRecentDaysRecords(days) { return getRecordsByTimeRange(Date.now() - days * 86400000, Date.now() + 1); }
  function getThisWeekRecords() { const now = new Date(); const day = now.getDay() || 7; const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1).getTime(); return getRecordsByTimeRange(start, start + 7 * 86400000); }
  function getThisMonthRecords() { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); return getRecordsByTimeRange(start, start + 32 * 86400000); }
  function prepareRecordsForAI(records) { return records.map(r => { const time = formatTime(r.ts); const visits = r.visits > 1 ? ` (×${r.visits})` : ''; const dwell = formatDuration(getRecordDwellSec(r)); const dwellText = dwell ? ` · 停留${dwell}` : ''; return `[${time}] ${r.domain} — ${r.title}${visits}${dwellText}`; }).join('\n'); }
  function exportRecordsAsJson() { downloadText(JSON.stringify({ ...historyStore, blacklistedUrls: getBlacklistedUrls() }, null, 2), `browsing-history-${formatDate(Date.now())}.json`); toast('已导出'); }
  function importRecordsFromJson() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const text = await file.text(); const data = JSON.parse(text);
        if (data && Array.isArray(data.records)) {
          const before = historyStore.records.length;
          historyStore.records = mergeHistoryRecords(historyStore.records, data.records);
          if (data.lastReadAt > historyStore.lastReadAt) historyStore.lastReadAt = data.lastReadAt;
          if (data.blacklistedUrls) setBlacklistedUrls(mergeBlacklistedUrls(getBlacklistedUrls(), data.blacklistedUrls));
          pruneBlacklistedRecords(); enforceMaxRecords(); saveHistory(historyStore);
          const added = historyStore.records.length - before;
          toast(`✅ 导入完成，新增 ${added} 条`);
          updateBadge(); if (historyTabEl) refreshHistoryTab();
        } else { alert('文件格式不正确，需要包含 records 数组的 JSON。'); }
      } catch (e) { alert('导入失败：' + e.message); }
    };
    input.click();
  }
  function clearAllRecords() {
    const deletedRecords = mergeDeletedHistoryRecords(getDeletedHistoryRecords(), historyStore.records.map(r => ({ url: r.url, ts: r.ts, deletedAt: Date.now() })));
    historyStore = { records: [], lastReadAt: 0, deletedRecords };
    saveHistory(historyStore);
  }
  function getDomainStats(records) {
    const map = {};
    records.forEach(r => { if (!map[r.domain]) map[r.domain] = { count: 0, visits: 0, dwellSec: 0 }; map[r.domain].count++; map[r.domain].visits += (r.visits || 1); map[r.domain].dwellSec += getRecordDwellSec(r); });
    return Object.entries(map).map(([domain, s]) => ({ domain, count: s.count, visits: s.visits, dwellSec: s.dwellSec })).sort((a, b) => (b.dwellSec - a.dwellSec) || (b.visits - a.visits));
  }
  function checkStorageQuota() {
    try {
      const histSize = JSON.stringify(historyStore).length;
      const cfgSize = JSON.stringify(cfg).length;
      const totalKB = Math.round((histSize + cfgSize) / 1024);
      if (totalKB > 4000) toast(`⚠️ 存储已用 ${totalKB}KB，接近上限(5MB)`, 4000);
    } catch (e) {}
  }

  /******************************************************************
   * 5. 旧版推送功能（可选）
   ******************************************************************/
  const recentUrls = new Map();
  function isUrlInCooldown(url, cooldownMs) { const t = recentUrls.get(url); return t ? (Date.now() - t) < (cooldownMs || 0) : false; }
  function markUrlPushed(url) { recentUrls.set(url, Date.now()); }
  function buildMessageText(title, url) { const parts = []; if (cfg.common.includeTitle) parts.push(`网页标题: ${title}`); if (cfg.common.includeUrl) parts.push(`网页链接: ${url}`); if (cfg.common.includeTime) parts.push(`时间: ${new Date().toLocaleString()}`); return parts.join('\n'); }
  function requestJson(url, body) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method: 'POST', url, data: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, onload: resolve, onerror: reject }); }); }
  async function sendToTelegram(title, url) {
    if (!cfg.telegram.enabled) return { skipped: true }; if (!cfg.telegram.botToken || !cfg.telegram.chatId) return { skipped: true };
    const resp = await requestJson(`https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`, { chat_id: cfg.telegram.chatId, text: buildMessageText(title, url) });
    return { ok: true, resp };
  }
  function arrayBufferToBase64(buffer) { const bytes = new Uint8Array(buffer); let binary = ''; for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]); return btoa(binary); }
  async function genFeishuSign(secret, timestampSec) {
    if (!window.crypto || !window.crypto.subtle) throw new Error('当前环境不支持 crypto.subtle');
    const enc = new TextEncoder(); const keyBytes = enc.encode(`${timestampSec}\n${secret}`); const msgBytes = enc.encode('');
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return arrayBufferToBase64(await crypto.subtle.sign('HMAC', key, msgBytes));
  }
  async function sendToFeishu(title, url) {
    if (!cfg.feishu.enabled) return { skipped: true }; if (!cfg.feishu.webhookUrl) return { skipped: true };
    const payload = { msg_type: 'text', content: { text: buildMessageText(title, url) } };
    const secret = String(cfg.feishu.secret || '').trim();
    if (secret) { const ts = Math.floor(Date.now() / 1000); payload.timestamp = ts; payload.sign = await genFeishuSign(secret, ts); }
    return { ok: true, resp: await requestJson(cfg.feishu.webhookUrl, payload) };
  }
  async function pushCurrentPage(opts) {
    opts = opts || {}; cfg = loadConfig();
    const url = window.location.href, title = document.title;
    if (shouldFilterTitle(title)) return;
    const cooldownMs = Number(cfg.common.cooldownMs || 0);
    if (!opts.force && cooldownMs > 0 && isUrlInCooldown(url, cooldownMs)) return;
    if (!(cfg.telegram.enabled || cfg.feishu.enabled)) { if (opts.showToast) toast('两个渠道都未启用'); return; }
    if ((cfg.telegram.enabled && (!cfg.telegram.botToken || !cfg.telegram.chatId)) || (cfg.feishu.enabled && !cfg.feishu.webhookUrl)) { if (opts.showToast) toast('请先在面板里补全推送配置'); return; }
    markUrlPushed(url);
    const tasks = []; if (cfg.telegram.enabled) tasks.push(sendToTelegram(title, url)); if (cfg.feishu.enabled) tasks.push(sendToFeishu(title, url));
    const results = await Promise.allSettled(tasks);
    if (opts.showToast) { const fail = results.filter(r => r.status === 'rejected'); toast(fail.length === 0 ? '✅ 推送成功' : `⚠️ 完成（失败 ${fail.length}）`); }
  }

  /******************************************************************
   * 6. AI 分析模块
   ******************************************************************/
  // 分析模板
  const ANALYSIS_TEMPLATES = [
    { id: 'summary', icon: '📊', name: '时段浏览总结', desc: '归纳一段时间看了什么',
      prompt: `你是用户的浏览行为分析师。以下是用户在「{timeRangeDesc}」的浏览记录数据（共 {count} 条，可能包含停留时长），请分析：

1. **关注主题**：归纳用户最近关注了哪些主题领域
2. **浏览模式**：什么时间段活跃？偏好什么类型的网站？哪些内容停留更久？
3. **高关注度内容**：哪些网站/主题被多次访问，说明特别感兴趣
4. **信息获取路径**：从域名分布看，用户的信息来源偏好
5. **总结与建议**：给出一段有价值的洞察` },
    { id: 'interest', icon: '🔍', name: '关注点分析', desc: '深度分析兴趣领域',
      prompt: `你是一位深度兴趣分析师。以下是用户在「{timeRangeDesc}」的浏览记录（共 {count} 条），请从知识结构角度深入分析：

1. **核心兴趣领域**：用户最关注的 2-3 个主题领域，每个领域举例具体看过的内容
2. **兴趣演变趋势**：从时间线看，用户的关注点是否有变化
3. **知识缺口**：基于用户浏览的领域，推测可能存在的知识盲区
4. **深度 vs 广度**：用户是广泛涉猎还是深耕某一领域
5. **学习路径建议**：基于用户兴趣，推荐下一步可以深入了解的方向` },
    { id: 'highlights', icon: '🎯', name: '高优内容提取', desc: '只看反复访问的内容',
      prompt: `你是一位内容策展专家。以下是用户的浏览记录（共 {count} 条），其中标注了重复访问次数。请重点关注被多次访问的内容：

1. **高价值内容清单**：列出被访问 2 次以上的网页，说明为什么可能反复查看
2. **核心关注主题**：从高频访问内容中提炼用户最在意的话题
3. **行动建议**：这些反复查看的内容可能意味着用户在做决策或深入研究，给出相关建议` },
    { id: 'free', icon: '💡', name: '自由提问', desc: '基于浏览记录自由对话',
      prompt: `你是一位智能助手。以下是用户最近的浏览记录（共 {count} 条），你可以基于这些数据回答用户的任何问题。请先简要总结浏览记录概况，然后等待用户提问。` },
    { id: 'profile', icon: '👤', name: '用户画像', desc: '生成结构化偏好画像文档',
      prompt: `你是用户的行为画像师。根据以下浏览记录，输出一份简洁的「用户偏好画像」。

要求：
- 只输出事实，不写分析过程、不写依据、不写建议
- 没有数据支撑的维度直接跳过，不要编造
- 判断"喜欢"的标准：访问次数多 + 停留时间长
- 只输出下面格式里的三个模块，不要增加阅读偏好、工具偏好、时间模式、信息来源等额外模块

输出格式：

# 用户偏好画像

## 兴趣领域
- 领域名（具体关注内容）

## 内容优先级
1. xxx
2. xxx

## 信息来源
- 主要渠道（按占比排序）

## 当前聚焦
- 近期集中关注的主题（无明显聚集则跳过）` }
  ];

  function buildAnalysisPrompt(records, timeRangeDesc, templateId) {
    const allTemplates = getAllAnalysisTemplates().filter(t => !t._deleted);
    const tpl = allTemplates.find(t => t.id === templateId) || allTemplates[0] || ANALYSIS_TEMPLATES[0];
    const lines = prepareRecordsForAI(records);
    const prompt = tpl.prompt
      .replace(/\{timeRangeDesc\}/g, timeRangeDesc)
      .replace(/\{count\}/g, records.length);
    return `${prompt}

以下是浏览记录：

${lines}`;
  }
  // ── 公共流式对话函数 ──
  async function streamChat(opts) {
    opts = opts || {};
    const streamingMsg = { role: 'assistant', content: '', meta: { model: getCurrentModelDisplayName(), streaming: true } };
    conversation.push(streamingMsg);
    renderConversation();
    const sendBtn = document.getElementById(UI.sendBtnId);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = opts.stopLabel || '⏹'; sendBtn.onclick = abortCurrentRequest; }
    let renderTimer = null;
    const scheduleRender = () => { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = null; renderConversation(); }, 60); };
    try {
      const finalText = await callChatApi(conversation.filter(m => !m.meta?.streaming).map(m => ({ role: m.role, content: m.content })), (delta, full) => { streamingMsg.content = full; scheduleRender(); });
      streamingMsg.content = finalText; streamingMsg.meta.streaming = false;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      renderConversation();
      if (opts.onSuccess) opts.onSuccess(finalText);
      return finalText;
    } catch (err) {
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      streamingMsg.content = streamingMsg.content ? `${streamingMsg.content}\n\n❌ ${err.message || err}` : `❌ ${err.message || err}`;
      streamingMsg.meta.streaming = false; renderConversation();
      if (opts.onError) opts.onError(err);
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送'; sendBtn.onclick = handleSendChat; }
    }
    return null;
  }

  async function runAnalysis(records, timeRangeDesc, templateId) {
    if (!checkApiConfig()) return;
    if (!records?.length) { toast('没有记录可分析'); return; }
    const effectiveTemplateId = templateId || USER_PROFILE_TEMPLATE_ID;
    conversation = [];
    conversation.push({ role: 'system', content: buildAnalysisPrompt(records, timeRangeDesc, effectiveTemplateId) });
    conversation.push({
      role: 'user',
      content: effectiveTemplateId === USER_PROFILE_TEMPLATE_ID
        ? `请基于以上 ${records.length} 条浏览记录，按指定格式输出用户偏好画像。`
        : `请分析以上 ${records.length} 条浏览记录，给出详细的分析报告。`,
      meta: { hidden: true }
    });
    renderConversation();
    const finalText = await streamChat({
      stopLabel: '⏹',
      onSuccess: () => { markAllAsRead(); updateBadge(); if (historyTabEl) refreshHistoryTab(); saveAnalysisHistory(); },
      onError: () => toast('分析失败')
    });
    if (finalText && effectiveTemplateId === USER_PROFILE_TEMPLATE_ID) {
      if (cfg.userProfile?.autoUploadToCloud === false) {
        toast('画像已生成；自动上传已关闭');
        return;
      }
      try {
        await uploadUserProfileMarkdown(finalText, { timeRangeDesc, recordCount: records.length });
      } catch (err) {
        toast('画像同步失败：' + (err.message || err));
      }
    }
  }
  async function handleSendChat() {
    if (!checkApiConfig()) return;
    const input = document.getElementById(UI.chatInputId); const text = (input?.value || '').trim(); if (!text) return;
    appendMessage('user', text); input.value = ''; input.style.height = 'auto';
    await streamChat({ stopLabel: '...', onSuccess: () => saveAnalysisHistory() });
  }
  // 分析结果持久化
  const ANALYSIS_HISTORY_KEY = 'mpush_analysis_history';
  function saveAnalysisHistory() {
    try {
      const visible = conversation.filter(m => m.role !== 'system' && !m.meta?.hidden && !m.meta?.streaming);
      if (visible.length && typeof GM_setValue === 'function') GM_setValue(ANALYSIS_HISTORY_KEY, JSON.stringify(visible.slice(-50)));
    } catch (e) {}
  }
  function loadAnalysisHistory() {
    try {
      const raw = (typeof GM_getValue === 'function') ? GM_getValue(ANALYSIS_HISTORY_KEY, '') : '';
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }
  function restoreAnalysisHistory() {
    const saved = loadAnalysisHistory();
    if (saved.length) { conversation = saved; renderConversation(); }
  }

  /******************************************************************
   * 7. 对话状态管理
   ******************************************************************/
  let conversation = [];
  function appendMessage(role, content, meta) { conversation.push({ role, content, meta: meta || {} }); renderConversation(); }
  function renderConversation() {
    const body = document.getElementById(UI.analysisBodyId); if (!body) return;
    const visibleMsgs = conversation.filter(m => m.role !== 'system' && !m.meta?.hidden);
    if (!visibleMsgs.length) { body.innerHTML = `<p class="mpush-placeholder">点击「✨ 分析未读」开始，或在下方输入框直接提问。</p>`; return; }
    body.innerHTML = visibleMsgs.map(m => {
      if (m.role === 'user') return `<div class="mpush-msg mpush-msg-user"><div class="mpush-msg-role">🙋 我</div><div class="mpush-msg-content">${_md(m.content)}</div></div>`;
      const cursor = m.meta?.streaming ? '<span class="mpush-cursor">▍</span>' : '';
      return `<div class="mpush-msg mpush-msg-assistant"><div class="mpush-msg-role">🤖 ${escapeAttr(m.meta?.model || 'AI')}${m.meta?.streaming ? ' · 输出中…' : ''}</div><div class="mpush-msg-content">${_md(m.content)}${cursor}</div></div>`;
    }).join('');
    body.scrollTop = body.scrollHeight;
  }

  /******************************************************************
   * 8. 云同步
   ******************************************************************/
  const JGY_BASE = 'https://dav.jianguoyun.com/dav/', JGY_SHARED_DIR = 'tabbit-shared/', JGY_PROFILES_FILE = 'ai-profiles.json', PROFILES_SCHEMA = 'tabbit-ai-profiles-v1', JGY_USER_PROFILE_FILE = 'user-profile.json', JGY_HISTORY_DIR = 'tabbit-history/', JGY_HISTORY_FILE = 'records.json';
  function jgyUrl(path) { return JGY_BASE + (path || ''); }
  function jgyAuthHeader() { const cs = cfg.cloudSync || {}; return 'Basic ' + btoa(unescape(encodeURIComponent(cs.account + ':' + cs.appPassword))); }
  function jgyRequest(method, url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method, url, headers: { Authorization: jgyAuthHeader(), ...(opts.headers || {}) }, timeout: opts.timeout || 30000,
        onload(res) { if (res.status >= 200 && res.status < 300) resolve(res); else if (res.status === 404 && opts.allow404) resolve(res); else if (res.status === 405 && opts.allow405) resolve(res); else reject(new Error(`坚果云返回 ${res.status}`)); },
        onerror() { reject(new Error('坚果云网络错误')); }, ontimeout() { reject(new Error('坚果云请求超时')); },
        ...(opts.data !== undefined ? { data: opts.data } : {})
      });
    });
  }
  async function jgyMkcolIfNeeded(dirPath) { try { await jgyRequest('MKCOL', jgyUrl(dirPath), { allow404: true, allow405: true }); } catch (e) { if (e.message?.includes('401')) throw e; } }
  async function jgyDownloadJson(filePath) { const res = await jgyRequest('GET', jgyUrl(filePath), { allow404: true }); if (res.status === 404) return null; try { return JSON.parse(res.responseText); } catch { return null; } }
  async function jgyUploadJson(filePath, payload) { await jgyRequest('PUT', jgyUrl(filePath), { headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(payload, null, 2) }); }
  async function jgyDeleteIfExists(filePath) { try { await jgyRequest('DELETE', jgyUrl(filePath), { allow404: true }); } catch (e) {} }
  function normalizeUserProfileMarkdown(markdown) {
    const text = String(markdown || '').trim();
    if (!text) return '';
    return text.replace(/\n{3,}/g, '\n\n');
  }
  async function uploadUserProfileMarkdown(markdown, meta) {
    const clean = normalizeUserProfileMarkdown(markdown);
    if (!clean) return false;
    if (!cfg.cloudSync?.account || !cfg.cloudSync?.appPassword) {
      toast('画像已生成；未配置坚果云，暂未同步');
      return false;
    }
    await jgyMkcolIfNeeded(JGY_SHARED_DIR);
    await jgyUploadJson(JGY_SHARED_DIR + JGY_USER_PROFILE_FILE, {
      version: 1,
      schema: USER_PROFILE_SCHEMA,
      updatedAt: Date.now(),
      source: 'browser-history',
      timeRangeDesc: meta?.timeRangeDesc || '',
      recordCount: Number(meta?.recordCount || 0),
      markdown: clean
    });
    toast('✅ 用户画像已同步');
    return true;
  }
  function extractSharedProfiles(payload) {
    if (!payload) return [];
    let list = [];
    if (Array.isArray(payload)) list = payload;
    else if (Array.isArray(payload.profiles)) list = payload.profiles;
    else if (Array.isArray(payload.data?.profiles)) list = payload.data.profiles;
    else if (payload.profile && typeof payload.profile === 'object') list = [payload.profile];
    else if (payload.apiUrl || payload.apiKey || payload.models) list = [payload];
    return Array.isArray(list) && list.length ? normalizeProfiles(list) : [];
  }
  function mergeProfiles(local, remote, prefer) {
    const map = new Map();
    const order = prefer === 'remote' ? [local, remote] : [remote, local];
    order.forEach(arr => (arr || []).forEach(p => map.set(p.id, p)));
    return Array.from(map.values());
  }
  function buildSharedProfilesPayload(profiles, currentProfileId, extra) {
    const normalized = normalizeProfiles(profiles);
    return {
      version: 1,
      schema: PROFILES_SCHEMA,
      updatedAt: Date.now(),
      profiles: normalized,
      currentProfileId: normalized.some(p => p.id === currentProfileId) ? currentProfileId : normalized[0]?.id || 'default',
      ...(extra || {})
    };
  }
  async function downloadProfilesFile() {
    return jgyDownloadJson(JGY_SHARED_DIR + JGY_PROFILES_FILE);
  }
  async function uploadProfilesFile(profiles, currentProfileId, extra) {
    await jgyMkcolIfNeeded(JGY_SHARED_DIR);
    await jgyUploadJson(JGY_SHARED_DIR + JGY_PROFILES_FILE, buildSharedProfilesPayload(profiles, currentProfileId, extra));
  }
  async function pullApiProfilesFromCloud() {
    const remote = await downloadProfilesFile();
    const remoteProfiles = extractSharedProfiles(remote);
    if (!remoteProfiles.length) return { hasProfiles: false, count: 0 };
    const merged = mergeProfiles(normalizeProfiles(cfg.profiles), remoteProfiles, 'remote');
    cfg.profiles = merged;
    if (remote?.currentProfileId && merged.some(p => p.id === remote.currentProfileId)) cfg.currentProfileId = remote.currentProfileId;
    else if (!merged.some(p => p.id === cfg.currentProfileId)) cfg.currentProfileId = merged[0].id;
    saveConfig(cfg);
    return { hasProfiles: true, count: merged.length };
  }
  async function pushCurrentApiProfileToCloud() {
    await jgyMkcolIfNeeded(JGY_SHARED_DIR);
    let remote = null; try { remote = await downloadProfilesFile(); } catch (e) {}
    const current = clone(getCurrentProfile());
    const remoteProfiles = extractSharedProfiles(remote);
    const cloudProfiles = remoteProfiles.length ? mergeProfiles([current], remoteProfiles, 'local') : normalizeProfiles([current]);
    await uploadProfilesFile(cloudProfiles, current.id);
    cfg.profiles = remoteProfiles.length ? mergeProfiles(normalizeProfiles(cfg.profiles), remoteProfiles, 'local') : normalizeProfiles(cfg.profiles);
    saveConfig(cfg);
    return { count: cloudProfiles.length };
  }
  async function jgyListChildNames(dirPath) {
    const body = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
    try {
      const res = await jgyRequest('PROPFIND', jgyUrl(dirPath), { headers: { Depth: '1', 'Content-Type': 'application/xml' }, data: body });
      const doc = new DOMParser().parseFromString(res.responseText || '', 'application/xml');
      const hrefNodes = [
        ...Array.from(doc.getElementsByTagName('d:href')),
        ...Array.from(doc.getElementsByTagName('href')),
        ...Array.from(doc.getElementsByTagNameNS('*', 'href'))
      ];
      const names = [];
      const selfName = (dirPath || '').split('/').filter(Boolean).pop() || '';
      hrefNodes.forEach(node => {
        const href = node.textContent || '';
        let name = (href.split('/').filter(Boolean).pop() || '').trim();
        try { name = decodeURIComponent(name); } catch (e) {}
        if (name && name !== selfName && !names.includes(name)) names.push(name);
      });
      return names;
    } catch (e) {
      return [];
    }
  }
  async function jgyListJsonFiles(dirPath) {
    return (await jgyListChildNames(dirPath)).filter(name => name.endsWith('.json'));
  }
  function mergeHistoryRecordFields(a, b) {
    const out = { ...a, ...b };
    out.title = b.title || a.title || '';
    out.domain = b.domain || a.domain || extractDomain(out.url);
    out.lastVisit = Math.max(Number(a.lastVisit || a.ts || 0), Number(b.lastVisit || b.ts || 0));
    out.visits = Math.max(Number(a.visits || 1), Number(b.visits || 1));
    out.dwellSec = Math.max(getRecordDwellSec(a), getRecordDwellSec(b));
    return out;
  }
  function mergeHistoryRecords(local, remote, deletedRecords) {
    const deleted = new Set(mergeDeletedHistoryRecords(deletedRecords || getDeletedHistoryRecords()).map(d => historyRecordKey(d.url, d.ts)));
    const map = new Map();
    [...(remote || []), ...(local || [])].forEach(r => {
      if (!r || !r.url || !r.ts) return;
      if (isUrlBlacklisted(r.url)) return;
      const key = historyRecordKey(r.url, r.ts);
      if (deleted.has(key)) return;
      map.set(key, map.has(key) ? mergeHistoryRecordFields(map.get(key), r) : r);
    });
    return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
  }
  function calcHistoryChecksum(records, blacklistedUrls) {
    const payload = JSON.stringify({
      records: (records || []).map(r => [r.url, r.ts, r.lastVisit || 0, r.visits || 1, getRecordDwellSec(r), r.title || '', r.domain || '']).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || a[1] - b[1]),
      blacklistedUrls: mergeBlacklistedUrls(blacklistedUrls || []).sort()
    });
    let hash = 2166136261;
    for (let i = 0; i < payload.length; i++) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }
  async function cloudPullAll() {
    const rp = await jgyDownloadJson(JGY_SHARED_DIR + JGY_PROFILES_FILE);
    const remoteProfiles = extractSharedProfiles(rp);
    if (remoteProfiles.length) { const m = mergeProfiles(normalizeProfiles(cfg.profiles), remoteProfiles, 'remote'); cfg.profiles = m; if (rp?.currentProfileId && m.some(p => p.id === rp.currentProfileId)) cfg.currentProfileId = rp.currentProfileId; else if (!m.some(p => p.id === cfg.currentProfileId)) cfg.currentProfileId = m[0].id; }
    const rh = await jgyDownloadJson(JGY_HISTORY_DIR + JGY_HISTORY_FILE);
    if (rh?.blacklistedUrls) setBlacklistedUrls(mergeBlacklistedUrls(getBlacklistedUrls(), rh.blacklistedUrls));
    if (rh?.deletedRecords) setDeletedHistoryRecords(mergeDeletedHistoryRecords(getDeletedHistoryRecords(), rh.deletedRecords));
    if (rh?.records) { historyStore.records = mergeHistoryRecords(historyStore.records, rh.records); if (rh.lastReadAt > historyStore.lastReadAt) historyStore.lastReadAt = rh.lastReadAt; pruneBlacklistedRecords(); applyDeletedHistoryRecords(); }
    cfg.cloudSync.lastSyncAt = Date.now(); cfg.cloudSync.lastSyncDirection = 'pull'; saveConfig(cfg); saveHistory(historyStore);
  }
  async function cloudPushAll() {
    await jgyMkcolIfNeeded(JGY_SHARED_DIR); let rp = null; try { rp = await jgyDownloadJson(JGY_SHARED_DIR + JGY_PROFILES_FILE); } catch (e) {}
    let mp = normalizeProfiles(cfg.profiles); const remoteProfiles = extractSharedProfiles(rp); if (remoteProfiles.length) mp = mergeProfiles(mp, remoteProfiles, 'local');
    await uploadProfilesFile(mp, cfg.currentProfileId); cfg.profiles = mp;
    await jgyMkcolIfNeeded(JGY_HISTORY_DIR); let rh = null; try { rh = await jgyDownloadJson(JGY_HISTORY_DIR + JGY_HISTORY_FILE); } catch (e) {}
    if (rh?.blacklistedUrls) setBlacklistedUrls(mergeBlacklistedUrls(getBlacklistedUrls(), rh.blacklistedUrls));
    if (rh?.deletedRecords) setDeletedHistoryRecords(mergeDeletedHistoryRecords(getDeletedHistoryRecords(), rh.deletedRecords));
    let mh = historyStore.records; if (rh?.records) mh = mergeHistoryRecords(mh, rh.records); historyStore.records = mh; pruneBlacklistedRecords(); applyDeletedHistoryRecords(); mh = historyStore.records;
    await jgyUploadJson(JGY_HISTORY_DIR + JGY_HISTORY_FILE, { version: 2, updatedAt: Date.now(), records: mh, lastReadAt: historyStore.lastReadAt, blacklistedUrls: getBlacklistedUrls(), deletedRecords: getDeletedHistoryRecords(), checksum: calcHistoryChecksum(mh, getBlacklistedUrls()) });
    cfg.cloudSync.lastSyncAt = Date.now(); cfg.cloudSync.lastSyncDirection = 'push'; saveConfig(cfg); saveHistory(historyStore);
  }
  async function cloudForcePushAll() {
    await jgyMkcolIfNeeded(JGY_SHARED_DIR); await jgyMkcolIfNeeded(JGY_HISTORY_DIR);
    await uploadProfilesFile(cfg.profiles, cfg.currentProfileId, { forcePush: true });
    pruneBlacklistedRecords();
    await jgyUploadJson(JGY_HISTORY_DIR + JGY_HISTORY_FILE, { version: 2, updatedAt: Date.now(), forcePush: true, records: historyStore.records, lastReadAt: historyStore.lastReadAt, blacklistedUrls: getBlacklistedUrls(), deletedRecords: getDeletedHistoryRecords(), checksum: calcHistoryChecksum(historyStore.records, getBlacklistedUrls()) });
    cfg.cloudSync.lastSyncAt = Date.now(); cfg.cloudSync.lastSyncDirection = 'force-push'; saveConfig(cfg); saveHistory(historyStore);
  }

  /******************************************************************
   * 8.1 历史记录对账同步（独立通道）
   ******************************************************************/
  const JGY_HISTORY_SYNC_DIR = 'tabbit-history-sync/';
  const JGY_HISTORY_SYNC_META = 'meta.json';
  const JGY_HISTORY_SYNC_BATCHES = 'batches/';
  const JGY_HISTORY_SYNC_CLIENTS = 'clients/';
  const AUTO_SYNC_BASELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  function loadHistorySyncMeta() {
    try {
      const raw = (typeof GM_getValue === 'function') ? GM_getValue('history_sync_meta', '') : '';
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { lastSyncAt: 0, lastBatchId: '', lastRecordTs: 0, syncedCount: 0 };
  }
  function saveHistorySyncMeta(meta) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue('history_sync_meta', JSON.stringify(meta));
    } catch (e) {}
  }
  function getHistorySyncClientId() {
    try {
      const key = 'history_sync_client_id';
      let id = (typeof GM_getValue === 'function') ? GM_getValue(key, '') : '';
      if (!id) {
        id = makeId('client');
        if (typeof GM_setValue === 'function') GM_setValue(key, id);
      }
      return id;
    } catch (e) {
      return 'client_' + Math.random().toString(36).slice(2, 10);
    }
  }

  function getLatestHistoryRecordTs(records) {
    return (records || []).length ? Math.max(...records.map(r => Number(r.ts || 0))) : 0;
  }

  function getRecordSyncUpdatedAt(record) {
    return Number(record?.syncUpdatedAt || record?.lastVisit || record?.ts || 0);
  }

  function getLatestRecordSyncUpdatedAt(records) {
    return (records || []).length ? Math.max(...records.map(getRecordSyncUpdatedAt)) : 0;
  }

  function formatSyncBatchDay(ts) {
    const d = new Date(ts || Date.now());
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async function listHistorySyncBatchFiles() {
    const entries = await jgyListChildNames(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES);
    const files = entries
      .filter(name => name.endsWith('.json'))
      .map(name => ({ name, path: JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES + name }));
    const dirs = entries.filter(name => !name.endsWith('.json'));
    for (const dir of dirs) {
      const childFiles = await jgyListJsonFiles(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES + dir + '/');
      childFiles.forEach(name => files.push({ name: `${dir}/${name}`, path: JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES + dir + '/' + name }));
    }
    return files;
  }

  function getHistorySyncSnapshot(records, blacklistedUrls) {
    const list = records || historyStore.records;
    const blocked = blacklistedUrls || getBlacklistedUrls();
    return {
      syncedCount: list.length,
      recordCount: list.length,
      lastRecordTs: getLatestHistoryRecordTs(list),
      lastReadAt: historyStore.lastReadAt || 0,
      blacklistedCount: blocked.length,
      checksum: calcHistoryChecksum(list, blocked)
    };
  }

  function sameHistorySyncSnapshot(a, b) {
    if (!a || !b || !a.checksum || !b.checksum) return false;
    const bCount = Number(b.syncedCount ?? b.recordCount ?? b.count ?? 0);
    const bLastTs = Number(b.lastRecordTs ?? b.latestRecordTs ?? 0);
    return a.checksum === b.checksum
      && Number(a.syncedCount || 0) === bCount
      && Number(a.lastRecordTs || 0) === bLastTs
      && Number(a.lastReadAt || 0) === Number(b.lastReadAt || 0);
  }

  async function historySyncAutoUploadDelta() {
    const now = Date.now();
    const clientId = getHistorySyncClientId();
    const localMeta = loadHistorySyncMeta();
    const baselineAt = Number(localMeta.lastAutoUploadRecordUpdatedAt || localMeta.lastSyncAt || 0);
    const lastReadBaseline = Number(localMeta.lastAutoUploadLastReadAt ?? localMeta.lastReadAt ?? 0);
    const blacklistBaseline = Number(localMeta.lastAutoUploadBlacklistAt || 0);

    if (!baselineAt && !localMeta.checksum) {
      const latestUpdatedAt = getLatestRecordSyncUpdatedAt(historyStore.records);
      saveHistorySyncMeta({
        ...localMeta,
        lastAutoUploadRecordUpdatedAt: Math.max(0, latestUpdatedAt - AUTO_SYNC_BASELINE_WINDOW_MS),
        lastAutoUploadLastReadAt: historyStore.lastReadAt || 0,
        lastAutoUploadBlacklistAt: Number(cfg.history?.blacklistUpdatedAt || 0),
        lastSyncAt: now,
        lastCheckedAt: now,
        lastDirection: 'auto-baseline',
        skipped: true
      });
      cfg.cloudSync.lastSyncAt = now;
      cfg.cloudSync.lastSyncDirection = 'auto-baseline';
      saveConfig(cfg);
      return { skipped: true, baseline: true, finalCount: historyStore.records.length };
    }

    const changedRecords = historyStore.records.filter(r => getRecordSyncUpdatedAt(r) > baselineAt);
    const changedDeletedRecords = getDeletedHistoryRecords().filter(r => Number(r.deletedAt || 0) > baselineAt);
    const lastReadChanged = Number(historyStore.lastReadAt || 0) > lastReadBaseline;
    const blacklistChanged = Number(cfg.history?.blacklistUpdatedAt || 0) > blacklistBaseline;
    if (!changedRecords.length && !changedDeletedRecords.length && !lastReadChanged && !blacklistChanged) {
      saveHistorySyncMeta({ ...localMeta, lastSyncAt: now, lastCheckedAt: now, lastDirection: 'auto-delta-check', skipped: true });
      cfg.cloudSync.lastSyncAt = now;
      cfg.cloudSync.lastSyncDirection = 'auto-delta-check';
      saveConfig(cfg);
      return { skipped: true, finalCount: historyStore.records.length };
    }

    await jgyMkcolIfNeeded(JGY_HISTORY_DIR);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS);
    const dayDir = formatSyncBatchDay(now) + '/';
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES + dayDir);

    const lastRecordUpdatedAt = Math.max(
      baselineAt,
      changedRecords.length ? Math.max(...changedRecords.map(getRecordSyncUpdatedAt)) : 0,
      changedDeletedRecords.length ? Math.max(...changedDeletedRecords.map(r => Number(r.deletedAt || 0))) : 0
    );
    const batchId = `${clientId}-${now}-${makeId('delta')}`;
    const payload = {
      version: 3,
      mode: 'delta',
      batchId,
      clientId,
      createdAt: now,
      baseRecordUpdatedAt: baselineAt,
      records: changedRecords,
      deletedRecords: changedDeletedRecords,
      recordCount: changedRecords.length,
      deletedCount: changedDeletedRecords.length,
      lastRecordUpdatedAt,
      latestRecordTs: getLatestHistoryRecordTs(changedRecords),
      ...(lastReadChanged ? { lastReadAt: historyStore.lastReadAt } : {}),
      ...(blacklistChanged ? { blacklistedUrls: getBlacklistedUrls() } : {})
    };
    await jgyUploadJson(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES + dayDir + batchId + '.json', payload);
    await jgyUploadJson(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS + clientId + '.json', {
      version: 3,
      clientId,
      updatedAt: now,
      mode: 'auto-delta',
      lastBatchId: batchId,
      uploadedRecordCount: changedRecords.length,
      uploadedDeleteCount: changedDeletedRecords.length,
      localRecordCount: historyStore.records.length,
      latestRecordTs: getLatestHistoryRecordTs(historyStore.records),
      lastRecordUpdatedAt,
      lastReadAt: historyStore.lastReadAt || 0,
      blacklistedCount: getBlacklistedUrls().length
    });

    saveHistorySyncMeta({
      ...localMeta,
      lastSyncAt: now,
      lastCheckedAt: now,
      lastBatchId: batchId,
      lastDirection: 'auto-delta',
      lastAutoUploadAt: now,
      lastAutoUploadRecordUpdatedAt: Math.max(baselineAt, lastRecordUpdatedAt),
      lastAutoUploadLastReadAt: historyStore.lastReadAt || 0,
      lastAutoUploadBlacklistAt: Number(cfg.history?.blacklistUpdatedAt || 0),
      syncedCount: historyStore.records.length,
      recordCount: historyStore.records.length
    });
    cfg.cloudSync.lastSyncAt = now;
    cfg.cloudSync.lastSyncDirection = 'auto-delta';
    saveConfig(cfg);
    return { skipped: false, uploaded: changedRecords.length, finalCount: historyStore.records.length, batchId };
  }

  async function historySyncReconcile() {
    const now = Date.now();
    const localBefore = historyStore.records.length;
    const clientId = getHistorySyncClientId();

    await jgyMkcolIfNeeded(JGY_HISTORY_DIR);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_BATCHES);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS);

    let remoteRecords = [];
    let remoteLastReadAt = 0;
    let remoteBlockedUrls = [];
    let remoteDeletedRecords = [];

    const remoteFull = await jgyDownloadJson(JGY_HISTORY_DIR + JGY_HISTORY_FILE);
    if (remoteFull?.records) remoteRecords.push(...remoteFull.records);
    if (remoteFull?.lastReadAt) remoteLastReadAt = Math.max(remoteLastReadAt, remoteFull.lastReadAt);
    remoteBlockedUrls = mergeBlacklistedUrls(remoteBlockedUrls, remoteFull?.blacklistedUrls || []);
    remoteDeletedRecords = mergeDeletedHistoryRecords(remoteDeletedRecords, remoteFull?.deletedRecords || []);

    const remoteMeta = await jgyDownloadJson(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_META);
    if (remoteMeta?.lastReadAt) remoteLastReadAt = Math.max(remoteLastReadAt, remoteMeta.lastReadAt);
    remoteBlockedUrls = mergeBlacklistedUrls(remoteBlockedUrls, remoteMeta?.blacklistedUrls || []);
    remoteDeletedRecords = mergeDeletedHistoryRecords(remoteDeletedRecords, remoteMeta?.deletedRecords || []);

    const batchFiles = await listHistorySyncBatchFiles();
    for (const item of batchFiles) {
      const batchData = await jgyDownloadJson(item.path);
      if (batchData?.records) remoteRecords.push(...batchData.records);
      if (batchData?.lastReadAt) remoteLastReadAt = Math.max(remoteLastReadAt, batchData.lastReadAt);
      remoteBlockedUrls = mergeBlacklistedUrls(remoteBlockedUrls, batchData?.blacklistedUrls || []);
      remoteDeletedRecords = mergeDeletedHistoryRecords(remoteDeletedRecords, batchData?.deletedRecords || []);
    }

    const clientFiles = await jgyListJsonFiles(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS);

    setBlacklistedUrls(mergeBlacklistedUrls(getBlacklistedUrls(), remoteBlockedUrls));
    const deletedRecords = mergeDeletedHistoryRecords(getDeletedHistoryRecords(), remoteDeletedRecords);
    setDeletedHistoryRecords(deletedRecords);
    historyStore.records = mergeHistoryRecords(historyStore.records, remoteRecords, deletedRecords);
    if (remoteLastReadAt > historyStore.lastReadAt) historyStore.lastReadAt = remoteLastReadAt;
    pruneBlacklistedRecords();
    enforceMaxRecords();
    applyDeletedHistoryRecords();

    const blacklistedUrls = getBlacklistedUrls();
    const finalDeletedRecords = getDeletedHistoryRecords();
    const snapshot = getHistorySyncSnapshot(historyStore.records, blacklistedUrls);
    const latestRecordTs = snapshot.lastRecordTs;
    const checksum = snapshot.checksum;
    const payload = {
      version: 2,
      updatedAt: now,
      records: historyStore.records,
      lastReadAt: historyStore.lastReadAt,
      blacklistedUrls,
      deletedRecords: finalDeletedRecords,
      count: historyStore.records.length,
      deletedCount: finalDeletedRecords.length,
      checksum
    };

    await jgyUploadJson(JGY_HISTORY_DIR + JGY_HISTORY_FILE, payload);
    await jgyUploadJson(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS + clientId + '.json', {
      version: 2,
      clientId,
      updatedAt: now,
      summaryOnly: true,
      recordCount: historyStore.records.length,
      latestRecordTs,
      lastReadAt: historyStore.lastReadAt,
      blacklistedCount: blacklistedUrls.length,
      checksum
    });

    await jgyUploadJson(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_META, {
      lastSyncAt: now,
      lastBatchId: remoteMeta?.lastBatchId || '',
      lastRecordTs: latestRecordTs,
      syncedCount: historyStore.records.length,
      lastReadAt: historyStore.lastReadAt,
      pendingBatches: [],
      blacklistedUrls,
      deletedCount: finalDeletedRecords.length,
      checksum,
      reconcile: true,
      mode: 'full-reconcile-with-delta-batches',
      clientId,
      clientCount: clientFiles.length + (clientFiles.includes(clientId + '.json') ? 0 : 1)
    });

    saveHistorySyncMeta({
      lastSyncAt: now,
      lastBatchId: clientId,
      lastRecordTs: latestRecordTs,
      syncedCount: snapshot.syncedCount,
      recordCount: snapshot.recordCount,
      lastReadAt: snapshot.lastReadAt,
      lastReconcileAt: now,
      lastAutoUploadRecordUpdatedAt: getLatestRecordSyncUpdatedAt(historyStore.records),
      lastAutoUploadLastReadAt: historyStore.lastReadAt || 0,
      lastAutoUploadBlacklistAt: Number(cfg.history?.blacklistUpdatedAt || 0),
      checksum
    });
    saveHistory(historyStore);
    cfg.cloudSync.lastSyncAt = now;
    cfg.cloudSync.lastSyncDirection = 'reconcile';
    saveConfig(cfg);
    await Promise.allSettled(batchFiles.map(item => jgyDeleteIfExists(item.path)));

    return {
      localBefore,
      pulled: Math.max(0, historyStore.records.length - localBefore),
      pushed: Math.max(0, historyStore.records.length - remoteRecords.length),
      remoteSeen: remoteRecords.length,
      batchFiles: batchFiles.length,
      clientFiles: clientFiles.length,
      finalCount: historyStore.records.length,
      blacklistedCount: blacklistedUrls.length,
      checksum
    };
  }

  // 手动入口保留“对账同步”语义：读取云端全量和增量批次后合并。
  async function historySyncIncremental() {
    return historySyncReconcile();
  }

  function getAutoSyncIntervalMs() {
    const minutes = Number(cfg.cloudSync?.autoSyncMinutes ?? 0);
    if (minutes <= 0) return 0;
    return Math.max(60 * 1000, minutes * 60 * 1000);
  }

  // 强制覆盖：本地全量覆盖远端
  async function historySyncForcePush() {
    const now = Date.now();
    const clientId = getHistorySyncClientId();

    await jgyMkcolIfNeeded(JGY_HISTORY_DIR);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR);
    await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS);
    pruneBlacklistedRecords();
    const blacklistedUrls = getBlacklistedUrls();
    const checksum = calcHistoryChecksum(historyStore.records, blacklistedUrls);

    await jgyUploadJson(JGY_HISTORY_DIR + JGY_HISTORY_FILE, {
      version: 2,
      updatedAt: now,
      records: historyStore.records,
      lastReadAt: historyStore.lastReadAt,
      blacklistedUrls,
      count: historyStore.records.length,
      checksum,
      forcePush: true
    });
    await jgyUploadJson(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS + clientId + '.json', {
      version: 2,
      updatedAt: now,
      clientId,
      summaryOnly: true,
      recordCount: historyStore.records.length,
      latestRecordTs: historyStore.records.length ? Math.max(...historyStore.records.map(r => r.ts)) : 0,
      lastReadAt: historyStore.lastReadAt,
      blacklistedCount: blacklistedUrls.length,
      checksum,
      forcePush: true
    });

    // 更新远端 meta（强制覆盖后不再新建全量 batch）
    const latestRecordTs = historyStore.records.length ? Math.max(...historyStore.records.map(r => r.ts)) : 0;
    await jgyUploadJson(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_META, {
      lastSyncAt: now,
      lastBatchId: '',
      lastRecordTs: latestRecordTs,
      syncedCount: historyStore.records.length,
      lastReadAt: historyStore.lastReadAt,
      blacklistedUrls,
      checksum,
      pendingBatches: [],
      mode: 'single-full-with-client-summaries',
      clientId,
      forcePush: true
    });

    // 更新本地 sync meta
    const snapshot = getHistorySyncSnapshot(historyStore.records, blacklistedUrls);
    saveHistorySyncMeta({
      lastSyncAt: now,
      lastBatchId: clientId,
      lastRecordTs: latestRecordTs,
      syncedCount: snapshot.syncedCount,
      recordCount: snapshot.recordCount,
      lastReadAt: snapshot.lastReadAt,
      lastReconcileAt: now,
      lastAutoUploadRecordUpdatedAt: getLatestRecordSyncUpdatedAt(historyStore.records),
      lastAutoUploadLastReadAt: historyStore.lastReadAt || 0,
      lastAutoUploadBlacklistAt: Number(cfg.history?.blacklistUpdatedAt || 0),
      checksum
    });

    cfg.cloudSync.lastSyncAt = now;
    cfg.cloudSync.lastSyncDirection = 'force-push';
    saveConfig(cfg);
    saveHistory(historyStore);
  }

  /******************************************************************
   * 9. UI 常量与样式
   ******************************************************************/
  function addStyle(css) { if (typeof GM_addStyle === 'function') return GM_addStyle(css); const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style); }
  const UI = { rootId: 'mpush-root', btnId: 'mpush-float-btn', panelId: 'mpush-panel', toastId: 'mpush-toast', chatInputId: 'mpush-chat-input', sendBtnId: 'mpush-send-btn', analysisBodyId: 'mpush-analysis-body', badgeId: 'mpush-badge', contextMenuId: 'mpush-context-menu' };
  let historyTabEl = null;

  addStyle(`
    #${UI.btnId} { position:fixed; right:16px; bottom:16px; width:44px; height:44px; border-radius:22px; border:none; cursor:pointer; z-index:2147483647; background:linear-gradient(135deg,#8b5cf6,#3b82f6); color:#fff; font-size:18px; box-shadow:0 4px 16px rgba(0,0,0,.25); backdrop-filter:blur(6px); transition:transform .15s; user-select:none; -webkit-user-select:none; }
    #${UI.btnId}:hover { transform:scale(1.08); }
    #${UI.btnId}.dragging { transition:none!important; transform:scale(1.08); }
    #${UI.badgeId} { position:absolute; top:-4px; right:-4px; min-width:18px; height:18px; border-radius:9px; background:#ef4444; color:#fff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; padding:0 4px; pointer-events:none; }
    #${UI.badgeId}:empty { display:none; }
    #${UI.contextMenuId} { position:fixed; z-index:2147483647; width:230px; padding:8px; border:1px solid rgba(124,58,237,.18); border-radius:10px; background:#fff; color:#222; box-shadow:0 16px 42px rgba(0,0,0,.22); font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; display:none; }
    #${UI.contextMenuId}.show { display:block; }
    .mpush-context-title { padding:4px 6px 8px; font-size:12px; font-weight:700; color:#5a43c8; border-bottom:1px solid #f0f0f0; margin-bottom:6px; }
    .mpush-context-action { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 10px; border:none; border-radius:8px; background:#f5f5f7; color:#333; cursor:pointer; font-size:12px; font-weight:600; text-align:left; }
    .mpush-context-action:hover { background:#ede9fe; color:#5a43c8; }
    .mpush-context-action:disabled { opacity:.55; cursor:not-allowed; }
    .mpush-context-status { margin-top:8px; padding:8px 6px 2px; border-top:1px solid #f0f0f0; color:#777; font-size:11px; line-height:1.5; word-break:break-word; }
    .mpush-context-status.ok { color:#15803d; }
    .mpush-context-status.error { color:#b91c1c; }
    #${UI.panelId} { position:fixed; right:16px; bottom:70px; width:420px; max-width:calc(100vw - 32px); height:80vh; max-height:calc(100vh - 100px); min-height:400px; z-index:2147483647; background:#fff; color:#222; border:none; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.25); display:none; flex-direction:column; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; overflow:hidden; }
    #${UI.panelId}.show { display:flex; }
    .mpush-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:linear-gradient(135deg,#8b5cf6,#3b82f6); color:#fff; cursor:move; flex-shrink:0; }
    .mpush-panel-title { font-weight:700; font-size:14px; }
    .mpush-panel-actions { display:flex; gap:6px; }
    .mpush-icon-btn { background:rgba(255,255,255,.18); color:#fff; border:none; width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:14px; }
    .mpush-icon-btn:hover { background:rgba(255,255,255,.32); }
    .mpush-tabs { display:flex; border-bottom:1px solid #eee; flex-shrink:0; background:#fafafa; }
    .mpush-tab { flex:1; padding:10px 0; text-align:center; font-size:12px; font-weight:600; cursor:pointer; border:none; background:none; color:#888; border-bottom:2px solid transparent; transition:all .2s; }
    .mpush-tab:hover { color:#333; }
    .mpush-tab.active { color:#7c3aed; border-bottom-color:#7c3aed; }
    .mpush-tab-content { flex:1; overflow-y:auto; min-height:0; padding:12px 14px; }
    .mpush-tab-pane { display:none; flex-direction:column; }
    .mpush-tab-pane.active { display:flex; flex:1; min-height:0; overflow-y:auto; }
    .mpush-placeholder { color:#888; font-size:13px; text-align:center; padding:40px 0; }
    .mpush-field { margin-bottom:10px; }
    .mpush-field-label { font-size:12px; font-weight:600; color:#555; margin-bottom:4px; }
    .mpush-field input[type="text"],.mpush-field input[type="password"],.mpush-field input[type="number"],.mpush-field textarea,.mpush-field select { width:100%; padding:8px 10px; border-radius:8px; border:1px solid #ddd; background:#fafafa; color:#222; font-size:12px; font-family:inherit; outline:none; box-sizing:border-box; }
    .mpush-field textarea { min-height:80px; resize:vertical; }
    .mpush-field input:focus,.mpush-field textarea:focus,.mpush-field select:focus { border-color:#8b5cf6; }
    .mpush-field small { display:block; color:#999; font-size:11px; margin-top:3px; }
    .mpush-field-inline { display:flex; align-items:center; gap:8px; }
    .mpush-field-inline input[type="checkbox"] { transform:translateY(1px); }
    .mpush-field-inline span { font-size:12px; color:#333; }
    .mpush-row-2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .mpush-btn { padding:8px 14px; border-radius:8px; border:1px solid #e5e5ea; background:#f5f5f7; color:#333; cursor:pointer; font-size:12px; font-weight:500; }
    .mpush-btn:hover { background:#ececf0; }
    .mpush-btn.primary { background:linear-gradient(135deg,#8b5cf6,#3b82f6); color:#fff; border:none; }
    .mpush-btn.danger { background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; }
    .mpush-btn:disabled { opacity:.5; cursor:not-allowed; }
    .mpush-btns { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    /* ── 折叠面板 ── */
    .mpush-collapse { border:1px solid #eee; border-radius:8px; margin-bottom:8px; overflow:hidden; }
    .mpush-collapse-header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#fafafa; cursor:pointer; font-size:13px; font-weight:600; color:#5a43c8; user-select:none; }
    .mpush-collapse-header:hover { background:#f0f0f3; }
    .mpush-collapse-arrow { font-size:10px; transition:transform .2s; }
    .mpush-collapse-header.open .mpush-collapse-arrow { transform:rotate(90deg); }
    .mpush-collapse-body { display:none; padding:12px; border-top:1px solid #eee; }
    .mpush-collapse-body.open { display:block; }
    /* ── 历史列表 ── */
    .mpush-history-header { margin-bottom:10px; }
    .mpush-history-stats { font-size:12px; color:#888; margin-bottom:8px; }
    .mpush-history-filters { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
    .mpush-history-filters button { padding:5px 10px; border-radius:6px; border:1px solid #e5e5ea; background:#f5f5f7; color:#333; cursor:pointer; font-size:11px; }
    .mpush-history-filters button.active { background:#ede9fe; border-color:#8b5cf6; color:#7c3aed; }
    .mpush-history-list { border:1px solid #eee; border-radius:8px; max-height:50vh; overflow-y:auto; }
    .mpush-history-item { display:flex; gap:8px; padding:8px 10px; border-bottom:1px solid #f0f0f0; font-size:12px; cursor:pointer; transition:background .15s; position:relative; }
    .mpush-history-item:last-child { border-bottom:none; }
    .mpush-history-item:hover { background:#f7f7f8; }
    .mpush-history-item.unread { border-left:3px solid #8b5cf6; }
    .mpush-history-item.unread .mpush-history-title { font-weight:600; }
    .mpush-history-time { color:#999; flex-shrink:0; width:40px; font-size:11px; padding-top:1px; }
    .mpush-history-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
    .mpush-history-title { color:#333; font-size:12px; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .mpush-history-url { color:#999; font-size:11px; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:4px; }
    .mpush-history-url-domain { color:#7c3aed; font-weight:600; flex-shrink:0; }
    .mpush-history-url-path { color:#aaa; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .mpush-history-meta { display:flex; align-items:center; gap:4px; flex-shrink:0; padding-top:1px; }
    .mpush-history-visits { color:#999; font-size:10px; flex-shrink:0; }
    .mpush-history-del,.mpush-history-block { color:#ccc; font-size:11px; cursor:pointer; padding:0 2px; flex-shrink:0; opacity:0; transition:opacity .15s; }
    .mpush-history-item:hover .mpush-history-del,.mpush-history-item:hover .mpush-history-block { opacity:1; }
    .mpush-history-del:hover { color:#ef4444; }
    .mpush-history-block:hover { color:#f59e0b; }
    .mpush-rule-overlay { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(17,24,39,.35); font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
    .mpush-rule-dialog { width:560px; max-width:calc(100vw - 32px); max-height:calc(100vh - 32px); overflow:auto; background:#fbfbfd; color:#26262b; border-radius:14px; box-shadow:0 24px 70px rgba(15,23,42,.28); border:1px solid rgba(124,58,237,.16); padding:18px; box-sizing:border-box; }
    .mpush-rule-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
    .mpush-rule-title { color:#5a43c8; font-size:18px; font-weight:800; line-height:1.25; }
    .mpush-rule-close { width:32px; height:32px; border:none; border-radius:8px; background:#ececf1; color:#333; cursor:pointer; font-size:18px; line-height:1; }
    .mpush-rule-close:hover { background:#e2e2e8; }
    .mpush-rule-url { width:100%; box-sizing:border-box; border:1px solid #dedee7; border-radius:10px; background:#f4f4f7; color:#444; padding:11px 12px; font-size:13px; outline:none; margin-bottom:14px; }
    .mpush-rule-url:focus { border-color:#8b5cf6; background:#fff; }
    .mpush-rule-options { display:flex; flex-direction:column; gap:10px; }
    .mpush-rule-option { width:100%; border:1px solid #e2e2ea; border-radius:12px; background:#fff; color:#222; padding:14px 16px; cursor:pointer; text-align:left; display:grid; grid-template-columns:1fr auto; gap:8px 12px; align-items:start; transition:background .15s,border-color .15s,box-shadow .15s; }
    .mpush-rule-option:hover { background:#faf7ff; border-color:#c4b5fd; box-shadow:0 8px 24px rgba(124,58,237,.08); }
    .mpush-rule-option-title { font-size:15px; font-weight:800; line-height:1.3; }
    .mpush-rule-option-note { color:#777; font-size:12px; white-space:nowrap; }
    .mpush-rule-pattern { grid-column:1 / -1; font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; font-size:12px; color:#be185d; background:#fdf2f8; border-radius:6px; padding:3px 6px; word-break:break-all; }
    .mpush-rule-impact { grid-column:1 / -1; color:#888; font-size:12px; }
    .mpush-rule-tip { margin-top:14px; padding-top:12px; border-top:1px dashed #dedee7; color:#888; font-size:12px; line-height:1.6; }
    .mpush-rule-tip code { background:#fdf2f8; color:#be185d; border-radius:5px; padding:1px 5px; }
    /* ── 分析对话 ── */
    .mpush-msg { margin:12px 0; }
    .mpush-msg-role { font-size:12px; font-weight:600; color:#6b7280; margin-bottom:4px; }
    .mpush-msg-user .mpush-msg-role { color:#2563eb; }
    .mpush-msg-assistant .mpush-msg-role { color:#7c3aed; }
    .mpush-msg-content { padding:10px 14px; border-radius:12px; background:#f7f8fc; font-size:14px; line-height:1.7; text-align:left; }
    .mpush-msg-user .mpush-msg-content { background:linear-gradient(135deg,#eef2ff,#e0e7ff); border:1px solid #c7d2fe; }
    .mpush-msg-assistant .mpush-msg-content { background:#fafafa; border:1px solid #eee; }
    .mpush-msg-content > *:first-child { margin-top:0; }
    .mpush-msg-content > *:last-child { margin-bottom:0; }
    .mpush-body h1,.mpush-body h2,.mpush-body h3 { font-weight:700; margin:.8em 0 .4em; color:#5a43c8; }
    .mpush-body h1 { font-size:1.15rem; } .mpush-body h2 { font-size:1.05rem; } .mpush-body h3 { font-size:1rem; }
    .mpush-body p { margin:.4em 0; }
    .mpush-body strong { color:#7c3aed; }
    .mpush-body ul,.mpush-body ol { padding-left:1.5em; margin:.4em 0; }
    .mpush-body code { background:rgba(139,92,246,.12); padding:1px 6px; border-radius:4px; font-size:.88em; color:#be185d; }
    .mpush-body pre { background:rgba(15,23,42,.05); padding:.7em; border-radius:8px; overflow-x:auto; }
    .mpush-body blockquote { border-left:3px solid #7c3aed; padding:.3em .8em; background:rgba(139,92,246,.08); margin:.5em 0; border-radius:0 6px 6px 0; }
    .mpush-body a { color:#2563eb; text-decoration:underline; }
    .mpush-cursor { display:inline-block; width:6px; animation:mpushBlink 1s steps(2,start) infinite; color:#8b5cf6; font-weight:bold; }
    @keyframes mpushBlink { to { visibility:hidden; } }
    .mpush-input-area { flex-shrink:0; border-top:1px solid #eee; padding:8px 12px 10px; background:#fafafa; }
    .mpush-input-row { display:flex; gap:6px; align-items:flex-end; }
    #${UI.chatInputId} { flex:1; border:1px solid #ddd; border-radius:10px; padding:8px 10px; font-size:13px; font-family:inherit; resize:none; min-height:36px; max-height:120px; line-height:1.5; outline:none; }
    #${UI.chatInputId}:focus { border-color:#8b5cf6; }
    #${UI.sendBtnId} { background:linear-gradient(135deg,#8b5cf6,#3b82f6); color:#fff; border:none; width:56px; height:36px; border-radius:10px; cursor:pointer; font-size:13px; font-weight:600; flex-shrink:0; }
    #${UI.sendBtnId}:disabled { opacity:.5; cursor:not-allowed; }
    .mpush-input-hint { font-size:11px; color:#999; margin-top:4px; text-align:right; }
    .mpush-analysis-toolbar { display:flex; gap:6px; padding:8px 14px; border-bottom:1px solid #eee; flex-wrap:wrap; align-items:center; flex-shrink:0; }
    .mpush-body .md-table-wrap,.mpush-msg-content .md-table-wrap { overflow-x:auto; margin:.8em 0; border-radius:8px; border:1px solid rgba(139,92,246,.25); background:rgba(255,255,255,.6); }
    .mpush-body .md-table,.mpush-msg-content .md-table { width:100%; border-collapse:collapse; font-size:.88em; line-height:1.55; }
    .mpush-body .md-table th,.mpush-body .md-table td,.mpush-msg-content .md-table th,.mpush-msg-content .md-table td { padding:8px 12px; border-bottom:1px solid rgba(139,92,246,.15); border-right:1px solid rgba(139,92,246,.10); vertical-align:top; text-align:left; word-break:break-word; }
    .mpush-body .md-table thead th,.mpush-msg-content .md-table thead th { background:linear-gradient(135deg,rgba(124,58,237,.12),rgba(59,130,246,.10)); color:#5a43c8; font-weight:700; white-space:nowrap; border-bottom:2px solid rgba(124,58,237,.35); }
    #${UI.toastId} { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); background:rgba(0,0,0,.82); color:#fff; padding:8px 14px; border-radius:999px; z-index:2147483647; font-size:12px; opacity:0; pointer-events:none; transition:opacity .25s ease; }
    #${UI.toastId}.show { opacity:1; }
    .mpush-search { width:100%; padding:7px 10px; border-radius:8px; border:1px solid #ddd; font-size:12px; margin-bottom:8px; outline:none; }
    .mpush-search:focus { border-color:#8b5cf6; }
    .mpush-cloud-status { font-size:11px; color:#888; margin:4px 0 8px; }
    #${UI.analysisBodyId} { flex:1; overflow-y:auto; padding:10px 14px; font-size:14px; line-height:1.7; min-height:0; }
    .mpush-resize-handle { position:absolute; right:0; bottom:0; width:18px; height:18px; cursor:nwse-resize; background:linear-gradient(135deg,transparent 50%,rgba(139,92,246,.35) 50%); border-bottom-right-radius:14px; z-index:10; }
    .mpush-resize-handle:hover { background:linear-gradient(135deg,transparent 50%,rgba(139,92,246,.65) 50%); }
    .mpush-save-bar { display:flex; gap:8px; padding:12px 0 4px; border-top:1px dashed #e5e5ea; margin-top:12px; }
  `);

  /******************************************************************
   * 10. UI - 面板主体
   ******************************************************************/
  function buildUI() {
    if (document.getElementById(UI.rootId)) return;
    const root = el('div', { id: UI.rootId });
    const floatBtn = el('button', { id: UI.btnId, title: '网页浏览记录助手' });
    floatBtn.innerHTML = '📊<span id="' + UI.badgeId + '"></span>';
    const panel = el('div', { id: UI.panelId });
    const contextMenu = el('div', { id: UI.contextMenuId });
    contextMenu.innerHTML = `
      <div class="mpush-context-title">网页浏览记录助手</div>
      <button class="mpush-context-action" id="mpush-context-sync" type="button">
        <span>🔁 对账同步</span><span>›</span>
      </button>
      <div class="mpush-context-status" id="mpush-context-status">读取同步状态中…</div>`;
    const toastNode = el('div', { id: UI.toastId }, '');

    const header = el('div', { class: 'mpush-panel-header' });
    header.innerHTML = `<div class="mpush-panel-title">📊 网页浏览记录助手</div><div class="mpush-panel-actions"><button class="mpush-icon-btn" id="mpush-settings-btn" title="设置">⚙️</button><button class="mpush-icon-btn" id="mpush-close-btn" title="关闭">×</button></div>`;
    panel.appendChild(header);

    // Tab 栏（3个Tab：历史、分析、设置）
    const tabs = el('div', { class: 'mpush-tabs' });
    ['📋 历史', '🤖 分析', '⚙️ 设置'].forEach((label, idx) => {
      const tab = el('button', { class: 'mpush-tab' + (idx === 0 ? ' active' : ''), 'data-tab': ['history', 'analysis', 'settings'][idx] }, label);
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
      tabs.appendChild(tab);
    });
    panel.appendChild(tabs);

    const content = el('div', { class: 'mpush-tab-content' });
    content.appendChild(buildHistoryTab());
    content.appendChild(buildAnalysisTab());
    content.appendChild(buildSettingsTab());
    panel.appendChild(content);

    const resizeHandle = el('div', { class: 'mpush-resize-handle', title: '拖动调整大小' });
    panel.appendChild(resizeHandle);

    panel.querySelector('#mpush-close-btn').addEventListener('click', () => panel.classList.remove('show'));
    panel.querySelector('#mpush-settings-btn').addEventListener('click', () => switchTab('settings'));

    floatBtn.addEventListener('click', () => {
      if (panel.classList.contains('show')) { panel.classList.remove('show'); return; }
      panel.classList.add('show'); cfg = loadConfig();
      refreshHistoryTab(); updateBadge();
      const unreadCount = getUnreadCount();
      if (unreadCount > 0 && cfg.profiles?.[0]?.apiKey) {
        switchTab('analysis'); toast(`📢 你有 ${unreadCount} 条新记录`);
        setTimeout(() => {
          if (confirm(`你有 ${unreadCount} 条新浏览记录，是否立即让 AI 分析？`)) {
            runAnalysis(historyStore.records.filter(r => isUnread(r)), `最近${formatDate(Date.now())}`, 'summary');
          } else { markAllAsRead(); updateBadge(); refreshHistoryTab(); }
        }, 300);
      }
    });

    root.appendChild(floatBtn); root.appendChild(contextMenu); root.appendChild(panel);
    document.body.appendChild(root); document.body.appendChild(toastNode);

    enablePanelDrag(header, panel, resizeHandle);
    enableFloatBtnDrag(floatBtn);
    enableFloatContextMenu(floatBtn, contextMenu);
    updateBadge();
  }

  function setContextMenuStatus(message, state) {
    const status = document.getElementById('mpush-context-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('ok', state === 'ok');
    status.classList.toggle('error', state === 'error');
  }

  function refreshContextMenuStatus() {
    cfg = loadConfig();
    const syncMeta = loadHistorySyncMeta();
    if (!cfg.cloudSync?.account || !cfg.cloudSync?.appPassword) {
      setContextMenuStatus('未配置坚果云账号/应用密码，无法同步。', 'error');
      return;
    }
    if (!syncMeta.lastSyncAt) {
      setContextMenuStatus('尚未同步历史记录。', '');
      return;
    }
    const checksum = syncMeta.checksum ? `，校验 ${syncMeta.checksum}` : '';
    setContextMenuStatus(`上次同步：${formatDate(syncMeta.lastSyncAt)} ${formatTime(syncMeta.lastSyncAt)}，${syncMeta.syncedCount || 0} 条${checksum}`, 'ok');
  }

  function positionContextMenu(menu, x, y) {
    menu.classList.add('show');
    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function hideContextMenu() {
    const menu = document.getElementById(UI.contextMenuId);
    if (menu) menu.classList.remove('show');
  }

  async function runContextReconcile(btn) {
    cfg = loadConfig();
    if (!cfg.cloudSync?.account || !cfg.cloudSync?.appPassword) {
      setContextMenuStatus('请先在设置中配置坚果云账号和应用密码。', 'error');
      return;
    }
    btn.disabled = true;
    btn.querySelector('span:first-child').textContent = '🔁 对账中…';
    setContextMenuStatus('正在对账同步，请稍等…', '');
    try {
      const result = await historySyncReconcile();
      const checksum = result.checksum ? `，校验 ${result.checksum}` : '';
      setContextMenuStatus(`完成：本地 ${result.localBefore} 条，云端看到 ${result.remoteSeen} 条，最终 ${result.finalCount} 条${checksum}`, 'ok');
      toast(`✅ 对账完成：${result.finalCount} 条`);
      updateSyncStatus();
      refreshHistoryTab();
      fillSettingsTab();
    } catch (err) {
      setContextMenuStatus('同步失败：' + (err.message || err), 'error');
      toast('❌ 同步失败');
    } finally {
      btn.disabled = false;
      btn.querySelector('span:first-child').textContent = '🔁 对账同步';
    }
  }

  function enableFloatContextMenu(floatBtn, menu) {
    const syncBtn = menu.querySelector('#mpush-context-sync');
    menu.addEventListener('click', e => e.stopPropagation());
    menu.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    syncBtn.addEventListener('click', () => runContextReconcile(syncBtn));
    floatBtn.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      refreshContextMenuStatus();
      positionContextMenu(menu, e.clientX, e.clientY);
    });
    document.addEventListener('click', e => {
      if (e.target.closest(`#${UI.contextMenuId}`) || e.target.closest(`#${UI.btnId}`)) return;
      hideContextMenu();
    });
    document.addEventListener('contextmenu', e => {
      if (e.target.closest(`#${UI.contextMenuId}`) || e.target.closest(`#${UI.btnId}`)) return;
      hideContextMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });
  }

  /* ── 全局拖拽状态（document 监听器只注册一次）── */
  let _floatDrag = { active: false, moved: false, sx: 0, sy: 0, sl: 0, st: 0, btn: null };
  let _panelDrag = { active: false, sx: 0, sy: 0, sl: 0, st: 0, panel: null };
  let _panelResize = { active: false, sx: 0, sy: 0, sw: 0, sh: 0, panel: null };

  document.addEventListener('mousemove', e => {
    const fd = _floatDrag;
    if (fd.active) {
      const dx = e.clientX - fd.sx, dy = e.clientY - fd.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) fd.moved = true;
      fd.btn.style.left = Math.max(0, Math.min(innerWidth - 44, fd.sl + dx)) + 'px';
      fd.btn.style.top = Math.max(0, Math.min(innerHeight - 44, fd.st + dy)) + 'px';
      fd.btn.style.right = 'auto'; fd.btn.style.bottom = 'auto';
    }
    if (_panelDrag.active) {
      _panelDrag.panel.style.left = (_panelDrag.sl + e.clientX - _panelDrag.sx) + 'px';
      _panelDrag.panel.style.top = (_panelDrag.st + e.clientY - _panelDrag.sy) + 'px';
    }
    if (_panelResize.active) {
      _panelResize.panel.style.width = Math.max(340, Math.min(innerWidth - 20, _panelResize.sw + e.clientX - _panelResize.sx)) + 'px';
      _panelResize.panel.style.height = Math.max(400, Math.min(innerHeight - 20, _panelResize.sh + e.clientY - _panelResize.sy)) + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (_floatDrag.active) {
      _floatDrag.btn.classList.remove('dragging');
      if (_floatDrag.moved) {
        const b = ev => { ev.stopPropagation(); ev.preventDefault(); _floatDrag.btn.removeEventListener('click', b, true); };
        _floatDrag.btn.addEventListener('click', b, true);
      }
      _floatDrag.active = false;
    }
    _panelDrag.active = false;
    _panelResize.active = false;
  });

  // 窗口大小变化时，确保悬浮按钮始终在可视区域内
  window.addEventListener('resize', () => {
    const btn = document.getElementById(UI.btnId);
    if (!btn || !btn.style.left) return; // 未拖拽过，用 right/bottom 定位，无需修正
    const rect = btn.getBoundingClientRect();
    const maxLeft = window.innerWidth - 44;
    const maxTop = window.innerHeight - 44;
    let changed = false;
    if (rect.left > maxLeft) { btn.style.left = Math.max(0, maxLeft) + 'px'; changed = true; }
    if (rect.top > maxTop) { btn.style.top = Math.max(0, maxTop) + 'px'; changed = true; }
    if (rect.left < 0) { btn.style.left = '0px'; changed = true; }
    if (rect.top < 0) { btn.style.top = '0px'; changed = true; }
  });

  function enableFloatBtnDrag(btn) {
    btn.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      hideContextMenu();
      _floatDrag.moved = false;
      _floatDrag.sx = e.clientX; _floatDrag.sy = e.clientY;
      const r = btn.getBoundingClientRect();
      _floatDrag.sl = r.left; _floatDrag.st = r.top;
      _floatDrag.btn = btn;
      btn.classList.add('dragging');
      _floatDrag.active = true;
      e.preventDefault();
    });
  }

  function enablePanelDrag(handle, panel, resizeHandle) {
    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      const r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      _panelDrag.sx = e.clientX; _panelDrag.sy = e.clientY;
      _panelDrag.sl = r.left; _panelDrag.st = r.top;
      _panelDrag.panel = panel;
      _panelDrag.active = true;
      e.preventDefault();
    });

    resizeHandle.addEventListener('mousedown', e => {
      const r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      _panelResize.sx = e.clientX; _panelResize.sy = e.clientY;
      _panelResize.sw = r.width; _panelResize.sh = r.height;
      _panelResize.panel = panel;
      _panelResize.active = true;
      e.preventDefault(); e.stopPropagation();
    });
  }

  function switchTab(tabName) {
    document.querySelectorAll('.mpush-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.querySelectorAll('.mpush-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tabName));
    // 每次切换 tab 都刷新对应内容
    if (tabName === 'history') refreshHistoryTab();
    if (tabName === 'settings') fillSettingsTab();
    if (tabName === 'analysis') {
      renderConversation();
      // 刷新分析Tab的模板下拉框
      const tplSelect = document.getElementById('analysis-tpl-select');
      if (tplSelect) {
        const allTemplates = getAllAnalysisTemplates().filter(t => !t._deleted);
        const currentVal = tplSelect.value;
        tplSelect.innerHTML = '';
        allTemplates.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = `${t.icon || '📝'} ${t.name || t.id}`;
          tplSelect.appendChild(opt);
        });
        if (currentVal && allTemplates.some(t => t.id === currentVal)) tplSelect.value = currentVal;
      }
    }
  }

  function updateBadge() {
    const badge = document.getElementById(UI.badgeId); if (!badge) return;
    const count = getUnreadCount();
    badge.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
    badge.style.background = count > 0 ? '#ef4444' : 'transparent';
  }

  // ── 折叠面板辅助 ──
  function toggleCollapse(headerEl) {
    const body = headerEl.nextElementSibling;
    headerEl.classList.toggle('open');
    body.classList.toggle('open');
  }

  /******************************************************************
   * 10.1 历史 Tab
   ******************************************************************/
  let currentHistoryFilter = 'all', currentHistorySearch = '';
  function buildHistoryTab() {
    const pane = el('div', { class: 'mpush-tab-pane active', 'data-pane': 'history' });
    historyTabEl = pane;
    pane.innerHTML = `
      <div class="mpush-history-header">
        <div class="mpush-history-stats" id="history-stats"></div>
        <div class="mpush-history-filters" id="history-filters">
          <button data-filter="all" class="active">🔍 全部</button>
          <button data-filter="today">📅 今天</button>
          <button data-filter="yesterday">📆 昨天</button>
          <button data-filter="week">📈 本周</button>
          <button data-filter="month">📆 本月</button>
          <button data-filter="unread">🆕 未读</button>
        </div>
        <input class="mpush-search" id="history-search" placeholder="搜索标题、域名或链接…">
        <div class="mpush-btns" id="history-bulk-actions" style="margin-top:8px;display:none;">
          <button class="mpush-btn danger" id="history-delete-filtered" disabled>🗑️ 删除当前筛选结果</button>
        </div>
      </div>
      <div class="mpush-history-list" id="history-list"></div>
      <div class="mpush-cloud-status" id="history-sync-status" style="margin:6px 0;font-size:11px;color:#888;"></div>
      <div class="mpush-btns" style="margin-top:10px;">
        <button class="mpush-btn" id="history-mark-read">✅ 标为已读</button>
        <button class="mpush-btn" id="history-export">📦 导出</button>
        <button class="mpush-btn" id="history-import">📥 导入</button>
        <button class="mpush-btn" id="history-domain-stats">📊 域名统计</button>
        <button class="mpush-btn danger" id="history-clear">🗑️ 清理</button>
      </div>
      <div class="mpush-btns">
        <button class="mpush-btn primary" id="history-sync-incr">🔁 对账同步</button>
        <button class="mpush-btn danger" id="history-sync-force">⚠️ 强制覆盖</button>
      </div>`;
    pane.querySelector('#history-filters').addEventListener('click', e => { const btn = e.target.closest('[data-filter]'); if (!btn) return; currentHistoryFilter = btn.dataset.filter; pane.querySelectorAll('#history-filters button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); refreshHistoryTab(); });
    pane.querySelector('#history-search').addEventListener('input', e => { currentHistorySearch = e.target.value.trim().toLowerCase(); refreshHistoryTab(); });
    pane.querySelector('#history-delete-filtered').addEventListener('click', deleteFilteredHistoryRecords);
    pane.querySelector('#history-mark-read').addEventListener('click', () => { markAllAsRead(); updateBadge(); refreshHistoryTab(); toast('✅ 已全部标为已读'); });
    pane.querySelector('#history-export').addEventListener('click', exportRecordsAsJson);
    pane.querySelector('#history-import').addEventListener('click', importRecordsFromJson);
    pane.querySelector('#history-domain-stats').addEventListener('click', () => {
      const stats = getDomainStats(historyStore.records).slice(0, 10);
      if (!stats.length) { toast('暂无记录'); return; }
      const msg = stats.map((s, i) => `${i+1}. ${s.domain} — ${s.count}条, ${s.visits}次浏览${s.dwellSec ? `, 停留${formatDuration(s.dwellSec)}` : ''}`).join('\n');
      alert('📊 Top 10 域名统计\n\n' + msg);
    });
    pane.querySelector('#history-clear').addEventListener('click', () => { if (!confirm('确定要清理全部浏览记录吗？')) return; clearAllRecords(); updateBadge(); refreshHistoryTab(); toast('已清理全部记录'); });
    pane.querySelector('#history-sync-incr').addEventListener('click', async () => {
      if (!cfg.cloudSync?.account || !cfg.cloudSync?.appPassword) { alert('请先在设置中配置坚果云账号和密码。'); return; }
      const btn = pane.querySelector('#history-sync-incr'); btn.disabled = true; btn.textContent = '对账中…';
      try { const result = await historySyncIncremental(); toast(`✅ 对账完成：${result.finalCount} 条，校验 ${result.checksum}`); updateSyncStatus(); refreshHistoryTab(); } catch (err) { alert('❌ 同步失败：' + (err.message || err)); } finally { btn.disabled = false; btn.textContent = '🔁 对账同步'; }
    });
    pane.querySelector('#history-sync-force').addEventListener('click', async () => {
      if (!cfg.cloudSync?.account || !cfg.cloudSync?.appPassword) { alert('请先在设置中配置坚果云账号和密码。'); return; }
      if (!confirm('⚠️ 强制覆盖会用本地记录替换云端所有历史记录，继续？')) return;
      const btn = pane.querySelector('#history-sync-force'); btn.disabled = true; btn.textContent = '覆盖中…';
      try { await historySyncForcePush(); toast('✅ 强制覆盖完成'); updateSyncStatus(); } catch (err) { alert('❌ 覆盖失败：' + (err.message || err)); } finally { btn.disabled = false; btn.textContent = '⚠️ 强制覆盖'; }
    });
    return pane;
  }
  function getCurrentFilteredHistoryRecords() {
    let filtered = historyStore.records;
    if (currentHistoryFilter === 'today') filtered = getTodayRecords();
    else if (currentHistoryFilter === 'yesterday') filtered = getYesterdayRecords();
    else if (currentHistoryFilter === 'week') filtered = getThisWeekRecords();
    else if (currentHistoryFilter === 'month') filtered = getThisMonthRecords();
    else if (currentHistoryFilter === 'unread') filtered = historyStore.records.filter(r => isUnread(r));
    if (currentHistorySearch) {
      const q = currentHistorySearch;
      filtered = filtered.filter(r =>
        (r.title && r.title.toLowerCase().includes(q)) ||
        (r.domain && r.domain.toLowerCase().includes(q)) ||
        (r.url && r.url.toLowerCase().includes(q))
      );
    }
    return [...filtered].sort((a, b) => b.ts - a.ts);
  }

  function refreshHistoryTab() {
    if (!historyTabEl) return;
    const stats = historyTabEl.querySelector('#history-stats'), list = historyTabEl.querySelector('#history-list');
    if (!stats || !list) return;
    const total = historyStore.records.length, unread = getUnreadCount(), todayRecords = getTodayRecords(), todayCount = todayRecords.length;
    const filtered = getCurrentFilteredHistoryRecords();
    const bulkBtn = historyTabEl.querySelector('#history-delete-filtered');
    const bulkActions = historyTabEl.querySelector('#history-bulk-actions');
    if (bulkActions) bulkActions.style.display = currentHistorySearch ? 'flex' : 'none';
    if (bulkBtn) {
      bulkBtn.disabled = !currentHistorySearch || !filtered.length;
      bulkBtn.textContent = `🗑️ 删除当前筛选结果${filtered.length ? `（${filtered.length}）` : ''}`;
    }
    const totalDwell = historyStore.records.reduce((sum, r) => sum + getRecordDwellSec(r), 0);
    const todayDwell = todayRecords.reduce((sum, r) => sum + getRecordDwellSec(r), 0);
    stats.innerHTML = `<div>📋 总计 ${total.toLocaleString()} 条 · 今日新增 ${todayCount} 条${totalDwell ? ` · 总停留 ${formatDuration(totalDwell)}` : ''}${todayDwell ? ` · 今日 ${formatDuration(todayDwell)}` : ''}</div>${unread > 0 ? `<div style="color:#ef4444;font-weight:600;">📢 ${unread} 条新记录</div>` : '<div style="color:#16a34a;">✅ 全部已查阅</div>'}`;
    const displayRecords = filtered.slice(0, _historyDisplayCount);
    list.innerHTML = displayRecords.map(r => {
      const unreadCls = isUnread(r) ? ' unread' : '';
      const visits = r.visits > 1 ? `<span class="mpush-history-visits">×${r.visits}</span>` : '';
      const dwell = getRecordDwellSec(r);
      const dwellText = dwell ? `<span class="mpush-history-visits" title="累计停留时间">⏱ ${formatDuration(dwell)}</span>` : '';
      const displayPath = getDisplayPath(r.url);
      const dotIdx = displayPath.indexOf('.');
      const domainEnd = displayPath.indexOf('/', dotIdx > 0 ? dotIdx : 0);
      const domain = domainEnd > 0 ? displayPath.substring(0, domainEnd) : displayPath;
      const path = domainEnd > 0 ? displayPath.substring(domainEnd) : '';
      return `<div class="mpush-history-item${unreadCls}" data-url="${escapeAttr(r.url)}" data-ts="${r.ts}" title="${escapeAttr(r.title)}\n${escapeAttr(r.url)}">` +
        `<span class="mpush-history-time">${formatTime(r.ts)}</span>` +
        `<span class="mpush-history-main">` +
          `<span class="mpush-history-title">${escapeAttr(r.title)}</span>` +
          `<span class="mpush-history-url"><span class="mpush-history-url-domain">${escapeAttr(domain)}</span><span class="mpush-history-url-path">${escapeAttr(path)}</span></span>` +
        `</span>` +
        `<span class="mpush-history-meta">${visits}${dwellText}<span class="mpush-history-block" data-url="${escapeAttr(r.url)}" data-ts="${r.ts}" title="拉黑此网址，不再记录">🚫</span><span class="mpush-history-del" data-url="${escapeAttr(r.url)}" data-ts="${r.ts}" title="删除">✕</span></span>` +
      `</div>`;
    }).join('');
    if (filtered.length > _historyDisplayCount) list.innerHTML += `<div class="mpush-placeholder" id="history-load-more" style="cursor:pointer;">📄 点击加载更多（${filtered.length - _historyDisplayCount} 条剩余）</div>`;
    const loadMoreBtn = list.querySelector('#history-load-more');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreHistory);
    if (!displayRecords.length) list.innerHTML = `<div class="mpush-placeholder">暂无记录</div>`;
    list.querySelectorAll('.mpush-history-item').forEach(item => { item.addEventListener('click', e => { if (e.target.closest('.mpush-history-del,.mpush-history-block')) return; const url = item.dataset.url; if (url) window.open(url, '_blank'); }); });
    list.querySelectorAll('.mpush-history-block').forEach(btn => { btn.addEventListener('click', e => { e.stopPropagation(); blacklistHistoryUrl(btn.dataset.url); }); });
    list.querySelectorAll('.mpush-history-del').forEach(btn => { btn.addEventListener('click', e => { e.stopPropagation(); deleteHistoryRecord(btn.dataset.url, Number(btn.dataset.ts)); }); });
    updateSyncStatus();
  }
  function updateSyncStatus() {
    const statusEl = historyTabEl?.querySelector('#history-sync-status');
    if (!statusEl) return;
    const syncMeta = loadHistorySyncMeta();
    if (syncMeta.lastSyncAt) {
      const dirMap = { reconcile: '对账同步', incremental: '对账同步', 'auto-delta': '自动增量上传', 'auto-delta-check': '自动检查', 'auto-baseline': '自动基线', 'force-push': '强制覆盖', pull: '拉取', push: '上传' };
      const dir = dirMap[cfg.cloudSync?.lastSyncDirection] || '';
      statusEl.textContent = `☁️ 上次同步：${formatDate(syncMeta.lastSyncAt)} ${formatTime(syncMeta.lastSyncAt)}（${dir}，${syncMeta.syncedCount || 0} 条${syncMeta.checksum ? `，校验 ${syncMeta.checksum}` : ''}）`;
    } else {
      statusEl.textContent = '☁️ 尚未同步历史记录';
    }
  }

  /******************************************************************
   * 10.2 分析 Tab
   ******************************************************************/
  function getAnalysisRecords() {
    const rangeSelect = document.getElementById('analysis-range-select');
    const range = rangeSelect ? rangeSelect.value : 'unread';
    switch (range) {
      case 'unread': return { records: historyStore.records.filter(r => isUnread(r)), desc: `未读记录（${formatDate(Date.now())}）` };
      case 'today': return { records: getTodayRecords(), desc: `今天（${formatDate(Date.now())}）` };
      case 'yesterday': return { records: getYesterdayRecords(), desc: `昨天` };
      case 'recent3': return { records: getRecentDaysRecords(3), desc: `最近3天` };
      case 'recent7': return { records: getRecentDaysRecords(7), desc: `最近7天` };
      case 'recent30': return { records: getRecentDaysRecords(30), desc: `最近1个月` };
      case 'week': return { records: getThisWeekRecords(), desc: `本周` };
      case 'month': return { records: getThisMonthRecords(), desc: `本月` };
      case 'all': return { records: historyStore.records, desc: `全部记录` };
      case 'custom': {
        const startInput = document.getElementById('analysis-range-start');
        const endInput = document.getElementById('analysis-range-end');
        if (!startInput?.value || !endInput?.value) { toast('请选择自定义时间段'); return null; }
        const start = new Date(startInput.value).getTime();
        const end = new Date(endInput.value).getTime() + 86400000; // 包含结束日期全天
        if (isNaN(start) || isNaN(end) || start >= end) { toast('时间范围不正确'); return null; }
        const records = getRecordsByTimeRange(start, end);
        return { records, desc: `${formatDate(start)} 至 ${formatDate(end - 86400000)}` };
      }
      default: return { records: historyStore.records.filter(r => isUnread(r)), desc: `未读记录` };
    }
  }

  function buildAnalysisTab() {
    const pane = el('div', { class: 'mpush-tab-pane', 'data-pane': 'analysis' });
    pane.innerHTML = `
      <div class="mpush-analysis-toolbar">
        <select id="analysis-tpl-select" style="padding:6px 8px;border-radius:6px;border:1px solid #e5e5ea;font-size:11px;background:#f5f5f7;cursor:pointer;max-width:120px;"></select>
        <select id="analysis-range-select" style="padding:6px 8px;border-radius:6px;border:1px solid #e5e5ea;font-size:11px;background:#f5f5f7;cursor:pointer;max-width:100px;">
          <option value="unread">🆕 未读</option>
          <option value="today">📅 今天</option>
          <option value="yesterday">📆 昨天</option>
          <option value="recent3">🕒 最近3天</option>
          <option value="recent7">📈 最近7天</option>
          <option value="recent30">🗓️ 最近1个月</option>
          <option value="week">📈 本周</option>
          <option value="month">📆 本月</option>
          <option value="all">📋 全部</option>
          <option value="custom">⏰ 自定义</option>
        </select>
        <button class="mpush-btn primary" id="analysis-auto-btn">✨ 分析</button>
        <button class="mpush-btn" id="analysis-export-md">📝 导出MD</button>
        <button class="mpush-btn" id="analysis-copy-btn">📋 复制</button>
        <button class="mpush-btn danger" id="analysis-clear-btn">🗑️ 清空</button>
      </div>
      <div id="analysis-custom-range" style="display:none;padding:6px 14px;border-bottom:1px solid #eee;flex-shrink:0;">
        <div class="mpush-row-2">
          <div class="mpush-field"><div class="mpush-field-label">开始时间</div><input type="datetime-local" id="analysis-range-start"></div>
          <div class="mpush-field"><div class="mpush-field-label">结束时间</div><input type="datetime-local" id="analysis-range-end"></div>
        </div>
      </div>
      <div id="${UI.analysisBodyId}" class="mpush-body"><p class="mpush-placeholder">选择数据范围和分析模板，点击「✨ 分析」开始。</p></div>
      <div class="mpush-input-area">
        <div class="mpush-input-row">
          <textarea id="${UI.chatInputId}" placeholder="追问… (Enter 发送)" rows="1"></textarea>
          <button id="${UI.sendBtnId}">发送</button>
        </div>
        <div class="mpush-input-hint">Enter 发送 · Shift+Enter 换行</div>
      </div>`;
    // 填充模板下拉框（使用合并后的模板列表）
    const tplSelect = pane.querySelector('#analysis-tpl-select');
    function refreshAnalysisTemplateSelect() {
      const allTemplates = getAllAnalysisTemplates().filter(t => !t._deleted);
      const currentVal = tplSelect.value;
      tplSelect.innerHTML = '';
      allTemplates.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.icon || '📝'} ${t.name || t.id}`;
        tplSelect.appendChild(opt);
      });
      // 恢复选择
      if (currentVal && allTemplates.some(t => t.id === currentVal)) tplSelect.value = currentVal;
      else if (allTemplates.some(t => t.id === USER_PROFILE_TEMPLATE_ID)) tplSelect.value = USER_PROFILE_TEMPLATE_ID;
    }
    refreshAnalysisTemplateSelect();

    // 数据范围切换：显示/隐藏自定义时间输入
    const rangeSelect = pane.querySelector('#analysis-range-select');
    const customRangeDiv = pane.querySelector('#analysis-custom-range');
    rangeSelect.addEventListener('change', () => {
      customRangeDiv.style.display = rangeSelect.value === 'custom' ? 'block' : 'none';
      // 切换到自定义时，设置默认值
      if (rangeSelect.value === 'custom') {
        const startInput = pane.querySelector('#analysis-range-start');
        const endInput = pane.querySelector('#analysis-range-end');
        if (!startInput.value) {
          const now = new Date();
          const weekAgo = new Date(now.getTime() - 7 * 86400000);
          startInput.value = weekAgo.toISOString().slice(0, 16);
          endInput.value = now.toISOString().slice(0, 16);
        }
      }
    });

    pane.querySelector('#analysis-export-md').addEventListener('click', exportAnalysisAsMarkdown);
    pane.querySelector('#analysis-auto-btn').addEventListener('click', () => {
      if (!checkApiConfig()) return;
      const result = getAnalysisRecords();
      if (!result) return;
      if (!result.records.length) { toast('没有记录可分析'); return; }
      // 刷新模板列表以获取最新配置
      refreshAnalysisTemplateSelect();
      runAnalysis(result.records, result.desc, tplSelect.value);
    });
    pane.querySelector('#analysis-copy-btn').addEventListener('click', () => { const text = conversation.filter(m => m.role !== 'system' && !m.meta?.hidden).map(m => { const tag = m.role === 'user' ? '【我】' : `【AI】`; return `${tag}\n${m.content}`; }).join('\n\n---\n\n'); if (!text.trim()) { toast('没有内容'); return; } if (typeof GM_setClipboard === 'function') GM_setClipboard(text); else navigator.clipboard?.writeText(text); toast('已复制'); });
    pane.querySelector('#analysis-clear-btn').addEventListener('click', () => { if (!conversation.length) return; conversation = []; document.getElementById(UI.analysisBodyId).innerHTML = `<p class="mpush-placeholder">点击「✨ 分析未读」开始。</p>`; toast('已清空'); });
    const input = pane.querySelector(`#${UI.chatInputId}`);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSendChat(); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
    return pane;
  }

  /******************************************************************
   * 10.3 设置 Tab
   ******************************************************************/
  function buildSettingsTab() {
    const pane = el('div', { class: 'mpush-tab-pane', 'data-pane': 'settings' });

    // ── 浏览记录 ──
    const recordSection = makeCollapseSection('📦 浏览记录', true);
    recordSection.body.innerHTML = `
      <div class="mpush-field"><div class="mpush-field-inline"><input type="checkbox" data-path="history.enabled"><span>开启自动保存</span></div><small>记录是 AI 分析和用户画像的基础，推送功能已移到“旧版推送”。</small></div>
      <div class="mpush-row-2">
        <div class="mpush-field"><div class="mpush-field-label">最小停留（秒）</div><input type="number" data-path="common.minDwellMs" min="0" max="60" step="1" value="2" data-scale="1000"><small>页面停留不足此时间不记录，过滤中转页</small></div>
        <div class="mpush-field"><div class="mpush-field-label">存储上限（条）</div><input type="number" data-path="history.maxRecords" min="100" max="100000" value="50000"></div>
      </div>
      <div class="mpush-row-2">
        <div class="mpush-field"><div class="mpush-field-label">自动清理（天）</div><input type="number" data-path="history.autoCleanDays" min="0" max="3650" value="180"><small>0=不清理</small></div>
        <div class="mpush-field"></div>
      </div>
      <div class="mpush-field"><div class="mpush-field-label">排除域名（每行一个）</div><textarea id="set-exclude-domains" rows="3"></textarea></div>
      <div class="mpush-field"><div class="mpush-field-label">拉黑网址规则（每行一个）</div><textarea id="set-blacklisted-urls" rows="3"></textarea><small>支持完整网址和通配符 *；历史列表点 🚫 可快速生成规则。</small></div>
      <div class="mpush-btns">
        <button class="mpush-btn danger" id="set-history-clear">🗑️ 清理全部</button>
        <button class="mpush-btn" id="set-history-export">📦 导出</button>
      </div>`;

    // ── 旧版推送 ──
    const legacyPushSection = makeCollapseSection('📨 旧版推送（可选）');
    legacyPushSection.body.innerHTML = `
      <div class="mpush-field"><div class="mpush-field-inline"><input type="checkbox" data-path="common.autoSendOnLoad"><span>页面打开后自动推送</span></div><small>默认关闭。这个功能不影响浏览记录、AI 分析和用户画像。</small></div>
      <div class="mpush-row-2">
        <div class="mpush-field"><div class="mpush-field-label">同URL推送冷却（秒）</div><input type="number" data-path="common.cooldownMs" min="0" max="86400" step="1" data-scale="1000"><small>冷却内不重复推送</small></div>
        <div class="mpush-field"><div class="mpush-field-inline"><input type="checkbox" data-path="common.includeTitle"><span>推送包含标题</span></div></div>
      </div>
      <div class="mpush-field"><div class="mpush-field-inline"><input type="checkbox" data-path="common.includeUrl"><span>推送包含链接</span></div></div>
      <div class="mpush-field"><div class="mpush-field-inline"><input type="checkbox" data-path="telegram.enabled"><span>启用 Telegram 推送</span></div></div>
      <div class="mpush-field"><div class="mpush-field-label">Telegram Bot Token</div><input type="password" data-path="telegram.botToken" autocomplete="off"></div>
      <div class="mpush-field"><div class="mpush-field-label">Telegram Chat ID</div><input type="text" data-path="telegram.chatId"></div>
      <div class="mpush-field"><div class="mpush-field-inline"><input type="checkbox" data-path="feishu.enabled"><span>启用飞书推送</span></div></div>
      <div class="mpush-field"><div class="mpush-field-label">飞书 Webhook URL</div><input type="text" data-path="feishu.webhookUrl"></div>
      <div class="mpush-field"><div class="mpush-field-label">飞书签名密钥（可选）</div><input type="password" data-path="feishu.secret" autocomplete="off"><small>开启签名校验时填写</small></div>`;

    // ── AI API ──
    const aiSection = makeCollapseSection('🤖 共享 AI API 预设');
    aiSection.body.innerHTML = `
      <div class="mpush-field">
        <small>和「饺子 AI 网页摘要助手」共用 <code>tabbit-shared/ai-profiles.json</code>。推荐主要在摘要助手里维护 API，这里读取后直接用于浏览记录分析。API Key 会随预设上传到坚果云。</small>
      </div>
      <div class="mpush-field"><div class="mpush-field-label">预设选择</div><select id="set-profile-select"></select></div>
      <div class="mpush-field"><div class="mpush-field-label">预设名称</div><input type="text" id="set-profile-name" placeholder="如：DeepSeek、OpenAI"></div>
      <div class="mpush-field"><div class="mpush-field-label">API URL</div><input type="text" id="set-api-url" placeholder="https://api.openai.com/v1/chat/completions"></div>
      <div class="mpush-field"><div class="mpush-field-label">API Key</div><input type="password" id="set-api-key" placeholder="sk-xxxx"></div>
      <div class="mpush-row-2">
        <div class="mpush-field"><div class="mpush-field-label">Temperature</div><input type="number" id="set-temperature" step="0.1" min="0" max="2" value="0.7"></div>
        <div class="mpush-field"><div class="mpush-field-label">Max Tokens</div><input type="number" id="set-max-tokens" min="100" value="2000"></div>
      </div>
      <div class="mpush-field"><div class="mpush-field-label">模型</div><select id="set-model-select"></select></div>
      <div class="mpush-btns">
        <button class="mpush-btn" id="set-profile-add">➕ 新建</button>
        <button class="mpush-btn" id="set-profile-clone">📋 复制</button>
        <button class="mpush-btn danger" id="set-profile-delete">🗑️ 删除</button>
        <button class="mpush-btn" id="set-test-api">⚡ 测试</button>
        <button class="mpush-btn" id="set-fetch-models">🔄 获取模型</button>
        <button class="mpush-btn primary" id="set-profile-cloud-pull">☁️ 从坚果云读取 API 预设</button>
        <button class="mpush-btn" id="set-profile-cloud-push">⬆️ 上传当前 API 预设到坚果云</button>
      </div>`;

    // ── AI 分析提示词 ──
    const tplSection = makeCollapseSection('📝 AI 分析提示词');
    tplSection.body.innerHTML = `
      <div class="mpush-field">
        <div class="mpush-field-label">用户画像流转</div>
        <div class="mpush-field-inline"><input type="checkbox" data-path="userProfile.autoUploadToCloud"><span>画像生成成功后自动上传到坚果云</span></div>
        <small>云端方式：生成用户画像后写入 tabbit-shared/user-profile.json，摘要助手点“从坚果云读取用户画像”。本地方式：点“导出MD”，再到摘要助手点“导入 .md 文件”。</small>
      </div>
      <div class="mpush-field">
        <div class="mpush-field-label">当前模板列表</div>
        <div id="set-tpl-list" style="max-height:300px;overflow-y:auto;border:1px solid #eee;border-radius:8px;"></div>
      </div>
      <div class="mpush-btns" style="margin-top:12px;">
        <button class="mpush-btn" id="set-tpl-add">➕ 新建模板</button>
        <button class="mpush-btn" id="set-tpl-reset-default">🔄 恢复默认模板</button>
        <button class="mpush-btn" id="set-tpl-export">📦 导出全部</button>
        <button class="mpush-btn" id="set-tpl-import">📥 导入模板</button>
      </div>
      <div id="set-tpl-editor" style="display:none;margin-top:12px;padding:12px;border:1px solid #e5e5ea;border-radius:8px;background:#fafafa;">
        <div class="mpush-field"><div class="mpush-field-label">模板ID</div><input type="text" id="set-tpl-edit-id" placeholder="唯一标识，如：summary"><small>用于内部识别，不可重复</small></div>
        <div class="mpush-field"><div class="mpush-field-label">图标</div><input type="text" id="set-tpl-edit-icon" placeholder="如：📊" style="width:60px;"></div>
        <div class="mpush-field"><div class="mpush-field-label">名称</div><input type="text" id="set-tpl-edit-name" placeholder="如：时段浏览总结"></div>
        <div class="mpush-field"><div class="mpush-field-label">描述</div><input type="text" id="set-tpl-edit-desc" placeholder="简短说明模板用途"></div>
        <div class="mpush-field">
          <div class="mpush-field-label">提示词内容</div>
          <textarea id="set-tpl-edit-prompt" rows="8" style="min-height:150px;" placeholder="输入 AI 分析提示词..."></textarea>
          <small>可用变量：{timeRangeDesc} = 时间范围描述，{count} = 记录总数</small>
        </div>
        <div class="mpush-btns">
          <button class="mpush-btn primary" id="set-tpl-save">💾 保存模板</button>
          <button class="mpush-btn" id="set-tpl-cancel">取消</button>
        </div>
      </div>`;

    // 初始化模板列表
    function refreshTemplateList() {
      const listEl = tplSection.body.querySelector('#set-tpl-list');
      if (!listEl) return;
      const allTemplates = getAllAnalysisTemplates();
      const defaultIds = ANALYSIS_TEMPLATES.map(t => t.id);
      if (!allTemplates.length) {
        listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#888;font-size:12px;">暂无模板</div>';
        return;
      }
      listEl.innerHTML = allTemplates.map(t => {
        const isDefault = defaultIds.includes(t.id);
        return `<div class="mpush-history-item" data-tpl-id="${escapeAttr(t.id)}" style="cursor:pointer;padding:10px 12px;">
          <span style="font-size:18px;flex-shrink:0;margin-right:8px;">${escapeAttr(t.icon || '📝')}</span>
          <span class="mpush-history-main">
            <span class="mpush-history-title" style="font-size:13px;font-weight:600;">${escapeAttr(t.name || t.id)}</span>
            <span class="mpush-history-url" style="color:#888;font-size:11px;">${escapeAttr(t.desc || '')}</span>
          </span>
          <span class="mpush-history-meta" style="gap:4px;">
            ${isDefault ? '<span style="font-size:10px;color:#8b5cf6;background:#ede9fe;padding:2px 6px;border-radius:4px;">默认</span>' : ''}
            <button class="mpush-icon-btn" data-action="edit" data-tpl-id="${escapeAttr(t.id)}" title="编辑" style="width:24px;height:24px;font-size:12px;background:#f3f4f6;">✏️</button>
            <button class="mpush-icon-btn" data-action="clone" data-tpl-id="${escapeAttr(t.id)}" title="复制" style="width:24px;height:24px;font-size:12px;background:#f3f4f6;">📋</button>
            <button class="mpush-icon-btn" data-action="delete" data-tpl-id="${escapeAttr(t.id)}" title="删除" style="width:24px;height:24px;font-size:12px;background:#fee2e2;">🗑️</button>
          </span>
        </div>`;
      }).join('');

      // 绑定模板操作事件
      listEl.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const tplId = btn.dataset.tplId;
          if (action === 'edit') openTemplateEditor(tplId);
          else if (action === 'clone') cloneTemplate(tplId);
          else if (action === 'delete') deleteTemplate(tplId);
        });
      });

      // 点击模板项打开编辑
      listEl.querySelectorAll('.mpush-history-item').forEach(item => {
        item.addEventListener('click', () => openTemplateEditor(item.dataset.tplId));
      });
    }

    // 打开模板编辑器
    let _editingTemplateId = null;
    function openTemplateEditor(tplId) {
      const allTemplates = getAllAnalysisTemplates();
      const tpl = allTemplates.find(t => t.id === tplId);
      if (!tpl) return;
      _editingTemplateId = tplId;
      const editor = tplSection.body.querySelector('#set-tpl-editor');
      editor.style.display = 'block';
      const defaultIds = ANALYSIS_TEMPLATES.map(t => t.id);
      const isDefault = defaultIds.includes(tplId);
      tplSection.body.querySelector('#set-tpl-edit-id').value = tpl.id || '';
      tplSection.body.querySelector('#set-tpl-edit-id').readOnly = !!isDefault; // 默认模板ID不可改
      tplSection.body.querySelector('#set-tpl-edit-icon').value = tpl.icon || '';
      tplSection.body.querySelector('#set-tpl-edit-name').value = tpl.name || '';
      tplSection.body.querySelector('#set-tpl-edit-desc').value = tpl.desc || '';
      tplSection.body.querySelector('#set-tpl-edit-prompt').value = tpl.prompt || '';
      tplSection.body.querySelector('#set-tpl-edit-id').focus();
    }

    // 保存模板
    function saveTemplateFromEditor() {
      const id = tplSection.body.querySelector('#set-tpl-edit-id').value.trim();
      const icon = tplSection.body.querySelector('#set-tpl-edit-icon').value.trim();
      const name = tplSection.body.querySelector('#set-tpl-edit-name').value.trim();
      const desc = tplSection.body.querySelector('#set-tpl-edit-desc').value.trim();
      const prompt = tplSection.body.querySelector('#set-tpl-edit-prompt').value;
      if (!id) { alert('模板ID不能为空'); return; }
      if (!name) { alert('模板名称不能为空'); return; }
      if (!prompt) { alert('提示词内容不能为空'); return; }
      // 检查ID冲突（排除当前编辑的）
      const allTemplates = getAllAnalysisTemplates();
      const conflict = allTemplates.find(t => t.id === id && t.id !== _editingTemplateId);
      if (conflict) { alert(`模板ID "${id}" 已存在，请使用其他ID`); return; }
      // 如果是编辑默认模板，覆盖到自定义
      const newTpl = { id, icon, name, desc, prompt };
      const custom = cfg.analysisTemplates || [];
      if (_editingTemplateId) {
        const idx = custom.findIndex(t => t.id === _editingTemplateId);
        if (idx >= 0) custom[idx] = newTpl;
        else custom.push(newTpl); // 覆盖默认模板
      } else {
        custom.push(newTpl);
      }
      cfg.analysisTemplates = custom;
      saveConfig(cfg);
      closeTemplateEditor();
      refreshTemplateList();
      toast('✅ 模板已保存');
    }

    // 关闭编辑器
    function closeTemplateEditor() {
      _editingTemplateId = null;
      const editor = tplSection.body.querySelector('#set-tpl-editor');
      editor.style.display = 'none';
    }

    // 复制模板
    function cloneTemplate(tplId) {
      const allTemplates = getAllAnalysisTemplates();
      const tpl = allTemplates.find(t => t.id === tplId);
      if (!tpl) return;
      const newId = tpl.id + '_copy_' + Date.now().toString(36);
      const newTpl = { ...tpl, id: newId, name: tpl.name + '（副本）' };
      const custom = cfg.analysisTemplates || [];
      custom.push(newTpl);
      cfg.analysisTemplates = custom;
      saveConfig(cfg);
      refreshTemplateList();
      toast('✅ 已复制模板');
    }

    // 删除模板
    function deleteTemplate(tplId) {
      const defaultIds = ANALYSIS_TEMPLATES.map(t => t.id);
      const isDefault = defaultIds.includes(tplId);
      const tpl = getAllAnalysisTemplates().find(t => t.id === tplId);
      if (!tpl) return;
      if (isDefault) {
        if (!confirm(`「${tpl.name}」是默认模板，删除后将恢复为内置默认内容，继续？`)) return;
      } else {
        if (!confirm(`确定删除模板「${tpl.name}」？`)) return;
      }
      // 从自定义列表中移除（如果是默认模板，则覆盖为空占位防止恢复）
      let custom = cfg.analysisTemplates || [];
      if (isDefault) {
        // 对默认模板：添加一个空的覆盖标记（id保留，prompt清空）
        const idx = custom.findIndex(t => t.id === tplId);
        const marker = { id: tplId, icon: tpl.icon, name: tpl.name + '（已删除）', desc: '', prompt: '', _deleted: true };
        if (idx >= 0) custom[idx] = marker; else custom.push(marker);
      } else {
        custom = custom.filter(t => t.id !== tplId);
      }
      cfg.analysisTemplates = custom;
      saveConfig(cfg);
      if (_editingTemplateId === tplId) closeTemplateEditor();
      refreshTemplateList();
      toast('✅ 已删除模板');
    }

    // 恢复默认模板
    tplSection.body.querySelector('#set-tpl-reset-default')?.addEventListener('click', () => {
      if (!confirm('确定恢复默认模板？这将清除所有自定义模板和对默认模板的修改。')) return;
      cfg.analysisTemplates = [];
      saveConfig(cfg);
      refreshTemplateList();
      closeTemplateEditor();
      toast('✅ 已恢复默认模板');
    });

    // 新建模板
    tplSection.body.querySelector('#set-tpl-add')?.addEventListener('click', () => {
      _editingTemplateId = null;
      const editor = tplSection.body.querySelector('#set-tpl-editor');
      editor.style.display = 'block';
      tplSection.body.querySelector('#set-tpl-edit-id').value = 'custom_' + Date.now().toString(36);
      tplSection.body.querySelector('#set-tpl-edit-id').readOnly = false;
      tplSection.body.querySelector('#set-tpl-edit-icon').value = '📝';
      tplSection.body.querySelector('#set-tpl-edit-name').value = '';
      tplSection.body.querySelector('#set-tpl-edit-desc').value = '';
      tplSection.body.querySelector('#set-tpl-edit-prompt').value = '';
      tplSection.body.querySelector('#set-tpl-edit-name').focus();
    });

    // 保存/取消按钮
    tplSection.body.querySelector('#set-tpl-save')?.addEventListener('click', saveTemplateFromEditor);
    tplSection.body.querySelector('#set-tpl-cancel')?.addEventListener('click', closeTemplateEditor);

    // 导出全部模板
    tplSection.body.querySelector('#set-tpl-export')?.addEventListener('click', () => {
      const allTemplates = getAllAnalysisTemplates();
      const exportData = { version: 1, exportedAt: Date.now(), templates: allTemplates };
      downloadText(JSON.stringify(exportData, null, 2), `analysis-templates-${formatDate(Date.now())}.json`);
      toast('✅ 已导出模板');
    });

    // 导入模板
    tplSection.body.querySelector('#set-tpl-import')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const templates = data.templates || data;
          if (!Array.isArray(templates)) { alert('文件格式不正确'); return; }
          const custom = cfg.analysisTemplates || [];
          let added = 0;
          templates.forEach(t => {
            if (!t.id || !t.prompt) return;
            const idx = custom.findIndex(ct => ct.id === t.id);
            if (idx >= 0) custom[idx] = t; else { custom.push(t); added++; }
          });
          cfg.analysisTemplates = custom;
          saveConfig(cfg);
          refreshTemplateList();
          toast(`✅ 导入完成，新增 ${added} 个模板`);
        } catch (e) { alert('导入失败：' + e.message); }
      };
      input.click();
    });

    // 初始渲染
    refreshTemplateList();

    // ── 云同步 ──
    const cloudSection = makeCollapseSection('☁️ 坚果云云同步');
    cloudSection.body.innerHTML = `
      <div class="mpush-row-2">
        <div class="mpush-field"><div class="mpush-field-label">账号（邮箱）</div><input type="text" data-path="cloudSync.account" placeholder="you@example.com"></div>
        <div class="mpush-field"><div class="mpush-field-label">应用密码</div><input type="password" data-path="cloudSync.appPassword" placeholder="坚果云应用密码"></div>
      </div>
      <div class="mpush-row-2">
        <div class="mpush-field"><div class="mpush-field-label">自动同步间隔（分钟）</div><input type="number" data-path="cloudSync.autoSyncMinutes" min="0" max="10080" step="1" value="240"><small>建议 15-30；0=关闭。自动只上传增量，手动对账才全量合并</small></div>
        <div class="mpush-field"></div>
      </div>
      <div class="mpush-cloud-status" id="set-cloud-status">尚未同步</div>
      <div class="mpush-btns">
        <button class="mpush-btn" id="set-cloud-test">🔌 测试</button>
        <button class="mpush-btn primary" id="set-cloud-reconcile">🔁 对账同步</button>
        <button class="mpush-btn" id="set-cloud-pull">⬇️ 拉取</button>
        <button class="mpush-btn" id="set-cloud-push">⬆️ 上传</button>
        <button class="mpush-btn danger" id="set-cloud-force">⚠️ 覆盖</button>
      </div>`;

    // 组装面板
    pane.appendChild(recordSection.container);
    pane.appendChild(aiSection.container);
    pane.appendChild(tplSection.container);
    pane.appendChild(legacyPushSection.container);
    pane.appendChild(cloudSection.container);

    // ── 保存按钮（统一保存所有设置）──
    const saveBar = el('div', { class: 'mpush-save-bar' });
    const saveBtn = el('button', { class: 'mpush-btn primary', style: 'flex:1;padding:10px;' }, '💾 保存所有设置');
    saveBtn.addEventListener('click', () => { readAllSettingsToConfig(); const removed = pruneBlacklistedRecords(); saveConfig(cfg); if (removed) { saveHistory(historyStore); updateBadge(); refreshHistoryTab(); } toast(removed ? `✅ 已保存，已移除 ${removed} 条拉黑记录` : '✅ 已保存所有设置'); });
    saveBar.appendChild(saveBtn);
    pane.appendChild(saveBar);

    // ── 绑定子事件 ──
    pane.querySelector('#set-profile-select').addEventListener('change', e => { readAllSettingsToConfig(); setCurrentProfile(e.target.value); fillSettingsTab(); });
    pane.querySelector('#set-profile-add').addEventListener('click', () => { const name = prompt('新预设名称：', '新配置'); if (!name) return; readAllSettingsToConfig(); const np = clone(DEFAULT_PROFILE); np.id = makeId('prof'); np.name = name; cfg.profiles.push(np); cfg.currentProfileId = np.id; saveConfig(cfg); fillSettingsTab(); });
    pane.querySelector('#set-profile-clone').addEventListener('click', () => { const cur = getCurrentProfile(); const name = prompt('复制为：', cur.name + '（副本）'); if (!name) return; readAllSettingsToConfig(); const cp = clone(cur); cp.id = makeId('prof'); cp.name = name; cfg.profiles.push(cp); cfg.currentProfileId = cp.id; saveConfig(cfg); fillSettingsTab(); });
    pane.querySelector('#set-profile-delete').addEventListener('click', () => { if (cfg.profiles.length <= 1) { alert('至少保留一个预设。'); return; } if (!confirm(`删除「${getCurrentProfile().name}」？`)) return; readAllSettingsToConfig(); const idx = cfg.profiles.findIndex(p => p.id === cfg.currentProfileId); cfg.profiles.splice(idx, 1); cfg.currentProfileId = cfg.profiles[0].id; saveConfig(cfg); fillSettingsTab(); });
    pane.querySelector('#set-test-api').addEventListener('click', async () => { readAllSettingsToConfig(); saveConfig(cfg); if (!checkApiConfig()) return; const btn = pane.querySelector('#set-test-api'); btn.disabled = true; btn.textContent = '测试中…'; try { await callChatApi([{ role: 'user', content: '请只回复 OK' }]); toast('✅ 测试成功'); } catch (err) { alert('❌ 测试失败：\n' + (err.message || err)); } finally { btn.disabled = false; btn.textContent = '⚡ 测试'; } });
    pane.querySelector('#set-profile-cloud-pull').addEventListener('click', async () => {
      readAllSettingsToConfig(); saveConfig(cfg);
      if (!cfg.cloudSync.account || !cfg.cloudSync.appPassword) { alert('请先在“坚果云云同步”里填写账号和密码。'); return; }
      const btn = pane.querySelector('#set-profile-cloud-pull'); btn.disabled = true; btn.textContent = '读取中…';
      try {
        const result = await pullApiProfilesFromCloud();
        fillSettingsTab();
        alert(result.hasProfiles ? `✅ 已读取 API 预设，共 ${result.count} 个。` : '云端还没有 API 预设。');
      } catch (err) { alert('❌ 读取失败：\n' + (err.message || err)); }
      finally { btn.disabled = false; btn.textContent = '☁️ 从坚果云读取 API 预设'; }
    });
    pane.querySelector('#set-profile-cloud-push').addEventListener('click', async () => {
      readAllSettingsToConfig(); saveConfig(cfg);
      if (!cfg.cloudSync.account || !cfg.cloudSync.appPassword) { alert('请先在“坚果云云同步”里填写账号和密码。'); return; }
      if (!confirm('上传当前 API 预设到坚果云？同 ID 预设会以本地为准。')) return;
      const btn = pane.querySelector('#set-profile-cloud-push'); btn.disabled = true; btn.textContent = '上传中…';
      try {
        const result = await pushCurrentApiProfileToCloud();
        fillSettingsTab();
        alert(`✅ 已上传 API 预设，共 ${result.count} 个。`);
      } catch (err) { alert('❌ 上传失败：\n' + (err.message || err)); }
      finally { btn.disabled = false; btn.textContent = '⬆️ 上传当前 API 预设到坚果云'; }
    });
    pane.querySelector('#set-fetch-models').addEventListener('click', () => {
      readAllSettingsToConfig(); saveConfig(cfg); const p = getCurrentProfile();
      if (!p.apiUrl || !p.apiKey) { alert('请先填写 API 地址和 Key。'); return; }
      let modelsUrl; try { modelsUrl = buildModelsUrl(p.apiUrl); } catch { alert('API 地址格式不正确。'); return; }
      const btn = pane.querySelector('#set-fetch-models'); btn.disabled = true; btn.textContent = '获取中…';
      GM_xmlhttpRequest({ method: 'GET', url: modelsUrl, headers: { Authorization: `Bearer ${p.apiKey}` }, timeout: 60000,
        onload(res) { btn.disabled = false; btn.textContent = '🔄 获取模型'; try { if (res.status < 200 || res.status >= 300) { alert(`失败：${res.status}`); return; } const data = JSON.parse(res.responseText); const ids = Array.isArray(data?.data) ? data.data.map(x => x.id).filter(Boolean) : []; if (!ids.length) { alert('未识别到模型'); return; } ids.forEach(id => { if (!p.models.some(m => m.value === id)) p.models.push({ name: id, value: id, temperature: '', maxTokens: '' }); }); if (!p.currentModel) p.currentModel = p.models[0]?.value || ''; saveConfig(cfg); fillSettingsTab(); alert(`✅ 获取 ${ids.length} 个模型`); } catch (err) { alert('解析失败：' + err.message); } },
        onerror() { btn.disabled = false; btn.textContent = '🔄 获取模型'; }, ontimeout() { btn.disabled = false; btn.textContent = '🔄 获取模型'; }
      });
    });
    pane.querySelector('#set-history-clear').addEventListener('click', () => { if (!confirm('清理全部记录？')) return; clearAllRecords(); updateBadge(); refreshHistoryTab(); toast('已清理'); });
    pane.querySelector('#set-history-export').addEventListener('click', exportRecordsAsJson);
    pane.querySelector('#set-cloud-test').addEventListener('click', async () => { readAllSettingsToConfig(); saveConfig(cfg); if (!cfg.cloudSync.account || !cfg.cloudSync.appPassword) { alert('请先填写账号和密码。'); return; } try { await jgyMkcolIfNeeded(JGY_SHARED_DIR); await jgyMkcolIfNeeded(JGY_HISTORY_DIR); await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR); await jgyMkcolIfNeeded(JGY_HISTORY_SYNC_DIR + JGY_HISTORY_SYNC_CLIENTS); toast('✅ 连接成功'); } catch (err) { alert('❌ ' + (err.message || err)); } });
    pane.querySelector('#set-cloud-reconcile').addEventListener('click', async () => { readAllSettingsToConfig(); saveConfig(cfg); if (!cfg.cloudSync.account || !cfg.cloudSync.appPassword) { alert('请先填写账号和密码。'); return; } const btn = pane.querySelector('#set-cloud-reconcile'); btn.disabled = true; btn.textContent = '对账中…'; try { const result = await historySyncReconcile(); toast(`✅ 对账完成：${result.finalCount} 条，校验 ${result.checksum}`); fillSettingsTab(); refreshHistoryTab(); } catch (err) { alert('❌ ' + (err.message || err)); } finally { btn.disabled = false; btn.textContent = '🔁 对账同步'; } });
    pane.querySelector('#set-cloud-pull').addEventListener('click', async () => { readAllSettingsToConfig(); saveConfig(cfg); if (!cfg.cloudSync.account || !cfg.cloudSync.appPassword) { alert('请先填写账号和密码。'); return; } if (!confirm('从云端拉取？')) return; try { await cloudPullAll(); toast('✅ 拉取完成'); fillSettingsTab(); refreshHistoryTab(); } catch (err) { alert('❌ ' + (err.message || err)); } });
    pane.querySelector('#set-cloud-push').addEventListener('click', async () => { readAllSettingsToConfig(); saveConfig(cfg); if (!cfg.cloudSync.account || !cfg.cloudSync.appPassword) { alert('请先填写账号和密码。'); return; } try { await cloudPushAll(); toast('✅ 上传完成'); } catch (err) { alert('❌ ' + (err.message || err)); } });
    pane.querySelector('#set-cloud-force').addEventListener('click', async () => { readAllSettingsToConfig(); saveConfig(cfg); if (!cfg.cloudSync.account || !cfg.cloudSync.appPassword) { alert('请先填写账号和密码。'); return; } if (!confirm('⚠️ 强制覆盖？')) return; if (!confirm('不可恢复，继续？')) return; try { await cloudForcePushAll(); toast('✅ 覆盖完成'); } catch (err) { alert('❌ ' + (err.message || err)); } });

    return pane;
  }

  function makeCollapseSection(title, openByDefault) {
    const container = el('div', { class: 'mpush-collapse' });
    const header = el('div', { class: 'mpush-collapse-header' + (openByDefault ? ' open' : '') });
    header.innerHTML = `<span>${title}</span><span class="mpush-collapse-arrow">▶</span>`;
    const body = el('div', { class: 'mpush-collapse-body' + (openByDefault ? ' open' : '') });
    header.addEventListener('click', () => toggleCollapse(header));
    container.appendChild(header);
    container.appendChild(body);
    return { container, header, body };
  }

  /* ── 从所有 data-path 元素读取值到 cfg ── */
  function readAllSettingsToConfig() {
    const pane = document.querySelector('[data-pane="settings"]');
    if (!pane) return;
    // data-path 元素
    pane.querySelectorAll('[data-path]').forEach(node => {
      const path = node.dataset.path;
      if (node.type === 'checkbox') setByPath(cfg, path, !!node.checked);
      else if (node.type === 'number') {
        const raw = String(node.value || '').trim();
        const scale = node.dataset.scale ? Number(node.dataset.scale) : 1;
        setByPath(cfg, path, Math.max(0, Math.round((raw === '' ? 0 : Number(raw)) * scale)));
      } else setByPath(cfg, path, String(node.value || '').trim());
    });
    // AI 配置
    const profile = getCurrentProfile();
    profile.name = pane.querySelector('#set-profile-name')?.value?.trim() || profile.name;
    profile.apiUrl = pane.querySelector('#set-api-url')?.value?.trim() || '';
    profile.apiKey = pane.querySelector('#set-api-key')?.value?.trim() || '';
    profile.temperature = Number(pane.querySelector('#set-temperature')?.value || 0.7);
    profile.maxTokens = Number(pane.querySelector('#set-max-tokens')?.value || 2000);
    const ms = pane.querySelector('#set-model-select');
    if (ms?.value) profile.currentModel = ms.value;
    // 排除域名
    const ed = pane.querySelector('#set-exclude-domains');
    if (ed && cfg.history) cfg.history.excludeDomains = ed.value.split('\n').map(s => s.trim()).filter(Boolean);
    const bu = pane.querySelector('#set-blacklisted-urls');
    if (bu && cfg.history) {
      const nextBlocked = mergeBlacklistedUrls(bu.value.split('\n').map(s => s.trim()).filter(Boolean));
      const oldBlocked = getBlacklistedUrls();
      cfg.history.blacklistedUrls = nextBlocked;
      if (nextBlocked.join('\n') !== oldBlocked.join('\n')) cfg.history.blacklistUpdatedAt = Date.now();
    }
  }

  function fillSettingsTab() {
    const pane = document.querySelector('[data-pane="settings"]'); if (!pane) return;
    // data-path
    pane.querySelectorAll('[data-path]').forEach(node => {
      const val = getByPath(cfg, node.dataset.path);
      if (node.type === 'checkbox') node.checked = !!val;
      else if (node.type === 'number') { const scale = node.dataset.scale ? Number(node.dataset.scale) : 1; node.value = val == null ? '' : String(Math.round(Number(val) / scale)); }
      else node.value = val == null ? '' : String(val);
    });
    // AI 配置
    const ps = pane.querySelector('#set-profile-select');
    if (ps) { ps.innerHTML = ''; cfg.profiles.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; if (p.id === cfg.currentProfileId) opt.selected = true; ps.appendChild(opt); }); }
    const profile = getCurrentProfile();
    const setVal = (id, v) => { const el = pane.querySelector(id); if (el) el.value = v; };
    setVal('#set-profile-name', profile.name || '');
    setVal('#set-api-url', profile.apiUrl || '');
    setVal('#set-api-key', profile.apiKey || '');
    setVal('#set-temperature', profile.temperature ?? 0.7);
    setVal('#set-max-tokens', profile.maxTokens ?? 2000);
    const ms = pane.querySelector('#set-model-select');
    if (ms) { ms.innerHTML = ''; normalizeModels(profile.models).forEach(m => { const opt = document.createElement('option'); opt.value = m.value; opt.textContent = m.name || m.value; if (m.value === profile.currentModel) opt.selected = true; ms.appendChild(opt); }); ms.onchange = function () { profile.currentModel = this.value; saveConfig(cfg); }; }
    const ed = pane.querySelector('#set-exclude-domains');
    if (ed) ed.value = (cfg.history?.excludeDomains || DEFAULT_EXCLUDE_DOMAINS).join('\n');
    const bu = pane.querySelector('#set-blacklisted-urls');
    if (bu) bu.value = getBlacklistedUrls().join('\n');
    const cs = pane.querySelector('#set-cloud-status');
    if (cs) { const t = cfg.cloudSync?.lastSyncAt; if (t) { const dirMap = { reconcile: '对账同步', incremental: '对账同步', 'auto-delta': '自动增量上传', 'auto-delta-check': '自动检查', 'auto-baseline': '自动基线', pull: '拉取', push: '上传', 'force-push': '覆盖' }; cs.textContent = `上次：${formatDate(t)}（${dirMap[cfg.cloudSync.lastSyncDirection] || ''}）`; } else cs.textContent = '尚未同步'; }
  }

  /******************************************************************
   * 11. 初始化
   ******************************************************************/
  function deleteHistoryRecords(records, toastText) {
    const list = Array.isArray(records) ? records.filter(r => r && r.url && r.ts) : [];
    if (!list.length) return 0;
    const deletedKeys = new Set(list.map(r => historyRecordKey(r.url, r.ts)));
    addDeletedHistoryRecords(list);
    historyStore.records = historyStore.records.filter(r => !deletedKeys.has(historyRecordKey(r.url, r.ts)));
    saveHistory(historyStore);
    updateBadge();
    refreshHistoryTab();
    toast(toastText || `已删除 ${list.length} 条`);
    return list.length;
  }

  function deleteHistoryRecord(url, ts) {
    const record = historyStore.records.find(r => r.url === url && r.ts === ts);
    deleteHistoryRecords(record ? [record] : [{ url, ts }], '已删除');
  }
  function deleteFilteredHistoryRecords() {
    const filtered = getCurrentFilteredHistoryRecords();
    if (!filtered.length) return;
    if (!currentHistorySearch) {
      alert('请先输入关键词，避免误删。');
      return;
    }
    const desc = `关键词「${currentHistorySearch}」`;
    if (!confirm(`确定删除 ${desc} 下的 ${filtered.length} 条历史记录？\n\n删除会作为增量同步到云端。`)) return;
    deleteHistoryRecords(filtered, `已删除 ${filtered.length} 条`);
  }
  function getBlacklistRuleOptions(url) {
    const normalized = normalizeUrlForBlock(url);
    if (!normalized) return [];
    try {
      const u = new URL(normalized);
      const path = u.pathname || '/';
      const dirPath = path.endsWith('/') ? path : (path.slice(0, path.lastIndexOf('/') + 1) || '/');
      return [
        { key: 'exact', title: '只这个页面', note: '当前精确路径', rule: normalized },
        { key: 'dir', title: '当前目录下全部', note: '推荐', rule: u.origin + dirPath + '*' },
        { key: 'site', title: '整站全部页面', note: '范围最大', rule: u.origin + '/*' }
      ];
    } catch (e) {
      return [{ key: 'exact', title: '只这个页面', note: '当前精确路径', rule: normalized }];
    }
  }
  function countHistoryMatchesRule(rule) {
    return historyStore.records.filter(r => isUrlMatchingBlacklistRule(r.url, rule)).length;
  }
  function closeBlacklistRuleDialog() {
    document.getElementById('mpush-rule-overlay')?.remove();
  }
  function renderBlacklistRuleOptions(box, input, sourceUrl) {
    const options = getBlacklistRuleOptions(input.value);
    box.innerHTML = options.map(opt => {
      const count = countHistoryMatchesRule(opt.rule);
      return `<button class="mpush-rule-option" type="button" data-rule="${escapeAttr(opt.rule)}" data-source-url="${escapeAttr(sourceUrl)}">
        <span class="mpush-rule-option-title">${escapeAttr(opt.title)}</span>
        <span class="mpush-rule-option-note">${escapeAttr(opt.note)}${opt.key === 'dir' ? ' ★' : ''}</span>
        <span class="mpush-rule-pattern">${escapeAttr(opt.rule)}</span>
        <span class="mpush-rule-impact">当前会移除 ${count} 条历史记录</span>
      </button>`;
    }).join('');
    box.querySelectorAll('.mpush-rule-option').forEach(btn => {
      btn.addEventListener('click', () => applyBlacklistRule(btn.dataset.rule, btn.dataset.sourceUrl));
    });
  }
  function blacklistHistoryUrl(url) {
    const normalized = normalizeUrlForBlock(url);
    if (!normalized) return;
    closeBlacklistRuleDialog();
    const overlay = el('div', { id: 'mpush-rule-overlay', class: 'mpush-rule-overlay' });
    overlay.innerHTML = `<div class="mpush-rule-dialog" role="dialog" aria-modal="true" aria-label="把当前网址加入规则">
      <div class="mpush-rule-head">
        <div class="mpush-rule-title">📌 把当前网址加入规则</div>
        <button class="mpush-rule-close" type="button" title="关闭">×</button>
      </div>
      <input class="mpush-rule-url" id="mpush-rule-url" type="text" value="${escapeAttr(normalized)}">
      <div class="mpush-rule-options" id="mpush-rule-options"></div>
      <div class="mpush-rule-tip">提示：支持通配符 <code>*</code>。规则会加入设置里的拉黑网址列表，匹配到的历史会被删除并作为增量同步。</div>
    </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#mpush-rule-url');
    const optionsBox = overlay.querySelector('#mpush-rule-options');
    const close = () => closeBlacklistRuleDialog();
    overlay.querySelector('.mpush-rule-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => renderBlacklistRuleOptions(optionsBox, input, normalized));
    renderBlacklistRuleOptions(optionsBox, input, normalized);
    input.focus();
    input.select();
  }
  function applyBlacklistRule(rule, sourceUrl) {
    const normalizedRule = normalizeUrlForBlock(rule);
    if (!normalizedRule) return;
    const affected = historyStore.records.filter(r => isUrlMatchingBlacklistRule(r.url, normalizedRule));
    setBlacklistedUrls(mergeBlacklistedUrls(getBlacklistedUrls(), [normalizedRule]));
    removePendingRecord(sourceUrl);
    closeBlacklistRuleDialog();
    if (affected.length) {
      deleteHistoryRecords(affected, `已加入规则，移除 ${affected.length} 条`);
    } else {
      saveHistory(historyStore);
      updateBadge();
      refreshHistoryTab();
      toast('已加入规则');
    }
  }
  function exportAnalysisAsMarkdown() {
    const lines = conversation.filter(m => m.role !== 'system' && !m.meta?.hidden).map(m => {
      const tag = m.role === 'user' ? '## 🙋 我' : '## 🤖 AI';
      return `${tag}\n\n${m.content}`;
    });
    if (!lines.length) { toast('没有内容'); return; }
    downloadText(`# 浏览分析报告 - ${formatDate(Date.now())}\n\n${lines.join('\n\n---\n\n')}`, `analysis-${formatDate(Date.now())}.md`);
    toast('已导出 Markdown');
  }
  let _historyDisplayCount = 200;
  function loadMoreHistory() { _historyDisplayCount += 200; refreshHistoryTab(); }

  function init() {
    buildUI();
    // 先记录当前页面，再更新角标
    if (cfg.history?.enabled && !shouldFilterTitle(document.title)) {
      const visitTs = Date.now();
      startDwellSession(window.location.href, document.title, visitTs);
      addHistoryRecord(window.location.href, document.title, false, visitTs);
    }
    updateBadge();
    // 恢复上次分析结果
    restoreAnalysisHistory();
    // 存储配额检查
    checkStorageQuota();
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开面板', () => { const panel = document.getElementById(UI.panelId); if (panel) { panel.classList.add('show'); cfg = loadConfig(); refreshHistoryTab(); updateBadge(); } });
      GM_registerMenuCommand('分析未读记录', () => { const panel = document.getElementById(UI.panelId); if (panel) panel.classList.add('show'); switchTab('analysis'); const unread = historyStore.records.filter(r => isUnread(r)); if (unread.length && cfg.profiles?.[0]?.apiKey) runAnalysis(unread, '最近未读记录', 'summary'); else toast(unread.length ? '请先配置 API' : '没有未读记录'); });
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => cleanExpiredRecords()); else setTimeout(cleanExpiredRecords, 5000);
    // 定时自动同步（按配置间隔，仅在配置了坚果云时生效）
    setInterval(async () => {
      try {
        cfg = loadConfig();
        const intervalMs = getAutoSyncIntervalMs();
        if (intervalMs <= 0) return; // 关闭自动同步
        if (!cfg.cloudSync?.account || !cfg.cloudSync?.appPassword) return;
        const syncMeta = loadHistorySyncMeta();
        if (syncMeta.backoffUntil && Date.now() < syncMeta.backoffUntil) return;
        if (syncMeta.lastSyncAt && (Date.now() - syncMeta.lastSyncAt) < intervalMs) return;
        await historySyncAutoUploadDelta();
        if (historyTabEl) updateSyncStatus();
      } catch (e) {
        const msg = String(e?.message || e || '');
        if (/(429|503|507|509|频率|流量|quota|limit)/i.test(msg)) {
          const syncMeta = loadHistorySyncMeta();
          saveHistorySyncMeta({ ...syncMeta, backoffUntil: Date.now() + 30 * 60 * 1000, lastError: msg.slice(0, 120) });
        }
      }
    }, 60 * 1000); // 每分钟本地检查一次是否到了同步时间
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') commitDwellSession(true);
    else resumeDwellSession();
  });
  window.addEventListener('pagehide', () => finishDwellSession(true));
  // 页面离开时，清理未达停留阈值的待确认记录
  window.addEventListener('beforeunload', () => {
    finishDwellSession(true);
    const currentUrl = window.location.href;
    removePendingRecord(currentUrl);
  });

  // ── SPA 路由监听：页面内链接切换时记录浏览 ──
  let __lastUrl = location.href;
  function handleUrlChanged() {
    const newUrl = location.href;
    if (newUrl === __lastUrl) return;
    finishDwellSession(true);
    __lastUrl = newUrl;
    const title = document.title;
    if (cfg.history?.enabled && !shouldFilterTitle(title)) {
      // 等待页面标题更新后再记录
      setTimeout(() => {
        if (window.location.href !== newUrl) return;
        const visitTs = Date.now();
        startDwellSession(window.location.href, document.title, visitTs);
        addHistoryRecord(window.location.href, document.title, false, visitTs);
        updateBadge();
      }, 500);
    }
  }

  // 轮询兜底
  setInterval(handleUrlChanged, 1000);
  // 拦截 history API
  const _origPush = history.pushState;
  const _origReplace = history.replaceState;
  history.pushState = function (...args) { const r = _origPush.apply(this, args); setTimeout(handleUrlChanged, 50); return r; };
  history.replaceState = function (...args) { const r = _origReplace.apply(this, args); setTimeout(handleUrlChanged, 50); return r; };
  window.addEventListener('popstate', () => setTimeout(handleUrlChanged, 50));
  window.addEventListener('hashchange', () => setTimeout(handleUrlChanged, 50));
})();
