# 自制5 个网页 AI 助手分享

看 B站、读文章、刷 RSS、摘录资料，这些事我每天都在做。我用 Codex 写了几个油猴脚本，把总结、复制、记下看过的网页这些操作放进浏览器里。你也有同样的需要，可以挑一个试试。

几个每天都会碰到的小问题：

- 视频十几分钟，我想先知道它到底讲了什么。
- 文章太长，想按自己的要求总结一下。
- 前几天看过的网页，现在想找却找不到。

**用得上哪个，就装哪个。脚本免费开源，AI 总结可以先试有免费额度的服务。**

## 先装篡改猴，再装脚本

请在支持用户脚本的浏览器中安装。脚本安装后在对应网站使用；已经装过篡改猴，可以直接到下面选择脚本。

1. **先安装篡改猴。** [前往 Tampermonkey 官网](https://www.tampermonkey.net/)，按浏览器选择扩展。移动端需要支持用户脚本的浏览器或扩展。
2. **选择并安装脚本。** 点击下面的“安装 / 下载”，通常会进入篡改猴安装页。如果显示源码，可保存为 `.user.js` 文件后在管理器中导入。
3. **填好需要的配置。** AI 总结需要填写兼容 OpenAI 格式的接口地址、API Key 和模型名。生图功能需要支持相应请求的生图接口，可以单独配置。flomo、推送和云同步按需配置。

### 想先试试 AI 总结，不一定要先付费

可以看看商汤日日新的 [SenseNova Token Plan](https://www.sensenova.cn/token-plan)。官网目前提供公测免费额度；注册后，按平台文档获取 API Key、接口地址和模型名，再填入脚本设置。额度、支持的模型和活动时间以官网为准。

## 这 5 个脚本，分别做什么？

| 脚本 | 版本 | 适用场景 | 安装入口 |
| :--- | :--- | :--- | :--- |
| B站省流助手 | `5.0.23` | 视频十几分钟，先看看重点在哪，再决定要不要看。 | [安装 / 下载](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B_-_%E5%AD%97%E5%B9%95AI%E6%91%98%E8%A6%81_Pro.user.js) |
| AI 网页摘要助手 | `3.0.10` | 文章太长懒得读完，先让 AI 帮你总结一遍。 | [安装 / 下载](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/AI_%E7%BD%91%E9%A1%B5%E6%91%98%E8%A6%81%E5%8A%A9%E6%89%8B/%E9%A5%BA%E5%AD%90_AI_%E7%BD%91%E9%A1%B5%E6%91%98%E8%A6%81%E5%8A%A9%E6%89%8B.user.js) |
| Folo 网站增强工具 | `14.0.11` | Folo 里只有一小段预览？先抓全文，再用自己的模型总结。 | [安装 / 下载](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/Folo_%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA/Folo_%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA%E5%B7%A5%E5%85%B7.user.js) |
| 网页浏览记录助手 | `2.0.3` | “前几天在哪看到过？”让脚本帮你记下看过的网页。 | [安装 / 下载](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/%E7%BD%91%E9%A1%B5%E6%B5%8F%E8%A7%88%E8%AE%B0%E5%BD%95%E8%87%AA%E5%8A%A8%E6%8E%A8%E9%80%81/%E7%BD%91%E9%A1%B5%E6%B5%8F%E8%A7%88%E8%AE%B0%E5%BD%95%E8%87%AA%E5%8A%A8%E6%8E%A8%E9%80%81.user.js) |
| 网页一键自动复制 | `0.3` | 选中文字就复制，也可以把标题和链接一起带上。 | [安装 / 下载](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/%E7%BD%91%E9%A1%B5%E9%80%89%E4%B8%AD%E6%96%87%E6%9C%AC%E8%87%AA%E5%8A%A8%E5%A4%8D%E5%88%B6/%E9%80%89%E4%B8%AD%E6%96%87%E6%9C%AC%E8%87%AA%E5%8A%A8%E5%A4%8D%E5%88%B6.user.js) |

---

## 1. B站省流助手

视频十几分钟，先看看重点在哪，再决定要不要看。

- 自动读字幕，支持不同风格的总结
- 能接着问，也能总结评论和弹幕
- 下载字幕，或者把摘要存到 flomo

可以用大白话看结论、整理详细笔记，或者按时间轴找内容；提示词也能自己改。拿到字幕后能下载 TXT / SRT，没有字幕时可以上传或粘贴。支持后台总结、保存摘要和总结生图。

支持视频摘要、评论区总结、弹幕分析，以及字幕、弹幕和评论的全面分析。可配置多个 API、切换模型，选择后台解析或手动开始。结果窗口支持浮窗、右侧满高和全屏布局。

**[安装 / 下载B站省流助手](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B/B%E7%AB%99%E7%9C%81%E6%B5%81%E5%8A%A9%E6%89%8B_-_%E5%AD%97%E5%B9%95AI%E6%91%98%E8%A6%81_Pro.user.js)**

<img width="720" alt="B站省流助手" src="https://github.com/user-attachments/assets/19951f71-9cc9-4018-a449-00a70cc73b62" />

---

## 2. AI 网页摘要助手

文章太长懒得读完，先让 AI 帮你总结一遍。

- 指定网站打开后自动总结
- 不同网站可以用不同的提示词
- 复制摘要、存到 flomo，也能生成图片

不想一打开网页就弹窗，可以让它在后台总结，好了再点悬浮球看。新闻、论坛、文档可以各用一套提示词，也能换模型。选中文字自动复制已包含在里面。配置可以导出，或用坚果云同步；生图接口能单独设置。

支持多 API、多模型和多提示词模板，按网址绑定模板。页面内容切换后可重新总结，配置支持本地导入、导出。

**[安装 / 下载AI 网页摘要助手](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/AI_%E7%BD%91%E9%A1%B5%E6%91%98%E8%A6%81%E5%8A%A9%E6%89%8B/%E9%A5%BA%E5%AD%90_AI_%E7%BD%91%E9%A1%B5%E6%91%98%E8%A6%81%E5%8A%A9%E6%89%8B.user.js)**

<img width="720" alt="饺子 AI 网页摘要助手" src="https://github.com/user-attachments/assets/09568ffe-8e6c-4af3-9df6-7d96531919a9" />

---

## 3. Folo 网站增强工具

Folo 里只有一小段预览？先抓全文，再用自己的模型总结。

- 抓取原文全文，切换预览和全文
- 自动总结，保存已生成的摘要
- 可以接着问，也能复制或存到 flomo

原文抓取会依次尝试几种方式，其中 Jina 会把文章网址交给外部服务。可以手动给当前列表预先生成摘要，下次读时少等一会儿。支持多个 API 配置、坚果云同步和复制文章内容。

支持预览和全文模式切换、后续对话、复制完整对话，并可保存到 flomo。

**[安装 / 下载Folo 网站增强工具](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/Folo_%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA/Folo_%E7%BD%91%E7%AB%99%E5%A2%9E%E5%BC%BA%E5%B7%A5%E5%85%B7.user.js)**

<img width="720" alt="Folo 网站增强工具" src="https://github.com/user-attachments/assets/758d7229-3d78-4330-973f-ab2920da2a07" />

---

## 4. 网页浏览记录助手

“前几天在哪看到过？”让脚本帮你记下看过的网页。

- 记下标题、链接、时间和停留多久
- 把网页推送到 Telegram 或飞书
- 让 AI 看看最近都在关注什么

可以设置停留多久才记录、哪些网站不记录。看今天、本周、本月，或者自己选一段时间，让 AI 总结关注点和常看的内容。记录可以导出、删除，也能用坚果云同步。

支持未读、今天、本周、本月、全部和自定义时间段分析，也能根据浏览记录生成用户画像。坚果云同步支持增量同步和手动合并。

**[安装 / 下载网页浏览记录助手](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/%E7%BD%91%E9%A1%B5%E6%B5%8F%E8%A7%88%E8%AE%B0%E5%BD%95%E8%87%AA%E5%8A%A8%E6%8E%A8%E9%80%81/%E7%BD%91%E9%A1%B5%E6%B5%8F%E8%A7%88%E8%AE%B0%E5%BD%95%E8%87%AA%E5%8A%A8%E6%8E%A8%E9%80%81.user.js)**

---

## 5. 网页一键自动复制

选中文字就复制，也可以把标题和链接一起带上。

- 选中文字后，自动放进剪贴板
- 想保留出处，可以带上标题和链接
- Alt + X 开关，按钮可以拖动

复制成功会有提示，不会自动复制输入框里正在编辑的文字。只需要复制功能就装这个。如果已经装了网页摘要助手，里面也有同类功能，可以先试试，不必再装一份。

支持 `Alt + X` 快捷键开关，悬浮按钮可拖动。开启出处信息后，复制内容会附上网页标题和 URL。

**[安装 / 下载网页一键自动复制](https://raw.githubusercontent.com/moonjoin/tampermonkey-scripts/main/%E7%BD%91%E9%A1%B5%E9%80%89%E4%B8%AD%E6%96%87%E6%9C%AC%E8%87%AA%E5%8A%A8%E5%A4%8D%E5%88%B6/%E9%80%89%E4%B8%AD%E6%96%87%E6%9C%AC%E8%87%AA%E5%8A%A8%E5%A4%8D%E5%88%B6.user.js)**

---

## 常见问题

### 不用 flomo、坚果云，影响使用吗？

**没有影响，不用 flomo 和坚果云也能正常使用脚本。** 用 flomo 可以更方便地保存摘要和笔记；用坚果云可以同步配置，浏览记录助手还支持同步记录。需要这些功能时再配置就好。

保存到 flomo 需填写 flomo API 地址。B站助手和网页摘要助手的自动发送默认关闭，需要时单独开启。坚果云同步需填写 WebDAV 账号和应用密码。

### B站没有字幕怎么办？

推荐用 [飞书妙记](https://meetings.feishu.cn/minutes/recommend-invite?vcInviteCode=ABDEUNHHT) 把视频或音频转成文字，再交给 B站省流助手总结。

1. 准备好视频或音频文件，上传到飞书妙记，等待转写完成。
2. 在妙记中选择“导出文字记录”，导出为 SRT 或 TXT；也可以直接复制转写文字。
3. 回到 B站省流助手，打开“上传字幕”，上传文件或粘贴文字，再开始总结。想保留时间轴，优先选 SRT。

飞书免费版每月有 300 分钟免费转写额度，实际可用额度以账号内显示为准。

如果视频本来有字幕但自动获取失败，可以停止自动获取，再试手动操作，或上传字幕文件。

### 模型怎么选？

日常摘要可以先用 flash 模型，实际比较速度、费用和结果质量；需要更细的分析时，再换更强的模型。可用模型和价格以你的 API 服务为准。

### 网页内容会发到哪里？

- API Key、flomo 地址、坚果云账号等配置保存在浏览器脚本存储里。
- AI 总结会将相关正文、字幕、弹幕、评论或浏览记录发给你配置的 API。
- Folo 的 Jina Reader 会将文章网址交给 Jina。
- 开启 flomo、Telegram、飞书或坚果云功能后，相应内容会发到对应服务。
- 不想上传的内容，请关闭自动总结、推送或同步。

---

[GreasyFork 发布站](https://greasyfork.org/zh-CN/users/1593947-moon-join) · [国内代理](https://home.greasyfork.org.cn/zh-hans/lookup#?q=moonjoin&filter_locale=0) · [B站主页](https://space.bilibili.com/38389107) · [MIT 开源协议](LICENSE)

次元饺子 · 自己用，也分享给有需要的人。
