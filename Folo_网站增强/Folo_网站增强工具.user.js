// ==UserScript==
// @name         Folo 网站增强工具
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      13.4.5
// @description  Folo 增强：Jina Reader + Readability + 启发式三级抓取 + AI 总结 + 自动总结 + 后续对话 + 多配置管理 + 坚果云 WebDAV 同步 + 复制对话 + 保存到 flomo
// @author       次元饺子
// @icon         https://img.icons8.com/?size=100&id=90385&format=png&color=000000
// @match        https://app.folo.is/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-start
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/576150/Folo%20%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA%E5%B7%A5%E5%85%B7%20%28v134%20flomo%E9%9B%86%E6%88%90%E7%89%88%29.user.js
// @updateURL https://update.greasyfork.org/scripts/576150/Folo%20%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA%E5%B7%A5%E5%85%B7%20%28v134%20flomo%E9%9B%86%E6%88%90%E7%89%88%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    console.log("🚀 Folo 增强脚本 v13.4 (flomo集成版) 已启动");

    // ==================== 0. 内联 Markdown 渲染器（含 GFM 表格） ====================
    const _md = (function() {
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

        // 解析表格行 "| a | b | c |" -> ["a","b","c"]
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
        // 判断是否是分隔行 |---|:--:|---:|
        function isTableSeparator(line) {
            if (!/\|/.test(line)) return false;
            const cells = parseTableRow(line);
            if (cells.length === 0) return false;
            return cells.every(c => /^:?-{1,}:?$/.test(c.trim()));
        }
        // 从分隔行解析每列对齐方式
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

                // GFM 表格识别
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

    // ==================== 1. 工具函数 ====================
    function normalizeApiUrl(url) {
        if (!url) return "";
        let cleanUrl = url.trim();
        if (cleanUrl.endsWith('#')) return cleanUrl.slice(0, -1);
        if (cleanUrl.includes('/chat/completions')) return cleanUrl;
        if (cleanUrl.endsWith('/')) return cleanUrl + 'chat/completions';
        return cleanUrl + '/v1/chat/completions';
    }
    function getModelsUrl(chatUrl) { return chatUrl.replace(/\/chat\/completions$/, '/models'); }

    function getCleanArticleText(articleNode) {
        if (!articleNode) return "";
        const clone = articleNode.cloneNode(true);
        clone.querySelectorAll('.custom-copy-btn, #my-custom-ai-wrapper').forEach(el => el.remove());
        clone.querySelectorAll('button').forEach(el => el.remove());
        clone.querySelectorAll('a').forEach(a => {
            if (a.innerText.includes("阅读完整话题")) {
                if (a.parentElement && a.parentElement.tagName === 'P') a.parentElement.remove();
                else a.remove();
            }
        });
        const metaRegex = /^\s*\d+\s*个帖子\s*[\-—]\s*\d+\s*位参与者/i;
        clone.querySelectorAll('p').forEach(p => { if (metaRegex.test(p.innerText)) p.remove(); });
        return clone.innerText.trim();
    }

    function getOriginalUrl(articleNode) {
        if (!articleNode) return null;
        const titleLink = articleNode.querySelector('a[target="_blank"][class*="text-[1.7rem]"]')
                       || document.querySelector('a[target="_blank"][class*="text-[1.7rem]"]');
        if (titleLink && titleLink.href && /^https?:\/\//.test(titleLink.href)) return titleLink.href;
        const firstExternal = articleNode.querySelector('a[target="_blank"][href^="http"]');
        if (firstExternal) return firstExternal.href;
        return null;
    }

    function getArticleTitle(articleNode) {
        if (!articleNode) return "文章";
        const titleEl = articleNode.querySelector('a[class*="text-[1.7rem]"]')
                     || document.querySelector('a[class*="text-[1.7rem]"]');
        if (titleEl) return titleEl.innerText.trim();
        return document.title || "文章";
    }

    // ==================== 2. 三级抓取策略 ====================
    function fetchViaJinaReader(url) {
        return new Promise((resolve, reject) => {
            const jinaUrl = "https://r.jina.ai/" + url;
            GM_xmlhttpRequest({
                method: "GET",
                url: jinaUrl,
                headers: {
                    "Accept": "text/plain",
                    "X-Return-Format": "markdown",
                    "X-Timeout": "20"
                },
                timeout: 30000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300 && res.responseText && res.responseText.length > 100) {
                        let md = res.responseText;
                        let title = "";
                        const titleMatch = md.match(/^Title:\s*(.+)$/m);
                        if (titleMatch) title = titleMatch[1].trim();
                        md = md.replace(/^Title:\s*.+\n/m, '')
                               .replace(/^URL Source:\s*.+\n/m, '')
                               .replace(/^Published Time:\s*.+\n/m, '')
                               .replace(/^Markdown Content:\s*\n?/m, '')
                               .trim();
                        resolve({ title: title, text: md, length: md.length, method: 'Jina Reader 🌟' });
                    } else {
                        reject(new Error(`Jina HTTP ${res.status}`));
                    }
                },
                onerror: () => reject(new Error("Jina 网络错误")),
                ontimeout: () => reject(new Error("Jina 超时"))
            });
        });
    }

    let _Readability = null;
    let _readabilityLoading = null;
    function loadReadability() {
        if (_Readability) return Promise.resolve(_Readability);
        if (_readabilityLoading) return _readabilityLoading;
        _readabilityLoading = new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js",
                timeout: 15000,
                onload: (res) => {
                    if (res.status !== 200) return reject(new Error("Readability 下载失败"));
                    try {
                        const sandbox = { module: { exports: {} }, exports: {} };
                        const code = res.responseText + '\n;return (typeof Readability !== "undefined") ? Readability : (module.exports || exports);';
                        const fn = new Function('module', 'exports', code);
                        _Readability = fn(sandbox.module, sandbox.exports);
                        if (!_Readability) return reject(new Error("Readability 加载后为空"));
                        resolve(_Readability);
                    } catch (e) { reject(e); }
                },
                onerror: () => reject(new Error("Readability CDN 网络错误")),
                ontimeout: () => reject(new Error("Readability CDN 超时"))
            });
        });
        return _readabilityLoading;
    }

    function fetchOriginalHtml(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: {
                    "User-Agent": navigator.userAgent,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                    "Referer": new URL(url).origin + "/"
                },
                timeout: 20000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 400) resolve(res.responseText);
                    else reject(new Error(`HTTP ${res.status}`));
                },
                onerror: () => reject(new Error("网络错误")),
                ontimeout: () => reject(new Error("请求超时"))
            });
        });
    }

    async function fetchViaReadability(url) {
        const Readability = await loadReadability();
        const html = await fetchOriginalHtml(url);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        try {
            if (!doc.querySelector('base')) {
                const base = doc.createElement('base');
                base.href = url;
                doc.head && doc.head.insertBefore(base, doc.head.firstChild);
            }
        } catch(e){}
        const article = new Readability(doc.cloneNode(true), { charThreshold: 200 }).parse();
        if (!article || !article.textContent || article.textContent.length < 200) {
            throw new Error("Readability 提取过短: " + (article ? article.textContent.length : 0));
        }
        const text = article.textContent.trim().replace(/\n{3,}/g, '\n\n');
        return { title: article.title || "", text: text, length: text.length, method: 'Readability.js 📖' };
    }

    function extractArticleFromHtml(htmlString, sourceUrl) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        try {
            const base = doc.createElement('base');
            base.href = sourceUrl;
            doc.head && doc.head.appendChild(base);
        } catch(e){}
        let title = "";
        const ogTitle = doc.querySelector('meta[property="og:title"]');
        if (ogTitle) title = ogTitle.getAttribute('content') || "";
        if (!title) { const h1 = doc.querySelector('h1'); if (h1) title = h1.innerText || h1.textContent || ""; }
        if (!title && doc.title) title = doc.title;
        const removeSelectors = [
            'script', 'style', 'noscript', 'iframe', 'svg',
            'nav', 'header', 'footer', 'aside',
            '.nav', '.navbar', '.header', '.footer', '.sidebar', '.aside',
            '.comment', '.comments', '#comments', '.comment-list',
            '.advertisement', '.ads', '.ad', '.advert',
            '.share', '.social', '.related', '.recommend', '.recommendation',
            '.breadcrumb', '.pagination',
            '[class*="sidebar"]', '[id*="sidebar"]',
            '[class*="comment"]', '[id*="comment"]',
            '[class*="recommend"]', '[class*="related"]'
        ];
        removeSelectors.forEach(sel => { try { doc.querySelectorAll(sel).forEach(el => el.remove()); } catch(e){} });
        const candidateSelectors = [
            'article', '[itemprop="articleBody"]',
            '.post-content', '.entry-content', '.article-content', '.article-body',
            '.post-body', '.content-article', '.markdown-body', '.rich_media_content',
            '#content', '#main-content', '#article', '#post', 'main'
        ];
        let bestNode = null, bestScore = 0;
        for (const sel of candidateSelectors) {
            doc.querySelectorAll(sel).forEach(node => {
                const text = (node.innerText || node.textContent || "").trim();
                const score = text.length + node.querySelectorAll('p').length * 50;
                if (score > bestScore) { bestScore = score; bestNode = node; }
            });
        }
        if (!bestNode || bestScore < 200) {
            doc.querySelectorAll('div, section').forEach(div => {
                const text = (div.innerText || div.textContent || "").trim();
                if (text.length < 200) return;
                const links = div.querySelectorAll('a');
                let linkTextLen = 0;
                links.forEach(a => linkTextLen += (a.innerText || "").length);
                const linkRatio = linkTextLen / text.length;
                if (linkRatio > 0.5) return;
                const pCount = div.querySelectorAll('p').length;
                const score = text.length * (1 - linkRatio) + pCount * 30;
                if (score > bestScore) { bestScore = score; bestNode = div; }
            });
        }
        let bodyText = "";
        if (bestNode) {
            bestNode.querySelectorAll('script, style, noscript').forEach(el => el.remove());
            bodyText = (bestNode.innerText || bestNode.textContent || "").trim();
            bodyText = bodyText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
        }
        return { title: title.trim(), text: bodyText, length: bodyText.length, method: '启发式算法 🔧' };
    }

    async function fetchViaHeuristic(url) {
        const html = await fetchOriginalHtml(url);
        const parsed = extractArticleFromHtml(html, url);
        if (!parsed.text || parsed.text.length < 200) {
            throw new Error("启发式提取过短: " + parsed.length);
        }
        return parsed;
    }

    async function smartFetchArticle(url, strategies, onProgress) {
        const errors = [];
        for (const strat of strategies) {
            try {
                onProgress && onProgress(strat);
                let result;
                if (strat === 'jina') result = await fetchViaJinaReader(url);
                else if (strat === 'readability') result = await fetchViaReadability(url);
                else if (strat === 'heuristic') result = await fetchViaHeuristic(url);
                else continue;
                if (result && result.text && result.text.length >= 200) {
                    result.attemptedStrategies = errors.map(e => e.strat);
                    return result;
                }
                errors.push({ strat, err: '内容过短' });
            } catch (e) {
                console.warn(`[Folo增强] 策略 ${strat} 失败：`, e.message);
                errors.push({ strat, err: e.message });
            }
        }
        const errMsg = errors.map(e => `${e.strat}: ${e.err}`).join(' | ');
        throw new Error("所有策略都失败：" + errMsg);
    }

    // ==================== 3. 配置管理 ====================
    const DEFAULT_PROFILE = {
        id: "default", name: "默认配置",
        apiUrl: "https://api.openai.com", apiKey: "", model: "gpt-3.5-turbo",
        prompt: "请简要总结以下文章内容,提取 3-5 个核心观点,使用中文回答："
    };

    function getFetchFulltextEnabled() { return GM_getValue("ai_fetch_fulltext", true) !== false; }
    function setFetchFulltextEnabled(v) { GM_setValue("ai_fetch_fulltext", !!v); }
    function getMaxChars() { return GM_getValue("ai_max_chars", 12000); }
    function setMaxChars(v) { GM_setValue("ai_max_chars", v); }

    function getAutoSummarizeEnabled() { return GM_getValue("ai_auto_summarize", false) === true; }
    function setAutoSummarizeEnabled(v) { GM_setValue("ai_auto_summarize", !!v); }

    function getExtractStrategies() {
        return GM_getValue("ai_extract_strategies", ['jina', 'readability', 'heuristic']);
    }
    function setExtractStrategies(arr) { GM_setValue("ai_extract_strategies", arr); }

    function getFlomoApiUrl() { return GM_getValue("ai_flomo_api_url", ""); }
    function setFlomoApiUrl(v) { GM_setValue("ai_flomo_api_url", String(v || "").trim()); }

    function getProfiles() {
        let profiles = GM_getValue("ai_profiles", []);
        if (!profiles || profiles.length === 0) { profiles = [DEFAULT_PROFILE]; GM_setValue("ai_profiles", profiles); }
        return profiles;
    }
    function getCurrentProfileId() { return GM_getValue("ai_current_profile_id", "default"); }
    function getActiveConfig() {
        const profiles = getProfiles();
        return profiles.find(p => p.id === getCurrentProfileId()) || profiles[0];
    }
    function saveProfiles(profiles, activeId) {
        GM_setValue("ai_profiles", profiles);
        if (activeId) GM_setValue("ai_current_profile_id", activeId);
    }

    // ==================== 3.5. 坚果云 WebDAV 同步 ====================
    const WEBDAV_BASE = 'https://dav.jianguoyun.com/dav/';
    const WEBDAV_FOLDER = 'folo-sync';
    const WEBDAV_FILENAME = 'folo-ai-sync.json';
    const WEBDAV_FOLDER_URL = WEBDAV_BASE + WEBDAV_FOLDER + '/';
    const WEBDAV_FILE_URL  = WEBDAV_FOLDER_URL + WEBDAV_FILENAME;

    function getWebDAVUser() { return GM_getValue("webdav_user", ""); }
    function setWebDAVUser(v) { GM_setValue("webdav_user", v || ""); }
    function getWebDAVPass() { return GM_getValue("webdav_pass", ""); }
    function setWebDAVPass(v) { GM_setValue("webdav_pass", v || ""); }

    function getWebDAVAuth() {
        const user = getWebDAVUser();
        const pass = getWebDAVPass();
        if (!user || !pass) return null;
        return 'Basic ' + btoa(unescape(encodeURIComponent(user + ':' + pass)));
    }

    function buildLocalSyncPayload() {
        return {
            version: 2,
            updatedAt: new Date().toISOString(),
            profiles: getProfiles(),
            currentProfileId: getCurrentProfileId(),
            extractStrategies: getExtractStrategies(),
            autoSummarize: getAutoSummarizeEnabled(),
            fetchFulltext: getFetchFulltextEnabled(),
            maxChars: getMaxChars(),
            flomoApiUrl: getFlomoApiUrl()
        };
    }

    function applyRemotePayloadToLocal(remote) {
        if (!remote || typeof remote !== 'object') throw new Error("云端数据格式错误");
        if (Array.isArray(remote.profiles) && remote.profiles.length > 0) {
            saveProfiles(remote.profiles, remote.currentProfileId || remote.profiles[0].id);
        }
        if (Array.isArray(remote.extractStrategies)) setExtractStrategies(remote.extractStrategies);
        if (typeof remote.autoSummarize === 'boolean') setAutoSummarizeEnabled(remote.autoSummarize);
        if (typeof remote.fetchFulltext === 'boolean') setFetchFulltextEnabled(remote.fetchFulltext);
        if (typeof remote.maxChars === 'number') setMaxChars(remote.maxChars);
        if (typeof remote.flomoApiUrl === 'string') setFlomoApiUrl(remote.flomoApiUrl);
    }

    function mergeProfiles(baseList, patchList) {
        const map = new Map();
        baseList.forEach(p => map.set(p.id, { ...p }));
        patchList.forEach(p => {
            if (map.has(p.id)) {
                map.set(p.id, { ...map.get(p.id), ...p });
            } else {
                map.set(p.id, { ...p });
            }
        });
        return Array.from(map.values());
    }

    function webdavRequest(method, url, opts) {
        opts = opts || {};
        return new Promise((resolve, reject) => {
            const auth = getWebDAVAuth();
            if (!auth) return reject(new Error("请先填写坚果云账号和应用密码"));
            const headers = { 'Authorization': auth };
            if (opts.contentType) headers['Content-Type'] = opts.contentType;
            if (method === 'PUT') headers['Overwrite'] = 'T';
            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: headers,
                data: opts.data,
                timeout: 20000,
                onload: (res) => {
                    console.log(`[WebDAV ${method}]`, url, '→', res.status);
                    resolve(res);
                },
                onerror: () => reject(new Error("网络错误")),
                ontimeout: () => reject(new Error("请求超时"))
            });
        });
    }

    async function ensureWebDAVFolder() {
        const res = await webdavRequest('MKCOL', WEBDAV_FOLDER_URL);
        if (res.status === 201 || res.status === 405 || res.status === 301) return true;
        if (res.status === 401) throw new Error("认证失败,请检查邮箱和应用密码");
        if (res.status === 403) throw new Error("权限不足,请确认应用密码有写入权限");
        console.warn("[WebDAV] MKCOL 返回非预期状态:", res.status, res.responseText);
        return true;
    }

    async function webdavDownload() {
        const res = await webdavRequest('GET', WEBDAV_FILE_URL);
        if (res.status === 200) {
            try { return JSON.parse(res.responseText); }
            catch(e) { throw new Error("云端文件不是合法 JSON"); }
        }
        if (res.status === 404) return null;
        if (res.status === 401) throw new Error("认证失败,请检查邮箱和应用密码");
        throw new Error(`下载失败 HTTP ${res.status}`);
    }

    async function webdavUploadRaw(payload) {
        await ensureWebDAVFolder();
        const res = await webdavRequest('PUT', WEBDAV_FILE_URL, {
            data: JSON.stringify(payload, null, 2),
            contentType: 'application/json'
        });
        if (res.status >= 200 && res.status < 300) return true;
        if (res.status === 401) throw new Error("认证失败,请检查邮箱和应用密码");
        if (res.status === 403) throw new Error("权限不足或路径不允许写入");
        if (res.status === 404) throw new Error("路径不存在(文件夹创建失败?)");
        if (res.status === 409) throw new Error("冲突,可能是父文件夹不存在");
        throw new Error(`上传失败 HTTP ${res.status} ${res.responseText ? '· ' + res.responseText.substring(0,80) : ''}`);
    }

    async function syncUploadIncremental() {
        const local = buildLocalSyncPayload();
        let remote = null;
        try { remote = await webdavDownload(); } catch(e) {
            if (!/HTTP 404/.test(e.message)) throw e;
        }
        let merged;
        if (!remote) {
            merged = local;
        } else {
            merged = {
                version: 2,
                updatedAt: new Date().toISOString(),
                profiles: mergeProfiles(remote.profiles || [], local.profiles || []),
                currentProfileId: local.currentProfileId || remote.currentProfileId,
                extractStrategies: local.extractStrategies || remote.extractStrategies,
                autoSummarize: typeof local.autoSummarize === 'boolean' ? local.autoSummarize : remote.autoSummarize,
                fetchFulltext: typeof local.fetchFulltext === 'boolean' ? local.fetchFulltext : remote.fetchFulltext,
                maxChars: typeof local.maxChars === 'number' ? local.maxChars : remote.maxChars,
                flomoApiUrl: local.flomoApiUrl || remote.flomoApiUrl || ""
            };
        }
        await webdavUploadRaw(merged);
        return merged;
    }

    async function syncDownloadIncremental() {
        const remote = await webdavDownload();
        if (!remote) throw new Error("云端没有同步文件,请先上传一次");
        const local = buildLocalSyncPayload();
        const merged = {
            version: 2,
            updatedAt: new Date().toISOString(),
            profiles: mergeProfiles(local.profiles || [], remote.profiles || []),
            currentProfileId: remote.currentProfileId || local.currentProfileId,
            extractStrategies: remote.extractStrategies || local.extractStrategies,
            autoSummarize: typeof remote.autoSummarize === 'boolean' ? remote.autoSummarize : local.autoSummarize,
            fetchFulltext: typeof remote.fetchFulltext === 'boolean' ? remote.fetchFulltext : local.fetchFulltext,
            maxChars: typeof remote.maxChars === 'number' ? remote.maxChars : local.maxChars,
            flomoApiUrl: remote.flomoApiUrl || local.flomoApiUrl || ""
        };
        applyRemotePayloadToLocal(merged);
        return merged;
    }

    async function syncForceUploadOverwrite() {
        const local = buildLocalSyncPayload();
        await webdavUploadRaw(local);
        return local;
    }

    // ==================== 4. 菜单命令 ====================
    GM_registerMenuCommand("⚙️ 设置 AI API", showSettingsModal);
    GM_registerMenuCommand("🔁 切换『抓取原文全文』(当前: " + (getFetchFulltextEnabled() ? "开" : "关") + ")", () => {
        setFetchFulltextEnabled(!getFetchFulltextEnabled());
        alert("已切换。当前：" + (getFetchFulltextEnabled() ? "开启抓取原文" : "仅使用 Folo 预览"));
    });
    GM_registerMenuCommand("🤖 切换『自动总结』(当前: " + (getAutoSummarizeEnabled() ? "开" : "关") + ")", () => {
        setAutoSummarizeEnabled(!getAutoSummarizeEnabled());
        alert("已切换。当前：" + (getAutoSummarizeEnabled() ? "开启自动总结" : "关闭自动总结"));
    });

    // ==================== 4. 样式 ====================
    GM_addStyle(`
        article[data-testid="entry-render"], #follow-entry-render { user-select: text !important; -webkit-user-select: text !important; }
        .folo-native-ai-hidden { display: none !important; }
        .custom-copy-btn { position: absolute !important; top: 0px; right: 0px; z-index: 50; padding: 4px 10px !important; background: rgba(59, 130, 246, 0.9); color: white; border: none; border-radius: 0 0 0 8px; cursor: pointer; font-size: 12px; opacity: 0.6; }
        .custom-copy-btn:hover { opacity: 1; }
        #my-custom-ai-wrapper { margin: 1.5rem 0; width: 100%; position: relative; z-index: 10; animation: fadeIn 0.4s ease; transition: all 0.3s; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .my-ai-box { padding: 1rem; border-radius: 12px; border: 1px solid rgba(139, 92, 246, 0.3); background: linear-gradient(135deg, rgba(239, 246, 255, 0.8) 0%, rgba(250, 245, 255, 0.8) 100%); backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); color: #1f2937; }
        .dark .my-ai-box { background: linear-gradient(135deg, rgba(30, 20, 60, 0.7) 0%, rgba(20, 30, 60, 0.7) 100%); border-color: rgba(139, 92, 246, 0.4); color: #e5e7eb; }
        .my-ai-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 6px; }
        .my-ai-title { font-weight: 700; font-size: 0.95rem; background: linear-gradient(to right, #7c3aed, #2563eb); -webkit-background-clip: text; color: transparent; }
        .my-ai-btn { background: linear-gradient(to right, #7c3aed, #2563eb); color: white; border: none; padding: 5px 14px; border-radius: 99px; cursor: pointer; font-weight: 600; font-size: 0.8rem; }
        .my-ai-btn:disabled { background: #999; cursor: not-allowed; }
        .my-ai-mode-toggle { font-size: 0.75rem; cursor: pointer; padding: 3px 8px; border-radius: 99px; background: rgba(139,92,246,0.1); color: #7c3aed; border: 1px solid rgba(139,92,246,0.3); user-select: none; }
        .my-ai-mode-toggle.active { background: rgba(16,185,129,0.15); color: #10b981; border-color: rgba(16,185,129,0.4); }
        .my-ai-auto-badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 99px; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.4); user-select: none; }
        .my-ai-setting-icon { cursor: pointer; color: #7c3aed; font-size: 1.1rem; opacity: 0.7; margin-left: 6px; }
        .my-ai-content { font-size: 0.95rem; line-height: 1.7; padding-top: 0.8rem; border-top: 1px dashed rgba(139, 92, 246, 0.3); margin-top: 8px; }
        .my-ai-status { font-size: 0.8rem; color: #888; margin-top: 4px; }

        .my-ai-chat-area { margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(139,92,246,0.3); display: none; }
        .my-ai-chat-history { max-height: 400px; overflow-y: auto; margin-bottom: 8px; }
        .my-ai-chat-msg { padding: 8px 12px; border-radius: 10px; margin: 6px 0; font-size: 0.9rem; line-height: 1.6; word-wrap: break-word; }
        .my-ai-chat-msg.user { background: rgba(37,99,235,0.12); border: 1px solid rgba(37,99,235,0.25); margin-left: 30px; }
        .dark .my-ai-chat-msg.user { background: rgba(37,99,235,0.2); }
        .my-ai-chat-msg.assistant { background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.2); margin-right: 30px; }
        .dark .my-ai-chat-msg.assistant { background: rgba(139,92,246,0.15); }
        .my-ai-chat-msg .role-label { font-size: 0.7rem; opacity: 0.6; font-weight: 700; margin-bottom: 3px; display: block; }
        .my-ai-chat-input-row { display: flex; gap: 6px; align-items: flex-end; }
        .my-ai-chat-input { flex: 1; padding: 8px 10px; border: 1px solid rgba(139,92,246,0.3); border-radius: 8px; resize: vertical; min-height: 38px; max-height: 150px; font-family: inherit; font-size: 0.9rem; background: rgba(255,255,255,0.6); color: inherit; box-sizing: border-box; }
        .dark .my-ai-chat-input { background: rgba(0,0,0,0.3); color: #e5e7eb; border-color: rgba(139,92,246,0.4); }
        .my-ai-chat-input:focus { outline: none; border-color: #7c3aed; }
        .my-ai-chat-send { background: linear-gradient(to right, #7c3aed, #2563eb); color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.85rem; white-space: nowrap; }
        .my-ai-chat-send:disabled { background: #999; cursor: not-allowed; }

        .my-ai-chat-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
        .my-ai-chat-clear, .my-ai-chat-copy, .my-ai-chat-flomo {
            background: transparent;
            border: 1px solid #ccc;
            padding: 4px 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.75rem;
            color: #888;
            transition: all 0.15s;
        }
        .my-ai-chat-clear:hover { background: rgba(0,0,0,0.05); }
        .my-ai-chat-copy {
            border-color: rgba(139,92,246,0.4);
            color: #7c3aed;
        }
        .my-ai-chat-copy:hover { background: rgba(139,92,246,0.1); }
        .my-ai-chat-flomo {
            border-color: rgba(16,185,129,0.5);
            color: #10b981;
        }
        .my-ai-chat-flomo:hover { background: rgba(16,185,129,0.1); }
        .my-ai-chat-flomo:disabled, .my-ai-chat-copy:disabled {
            opacity: 0.5; cursor: not-allowed;
        }
        .dark .my-ai-chat-copy { color: #a78bfa; }
        .dark .my-ai-chat-flomo { color: #34d399; }

        #my-config-modal { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: none; align-items: center; justify-content: center; }
        .my-modal-content { background: white; width: 90%; max-width: 540px; border-radius: 12px; padding: 20px; max-height: 90vh; overflow-y: auto; }
        .dark .my-modal-content { background: #1e1e2e; color: #eee; border: 1px solid #444; }
        .my-modal-header { display: flex; justify-content: space-between; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px; font-weight: bold; }
        .profile-row { display: flex; gap: 8px; margin-bottom: 15px; align-items: center; }
        .profile-select { flex: 1; padding: 6px; border-radius: 4px; }
        .profile-btn { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: #f3f4f6; }
        .dark .profile-select, .dark .profile-btn { background: #2a2a3c; border-color: #555; color: white; }
        .profile-current-badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgba(124,58,237,0.12); color: #7c3aed; border: 1px solid rgba(124,58,237,0.3); white-space: nowrap; }
        .dark .profile-current-badge { background: rgba(167,139,250,0.18); color: #c4b5fd; }
        .my-input-group { margin-bottom: 12px; }
        .my-input-label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; font-weight: bold; }
        .dark .my-input-label { color: #aaa; }
        .my-input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .dark .my-input { background: #2a2a3c; border-color: #555; color: #fff; }
        .password-wrapper { position: relative; display: flex; align-items: center; }
        .password-wrapper input { padding-right: 60px; }
        .pw-actions { position: absolute; right: 5px; display: flex; gap: 4px; cursor: pointer; }
        .btn-tool { padding: 8px; background: #e9ecef; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap; }
        .dark .btn-tool { background: #3a3a4c; border-color: #555; color: #eee; }
        .my-modal-actions { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; }
        .btn-test { background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        .btn-save { background: #7c3aed; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
        .btn-cancel { background: transparent; border: 1px solid #ccc; padding: 8px 16px; border-radius: 4px; cursor: pointer; color: #666; }
        datalist { display: none; }
        .strategy-row { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb; }
        .dark .strategy-row { background: #2a2a3c; border-color: #555; }
        .strategy-row label { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
        .strategy-row .desc { font-size: 11px; color: #888; margin-left: 24px; }

        .auto-summary-row { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: #f0fdf4; border-radius: 6px; border: 1px solid #bbf7d0; }
        .dark .auto-summary-row { background: #1a2e1f; border-color: #2d5a3a; }
        .auto-summary-row label { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
        .auto-summary-row .desc { font-size: 11px; color: #888; margin-left: 24px; }

        .flomo-section { padding: 10px; background: #ecfdf5; border-radius: 6px; border: 1px solid #6ee7b7; }
        .dark .flomo-section { background: #0f2a1f; border-color: #15803d; }
        .flomo-section .desc { font-size: 11px; color: #888; margin-top: 4px; line-height: 1.5; }

        .webdav-section { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #fff7ed; border-radius: 8px; border: 1px solid #fed7aa; }
        .dark .webdav-section { background: #2a1f15; border-color: #6b3a1a; }
        .webdav-fixed-url { font-family: monospace; font-size: 12px; padding: 6px 10px; background: rgba(0,0,0,0.05); border-radius: 4px; color: #666; word-break: break-all; }
        .dark .webdav-fixed-url { background: rgba(255,255,255,0.06); color: #aaa; }
        .webdav-btns { display: flex; gap: 8px; flex-wrap: wrap; }
        .webdav-btn { flex: 1; min-width: 110px; padding: 8px 10px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; color: white; }
        .webdav-btn.up { background: #2563eb; }
        .webdav-btn.up:hover { background: #1d4ed8; }
        .webdav-btn.down { background: #10b981; }
        .webdav-btn.down:hover { background: #059669; }
        .webdav-btn.force { background: #dc2626; }
        .webdav-btn.force:hover { background: #b91c1c; }
        .webdav-btn:disabled { background: #999 !important; cursor: not-allowed; }
        .webdav-status { font-size: 12px; color: #666; min-height: 18px; padding: 4px 0; }
        .dark .webdav-status { color: #aaa; }
        .webdav-status.success { color: #10b981; }
        .webdav-status.error { color: #dc2626; }

        .my-ai-content h1, .my-ai-content h2, .my-ai-content h3 { font-weight: 700; margin: 0.8em 0 0.4em; color: #4c1d95; }
        .dark .my-ai-content h1, .dark .my-ai-content h2, .dark .my-ai-content h3 { color: #c4b5fd; }
        .my-ai-content h1 { font-size: 1.25rem; } .my-ai-content h2 { font-size: 1.15rem; } .my-ai-content h3 { font-size: 1.05rem; }
        .my-ai-content p { margin: 0.5em 0; line-height: 1.75; }
        .my-ai-content strong { color: #7c3aed; }
        .dark .my-ai-content strong { color: #a78bfa; }
        .my-ai-content ul, .my-ai-content ol { padding-left: 1.6em; margin: 0.5em 0; }
        .my-ai-content li { margin: 0.2em 0; }
        .my-ai-content code { background: rgba(139,92,246,0.12); padding: 1px 6px; border-radius: 4px; font-size: 0.88em; color: #be185d; }
        .my-ai-content pre { background: rgba(15,23,42,0.05); padding: 0.8em; border-radius: 8px; overflow-x: auto; }
        .dark .my-ai-content pre { background: rgba(15,23,42,0.5); }
        .my-ai-content pre code { background: none; padding: 0; color: inherit; }
        .my-ai-content blockquote { border-left: 3px solid #7c3aed; padding: 0.3em 0.8em; background: rgba(139,92,246,0.08); margin: 0.6em 0; border-radius: 0 6px 6px 0; }
        .my-ai-content a { color: #2563eb; text-decoration: underline; }
        .dark .my-ai-content a { color: #60a5fa; }

        .my-ai-chat-msg p { margin: 0.3em 0; }
        .my-ai-chat-msg ul, .my-ai-chat-msg ol { padding-left: 1.4em; margin: 0.3em 0; }
        .my-ai-chat-msg code { background: rgba(139,92,246,0.12); padding: 1px 5px; border-radius: 3px; font-size: 0.85em; color: #be185d; }
        .my-ai-chat-msg pre { background: rgba(15,23,42,0.05); padding: 0.6em; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
        .dark .my-ai-chat-msg pre { background: rgba(15,23,42,0.5); }
        .my-ai-chat-msg pre code { background: none; padding: 0; }
        .my-ai-chat-msg a { color: #2563eb; text-decoration: underline; }
        .dark .my-ai-chat-msg a { color: #60a5fa; }

        /* Markdown 表格样式 */
        .my-ai-content .md-table-wrap,
        .my-ai-chat-msg .md-table-wrap {
            overflow-x: auto;
            margin: 0.8em 0;
            border-radius: 8px;
            border: 1px solid rgba(139, 92, 246, 0.25);
            background: rgba(255, 255, 255, 0.5);
        }
        .dark .my-ai-content .md-table-wrap,
        .dark .my-ai-chat-msg .md-table-wrap {
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(139, 92, 246, 0.35);
        }
        .my-ai-content .md-table,
        .my-ai-chat-msg .md-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.88em;
            line-height: 1.55;
        }
        .my-ai-content .md-table th,
        .my-ai-content .md-table td,
        .my-ai-chat-msg .md-table th,
        .my-ai-chat-msg .md-table td {
            padding: 8px 12px;
            border-bottom: 1px solid rgba(139, 92, 246, 0.15);
            border-right: 1px solid rgba(139, 92, 246, 0.10);
            vertical-align: top;
            text-align: left;
            word-break: break-word;
        }
        .my-ai-content .md-table th:last-child,
        .my-ai-content .md-table td:last-child,
        .my-ai-chat-msg .md-table th:last-child,
        .my-ai-chat-msg .md-table td:last-child { border-right: none; }
        .my-ai-content .md-table thead th,
        .my-ai-chat-msg .md-table thead th {
            background: linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.10));
            color: #4c1d95;
            font-weight: 700;
            white-space: nowrap;
            border-bottom: 2px solid rgba(124, 58, 237, 0.35);
        }
        .dark .my-ai-content .md-table thead th,
        .dark .my-ai-chat-msg .md-table thead th {
            background: linear-gradient(135deg, rgba(124,58,237,0.25), rgba(37,99,235,0.18));
            color: #c4b5fd;
            border-bottom-color: rgba(167,139,250,0.5);
        }
        .my-ai-content .md-table tbody tr:nth-child(even),
        .my-ai-chat-msg .md-table tbody tr:nth-child(even) {
            background: rgba(139, 92, 246, 0.04);
        }
        .dark .my-ai-content .md-table tbody tr:nth-child(even),
        .dark .my-ai-chat-msg .md-table tbody tr:nth-child(even) {
            background: rgba(139, 92, 246, 0.08);
        }
        .my-ai-content .md-table tbody tr:hover,
        .my-ai-chat-msg .md-table tbody tr:hover {
            background: rgba(124, 58, 237, 0.08);
        }
        .dark .my-ai-content .md-table tbody tr:hover,
        .dark .my-ai-chat-msg .md-table tbody tr:hover {
            background: rgba(124, 58, 237, 0.18);
        }
        .my-ai-content .md-table tbody tr:last-child td,
        .my-ai-chat-msg .md-table tbody tr:last-child td {
            border-bottom: none;
        }
        .my-ai-content .md-table code,
        .my-ai-chat-msg .md-table code {
            font-size: 0.85em;
            padding: 1px 5px;
        }
    `);

    // ==================== 5. 设置弹窗 ====================
    function showSettingsModal() {
        let modal = document.getElementById('my-config-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'my-config-modal';
            modal.innerHTML = `
                <div class="my-modal-content">
                    <div class="my-modal-header"><span>⚙️ AI API 配置</span><button id="modal-close-x" style="background:none;border:none;cursor:pointer;">✕</button></div>
                    <div class="profile-row">
                        <select id="profile-select" class="profile-select"></select>
                        <span id="profile-current-badge" class="profile-current-badge" title="当前正在编辑的配置">编辑中</span>
                        <button id="btn-add-profile" class="profile-btn" title="新建配置">➕</button>
                        <button id="btn-del-profile" class="profile-btn" title="删除当前配置">🗑️</button>
                    </div>
                    <div class="my-input-group"><label class="my-input-label">配置名称</label><input id="cfg-name" class="my-input"></div>
                    <div class="my-input-group"><label class="my-input-label">API 地址</label><input id="cfg-url" class="my-input" placeholder="https://api.openai.com"></div>
                    <div class="my-input-group"><label class="my-input-label">API Key</label><div class="password-wrapper"><input id="cfg-key" class="my-input" type="password"><div class="pw-actions"><span id="btn-toggle-pw">👁️</span><span id="btn-copy-pw">📋</span></div></div></div>
                    <div class="my-input-group"><label class="my-input-label">Model</label><div style="display:flex;gap:8px"><input id="cfg-model" class="my-input" list="model-list"><button id="btn-fetch-models" class="btn-tool">🔄 获取模型</button></div><datalist id="model-list"></datalist></div>
                    <div class="my-input-group"><label class="my-input-label">System Prompt</label><textarea id="cfg-prompt" class="my-input" rows="3"></textarea></div>

                    <div class="my-input-group">
                        <label class="my-input-label">🤖 自动总结</label>
                        <div class="auto-summary-row">
                            <label><input type="checkbox" id="cfg-auto-summarize"> 开启自动总结</label>
                            <div class="desc">开启后,点击文章条目时会按当前设置自动开始总结,无需手动点击"点击生成摘要"按钮</div>
                        </div>
                    </div>

                    <div class="my-input-group">
                        <label class="my-input-label">📡 原文抓取策略（按勾选顺序依次尝试）</label>
                        <div class="strategy-row">
                            <label><input type="checkbox" id="strat-jina"> 🌟 Jina Reader（推荐,能跑 JS、绕反爬）</label>
                            <div class="desc">免费,URL 经 r.jina.ai 转发,能搞定 SPA 站点</div>
                            <label><input type="checkbox" id="strat-readability"> 📖 Readability.js（Firefox 阅读模式同款）</label>
                            <div class="desc">本地解析,质量高但不能跑 JS</div>
                            <label><input type="checkbox" id="strat-heuristic"> 🔧 启发式算法（兜底）</label>
                            <div class="desc">内置算法,简单快速但精度一般</div>
                        </div>
                    </div>

                    <div class="my-input-group">
                        <label class="my-input-label">🌱 flomo API URL（可选）</label>
                        <div class="flomo-section">
                            <input id="cfg-flomo-url" class="my-input" type="text" placeholder="https://flomoapp.com/iwh/xxxxx/yyyyyyyy/">
                            <div class="desc">
                                填写后,可在对话框中一键将"AI 总结 + 后续对话"保存到 flomo（需 PRO 会员）。<br>
                                获取地址：flomo App → 我的 → API & Webhook
                            </div>
                        </div>
                    </div>

                    <div class="my-input-group">
                        <label class="my-input-label">☁️ 坚果云 WebDAV 同步</label>
                        <div class="webdav-section">
                            <div>
                                <div style="font-size:11px;color:#888;margin-bottom:3px;">WebDAV 地址（固定）</div>
                                <div class="webdav-fixed-url">${WEBDAV_FILE_URL}</div>
                            </div>
                            <div>
                                <div style="font-size:11px;color:#888;margin-bottom:3px;">坚果云账号（邮箱）</div>
                                <input id="webdav-user" class="my-input" type="email" placeholder="your@email.com">
                            </div>
                            <div>
                                <div style="font-size:11px;color:#888;margin-bottom:3px;">应用密码（不是登录密码！请在坚果云"安全选项→第三方应用管理"生成）</div>
                                <div class="password-wrapper">
                                    <input id="webdav-pass" class="my-input" type="password" placeholder="例如 abcd1234efgh5678">
                                    <div class="pw-actions">
                                        <span id="btn-toggle-webdav-pw">👁️</span>
                                    </div>
                                </div>
                            </div>
                            <div class="webdav-btns">
                                <button id="btn-webdav-up" class="webdav-btn up" title="本地配置增量合并到云端">⬆️ 上传到云端</button>
                                <button id="btn-webdav-down" class="webdav-btn down" title="云端配置增量合并到本地">⬇️ 从云端下载</button>
                                <button id="btn-webdav-force" class="webdav-btn force" title="本地配置完全覆盖云端,谨慎使用">💥 强制覆盖云端</button>
                            </div>
                            <div id="webdav-status" class="webdav-status">提示：上传/下载默认为增量合并；强制覆盖会用本地配置完全替换云端</div>
                        </div>
                    </div>

                    <div class="my-modal-actions"><button id="btn-test-conn" class="btn-test">⚡ 测试连接</button><div style="display:flex;gap:10px"><button id="my-btn-cancel" class="btn-cancel">取消</button><button id="my-btn-save" class="btn-save">保存</button></div></div>
                </div>`;
            document.body.appendChild(modal);
            bindModalEvents(modal);
        }
        const select = document.getElementById('profile-select');
        renderProfiles(select);
        modal.__lastProfileId = getCurrentProfileId();
        select.value = modal.__lastProfileId;
        loadFormData(getActiveConfig());
        loadStrategiesUI();
        document.getElementById('cfg-auto-summarize').checked = getAutoSummarizeEnabled();
        document.getElementById('cfg-flomo-url').value = getFlomoApiUrl();
        document.getElementById('webdav-user').value = getWebDAVUser();
        document.getElementById('webdav-pass').value = getWebDAVPass();
        const statusEl = document.getElementById('webdav-status');
        statusEl.className = 'webdav-status';
        statusEl.innerText = '提示：上传/下载默认为增量合并；强制覆盖会用本地配置完全替换云端';
        modal.style.display = 'flex';
    }

    function loadStrategiesUI() {
        const strats = getExtractStrategies();
        document.getElementById('strat-jina').checked = strats.includes('jina');
        document.getElementById('strat-readability').checked = strats.includes('readability');
        document.getElementById('strat-heuristic').checked = strats.includes('heuristic');
    }
    function saveStrategiesFromUI() {
        const arr = [];
        if (document.getElementById('strat-jina').checked) arr.push('jina');
        if (document.getElementById('strat-readability').checked) arr.push('readability');
        if (document.getElementById('strat-heuristic').checked) arr.push('heuristic');
        if (arr.length === 0) arr.push('heuristic');
        setExtractStrategies(arr);
    }

    function renderProfiles(selectEl) {
        const profiles = getProfiles();
        const currentId = getCurrentProfileId();
        selectEl.innerHTML = "";
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.text = (p.id === currentId ? '★ ' : '') + p.name;
            if (p.id === currentId) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }
    function loadFormData(config) {
        document.getElementById('cfg-name').value = config.name || '';
        document.getElementById('cfg-url').value = config.apiUrl || '';
        document.getElementById('cfg-key').value = config.apiKey || '';
        document.getElementById('cfg-model').value = config.model || '';
        document.getElementById('cfg-prompt').value = config.prompt || '';
    }
    function getFormDataFromUI(id) {
        return {
            id: id,
            name: document.getElementById('cfg-name').value,
            apiUrl: document.getElementById('cfg-url').value.trim(),
            apiKey: document.getElementById('cfg-key').value.trim(),
            model: document.getElementById('cfg-model').value.trim(),
            prompt: document.getElementById('cfg-prompt').value.trim()
        };
    }

    function saveFormToProfile(profileId) {
        if (!profileId) return;
        let profiles = getProfiles();
        const idx = profiles.findIndex(p => p.id === profileId);
        if (idx === -1) return;
        profiles[idx] = getFormDataFromUI(profileId);
        GM_setValue("ai_profiles", profiles);
    }

    function setWebDAVStatus(text, type) {
        const el = document.getElementById('webdav-status');
        if (!el) return;
        el.className = 'webdav-status' + (type ? ' ' + type : '');
        el.innerText = text;
    }

    function persistWebDAVCredsFromForm() {
        setWebDAVUser(document.getElementById('webdav-user').value.trim());
        setWebDAVPass(document.getElementById('webdav-pass').value.trim());
    }

    function bindModalEvents(modal) {
        const select = document.getElementById('profile-select');
        modal.__lastProfileId = select.value || getCurrentProfileId();

        select.onchange = () => {
            const oldId = modal.__lastProfileId;
            const newId = select.value;
            if (oldId && oldId !== newId) {
                saveFormToProfile(oldId);
            }
            GM_setValue("ai_current_profile_id", newId);
            modal.__lastProfileId = newId;
            loadFormData(getActiveConfig());
            renderProfiles(select);
            select.value = newId;
        };

        document.getElementById('btn-add-profile').onclick = () => {
            const name = prompt("新配置名称:", "DeepSeek");
            if (!name) return;
            saveFormToProfile(modal.__lastProfileId);
            const profiles = getProfiles();
            const newId = Date.now().toString();
            const newProfile = { ...DEFAULT_PROFILE, id: newId, name: name, apiKey: "" };
            profiles.push(newProfile);
            saveProfiles(profiles, newId);
            modal.__lastProfileId = newId;
            renderProfiles(select);
            select.value = newId;
            loadFormData(getActiveConfig());
        };

        document.getElementById('btn-del-profile').onclick = () => {
            let profiles = getProfiles();
            if (profiles.length <= 1) return alert("至少保留一个配置");
            const delId = modal.__lastProfileId;
            const delProfile = profiles.find(p => p.id === delId);
            if (!confirm(`删除配置「${delProfile ? delProfile.name : delId}」？`)) return;
            profiles = profiles.filter(p => p.id !== delId);
            const newActiveId = profiles[0].id;
            saveProfiles(profiles, newActiveId);
            modal.__lastProfileId = newActiveId;
            renderProfiles(select);
            select.value = newActiveId;
            loadFormData(getActiveConfig());
        };

        const keyInput = document.getElementById('cfg-key');
        document.getElementById('btn-toggle-pw').onclick = () => keyInput.type = keyInput.type === "password" ? "text" : "password";
        document.getElementById('btn-copy-pw').onclick = () => { GM_setClipboard(keyInput.value); alert("Key 已复制"); };

        const webdavPassInput = document.getElementById('webdav-pass');
        document.getElementById('btn-toggle-webdav-pw').onclick = () => webdavPassInput.type = webdavPassInput.type === "password" ? "text" : "password";

        const btnUp = document.getElementById('btn-webdav-up');
        const btnDown = document.getElementById('btn-webdav-down');
        const btnForce = document.getElementById('btn-webdav-force');

        function lockBtns(lock) {
            btnUp.disabled = lock;
            btnDown.disabled = lock;
            btnForce.disabled = lock;
        }

        btnUp.onclick = async () => {
            saveFormToProfile(modal.__lastProfileId);
            saveStrategiesFromUI();
            setAutoSummarizeEnabled(document.getElementById('cfg-auto-summarize').checked);
            setFlomoApiUrl(document.getElementById('cfg-flomo-url').value);
            persistWebDAVCredsFromForm();
            if (!getWebDAVUser() || !getWebDAVPass()) return setWebDAVStatus("请先填写邮箱和应用密码", "error");
            lockBtns(true);
            setWebDAVStatus("⬆️ 正在上传（增量合并）...");
            try {
                const merged = await syncUploadIncremental();
                setWebDAVStatus(`✅ 上传成功 · 配置数:${merged.profiles.length} · ${new Date().toLocaleTimeString()}`, "success");
            } catch(e) {
                setWebDAVStatus("❌ 上传失败：" + e.message, "error");
            } finally {
                lockBtns(false);
            }
        };

        btnDown.onclick = async () => {
            persistWebDAVCredsFromForm();
            if (!getWebDAVUser() || !getWebDAVPass()) return setWebDAVStatus("请先填写邮箱和应用密码", "error");
            lockBtns(true);
            setWebDAVStatus("⬇️ 正在下载（增量合并到本地）...");
            try {
                const merged = await syncDownloadIncremental();
                modal.__lastProfileId = getCurrentProfileId();
                renderProfiles(select);
                select.value = modal.__lastProfileId;
                loadFormData(getActiveConfig());
                loadStrategiesUI();
                document.getElementById('cfg-auto-summarize').checked = getAutoSummarizeEnabled();
                document.getElementById('cfg-flomo-url').value = getFlomoApiUrl();
                setWebDAVStatus(`✅ 下载成功 · 配置数:${merged.profiles.length} · ${new Date().toLocaleTimeString()}`, "success");
            } catch(e) {
                setWebDAVStatus("❌ 下载失败：" + e.message, "error");
            } finally {
                lockBtns(false);
            }
        };

        btnForce.onclick = async () => {
            saveFormToProfile(modal.__lastProfileId);
            saveStrategiesFromUI();
            setAutoSummarizeEnabled(document.getElementById('cfg-auto-summarize').checked);
            setFlomoApiUrl(document.getElementById('cfg-flomo-url').value);
            persistWebDAVCredsFromForm();
            if (!getWebDAVUser() || !getWebDAVPass()) return setWebDAVStatus("请先填写邮箱和应用密码", "error");
            if (!confirm("⚠️ 危险操作\n\n将用本地配置完全覆盖云端文件,云端独有的配置会丢失！\n\n确定继续？")) return;
            lockBtns(true);
            setWebDAVStatus("💥 正在强制覆盖云端...");
            try {
                const local = await syncForceUploadOverwrite();
                setWebDAVStatus(`✅ 已强制覆盖云端 · 配置数:${local.profiles.length} · ${new Date().toLocaleTimeString()}`, "success");
            } catch(e) {
                setWebDAVStatus("❌ 覆盖失败：" + e.message, "error");
            } finally {
                lockBtns(false);
            }
        };

        document.getElementById('btn-fetch-models').onclick = () => {
            const rawUrl = document.getElementById('cfg-url').value.trim();
            const apiKey = document.getElementById('cfg-key').value.trim();
            if (!rawUrl || !apiKey) return alert("请先填写 URL 和 Key");
            const btn = document.getElementById('btn-fetch-models');
            btn.innerText = "..."; btn.disabled = true;
            GM_xmlhttpRequest({
                method: "GET", url: getModelsUrl(normalizeApiUrl(rawUrl)), headers: { "Authorization": "Bearer " + apiKey },
                onload: (res) => {
                    btn.innerText = "🔄 获取模型"; btn.disabled = false;
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.data && Array.isArray(data.data)) {
                            const list = document.getElementById('model-list');
                            list.innerHTML = "";
                            data.data.forEach(m => { const opt = document.createElement('option'); opt.value = m.id; list.appendChild(opt); });
                            alert(`获取成功: ${data.data.length} 个模型`);
                        } else alert("获取成功但格式不符");
                    } catch (e) { alert("返回非 JSON 数据"); }
                },
                onerror: () => { btn.innerText = "重试"; btn.disabled = false; alert("请求失败"); }
            });
        };

        document.getElementById('btn-test-conn').onclick = () => {
            const rawUrl = document.getElementById('cfg-url').value.trim();
            const apiKey = document.getElementById('cfg-key').value.trim();
            const model = document.getElementById('cfg-model').value.trim();
            const btn = document.getElementById('btn-test-conn');
            if (!rawUrl || !apiKey) return alert("请完善配置");
            const finalUrl = normalizeApiUrl(rawUrl);
            btn.innerText = "连接中...";
            GM_xmlhttpRequest({
                method: "POST", url: finalUrl, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
                data: JSON.stringify({ model: model, messages: [{ role: "user", content: "Hi" }], max_tokens: 5 }),
                onload: (res) => {
                    btn.innerText = "⚡ 测试连接";
                    if (res.status === 200) alert("✅ 连接成功！"); else alert(`❌ 连接失败 (${res.status})\n${res.responseText.substring(0,100)}`);
                },
                onerror: () => { btn.innerText = "⚡ 测试连接"; alert("❌ 网络错误"); }
            });
        };

        document.getElementById('my-btn-save').onclick = () => {
            saveFormToProfile(modal.__lastProfileId);
            saveStrategiesFromUI();
            setAutoSummarizeEnabled(document.getElementById('cfg-auto-summarize').checked);
            setFlomoApiUrl(document.getElementById('cfg-flomo-url').value);
            persistWebDAVCredsFromForm();
            modal.style.display = 'none';
            alert("已保存");
        };
        document.getElementById('my-btn-cancel').onclick = () => modal.style.display = 'none';
        document.getElementById('modal-close-x').onclick = () => modal.style.display = 'none';
    }

    // ==================== 6. AI 调用 ====================
    function callAIChat(messages, onSuccess, onError, onChunk) {
        const config = getActiveConfig();
        if (!config.apiKey) {
            onError && onError("请先配置 API Key");
            return;
        }
        const finalUrl = normalizeApiUrl(config.apiUrl);
        const useStream = typeof onChunk === 'function';

        // 非流式：保持原逻辑
        if (!useStream) {
            GM_xmlhttpRequest({
                method: "POST", url: finalUrl,
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + config.apiKey },
                data: JSON.stringify({ model: config.model, messages: messages }),
                onload: (res) => {
                    if (res.responseText.trim().startsWith("<")) {
                        onError && onError("URL 错误 (返回了 HTML)");
                        return;
                    }
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) onError && onError("API Error: " + data.error.message);
                        else {
                            const content = data.choices?.[0]?.message?.content || "无内容";
                            onSuccess && onSuccess(content);
                        }
                    } catch(e) { onError && onError("解析失败：" + e.message); }
                },
                onerror: () => onError && onError("网络错误")
            });
            return;
        }

        // 流式：优先用 fetch + ReadableStream（真流式）
        const doFetchStream = async () => {
            const controller = new AbortController();
            let fullText = '';
            let buffer = '';

            const processLine = (line) => {
                line = line.replace(/\r$/, '').trim();
                if (!line) return true;
                if (line.startsWith(':')) return true;
                if (!line.startsWith('data:')) return true;
                const payload = line.slice(5).trim();
                if (payload === '[DONE]') return false;
                try {
                    const obj = JSON.parse(payload);
                    if (obj.error) {
                        throw new Error(obj.error.message || JSON.stringify(obj.error));
                    }
                    const delta = obj.choices?.[0]?.delta?.content
                               || obj.choices?.[0]?.message?.content
                               || '';
                    if (delta) {
                        fullText += delta;
                        try { onChunk(delta, fullText); } catch(e) { console.warn(e); }
                    }
                } catch(e) {
                    if (e.message && e.message.indexOf('JSON') === -1) throw e;
                    // 非合法 JSON 行,忽略
                }
                return true;
            };

            try {
                const resp = await fetch(finalUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + config.apiKey,
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify({ model: config.model, messages: messages, stream: true }),
                    signal: controller.signal
                });

                if (!resp.ok) {
                    const errText = await resp.text();
                    throw new Error(`HTTP ${resp.status}: ${errText.substring(0, 200)}`);
                }

                const ctype = resp.headers.get('content-type') || '';
                // 如果服务端没返回 SSE,降级一次性
                if (!ctype.includes('text/event-stream') && !resp.body) {
                    const text = await resp.text();
                    try {
                        const data = JSON.parse(text);
                        const content = data.choices?.[0]?.message?.content || '';
                        if (content) {
                            try { onChunk(content, content); } catch(e){}
                            onSuccess && onSuccess(content);
                            return true;
                        }
                    } catch(e){}
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
                // 处理残余 buffer
                if (buffer.trim()) processLine(buffer);

                if (fullText) {
                    onSuccess && onSuccess(fullText);
                } else {
                    onError && onError('流式响应为空');
                }
                return true;
            } catch (e) {
                console.warn('[fetch stream 失败,尝试降级]', e);
                return { fallback: true, error: e };
            }
        };

        // 兜底：GM_xmlhttpRequest（虽然多数环境不真流式,但起码能拿到结果）
        const doGMFallback = () => {
            let receivedLen = 0;
            let buffer = '';
            let fullText = '';
            let aborted = false;

            const flushBuffer = () => {
                let idx;
                while ((idx = buffer.indexOf('\n')) !== -1) {
                    let line = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 1);
                    line = line.replace(/\r$/, '').trim();
                    if (!line) continue;
                    if (line.startsWith(':')) continue;
                    if (line.startsWith('data:')) {
                        const payload = line.slice(5).trim();
                        if (payload === '[DONE]') { aborted = true; return; }
                        try {
                            const obj = JSON.parse(payload);
                            if (obj.error) {
                                onError && onError("API Error: " + (obj.error.message || JSON.stringify(obj.error)));
                                aborted = true;
                                return;
                            }
                            const delta = obj.choices?.[0]?.delta?.content
                                       || obj.choices?.[0]?.message?.content
                                       || '';
                            if (delta) {
                                fullText += delta;
                                try { onChunk(delta, fullText); } catch(e) { console.warn(e); }
                            }
                        } catch(e) {}
                    }
                }
            };

            GM_xmlhttpRequest({
                method: "POST", url: finalUrl,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + config.apiKey,
                    "Accept": "text/event-stream"
                },
                data: JSON.stringify({ model: config.model, messages: messages, stream: true }),
                responseType: 'stream',
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
                    if (aborted && fullText) { onSuccess && onSuccess(fullText); return; }
                    const text = res.responseText || '';
                    if (text.length > receivedLen) {
                        buffer += text.substring(receivedLen);
                        receivedLen = text.length;
                        flushBuffer();
                    }
                    if (fullText) {
                        onSuccess && onSuccess(fullText);
                    } else {
                        if (text.trim().startsWith("<")) {
                            onError && onError("URL 错误 (返回了 HTML)");
                            return;
                        }
                        try {
                            const data = JSON.parse(text);
                            if (data.error) onError && onError("API Error: " + data.error.message);
                            else {
                                const content = data.choices?.[0]?.message?.content || "无内容";
                                try { onChunk(content, content); } catch(e){}
                                onSuccess && onSuccess(content);
                            }
                        } catch(e) {
                            onError && onError("流式解析失败,且非合法 JSON");
                        }
                    }
                },
                onerror: () => onError && onError("网络错误"),
                ontimeout: () => onError && onError("请求超时")
            });
        };

        // 先尝试 fetch,失败再降级
        doFetchStream().then(result => {
            if (result && result.fallback) {
                console.log('[Folo增强] fetch 流式失败,降级到 GM_xmlhttpRequest');
                doGMFallback();
            }
        });
    }

    function callAIWithText(opts) {
        const { title, text, url, btn, resultDiv, statusDiv, sourceLabel, wrapper } = opts;
        const config = getActiveConfig();
        if (!config.apiKey) {
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = "⚠️ 请先配置 API Key";
            showSettingsModal();
            return;
        }
        if (!text || text.length < 10) {
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `<span style="color:red">⚠️ 正文内容过少（${text ? text.length : 0} 字）,无法总结。</span>`;
            return;
        }

        const maxChars = getMaxChars();
        let workText = text;
        let truncatedNote = "";
        if (workText.length > maxChars) {
            workText = workText.substring(0, maxChars);
            truncatedNote = `（已截断到 ${maxChars} 字符）`;
        }

        btn.disabled = true; btn.innerText = "AI 生成中...";
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `🤖 正在调用 AI 模型... <span style="font-size:0.8em;color:#888">(${config.model})</span>`;
        if (statusDiv) statusDiv.innerText = `📄 正文来源：${sourceLabel} · 长度：${text.length} 字 ${truncatedNote}`;

        const urlBlock = url ? `原文链接: ${url}\n` : "（无原文链接）\n";
        const fullContent =
            `以下是从 RSS 阅读器中提取的文章信息,请基于这些信息进行总结。\n\n` +
            `==== 文章元信息 ====\n` +
            `标题: ${title}\n` +
            urlBlock +
            `\n==== 正文内容 ====\n${workText}\n\n` +
            `==== 任务要求 ====\n` +
            `请基于上面提供的正文进行总结。注意：你不需要也无法访问网络,所有内容已包含在上方文本中。\n` +
            (url ? `如需引用原文出处,请使用此链接：${url}\n` : "");

        const systemPrompt =
            "You are a helpful assistant summarizing articles. " +
            "All article content is provided directly in the user's message - " +
            "you do NOT have web access and do NOT need to fetch anything. " +
            "Just summarize what's given. If a URL is provided, reference it in your answer when appropriate.";

        const userMessage = config.prompt + "\n\n" + fullContent;

        // 流式渲染状态
        let streamStarted = false;
        const renderStream = (delta, full) => {
            if (!streamStarted) {
                streamStarted = true;
                btn.innerText = "AI 输出中...";
                resultDiv.innerHTML = '';
            }
            // 实时 markdown 渲染（每次 chunk 全量重渲）
            resultDiv.innerHTML = _md(full) + '<span style="opacity:0.5;animation:fadeIn 0.5s infinite alternate">▍</span>';
        };

        callAIChat(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            (content) => {
                btn.disabled = false; btn.innerText = "重新生成";
                let raw = content;
                if (url) raw += `\n\n---\n🔗 **原文链接**：[${url}](${url})`;
                resultDiv.innerHTML = _md(raw);

                if (wrapper) {
                    wrapper.__articleContext = {
                        title: title,
                        text: workText,
                        url: url,
                        truncated: !!truncatedNote
                    };
                    wrapper.__summaryContent = content;  // 保存原始 markdown,便于复制/发送 flomo
                    wrapper.__chatHistory = [
                        { role: "system", content:
                            "你是一个有用的文章助手。下面是用户正在阅读的文章。请基于这篇文章的内容回答用户的后续提问。所有信息已包含在下方文本中,你无法访问网络。\n\n" +
                            `==== 文章标题 ====\n${title}\n` +
                            (url ? `==== 原文链接 ====\n${url}\n` : "") +
                            `\n==== 文章正文 ====\n${workText}\n\n` +
                            `==== 之前的 AI 总结 ====\n${content}`
                        }
                    ];
                    const chatArea = wrapper.querySelector('.my-ai-chat-area');
                    if (chatArea) {
                        chatArea.style.display = 'block';
                        const histDiv = chatArea.querySelector('.my-ai-chat-history');
                        if (histDiv) histDiv.innerHTML = '';
                    }
                }
            },
            (errMsg) => {
                btn.disabled = false; btn.innerText = "重试";
                resultDiv.innerHTML = `<span style="color:red">${errMsg}</span>`;
            },
            renderStream  // 👈 第 4 个参数：流式回调
        );
    }

    async function runSummary(articleNode, btn, resultDiv, statusDiv, fetchFulltext, wrapper) {
        const title = getArticleTitle(articleNode);
        const previewText = getCleanArticleText(articleNode);
        const originalUrl = getOriginalUrl(articleNode);

        if (!fetchFulltext || !originalUrl) {
            const reason = !originalUrl ? "未找到原文链接" : "已禁用全文抓取";
            callAIWithText({
                title, text: previewText, url: originalUrl,
                btn, resultDiv, statusDiv, wrapper,
                sourceLabel: `Folo 预览（${reason}）`
            });
            return;
        }

        const strategies = getExtractStrategies();
        btn.disabled = true; btn.innerText = "抓取原文中...";
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `🌐 正在抓取原文：<a href="${originalUrl}" target="_blank" style="color:#7c3aed;word-break:break-all">${originalUrl}</a>`;
        if (statusDiv) statusDiv.innerText = `⏳ 准备使用策略：${strategies.join(' → ')}`;

        try {
            const result = await smartFetchArticle(originalUrl, strategies, (strat) => {
                const labels = { jina: '🌟 Jina Reader', readability: '📖 Readability.js', heuristic: '🔧 启发式算法' };
                if (statusDiv) statusDiv.innerText = `⏳ 正在尝试：${labels[strat] || strat}...`;
                resultDiv.innerHTML = `🌐 正在抓取：<a href="${originalUrl}" target="_blank" style="color:#7c3aed;word-break:break-all">${originalUrl}</a><br/><span style="font-size:0.85em;color:#888">使用 ${labels[strat] || strat}...</span>`;
            });

            const useFulltext = result.text.length >= previewText.length * 0.8;
            if (useFulltext) {
                callAIWithText({
                    title: result.title || title,
                    text: result.text,
                    url: originalUrl,
                    btn, resultDiv, statusDiv, wrapper,
                    sourceLabel: `${result.method}（${new URL(originalUrl).hostname}）`
                });
            } else {
                console.warn("[Folo增强] 全文比预览短,使用预览。");
                callAIWithText({
                    title, text: previewText, url: originalUrl,
                    btn, resultDiv, statusDiv, wrapper,
                    sourceLabel: `Folo 预览（${result.method}抓到 ${result.length} 字 < 预览）`
                });
            }
        } catch (err) {
            console.warn("[Folo增强] 所有抓取策略失败：", err);
            callAIWithText({
                title, text: previewText, url: originalUrl,
                btn, resultDiv, statusDiv, wrapper,
                sourceLabel: `Folo 预览（抓取失败：${err.message}）`
            });
        }
    }

    // ==================== 7. 对话框相关 ====================
    // —— 构建可复制/分享的纯文本对话内容 ——
    function buildConversationText(wrapper) {
        const ctx = wrapper.__articleContext || {};
        const history = wrapper.__chatHistory || [];
        const lines = [];

        if (ctx.title) lines.push(`📄 ${ctx.title}`);
        if (ctx.url)   lines.push(`🔗 ${ctx.url}`);
        if (lines.length) lines.push('');

        // AI 总结(优先用保存的原始 markdown)
        const summaryRaw = wrapper.__summaryContent;
        const summaryEl = wrapper.querySelector('.my-ai-content');
        const summaryText = summaryRaw || (summaryEl ? summaryEl.innerText.trim() : '');
        if (summaryText) {
            lines.push('===== 🤖 AI 总结 =====');
            lines.push(summaryText);
            lines.push('');
        }

        // 后续对话(跳过 system)
        const dialog = history.filter(m => m.role !== 'system');
        if (dialog.length) {
            lines.push('===== 💬 后续对话 =====');
            dialog.forEach(m => {
                const tag = m.role === 'user' ? '【我】' : '【AI】';
                lines.push(`${tag}\n${m.content}\n`);
            });
        }

        return lines.join('\n').trim();
    }

    // —— 复制对话到剪贴板 ——
    function handleCopyConversation(wrapper) {
        const text = buildConversationText(wrapper);
        if (!text) {
            alert('当前没有可复制的内容,请先生成总结。');
            return;
        }
        GM_setClipboard(text);
        const btn = wrapper.querySelector('.my-ai-chat-copy');
        if (btn) {
            const old = btn.innerText;
            btn.innerText = '✅ 已复制';
            setTimeout(() => { btn.innerText = old; }, 1500);
        }
    }

    // —— 发送到 flomo ——
    function handleSendToFlomo(wrapper) {
        const flomoUrl = getFlomoApiUrl();
        if (!flomoUrl) {
            alert('请先在设置中填写 flomo API URL。');
            showSettingsModal();
            return;
        }
        const text = buildConversationText(wrapper);
        if (!text) {
            alert('当前没有可发送的内容,请先生成总结。');
            return;
        }

        const ctx = wrapper.__articleContext || {};
        const content =
            text +
            '\n\n---' +
            (ctx.title ? `\n📄 ${ctx.title}` : '') +
            (ctx.url   ? `\n🔗 ${ctx.url}`   : '') +
            '\n#Folo增强 #AI总结';

        const btn = wrapper.querySelector('.my-ai-chat-flomo');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ 发送中...'; }

        GM_xmlhttpRequest({
            method: 'POST',
            url: flomoUrl,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ content: content }),
            timeout: 30000,
            onload: (res) => {
                let ok = false, msg = '';
                try {
                    const data = JSON.parse(res.responseText || '{}');
                    ok = (res.status >= 200 && res.status < 300) &&
                         (data.code === 0 || data.code === 200 || data.message === 'ok' || data.message === 'success' || data.memo);
                    msg = data.message || `HTTP ${res.status}`;
                } catch(e) {
                    ok = (res.status >= 200 && res.status < 300);
                    msg = `HTTP ${res.status}`;
                }
                if (btn) { btn.disabled = false; }
                if (ok) {
                    if (btn) {
                        btn.innerText = '✅ 已发送';
                        setTimeout(() => { btn.innerText = '🌱 保存到 flomo'; }, 2000);
                    }
                } else {
                    if (btn) btn.innerText = '🌱 保存到 flomo';
                    alert('❌ 发送 flomo 失败：' + msg);
                }
            },
            onerror: () => {
                if (btn) { btn.disabled = false; btn.innerText = '🌱 保存到 flomo'; }
                alert('❌ 网络错误,发送 flomo 失败');
            },
            ontimeout: () => {
                if (btn) { btn.disabled = false; btn.innerText = '🌱 保存到 flomo'; }
                alert('❌ 请求超时,发送 flomo 失败');
            }
        });
    }

    function appendChatMessage(historyDiv, role, content, isMarkdown) {
        const msg = document.createElement('div');
        msg.className = 'my-ai-chat-msg ' + role;
        const label = role === 'user' ? '🧑 你' : '🤖 AI';
        msg.innerHTML = `<span class="role-label">${label}</span>` + (isMarkdown ? _md(content) : `<span>${content.replace(/</g,'&lt;')}</span>`);
        historyDiv.appendChild(msg);
        historyDiv.scrollTop = historyDiv.scrollHeight;
        return msg;
    }

    function handleChatSend(wrapper) {
        const input = wrapper.querySelector('.my-ai-chat-input');
        const sendBtn = wrapper.querySelector('.my-ai-chat-send');
        const historyDiv = wrapper.querySelector('.my-ai-chat-history');
        const userText = input.value.trim();
        if (!userText) return;
        if (!wrapper.__chatHistory) {
            alert("请先生成总结后再开始对话");
            return;
        }

        appendChatMessage(historyDiv, 'user', userText, false);
        input.value = '';
        input.style.height = 'auto';

        wrapper.__chatHistory.push({ role: 'user', content: userText });

        const aiMsg = appendChatMessage(historyDiv, 'assistant', '🤔 思考中...', false);

        sendBtn.disabled = true; sendBtn.innerText = '发送中';

        let chatStreamStarted = false;
        const onChatChunk = (delta, full) => {
            if (!chatStreamStarted) {
                chatStreamStarted = true;
            }
            aiMsg.innerHTML = `<span class="role-label">🤖 AI</span>` + _md(full)
                + '<span style="opacity:0.5;">▍</span>';
            historyDiv.scrollTop = historyDiv.scrollHeight;
        };

        callAIChat(
            wrapper.__chatHistory,
            (content) => {
                sendBtn.disabled = false; sendBtn.innerText = '发送';
                wrapper.__chatHistory.push({ role: 'assistant', content: content });
                aiMsg.innerHTML = `<span class="role-label">🤖 AI</span>` + _md(content);
                historyDiv.scrollTop = historyDiv.scrollHeight;
            },
            (errMsg) => {
                sendBtn.disabled = false; sendBtn.innerText = '发送';
                aiMsg.innerHTML = `<span class="role-label">🤖 AI</span><span style="color:red">${errMsg}</span>`;
                wrapper.__chatHistory.pop();
            },
            onChatChunk  // 👈 流式回调
        );
    }

    // ==================== 8. 页面注入 + 自动重置 ====================
    function checkAndReset(wrapper) {
        const currentUrl = window.location.href;
        const savedUrl = wrapper.dataset.url;
        if (savedUrl && savedUrl !== currentUrl) {
            const contentDiv = wrapper.querySelector('.my-ai-content');
            const statusDiv = wrapper.querySelector('.my-ai-status');
            const btn = wrapper.querySelector('.my-ai-btn');
            const chatArea = wrapper.querySelector('.my-ai-chat-area');
            const chatHistory = wrapper.querySelector('.my-ai-chat-history');
            contentDiv.style.display = 'none';
            contentDiv.innerText = '';
            if (statusDiv) statusDiv.innerText = '';
            btn.disabled = false;
            btn.innerText = "点击生成摘要";
            if (chatArea) chatArea.style.display = 'none';
            if (chatHistory) chatHistory.innerHTML = '';
            wrapper.__chatHistory = null;
            wrapper.__articleContext = null;
            wrapper.__summaryContent = null;
            wrapper.dataset.url = currentUrl;
            wrapper.dataset.autoTriggered = '';

            if (getAutoSummarizeEnabled()) {
                tryAutoSummarize(wrapper);
            }
        } else if (!savedUrl) {
            wrapper.dataset.url = currentUrl;
        }
    }

    function tryAutoSummarize(wrapper) {
        if (!wrapper) return;
        if (wrapper.dataset.autoTriggered === 'true') return;

        setTimeout(() => {
            const article = document.getElementById('follow-entry-render') || document.querySelector('article[data-testid="entry-render"]');
            if (!article) return;
            const text = getCleanArticleText(article);
            if (!text || text.length < 30) return;
            wrapper.dataset.autoTriggered = 'true';
            const btn = wrapper.querySelector('.my-ai-btn');
            const content = wrapper.querySelector('.my-ai-content');
            const statusDiv = wrapper.querySelector('.my-ai-status');
            if (btn && !btn.disabled) {
                runSummary(article, btn, content, statusDiv, getFetchFulltextEnabled(), wrapper);
            }
        }, 600);
    }

    function checkAndInject() {
        document.querySelectorAll('button[title="Open AI Chat"]').forEach(b => b.style.display = 'none');

        let article = document.getElementById('follow-entry-render') || document.querySelector('article[data-testid="entry-render"]');
        if (!article) return;

        article.querySelectorAll('div').forEach(div => {
            if (div.innerText.includes("AI 总结") && !div.closest('#my-custom-ai-wrapper')) {
                const container = div.closest('.group.relative.overflow-hidden');
                if (container) container.classList.add('folo-native-ai-hidden');
            }
        });

        if (!article.dataset.unlocked) {
            ['onselectstart', 'oncopy', 'oncut', 'onpaste'].forEach(e => article.removeAttribute(e));
            article.classList.remove('select-none', 'no-select');
            if (!article.querySelector('.custom-copy-btn')) {
                const btn = document.createElement('button');
                btn.className = 'custom-copy-btn';
                btn.innerText = 'Copy';
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const cleanText = getCleanArticleText(article);
                    GM_setClipboard(cleanText);
                    btn.innerText = "OK"; setTimeout(()=>btn.innerText="Copy", 1000);
                };
                if (getComputedStyle(article).position === 'static') article.style.position = 'relative';
                article.appendChild(btn);
            }
            article.dataset.unlocked = "true";
        }

        const existingWrapper = document.getElementById('my-custom-ai-wrapper');
        if (existingWrapper) { checkAndReset(existingWrapper); return; }

        let injectionTarget = article.querySelector('.group.relative.block.mt-12') || article;
        if (injectionTarget) {
            const wrapper = document.createElement('div');
            wrapper.id = 'my-custom-ai-wrapper';
            wrapper.dataset.url = window.location.href;

            const activeConfigName = getActiveConfig().name;
            const fetchOn = getFetchFulltextEnabled();
            const autoOn = getAutoSummarizeEnabled();
            wrapper.innerHTML = `
                <div class="my-ai-box">
                    <div class="my-ai-header">
                        <div class="my-ai-title">✨ AI 智能总结
                            <span style="font-weight:400;font-size:0.8em;opacity:0.6;margin-left:5px;">(${activeConfigName})</span>
                            ${autoOn ? '<span class="my-ai-auto-badge" title="自动总结已开启">🤖 AUTO</span>' : ''}
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span class="my-ai-mode-toggle ${fetchOn ? 'active' : ''}" title="点击切换：是否抓取原文全文">
                                ${fetchOn ? '🌐 全文模式' : '📄 预览模式'}
                            </span>
                            <button class="my-ai-btn">点击生成摘要</button>
                            <div class="my-ai-setting-icon" title="设置">⚙️</div>
                        </div>
                    </div>
                    <div class="my-ai-content" style="display:none;"></div>
                    <div class="my-ai-status"></div>

                    <div class="my-ai-chat-area">
                        <div class="my-ai-chat-actions">
                            <button class="my-ai-chat-clear" title="清空对话">🧹 清空对话</button>
                            <button class="my-ai-chat-copy" title="复制全部对话(含总结)">📋 复制对话</button>
                            <button class="my-ai-chat-flomo" title="保存到 flomo">🌱 保存到 flomo</button>
                        </div>
                        <div class="my-ai-chat-history"></div>
                        <div class="my-ai-chat-input-row">
                            <textarea class="my-ai-chat-input" placeholder="基于文章继续提问...（Enter 发送,Shift+Enter 换行）" rows="1"></textarea>
                            <button class="my-ai-chat-send">发送</button>
                        </div>
                    </div>
                </div>`;

            if (injectionTarget === article) article.insertBefore(wrapper, article.firstChild);
            else injectionTarget.insertAdjacentElement('afterend', wrapper);

            wrapper.querySelector('.my-ai-setting-icon').onclick = showSettingsModal;

            const modeToggle = wrapper.querySelector('.my-ai-mode-toggle');
            modeToggle.onclick = () => {
                const next = !getFetchFulltextEnabled();
                setFetchFulltextEnabled(next);
                modeToggle.classList.toggle('active', next);
                modeToggle.innerText = next ? '🌐 全文模式' : '📄 预览模式';
            };

            const btn = wrapper.querySelector('.my-ai-btn');
            const content = wrapper.querySelector('.my-ai-content');
            const statusDiv = wrapper.querySelector('.my-ai-status');

            btn.onclick = () => {
                const currentArticle = document.getElementById('follow-entry-render') || document.querySelector('article[data-testid="entry-render"]');
                if (!currentArticle) return;
                runSummary(currentArticle, btn, content, statusDiv, getFetchFulltextEnabled(), wrapper);
            };

            const chatInput = wrapper.querySelector('.my-ai-chat-input');
            const sendBtn = wrapper.querySelector('.my-ai-chat-send');
            const clearBtn = wrapper.querySelector('.my-ai-chat-clear');
            const copyBtn = wrapper.querySelector('.my-ai-chat-copy');
            const flomoBtn = wrapper.querySelector('.my-ai-chat-flomo');

            sendBtn.onclick = () => handleChatSend(wrapper);
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSend(wrapper);
                }
            });
            chatInput.addEventListener('input', () => {
                chatInput.style.height = 'auto';
                chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
            });
            clearBtn.onclick = () => {
                if (!wrapper.__chatHistory) return;
                if (!confirm('确定清空当前对话历史？（文章上下文会保留）')) return;
                wrapper.__chatHistory = wrapper.__chatHistory.slice(0, 1);
                wrapper.querySelector('.my-ai-chat-history').innerHTML = '';
            };
            if (copyBtn)  copyBtn.onclick  = () => handleCopyConversation(wrapper);
            if (flomoBtn) flomoBtn.onclick = () => handleSendToFlomo(wrapper);

            if (getAutoSummarizeEnabled()) {
                tryAutoSummarize(wrapper);
            }
        }
    }

    function startObserver() {
        const observer = new MutationObserver(checkAndInject);
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(checkAndInject, 500);
    }
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver);

})();