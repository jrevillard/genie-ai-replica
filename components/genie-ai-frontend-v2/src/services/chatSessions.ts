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
  _key?: string;
  role: 'user' | 'assistant' | string;
  content: string;
  audioUrl?: string | null;
  createdAt?: string;
}

function normalizeChatHistoryMessage(raw: unknown): ChatHistoryMessage {
  if (!raw || typeof raw !== 'object') {
    return { role: 'assistant', content: '' };
  }
  const r = raw as Record<string, unknown>;
  const createdCandidate = r.createdAt ?? r.created_at ?? r.sentAt ?? r.timestamp ?? r.time;
  let createdAt: string | undefined;
  if (typeof createdCandidate === 'string' && createdCandidate.trim()) {
    createdAt = createdCandidate.trim();
  } else if (typeof createdCandidate === 'number' && Number.isFinite(createdCandidate)) {
    createdAt = new Date(createdCandidate).toISOString();
  }

  let role: ChatHistoryMessage['role'] = 'assistant';
  if (r.role === 'user' || r.role === 'assistant') {
    role = r.role;
  } else if (r.sender === 'user' || r.sender === 'assistant') {
    role = r.sender;
  } else if (r.sender === 'human') {
    role = 'user';
  }

  const _key =
    typeof r._key === 'string'
      ? r._key
      : typeof r.id === 'string'
        ? r.id
        : typeof r.messageId === 'string'
          ? r.messageId
          : undefined;

  const content = typeof r.content === 'string' ? r.content : String(r.content ?? '');
  const audioUrl =
    r.audioUrl === null || typeof r.audioUrl === 'string' ? (r.audioUrl as string | null) : null;

  return { _key, role, content, audioUrl, createdAt };
}

export interface SendVoiceMessageOptions {
  language?: string;
  categoryLabel?: string;
  serviceLabels?: string[];
}

export interface SendVoiceMessageResponse {
  sessionId: string;
  userMessage: { id: string; text: string; audioUrl?: string | null };
  assistantMessage: { id: string; text: string };
  responseTime?: number;
  queryId?: string;
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
  const data = res.data;
  return {
    session: data.session,
    messages: (data.messages ?? []).map(normalizeChatHistoryMessage),
  };
}

export async function deleteChatSession(sessionId: string): Promise<DeleteChatSessionResponse> {
  const res = await api.delete<DeleteChatSessionResponse>(
    `/chat-sessions/${encodeURIComponent(sessionId)}`
  );
  return res.data;
}

export async function sendVoiceMessage(
  sessionId: string,
  audio: Blob,
  opts: SendVoiceMessageOptions = {},
): Promise<SendVoiceMessageResponse> {
  const form = new FormData();
  const file = audio instanceof File ? audio : new File([audio], inferAudioFileName(audio), {
    type: audio.type || 'audio/webm',
  });
  form.append('audio', file);
  if (opts.language) form.append('language', opts.language);
  if (opts.categoryLabel) form.append('categoryLabel', opts.categoryLabel);
  if (opts.serviceLabels?.length) form.append('serviceLabels', opts.serviceLabels.join(','));

  const res = await api.post<SendVoiceMessageResponse>(
    `/chat-sessions/${encodeURIComponent(sessionId)}/voice-messages`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data;
}

export async function fetchMessageAudio(
  sessionId: string,
  messageId: string,
): Promise<Blob> {
  const res = await api.get<Blob>(
    `/chat-sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/audio`,
    { responseType: 'blob' },
  );
  return res.data;
}

function inferAudioFileName(blob: Blob): string {
  const type = blob.type || 'audio/webm';
  if (type.includes('webm')) return 'recording.webm';
  if (type.includes('ogg')) return 'recording.ogg';
  if (type.includes('wav')) return 'recording.wav';
  if (type.includes('mp3') || type.includes('mpeg')) return 'recording.mp3';
  if (type.includes('mp4') || type.includes('m4a')) return 'recording.m4a';
  return 'recording.webm';
}

// ============================================================================
// Public (guest) endpoints — limited to the default twin. No auth header.
// ============================================================================

export interface PublicCreateChatSessionResponse {
  sessionId: string;
  guestId: string;
  twinId: string;
  createdAt: string;
}

export async function createPublicChatSession(): Promise<PublicCreateChatSessionResponse> {
  const res = await api.post<PublicCreateChatSessionResponse>('/public/chat-sessions');
  return res.data;
}

export async function sendPublicChatMessage(
  sessionId: string,
  payload: SendChatMessagePayload
): Promise<string> {
  const res = await api.post<SendChatMessageResponse>(
    `/public/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
    payload
  );
  return res.data?.response ?? '';
}

export async function getPublicChatSessionMessages(
  sessionId: string,
  params: GetChatSessionMessagesParams = {}
): Promise<ChatSessionMessagesResponse> {
  const query: Record<string, string | number> = { limit: params.limit ?? 500 };
  if (params.q) query.q = params.q;
  const res = await api.get<ChatSessionMessagesResponse>(
    `/public/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
    { params: query }
  );
  const data = res.data;
  return {
    session: data.session,
    messages: (data.messages ?? []).map(normalizeChatHistoryMessage),
  };
}

export async function sendPublicVoiceMessage(
  sessionId: string,
  audio: Blob,
  opts: SendVoiceMessageOptions = {},
): Promise<SendVoiceMessageResponse> {
  const form = new FormData();
  const file = audio instanceof File ? audio : new File([audio], inferAudioFileName(audio), {
    type: audio.type || 'audio/webm',
  });
  form.append('audio', file);
  if (opts.language) form.append('language', opts.language);

  const res = await api.post<SendVoiceMessageResponse>(
    `/public/chat-sessions/${encodeURIComponent(sessionId)}/voice-messages`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data;
}

export async function fetchPublicMessageAudio(
  sessionId: string,
  messageId: string,
): Promise<Blob> {
  const res = await api.get<Blob>(
    `/public/chat-sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/audio`,
    { responseType: 'blob' },
  );
  return res.data;
}
