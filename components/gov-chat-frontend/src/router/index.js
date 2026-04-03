// router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import store from '../store'

const routes = [
  {
    path: '/',
    name: 'Home',
    // Use your main dashboard or home component here
    // component: Dashboard,
    component: () => import('../views/Dashboard.vue'), // Lazy-loaded
    meta: { requiresAuth: true }
  },
  // Add your existing routes here
  // {
  //   path: '/profile',
  //   name: 'Profile',
  //   component: UserProfile,
  //   meta: { requiresAuth: true }
  // },
  
  // Catch-all route for 404
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes
})

// Navigation guard to check authentication
router.beforeEach((to, from, next) => {
  // Initialize authentication if not already done
  if (store.state.auth.user === null) {
    store.dispatch('initAuth')
  }

  // Check if the route requires authentication
  if (to.matched.some(record => record.meta.requiresAuth)) {
    // Check if user is authenticated
    if (!store.getters.isAuthenticated) {
      // Redirect to home page (Keycloak handles login)
      next({ path: '/' })
    } else {
      // User is authenticated, proceed to route
      next()
    }
  } else {
    // Route doesn't require auth, proceed
    next()
  }
})

export default router