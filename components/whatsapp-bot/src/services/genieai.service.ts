import { request } from "undici";
import { createHash } from "node:crypto";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type {
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  GenieAIUser,
  CreateConversationRequest,
  Conversation,
  ConversationListResponse,
  AddMessageRequest,
  ChatMessage,
  MessageListResponse,
  CreateQueryRequest,
  QueryResponse,
  SubmitFeedbackRequest,
} from "../types/genieai.types.js";

function baseUrl(): string {
  return getConfig().GENIEAI_API_BASE_URL;
}

function timeoutMs(): number {
  return getConfig().GENIEAI_API_TIMEOUT_MS;
}

async function apiRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: {
    body?: unknown;
    token?: string;
    query?: Record<string, string>;
  } = {},
): Promise<T> {
  let url = `${baseUrl()}${path}`;
  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += `?${params.toString()}`;
  }

  const hdrs: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) {
    hdrs["Authorization"] = `Bearer ${options.token}`;
  }

  const { statusCode, body: resBody } = await request(url, {
    method,
    headers: hdrs,
    body: options.body ? JSON.stringify(options.body) : undefined,
    headersTimeout: timeoutMs(),
    bodyTimeout: timeoutMs(),
  });

  const data = (await resBody.json()) as T;

  if (statusCode >= 400) {
    logger.error({ statusCode, path, data }, "Genie AI API error");
    throw new GenieAIApiError(statusCode, path, data);
  }

  return data;
}

export class GenieAIApiError extends Error {
  constructor(
    public statusCode: number,
    public path: string,
    public data: unknown,
  ) {
    super(`Genie AI API ${statusCode} on ${path}`);
    this.name = "GenieAIApiError";
  }
}

// ── Auth ──

export interface RegisterResult {
  userId: string;
  loginName: string;
  encPassword: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Register a user with a real email and password provided by the user.
 * Uses the accessToken from the register response directly.
 */
export async function registerWithPassword(
  loginName: string,
  email: string,
  password: string,
  fullName: string,
  phoneNumber?: string,
): Promise<RegisterResult> {
  // Hash with SHA-256, matching the web frontend's hashPassword() method
  const encPassword = createHash("sha256").update(password).digest("hex");

  const body: RegisterRequest = {
    loginName,
    email,
    encPassword,
    fullName,
  };
  if (phoneNumber) {
    body.phoneNumber = phoneNumber;
  }

  async function doRegister(ln: string): Promise<RegisterResult> {
    body.loginName = ln;
    const registerRes = await apiRequest<RegisterResponse>("POST", "/auth/register", { body });
    logger.info({ userId: registerRes.user._key, loginName: ln }, "User registered on Genie AI backend");

    // Try to get accessToken from register response (requires backend fix to include it).
    // If missing, try logging in (works if email verification is not enforced).
    const token = registerRes.user.accessToken;
    if (token) {
      return { userId: registerRes.user._key, loginName: ln, encPassword, accessToken: token, refreshToken: "" };
    }

    // Fallback: try login. May fail if email verification is required.
    try {
      const loginRes = await login(ln, encPassword);
      return { userId: loginRes._key, loginName: ln, encPassword, accessToken: loginRes.accessToken, refreshToken: loginRes.refreshToken };
    } catch {
      // Last resort: use a placeholder. The user will need to verify email before full functionality.
      logger.warn({ loginName: ln }, "Could not obtain accessToken after registration — using placeholder");
      return { userId: registerRes.user._key, loginName: ln, encPassword, accessToken: "pending-email-verification", refreshToken: "" };
    }
  }

  try {
    return await doRegister(loginName);
  } catch (err) {
    if (err instanceof GenieAIApiError && err.statusCode === 409) {
      const errMsg = (err.data as { message?: string })?.message ?? "";

      if (errMsg.includes("Email already exists")) {
        // The email is taken by a different account — let the user know
        throw new GenieAIApiError(409, "/auth/register", {
          message: "This email address is already registered. Please use a different email, or verify your existing account and log in via the mobile app.",
        });
      }

      // Username (wa_<phone>) already exists — try to login.
      // This handles orphaned registrations where backend succeeded but local DB failed.
      logger.info({ loginName }, "Username already exists on backend, attempting login");
      try {
        const loginRes = await login(loginName, encPassword);
        return { userId: loginRes._key, loginName, encPassword, accessToken: loginRes.accessToken, refreshToken: loginRes.refreshToken };
      } catch (loginErr) {
        if (loginErr instanceof GenieAIApiError && loginErr.statusCode === 403) {
          throw new GenieAIApiError(403, "/auth/login", {
            message: "Your account exists but the email hasn't been verified yet. Please check your inbox for the verification link, then try again.",
          });
        }
        // Wrong password — orphaned account with a different password we can't recover
        throw new GenieAIApiError(409, "/auth/register", {
          message: "An account already exists for this phone number with different credentials. Please contact support for help.",
        });
      }
    }
    throw err;
  }
}

export async function login(
  loginName: string,
  encPassword: string,
): Promise<LoginResponse> {
  const body: LoginRequest = { loginName, encPassword };
  return apiRequest<LoginResponse>("POST", "/auth/login", { body });
}

export async function refreshToken(
  refreshTok: string,
): Promise<RefreshTokenResponse> {
  const body: RefreshTokenRequest = { refreshToken: refreshTok };
  return apiRequest<RefreshTokenResponse>("POST", "/auth/refresh-token", { body });
}

// ── Users ──

export async function getUser(
  userId: string,
  token: string,
): Promise<GenieAIUser> {
  return apiRequest<GenieAIUser>("GET", `/users/${userId}`, { token });
}

export async function updateUser(
  userId: string,
  token: string,
  data: Partial<GenieAIUser>,
): Promise<{ success: boolean; user: GenieAIUser }> {
  return apiRequest<{ success: boolean; user: GenieAIUser }>(
    "PUT",
    `/users/${userId}`,
    { token, body: data },
  );
}

// ── Conversations ──

export async function createConversation(
  token: string,
  data: CreateConversationRequest,
): Promise<Conversation> {
  return apiRequest<Conversation>("POST", "/chat-history/conversations", {
    token,
    body: data,
  });
}

export async function getConversations(
  token: string,
  query: { limit?: string; offset?: string } = {},
): Promise<ConversationListResponse> {
  return apiRequest<ConversationListResponse>(
    "GET",
    "/chat-history/conversations",
    { token, query },
  );
}

export async function addMessage(
  token: string,
  conversationId: string,
  data: AddMessageRequest,
): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(
    "POST",
    `/chat-history/conversations/${conversationId}/messages`,
    { token, body: data },
  );
}

export async function getMessages(
  token: string,
  conversationId: string,
  query: { limit?: string; offset?: string; newestFirst?: string } = {},
): Promise<MessageListResponse> {
  return apiRequest<MessageListResponse>(
    "GET",
    `/chat-history/conversations/${conversationId}/messages`,
    { token, query },
  );
}

// ── Queries ──

export async function createQuery(
  token: string,
  data: CreateQueryRequest,
): Promise<QueryResponse> {
  return apiRequest<QueryResponse>("POST", "/queries", { token, body: data });
}

export async function submitFeedback(
  token: string,
  queryId: string,
  data: SubmitFeedbackRequest,
): Promise<QueryResponse> {
  return apiRequest<QueryResponse>(
    "POST",
    `/queries/${queryId}/feedback`,
    { token, body: data },
  );
}
