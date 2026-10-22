/* eslint-disable @typescript-eslint/no-explicit-any */
import { mintVoiceToken } from './voice';

/**
 * Live voice-call client. Owns the WebSocket to the voice-bridge, the mic
 * AudioWorklet (PCM frames + RMS), the playback queue (raw PCM → AudioBuffer),
 * and the four-layer echo strategy:
 *   1. Browser AEC (echoCancellation + noiseSuppression + autoGainControl)
 *   2. Mic mute while the agent is speaking + 400 ms cooldown after tts_end
 *      (the user's mic frames simply aren't sent during this window)
 *   3. Server-side drain window (POST_PROCESS_DRAIN_S=1.5 in voice-bridge)
 *      drops any audio buffered in the WS read queue while we were busy
 *   4. Barge-in detection — RMS over BARGE_IN_RMS_THRESHOLD for
 *      BARGE_IN_FRAMES_REQUIRED consecutive 20 ms frames stops playback
 *      and tells the server to cancel its in-flight LLM/TTS task
 *
 * The class is event-driven; consumers attach handlers via on(...).
 */

// The backend gates voice availability via /public/chat-sessions/languages
// (isVoiceSupported). Any ISO-639-1 code from that endpoint is a valid call
// language, so this is intentionally a string alias rather than a closed union
// — the UI is responsible for refusing unsupported codes before reaching here.
export type VoiceLanguage = string;
export type VoiceGender = 'female' | 'male';
export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'error';

/** Why the microphone could not be opened: the user refused, or anything else. */
export type MicFailure = 'denied' | 'unavailable';

export type VoiceTranscriptKind = 'transcript' | 'agent_text';

export interface VoiceTranscript {
  type: VoiceTranscriptKind;
  text: string;
}

interface VoiceCallEvents {
  status: (s: VoiceStatus) => void;
  agentSpeaking: (speaking: boolean) => void;
  userSpeaking: (speaking: boolean) => void;
  transcript: (t: VoiceTranscript) => void;
  bargeIn: () => void;
  muted: (muted: boolean) => void;
  error: (e: Error) => void;
  /** The microphone could not be opened; the call ends itself right after. */
  micFailed: (reason: MicFailure) => void;
  disconnected: () => void;
}

const TARGET_SAMPLE_RATE = 16000;
const BARGE_IN_RMS_THRESHOLD = 0.04; // ~ -28 dBFS on AEC-cleaned mic
const BARGE_IN_FRAMES_REQUIRED = 5; // 100 ms of sustained voice

export interface StartCallOptions {
  language: VoiceLanguage;
  gender?: VoiceGender;
  twinId?: string;
}

export class VoiceCall {
  private ws: WebSocket | null = null;
  private captureContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private playbackContext: AudioContext | null = null;
  private playbackTime = 0;
  private currentPlaybackSampleRate = 22050;
  private activeSources = new Set<AudioBufferSourceNode>();
  private bargeInFrames = 0;

  private muted = false;
  private agentSpeaking = false;
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;
  // Set by stop(). A VoiceCall is single-use: once stopped, a token request
  // or socket handshake still in flight must not bring it up.
  private stopped = false;
  // Set once the mic is capturing (status 'connected'). The bridge accepts the
  // socket before it checks the token and speaks the greeting, so a close
  // before this point means the call never started.
  private live = false;

  private listeners: { [K in keyof VoiceCallEvents]?: VoiceCallEvents[K][] } = {};

  on<K extends keyof VoiceCallEvents>(event: K, handler: VoiceCallEvents[K]): this {
    (this.listeners[event] ??= [] as any).push(handler);
    return this;
  }

  off<K extends keyof VoiceCallEvents>(event: K, handler: VoiceCallEvents[K]): void {
    const arr = this.listeners[event];
    if (!arr) return;
    const i = (arr as any[]).indexOf(handler);
    if (i >= 0) (arr as any[]).splice(i, 1);
  }

  private emit<K extends keyof VoiceCallEvents>(
    event: K,
    ...args: Parameters<VoiceCallEvents[K]>
  ): void {
    for (const h of this.listeners[event] ?? []) {
      try {
        (h as any)(...args);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`voiceCall listener for ${event} threw`, err);
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = Boolean(muted);
    this.emit('muted', this.muted);
  }

  /** Begin the call: mint token, open WS, start mic. Resolves when WS opens. */
  async start(opts: StartCallOptions): Promise<void> {
    if (this.ws) throw new Error('An audio session is already active');
    const language = opts.language ?? 'en';
    const gender = opts.gender && ['female', 'male'].includes(opts.gender)
      ? opts.gender
      : 'female';

    this.emit('status', 'connecting');

    const tokenInfo = await mintVoiceToken(language, opts.twinId);
    if (this.stopped) throw new Error('Audio session stopped while connecting');
    if (!tokenInfo?.wsUrl || !tokenInfo?.voiceToken) {
      const err = new Error('Backend did not return a valid voice token');
      this.emit('error', err);
      this.emit('status', 'error');
      throw err;
    }

    await this.openWebSocket(tokenInfo.wsUrl, language, gender, tokenInfo.voiceToken);
  }

  /** Graceful disconnect. Sends a "stop" frame, closes the WS, releases mic. */
  async stop(): Promise<void> {
    this.stopped = true;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'stop' }));
      }
      // Also abandons a socket that is still connecting, which would
      // otherwise open after the user has left and start the session.
      this.ws?.close(1000, 'client closed');
    } catch {
      /* ignore */
    }
    this.cleanup();
  }

  private openWebSocket(
    wsUrl: string,
    language: string,
    gender: string,
    voiceToken: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(err as Error);
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let opened = false;

      ws.addEventListener('open', () => {
        opened = true;
        try {
          // Status stays 'connecting' until the mic is live (see 'ready').
          ws.send(JSON.stringify({ type: 'start', language, gender, voiceToken }));
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });

      ws.addEventListener('message', (event) => this.handleMessage(event));

      ws.addEventListener('close', () => {
        if (!opened) {
          // A socket that never opened is a failed start. The error listener
          // normally rejected already; this covers a close without one, which
          // would otherwise leave start() pending forever.
          reject(new Error('Voice connection closed before it opened'));
        } else if (!this.live && !this.stopped) {
          // Closed before the call went live (bad token, failed greeting,
          // bridge restart): a failed start, not an end.
          this.emit('status', 'error');
        } else {
          this.emit('status', 'ended');
          this.emit('disconnected');
        }
        this.cleanup();
      });

      ws.addEventListener('error', (err) => {
        const e = err instanceof Error ? err : new Error('WebSocket error');
        this.emit('error', e);
        if (ws.readyState !== WebSocket.OPEN) reject(e);
      });
    });
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (event.data instanceof ArrayBuffer) {
      await this.enqueueAudio(event.data);
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        try {
          await this.startMicrophone();
          // Only now is anything listening. No socket: the call ended meanwhile.
          if (this.ws) {
            this.live = true;
            this.emit('status', 'connected');
          }
        } catch {
          // Without working audio capture nothing can be heard, so end the
          // call rather than leave the UI showing "Listening…".
          if (this.ws) {
            this.emit('status', 'error');
            await this.stop();
          }
        }
        break;
      case 'tts_start':
        this.currentPlaybackSampleRate = Number(msg.sample_rate) || 22050;
        this.agentSpeaking = true;
        if (this.unmuteTimer) {
          clearTimeout(this.unmuteTimer);
          this.unmuteTimer = null;
        }
        this.emit('agentSpeaking', true);
        break;
      case 'tts_end': {
        // Wait for the queued playback to drain + 400 ms reverb cushion
        // before re-opening the mic to the upstream.
        let waitMs = 400;
        if (this.playbackContext) {
          const remaining = Math.max(
            0,
            this.playbackTime - this.playbackContext.currentTime
          );
          waitMs += remaining * 1000;
        }
        if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
        this.unmuteTimer = setTimeout(() => {
          this.agentSpeaking = false;
          this.emit('agentSpeaking', false);
          this.unmuteTimer = null;
        }, waitMs);
        break;
      }
      case 'transcript':
      case 'agent_text':
        this.emit('transcript', { type: msg.type, text: String(msg.text ?? '') });
        break;
      case 'user_speaking':
        this.emit('userSpeaking', true);
        break;
      case 'agent_interrupted':
        this.emit('bargeIn');
        break;
      case 'error':
        this.emit('error', new Error(String(msg.message || 'voice error')));
        break;
      default:
        break;
    }
  }

  private async startMicrophone(): Promise<void> {
    if (this.captureContext) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      const e = new Error(`Microphone permission denied: ${(err as Error).message || err}`);
      this.emit('error', e);
      if (this.ws) {
        this.emit('micFailed', (err as Error).name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
      throw e;
    }
    if (!this.ws) {
      // The call ended (stopped, or the socket closed) while the permission
      // prompt was open: let the mic go again.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.mediaStream = stream;

    const Ctx: typeof AudioContext =
      (window.AudioContext as typeof AudioContext) ||
      ((window as any).webkitAudioContext as typeof AudioContext);
    let captureCtx: AudioContext;
    try {
      captureCtx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      captureCtx = new Ctx();
    }
    this.captureContext = captureCtx;

    try {
      // Bump v=N when /public/voice-worklet.js changes, to bust the static cache.
      await captureCtx.audioWorklet.addModule('/voice-worklet.js?v=2');
    } catch (err) {
      const e = new Error(`Failed to load audio worklet: ${(err as Error).message || err}`);
      this.emit('error', e);
      throw e;
    }
    // The call ended during the load; cleanup() has closed this context.
    if (!this.ws) return;

    this.workletNode = new AudioWorkletNode(captureCtx, 'voice-pcm-extractor');
    this.workletNode.port.onmessage = (event) => this.onMicFrame(event.data);

    this.sourceNode = captureCtx.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.workletNode);
    // Important: do NOT connect workletNode to destination — that would echo
    // mic into speakers and create a feedback loop.
  }

  private onMicFrame(data: any): void {
    let buffer: ArrayBuffer | undefined;
    let rms = 0;
    if (data instanceof ArrayBuffer) {
      buffer = data;
    } else if (data && data.buffer) {
      buffer = data.buffer as ArrayBuffer;
      rms = Number(data.rms) || 0;
    }
    if (!buffer) return;

    // Detect barge-in while the agent is speaking — measure RMS of the
    // already-AEC'd mic. Sustained voice above the threshold cancels the
    // agent's playback and signals the server.
    if (this.agentSpeaking) {
      if (rms > BARGE_IN_RMS_THRESHOLD) {
        this.bargeInFrames++;
        if (this.bargeInFrames >= BARGE_IN_FRAMES_REQUIRED) this.triggerBargeIn();
      } else if (this.bargeInFrames > 0) {
        this.bargeInFrames--; // soft decay so brief noise doesn't latch
      }
    } else {
      this.bargeInFrames = 0;
    }

    if (this.muted || this.agentSpeaking) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(buffer);
  }

  private async enqueueAudio(arrayBuffer: ArrayBuffer): Promise<void> {
    if (!this.playbackContext) {
      const Ctx: typeof AudioContext =
        (window.AudioContext as typeof AudioContext) ||
        ((window as any).webkitAudioContext as typeof AudioContext);
      this.playbackContext = new Ctx();
      this.playbackTime = this.playbackContext.currentTime;
    }
    const ctx = this.playbackContext;
    const pcm16 = new Int16Array(arrayBuffer);
    if (pcm16.length === 0) return;
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
    const sampleRate = this.currentPlaybackSampleRate || 22050;
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.playbackTime);
    source.start(startAt);
    this.activeSources.add(source);
    source.onended = () => this.activeSources.delete(source);
    this.playbackTime = startAt + buffer.duration;
  }

  private triggerBargeIn(): void {
    if (!this.agentSpeaking) return;
    this.bargeInFrames = 0;

    // Stop every queued/playing source immediately
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources.clear();
    if (this.playbackContext) {
      this.playbackTime = this.playbackContext.currentTime;
    }

    // Tell server to cancel in-flight LLM/TTS
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'barge_in' }));
      } catch {
        /* ignore */
      }
    }

    this.agentSpeaking = false;
    if (this.unmuteTimer) {
      clearTimeout(this.unmuteTimer);
      this.unmuteTimer = null;
    }
    this.emit('agentSpeaking', false);
    this.emit('bargeIn');
  }

  private cleanup(): void {
    if (this.unmuteTimer) {
      clearTimeout(this.unmuteTimer);
      this.unmuteTimer = null;
    }
    this.agentSpeaking = false;
    this.bargeInFrames = 0;
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        /* */
      }
    }
    this.activeSources.clear();
    try { this.workletNode?.disconnect(); } catch { /* */ }
    try { this.sourceNode?.disconnect(); } catch { /* */ }
    try { this.mediaStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { this.captureContext?.close(); } catch { /* */ }
    try { this.playbackContext?.close(); } catch { /* */ }
    this.workletNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.captureContext = null;
    this.playbackContext = null;
    this.playbackTime = 0;
    this.ws = null;
    this.muted = false;
  }
}
