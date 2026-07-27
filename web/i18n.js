// Port of V2A/Resources/Localizable.xcstrings.
//
// Same convention as the iOS String Catalog: the source language is zh-Hans,
// so the *keys are the Chinese strings* and the table holds the English
// translations. t("清空全部") returns the key verbatim in Chinese mode and
// "Clear all" in English mode.
//
// Format specifiers keep the iOS syntax (%@, %lld, and positional %1$lld)
// so the strings can be copied back and forth with the Swift catalog.

const EN = {
  'V2A · 语音 → 文字 → AI 整理': 'V2A · Voice → Text → AI Cleanup',
  '说一段，停一下，AI 整理后复制给 agent': 'Speak a bit, pause, then copy the AI-cleaned text to your agent.',
  '未配置 Soniox API Key。点右上角齿轮添加。': 'Soniox API key not set. Click the gear in the top-right to add one.',
  '未配置 %@ 的 API Key。AI 整理不可用，请去设置添加。': '%@ API key not set. AI cleanup is unavailable — open Settings to add one.',
  '清空全部': 'Clear all',
  '正在连接 Soniox…': 'Connecting to Soniox…',
  '正在保存…': 'Saving…',
  '录音中…': 'Recording…',
  '点按钮开始': 'Click the button to start',
  '需要先配置 API Key': 'API key required first',
  '原始转录': 'Raw transcript',
  '转录的文字会出现在这里。停止后可编辑。': 'Transcribed text appears here. Editable after you stop.',
  '已复制 ✓': 'Copied ✓',
  '复制原文': 'Copy raw',
  '整理中…': 'Cleaning up…',
  'AI 整理后': 'Cleaned',
  'AI 整理后的文本会出现在这里。': 'Cleaned text appears here.',
  '未配置 AI provider API key — AI 整理不可用。': 'No AI provider API key — cleanup unavailable.',
  '复制整理后': 'Copy cleaned',
  '连接中…': 'Connecting…',
  '停止中…': 'Stopping…',
  '设置': 'Settings',
  '取消': 'Cancel',
  '保存': 'Save',
  'AI 整理（必需）': 'AI Cleanup (required)',
  '选一家 provider 给你的语音转录做后期清理。每家 key 独立存储，可随时切换。':
    'Pick a provider to clean up your transcripts. Each key is stored separately; switch any time.',
  '去 %@ 网站拿 key →': 'Get a %@ API key →',
  '整理风格': 'Cleanup Style',
  '告诉 AI 怎么整理': 'Tell AI how to clean up',
  '自定义 1': 'Custom 1',
  '自定义 2': 'Custom 2',
  'Soniox 实时转录（必需）': 'Soniox Real-time Transcription (required)',
  '启用的语言': 'Enabled languages',
  '去 Soniox 网站拿 key →': 'Get a Soniox API key →',
  '用来把你说的话实时转成文字。从 console.soniox.com 拿 key。':
    'Used to transcribe your voice in real time. Get a key at console.soniox.com.',
  '热词': 'Hotwords',
  '添加热词': 'Add hotword',
  '加入': 'Add',
  '把人名、专有名词、缩写加进来，Soniox 识别会更准。':
    'Add names, proper nouns, abbreviations — Soniox will recognize them more accurately.',
  '逗号或回车分隔多个；点右边垃圾桶删除单个。':
    'Separate multiple with commas or Enter; click the trash icon to delete one.',
  '通用': 'General',
  '界面语言': 'App Language',
  '跟随系统': 'Follow System',
  '中文': '中文',
  '帮助': 'Help',
  '怎么拿 API key': 'How to get API keys',
  '关于 / 隐私': 'About / Privacy',
  'Soniox 语言': 'Soniox Languages',
  '勾选你会说的语言。勾得越多越容易误判（比如把中文听成日文）。至少保留一个；默认中 + 英。':
    'Check the languages you speak. The more you enable, the more likely Soniox will mis-detect (e.g. hearing Chinese as Japanese). Keep at least one; defaults to Chinese + English.',
  '停止': 'Stop',
  '录音输入': 'Record',
  '完成': 'Done',
  '未配置 Soniox key，去设置 → Soniox 那栏填一下。': 'Soniox key not set. Open Settings → Soniox to add it.',
  'Soniox · 把语音转成文字（必需）': 'Soniox · Voice to Text (required)',
  '%@ · 帮你整理文字': '%@ · Cleans up text',
  '打开 Soniox 控制台 →': 'Open Soniox Console →',
  '打开 %@ 控制台 →': 'Open %@ Console →',
  '打开 console.soniox.com，用邮箱注册一个账号': 'Open console.soniox.com and sign up with email',
  '登录后左边菜单找到「API Keys」': "Sign in, then find 'API Keys' in the left menu",
  '点「Create API Key」生成一个新 key': "Click 'Create API Key' to generate a new key",
  '复制出来的那串字符，回到 V2A 设置粘到 Soniox 那栏': 'Copy the key string and paste it into V2A → Settings → Soniox',
  '打开 platform.deepseek.com 注册账号（手机号或邮箱都行）': 'Open platform.deepseek.com and sign up (phone or email)',
  '登录后点右上角头像 → API Keys': 'Sign in, then click your avatar (top-right) → API Keys',
  '点「Create new API key」起个名字，生成 key': "Click 'Create new API key', give it a name, generate the key",
  '复制 sk- 开头的字符串，回到 V2A 设置粘进 AI 整理那栏': 'Copy the sk- key and paste it into V2A → Settings → AI Cleanup',
  '打开 console.anthropic.com 注册账号': 'Open console.anthropic.com and sign up',
  '充值至少 5 美元（Anthropic 要求先充值才能用 API）': 'Add at least $5 of credit (Anthropic requires prepayment before API use)',
  '左边菜单 API Keys → 点「Create Key」': "Left menu → API Keys → click 'Create Key'",
  '复制 sk-ant- 开头的 key，回到 V2A 设置粘进去': 'Copy the sk-ant- key and paste it into V2A → Settings',
  '打开 aistudio.google.com，用 Google 账号登录': 'Open aistudio.google.com and sign in with Google',
  '左下角点「Get API key」': "Click 'Get API key' at the bottom-left",
  '点「Create API key」，选一个 Google Cloud 项目（没有就让它新建）':
    "Click 'Create API key' and pick a Google Cloud project (let it create one if you don't have any)",
  '复制 AIza 开头的 key，回到 V2A 设置粘进去': 'Copy the AIza key and paste it into V2A → Settings',
  '打开 platform.openai.com 注册账号': 'Open platform.openai.com and sign up',
  '必须先充值（最少 5 美元）才能用 API': 'Add credit (at least $5) before you can use the API',
  '右上角设置 → API keys → Create new secret key': "Top-right Settings → API keys → 'Create new secret key'",
  '复制 sk- 开头的 key（关掉就看不到了，记得马上粘到 V2A）':
    'Copy the sk- key (it disappears once you close the dialog — paste into V2A right away)',
  '打开 console.groq.com，可以直接用 Google 或 GitHub 登录': 'Open console.groq.com — sign in with Google or GitHub',
  '左边菜单点「API Keys」': 'Left menu → API Keys',
  '点「Create API Key」起个名字': "Click 'Create API Key' and give it a name",
  '复制 gsk_ 开头的 key，回到 V2A 设置粘进去': 'Copy the gsk_ key and paste it into V2A → Settings',
  '新账号有免费额度，先用着不要钱。': 'New accounts get free credit — costs nothing to start.',
  '每天有免费配额，量不大的话不用付钱。': 'Daily free quota — usually no payment needed for casual use.',
  '免费额度大、速度飞快。适合刚开始试。': 'Generous free tier and very fast. Great to try first.',
  '质量最稳，但要先充钱才能用。': 'Most consistent quality, but requires prepaid credit.',
  '知名度最高，但价格不便宜，要先充值。': 'Most well-known but pricier — requires prepaid credit.',
  '关于': 'About',
  '版本': 'Version',
  '说一段话 → 实时转成文字 → AI 整理通顺 → 复制给 ChatGPT / Claude / 任何 Agent。打字慢的时候用。':
    'Speak → live transcript → AI cleans it up → copy to ChatGPT / Claude / any agent. For when typing is too slow.',
  '隐私': 'Privacy',
  '你填进去的 API key 用 Windows 数据保护（DPAPI）加密存在本机，只有你这个 Windows 账户能解开。我们看不到，也不会上传。':
    'Your API keys are encrypted on this PC with Windows Data Protection (DPAPI) and can only be decrypted by your Windows account. We never see them or upload them.',
  '录音通过你自己的 Soniox key 发到 Soniox，整理通过你自己的 AI 厂商 key 发到对应厂商。中间不经过任何我们的服务器。':
    'Audio is sent to Soniox via your own Soniox key; cleanup runs through your own AI-provider key. Nothing routes through our servers.',
  '热词、自定义整理风格、设置项都只存在本机。': 'Hotwords, custom styles, and settings stay on this device.',
  '我们不收集任何使用数据、不做分析、不做广告。': 'We collect no usage data, no analytics, no ads.',
  'App 完全断网时除了录音之外都不能用——所有功能都靠你自己的 key 调用第三方 API。':
    'Offline, only basic recording works — every feature relies on third-party APIs via your own keys.',
  '如果换设备或重装，记得在新设备重新填一次 key。':
    'If you switch devices or reinstall, remember to re-enter your keys on the new device.',
  '上一步': 'Back',
  '下一步': 'Next',
  '完成，开始用': "Done, let's go",
  '欢迎用 V2A': 'Welcome to V2A',
  '说一段话，自动转成文字，AI 帮你整理通顺，一键复制给 ChatGPT 或其他 agent。打字慢的时候特别好用。':
    'Speak a sentence — it transcribes automatically, AI cleans it up, copy to ChatGPT or any agent in one click. Great when typing is too slow.',
  '接下来要填两个 key：': "Next, you'll add two keys:",
  '· Soniox（把声音变文字）': '· Soniox (voice → text)',
  '· 一家 AI 服务商（整理文字，5 家任选其一）': '· One AI provider (text cleanup, pick any of 5)',
  '两个 key 都从对应官网注册账号免费拿。': "Both keys are free to grab — sign up on each provider's website.",
  '第 1 步 · Soniox key': 'Step 1 · Soniox key',
  'Soniox 负责把你说的话实时转成文字。': 'Soniox transcribes your voice in real time.',
  '把 Soniox API key 粘进来': 'Paste your Soniox API key here',
  '还没有 key？打开 Soniox 注册 →': "Don't have one? Sign up at Soniox →",
  '拿 key 的步骤：注册账号 → 登录 → 左侧 API Keys → Create API Key → 复制。':
    'Steps: sign up → sign in → left menu API Keys → Create API Key → copy.',
  '第 2 步 · 选一家 AI': 'Step 2 · Pick an AI',
  '用谁来帮你整理文字。5 家任选一家，以后随时可以切换。':
    'Choose who cleans up your text. Pick one of 5; you can switch any time later.',
  'AI 服务商': 'AI Provider',
  '把 %@ 的 API key 粘进来': 'Paste your %@ API key here',
  '还没有 key？打开 %@ 注册 →': "Don't have one? Sign up at %@ →",
  'Deepseek 注册就送免费额度，对中文友好，推荐先用这家试试。':
    'Deepseek gives free credit on signup. Great for Chinese. Recommended to start with.',
  'Claude 质量最稳，但需要先在 Anthropic 充值才能用。':
    'Claude has the most consistent quality, but Anthropic requires prepaid credit.',
  'Google Gemini 每天有免费配额，量不大的话不用付钱。':
    'Google Gemini has a daily free quota — likely free for casual use.',
  'OpenAI 知名度最高，但要先充值才能用 API。': 'OpenAI is the most well-known, but requires prepaid credit.',
  'Groq 速度飞快、免费额度大。适合刚开始试。': 'Groq is very fast with a generous free tier. Great to start with.',
  '转录历史': 'Transcript history',
  '清空': 'Clear',
  '清空全部历史？': 'Clear all history?',
  '这个操作不能撤销。': "This action can't be undone.",
  '还没有历史记录': 'No history yet',
  'AI 整理完成后会自动保存最近 20 条到这里。': 'Up to 20 cleaned-up sessions are auto-saved here.',
  '历史详情': 'Session detail',
  '记录转录历史': 'Save transcript history',
  '最近 %lld 条': 'last %lld',
  '整理完自动复制': 'Auto-copy after cleanup',
  '已自动复制到剪贴板': 'Copied to clipboard',
  '「自动复制」打开后，AI 整理一完成就把结果写到剪贴板，省一步操作。历史保存在本机。':
    "When 'Auto-copy' is on, the cleaned text is written to your clipboard the moment AI cleanup finishes. History stays on this device.",
  '外观': 'Appearance',
  '轻度整理': 'Quick',
  '深度整理': 'Deep',
  '复制这段': 'Copy this',
  '填入模板': 'Fill from template',
  '自定义 %lld': 'Custom %lld',
  '快速清理：删语气词、修标点、小幅通顺。': 'Quick cleanup: remove fillers, fix punctuation, light polish.',
  '结构化：识别改口只留最终意思、把分点整理成 bullet。':
    'Structured: resolve self-corrections to final intent, format points as bullets.',
  '看轻度 / 深度整理的规则，或者自己写一两个自定义版本（主页右键点击整理按钮选用）。':
    'See how Quick / Deep cleanup work, or write one or two custom versions (right-click a cleanup button on the main screen to use them).',
  '亮': 'Light',
  '暗': 'Dark',
  'AI 响应超时，稍后重试。': 'AI response timed out. Try again in a moment.',
  '无网络连接，检查网络后重试。': 'No internet connection. Check your network and retry.',
  '%@ 余额 / 额度不足，无法整理。': '%@ is out of balance / quota — cleanup unavailable.',
  '去 %@ 充值 →': 'Add credit at %@ →',
  '%@ 的 API key 无效或已失效。': 'The %@ API key is invalid or expired.',
  '去设置重新配置': 'Fix it in Settings',
  '请求太频繁，稍等几秒再试。': 'Too many requests. Wait a few seconds and retry.',
  'AI 整理失败（%lld）：%@': 'Cleanup failed (%1$lld): %2$@',
  'AI 整理失败：%@': 'Cleanup failed: %@',
  'Soniox 的 API key 无效或已失效。': 'The Soniox API key is invalid or expired.',
  '去 Soniox 充值 →': 'Add credit at Soniox →',
  'Soniox 余额 / 额度不足，无法转录。': 'Soniox is out of balance / quota — transcription unavailable.',
  'Soniox 连接出错：%@': 'Soniox connection error: %@',
  'Soniox 连接断开，请重试。': 'Soniox disconnected. Please retry.',
  '未配置 Soniox API key。': 'Soniox API key not set.',
  'Soniox 连接失败：%@': 'Soniox connection failed: %@',
  '麦克风失败：%@': 'Microphone error: %@',
  '没听到声音，检查麦克风或说话音量。': "Didn't catch any audio — check your mic or speak louder.",
  '录音中': 'Recording',
  '开始录音': 'Start recording',
  '启动失败：%@': 'Failed to start: %@',
  '%lld 字': '%lld chars',
  '未知错误': 'Unknown error',
  '在主页右键点击「轻度整理」或「深度整理」就能选用这一版。':
    'On the main screen, right-click "Quick" or "Deep" to use this version.',

  // --- onboarding: how to use ---
  '第 3 步 · 怎么用': 'Step 3 · How to use it',
  '三步就完事：': 'Three steps, that’s it:',
  '说': 'Speak',
  '点「开始录音」或按 %@，说完再按一次停止。说错了直接改口重说，深度整理会自动只保留你最后的意思。':
    'Click "Start recording" or press %@, then press again to stop. Misspoke? Just correct yourself out loud — Deep cleanup keeps only what you meant last.',
  '整理': 'Clean up',
  '「轻度整理」删语气词、修标点，尽量不动你的原话；「深度整理」会识别改口、把分点整理成 bullet，说得比较乱的时候用它。':
    '"Quick" removes fillers and fixes punctuation, leaving your wording largely intact. "Deep" resolves self-corrections and turns spoken lists into bullets — use it when you rambled.',
  '粘': 'Paste',
  '整理完自动进剪贴板，切到 ChatGPT 直接 Ctrl+V。不想自动复制可以在设置里关掉。':
    'The result lands on your clipboard automatically — switch to ChatGPT and hit Ctrl+V. You can turn auto-copy off in Settings.',
  '第 4 步 · 快捷键': 'Step 4 · Hotkeys',
  '这四个组合在任何窗口下都能用，不用先切回 V2A：':
    'These four work from any window — you never have to switch back to V2A first:',
  '关掉窗口后 V2A 会留在右下角托盘继续运行，快捷键照样能用；右键托盘图标可以彻底退出。想换组合键去「设置 → 全局快捷键」。':
    'Closing the window leaves V2A running in the notification area, and the hotkeys keep working. Right-click the tray icon to quit for good. To rebind, go to Settings → Global hotkeys.',

  // --- Windows-only strings (no iOS counterpart) ---
  '开始 / 停止录音': 'Start / stop recording',
  '复制整理结果': 'Copy cleaned result',
  '点一行然后按下你想用的组合键即可改。全局快捷键会从其它程序手里接管这个组合，所以尽量避开常用的。':
    'Click a row, then press the combination you want. A global hotkey takes that combination over from every other app, so avoid ones you use elsewhere.',
  '%@ 已经被另一个快捷键占用了。': '%@ is already assigned to another action.',
  '开机自动启动': 'Start with Windows',
  '已设为开机自动启动': 'Will start with Windows',
  '已取消开机自动启动': 'No longer starts with Windows',
  '「自动复制」打开后，AI 整理一完成就把结果直接写进剪贴板，切过去 Ctrl+V 就行，不用再按复制快捷键。历史保存在本机。':
    'With auto-copy on, the cleaned text goes straight to your clipboard the moment cleanup finishes — just Ctrl+V, no copy hotkey needed. History stays on this device.',
  '麦克风权限被拒绝。点地址栏左边的图标允许麦克风，或在 Windows 设置里打开麦克风权限。':
    'Microphone permission denied. Allow the mic from the icon in the window, or enable microphone access in Windows Settings.',
  '找不到麦克风。插上麦克风或耳机后重试。': 'No microphone found. Plug one in and try again.',
  '麦克风被其他程序占用，关掉它再试。': 'The microphone is in use by another app. Close it and retry.',
  '删除': 'Delete',
  '数据位置': 'Data folder',
  '源码 / 反馈 →': 'Source / feedback →',
  '有新版本 %@': 'Version %@ available',
  '去下载': 'Download',
  '录音快捷键': 'Recording hotkey',
  '全局快捷键（任何窗口下都能用）': 'Global hotkey — works from any window',
  '按下快捷键就开始/停止录音，不用先切回 V2A。留空或关掉就不注册。':
    'Press the hotkey to start/stop recording without switching to V2A first. Turn it off to unregister.',
  '启用全局快捷键': 'Enable global hotkey',
  '快捷键已保存，立即生效。': 'Hotkey saved and active.',
  '关闭窗口后 V2A 会继续留在系统托盘，按快捷键随时能录音。右键托盘图标可以彻底退出。':
    'Closing the window leaves V2A running in the system tray; the hotkey still works. Right-click the tray icon to quit for good.',
  '后台运行': 'Background',
  '保存为 .txt 文件': 'Save as .txt file',
  '已保存文件': 'File saved',
  '设置已保存': 'Settings saved',
  '按下想用的组合键…': 'Press the key combination…',
  '点这里录制快捷键': 'Click here to record a hotkey',
  '界面语言已切换。': 'App language switched.',
};

let currentLang = 'zh';

// "system" resolves against the OS/browser locale, matching Locale.current.
export function resolveLang(uiLanguage) {
  if (uiLanguage === 'zh' || uiLanguage === 'en') return uiLanguage;
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setLang(uiLanguage) {
  currentLang = resolveLang(uiLanguage);
  document.documentElement.lang = currentLang === 'zh' ? 'zh-Hans' : 'en';
}

export function getLang() {
  return currentLang;
}

// Substitutes iOS-style specifiers: positional (%1$lld) first, then the
// remaining %@ / %lld in order.
function format(template, args) {
  let out = template.replace(/%(\d+)\$(?:@|lld|d|s)/g, (_, n) => {
    const v = args[Number(n) - 1];
    return v === undefined ? '' : String(v);
  });
  let i = 0;
  out = out.replace(/%(?:@|lld|d|s)/g, () => {
    const v = args[i++];
    return v === undefined ? '' : String(v);
  });
  return out;
}

export function t(key, ...args) {
  const template = currentLang === 'en' ? (EN[key] ?? key) : key;
  return args.length ? format(template, args) : template;
}
