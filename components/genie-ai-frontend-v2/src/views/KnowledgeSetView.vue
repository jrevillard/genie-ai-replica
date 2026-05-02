<script setup lang="ts">
import { Mortarboard02Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import BaseButton from '../components/ui/BaseButton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 p-6">
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-slate-900">Knowledge Set</h1>
          <p class="mt-1 text-sm text-slate-500">Documents and sources your AI Twins can draw from.</p>
        </div>
        <BaseButton variant="primary" size="md" disabled>
          <Icon :icon="PlusSignIcon" :size="16" /> Add knowledge
        </BaseButton>
      </header>

      <div class="rounded-2xl border border-slate-200 bg-white">
        <EmptyState
          :icon="Mortarboard02Icon"
          title="No knowledge yet"
          description="Upload PDFs, articles, or text snippets so your AI Twins answer with your facts."
        />
      </div>
    </section>
  </DashboardLayout>
</template>
