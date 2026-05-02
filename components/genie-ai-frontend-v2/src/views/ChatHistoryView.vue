<script setup lang="ts">
import { MessageMultiple01Icon } from '@hugeicons/core-free-icons';
import EmptyState from '../components/ui/EmptyState.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 p-6">
      <header>
        <h1 class="text-xl font-semibold text-slate-900">Chat / Call History</h1>
        <p class="mt-1 text-sm text-slate-500">Conversations and calls with your AI Twins.</p>
      </header>

      <div class="rounded-2xl border border-slate-200 bg-white">
        <EmptyState
          :icon="MessageMultiple01Icon"
          title="No conversations yet"
          description="Once your AI Twins start chatting or taking calls, history will appear here."
        />
      </div>
    </section>
  </DashboardLayout>
</template>
