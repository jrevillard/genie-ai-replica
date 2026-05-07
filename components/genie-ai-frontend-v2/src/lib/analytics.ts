// Pure helpers for the Admin Analytics page.
// All formatting decisions live here so charts/tables can stay declarative
// and the date-arithmetic stays unit-test friendly.

export type RangePreset = 'last7' | 'last30' | 'last90' | 'custom';

export interface DateRange {
  from: string;
  to: string;
  preset: RangePreset;
}

// Local-time YYYY-MM-DD. `Date.toISOString()` slices the UTC date and is
// off-by-one for evening users in negative timezones, which silently shifts
// the from/to params back by a day. en-CA always emits ISO format.
export function formatDateISO(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

export function presetToRange(preset: RangePreset, today: Date = new Date()): DateRange {
  const to = new Date(today);
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  if (preset === 'last7') from.setDate(to.getDate() - 6);
  else if (preset === 'last30') from.setDate(to.getDate() - 29);
  else if (preset === 'last90') from.setDate(to.getDate() - 89);
  return { from: formatDateISO(from), to: formatDateISO(to), preset };
}

export function defaultRange(): DateRange {
  return presetToRange('last30');
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return new Intl.NumberFormat('en-US').format(n);
}

export function msToSeconds(ms: number | null | undefined, digits: number = 1): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return (ms / 1000).toFixed(digits);
}

export function secsToMinutes(s: number | null | undefined, digits: number = 1): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  return (s / 60).toFixed(digits);
}

// Compact human-readable duration. `null` → '—'. < 60s → '42s'. else → '5m 12s'.
export function secsToReadable(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const r = total % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

export interface RelativeStrings {
  justNow: string;
  minutesAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  daysAgo: (n: number) => string;
  weeksAgo: (n: number) => string;
  monthsAgo: (n: number) => string;
  yearsAgo: (n: number) => string;
  never: string;
}

// Locale-agnostic, takes formatted strings from the caller so this module stays
// dependency-free. ChatHistoryView uses the same general shape; reuse fine here.
export function formatRelative(iso: string | null | undefined, s: RelativeStrings, now: Date = new Date()): string {
  if (!iso) return s.never;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return s.never;
  const diffMs = now.getTime() - t;
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return s.justNow;
  const min = Math.floor(sec / 60);
  if (min < 60) return s.minutesAgo(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return s.hoursAgo(hr);
  const day = Math.floor(hr / 24);
  if (day < 7) return s.daysAgo(day);
  if (day < 30) return s.weeksAgo(Math.floor(day / 7));
  if (day < 365) return s.monthsAgo(Math.floor(day / 30));
  return s.yearsAgo(Math.floor(day / 365));
}

// Short label for a date range trigger button: "Mar 1 – Mar 31" or
// "Mar 1, 2026 – Apr 1, 2027" when years differ.
export function formatRangeLabel(from: string, to: string, locale: string = 'en'): string {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return `${from} – ${to}`;
  const sameYear = f.getFullYear() === t.getFullYear();
  const fmt = (d: Date) =>
    d.toLocaleDateString(locale, sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(f)} – ${fmt(t)}`;
}

export function formatHourLabel(h: number, locale: string = 'en'): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString(locale, { hour: 'numeric' });
}
