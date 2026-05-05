import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { i18n } from '../i18n';

const STORAGE_KEY = 'user';

interface StoredSession {
  accessToken?: string;
  refreshToken?: string;
  [k: string]: unknown;
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function resolveBaseUrl(): string {
  return window.APP_CONFIG?.apiUrl || '/api';
}

// Single axios instance shared by all services. Mirrors httpService.js:
// - Bearer token from localStorage 'user' key (same key as the existing app, so SSO is automatic)
// - 401 retry with /auth/refresh-token, deduplicated across concurrent requests
// - On refresh failure, clear session and redirect to /signin
const api: AxiosInstance = axios.create({
  baseURL: resolveBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
});

let refreshInFlight: Promise<string> | null = null;

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const session = readSession();
  if (session?.accessToken) {
    config.headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  // For FormData bodies, drop the default JSON content-type so the browser
  // can set `multipart/form-data; boundary=...` itself. Otherwise the server
  // can't parse the upload and rejects it as "No file uploaded".
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  // Tell the backend which UI language is active so any localized response
  // strings (errors, emails) match what the user sees.
  const locale = i18n.global.locale.value;
  if (locale && !config.headers.has('Accept-Language')) {
    config.headers.set('Accept-Language', locale);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (!original || status !== 401 || original._retried) {
      return Promise.reject(error);
    }

    // Don't try to refresh on auth endpoints themselves — that path leads to loops.
    // /auth/change-password also returns 401 when the user supplies the wrong
    // current password; that is a validation error, not an auth-session failure.
    const url = (original.url ?? '').toString();
    if (
      url.includes('/auth/login') ||
      url.includes('/auth/refresh-token') ||
      url.includes('/auth/register') ||
      url.includes('/auth/change-password')
    ) {
      return Promise.reject(error);
    }

    const session = readSession();
    if (!session) {
      // No session at all — caller is browsing as a guest on a public page.
      // Don't redirect; let the caller handle the 401 (e.g. fall back to a
      // public surface, or show its own error state).
      return Promise.reject(error);
    }
    if (!session.refreshToken) {
      clearSession();
      redirectToSignIn();
      return Promise.reject(error);
    }

    try {
      const newAccessToken = await getOrStartRefresh(session.refreshToken);
      original._retried = true;
      original.headers = original.headers ?? {};
      (original.headers as Record<string, string>).Authorization = `Bearer ${newAccessToken}`;
      return api.request(original);
    } catch (refreshError) {
      clearSession();
      redirectToSignIn();
      return Promise.reject(refreshError);
    }
  }
);

async function getOrStartRefresh(refreshToken: string): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await axios.post(
        `${resolveBaseUrl()}/auth/refresh-token`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } }
      );
      const session = readSession() ?? {};
      const updated: StoredSession = {
        ...session,
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken ?? session.refreshToken,
      };
      writeSession(updated);
      return updated.accessToken as string;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function redirectToSignIn(): void {
  if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/signin')) {
    window.location.href = '/signin?error=session_expired';
  }
}

export { api, readSession, writeSession, clearSession, STORAGE_KEY };
