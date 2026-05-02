<script setup lang="ts">
import { ref } from 'vue';
import { PlayIcon, RecordIcon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';

interface Voice {
  id: string;
  name: string;
  caption: string;
  avatar: string;
  group?: string;
}

const subTab = ref<'cloned' | 'default'>('cloned');
const selectedVoice = ref<string>('billie-1');

const cloned: Voice[] = [
  { id: 'billie-1', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=14' },
  { id: 'billie-2', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=15' },
];

const defaults: Voice[] = [
  { id: 'def-1', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=16', group: 'Top Picks' },
  { id: 'def-2', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=17', group: 'Top Picks' },
  { id: 'def-3', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=18', group: 'Top Picks' },
  { id: 'def-4', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=19', group: 'Newly Added' },
  { id: 'def-5', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=20', group: 'Newly Added' },
  { id: 'def-6', name: 'Billie Voice 1', caption: 'Voice Library — Top Picks For You', avatar: 'https://i.pravatar.cc/40?img=21', group: 'Professional Sounds' },
];

const groupedDefaults = (): Record<string, Voice[]> => {
  const map: Record<string, Voice[]> = {};
  for (const v of defaults) {
    const g = v.group ?? 'Other';
    (map[g] ??= []).push(v);
  }
  return map;
};
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <h2 class="text-base font-semibold text-slate-900">Manage Your Voices From Here</h2>
      <BaseButton variant="outline" size="sm" rounded="full">
        <Icon :icon="RecordIcon" :size="14" /> Change Voice
      </BaseButton>
    </header>

    <div class="border-b border-slate-200">
      <div class="flex gap-6">
        <button
          type="button"
          :class="[
            'pb-3 text-sm font-medium transition',
            subTab === 'cloned' ? 'border-b-2 border-ieee-600 text-ieee-700' : 'text-slate-500 hover:text-slate-800',
          ]"
          @click="subTab = 'cloned'"
        >
          Cloned Voices
        </button>
        <button
          type="button"
          :class="[
            'pb-3 text-sm font-medium transition',
            subTab === 'default' ? 'border-b-2 border-ieee-600 text-ieee-700' : 'text-slate-500 hover:text-slate-800',
          ]"
          @click="subTab = 'default'"
        >
          Default Voices
        </button>
      </div>
    </div>

    <div v-if="subTab === 'cloned'">
      <ul v-if="cloned.length" class="space-y-3">
        <li
          v-for="v in cloned"
          :key="v.id"
          :class="[
            'flex items-center gap-3 rounded-xl border p-3 transition',
            selectedVoice === v.id ? 'border-ieee-300 bg-ieee-50/40' : 'border-slate-200',
          ]"
        >
          <button class="rounded-full bg-ieee-50 p-2 text-ieee-600 transition hover:bg-ieee-100" aria-label="Play">
            <Icon :icon="PlayIcon" :size="14" />
          </button>
          <BaseAvatar :src="v.avatar" :name="v.name" size="md" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-slate-900">{{ v.name }}</p>
            <p class="truncate text-xs text-slate-500">{{ v.caption }}</p>
          </div>
          <input
            type="radio"
            :value="v.id"
            :checked="selectedVoice === v.id"
            class="h-4 w-4 text-ieee-600 focus:ring-ieee-300"
            @change="selectedVoice = v.id"
          />
        </li>
      </ul>
      <EmptyState
        v-else
        :icon="RecordIcon"
        title="No cloned voices yet"
        description="Clone your voice to make this AI Twin sound exactly like you."
      >
        <BaseButton variant="primary" size="md">Clone a voice</BaseButton>
      </EmptyState>
    </div>

    <div v-else class="space-y-6">
      <section v-for="(items, group) in groupedDefaults()" :key="group">
        <h3 class="mb-3 text-sm font-semibold text-slate-700">{{ group }}</h3>
        <ul class="space-y-3">
          <li
            v-for="v in items"
            :key="v.id"
            :class="[
              'flex items-center gap-3 rounded-xl border p-3 transition',
              selectedVoice === v.id ? 'border-ieee-300 bg-ieee-50/40' : 'border-slate-200',
            ]"
          >
            <button class="rounded-full bg-ieee-50 p-2 text-ieee-600 transition hover:bg-ieee-100" aria-label="Play">
              <Icon :icon="PlayIcon" :size="14" />
            </button>
            <BaseAvatar :src="v.avatar" :name="v.name" size="md" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-900">{{ v.name }}</p>
              <p class="truncate text-xs text-slate-500">{{ v.caption }}</p>
            </div>
            <input
              type="radio"
              :value="v.id"
              :checked="selectedVoice === v.id"
              class="h-4 w-4 text-ieee-600 focus:ring-ieee-300"
              @change="selectedVoice = v.id"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
