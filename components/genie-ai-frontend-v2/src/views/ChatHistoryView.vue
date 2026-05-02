<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Attachment01Icon,
  CallIcon,
  Calendar03Icon,
  Download04Icon,
  FilterHorizontalIcon,
  MoreVerticalIcon,
  PlayIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';

type Conversation = {
  id: number;
  name: string;
  role: string;
  preview: string;
  date: string;
  active?: boolean;
};

type Message = {
  id: number;
  side: 'inbound' | 'outbound';
  text?: string;
  audio?: boolean;
  time?: string;
  compact?: boolean;
};

type CallRecord = {
  id: number;
  aiTwin: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: string;
  callerName: string;
};

const conversations: Conversation[] = [
  { id: 1, name: 'Felecia Rower', role: 'UI Designer', preview: 'I will purchase it for sure.', date: 'Apr 10', active: true },
  { id: 2, name: 'Adalberto Granzin', role: 'UI/UX Designer', preview: 'Shared design notes', date: 'Apr 8' },
  { id: 3, name: 'Zenia Jacobs', role: 'Building surveyor', preview: 'Asked for a product deck', date: 'Jan 16' },
  { id: 4, name: 'Heather Gislason', role: 'UI Designer', preview: 'Requested more examples', date: 'Jan 20' },
  { id: 5, name: 'Rosemary Hettinger', role: 'Direct Mobility Manager', preview: 'Call follow-up required', date: 'Jan 22' },
  { id: 6, name: 'Adalberto Granzin', role: 'UI/UX Designer', preview: 'Wants pricing details', date: 'Apr 8' },
  { id: 7, name: 'Zenia Jacobs', role: 'Building surveyor', preview: 'Reviewing template', date: 'Jan 16' },
  { id: 8, name: 'Heather Gislason', role: 'UI Designer', preview: 'Needs MUI support', date: 'Jan 20' },
  { id: 9, name: 'Rosemary Hettinger', role: 'Direct Mobility Manager', preview: 'Final approval pending', date: 'Jan 22' },
];

const messages: Message[] = [
  { id: 1, side: 'outbound', text: "How can we help? We're here for you!", time: '1:15 PM', compact: true },
  {
    id: 2,
    side: 'inbound',
    text: 'Hey John, I am looking for the best admin template. Could you please help me to find it out?',
    audio: true,
    time: '1:15 PM',
  },
  { id: 3, side: 'inbound', text: 'It should be MUI v5 compatible.', audio: true, compact: true },
  { id: 4, side: 'outbound', text: 'Absolutely!', compact: true },
  { id: 5, side: 'outbound', text: 'This admin template is built with MUI!', time: '1:16 PM', compact: true },
  { id: 6, side: 'inbound', text: 'Looks clean and fresh UI.', audio: true },
  { id: 7, side: 'inbound', text: "It's perfect for my next project.", compact: true },
];

const dateOptions = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'Last month', 'Custom Date'];
const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const leftCalendar = [28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const rightCalendar = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const waveformBars = [18, 28, 36, 26, 44, 32, 40, 30, 48, 34, 24, 42, 30, 38, 22, 46, 36, 26, 40, 30, 34, 22, 28, 18];
const detailWaveformBars = [54, 72, 88, 64, 92, 46, 76, 82, 60, 78, 70, 92, 98, 74, 50, 66, 86, 44, 72, 82, 58, 74, 88, 54, 68, 38, 82, 76, 90, 48, 72, 60, 80, 44, 76, 62, 88, 54, 74, 92, 46, 66, 84, 58, 78, 52, 90, 64];

const callRecords: CallRecord[] = [
  { id: 1, aiTwin: 'John Doe', date: 'Jan 6, 2025', startTime: 'Jan 4, 2025', endTime: 'Jan 4, 2025', duration: '2h', callerName: 'Olivia Rhye' },
  { id: 2, aiTwin: 'John Doe', date: 'Jan 6, 2025', startTime: 'Jan 4, 2025', endTime: 'Jan 4, 2025', duration: '2h', callerName: 'Phoenix Baker' },
  { id: 3, aiTwin: 'John Doe', date: 'Jan 6, 2025', startTime: 'Jan 2, 2025', endTime: 'Jan 2, 2025', duration: '2h', callerName: 'Lana Steiner' },
  { id: 4, aiTwin: 'John Doe', date: 'Jan 6, 2025', startTime: 'Jan 6, 2025', endTime: 'Jan 6, 2025', duration: '2h', callerName: 'Demi Wilkinson' },
  { id: 5, aiTwin: 'John Doe', date: 'Jan 6, 2025', startTime: 'Jan 8, 2025', endTime: 'Jan 8, 2025', duration: '2h', callerName: 'Candice Wu' },
  { id: 6, aiTwin: 'John Doe', date: 'Jan 6, 2025', startTime: 'Jan 6, 2025', endTime: 'Jan 6, 2025', duration: '2h', callerName: 'Natali Craig' },
  { id: 7, aiTwin: 'John Doe', date: 'Jan 6, 2025', startTime: 'Jan 4, 2025', endTime: 'Jan 4, 2025', duration: '2h', callerName: 'Drew Cano' },
];

const activeTab = ref<'Chats' | 'Calls'>('Chats');
const selectedDate = ref('Today');
const dateMenuOpen = ref(false);
const sortMenuOpen = ref(false);
const filterPanelOpen = ref(false);
const callDetailOpen = ref(false);
const deleteDialogOpen = ref(false);
const detailMode = ref<'transcript' | 'summary'>('transcript');

const selectedConversation = computed(() => conversations.find((item) => item.active) ?? conversations[0]);
const showCalendar = computed(() => selectedDate.value === 'Custom Date');

function chooseDate(option: string) {
  selectedDate.value = option;
}

function openCallDetails(mode: 'transcript' | 'summary') {
  detailMode.value = mode;
  callDetailOpen.value = true;
}
</script>

<template>
  <DashboardLayout>
    <section class="h-full min-h-0 bg-white p-4 md:p-6">
      <div class="flex h-full min-h-[760px] flex-col gap-4 lg:min-h-[640px]">
        <header class="flex flex-col gap-4">
          <h1 class="text-lg font-bold text-slate-900">Chat/Call History</h1>
          <div class="inline-flex w-fit gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="History type">
            <button
              v-for="tab in ['Chats', 'Calls']"
              :key="tab"
              type="button"
              :class="[
                'rounded-md px-3 py-2 text-xs font-semibold text-slate-400 transition',
                activeTab === tab && 'bg-white text-slate-700 shadow-sm',
              ]"
              @click="activeTab = tab as 'Chats' | 'Calls'"
            >
              {{ tab }}
            </button>
          </div>
        </header>

        <div v-if="activeTab === 'Chats'" class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:grid-cols-[minmax(250px,330px)_minmax(0,1fr)]">
          <aside class="relative z-10 flex max-h-[330px] min-h-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:border-b-0 lg:border-r">
            <div class="relative z-20 grid grid-cols-[1fr_1fr_36px] gap-2 border-b border-slate-100 px-3 py-4">
              <button
                type="button"
                class="flex h-9 items-center justify-between gap-2 rounded-full border border-neutral-200 bg-white px-3 text-xs text-neutral-500 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950"
                @click="dateMenuOpen = !dateMenuOpen"
              >
                <span>AI Twin</span>
                <Icon :icon="ArrowDown01Icon" :size="14" />
              </button>
              <div class="relative">
                <button
                  type="button"
                  class="flex h-9 w-full items-center justify-between gap-2 rounded-full border border-neutral-200 bg-white px-3 text-xs text-neutral-500 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950"
                  @click="sortMenuOpen = !sortMenuOpen"
                >
                  <span>Sort By</span>
                  <Icon :icon="ArrowDown01Icon" :size="14" />
                </button>
                <div v-if="sortMenuOpen" class="absolute right-0 top-11 z-30 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  <button type="button" class="block w-full rounded-md px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900">Newest first</button>
                  <button type="button" class="block w-full rounded-md px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900">Unread first</button>
                  <button type="button" class="block w-full rounded-md px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900">Longest calls</button>
                </div>
              </div>
              <button
                type="button"
                class="grid h-9 place-items-center rounded-full border border-neutral-200 bg-white text-ieee-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"
                aria-label="Open filters"
                @click="filterPanelOpen = !filterPanelOpen"
              >
                <Icon :icon="FilterHorizontalIcon" :size="18" />
              </button>

              <div v-if="dateMenuOpen" class="absolute left-3 top-[58px] z-40 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                <button
                  v-for="option in dateOptions"
                  :key="option"
                  type="button"
                  :class="[
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-500',
                    selectedDate === option && 'bg-ieee-50 text-ieee-800',
                  ]"
                  @click="chooseDate(option)"
                >
                  <span
                    :class="[
                      'h-3 w-3 rounded-full border border-slate-400',
                      selectedDate === option && 'border-[3.5px] border-ieee-700',
                    ]"
                  />
                  <span>{{ option }}</span>
                </button>
              </div>

              <div
                v-if="dateMenuOpen && showCalendar"
                class="absolute left-3 top-[330px] z-50 w-[calc(100vw-4rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl sm:w-[520px] lg:left-[225px] lg:top-[58px]"
              >
                <div class="mb-3 grid grid-cols-[28px_1fr_28px] items-center gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-[28px_1fr_1fr_28px]">
                  <button type="button" class="grid h-7 place-items-center rounded-md hover:bg-slate-100" aria-label="Previous month">
                    <Icon :icon="ArrowLeft01Icon" :size="16" />
                  </button>
                  <span>December 2021</span>
                  <span class="hidden sm:block">December 2021</span>
                  <button type="button" class="grid h-7 place-items-center rounded-md hover:bg-slate-100" aria-label="Next month">
                    <Icon :icon="ArrowRight01Icon" :size="16" />
                  </button>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="grid grid-cols-7 gap-1">
                    <span v-for="day in weekDays" :key="`l-${day}`" class="grid h-7 place-items-center text-[11px] font-bold text-slate-500">{{ day }}</span>
                    <span
                      v-for="(day, index) in leftCalendar"
                      :key="`left-${index}`"
                      :class="[
                        'grid h-7 place-items-center rounded-md text-[11px] text-slate-600',
                        index < 3 && 'text-slate-300',
                        day >= 23 && day <= 31 && 'bg-ieee-50 text-ieee-800',
                        day === 23 && 'bg-ieee-700 text-white',
                      ]"
                    >
                      {{ day }}
                    </span>
                  </div>
                  <div class="grid grid-cols-7 gap-1">
                    <span v-for="day in weekDays" :key="`r-${day}`" class="grid h-7 place-items-center text-[11px] font-bold text-slate-500">{{ day }}</span>
                    <span
                      v-for="(day, index) in rightCalendar"
                      :key="`right-${index}`"
                      :class="[
                        'grid h-7 place-items-center rounded-md text-[11px] text-slate-600',
                        day >= 5 && day <= 14 && 'bg-ieee-50 text-ieee-800',
                        day === 14 && 'bg-ieee-700 text-white',
                      ]"
                    >
                      {{ day || '' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="filterPanelOpen" class="flex gap-2 border-b border-slate-100 px-3 pb-3">
              <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                <Icon :icon="Calendar03Icon" :size="15" /> {{ selectedDate }}
              </span>
              <span class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Unread only</span>
            </div>

            <div class="min-h-0 overflow-y-auto p-2">
              <button
                v-for="item in conversations"
                :key="`${item.id}-${item.name}`"
                type="button"
                :class="[
                  'flex w-full items-center gap-2.5 rounded-lg p-2.5 transition hover:bg-ieee-50',
                  item.active && 'bg-ieee-50',
                ]"
              >
                <BaseAvatar :src="`https://i.pravatar.cc/80?img=${10 + item.id}`" :name="item.name" size="sm" />
                <span class="min-w-0 flex-1 text-left">
                  <span class="block truncate text-sm font-semibold text-slate-900">{{ item.name }}</span>
                  <span class="block truncate text-xs text-slate-500">{{ item.preview || item.role }}</span>
                </span>
                <time class="text-[11px] text-slate-400">{{ item.date }}</time>
              </button>
            </div>
          </aside>

          <article class="flex min-h-0 min-w-0 flex-col bg-white">
            <header class="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3">
              <div class="flex items-center gap-3">
                <BaseAvatar src="https://i.pravatar.cc/80?img=11" :name="selectedConversation.name" size="sm" badge="online" />
                <div>
                  <h2 class="text-sm font-bold text-slate-700">{{ selectedConversation.name }}</h2>
                  <p class="mt-0.5 text-[11px] text-slate-400">Active conversation</p>
                </div>
              </div>
              <div class="flex items-center gap-1 text-slate-500">
                <button type="button" class="grid h-9 w-9 place-items-center rounded-md transition hover:bg-white hover:text-ieee-800" aria-label="Search conversation">
                  <Icon :icon="Search01Icon" :size="19" />
                </button>
                <button type="button" class="grid h-9 w-9 place-items-center rounded-md transition hover:bg-white hover:text-ieee-800" aria-label="Conversation actions">
                  <Icon :icon="MoreVerticalIcon" :size="19" />
                </button>
              </div>
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-7">
              <div
                v-for="message in messages"
                :key="message.id"
                :class="['mb-5 flex items-start gap-2.5', message.side === 'outbound' && 'justify-end']"
              >
                <BaseAvatar v-if="message.side === 'inbound'" src="https://i.pravatar.cc/80?img=11" name="Felecia Rower" size="xs" />
                <div :class="['flex max-w-[86%] flex-col gap-1 md:max-w-[430px]', message.side === 'outbound' && 'items-end']">
                  <div
                    :class="[
                      'rounded-2xl px-3.5 py-3 text-xs leading-relaxed',
                      message.compact && 'w-fit py-2',
                      message.side === 'inbound'
                        ? 'rounded-tl-md bg-white text-slate-600 shadow-sm'
                        : 'rounded-tr-md bg-ieee-700 text-white shadow-sm',
                    ]"
                  >
                    <p v-if="message.text">{{ message.text }}</p>
                    <div v-if="message.audio" class="mt-2 flex items-center gap-2">
                      <button type="button" class="grid h-7 w-7 place-items-center rounded-full bg-ieee-700 text-white" aria-label="Play voice message">
                        <Icon :icon="PlayIcon" :size="13" />
                      </button>
                      <div class="flex h-7 w-[min(195px,40vw)] items-center gap-0.5" aria-hidden="true">
                        <span
                          v-for="(height, index) in waveformBars"
                          :key="`${message.id}-${index}`"
                          class="w-0.5 min-h-[5px] rounded-full bg-neutral-300 [background:linear-gradient(180deg,#005280_0%,#005280_36%,#d4d4d4_36%,#d4d4d4_100%)]"
                          :style="{ height: `${height}%` }"
                        />
                      </div>
                      <span class="text-[11px] text-slate-400">00:50</span>
                    </div>
                  </div>
                  <time v-if="message.time" class="text-[11px] text-slate-400">{{ message.time }}</time>
                </div>
                <BaseAvatar v-if="message.side === 'outbound'" src="https://i.pravatar.cc/80?img=32" name="John" size="xs" />
              </div>
            </div>

            <footer class="flex gap-3 border-t border-slate-200 bg-white/80 px-3 py-3 md:px-4 md:pb-4">
              <label class="flex min-w-0 flex-1 items-center gap-2.5 rounded-full bg-slate-100 px-4">
                <input type="text" placeholder="Type your message here..." class="h-11 min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400" />
                <button type="button" class="text-slate-500 hover:text-ieee-800" aria-label="Attach file">
                  <Icon :icon="Attachment01Icon" :size="18" />
                </button>
              </label>
              <button type="button" class="grid h-11 w-11 place-items-center rounded-full bg-ieee-700 text-white transition hover:bg-ieee-800" aria-label="Send message">
                <Icon :icon="ArrowRight01Icon" :size="21" />
              </button>
            </footer>
          </article>
        </div>

        <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-3">
            <button type="button" class="flex h-11 items-center justify-between rounded-full border border-neutral-200 bg-white px-4 text-sm text-slate-500 shadow-sm">
              <span>Select Date</span>
              <Icon :icon="ArrowDown01Icon" :size="15" />
            </button>
            <button type="button" class="flex h-11 items-center justify-between rounded-full border border-neutral-200 bg-white px-4 text-sm text-slate-500 shadow-sm">
              <span>Sort By</span>
              <Icon :icon="ArrowDown01Icon" :size="15" />
            </button>
            <button type="button" class="flex h-11 items-center justify-between rounded-full border border-neutral-200 bg-white px-4 text-sm text-slate-500 shadow-sm">
              <span>AI Twin</span>
              <Icon :icon="ArrowDown01Icon" :size="15" />
            </button>
          </div>

          <div class="min-h-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div class="grid grid-cols-[1.1fr_1fr_1fr_1fr_0.8fr_1.1fr_40px] border-b border-neutral-100 bg-neutral-50 px-5 py-3 text-xs font-semibold text-slate-500">
              <span>AI Twin</span>
              <span>Date</span>
              <span>Start Time</span>
              <span>End Time</span>
              <span>Duration</span>
              <span>Caller Name</span>
              <span />
            </div>
            <div class="min-h-0 divide-y divide-neutral-100 overflow-y-auto">
              <div
                v-for="record in callRecords"
                :key="record.id"
                class="grid grid-cols-[1.1fr_1fr_1fr_1fr_0.8fr_1.1fr_40px] items-center px-5 py-4 text-sm text-slate-600"
              >
                <button type="button" class="flex items-center gap-3 text-left font-semibold text-slate-900" @click="openCallDetails('transcript')">
                  <span class="grid h-6 w-6 place-items-center rounded-full bg-violet-50 text-violet-500">
                    <Icon :icon="CallIcon" :size="14" />
                  </span>
                  {{ record.aiTwin }}
                </button>
                <span>{{ record.date }}</span>
                <span>{{ record.startTime }}</span>
                <span>{{ record.endTime }}</span>
                <span>{{ record.duration }}</span>
                <button type="button" class="text-left transition hover:text-ieee-800" @click="openCallDetails('summary')">
                  {{ record.callerName }}
                </button>
                <button type="button" class="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500" aria-label="Delete call" @click="deleteDialogOpen = true">
                  <Icon :icon="MoreVerticalIcon" :size="18" />
                </button>
              </div>
            </div>
            <footer class="flex items-center justify-end gap-6 border-t border-neutral-100 px-5 py-3 text-sm text-slate-500">
              <span>Rows per page: <strong class="font-medium text-slate-700">10</strong></span>
              <span>1-5 of 13</span>
              <button type="button" class="text-slate-400 hover:text-ieee-800" aria-label="Previous page">
                <Icon :icon="ArrowLeft01Icon" :size="17" />
              </button>
              <button type="button" class="text-slate-700 hover:text-ieee-800" aria-label="Next page">
                <Icon :icon="ArrowRight01Icon" :size="17" />
              </button>
            </footer>
          </div>
        </div>
      </div>

      <Teleport to="body">
        <div v-if="callDetailOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-[#7f819f] p-6">
          <section class="relative w-full max-w-2xl rounded-xl bg-white p-4 shadow-2xl">
            <button
              type="button"
              class="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950"
              aria-label="Close call details"
              @click="callDetailOpen = false"
            >
              <span class="text-2xl leading-none">&times;</span>
            </button>
            <header>
              <h2 class="text-base font-semibold text-slate-950">Call Details</h2>
              <div class="mt-4 flex items-center gap-2">
                <div class="flex h-12 flex-1 items-center gap-1" aria-hidden="true">
                  <span
                    v-for="(height, index) in detailWaveformBars"
                    :key="index"
                    :class="['w-0.5 rounded-full', index < 18 ? 'bg-ieee-700' : 'bg-slate-300']"
                    :style="{ height: `${height}%` }"
                  />
                </div>
                <span class="text-xs text-slate-400">3:50</span>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <button type="button" class="inline-flex h-7 items-center gap-2 rounded-full bg-ieee-700 px-3 text-xs font-semibold text-white">
                  <Icon :icon="PlayIcon" :size="11" />
                  Play
                </button>
                <button type="button" class="grid h-7 w-7 place-items-center rounded-full bg-ieee-700 text-white" aria-label="Download recording">
                  <Icon :icon="Download04Icon" :size="14" />
                </button>
              </div>
            </header>

            <div class="mt-4 grid grid-cols-2 border-b border-slate-200 text-sm font-semibold">
              <button
                type="button"
                :class="['border-b-2 py-2', detailMode === 'transcript' ? 'border-ieee-700 text-slate-950' : 'border-transparent text-slate-500']"
                @click="detailMode = 'transcript'"
              >
                Transcript
              </button>
              <button
                type="button"
                :class="['border-b-2 py-2', detailMode === 'summary' ? 'border-ieee-700 text-slate-950' : 'border-transparent text-slate-500']"
                @click="detailMode = 'summary'"
              >
                Summary
              </button>
            </div>

            <div v-if="detailMode === 'transcript'" class="min-h-[260px] py-4 text-sm leading-relaxed">
              <p class="font-bold text-ieee-700">Ai Twin</p>
              <p class="mt-1 text-slate-950">Hey, how are you?</p>
              <p class="mt-3 font-bold text-ieee-700">User</p>
              <p class="mt-1 text-slate-950">I'm doing great how about you?</p>
              <p class="mt-3 font-bold text-ieee-700">Ai Twin</p>
              <p class="mt-1 text-slate-950">Great, thank you for asking.</p>
              <p class="mt-3 font-bold text-ieee-700">Ai Twin</p>
              <p class="mt-1 text-slate-950">Hey, how are you?</p>
              <p class="mt-3 font-bold text-ieee-700">User</p>
            </div>
            <div v-else class="min-h-[260px] space-y-4 py-4 text-sm leading-relaxed text-slate-950">
              <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
              </p>
              <p>
                Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
              </p>
              <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
              </p>
            </div>

          </section>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="deleteDialogOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-[#7f819f] p-6">
          <section class="relative w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <button
              type="button"
              class="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950"
              aria-label="Close delete dialog"
              @click="deleteDialogOpen = false"
            >
              <span class="text-2xl leading-none">&times;</span>
            </button>
            <h2 class="text-lg font-bold text-slate-950">Are you sure you want to delete this call recording?</h2>
            <p class="mt-4 text-sm leading-relaxed text-red-500">
              If you decide to delete, you'll lose all data related to this call. You can't recover them once deleted.
            </p>
            <footer class="mt-6 flex justify-end gap-3">
              <button type="button" class="h-10 rounded-full bg-red-500 px-5 text-sm font-semibold text-white hover:bg-red-600" @click="deleteDialogOpen = false">
                Delete
              </button>
            </footer>
          </section>
        </div>
      </Teleport>
    </section>
  </DashboardLayout>
</template>
