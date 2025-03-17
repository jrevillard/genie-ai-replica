// src/router.js
import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'
import LoginScreen from '@/components/LoginScreen.vue'
import RegisterScreen from '@/components/RegisterScreen.vue'
import store from '@/store'

import UserProfileComponent from '@/components/UserProfileComponent.vue'
import UnifiedAnalytics from '@/components/UnifiedAnalytics.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: LoginScreen,
    meta: { requiresAuth: false }
  },
  {
    path: '/register',
    name: 'Register',
    component: RegisterScreen,
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
  // redirect root to login if not authenticated, otherwise to dashboard
  {
    path: '/',
    name: 'Root',
    redirect: to => {
      return store.getters.isAuthenticated ? '/dashboard' : '/login'
    }
  },
  // catch-all -> login if not authenticated, otherwise dashboard
  {
    path: '/:pathMatch(.*)*',
    redirect: to => {
      return store.getters.isAuthenticated ? '/dashboard' : '/login'
    }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Authentication navigation guard (more strict implementation)
// Authentication navigation guard (more strict implementation)
router.beforeEach((to, from, next) => {

  console.log('Navigating to:', to.path)
  console.log('Route matched:', to.matched)
  
  // Initialize authentication if not already done
  if (store.state.auth && store.state.auth.user === null) {
    store.dispatch('initAuth')
  }
  
  // Check if the user is authenticated
  const isAuthenticated = store.getters.isAuthenticated
  
  // Check if the route requires authentication
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth !== false)
  
  if (requiresAuth && !isAuthenticated) {
    // Route requires auth but user is not authenticated
    next({ name: 'Login' })
  } else if ((to.path === '/login' || to.path === '/register') && isAuthenticated) {
    // User is authenticated but trying to access login or register page
    next({ name: 'Dashboard' })
  } else {
    // Either route doesn't require auth, or user is authenticated
    next()
  }
})

export default router