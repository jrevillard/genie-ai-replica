<template>
  <transition name="crop-alert-slide">
    <div
      v-if="visible"
      class="crop-alert-banner"
      :class="`tier-${alert.tier}`"
      role="alert"
    >
      <div class="crop-alert-icon">
        <i :class="tierIcon"></i>
      </div>
      <div class="crop-alert-body">
        <div class="crop-alert-title">{{ tierLabel }} — Potato</div>
        <div class="crop-alert-message">{{ alert.message }}</div>
        <div v-if="alert.triggers && alert.triggers.length" class="crop-alert-triggers">
          <span v-for="(t, i) in alert.triggers" :key="i" class="crop-alert-trigger-tag">{{ t }}</span>
        </div>
      </div>
      <button class="crop-alert-close" @click="dismiss" :title="'Dismiss'">
        <i class="fas fa-times"></i>
      </button>
    </div>
  </transition>
</template>

<script>
import httpService from '@/services/httpService';

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DISMISS_KEY = 'crop_alert_dismissed_until';

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
        forecast_date: '',
        location: '',
      },
      pollTimer: null,
    };
  },

  computed: {
    tierLabel() {
      return this.alert.tier_label || 'Alert';
    },
    tierIcon() {
      if (this.alert.tier >= 4) return 'fas fa-radiation';
      if (this.alert.tier >= 3) return 'fas fa-exclamation-triangle';
      return 'fas fa-exclamation-circle';
    },
  },

  mounted() {
    this.poll();
    this.pollTimer = setInterval(this.poll, POLL_INTERVAL_MS);
  },

  beforeUnmount() {
    clearInterval(this.pollTimer);
  },

  methods: {
    async poll() {
      // Default to Dhaka for v1; extend to user district preference later
      const location = 'Dhaka';

      if (this.isDismissedRecently()) return;

      try {
        const resp = await httpService.get('weather/potato-risk', { location });
        const data = resp.data;
        if (data && data.tier >= 2) {
          this.alert = data;
          this.visible = true;
        } else {
          this.visible = false;
        }
      } catch (err) {
        // Silently ignore — EWS should never break the main UI
        console.debug('[CropAlertBanner] poll error:', err);
      }
    },

    dismiss() {
      this.visible = false;
      // Suppress re-show for 12 hours
      const until = Date.now() + 12 * 60 * 60 * 1000;
      localStorage.setItem(DISMISS_KEY, String(until));
    },

    isDismissedRecently() {
      const until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
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

.crop-alert-banner.tier-2 {
  background: #fff3cd;
  border-left-color: #f0a500;
  color: #6b4e00;
}

.crop-alert-banner.tier-3 {
  background: #fde8e8;
  border-left-color: #dc3545;
  color: #6e0000;
}

.crop-alert-banner.tier-4 {
  background: #ede0f7;
  border-left-color: #6f42c1;
  color: #3a006f;
}

.crop-alert-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
  margin-top: 2px;
}

.tier-2 .crop-alert-icon { color: #f0a500; }
.tier-3 .crop-alert-icon { color: #dc3545; }
.tier-4 .crop-alert-icon { color: #6f42c1; }

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

/* Slide-in animation */
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

/* Mobile: full-width bar pinned to bottom */
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

  .crop-alert-banner.tier-2 { border-top-color: #f0a500; }
  .crop-alert-banner.tier-3 { border-top-color: #dc3545; }
  .crop-alert-banner.tier-4 { border-top-color: #6f42c1; }
}
</style>
