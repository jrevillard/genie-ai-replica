<script setup lang="ts">
import { computed, ref } from 'vue';
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

const groupedDefaults = computed<Record<string, Voice[]>>(() => {
  const map: Record<string, Voice[]> = {};
  for (const v of defaults) {
    const g = v.group ?? 'Other';
    (map[g] ??= []).push(v);
  }
  return map;
});

const itemClass = (id: string) => [
  'flex items-center gap-3 rounded-2xl border bg-surface p-3 shadow-card transition cursor-pointer',
  selectedVoice.value === id
    ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/20'
    : 'border-border hover:bg-surface-muted',
];
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <h2 class="text-title text-text">Manage Your Voices From Here</h2>
      <BaseButton variant="outline" size="sm" rounded="full">
        <Icon :icon="RecordIcon" :size="14" /> Change Voice
      </BaseButton>
    </header>

    <div class="border-b border-border">
      <div class="flex gap-6" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="subTab === 'cloned'"
          :class="[
            'pb-3 text-body font-medium transition',
            subTab === 'cloned' ? 'border-b-2 border-accent text-accent' : 'text-text-muted hover:text-text',
          ]"
          @click="subTab = 'cloned'"
        >
          Cloned Voices
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="subTab === 'default'"
          :class="[
            'pb-3 text-body font-medium transition',
            subTab === 'default' ? 'border-b-2 border-accent text-accent' : 'text-text-muted hover:text-text',
          ]"
          @click="subTab = 'default'"
        >
          Default Voices
        </button>
      </div>
    </div>

    <div v-if="subTab === 'cloned'">
      <fieldset v-if="cloned.length">
        <legend class="sr-only">Cloned voices</legend>
        <ul class="space-y-3">
          <li v-for="v in cloned" :key="v.id">
            <label :class="itemClass(v.id)">
              <button
                type="button"
                class="rounded-full bg-accent-soft p-2 text-accent transition hover:bg-ieee-100"
                :aria-label="`Play preview of ${v.name}`"
                @click.stop
              >
                <Icon :icon="PlayIcon" :size="14" />
              </button>
              <BaseAvatar :src="v.avatar" :name="v.name" size="md" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-body font-medium text-text">{{ v.name }}</p>
                <p class="truncate text-caption text-text-muted">{{ v.caption }}</p>
              </div>
              <input
                type="radio"
                name="cloned-voice"
                :value="v.id"
                :checked="selectedVoice === v.id"
                class="h-4 w-4 cursor-pointer accent-accent"
                @change="selectedVoice = v.id"
              />
            </label>
          </li>
        </ul>
      </fieldset>
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
      <section v-for="(items, group) in groupedDefaults" :key="group">
        <h3 class="mb-3 text-body font-semibold text-text">{{ group }}</h3>
        <fieldset>
          <legend class="sr-only">{{ group }}</legend>
          <ul class="space-y-3">
            <li v-for="v in items" :key="v.id">
              <label :class="itemClass(v.id)">
                <button
                  type="button"
                  class="rounded-full bg-accent-soft p-2 text-accent transition hover:bg-ieee-100"
                  :aria-label="`Play preview of ${v.name}`"
                  @click.stop
                >
                  <Icon :icon="PlayIcon" :size="14" />
                </button>
                <BaseAvatar :src="v.avatar" :name="v.name" size="md" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-body font-medium text-text">{{ v.name }}</p>
                  <p class="truncate text-caption text-text-muted">{{ v.caption }}</p>
                </div>
                <input
                  type="radio"
                  name="default-voice"
                  :value="v.id"
                  :checked="selectedVoice === v.id"
                  class="h-4 w-4 cursor-pointer accent-accent"
                  @change="selectedVoice = v.id"
                />
              </label>
            </li>
          </ul>
        </fieldset>
      </section>
    </div>
  </div>
</template>
