import { api } from './http';

/**
 * Document Repository file API (mounted under `/api/files` in the GENIE.AI stack).
 * Paths are relative to the shared axios `baseURL` (typically `/api`).
 */

function apiBasePath(): string {
  const base = api.defaults.baseURL ?? '/api';
  return base.replace(/\/$/, '');
}

export interface FilePreviewOptions {
  width?: string | number;
  height?: string | number;
  quality?: string | number;
}

/** Optional multipart fields accepted by the repository upload handlers. */
export interface FileUploadOptions {
  author?: string;
  labels?: string[];
  language?: string;
}

export interface ListFilesParams {
  page?: number;
  limit?: number;
  search?: string;
  /** Lowercase filter value; server matches case-insensitively. */
  dataprepStatus?: string;
  language?: string;
  mimeType?: string;
}

export interface ListFilesPagination {
  currentPage: number;
  totalPages: number;
  totalFiles: number;
  limit: number;
}

/** Row shape returned from the repository `getFiles` query (may include extra fields). */
export interface RepoFileRow {
  file_id: string;
  file_name: string;
  file_type?: string;
  file_size?: number;
  uploaded_date?: string;
  language?: string;
  chunk_count?: number;
  labels?: string[];
  dataprep?: {
    status?: string;
    ingest_date?: string | null;
    retract_date?: string | null;
  };
  [key: string]: unknown;
}

export interface ListFilesResult {
  files: RepoFileRow[];
  pagination: ListFilesPagination;
}

/** Normalised record returned on successful upload (`_formatFileRecord`). */
export interface UploadedFileRecord {
  file_id: string;
  file_name: string;
  file_size?: number;
  file_type?: string;
  upload_date?: string;
  language?: string;
  chunk_count?: number;
  dataprep?: {
    status?: string;
    ingest_date?: string | null;
    retract_date?: string | null;
  };
  [key: string]: unknown;
}

function appendUploadFields(form: FormData, options?: FileUploadOptions): void {
  if (!options) return;
  if (options.author) form.append('author', options.author);
  if (options.labels?.length) form.append('labels', JSON.stringify(options.labels));
  if (options.language !== undefined && options.language !== '') {
    form.append('language', options.language);
  }
}

async function listFiles(params: ListFilesParams = {}): Promise<ListFilesResult> {
  const { data } = await api.get<{
    success?: boolean;
    data?: RepoFileRow[];
    pagination?: ListFilesPagination;
  }>('files', {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 50,
      ...(params.search ? { search: params.search } : {}),
      ...(params.dataprepStatus ? { dataprepStatus: params.dataprepStatus } : {}),
      ...(params.language ? { language: params.language } : {}),
      ...(params.mimeType ? { mimeType: params.mimeType } : {}),
    },
  });
  return {
    files: Array.isArray(data.data) ? data.data : [],
    pagination: data.pagination ?? {
      currentPage: params.page ?? 1,
      totalPages: 1,
      totalFiles: 0,
      limit: params.limit ?? 50,
    },
  };
}

async function uploadFile(
  file: File,
  options?: FileUploadOptions
): Promise<UploadedFileRecord> {
  const formData = new FormData();
  formData.append('file', file);
  appendUploadFields(formData, options);
  const { data } = await api.post<{
    success?: boolean;
    data?: UploadedFileRecord;
    message?: string;
  }>('files/upload', formData);
  if (!data?.data?.file_id) {
    throw new Error(data?.message || 'Upload failed');
  }
  return data.data;
}

async function uploadMultipleFiles(
  files: File[],
  options?: FileUploadOptions
): Promise<UploadedFileRecord[]> {
  const formData = new FormData();
  files.forEach((f) => {
    formData.append('files', f);
  });
  appendUploadFields(formData, options);
  const { data } = await api.post<{
    success?: boolean;
    data?: UploadedFileRecord[];
    message?: string;
  }>('files/uploads', formData);
  const list = Array.isArray(data?.data) ? data.data : [];
  if (!list.length) {
    throw new Error(data?.message || 'Upload failed');
  }
  return list;
}

function getFileUrl(fileId: string): string {
  return `${apiBasePath()}/files/${encodeURIComponent(fileId)}`;
}

/**
 * Stream download with Bearer auth (avoids opening a bare URL without headers).
 */
async function downloadFile(fileId: string, fallbackFileName?: string): Promise<void> {
  const res = await api.get<Blob>(`files/${encodeURIComponent(fileId)}/download`, {
    responseType: 'blob',
  });
  const blob = res.data;
  const header = res.headers['content-disposition'] ?? res.headers['Content-Disposition'];
  let filename = fallbackFileName || 'download';
  if (typeof header === 'string') {
    const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(header);
    const raw = m?.[1] ?? m?.[2];
    if (raw) {
      try {
        filename = decodeURIComponent(raw.replace(/['"]/g, ''));
      } catch {
        filename = raw.replace(/['"]/g, '');
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function deleteFile(fileId: string): Promise<void> {
  await api.delete(`files/${encodeURIComponent(fileId)}`);
}

async function getFileMetadata(fileId: string): Promise<unknown> {
  const { data } = await api.get<{ success?: boolean; data?: unknown }>(
    `files/${encodeURIComponent(fileId)}`
  );
  if (data && typeof data === 'object' && 'data' in data) {
    return (data as { data: unknown }).data;
  }
  return data;
}

function getPreviewUrl(fileId: string, options: FilePreviewOptions = {}): string {
  const { width, height, quality } = options;
  let url = `${apiBasePath()}/files/${encodeURIComponent(fileId)}/view`;
  const params = new URLSearchParams();
  if (width !== undefined && width !== '') params.append('width', String(width));
  if (height !== undefined && height !== '') params.append('height', String(height));
  if (quality !== undefined && quality !== '') params.append('quality', String(quality));
  const queryString = params.toString();
  if (queryString) url += `?${queryString}`;
  return url;
}

const fileService = {
  listFiles,
  uploadFile,
  uploadMultipleFiles,
  getFileUrl,
  downloadFile,
  deleteFile,
  getFileMetadata,
  getPreviewUrl,
};

export default fileService;

export {
  listFiles,
  uploadFile,
  uploadMultipleFiles,
  getFileUrl,
  downloadFile,
  deleteFile,
  getFileMetadata,
  getPreviewUrl,
};
