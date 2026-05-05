<template>
  <div class="voice-call">
    <div v-if="status === 'idle'" class="voice-call__setup">
      <label for="voice-language" class="voice-call__label">
        {{ translate('voice.languageLabel', 'Language') }}
      </label>
      <select id="voice-language" v-model="selectedLanguage" class="voice-call__language" :disabled="busy">
        <option value="fr">Français</option>
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="sw">Kiswahili</option>
      </select>

      <label for="voice-gender" class="voice-call__label">
        {{ translate('voice.genderLabel', 'Voice') }}
      </label>
      <select id="voice-gender" v-model="selectedGender" class="voice-call__language" :disabled="busy">
        <option value="female">{{ translate('voice.female', 'Female') }}</option>
        <option value="male">{{ translate('voice.male', 'Male') }}</option>
      </select>

      <button type="button" class="voice-call__btn voice-call__btn--start" :disabled="busy" @click="startCall">
        <span class="voice-call__icon" aria-hidden="true">●</span>
        {{ busy ? translate('voice.connecting', 'Connecting…') : translate('voice.start', 'Start voice call') }}
      </button>
    </div>

    <div v-else class="voice-call__active">
      <div class="voice-call__status" :class="`voice-call__status--${status}`">
        <span class="voice-call__dot" :class="{ 'voice-call__dot--speaking': agentSpeaking }"></span>
        <span>{{ statusLabel }}</span>
      </div>
      <div class="voice-call__controls">
        <button type="button" class="voice-call__btn voice-call__btn--mute" @click="toggleMute">
          {{ muted ? translate('voice.unmute', 'Unmute') : translate('voice.mute', 'Mute') }}
        </button>
        <button type="button" class="voice-call__btn voice-call__btn--stop" @click="endCall">
          {{ translate('voice.end', 'End call') }}
        </button>
      </div>
    </div>

    <p v-if="error" class="voice-call__error" role="alert">{{ error }}</p>
  </div>
</template>

<script>
import voiceService from '@/services/voiceService'

export default {
  name: 'VoiceCallComponent',
  props: {
    locale: {
      type: String,
      default: 'en',
    },
  },
  emits: ['transcript', 'call-started', 'call-ended'],
  data() {
    return {
      call: null,
      status: 'idle',
      busy: false,
      muted: false,
      agentSpeaking: false,
      selectedLanguage: this.normalizeLocale(this.locale),
      selectedGender: 'female',
      error: '',
    }
  },
  computed: {
    statusLabel() {
      const map = {
        connecting: this.translate('voice.connecting', 'Connecting…'),
        connected: this.agentSpeaking
          ? this.translate('voice.agentSpeaking', 'Agent speaking…')
          : this.translate('voice.listening', 'Listening…'),
        ended: this.translate('voice.ended', 'Call ended'),
      }
      return map[this.status] || this.status
    },
  },
  beforeUnmount() {
    if (this.call) {
      this.call.stop().catch(() => {})
    }
  },
  methods: {
    translate(key, fallback = '') {
      if (!this.$i18n) return fallback
      try {
        const t = this.$i18n.t(key)
        return t === key ? fallback || key : t
      } catch (e) {
        return fallback || key
      }
    },
    normalizeLocale(locale) {
      const code = (locale || '').slice(0, 2).toLowerCase()
      return voiceService.supportedLanguages.includes(code) ? code : 'en'
    },
    async startCall() {
      this.error = ''
      this.busy = true
      this.status = 'connecting'
      try {
        this.call = voiceService.createCall()
        this.call
          .on('status', (s) => {
            this.status = s
          })
          .on('agentSpeaking', (flag) => {
            this.agentSpeaking = flag
          })
          .on('muted', (flag) => {
            this.muted = flag
          })
          .on('transcript', (payload) => {
            this.$emit('transcript', payload)
          })
          .on('disconnected', () => {
            this.$emit('call-ended')
            this.call = null
            this.muted = false
            this.agentSpeaking = false
          })

        await this.call.start({
          language: this.selectedLanguage,
          gender: this.selectedGender,
        })
        this.$emit('call-started', {
          language: this.selectedLanguage,
          gender: this.selectedGender,
        })
      } catch (err) {
        this.status = 'idle'
        this.error = err?.message || String(err)
        this.call = null
      } finally {
        this.busy = false
      }
    },
    async toggleMute() {
      if (!this.call) return
      try {
        await this.call.setMuted(!this.muted)
      } catch (err) {
        this.error = err?.message || String(err)
      }
    },
    async endCall() {
      if (!this.call) return
      try {
        await this.call.stop()
      } catch (err) {
        this.error = err?.message || String(err)
      }
      this.status = 'idle'
    },
  },
}
</script>

<style scoped>
.voice-call {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color, #d0d7de);
  border-radius: 8px;
  background: var(--surface-secondary, #f6f8fa);
  font-family: inherit;
}

.voice-call__setup,
.voice-call__active {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.voice-call__label {
  font-size: 0.85rem;
  color: var(--text-secondary, #57606a);
}

.voice-call__language {
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border-color, #d0d7de);
  background: var(--surface-primary, #fff);
}

.voice-call__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.2s ease,
    opacity 0.2s ease;
}

.voice-call__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.voice-call__btn--start {
  background: var(--accent-color, #1f883d);
  color: #fff;
}

.voice-call__btn--mute {
  background: var(--surface-primary, #fff);
  border: 1px solid var(--border-color, #d0d7de);
  color: var(--text-primary, #24292f);
}

.voice-call__btn--stop {
  background: var(--danger-color, #cf222e);
  color: #fff;
}

.voice-call__icon {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: #fff;
  display: inline-block;
  box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
  animation: voice-pulse 1.4s infinite;
}

.voice-call__status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
}

.voice-call__dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--accent-color, #1f883d);
  display: inline-block;
}

.voice-call__dot--speaking {
  background: var(--warning-color, #d4a72c);
  animation: voice-pulse 1s infinite;
}

.voice-call__error {
  margin: 0;
  color: var(--danger-color, #cf222e);
  font-size: 0.85rem;
}

@keyframes voice-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(31, 136, 61, 0.5);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(31, 136, 61, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(31, 136, 61, 0);
  }
}
</style>
