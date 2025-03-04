<!-- src/components/NavBarComponent.vue -->
<template>
  <header class="nav-bar">
    <div class="nav-left">
      <!-- Hamburger toggles sidebar -->
      <button class="icon-btn" @click="$emit('toggleSidebar')">
        <img
          :alt="$t('nav.menu')"
          src="@/assets/menu.svg"
        />
      </button>

      <img
        class="brand-logo"
        src="@/assets/brand-logo.png"
        :alt="$t('brandName')"
      />
      <h1 class="brand-name">{{ $t('brandName') }}</h1>
    </div>

    <div class="nav-center">
      <select v-model="$i18n.locale" class="lang-select">
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="sw">Kiswahili</option>
      </select>
    </div>

    <div class="nav-right">
      <!-- Analytics -->
      <button class="icon-btn" @click="showAnalytics = true" :title="$t('nav.analytics')">
        <img
          :alt="$t('nav.analytics')"
          src="@/assets/analytics.svg"
        />
      </button>
      <!-- User profile -->
      <button class="icon-btn" @click="showUserProfile = true" :title="$t('nav.userProfile')">
        <img
          :alt="$t('nav.userProfile')"
          src="@/assets/user.svg"
        />
      </button>
    </div>

    <analytics-component
      v-if="showAnalytics"
      @close="showAnalytics = false"
    />

    <user-profile-component
      v-if="showUserProfile"
      @cancel="showUserProfile = false"
      @save="handleProfileSave"
    />
  </header>
</template>

<script>
import AnalyticsComponent from './AnalyticsComponent.vue'
import UserProfileComponent from './UserProfileComponent.vue'

export default {
  name: 'NavBarComponent',
  components: {
    AnalyticsComponent,
    UserProfileComponent
  },
  data() {
    return {
      showAnalytics: false,
      showUserProfile: false
    }
  },
  methods: {
    handleProfileSave(profileData) {
      console.log('Profile saved:', profileData)
      this.showUserProfile = false
    }
  }
}
</script>

<style scoped>
.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #4E97D1, #3A7DA0);
  color: #fff;
  padding: 0 16px;
  height: 60px;
}

.nav-left {
  display: flex;
  align-items: center;
}

/* Force icon sizes so no global CSS can blow them up */
.icon-btn img {
  width: 24px !important;
  height: 24px !important;
}

.brand-logo {
  width: auto !important;
  height: 40px !important;
  margin-left: 10px;
  margin-right: 10px;
}

.brand-name {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0;
}

.nav-center {
  flex: 1;
  display: flex;
  justify-content: center;
}
.lang-select {
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
  color: #333;
}

.nav-right .icon-btn {
  margin-left: 8px;
  background: #eee;
  color: #333;
  padding: 6px 12px;
  border-radius: 4px;
  border: none;
}
.nav-right .icon-btn:hover {
  background: #ccc;
}
</style>

