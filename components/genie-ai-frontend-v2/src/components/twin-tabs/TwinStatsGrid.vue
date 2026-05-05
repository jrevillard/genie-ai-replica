<script setup lang="ts">
import { computed } from 'vue';
import { BubbleChatIcon, CallIcon, WhatsappIcon } from '@hugeicons/core-free-icons';
import Icon from '../ui/Icon.vue';
import type { AiTwin } from '../../services/aiTwins';

const props = defineProps<{ twin: AiTwin }>();

interface StatCard {
  key: 'chats' | 'whatsapp' | 'calls';
  label: string;
  value: number;
  icon: unknown;
  iconBg: string;
  iconColor: string;
  accent: string;
}

function formatStat(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return new Intl.NumberFormat('en-US').format(n);
}

const stats = computed<StatCard[]>(() => [
  {
    key: 'chats',
    label: 'Number of Chats',
    value: props.twin.numChats ?? 0,
    icon: BubbleChatIcon,
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-500',
    accent: 'from-rose-400/70 to-rose-500/0',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Chats',
    value: props.twin.numWhatsappChats ?? 0,
    icon: WhatsappIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-500',
    accent: 'from-emerald-400/70 to-emerald-500/0',
  },
  {
    key: 'calls',
    label: 'Number of Calls',
    value: props.twin.numCalls ?? 0,
    icon: CallIcon,
    iconBg: 'bg-ieee-50',
    iconColor: 'text-ieee-600',
    accent: 'from-ieee-400/70 to-ieee-500/0',
  },
]);
</script>

<template>
  <section aria-label="Twin activity overview">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <article
        v-for="stat in stats"
        :key="stat.key"
        class="group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elevated"
      >
        <span
          :class="[
            'pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r opacity-70 transition-opacity duration-200 group-hover:opacity-100',
            stat.accent,
          ]"
          aria-hidden="true"
        />
        <div class="flex items-start gap-4">
          <span
            :class="[
              'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-black/[0.04]',
              stat.iconBg,
              stat.iconColor,
            ]"
            aria-hidden="true"
          >
            <Icon :icon="stat.icon" :size="22" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-body font-medium text-text-muted">{{ stat.label }}</p>
            <p
              class="mt-1 text-display font-semibold tabular-nums text-text"
              :title="String(stat.value)"
            >
              {{ formatStat(stat.value) }}
            </p>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
