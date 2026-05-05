<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Camera01Icon, SparklesIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseDrawer from '../ui/BaseDrawer.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import Icon from '../ui/Icon.vue';
import { useZodForm } from '../../composables/useZodForm';
import { createAiTwinSchema, type CreateAiTwinInput } from '../../lib/validation/schemas';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{ open: boolean; submitting?: boolean }>();
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'created', twin: { name: string; description: string; avatarFile: File | null }): void;
}>();

const form = reactive<CreateAiTwinInput>({
  name: '',
  description: '',
  profilePicUrl: null,
});

const { errors, validate, reset } = useZodForm(createAiTwinSchema, ['name', 'description']);

const fileInput = ref<HTMLInputElement | null>(null);
const avatarFile = ref<File | null>(null);
const previewUrl = ref<string | null>(null);

function close() {
  if (props.submitting) return;
  emit('update:open', false);
}

function pickFile() {
  fileInput.value?.click();
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  avatarFile.value = file;
  previewUrl.value = URL.createObjectURL(file);
  input.value = '';
}

function onSubmit() {
  if (props.submitting) return;
  if (!validate(form)) return;
  emit('created', {
    name: form.name.trim(),
    description: (form.description ?? '').trim(),
    avatarFile: avatarFile.value,
  });
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      form.name = '';
      form.description = '';
      form.profilePicUrl = null;
      avatarFile.value = null;
      if (previewUrl.value) {
        URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = null;
      }
      reset();
    }
  }
);
</script>

<template>
  <BaseDrawer
    :open="open"
    :title="t('twins.create.title', 'Create AI Twin')"
    :icon="SparklesIcon"
    width="md"
    :close-on-backdrop="!submitting"
    @update:open="(v) => !submitting && emit('update:open', v)"
  >
    <section class="space-y-4">
      <header>
        <h3 class="text-body font-semibold text-text">{{ t('twins.create.uploadHeader', 'Upload Your Image') }}</h3>
      </header>

      <div class="flex items-center gap-4">
        <button
          type="button"
          :class="[
            'group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700/40',
            previewUrl
              ? 'ring-1 ring-border'
              : 'border-2 border-dashed border-slate-300 bg-slate-50 hover:border-ieee-700 hover:bg-ieee-50',
          ]"
          :aria-label="previewUrl ? t('twins.detail.avatar.change', 'Change profile picture') : t('twins.detail.avatar.upload', 'Upload profile picture')"
          @click="pickFile"
        >
          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt=""
            class="h-full w-full object-cover"
          />
          <Icon
            v-else
            :icon="Camera01Icon"
            :size="22"
            class="text-slate-400 transition group-hover:text-ieee-700"
          />
          <span
            v-if="previewUrl"
            class="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100"
          >
            <Icon :icon="Camera01Icon" :size="18" />
          </span>
        </button>
        <div class="flex-1">
          <p class="text-caption text-text-muted">
            {{ t('twins.create.uploadHelp', 'Upload your photo here for the profile picture') }}
          </p>
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            class="hidden"
            @change="onFileChange"
          />
          <button
            type="button"
            class="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-caption font-medium text-text shadow-card transition hover:bg-surface-muted"
            @click="pickFile"
          >
            <Icon :icon="Upload01Icon" :size="14" /> {{ avatarFile ? t('twins.create.replace', 'Replace') : t('twins.create.upload', 'Upload') }}
          </button>
          <p v-if="avatarFile" class="mt-1 truncate text-caption text-text-muted">
            {{ avatarFile.name }}
          </p>
        </div>
      </div>
    </section>

    <hr class="my-5 border-border-subtle" />

    <section class="space-y-4">
      <BaseInput
        id="twin-name"
        v-model="form.name"
        :label="t('twins.create.nameLabel', 'Enter Your Full Name')"
        :placeholder="t('twins.create.namePlaceholder', 'Enter Your Name')"
        :error="errors.name"
        data-autofocus
      />

      <BaseTextarea
        id="twin-desc"
        v-model="form.description"
        :label="t('twins.create.descLabel', 'Twin Description')"
        :rows="8"
        :placeholder="t('twins.create.descPlaceholder', 'Describe what this AI Twin should do…')"
        :error="errors.description"
      />
    </section>

    <template #footer>
      <button
        type="button"
        class="text-body font-semibold text-text-muted transition hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="submitting"
        @click="close"
      >
        {{ t('common.cancel', 'Cancel') }}
      </button>
      <BaseButton variant="primary" size="md" :loading="submitting" @click="onSubmit">
        {{ t('twins.create.submit', 'Create Twin') }}
      </BaseButton>
    </template>
  </BaseDrawer>
</template>
