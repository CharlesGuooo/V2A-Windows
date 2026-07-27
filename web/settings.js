// Ports of SettingsSheet.swift, PromptManagerView.swift, LanguagePickerView.swift,
// HistoryView.swift, FAQView.swift and AboutView.swift — same sections, same
// order, same copy. Windows-only additions: the global-hotkey section and the
// background/tray explanation.

import {
  h, icon, navbar, section, navRow, toggleRow, selectRow, linkRow,
  pushPage, popPage, confirmDialog,
} from './ui.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { PromptDefaults } from './prompts.js';
import { MicRecorder } from './recorder.js';
import { SonioxClient } from './soniox.js';

const SONIOX_CONSOLE = 'https://console.soniox.com/';
const openExternal = (url) => api.openExternal(url);

// ============================================================== settings

export function openSettings(state) {
  return pushPage((page) => {
    // Key edits are held locally and only committed on Save, matching the
    // iOS sheet's Cancel / Save semantics.
    const draftKeys = { ...state.keys };
    let selectedProviderId = state.activeProviderId;

    const providerKeyField = h('input', {
      type: 'password',
      class: 'field field--mono',
      placeholder: 'API Key',
      autocomplete: 'off',
      spellcheck: 'false',
      value: draftKeys[providerAccount(selectedProviderId)] || '',
      onInput: (e) => { draftKeys[providerAccount(selectedProviderId)] = e.target.value; },
    });

    const providerLinkRow = h('div');

    function providerAccount(id) {
      return state.findProvider(id)?.account || '';
    }

    function refreshProviderLink() {
      const p = state.findProvider(selectedProviderId);
      providerLinkRow.replaceChildren(
        p ? linkRow(t('去 %@ 网站拿 key →', p.displayName), p.apiKeyHelpURL, openExternal) : h('span'),
      );
    }
    refreshProviderLink();

    const aiSection = section(
      {
        header: t('AI 整理（必需）'),
        footer: t('选一家 provider 给你的语音转录做后期清理。每家 key 独立存储，可随时切换。'),
      },
      selectRow({
        label: 'Provider',
        value: selectedProviderId,
        options: state.providers.map((p) => ({ value: p.id, label: p.displayName })),
        onChange: (id) => {
          // Stash what's typed before swapping the visible key.
          draftKeys[providerAccount(selectedProviderId)] = providerKeyField.value;
          selectedProviderId = id;
          providerKeyField.value = draftKeys[providerAccount(id)] || '';
          refreshProviderLink();
        },
      }),
      h('div', { class: 'row' }, providerKeyField),
      providerLinkRow,
    );

    // ---- cleanup style
    const promptSection = section(
      {
        header: t('整理风格'),
        footer: t('看轻度 / 深度整理的规则，或者自己写一两个自定义版本（主页右键点击整理按钮选用）。'),
      },
      navRow({ label: t('告诉 AI 怎么整理'), onClick: () => openPromptManager(state) }),
    );

    // ---- Soniox
    const sonioxKeyField = h('input', {
      type: 'password',
      class: 'field field--mono',
      placeholder: t('Soniox API Key'),
      autocomplete: 'off',
      spellcheck: 'false',
      value: draftKeys.soniox || '',
      onInput: (e) => { draftKeys.soniox = e.target.value; },
    });

    const languagesRow = h('div');
    function refreshLanguagesRow() {
      languagesRow.replaceChildren(navRow({
        label: t('启用的语言'),
        value: state.selectedLanguages.join(', '),
        onClick: () => openLanguagePicker(state, refreshLanguagesRow),
      }));
    }
    refreshLanguagesRow();

    const sonioxSection = section(
      {
        header: t('Soniox 实时转录（必需）'),
        footer: t('用来把你说的话实时转成文字。从 console.soniox.com 拿 key。'),
      },
      h('div', { class: 'row' }, sonioxKeyField),
      languagesRow,
      linkRow(t('去 Soniox 网站拿 key →'), SONIOX_CONSOLE, openExternal),
    );

    // ---- hotwords
    const hotwordListEl = h('div');
    const hotwordInput = h('input', {
      type: 'text',
      class: 'field',
      placeholder: t('添加热词'),
      autocomplete: 'off',
      spellcheck: 'false',
      onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); commitHotword(); } },
      onInput: () => { addHotwordBtn.disabled = !hotwordInput.value.trim(); },
    });
    const addHotwordBtn = h('button', {
      class: 'btn-secondary',
      disabled: true,
      onClick: () => commitHotword(),
    }, t('加入'));

    function commitHotword() {
      const value = hotwordInput.value.trim();
      if (!value) return;
      state.addHotwords(hotwordInput.value);
      hotwordInput.value = '';
      addHotwordBtn.disabled = true;
      renderHotwords();
    }

    function renderHotwords() {
      if (state.hotwords.length === 0) {
        hotwordListEl.replaceChildren(
          h('div', { class: 'row row--hint' }, t('把人名、专有名词、缩写加进来，Soniox 识别会更准。')),
        );
        return;
      }
      hotwordListEl.replaceChildren(...state.hotwords.map((word) =>
        h('div', { class: 'row' },
          h('div', { class: 'chip-row row__grow' },
            h('span', { class: 'chip-row__text' }, word),
            h('button', {
              class: 'icon-btn',
              title: t('删除'),
              onClick: () => { state.removeHotword(word); renderHotwords(); },
            }, icon('trash')),
          ),
        )));
    }
    renderHotwords();

    const hotwordsSection = section(
      { header: t('热词'), footer: t('逗号或回车分隔多个；点右边垃圾桶删除单个。') },
      h('div', { class: 'row' }, h('div', { class: 'field-row' }, hotwordInput, addHotwordBtn)),
      hotwordListEl,
    );

    // ---- general
    const historyRow = h('div');
    function refreshHistoryRow() {
      historyRow.replaceChildren(navRow({
        label: t('转录历史'),
        value: t('最近 %lld 条', state.historyCap),
        onClick: () => openHistory(state),
      }));
    }
    refreshHistoryRow();

    const generalSection = section(
      {
        header: t('通用'),
        footer: t('「自动复制」打开后，AI 整理一完成就把结果直接写进剪贴板，切过去 Ctrl+V 就行，不用再按复制快捷键。历史保存在本机。'),
      },
      selectRow({
        label: t('外观'),
        value: state.appearance,
        options: [
          { value: 'system', label: t('跟随系统') },
          { value: 'light', label: t('亮') },
          { value: 'dark', label: t('暗') },
        ],
        onChange: (v) => state.setAppearance(v),
      }),
      selectRow({
        label: t('界面语言'),
        value: state.uiLanguage,
        options: [
          { value: 'system', label: t('跟随系统') },
          { value: 'zh', label: t('中文') },
          { value: 'en', label: 'English' },
        ],
        onChange: (v) => {
          state.setUiLanguage(v);
          // Applies immediately on Windows — rebuild the sheet in the new language.
          popPage(page);
          openSettings(state);
        },
      }),
      toggleRow({
        label: t('整理完自动复制'),
        value: state.autoCopy,
        onChange: (v) => state.setAutoCopy(v),
      }),
      toggleRow({
        label: t('记录转录历史'),
        value: state.historyEnabled,
        onChange: (v) => state.setHistoryEnabled(v),
      }),
      historyRow,
    );

    // ---- global hotkeys (Windows only)
    const hotkeyRow = (action, label) => {
      const value = h('span', { class: 'row__value row__value--mono' }, state.hotkeys[action]);
      return h('button', {
        class: 'row row--tappable',
        onClick: () => captureHotkey(state, action, value),
      },
        h('span', { class: 'row__label row__grow' }, label),
        value,
        h('span', { class: 'row__chevron' }, icon('chevronRight')),
      );
    };

    const hotkeySection = section(
      {
        header: t('全局快捷键（任何窗口下都能用）'),
        footer: t('点一行然后按下你想用的组合键即可改。全局快捷键会从其它程序手里接管这个组合，所以尽量避开常用的。'),
      },
      toggleRow({
        label: t('启用全局快捷键'),
        value: state.hotkeysEnabled,
        onChange: (v) => { state.setHotkeysEnabled(v); state.showToast(t('快捷键已保存，立即生效。')); },
      }),
      hotkeyRow('record', t('开始 / 停止录音')),
      hotkeyRow('light', t('轻度整理')),
      hotkeyRow('deep', t('深度整理')),
      hotkeyRow('copy', t('复制整理结果')),
    );

    const backgroundSection = section(
      { header: t('后台运行'), footer: t('关闭窗口后 V2A 会继续留在系统托盘，按快捷键随时能录音。右键托盘图标可以彻底退出。') },
      toggleRow({
        label: t('开机自动启动'),
        value: state.autostart,
        onChange: (v) => {
          state.setAutostart(v);
          state.showToast(v ? t('已设为开机自动启动') : t('已取消开机自动启动'));
        },
      }),
    );

    // ---- help
    const aboutSection = section(
      { header: t('帮助') },
      navRow({ label: t('怎么拿 API key'), leading: 'question', onClick: () => openFAQ(state) }),
      navRow({ label: t('关于 / 隐私'), leading: 'info', onClick: () => openAbout(state) }),
    );

    async function save() {
      draftKeys[providerAccount(selectedProviderId)] = providerKeyField.value;
      draftKeys.soniox = sonioxKeyField.value;
      await state.saveKeys(draftKeys);
      state.setActiveProvider(selectedProviderId);
      popPage(page);
      state.showToast(t('设置已保存'));
    }

    page.layer.append(
      navbar({
        title: t('设置'),
        onBack: () => popPage(page),
        backLabel: t('取消'),
        action: { label: t('保存'), onClick: save },
      }),
      h('div', { class: 'scroll' },
        h('div', { class: 'form' },
          aiSection, promptSection, sonioxSection, hotwordsSection,
          generalSection, hotkeySection, backgroundSection, aboutSection,
        ),
      ),
    );
  }, 'sheet');
}

// Reads the next key combination the user presses and stores it for `action`.
async function captureHotkey(state, action, valueEl) {
  const previous = valueEl.textContent;
  valueEl.textContent = t('按下想用的组合键…');

  const combo = await new Promise((resolve) => {
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { cleanup(); resolve(null); return; }
      // Wait for a non-modifier key.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      const mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push('Win');
      // A global hotkey without a modifier would swallow that key system-wide.
      if (mods.length === 0) return;

      const name = normalizeKeyName(e);
      if (!name) return;
      cleanup();
      resolve([...mods, name].join('+'));
    };
    const cleanup = () => window.removeEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);
  });

  if (!combo) { valueEl.textContent = previous; return; }

  // Refuse a combination already bound to another action — two actions on one
  // key would just mean one of them never fires.
  const clash = Object.entries(state.hotkeys)
    .find(([a, c]) => a !== action && c.toLowerCase() === combo.toLowerCase());
  if (clash) {
    valueEl.textContent = previous;
    state.showToast(t('%@ 已经被另一个快捷键占用了。', combo));
    return;
  }

  valueEl.textContent = combo;
  state.setHotkey(action, combo);
  state.showToast(t('快捷键已保存，立即生效。'));
}

function normalizeKeyName(e) {
  const key = e.key;
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  const named = {
    ' ': 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Back', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    '`': 'Oemtilde', '-': 'OemMinus', '=': 'Oemplus', '\\': 'OemPipe',
    '[': 'OemOpenBrackets', ']': 'OemCloseBrackets', ';': 'OemSemicolon',
    "'": 'OemQuotes', ',': 'Oemcomma', '.': 'OemPeriod', '/': 'OemQuestion',
  };
  return named[key] || null;
}

// ======================================================= prompt manager

function openPromptManager(state) {
  return pushPage((page) => {
    const lang = state.displayLang;

    const builtin = (title, footer, text) => section(
      { header: title, footer },
      h('div', { class: 'row row--stack' },
        h('div', { class: 'prompt-readonly' }, text),
        h('button', {
          class: 'link-btn',
          onClick: async () => { await state.writeClipboard(text); state.showToast(t('已复制 ✓')); },
        }, icon('copy'), t('复制这段')),
      ),
    );

    // --- shared recording state; only one slot can record at a time
    let recordingSlot = null;
    let recordingStarting = false;
    let recordingStopping = false;
    let liveTranscript = '';
    let baseTextBeforeRecord = '';
    let recorder = null;
    let soniox = null;
    const errorRow = h('div', { class: 'section__footer', style: { color: 'var(--error)' } });

    const slots = [1, 2].map((index) => {
      const editor = h('textarea', {
        class: 'prompt-editor',
        spellcheck: 'false',
        value: index === 1 ? state.promptSlot1 : state.promptSlot2,
        onInput: () => {
          if (recordingSlot === index) return;
          if (index === 1) state.setPromptSlot1(editor.value);
          else state.setPromptSlot2(editor.value);
          refreshAll();
        },
      });

      const recordBtn = h('button', { class: 'link-btn', onClick: () => toggleRecording(index) });
      const templateBtn = h('button', {
        class: 'link-btn',
        onClick: (e) => {
          e.preventDefault();
          showTemplateMenu(e.clientX, e.clientY, index);
        },
      }, icon('fillDoc'), t('填入模板'));
      const deleteBtn = h('button', {
        class: 'icon-btn',
        title: t('删除'),
        onClick: () => fill(index, ''),
      }, icon('trash'));

      const controls = h('div', { class: 'prompt-controls' },
        recordBtn, templateBtn,
        h('div', { class: 'prompt-controls__spacer' }),
        deleteBtn,
      );

      const el = section(
        { header: t('自定义 %lld', index), footer: t('在主页右键点击「轻度整理」或「深度整理」就能选用这一版。') },
        h('div', { class: 'row row--stack' }, editor, controls),
      );

      return { index, el, editor, recordBtn, templateBtn, deleteBtn };
    });

    function draftOf(index) {
      return index === 1 ? state.promptSlot1 : state.promptSlot2;
    }

    function fill(index, text) {
      if (index === 1) state.setPromptSlot1(text); else state.setPromptSlot2(text);
      slots[index - 1].editor.value = text;
      refreshAll();
    }

    function showTemplateMenu(x, y, index) {
      import('./ui.js').then(({ showContextMenu }) => {
        showContextMenu(x, y, [
          { label: t('轻度整理'), onClick: () => fill(index, PromptDefaults.lightDisplay(lang)) },
          { label: t('深度整理'), onClick: () => fill(index, PromptDefaults.deepDisplay(lang)) },
        ]);
      });
    }

    function combinedTextDuringRecording() {
      const live = liveTranscript.trim();
      if (!live) return baseTextBeforeRecord;
      if (!baseTextBeforeRecord) return live;
      return `${baseTextBeforeRecord} ${live}`;
    }

    function refreshAll() {
      for (const slot of slots) {
        const isRec = recordingSlot === slot.index;
        slot.editor.disabled = isRec;
        slot.editor.style.opacity = isRec ? '0.85' : '1';
        if (isRec) slot.editor.value = combinedTextDuringRecording();

        slot.recordBtn.replaceChildren(
          icon(isRec ? 'stop' : 'mic'),
          document.createTextNode(
            isRec ? (recordingStopping ? t('停止中…') : t('停止'))
              : (recordingStarting && recordingSlot === null ? t('连接中…') : t('录音输入')),
          ),
        );
        slot.recordBtn.classList.toggle('link-btn--recording', isRec);
        slot.recordBtn.disabled =
          (recordingSlot !== null && recordingSlot !== slot.index) || recordingStarting || recordingStopping;
        slot.templateBtn.disabled = recordingSlot !== null;
        slot.deleteBtn.disabled = !draftOf(slot.index) || recordingSlot !== null;
      }
      errorRow.hidden = !errorRow.textContent;
    }

    function toggleRecording(index) {
      if (recordingSlot === index) stopRecording();
      else if (recordingSlot === null) startRecording(index);
    }

    async function startRecording(index) {
      if (recordingSlot !== null || recordingStarting || recordingStopping) return;
      const key = (state.keys.soniox || '').trim();
      if (!key) {
        errorRow.textContent = t('未配置 Soniox key，去设置 → Soniox 那栏填一下。');
        refreshAll();
        return;
      }
      recordingStarting = true;
      errorRow.textContent = '';
      liveTranscript = '';
      baseTextBeforeRecord = draftOf(index);
      refreshAll();

      const rec = new MicRecorder();
      if (!(await rec.requestPermission())) {
        errorRow.textContent = rec.permissionError;
        recordingStarting = false;
        refreshAll();
        return;
      }

      const sx = new SonioxClient({
        apiKey: key,
        hotwords: [...state.hotwords],
        languageHints: [...state.selectedLanguages],
        languageHintsStrict: state.selectedLanguages.length > 0,
        onText: (text) => { liveTranscript = text; refreshAll(); },
        onFailure: (err) => { errorRow.textContent = err.message; stopRecording(); },
      });

      try {
        await sx.start();
        await rec.start((frame) => sx.sendAudio(frame));
      } catch (e) {
        errorRow.textContent = t('启动失败：%@', e.message || String(e));
        await sx.stop();
        await rec.stop();
        recordingStarting = false;
        refreshAll();
        return;
      }

      recorder = rec;
      soniox = sx;
      recordingStarting = false;
      recordingSlot = index;
      refreshAll();
    }

    async function stopRecording() {
      const index = recordingSlot;
      if (index === null) {
        if (recorder) { await recorder.stop(); recorder = null; }
        if (soniox) { await soniox.stop(); soniox = null; }
        recordingStarting = false;
        recordingStopping = false;
        refreshAll();
        return;
      }
      if (recordingStopping) return;
      recordingStopping = true;
      refreshAll();

      if (recorder) { await recorder.stop(); recorder = null; }
      if (soniox) { await soniox.stop(); soniox = null; }

      const finalText = combinedTextDuringRecording();
      recordingSlot = null;
      recordingStopping = false;
      liveTranscript = '';
      baseTextBeforeRecord = '';
      fill(index, finalText);
    }

    page.onClose = () => { stopRecording(); };

    page.layer.append(
      navbar({ title: t('告诉 AI 怎么整理'), onBack: () => popPage(page), backLabel: t('设置') }),
      h('div', { class: 'scroll' },
        h('div', { class: 'form' },
          builtin(t('轻度整理'), t('快速清理：删语气词、修标点、小幅通顺。'), PromptDefaults.lightDisplay(lang)),
          builtin(t('深度整理'), t('结构化：识别改口只留最终意思、把分点整理成 bullet。'), PromptDefaults.deepDisplay(lang)),
          slots[0].el, slots[1].el,
          errorRow,
        ),
      ),
    );
    refreshAll();
  });
}

// ====================================================== language picker

const SONIOX_LANGUAGES = [
  ['zh', '中文（普通话）'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'],
  ['ru', 'Русский'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['pl', 'Polski'],
  ['tr', 'Türkçe'], ['ar', 'العربية'], ['hi', 'हिन्दी'],
];

function openLanguagePicker(state, onDone) {
  return pushPage((page) => {
    const rows = SONIOX_LANGUAGES.map(([code, label]) => toggleRow({
      label: h('span', { class: 'row__grow', style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
        h('span', {}, label),
        h('span', { class: 'row__value' }, code),
      ),
      value: state.selectedLanguages.includes(code),
      onChange: (on) => {
        const next = state.selectedLanguages.filter((c) => c !== code);
        if (on) next.push(code);
        state.setSelectedLanguages(next);
      },
    }));

    page.onClose = onDone;
    page.layer.append(
      navbar({ title: t('Soniox 语言'), onBack: () => popPage(page), backLabel: t('设置') }),
      h('div', { class: 'scroll' },
        h('div', { class: 'form' },
          section(
            {
              header: t('启用的语言'),
              footer: t('勾选你会说的语言。勾得越多越容易误判（比如把中文听成日文）。至少保留一个；默认中 + 英。'),
            },
            ...rows,
          ),
        ),
      ),
    );
  });
}

// ============================================================== history

function formatStamp(iso, lang) {
  const d = new Date(iso);
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  return {
    date: d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  };
}

function openHistory(state) {
  return pushPage((page) => {
    const body = h('div', { class: 'scroll' });
    const clearBtn = h('button', {
      class: 'navbar__btn navbar__btn--strong navbar__btn--danger',
      onClick: async () => {
        const ok = await confirmDialog({
          title: t('清空全部历史？'),
          message: t('这个操作不能撤销。'),
          confirmLabel: t('清空'),
          danger: true,
        });
        if (!ok) return;
        await api.clearHistory();
        render();
      },
    }, t('清空全部'));

    const bar = navbar({ title: t('转录历史'), onBack: () => popPage(page), backLabel: t('设置') });
    bar.replaceChild(clearBtn, bar.lastChild);

    async function render() {
      const sessions = await api.loadHistory();
      clearBtn.hidden = sessions.length === 0;

      if (sessions.length === 0) {
        body.replaceChildren(h('div', { class: 'empty-state' },
          icon('clock'),
          h('div', {}, t('还没有历史记录')),
          h('div', { class: 'empty-state__hint' }, t('AI 整理完成后会自动保存最近 20 条到这里。')),
        ));
        return;
      }

      body.replaceChildren(h('div', { class: 'history-list' },
        ...sessions.map((s) => {
          const stamp = formatStamp(s.timestamp, state.displayLang);
          const providerLabel = state.findProvider(s.providerId)?.displayName ?? s.providerId;
          return h('div', { class: 'history-row' },
            h('button', {
              class: 'history-row__main',
              style: { background: 'none', textAlign: 'left' },
              onClick: () => openHistoryDetail(state, s),
            },
              h('div', { class: 'history-row__text' }, s.cleaned || s.raw),
              h('div', { class: 'history-row__meta' },
                h('span', {}, stamp.date), h('span', {}, '·'),
                h('span', {}, stamp.time), h('span', {}, '·'),
                h('span', {}, providerLabel),
              ),
            ),
            h('button', {
              class: 'icon-btn',
              title: t('删除'),
              onClick: async () => { await api.deleteHistory(s.id); render(); },
            }, icon('trash')),
          );
        }),
      ));
    }

    page.layer.append(bar, body);
    render();
  });
}

function openHistoryDetail(state, session) {
  return pushPage((page) => {
    const stamp = formatStamp(session.timestamp, state.displayLang);
    const providerLabel = state.findProvider(session.providerId)?.displayName ?? session.providerId;

    const pane = (title, text, isCleaned) => {
      const btn = h('button', {
        class: 'btn-primary',
        style: { width: '100%' },
        disabled: !text,
        onClick: async () => {
          await state.writeClipboard(text);
          btn.textContent = t('已复制 ✓');
          btn.classList.add('is-ok');
          setTimeout(() => {
            btn.textContent = isCleaned ? t('复制整理后') : t('复制原文');
            btn.classList.remove('is-ok');
          }, 1500);
        },
      }, isCleaned ? t('复制整理后') : t('复制原文'));

      return h('div', { class: 'pane' },
        h('div', { class: 'pane__head' }, h('span', { class: 'pane__title pane__title--accent' }, title)),
        h('div', { class: 'detail-pane' }, text),
        btn,
      );
    };

    page.layer.append(
      navbar({ title: t('历史详情'), onBack: () => popPage(page), backLabel: t('转录历史') }),
      h('div', { class: 'scroll' },
        h('div', { class: 'main-content' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('div', { class: 'header__subtitle' }, `${stamp.date}  ${stamp.time}`),
            h('div', { class: 'header__subtitle' }, providerLabel),
          ),
          pane(t('原始转录'), session.raw, false),
          pane(t('AI 整理后'), session.cleaned, true),
        ),
      ),
    );
  });
}

// ================================================================== FAQ

const SONIOX_STEPS = [
  '打开 console.soniox.com，用邮箱注册一个账号',
  '登录后左边菜单找到「API Keys」',
  '点「Create API Key」生成一个新 key',
  '复制出来的那串字符，回到 V2A 设置粘到 Soniox 那栏',
];

const PROVIDER_STEPS = {
  deepseek: [
    '打开 platform.deepseek.com 注册账号（手机号或邮箱都行）',
    '登录后点右上角头像 → API Keys',
    '点「Create new API key」起个名字，生成 key',
    '复制 sk- 开头的字符串，回到 V2A 设置粘进 AI 整理那栏',
  ],
  claude: [
    '打开 console.anthropic.com 注册账号',
    '充值至少 5 美元（Anthropic 要求先充值才能用 API）',
    '左边菜单 API Keys → 点「Create Key」',
    '复制 sk-ant- 开头的 key，回到 V2A 设置粘进去',
  ],
  gemini: [
    '打开 aistudio.google.com，用 Google 账号登录',
    '左下角点「Get API key」',
    '点「Create API key」，选一个 Google Cloud 项目（没有就让它新建）',
    '复制 AIza 开头的 key，回到 V2A 设置粘进去',
  ],
  openai: [
    '打开 platform.openai.com 注册账号',
    '必须先充值（最少 5 美元）才能用 API',
    '右上角设置 → API keys → Create new secret key',
    '复制 sk- 开头的 key（关掉就看不到了，记得马上粘到 V2A）',
  ],
  groq: [
    '打开 console.groq.com，可以直接用 Google 或 GitHub 登录',
    '左边菜单点「API Keys」',
    '点「Create API Key」起个名字',
    '复制 gsk_ 开头的 key，回到 V2A 设置粘进去',
  ],
};

const PROVIDER_FOOTNOTE = {
  deepseek: '新账号有免费额度，先用着不要钱。',
  gemini: '每天有免费配额，量不大的话不用付钱。',
  groq: '免费额度大、速度飞快。适合刚开始试。',
  claude: '质量最稳，但要先充钱才能用。',
  openai: '知名度最高，但价格不便宜，要先充值。',
};

function stepsView(steps) {
  return h('div', { class: 'row row--stack' },
    h('div', { class: 'faq-steps' },
      ...steps.map((text, i) => h('div', { class: 'faq-step' },
        h('span', { class: 'faq-step__num' }, `${i + 1}.`),
        h('span', { class: 'faq-step__text' }, t(text)),
      )),
    ),
  );
}

function openFAQ(state) {
  return pushPage((page) => {
    page.layer.append(
      navbar({ title: t('怎么拿 API key'), onBack: () => popPage(page), backLabel: t('设置') }),
      h('div', { class: 'scroll' },
        h('div', { class: 'form' },
          section({ header: t('Soniox · 把语音转成文字（必需）') },
            stepsView(SONIOX_STEPS),
            linkRow(t('打开 Soniox 控制台 →'), SONIOX_CONSOLE, openExternal),
          ),
          ...state.providers.map((p) => section(
            {
              header: t('%@ · 帮你整理文字', p.displayName),
              footer: PROVIDER_FOOTNOTE[p.id] ? t(PROVIDER_FOOTNOTE[p.id]) : null,
            },
            stepsView(PROVIDER_STEPS[p.id] || []),
            linkRow(t('打开 %@ 控制台 →', p.displayName), p.apiKeyHelpURL, openExternal),
          )),
        ),
      ),
    );
  });
}

// ================================================================ about

const PRIVACY_BULLETS = [
  '你填进去的 API key 用 Windows 数据保护（DPAPI）加密存在本机，只有你这个 Windows 账户能解开。我们看不到，也不会上传。',
  '录音通过你自己的 Soniox key 发到 Soniox，整理通过你自己的 AI 厂商 key 发到对应厂商。中间不经过任何我们的服务器。',
  '热词、自定义整理风格、设置项都只存在本机。',
  '我们不收集任何使用数据、不做分析、不做广告。',
  'App 完全断网时除了录音之外都不能用——所有功能都靠你自己的 key 调用第三方 API。',
];

function openAbout(state) {
  return pushPage((page) => {
    page.layer.append(
      navbar({ title: t('关于'), onBack: () => popPage(page), backLabel: t('设置') }),
      h('div', { class: 'scroll' },
        h('div', { class: 'form' },
          section(
            {
              header: 'V2A',
              footer: t('说一段话 → 实时转成文字 → AI 整理通顺 → 复制给 ChatGPT / Claude / 任何 Agent。打字慢的时候用。'),
            },
            h('div', { class: 'row' },
              h('span', { class: 'row__label row__grow' }, t('版本')),
              h('span', { class: 'row__value' }, '1.0.0 (Windows)'),
            ),
            h('div', { class: 'row' },
              h('span', { class: 'row__label row__grow' }, t('数据位置')),
              h('span', { class: 'row__value' }, '%APPDATA%\\V2A'),
            ),
          ),
          section(
            { header: t('隐私'), footer: t('如果换设备或重装，记得在新设备重新填一次 key。') },
            h('div', { class: 'row row--stack' },
              h('div', { class: 'bullet-list' },
                ...PRIVACY_BULLETS.map((text) => h('div', { class: 'bullet' },
                  h('span', { class: 'bullet__dot' }, '•'),
                  h('span', { class: 'bullet__text' }, t(text)),
                )),
              ),
            ),
          ),
        ),
      ),
    );
  });
}
