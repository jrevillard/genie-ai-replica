// src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '@/views/DashboardView.vue';
import CallbackView from '@/views/CallbackView.vue';
import UserProfileComponent from '@/components/UserProfileComponent.vue';
import UnifiedAnalytics from '@/components/UnifiedAnalytics.vue';
import store from '@/store';
import keycloakAuthService from '@/services/keycloakAuthService';

const routes = [
  {
    path: '/callback',
    name: 'Callback',
    component: CallbackView,
    meta: { requiresAuth: false }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: DashboardView,
    meta: { requiresAuth: true }
  },
  {
    path: '/analytics',
    name: 'Analytics',
    component: UnifiedAnalytics,
    meta: { requiresAuth: true }
  },
  {
    path: '/profile',
    name: 'UserProfile',
    component: UserProfileComponent,
    meta: { requiresAuth: true }
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard'
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// Keycloak OIDC navigation guard
router.beforeEach(async (to) => {
  // Wait for auth initialization before making routing decisions
  if (!store.getters.isAuthInitialized) {
    await store.dispatch('initialize');
  }

  // Public routes (callback) — always allow
  if (to.matched.some((record) => record.meta.requiresAuth === false)) {
    return true;
  }

  // Protected routes — check authentication
  if (!store.getters.isAuthenticated) {
    keycloakAuthService.login({ returnUrl: to.fullPath });
    return false;
  }

  return true;
});

export default router;
