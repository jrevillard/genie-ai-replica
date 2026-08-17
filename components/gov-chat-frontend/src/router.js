// src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import store from '@/store';
import keycloakAuthService from '@/services/keycloakAuthService';

const routes = [
  {
    path: '/callback',
    name: 'Callback',
    component: () => import('@/views/CallbackView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, showSidebar: true }
  },
  {
    path: '/analytics',
    name: 'Analytics',
    component: () => import('@/components/UnifiedAnalytics.vue'),
    meta: { requiresAuth: true, showSidebar: false }
  },
  {
    path: '/profile',
    name: 'UserProfile',
    component: () => import('@/components/UserProfileComponent.vue'),
    meta: { requiresAuth: true, showSidebar: false }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/components/SettingsComponent.vue'),
    meta: { requiresAuth: true, showSidebar: false }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('@/components/AdminDashboard.vue'),
    meta: { requiresAuth: true, showSidebar: false }
  },
  {
    path: '/admin/tools',
    name: 'AdminTools',
    component: () => import('@/views/AdminToolsView.vue'),
    meta: { requiresAuth: true, showSidebar: false }
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
