// AudioWorklet: extract Float32 mic samples, post Int16 PCM frames + per-frame
// RMS level to the main thread.
// Frame size matches the voice-bridge expectation (20 ms at 16 kHz = 320 samples
// = 640 bytes). RMS is computed on the AEC-cleaned float input (the browser
// applied echoCancellation before we get here) so the level reflects what's
// actually being sent — used by the main thread for barge-in detection.

class VoicePcmExtractor extends AudioWorkletProcessor {
  constructor () {
    super();
    this.frameSize = 320;
    this.buf = new Int16Array(this.frameSize);
    this.idx = 0;
    this.sumSq = 0;
  }

  process (inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }
    const samples = input[0]; // Float32 mono channel
    for (let i = 0; i < samples.length; i++) {
      let s = samples[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this.sumSq += s * s;
      this.buf[this.idx++] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
      if (this.idx >= this.frameSize) {
        const rms = Math.sqrt(this.sumSq / this.frameSize);
        // Transfer the buffer; rms is a small primitive, copied.
        this.port.postMessage({ buffer: this.buf.buffer, rms }, [this.buf.buffer]);
        this.buf = new Int16Array(this.frameSize);
        this.idx = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor('voice-pcm-extractor', VoicePcmExtractor);
