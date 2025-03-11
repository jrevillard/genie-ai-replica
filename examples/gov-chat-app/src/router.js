// src/router.js
import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'

//import AnalyticsComponent from '@/components/AnalyticsComponent.vue'
import UserProfileComponent from '@/components/UserProfileComponent.vue'
import UnifiedAnalytics from '@/components/UnifiedAnalytics.vue'

const routes = [
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: DashboardView
  },
  {
    path: '/analytics',
    name: 'Analytics',
    component: UnifiedAnalytics
  },
  {
    path: '/profile',
    name: 'UserProfile',
    component: UserProfileComponent
  },
  // redirect root to /dashboard
  {
    path: '/',
    redirect: '/dashboard'
  },
  // catch-all -> /dashboard
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
