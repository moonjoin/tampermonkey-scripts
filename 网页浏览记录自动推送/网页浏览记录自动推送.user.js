// ==UserScript==
// @name        多渠道网页浏览记录自动推送
// @namespace   https://github.com/moonjoin/tampermonkey-scripts
// @version      0.2
// @description  将当前网页标题/链接推送到 Telegram 或飞书自定义机器人 Webhook
// @icon         https://img.icons8.com/?size=100&id=90385&format=png&color=000000
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    /******************************************************************
     * 0) 配置存储（本地）
     ******************************************************************/
    const STORAGE_KEY = 'multi_push_config_v1';
    const DEFAULT_CONFIG = {
        common: {
            autoSendOnLoad: true,
            delayMs: 3000,
            cooldownMs: 5 * 60 * 1000,
            includeTitle: true,
            includeUrl: true,
            includeTime: false,
        },
        telegram: {
            enabled: true,
            botToken: '',
            chatId: '',
        },
        feishu: {
            enabled: false,
            webhookUrl: '',
            // 飞书自定义机器人：如果开启“签名校验”，填这里；不填则不签名
            secret: '',
        }
    };

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
            const raw = (typeof GM_getValue === 'function') ? GM_getValue(STORAGE_KEY, '') : '';
            if (raw) return deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
        } catch (e) {}
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    function saveConfig(cfg) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY, JSON.stringify(cfg));
        } catch (e) {
            console.warn('[多渠道推送] 保存配置失败:', e);
        }
    }

    let cfg = loadConfig();

    /******************************************************************
     * 1) UI（配置面板 + 导入导出）
     ******************************************************************/
    const UI = {
        rootId: 'mpush-root',
        btnId: 'mpush-float-btn',
        panelId: 'mpush-panel',
        toastId: 'mpush-toast',
    };

    function addStyle(css) {
        if (typeof GM_addStyle === 'function') return GM_addStyle(css);
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    addStyle(`
        #${UI.btnId} {
            position: fixed;
            right: 16px;
            bottom: 16px;
            width: 44px;
            height: 44px;
            border-radius: 22px;
            border: none;
            cursor: pointer;
            z-index: 2147483647;
            background: rgba(0,0,0,0.75);
            color: #fff;
            font-size: 18px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.25);
            backdrop-filter: blur(6px);
        }
        #${UI.btnId}:hover { transform: scale(1.05); }

        #${UI.panelId} {
            position: fixed;
            right: 16px;
            bottom: 70px;
            width: 380px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 120px);
            overflow: auto;
            z-index: 2147483647;
            background: rgba(20,20,20,0.95);
            color: #eee;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 12px;
            padding: 12px 12px 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            backdrop-filter: blur(10px);
            display: none;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,"PingFang SC","Hiragino Sans GB","Microsoft Yahei",sans-serif;
        }
        #${UI.panelId}.show { display: block; }

        .mpush-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
        .mpush-row label { font-size: 12px; opacity: 0.9; width: 92px; flex: 0 0 auto; }
        .mpush-row input[type="text"], .mpush-row input[type="password"], .mpush-row input[type="number"], .mpush-row textarea {
            flex: 1 1 auto;
            width: 100%;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.06);
            color: #eee;
            outline: none;
            font-size: 12px;
        }
        .mpush-row textarea { min-height: 110px; resize: vertical; }
        .mpush-hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
        .mpush-title { font-weight: 700; font-size: 13px; }
        .mpush-subtitle { font-size: 12px; opacity: 0.75; margin: 6px 0 2px; }
        .mpush-divider { height: 1px; background: rgba(255,255,255,0.10); margin: 10px 0; }
        .mpush-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .mpush-btn {
            padding: 8px 10px;
            border-radius: 9px;
            border: 1px solid rgba(255,255,255,0.14);
            background: rgba(255,255,255,0.08);
            color: #fff;
            cursor: pointer;
            font-size: 12px;
        }
        .mpush-btn.primary { background: rgba(79,195,247,0.25); border-color: rgba(79,195,247,0.35); }
        .mpush-btn.danger { background: rgba(255,82,82,0.22); border-color: rgba(255,82,82,0.35); }
        .mpush-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        #${UI.toastId} {
            position: fixed;
            left: 50%;
            bottom: 18px;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.80);
            color: #fff;
            padding: 8px 14px;
            border-radius: 999px;
            z-index: 2147483647;
            font-size: 12px;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease;
        }
        #${UI.toastId}.show { opacity: 1; }
        .mpush-checkbox { display:flex; align-items:center; gap:8px; }
        .mpush-checkbox input { transform: translateY(1px); }
        .mpush-mini { font-size: 11px; opacity: 0.75; line-height: 1.4; }
    `);

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
        const t = document.getElementById(UI.toastId);
        if (!t) return;
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1800);
    }

    function buildUI() {
        if (document.getElementById(UI.rootId)) return;

        const root = el('div', { id: UI.rootId });
        const floatBtn = el('button', { id: UI.btnId, title: '推送设置 / 立即推送' }, '📨');
        const panel = el('div', { id: UI.panelId });
        const toastNode = el('div', { id: UI.toastId }, '');

        const hd = el('div', { class: 'mpush-hd' });
        hd.appendChild(el('div', null, `<div class="mpush-title">多渠道网页推送</div><div class="mpush-mini">Telegram / 飞书 Webhook（配置保存在本地）</div>`));
        const closeBtn = el('button', { class: 'mpush-btn', title: '关闭' }, '关闭');
        closeBtn.addEventListener('click', () => panel.classList.remove('show'));
        hd.appendChild(closeBtn);

        panel.appendChild(hd);

        // Common
        panel.appendChild(el('div', { class: 'mpush-subtitle' }, '通用设置'));
        panel.appendChild(buildCheckboxRow('自动在页面打开后推送', 'common.autoSendOnLoad'));
        panel.appendChild(buildNumberRow('延迟（ms）', 'common.delayMs', 0, 600000));
        panel.appendChild(buildNumberRow('冷却（秒）', 'common.cooldownMs', 0, 3600 * 24, 1000));
        panel.appendChild(el('div', { class: 'mpush-mini' }, '冷却：同一 URL 在冷却时间内不会重复推送（手动“立即推送”可强制）。'));

        panel.appendChild(el('div', { class: 'mpush-divider' }));

        // Telegram
        panel.appendChild(el('div', { class: 'mpush-subtitle' }, 'Telegram'));
        panel.appendChild(buildCheckboxRow('启用 Telegram 推送', 'telegram.enabled'));
        panel.appendChild(buildTextRow('Bot Token', 'telegram.botToken', true));
        panel.appendChild(buildTextRow('Chat ID', 'telegram.chatId', false));

        panel.appendChild(el('div', { class: 'mpush-divider' }));

        // Feishu
        panel.appendChild(el('div', { class: 'mpush-subtitle' }, '飞书（自定义机器人 Webhook）'));
        panel.appendChild(buildCheckboxRow('启用飞书推送', 'feishu.enabled'));
        panel.appendChild(buildTextRow('Webhook URL', 'feishu.webhookUrl', false));
        panel.appendChild(buildTextRow('签名密钥（可选）', 'feishu.secret', true));
        panel.appendChild(el('div', { class: 'mpush-mini' }, '如果机器人开启了“签名校验”，把密钥填到这里；未开启则留空。'));

        panel.appendChild(el('div', { class: 'mpush-divider' }));

        // Import / Export
        panel.appendChild(el('div', { class: 'mpush-subtitle' }, '导入 / 导出'));
        const ioArea = el('textarea', { id: 'mpush-io', placeholder: '这里粘贴配置 JSON，用“导入配置”应用；或点击“导出配置”生成 JSON。' });
        panel.appendChild(el('div', { class: 'mpush-row' }, `<label>配置 JSON</label>`));
        panel.lastChild.appendChild(ioArea);

        const fileInput = el('input', { id: 'mpush-file', type: 'file', accept: 'application/json', style: 'display:none' });
        fileInput.addEventListener('change', async () => {
            const f = fileInput.files && fileInput.files[0];
            if (!f) return;
            try {
                const text = await f.text();
                ioArea.value = text;
                toast('已加载文件内容，点击“导入配置”应用');
            } catch (e) {
                toast('读取文件失败');
            } finally {
                fileInput.value = '';
            }
        });

        panel.appendChild(fileInput);

        const btns = el('div', { class: 'mpush-btns' });
        const saveBtn = el('button', { class: 'mpush-btn primary' }, '保存配置');
        const exportBtn = el('button', { class: 'mpush-btn' }, '导出配置');
        const importBtn = el('button', { class: 'mpush-btn' }, '导入配置');
        const importFileBtn = el('button', { class: 'mpush-btn' }, '选择文件导入');
        const clearBtn = el('button', { class: 'mpush-btn danger' }, '重置为默认');
        const pushBtn = el('button', { class: 'mpush-btn primary' }, '立即推送当前页');

        saveBtn.addEventListener('click', () => {
            cfg = readConfigFromUI(panel, cfg);
            saveConfig(cfg);
            toast('✅ 已保存');
        });

        exportBtn.addEventListener('click', () => {
            cfg = readConfigFromUI(panel, cfg);
            const text = JSON.stringify(cfg, null, 2);
            ioArea.value = text;
            try {
                if (typeof GM_setClipboard === 'function') GM_setClipboard(text);
                else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
            } catch (e) {}
            downloadText(text, `multi-push-config.json`);
            toast('已导出（已填入文本框，并尝试复制到剪贴板/下载文件）');
        });

        importBtn.addEventListener('click', () => {
            try {
                const incoming = JSON.parse(ioArea.value || '{}');
                cfg = deepMerge(DEFAULT_CONFIG, incoming);
                saveConfig(cfg);
                fillUI(panel, cfg);
                toast('✅ 已导入并保存');
            } catch (e) {
                toast('导入失败：JSON 格式不正确');
            }
        });

        importFileBtn.addEventListener('click', () => fileInput.click());

        clearBtn.addEventListener('click', () => {
            if (!confirm('确定要重置为默认配置吗？（不会影响 Tampermonkey 以外的数据）')) return;
            cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            saveConfig(cfg);
            fillUI(panel, cfg);
            toast('已重置为默认');
        });

        pushBtn.addEventListener('click', async () => {
            cfg = readConfigFromUI(panel, cfg);
            saveConfig(cfg);
            await pushCurrentPage({ force: true, showToast: true });
        });

        btns.appendChild(saveBtn);
        btns.appendChild(pushBtn);
        btns.appendChild(exportBtn);
        btns.appendChild(importBtn);
        btns.appendChild(importFileBtn);
        btns.appendChild(clearBtn);
        panel.appendChild(btns);

        floatBtn.addEventListener('click', () => {
            panel.classList.toggle('show');
            if (panel.classList.contains('show')) {
                cfg = loadConfig();
                fillUI(panel, cfg);
            }
        });

        root.appendChild(floatBtn);
        root.appendChild(panel);
        document.body.appendChild(root);
        document.body.appendChild(toastNode);
    }

    function buildTextRow(label, path, isSecret) {
        const row = el('div', { class: 'mpush-row' });
        row.appendChild(el('label', null, label));
        const input = el('input', { type: isSecret ? 'password' : 'text', 'data-path': path, autocomplete: 'off' });
        row.appendChild(input);
        return row;
    }

    function buildNumberRow(label, path, min, max, scale) {
        const row = el('div', { class: 'mpush-row' });
        row.appendChild(el('label', null, label));
        const input = el('input', { type: 'number', 'data-path': path, min: String(min || 0), max: String(max || 9999999), step: '1' });
        input.dataset.scale = scale ? String(scale) : '';
        row.appendChild(input);
        return row;
    }

    function buildCheckboxRow(text, path) {
        const row = el('div', { class: 'mpush-row' });
        row.appendChild(el('label', null, ''));
        const wrap = el('div', { class: 'mpush-checkbox' });
        const input = el('input', { type: 'checkbox', 'data-path': path });
        wrap.appendChild(input);
        wrap.appendChild(el('span', null, text));
        row.appendChild(wrap);
        return row;
    }

    function setByPath(obj, path, value) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
            cur = cur[k];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function getByPath(obj, path) {
        const parts = path.split('.');
        let cur = obj;
        for (const k of parts) {
            if (!cur || typeof cur !== 'object') return undefined;
            cur = cur[k];
        }
        return cur;
    }

    function fillUI(panel, cfgObj) {
        panel.querySelectorAll('[data-path]').forEach((node) => {
            const path = node.dataset.path;
            const val = getByPath(cfgObj, path);
            if (node.type === 'checkbox') node.checked = !!val;
            else if (node.type === 'number') {
                const scale = node.dataset.scale ? Number(node.dataset.scale) : 1;
                node.value = (val == null ? '' : String(Math.round(Number(val) / scale)));
            } else {
                node.value = val == null ? '' : String(val);
            }
        });
    }

    function readConfigFromUI(panel, baseCfg) {
        const next = JSON.parse(JSON.stringify(baseCfg));
        panel.querySelectorAll('[data-path]').forEach((node) => {
            const path = node.dataset.path;
            if (node.type === 'checkbox') {
                setByPath(next, path, !!node.checked);
            } else if (node.type === 'number') {
                const raw = String(node.value || '').trim();
                const n = raw === '' ? 0 : Number(raw);
                const scale = node.dataset.scale ? Number(node.dataset.scale) : 1;
                setByPath(next, path, Math.max(0, Math.round(n * scale)));
            } else {
                setByPath(next, path, String(node.value || '').trim());
            }
        });
        return next;
    }

    function downloadText(text, filename) {
        try {
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (e) {}
    }

    // 需要过滤的标题关键词
    const FILTERED_KEYWORDS = ['reCAPTCHA', 'Content from', 'Twitter Embed', 'Sign In', '嵌入', 'Local Storage', 'Leader Iframe', 'header sync', 'Just a moment'];

    // 存储最近推送的URL及时间戳
    const recentUrls = new Map();

    // 检查标题是否包含过滤关键词
    function shouldFilterTitle(title) {
        // 检查标题是否为空或仅包含空白字符
        if (!title || title.trim() === '') {
            return true;
        }
        return FILTERED_KEYWORDS.some(keyword => title.includes(keyword));
    }

    function isUrlInCooldown(url, cooldownMs) {
        const lastPushTime = recentUrls.get(url);
        if (!lastPushTime) return false;
        return (Date.now() - lastPushTime) < (cooldownMs || 0);
    }

    function markUrlPushed(url) {
        recentUrls.set(url, Date.now());
    }

    function buildMessageText(title, url) {
        const parts = [];
        if (cfg.common.includeTitle) parts.push(`网页标题: ${title}`);
        if (cfg.common.includeUrl) parts.push(`网页链接: ${url}`);
        if (cfg.common.includeTime) parts.push(`时间: ${new Date().toLocaleString()}`);
        return parts.join('\n');
    }

    function buildTelegramApiUrl(botToken) {
        return `https://api.telegram.org/bot${botToken}/sendMessage`;
    }

    function requestJson(url, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                data: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' },
                onload: (resp) => resolve(resp),
                onerror: (err) => reject(err),
            });
        });
    }

    async function sendToTelegram(title, url) {
        if (!cfg.telegram.enabled) return { skipped: true, reason: 'telegram_disabled' };
        if (!cfg.telegram.botToken || !cfg.telegram.chatId) return { skipped: true, reason: 'telegram_not_configured' };

        const api = buildTelegramApiUrl(cfg.telegram.botToken);
        const message = { chat_id: cfg.telegram.chatId, text: buildMessageText(title, url) };
        const resp = await requestJson(api, message);
        return { ok: true, resp };
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    async function genFeishuSign(secret, timestampSec) {
        // 参考飞书自定义机器人签名：以 `${timestamp}\n${secret}` 作为 key，对空字符串做 HMAC-SHA256，然后 Base64
        // （如果你的机器人没开签名校验，secret 留空即可）
        if (!window.crypto || !window.crypto.subtle) throw new Error('当前环境不支持 crypto.subtle，无法生成飞书签名');
        const enc = new TextEncoder();
        const keyBytes = enc.encode(`${timestampSec}\n${secret}`);
        const msgBytes = enc.encode('');
        const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
        return arrayBufferToBase64(sig);
    }

    async function sendToFeishu(title, url) {
        if (!cfg.feishu.enabled) return { skipped: true, reason: 'feishu_disabled' };
        if (!cfg.feishu.webhookUrl) return { skipped: true, reason: 'feishu_not_configured' };

        const payload = {
            msg_type: 'text',
            content: { text: buildMessageText(title, url) }
        };

        const secret = String(cfg.feishu.secret || '').trim();
        if (secret) {
            const ts = Math.floor(Date.now() / 1000);
            payload.timestamp = ts;
            payload.sign = await genFeishuSign(secret, ts);
        }

        const resp = await requestJson(cfg.feishu.webhookUrl, payload);
        return { ok: true, resp };
    }

    async function pushCurrentPage(opts) {
        opts = opts || {};
        cfg = loadConfig(); // 运行时再读一次，避免你改了配置但不刷新页面

        const currentUrl = window.location.href;
        const currentTitle = document.title;

        if (shouldFilterTitle(currentTitle)) return;

        const cooldownMs = Number(cfg.common.cooldownMs || 0);
        if (!opts.force && cooldownMs > 0 && isUrlInCooldown(currentUrl, cooldownMs)) return;

        const hasAnyEnabled = !!(cfg.telegram.enabled || cfg.feishu.enabled);
        if (!hasAnyEnabled) {
            if (opts.showToast) toast('两个渠道都未启用');
            return;
        }

        // 如果启用了渠道但没填配置：提示并打开面板
        const needTg = cfg.telegram.enabled && (!cfg.telegram.botToken || !cfg.telegram.chatId);
        const needFs = cfg.feishu.enabled && (!cfg.feishu.webhookUrl);
        if (needTg || needFs) {
            if (opts.showToast) toast('请先在面板里补全推送配置');
            const panel = document.getElementById(UI.panelId);
            if (panel) {
                panel.classList.add('show');
                fillUI(panel, cfg);
            }
            return;
        }

        // 同一页面同时推送多个渠道：只做一次冷却记录
        markUrlPushed(currentUrl);

        const tasks = [];
        if (cfg.telegram.enabled) tasks.push(sendToTelegram(currentTitle, currentUrl));
        if (cfg.feishu.enabled) tasks.push(sendToFeishu(currentTitle, currentUrl));

        const results = await Promise.allSettled(tasks);
        const fail = results.filter(r => r.status === 'rejected');
        if (opts.showToast) {
            if (fail.length === 0) toast('✅ 推送成功');
            else toast(`⚠️ 推送完成（失败 ${fail.length} 个）`);
        }
    }

    // 设置3秒延迟执行
    let timer;
    window.addEventListener('DOMContentLoaded', () => {
        buildUI();
        // Tampermonkey 菜单：打开面板 / 立即推送
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('打开推送配置面板', () => {
                const panel = document.getElementById(UI.panelId);
                if (!panel) return;
                panel.classList.add('show');
                cfg = loadConfig();
                fillUI(panel, cfg);
            });
            GM_registerMenuCommand('立即推送当前页（忽略冷却）', () => pushCurrentPage({ force: true, showToast: true }));
        }

        cfg = loadConfig();
        if (cfg.common.autoSendOnLoad) {
            const delay = Math.max(0, Number(cfg.common.delayMs || 0));
            timer = setTimeout(() => pushCurrentPage({ force: false, showToast: false }), delay);
        }
    });

    // 页面关闭前清除定时器
    window.addEventListener('beforeunload', () => {
        if (timer) {
            clearTimeout(timer);
        }
    });
})();
