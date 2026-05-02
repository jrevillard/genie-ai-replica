<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { PlusSignIcon } from '@hugeicons/core-free-icons';
import { sileo } from '../../lib/notify';
import BaseButton from '../ui/BaseButton.vue';
import BaseDialog from '../ui/BaseDialog.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import Icon from '../ui/Icon.vue';
import { useAiTwinsStore } from '../../stores/aiTwins';
import type { AiTwin } from '../../services/aiTwins';

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);

const store = useAiTwinsStore();

const form = reactive({
  name: props.twin.name,
  description: props.twin.description,
  pageGreeting: '',
  chatGreeting: '',
});

const numbers = reactive<string[]>([]);
const numberDialogOpen = ref(false);
const newNumber = ref('');

watch(
  () => props.twin,
  (t) => {
    form.name = t.name;
    form.description = t.description;
  }
);

function discard() {
  form.name = props.twin.name;
  form.description = props.twin.description;
}

async function save(): Promise<boolean> {
  const name = form.name.trim();
  if (!name) {
    sileo.error({ title: 'Name is required' });
    return false;
  }
  try {
    await store.update(props.twin._key, {
      name,
      description: form.description,
    });
    sileo.success({ title: 'Changes saved' });
    return true;
  } catch {
    sileo.error({ title: store.error ?? 'Failed to save changes' });
    return false;
  }
}

defineExpose({ save, discard });

function openNumberDialog() {
  if (!props.editing) return;
  newNumber.value = '';
  numberDialogOpen.value = true;
}

function addNumber() {
  const value = newNumber.value.trim();
  if (!value) return;
  numbers.push(value);
  numberDialogOpen.value = false;
  newNumber.value = '';
}
</script>

<template>
  <div class="space-y-8">
    <section>
      <h2 class="text-base font-semibold text-slate-900">Change Your General Information</h2>
      <div class="mt-4 space-y-5">
        <BaseInput
          v-model="form.name"
          label="AI Twin Name"
          placeholder="Enter the twin's name"
          :disabled="!editing"
        />
        <BaseTextarea
          v-model="form.description"
          label="Description"
          :rows="6"
          :disabled="!editing"
        />
      </div>
    </section>

    <section>
      <header class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-slate-900">AI Twin Number</h2>
        <BaseButton
          variant="primary"
          size="sm"
          rounded="full"
          :disabled="!editing"
          @click="openNumberDialog"
        >
          <Icon :icon="PlusSignIcon" :size="14" /> Add Number
        </BaseButton>
      </header>

      <div v-if="numbers.length" class="mt-4 space-y-2">
        <BaseInput
          v-for="(_, idx) in numbers"
          :key="idx"
          v-model="numbers[idx]"
          placeholder="+1 234 567 8900"
          :disabled="!editing"
        />
      </div>
      <p v-else class="mt-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-center text-xs text-slate-500">
        No phone numbers added yet. Click "Add Number" to attach one.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-slate-900">Page Greeting</h2>
      <div class="mt-3">
        <BaseTextarea
          v-model="form.pageGreeting"
          :rows="5"
          placeholder="Welcome message shown on the page…"
          :disabled="!editing"
        />
      </div>
    </section>

    <section>
      <h2 class="text-base font-semibold text-slate-900">Chat Greeting</h2>
      <div class="mt-3">
        <BaseTextarea
          v-model="form.chatGreeting"
          :rows="5"
          placeholder="First message the AI sends in chat…"
          :disabled="!editing"
        />
      </div>
    </section>

    <BaseDialog v-model:open="numberDialogOpen" size="sm">
      <div class="pr-10">
        <h2 class="text-lg font-semibold text-slate-950">Add Number</h2>
        <p class="mt-2 text-sm leading-6 text-slate-500">
          Attach a phone number to this AI Twin.
        </p>
      </div>

      <div class="mt-6">
        <BaseInput
          v-model="newNumber"
          label="Phone Number"
          placeholder="+1 234 567 8900"
          type="tel"
          rounded="full"
          @keydown.enter.prevent="addNumber"
        />
      </div>

      <div class="mt-7 flex justify-end">
        <BaseButton variant="primary" @click="addNumber">
          <Icon :icon="PlusSignIcon" :size="16" />
          Add Number
        </BaseButton>
      </div>
    </BaseDialog>
  </div>
</template>
