import { defineStore } from 'pinia';
import * as authApi from '../services/auth';
import { clearSession, readSession, writeSession } from '../services/http';
import type { PersonalIdentification, User } from '../services/auth';

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
    isAdmin: (state): boolean => state.user?.role === 'Admin',
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

    async requestPasswordReset(email: string): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        await authApi.requestPasswordReset(email);
      } catch (err) {
        this.error = extractError(err, 'Failed to send reset instructions');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    // Maps the four documented HTTP outcomes (200 / 400 / 409 / 410) onto a
    // discriminated UI state so the view can render distinct copy without
    // sniffing axios errors itself.
    async validateResetToken(token: string): Promise<ResetTokenStatus> {
      this.loading = true;
      this.error = null;
      try {
        await authApi.validateResetToken(token);
        return { status: 'valid' };
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 410) return { status: 'expired', message: 'This reset link has expired.' };
        if (status === 409) return { status: 'used', message: 'This reset link has already been used.' };
        return { status: 'invalid', message: 'This reset link is not valid.' };
      } finally {
        this.loading = false;
      }
    },

    async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        await authApi.confirmPasswordReset(token, newPassword);
      } catch (err) {
        this.error = extractError(err, 'Failed to reset password');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        await authApi.changePassword(currentPassword, newPassword);
      } catch (err) {
        this.error = extractError(err, 'Failed to change password');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async updateProfile(pid: PersonalIdentification): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const updated = await authApi.updateProfile(pid);
        // Backend returns the full user doc; mirror fetchCurrentUser shape so
        // displayName/profileFields recompute against the fresh values.
        if (updated) this.user = updated;
      } catch (err) {
        this.error = extractError(err, 'Failed to update profile');
        throw err;
      } finally {
        this.loading = false;
      }
    },

    persistSession(session: Record<string, unknown>): void {
      writeSession(session);
    },
  },
});

export type ResetTokenStatus =
  | { status: 'valid' }
  | { status: 'invalid' | 'used' | 'expired'; message: string };

function extractError(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}
