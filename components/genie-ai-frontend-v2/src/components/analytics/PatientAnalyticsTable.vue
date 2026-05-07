<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDown01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import BaseInput from '../ui/BaseInput.vue';
import Icon from '../ui/Icon.vue';
import AnalyticsTableSkeleton from '../ui/skeletons/AnalyticsTableSkeleton.vue';
import { useT } from '../../i18n/composables';
import {
  formatNumber,
  formatRelative,
  msToSeconds,
  secsToReadable,
  type RelativeStrings,
} from '../../lib/analytics';
import { getAdminPatients, type PatientAnalyticsRow } from '../../services/analytics';
import { extractError } from '../../lib/errors';

const props = defineProps<{ from: string; to: string }>();

const { t } = useT();
const { locale } = useI18n();

const PAGE_SIZE = 50;

const offset = ref(0);
const total = ref(0);
const rows = ref<PatientAnalyticsRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const search = ref('');

type SortKey =
  | 'name'
  | 'chatSessions'
  | 'calls'
  | 'totalMessages'
  | 'avgSessionLength'
  | 'totalCallSecs'
  | 'avgResponseTimeMs'
  | 'lastActive';

const sortKey = ref<SortKey>('lastActive');
const sortDir = ref<'asc' | 'desc'>('desc');

const totalPages = computed(() =>
  total.value === 0 ? 1 : Math.max(1, Math.ceil(total.value / PAGE_SIZE))
);
const currentPage = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);

const relativeStrings = computed<RelativeStrings>(() => ({
  justNow: t('analytics.relative.justNow', 'just now'),
  minutesAgo: (n) => t('analytics.relative.minutesAgo', { n }, '{n} min ago'),
  hoursAgo: (n) => t('analytics.relative.hoursAgo', { n }, '{n} hr ago'),
  daysAgo: (n) => t('analytics.relative.daysAgo', { n }, '{n} days ago'),
  weeksAgo: (n) => t('analytics.relative.weeksAgo', { n }, '{n} weeks ago'),
  monthsAgo: (n) => t('analytics.relative.monthsAgo', { n }, '{n} months ago'),
  yearsAgo: (n) => t('analytics.relative.yearsAgo', { n }, '{n} years ago'),
  never: t('analytics.relative.never', 'Never'),
}));

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await getAdminPatients({
      from: props.from,
      to: props.to,
      offset: offset.value,
      limit: PAGE_SIZE,
    });
    total.value = res.total;
    rows.value = res.patients;
  } catch (err) {
    error.value = extractError(err, t('analytics.errors.loadFailedBody', 'Something went wrong while loading the analytics data.'));
    rows.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

// Reset to first page whenever the date range changes (per plan).
watch(
  () => [props.from, props.to],
  () => {
    offset.value = 0;
    load();
  },
  { immediate: true }
);

function prevPage(): void {
  if (offset.value === 0) return;
  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  load();
}
function nextPage(): void {
  if (offset.value + PAGE_SIZE >= total.value) return;
  offset.value = offset.value + PAGE_SIZE;
  load();
}

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortDir.value = key === 'name' || key === 'lastActive' ? 'desc' : 'desc';
  }
}

function compareValue(v: string | number | null, w: string | number | null): number {
  if (v === null && w === null) return 0;
  if (v === null) return 1; // sink null
  if (w === null) return -1;
  if (typeof v === 'string' && typeof w === 'string') return v.localeCompare(w);
  if (typeof v === 'number' && typeof w === 'number') return v - w;
  return 0;
}

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  let arr = rows.value;
  if (q) {
    arr = arr.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q)
    );
  }
  const sorted = [...arr];
  sorted.sort((a, b) => {
    const av = a[sortKey.value] as string | number | null;
    const bv = b[sortKey.value] as string | number | null;
    const cmp = compareValue(av, bv);
    return sortDir.value === 'asc' ? cmp : -cmp;
  });
  return sorted;
});

interface ColumnSpec {
  key: SortKey;
  labelKey: string;
  fallback: string;
  align: 'left' | 'right';
}

const columns: ColumnSpec[] = [
  { key: 'name', labelKey: 'analytics.tables.patients.col.name', fallback: 'Patient', align: 'left' },
  { key: 'chatSessions', labelKey: 'analytics.tables.patients.col.chats', fallback: 'Chats', align: 'right' },
  { key: 'calls', labelKey: 'analytics.tables.patients.col.calls', fallback: 'Calls', align: 'right' },
  { key: 'totalMessages', labelKey: 'analytics.tables.patients.col.messages', fallback: 'Messages', align: 'right' },
  { key: 'avgSessionLength', labelKey: 'analytics.tables.patients.col.avgSession', fallback: 'Avg Session', align: 'right' },
  { key: 'totalCallSecs', labelKey: 'analytics.tables.patients.col.totalCallTime', fallback: 'Total Call Time', align: 'right' },
  { key: 'avgResponseTimeMs', labelKey: 'analytics.tables.patients.col.avgResp', fallback: 'Avg Response', align: 'right' },
  { key: 'lastActive', labelKey: 'analytics.tables.patients.col.lastActive', fallback: 'Last Active', align: 'right' },
];
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="max-w-sm flex-1">
        <BaseInput
          v-model="search"
          rounded="full"
          size="sm"
          :placeholder="t('analytics.tables.patients.searchPlaceholder', 'Search by name or email…')"
        >
          <template #leading>
            <Icon :icon="Search01Icon" :size="14" />
          </template>
        </BaseInput>
      </div>
      <p v-if="!loading" class="text-meta text-text-subtle">
        {{ t('analytics.pagination.countLabel', { count: total }, '{count} patients') }}
      </p>
    </div>

    <AnalyticsTableSkeleton v-if="loading" :rows="6" :cols="8" />

    <div
      v-else-if="error"
      class="rounded-xl border border-danger/30 bg-danger/5 p-4 text-body text-danger"
    >
      {{ error }}
    </div>

    <div
      v-else-if="rows.length === 0"
      class="rounded-xl bg-surface-subtle p-8 text-center text-body text-text-subtle"
    >
      {{ t('analytics.tables.patients.empty', 'No patient activity in this period.') }}
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[920px] border-collapse text-body">
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
            v-for="row in visible"
            :key="row.patientId"
            class="border-b border-border-subtle transition hover:bg-surface-subtle/40"
          >
            <td class="px-3 py-3">
              <div class="flex flex-col">
                <RouterLink
                  :to="`/users/${row.patientId}`"
                  class="font-medium text-text hover:text-accent"
                >
                  {{ row.name }}
                </RouterLink>
                <span class="text-meta text-text-subtle">{{ row.email }}</span>
              </div>
            </td>
            <td class="px-3 py-3 text-right tabular-nums text-text">{{ formatNumber(row.chatSessions) }}</td>
            <td class="px-3 py-3 text-right tabular-nums text-text">{{ formatNumber(row.calls) }}</td>
            <td class="px-3 py-3 text-right tabular-nums text-text">{{ formatNumber(row.totalMessages) }}</td>
            <td class="px-3 py-3 text-right tabular-nums text-text">
              <template v-if="row.avgSessionLength === null">—</template>
              <template v-else>
                {{ row.avgSessionLength.toFixed(1) }}
                <span class="ml-1 text-meta text-text-subtle">{{ t('analytics.tables.patients.msgsUnit', 'msgs') }}</span>
              </template>
            </td>
            <td class="px-3 py-3 text-right tabular-nums text-text">
              {{ secsToReadable(row.totalCallSecs) }}
            </td>
            <td class="px-3 py-3 text-right tabular-nums text-text">
              {{ row.avgResponseTimeMs === null ? '—' : `${msToSeconds(row.avgResponseTimeMs)}s` }}
            </td>
            <td class="px-3 py-3 text-right tabular-nums text-text-muted">
              {{ formatRelative(row.lastActive, relativeStrings) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer
      v-if="!loading && !error && total > PAGE_SIZE"
      class="flex items-center justify-between gap-4 pt-2"
    >
      <p class="text-meta text-text-subtle">
        {{ t('analytics.pagination.pageOf', { page: currentPage, total: totalPages }, 'Page {page} of {total}') }}
      </p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-meta font-medium text-text transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="offset === 0"
          @click="prevPage"
        >
          {{ t('analytics.pagination.prev', 'Previous') }}
        </button>
        <button
          type="button"
          class="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-meta font-medium text-text transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="offset + PAGE_SIZE >= total"
          @click="nextPage"
        >
          {{ t('analytics.pagination.next', 'Next') }}
        </button>
      </div>
    </footer>
  </div>
</template>
