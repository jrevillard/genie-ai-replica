<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { SparklesIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseDrawer from '../ui/BaseDrawer.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import Icon from '../ui/Icon.vue';
import { useZodForm } from '../../composables/useZodForm';
import { createAiTwinSchema, type CreateAiTwinInput } from '../../lib/validation/schemas';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'created', twin: { name: string; description: string; avatar: string | null }): void;
}>();

const form = reactive<CreateAiTwinInput>({
  name: '',
  description: '',
  profilePicUrl: null,
});

const { errors, validate, reset } = useZodForm(createAiTwinSchema, ['name', 'description']);

const fileInput = ref<HTMLInputElement | null>(null);

function close() {
  emit('update:open', false);
}

function pickFile() {
  fileInput.value?.click();
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    form.profilePicUrl = String(reader.result);
  };
  reader.readAsDataURL(file);
}

function onSubmit() {
  if (!validate(form)) return;
  emit('created', {
    name: form.name.trim(),
    description: (form.description ?? '').trim(),
    avatar: form.profilePicUrl ?? null,
  });
  close();
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      form.name = '';
      form.description = '';
      form.profilePicUrl = null;
      reset();
    }
  }
);
</script>

<template>
  <BaseDrawer
    :open="open"
    title="Create AI Twin"
    badge="#NEW"
    :icon="SparklesIcon"
    width="md"
    @update:open="emit('update:open', $event)"
  >
    <section class="space-y-4">
      <header>
        <p class="text-caption font-medium uppercase text-text-subtle">Change Image</p>
        <h3 class="mt-1 text-body font-semibold text-text">Upload Your Image</h3>
      </header>

      <div class="flex items-center gap-4">
        <BaseAvatar :src="form.profilePicUrl" name="?" size="lg" />
        <div class="flex-1">
          <p class="text-caption text-text-muted">
            Upload your photo here for the profile picture
          </p>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onFileChange"
          />
          <button
            type="button"
            class="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-caption font-medium text-text shadow-card transition hover:bg-surface-muted"
            @click="pickFile"
          >
            <Icon :icon="Upload01Icon" :size="14" /> Upload
          </button>
        </div>
      </div>
    </section>

    <hr class="my-5 border-border-subtle" />

    <section class="space-y-4">
      <BaseInput
        id="twin-name"
        v-model="form.name"
        label="Enter Your Full Name"
        placeholder="Enter Your Name"
        :error="errors.name"
        data-autofocus
      />

      <BaseTextarea
        id="twin-desc"
        v-model="form.description"
        label="Twin Description"
        :rows="8"
        placeholder="Describe what this AI Twin should do…"
        :error="errors.description"
      />
    </section>

    <template #footer>
      <button
        type="button"
        class="text-body font-semibold text-text-muted transition hover:text-text"
        @click="close"
      >
        Cancel
      </button>
      <BaseButton variant="primary" size="md" @click="onSubmit">
        Create Twin
      </BaseButton>
    </template>
  </BaseDrawer>
</template>
