<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import Icon from '../ui/Icon.vue';
import { useT } from '../../i18n/composables';
import { formatNumber, msToSeconds, secsToMinutes } from '../../lib/analytics';
import type { TwinBreakdownRow } from '../../services/analytics';

const props = defineProps<{ data: TwinBreakdownRow[] }>();

const { t } = useT();

type SortKey =
  | 'name'
  | 'chatSessions'
  | 'calls'
  | 'avgResponseTimeMs'
  | 'avgMsgsPerSession'
  | 'avgCallDurationSecs';

const sortKey = ref<SortKey>('chatSessions');
const sortDir = ref<'asc' | 'desc'>('desc');

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = key === 'name' ? 'asc' : 'desc';
  }
}

// Null sinks to bottom regardless of direction (so users always see the
// populated rows first when sorting by an averages column with sparse data).
function compare(a: TwinBreakdownRow, b: TwinBreakdownRow, key: SortKey): number {
  const av = a[key];
  const bv = b[key];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv);
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return 0;
}

const sorted = computed(() => {
  const rows = [...props.data];
  rows.sort((a, b) => {
    const nullSink = (() => {
      const av = a[sortKey.value];
      const bv = b[sortKey.value];
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      return 0;
    })();
    if (nullSink !== 0) return nullSink;
    const cmp = compare(a, b, sortKey.value);
    return sortDir.value === 'asc' ? cmp : -cmp;
  });
  return rows;
});

interface ColumnSpec {
  key: SortKey;
  labelKey: string;
  fallback: string;
  align: 'left' | 'right';
}

const columns: ColumnSpec[] = [
  { key: 'name', labelKey: 'analytics.tables.twins.col.name', fallback: 'Twin', align: 'left' },
  { key: 'chatSessions', labelKey: 'analytics.tables.twins.col.chats', fallback: 'Chat Sessions', align: 'right' },
  { key: 'calls', labelKey: 'analytics.tables.twins.col.calls', fallback: 'Calls', align: 'right' },
  { key: 'avgResponseTimeMs', labelKey: 'analytics.tables.twins.col.avgResp', fallback: 'Avg Response Time', align: 'right' },
  { key: 'avgMsgsPerSession', labelKey: 'analytics.tables.twins.col.avgMsgs', fallback: 'Avg Msgs/Session', align: 'right' },
  { key: 'avgCallDurationSecs', labelKey: 'analytics.tables.twins.col.avgCallDur', fallback: 'Avg Call Duration', align: 'right' },
];
</script>

<template>
  <div v-if="data.length === 0" class="rounded-xl bg-surface-subtle p-8 text-center text-body text-text-subtle">
    {{ t('analytics.tables.twins.empty', 'No twin activity in this period.') }}
  </div>

  <div v-else class="overflow-x-auto">
    <table class="w-full min-w-[640px] border-collapse text-body">
      <thead>
        <tr class="border-b border-border-subtle">
          <th
            v-for="col in columns"
            :key="col.key"
            scope="col"
            :class="[
              'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-subtle',
              col.align === 'right' ? 'text-right' : 'text-left',
            ]"
          >
            <button
              type="button"
              class="inline-flex items-center gap-1 transition hover:text-text"
              :class="col.align === 'right' && 'flex-row-reverse'"
              @click="toggleSort(col.key)"
            >
              {{ t(col.labelKey, col.fallback) }}
              <Icon
                v-if="sortKey === col.key"
                :icon="ArrowDown01Icon"
                :size="12"
                :class="['transition-transform', sortDir === 'asc' && 'rotate-180']"
              />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in sorted"
          :key="row.twinId"
          class="border-b border-border-subtle transition hover:bg-surface-subtle/40"
        >
          <td class="px-3 py-3 text-text">{{ row.name }}</td>
          <td class="px-3 py-3 text-right tabular-nums text-text">{{ formatNumber(row.chatSessions) }}</td>
          <td class="px-3 py-3 text-right tabular-nums text-text">{{ formatNumber(row.calls) }}</td>
          <td class="px-3 py-3 text-right tabular-nums text-text">
            {{ row.avgResponseTimeMs === null ? '—' : `${msToSeconds(row.avgResponseTimeMs)}s` }}
          </td>
          <td class="px-3 py-3 text-right tabular-nums text-text">
            {{ row.avgMsgsPerSession === null ? '—' : row.avgMsgsPerSession.toFixed(1) }}
          </td>
          <td class="px-3 py-3 text-right tabular-nums text-text">
            {{ row.avgCallDurationSecs === null ? '—' : `${secsToMinutes(row.avgCallDurationSecs)}m` }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
