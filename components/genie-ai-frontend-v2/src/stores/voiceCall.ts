import { defineStore } from 'pinia';
import {
  VoiceCall,
  type StartCallOptions,
  type VoiceLanguage,
  type VoiceTranscript,
  type VoiceStatus,
} from '../services/voiceCall';

interface VoiceCallState {
  call: VoiceCall | null;
  status: VoiceStatus;
  agentSpeaking: boolean;
  userSpeaking: boolean;
  muted: boolean;
  transcripts: VoiceTranscript[];
  error: string | null;
}

/**
 * Live voice-call control store. Wraps the {@link VoiceCall} runtime with
 * Pinia-reactive state so the UI can drive itself off `status`, `muted`,
 * `agentSpeaking`. Existing CallView UI bindings still work — the view just
 * imports `state`/`muted`/`status` from here instead of local refs.
 */
export const useVoiceCallStore = defineStore('voiceCall', {
  state: (): VoiceCallState => ({
    call: null,
    status: 'idle',
    agentSpeaking: false,
    userSpeaking: false,
    muted: false,
    transcripts: [],
    error: null,
  }),

  getters: {
    isActive: (state): boolean =>
      state.status === 'connecting' || state.status === 'connected',
    isEnded: (state): boolean => state.status === 'ended',
  },

  actions: {
    async startCall(opts: StartCallOptions): Promise<void> {
      if (this.call) {
        // Treat a duplicate start as idempotent — caller may have re-mounted.
        return;
      }
      this.error = null;
      this.transcripts = [];
      this.agentSpeaking = false;
      this.userSpeaking = false;
      this.muted = false;
      this.status = 'connecting';

      const call = new VoiceCall();
      this.call = call;

      call.on('status', (s) => {
        this.status = s;
      });
      call.on('agentSpeaking', (speaking) => {
        this.agentSpeaking = speaking;
        if (speaking) this.userSpeaking = false;
      });
      call.on('userSpeaking', () => {
        this.userSpeaking = true;
      });
      call.on('muted', (muted) => {
        this.muted = muted;
      });
      call.on('transcript', (t) => {
        this.transcripts.push(t);
      });
      call.on('error', (e) => {
        this.error = e.message;
      });
      call.on('disconnected', () => {
        // Status is set to 'ended' by the call before this fires.
        this.call = null;
      });

      try {
        await call.start(opts);
      } catch (err) {
        this.error = (err as Error).message || 'Failed to start call';
        this.status = 'error';
        this.call = null;
        throw err;
      }
    },

    async endCall(): Promise<void> {
      if (!this.call) return;
      const call = this.call;
      this.call = null;
      try {
        await call.stop();
      } catch {
        /* swallowed; status will move to 'ended' via disconnected */
      }
      this.status = 'ended';
    },

    toggleMute(): void {
      if (!this.call) return;
      this.call.setMuted(!this.muted);
    },

    /** Reset to idle so the view can restart a call from the same component. */
    reset(): void {
      void this.endCall();
      this.status = 'idle';
      this.transcripts = [];
      this.error = null;
    },
  },
});

export type { VoiceLanguage, VoiceStatus, VoiceTranscript };
