import httpService from './httpService'

const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'sw']
const TARGET_SAMPLE_RATE = 16000

// Barge-in: while the agent is speaking, watch the AEC-cleaned mic level.
// If RMS exceeds this threshold for N consecutive 20 ms frames, treat it as
// the user wanting to interrupt, kill agent playback, and tell the server.
// Tuned for typical speaking volume; raise if the residual echo bleeds
// through a poor speaker setup and triggers false barge-ins.
const BARGE_IN_RMS_THRESHOLD = 0.04 // ~ -28 dBFS on the cleaned mic
const BARGE_IN_FRAMES_REQUIRED = 5 // 100 ms of sustained voice

class VoiceCall {
  constructor() {
    this.ws = null
    this.captureContext = null
    this.mediaStream = null
    this.workletNode = null
    this.sourceNode = null

    this.playbackContext = null
    this.playbackTime = 0
    this.currentPlaybackSampleRate = 22050
    // Track active AudioBufferSourceNodes so we can stop them on barge-in.
    this._activeSources = new Set()
    this._bargeInFrames = 0

    this.muted = false
    // True while the agent's TTS is being streamed AND its audio is still
    // queued for playback. We must NOT send mic frames during this window or
    // the agent will hear its own playback (no AEC against speakers in this
    // path) and respond to itself in a loop.
    this.agentSpeaking = false
    // Extra cooldown after tts_end to cover the in-flight queued audio.
    this._unmuteTimer = null
    this.listeners = {}
  }

  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(handler)
    return this
  }

  emit(event, payload) {
    ;(this.listeners[event] || []).forEach((handler) => {
      try {
        handler(payload)
      } catch (err) {
        console.error(`voiceCall listener for ${event} threw`, err)
      }
    })
  }

  async start({ language, gender }) {
    if (this.ws) {
      throw new Error('A call is already active')
    }
    const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'en'
    const gen = ['female', 'male'].includes(gender) ? gender : 'female'
    console.log('[voice] start() lang=%s gender=%s', lang, gen)

    // Mint a short-lived signed voice token from the backend. Voice-bridge
    // verifies it and creates the call_session in ArangoDB on our behalf —
    // the frontend never writes to the call APIs directly.
    const tokenInfo = await this._fetchToken(lang)
    console.log('[voice] got token info', { wsUrl: tokenInfo?.wsUrl, language: tokenInfo?.language })
    if (!tokenInfo?.wsUrl || !tokenInfo?.voiceToken) {
      throw new Error('Backend did not return a valid voice token')
    }

    this.emit('status', 'connecting')
    await this._openWebSocket(tokenInfo.wsUrl, lang, gen, tokenInfo.voiceToken)
    return tokenInfo
  }

  async _openWebSocket(wsUrl, language, gender, voiceToken) {
    return new Promise((resolve, reject) => {
      let ws
      try {
        ws = new WebSocket(wsUrl)
      } catch (err) {
        reject(err)
        return
      }
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      const onOpen = async () => {
        console.log('[voice] WS open, sending start frame')
        try {
          ws.send(JSON.stringify({ type: 'start', language, gender, voiceToken }))
          this.emit('status', 'connected')
          resolve()
        } catch (err) {
          console.error('[voice] WS open send failed', err)
          reject(err)
        }
      }

      const onMessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          console.debug('[voice] audio chunk in: %d bytes', event.data.byteLength)
          await this._enqueueAudio(event.data)
          return
        }
        let msg
        try {
          msg = JSON.parse(event.data)
        } catch (e) {
          console.warn('[voice] non-JSON text frame', event.data)
          return
        }
        console.log('[voice] msg', msg.type, msg)
        if (msg.type === 'ready') {
          this.emit('status', 'connected')
          console.log('[voice] greeting done; starting mic')
          await this._startMicrophone()
        } else if (msg.type === 'tts_start') {
          this.currentPlaybackSampleRate = Number(msg.sample_rate) || 22050
          this.agentSpeaking = true
          if (this._unmuteTimer) {
            clearTimeout(this._unmuteTimer)
            this._unmuteTimer = null
          }
          console.log('[voice] tts_start, mic muted, sample_rate=%d', this.currentPlaybackSampleRate)
          this.emit('agentSpeaking', true)
        } else if (msg.type === 'tts_end') {
          // Wait for the queued playback to actually finish + 400 ms safety
          // buffer to suppress any reverb tail that the mic would pick up.
          let waitMs = 400
          if (this.playbackContext) {
            const remaining = Math.max(0, this.playbackTime - this.playbackContext.currentTime)
            waitMs += remaining * 1000
          }
          if (this._unmuteTimer) clearTimeout(this._unmuteTimer)
          console.log('[voice] tts_end, will unmute mic in %d ms', Math.round(waitMs))
          this._unmuteTimer = setTimeout(() => {
            this.agentSpeaking = false
            this.emit('agentSpeaking', false)
            this._unmuteTimer = null
            console.log('[voice] mic unmuted')
          }, waitMs)
        } else if (msg.type === 'transcript' || msg.type === 'agent_text') {
          this.emit('transcript', msg)
        } else if (msg.type === 'user_speaking') {
          this.emit('userSpeaking', true)
        } else if (msg.type === 'error') {
          this.emit('error', new Error(msg.message || 'voice error'))
        }
      }

      const onClose = () => {
        this.emit('status', 'ended')
        this.emit('disconnected')
        this._cleanup()
      }

      const onError = (err) => {
        this.emit('error', err)
        if (ws.readyState !== WebSocket.OPEN) {
          reject(err)
        }
      }

      ws.addEventListener('open', onOpen)
      ws.addEventListener('message', onMessage)
      ws.addEventListener('close', onClose)
      ws.addEventListener('error', onError)
    })
  }

  async _startMicrophone() {
    if (this.captureContext) return
    console.log('[voice] requesting mic permission')
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      console.log('[voice] mic granted')
    } catch (err) {
      console.error('[voice] mic permission denied', err)
      this.emit('error', new Error(`Microphone permission denied: ${err.message || err}`))
      throw err
    }

    const Ctx = window.AudioContext || window.webkitAudioContext
    let captureCtx
    try {
      captureCtx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE })
    } catch (e) {
      // Fallback: some browsers reject custom sampleRate. Use default and resample manually if needed.
      captureCtx = new Ctx()
    }
    this.captureContext = captureCtx

    try {
      // Bust the static-asset cache when the worklet contract changes.
      // Bump v=N below whenever voice-worklet.js is modified.
      await captureCtx.audioWorklet.addModule('/voice-worklet.js?v=2')
    } catch (err) {
      this.emit('error', new Error(`Failed to load audio worklet: ${err.message || err}`))
      throw err
    }

    this.workletNode = new AudioWorkletNode(captureCtx, 'voice-pcm-extractor')
    let framesSent = 0
    let framesSuppressed = 0
    let lastLogAt = performance.now()
    this.workletNode.port.onmessage = (event) => {
      // Accept both message shapes:
      //   - new: { buffer: ArrayBuffer, rms: Number }
      //   - old: ArrayBuffer (cached worklet from before barge-in)
      let buffer, rms
      if (event.data instanceof ArrayBuffer) {
        buffer = event.data
        rms = 0
      } else if (event.data && event.data.buffer) {
        buffer = event.data.buffer
        rms = event.data.rms || 0
      } else {
        return
      }

      // While the agent is speaking, the mic is muted from sending — but we
      // still observe RMS locally to detect barge-in.
      if (this.agentSpeaking) {
        if (rms > BARGE_IN_RMS_THRESHOLD) {
          this._bargeInFrames++
          if (this._bargeInFrames >= BARGE_IN_FRAMES_REQUIRED) {
            this._triggerBargeIn()
          }
        } else if (this._bargeInFrames > 0) {
          this._bargeInFrames-- // soft decay so brief noise doesn't latch
        }
      } else {
        this._bargeInFrames = 0
      }

      if (this.muted || this.agentSpeaking) {
        framesSuppressed++
        return
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.ws.send(buffer)
      framesSent++
      const now = performance.now()
      if (now - lastLogAt > 5000) {
        console.log(
          '[voice] mic last 5s: sent=%d suppressed=%d (mute=%s, agentSpeaking=%s)',
          framesSent,
          framesSuppressed,
          this.muted,
          this.agentSpeaking
        )
        framesSent = 0
        framesSuppressed = 0
        lastLogAt = now
      }
    }

    this.sourceNode = captureCtx.createMediaStreamSource(this.mediaStream)
    this.sourceNode.connect(this.workletNode)
    console.log('[voice] mic capture started, ctx sample rate=%d', captureCtx.sampleRate)
    // Important: do NOT connect workletNode to destination — would echo mic to speakers.
  }

  async _enqueueAudio(arrayBuffer) {
    if (!this.playbackContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      this.playbackContext = new Ctx()
      this.playbackTime = this.playbackContext.currentTime
    }
    const ctx = this.playbackContext
    const pcm16 = new Int16Array(arrayBuffer)
    if (pcm16.length === 0) return
    const float32 = new Float32Array(pcm16.length)
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768
    }
    const sampleRate = this.currentPlaybackSampleRate || 22050
    const buffer = ctx.createBuffer(1, float32.length, sampleRate)
    buffer.getChannelData(0).set(float32)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const startAt = Math.max(ctx.currentTime, this.playbackTime)
    source.start(startAt)
    this._activeSources.add(source)
    source.onended = () => this._activeSources.delete(source)
    this.playbackTime = startAt + buffer.duration
  }

  _triggerBargeIn() {
    if (!this.agentSpeaking) return
    console.log('[voice] BARGE-IN detected, killing playback and notifying server')
    this._bargeInFrames = 0

    // Stop every queued/playing source immediately
    this._activeSources.forEach((s) => {
      try {
        s.stop()
      } catch (e) {
        /* already stopped */
      }
    })
    this._activeSources.clear()
    if (this.playbackContext) {
      this.playbackTime = this.playbackContext.currentTime
    }

    // Tell server to cancel its in-flight LLM/TTS
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'barge_in' }))
      } catch (e) {
        /* */
      }
    }

    // Mic resumes immediately — we're now expecting user speech
    this.agentSpeaking = false
    if (this._unmuteTimer) {
      clearTimeout(this._unmuteTimer)
      this._unmuteTimer = null
    }
    this.emit('agentSpeaking', false)
    this.emit('bargeIn')
  }

  async setMuted(muted) {
    this.muted = Boolean(muted)
    this.emit('muted', this.muted)
  }

  async stop() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'stop' }))
        this.ws.close(1000, 'client closed')
      }
    } catch (e) {
      // ignore
    }
    this._cleanup()
  }

  _cleanup() {
    if (this._unmuteTimer) {
      clearTimeout(this._unmuteTimer)
      this._unmuteTimer = null
    }
    this.agentSpeaking = false
    this._bargeInFrames = 0
    this._activeSources.forEach((s) => {
      try {
        s.stop()
      } catch (e) {
        /* */
      }
    })
    this._activeSources.clear()
    try {
      this.workletNode?.disconnect()
    } catch (e) {
      /* */
    }
    try {
      this.sourceNode?.disconnect()
    } catch (e) {
      /* */
    }
    try {
      this.mediaStream?.getTracks().forEach((t) => t.stop())
    } catch (e) {
      /* */
    }
    try {
      this.captureContext?.close()
    } catch (e) {
      /* */
    }
    try {
      this.playbackContext?.close()
    } catch (e) {
      /* */
    }
    this.workletNode = null
    this.sourceNode = null
    this.mediaStream = null
    this.captureContext = null
    this.playbackContext = null
    this.playbackTime = 0
    this.ws = null
    this.muted = false
  }

  async _fetchToken(language) {
    const response = await httpService.post('voice/token', { language })
    if (!response?.data?.wsUrl) {
      throw new Error('Backend did not return a valid voice WebSocket URL')
    }
    return response.data
  }
}

export default {
  supportedLanguages: SUPPORTED_LANGUAGES,
  supportedGenders: ['female', 'male'],
  createCall() {
    return new VoiceCall()
  },
}
