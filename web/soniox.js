// Port of V2A/Services/SonioxClient.swift.
//
// Real-time STT over WebSocket. The audio framing and the token-merge logic
// (final accumulates, interim is the rolling tail) are kept identical to the
// iOS and web builds so the live-text UX matches exactly.
//
// The page talks to Soniox directly: WebSocket isn't subject to CORS, and the
// key never leaves the machine.

import { classifySoniox } from './errors.js';

const ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';

export class SonioxClient {
  constructor({
    apiKey,
    hotwords = [],
    languageHints = ['zh', 'en'],
    languageHintsStrict = false,
    sampleRate = 16000,
    onText,
    onFailure,
  }) {
    this.apiKey = apiKey;
    this.hotwords = hotwords.map((w) => w.trim()).filter(Boolean);
    this.languageHints = languageHints;
    this.languageHintsStrict = languageHintsStrict;
    this.sampleRate = sampleRate;
    this.onText = onText;
    this.onFailure = onFailure;

    this.ws = null;
    this.finalText = '';
    this.closedByUs = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(ENDPOINT);
      } catch (e) {
        reject(e);
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      let settled = false;

      ws.onopen = () => {
        const config = {
          api_key: this.apiKey,
          model: 'stt-rt-v5',
          audio_format: 's16le',
          sample_rate: this.sampleRate,
          num_channels: 1,
          enable_endpoint_detection: true,
        };
        if (this.languageHints.length > 0) {
          config.language_hints = this.languageHints;
          config.language_hints_strict = this.languageHintsStrict;
        }
        // Soniox v5 context is an object with a `terms` array, not a sentence.
        if (this.hotwords.length > 0) {
          config.context = { terms: this.hotwords };
        }
        try {
          ws.send(JSON.stringify(config));
        } catch (e) {
          if (!settled) { settled = true; reject(e); }
          return;
        }
        settled = true;
        resolve();
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') this.handleMessage(event.data);
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket connection failed'));
          return;
        }
        if (!this.closedByUs && this.ws) {
          this.ws = null;
          this.onFailure?.(classifySoniox(null, 'WebSocket error'));
        }
      };

      ws.onclose = (event) => {
        if (!settled) {
          settled = true;
          reject(new Error(event.reason || `WebSocket closed (${event.code})`));
          return;
        }
        // A close we didn't ask for means the session dropped.
        if (!this.closedByUs && this.ws) {
          this.ws = null;
          this.onFailure?.(classifySoniox(null, event.reason || ''));
        }
      };
    });
  }

  // frame: ArrayBuffer of Int16 LE samples.
  sendAudio(frame) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(frame); } catch { /* socket closing */ }
  }

  async stop() {
    const ws = this.ws;
    if (!ws) return;
    this.closedByUs = true;
    this.ws = null;

    // Signal end-of-stream per the Soniox docs, then give the server 500 ms to
    // push its final tokens before closing.
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send('');
    } catch { /* ignore */ }

    await new Promise((r) => setTimeout(r, 500));
    try { ws.close(1000); } catch { /* ignore */ }
  }

  handleMessage(raw) {
    let obj;
    try { obj = JSON.parse(raw); } catch { return; }

    // Soniox sends an error object before closing on auth / quota / bad config.
    if (obj.error_code != null || obj.error_message != null) {
      this.closedByUs = true;            // suppress the follow-up close handler
      const ws = this.ws;
      this.ws = null;
      try { ws?.close(); } catch { /* ignore */ }
      this.onFailure?.(classifySoniox(obj.error_code ?? null, obj.error_message ?? null));
      return;
    }

    const tokens = obj.tokens;
    if (!Array.isArray(tokens) || tokens.length === 0) return;

    let newFinal = '';
    let newInterim = '';
    let sawFinal = false;
    for (const tok of tokens) {
      const text = tok && tok.text;
      if (typeof text !== 'string' || text === '') continue;
      // enable_endpoint_detection makes Soniox emit literal "<end>" / "<fin>"
      // marker tokens to signal a sentence boundary. They are protocol, not
      // speech — never let them reach the transcript.
      if (text === '<end>' || text === '<fin>') continue;
      if (tok.is_final === true) {
        newFinal += text;
        sawFinal = true;
      } else {
        newInterim += text;
      }
    }
    if (newFinal) this.finalText += newFinal;

    const combined = (this.finalText + newInterim).trim();
    this.onText?.(combined, sawFinal && newInterim === '');
  }
}
