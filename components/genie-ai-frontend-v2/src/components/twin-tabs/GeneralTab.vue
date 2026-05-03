<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { PlusSignIcon } from '@hugeicons/core-free-icons';
import { notify } from '../../lib/notify';
import BaseButton from '../ui/BaseButton.vue';
import BaseDialog from '../ui/BaseDialog.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import Icon from '../ui/Icon.vue';
import { useAiTwinsStore } from '../../stores/aiTwins';
import type { AiTwin } from '../../services/aiTwins';
import { useZodForm } from '../../composables/useZodForm';
import { updateAiTwinSchema, type UpdateAiTwinInput } from '../../lib/validation/schemas';

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);

const store = useAiTwinsStore();

const form = reactive<UpdateAiTwinInput & { pageGreeting: string; chatGreeting: string }>({
  name: props.twin.name,
  description: props.twin.description,
  pageGreeting: '',
  chatGreeting: '',
});

const { errors, validate, reset } = useZodForm(updateAiTwinSchema, ['name', 'description']);

const numbers = reactive<string[]>([]);
const numberDialogOpen = ref(false);
const newNumber = ref('');

watch(
  () => props.twin,
  (t) => {
    form.name = t.name;
    form.description = t.description;
    reset();
  }
);

function discard() {
  form.name = props.twin.name;
  form.description = props.twin.description;
  reset();
}

async function save(): Promise<boolean> {
  if (!validate(form)) return false;
  try {
    await store.update(props.twin._key, {
      name: form.name?.trim(),
      description: form.description ?? '',
    });
    notify.success('Changes saved');
    return true;
  } catch {
    notify.error(store.error ?? 'Failed to save changes');
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
      <h2 class="text-title text-text">Change Your General Information</h2>
      <div class="mt-4 space-y-5">
        <BaseInput
          v-model="form.name"
          label="AI Twin Name"
          placeholder="Enter the twin's name"
          :disabled="!editing"
          :error="errors.name"
        />
        <BaseTextarea
          v-model="form.description"
          label="Description"
          :rows="6"
          :disabled="!editing"
          :error="errors.description"
        />
      </div>
    </section>

    <section>
      <header class="flex items-center justify-between">
        <h2 class="text-title text-text">AI Twin Number</h2>
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
      <p v-else class="mt-3 rounded-2xl border border-dashed border-border bg-surface-muted p-4 text-center text-caption text-text-muted">
        No phone numbers added yet. Click "Add Number" to attach one.
      </p>
    </section>

    <section>
      <h2 class="text-title text-text">Page Greeting</h2>
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
      <h2 class="text-title text-text">Chat Greeting</h2>
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
        <h2 class="text-title text-text">Add Number</h2>
        <p class="mt-2 text-body leading-6 text-text-muted">
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
