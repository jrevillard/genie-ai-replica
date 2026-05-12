import { api } from './http';

export interface VoiceSession {
  _key: string;
  userId: string;
  language: string;
  gender: string;
  twinId?: string | null;
  startAt: string;
  endAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
  // Relative URL to the captured call audio (e.g. /Uploads/call-recordings/<id>.wav).
  // Returned by GET /voice/sessions/:id once the recording has been finalised on
  // the backend. Absent on older sessions and may be null while encoding.
  recordingUrl?: string | null;
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
  twinId: string | null;
  identity: string;
  fullName: string;
}

export type VoiceDateRange = 'all' | 'today' | 'last7' | 'last30';
export type VoiceSort = 'newest' | 'oldest' | 'longest' | 'shortest';

export interface ListVoiceSessionsParams {
  limit?: number;
  offset?: number;
  twinId?: string | null;
  language?: string | null;
  dateRange?: VoiceDateRange;
  sort?: VoiceSort;
}

export interface GetVoiceMessagesParams {
  limit?: number;
}

export async function mintVoiceToken(
  language: string,
  twinId?: string
): Promise<VoiceTokenResponse> {
  const body: Record<string, string> = { language };
  if (twinId) body.twinId = twinId;
  const res = await api.post<VoiceTokenResponse>('/voice/token', body);
  return res.data;
}

export async function listVoiceSessions(
  params: ListVoiceSessionsParams = {}
): Promise<VoiceSession[]> {
  const query: Record<string, string | number> = {
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  };
  if (params.twinId) query.twinId = params.twinId;
  if (params.language) query.language = params.language;
  if (params.dateRange && params.dateRange !== 'all') query.dateRange = params.dateRange;
  if (params.sort) query.sort = params.sort;
  const res = await api.get<VoiceSession[]>('/voice/sessions', { params: query });
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
