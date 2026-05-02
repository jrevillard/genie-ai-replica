import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { readSession } from '../services/http';

const routes: RouteRecordRaw[] = [
  // Default lands on the AI Twins list (post-login home).
  { path: '/', name: 'home', redirect: '/ai-twins' },
  { path: '/dashboard', redirect: '/ai-twins' },

  // Public auth routes.
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

  // Authenticated dashboard.
  {
    path: '/ai-twins',
    name: 'ai-twins',
    component: () => import('../views/AiTwinsListView.vue'),
  },
  {
    path: '/ai-twins/:id',
    name: 'ai-twin-detail',
    component: () => import('../views/AiTwinDetailView.vue'),
  },
  {
    path: '/chat-history',
    name: 'chat-history',
    component: () => import('../views/ChatHistoryView.vue'),
  },
  {
    path: '/knowledge-set',
    name: 'knowledge-set',
    component: () => import('../views/KnowledgeSetView.vue'),
  },
  {
    path: '/statistics',
    name: 'statistics',
    component: () => import('../views/StatisticsView.vue'),
  },

  { path: '/:pathMatch(.*)*', redirect: '/ai-twins' },
];

const router = createRouter({
  history: createWebHistory('/'),
  routes,
});

// TEMPORARY — design mode. Set to `false` to re-enable the auth guard so
// unauthenticated users get bounced to /signin (the production behavior).
const DESIGN_MODE = false;

router.beforeEach((to) => {
  if (DESIGN_MODE) return;

  const isPublic = to.meta.public === true;
  const session = readSession();
  if (!isPublic && !session?.accessToken) {
    return { name: 'signin', query: to.fullPath !== '/signin' ? { redirect: to.fullPath } : undefined };
  }
  if (isPublic && session?.accessToken && (to.name === 'signin' || to.name === 'signup')) {
    return { name: 'ai-twins' };
  }
});

export default router;
