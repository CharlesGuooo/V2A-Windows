// AudioWorklet that turns the mic stream into the exact frames Soniox expects:
// 16 kHz mono signed 16-bit little-endian PCM, 1600 samples (~100 ms) per frame.
//
// Same framing as MicRecorder.swift (frameSamples = 1600) and the original
// web build's public/pcm-worklet.js. Resampling to 16 kHz is done by the
// AudioContext itself (constructed with sampleRate: 16000), so this processor
// only has to convert float → int16 and chunk.

const FRAME_SAMPLES = 1600;

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(FRAME_SAMPLES);
    this.count = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // No input yet (mic still warming up) — keep the node alive.
    if (!channel || channel.length === 0) return true;

    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.count++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.count === FRAME_SAMPLES) {
        const frame = this.buffer.slice();          // copy so we can transfer it
        this.port.postMessage(frame.buffer, [frame.buffer]);
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
