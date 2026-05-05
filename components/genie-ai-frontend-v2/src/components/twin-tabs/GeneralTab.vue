<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { notify } from '../../lib/notify';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import { useAiTwinsStore } from '../../stores/aiTwins';
import {
  getTwinSettings,
  updateTwinSettings,
  type AiTwin,
  type TwinSettings,
} from '../../services/aiTwins';
import { useZodForm } from '../../composables/useZodForm';
import { updateAiTwinSchema, type UpdateAiTwinInput } from '../../lib/validation/schemas';
import { useT } from '../../i18n/composables';
import { useTranslated } from '../../composables/useTranslated';

const { t } = useT();

const props = withDefaults(
  defineProps<{ twin: AiTwin; editing?: boolean }>(),
  { editing: false }
);

const store = useAiTwinsStore();

interface FormState extends UpdateAiTwinInput, TwinSettings {}

function snapshot(t: AiTwin): FormState {
  return {
    name: t.name,
    description: t.description,
    chatGreeting: t.chatGreeting ?? '',
    callGreeting: t.callGreeting ?? '',
    twinNumber: t.twinNumber ?? '',
  };
}

const form = reactive<FormState>(snapshot(props.twin));
const baseline = ref<FormState>(snapshot(props.twin));

const { errors, validate, reset } = useZodForm(updateAiTwinSchema, ['name', 'description']);
const settingsLoading = ref(false);

watch(
  () => props.twin,
  (t) => {
    Object.assign(form, snapshot(t));
    baseline.value = snapshot(t);
    reset();
  }
);

onMounted(async () => {
  // The twin object already snapshots these fields, but the dedicated
  // /settings endpoint is the canonical source — refresh in the background.
  if (!props.twin?._key) return;
  settingsLoading.value = true;
  try {
    const settings = await getTwinSettings(props.twin._key);
    if (!isDirtySettings()) {
      form.chatGreeting = settings.chatGreeting ?? '';
      form.callGreeting = settings.callGreeting ?? '';
      form.twinNumber = settings.twinNumber ?? '';
      baseline.value = { ...baseline.value, ...settings };
    }
  } catch {
    // Non-fatal — fall back to the snapshot already loaded from /ai-twins/:id.
  } finally {
    settingsLoading.value = false;
  }
});

function isDirtySettings(): boolean {
  return (
    form.chatGreeting !== baseline.value.chatGreeting ||
    form.callGreeting !== baseline.value.callGreeting ||
    form.twinNumber !== baseline.value.twinNumber
  );
}

function isDirtyTwin(): boolean {
  return form.name !== baseline.value.name || form.description !== baseline.value.description;
}

function discard() {
  Object.assign(form, baseline.value);
  reset();
}

async function save(): Promise<boolean> {
  if (!validate(form)) return false;
  const tasks: Promise<unknown>[] = [];
  if (isDirtyTwin()) {
    tasks.push(
      store.update(props.twin._key, {
        name: form.name?.trim(),
        description: (form.description ?? '').trim(),
      })
    );
  }
  if (isDirtySettings()) {
    tasks.push(
      updateTwinSettings(props.twin._key, {
        chatGreeting: form.chatGreeting,
        callGreeting: form.callGreeting,
        twinNumber: form.twinNumber.trim(),
      })
    );
  }
  if (tasks.length === 0) {
    notify.success(t('twins.general.noChangesToast', 'No changes to save'));
    return true;
  }
  try {
    await Promise.all(tasks);
    baseline.value = snapshot({
      ...props.twin,
      name: form.name ?? props.twin.name,
      description: form.description ?? props.twin.description,
      chatGreeting: form.chatGreeting,
      callGreeting: form.callGreeting,
      twinNumber: form.twinNumber.trim(),
    });
    notify.success(t('twins.general.savedToast', 'Changes saved'));
    return true;
  } catch {
    notify.error(store.error ?? t('twins.general.saveFailedToast', 'Failed to save changes'));
    return false;
  }
}

defineExpose({ save, discard });

// Read-mode display values: translated to the active UI locale. When the user
// clicks Update, the inputs flip back to the source `form.*` values so a save
// can never overwrite the original with a translation.
const { value: tName } = useTranslated(() => form.name ?? '', 'en');
const { value: tDescription } = useTranslated(() => form.description ?? '', 'en');
const { value: tChatGreeting } = useTranslated(() => form.chatGreeting, 'en');
const { value: tCallGreeting } = useTranslated(() => form.callGreeting, 'en');
</script>

<template>
  <div class="space-y-8">
    <section>
      <h2 class="text-title text-text">{{ t('twins.general.sectionTitle', 'Change Your General Information') }}</h2>
      <div class="mt-4 space-y-5">
        <BaseInput
          :model-value="editing ? form.name : tName"
          :label="t('twins.general.nameLabel', 'AI Twin Name')"
          :placeholder="t('twins.general.namePlaceholder', `Enter the twin's name`)"
          :disabled="!editing"
          :error="errors.name"
          @update:model-value="(v) => (form.name = v)"
        />
        <BaseTextarea
          :model-value="editing ? form.description : tDescription"
          :label="t('twins.general.descLabel', 'Description')"
          :rows="6"
          :disabled="!editing"
          :error="errors.description"
          @update:model-value="(v) => (form.description = v)"
        />
      </div>
    </section>

    <section>
      <h2 class="text-title text-text">{{ t('twins.general.numberTitle', 'AI Twin Number') }}</h2>
      <p class="mt-1 text-caption text-text-muted">
        {{ t('twins.general.numberSubtitle', 'The phone number callers can use to reach this AI Twin.') }}
      </p>
      <div class="mt-3">
        <BaseInput
          v-model="form.twinNumber"
          type="tel"
          :placeholder="t('twins.general.numberPlaceholder', '+1 234 567 8900')"
          disabled
        />
      </div>
    </section>

    <section>
      <h2 class="text-title text-text">{{ t('twins.general.chatGreetingTitle', 'Chat Greeting') }}</h2>
      <p class="mt-1 text-caption text-text-muted">
        {{ t('twins.general.chatGreetingSubtitle', 'First message the AI sends when a chat opens.') }}
      </p>
      <div class="mt-3">
        <BaseTextarea
          :model-value="editing ? form.chatGreeting : tChatGreeting"
          :rows="4"
          :placeholder="t('twins.general.greetingPlaceholder', 'Hey, how can I help you today?')"
          :disabled="!editing"
          @update:model-value="(v) => (form.chatGreeting = v)"
        />
      </div>
    </section>

    <section>
      <h2 class="text-title text-text">{{ t('twins.general.callGreetingTitle', 'Call Greeting') }}</h2>
      <p class="mt-1 text-caption text-text-muted">
        {{ t('twins.general.callGreetingSubtitle', 'First thing the AI says when a voice call connects.') }}
      </p>
      <div class="mt-3">
        <BaseTextarea
          :model-value="editing ? form.callGreeting : tCallGreeting"
          :rows="4"
          :placeholder="t('twins.general.greetingPlaceholder', 'Hey, how can I help you today?')"
          :disabled="!editing"
          @update:model-value="(v) => (form.callGreeting = v)"
        />
      </div>
    </section>
  </div>
</template>
