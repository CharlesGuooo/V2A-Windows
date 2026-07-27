// Port of V2A/ContentView.swift + TranscriptPaneView.swift.
//
// The DOM is built once and patched on every state change, so editing a
// transcript never loses the caret — the equivalent of SwiftUI's diffing.

import { h, icon, showContextMenu } from './ui.js';
import { t } from './i18n.js';
import { api } from './api.js';

export function buildMainScreen(state, { onOpenSettings }) {
  const refs = {};

  // ------------------------------------------------------------- header
  const header = h('div', { class: 'header' },
    h('div', { class: 'header__text' },
      refs.title = h('div', { class: 'header__title' }),
      refs.subtitle = h('div', { class: 'header__subtitle' }),
    ),
    h('button', { class: 'header__gear', onClick: onOpenSettings, title: t('设置') }, icon('gear')),
  );

  // ------------------------------------------------------------ notices
  const notices = h('div', { class: 'notices', style: { display: 'contents' } });

  // ------------------------------------------------------------ mic row
  refs.recordDot = h('span', { class: 'record-btn__dot' });
  refs.recordSpinner = h('span', { class: 'spinner', hidden: true });
  refs.recordLabel = h('span');
  refs.recordBtn = h('button', {
    class: 'record-btn',
    onClick: () => state.toggleRecording(),
  }, refs.recordDot, refs.recordSpinner, refs.recordLabel);

  refs.clearBtn = h('button', {
    class: 'btn-secondary',
    onClick: () => state.clearAll(),
  }, t('清空全部'));

  refs.statusText = h('span');
  refs.hotkeyChip = h('span', { class: 'hotkey-chip' });

  const micRow = h('div', { class: 'mic-row' },
    h('div', { class: 'mic-row__top' },
      refs.recordBtn,
      h('div', { class: 'mic-row__spacer' }),
      refs.clearBtn,
    ),
    h('div', { class: 'status-line' }, refs.statusText, refs.hotkeyChip),
  );

  // ----------------------------------------------------------- raw pane
  refs.rawCount = h('span', { class: 'pane__count' });
  refs.rawInput = h('textarea', {
    class: 'pane__input',
    spellcheck: 'false',
    onInput: () => {
      if (state.isBusy) return;
      state.finalText = refs.rawInput.value;
      state.liveText = '';
      state.notify();
    },
  });
  refs.rawBox = h('div', { class: 'pane__box' }, refs.rawInput);

  const rawPaneHead = h('div', { class: 'pane__head' },
    h('span', { class: 'pane__title' }, t('原始转录')),
    refs.rawCount,
  );

  // Copy-raw: lowest emphasis, narrow left column (0.32 of the row).
  refs.copyRawBtn = h('button', {
    class: 'btn-cleanup btn-cleanup--faint',
    onClick: () => state.copyRaw(),
  });

  refs.lightBtn = makeCleanupButton(state, 'light', 'medium', t('轻度整理'));
  refs.deepBtn = makeCleanupButton(state, 'deep', 'solid', t('深度整理'));

  const actionRow = h('div', { class: 'action-row' },
    refs.copyRawBtn,
    h('div', { class: 'action-row__stack' }, refs.lightBtn.el, refs.deepBtn.el),
  );

  const rawPane = h('div', { class: 'pane' }, rawPaneHead, refs.rawBox, actionRow);

  // ----------------------------------------------------- processed pane
  refs.processedCount = h('span', { class: 'pane__count' });
  refs.processedInput = h('textarea', {
    class: 'pane__input',
    spellcheck: 'false',
    onInput: () => {
      state.processedText = refs.processedInput.value;
      state.notify();
    },
  });

  refs.copyProcessedBtn = h('button', {
    class: 'btn-cleanup btn-cleanup--solid is-big',
    onClick: () => state.copyProcessed(),
  });

  refs.shareBtn = h('button', {
    class: 'share-btn',
    title: t('保存为 .txt 文件'),
    onClick: () => saveAsTextFile(state),
  }, icon('share'));

  const processedPane = h('div', { class: 'pane' },
    h('div', { class: 'pane__head' },
      h('span', { class: 'pane__title' }, t('AI 整理后')),
      refs.processedCount,
    ),
    h('div', { class: 'pane__box' }, refs.processedInput),
    h('div', { class: 'processed-actions' }, refs.copyProcessedBtn, refs.shareBtn),
  );

  const layer = h('div', { class: 'layer' },
    h('div', { class: 'scroll' },
      h('div', { class: 'main-content' }, header, notices, micRow, rawPane, processedPane),
    ),
  );

  // ------------------------------------------------------------- update
  function update() {
    // Header
    refs.title.textContent = t('V2A · 语音 → 文字 → AI 整理');
    refs.subtitle.textContent = t('说一段，停一下，AI 整理后复制给 agent');

    // Notices
    renderNotices(notices, state, onOpenSettings);

    // Record button
    const busyStarting = state.starting || state.stopping;
    refs.recordSpinner.hidden = !busyStarting;
    refs.recordDot.hidden = busyStarting;
    refs.recordBtn.classList.toggle('is-recording', state.recording);
    refs.recordLabel.textContent = state.starting ? t('连接中…')
      : state.stopping ? t('停止中…')
      : state.recording ? t('录音中')
      : t('开始录音');
    refs.recordBtn.disabled = !state.hasSonioxKey || state.starting || state.stopping;

    refs.clearBtn.textContent = t('清空全部');
    refs.clearBtn.disabled = state.isBusy
      || (!state.finalText && !state.liveText && !state.processedText);

    refs.statusText.textContent = state.starting ? t('正在连接 Soniox…')
      : state.stopping ? t('正在保存…')
      : state.recording ? t('录音中…')
      : state.hasSonioxKey ? t('点按钮开始') : t('需要先配置 API Key');

    // Windows-only affordance: make the global hotkey discoverable.
    refs.hotkeyChip.textContent = state.hotkeys.record;
    refs.hotkeyChip.hidden = !state.hotkeysEnabled || !state.hasSonioxKey;

    // Raw pane
    const raw = state.rawDisplay;
    if (refs.rawInput.value !== raw) refs.rawInput.value = raw;
    refs.rawInput.readOnly = state.isBusy;
    refs.rawInput.placeholder = t('转录的文字会出现在这里。停止后可编辑。');
    refs.rawBox.classList.toggle('is-readonly', state.isBusy);
    refs.rawCount.textContent = t('%lld 字', raw.length);

    refs.copyRawBtn.textContent = state.rawCopied ? t('已复制 ✓') : t('复制原文');
    refs.copyRawBtn.classList.toggle('is-ok', state.rawCopied);
    refs.copyRawBtn.disabled = !raw;

    const cleanupDisabled = !raw || state.processing || !state.hasActiveProviderKey || state.isBusy;
    refs.lightBtn.update(t('轻度整理'), state.processing, cleanupDisabled);
    refs.deepBtn.update(t('深度整理'), state.processing, cleanupDisabled);

    // Processed pane
    if (refs.processedInput.value !== state.processedText) {
      refs.processedInput.value = state.processedText;
    }
    refs.processedInput.placeholder = state.hasActiveProviderKey
      ? t('AI 整理后的文本会出现在这里。')
      : t('未配置 AI provider API key — AI 整理不可用。');
    refs.processedCount.textContent = t('%lld 字', state.processedText.length);

    refs.copyProcessedBtn.textContent = state.processedCopied ? t('已复制 ✓') : t('复制整理后');
    refs.copyProcessedBtn.classList.toggle('is-ok', state.processedCopied);
    refs.copyProcessedBtn.disabled = !state.processedText;
    refs.shareBtn.hidden = !state.processedText;
  }

  return { layer, update, focusRaw: () => refs.rawInput.focus() };
}

// One big cleanup button. Right-click (the desktop equivalent of the iOS
// long-press context menu) reveals whichever custom slots the user filled in.
function makeCleanupButton(state, kind, emphasis, initialLabel) {
  const label = h('span', {}, initialLabel);
  const spinner = h('span', { class: 'spinner', hidden: true });
  const el = h('button', {
    class: `btn-cleanup btn-cleanup--${emphasis} is-big`,
    onClick: () => state.processWithAI(kind),
    onContextmenu: (e) => {
      e.preventDefault();
      const items = [];
      if (state.promptSlot1) items.push({ label: t('自定义 1'), onClick: () => state.processWithAI('custom1') });
      if (state.promptSlot2) items.push({ label: t('自定义 2'), onClick: () => state.processWithAI('custom2') });
      if (items.length) showContextMenu(e.clientX, e.clientY, items);
    },
  }, spinner, label);

  return {
    el,
    update(text, processing, disabled) {
      label.textContent = text;
      label.hidden = processing;
      spinner.hidden = !processing;
      el.disabled = disabled;
    },
  };
}

function renderNotices(container, state, onOpenSettings) {
  const parent = container.parentNode;
  // Remove previously rendered notices (the container itself is display:contents).
  for (const el of parent.querySelectorAll(':scope > .notice, :scope > .error-notice')) el.remove();

  const insert = (el) => parent.insertBefore(el, container.nextSibling);
  const banners = [];

  if (!state.hasSonioxKey) {
    banners.push(h('div', { class: 'notice' }, t('未配置 Soniox API Key。点右上角齿轮添加。')));
  }
  if (state.hasSonioxKey && !state.hasActiveProviderKey) {
    const name = state.activeProvider?.displayName ?? 'AI provider';
    banners.push(h('div', { class: 'notice' }, t('未配置 %@ 的 API Key。AI 整理不可用，请去设置添加。', name)));
  }
  if (state.appError) {
    const err = state.appError;
    banners.push(h('div', { class: 'error-notice' },
      h('div', { class: 'error-notice__message' }, err.message),
      err.actionTitle
        ? h('button', {
            class: 'error-notice__action',
            onClick: () => {
              if (err.actionURL) api.openExternal(err.actionURL);
              else onOpenSettings();
            },
          }, err.actionTitle)
        : null,
    ));
  }

  // Insert in reverse so the visual order matches ContentView's VStack.
  for (const b of banners.reverse()) insert(b);
}

// The iOS build offers a ShareLink here. Windows has no share sheet in a
// browser window, so the nearest desktop equivalent is "save it somewhere".
async function saveAsTextFile(state) {
  const text = state.processedText;
  if (!text) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `V2A-${stamp}.txt`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Text', accept: { 'text/plain': ['.txt'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      state.showToast(t('已保存文件'));
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // user cancelled the dialog
    }
  }

  // Fallback: a plain download.
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  state.showToast(t('已保存文件'));
}
