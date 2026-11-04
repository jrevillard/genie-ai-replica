// src/utils/document-opener.js — Shared helpers for opening repository
// documents. The repository serves files behind Bearer auth, so a plain
// link cannot carry the session — the fetch-blob flow is the only way to
// hand the browser a viewable document.

import MarkdownIt from 'markdown-it';
import conceptService from '../services/conceptService';

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

// ---------------------------------------------------------------------------
// OKF concept sources (CAP-2/CAP-3, chat-source resolution). A concept has NO
// doc-repository file (content-only chunking) — the open/download flows go
// through the okf-server concept route under the caller's own scope, never
// through the /api/files URL family. An unavailable concept (restricted repo,
// retracted, deleted) resolves to OKF_CONCEPT_UNAVAILABLE so the callers can
// render an honest "unavailable" notice instead of a generic open error.
// ---------------------------------------------------------------------------

/** Error shape for a concept that exists as a citation but cannot be served. */
export function okfConceptUnavailable(message) {
  const err = new Error(message || 'OKF concept content is not available');
  err.code = 'OKF_CONCEPT_UNAVAILABLE';
  return err;
}

/** Fetch one concept's meta row through conceptService (user bearer, per-request scope authz). */
export async function fetchOkfConcept(repoId, conceptId) {
  if (!repoId || !conceptId) throw okfConceptUnavailable();
  const meta = await conceptService.get(repoId, conceptId);
  // conceptService maps 404/501 → null: the concept is gone or fenced (404 is
  // the anti-enumeration denial for restricted repos too).
  if (!meta) throw okfConceptUnavailable();
  return meta;
}

/** The concept's display title: frontmatter title, else the humanized id. */
export function okfConceptTitle(meta, conceptId) {
  const t = meta && meta.frontmatter && meta.frontmatter.title;
  return (typeof t === 'string' && t.trim()) || String(conceptId).replace(/_/g, ' ').trim();
}

/**
 * Open a concept as rendered markdown in a new tab (the viewbrowser
 * equivalent for OKF concepts).
 * @param {String} repoId
 * @param {String} conceptId
 */
export async function openOkfConcept(repoId, conceptId) {
  const meta = await fetchOkfConcept(repoId, conceptId);
  const title = okfConceptTitle(meta, conceptId);
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
  const rendered = md.render(String(meta.body || ''));
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${title.replace(/[<>&]/g, '')}</title>` +
    '<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:52rem;line-height:1.55;color:#1a1a1a;padding:0 1rem}' +
    'h1,h2,h3{line-height:1.25}code,pre{background:#f4f4f4;border-radius:4px;font-family:ui-monospace,monospace}' +
    'pre{padding:.75rem;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.35rem .5rem}' +
    'img{max-width:100%}</style></head><body>' +
    `<h1>${title.replace(/[<>&]/g, '')}</h1>` +
    rendered +
    '</body></html>';
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
}

/**
 * Download a concept's markdown body as <title>.md.
 * @param {String} repoId
 * @param {String} conceptId
 */
export async function downloadOkfConcept(repoId, conceptId) {
  const meta = await fetchOkfConcept(repoId, conceptId);
  const title = okfConceptTitle(meta, conceptId);
  const blob = new Blob([String(meta.body || '')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w\-. ]+/g, '_')}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

/**
 * Resolve a concept's real title for a citation card (async id → title swap).
 * Returns null when the concept cannot be fetched — the caller keeps the
 * fallback title (never blocks render).
 * @param {String} repoId
 * @param {String} conceptId
 */
export async function fetchOkfConceptTitle(repoId, conceptId) {
  try {
    const meta = await fetchOkfConcept(repoId, conceptId);
    return okfConceptTitle(meta, conceptId);
  } catch {
    return null;
  }
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
