<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../components/ui/BaseButton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import AnalyticsKpiSkeleton from '../components/ui/skeletons/AnalyticsKpiSkeleton.vue';
import AnalyticsChartSkeleton from '../components/ui/skeletons/AnalyticsChartSkeleton.vue';
import AnalyticsTableSkeleton from '../components/ui/skeletons/AnalyticsTableSkeleton.vue';
import AnalyticsDateRange from '../components/analytics/AnalyticsDateRange.vue';
import KpiGrid from '../components/analytics/KpiGrid.vue';
import ChartCard from '../components/analytics/ChartCard.vue';
import ActivityByDayChart from '../components/analytics/charts/ActivityByDayChart.vue';
import ChannelSplitChart from '../components/analytics/charts/ChannelSplitChart.vue';
import SessionLengthChart from '../components/analytics/charts/SessionLengthChart.vue';
import CallDurationChart from '../components/analytics/charts/CallDurationChart.vue';
import HourlyDistributionChart from '../components/analytics/charts/HourlyDistributionChart.vue';
import TopCategoriesChart from '../components/analytics/charts/TopCategoriesChart.vue';
import CallLanguagesChart from '../components/analytics/charts/CallLanguagesChart.vue';
import TwinBreakdownTable from '../components/analytics/TwinBreakdownTable.vue';
import PatientAnalyticsTable from '../components/analytics/PatientAnalyticsTable.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useT } from '../i18n/composables';
import { defaultRange, type DateRange } from '../lib/analytics';
import { extractError } from '../lib/errors';
import {
  getAdminSummary,
  type AdminAnalyticsSummary,
} from '../services/analytics';

const { t } = useT();

const range = ref<DateRange>(defaultRange());
const summary = ref<AdminAnalyticsSummary | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    summary.value = await getAdminSummary({ from: range.value.from, to: range.value.to });
  } catch (err) {
    error.value = extractError(
      err,
      t('analytics.errors.loadFailedBody', 'Something went wrong while loading the analytics data.')
    );
    summary.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

watch(
  () => [range.value.from, range.value.to],
  () => load()
);

function isAllZero<T>(arr: T[], pick: (x: T) => number): boolean {
  return arr.length === 0 || arr.every((d) => pick(d) === 0);
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 class="text-headline text-text">{{ t('analytics.title', 'Analytics') }}</h1>
          <p class="mt-1 text-meta text-text-subtle">
            {{ t('analytics.subtitle', 'How patients are engaging with your AI twins.') }}
          </p>
        </div>
        <AnalyticsDateRange v-model="range" />
      </header>

      <!-- Error state -->
      <EmptyState
        v-if="error && !loading"
        full-height
        :icon="Alert02Icon"
        :title="t('analytics.errors.loadFailedTitle', `Couldn't load analytics`)"
        :description="error"
      >
        <BaseButton variant="primary" size="md" @click="load">
          {{ t('common.retry', 'Retry') }}
        </BaseButton>
      </EmptyState>

      <!-- Loading skeleton on initial load -->
      <template v-else-if="loading && !summary">
        <AnalyticsKpiSkeleton />
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AnalyticsChartSkeleton />
          <AnalyticsChartSkeleton />
          <AnalyticsChartSkeleton />
          <AnalyticsChartSkeleton />
        </div>
        <AnalyticsTableSkeleton :rows="5" :cols="6" />
      </template>

      <!-- Loaded -->
      <template v-else-if="summary">
        <KpiGrid :kpis="summary.kpis" />

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            class="lg:col-span-2"
            :title="t('analytics.charts.activityByDay', 'Activity Over Time')"
            :subtitle="t('analytics.charts.activityByDaySubtitle', 'Chat sessions and calls per day')"
            :empty="isAllZero(summary.activityByDay, (d) => d.chatSessions + d.calls)"
          >
            <ActivityByDayChart :data="summary.activityByDay" />
          </ChartCard>

          <ChartCard
            :title="t('analytics.charts.channelSplit', 'Channel Split')"
            :subtitle="t('analytics.charts.channelSplitSubtitle', 'Distribution by channel')"
            :empty="isAllZero(summary.channelSplit, (d) => d.count)"
          >
            <ChannelSplitChart :data="summary.channelSplit" />
          </ChartCard>

          <ChartCard
            :title="t('analytics.charts.callLanguages', 'Call Languages')"
            :subtitle="t('analytics.charts.callLanguagesSubtitle', 'Languages used in voice calls')"
            :empty="isAllZero(summary.callLanguages, (d) => d.count)"
          >
            <CallLanguagesChart :data="summary.callLanguages" />
          </ChartCard>

          <ChartCard
            :title="t('analytics.charts.sessionLength', 'Chat Session Length')"
            :subtitle="t('analytics.charts.sessionLengthSubtitle', 'Messages per session')"
            :empty="isAllZero(summary.sessionLengthDistribution, (d) => d.count)"
          >
            <SessionLengthChart :data="summary.sessionLengthDistribution" />
          </ChartCard>

          <ChartCard
            :title="t('analytics.charts.callDuration', 'Call Duration')"
            :subtitle="t('analytics.charts.callDurationSubtitle', 'Distribution of call lengths')"
            :empty="isAllZero(summary.callDurationDistribution, (d) => d.count)"
          >
            <CallDurationChart :data="summary.callDurationDistribution" />
          </ChartCard>

          <ChartCard
            class="lg:col-span-2"
            :title="t('analytics.charts.hourlyDistribution', 'When Are Patients Most Active?')"
            :subtitle="t('analytics.charts.hourlyDistributionSubtitle', 'Activity by hour of day')"
            :empty="isAllZero(summary.hourlyDistribution, (d) => d.count)"
          >
            <HourlyDistributionChart :data="summary.hourlyDistribution" />
          </ChartCard>

          <ChartCard
            class="lg:col-span-2"
            :title="t('analytics.charts.topCategories', 'Top Conversation Topics')"
            :subtitle="t('analytics.charts.topCategoriesSubtitle', 'Most-discussed categories')"
            :empty="summary.topCategories.length === 0"
            :empty-body="t('analytics.charts.empty.topCategoriesBody', 'Topics appear once patients start chatting.')"
          >
            <TopCategoriesChart :data="summary.topCategories" />
          </ChartCard>
        </div>

        <ChartCard :title="t('analytics.tables.twins.title', 'Twin Performance')">
          <TwinBreakdownTable :data="summary.twinBreakdown" />
        </ChartCard>

        <ChartCard :title="t('analytics.tables.patients.title', 'Patient Engagement')">
          <PatientAnalyticsTable :from="range.from" :to="range.to" />
        </ChartCard>
      </template>
    </section>
  </DashboardLayout>
</template>
