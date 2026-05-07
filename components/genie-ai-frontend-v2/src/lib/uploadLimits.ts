// Mirrors the document-repository's upload allow-list (see
// `components/document-repository/src/config/appConfig.js` → `upload`). Keep
// this in sync — diverging from the backend means users get an opaque 500
// when the request lands instead of a clear pre-flight error.

export const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.md',
  '.html',
  '.txt',
] as const;

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_FILES_PER_UPLOAD = 10;

/** Comma-separated form for `<input accept>`. */
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.join(',');

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export interface UploadValidationFailure {
  file: File;
  reason: 'extension' | 'size';
  ext: string;
}

export interface UploadValidationResult {
  accepted: File[];
  rejected: UploadValidationFailure[];
  /** True when the resulting queue would exceed `MAX_FILES_PER_UPLOAD`. */
  overflowed: boolean;
  /** Files dropped because of the per-upload count cap (after type/size). */
  overflow: File[];
}

/**
 * Filter incoming files against the backend allow-list. `existingCount` lets
 * the staging UI keep its current queue under the per-upload limit when the
 * user adds more files in a second batch.
 */
export function validateUploadCandidates(
  files: Iterable<File>,
  existingCount = 0
): UploadValidationResult {
  const accepted: File[] = [];
  const rejected: UploadValidationFailure[] = [];
  const overflow: File[] = [];

  for (const file of files) {
    const ext = fileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
      rejected.push({ file, reason: 'extension', ext });
      continue;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      rejected.push({ file, reason: 'size', ext });
      continue;
    }
    accepted.push(file);
  }

  // Apply the per-upload count cap last so a queue that's already at the
  // limit doesn't silently swallow valid files in subsequent batches.
  const room = Math.max(0, MAX_FILES_PER_UPLOAD - existingCount);
  if (accepted.length > room) {
    overflow.push(...accepted.splice(room));
  }

  return {
    accepted,
    rejected,
    overflow,
    overflowed: overflow.length > 0,
  };
}
