<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  CallEnd01Icon,
  Mic01Icon,
  MicOff01Icon,
} from '@hugeicons/core-free-icons';

import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import { chatStrings } from '../lib/chatStrings';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useChatStore } from '../stores/chat';
import { useVoiceCallStore } from '../stores/voiceCall';
import type { VoiceLanguage } from '../services/voiceCall';
import { useT } from '../i18n/composables';

const { t: tt } = useT();

// Live voice call wired through useVoiceCallStore.
type CallState = 'idle' | 'ended';

const route = useRoute();
const router = useRouter();
const aiTwinsStore = useAiTwinsStore();
const chatStore = useChatStore();
const voiceCall = useVoiceCallStore();
const { current: twin } = storeToRefs(aiTwinsStore);
const { lang } = storeToRefs(chatStore);
const {
  status: callStatus,
  muted: callMuted,
  agentSpeaking,
} = storeToRefs(voiceCall);

const t = chatStrings;
const c = chatStrings.call;

const twinId = computed(() => {
  const raw = route.params.twinId;
  return Array.isArray(raw) ? raw[0] : (raw ?? '');
});

// `state` shapes what the orb / footer render. We map the live status to the
// existing 'idle' | 'ended' values the template already expects.
const state = computed<CallState>(() => (callStatus.value === 'ended' ? 'ended' : 'idle'));
const muted = computed<boolean>({
  get: () => callMuted.value,
  set: (v) => {
    if (v !== callMuted.value) voiceCall.toggleMute();
  },
});

async function loadTwin(): Promise<void> {
  if (!twinId.value) return;
  chatStore.setTwinContext(twinId.value);
  try {
    await aiTwinsStore.fetchOne(twinId.value);
  } catch {
    // store.error renders into the empty fallback below.
  }
}

const SUPPORTED_VOICE_LANGS: readonly VoiceLanguage[] = ['en', 'fr', 'es', 'sw'];
function toVoiceLang(code: string): VoiceLanguage {
  return (SUPPORTED_VOICE_LANGS as readonly string[]).includes(code)
    ? (code as VoiceLanguage)
    : 'en';
}

async function startVoiceCall(): Promise<void> {
  if (!twinId.value) return;
  if (voiceCall.isActive) return;
  try {
    await voiceCall.startCall({
      language: toVoiceLang(lang.value),
      twinId: twinId.value,
    });
  } catch {
    // store.error already populated; UI stays on the idle shell.
  }
}

onMounted(() => {
  void loadTwin();
  void startVoiceCall();
});

onBeforeUnmount(() => {
  void voiceCall.endCall();
});

watch(twinId, () => {
  void loadTwin();
  void startVoiceCall();
});

// When the call ends (user hangs up, backend closes, or anything else),
// skip the standalone "Call ended" screen and drop the user back into the
// chat surface for the same twin. Falls back to the twin list if we somehow
// have no twinId.
watch(state, (next) => {
  if (next !== 'ended') return;
  if (twinId.value) {
    router.replace({ name: 'chat', params: { twinId: twinId.value } });
  } else {
    router.replace({ name: 'ai-twins' });
  }
});

const statusLabel = computed(() => {
  if (state.value === 'ended') return c.ended;
  if (callStatus.value === 'connecting') return c.connecting;
  if (muted.value) return c.muted;
  if (agentSpeaking.value) return c.aiSpeaking;
  return c.listening;
});

function endCall(): void {
  void voiceCall.endCall();
}

function toggleMute(): void {
  voiceCall.toggleMute();
}

const orbStateClass = computed(() => {
  if (state.value === 'ended') return 'orb--ended';
  if (callStatus.value === 'connecting') return 'orb--connecting';
  if (muted.value) return 'orb--muted';
  if (agentSpeaking.value) return 'orb--speaking';
  return 'orb--listening';
});
</script>

<template>
  <div class="call-shell relative flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden text-white">
    <!-- Ambient backdrop -->
    <div class="bg-aurora pointer-events-none absolute inset-0" aria-hidden="true" />

    <!-- Body -->
    <main class="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-2">
      <!-- No twin: empty state -->
      <EmptyState
        v-if="!twinId"
        :icon="CallEnd01Icon"
        :title="tt('chat.call.emptyTitle', 'No AI Twin selected')"
        :description="tt('chat.call.emptyBody', 'Open an AI Twin to start a voice call.')"
      >
        <BaseButton variant="primary" @click="router.push({ name: 'ai-twins' })">
          {{ tt('chat.call.emptyCta', 'Browse AI Twins') }}
        </BaseButton>
      </EmptyState>

      <!-- Idle call shell (UI only — voice API not yet wired) -->
      <template v-else-if="twin">
        <div :class="['orb', orbStateClass]" aria-hidden="true">
          <span class="orb__ring orb__ring--1" />
          <span class="orb__ring orb__ring--2" />
          <span class="orb__ring orb__ring--3" />
          <div class="orb__core">
            <BaseAvatar
              :src="twin.profilePicUrl ?? ''"
              :name="twin.name"
              size="xl"
            />
          </div>
        </div>

        <p class="mt-8 text-headline tracking-wide text-white">{{ statusLabel }}</p>
      </template>
    </main>

    <!-- Controls -->
    <footer
      v-if="twinId && state !== 'ended'"
      class="relative z-10 flex items-center justify-center gap-4 px-6 pb-10 pt-6"
    >
      <button
        type="button"
        :class="[
          'control',
          muted ? 'control--active' : 'control--neutral',
        ]"
        :aria-label="muted ? c.unmute : c.mute"
        :title="muted ? c.unmute : c.mute"
        @click="toggleMute"
      >
        <Icon :icon="muted ? MicOff01Icon : Mic01Icon" :size="26" />
      </button>

      <button
        type="button"
        class="control control--end"
        :aria-label="c.endCall"
        :title="c.endCall"
        @click="endCall"
      >
        <Icon :icon="CallEnd01Icon" :size="32" />
      </button>

    </footer>
  </div>
</template>

<style scoped>
.call-shell {
  background:
    radial-gradient(1200px 700px at 20% 0%, rgba(0, 115, 185, 0.35), transparent 60%),
    radial-gradient(1000px 600px at 80% 100%, rgba(0, 82, 128, 0.55), transparent 60%),
    linear-gradient(160deg, #002b44 0%, #001f33 60%, #000d1a 100%);
}

.bg-aurora {
  background:
    radial-gradient(800px 500px at 50% 30%, rgba(99, 179, 237, 0.18), transparent 70%),
    radial-gradient(500px 400px at 50% 80%, rgba(0, 115, 185, 0.18), transparent 70%);
  filter: blur(20px);
  opacity: 0.9;
  animation: aurora 8s ease-in-out infinite alternate;
}
@keyframes aurora {
  0% { transform: translate3d(0, -10px, 0) scale(1); }
  100% { transform: translate3d(0, 10px, 0) scale(1.04); }
}

/* ===== Orb ===== */
.orb {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 240px;
  height: 240px;
}
.orb__core {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 160px;
  height: 160px;
  border-radius: 9999px;
  background:
    radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0) 60%),
    linear-gradient(180deg, #0073b9 0%, #003e62 100%);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.25),
    0 20px 60px -10px rgba(0, 115, 185, 0.55),
    0 0 80px rgba(0, 115, 185, 0.35);
  transition: transform 0.6s ease, box-shadow 0.6s ease;
}
.orb__ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  opacity: 0;
}

.orb--connecting .orb__core {
  animation: orb-breathe 1.4s ease-in-out infinite;
}
.orb--listening .orb__core {
  animation: orb-breathe 3s ease-in-out infinite;
}
.orb--speaking .orb__core {
  animation: orb-breathe 0.9s ease-in-out infinite;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.35),
    0 20px 80px -10px rgba(0, 115, 185, 0.7),
    0 0 120px rgba(99, 179, 237, 0.5);
}
.orb--muted .orb__core {
  filter: saturate(0.4);
}

.orb--listening .orb__ring,
.orb--speaking .orb__ring,
.orb--connecting .orb__ring {
  animation: orb-pulse 2.4s ease-out infinite;
}
.orb--speaking .orb__ring { animation-duration: 1.4s; }
.orb--connecting .orb__ring { animation-duration: 1.6s; }

.orb__ring--1 { animation-delay: 0s !important; }
.orb__ring--2 { animation-delay: 0.5s !important; }
.orb__ring--3 { animation-delay: 1s !important; }

@keyframes orb-pulse {
  0%   { transform: scale(0.8); opacity: 0.6; }
  100% { transform: scale(1.6); opacity: 0; }
}
@keyframes orb-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}

/* ===== Visualizer ===== */
.visualizer {
  display: inline-flex;
  align-items: end;
  gap: 4px;
  height: 24px;
}
.visualizer span {
  display: inline-block;
  width: 3px;
  height: 8px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.85);
  animation: vis-bounce 0.9s ease-in-out infinite;
}
@keyframes vis-bounce {
  0%, 100% { height: 6px; opacity: 0.55; }
  50%      { height: 22px; opacity: 1; }
}

/* ===== Captions ===== */
.caption {
  width: 100%;
  border-radius: 1rem;
  padding: 0.875rem 1rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}
.caption__label {
  display: block;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0.25rem;
}
.caption p {
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.5;
}
.caption--user {
  background: rgba(0, 115, 185, 0.22);
  border-color: rgba(99, 179, 237, 0.3);
}
.caret {
  display: inline-block;
  width: 8px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -2px;
  background: currentColor;
  opacity: 0.7;
  animation: caret-blink 0.9s steps(2) infinite;
}
@keyframes caret-blink {
  0%, 100% { opacity: 0.1; }
  50%      { opacity: 0.9; }
}

/* ===== Controls ===== */
.control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 9999px;
  color: white;
  transition: transform 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
  outline: none;
}
.control:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 3px;
}
.control:hover { transform: translateY(-1px); }
.control--neutral {
  background: rgba(255, 255, 255, 0.12);
}
.control--neutral:hover { background: rgba(255, 255, 255, 0.18); }
.control--active {
  background: rgba(255, 255, 255, 0.95);
  color: #002b44;
}
.control--end {
  width: 76px;
  height: 76px;
  background: #dc2626;
  box-shadow: 0 12px 32px -8px rgba(220, 38, 38, 0.6);
}
.control--end:hover { background: #b91c1c; }
</style>
