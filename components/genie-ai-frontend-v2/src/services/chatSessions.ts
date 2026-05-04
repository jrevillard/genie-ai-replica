import { api } from './http';

export interface CreateChatSessionResponse {
  sessionId: string;
}

export interface ChatMessageContext {
  categoryLabel?: string;
  serviceLabels?: string[];
  language?: string;
}

export interface SendChatMessagePayload {
  text: string;
  context?: ChatMessageContext;
}

export interface SendChatMessageResponse {
  queryId?: string;
  sessionId?: string;
  response?: string;
  responseTime?: number;
  metadata?: {
    source_documents?: unknown[];
    confidence_score?: number;
  };
}

export type ChatSessionType = 'chat' | 'whatsapp';

export interface ChatSessionRecord {
  _key: string;
  userId: string;
  type: ChatSessionType;
  phoneNumber?: string | null;
  twinId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListChatSessionsParams {
  type?: ChatSessionType;
  scope?: 'me' | 'all';
  phoneNumber?: string;
  limit?: number;
  offset?: number;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant' | string;
  content: string;
  createdAt?: string;
}

export interface ChatSessionMessagesResponse {
  session: ChatSessionRecord;
  messages: ChatHistoryMessage[];
}

export interface GetChatSessionMessagesParams {
  limit?: number;
  q?: string;
}

export interface DeleteChatSessionResponse {
  deletedMessages: number;
}

export async function createChatSession(twinId: string): Promise<string> {
  const res = await api.post<CreateChatSessionResponse>('/chat-sessions', { twinId });
  return res.data.sessionId;
}

export async function sendChatMessage(
  sessionId: string,
  payload: SendChatMessagePayload
): Promise<string> {
  const res = await api.post<SendChatMessageResponse>(
    `/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
    payload
  );
  return res.data?.response ?? '';
}

export async function listChatSessions(
  params: ListChatSessionsParams = {}
): Promise<ChatSessionRecord[]> {
  const query: Record<string, string | number> = {
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  };
  if (params.type) query.type = params.type;
  if (params.scope) query.scope = params.scope;
  if (params.phoneNumber) query.phoneNumber = params.phoneNumber;

  const res = await api.get<ChatSessionRecord[]>('/chat-sessions', { params: query });
  return res.data;
}

export async function getChatSessionMessages(
  sessionId: string,
  params: GetChatSessionMessagesParams = {}
): Promise<ChatSessionMessagesResponse> {
  const query: Record<string, string | number> = { limit: params.limit ?? 500 };
  if (params.q) query.q = params.q;
  const res = await api.get<ChatSessionMessagesResponse>(
    `/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
    { params: query }
  );
  return res.data;
}

export async function deleteChatSession(sessionId: string): Promise<DeleteChatSessionResponse> {
  const res = await api.delete<DeleteChatSessionResponse>(
    `/chat-sessions/${encodeURIComponent(sessionId)}`
  );
  return res.data;
}
