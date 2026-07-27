// Port of V2A/Services/MicRecorder.swift.
//
// Captures the microphone and emits 16 kHz mono Int16 PCM frames of 1600
// samples (~100 ms). On iOS that meant AVAudioEngine + AVAudioConverter; here
// the AudioContext does the resampling and an AudioWorklet does the framing.

import { t } from './i18n.js';

export class MicError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

export class MicRecorder {
  constructor() {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.worklet = null;
    this.onFrame = null;
    this.isRunning = false;

    // Fires when the mic goes away mid-session — device unplugged, or another
    // app grabbed it. Equivalent to AVAudioSession.interruptionNotification.
    this.onInterruption = null;
  }

  // Web getUserMedia both prompts for permission and opens the device, so this
  // keeps the stream for start() to use.
  async requestPermission() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      return true;
    } catch (e) {
      this.permissionError = MicRecorder.describe(e);
      return false;
    }
  }

  static describe(e) {
    const name = e && e.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return t('麦克风权限被拒绝。点地址栏左边的图标允许麦克风，或在 Windows 设置里打开麦克风权限。');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return t('找不到麦克风。插上麦克风或耳机后重试。');
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return t('麦克风被其他程序占用，关掉它再试。');
    }
    return (e && e.message) || String(e);
  }

  async start(onFrame) {
    if (this.isRunning) throw new MicError('already running', 'already-running');
    if (!this.stream) {
      const ok = await this.requestPermission();
      if (!ok) throw new MicError(this.permissionError, 'permission');
    }
    this.onFrame = onFrame;

    // Ask for a 16 kHz context so the browser resamples for us — this is the
    // AVAudioConverter step in the Swift version.
    this.context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    if (this.context.state === 'suspended') await this.context.resume();

    await this.context.audioWorklet.addModule('./pcm-worklet.js');

    this.source = this.context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.context, 'pcm-worklet', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.worklet.port.onmessage = (event) => {
      if (this.onFrame) this.onFrame(event.data);   // ArrayBuffer of Int16 LE
    };
    this.source.connect(this.worklet);

    // Device pulled out from under us.
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.isRunning && this.onInterruption) this.onInterruption();
      });
    }

    this.isRunning = true;
  }

  async stop() {
    this.isRunning = false;
    this.onFrame = null;

    if (this.worklet) {
      this.worklet.port.onmessage = null;
      try { this.worklet.disconnect(); } catch { /* already gone */ }
      this.worklet = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch { /* already gone */ }
      this.source = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.context) {
      try { await this.context.close(); } catch { /* already closed */ }
      this.context = null;
    }
  }
}
