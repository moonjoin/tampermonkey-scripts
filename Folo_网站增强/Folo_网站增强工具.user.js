// ==UserScript==
// @name         Folo 网站增强工具
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      14.0.1
// @description  Folo 增强：Jina Reader + Readability + 启发式三级抓取 + AI 总结 + 自动总结 + 手动列表全量预加载 + 后续对话 + 多配置管理 + 坚果云 WebDAV 同步 + 复制对话 + 保存到 flomo
// @author       次元饺子
// @icon         https://img.icons8.com/?size=100&id=90385&format=png&color=000000
// @match        https://app.folo.is/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/576150/Folo%20%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA%E5%B7%A5%E5%85%B7%20%28v134%20flomo%E9%9B%86%E6%88%90%E7%89%88%29.user.js
// @updateURL https://update.greasyfork.org/scripts/576150/Folo%20%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA%E5%B7%A5%E5%85%B7%20%28v134%20flomo%E9%9B%86%E6%88%90%E7%89%88%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    console.log("🚀 Folo 增强脚本 (手动列表预加载版) 已启动");

    // ==================== 0. 内联 Markdown 渲染器（含 GFM 表格） ====================
    const _md = (function() {
        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        function renderMarkdownLinks(s, isImage) {
            const prefix = isImage ? '![' : '[';
            let out = '';
            let i = 0;
            while (i < s.length) {
                const start = s.indexOf(prefix, i);
                if (start < 0) {
                    out += s.slice(i);
                    break;
                }
                if (!isImage && start > 0 && s[start - 1] === '!') {
                    out += s.slice(i, start + 1);
                    i = start + 1;
                    continue;
                }
                out += s.slice(i, start);
                let j = start + prefix.length;
                let depth = 1;
                while (j < s.length) {
                    if (s[j] === '\\') { j += 2; continue; }
                    if (s[j] === '[') depth++;
                    else if (s[j] === ']') {
                        depth--;
                        if (depth === 0) break;
                    }
                    j++;
                }
                if (j >= s.length || s[j + 1] !== '(') {
                    out += prefix;
                    i = start + prefix.length;
                    continue;
                }
                let k = j + 2;
                while (k < s.length) {
                    if (s[k] === '\\') { k += 2; continue; }
                    if (s[k] === ')') break;
                    k++;
                }
                if (k >= s.length) {
                    out += prefix;
                    i = start + prefix.length;
                    continue;
                }
                const label = s.slice(start + prefix.length, j).replace(/\\([\[\]])/g, '$1');
                const targetRaw = s.slice(j + 2, k).trim();
                const href = targetRaw.replace(/\s+(?:"[^"]*"|&quot;.*?&quot;)$/, '').split(/\s+/)[0];
                if (!href) {
                    out += s.slice(start, k + 1);
                } else if (isImage) {
                    out += `<img src="${href}" alt="${label}" style="max-width:100%;border-radius:6px">`;
                } else {
                    out += `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
                }
                i = k + 1;
            }
            return out;
        }
        function autoLinkPlainUrls(s) {
            return s.split(/(<a\b[^>]*>.*?<\/a>|<img\b[^>]*>|<code\b[^>]*>.*?<\/code>)/gi).map(part => {
                if (!part || /^<(a|img|code)\b/i.test(part)) return part;
                return part.split(/(<[^>]+>)/g).map(piece => {
                    if (!piece || piece[0] === '<') return piece;
                    return piece.replace(/https?:\/\/[^\s<)]+/g, url =>
                        `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
                }).join('');
            }).join('');
        }
        function renderInline(text) {
            let s = escapeHtml(text);
            s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
            s = renderMarkdownLinks(s, true);
            s = renderMarkdownLinks(s, false);
            s = autoLinkPlainUrls(s);
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
                const articleRef = line.match(/^\s*(#\d+)\s+(.*)$/);
                if (articleRef) {
                    closeAllLists();
                    html += '<p class="md-article-ref"><span class="md-article-no">' + escapeHtml(articleRef[1]) + '</span>' + renderInline(articleRef[2].trim()) + '</p>';
                    i++;
                    continue;
                }
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

    function getPreloadEnabled() { return GM_getValue("ai_preload_enabled", true) !== false; }
    function setPreloadEnabled(v) { GM_setValue("ai_preload_enabled", !!v); }
    function getPreloadLimit() { return Math.max(1, Math.min(20, Number(GM_getValue("ai_preload_limit", 8)) || 8)); }
    function setPreloadLimit(v) { GM_setValue("ai_preload_limit", Math.max(1, Math.min(20, Number(v) || 8))); }
    function getPreloadConcurrency() { return Math.max(1, Math.min(3, Number(GM_getValue("ai_preload_concurrency", 2)) || 2)); }
    function setPreloadConcurrency(v) { GM_setValue("ai_preload_concurrency", Math.max(1, Math.min(3, Number(v) || 2))); }
    function getPreloadIframeEnabled() { return GM_getValue("ai_preload_iframe_enabled", false) === true; }
    function setPreloadIframeEnabled(v) { GM_setValue("ai_preload_iframe_enabled", !!v); }
    function getIgnoredPreloadScopes() {
        const scopes = GM_getValue("ai_preload_ignored_scopes", {});
        return scopes && typeof scopes === "object" ? scopes : {};
    }
    function setPreloadScopeIgnored(scopePath, ignored) {
        if (!scopePath) return;
        const scopes = getIgnoredPreloadScopes();
        const key = getPreloadScopeStorageKey(scopePath);
        if (ignored) scopes[key] = Date.now();
        else {
            delete scopes[key];
            delete scopes[scopePath];
        }
        GM_setValue("ai_preload_ignored_scopes", scopes);
    }
    function isPreloadScopeIgnored(scopePath) {
        if (!scopePath) return false;
        const scopes = getIgnoredPreloadScopes();
        return !!(scopes[scopePath] || scopes[getPreloadScopeStorageKey(scopePath)]);
    }
    function getPreloadScopeStorageKey(scopePath) {
        return getTimelineScopeCompareKey(scopePath) || String(scopePath || "");
    }

    function getExtractStrategies() {
        return GM_getValue("ai_extract_strategies", ['jina', 'readability', 'heuristic']);
    }
    function setExtractStrategies(arr) { GM_setValue("ai_extract_strategies", arr); }

    function getFlomoApiUrl() { return GM_getValue("ai_flomo_api_url", ""); }
    function setFlomoApiUrl(v) { GM_setValue("ai_flomo_api_url", String(v || "").trim()); }
    function getFlomoTags() { return GM_getValue("ai_flomo_tags", "#Folo增强 #AI总结"); }
    function setFlomoTags(v) { GM_setValue("ai_flomo_tags", String(v || "").trim() || "#Folo增强 #AI总结"); }
    function toMarkdownLinkLabel(text) {
        return String(text || "无标题")
            .replace(/\s+/g, " ")
            .replace(/\[/g, "【")
            .replace(/\]/g, "】")
            .trim() || "无标题";
    }

    const DEFAULT_OVERVIEW_PROMPT = `你是一个信息分析助手。下面是一份包含 {{total}} 篇文章的 RSS 订阅列表。
{{analysisHint}}
规则：
- 用中文回答，语言简洁干练
- 输入材料已给每篇文章分配原始编号 #1、#2、#3...；引用文章时必须保留这个编号和标题中的 markdown 链接格式，例如 #3 [标题](URL)，方便定位和统计
- 不要输出"以下是分析"之类的开场白
- 最重要的规则：{{total}} 篇文章必须全部出现在输出中，一篇都不能漏。在输出最后用加粗写上"共覆盖 X/Y 篇"来自检
输出结构：
**一句话总结**：这个列表在讲什么，值不值得花时间
**主题分组**：按主题将全部 {{total}} 篇文章归类。每个主题用一句话概括，下面列出该主题下的所有文章标题（保留原始编号和链接）。每个主题下的文章用编号列表，确保所有文章都出现在某个主题下
**值得优先看**：从上面的文章中挑 3-5 篇最值得关注的，引用标题，每篇一句话说清为什么值得看
**信号与趋势**：从这些文章里能看出什么趋势、风险或机会
**可以跳过**：哪些文章明显是重复或低价值的，引用标题，简要说明原因`;
    function getOverviewPrompt() { return GM_getValue("ai_overview_prompt", DEFAULT_OVERVIEW_PROMPT); }
    function setOverviewPrompt(v) { GM_setValue("ai_overview_prompt", v || DEFAULT_OVERVIEW_PROMPT); }

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

    // ==================== 3.1. 总结缓存 + 列表预加载 ====================
    const SUMMARY_CACHE_KEY = "ai_summary_cache_v1";
    const SUMMARY_CACHE_MAX = 0; // 0 表示不按数量裁剪,只按 TTL 清理过期缓存
    const SUMMARY_CACHE_TTL = 1000 * 60 * 60 * 24 * 14;
    const PRELOAD_TASK_TIMEOUT_MS = 90000;
    const PRELOAD_DETAIL_LOAD_TIMEOUT_MS = 22000;
    const PRELOAD_ARTICLES = new Map();
    const PRELOAD_QUEUE = [];
    const PRELOAD_RUNNING = new Set();
    const PRELOAD_FAILED_UNTIL = new Map();
    const PRELOAD_TASKS = new Map();
    const PRELOAD_ARTICLE_STATES = new Map();
    const PRELOAD_ACTIVE_SCOPES = new Set();
    const PRELOAD_STATS = {
        detected: 0,
        queued: 0,
        running: 0,
        success: 0,
        failed: 0,
        lastMessage: "等待扫描列表",
        logs: []
    };
    let preloadPumpTimer = null;
    let preloadScanTimer = null;
    let preloadPanelTimer = null;
    let preloadMarkerTimer = null;
    let preloadPanelExpandedLayout = null;
    let preloadClearToken = 0;
    let preloadLastScopePath = "";
    let preloadLastPassiveScanAt = 0;

    function setPreloadStatus(message, level) {
        PRELOAD_STATS.lastMessage = message || "";
        PRELOAD_STATS.logs.unshift({
            time: new Date().toLocaleTimeString(),
            text: message || "",
            level: level || "info"
        });
        PRELOAD_STATS.logs = PRELOAD_STATS.logs.slice(0, 8);
        updatePreloadPanel();
    }

    function getCacheCount() {
        return Object.keys(readSummaryCache()).length;
    }

    function stripHtmlToText(html) {
        const s = String(html || "");
        if (!/[<>]/.test(s)) return s.replace(/\s+/g, " ").trim();
        const doc = new DOMParser().parseFromString(s, "text/html");
        return (doc.body ? doc.body.innerText : s).replace(/\s+/g, " ").trim();
    }

    function getVisibleRowText(el) {
        const row = el && (el.closest('[role="article"], [data-radix-collection-item], [data-testid*="entry"], article, li, a[href*="/timeline/articles/"]') || el.closest('div'));
        const text = row ? (row.innerText || row.textContent || "") : "";
        return text.replace(/\s+/g, " ").trim().slice(0, 2000);
    }

    function getTitleFromRow(el) {
        const rowText = getVisibleRowText(el);
        const ownText = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        const title = ownText || rowText;
        return title
            .replace(/\b\d+\s*(分钟|小时|天)前\b/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180);
    }

    function getTimelineRouteInfo(urlLike) {
        let u;
        try { u = new URL(urlLike || location.href, location.origin); } catch(e) { u = new URL(location.href); }
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] !== 'timeline' || parts.length < 3) {
            return { isTimeline: false, scopePath: "", entryId: "", isList: false, pathname: u.pathname };
        }
        const last = parts[parts.length - 1] || "";
        const isEntry = /^\d{8,}$/.test(last);
        const isList = last === "pending" || last === "read" || last === "all" || !isEntry;
        const scopeParts = isEntry || last === "pending" || last === "read" ? parts.slice(0, -1) : parts;
        return {
            isTimeline: true,
            scopePath: "/" + scopeParts.join("/"),
            entryId: isEntry ? last : "",
            isList,
            pathname: u.pathname
        };
    }

    function sameTimelineScope(href, scopePath) {
        if (!scopePath) return false;
        const info = getTimelineRouteInfo(href);
        if (!info.isTimeline || !info.entryId) return false;
        // 完全匹配
        if (info.scopePath === scopePath) return true;
        const wantedKey = getTimelineScopeCompareKey(scopePath);
        const itemKey = getTimelineScopeCompareKey(info.scopePath);
        if (wantedKey && itemKey && wantedKey === itemKey) return true;
        return false;
    }

    function getTimelineScopeCompareKey(scopePath) {
        const parts = String(scopePath || "").split("/").filter(Boolean);
        const last = parts[parts.length - 1] || "";
        if (!last) return "";
        if (/^folder-/i.test(last)) return "folder:" + last;
        if (/^feed-/i.test(last)) return "feed:" + last;
        if (/^\d{8,}$/.test(last) && parts[0] === "timeline" && parts[1] === "all") return "source:" + last;
        return parts.join("/");
    }

    function isNumericSourceTimelineScope(scopePath) {
        return /^\/timeline\/all\/\d{8,}$/.test(String(scopePath || ""));
    }

    function getCacheIdentity(parts) {
        parts = parts || {};
        const entryId = String(parts.entryId || "").trim();
        const appUrl = String(parts.appUrl || "").trim();
        const route = appUrl ? getTimelineRouteInfo(appUrl) : null;
        if (entryId) return "entry:" + entryId;
        if (route && route.entryId) return "entry:" + route.entryId;
        if (parts.url) return "url:" + String(parts.url).trim();
        if (parts.title) return "title:" + normalizeTitleKey(parts.title);
        return "loc:" + location.href;
    }

    function quickHash(str) {
        str = String(str || "");
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
        }
        return (h >>> 0).toString(36);
    }

    function normalizeTitleKey(title) {
        return String(title || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
    }

    function summaryVersionKey() {
        const cfg = getActiveConfig();
        return quickHash([cfg.apiUrl, cfg.model, cfg.prompt, getMaxChars(), getFetchFulltextEnabled(), getExtractStrategies().join(",")].join("|"));
    }

    function makeSummaryKey(url, title, entryId, appUrl) {
        const id = getCacheIdentity({ url, title, entryId, appUrl });
        return summaryVersionKey() + "::" + quickHash(id);
    }

    function getPendingSummaryTask(url, title, entryId, appUrl) {
        return PRELOAD_TASKS.get(makeSummaryKey(url, title, entryId, appUrl));
    }

    function getPreloadStateId(item) {
        item = item || {};
        const appUrl = String(item.appUrl || "").trim();
        const route = appUrl ? getTimelineRouteInfo(appUrl) : null;
        const entryId = String(item.entryId || (route && route.entryId) || "").trim();
        if (entryId) return "entry:" + entryId;
        if (appUrl) return "app:" + appUrl;
        if (item.url) return "url:" + String(item.url).trim();
        if (item.title) return "title:" + normalizeTitleKey(item.title);
        return "";
    }

    function setPreloadArticleState(item, state, extra) {
        const id = getPreloadStateId(item);
        if (!id) return;
        if (!state || state === "idle") {
            PRELOAD_ARTICLE_STATES.delete(id);
        } else {
            PRELOAD_ARTICLE_STATES.set(id, Object.assign({}, PRELOAD_ARTICLE_STATES.get(id) || {}, item || {}, extra || {}, {
                state,
                updatedAt: Date.now()
            }));
        }
        schedulePreloadMarkerRender();
        updatePreloadPanel();
    }

    function getPreloadArticleState(item) {
        if (!item) return "";
        if (peekSummaryCache(item.url || "", item.title || "", item.entryId || "", item.appUrl || "")) return "cached";
        const key = makeSummaryKey(item.url || "", item.title || "", item.entryId || "", item.appUrl || "");
        if (PRELOAD_RUNNING.has(key)) return "running";
        if (PRELOAD_QUEUE.some(q => q.key === key)) return "queued";
        const saved = PRELOAD_ARTICLE_STATES.get(getPreloadStateId(item));
        return saved ? saved.state : "";
    }

    function removeQueuedPreloadTask(url, title, entryId, appUrl) {
        const key = makeSummaryKey(url, title, entryId, appUrl);
        const idx = PRELOAD_QUEUE.findIndex(q => q.key === key);
        if (idx === -1) return false;
        const removed = PRELOAD_QUEUE.splice(idx, 1)[0];
        if (removed && removed.item) setPreloadArticleState(removed.item, "idle");
        PRELOAD_STATS.queued = PRELOAD_QUEUE.length;
        updatePreloadPanel();
        return true;
    }

    function withTimeout(promise, ms, label) {
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`超时 ${Math.round(ms / 1000)} 秒：${label || "预加载任务"}`)), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    function resetPreloadState(clearCache) {
        preloadClearToken++;
        PRELOAD_ARTICLES.clear();
        PRELOAD_QUEUE.length = 0;
        PRELOAD_RUNNING.clear();
        PRELOAD_FAILED_UNTIL.clear();
        PRELOAD_TASKS.clear();
        PRELOAD_ARTICLE_STATES.clear();
        PRELOAD_ACTIVE_SCOPES.clear();
        PRELOAD_STATS.detected = 0;
        PRELOAD_STATS.queued = 0;
        PRELOAD_STATS.running = 0;
        PRELOAD_STATS.success = 0;
        PRELOAD_STATS.failed = 0;
        PRELOAD_STATS.logs = [];
        if (clearCache) GM_setValue(SUMMARY_CACHE_KEY, {});
        setPreloadStatus(clearCache ? "已清空缓存和预加载队列" : "已清空预加载队列", "ok");
        schedulePreloadMarkerRender();
        updatePreloadPanel();
    }

    function clearSummaryCacheOnly() {
        GM_setValue(SUMMARY_CACHE_KEY, {});
        Array.from(PRELOAD_ARTICLE_STATES.entries()).forEach(([id, item]) => {
            if (item && item.state === "cached") PRELOAD_ARTICLE_STATES.delete(id);
        });
        setPreloadStatus("已清空 AI 总结缓存", "ok");
        schedulePreloadMarkerRender();
        updatePreloadPanel();
    }

    function preloadDetailFromFolo(appUrl) {
        if (!appUrl) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const iframe = document.createElement("iframe");
            let done = false;
            let timer = null;
            iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:960px;height:720px;opacity:0;pointer-events:none;";
            iframe.src = appUrl;
            const cleanup = () => {
                done = true;
                clearInterval(timer);
                try { iframe.remove(); } catch(e) {}
            };
            const tryRead = () => {
                if (done) return;
                let doc;
                try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch(e) { return; }
                if (!doc || !doc.body) return;
                const article = doc.getElementById('follow-entry-render') || doc.querySelector('article[data-testid="entry-render"]');
                if (!article) return;
                const text = getCleanArticleText(article);
                const originalUrl = getOriginalUrl(article) ||
                    (doc.querySelector('a[target="_blank"][href^="http"]:not([href*="app.folo.is"])') || {}).href || "";
                const title = getArticleTitle(article);
                if ((originalUrl && /^https?:\/\//.test(originalUrl)) || (text && text.length >= 80)) {
                    cleanup();
                    resolve({ title, originalUrl, text });
                }
            };
            iframe.onload = () => setTimeout(tryRead, 1200);
            document.body.appendChild(iframe);
            timer = setInterval(tryRead, 800);
            setTimeout(() => {
                if (!done) {
                    cleanup();
                    reject(new Error("详情页加载超时"));
                }
            }, PRELOAD_DETAIL_LOAD_TIMEOUT_MS);
        });
    }

    function readSummaryCache() {
        const cache = GM_getValue(SUMMARY_CACHE_KEY, {});
        return cache && typeof cache === "object" ? cache : {};
    }

    function writeSummaryCache(cache) {
        const now = Date.now();
        const entries = Object.entries(cache)
            .filter(([, v]) => v && (!v.createdAt || now - v.createdAt < SUMMARY_CACHE_TTL))
            .sort((a, b) => (b[1].lastAccess || b[1].createdAt || 0) - (a[1].lastAccess || a[1].createdAt || 0));
        const kept = SUMMARY_CACHE_MAX > 0 ? entries.slice(0, SUMMARY_CACHE_MAX) : entries;
        GM_setValue(SUMMARY_CACHE_KEY, Object.fromEntries(kept));
    }

    function findSummaryCache(url, title, entryId, appUrl) {
        const cache = readSummaryCache();
        const exactKey = makeSummaryKey(url, title, entryId, appUrl);
        const exact = cache[exactKey];
        if (exact) {
            exact.lastAccess = Date.now();
            cache[exactKey] = exact;
            writeSummaryCache(cache);
            return exact;
        }
        const routeEntryId = entryId || (appUrl ? getTimelineRouteInfo(appUrl).entryId : "") || getTimelineRouteInfo(location.href).entryId;
        const titleKey = normalizeTitleKey(title);
        const nowVersion = summaryVersionKey();
        const foundKey = Object.keys(cache).find(k => {
            const item = cache[k];
            if (!item || item.version !== nowVersion) return false;
            if (routeEntryId && String(item.entryId || "") === String(routeEntryId)) return true;
            if (url && item.url === url) return true;
            if (appUrl && item.appUrl === appUrl) return true;
            return titleKey && normalizeTitleKey(item.title) === titleKey;
        });
        if (!foundKey) return null;
        cache[foundKey].lastAccess = Date.now();
        writeSummaryCache(cache);
        return cache[foundKey];
    }

    function peekSummaryCache(url, title, entryId, appUrl) {
        const cache = readSummaryCache();
        const exact = cache[makeSummaryKey(url, title, entryId, appUrl)];
        if (exact) return exact;
        const routeEntryId = entryId || (appUrl ? getTimelineRouteInfo(appUrl).entryId : "") || getTimelineRouteInfo(location.href).entryId;
        const titleKey = normalizeTitleKey(title);
        const nowVersion = summaryVersionKey();
        const foundKey = Object.keys(cache).find(k => {
            const item = cache[k];
            if (!item || item.version !== nowVersion) return false;
            if (routeEntryId && String(item.entryId || "") === String(routeEntryId)) return true;
            if (url && item.url === url) return true;
            if (appUrl && item.appUrl === appUrl) return true;
            return titleKey && normalizeTitleKey(item.title) === titleKey;
        });
        return foundKey ? cache[foundKey] : null;
    }

    function saveSummaryCache(payload) {
        if (!payload || !payload.summary || (!payload.url && !payload.title && !payload.entryId && !payload.appUrl)) return;
        const cache = readSummaryCache();
        const now = Date.now();
        const route = payload.appUrl ? getTimelineRouteInfo(payload.appUrl) : getTimelineRouteInfo(location.href);
        const entryId = payload.entryId || route.entryId || "";
        const key = makeSummaryKey(payload.url, payload.title, entryId, payload.appUrl);
        cache[key] = Object.assign({}, payload, {
            entryId,
            version: summaryVersionKey(),
            createdAt: payload.createdAt || now,
            lastAccess: now
        });
        writeSummaryCache(cache);
        setPreloadArticleState(Object.assign({}, payload, { entryId }), "cached");
    }

    function applyCachedSummary(item, btn, resultDiv, statusDiv, wrapper) {
        if (!item || !item.summary) return false;
        if (btn) { btn.disabled = false; btn.innerText = "重新生成"; }
        if (resultDiv) {
            resultDiv.style.display = "block";
            const raw = item.url ? `${item.summary}\n\n---\n🔗 **原文链接**：[${item.url}](${item.url})` : item.summary;
            resultDiv.innerHTML = _md(raw);
        }
        if (statusDiv) {
            statusDiv.innerText = `✅ 已从本地缓存读取 · ${item.sourceLabel || "AI 总结"} · ${new Date(item.createdAt || Date.now()).toLocaleString()}`;
        }
        if (wrapper) {
            const workText = item.text || "";
            wrapper.__articleContext = {
                title: item.title,
                text: workText,
                url: item.url,
                truncated: !!item.truncated
            };
            wrapper.__summaryContent = item.summary;
            wrapper.__chatHistory = [
                { role: "system", content:
                    "你是一个有用的文章助手。下面是用户正在阅读的文章。请基于这篇文章的内容回答用户的后续提问。所有信息已包含在下方文本中,你无法访问网络。\n\n" +
                    `==== 文章标题 ====\n${item.title || "文章"}\n` +
                    (item.url ? `==== 原文链接 ====\n${item.url}\n` : "") +
                    `\n==== 文章正文 ====\n${workText}\n\n` +
                    `==== 之前的 AI 总结 ====\n${item.summary}`
                }
            ];
            const chatArea = wrapper.querySelector('.my-ai-chat-area');
            if (chatArea) {
                chatArea.style.display = 'block';
                const histDiv = chatArea.querySelector('.my-ai-chat-history');
                if (histDiv) histDiv.innerHTML = '';
            }
        }
        return true;
    }

    function markListEntryStatus(entryId, status, title) {
        if (!entryId) return;
        const mapped = status === "success" ? "cached" : status;
        setPreloadArticleState({ entryId: String(entryId), title: title || "" }, mapped);
    }

    function rememberPreloadArticle(article) {
        if (!article || (!article.url && !article.title && !article.appUrl && !article.entryId)) return;
        const title = String(article.title || "").trim();
        const url = String(article.url || "").trim();
        const appUrl = String(article.appUrl || "").trim();
        const route = appUrl ? getTimelineRouteInfo(appUrl) : null;
        const entryId = String(article.entryId || (route && route.entryId) || "").trim();
        const text = stripHtmlToText(article.text || "");
        if (!title && !url && !appUrl && !entryId) return;
        const key = quickHash(url || appUrl || entryId || title);
        const old = PRELOAD_ARTICLES.get(key) || {};
        PRELOAD_ARTICLES.set(key, Object.assign({}, old, { title, url, appUrl, entryId, text: text || old.text || "", seenAt: Date.now() }));
        PRELOAD_STATS.detected = PRELOAD_ARTICLES.size;
        return !old.seenAt;
    }

    function extractArticleHintsFromObject(obj, depth) {
        if (!obj || depth > 8) return;
        if (Array.isArray(obj)) {
            obj.forEach(v => extractArticleHintsFromObject(v, depth + 1));
            return;
        }
        if (typeof obj !== "object") return;

        const title = obj.title || obj.name || obj.entryTitle || obj.feedTitle || obj.articleTitle;
        const url = obj.url || obj.originalUrl || obj.original_url || obj.externalUrl || obj.external_url || obj.targetUrl || obj.target_url || obj.link || obj.href || obj.sourceUrl || obj.source_url;
        const text = obj.content || obj.description || obj.summary || obj.text || obj.plainText || obj.plain_text || obj.contentHTML || obj.contentHtml || obj.contentText || obj.readabilityContent;
        const entryId = obj.id || obj.entryId || obj.entry_id || obj.entryID || obj.entry_id_str;
        if (typeof title === "string" && title.trim().length > 3 && (typeof url === "string" || typeof text === "string" || entryId != null)) {
            rememberPreloadArticle({
                title,
                url: typeof url === "string" && /^https?:\/\//.test(url) && !url.includes("app.folo.is") ? url : "",
                appUrl: typeof url === "string" && url.includes("app.folo.is") ? url : "",
                entryId,
                text
            });
        }
        Object.keys(obj).slice(0, 80).forEach(k => extractArticleHintsFromObject(obj[k], depth + 1));
    }

    function installNetworkArticleCapture() {
        if (window.__foloAiNetworkCaptureInstalled) return;
        window.__foloAiNetworkCaptureInstalled = true;
        window.addEventListener("message", (event) => {
            if (event.source !== window) return;
            const data = event.data;
            if (!data || data.type !== "FOLO_AI_PRELOAD_HINTS" || !Array.isArray(data.items)) return;
            data.items.forEach(rememberPreloadArticle);
            if (data.items.length) {
                setPreloadStatus(`接口捕获到 ${data.items.length} 条文章线索，等待手动预加载`, "ok");
                schedulePreloadMarkerRender();
                updatePreloadPanel();
            }
        });

        try {
            const script = document.createElement("script");
            script.textContent = `(() => {
                if (window.__foloAiPageCaptureInstalled) return;
                window.__foloAiPageCaptureInstalled = true;
                const strip = (v) => String(v || "").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim();
                const pick = (obj, names) => {
                    for (const n of names) {
                        if (obj && typeof obj[n] === "string" && obj[n].trim()) return obj[n];
                    }
                    return "";
                };
                const walk = (obj, depth, out) => {
                    if (!obj || depth > 7) return;
                    if (Array.isArray(obj)) { obj.forEach(v => walk(v, depth + 1, out)); return; }
                    if (typeof obj !== "object") return;
                    const title = pick(obj, ["title", "name", "entryTitle", "feedTitle", "articleTitle"]);
                    const url = pick(obj, ["url", "originalUrl", "original_url", "externalUrl", "external_url", "targetUrl", "target_url", "link", "href", "sourceUrl", "source_url"]);
                    const text = pick(obj, ["content", "description", "summary", "text", "plainText", "plain_text", "contentHTML", "contentHtml", "contentText", "readabilityContent"]);
                    const entryId = obj.id || obj.entryId || obj.entry_id || obj.entryID || "";
                    if (title && (url || text || entryId)) {
                        out.push({
                            title: strip(title).slice(0, 180),
                            url: /^https?:\\/\\//.test(url) && !url.includes("app.folo.is") ? url : "",
                            appUrl: url && url.includes("app.folo.is") ? url : "",
                            entryId: String(entryId || ""),
                            text: strip(text).slice(0, 30000)
                        });
                    }
                    Object.keys(obj).slice(0, 80).forEach(k => walk(obj[k], depth + 1, out));
                };
                const emit = (json) => {
                    try {
                        const items = [];
                        walk(json, 0, items);
                        if (items.length) window.postMessage({ type: "FOLO_AI_PRELOAD_HINTS", items }, "*");
                    } catch(e) {}
                };
                const oldFetch = window.fetch;
                if (typeof oldFetch === "function") {
                    window.fetch = function(...args) {
                        return oldFetch.apply(this, args).then(resp => {
                            try {
                                const ctype = resp.headers && resp.headers.get && resp.headers.get("content-type");
                                if (ctype && ctype.includes("json")) resp.clone().json().then(emit).catch(() => {});
                            } catch(e) {}
                            return resp;
                        });
                    };
                }
                const oldOpen = XMLHttpRequest.prototype.open;
                const oldSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function(method, url) {
                    this.__foloAiUrl = url;
                    return oldOpen.apply(this, arguments);
                };
                XMLHttpRequest.prototype.send = function() {
                    this.addEventListener("load", function() {
                        try {
                            const ctype = this.getResponseHeader && this.getResponseHeader("content-type");
                            if (ctype && ctype.includes("json") && typeof this.responseText === "string") emit(JSON.parse(this.responseText));
                        } catch(e) {}
                    });
                    return oldSend.apply(this, arguments);
                };
            })();`;
            (document.documentElement || document.head || document.body).appendChild(script);
            script.remove();
            setPreloadStatus("已安装页面级接口监听", "ok");
        } catch(e) {
            setPreloadStatus("页面级接口监听安装失败,改用 DOM 扫描", "warn");
        }

        const originalFetch = window.fetch;
        if (typeof originalFetch === "function") {
            window.fetch = function(...args) {
                return originalFetch.apply(this, args).then(resp => {
                    try {
                        const ctype = resp.headers && resp.headers.get && resp.headers.get("content-type");
                        if (ctype && ctype.includes("json")) {
                            resp.clone().json().then(data => extractArticleHintsFromObject(data, 0)).catch(() => {});
                        }
                    } catch(e) {}
                    return resp;
                });
            };
        }

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            this.__foloAiUrl = url;
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
            this.addEventListener("load", function() {
                try {
                    const ctype = this.getResponseHeader && this.getResponseHeader("content-type");
                    if (ctype && ctype.includes("json") && typeof this.responseText === "string") {
                        extractArticleHintsFromObject(JSON.parse(this.responseText), 0);
                    }
                } catch(e) {}
            });
            return originalSend.apply(this, arguments);
        };
    }

    function scanListDomForPreloadArticles(options) {
        options = options || {};
        const route = getTimelineRouteInfo(location.href);
        if (!route.isTimeline || !route.scopePath) {
            if (!options.silent) setPreloadStatus("当前不是 Folo timeline 页面,跳过扫描", "warn");
            return 0;
        }
        let found = 0;
        let added = 0;
        const anchors = getCurrentListArticleAnchors(route);
        anchors.forEach(a => {
            const href = a.href || "";
            const title = getTitleFromRow(a);
            const rowText = getVisibleRowText(a);
            const itemRoute = getTimelineRouteInfo(href);
            const entryId = itemRoute.entryId;
            if (rememberPreloadArticle({ title, appUrl: href, entryId: entryId, text: rowText })) added++;
            found++;
        });
        schedulePreloadMarkerRender();
        if (!options.silent) {
            if (found) setPreloadStatus(`当前列表识别到 ${found} 篇 · 新增 ${added} 篇 · ${route.scopePath}`, "ok");
            else setPreloadStatus(`当前列表未扫到文章链接 · ${route.scopePath}`, "warn");
        }
        return found;
    }

    function getCurrentListArticleAnchors(route) {
        route = route || getTimelineRouteInfo(location.href);
        if (!route.isTimeline || !route.scopePath) return [];
        const allAnchors = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => a.offsetParent)
            .filter(a => !a.closest('#my-ai-preload-panel, #my-config-modal, #my-custom-ai-wrapper'));
        const strict = allAnchors.filter(a => sameTimelineScope(a.href, route.scopePath));
        if (strict.length || !isNumericSourceTimelineScope(route.scopePath)) return strict;

        const seen = new Set();
        return allAnchors.filter(a => {
            const info = getTimelineRouteInfo(a.href);
            if (!info.isTimeline || !info.entryId || seen.has(info.entryId)) return false;
            const row = getPreloadRowFromLink(a);
            const text = row ? (row.innerText || row.textContent || "").replace(/\s+/g, " ").trim() : "";
            if (text.length < 8) return false;
            seen.add(info.entryId);
            return true;
        });
    }

    function refreshCurrentListSnapshot(options) {
        options = options || {};
        const route = getTimelineRouteInfo(location.href);
        const scopePath = route.scopePath || "";
        const now = Date.now();
        const scopeChanged = scopePath !== preloadLastScopePath;
        if (!scopePath) return;
        if (!options.force && !scopeChanged && now - preloadLastPassiveScanAt < 1200) return;

        // When switching lists, clear stale articles and overview result
        if (scopeChanged) {
            PRELOAD_ARTICLES.clear();
            const panel = document.getElementById("my-ai-preload-panel");
            if (panel) {
                const resultDiv = panel.querySelector('.preload-overview-content');
                if (resultDiv) { resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; }
            }
        }

        preloadLastScopePath = scopePath;
        preloadLastPassiveScanAt = now;
        scanListDomForPreloadArticles({ silent: true });
        if (PRELOAD_ACTIVE_SCOPES.has(scopePath) && !isPreloadScopeIgnored(scopePath) && getPreloadEnabled()) {
            enqueuePreloadArticles(getCurrentScopePreloadCandidates());
        }
        updatePreloadPanel();
    }

    function getCurrentScopePreloadCandidates() {
        const currentRoute = getTimelineRouteInfo(location.href);
        if (!currentRoute.scopePath) return [];
        const currentScopeKey = getTimelineScopeCompareKey(currentRoute.scopePath);
        const map = new Map();
        const add = (item) => {
            if (!item) return;
            const id = getPreloadStateId(item);
            if (!id || map.has(id)) return;
            map.set(id, item);
        };
        getCurrentListEntriesFromDom().forEach(add);
        Array.from(PRELOAD_ARTICLES.values()).forEach(item => {
            if (!item.appUrl) return;
            const itemScope = getTimelineRouteInfo(item.appUrl).scopePath;
            const itemScopeKey = getTimelineScopeCompareKey(itemScope);
            if (itemScope === currentRoute.scopePath || (currentScopeKey && itemScopeKey === currentScopeKey)) add(item);
        });
        return Array.from(map.values());
    }

    function enqueuePreloadArticles(items, options) {
        if (!getPreloadEnabled()) return;
        options = options || {};
        const candidates = Array.isArray(items) ? items : getCurrentScopePreloadCandidates();
        let added = 0;
        candidates.forEach(item => {
            const key = makeSummaryKey(item.url, item.title, item.entryId, item.appUrl);
            if (findSummaryCache(item.url, item.title, item.entryId, item.appUrl)) {
                setPreloadArticleState(item, "cached");
                return;
            }
            if ((PRELOAD_FAILED_UNTIL.get(key) || 0) > Date.now() && !options.forceRetry) return;
            if (PRELOAD_RUNNING.has(key) || PRELOAD_QUEUE.some(q => q.key === key)) return;
            if (options.forceRetry) PRELOAD_FAILED_UNTIL.delete(key);
            PRELOAD_QUEUE.push({ key, item });
            setPreloadArticleState(item, "queued");
            markListEntryStatus(item.entryId, 'queued', item.title);
            added++;
        });
        PRELOAD_STATS.queued = PRELOAD_QUEUE.length;
        PRELOAD_STATS.running = PRELOAD_RUNNING.size;
        updatePreloadPanel();
        pumpPreloadQueue();
        return added;
    }

    function preloadCurrentListAll() {
        const route = getTimelineRouteInfo(location.href);
        if (!route.isTimeline || !route.scopePath) {
            setPreloadStatus("当前不是可预加载的 Folo 列表", "warn");
            return;
        }
        if (isPreloadScopeIgnored(route.scopePath)) {
            setPreloadStatus("本列表已忽略，先取消忽略再预加载", "warn");
            return;
        }
        if (!getPreloadEnabled()) setPreloadEnabled(true);
        PRELOAD_ACTIVE_SCOPES.add(route.scopePath);
        const scanned = scanListDomForPreloadArticles();
        const snapshot = getCurrentScopePreloadCandidates();
        const added = enqueuePreloadArticles(snapshot, { forceRetry: true }) || 0;
        const stats = getCurrentListPreloadStats(snapshot);
        setPreloadStatus(`本列表已加入预加载：新增 ${added} 篇 · 已缓存 ${stats.cached}/${stats.total} · 识别 ${scanned}`, added ? "ok" : "info");
        updatePreloadPanel();
    }

    function retryCurrentListFailed() {
        const candidates = getCurrentScopePreloadCandidates().filter(item => getPreloadArticleState(item) === "failed");
        if (!candidates.length) {
            setPreloadStatus("当前列表没有失败项可重试", "info");
            return;
        }
        const added = enqueuePreloadArticles(candidates, { forceRetry: true }) || 0;
        setPreloadStatus(`已重试当前列表失败项：${added} 篇`, added ? "ok" : "info");
    }

    function clearCurrentScopeQueuedTasks() {
        const route = getTimelineRouteInfo(location.href);
        const scopePath = route.scopePath;
        const scopeKey = getTimelineScopeCompareKey(scopePath);
        let removed = 0;
        for (let i = PRELOAD_QUEUE.length - 1; i >= 0; i--) {
            const item = PRELOAD_QUEUE[i].item || {};
            const itemScope = item.appUrl ? getTimelineRouteInfo(item.appUrl).scopePath : "";
            const itemScopeKey = getTimelineScopeCompareKey(itemScope);
            if (!scopePath || itemScope === scopePath || (scopeKey && itemScopeKey === scopeKey)) {
                const removedTask = PRELOAD_QUEUE.splice(i, 1)[0];
                if (removedTask && removedTask.item) setPreloadArticleState(removedTask.item, "idle");
                removed++;
            }
        }
        PRELOAD_STATS.queued = PRELOAD_QUEUE.length;
        setPreloadStatus(`已清空当前列表排队项：${removed} 篇`, "ok");
        updatePreloadPanel();
        schedulePreloadMarkerRender();
    }

    function pumpPreloadQueue() {
        if (!getPreloadEnabled()) return;
        const maxConcurrency = getPreloadConcurrency();
        while (PRELOAD_RUNNING.size < maxConcurrency && PRELOAD_QUEUE.length) {
            const next = PRELOAD_QUEUE.shift();
            if (!next || PRELOAD_RUNNING.has(next.key) || PRELOAD_TASKS.has(next.key)) continue;
            PRELOAD_RUNNING.add(next.key);
            PRELOAD_STATS.queued = PRELOAD_QUEUE.length;
            PRELOAD_STATS.running = PRELOAD_RUNNING.size;
            const taskTitle = next.item.title || next.item.url || next.item.entryId || "文章";
            const taskToken = preloadClearToken;
            setPreloadStatus(`开始：${taskTitle}`, "info");
            markListEntryStatus(next.item.entryId, 'running', taskTitle);

            const task = withTimeout(preloadOneArticle(next.item, taskToken), PRELOAD_TASK_TIMEOUT_MS, taskTitle);
            PRELOAD_TASKS.set(next.key, task);
            task
                .then(payload => {
                    if (taskToken !== preloadClearToken) return payload;
                    if (payload && payload.summary) {
                        PRELOAD_STATS.success += 1;
                        setPreloadStatus(`完成：${payload.title || taskTitle}`, "ok");
                        markListEntryStatus(next.item.entryId, 'success', payload.title || taskTitle);
                    }
                    return payload;
                })
                .catch(err => {
                    if (taskToken !== preloadClearToken) return;
                    PRELOAD_FAILED_UNTIL.set(next.key, Date.now() + 1000 * 60 * 30);
                    PRELOAD_STATS.failed += 1;
                    const msg = err && err.message ? err.message : String(err);
                    setPreloadStatus(`${/^超时/.test(msg) ? "超时" : "失败"}：${taskTitle} · ${msg}`, "err");
                    markListEntryStatus(next.item.entryId, 'failed', taskTitle);
                    console.warn("[Folo增强] 预加载失败：", err);
                })
                .finally(() => {
                    PRELOAD_RUNNING.delete(next.key);
                    PRELOAD_TASKS.delete(next.key);
                    PRELOAD_STATS.queued = PRELOAD_QUEUE.length;
                    PRELOAD_STATS.running = PRELOAD_RUNNING.size;
                    updatePreloadPanel();
                    clearTimeout(preloadPumpTimer);
                    preloadPumpTimer = setTimeout(pumpPreloadQueue, 1200);
                });
        }
    }

    async function preloadOneArticle(item, taskToken) {
        let title = item.title || "文章";
        let originalUrl = item.url || "";
        const appUrl = item.appUrl || "";
        const route = getTimelineRouteInfo(appUrl);
        const entryId = item.entryId || route.entryId || "";
        if (findSummaryCache(originalUrl, title, entryId, appUrl)) return;

        let sourceLabel = "Folo 列表预览";
        let text = item.text || "";
        if (getPreloadIframeEnabled() && (!originalUrl || text.length < 120) && appUrl) {
            try {
                const detail = await preloadDetailFromFolo(appUrl);
                if (taskToken !== preloadClearToken) throw new Error("任务已清理");
                if (detail) {
                    title = detail.title || title;
                    originalUrl = detail.originalUrl || originalUrl;
                    if (detail.text && detail.text.length > text.length) text = detail.text;
                    sourceLabel = "Folo 详情页预取";
                }
            } catch(e) {
                if (!originalUrl && (!text || text.length < 120)) throw e;
            }
        }
        if (taskToken !== preloadClearToken) throw new Error("任务已清理");
        if (getFetchFulltextEnabled() && originalUrl) {
            try {
                const result = await smartFetchArticle(originalUrl, getExtractStrategies());
                if (taskToken !== preloadClearToken) throw new Error("任务已清理");
                if (result && result.text && result.text.length >= Math.max(200, text.length * 0.8)) {
                    text = result.text;
                    sourceLabel = `${result.method}（预加载）`;
                }
            } catch(e) {
                if (!text || text.length < 120) throw e;
            }
        }
        if (!text || text.length < 120) {
            throw new Error(`正文过短：${text ? text.length : 0} 字，跳过预加载`);
        }
        const payload = await summarizeForCache({
            title,
            text,
            url: originalUrl,
            appUrl,
            entryId,
            sourceLabel
        });
        if (taskToken !== preloadClearToken) throw new Error("任务已清理");
        saveSummaryCache(payload);
        console.log("[Folo增强] 已预加载总结：", title);
        return payload;
    }

    function startAutoScanTimer() {
        if (preloadScanTimer) return;
        preloadScanTimer = setInterval(() => {
            ensurePreloadPanel();
            scanListDomForPreloadArticles();
        }, 30000);
    }

    function stopAutoScanTimer() {
        if (preloadScanTimer) {
            clearInterval(preloadScanTimer);
            preloadScanTimer = null;
        }
    }

    function startPreloadScheduler() {
        installNetworkArticleCapture();
        // 初始只识别当前列表，不自动排队。预加载由用户手动触发。
        setTimeout(() => {
            ensurePreloadPanel();
            scanListDomForPreloadArticles();
        }, 1500);
    }

    function ensurePreloadPanel() {
        if (!/^\/timeline/.test(location.pathname)) return;
        if (!document.body) return;
        let panel = document.getElementById("my-ai-preload-panel");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "my-ai-preload-panel";
            panel.innerHTML = `
                <div class="preload-head">
                    <span>📊 列表分析</span>
                    <span class="preload-mini"></span>
                    <button class="preload-scan-mini" data-act="overview" title="基于列表文章生成 AI 总览" style="background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;border:none;padding:3px 10px;border-radius:99px;cursor:pointer;font-size:12px;font-weight:600;flex:0 0 auto;">✨ 分析</button>
                    <button class="preload-toggle" title="收起/展开">展开</button>
                </div>
                <div class="preload-body">
                    <div class="preload-grid" style="display:none">
                        <span>本列表 <b data-k="listTotal">0</b></span>
                        <span style="display:none">已缓存 <b data-k="listCached">0</b></span>
                        <span style="display:none">计划 <b data-k="listPlanned">0</b></span>
                        <span style="display:none">运行 <b data-k="running">0</b></span>
                        <span style="display:none">失败 <b data-k="failed">0</b></span>
                        <span style="display:none">缓存 <b data-k="cache">0</b></span>
                    </div>
                    <div class="preload-scope" style="display:none"></div>
                    <div class="preload-actions">
                        <button data-act="preload-list" style="display:none" class="preload-act-primary">预加载本列表全部</button>
                        <button data-act="pause" style="display:none" class="preload-act-primary"></button>
                        <button data-act="ignore" style="display:none"></button>
                        <button data-act="clear-queue" style="display:none">清空队列</button>
                        <button data-act="clear-cache" style="display:none">清空缓存</button>
                        <button data-act="retry-failed" style="display:none">重试失败</button>
                        <button data-act="overview" class="preload-act-primary" style="background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;">✨ 生成列表总览</button>
                        <button data-act="settings">设置</button>
                    </div>
                    <div class="preload-overview-content" style="display:none;"></div>
                </div>
                <div class="preload-resize-handle" title="拖动调整大小"></div>`;
            document.body.appendChild(panel);
            panel.classList.add('is-minimized');
            panel.querySelector('.preload-toggle').innerText = '展开';
            applyPreloadPanelLayout(panel);
            enablePreloadPanelDragResize(panel);
            panel.querySelector('.preload-toggle').onclick = () => {
                const willMinimize = !panel.classList.contains('is-minimized');
                if (willMinimize) {
                    const rect = panel.getBoundingClientRect();
                    preloadPanelExpandedLayout = {
                        left: Math.round(rect.left),
                        bottom: Math.round((window.innerHeight || document.documentElement.clientHeight) - rect.bottom),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    };
                    savePreloadPanelLayout(panel);
                    panel.classList.add('is-minimized');
                    panel.style.width = "420px";
                    panel.style.height = "58px";
                    panel.querySelector('.preload-toggle').innerText = '展开';
                } else {
                    panel.classList.remove('is-minimized');
                    panel.querySelector('.preload-toggle').innerText = '收起';
                    applyPreloadPanelLayout(panel, preloadPanelExpandedLayout);
                }
            };
            function doDiscover() {
                const beforeCount = PRELOAD_ARTICLES.size;
                setPreloadStatus("正在发现当前列表...", "info");
                scanListDomForPreloadArticles();
                const newCount = PRELOAD_ARTICLES.size - beforeCount;
                if (newCount > 0) {
                    setPreloadStatus(`发现完成：新增 ${newCount} 篇，未自动预加载`, "ok");
                } else {
                    setPreloadStatus("发现完成：无新文章，未自动预加载", "info");
                }
                updatePreloadPanel();
            }
            // mini button now handled by overview binding below
            panel.querySelector('[data-act="preload-list"]').onclick = preloadCurrentListAll;
            panel.querySelectorAll('[data-act="overview"]').forEach(b => {
                b.onclick = () => {
                    // Expand panel if minimized
                    if (panel.classList.contains('is-minimized')) {
                        panel.classList.remove('is-minimized');
                        panel.querySelector('.preload-toggle').innerText = '收起';
                        applyPreloadPanelLayout(panel, preloadPanelExpandedLayout);
                    }
                    runCurrentListOverview();
                };
            });
            panel.querySelector('[data-act="pause"]').onclick = () => {
                const willEnable = !getPreloadEnabled();
                setPreloadEnabled(willEnable);
                if (willEnable) {
                    setPreloadStatus("已继续预加载队列", "ok");
                    pumpPreloadQueue();
                } else {
                    setPreloadStatus("已暂停预加载队列，正在运行的请求会自然结束", "info");
                }
                updatePreloadPanel();
            };
            panel.querySelector('[data-act="ignore"]').onclick = () => {
                const route = getTimelineRouteInfo(location.href);
                if (!route.scopePath) return;
                const willIgnore = !isPreloadScopeIgnored(route.scopePath);
                setPreloadScopeIgnored(route.scopePath, willIgnore);
                if (willIgnore) {
                    PRELOAD_ACTIVE_SCOPES.delete(route.scopePath);
                    clearCurrentScopeQueuedTasks();
                }
                setPreloadStatus(willIgnore ? "已忽略本列表，不再显示预加载标记" : "已取消忽略本列表", willIgnore ? "warn" : "ok");
                schedulePreloadMarkerRender();
                updatePreloadPanel();
            };
            panel.querySelector('[data-act="clear-queue"]').onclick = () => {
                if (!confirm("确定清空当前列表的排队项？正在运行的请求无法强制中断，但不会再追加新任务。")) return;
                clearCurrentScopeQueuedTasks();
            };
            panel.querySelector('[data-act="retry-failed"]').onclick = retryCurrentListFailed;
            panel.querySelector('[data-act="clear-cache"]').onclick = () => {
                if (!confirm("确定清空所有 AI 总结缓存？这不会删除当前排队任务。")) return;
                clearSummaryCacheOnly();
            };
            panel.querySelector('[data-act="settings"]').onclick = showSettingsModal;
        }
        updatePreloadPanel();
    }

    function applyPreloadPanelLayout(panel, overrideLayout) {
        const layout = overrideLayout || GM_getValue("ai_preload_panel_layout", null);
        if (!layout || typeof layout !== "object") return;
        const vw = window.innerWidth || document.documentElement.clientWidth || 1200;
        const vh = window.innerHeight || document.documentElement.clientHeight || 800;
        if (layout.width) panel.style.width = Math.max(300, Math.min(Number(layout.width), vw - 20)) + "px";
        if (layout.height) panel.style.height = Math.max(260, Math.min(Number(layout.height), vh - 20)) + "px";
        if (layout.left != null && layout.bottom != null) {
            panel.style.left = Math.max(8, Math.min(Number(layout.left), vw - 80)) + "px";
            panel.style.bottom = Math.max(8, Math.min(Number(layout.bottom), vh - 48)) + "px";
            panel.style.top = "auto";
        } else if (layout.left != null && layout.top != null) {
            const h = Number(layout.height) || panel.getBoundingClientRect().height || 360;
            const bottom = Math.max(8, vh - Number(layout.top) - h);
            panel.style.left = Math.max(8, Math.min(Number(layout.left), vw - 80)) + "px";
            panel.style.bottom = Math.min(bottom, vh - 48) + "px";
            panel.style.top = "auto";
        }
    }

    function savePreloadPanelLayout(panel) {
        if (panel.classList.contains("is-minimized")) return;
        const rect = panel.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight || 800;
        GM_setValue("ai_preload_panel_layout", {
            left: Math.round(rect.left),
            bottom: Math.round(vh - rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        });
    }

    function enablePreloadPanelDragResize(panel) {
        if (panel.dataset.dragResizeReady === "true") return;
        panel.dataset.dragResizeReady = "true";
        const head = panel.querySelector(".preload-head");
        const resizeHandle = panel.querySelector(".preload-resize-handle");
        let dragging = false;
        let resizing = false;
        let startX = 0, startY = 0, startLeft = 0, startBottom = 0, startWidth = 0, startHeight = 0;
        head.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || e.target.closest('button, input, textarea, select, a')) return;
            if (panel.classList.contains("is-minimized") && e.detail > 1) return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startBottom = vh - rect.bottom;
            panel.style.left = rect.left + "px";
            panel.style.bottom = startBottom + "px";
            panel.style.top = "auto";
            document.body.style.userSelect = "none";
            e.preventDefault();
        });
        if (resizeHandle) {
            resizeHandle.addEventListener("mousedown", (e) => {
                if (e.button !== 0 || panel.classList.contains("is-minimized")) return;
                resizing = true;
                const rect = panel.getBoundingClientRect();
                startX = e.clientX;
                startY = e.clientY;
                startWidth = rect.width;
                startHeight = rect.height;
                startLeft = rect.left;
                startBottom = (window.innerHeight || document.documentElement.clientHeight) - rect.bottom;
                panel.style.left = rect.left + "px";
                panel.style.top = rect.top + "px";
                panel.style.bottom = "auto";
                document.body.style.userSelect = "none";
                e.preventDefault();
                e.stopPropagation();
            });
        }
        window.addEventListener("mousemove", (e) => {
            const vw = window.innerWidth || document.documentElement.clientWidth;
            const vh = window.innerHeight || document.documentElement.clientHeight;
            if (dragging) {
                const rect = panel.getBoundingClientRect();
                const left = Math.max(8, Math.min(startLeft + e.clientX - startX, vw - rect.width - 8));
                const bottom = Math.max(8, Math.min(startBottom - (e.clientY - startY), vh - 48));
                panel.style.left = left + "px";
                panel.style.bottom = bottom + "px";
                panel.style.top = "auto";
            }
            if (resizing) {
                const maxWidth = vw - startLeft - 8;
                const maxHeight = vh - (parseFloat(panel.style.top) || panel.getBoundingClientRect().top) - 8;
                const width = Math.max(300, Math.min(startWidth + (e.clientX - startX), maxWidth));
                const height = Math.max(220, Math.min(startHeight + (e.clientY - startY), maxHeight));
                panel.style.width = width + "px";
                panel.style.height = height + "px";
            }
        });
        window.addEventListener("mouseup", () => {
            if (!dragging && !resizing) return;
            if (resizing) {
                const rect = panel.getBoundingClientRect();
                const vh = window.innerHeight || document.documentElement.clientHeight || 800;
                panel.style.left = rect.left + "px";
                panel.style.bottom = Math.max(8, vh - rect.bottom) + "px";
                panel.style.top = "auto";
            }
            dragging = false;
            resizing = false;
            document.body.style.userSelect = "";
            savePreloadPanelLayout(panel);
        });
    }

    function getCurrentListPreloadStats(entries) {
        entries = Array.isArray(entries) ? entries : getCurrentScopePreloadCandidates();
        const stats = { total: entries.length, cached: 0, planned: 0, running: 0, failed: 0 };
        entries.forEach(item => {
            const state = getPreloadArticleState(item);
            if (state === "cached") stats.cached++;
            else if (state === "running") stats.running++;
            else if (state === "failed") stats.failed++;
            else if (state === "queued" || state === "planned") stats.planned++;
        });
        return stats;
    }

    function updatePreloadPanel() {
        clearTimeout(preloadPanelTimer);
        preloadPanelTimer = setTimeout(() => {
            const panel = document.getElementById("my-ai-preload-panel");
            if (!panel) return;
            PRELOAD_STATS.detected = PRELOAD_ARTICLES.size;
            PRELOAD_STATS.queued = PRELOAD_QUEUE.length;
            PRELOAD_STATS.running = PRELOAD_RUNNING.size;
            const route = getTimelineRouteInfo(location.href);
            const ignored = isPreloadScopeIgnored(route.scopePath);
            const listStats = getCurrentListPreloadStats();
            const setText = (key, value) => {
                const el = panel.querySelector(`[data-k="${key}"]`);
                if (el) el.innerText = value;
            };
            setText("listTotal", listStats.total);
            setText("listCached", listStats.cached);
            setText("listPlanned", listStats.planned);
            setText("running", listStats.running);
            setText("failed", listStats.failed);
            setText("cache", getCacheCount());
            const mini = panel.querySelector('.preload-mini');
            if (mini) {
                mini.innerText = `${listStats.total} 篇文章`;
            }
            const scopeEl = panel.querySelector('.preload-scope');
            if (scopeEl) scopeEl.innerText = route.scopePath ? `当前列表：${route.scopePath}${ignored ? "（已忽略）" : ""}` : "当前列表：未识别";
            const preloadBtn = panel.querySelector('[data-act="preload-list"]');
            if (preloadBtn) {
                preloadBtn.disabled = ignored || !route.scopePath;
                preloadBtn.innerText = ignored ? "已忽略" : "预加载本列表全部";
            }
            const miniPreloadBtn = panel.querySelector('.preload-scan-mini');
            if (miniPreloadBtn) {
                miniPreloadBtn.disabled = !route.scopePath;
                miniPreloadBtn.innerText = "✨ 总览";
                miniPreloadBtn.title = "基于列表文章生成 AI 总览";
            }
            const pauseBtn = panel.querySelector('[data-act="pause"]');
            if (pauseBtn) pauseBtn.innerText = getPreloadEnabled() ? "暂停" : "继续";
            const ignoreBtn = panel.querySelector('[data-act="ignore"]');
            if (ignoreBtn) ignoreBtn.innerText = ignored ? "取消忽略" : "忽略本列表";
            panel.querySelector('.preload-log').innerHTML = PRELOAD_STATS.logs.map(log =>
                `<div class="preload-log-row ${log.level || "info"}"><span>${log.time}</span>${String(log.text || "").replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>`
            ).join("");
        }, 50);
    }

    function schedulePreloadMarkerRender() {
        clearTimeout(preloadMarkerTimer);
        preloadMarkerTimer = setTimeout(renderPreloadMarkers, 80);
    }

    function getPreloadRowFromLink(link) {
        return link && (link.closest('[role="article"], [data-radix-collection-item], [data-testid*="entry"], article, li') || link.closest('div'));
    }

    function renderPreloadMarkers() {
        const route = getTimelineRouteInfo(location.href);
        if (!route.isTimeline || !route.scopePath) return;
        const ignored = isPreloadScopeIgnored(route.scopePath);
        const seenRows = new Set();
        getCurrentListArticleAnchors(route)
            .forEach(link => {
                const itemRoute = getTimelineRouteInfo(link.href);
                const entryId = itemRoute.entryId;
                if (!entryId) return;
                const row = getPreloadRowFromLink(link);
                if (!row || seenRows.has(row)) return;
                seenRows.add(row);
                row.querySelectorAll('.folo-preload-mark').forEach(el => el.remove());
                const oldBadge = row.querySelector('.folo-preload-badge');
                const item = { title: getTitleFromRow(link), appUrl: link.href, entryId };
                const state = ignored ? "" : getPreloadArticleState(item);
                if (!state) {
                    if (oldBadge) oldBadge.remove();
                    return;
                }
                const labels = { queued: "计划", planned: "计划", running: "加载中", cached: "已缓存", failed: "失败" };
                const titles = {
                    queued: "已加入本列表预加载计划",
                    planned: "已加入本列表预加载计划",
                    running: "正在预加载总结",
                    cached: "已有本地摘要缓存",
                    failed: "预加载失败，可点重试失败"
                };
                let badge = oldBadge;
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'folo-preload-badge';
                    badge.dataset.foloPreloadEntry = entryId;
                    if (link.parentElement) link.parentElement.insertBefore(badge, link);
                }
                badge.className = `folo-preload-badge folo-preload-badge-${state}`;
                badge.innerText = labels[state] || state;
                badge.title = `${titles[state] || "预加载状态"}：${item.title || ""}`;
            });
    }

    function getCurrentListEntriesFromDom() {
        const route = getTimelineRouteInfo(location.href);
        if (!route.isTimeline || !route.scopePath) return [];
        const seen = new Set();
        return getCurrentListArticleAnchors(route)
            .map(a => {
                const itemRoute = getTimelineRouteInfo(a.href);
                return {
                    title: getTitleFromRow(a),
                    appUrl: a.href,
                    entryId: itemRoute.entryId
                };
            })
            .filter(item => {
                if (!item.entryId || seen.has(item.entryId)) return false;
                seen.add(item.entryId);
                return true;
            });
    }

    function collectCachedListSummaries() {
        const entries = getCurrentListEntriesFromDom();
        const cached = [];
        entries.forEach(item => {
            const cache = findSummaryCache("", item.title, item.entryId, item.appUrl);
            if (cache && cache.summary) cached.push(Object.assign({}, cache, item));
        });
        return { entries, cached };
    }

    function ensureListOverviewWindow() {
        let win = document.getElementById("my-list-overview-window");
        if (win) return win;
        win = document.createElement("div");
        win.id = "my-list-overview-window";
        win.innerHTML = `
            <div class="list-overview-window">
                <div class="list-overview-titlebar">
                    <div>
                        <div class="list-overview-title">列表总览</div>
                        <div class="list-overview-meta"></div>
                    </div>
                    <div class="list-overview-title-actions">
                        <button data-act="overview-refresh" title="重新生成总览">重新生成</button>
                        <button data-act="overview-close" title="关闭">关闭</button>
                    </div>
                </div>
                <div class="list-overview-scroll">
                    <div class="my-ai-content list-overview-content"></div>
                    <div class="my-ai-chat-area list-overview-chat" style="display:block;">
                        <div class="my-ai-chat-actions">
                            <button class="my-ai-chat-clear" title="清空对话">🧹 清空对话</button>
                            <button class="my-ai-chat-copy" title="复制全部对话(含总览)">📋 复制对话</button>
                            <button class="my-ai-chat-flomo" title="保存到 flomo">🌱 保存到 flomo</button>
                        </div>
                        <div class="my-ai-chat-history"></div>
                        <div class="my-ai-chat-input-row">
                            <textarea class="my-ai-chat-input" placeholder="基于当前列表总览继续提问...（Enter 发送,Shift+Enter 换行）" rows="1"></textarea>
                            <button class="my-ai-chat-send">发送</button>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(win);

        win.querySelector('[data-act="overview-close"]').onclick = () => { win.style.display = 'none'; };
        win.querySelector('[data-act="overview-refresh"]').onclick = runCurrentListOverview;
        const chatInput = win.querySelector('.my-ai-chat-input');
        const sendBtn = win.querySelector('.my-ai-chat-send');
        const clearBtn = win.querySelector('.my-ai-chat-clear');
        const copyBtn = win.querySelector('.my-ai-chat-copy');
        const flomoBtn = win.querySelector('.my-ai-chat-flomo');
        sendBtn.onclick = () => handleChatSend(win);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleChatSend(win);
            }
        });
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
        });
        clearBtn.onclick = () => {
            if (!win.__chatHistory) return;
            if (!confirm('确定清空当前对话历史？（列表上下文会保留）')) return;
            win.__chatHistory = win.__chatHistory.slice(0, 1);
            win.querySelector('.my-ai-chat-history').innerHTML = '';
        };
        copyBtn.onclick = () => handleCopyConversation(win);
        flomoBtn.onclick = () => handleSendToFlomo(win);
        return win;
    }

    function showListOverviewResult(markdown, meta) {
        const win = ensureListOverviewWindow();
        const route = getTimelineRouteInfo(location.href);
        const scope = route.scopePath || "当前列表";
        const sourceText = meta && meta.sourceText ? meta.sourceText : "";
        win.style.display = 'flex';
        win.querySelector('.list-overview-meta').innerText = meta ? `${scope} · 共 ${meta.total} 篇 · 分析 ${meta.used || meta.total} 篇` : scope;
        win.querySelector('.list-overview-content').innerHTML = _md(markdown);
        win.querySelector('.my-ai-chat-history').innerHTML = '';
        win.__articleContext = {
            title: `Folo 列表总览：${scope}`,
            text: sourceText,
            url: location.href,
            truncated: false
        };
        win.__summaryContent = markdown;
        win.__contentLabel = "列表总览";
        win.__chatHistory = [
            { role: "system", content:
                "你是 RSS 列表分析助手。用户正在查看一个 Folo 列表总览。请基于下面给出的列表总览和单篇摘要回答后续问题；不要声称你能访问网络。\n\n" +
                `==== 列表 ====\n${scope}\n${location.href}\n\n` +
                `==== 已生成的列表总览 ====\n${markdown}\n\n` +
                (sourceText ? `==== 可参考的单篇摘要材料 ====\n${sourceText}` : "")
            }
        ];
    }

    function runCurrentListOverview() {
        const config = getActiveConfig();
        if (!config.apiKey) {
            alert("请先配置 API Key");
            showSettingsModal();
            return;
        }
        // Collect articles from current DOM, enriched with PRELOAD_ARTICLES data
        const route = getTimelineRouteInfo(location.href);
        const anchors = getCurrentListArticleAnchors(route);
        const articles = [];
        const seen = new Set();
        // Build lookup from PRELOAD_ARTICLES by entryId for enrichment
        const preloadByEntry = new Map();
        PRELOAD_ARTICLES.forEach(item => {
            if (item.entryId) preloadByEntry.set(String(item.entryId), item);
        });
        anchors.forEach(a => {
            const info = getTimelineRouteInfo(a.href);
            const entryId = info.entryId;
            if (!entryId || seen.has(entryId)) return;
            seen.add(entryId);
            const title = getTitleFromRow(a);
            if (!title) return;
            const domText = getVisibleRowText(a);
            const cached = preloadByEntry.get(String(entryId));
            const url = (cached && cached.url) || "";
            const text = (cached && cached.text) || domText;
            articles.push({ title, url, appUrl: a.href, entryId, text });
        });

        if (!articles.length) {
            setPreloadStatus("当前列表没有扫描到文章，请稍等页面加载", "warn");
            return;
        }

        const useItems = articles;
        const joined = useItems.map((item, idx) => {
            const link = item.url || item.appUrl || "";
            const desc = item.text ? `\n简介: ${String(item.text).slice(0, 500)}` : "";
            const titleLabel = toMarkdownLinkLabel(item.title);
            const titleLink = link ? `[${titleLabel}](${link})` : titleLabel;
            return `编号: #${idx + 1}\n标题: ${titleLink}${desc}`;
        }).join("\n\n---\n\n");

        const hasDesc = useItems.some(item => item.text && item.text.length > 10);
        const analysisHint = hasDesc
            ? "部分文章附带了简介，请结合标题和简介进行分析。"
            : "目前只有文章标题，请基于标题进行主题归纳和趋势分析。";

        const total = useItems.length;
        const promptTemplate = getOverviewPrompt();
        const prompt = promptTemplate
            .replace(/\{\{total\}\}/g, total)
            .replace(/\{\{analysisHint\}\}/g, analysisHint)
            + `\n\n当前列表共 ${articles.length} 篇，本次分析 ${total} 篇。\n\n${joined}`;

        const panel = document.getElementById("my-ai-preload-panel");
        const overviewBtns = panel ? panel.querySelectorAll('[data-act="overview"]') : [];
        const setOvBtn = (disabled, text) => overviewBtns.forEach(b => { b.disabled = disabled; b.innerText = text; });
        setOvBtn(true, "生成中...");
        setPreloadStatus(`正在生成列表总览：${useItems.length} 篇`, "info");
        const resultDiv = panel.querySelector('.preload-overview-content');
        if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.innerHTML = '<div style="opacity:0.6">⏳ 正在生成...</div>'; }

        let streamStarted = false;
        callAIChat(
            [
                { role: "system", content: "你是 RSS 信息分析助手，擅长从文章标题和简介中提取趋势、分组主题、发现重点。引用文章时保留输入材料里的 #N 原始编号，方便用户定位和统计。" },
                { role: "user", content: prompt }
            ],
            (content) => {
                setOvBtn(false, "✨ 生成列表总览");
                if (resultDiv) resultDiv.innerHTML = _md(content);
                setPreloadStatus("列表总览生成完成", "ok");
            },
            (err) => {
                setOvBtn(false, "✨ 生成列表总览");
                if (resultDiv) resultDiv.innerHTML = '<div style="color:red">❌ ' + (err.message || err) + '</div>';
                setPreloadStatus(`列表总览失败：${err.message || err}`, "err");
            },
            (delta, full) => {
                if (!streamStarted) {
                    streamStarted = true;
                    if (resultDiv) resultDiv.innerHTML = '';
                }
                if (resultDiv) resultDiv.innerHTML = _md(full) + '<span style="opacity:0.5">▍</span>';
            }
        );
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
            preloadEnabled: getPreloadEnabled(),
            preloadLimit: getPreloadLimit(),
            preloadConcurrency: getPreloadConcurrency(),
            preloadIframeEnabled: getPreloadIframeEnabled(),
            preloadIgnoredScopes: getIgnoredPreloadScopes(),
            fetchFulltext: getFetchFulltextEnabled(),
            maxChars: getMaxChars(),
            flomoApiUrl: getFlomoApiUrl(),
            flomoTags: getFlomoTags()
        };
    }

    function applyRemotePayloadToLocal(remote) {
        if (!remote || typeof remote !== 'object') throw new Error("云端数据格式错误");
        if (Array.isArray(remote.profiles) && remote.profiles.length > 0) {
            saveProfiles(remote.profiles, remote.currentProfileId || remote.profiles[0].id);
        }
        if (Array.isArray(remote.extractStrategies)) setExtractStrategies(remote.extractStrategies);
        if (typeof remote.autoSummarize === 'boolean') setAutoSummarizeEnabled(remote.autoSummarize);
        if (typeof remote.preloadEnabled === 'boolean') setPreloadEnabled(remote.preloadEnabled);
        if (typeof remote.preloadLimit === 'number') setPreloadLimit(remote.preloadLimit);
        if (typeof remote.preloadConcurrency === 'number') setPreloadConcurrency(remote.preloadConcurrency);
        if (typeof remote.preloadIframeEnabled === 'boolean') setPreloadIframeEnabled(remote.preloadIframeEnabled);
        if (remote.preloadIgnoredScopes && typeof remote.preloadIgnoredScopes === 'object') GM_setValue("ai_preload_ignored_scopes", remote.preloadIgnoredScopes);
        if (typeof remote.fetchFulltext === 'boolean') setFetchFulltextEnabled(remote.fetchFulltext);
        if (typeof remote.maxChars === 'number') setMaxChars(remote.maxChars);
        if (typeof remote.flomoApiUrl === 'string') setFlomoApiUrl(remote.flomoApiUrl);
        if (typeof remote.flomoTags === 'string') setFlomoTags(remote.flomoTags);
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
                preloadEnabled: typeof local.preloadEnabled === 'boolean' ? local.preloadEnabled : remote.preloadEnabled,
                preloadLimit: typeof local.preloadLimit === 'number' ? local.preloadLimit : remote.preloadLimit,
                preloadConcurrency: typeof local.preloadConcurrency === 'number' ? local.preloadConcurrency : remote.preloadConcurrency,
                preloadIframeEnabled: typeof local.preloadIframeEnabled === 'boolean' ? local.preloadIframeEnabled : remote.preloadIframeEnabled,
                preloadIgnoredScopes: Object.assign({}, remote.preloadIgnoredScopes || {}, local.preloadIgnoredScopes || {}),
                fetchFulltext: typeof local.fetchFulltext === 'boolean' ? local.fetchFulltext : remote.fetchFulltext,
                maxChars: typeof local.maxChars === 'number' ? local.maxChars : remote.maxChars,
                flomoApiUrl: local.flomoApiUrl || remote.flomoApiUrl || "",
                flomoTags: local.flomoTags || remote.flomoTags || ""
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
            preloadEnabled: typeof remote.preloadEnabled === 'boolean' ? remote.preloadEnabled : local.preloadEnabled,
            preloadLimit: typeof remote.preloadLimit === 'number' ? remote.preloadLimit : local.preloadLimit,
            preloadConcurrency: typeof remote.preloadConcurrency === 'number' ? remote.preloadConcurrency : local.preloadConcurrency,
            preloadIframeEnabled: typeof remote.preloadIframeEnabled === 'boolean' ? remote.preloadIframeEnabled : local.preloadIframeEnabled,
            preloadIgnoredScopes: Object.assign({}, local.preloadIgnoredScopes || {}, remote.preloadIgnoredScopes || {}),
            fetchFulltext: typeof remote.fetchFulltext === 'boolean' ? remote.fetchFulltext : local.fetchFulltext,
            maxChars: typeof remote.maxChars === 'number' ? remote.maxChars : local.maxChars,
            flomoApiUrl: remote.flomoApiUrl || local.flomoApiUrl || "",
            flomoTags: remote.flomoTags || local.flomoTags || ""
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
    GM_registerMenuCommand("⚡ 切换『手动预加载队列』(当前: " + (getPreloadEnabled() ? "开" : "关") + ")", () => {
        setPreloadEnabled(!getPreloadEnabled());
        alert("已切换。当前：" + (getPreloadEnabled() ? "允许手动预加载队列执行" : "暂停手动预加载队列"));
    });
    GM_registerMenuCommand("🧹 清空 AI 总结缓存", () => {
        if (confirm("确定清空本地 AI 总结缓存？")) {
            clearSummaryCacheOnly();
            alert("已清空缓存");
        }
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

        #my-ai-preload-panel {
            position: fixed;
            left: 18px;
            bottom: 18px;
            z-index: 99998;
            width: 380px;
            min-width: 300px;
            min-height: 120px;
            max-width: calc(100vw - 36px);
            max-height: calc(100vh - 36px);
            border: 1px solid rgba(139, 92, 246, 0.35);
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.94);
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.16);
            color: #1f2937;
            overflow: hidden;
            resize: none;
            backdrop-filter: blur(10px);
            font-size: 12px;
            display: flex;
            flex-direction: column;
        }
        #my-ai-preload-panel .preload-resize-handle {
            position: absolute;
            bottom: 0;
            right: 0;
            width: 22px;
            height: 22px;
            cursor: nwse-resize;
            z-index: 2;
        }
        #my-ai-preload-panel .preload-resize-handle::after {
            content: "";
            position: absolute;
            right: 5px;
            bottom: 5px;
            width: 9px;
            height: 9px;
            border-right: 2px solid rgba(124, 58, 237, 0.55);
            border-bottom: 2px solid rgba(124, 58, 237, 0.55);
            border-radius: 1px;
        }
        .dark #my-ai-preload-panel {
            background: rgba(17, 24, 39, 0.94);
            color: #e5e7eb;
            border-color: rgba(139, 92, 246, 0.5);
        }
        .dark #my-ai-preload-panel .preload-grid b { color: #f3f4f6; }
        .dark #my-ai-preload-panel .preload-log {
            background: rgba(15, 23, 42, 0.72);
            border-color: rgba(139, 92, 246, 0.22);
        }
        .dark #my-ai-preload-panel .preload-overview {
            background: rgba(15, 23, 42, 0.62);
            border-color: rgba(139, 92, 246, 0.26);
        }
        #my-ai-preload-panel .preload-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            font-weight: 700;
            background: linear-gradient(90deg, rgba(124,58,237,0.11), rgba(37,99,235,0.07));
            gap: 8px;
            border-bottom: 1px solid rgba(139, 92, 246, 0.14);
            cursor: move;
            user-select: none;
        }
        #my-ai-preload-panel .preload-mini {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: left;
            font-size: 12px;
            font-weight: 600;
            color: #64748b;
        }
        #my-ai-preload-panel .preload-scan-mini {
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            flex: 0 0 auto;
        }
        #my-ai-preload-panel .preload-scan-mini:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }
        .dark #my-ai-preload-panel .preload-scan-mini {
            color: #c4b5fd;
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.28), rgba(37, 99, 235, 0.2));
        }
        #my-ai-preload-panel .preload-scan-mini:hover {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.28), rgba(37, 99, 235, 0.22));
            border-color: rgba(124, 58, 237, 0.5);
        }
        /* mini button stays visible in minimized state */
        #my-ai-preload-panel .preload-toggle {
            border: 1px solid rgba(139, 92, 246, 0.25);
            background: rgba(139, 92, 246, 0.10);
            cursor: pointer;
            font-size: 12px;
            font-weight: 700;
            color: inherit;
            min-width: 58px;
            height: 28px;
            border-radius: 999px;
            padding: 0 10px;
            line-height: 26px;
            text-align: center;
            flex: 0 0 auto;
        }
        #my-ai-preload-panel .preload-toggle:hover {
            background: rgba(139, 92, 246, 0.18);
            border-color: rgba(139, 92, 246, 0.4);
        }
        #my-ai-preload-panel.is-minimized {
            width: min(320px, calc(100vw - 36px)) !important;
            min-height: 40px;
            height: 40px !important;
            overflow: hidden;
            resize: none;
        }
        #my-ai-preload-panel.is-minimized .preload-head {
            height: 40px;
            padding: 6px 10px;
            gap: 8px;
            box-sizing: border-box;
            border-bottom: none;
        }
        #my-ai-preload-panel.is-minimized .preload-head > span:first-child {
            flex: 0 0 auto;
            white-space: nowrap;
            font-size: 12px;
            overflow: hidden;
        }
        #my-ai-preload-panel.is-minimized .preload-mini {
            text-align: left;
            font-size: 11px;
            font-weight: 700;
            color: #334155;
            min-width: 60px;
        }
        .dark #my-ai-preload-panel.is-minimized .preload-mini {
            color: #e5e7eb;
        }
        #my-ai-preload-panel.is-minimized .preload-resize-handle {
            display: none;
        }
        #my-ai-preload-panel.is-minimized .preload-toggle {
            min-width: 36px;
            height: 24px;
            padding: 0 6px;
            font-size: 10px;
            line-height: 22px;
            border-radius: 999px;
        }
        #my-ai-preload-panel.is-minimized .preload-body {
            display: none;
        }
        #my-ai-preload-panel.is-minimized .preload-grid,
        #my-ai-preload-panel.is-minimized .preload-scope,
        #my-ai-preload-panel.is-minimized .preload-actions,
        #my-ai-preload-panel.is-minimized .preload-overview {
            display: none;
        }
        #my-ai-preload-panel.is-minimized .preload-section-title {
            display: none;
        }
        #my-ai-preload-panel.is-minimized .preload-log {
            display: none;
        }
        #my-ai-preload-panel.is-minimized .preload-log-row {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 0;
        }
        #my-ai-preload-panel .preload-body {
            padding: 12px;
            box-sizing: border-box;
            min-height: 0;
        }
        #my-ai-preload-panel .preload-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-bottom: 10px;
        }
        #my-ai-preload-panel .preload-grid span {
            background: rgba(139, 92, 246, 0.08);
            border: 1px solid rgba(139, 92, 246, 0.12);
            border-radius: 8px;
            padding: 6px 7px;
            white-space: nowrap;
            color: #64748b;
            font-size: 11px;
        }
        #my-ai-preload-panel .preload-grid b {
            display: block;
            margin-top: 2px;
            color: #111827;
            font-size: 14px;
            line-height: 1.1;
        }
        #my-ai-preload-panel .preload-scope {
            margin: 0 0 10px;
            color: #64748b;
            font-size: 11px;
            word-break: break-all;
        }
        #my-ai-preload-panel .preload-actions {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
            margin-bottom: 10px;
        }
        #my-ai-preload-panel .preload-actions button {
            border: 1px solid rgba(139, 92, 246, 0.25);
            background: rgba(139, 92, 246, 0.08);
            color: inherit;
            border-radius: 8px;
            padding: 7px 3px;
            cursor: pointer;
            font-size: 11px;
            line-height: 1.2;
            white-space: normal;
            word-break: keep-all;
            overflow-wrap: anywhere;
            min-width: 0;
            min-height: 34px;
            overflow: hidden;
        }
        #my-ai-preload-panel .preload-actions button[data-act="preload-list"] {
            grid-column: 1 / -1;
            min-height: 38px;
            font-size: 13px;
        }
        #my-ai-preload-panel .preload-actions .preload-act-primary {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.18), rgba(37, 99, 235, 0.14));
            border-color: rgba(124, 58, 237, 0.35);
            font-weight: 700;
            color: #4c1d95;
        }
        .dark #my-ai-preload-panel .preload-actions .preload-act-primary {
            color: #c4b5fd;
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.28), rgba(37, 99, 235, 0.2));
        }
        #my-ai-preload-panel .preload-actions .preload-act-primary:hover {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.28), rgba(37, 99, 235, 0.22));
            border-color: rgba(124, 58, 237, 0.5);
        }
        #my-ai-preload-panel .preload-section-title {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            margin: 2px 0 6px;
        }
        #my-ai-preload-panel .preload-log {
            max-height: 96px;
            overflow-y: auto;
            border: 1px solid rgba(139, 92, 246, 0.12);
            border-radius: 10px;
            padding: 6px 8px;
            background: rgba(248, 250, 252, 0.78);
        }
        #my-ai-preload-panel .preload-log-row {
            line-height: 1.35;
            padding: 3px 0;
            word-break: break-word;
            color: #64748b;
        }
        #my-ai-preload-panel .preload-log-row span {
            opacity: 0.65;
            margin-right: 5px;
        }
        #my-ai-preload-panel .preload-log-row.ok { color: #059669; }
        #my-ai-preload-panel .preload-log-row.warn { color: #b45309; }
        #my-ai-preload-panel .preload-log-row.err { color: #dc2626; }
        .folo-preload-mark {
            display: inline-block;
            font-size: 12px;
            margin-right: 3px;
            vertical-align: middle;
            opacity: 0.85;
            line-height: 1;
            flex-shrink: 0;
        }
        .folo-preload-mark-discovered { opacity: 0.45; font-size: 11px; }
        .folo-preload-mark-queued { opacity: 0.55; }
        .folo-preload-mark-running { animation: folo-spin 1.5s linear infinite; }
        .folo-preload-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 18px;
            min-width: 38px;
            padding: 0 6px;
            margin-right: 6px;
            border-radius: 999px;
            border: 1px solid rgba(100, 116, 139, 0.24);
            background: rgba(248, 250, 252, 0.92);
            color: #475569;
            font-size: 11px;
            font-weight: 700;
            line-height: 18px;
            white-space: nowrap;
            vertical-align: middle;
            flex-shrink: 0;
            pointer-events: auto;
        }
        .folo-preload-badge-queued,
        .folo-preload-badge-planned {
            border-color: rgba(124, 58, 237, 0.32);
            background: rgba(139, 92, 246, 0.12);
            color: #5b21b6;
        }
        .folo-preload-badge-running {
            border-color: rgba(37, 99, 235, 0.35);
            background: rgba(59, 130, 246, 0.12);
            color: #1d4ed8;
        }
        .folo-preload-badge-cached {
            border-color: rgba(5, 150, 105, 0.32);
            background: rgba(16, 185, 129, 0.12);
            color: #047857;
        }
        .folo-preload-badge-failed {
            border-color: rgba(220, 38, 38, 0.28);
            background: rgba(239, 68, 68, 0.10);
            color: #b91c1c;
        }
        .dark .folo-preload-badge {
            background: rgba(15, 23, 42, 0.78);
            color: #cbd5e1;
        }
        .dark .folo-preload-badge-queued,
        .dark .folo-preload-badge-planned { color: #c4b5fd; }
        .dark .folo-preload-badge-running { color: #93c5fd; }
        .dark .folo-preload-badge-cached { color: #6ee7b7; }
        .dark .folo-preload-badge-failed { color: #fca5a5; }
        @keyframes folo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        #my-ai-preload-panel .preload-overview {
            margin-top: 10px;
            border: 1px solid rgba(139, 92, 246, 0.14);
            border-radius: 12px;
            padding: 9px 10px;
            background: rgba(255, 255, 255, 0.66);
        }
        #my-ai-preload-panel .preload-overview-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
            font-weight: 700;
            color: #4c1d95;
        }
        .dark #my-ai-preload-panel .preload-overview-head { color: #c4b5fd; }
        #my-ai-preload-panel .preload-overview-head button {
            border: 1px solid rgba(139, 92, 246, 0.25);
            background: rgba(139, 92, 246, 0.08);
            color: inherit;
            border-radius: 7px;
            padding: 3px 8px;
            cursor: pointer;
            font-size: 11px;
        }
        #my-ai-preload-panel .preload-body {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
        #my-ai-preload-panel .preload-overview-content {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            line-height: 1.85;
            font-size: 14px;
            color: #1f2937;
            padding: 16px 18px 24px;
            margin-top: 10px;
            border-top: 1px dashed rgba(139, 92, 246, 0.25);
        }
        .dark #my-ai-preload-panel .preload-overview-content { color: #d1d5db; }
        #my-ai-preload-panel .preload-overview-content h1,
        #my-ai-preload-panel .preload-overview-content h2,
        #my-ai-preload-panel .preload-overview-content h3 {
            font-weight: 700;
            margin: 1.15em 0 0.55em;
            color: #4c1d95;
        }
        #my-ai-preload-panel .preload-overview-content h1 { font-size: 1.2rem; }
        #my-ai-preload-panel .preload-overview-content h2 { font-size: 1.1rem; }
        #my-ai-preload-panel .preload-overview-content h3 { font-size: 1rem; }
        .dark #my-ai-preload-panel .preload-overview-content h1,
        .dark #my-ai-preload-panel .preload-overview-content h2,
        .dark #my-ai-preload-panel .preload-overview-content h3 { color: #c4b5fd; }
        #my-ai-preload-panel .preload-overview-content p {
            margin: 0.72em 0;
            line-height: 1.85;
        }
        #my-ai-preload-panel .preload-overview-content strong { color: #7c3aed; }
        .dark #my-ai-preload-panel .preload-overview-content strong { color: #a78bfa; }
        #my-ai-preload-panel .preload-overview-content ul,
        #my-ai-preload-panel .preload-overview-content ol {
            padding-left: 1.8em;
            margin: 0.7em 0 1em;
        }
        #my-ai-preload-panel .preload-overview-content li { margin: 0.42em 0; }
        #my-ai-preload-panel .preload-overview-content .md-article-ref {
            margin: 0.64em 0;
            padding: 7px 10px 7px 12px;
            border-left: 3px solid rgba(124, 58, 237, 0.36);
            border-radius: 8px;
            background: rgba(139, 92, 246, 0.055);
            line-height: 1.72;
        }
        #my-ai-preload-panel .preload-overview-content .md-article-no {
            display: inline-flex;
            min-width: 38px;
            margin-right: 4px;
            color: #7c3aed;
            font-weight: 800;
        }
        .dark #my-ai-preload-panel .preload-overview-content .md-article-ref {
            background: rgba(139, 92, 246, 0.12);
            border-left-color: rgba(167, 139, 250, 0.46);
        }
        #my-ai-preload-panel .preload-overview-content code {
            background: rgba(139,92,246,0.12);
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 0.88em;
            color: #be185d;
        }
        #my-ai-preload-panel .preload-overview-content hr {
            border: none;
            border-top: 1px dashed rgba(139,92,246,0.2);
            margin: 0.8em 0;
        }
        #my-ai-preload-panel .preload-overview-content a {
            color: #7c3aed;
            text-decoration: underline;
            text-underline-offset: 3px;
            overflow-wrap: anywhere;
        }

        #my-list-overview-window {
            position: fixed;
            inset: 0;
            z-index: 100000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 22px;
            background: rgba(15, 23, 42, 0.22);
            backdrop-filter: blur(4px);
            box-sizing: border-box;
        }
        #my-list-overview-window .list-overview-window {
            width: min(980px, calc(100vw - 44px));
            height: min(860px, calc(100vh - 44px));
            display: flex;
            flex-direction: column;
            border: 1px solid rgba(139, 92, 246, 0.28);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.98);
            box-shadow: 0 22px 70px rgba(15, 23, 42, 0.28);
            color: #1f2937;
            overflow: hidden;
        }
        .dark #my-list-overview-window .list-overview-window {
            background: rgba(17, 24, 39, 0.98);
            color: #e5e7eb;
            border-color: rgba(139, 92, 246, 0.46);
        }
        #my-list-overview-window .list-overview-titlebar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 16px;
            border-bottom: 1px solid rgba(139, 92, 246, 0.16);
            background: linear-gradient(90deg, rgba(124,58,237,0.10), rgba(37,99,235,0.06));
            flex: 0 0 auto;
        }
        #my-list-overview-window .list-overview-title {
            font-weight: 800;
            font-size: 15px;
        }
        #my-list-overview-window .list-overview-meta {
            margin-top: 3px;
            color: #64748b;
            font-size: 12px;
            word-break: break-all;
        }
        #my-list-overview-window .list-overview-title-actions {
            display: flex;
            gap: 8px;
            flex: 0 0 auto;
        }
        #my-list-overview-window .list-overview-title-actions button {
            border: 1px solid rgba(139, 92, 246, 0.28);
            background: rgba(139, 92, 246, 0.08);
            color: inherit;
            border-radius: 8px;
            padding: 7px 12px;
            cursor: pointer;
            font-weight: 700;
        }
        #my-list-overview-window .list-overview-scroll {
            flex: 1;
            overflow-y: auto;
            padding: 18px 22px 20px;
            box-sizing: border-box;
        }
        #my-list-overview-window .list-overview-content {
            display: block !important;
            max-width: 820px;
            margin: 0 auto 16px;
            padding: 0 0 14px;
            border-top: none;
            border-bottom: 1px dashed rgba(139, 92, 246, 0.26);
            font-size: 15px;
            line-height: 1.75;
        }
        #my-list-overview-window .list-overview-content h1,
        #my-list-overview-window .list-overview-content h2,
        #my-list-overview-window .list-overview-content h3 {
            margin: 14px 0 8px;
        }
        #my-list-overview-window .list-overview-chat {
            max-width: 820px;
            margin: 0 auto;
        }
        #my-list-overview-window .my-ai-chat-history {
            max-height: 280px;
        }
        @media (max-width: 720px) {
            #my-list-overview-window {
                padding: 8px;
            }
            #my-list-overview-window .list-overview-window {
                width: calc(100vw - 16px);
                height: calc(100vh - 16px);
            }
            #my-list-overview-window .list-overview-titlebar {
                align-items: flex-start;
                flex-direction: column;
            }
            #my-list-overview-window .list-overview-scroll {
                padding: 14px;
            }
        }

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
                        <label class="my-input-label">📊 列表分析</label>
                        <div class="auto-summary-row">
                            <div style="font-size:11px;color:#888;margin-bottom:4px;">分析提示词（可用变量：{{total}} 文章数，{{analysisHint}} 分析提示）</div>
                            <textarea id="cfg-overview-prompt" class="my-input" rows="8" style="font-size:12px;line-height:1.5;resize:vertical;"></textarea>
                            <div class="desc">修改提示词可调整分析风格和输出结构。留空恢复默认。</div>
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
                            <div style="margin-top:8px;">
                                <div style="font-size:11px;color:#666;margin-bottom:3px;font-weight:bold;">🏷️ 自动标签</div>
                                <input id="cfg-flomo-tags" class="my-input" type="text" placeholder="#Folo增强 #AI总结">
                                <div class="desc">发送到 flomo 时自动追加在内容末尾，多个标签用空格分隔</div>
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
        document.getElementById('cfg-overview-prompt').value = getOverviewPrompt();
        document.getElementById('cfg-flomo-url').value = getFlomoApiUrl();
        document.getElementById('cfg-flomo-tags').value = getFlomoTags();
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
            setFlomoTags(document.getElementById('cfg-flomo-tags').value);
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
                document.getElementById('cfg-overview-prompt').value = getOverviewPrompt();
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
            setFlomoTags(document.getElementById('cfg-flomo-tags').value);
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
            setOverviewPrompt(document.getElementById('cfg-overview-prompt').value.trim());
            setFlomoApiUrl(document.getElementById('cfg-flomo-url').value);
            setFlomoTags(document.getElementById('cfg-flomo-tags').value);
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

    function buildSummaryRequest(title, text, url) {
        const config = getActiveConfig();
        const maxChars = getMaxChars();
        let workText = text || "";
        let truncatedNote = "";
        if (workText.length > maxChars) {
            workText = workText.substring(0, maxChars);
            truncatedNote = `（已截断到 ${maxChars} 字符）`;
        }
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
            "Just summarize what's given. If a URL is provided, reference it in your answer when appropriate. " +
            "If the content appears truncated or incomplete, still do your best to summarize whatever is available. " +
            "Never say the content is incomplete or that you cannot summarize - always provide a useful summary.";

        return {
            workText,
            truncatedNote,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: config.prompt + "\n\n" + fullContent }
            ]
        };
    }

    function summarizeForCache(opts) {
        const { title, text, url, appUrl, entryId, sourceLabel } = opts;
        const config = getActiveConfig();
        if (!config.apiKey) return Promise.reject(new Error("请先配置 API Key"));
        if (!text || text.length < 10) return Promise.reject(new Error("正文内容过少"));
        const req = buildSummaryRequest(title, text, url);
        return new Promise((resolve, reject) => {
            callAIChat(
                req.messages,
                (content) => resolve({
                    title,
                    text: req.workText,
                    url,
                    appUrl,
                    entryId,
                    summary: content,
                    sourceLabel,
                    truncated: !!req.truncatedNote
                }),
                reject
            );
        });
    }

    function callAIWithText(opts) {
        const { title, text, url, appUrl, entryId, btn, resultDiv, statusDiv, sourceLabel, wrapper } = opts;
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

        const req = buildSummaryRequest(title, text, url);
        const workText = req.workText;
        const truncatedNote = req.truncatedNote;

        btn.disabled = true; btn.innerText = "AI 生成中...";
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `🤖 正在调用 AI 模型... <span style="font-size:0.8em;color:#888">(${config.model})</span>`;
        if (statusDiv) statusDiv.innerText = `📄 正文来源：${sourceLabel} · 长度：${text.length} 字 ${truncatedNote}`;

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
            req.messages,
            (content) => {
                btn.disabled = false; btn.innerText = "重新生成";
                let raw = content;
                if (url) raw += `\n\n---\n🔗 **原文链接**：[${url}](${url})`;
                resultDiv.innerHTML = _md(raw);
                saveSummaryCache({
                    title,
                    text: workText,
                    url,
                    appUrl,
                    entryId,
                    summary: content,
                    sourceLabel,
                    truncated: !!truncatedNote
                });

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
        const route = getTimelineRouteInfo(location.href);
        const appUrl = route.entryId ? location.href : "";
        const entryId = route.entryId || "";
        const cached = findSummaryCache(originalUrl, title, entryId, appUrl);
        if (cached && applyCachedSummary(cached, btn, resultDiv, statusDiv, wrapper)) {
            return;
        }

        const pendingTask = getPendingSummaryTask(originalUrl, title, entryId, appUrl);
        if (pendingTask) {
            btn.disabled = true;
            btn.innerText = "等待后台总结...";
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `⏳ 这篇文章正在后台预加载总结中，完成后会自动显示。`;
            if (statusDiv) statusDiv.innerText = `⚡ 正在复用后台队列任务，避免重复调用 AI`;
            try {
                const payload = await pendingTask;
                const ready = findSummaryCache(originalUrl, title, entryId, appUrl) || payload;
                if (ready && applyCachedSummary(ready, btn, resultDiv, statusDiv, wrapper)) return;
            } catch (err) {
                console.warn("[Folo增强] 等待后台预加载失败,改走前台总结：", err);
                if (statusDiv) statusDiv.innerText = `⚠️ 后台预加载失败，改为当前页面总结：${err.message || err}`;
            } finally {
                btn.disabled = false;
            }
        }
        if (removeQueuedPreloadTask(originalUrl, title, entryId, appUrl)) {
            setPreloadStatus(`已从后台队列移除当前文章，交给详情页总结：${title}`, "info");
        }

        if (!fetchFulltext || !originalUrl) {
            const reason = !originalUrl ? "未找到原文链接" : "已禁用全文抓取";
            callAIWithText({
                title, text: previewText, url: originalUrl, appUrl, entryId,
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
                    appUrl,
                    entryId,
                    btn, resultDiv, statusDiv, wrapper,
                    sourceLabel: `${result.method}（${new URL(originalUrl).hostname}）`
                });
            } else {
                console.warn("[Folo增强] 全文比预览短,使用预览。");
                callAIWithText({
                    title, text: previewText, url: originalUrl, appUrl, entryId,
                    btn, resultDiv, statusDiv, wrapper,
                    sourceLabel: `Folo 预览（${result.method}抓到 ${result.length} 字 < 预览）`
                });
            }
        } catch (err) {
            console.warn("[Folo增强] 所有抓取策略失败：", err);
            callAIWithText({
                title, text: previewText, url: originalUrl, appUrl, entryId,
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
            lines.push(`===== 🤖 ${wrapper.__contentLabel || "AI 总结"} =====`);
            lines.push(summaryText);
            lines.push('');
        }

        // 后续对话(跳过 system)
        const dialog = history.filter(m => m.role !== 'system');
        if (dialog.length) {
            lines.push('===== 💬 后续对话 =====');
            dialog.forEach(m => {
                const model = getActiveConfig().model || '';
                const tag = m.role === 'user' ? '【我】' : `【AI · ${model}】`;
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

        const tags = getFlomoTags();
        const content = tags ? `${text}\n\n---\n${tags}` : text;

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

            if (tryRenderCachedForCurrentArticle(wrapper)) {
                wrapper.dataset.autoTriggered = 'true';
            } else if (getAutoSummarizeEnabled()) {
                tryAutoSummarize(wrapper);
            }
        } else if (!savedUrl) {
            wrapper.dataset.url = currentUrl;
        }
    }

    function tryRenderCachedForCurrentArticle(wrapper) {
        const article = document.getElementById('follow-entry-render') || document.querySelector('article[data-testid="entry-render"]');
        if (!article || !wrapper) return false;
        const title = getArticleTitle(article);
        const originalUrl = getOriginalUrl(article);
        const route = getTimelineRouteInfo(location.href);
        const cached = findSummaryCache(originalUrl, title, route.entryId, route.entryId ? location.href : "");
        if (!cached) return false;
        const btn = wrapper.querySelector('.my-ai-btn');
        const content = wrapper.querySelector('.my-ai-content');
        const statusDiv = wrapper.querySelector('.my-ai-status');
        return applyCachedSummary(cached, btn, content, statusDiv, wrapper);
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
        ensurePreloadPanel();
        refreshCurrentListSnapshot();
        schedulePreloadMarkerRender();
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

            if (tryRenderCachedForCurrentArticle(wrapper)) {
                wrapper.dataset.autoTriggered = 'true';
            } else if (getAutoSummarizeEnabled()) {
                tryAutoSummarize(wrapper);
            }
        }
    }

    function startObserver() {
        const observer = new MutationObserver(checkAndInject);
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(checkAndInject, 500);
    }
    startPreloadScheduler();
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver);

})();
