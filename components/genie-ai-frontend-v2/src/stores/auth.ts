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
  },
  actions: {
    // Called once at boot. If we have a stored token, validate it via /auth/me.
    // If validation fails, the http interceptor clears the session and redirects.
    async hydrate(): Promise<void> {
      const session = readSession();
      if (!session?.accessToken) return;
      try {
        const me = await authApi.fetchMe();
        this.user = me;
      } catch {
        this.user = null;
      }
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
        const res = await authApi.login(payload);
        // login() already wrote the session; mirror selected fields into the store
        // for reactive access.
        this.user = {
          loginName: res.loginName,
          email: res.email,
          emailVerified: res.emailVerified,
        };
      } catch (err) {
        this.error = extractError(err, 'Login failed');
        throw err;
      } finally {
        this.loading = false;
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
