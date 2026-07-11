# 摘要结果操作按钮可配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 为 11 个摘要结果操作按钮提供显示、隐藏、排序和保存后立即重绘。

**Architecture:** 不拆分单 userscript。新增稳定按钮目录、配置归一化函数和按上下文渲染的统一工厂；正常摘要、生图、兜底、HTML PPT 共用文字行，图片专属按钮共用配置但渲染于图片卡片。设置面板修改编辑副本，保存成功后仅重绘现存 DOM。

**Tech Stack:** Tampermonkey userscript、原生 ES6 DOM、localStorage、Chrome DevTools、Node.js。

## Global Constraints

- 只修改 B站省流助手_-_字幕AI摘要_Pro.user.js；不新增运行时代码文件。
- resultActionButtons 只保存 { id, enabled }，目录维护文案、场景、class 和事件。
- 固定 ID 及默认顺序：copy_summary、edit_summary、generate_image、copy_image_prompt、post_comment、html_ppt、send_flomo、download_transcript、download_srt、save_image、fill_image_comment；默认全启用。
- 字段缺失、非数组、无法解析使用默认；显式 [] 必须代表关闭全部。
- 未知 ID 不渲染；重复保留第一项；缺失已知项按默认顺序追加 enabled:true；仅 enabled === false 关闭。
- download_srt 同时要求启用、场景适用、hasStructuredSubtitleData(rawSubtitleBody) 和非空 buildSrtContent(rawSubtitleBody)。
- 不改业务行为、按钮语义、样式类别、API 调用、enableImageAutoDownload、POSITION_KEY；不覆盖评论、弹幕、全面分析、聊天区。
- saveConfig 失败不刷新；成功后更新 CONFIG 和已有 DOM，不调用 runSummary()、callAIStream()、generateImageByApi()。
- 全部关闭时 .tabbit-result-actions 和 .tabbit-img-actions 为空，无占位。

---

## 文件结构

- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js:817-970，配置默认值、归一化、保存状态。
- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js:1142-1225, 2318-2370, 5060-5182, 5349-5435, 5561-5624, 6339-6525，目录渲染、正常/生图/兜底/PPT/字幕路径。
- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js:4076-4458, 7716-8705，样式、设置编辑、导入、重置、保存刷新。
- Modify: docs/superpowers/plans/2026-07-11-result-action-buttons.md，本计划；不添加测试框架。

## 任务分解

### Task 1: 默认配置与旧配置归一化

**Files:**
- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js:817-970
- Test: DevTools Console，node --check

**Interfaces:**
- Produces: RESULT_ACTION_BUTTON_IDS: string[]。
- Produces: getDefaultResultActionButtons(): Array<{id:string,enabled:boolean}>。
- Produces: normalizeResultActionButtons(raw:unknown): Array<{id:string,enabled:boolean}>。
- Consumed by: loadConfig()、设置编辑器、两个渲染器。

- [ ] **Step 1: 写失败断言**

~~~js
console.assert(normalizeResultActionButtons(undefined).length === 11);
console.assert(normalizeResultActionButtons([]).length === 0);
console.assert(normalizeResultActionButtons([{id:'send_flomo',enabled:false},{id:'unknown'},{id:'send_flomo',enabled:true}])[0].enabled === false);
~~~

Expected: 实现前 ReferenceError: normalizeResultActionButtons is not defined。

- [ ] **Step 2: 写最小归一化实现**

在 DEFAULT_CONFIG 前加入以下代码，并在 DEFAULT_CONFIG 加 resultActionButtons: getDefaultResultActionButtons()：

~~~js
const RESULT_ACTION_BUTTON_IDS=['copy_summary','edit_summary','generate_image','copy_image_prompt','post_comment','html_ppt','send_flomo','download_transcript','download_srt','save_image','fill_image_comment'];
function getDefaultResultActionButtons(){return RESULT_ACTION_BUTTON_IDS.map(function(id){return {id:id,enabled:true};});}
function normalizeResultActionButtons(raw){
  if(!Array.isArray(raw)) return getDefaultResultActionButtons();
  if(raw.length===0) return [];
  var known=new Set(RESULT_ACTION_BUTTON_IDS), seen=new Set(), out=[];
  raw.forEach(function(item){if(!item||!known.has(item.id)||seen.has(item.id))return;seen.add(item.id);out.push({id:item.id,enabled:item.enabled!==false});});
  RESULT_ACTION_BUTTON_IDS.forEach(function(id){if(!seen.has(id))out.push({id:id,enabled:true});});
  return out;
}
~~~

- [ ] **Step 3: 接入加载且不写回**

在 loadConfig() 的 Object.assign({}, DEFAULT_CONFIG, saved) 后执行 merged.resultActionButtons = normalizeResultActionButtons(saved.resultActionButtons)；无保存配置返回值也归一化 undefined。loadConfig() 不得调用 saveConfig()。

- [ ] **Step 4: 验证**

Run: node --check 'B站省流助手_-_字幕AI摘要_Pro.user.js'

Expected: 退出码 0、无输出；旧配置缺字段时 11 项全显示，其他 API、预设、生图字段不变。

- [ ] **Step 5: Commit**

~~~bash
git add B站省流助手_-_字幕AI摘要_Pro.user.js
git commit -m "feat: normalize result action button config"
~~~

### Task 2: 统一目录和上下文渲染

**Files:**
- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js:2318-2370, 5060-5182, 5561-5624, 6339-6525
- Test: DevTools Elements、手工点击

**Interfaces:**
- Produces: RESULT_ACTION_BUTTONS: Record<string,{id,scopes,imageRow,requiresText,settingsLabel,create(context)}>。
- Produces: renderResultActionButtons(container,context):void，renderImageActionButtons(container,context):void，refreshResultActionButtons(contentDiv):void。
- ResultActionContext: {resultType:'summary'|'image'|'fallback'|'html_ppt',contentDiv,videoInfo,hasText,hasImage,hasTimelineSubtitle,imageDataUrl?,imageFilenameSuffix?,summaryFallback?}。
- Consumes: copyResult、startSummaryEdit、triggerManualImageGen、triggerHtmlPptGen、sendToFlomo、fillBiliCommentSummary、downloadTranscript、downloadSubtitleSrt、downloadGeneratedImage、fillBiliCommentTextOnly。

- [ ] **Step 1: 写失败验收**

~~~js
CONFIG.resultActionButtons=[];
refreshResultActionButtons(document.querySelector('.tabbit-panel-content'));
~~~

Expected: 实现前 ReferenceError；记录 finalizeSummaryUI()、showImageResult() 和 appendSubtitleDownloadButtons() 的直接 append 范围。

- [ ] **Step 2: 写目录和渲染器**

目录 11 项复用当前 create 事件体和 CSS class。文字按钮 scopes 为 summary/image；download_transcript/download_srt 额外允许 fallback/html_ppt；save_image/fill_image_comment 为 imageRow:true、仅 image。实现：

~~~js
function canRenderResultAction(definition,context){
  if(definition.imageRow)return context.resultType==='image'&&context.hasImage;
  if(definition.id==='download_srt')return context.hasTimelineSubtitle&&!!buildSrtContent(rawSubtitleBody);
  return definition.scopes.indexOf(context.resultType)!==-1&&(!definition.requiresText||context.hasText);
}
function renderResultActionButtons(container,context){
  if(!container)return; container.innerHTML='';
  normalizeResultActionButtons(CONFIG.resultActionButtons).forEach(function(item){
    var def=RESULT_ACTION_BUTTONS[item.id];
    if(!item.enabled||!def||def.imageRow||!canRenderResultAction(def,context))return;
    container.appendChild(def.create(context));
  });
  appendResultActionStatus(container,context);
}
function renderImageActionButtons(container,context){
  if(!container)return; container.innerHTML='';
  normalizeResultActionButtons(CONFIG.resultActionButtons).forEach(function(item){
    var def=RESULT_ACTION_BUTTONS[item.id];
    if(!item.enabled||!def||!def.imageRow||!canRenderResultAction(def,context))return;
    container.appendChild(def.create(context));
  });
}
~~~

appendResultActionStatus() 只保留现有编辑状态和模型标签。删除 appendSubtitleDownloadButtons() 与全部调用，避免下载按钮绕过配置。

- [ ] **Step 3: 接入全部摘要状态**

finalizeSummaryUI() 设置 contentDiv._tabbitResultActionContext 为 summary、有文字、无图片、最新时间轴并渲染。showImageResult()/updateImageResult() 设置 image、hasText 来自 getCurrentSummaryText()、hasImage 仅为有效 data URL；createImageActionRow() 创建空 .tabbit-img-actions 后渲染图片按钮。startSummaryEdit() 保存分支末尾刷新。

- [ ] **Step 4: 写安全刷新入口**

~~~js
function refreshResultActionButtons(contentDiv){
  if(!contentDiv||!contentDiv.isConnected)return;
  var context=contentDiv._tabbitResultActionContext;
  if(!context)return;
  context.hasTimelineSubtitle=hasStructuredSubtitleData(rawSubtitleBody)&&!!buildSrtContent(rawSubtitleBody);
  context.hasText=!!String(getCurrentSummaryText(contentDiv,context.summaryFallback||'')).trim();
  renderResultActionButtons(contentDiv.querySelector('.tabbit-result-actions'),context);
  contentDiv.querySelectorAll('.tabbit-img-actions').forEach(function(row){renderImageActionButtons(row,context);});
}
~~~

- [ ] **Step 5: 验证**

Run: node --check 'B站省流助手_-_字幕AI摘要_Pro.user.js'

Expected: 退出码 0；有时间轴时顺序正确，图片项只在图片行；无时间轴刷新后 SRT 不出现但字幕下载仍在；重复刷新不重复按钮或监听器。

- [ ] **Step 6: Commit**

~~~bash
git add B站省流助手_-_字幕AI摘要_Pro.user.js
git commit -m "feat: render result actions from shared config"
~~~

### Task 3: 接入兜底、HTML PPT、字幕先到达路径

**Files:**
- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js:1142-1225, 5349-5435, 8988-9012
- Test: DevTools Network、手工状态切换

**Interfaces:**
- Consumes: renderResultActionButtons()、refreshResultActionButtons()。
- Produces: 每个 .tabbit-result-actions 均有 _tabbitResultActionContext，无直接创建受配置按钮路径。

- [ ] **Step 1: 审计失败路径**

Run: rg -n "appendSubtitleDownloadButtons|tabbit-download-transcript-fallback|tabbit-download-srt-fallback|actionsDiv\.appendChild\((copyBtn|editBtn|genImgBtn|htmlPptBtn|flomoBtn|downloadBtn)" 'B站省流助手_-_字幕AI摘要_Pro.user.js'

Expected: 实现前命中兜底、字幕提前可用或直接 append 路径。

- [ ] **Step 2: 改造两类特殊路径**

showApiNotConfiguredFallback() 保留正文“提示词+字幕”复制和“去配置 API”，删除正文字幕/SRT，设置 fallback 上下文后调用文字渲染器。renderHtmlPptResult() 保留 PPT 工具条，将上下文 resultType 更新为 html_ppt 后刷新。字幕抓取完成时不创建按钮，仅更新已有上下文的 hasTimelineSubtitle 并刷新；无上下文时等待结果生成。

- [ ] **Step 3: 验证**

Run: node --check 'B站省流助手_-_字幕AI摘要_Pro.user.js'

Expected: 退出码 0；兜底和 PPT 直出遵循同一配置；保存开关时 Network 无 AI、图片、字幕请求；上一步 rg 不再命中旧下载函数或旧兜底下载 ID。

- [ ] **Step 4: Commit**

~~~bash
git add B站省流助手_-_字幕AI摘要_Pro.user.js
git commit -m "fix: apply result action config to every result path"
~~~

### Task 4: 设置开关、排序、导入、重置和保存刷新

**Files:**
- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js:4076-4458, 7716-8705
- Test: DevTools Application localStorage、手工设置面板

**Interfaces:**
- Consumes: getDefaultResultActionButtons()、normalizeResultActionButtons()、refreshResultActionButtons()、saveConfig():boolean。
- Produces: renderResultActionButtonEditList(focusIndex?:number):void、editingResultActionButtons:Array<{id:string,enabled:boolean}>、#ts-result-action-buttons-list。

- [ ] **Step 1: 写失败验收**

Run: 在设置页 Console 执行 document.querySelector('#ts-result-action-buttons-list')。

Expected: 实现前 null。

- [ ] **Step 2: 加 UI 和编辑器**

CSS 添加 .tabbit-result-action-settings-item（flex、gap:6px、名称 flex:1）和 disabled 箭头。其他设置折叠区添加：

~~~html
<div class="tabbit-settings-group">
  <div class="tabbit-settings-label">🎛️ 摘要结果操作按钮</div>
  <div class="tabbit-settings-hint">勾选控制显示；上移、下移调整同一区域顺序。保存后才更新结果区。</div>
  <div id="ts-result-action-buttons-list"></div>
</div>
~~~

初始化 let editingResultActionButtons=normalizeResultActionButtons(CONFIG.resultActionButtons)。每行有 checkbox、RESULT_ACTION_BUTTONS[item.id].settingsLabel、上移、下移；首末箭头 disabled，空数组保持空。

- [ ] **Step 3: 写移动函数**

~~~js
function moveEditingResultActionButton(index,direction){
  var target=index+direction;
  if(target<0||target>=editingResultActionButtons.length)return;
  var item=editingResultActionButtons[index];
  editingResultActionButtons[index]=editingResultActionButtons[target];
  editingResultActionButtons[target]=item;
  renderResultActionButtonEditList(target);
}
~~~

renderResultActionButtonEditList(focusIndex) 重绘后对当前行调用 scrollIntoView({block:'nearest'})；checkbox 和移动只改编辑副本，绝不刷新结果区。

- [ ] **Step 4: 接入保存、导入、重置**

saveConfig(cfg) 成功返回 true、catch 返回 false。#ts-save 的其他字段校验后归一化编辑副本、保存，只有 true 才调用：

~~~js
document.querySelectorAll('#tabbit-ai-summary-panel .tabbit-panel-content').forEach(function(contentDiv){
  refreshResultActionButtons(contentDiv);
});
~~~

导入的 imported.resultActionButtons !== undefined 时归一化给编辑副本并重绘、不刷新。#ts-reset 赋 getDefaultResultActionButtons() 并重绘，到保存才写 localStorage。

- [ ] **Step 5: 验证**

Run: node --check 'B站省流助手_-_字幕AI摘要_Pro.user.js'

Expected: 退出码 0；首项不能上移、末项不能下移，重排后立即可见；保存后 localStorage 仅保存 ID、enabled、顺序，普通/生图文字/图片行立即更新且无请求；恢复默认全勾选，全部取消后重开仍为空。

- [ ] **Step 6: Commit**

~~~bash
git add B站省流助手_-_字幕AI摘要_Pro.user.js
git commit -m "feat: configure result action buttons in settings"
~~~

### Task 5: 端到端回归

**Files:**
- Modify: B站省流助手_-_字幕AI摘要_Pro.user.js（仅修复本计划发现的问题）
- Test: Node 语法检查、Chrome 回归

**Interfaces:**
- Consumes: 前四任务全部接口。
- Produces: 无绕过配置、无重复按钮的单脚本实现。

- [ ] **Step 1: 执行静态审计**

Run: rg -n "appendSubtitleDownloadButtons|resultActionButtons|renderResultActionButtons|renderImageActionButtons|refreshResultActionButtons" 'B站省流助手_-_字幕AI摘要_Pro.user.js'

Expected: 配置字段覆盖默认、加载、设置、保存、导入、重置；所有 11 项经渲染器；不再出现 appendSubtitleDownloadButtons。

- [ ] **Step 2: 执行浏览器矩阵**

删除新字段验证默认；写入未知/重复/字符串 false 验证兼容；保存 [] 验证所有文字和图片操作行为空；分别关闭 SRT/保存图片验证字幕下载和自动下载独立；在已有摘要和图片中保存排序验证无 runSummary/callAIStream/generateImageByApi；触发 API 兜底和 HTML PPT 直出验证场景一致。

- [ ] **Step 3: 最终检查**

Run: node --check 'B站省流助手_-_字幕AI摘要_Pro.user.js' && git diff --check && git status --short

Expected: 三项均成功，无语法输出，无空白错误，只有预期 userscript/计划文件变更。

- [ ] **Step 4: Commit**

~~~bash
git add B站省流助手_-_字幕AI摘要_Pro.user.js
git commit -m "test: verify configurable result actions"
~~~

## 自检结论

- 规格覆盖：11 按钮、默认与旧配置、复选框、上移下移、保存立即刷新、正常/生图/兜底/PPT、SRT 双条件、全部关闭、自动下载独立性都在任务中有实现与验收。
- 占位符检查：没有 TBD、TODO、implement later；每任务含路径、接口、步骤、命令和预期结果。
- 接口一致性：全部使用 normalizeResultActionButtons()、renderResultActionButtons()、renderImageActionButtons()、refreshResultActionButtons() 和 ResultActionContext；resultType 固定 summary、image、fallback、html_ppt。
