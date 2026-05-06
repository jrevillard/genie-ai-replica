import { api } from './http';

// API shape. Mirrors the deployed `/ai-twins` endpoint exactly — do not add
// UI-only fields here. Display formatting belongs in the components.
export interface AiTwin {
  _key: string;
  name: string;
  profilePicUrl: string | null;
  description: string;
  voiceId: string | null;
  chatGreeting: string;
  callGreeting: string;
  isDefault: boolean;
  twinNumber: string;
  linkedKbFileIds: string[];
  linkedKbFiles?: Array<{
    fileId: string;
    _key: string;
    fileName: string | null;
    originalName: string | null;
    mimeType: string | null;
    fileType: string | null;
    size: number | null;
    title: string | null;
    description: string | null;
    category: string | null;
    tags: string[];
    labels: string[];
    status: string | null;
    sourceUrl: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
  numChats?: number;
  numWhatsappChats?: number;
  numCalls?: number;
}

export interface ListAiTwinsParams {
  offset?: number;
  limit?: number;
}

export interface ListAiTwinsResponse {
  twins: AiTwin[];
  total: number;
  offset: number;
  limit: number;
}

// Public directory shape — backend strips admin-only fields.
export interface PublicAiTwin {
  _key: string;
  name: string;
  description: string;
  profilePicUrl: string | null;
}

export interface ListPublicAiTwinsResponse {
  twins: PublicAiTwin[];
  total: number;
  offset: number;
  limit: number;
}

export interface CreateAiTwinPayload {
  name: string;
  profilePicUrl?: string | null;
  description?: string;
  voiceId?: string | null;
  chatGreeting?: string;
  callGreeting?: string;
  isDefault?: boolean;
  twinNumber?: string;
  linkedKbFileIds?: string[];
}

export type UpdateAiTwinPayload = Partial<CreateAiTwinPayload>;

export async function listAiTwins(params: ListAiTwinsParams = {}): Promise<ListAiTwinsResponse> {
  const res = await api.get<ListAiTwinsResponse>('/ai-twins', {
    params: { offset: params.offset ?? 0, limit: params.limit ?? 50 },
  });
  return res.data;
}

export async function getAiTwin(twinId: string): Promise<AiTwin> {
  const res = await api.get<AiTwin>(`/ai-twins/${encodeURIComponent(twinId)}`);
  return res.data;
}

// Public directory — sanitized list, safe for non-admin users and guests.
export async function listPublicAiTwins(params: ListAiTwinsParams = {}): Promise<ListPublicAiTwinsResponse> {
  const res = await api.get<ListPublicAiTwinsResponse>('/public/ai-twins', {
    params: { offset: params.offset ?? 0, limit: params.limit ?? 50 },
  });
  return res.data;
}

// Guest read of a twin — backend only exposes the default twin here, with
// admin fields stripped. Returns 404 for any non-default twin id.
export async function getPublicAiTwin(twinId: string): Promise<AiTwin> {
  const res = await api.get<AiTwin>(`/public/ai-twins/${encodeURIComponent(twinId)}`);
  return res.data;
}

export async function createAiTwin(payload: CreateAiTwinPayload): Promise<AiTwin> {
  const res = await api.post<AiTwin>('/ai-twins', payload);
  return res.data;
}

export async function updateAiTwin(twinId: string, payload: UpdateAiTwinPayload): Promise<AiTwin> {
  const res = await api.patch<AiTwin>(`/ai-twins/${encodeURIComponent(twinId)}`, payload);
  return res.data;
}

export async function deleteAiTwin(twinId: string): Promise<void> {
  await api.delete(`/ai-twins/${encodeURIComponent(twinId)}`);
}

// KB-file linking — server normalises (strips optional `files/` prefix).
export async function linkKbFile(twinId: string, fileId: string): Promise<AiTwin> {
  const res = await api.post<AiTwin>(`/ai-twins/${encodeURIComponent(twinId)}/kb-files`, { fileId });
  return res.data;
}

export async function replaceKbFiles(twinId: string, linkedKbFileIds: string[]): Promise<AiTwin> {
  const res = await api.patch<AiTwin>(
    `/ai-twins/${encodeURIComponent(twinId)}/kb-files`,
    { linkedKbFileIds }
  );
  return res.data;
}

export async function unlinkKbFile(twinId: string, fileId: string): Promise<AiTwin> {
  // The backend supports both `?fileId=` and a JSON body — using the query
  // param keeps the request simple and avoids DELETE-with-body quirks.
  const res = await api.delete<AiTwin>(
    `/ai-twins/${encodeURIComponent(twinId)}/kb-files`,
    { params: { fileId } }
  );
  return res.data;
}

export interface TwinSettings {
  chatGreeting: string;
  callGreeting: string;
  twinNumber: string;
}

export type UpdateTwinSettingsPayload = Partial<TwinSettings>;

export async function getTwinSettings(twinId: string): Promise<TwinSettings> {
  const res = await api.get<TwinSettings>(
    `/ai-twins/${encodeURIComponent(twinId)}/settings`
  );
  return res.data;
}

export async function updateTwinSettings(
  twinId: string,
  payload: UpdateTwinSettingsPayload
): Promise<TwinSettings> {
  const res = await api.post<TwinSettings>(
    `/ai-twins/${encodeURIComponent(twinId)}/settings`,
    payload
  );
  return res.data;
}

export type LanguageStyle = 'slang' | 'casual' | 'professional';
export type ResponseLength = 'short' | 'medium' | 'long';

export interface TwinPersonality {
  languageStyle: LanguageStyle;
  responseLength: ResponseLength;
}

export type UpdateTwinPersonalityPayload = Partial<TwinPersonality>;

export async function getTwinPersonality(twinId: string): Promise<TwinPersonality> {
  const res = await api.get<TwinPersonality>(
    `/ai-twins/${encodeURIComponent(twinId)}/personality`
  );
  return res.data;
}

export async function updateTwinPersonality(
  twinId: string,
  payload: UpdateTwinPersonalityPayload
): Promise<TwinPersonality> {
  const res = await api.post<TwinPersonality>(
    `/ai-twins/${encodeURIComponent(twinId)}/personality`,
    payload
  );
  return res.data;
}

// Multipart upload — server stores the file and returns the updated twin
// (profilePicUrl set to /Uploads/ai-twins/...). Limits: jpeg/png/webp/gif, ≤ 5 MB.
export async function uploadAiTwinAvatar(twinId: string, file: File): Promise<AiTwin> {
  const form = new FormData();
  form.append('image', file);
  const res = await api.post<AiTwin>(
    `/ai-twins/${encodeURIComponent(twinId)}/avatar`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return res.data;
}
