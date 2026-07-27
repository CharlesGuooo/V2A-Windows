# V2A for Windows — 语音 → 文字 → AI 整理

iOS 版 [V2A](https://github.com/CharlesGuooo/V2A) 的 Windows 移植版，功能完全一致：
说一段话 → **Soniox** 实时转成文字 → **你选的 AI** 整理通顺 → 复制给 ChatGPT / Claude / 任何 agent。

**BYOK（自带 key）**：没有后端、没有账号、不收集任何数据。每一次网络请求都是从你这台电脑
直接发到 Soniox 或你选的 AI 厂商，key 用 Windows 数据保护（DPAPI）加密存在本机。

---

## 怎么用

**双击 `V2A.vbs`** —— 就这一步。

第一次启动会走三步引导，填两个 key（Soniox + 任选一家 AI），之后直接进主界面。

| | |
|---|---|
| **启动** | 双击 `V2A.vbs`（无窗口闪烁，静默启动） |
| **录音** | 按 `Ctrl+Alt+V`，**任何窗口下都能用**，不用先切回 V2A |
| **后台** | 关掉窗口 V2A 仍在系统托盘里跑，快捷键照样能用 |
| **退出** | 右键托盘图标 → 退出 V2A |
| **调试** | 双击 `V2A-调试模式.bat`，保留命令行看实时日志 |

没开窗口时按快捷键，会自动开窗并立刻开始录音。

### 需要什么

- **Windows 10 / 11**
- **[Node.js](https://nodejs.org) 18 或更高**（装 LTS 版就行）—— 唯一需要安装的东西
- **Edge 或 Chrome**（Windows 11 自带 Edge，不用额外装）

不需要 `npm install`：整个项目**零第三方依赖**，只用 Node 标准库。

---

## 功能

和 iOS 版一一对应：

- **实时转录** — Soniox `stt-rt-v5`，60+ 语言，可选语言范围 + 热词
- **五家 AI 任选** — Deepseek / Claude Haiku / Gemini Flash / OpenAI / Groq，全部流式输出
- **两种整理风格** — *轻度*（删语气词、修标点）和 *深度*（识别改口只留最终意思、分点整理成 bullet），
  外加两个自定义 prompt 槽位（可以直接**用说的**录进去）
- **亮 / 暗 / 跟随系统**，**中文 / English / 跟随系统**
- 引导流程、取 key 的 FAQ、转录历史（本地，最近 20 条）、整理完自动复制
- 友好的错误提示 — 余额不足 / key 失效 / 断网 / 限流都有明确说法和对应的跳转按钮

### Windows 特有的部分

| 功能 | 说明 |
|---|---|
| **全局快捷键** | 默认 `Ctrl+Alt+V`，设置里可以改（点「录音快捷键」然后按你想要的组合键） |
| **系统托盘** | 关窗口不退出；双击图标开窗，右键菜单可以录音 / 退出 |
| **右键菜单** | iOS 上「长按」整理按钮选自定义 prompt，Windows 上是**右键点击** |
| **保存为文件** | iOS 的分享按钮在 Windows 上改成「另存为 .txt」 |
| **切换界面语言** | iOS 需要重启 App，Windows 上**立即生效** |

---

## 数据存在哪

全部在 `%APPDATA%\V2A\`：

| 文件 | 内容 |
|---|---|
| `keys.dat` | API key，**DPAPI 加密**（只有你这个 Windows 账户能解开） |
| `settings.json` | 设置、热词、自定义 prompt |
| `history.json` | 转录历史（最近 20 条） |
| `v2a.log` | 运行日志，出问题先看这个 |
| `V2ATray.exe` | 托盘程序，首次启动时本地编译生成 |
| `browser-profile\` | 应用窗口专用的浏览器配置（麦克风授权记在这里） |

想彻底清干净，直接删掉整个 `%APPDATA%\V2A` 文件夹。

---

## 出问题了

**双击没反应 / 提示找不到 Node.js**
装 [Node.js LTS](https://nodejs.org)，装完重启一次电脑让 PATH 生效。

**快捷键不管用**
八成是被别的程序占用了（输入法、录屏、QQ 之类）。托盘图标会弹气泡提示注册失败。
去 设置 → 录音快捷键，换一个组合。

**点了开始录音但没声音**
第一次会弹麦克风授权，点「允许」。如果误点了拒绝，点地址栏左边的图标重新允许，
或者去 Windows 设置 → 隐私和安全性 → 麦克风 检查权限。

**杀毒软件报警**
托盘程序 `V2ATray.exe` 是首次启动时用 Windows 自带的 C# 编译器在本机编译的，
源码就是 `scripts\V2ATray.cs`，可以自己看。如果被拦，把 `%APPDATA%\V2A` 加进白名单。

**想看到底哪出错了**
双击 `V2A-调试模式.bat`，或者看 `%APPDATA%\V2A\v2a.log`。

---

## 代码结构

```
V2A.vbs              双击入口 —— 静默启动 node server.js
V2A-调试模式.bat      带控制台的调试入口
server.js            后端：静态服务 / 设置 / DPAPI 加密 / AI 代理 / SSE / 生命周期
scripts/V2ATray.cs   托盘 + 全局快捷键（首次启动本地编译成 exe）
web/
  index.html
  theme.css          设计 token（颜色逐个抄自 iOS 的 Assets.xcassets）
  app.css            各屏幕布局
  main.js            启动、SSE、快捷键接线
  state.js           AppState.swift 的移植
  main-screen.js     ContentView.swift + TranscriptPaneView.swift
  settings.js        设置 + prompt 管理 + 历史 + FAQ + 关于 + 语言选择
  onboarding.js      OnboardingFlow.swift
  soniox.js          SonioxClient.swift
  recorder.js        MicRecorder.swift（AudioWorklet 出 16kHz Int16 PCM）
  pcm-worklet.js     音频分帧，1600 采样点/帧，和 iOS 一致
  errors.js          AppError.swift 的 FailureClassifier
  prompts.js         PromptDefaults.swift（prompt 原文一字未改）
  i18n.js            Localizable.xcstrings
  api.js             调本地后端
  ui.js              DOM 工具、图标、页面栈、弹窗
```

### 为什么这么设计

- **页面跑在 `http://127.0.0.1`** —— 这是浏览器认可的安全上下文，所以 `getUserMedia` 和
  `AudioWorklet` 能直接用，麦克风链路和 iOS 版是同一套 16kHz Int16 PCM 分帧。
- **Soniox 走 WebSocket 直连** —— WebSocket 不受 CORS 限制，音频不经过任何中转。
- **AI 请求走本地后端代理** —— 绕开浏览器 CORS，同时 provider 的 key 不进页面，流式 token 用 SSE 回传。
- **托盘和快捷键用编译好的小程序而不是 PowerShell 脚本** —— 一个注册全局热键又访问网络的
  `.ps1`，在杀毒软件的脚本扫描器眼里和键盘记录器长得一模一样，会被直接隔离删除。
  编译成 exe 就没这个问题，而且源码随包附带、首次启动本地编译，仍然是零安装。

---

## 隐私

没有后端、没有统计、没有广告。API key 只存在本机且经 DPAPI 加密；热词、自定义风格、
历史记录都只在本地。录音用你自己的 Soniox key 发给 Soniox，整理用你自己的厂商 key
发给对应厂商，中间不经过任何我们的服务器。

## License

MIT，和上游 iOS 版一致。
