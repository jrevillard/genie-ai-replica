<!-- NavBarComponent.vue -->
<template>
  <header class="nav-bar">
    <div class="nav-left">
      <!-- HAMBURGER: restore toggling the sidebar -->
      <button class="icon-btn" @click="$emit('toggleSidebar')">
        <img src="@/assets/menu.svg" alt="Menu" />
      </button>

      <!-- Brand text or logo (unchanged) -->
      <h1 class="brand-name">{{ $t('brandName') }}</h1>
    </div>

    <!-- Center area: your language dropdown or nothing -->
    <div class="nav-center">
      <select v-model="currentLocale" @change="changeLocale">
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="sw">Kiswahili</option>
      </select>
    </div>

    <!-- Right side: analytics + user profile buttons -->
    <div class="nav-right">
      <button class="icon-btn" @click="$emit('openAnalytics')">
        <img src="@/assets/analytics.svg" alt="Analytics" />
      </button>
      <button class="icon-btn" @click="$emit('openProfile')">
        <img src="@/assets/user.svg" alt="User Profile" />
      </button>
    </div>
  </header>
</template>

<script>
export default {
  name: 'NavBarComponent',
  emits: ['toggleSidebar', 'openAnalytics', 'openProfile'],
  data() {
    return {
      currentLocale: this.$i18n.locale
    }
  },
  methods: {
    changeLocale() {
      this.$i18n.locale = this.currentLocale
    }
  }
}
</script>

<style scoped>
.nav-bar {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #4E97D1, #3A7DA0);
  color: #fff;
  height: 60px;
  padding: 0 16px;
}

.nav-left,
.nav-center,
.nav-right {
  display: flex;
  align-items: center;
}

.nav-center {
  flex: 1;
  justify-content: center;
}

.brand-name {
  margin-left: 12px;
  font-size: 1.2rem;
  font-weight: 600;
}

.icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  margin-left: 8px;
}
.icon-btn img {
  width: 24px;
  height: 24px;
}

/* Language dropdown styling if needed */
select {
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-left: 8px;
  font-size: 0.9rem;
  color: #000;
  background: #fff;
  cursor: pointer;
}
</style>

