// App bootstrap: wire state → view, connect the backend event stream (tray and
// global hotkey), and run onboarding on first launch.

import { AppState } from './state.js';
import { buildMainScreen } from './main-screen.js';
import { openSettings } from './settings.js';
import { openOnboarding } from './onboarding.js';
import { initShell, setRootLayer, renderToast, popAllPages, closeContextMenu } from './ui.js';
import { api } from './api.js';

const shell = document.getElementById('app');
initShell(shell);

const state = new AppState();
let screen = null;

async function boot() {
  await state.load();

  // Pick up whatever was dictated while no window was open.
  try { state.applySession(await api.getSession()); } catch { /* server will push it */ }

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
    openOnboarding(state, () => state.notify());
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

      if (msg.type === 'session') {
        // Authoritative transcript state — the tray may have changed it while
        // this window wasn't even open.
        state.applySession(msg.session);
      } else if (msg.type === 'cleanup-token') {
        // Streamed so the cleaned pane fills in live, same as before.
        state.processedText += msg.v;
        state.notify();
      } else if (msg.type === 'toggle-record') {
        // Meant for the tray helper; the window just closes any open menu.
        closeContextMenu();
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

// Nothing to release on unload: the microphone belongs to the tray helper, so
// closing this window leaves an in-progress recording running — which is the
// whole point of the background mode.

boot().catch((err) => {
  document.body.innerHTML =
    `<div style="padding:24px;font:14px system-ui;color:#DC2626">启动失败 / Failed to start:<br><br>${
      String(err && err.message || err)}</div>`;
});
