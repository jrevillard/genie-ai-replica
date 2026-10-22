import { markRaw } from 'vue';
import { defineStore } from 'pinia';
import { isGuestTwinNotAllowed } from '../services/aiTwins';
import {
  VoiceCall,
  type MicFailure,
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
  /** Set when the call failed because the microphone could not be opened. */
  micFailure: MicFailure | null;
  /** Set when the call failed because guests may not use this Topic Module. */
  guestTwinNotAllowed: boolean;
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
    micFailure: null,
    guestTwinNotAllowed: false,
  }),

  getters: {
    isActive: (state): boolean =>
      state.status === 'connecting' || state.status === 'connected',
    // A failed call is over too: there is nothing left to listen to or stop.
    isEnded: (state): boolean => state.status === 'ended' || state.status === 'error',
  },

  actions: {
    async startCall(opts: StartCallOptions): Promise<void> {
      if (this.call) {
        // Treat a duplicate start as idempotent — caller may have re-mounted.
        return;
      }
      this.error = null;
      this.micFailure = null;
      this.guestTwinNotAllowed = false;
      this.transcripts = [];
      this.agentSpeaking = false;
      this.userSpeaking = false;
      this.muted = false;
      this.status = 'connecting';

      // markRaw: state holds the instance itself, not a reactive proxy of it,
      // so the identity check below holds (and its sockets stay unproxied).
      const call = markRaw(new VoiceCall());
      this.call = call;
      // A call that has been ended or replaced may still emit (its socket
      // closing, a late handshake); none of that may touch the current state.
      const isCurrent = (): boolean => this.call === call;

      call.on('status', (s) => {
        if (!isCurrent()) return;
        this.status = s;
        // 'error' is final and the call stops itself: let go of it.
        if (s === 'error') this.call = null;
      });
      call.on('agentSpeaking', (speaking) => {
        if (!isCurrent()) return;
        this.agentSpeaking = speaking;
        if (speaking) this.userSpeaking = false;
      });
      call.on('userSpeaking', () => {
        if (!isCurrent()) return;
        this.userSpeaking = true;
      });
      call.on('muted', (muted) => {
        if (!isCurrent()) return;
        this.muted = muted;
      });
      call.on('transcript', (t) => {
        if (!isCurrent()) return;
        this.transcripts.push(t);
      });
      call.on('error', (e) => {
        if (!isCurrent()) return;
        this.error = e.message;
      });
      call.on('micFailed', (reason) => {
        if (!isCurrent()) return;
        this.micFailure = reason;
      });
      call.on('disconnected', () => {
        if (!isCurrent()) return;
        // Status is set to 'ended' by the call before this fires.
        this.call = null;
      });

      try {
        await call.start(opts);
      } catch (err) {
        // No longer ours: the user ended it while connecting, or it already
        // reported 'error' itself. Either way there is nothing to add.
        if (!isCurrent()) return;
        this.error = (err as Error).message || 'Failed to start audio';
        this.guestTwinNotAllowed = isGuestTwinNotAllowed(err);
        this.status = 'error';
        this.call = null;
        throw err;
      }
    },

    async endCall(): Promise<void> {
      if (!this.call) return;
      const call = this.call;
      // Settle the state before stopping: the call is detached, so nothing it
      // emits meanwhile counts, and no write after the await can overwrite a
      // newer call's (or reset()'s) status.
      this.call = null;
      this.status = 'ended';
      try {
        await call.stop();
      } catch {
        /* nothing to report: the call is already detached */
      }
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
      this.micFailure = null;
      this.guestTwinNotAllowed = false;
    },
  },
});

export type { VoiceLanguage, VoiceStatus, VoiceTranscript };
