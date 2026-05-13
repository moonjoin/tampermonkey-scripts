# tampermonkey-scripts
个人油猴脚本聚集处：
- 发布站：https://greasyfork.org/zh-CN/users/1593947-moon-join
- 国内代理：https://home.greasyfork.org.cn/zh-hans/lookup/#?q=moonjoin
- 解决主要痛点：自动触发AI总结，模型和提示词预设切换，基于原文连续对话，快捷发送到flomo笔记，配置坚果云同步
---

### 1. B站省流助手 - 字幕AI摘要 Pro
**用途**：B站视频AI总结增强脚本
- 核心功能：
  - 自动总结**视频字幕**内容，快速抓要点
  - 一键**评论区总结**，看舆论风向
  - 识别软广/恰饭内容
- 需自备**兼容OpenAI格式的API Key**与地址，可自定义模型
- 适用：B站重度用户、学习/省流场景
- 自动提取B站视频字幕，通过自定义AI API生成极简摘要或图片，支持模型切换、持续对话和评论区总结；配置项（API/模型列表）存储于localStorage，支持设置界面导入导出；支持自动解析开关、悬浮窗/面板可拖动、自动获取模型列表、flomo自动加标签
- <img width="640" height="360" alt="image" src="https://github.com/user-attachments/assets/19951f71-9cc9-4018-a449-00a70cc73b62" />

---

### 2. 饺子 AI 网页摘要助手
**用途**：通用网页AI内容提炼脚本
- 核心功能：
  - 提取网页正文，生成**精简摘要**
  - 轻量化、无多余界面
  - 支持自定义API与提示词
- 适用：快速读文章、新闻、文档，不想全文阅读
- 指定网站自动弹出 AI 网页摘要，支持连续对话、多预设、多模板、SPA路由，flomo、坚果云双文件云同步。
- <img width="1785" height="1256" alt="论坛" src="https://github.com/user-attachments/assets/09568ffe-8e6c-4af3-9df6-7d96531919a9" />

---

### 3. Folo 网站增强工具 
**用途**：浏览器悬浮笔记 + flomo 同步
- 核心功能：
  - 网页**悬浮快速记笔记**，不打断阅读
  - 一键同步到 **flomo 浮墨笔记**
  - 支持标签、快捷操作、轻量化界面
- 适用：边浏览边摘录、知识卡片整理、flomo 用户
- Folo 增强：Jina Reader + Readability + 启发式三级抓取 + AI 总结 + 自动总结 + 后续对话 + 多配置管理 + 坚果云 WebDAV 同步 + 复制对话 + 保存到 flomo
- <img width="2045" height="1337" alt="folo" src="https://github.com/user-attachments/assets/758d7229-3d78-4330-973f-ab2920da2a07" />

---

### 简要对比
| 脚本 | 适用场景 | 核心亮点 |
| :--- | :--- | :--- |
| B站省流助手 - 字幕AI摘要 Pro | B站观看 | 主动总结，视频+评论AI总结、省流 |
| 饺子 AI 网页摘要助手 | 通用网页 | 自动弹出总结，连续对话 |
| Folo 网站增强工具 | FOLO网页版 | 替代官方 AI 总结，接入自己 api |

---
推荐接入模型（国内环境）：
- flash模型最优，速度快，价格便宜，忠实总结原文，且无需深度推理。
- 各家 Flash 比：小米 MiMo‑V2‑Flash 最快，其次是 Claude Haiku 4.5，然后是 DeepSeek V4‑Flash。（2026‑05，公开基准 / 个人体验）
<img width="772" height="1004" alt="CFWBPV" src="https://github.com/user-attachments/assets/6189d7fc-d2ec-4386-8cd7-315342dd3ff6" />
