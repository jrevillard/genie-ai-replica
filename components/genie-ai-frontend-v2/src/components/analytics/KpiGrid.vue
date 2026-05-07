<script setup lang="ts">
import { computed } from 'vue';
import {
  BubbleChatIcon,
  CallIcon,
  Clock01Icon,
  Message01Icon,
  Timer01Icon,
  UserAdd01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons';
import { useT } from '../../i18n/composables';
import { formatNumber, msToSeconds, secsToMinutes } from '../../lib/analytics';
import type { AnalyticsKpis } from '../../services/analytics';
import KpiCard from './KpiCard.vue';

const { t } = useT();

const props = defineProps<{ kpis: AnalyticsKpis }>();

interface KpiSpec {
  label: string;
  value: string;
  hint: string;
  icon: unknown;
  iconBg: string;
  iconColor: string;
}

const cards = computed<KpiSpec[]>(() => {
  const k = props.kpis;
  return [
    {
      label: t('analytics.kpis.totalChatSessions', 'Total Chat Sessions'),
      value: formatNumber(k.totalChatSessions),
      hint: t('analytics.kpis.sessionsUnit', 'sessions'),
      icon: BubbleChatIcon,
      iconBg: 'bg-ieee-50',
      iconColor: 'text-ieee-700',
    },
    {
      label: t('analytics.kpis.totalCalls', 'Total Calls'),
      value: formatNumber(k.totalCalls),
      hint: t('analytics.kpis.callsUnit', 'calls'),
      icon: CallIcon,
      iconBg: 'bg-rose-50',
      iconColor: 'text-rose-500',
    },
    {
      label: t('analytics.kpis.activePatients', 'Active Patients'),
      value: formatNumber(k.activePatients),
      hint: t('analytics.kpis.patientsUnit', 'patients'),
      icon: UserMultipleIcon,
      iconBg: 'bg-violet-50',
      iconColor: 'text-violet-500',
    },
    {
      label: t('analytics.kpis.newPatients', 'New Patients'),
      value: formatNumber(k.newPatients),
      hint: t('analytics.kpis.patientsThisPeriodUnit', 'this period'),
      icon: UserAdd01Icon,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-500',
    },
    {
      label: t('analytics.kpis.totalMessages', 'Messages Sent'),
      value: formatNumber(k.totalMessages),
      hint: t('analytics.kpis.messagesUnit', 'messages'),
      icon: Message01Icon,
      iconBg: 'bg-sky-50',
      iconColor: 'text-sky-500',
    },
    {
      label: t('analytics.kpis.avgResponseTime', 'Avg Response Time'),
      value: k.avgResponseTimeMs === null ? '—' : `${msToSeconds(k.avgResponseTimeMs)}s`,
      hint: t('analytics.kpis.secondsUnit', 'sec'),
      icon: Clock01Icon,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-500',
    },
    {
      label: t('analytics.kpis.avgCallDuration', 'Avg Call Duration'),
      value: k.avgCallDurationSecs === null ? '—' : `${secsToMinutes(k.avgCallDurationSecs)}m`,
      hint: t('analytics.kpis.minutesUnit', 'min'),
      icon: Timer01Icon,
      iconBg: 'bg-fuchsia-50',
      iconColor: 'text-fuchsia-500',
    },
  ];
});
</script>

<template>
  <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <KpiCard
      v-for="card in cards"
      :key="card.label"
      :label="card.label"
      :value="card.value"
      :hint="card.hint"
      :icon="card.icon"
      :icon-bg="card.iconBg"
      :icon-color="card.iconColor"
    />
  </section>
</template>
