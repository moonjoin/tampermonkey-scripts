// ==UserScript==
// @name         网页一键自动复制
// @namespace    https://github.com/moonjoin/tampermonkey-scripts
// @version      0.3
// @description  选中文本自动复制，支持出处信息开关、快捷键切换、拖拽移动，带优雅视觉反馈
// @author       次元饺子
// @icon         https://img.icons8.com/?size=100&id=90385&format=png&color=000000
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'autoCopySettings';
    const POSITION_KEY = 'autoCopyPosition';
    const MIN_SELECTION_LENGTH = 2;
    const COPY_COOLDOWN = 2000;
    const FADE_DELAY = 3000;
    const DRAG_THRESHOLD = 5;

    let settings = loadSettings();
    let lastCopyTime = 0;
    let fadeTimer = null;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragMoved = false;
    let elemStartX = 0;
    let elemStartY = 0;

    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return { enabled: true, withSource: false };
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {}
    }

    function loadPosition() {
        try {
            const saved = localStorage.getItem(POSITION_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return { left: 20, top: 20 };
    }

    function savePosition(left, top) {
        try {
            localStorage.setItem(POSITION_KEY, JSON.stringify({ left, top }));
        } catch (e) {}
    }

    GM_addStyle(`
        .ac-toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.82);
            color: #fff;
            padding: 8px 18px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 2147483647;
            pointer-events: none;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            backdrop-filter: blur(4px);
        }
        .ac-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .ac-toggle {
            position: fixed;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            transition: opacity 0.5s ease;
        }
        .ac-toggle.faded {
            opacity: 0.25;
        }
        .ac-toggle.faded:hover {
            opacity: 1;
        }
        .ac-toggle.dragging {
            transition: none;
            opacity: 1;
        }
        .ac-toggle-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 18px;
            border: none;
            cursor: grab;
            font-size: 16px;
            background: rgba(0, 0, 0, 0.72);
            color: #fff;
            backdrop-filter: blur(4px);
            transition: transform 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .ac-toggle-btn:active {
            cursor: grabbing;
        }
        .ac-toggle-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        }
        .ac-toggle-btn.off {
            background: rgba(120, 120, 120, 0.5);
        }
        @keyframes ac-pulse {
            0%   { box-shadow: 0 0 0 0 rgba(79, 195, 247, 0.6); }
            70%  { box-shadow: 0 0 0 10px rgba(79, 195, 247, 0); }
            100% { box-shadow: 0 0 0 0 rgba(79, 195, 247, 0); }
        }
        .ac-toggle-btn.pulse {
            animation: ac-pulse 0.6s ease-out;
        }
        .ac-settings {
            position: absolute;
            left: 0;
            background: rgba(30, 30, 30, 0.95);
            backdrop-filter: blur(8px);
            border-radius: 10px;
            padding: 10px 14px;
            opacity: 0;
            pointer-events: none;
            transition: all 0.2s ease;
            white-space: nowrap;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .ac-settings.above {
            bottom: 46px;
            transform: translateY(6px);
        }
        .ac-settings.below {
            top: 46px;
            transform: translateY(-6px);
        }
        .ac-settings.show {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
        }
        .ac-settings-row {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #eee;
            font-size: 13px;
            cursor: pointer;
            padding: 3px 0;
        }
        .ac-settings-row:hover {
            color: #fff;
        }
        .ac-settings-row .ac-checkbox {
            width: 14px;
            height: 14px;
            border: 1.5px solid #888;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: all 0.15s ease;
        }
        .ac-settings-row .ac-checkbox.checked {
            background: #4fc3f7;
            border-color: #4fc3f7;
        }
        .ac-settings-row .ac-checkbox.checked::after {
            content: '';
            display: block;
            width: 4px;
            height: 7px;
            border: solid #fff;
            border-width: 0 1.5px 1.5px 0;
            transform: rotate(45deg) translateY(-1px);
        }
        .ac-hint {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(255,255,255,0.1);
            color: #888;
            font-size: 11px;
        }
    `);

    const toast = document.createElement('div');
    toast.className = 'ac-toast';
    document.body.appendChild(toast);

    let toastTimer = null;
    function showToast(text) {
        clearTimeout(toastTimer);
        toast.textContent = text || '✅ 已复制';
        toast.classList.add('show');
        toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
    }

    const container = document.createElement('div');
    container.className = 'ac-toggle';

    const btn = document.createElement('button');
    btn.className = 'ac-toggle-btn';
    btn.title = '自动复制 (Alt+X) | 拖拽移动';
    btn.textContent = '📋';

    const panel = document.createElement('div');
    panel.className = 'ac-settings';
    panel.innerHTML = `
        <div class="ac-settings-row" data-action="toggleSource">
            <div class="ac-checkbox"></div>
            <span>附带出处信息</span>
        </div>
        <div class="ac-hint">快捷键 Alt+X 开关</div>
    `;

    container.appendChild(panel);
    container.appendChild(btn);
    document.body.appendChild(container);

    const sourceCheckbox = panel.querySelector('.ac-checkbox');

    function applyPosition() {
        const pos = loadPosition();
        container.style.left = pos.left + 'px';
        container.style.top = pos.top + 'px';
    }
    applyPosition();

    function updatePanelDirection() {
        panel.classList.remove('above', 'below');
        const rect = container.getBoundingClientRect();
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        panel.classList.add(spaceAbove >= spaceBelow ? 'above' : 'below');
    }

    function updateUI() {
        btn.textContent = settings.enabled ? '📋' : '📄';
        btn.classList.toggle('off', !settings.enabled);
        btn.title = settings.enabled
            ? '自动复制已开启 (Alt+X) | 拖拽移动'
            : '自动复制已关闭 (Alt+X) | 拖拽移动';
        sourceCheckbox.classList.toggle('checked', settings.withSource);
    }

    function pulseButton() {
        btn.classList.remove('pulse');
        void btn.offsetWidth;
        btn.classList.add('pulse');
    }

    function startFadeTimer() {
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => {
            if (!panel.classList.contains('show')) {
                container.classList.add('faded');
            }
        }, FADE_DELAY);
    }

    function resetFadeTimer() {
        clearTimeout(fadeTimer);
        container.classList.remove('faded');
        startFadeTimer();
    }

    container.addEventListener('mouseenter', resetFadeTimer);
    container.addEventListener('mouseleave', () => {
        if (!panel.classList.contains('show')) startFadeTimer();
    });

    function toggleEnabled() {
        settings.enabled = !settings.enabled;
        saveSettings();
        updateUI();
        showToast(settings.enabled ? '✅ 自动复制已开启' : '⏸️ 自动复制已关闭');
    }

    function toggleSource() {
        settings.withSource = !settings.withSource;
        saveSettings();
        updateUI();
        showToast(settings.withSource ? '📎 出处信息已开启' : '📄 出处信息已关闭');
    }

    btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        elemStartX = rect.left;
        elemStartY = rect.top;
        dragMoved = false;
        isDragging = true;
        container.classList.add('dragging');

        const onMove = (ev) => {
            if (!isDragging) return;
            const dx = ev.clientX - dragStartX;
            const dy = ev.clientY - dragStartY;
            if (!dragMoved && Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
            dragMoved = true;
            panel.classList.remove('show');
            let newX = elemStartX + dx;
            let newY = elemStartY + dy;
            newX = Math.max(0, Math.min(newX, window.innerWidth - rect.width));
            newY = Math.max(0, Math.min(newY, window.innerHeight - rect.height));
            container.style.left = newX + 'px';
            container.style.top = newY + 'px';
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            isDragging = false;
            container.classList.remove('dragging');
            if (dragMoved) {
                const r = container.getBoundingClientRect();
                savePosition(r.left, r.top);
                updatePanelDirection();
                resetFadeTimer();
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dragMoved) return;
        toggleEnabled();
    });

    btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragMoved) return;
        updatePanelDirection();
        panel.classList.toggle('show');
    });

    panel.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = e.target.closest('[data-action]');
        if (!row) return;
        if (row.dataset.action === 'toggleSource') toggleSource();
    });

    document.addEventListener('click', () => panel.classList.remove('show'));

    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key.toLowerCase() === 'x') {
            e.preventDefault();
            toggleEnabled();
        }
    });

    function isInsideEditable(el) {
        if (!el) return false;
        if (el.isContentEditable) return true;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function copySelectedText() {
        if (!settings.enabled) return;

        const activeEl = document.activeElement;
        if (isInsideEditable(activeEl)) return;

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        if (!selectedText || selectedText.length < MIN_SELECTION_LENGTH) return;

        if (Date.now() - lastCopyTime < COPY_COOLDOWN) return;
        lastCopyTime = Date.now();

        let content = selectedText;
        if (settings.withSource) {
            content += `\n—————\n${document.title}\n${window.location.href}`;
        }

        navigator.clipboard.writeText(content).then(() => {
            pulseButton();
            showToast('✅ 已复制');
        }).catch(err => console.error('复制失败:', err));
    }

    document.addEventListener('mouseup', copySelectedText);

    let selectionChangeTimer = null;
    document.addEventListener('selectionchange', () => {
        clearTimeout(selectionChangeTimer);
        selectionChangeTimer = setTimeout(() => {
            const selection = window.getSelection();
            const text = selection.toString().trim();
            if (text.length >= MIN_SELECTION_LENGTH) {
                copySelectedText();
            }
        }, 500);
    });

    document.addEventListener('touchend', (e) => {
        setTimeout(copySelectedText, 100);
    });

    updateUI();
    startFadeTimer();
})();