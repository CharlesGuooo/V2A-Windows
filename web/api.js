// Thin client for the local server.js backend (loopback only).

async function json(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status}`);
  return res.json();
}

export const api = {
  bootstrap: () => json('/api/bootstrap'),

  saveSettings: (patch) => json('/api/settings', { method: 'POST', body: JSON.stringify(patch) }),

  saveKeys: (patch) => json('/api/keys', { method: 'POST', body: JSON.stringify(patch) }),

  loadHistory: () => json('/api/history').then((r) => r.sessions || []),
  appendHistory: (session) => json('/api/history', { method: 'POST', body: JSON.stringify(session) }),
  deleteHistory: (id) => json('/api/history', { method: 'DELETE', body: JSON.stringify({ id }) }),
  clearHistory: () => json('/api/history', { method: 'DELETE', body: JSON.stringify({}) }),

  // Opens a link in the user's real default browser rather than inside this
  // chromeless app window (which has no address bar or tabs).
  openExternal: (url) => json('/api/open', { method: 'POST', body: JSON.stringify({ url }) }),

  quit: () => json('/api/tray/quit', { method: 'POST', body: '{}' }),

  // Streams an AI cleanup through the backend proxy (no CORS, key stays
  // server-side). Calls onToken for each delta; resolves with the full text.
  // Throws { kind: 'http'|'network', ... } on failure, matching errors.js.
  async cleanup({ providerId, systemPrompt, transcript, onToken, signal }) {
    const res = await fetch('/api/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, systemPrompt, transcript }),
      signal,
    });

    if (!res.ok) {
      let payload = {};
      try { payload = await res.json(); } catch { /* ignore */ }
      throw { kind: 'network', message: payload.error || `HTTP ${res.status}` };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let full = '';
    let failure = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!chunk.startsWith('data: ')) continue;

        let msg;
        try { msg = JSON.parse(chunk.slice(6)); } catch { continue; }

        if (msg.t === 'token') {
          full += msg.v;
          onToken?.(msg.v);
        } else if (msg.t === 'done') {
          full = msg.v;
        } else if (msg.t === 'error') {
          failure = msg;
        }
      }
    }

    if (failure) throw failure;
    return full;
  },
};
