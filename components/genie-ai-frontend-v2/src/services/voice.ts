import { api } from './http';

export interface VoiceSession {
  _key: string;
  userId: string;
  language: string;
  gender: string;
  startAt: string;
  endAt: string | null;
  durationSeconds: number;
  createdAt: string;
}

export interface VoiceMessage {
  _key: string;
  sessionId: string;
  content: string;
  isAssistant: boolean;
  createdAt: string;
}

export interface VoiceTokenResponse {
  wsUrl: string;
  voiceToken: string;
  expiresIn: number;
  language: string;
  identity: string;
  fullName: string;
}

export interface ListVoiceSessionsParams {
  limit?: number;
  offset?: number;
}

export interface GetVoiceMessagesParams {
  limit?: number;
}

export async function mintVoiceToken(language: string): Promise<VoiceTokenResponse> {
  const res = await api.post<VoiceTokenResponse>('/voice/token', { language });
  return res.data;
}

export async function listVoiceSessions(
  params: ListVoiceSessionsParams = {}
): Promise<VoiceSession[]> {
  const res = await api.get<VoiceSession[]>('/voice/sessions', {
    params: { limit: params.limit ?? 50, offset: params.offset ?? 0 },
  });
  return res.data;
}

export async function getVoiceSession(sessionId: string): Promise<VoiceSession> {
  const res = await api.get<VoiceSession>(
    `/voice/sessions/${encodeURIComponent(sessionId)}`
  );
  return res.data;
}

export async function getVoiceMessages(
  sessionId: string,
  params: GetVoiceMessagesParams = {}
): Promise<VoiceMessage[]> {
  const res = await api.get<VoiceMessage[]>(
    `/voice/sessions/${encodeURIComponent(sessionId)}/messages`,
    { params: { limit: params.limit ?? 500 } }
  );
  return res.data;
}
