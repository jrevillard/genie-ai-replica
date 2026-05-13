<!-- NotificationSystem.vue -->
<template>
  <div class="notification-container">
    <transition-group name="notification">
      <div 
        v-for="notification in activeNotifications" 
        :key="notification.id"
        :class="['notification', notification.type]"
      >
        <div class="notification-icon">
          <icon-success v-if="notification.type === 'success'" />
          <icon-error v-else-if="notification.type === 'error'" />
          <icon-info v-else-if="notification.type === 'info'" />
          <icon-warning v-else-if="notification.type === 'warning'" />
        </div>
        <div class="notification-content">
          <div class="notification-message">
            {{ notification.message }}
          </div>
        </div>
        <button 
          class="notification-close" 
          @click="removeNotification(notification.id)"
          aria-label="Close"
        >
          &times;
        </button>
        <div 
          class="notification-progress" 
          :style="{ 'animation-duration': `${notification.duration}ms` }"
        ></div>
      </div>
    </transition-group>
  </div>
</template>

<script>
// Simple SVG Icons as components
const IconSuccess = {
  name: 'IconSuccess',
  render(h) {
    return h('svg', {
      attrs: {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '24',
        height: '24',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }
    }, [
      h('path', { attrs: { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' } }),
      h('polyline', { attrs: { points: '22 4 12 14.01 9 11.01' } })
    ])
  }
}

const IconError = {
  name: 'IconError',
  render(h) {
    return h('svg', {
      attrs: {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '24',
        height: '24',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }
    }, [
      h('circle', { attrs: { cx: '12', cy: '12', r: '10' } }),
      h('line', { attrs: { x1: '15', y1: '9', x2: '9', y2: '15' } }),
      h('line', { attrs: { x1: '9', y1: '9', x2: '15', y2: '15' } })
    ])
  }
}

const IconInfo = {
  name: 'IconInfo',
  render(h) {
    return h('svg', {
      attrs: {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '24',
        height: '24',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }
    }, [
      h('circle', { attrs: { cx: '12', cy: '12', r: '10' } }),
      h('line', { attrs: { x1: '12', y1: '16', x2: '12', y2: '12' } }),
      h('line', { attrs: { x1: '12', y1: '8', x2: '12.01', y2: '8' } })
    ])
  }
}

const IconWarning = {
  name: 'IconWarning',
  render(h) {
    return h('svg', {
      attrs: {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '24',
        height: '24',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }
    }, [
      h('path', { attrs: { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' } }),
      h('line', { attrs: { x1: '12', y1: '9', x2: '12', y2: '13' } }),
      h('line', { attrs: { x1: '12', y1: '17', x2: '12.01', y2: '17' } })
    ])
  }
}

export default {
  name: 'NotificationSystem',
  components: {
    IconSuccess,
    IconError,
    IconInfo,
    IconWarning
  },
  data() {
    return {
      notifications: [],
      counter: 0
    }
  },
  computed: {
    activeNotifications() {
      return this.notifications
    }
  },
  methods: {
    addNotification({ type = 'info', message, duration = 5000 }) {
      const id = this.counter++
      
      // Add notification to the stack
      this.notifications.push({
        id,
        type,
        message,
        duration
      })
      
      // Set a timer to auto-remove the notification
      setTimeout(() => {
        this.removeNotification(id)
      }, duration)
      
      return id
    },
    removeNotification(id) {
      const index = this.notifications.findIndex(n => n.id === id)
      if (index !== -1) {
        this.notifications.splice(index, 1)
      }
    },
    // Helper methods for common notification types
    success(message, duration = 5000) {
      return this.addNotification({ type: 'success', message, duration })
    },
    error(message, duration = 5000) {
      return this.addNotification({ type: 'error', message, duration })
    },
    info(message, duration = 5000) {
      return this.addNotification({ type: 'info', message, duration })
    },
    warning(message, duration = 5000) {
      return this.addNotification({ type: 'warning', message, duration })
    }
  }
}
</script>

<style scoped>
.notification-container {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 350px;
  max-width: calc(100vw - 40px);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.notification {
  position: relative;
  display: flex;
  align-items: flex-start;
  padding: 15px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  margin-bottom: 10px;
  overflow: hidden;
  animation: slideIn 0.3s ease-out forwards;
}

.notification.success {
  background: var(--success-bg);
  border-left: 4px solid var(--success);
  color: var(--success);
}

.notification.error {
  background: var(--danger-bg);
  border-left: 4px solid var(--danger);
  color: var(--danger);
}

.notification.info {
  background: var(--info-bg);
  border-left: 4px solid var(--accent);
  color: var(--accent);
}

.notification.warning {
  background: var(--warning-bg);
  border-left: 4px solid var(--warning);
  color: var(--warning);
}

.notification-icon {
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notification-content {
  flex: 1;
}

.notification-message {
  font-size: 0.95rem;
  line-height: 1.4;
}

.notification-close {
  background: transparent;
  border: none;
  color: currentColor;
  opacity: 0.6;
  font-size: 18px;
  cursor: pointer;
  margin-left: 10px;
}

.notification-close:hover {
  opacity: 1;
}

.notification-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: 100%;
  animation: progress linear forwards;
}

.notification.success .notification-progress {
  background: var(--success);
}

.notification.error .notification-progress {
  background: var(--danger);
}

.notification.info .notification-progress {
  background: var(--accent);
}

.notification.warning .notification-progress {
  background: var(--warning);
}

@keyframes progress {
  from { width: 100%; }
  to { width: 0%; }
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* Enter and leave animations for transition-group */
.notification-enter-active, .notification-leave-active {
  transition: all 0.3s;
}

.notification-enter, .notification-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
