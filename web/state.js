// Port of V2A/Models/AppState.swift.
//
// Same fields, same method names, same state transitions. Persistence goes to
// server.js (settings.json + DPAPI-encrypted keys) instead of UserDefaults +
// Keychain; everything else is a straight translation.

import { api } from './api.js';
import { t, setLang, resolveLang } from './i18n.js';
import { PromptDefaults } from './prompts.js';
import { appError } from './errors.js';

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
  //
  // Capture itself lives in the native tray helper, not here — that is what
  // lets the global hotkeys work with no window open. The window only asks the
  // server to toggle, and learns the result from the session broadcast.

  toggleRecording() {
    if (this.starting || this.stopping) return;
    api.toggleRecording().catch(() => {
      this.appError = appError(t('V2A 后台没有响应'));
      this.notify();
    });
  }

  startRecording() { this.toggleRecording(); }

  stopRecording() {
    if (!this.recording) return;
    this.toggleRecording();
  }

  // Applies a session snapshot pushed by the server.
  applySession(s) {
    if (!s) return;
    this.recording = !!s.recording;
    this.processing = !!s.processing;
    this.finalText = s.finalText || '';
    this.liveText = s.liveText || '';
    this.processedText = s.processedText || '';
    this.notify();
  }

  // Text typed into either pane goes back to the server, which is the single
  // source of truth the hotkeys operate on.
  pushText(patch) {
    clearTimeout(this._textPushTimer);
    this._textPushTimer = setTimeout(() => {
      api.setSessionText(patch).catch(() => { /* best effort */ });
    }, 300);
  }


  // ------------------------------------------------------------ AI cleanup

  // Cleanup runs on the server so the hotkeys and the window share one
  // implementation, one result and one history entry. Tokens stream back over
  // the session broadcast; this call resolves when the whole thing is done.
  async processWithAI(kind = 'light') {
    if (this.isBusy || this.processing) return;

    this.appError = null;
    this.notify();

    const res = await api.cleanupSession(kind);

    if (!res || res.ok) {
      // Success: the session broadcast already carries the cleaned text.
      if (res && res.ok && this.autoCopy && res.text) {
        await this.writeClipboard(res.text);
        this.showToast(t('已自动复制到剪贴板'));
      }
      return;
    }
    this.appError = appError(res.message || t('AI 整理失败：%@', ''));
    this.notify();
  }

  clearAll() {
    if (this.isBusy) return;
    this.appError = null;
    this.notify();
    // The session broadcast will echo the cleared state back.
    api.clearSession().catch(() => { /* best effort */ });
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
