<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  AiBrain01Icon,
  ArrowExpand01Icon,
  Cancel01Icon,
  MoreHorizontalIcon,
  Upload01Icon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
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
const expanded = ref(false);

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
  emit('created', {
    name: form.name.trim(),
    description: form.description.trim(),
    avatar: form.avatar,
  });
  close();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close();
}

onMounted(() => document.addEventListener('keydown', onKeyDown));
onUnmounted(() => document.removeEventListener('keydown', onKeyDown));

watch(
  () => props.open,
  (open) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = open ? 'hidden' : '';
    }
    if (!open) {
      form.name = '';
      form.description = '';
      form.avatar = null;
      expanded.value = false;
    }
  }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-twin-title"
      >
        <div class="absolute inset-0 bg-neutral-900/30 backdrop-blur-[2px]" @click="close" />

        <Transition name="drawer-slide">
          <aside
            v-if="open"
            :class="[
              'absolute right-3 top-3 bottom-3 z-10 flex flex-col overflow-hidden rounded-3xl border border-neutral-200/70 bg-white shadow-[0_30px_80px_-20px_rgba(15,23,42,0.35)] transition-all duration-300',
              expanded ? 'left-3 sm:left-auto sm:w-[min(96vw,1080px)]' : 'w-[min(96vw,560px)]',
            ]"
          >
            <header
              class="flex items-center justify-between gap-3 border-b border-neutral-100 px-6 py-4"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-slate-600 ring-1 ring-inset ring-neutral-200"
                >
                  <Icon :icon="AiBrain01Icon" :size="20" />
                </span>
                <h2
                  id="create-twin-title"
                  class="truncate text-lg font-semibold text-slate-900"
                >
                  Create AI Twin
                </h2>
                <span
                  class="hidden shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-neutral-200 sm:inline-flex"
                >
                  #NEW
                </span>
              </div>
              <div class="flex items-center gap-1 text-slate-500">
                <button
                  type="button"
                  class="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-neutral-100 hover:text-slate-900"
                  :aria-label="expanded ? 'Collapse' : 'Expand'"
                  @click="expanded = !expanded"
                >
                  <Icon :icon="ArrowExpand01Icon" :size="18" />
                </button>
                <button
                  type="button"
                  class="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-neutral-100 hover:text-slate-900"
                  aria-label="More options"
                >
                  <Icon :icon="MoreHorizontalIcon" :size="18" />
                </button>
                <button
                  type="button"
                  class="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-neutral-100 hover:text-slate-900"
                  aria-label="Close drawer"
                  @click="close"
                >
                  <Icon :icon="Cancel01Icon" :size="18" />
                </button>
              </div>
            </header>

            <div class="flex-1 overflow-y-auto px-6 py-5">
              <section class="space-y-4">
                <header>
                  <p class="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Change Image
                  </p>
                  <h3 class="mt-1 text-sm font-semibold text-slate-900">Upload Your Image</h3>
                </header>

                <div class="flex items-center gap-4">
                  <BaseAvatar :src="form.avatar" name="?" size="lg" />
                  <div class="flex-1">
                    <p class="text-xs text-slate-500">
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
                      class="mt-2 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-neutral-50"
                      @click="pickFile"
                    >
                      <Icon :icon="Upload01Icon" :size="14" /> Upload
                    </button>
                  </div>
                </div>
              </section>

              <hr class="my-5 border-neutral-100" />

              <section class="space-y-4">
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
                  :rows="8"
                  placeholder="Describe what this AI Twin should do…"
                />
              </section>
            </div>

            <footer
              class="flex items-center justify-end gap-3 border-t border-neutral-100 px-6 py-4"
            >
              <button
                type="button"
                class="text-sm font-semibold text-slate-600 transition hover:text-slate-900"
                @click="close"
              >
                Cancel
              </button>
              <BaseButton
                variant="primary"
                size="md"
                :disabled="!form.name.trim()"
                @click="onSubmit"
              >
                Create Twin
              </BaseButton>
            </footer>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
</style>
