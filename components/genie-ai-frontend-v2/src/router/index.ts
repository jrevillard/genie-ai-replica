import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { readSession } from '../services/http';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', redirect: '/dashboard' },
  {
    path: '/signup',
    name: 'signup',
    component: () => import('../views/SignUpView.vue'),
    meta: { public: true },
  },
  {
    path: '/signin',
    name: 'signin',
    component: () => import('../views/SignInView.vue'),
    meta: { public: true },
  },
  {
    path: '/verify-email',
    name: 'verify-email',
    component: () => import('../views/VerifyEmailView.vue'),
    meta: { public: true },
  },
  {
    path: '/registration-success',
    name: 'registration-success',
    component: () => import('../views/RegistrationSuccessView.vue'),
    meta: { public: true },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../views/DashboardPlaceholderView.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

// Vite base and Router base must match — see vite.config.ts.
const router = createRouter({
  history: createWebHistory('/'),
  routes,
});

router.beforeEach((to) => {
  const isPublic = to.meta.public === true;
  const session = readSession();
  if (!isPublic && !session?.accessToken) {
    return { name: 'signin', query: to.fullPath !== '/signin' ? { redirect: to.fullPath } : undefined };
  }
  if (isPublic && session?.accessToken && (to.name === 'signin' || to.name === 'signup')) {
    return { name: 'dashboard' };
  }
});

export default router;
