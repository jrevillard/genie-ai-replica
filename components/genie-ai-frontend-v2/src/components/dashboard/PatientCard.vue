<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import type { Patient } from '../../services/patients';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{ patient: Patient }>();

const router = useRouter();

const fullName = computed(
  () => props.patient.personalIdentification?.fullName?.trim() || props.patient.email
);

const dob = computed(() => formatDate(props.patient.personalIdentification?.dob, 'date'));
const dateCreated = computed(() => formatDate(props.patient.createdAt, 'datetime'));
const dateEdited = computed(() => formatDate(props.patient.updatedAt, 'datetime'));

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnlyFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function formatDate(iso: string | undefined | null, kind: 'date' | 'datetime'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (kind === 'datetime' ? dateTimeFormatter : dateOnlyFormatter).format(d);
}

function open() {
  router.push({ name: 'patient-detail', params: { id: props.patient._key } });
}
</script>

<template>
  <article
    class="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-ieee-200 hover:shadow-md"
  >
    <header class="flex items-center gap-3">
      <BaseAvatar :name="fullName" size="lg" />
      <div class="min-w-0">
        <h3 class="truncate text-base font-semibold text-slate-900">{{ fullName }}</h3>
        <p class="truncate text-xs text-slate-500">{{ patient.email }}</p>
      </div>
    </header>

    <div class="grid grid-cols-2 items-center gap-x-6 rounded-2xl bg-neutral-50 px-4 py-3 text-xs">
      <dl class="flex flex-col gap-y-2">
        <div class="flex items-center justify-between gap-3">
          <dt class="text-slate-500">{{ t('patients.list.card.dateEdited', 'Edited') }}</dt>
          <dd class="font-medium text-slate-800">{{ dateEdited }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-slate-500">{{ t('patients.list.card.dateCreated', 'Created') }}</dt>
          <dd class="font-medium text-slate-800">{{ dateCreated }}</dd>
        </div>
      </dl>
      <dl class="flex flex-col gap-y-2 border-l border-slate-200 pl-6">
        <div class="flex items-center justify-between gap-3">
          <dt class="text-slate-500">{{ t('patients.list.card.dob', 'Date of Birth') }}</dt>
          <dd class="font-medium text-slate-800">{{ dob }}</dd>
        </div>
      </dl>
    </div>

    <div class="flex justify-end">
      <BaseButton variant="soft" size="md" rounded="full" @click="open">
        {{ t('patients.list.card.view', 'View User') }}
      </BaseButton>
    </div>
  </article>
</template>
