// router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import store from '../store'

// Import the login component
import LoginScreen from '../components/LoginScreen.vue'

// Import your existing route components
// Examples (replace with your actual components):
// import Dashboard from '../views/Dashboard.vue'
// import UserProfile from '../views/UserProfile.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: LoginScreen,
    meta: { requiresAuth: false }
  },
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
      // Redirect to login page
      next({ name: 'Login' })
    } else {
      // User is authenticated, proceed to route
      next()
    }
  } else {
    // If user is already logged in and tries to access login page
    if (to.path === '/login' && store.getters.isAuthenticated) {
      // Redirect to home page
      next({ path: '/' })
    } else {
      // Route doesn't require auth, proceed
      next()
    }
  }
})

export default router