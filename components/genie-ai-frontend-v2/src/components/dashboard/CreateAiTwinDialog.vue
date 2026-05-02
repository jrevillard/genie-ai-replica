<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Upload01Icon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseDialog from '../ui/BaseDialog.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import Icon from '../ui/Icon.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'created', twin: { name: string; description: string; avatar: string | null }): void;
}>();

const form = reactive({
  name: '',
  description: '',
  avatar: null as string | null,
});

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
    form.avatar = String(reader.result);
  };
  reader.readAsDataURL(file);
}

function onSubmit() {
  if (!form.name.trim()) return;
  emit('created', { name: form.name.trim(), description: form.description.trim(), avatar: form.avatar });
  close();
}

// Reset form on close
watch(
  () => props.open,
  (open) => {
    if (!open) {
      form.name = '';
      form.description = '';
      form.avatar = null;
    }
  }
);
</script>

<template>
  <BaseDialog :open="open" size="md" @update:open="close">
    <template #default>
      <div class="space-y-5">
        <header>
          <p class="text-xs font-medium uppercase tracking-wider text-slate-400">Change Image</p>
          <h2 class="mt-1 text-lg font-semibold text-slate-900">Upload Your Image</h2>
        </header>

        <div class="flex items-center gap-4">
          <BaseAvatar :src="form.avatar" name="?" size="lg" />
          <div class="flex-1">
            <p class="text-xs text-slate-500">Upload your photo here for the profile picture</p>
            <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange" />
            <button
              type="button"
              class="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              @click="pickFile"
            >
              <Icon :icon="Upload01Icon" :size="14" /> Upload
            </button>
          </div>
        </div>

        <BaseInput
          id="twin-name"
          v-model="form.name"
          label="Enter Your Full Name"
          placeholder="Enter Your Name"
        />

        <BaseTextarea
          id="twin-desc"
          v-model="form.description"
          label="Twin Description"
          :rows="6"
          placeholder="Describe what this AI Twin should do…"
        />
      </div>
    </template>

    <template #footer>
      <BaseButton variant="outline" size="md" @click="close">Cancel</BaseButton>
      <BaseButton variant="primary" size="md" :disabled="!form.name.trim()" @click="onSubmit">
        Create Twin
      </BaseButton>
    </template>
  </BaseDialog>
</template>
