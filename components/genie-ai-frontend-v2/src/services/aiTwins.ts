import { api } from './http';

// API shape. Mirrors the deployed `/ai-twins` endpoint exactly — do not add
// UI-only fields here. Display formatting belongs in the components.
export interface AiTwin {
  _key: string;
  name: string;
  profilePicUrl: string | null;
  description: string;
  linkedKbFileIds: string[];
  createdAt: string;
  updatedAt: string;
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

export interface CreateAiTwinPayload {
  name: string;
  profilePicUrl?: string | null;
  description?: string;
  linkedKbFileIds?: string[];
}

export type UpdateAiTwinPayload = Partial<CreateAiTwinPayload>;

export async function listAiTwins(params: ListAiTwinsParams = {}): Promise<ListAiTwinsResponse> {
  const res = await api.get<ListAiTwinsResponse>('/ai-twins', {
    params: { offset: params.offset ?? 1, limit: params.limit ?? 50 },
  });
  return res.data;
}

export async function getAiTwin(twinId: string): Promise<AiTwin> {
  const res = await api.get<AiTwin>(`/ai-twins/${encodeURIComponent(twinId)}`);
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
