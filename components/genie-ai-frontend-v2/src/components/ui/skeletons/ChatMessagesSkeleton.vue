<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';

const bubbles = [
  { role: 'assistant', width: '14rem', lines: 2 },
  { role: 'user', width: '10rem', lines: 1 },
  { role: 'assistant', width: '17rem', lines: 3 },
  { role: 'user', width: '12rem', lines: 2 },
  { role: 'assistant', width: '11rem', lines: 1 },
] as const;
</script>

<template>
  <div aria-hidden="true">
    <div
      v-for="(b, i) in bubbles"
      :key="i"
      :class="['mb-5 flex items-start gap-2.5', b.role === 'user' && 'justify-end']"
    >
      <BaseSkeleton v-if="b.role !== 'user'" variant="circle" width="1.5rem" height="1.5rem" />
      <div :class="['flex max-w-[86%] flex-col gap-1 md:max-w-[430px]', b.role === 'user' && 'items-end']">
        <div
          :class="[
            'flex flex-col gap-1.5 rounded-2xl px-3.5 py-3 shadow-sm',
            b.role === 'user' ? 'rounded-tr-md bg-ieee-700/10' : 'rounded-tl-md bg-white',
          ]"
          :style="{ width: b.width }"
        >
          <BaseSkeleton v-for="ln in b.lines" :key="ln" height="0.625rem" :width="ln === b.lines ? '70%' : '100%'" rounded="md" />
        </div>
        <BaseSkeleton height="0.625rem" width="3rem" rounded="md" />
      </div>
      <BaseSkeleton v-if="b.role === 'user'" variant="circle" width="1.5rem" height="1.5rem" />
    </div>
  </div>
</template>
