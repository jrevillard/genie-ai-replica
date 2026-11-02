// src/router.js
// Router + OIDC navigation guard ported from upstream GenieAI v2.0.1
// (components/gov-chat-frontend/src/router.js). Legacy credential routes
// (/register, /forgot-password, /reset-password, /verify-email,
// /registration-success) are deleted (DEC-3: registration + password reset
// happen on Keycloak's own pages). /pending-approval is a local product
// keep. /login (DEC-32b: Keletso-style, click-to-sign-in) is a branded
// PRE-REDIRECT wrapper — no local credential form (S-1); its Sign-in button
// performs the same keycloakAuthService.login() the guard has always used.
import { createRouter, createWebHistory } from 'vue-router'
import store from '@/store'

import UserProfileComponent from '@/components/UserProfileComponent.vue'
import UnifiedAnalytics from '@/components/UnifiedAnalytics.vue'
import PendingApprovalScreen from '@/components/PendingApprovalScreen.vue'
import LoginScreen from '@/components/LoginScreen.vue'

const routes = [
  {
    path: '/callback',
    name: 'Callback',
    component: () => import('@/views/CallbackView.vue'),
    meta: { requiresAuth: false }
  },
  {
    // DEC-32b: branded wrapper (Keletso style) — public; Sign-in → Keycloak
    path: '/login',
    name: 'Login',
    component: LoginScreen,
    props: route => ({ returnUrl: route.query.returnUrl || '' }),
    meta: { requiresAuth: false }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
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
    // Local product keep: post-registration Pending-approval flow (DEC-3/6)
    path: '/pending-approval',
    name: 'PendingApproval',
    component: PendingApprovalScreen,
    props: route => ({ userEmail: route.query.email || '' }),
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Keycloak OIDC navigation guard
router.beforeEach(async (to) => {
  // Wait for auth initialization before making routing decisions
  if (!store.getters.isAuthInitialized) {
    await store.dispatch('initialize')
  }

  // Public routes (callback, login wrapper, pending-approval) — always allow
  if (to.matched.some((record) => record.meta.requiresAuth === false)) {
    // An already-authenticated user has no business on the login wrapper
    if (to.name === 'Login' && store.getters.isAuthenticated) {
      return { path: '/' }
    }
    return true
  }

  // Protected routes — check authentication. DEC-32b: unauthenticated
  // visitors land on the branded wrapper (Sign-in performs the OIDC
  // redirect) instead of an immediate bounce to the stock Keycloak page.
  if (!store.getters.isAuthenticated) {
    return { name: 'Login', query: { returnUrl: to.fullPath } }
  }

  return true
})

export default router
