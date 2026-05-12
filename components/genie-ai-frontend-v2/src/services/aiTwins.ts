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
    originalName?: string | null;
    mimeType?: string | null;
    fileType: string | null;
    /** Legacy field — newer backend sends `fileSize` (bytes) instead. */
    size?: number | null;
    fileSize?: number | null;
    title?: string | null;
    description?: string | null;
    category?: string | null;
    tags?: string[];
    labels: string[];
    status: string | null;
    sourceUrl: string | null;
    /** ISO-639-1 language tag detected/assigned on upload. */
    language?: string | null;
    author?: string | null;
    chunkCount?: number | null;
    uploadedDate?: string | null;
    createDate?: string | null;
    crawlDate?: string | null;
    ingestDate?: string | null;
    retractDate?: string | null;
    /** Legacy aliases kept for older payloads. */
    createdAt?: string | null;
    updatedAt?: string | null;
    /** Twin IDs that link this file — used to render an avatar stack on the
     *  file row showing every AI Twin currently using it. */
    linkedTwinIds?: string[];
  }>;
  // Hydrated by the privileged read so PersonalityTab/InstructionsTab can
  // render correct initial values without a separate async fetch (and the
  // visible flicker that comes with one).
  personality?: TwinPersonality;
  instructions?: string[];
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

export async function createAiTwin(
  payload: CreateAiTwinPayload,
  signal?: AbortSignal
): Promise<AiTwin> {
  const res = await api.post<AiTwin>('/ai-twins', payload, { signal });
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

// Admin instructions — replace-only. The backend enforces uniqueness +
// dedupes on save, so callers can pass the raw list as displayed. The current
// list is hydrated on the AiTwin payload, so a dedicated GET isn't needed
// here; only the suggestions need their own endpoint.
export async function replaceTwinInstructions(
  twinId: string,
  instructions: string[]
): Promise<string[]> {
  const res = await api.post<{ instructions: string[] }>(
    `/ai-twins/${encodeURIComponent(twinId)}/instructions`,
    { instructions }
  );
  return res.data?.instructions ?? [];
}

// Curated suggestions filtered to exclude what the twin already has applied.
export async function getSuggestedInstructions(twinId: string): Promise<string[]> {
  const res = await api.get<{ instructions: string[] }>(
    `/ai-twins/${encodeURIComponent(twinId)}/suggested-instructions`
  );
  return res.data?.instructions ?? [];
}

// Per-twin LLM-generated chat-landing questions. The backend refreshes this
// set fire-and-forget whenever the KB changes; the regenerate endpoint forces
// a synchronous re-run (~1-3s) for admins. When the twin has no KB, the
// backend falls back to the global curated NCD set.
export interface TwinSuggestedQuestion {
  order: number;
  category: string;
  content: string;
}

function normaliseTwinSuggestedQuestions(raw: unknown): TwinSuggestedQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is TwinSuggestedQuestion =>
        typeof item?.content === 'string' && item.content.trim().length > 0
    )
    .map((item, idx) => ({
      // Server may omit `order` on the fallback list — derive a stable index
      // so grouping/sorting still works.
      order: typeof item.order === 'number' ? item.order : idx + 1,
      category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : 'General',
      content: item.content.trim(),
    }))
    .sort((a, b) => a.order - b.order);
}

export async function getTwinSuggestedQuestions(twinId: string): Promise<TwinSuggestedQuestion[]> {
  const res = await api.get<TwinSuggestedQuestion[]>(
    `/ai-twins/${encodeURIComponent(twinId)}/suggested-questions`
  );
  return normaliseTwinSuggestedQuestions(res.data);
}

export async function regenerateTwinSuggestedQuestions(
  twinId: string
): Promise<TwinSuggestedQuestion[]> {
  const res = await api.post<TwinSuggestedQuestion[]>(
    `/ai-twins/${encodeURIComponent(twinId)}/suggested-questions/regenerate`
  );
  return normaliseTwinSuggestedQuestions(res.data);
}

// System prompt — admin-editable base prompt for a twin. The backend always
// returns a non-empty value (falls back to the platform default when the
// twin document has no systemPrompt stored yet).
export interface TwinSystemPrompt {
  systemPrompt: string;
}

export async function getTwinSystemPrompt(twinId: string): Promise<string> {
  const res = await api.get<TwinSystemPrompt>(
    `/ai-twins/${encodeURIComponent(twinId)}/prompt`
  );
  return res.data?.systemPrompt ?? '';
}

export async function updateTwinSystemPrompt(
  twinId: string,
  systemPrompt: string
): Promise<string> {
  const res = await api.patch<TwinSystemPrompt>(
    `/ai-twins/${encodeURIComponent(twinId)}/prompt`,
    { systemPrompt }
  );
  return res.data?.systemPrompt ?? systemPrompt;
}

export async function getDefaultSystemPrompt(): Promise<string> {
  const res = await api.get<TwinSystemPrompt>('/ai-twins/default-prompt');
  return res.data?.systemPrompt ?? '';
}

// Multipart upload — server stores the file and returns the updated twin
// (profilePicUrl set to /Uploads/ai-twins/...). Limits: jpeg/png/webp/gif, ≤ 5 MB.
export async function uploadAiTwinAvatar(
  twinId: string,
  file: File,
  signal?: AbortSignal
): Promise<AiTwin> {
  const form = new FormData();
  form.append('image', file);
  const res = await api.post<AiTwin>(
    `/ai-twins/${encodeURIComponent(twinId)}/avatar`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, signal }
  );
  return res.data;
}
