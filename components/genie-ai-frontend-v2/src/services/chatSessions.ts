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
