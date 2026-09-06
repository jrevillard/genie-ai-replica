<template>
  <transition name="crop-alert-slide">
    <div
      v-if="visible"
      class="crop-alert-banner"
      :class="[`tier-${alert.tier}`, `type-${alertType}`]"
      role="alert"
    >
      <div class="crop-alert-icon">
        <i :class="tierIcon"></i>
      </div>
      <div class="crop-alert-body">
        <div class="crop-alert-title">{{ alertTypeLabel }} — {{ tierLabel }}</div>
        <div class="crop-alert-message">{{ alert.message }}</div>
        <div v-if="alert.triggers && alert.triggers.length" class="crop-alert-triggers">
          <span v-for="(t, i) in alert.triggers" :key="i" class="crop-alert-trigger-tag">{{ t }}</span>
        </div>
        <a
          v-if="alertType === 'drought' && alert.report_filename"
          :href="`/api/weather/drought-report/${alert.report_filename}`"
          target="_blank"
          rel="noopener noreferrer"
          class="crop-alert-report-link"
        >
          <i class="fas fa-file-pdf"></i> View Drought Report
        </a>
      </div>
      <button class="crop-alert-close" @click="dismiss" :title="'Dismiss'">
        <i class="fas fa-times"></i>
      </button>
    </div>
  </transition>
</template>

<script>
import httpService from '@/services/httpService';

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

function dismissKey(type) {
  return `${type}_alert_dismissed_until`;
}

export default {
  name: 'CropAlertBanner',

  data() {
    return {
      visible: false,
      alert: {
        tier: 0,
        tier_label: 'Normal',
        message: '',
        triggers: [],
        location: '',
        report_filename: '',
      },
      alertType: 'potato', // 'potato' | 'drought'
      pollTimer: null,
    };
  },

  computed: {
    tierLabel() {
      return this.alert.tier_label || 'Alert';
    },
    alertTypeLabel() {
      return this.alertType === 'drought' ? 'Drought' : 'Potato';
    },
    tierIcon() {
      if (this.alert.tier >= 4) return 'fas fa-radiation';
      if (this.alert.tier >= 3) return 'fas fa-exclamation-triangle';
      if (this.alertType === 'drought') return 'fas fa-sun';
      return 'fas fa-exclamation-circle';
    },
  },

  mounted() {
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
    pollWhenVisible() {
      if (!document.hidden) {
        this.poll();
      }
    },

    async poll() {
      const location = 'Dhaka';

      try {
        const [potatoResult, droughtResult] = await Promise.allSettled([
          httpService.get('weather/potato-risk', { location }),
          httpService.get('weather/drought-risk', { location }),
        ]);

        const potato = potatoResult.status === 'fulfilled' ? potatoResult.value.data : null;
        const drought = droughtResult.status === 'fulfilled' ? droughtResult.value.data : null;

        // Collect active alerts (tier >= 2) that are not dismissed
        const candidates = [
          potato  && potato.tier  >= 2 && !this.isDismissedRecently('potato')  ? { ...potato,  _type: 'potato'  } : null,
          drought && drought.tier >= 2 && !this.isDismissedRecently('drought') ? { ...drought, _type: 'drought' } : null,
        ].filter(Boolean);

        if (candidates.length === 0) {
          this.visible = false;
          return;
        }

        // Show highest-tier alert; prefer drought when tied (it's the newer sensor)
        candidates.sort((a, b) => b.tier - a.tier || (a._type === 'drought' ? -1 : 1));
        const best = candidates[0];

        this.alertType = best._type;
        this.alert = best;
        this.visible = true;
      } catch (err) {
        // Silently ignore — EWS should never break the main UI
        console.debug('[CropAlertBanner] poll error:', err);
      }
    },

    dismiss() {
      this.visible = false;
      const until = Date.now() + 12 * 60 * 60 * 1000;
      localStorage.setItem(dismissKey(this.alertType), String(until));
    },

    isDismissedRecently(type) {
      const until = parseInt(localStorage.getItem(dismissKey(type)) || '0', 10);
      return Date.now() < until;
    },
  },
};
</script>

<style scoped>
.crop-alert-banner {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
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
.crop-alert-banner.type-potato.tier-2 {
  background: #fff3cd;
  border-left-color: #f0a500;
  color: #6b4e00;
}
.crop-alert-banner.type-potato.tier-3 {
  background: #fde8e8;
  border-left-color: #dc3545;
  color: #6e0000;
}
.crop-alert-banner.type-potato.tier-4 {
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
  flex-shrink: 0;
  margin-top: 2px;
}

.type-potato.tier-2 .crop-alert-icon { color: #f0a500; }
.type-potato.tier-3 .crop-alert-icon { color: #dc3545; }
.type-potato.tier-4 .crop-alert-icon { color: #6f42c1; }
.type-drought.tier-2 .crop-alert-icon { color: #ef6c00; }
.type-drought.tier-3 .crop-alert-icon { color: #b71c1c; }

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
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.55;
  font-size: 1rem;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
  color: inherit;
  transition: opacity 0.15s;
}

.crop-alert-close:hover {
  opacity: 1;
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
  .crop-alert-banner {
    left: 0;
    right: 0;
    bottom: 0;
    max-width: 100%;
    min-width: 0;
    border-radius: 10px 10px 0 0;
    border-left: none;
    border-top: 5px solid #ffc107;
    padding: 14px 16px;
    gap: 12px;
  }

  .type-potato.tier-2  { border-top-color: #f0a500; }
  .type-potato.tier-3  { border-top-color: #dc3545; }
  .type-potato.tier-4  { border-top-color: #6f42c1; }
  .type-drought.tier-2 { border-top-color: #ef6c00; }
  .type-drought.tier-3 { border-top-color: #b71c1c; }
}
</style>
