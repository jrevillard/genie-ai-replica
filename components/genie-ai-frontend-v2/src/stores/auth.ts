import { defineStore } from 'pinia';
import * as authApi from '../services/auth';
import { clearSession, readSession, writeSession } from '../services/http';
import type { User } from '../services/auth';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    loading: false,
    error: null,
  }),
  getters: {
    isAuthenticated: (state): boolean => {
      const session = readSession();
      return !!state.user || !!session?.accessToken;
    },
    displayName: (state): string =>
      state.user?.personalIdentification?.fullName ||
      state.user?.loginName ||
      state.user?.email ||
      'User',
    email: (state): string => state.user?.email ?? '',
    role: (state): string => state.user?.role ?? '',
  },
  actions: {
    // Called once at boot. If we have a stored token, validate it via /auth/me.
    // If validation fails, the http interceptor clears the session and redirects.
    async hydrate(): Promise<void> {
      const session = readSession();
      if (!session?.accessToken) return;
      await this.fetchCurrentUser();
    },

    async signUp(payload: authApi.RegisterPayload): Promise<{ message: string }> {
      this.loading = true;
      this.error = null;
      try {
        const res = await authApi.register(payload);
        return { message: res.message };
      } catch (err) {
        this.error = extractError(err, 'Registration failed');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async signIn(payload: authApi.LoginPayload): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        await authApi.login(payload);
        // Pull the full profile (role, fullName, etc.) from /auth/me — login()
        // does not return personalIdentification.
        await this.fetchCurrentUser();
      } catch (err) {
        this.error = extractError(err, 'Login failed');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchCurrentUser(): Promise<User | null> {
      try {
        const me = await authApi.fetchMe();
        this.user = me;
        return me;
      } catch {
        this.user = null;
        return null;
      }
    },

    async signOut(): Promise<void> {
      try {
        await authApi.logout();
      } finally {
        this.user = null;
        clearSession();
      }
    },

    async verifyEmail(token: string): Promise<{ success?: boolean; status?: string }> {
      this.loading = true;
      this.error = null;
      try {
        return await authApi.verifyEmail(token);
      } catch (err) {
        this.error = extractError(err, 'Verification failed');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async resendVerification(email: string): Promise<void> {
      await authApi.resendVerification(email);
    },

    persistSession(session: Record<string, unknown>): void {
      writeSession(session);
    },
  },
});

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}
