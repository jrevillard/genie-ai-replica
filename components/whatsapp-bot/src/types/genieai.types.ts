/** Genie AI backend API types — matches actual backend contracts */

// ── Auth ──

export interface RegisterRequest {
  loginName: string;
  email: string;
  encPassword: string;
  fullName?: string;
  phoneNumber?: string; // requires backend enhancement
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  user: {
    _key: string;
    loginName: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
    accessToken: string;
  };
}

export interface LoginRequest {
  loginName: string;
  encPassword: string;
}

export interface LoginResponse {
  success: boolean;
  _key: string;
  loginName: string;
  email: string;
  role: string;
  emailVerified: boolean;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
}

// ── Users ──

export interface GenieAIUser {
  _key: string;
  loginName: string;
  email: string;
  emailVerified: boolean;
  role: string;
  createdAt: string;
  updatedAt: string;
  personalIdentification?: {
    fullName?: string;
    dob?: string;
    gender?: string;
    nationality?: string;
    maritalStatus?: string;
  };
  addressResidency?: {
    currentAddress?: string;
  };
  phoneNumber?: string;
  riskProfile?: RiskProfile;
  preferredNudgeTime?: string;
  registrationChannel?: string;
}

export interface RiskProfile {
  hypertension?: RiskLevel;
  diabetes?: RiskLevel;
  cancer?: RiskLevel;
  respiratory?: RiskLevel;
  mentalHealth?: RiskLevel;
  tobacco?: RiskLevel;
  diet?: RiskLevel;
  physicalActivity?: RiskLevel;
  lastAssessedAt?: string;
}

export type RiskLevel = "none" | "low" | "medium" | "high";

// ── Chat History ──

export interface CreateConversationRequest {
  title: string;
  categoryId?: string;
  initialMessage?: string;
  tags?: string[];
}

export interface Conversation {
  _key: string;
  userId: string;
  title: string;
  categoryId?: string;
  tags?: string[];
  created: string;
  updated: string;
  messageCount: number;
  isStarred: boolean;
  isArchived: boolean;
}

export interface ConversationListResponse {
  conversations: Conversation[];
  total: number;
  limit: number;
  offset: number;
}

export interface AddMessageRequest {
  content: string;
  sender: "user" | "assistant";
  queryId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  _key: string;
  conversationId: string;
  content: string;
  sender: "user" | "assistant";
  userId: string;
  timestamp: string;
  queryId?: string;
  metadata?: Record<string, unknown>;
  readStatus: boolean;
}

export interface MessageListResponse {
  messages: ChatMessage[];
  total: number;
  limit: number;
  offset: number;
}

// ── Queries ──

export interface CreateQueryRequest {
  userId: string;
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context: {
    categoryLabel?: string;
    serviceLabels?: string[];
    language?: string;
  };
  contextOption: "conversation-with-context-labels";
  categoryId?: string;
  serviceId?: string;
  timestamp?: string;
}

export interface QueryResponse {
  _key: string;
  userId: string;
  sessionId: string;
  timestamp: string;
  isAnswered: boolean;
  categoryId?: string;
  serviceId?: string;
  responseTime: number;
  contextOption: string;
  text: string;
  response: string;
  metadata?: {
    source_documents?: SourceDocument[];
    confidence_score?: number;
  };
  feedback?: {
    rating: number;
    comment?: string;
  };
}

export interface SourceDocument {
  document_id?: string;
  url?: string;
  text?: string;
  categoryLabel?: string;
  serviceLabels?: string[];
  score?: number;
}

export interface SubmitFeedbackRequest {
  rating: number;
  comment?: string;
}

// ── API Error ──

export interface GenieAIErrorResponse {
  success: false;
  message: string;
}
