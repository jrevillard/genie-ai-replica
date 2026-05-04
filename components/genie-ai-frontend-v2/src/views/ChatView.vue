<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  ArrowLeft01Icon,
  BloodPressureIcon,
  BubbleChatIcon,
  CallIcon,
  Copy01Icon,
  Mic01Icon,
  PlateIcon,
  RefreshIcon,
  SentIcon,
  StethoscopeIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  WellnessIcon,
} from '@hugeicons/core-free-icons';

import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import { CHAT_LANGS, chatStrings, type ChatLang } from '../lib/chatStrings';
import { notify } from '../lib/notify';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useChatStore, type ChatMessage } from '../stores/chat';

const route = useRoute();
const router = useRouter();

const aiTwinsStore = useAiTwinsStore();
const chatStore = useChatStore();
const { current: twin } = storeToRefs(aiTwinsStore);
const { messages, sending, lang } = storeToRefs(chatStore);

// Single English source — the API will return localised strings later.
const t = chatStrings;

const twinId = computed(() => {
  const raw = route.params.twinId;
  return Array.isArray(raw) ? raw[0] : (raw ?? '');
});

const draft = ref('');
const composer = ref<HTMLTextAreaElement | null>(null);
const messagesEnd = ref<HTMLDivElement | null>(null);
const langOpen = ref(false);
const langButton = ref<HTMLButtonElement | null>(null);

const suggestionIcons = [
  BloodPressureIcon,
  PlateIcon,
  StethoscopeIcon,
  WellnessIcon,
];

async function loadTwin(): Promise<void> {
  if (!twinId.value) return;
  chatStore.setTwinContext(twinId.value);
  try {
    await aiTwinsStore.fetchOne(twinId.value);
  } catch {
    // store.error renders into the empty fallback below.
  }
}

onMounted(loadTwin);
watch(twinId, loadTwin);

function autoSize(): void {
  const el = composer.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
}

watch(draft, () => nextTick(autoSize));

function scrollToBottom(): void {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
}

watch(
  () => messages.value.length,
  () => scrollToBottom()
);

watch(
  () => messages.value.map((m) => m.text).join('|'),
  () => scrollToBottom()
);

async function send(text?: string): Promise<void> {
  const value = (text ?? draft.value).trim();
  if (!value || sending.value) return;
  draft.value = '';
  await nextTick(autoSize);
  await chatStore.sendMessage(value);
}

function onComposerKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

function newConversation(): void {
  chatStore.resetConversation();
  draft.value = '';
  nextTick(() => composer.value?.focus());
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push({ name: 'ai-twins' });
  }
}

async function copyMessage(m: ChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(m.text);
    notify.success(t.copied);
  } catch {
    notify.error('Copy failed');
  }
}

function regenerate(): void {
  void chatStore.regenerateLast();
}

function micPlaceholder(): void {
  notify.info(t.micSoon);
}

function startVoiceCall(): void {
  if (!twinId.value) return;
  const href = router.resolve({
    name: 'call',
    params: { twinId: twinId.value },
  }).href;
  window.open(href, '_blank', 'noopener');
}

function setLanguage(next: ChatLang): void {
  chatStore.setLanguage(next);
  langOpen.value = false;
}

function onLangButtonBlur(e: FocusEvent): void {
  // Close the popover if focus moves outside the trigger + popover.
  const next = e.relatedTarget as Node | null;
  const root = (e.currentTarget as HTMLElement).closest('[data-lang-root]');
  if (!root || !next || !root.contains(next)) {
    langOpen.value = false;
  }
}

function onDocumentClick(e: MouseEvent): void {
  if (!langOpen.value) return;
  const root = (e.target as Element)?.closest('[data-lang-root]');
  if (!root) langOpen.value = false;
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  autoSize();
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
});

const currentLang = computed(
  () => CHAT_LANGS.find((l) => l.code === lang.value) ?? CHAT_LANGS[0]
);

interface Group {
  label: string;
  items: ChatMessage[];
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return t.today;
  if (sameDay(d, yesterday)) return t.yesterday;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const groupedMessages = computed<Group[]>(() => {
  const groups: Group[] = [];
  for (const m of messages.value) {
    const label = dayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(m);
    } else {
      groups.push({ label, items: [m] });
    }
  }
  return groups;
});

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div class="chat-shell flex h-[100dvh] min-h-0 w-full flex-col bg-surface">
    <section class="flex h-full min-h-0 flex-col bg-surface">
      <!-- Top bar -->
      <header
        class="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface px-6 py-4"
      >
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-full bg-surface-muted p-2 text-text-muted transition hover:bg-surface-subtle hover:text-text"
            aria-label="Go back"
            @click="goBack"
          >
            <Icon :icon="ArrowLeft01Icon" :size="18" />
          </button>
          <template v-if="twin">
            <BaseAvatar
              :src="twin.profilePicUrl ?? ''"
              :name="twin.name"
              size="md"
              badge="online"
            />
            <div class="min-w-0">
              <p class="truncate text-title text-text">{{ twin.name }}</p>
              <p class="truncate text-meta text-text-muted">
                {{ t.subgreeting.split('.')[0] }}
              </p>
            </div>
          </template>
          <template v-else>
            <p class="text-title text-text">Chat</p>
          </template>
        </div>

        <div class="flex items-center gap-2">
          <!-- Language switcher -->
          <div class="relative" data-lang-root>
            <button
              ref="langButton"
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-body font-medium text-text transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              :aria-label="t.langLabel"
              :aria-expanded="langOpen"
              aria-haspopup="listbox"
              @click="langOpen = !langOpen"
              @blur="onLangButtonBlur"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
              </svg>
              <span class="uppercase">{{ currentLang.code }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3 transition-transform" :class="langOpen && 'rotate-180'" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <ul
              v-if="langOpen"
              role="listbox"
              class="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
            >
              <li v-for="opt in CHAT_LANGS" :key="opt.code" role="option" :aria-selected="opt.code === lang">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                  @click="setLanguage(opt.code)"
                >
                  <span class="font-medium">{{ opt.label }}</span>
                  <span class="rounded-md bg-ieee-50 px-2 py-0.5 text-[11px] font-semibold text-ieee-700">
                    {{ opt.code }}
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <BaseButton
            v-if="twin"
            variant="outline"
            size="md"
            rounded="full"
            @click="newConversation"
          >
            <Icon :icon="BubbleChatIcon" :size="16" />
            {{ t.newChat }}
          </BaseButton>

          <button
            v-if="twin"
            type="button"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-inverse text-text-inverse transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            :aria-label="t.call.startCall"
            :title="t.call.startCall"
            @click="startVoiceCall"
          >
            <Icon :icon="CallIcon" :size="18" />
          </button>
        </div>
      </header>

      <!-- Body -->
      <div class="flex min-h-0 flex-1 flex-col">
        <!-- No twin selected -->
        <EmptyState
          v-if="!twinId"
          :icon="BubbleChatIcon"
          :title="t.pickTwinTitle"
          :description="t.pickTwinDescription"
        >
          <BaseButton variant="primary" @click="router.push({ name: 'ai-twins' })">
            {{ t.pickTwinAction }}
          </BaseButton>
        </EmptyState>

        <!-- Empty hero (twin loaded, no messages) -->
        <div
          v-else-if="twin && messages.length === 0"
          class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center"
        >
          <h1 class="text-display text-text">{{ t.greeting }}</h1>
          <p class="mt-2 max-w-xl text-lead text-text-muted">{{ t.subgreeting }}</p>

          <p class="mt-8 text-meta uppercase tracking-wide text-text-subtle">
            {{ t.suggestionsTitle }}
          </p>
          <div class="mt-3 grid w-full max-w-3xl gap-3 sm:grid-cols-2">
            <button
              v-for="(card, idx) in t.suggestionCards"
              :key="card.topic"
              type="button"
              :disabled="sending"
              class="group flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-accent/40 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
              @click="send(card.prompt)"
            >
              <span
                class="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent transition group-hover:bg-accent group-hover:text-text-inverse"
              >
                <Icon :icon="suggestionIcons[idx]" :size="22" />
              </span>
              <span class="min-w-0">
                <span class="block text-body font-semibold text-text">{{ card.topic }}</span>
                <span class="mt-0.5 block text-meta text-text-muted">{{ card.prompt }}</span>
              </span>
            </button>
          </div>
        </div>

        <!-- Active conversation -->
        <div
          v-else-if="twin"
          class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 scrollbar-thin"
        >
          <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
            <template v-for="group in groupedMessages" :key="group.label">
              <div class="flex items-center justify-center">
                <span
                  class="rounded-full bg-surface-muted px-3 py-1 text-meta font-medium text-text-muted"
                >
                  {{ group.label }}
                </span>
              </div>
              <div
                v-for="m in group.items"
                :key="m.id"
                :class="[
                  'flex gap-3',
                  m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                ]"
              >
                <BaseAvatar
                  v-if="m.role === 'assistant'"
                  :src="twin.profilePicUrl ?? ''"
                  :name="twin.name"
                  size="sm"
                />
                <div
                  :class="[
                    'group flex max-w-[80%] flex-col',
                    m.role === 'user' ? 'items-end' : 'items-start',
                  ]"
                >
                  <div
                    :class="[
                      'rounded-2xl px-5 py-3 text-body shadow-card',
                      m.role === 'user'
                        ? 'bg-accent text-text-inverse'
                        : 'bg-surface-muted text-text',
                    ]"
                  >
                    <span v-if="m.streaming && !m.text" class="inline-flex items-center gap-1">
                      <span class="dot" />
                      <span class="dot" style="animation-delay: 0.15s" />
                      <span class="dot" style="animation-delay: 0.3s" />
                    </span>
                    <p v-else class="whitespace-pre-wrap leading-relaxed">{{ m.text }}</p>
                  </div>
                  <div
                    :class="[
                      'mt-1 flex items-center gap-1 text-meta text-text-subtle',
                      m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                    ]"
                  >
                    <span>{{ formatTime(m.createdAt) }}</span>
                    <template v-if="m.role === 'assistant' && !m.streaming">
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        class="rounded p-1 text-text-subtle opacity-0 transition hover:bg-surface-muted hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                        :aria-label="t.copy"
                        :title="t.copy"
                        @click="copyMessage(m)"
                      >
                        <Icon :icon="Copy01Icon" :size="14" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1 text-text-subtle opacity-0 transition hover:bg-surface-muted hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                        :aria-label="t.regenerate"
                        :title="t.regenerate"
                        @click="regenerate"
                      >
                        <Icon :icon="RefreshIcon" :size="14" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1 text-text-subtle opacity-0 transition hover:bg-surface-muted hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                        :aria-label="t.helpful"
                        :title="t.helpful"
                      >
                        <Icon :icon="ThumbsUpIcon" :size="14" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1 text-text-subtle opacity-0 transition hover:bg-surface-muted hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                        :aria-label="t.notHelpful"
                        :title="t.notHelpful"
                      >
                        <Icon :icon="ThumbsDownIcon" :size="14" />
                      </button>
                    </template>
                  </div>
                </div>
              </div>
            </template>
            <div ref="messagesEnd" />
          </div>
        </div>
      </div>

      <!-- Composer -->
      <footer
        v-if="twinId"
        class="border-t border-border-subtle bg-surface px-6 py-4"
      >
        <div class="mx-auto w-full max-w-3xl">
          <div
            class="flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-card transition focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20"
          >
            <textarea
              ref="composer"
              v-model="draft"
              rows="1"
              :placeholder="t.placeholder"
              :disabled="sending"
              class="composer-input flex-1 resize-none bg-transparent px-2 py-2 text-body leading-6 text-text outline-none placeholder:text-text-subtle disabled:cursor-not-allowed"
              @keydown="onComposerKeydown"
              @input="autoSize"
            />
            <button
              type="button"
              class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-muted hover:text-text"
              :aria-label="t.micAria"
              :title="t.micAria"
              :disabled="sending"
              @click="micPlaceholder"
            >
              <Icon :icon="Mic01Icon" :size="22" />
            </button>
            <button
              type="button"
              class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-text-inverse transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
              :aria-label="t.sendAria"
              :title="t.sendAria"
              :disabled="!draft.trim() || sending"
              @click="send()"
            >
              <Icon :icon="SentIcon" :size="20" />
            </button>
          </div>
          <p class="mt-2 text-center text-caption text-text-subtle">
            {{ t.disclaimer }}
          </p>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.composer-input {
  max-height: 12rem;
}
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: currentColor;
  opacity: 0.55;
  animation: pulse-dot 1.1s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 80%, 100% {
    transform: scale(0.7);
    opacity: 0.35;
  }
  40% {
    transform: scale(1);
    opacity: 0.95;
  }
}
</style>
