<template>
  <div class="crop-alert-stack">
    <!-- General / district notices from admin or engine broadcasts (same message the Android app gets via FCM) -->
    <transition-group name="crop-alert-slide" tag="div">
      <div v-for="n in visibleNotices" :key="n.id" class="crop-alert-banner type-notice" role="status">
        <div class="crop-alert-icon" aria-hidden="true">{{ '\u{1F4E2}' }}</div>
        <div class="crop-alert-body">
          <div class="crop-alert-title">
            {{ noticeText(n, 'title') }}
            <span class="crop-alert-scope">
              · {{ n.districts.length ? n.districts.join(', ') : $t('cropAlert.allAreas') }}
            </span>
          </div>
          <div class="crop-alert-message">{{ noticeText(n, 'body') }}</div>
        </div>
        <button
          class="crop-alert-close"
          type="button"
          :title="$t('cropAlert.dismiss')"
          :aria-label="$t('cropAlert.dismiss')"
          @click="dismissNotice(n)"
        >
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>
    </transition-group>

    <!-- One card per active alert: a crop each, plus drought and flood. -->
    <transition-group name="crop-alert-slide" tag="div">
      <div
        v-for="a in alerts"
        :key="alertKey(a)"
        class="crop-alert-banner"
        :class="[`tier-${a.tier}`, `type-${a._type}`]"
        role="alert"
      >
        <div class="crop-alert-icon" aria-hidden="true">{{ tierGlyph(a) }}</div>
        <div class="crop-alert-body">
          <div class="crop-alert-title">
            {{ alertTypeLabel(a) }} — {{ tierLabel(a) }}
            <span class="crop-alert-scope">· {{ a.location || district }}</span>
          </div>
          <div class="crop-alert-message">{{ a.message }}</div>
          <div v-if="a.triggers && a.triggers.length" class="crop-alert-triggers">
            <span v-for="(t, i) in a.triggers" :key="i" class="crop-alert-trigger-tag">{{ t }}</span>
          </div>
          <a
            v-if="a._type === 'drought' && a.report_filename"
            :href="`/api/weather/drought-report/${a.report_filename}`"
            target="_blank"
            rel="noopener noreferrer"
            class="crop-alert-report-link"
          >
            {{ $t('cropAlert.viewDroughtReport') }}
          </a>
        </div>
        <button
          class="crop-alert-close"
          type="button"
          :title="$t('cropAlert.dismiss')"
          :aria-label="$t('cropAlert.dismiss')"
          @click="dismiss(a)"
        >
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script>
import httpService from '@/services/httpService';
import { DISTRICT_CACHE_KEY, DISTRICT_CACHE_MS, getDefaultLocation } from '@/config/defaultLocation';

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
// Deployment fallback district (DEFAULT_LOCATION via window.APP_CONFIG; Dhaka when unset).
const DEFAULT_DISTRICT = getDefaultLocation().name;
const NOTICE_DISMISSED_KEY = 'mewa_notices_dismissed';
const NOTICE_WINDOW_HOURS = 48;
// Engine alert broadcasts (weather / potato / drought / flood) already appear as the
// risk card; general, admin and official BMD notices become notice cards.
const ENGINE_ALERT_TYPES = /^(weather_warning|[a-z]+_ews)$/;

function dismissKey(type) {
  return `${type}_alert_dismissed_until`;
}

function readDismissedNotices() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTICE_DISMISSED_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(-200) : [];
  } catch {
    return [];
  }
}

// Risk tiers from warning_system_engine (models.TIER_LABELS) -> i18n keys.
const TIER_KEYS = ['normal', 'advisory', 'warning', 'severe', 'emergency'];

export default {
  name: 'CropAlertBanner',

  data() {
    return {
      // Active alerts, worst first: one per crop ('crop'), plus drought and flood.
      alerts: [],
      pollTimer: null,
      // District whose alerts this browser shows: nearest to the geolocation,
      // cached for a day; the configured default until the location is known or when refused.
      district: DEFAULT_DISTRICT,
      notices: [],
      dismissedNotices: readDismissedNotices()
    };
  },

  computed: {
    /** UI locale, lower-case (e.g. "en", "bn"); drives label keys and the API lang param. */
    uiLocale() {
      return String(this.$i18n?.locale || 'en').toLowerCase();
    },
    visibleNotices() {
      return this.notices.filter((n) => !this.dismissedNotices.includes(n.id));
    }
  },

  watch: {
    // Re-fetch in the new language when the user switches locale.
    uiLocale() {
      this.poll();
    }
  },

  async mounted() {
    await this.resolveDistrict();
    this.poll();
    this.pollTimer = setInterval(this.poll, POLL_INTERVAL_MS);
    window.addEventListener('focus', this.poll);
    document.addEventListener('visibilitychange', this.pollWhenVisible);
  },

  beforeUnmount() {
    clearInterval(this.pollTimer);
    window.removeEventListener('focus', this.poll);
    document.removeEventListener('visibilitychange', this.pollWhenVisible);
  },

  methods: {
    /** Stable v-for key: the crop name for crop alerts, the channel otherwise. */
    alertKey(a) {
      return a._type === 'crop' ? `crop:${a.crop || ''}` : a._type;
    },

    /** Dismissal is per crop, so silencing eggplant leaves rice aman showing. */
    dismissTarget(a) {
      return a._type === 'crop' ? a.crop || 'crop' : a._type;
    },

    tierLabel(a) {
      const key = TIER_KEYS[a.tier];
      const translated = key ? this.$t(`cropAlert.tier.${key}`) : '';
      return translated && translated !== `cropAlert.tier.${key}` ? translated : a.tier_label || 'Alert';
    },

    alertTypeLabel(a) {
      const fixed = { drought: 'cropAlert.drought', flood: 'cropAlert.flood' }[a._type];
      if (fixed) return this.$t(fixed);
      // Crop alerts name the crop the engine assessed (eggplant, rice_aman, …).
      // Untranslated crops fall back to their prettified name rather than a key.
      const crop = String(a.crop || '');
      if (!crop) return this.$t('cropAlert.crop');
      const key = `cropAlert.${crop}`;
      const translated = this.$t(key);
      return translated !== key ? translated : crop.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    },

    // Plain glyphs: the app does not ship an icon font.
    tierGlyph(a) {
      if (a._type === 'flood') return '\u{1F30A}'; // water wave
      if (a.tier >= 3) return '\u26A0'; // warning sign
      if (a._type === 'drought') return '\u2600'; // sun
      return '\u2757'; // exclamation
    },

    pollWhenVisible() {
      if (!document.hidden) {
        this.poll();
      }
    },

    /**
     * Map the browser location to the nearest district (backend lookup) and
     * cache it. Any failure - no geolocation API, permission refused, offline,
     * outside Bangladesh - keeps the default so the banner still works.
     */
    async resolveDistrict() {
      try {
        const cached = JSON.parse(localStorage.getItem(DISTRICT_CACHE_KEY) || 'null');
        if (cached?.district && Date.now() - (cached.at || 0) < DISTRICT_CACHE_MS) {
          this.district = cached.district;
          return;
        }
      } catch {
        // ignore a corrupt cache entry
      }
      if (typeof navigator === 'undefined' || !navigator.geolocation) return;
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 600000 })
        );
        const { latitude: lat, longitude: lon } = pos.coords;
        const resp = await httpService.get('weather/nearest-district', { lat, lon });
        const district = resp?.data?.district;
        if (district) {
          this.district = district;
          localStorage.setItem(DISTRICT_CACHE_KEY, JSON.stringify({ district, at: Date.now() }));
        }
      } catch (err) {
        console.debug('[CropAlertBanner] district resolution skipped:', err?.message || err);
      }
    },

    async poll() {
      const location = this.district || DEFAULT_DISTRICT;
      const lang = this.uiLocale;

      try {
        const [potatoResult, droughtResult, noticesResult, floodResult] = await Promise.allSettled([
          httpService.get('weather/potato-risk', { location, lang }),
          httpService.get('weather/drought-risk', { location, lang }),
          httpService.get('notifications/latest', { district: location, hours: NOTICE_WINDOW_HOURS, limit: 3 }),
          httpService.get('weather/flood-risk', { location, lang })
        ]);
        const flood = floodResult.status === 'fulfilled' ? floodResult.value.data : null;

        const potato = potatoResult.status === 'fulfilled' ? potatoResult.value.data : null;
        const drought = droughtResult.status === 'fulfilled' ? droughtResult.value.data : null;
        if (noticesResult.status === 'fulfilled') {
          const list = noticesResult.value?.data?.notices;
          // Engine weather warnings are already shown as the risk alert below;
          // the notice cards are for everything else (general / admin messages).
          this.notices = (Array.isArray(list) ? list : []).filter(
            (n) => !ENGINE_ALERT_TYPES.test(String(n.type || ''))
          );
        }

        // One card per active alert (tier >= 2, not dismissed): a crop each,
        // plus drought and flood. `crops` carries every crop the engine watches;
        // older responses without it are treated as a single crop alert.
        const cropList =
          Array.isArray(potato?.crops) && potato.crops.length ? potato.crops : potato && potato.crop ? [potato] : [];

        const candidates = [
          ...cropList
            .filter((c) => c && c.tier >= 2 && !this.isDismissedRecently(c.crop || 'crop'))
            .map((c) => ({ ...c, _type: 'crop' })),
          drought && drought.tier >= 2 && !this.isDismissedRecently('drought')
            ? { ...drought, _type: 'drought' }
            : null,
          flood && flood.tier >= 2 && !this.isDismissedRecently('flood') ? { ...flood, _type: 'flood' } : null
        ].filter(Boolean);

        // Worst first; drought wins a tie (it's the newer sensor)
        candidates.sort((a, b) => b.tier - a.tier || (a._type === 'drought' ? -1 : 1));
        this.alerts = candidates;
      } catch (err) {
        // Silently ignore — EWS should never break the main UI
        console.debug('[CropAlertBanner] poll error:', err);
      }
    },

    dismiss(a) {
      const target = this.dismissTarget(a);
      this.alerts = this.alerts.filter((x) => this.alertKey(x) !== this.alertKey(a));
      const until = Date.now() + 12 * 60 * 60 * 1000;
      localStorage.setItem(dismissKey(target), String(until));
    },

    /** Bengali text of a notice when the UI is Bengali and the broadcast carries it (BMD CAP alerts do). */
    noticeText(notice, field) {
      if (this.uiLocale === 'bn' && notice[`${field}_bn`]) return notice[`${field}_bn`];
      return notice[field];
    },

    dismissNotice(notice) {
      this.dismissedNotices = [...this.dismissedNotices, notice.id].slice(-200);
      localStorage.setItem(NOTICE_DISMISSED_KEY, JSON.stringify(this.dismissedNotices));
    },

    isDismissedRecently(type) {
      const until = parseInt(localStorage.getItem(dismissKey(type)) || '0', 10);
      return Date.now() < until;
    }
  }
};
</script>

<style scoped>
.crop-alert-stack {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
}

.crop-alert-scope {
  font-weight: 500;
  opacity: 0.8;
}

.crop-alert-banner.type-flood.tier-2 {
  background: #e3f0fb;
  border-left-color: #1976d2;
  color: #0d3c61;
}
.crop-alert-banner.type-flood.tier-3,
.crop-alert-banner.type-flood.tier-4 {
  background: #dbe9f8;
  border-left-color: #0d47a1;
  color: #082a4a;
}
.type-flood .crop-alert-icon {
  color: #1565c0;
}

.crop-alert-banner.type-notice {
  background: #e8f1f7;
  border-left-color: #1f4a5e;
  color: #143544;
}
.type-notice .crop-alert-icon {
  color: #1f4a5e;
}

.crop-alert-banner {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  max-width: 420px;
  min-width: 300px;
  padding: 16px 18px;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  background: #fff3cd;
  border-left: 5px solid #ffc107;
  color: #6b4e00;
  font-size: 0.9rem;
}

/* ── Potato tiers ── */
.crop-alert-banner.type-crop.tier-2 {
  background: #fff3cd;
  border-left-color: #f0a500;
  color: #6b4e00;
}
.crop-alert-banner.type-crop.tier-3 {
  background: #fde8e8;
  border-left-color: #dc3545;
  color: #6e0000;
}
.crop-alert-banner.type-crop.tier-4 {
  background: #ede0f7;
  border-left-color: #6f42c1;
  color: #3a006f;
}

/* ── Drought tiers ── */
.crop-alert-banner.type-drought.tier-2 {
  background: #fff8e1;
  border-left-color: #ef6c00;
  color: #7a3600;
}
.crop-alert-banner.type-drought.tier-3 {
  background: #fbe9e7;
  border-left-color: #b71c1c;
  color: #5c0000;
}

/* ── Icons ── */
.crop-alert-icon {
  font-size: 1.4rem;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.type-crop.tier-2 .crop-alert-icon {
  color: #f0a500;
}
.type-crop.tier-3 .crop-alert-icon {
  color: #dc3545;
}
.type-crop.tier-4 .crop-alert-icon {
  color: #6f42c1;
}
.type-drought.tier-2 .crop-alert-icon {
  color: #ef6c00;
}
.type-drought.tier-3 .crop-alert-icon {
  color: #b71c1c;
}

.crop-alert-body {
  flex: 1;
}

.crop-alert-title {
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 4px;
}

.crop-alert-message {
  line-height: 1.4;
}

.crop-alert-triggers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.crop-alert-trigger-tag {
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 0.78rem;
}

.crop-alert-report-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  color: inherit;
  text-decoration: underline;
  opacity: 0.85;
}

.crop-alert-report-link:hover {
  opacity: 1;
}

.crop-alert-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  cursor: pointer;
  opacity: 0.8;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
  color: inherit;
  transition:
    opacity 0.15s,
    background 0.15s;
}

.crop-alert-close:hover,
.crop-alert-close:focus-visible {
  opacity: 1;
  background: rgba(0, 0, 0, 0.12);
  outline: none;
}

/* ── Slide-in animation ── */
.crop-alert-slide-enter-active {
  transition: all 0.35s ease;
}
.crop-alert-slide-leave-active {
  transition: all 0.25s ease;
}
.crop-alert-slide-enter-from,
.crop-alert-slide-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* ── Mobile: full-width bar pinned to bottom ── */
@media screen and (max-width: 600px) {
  /* In the page flow (App.vue renders the stack between the navbar and the chat),
     so an alert pushes the chat down instead of covering the input at the bottom.
     Fixed-bottom banners hid the send button on phones. */
  .crop-alert-stack {
    position: static;
    align-items: stretch;
    gap: 6px;
    padding: 6px 8px 0;
    max-height: 40vh;
    max-height: 40dvh;
    overflow-y: auto;
  }

  .crop-alert-banner {
    max-width: 100%;
    min-width: 0;
    padding: 10px 12px;
    gap: 10px;
    border-radius: 8px;
    font-size: 0.85rem;
  }
}
</style>
