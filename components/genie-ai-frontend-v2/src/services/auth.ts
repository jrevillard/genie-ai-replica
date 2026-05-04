import { api, writeSession, clearSession } from './http';
import { sha256Hex } from './crypto';

// Endpoint shapes match components/gov-chat-backend/routes/auth-routes.js.
// Passwords are SHA-256 hashed client-side (matches existing frontend behavior).

export interface RegisterPayload {
  loginName: string;
  email: string;
  password: string;
  fullName?: string;
}

export interface LoginPayload {
  loginName: string;
  password: string;
}

export interface PersonalIdentification {
  fullName?: string;
  dob?: string;
  gender?: string;
  nationality?: string;
  maritalStatus?: string;
}

export interface User {
  _key?: string;
  _id?: string;
  loginName?: string;
  email?: string;
  emailVerified?: boolean;
  role?: string;
  avatar?: string;
  personalIdentification?: PersonalIdentification;
}

export interface LoginResponse extends User {
  accessToken: string;
  refreshToken: string;
}

export async function register(payload: RegisterPayload): Promise<{ success: boolean; message: string; user?: User }> {
  const encPassword = await sha256Hex(payload.password);
  const body: Record<string, string> = {
    loginName: payload.loginName,
    email: payload.email,
    encPassword,
  };
  if (payload.fullName) body.fullName = payload.fullName;
  const res = await api.post('/auth/register', body);
  return res.data;
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const encPassword = await sha256Hex(payload.password);
  const res = await api.post<LoginResponse>('/auth/login', {
    loginName: payload.loginName,
    encPassword,
  });
  if (res.data?.accessToken) {
    writeSession(res.data as unknown as Record<string, unknown>);
  }
  return res.data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    clearSession();
  }
}

export async function fetchMe(): Promise<User> {
  const res = await api.get<{ success: boolean; user: User }>('/auth/me');
  return res.data.user;
}

// Backend returns hex tokens via email link (GET /auth/verify-email/:token).
// The Figma 6-digit code UI will pass whatever the user types as `:token`;
// today the backend will reject non-hex codes. This is intentional — the
// link-from-email flow works now, and a code-based variant will land later.
export async function verifyEmail(token: string): Promise<{ success?: boolean; status?: string }> {
  const res = await api.get(`/auth/verify-email/${encodeURIComponent(token)}`);
  return res.data;
}

export async function resendVerification(email: string): Promise<{ success: boolean; message: string }> {
  const res = await api.post('/auth/resend-verification', { email });
  return res.data;
}

export async function requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
  const res = await api.post('/auth/reset-password', { email });
  return res.data;
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const encPassword = await sha256Hex(newPassword);
  const res = await api.post('/auth/reset-password/confirm', { token, newPassword: encPassword });
  return res.data;
}

export async function validateResetToken(token: string): Promise<{ valid: boolean; message?: string }> {
  const res = await api.post('/auth/validate-token', { token });
  return res.data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const [encCurrent, encNew] = await Promise.all([
    sha256Hex(currentPassword),
    sha256Hex(newPassword),
  ]);
  const res = await api.post('/auth/change-password', {
    currentPassword: encCurrent,
    newPassword: encNew,
  });
  return res.data;
}
