import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { readSession } from '../services/http';
import { useAuthStore } from '../stores/auth';

const routes: RouteRecordRaw[] = [
  // Default lands on the AI Twins surface (post-login home). The actual
  // landing page (admin vs. user) is decided by the global beforeEach guard
  // based on the authenticated user's role.
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
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('../views/ForgotPasswordView.vue'),
    meta: { public: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('../views/ResetPasswordView.vue'),
    meta: { public: true },
  },

  // Authenticated admin dashboard.
  {
    path: '/ai-twins',
    name: 'ai-twins',
    component: () => import('../views/AiTwinsListView.vue'),
    meta: { adminOnly: true },
  },
  {
    path: '/ai-twins/:id',
    name: 'ai-twin-detail',
    component: () => import('../views/AiTwinDetailView.vue'),
    meta: { adminOnly: true },
  },

  // Normal-user dashboard — read-only twin directory + chat surface.
  {
    path: '/my-twins',
    name: 'user-home',
    component: () => import('../views/UserDashboardView.vue'),
    meta: { userOnly: true },
  },
  {
    path: '/my-twins/:id',
    name: 'user-twin-detail',
    component: () => import('../views/UserTwinDetailView.vue'),
    meta: { userOnly: true },
  },
  {
    path: '/chat/:twinId?',
    name: 'chat',
    component: () => import('../views/ChatView.vue'),
    // Standalone, end-user surface. No auth required so shareable session URLs
    // (twinId in path) work for unauthenticated visitors once the public API lands.
    meta: { public: true },
  },
  {
    path: '/call/:twinId?',
    name: 'call',
    component: () => import('../views/CallView.vue'),
    // Standalone voice surface. Same shareability story as /chat.
    meta: { public: true },
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
    meta: { adminOnly: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/ProfileView.vue'),
  },

  { path: '/:pathMatch(.*)*', redirect: '/ai-twins' },
];

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

  // Role-aware landing. We only branch when the auth store has hydrated;
  // otherwise the navigation guard would race the /auth/me call and bounce
  // admins to the user dashboard on hard reload.
  const auth = useAuthStore();
  const hydrated = auth.user !== null;

  if (isPublic && session?.accessToken && (to.name === 'signin' || to.name === 'signup')) {
    return { name: hydrated && auth.isAdmin ? 'ai-twins' : 'user-home' };
  }

  if (!hydrated) return;

  if (to.meta.adminOnly && !auth.isAdmin) {
    return { name: 'user-home' };
  }
  if (to.meta.userOnly && auth.isAdmin) {
    return { name: 'ai-twins' };
  }
});

export default router;
