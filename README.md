# Finch消息提醒

让 Finch 在做完事、被打断、出错或等你确认时出声提醒你。任务完成时，还会有一只背着小邮包的 Finch 小鸟从刘海里钻出来送信。

> 仅支持 macOS。小鸟需要带刘海的 Mac；没有刘海的 Mac 上，小鸟会在菜单栏正中间出现。

![图标](icon.png)

## 提示音

8 种事件可以分别设置声音：任务完成、任务中断、出错失败、等待确认（权限卡、提问卡、表单）、任务开始、自动重试、上下文压缩完成、工具报错。

每个事件可以选：

- **macOS 系统音**：Glass、Ping、Basso、Hero 等 14 种。
- **趣味音效**：料理出锅、宝箱开启、升级、8-bit 能量充满、拾取金币、魔法闪烁、小雀啾啾、拇指琴三连、柜台服务铃、敲门两下、打字机叮、水泡啵、失败哇哇哇、寺院钟声，一共 14 种。
- **自定义音频**：填本地音频文件的路径，支持 mp3、wav、aiff、m4a。
- **不响**。

默认只在你没在看那个会话时才响，也就是 Finch 不在前台，或者那个会话有未读结果。可以单独指定哪些事件即使正在看也照样响，默认是“任务中断”。

另外还支持调音量、设免打扰时段（例如 `23:00-08:00`），也能在设置菜单里临时静音、逐个试听。

## 刘海送信小鸟

默认在“任务完成”时放飞，可以在设置里改成别的事件。

- 小鸟从刘海里探出头，飞出来落地后先挥翅膀打招呼，然后在刘海左边那段菜单栏黑边里走来走去。
- 每次停下会随机做一个小动作：伸懒腰、打哈欠、哼歌、抖羽毛、掏信晃一晃、打盹、摇摆跳舞。7 个都做完一轮才会重复。
- 离得近就蹦过去，远一点就扑腾着飞过去。
- 鼠标移到它身上，它会抬头从包里亮出信。点一下就打开对应的会话。
- 停留时间到了，它会飞回刘海里。停留时间默认 15 秒，可以在设置里改。
- 小鸟还没飞走时又有新任务完成，邮包上会出现未读数角标，停留时间也会顺延。

## 用法

装好并启用后，点小程序卡片上的设置按钮，打开的菜单里有：

- 当前状态
- 临时静音 / 取消静音
- 试听每个事件的声音
- 放飞送信小鸟（预览）
- 设置：完整的配置表单

也可以直接对 Finch 说“预览一下提示音”或“放飞小鸟看看”。

## 权限说明

| 权限 | 用途 |
|---|---|
| 运行命令（shell） | 用 macOS 自带的 `afplay` 播放声音，用 `osascript` 读取屏幕和刘海的位置，用 `lsappinfo` 判断 Finch 是不是在前台 |
| 读取文件 | 检查自定义音频文件是否存在 |
| 网络 | 不使用 |

小程序只读取任务的运行状态（开始、完成、出错等），不读取对话内容，也不上传任何数据。

## 已知限制

- 小鸟所在的窗口层级比菜单栏高、比展开的菜单低。展开菜单时，小鸟会被菜单挡住。
- 菜单栏设成自动隐藏时，小鸟仍然会出现在屏幕最上方。

## 素材说明

14 种趣味音效全部由代码从零合成，没有使用任何录音素材或第三方音频。系统音直接调用 macOS 自带的 `/System/Library/Sounds`，不随包分发。

## 从源码构建

需要 Node.js 18 及以上。

```bash
npm install
npm run build        # TypeScript 编译，src/ → dist/
npm test             # 编译并跑自测
npx @finchtoys/minitools doctor .   # 检查清单
npx @finchtoys/minitools add .      # 安装到本机 Finch
```

目录说明：

- `src/`：小程序主逻辑（事件判断、声音播放、小鸟窗口编排）
- `assets/bird-canvas.js`：小鸟的绘制和动画，运行在 Finch 的 Canvas 窗口里
- `sounds/`：14 种趣味音效，由 `scripts/gen_sounds.py` 生成
- `i18n/`：中英文文案
- `scripts/`：自测、音效生成、小鸟分解图和图标渲染（开发用，不进 npm 包）

---

## English

**Finch Message Alerts** plays a sound when a Finch task completes, is interrupted, fails, or waits for you. When a task finishes, a little Finch bird with a mail bag pops out of the camera notch, hops around the menu bar, does small idle actions (stretch, yawn, sing, nap…) and opens the conversation when clicked.

- 8 events, each with a macOS system sound, one of 14 original fun sounds, your own audio file, or silence.
- Rings only when you are not looking by default; volume, quiet hours, mute and previews are in the settings menu.
- macOS only. Uses `afplay`, `osascript` and `lsappinfo`; reads task status only, never conversation content; no network.
