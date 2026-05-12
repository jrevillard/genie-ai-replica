<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  BirthdayCakeIcon,
  BubbleChatIcon,
  CalendarAdd01Icon,
  CallIcon,
  CheckmarkCircle02Icon,
  Login03Icon,
  WhatsappIcon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import Icon from '../ui/Icon.vue';
import type { Patient } from '../../services/patients';
import { formatRelative, type RelativeStrings } from '../../lib/analytics';
import { useT } from '../../i18n/composables';

const { t } = useT();
const { locale } = useI18n();

const props = defineProps<{ patient: Patient }>();
const router = useRouter();

const fullName = computed(
  () => props.patient.personalIdentification?.fullName?.trim() || props.patient.email
);

const dateOnlyFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
);

function formatDateOnly(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateOnlyFormatter.value.format(d);
}

const relativeStrings = computed<RelativeStrings>(() => ({
  justNow: t('analytics.relative.justNow', 'just now'),
  minutesAgo: (n) => t('analytics.relative.minutesAgo', { n }, '{n} min ago'),
  hoursAgo: (n) => t('analytics.relative.hoursAgo', { n }, '{n} hr ago'),
  daysAgo: (n) => t('analytics.relative.daysAgo', { n }, '{n} days ago'),
  weeksAgo: (n) => t('analytics.relative.weeksAgo', { n }, '{n} weeks ago'),
  monthsAgo: (n) => t('analytics.relative.monthsAgo', { n }, '{n} months ago'),
  yearsAgo: (n) => t('analytics.relative.yearsAgo', { n }, '{n} years ago'),
  never: t('patients.list.card.neverActive', 'No activity yet'),
}));

const lastActiveLabel = computed(() =>
  formatRelative(props.patient.lastActivityAt, relativeStrings.value)
);

// When activity exists, prefix with "Last active …" so the pill self-explains.
// The "never" case already reads as a full sentence ("No activity yet"), so we
// skip the prefix to avoid "Last active No activity yet".
const lastActiveDisplay = computed(() => {
  if (!props.patient.lastActivityAt) return lastActiveLabel.value;
  return t(
    'patients.list.card.lastActiveWithTime',
    { time: lastActiveLabel.value },
    'Last active {time}'
  );
});

// "Active" = activity within the last 14 days. Tunes the dot color so admins
// can scan the list and find stale users at a glance.
const isActive = computed(() => {
  const iso = props.patient.lastActivityAt;
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms < 14 * 24 * 60 * 60 * 1000;
});

const numChats = computed(() => props.patient.numChats ?? 0);
const numCalls = computed(() => props.patient.numCalls ?? 0);
const numWhatsapp = computed(() => props.patient.numWhatsappChats ?? 0);
const totalSessions = computed(() => props.patient.totalSessions ?? 0);

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value));
function formatStat(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return numberFormatter.value.format(n);
}

const dob = computed(() => formatDateOnly(props.patient.personalIdentification?.dob));
const dateCreated = computed(() => formatDateOnly(props.patient.createdAt));
const hasDob = computed(() => !!props.patient.personalIdentification?.dob);

function open() {
  router.push({ name: 'patient-detail', params: { id: props.patient._key } });
}
</script>

<template>
  <article
    class="patient-card group relative flex flex-col gap-5 overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/40 p-5 shadow-card-soft transition-shadow duration-300 hover:shadow-card-hover"
  >
    <!-- Subtle always-on hairline accent at the top edge — premium without
         being noisy. No hover animation. -->
    <span
      class="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-ieee-500/30 to-transparent"
      aria-hidden="true"
    />

    <header class="flex items-start gap-3">
      <BaseAvatar
        :name="fullName"
        size="lg"
        :badge="isActive ? 'online' : 'offline'"
      />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 class="truncate text-[15px] font-semibold tracking-tight text-slate-900">
            {{ fullName }}
          </h3>
          <span
            v-if="patient.emailVerified"
            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success ring-1 ring-inset ring-success/15"
            :title="t('patients.list.card.emailVerifiedTooltip', 'This user has confirmed their email address')"
          >
            <Icon :icon="CheckmarkCircle02Icon" :size="11" />
            {{ t('patients.list.card.emailVerified', 'Verified') }}
          </span>
          <span
            v-else
            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning ring-1 ring-inset ring-warning/15"
            :title="t('patients.list.card.emailUnverifiedTooltip', `This user hasn't confirmed their email yet`)"
          >
            <Icon :icon="AlertCircleIcon" :size="11" />
            {{ t('patients.list.card.emailUnverified', 'Unverified') }}
          </span>
        </div>
        <p class="mt-0.5 truncate text-xs text-slate-500">{{ patient.email }}</p>
      </div>
      <span
        :class="[
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap',
          isActive
            ? 'bg-emerald-50/80 text-emerald-700 ring-emerald-500/15'
            : 'bg-slate-100/80 text-slate-500 ring-slate-300/40',
        ]"
      >
        <span
          :class="[
            'inline-block h-1.5 w-1.5 rounded-full',
            isActive ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]' : 'bg-slate-400',
          ]"
          aria-hidden="true"
        />
        {{ lastActiveDisplay }}
      </span>
    </header>

    <!-- Engagement stats — the most-important new data, given premium tile
         treatment: subtle gradient, ring border, top icon + big number, label
         below. Slight lift on hover gives an interactive feel. -->
    <div class="grid grid-cols-3 gap-2.5">
      <div class="stat-tile from-rose-50/80 to-white">
        <div class="flex items-center justify-between">
          <span class="stat-icon bg-white text-rose-500 ring-rose-100">
            <Icon :icon="BubbleChatIcon" :size="14" />
          </span>
          <span class="stat-value" :title="String(numChats)">{{ formatStat(numChats) }}</span>
        </div>
        <p class="stat-label">{{ t('patients.list.card.chats', 'Chats') }}</p>
      </div>
      <div class="stat-tile from-emerald-50/80 to-white">
        <div class="flex items-center justify-between">
          <span class="stat-icon bg-white text-emerald-500 ring-emerald-100">
            <Icon :icon="WhatsappIcon" :size="14" />
          </span>
          <span class="stat-value" :title="String(numWhatsapp)">{{ formatStat(numWhatsapp) }}</span>
        </div>
        <p class="stat-label">{{ t('patients.list.card.whatsapp', 'WhatsApp') }}</p>
      </div>
      <div class="stat-tile from-ieee-50/80 to-white">
        <div class="flex items-center justify-between">
          <span class="stat-icon bg-white text-ieee-600 ring-ieee-100">
            <Icon :icon="CallIcon" :size="14" />
          </span>
          <span class="stat-value" :title="String(numCalls)">{{ formatStat(numCalls) }}</span>
        </div>
        <p class="stat-label">{{ t('patients.list.card.calls', 'Calls') }}</p>
      </div>
    </div>

    <!-- Metadata strip — single line of secondary facts, paired with icons.
         Hairline divider above and below the action row keeps it visually
         anchored without competing with the stats. -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
      <span class="inline-flex items-center gap-1.5">
        <Icon :icon="Login03Icon" :size="12" class="text-slate-400" />
        <span class="text-slate-400">{{ t('patients.list.card.sessions', 'Sessions') }}</span>
        <span class="font-semibold tabular-nums text-slate-700">{{ formatStat(totalSessions) }}</span>
      </span>
      <span class="inline-flex items-center gap-1.5" v-if="hasDob">
        <Icon :icon="BirthdayCakeIcon" :size="12" class="text-slate-400" />
        <span class="text-slate-400">{{ t('patients.list.card.born', 'Born') }}</span>
        <span class="font-semibold text-slate-700">{{ dob }}</span>
      </span>
      <span class="inline-flex items-center gap-1.5">
        <Icon :icon="CalendarAdd01Icon" :size="12" class="text-slate-400" />
        <span class="text-slate-400">{{ t('patients.list.card.joined', 'Joined') }}</span>
        <span class="font-semibold text-slate-700">{{ dateCreated }}</span>
      </span>
    </div>

    <div class="flex justify-end">
      <button
        type="button"
        :aria-label="t('patients.list.card.openAria', { name: fullName }, `Open {name}'s profile`)"
        class="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ieee-700 px-6 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-ieee-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ieee-700"
        @click="open"
      >
        {{ t('patients.list.card.view', 'View User') }}
        <Icon :icon="ArrowRight01Icon" :size="16" />
      </button>
    </div>
  </article>
</template>

<style scoped>
.shadow-card-soft {
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 4px 16px rgba(15, 23, 42, 0.04);
}
.shadow-card-hover {
  box-shadow:
    0 4px 8px rgba(15, 23, 42, 0.06),
    0 16px 36px rgba(15, 23, 42, 0.08);
}

.stat-tile {
  @apply relative flex flex-col gap-2 rounded-2xl bg-gradient-to-br p-3 ring-1 ring-slate-200/60;
}
.stat-tile::after {
  /* Soft top-edge highlight for a glassy feel. */
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.6), transparent 40%);
  pointer-events: none;
}
.stat-icon {
  @apply inline-flex h-7 w-7 items-center justify-center rounded-xl ring-1 ring-inset shadow-sm;
}
.stat-value {
  @apply text-xl font-bold leading-none tabular-nums tracking-tight text-slate-900;
}
.stat-label {
  @apply text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500;
}
</style>
