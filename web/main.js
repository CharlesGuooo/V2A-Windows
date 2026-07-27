// App bootstrap: wire state → view, connect the backend event stream (tray and
// global hotkey), and run onboarding on first launch.

import { AppState } from './state.js';
import { buildMainScreen } from './main-screen.js';
import { openSettings } from './settings.js';
import { openOnboarding } from './onboarding.js';
import { initShell, setRootLayer, renderToast, popAllPages, closeContextMenu } from './ui.js';

const shell = document.getElementById('app');
initShell(shell);

const state = new AppState();
let screen = null;

async function boot() {
  await state.load();

  screen = buildMainScreen(state, {
    onOpenSettings: () => openSettings(state),
  });
  shell.appendChild(screen.layer);
  setRootLayer(screen.layer);

  state.subscribe(() => {
    screen.update();
    renderToast(state.toast);
  });
  screen.update();

  connectEvents();

  if (!state.onboarded) {
    openOnboarding(state, () => {
      state.notify();
      maybeAutoRecord();
    });
  } else {
    maybeAutoRecord();
  }
}

// The tray/hotkey path can launch the window with ?autorecord=1 when no window
// was open — start recording as soon as we're ready.
function maybeAutoRecord() {
  const params = new URLSearchParams(location.search);
  if (params.get('autorecord') !== '1') return;
  history.replaceState(null, '', location.pathname);
  if (state.onboarded && state.hasSonioxKey) {
    state.startRecording();
  }
}

// SSE from server.js. Holding this stream open is also how the backend knows a
// window is currently visible.
function connectEvents() {
  let source;

  const connect = () => {
    source = new EventSource('/api/events');

    source.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'toggle-record') {
        // Global hotkey pressed anywhere in Windows.
        closeContextMenu();
        state.toggleRecording();
      } else if (msg.type === 'focus') {
        window.focus();
      } else if (msg.type === 'quit') {
        source.close();
        window.close();
      }
    };

    source.onerror = () => {
      source.close();
      setTimeout(connect, 2000);   // server restarting, or transient drop
    };
  };

  connect();
}

// Global keyboard handling inside the window.
window.addEventListener('keydown', (e) => {
  const inEditor = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape' && !inEditor) {
    popAllPages();
  }
});

// Release the mic if the window goes away while recording.
window.addEventListener('pagehide', () => {
  if (state.recording || state.starting) state.stopRecording();
});

boot().catch((err) => {
  document.body.innerHTML =
    `<div style="padding:24px;font:14px system-ui;color:#DC2626">启动失败 / Failed to start:<br><br>${
      String(err && err.message || err)}</div>`;
});
