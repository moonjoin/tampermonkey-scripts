# B站省流助手 - 项目指令

## ⚠️ 核心规则

当用户发送 Bilibili 链接时，**必须**使用以下脚本，**绝对不要**用浏览器工具打开网页：

```bash
/Users/joinmoon/Documents/MJpy/js/tampermonkey-scripts/B站省流助手/tools/bili-summarize.sh "<URL>" <命令>
```

## 可用命令

| 命令 | 说明 |
|------|------|
| `summary` | 字幕总结（默认） |
| `summary detailed` | 详细笔记版 |
| `summary critical` | 批判分析版 |
| `summary action` | 行动清单版 |
| `comment` | 总结评论区 |
| `danmaku` | 弹幕分析 |
| `full` | 全面分析 |
| `full quick_review` | 极简速览版 |
| `full deep_critique` | 深度批判版 |
| `gen-image` | 生成配图 |
| `gen-ppt` | 生成HTML PPT |
| `post-comment` | 摘要发B站评论 |
| `copy-summary` | 复制摘要 |
| `copy-image-prompt` | 复制生图提示词 |
| `send-flomo` | 发送Flomo |
| `chat "问题"` | 基于视频内容追问 |
| `settings` | 打开设置面板 |

## 示例

用户说「帮我总结 https://www.bilibili.com/video/BVxxx」→
运行 `./tools/bili-summarize.sh "https://www.bilibili.com/video/BVxxx" summary`

用户说「弹幕分析 https://www.bilibili.com/video/BVxxx」→
运行 `./tools/bili-summarize.sh "https://www.bilibili.com/video/BVxxx" danmaku`

## 前提条件

- macOS + Chrome 已打开
- Chrome 开启「查看→开发者→允许Apple事件中的JavaScript」
- 油猴脚本已安装且API已配置

## 注意

- 字幕获取有时会卡住，脚本会自动处理
- 首次等待10秒，之后每5秒轮询，结果就绪立即返回
- 用户偏好：直接给结果，不要废话
- `docs/superpowers/` 仅作本地临时设计和实施计划使用，严禁提交或推送；需要落盘的此类内容必须放在 Git 忽略路径。
