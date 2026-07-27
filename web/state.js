// Port of V2A/Models/AppState.swift.
//
// Same fields, same method names, same state transitions. Persistence goes to
// server.js (settings.json + DPAPI-encrypted keys) instead of UserDefaults +
// Keychain; everything else is a straight translation.

import { api } from './api.js';
import { t, setLang, resolveLang } from './i18n.js';
import { PromptDefaults } from './prompts.js';
import { MicRecorder } from './recorder.js';
import { SonioxClient } from './soniox.js';
import { appError, classifyProvider } from './errors.js';

export class AppState {
  constructor() {
    // --- state (matches AppState.swift) ---
    this.recording = false;
    this.starting = false;
    this.stopping = false;
    this.hotwords = [];
    this.finalText = '';
    this.liveText = '';
    this.processedText = '';
    this.processing = false;
    this.rawCopied = false;
    this.processedCopied = false;
    this.hasSonioxKey = false;
    this.hasActiveProviderKey = false;
    this.activeProviderId = 'deepseek';
    this.selectedLanguages = ['zh', 'en'];
    this.promptSlot1 = '';
    this.promptSlot2 = '';
    this.onboarded = false;
    this.uiLanguage = 'system';
    this.appearance = 'system';
    this.autoCopy = false;
    this.toast = null;
    this.appError = null;

    // --- Windows additions ---
    this.historyEnabled = true;
    this.hotkeys = {
      record: 'Ctrl+Shift+R',
      light: 'Ctrl+Shift+Q',
      deep: 'Ctrl+Shift+D',
      copy: 'Ctrl+Shift+X',
      clear: 'Ctrl+Shift+Backspace',
    };
    this.hotkeysEnabled = true;
    this.autostart = false;

    // --- internals ---
    this.providers = [];
    this.keys = {};
    this.historyCap = 20;
    this.version = '0.0.0';
    this.repoURL = '';

    this.recorder = null;
    this.soniox = null;
    this.cleanupAbort = null;
    this.receivedAnyText = false;   // any token this session? (silence detection)
    this.stoppedDueToError = false;

    this._listeners = new Set();
    this._toastTimer = null;
    this._rawCopiedTimer = null;
    this._processedCopiedTimer = null;
  }

  // ------------------------------------------------------------ observation

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  notify() {
    for (const fn of this._listeners) fn();
  }

  // ------------------------------------------------------------- bootstrap

  async load() {
    const data = await api.bootstrap();
    const s = data.settings || {};

    this.providers = data.providers || [];
    this.keys = data.keys || {};
    this.historyCap = data.historyCap ?? 20;
    this.version = data.version || '0.0.0';
    this.repoURL = data.repoURL || '';

    this.hotwords = Array.isArray(s.hotwords) ? s.hotwords : [];
    this.activeProviderId = this.findProvider(s.activeProvider) ? s.activeProvider : data.defaultProviderId;
    this.selectedLanguages = Array.isArray(s.languages) && s.languages.length ? s.languages : ['zh', 'en'];
    this.promptSlot1 = s.promptSlot1 || '';
    this.promptSlot2 = s.promptSlot2 || '';
    this.uiLanguage = ['system', 'zh', 'en'].includes(s.uiLanguage) ? s.uiLanguage : 'system';
    this.appearance = ['system', 'light', 'dark'].includes(s.appearance) ? s.appearance : 'system';
    this.autoCopy = !!s.autoCopy;
    this.historyEnabled = s.historyEnabled !== false;
    this.hotkeys = { ...this.hotkeys, ...(s.hotkeys || {}) };
    this.hotkeysEnabled = s.hotkeysEnabled !== false;
    this.autostart = !!s.autostart;

    // Existing users (already have keys) skip onboarding — same rule as iOS.
    if (s.onboarded) {
      this.onboarded = true;
    } else {
      const hasSoniox = !!(this.keys.soniox || '').trim();
      const hasAnyProvider = this.providers.some((p) => (this.keys[p.account] || '').trim());
      if (hasSoniox && hasAnyProvider) {
        this.onboarded = true;
        api.saveSettings({ onboarded: true });
      }
    }

    setLang(this.uiLanguage);
    this.applyAppearance();
    this.refreshKeyAvailability();
  }

  persist(patch) {
    api.saveSettings(patch).catch(() => { /* best effort; local file write */ });
  }

  // -------------------------------------------------------------- providers

  findProvider(id) {
    return this.providers.find((p) => p.id === id) || null;
  }

  get activeProvider() {
    return this.findProvider(this.activeProviderId);
  }

  setActiveProvider(id) {
    if (!this.findProvider(id)) return;
    this.activeProviderId = id;
    this.persist({ activeProvider: id });
    this.refreshKeyAvailability();
    this.notify();
  }

  refreshKeyAvailability() {
    this.hasSonioxKey = !!(this.keys.soniox || '').trim();
    const p = this.activeProvider;
    this.hasActiveProviderKey = p ? !!(this.keys[p.account] || '').trim() : false;
  }

  async saveKeys(patch) {
    const res = await api.saveKeys(patch);
    this.keys = res.keys || {};
    this.refreshKeyAvailability();
    this.notify();
  }

  // ------------------------------------------------------------ appearance

  applyAppearance() {
    document.documentElement.dataset.theme = this.appearance;
  }

  setAppearance(value) {
    if (!['system', 'light', 'dark'].includes(value)) return;
    this.appearance = value;
    this.persist({ appearance: value });
    this.applyAppearance();
    this.notify();
  }

  // Unlike iOS (which reads AppleLanguages only at launch), the Windows build
  // can re-render immediately — so no "restart the app" alert is needed.
  setUiLanguage(code) {
    if (!['system', 'zh', 'en'].includes(code)) return;
    this.uiLanguage = code;
    this.persist({ uiLanguage: code });
    setLang(code);
    this.notify();
  }

  get displayLang() {
    return resolveLang(this.uiLanguage);
  }

  setAutoCopy(enabled) {
    this.autoCopy = !!enabled;
    this.persist({ autoCopy: this.autoCopy });
    this.notify();
  }

  setHistoryEnabled(enabled) {
    this.historyEnabled = !!enabled;
    this.persist({ historyEnabled: this.historyEnabled });
    this.notify();
  }

  // action: 'record' | 'light' | 'deep' | 'copy'
  setHotkey(action, combo) {
    if (!(action in this.hotkeys) || !combo) return;
    this.hotkeys = { ...this.hotkeys, [action]: combo };
    this.persist({ hotkeys: { [action]: combo } });
    this.notify();
  }

  setHotkeysEnabled(enabled) {
    this.hotkeysEnabled = !!enabled;
    this.persist({ hotkeysEnabled: this.hotkeysEnabled });
    this.notify();
  }

  setAutostart(enabled) {
    this.autostart = !!enabled;
    this.persist({ autostart: this.autostart });
    this.notify();
  }

  // ---------------------------------------------------------------- toast

  showToast(message, duration = 2000) {
    this.toast = message;
    this.notify();
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast = null;
      this.notify();
    }, duration);
  }

  // ------------------------------------------------------------ languages

  setSelectedLanguages(langs) {
    const cleaned = langs.length === 0 ? ['zh', 'en'] : langs;
    this.selectedLanguages = cleaned;
    this.persist({ languages: cleaned });
    this.notify();
  }

  // -------------------------------------------------------------- prompts

  setPromptSlot1(value) {
    this.promptSlot1 = value;
    this.persist({ promptSlot1: value });
    this.notify();
  }

  setPromptSlot2(value) {
    this.promptSlot2 = value;
    this.persist({ promptSlot2: value });
    this.notify();
  }

  prompt(kind) {
    switch (kind) {
      case 'light': return PromptDefaults.lightCanonical;
      case 'deep': return PromptDefaults.deepCanonical;
      case 'custom1': return this.promptSlot1 || PromptDefaults.lightCanonical;
      case 'custom2': return this.promptSlot2 || PromptDefaults.lightCanonical;
      default: return PromptDefaults.lightCanonical;
    }
  }

  // ------------------------------------------------------------- hotwords

  static parseHotwords(input) {
    return input
      .split(/[,，\n]/)
      .map((w) => w.trim())
      .filter(Boolean);
  }

  addHotwords(input) {
    const next = AppState.parseHotwords(input);
    if (next.length === 0) return;
    const merged = [...this.hotwords];
    for (const w of next) if (!merged.includes(w)) merged.push(w);
    this.hotwords = merged;
    this.persist({ hotwords: merged });
    this.notify();
  }

  removeHotword(word) {
    this.hotwords = this.hotwords.filter((w) => w !== word);
    this.persist({ hotwords: this.hotwords });
    this.notify();
  }

  // ------------------------------------------------------------- computed

  get rawDisplay() {
    if (!this.liveText) return this.finalText;
    if (!this.finalText) return this.liveText;
    return `${this.finalText}\n\n${this.liveText}`;
  }

  get isBusy() {
    return this.recording || this.starting || this.stopping;
  }

  // ------------------------------------------------------------ recording

  toggleRecording() {
    if (this.starting || this.stopping) return;
    if (this.recording) this.stopRecording();
    else this.startRecording();
  }

  async startRecording() {
    if (this.recording || this.starting || this.stopping) return;

    const key = (this.keys.soniox || '').trim();
    if (!key) {
      this.appError = appError(t('未配置 Soniox API key。'));
      this.notify();
      return;
    }

    this.starting = true;
    this.appError = null;
    this.liveText = '';
    this.receivedAnyText = false;
    this.stoppedDueToError = false;
    this.notify();

    const recorder = new MicRecorder();
    const granted = await recorder.requestPermission();
    if (!granted) {
      this.appError = appError(recorder.permissionError);
      this.starting = false;
      this.notify();
      return;
    }

    recorder.onInterruption = () => {
      if (!this.recording) return;
      this.stoppedDueToError = true;
      this.appError = appError(t('麦克风被其他程序占用，关掉它再试。'));
      this.stopRecording();
    };

    const soniox = new SonioxClient({
      apiKey: key,
      hotwords: [...this.hotwords],
      languageHints: [...this.selectedLanguages],
      languageHintsStrict: this.selectedLanguages.length > 0,
      onText: (text) => {
        if (text) this.receivedAnyText = true;
        this.liveText = text;
        this.notify();
      },
      onFailure: (err) => {
        this.stoppedDueToError = true;
        this.appError = err;
        this.stopRecording();
      },
    });

    try {
      await soniox.start();
    } catch (e) {
      await recorder.stop();
      this.appError = appError(t('Soniox 连接失败：%@', e.message || String(e)));
      this.starting = false;
      this.notify();
      return;
    }

    try {
      await recorder.start((frame) => soniox.sendAudio(frame));
    } catch (e) {
      await soniox.stop();
      await recorder.stop();
      this.appError = appError(t('麦克风失败：%@', e.message || String(e)));
      this.starting = false;
      this.notify();
      return;
    }

    this.recorder = recorder;
    this.soniox = soniox;
    this.starting = false;
    this.recording = true;
    this.notify();
  }

  async stopRecording() {
    if (this.stopping) return;
    if (!this.recording && !this.recorder && !this.soniox) return;

    this.stopping = true;
    this.recording = false;
    this.notify();

    if (this.recorder) {
      await this.recorder.stop();
      this.recorder = null;
    }
    if (this.soniox) {
      await this.soniox.stop();
      this.soniox = null;
    }

    const session = this.liveText.trim();
    if (session) {
      this.finalText = this.finalText ? `${this.finalText}\n\n${session}` : session;
    }
    this.liveText = '';
    this.stopping = false;

    // A whole session with nothing heard (and no error that stopped it) is
    // almost always a mic problem — say so rather than sitting silent.
    if (!this.stoppedDueToError && !this.receivedAnyText && !session) {
      this.appError = appError(t('没听到声音，检查麦克风或说话音量。'));
    }
    this.stoppedDueToError = false;
    this.notify();
  }

  // ------------------------------------------------------------ AI cleanup

  async processWithAI(kind = 'light') {
    if (this.isBusy) return;
    const provider = this.findProvider(this.activeProviderId);
    if (!provider) return;
    if (!(this.keys[provider.account] || '').trim()) return;

    const source = this.rawDisplay;
    if (!source || this.processing) return;

    const activePrompt = this.prompt(kind);
    const providerId = this.activeProviderId;

    this.processing = true;
    this.processedText = '';
    this.appError = null;
    this.notify();

    this.cleanupAbort?.abort();
    const controller = new AbortController();
    this.cleanupAbort = controller;

    try {
      const cleaned = await api.cleanup({
        providerId,
        systemPrompt: activePrompt,
        transcript: source,
        signal: controller.signal,
        onToken: (token) => {
          if (controller.signal.aborted) return;
          this.processedText += token;
          this.notify();
        },
      });

      if (controller.signal.aborted) return;

      // Replace with the trimmed final to clear any trailing whitespace.
      if (this.processedText !== cleaned) this.processedText = cleaned;

      this.recordSessionIfEnabled(source, cleaned, providerId, kind);

      if (this.autoCopy && cleaned) {
        await this.writeClipboard(cleaned);
        this.showToast(t('已自动复制到剪贴板'));
      }
    } catch (e) {
      if (controller.signal.aborted || e?.name === 'AbortError') return;
      this.appError = classifyProvider(
        e && e.kind ? e : { kind: 'network', message: e?.message || String(e) },
        provider,
      );
    } finally {
      if (this.cleanupAbort === controller) this.cleanupAbort = null;
      this.processing = false;
      this.notify();
    }
  }

  recordSessionIfEnabled(raw, cleaned, providerId, mode) {
    if (!this.historyEnabled) return;
    api.appendHistory({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      raw,
      cleaned,
      providerId,
      mode,
    }).catch(() => { /* best effort */ });
  }

  clearAll() {
    if (this.isBusy) return;
    this.cleanupAbort?.abort();
    this.cleanupAbort = null;
    this.processing = false;
    this.finalText = '';
    this.liveText = '';
    this.processedText = '';
    this.appError = null;
    this.notify();
  }

  // ---------------------------------------------------------------- copy

  async writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for when the async clipboard API is unavailable.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  async copyRaw() {
    const text = this.rawDisplay;
    if (!text) return;
    await this.writeClipboard(text);
    this.rawCopied = true;
    this.notify();
    clearTimeout(this._rawCopiedTimer);
    this._rawCopiedTimer = setTimeout(() => {
      this.rawCopied = false;
      this.notify();
    }, 1500);
  }

  async copyProcessed() {
    const text = this.processedText;
    if (!text) return;
    await this.writeClipboard(text);
    this.processedCopied = true;
    this.notify();
    clearTimeout(this._processedCopiedTimer);
    this._processedCopiedTimer = setTimeout(() => {
      this.processedCopied = false;
      this.notify();
    }, 1500);
  }
}
