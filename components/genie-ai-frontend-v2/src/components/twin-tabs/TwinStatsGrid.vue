<script setup lang="ts">
import { computed } from 'vue';
import { BubbleChatIcon, CallIcon, WhatsappIcon } from '@hugeicons/core-free-icons';
import Icon from '../ui/Icon.vue';
import type { AiTwin } from '../../services/aiTwins';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{ twin: AiTwin }>();

interface StatCard {
  key: 'chats' | 'whatsapp' | 'calls';
  label: string;
  value: number;
  icon: unknown;
  iconBg: string;
  iconColor: string;
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
    label: t('twins.stats.chats', 'Number of Chats'),
    value: props.twin.numChats ?? 0,
    icon: BubbleChatIcon,
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-500',
  },
  {
    key: 'whatsapp',
    label: t('twins.stats.whatsapp', 'WhatsApp Chats'),
    value: props.twin.numWhatsappChats ?? 0,
    icon: WhatsappIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-500',
  },
  {
    key: 'calls',
    label: t('twins.stats.calls', 'Number of Calls'),
    value: props.twin.numCalls ?? 0,
    icon: CallIcon,
    iconBg: 'bg-ieee-50',
    iconColor: 'text-ieee-600',
  },
]);
</script>

<template>
  <section :aria-label="t('twins.stats.ariaLabel', 'Twin activity overview')">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <article
        v-for="stat in stats"
        :key="stat.key"
        class="rounded-2xl border border-border-subtle bg-surface p-5"
      >
        <div class="flex items-center gap-4">
          <span
            :class="[
              'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
              stat.iconBg,
              stat.iconColor,
            ]"
            aria-hidden="true"
          >
            <Icon :icon="stat.icon" :size="24" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-subtle">
              {{ stat.label }}
            </p>
            <p
              class="mt-1 text-3xl font-bold leading-none tabular-nums text-text"
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
