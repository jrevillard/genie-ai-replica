// src/utils/document-opener.js — Shared helpers for opening repository
// documents. The repository serves files behind Bearer auth, so a plain
// link cannot carry the session — the fetch-blob flow is the only way to
// hand the browser a viewable document.

/**
 * Whether a stored url points outside the repository.
 * @param {String} url
 * @returns {Boolean}
 */
export function isExternalUrl(url) {
  if (!url) return false;
  const isHttp = url.startsWith('http://') || url.startsWith('https://');
  const isPlaceholder = url.includes('<HOST>') || url.includes('<PORT>');
  // A URL is considered external only if it's a valid HTTP link AND not a
  // placeholder.
  return isHttp && !isPlaceholder;
}

/**
 * Fetch a repository document with the session token and open the browser
 * on a blob URL (revoked shortly after).
 * @param {String} docId - Repository file id
 * @param {String} accessToken - OIDC access token
 */
export async function openRepositoryDocument(docId, accessToken) {
  if (!docId) return;
  if (!accessToken) throw new Error('Authentication token not found. Unable to open internal document.');
  const fileUrl = `${window.location.origin}/api/files/${docId}/viewbrowser`;
  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`Network response was not ok: ${response.statusText}`);
  }
  const fileBlob = await response.blob();
  const blobUrl = URL.createObjectURL(fileBlob);
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
}

/**
 * Map a file name (or extension) to a badge label and tone for the
 * document families the platform supports. Pure CSS + text, so every
 * mark stays license-free.
 * @param {String} name - File name, extension, or upper-case type label
 * @returns {{label: String, tone: String}}
 */
export function fileTypeBadge(name) {
  const n = String(name || '').toLowerCase();
  const ext = n.includes('.') ? n.split('.').pop() : n;
  if (ext === 'pdf') return { label: 'PDF', tone: 'danger' };
  if (['doc', 'docx'].includes(ext)) return { label: 'DOC', tone: 'info' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', tone: 'success' };
  if (['ppt', 'pptx'].includes(ext)) return { label: 'PPT', tone: 'warning' };
  if (['md', 'markdown'].includes(ext)) return { label: 'MD', tone: 'warning' };
  if (['html', 'htm'].includes(ext)) return { label: 'HTML', tone: 'warning' };
  if (['json', 'xml'].includes(ext)) return { label: 'JSON', tone: 'warning' };
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return { label: 'IMG', tone: 'accent' };
  if (['zip', 'gz', 'tar'].includes(ext)) return { label: 'ZIP', tone: 'muted' };
  if (ext === 'txt') return { label: 'TXT', tone: 'muted' };
  return { label: ext ? ext.slice(0, 4).toUpperCase() : 'FILE', tone: 'muted' };
}
