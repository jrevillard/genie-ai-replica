<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useT } from '../../i18n/composables';

interface Props {
  /** ISO yyyy-mm-dd. Empty string when no value. */
  modelValue?: string;
  label?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string | null;
  /** Inclusive lower bound, ISO yyyy-mm-dd. */
  min?: string;
  /** Inclusive upper bound, ISO yyyy-mm-dd. */
  max?: string;
}

const props = withDefaults(defineProps<Props>(), { placeholder: 'dd/mm/yyyy' });

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const { t } = useT();

// ── Date helpers ──────────────────────────────────────────────────────────
function parse(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const selected = computed(() => parse(props.modelValue));

const displayValue = computed(() => {
  const d = selected.value;
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
});

// ── Popup state ───────────────────────────────────────────────────────────
// The calendar renders inline (absolutely positioned under the trigger) so
// it inherits the parent stacking context. That avoids the cross-portal
// focus / outside-click conflicts that show up when the trigger lives inside
// a drawer or dialog.
const open = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);
const popupRef = ref<HTMLElement | null>(null);
const view = ref<'days' | 'years'>('days');
// 'bottom' = popup hangs below the trigger; 'top' = it flips up. Recomputed
// every time the picker opens so it works inside scrolled drawers.
const placement = ref<'bottom' | 'top'>('bottom');
// 'left' = popup aligns to trigger's left edge; 'right' = aligns to right
// edge. Flipped when there's not enough viewport space on the right (e.g.
// the "To" picker inside a right-anchored popup).
const align = ref<'left' | 'right'>('left');
const POPUP_HEIGHT = 360;
const POPUP_WIDTH = 310;

// Cursor = which month/year the popup is currently rendering. Defaults to
// the selected date (or today) every time the popup opens.
const cursor = ref<Date>(selected.value ?? new Date());

function show(): void {
  if (props.disabled) return;
  cursor.value = selected.value ?? new Date();
  view.value = 'days';
  // Pick top vs bottom based on viewport space below the trigger. If there's
  // not enough room below but more above, flip up.
  const el = wrapperRef.value;
  if (el) {
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    placement.value = spaceBelow < POPUP_HEIGHT && spaceAbove > spaceBelow ? 'top' : 'bottom';
    // Same idea horizontally: if a left-aligned popup would overflow the
    // viewport on the right, anchor it to the trigger's right edge instead.
    const spaceRight = window.innerWidth - r.left;
    align.value = spaceRight < POPUP_WIDTH ? 'right' : 'left';
  } else {
    placement.value = 'bottom';
    align.value = 'left';
  }
  open.value = true;
}
function close(): void {
  open.value = false;
}
function toggle(): void {
  if (open.value) close();
  else show();
}

function onDocClick(e: MouseEvent): void {
  const tgt = e.target as Node;
  if (wrapperRef.value?.contains(tgt)) return;
  if (popupRef.value?.contains(tgt)) return;
  close();
}
function onKey(e: KeyboardEvent): void {
  if (!open.value) return;
  if (e.key === 'Escape') close();
}

watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  window.removeEventListener('keydown', onKey);
});

// ── Calendar grid ─────────────────────────────────────────────────────────
const weekdays = computed(() => [
  t('common.weekday.mon', 'Mo'),
  t('common.weekday.tue', 'Tu'),
  t('common.weekday.wed', 'We'),
  t('common.weekday.thu', 'Th'),
  t('common.weekday.fri', 'Fr'),
  t('common.weekday.sat', 'Sa'),
  t('common.weekday.sun', 'Su'),
]);

interface DayCell {
  date: Date;
  outside: boolean;
  isToday: boolean;
  isSelected: boolean;
  disabled: boolean;
}

const days = computed<DayCell[]>(() => {
  const c = cursor.value;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  // Monday-first week. JS Sunday=0, so shift.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sel = selected.value;
  const min = parse(props.min);
  const max = parse(props.max);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      outside: d.getMonth() !== c.getMonth(),
      isToday: sameDay(d, today),
      isSelected: !!sel && sameDay(d, sel),
      disabled: (min ? d < min : false) || (max ? d > max : false),
    });
  }
  return cells;
});

const monthLabel = computed(() =>
  cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
);

const yearGrid = computed(() => {
  const y = cursor.value.getFullYear();
  const start = y - (y % 10) - 1;
  return Array.from({ length: 12 }, (_, i) => start + i);
});
const decadeLabel = computed(() => {
  const y = cursor.value.getFullYear();
  const start = y - (y % 10);
  return `${start} – ${start + 9}`;
});

function prevMonth(): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() - 1, 1);
}
function nextMonth(): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 1);
}
function prevDecade(): void {
  cursor.value = new Date(cursor.value.getFullYear() - 10, cursor.value.getMonth(), 1);
}
function nextDecade(): void {
  cursor.value = new Date(cursor.value.getFullYear() + 10, cursor.value.getMonth(), 1);
}

function pickDay(cell: DayCell): void {
  if (cell.disabled) return;
  emit('update:modelValue', fmtIso(cell.date));
  close();
}
function pickYear(y: number): void {
  cursor.value = new Date(y, cursor.value.getMonth(), 1);
  view.value = 'days';
}
function pickToday(): void {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  emit('update:modelValue', fmtIso(t));
  close();
}
function clearValue(): void {
  emit('update:modelValue', '');
  close();
}

const triggerClass = computed(() => [
  'flex h-11 w-full items-center justify-between gap-2 rounded-full border bg-surface px-4 text-body transition',
  props.error
    ? 'border-danger/40 focus:ring-2 focus:ring-danger/40'
    : 'border-border hover:border-slate-300 focus:border-accent focus:ring-2 focus:ring-accent/30',
  props.disabled ? 'cursor-not-allowed bg-surface-muted text-text-muted' : 'cursor-pointer',
  open.value && !props.error && 'border-accent ring-2 ring-accent/30',
]);
</script>

<template>
  <div ref="wrapperRef" class="relative">
    <label v-if="label" :for="id" class="mb-1.5 block text-body font-medium text-text">
      {{ label }}
    </label>

    <button
      :id="id"
      type="button"
      :class="triggerClass"
      :disabled="disabled"
      :aria-haspopup="'dialog'"
      :aria-expanded="open"
      @click="toggle"
    >
      <span :class="['truncate', !displayValue && 'text-text-muted']">
        {{ displayValue || placeholder }}
      </span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        class="h-4 w-4 shrink-0 text-text-muted"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path stroke-linecap="round" d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    </button>

    <p v-if="error" class="mt-1 pl-2 text-meta text-danger">{{ error }}</p>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1 scale-95"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-1 scale-95"
    >
      <div
        v-if="open"
        ref="popupRef"
        role="dialog"
        :class="[
          'absolute z-50 w-[310px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.12)]',
          align === 'left' ? 'left-0 right-auto' : 'right-0 left-auto',
          placement === 'bottom' ? 'top-full mt-2 origin-top' : 'bottom-full mb-2 origin-bottom',
        ]"
      >
          <!-- Header -->
          <header class="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              class="grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-slate-100 hover:text-text"
              :aria-label="t('common.previous', 'Previous')"
              @click="view === 'days' ? prevMonth() : prevDecade()"
            >
              <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m12 5-5 5 5 5" />
              </svg>
            </button>

            <button
              type="button"
              class="rounded-full px-3 py-1.5 text-body font-semibold text-text transition hover:bg-slate-100"
              @click="view = view === 'days' ? 'years' : 'days'"
            >
              {{ view === 'days' ? monthLabel : decadeLabel }}
            </button>

            <button
              type="button"
              class="grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-slate-100 hover:text-text"
              :aria-label="t('common.next', 'Next')"
              @click="view === 'days' ? nextMonth() : nextDecade()"
            >
              <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m8 5 5 5-5 5" />
              </svg>
            </button>
          </header>

          <!-- Day view -->
          <div v-if="view === 'days'">
            <div class="mb-1 grid grid-cols-7 gap-1 px-1 text-center text-meta font-semibold text-text-muted">
              <span v-for="w in weekdays" :key="w">{{ w }}</span>
            </div>
            <div class="grid grid-cols-7 gap-1">
              <button
                v-for="(c, i) in days"
                :key="i"
                type="button"
                :disabled="c.disabled"
                :class="[
                  'grid h-9 place-items-center rounded-full text-body transition',
                  c.disabled && 'cursor-not-allowed text-slate-300',
                  !c.disabled && c.isSelected && 'bg-accent text-white shadow-sm',
                  !c.disabled && !c.isSelected && c.outside && 'text-slate-300 hover:bg-slate-100',
                  !c.disabled && !c.isSelected && !c.outside && 'text-text hover:bg-slate-100',
                  !c.isSelected && c.isToday && 'ring-1 ring-inset ring-accent',
                ]"
                @click="pickDay(c)"
              >
                {{ c.date.getDate() }}
              </button>
            </div>
          </div>

          <!-- Year view -->
          <div v-else class="grid grid-cols-3 gap-1.5">
            <button
              v-for="(y, i) in yearGrid"
              :key="y"
              type="button"
              :class="[
                'grid h-10 place-items-center rounded-xl text-body transition',
                i === 0 || i === 11 ? 'text-slate-300' : 'text-text',
                cursor.getFullYear() === y
                  ? 'bg-accent text-white'
                  : 'hover:bg-slate-100',
              ]"
              @click="pickYear(y)"
            >
              {{ y }}
            </button>
          </div>

          <!-- Footer -->
          <footer class="mt-3 flex items-center justify-between border-t border-slate-100 px-1 pt-3 text-body">
            <button
              type="button"
              class="font-semibold text-accent transition hover:text-accent-hover"
              @click="clearValue"
            >
              {{ t('common.clear', 'Clear') }}
            </button>
            <button
              type="button"
              class="font-semibold text-accent transition hover:text-accent-hover"
              @click="pickToday"
            >
              {{ t('common.today', 'Today') }}
            </button>
        </footer>
      </div>
    </Transition>
  </div>
</template>
