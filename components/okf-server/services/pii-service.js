// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// PII service — the orchestrator-facing API (ADR-okf-021 write-path step 4d).
// scanConcept calls the Presidio sidecar (fail-closed), UPSERTs pii_state onto
// okf_concepts_meta (the SEED of Story 2.9.2's writer — G9/G28), and returns
// redacted_text for the caller to persist (2.9.1 stores bodies). Also owns:
// the publish gate (assertPiiClean, D22/ADR-okf-030), the FR-3 ingest version
// record (sha256-derived, NOT bundle_version — 2.9.7 boundary), and the FR-28
// document-reference shape. NFR-P2: raw PII NEVER persisted or logged — only
// type/count summaries. MELT on every method.

const { aql } = require('arangojs');
const nodeCrypto = require('node:crypto');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const piiClient = require('./pii/pii-client');
const auditService = require('./audit-service');
const conceptMetaService = require('./concept-meta-service');

const META = 'okf_concepts_meta';
const REPOS = 'okf_repositories';
const FILES = 'files';

const meter = getMeter();
const opsCounter = meter.createCounter('okf_pii_operations_total', {
  description: 'OKF PII scan/gate/version operations'
});
function recordOp(operation, status) {
  try {
    opsCounter.add(1, { operation, status });
  } catch {
    /* meter no-op when observability off */
  }
}

let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

// ─── pii_state writer (G28 — the seed UPSERT) ───────────────────────────────

// Shared strict ArangoDB error classifiers (2026-08-15 review fix — was a
// local copy with a message-regex that masked transient failures as doc-absent).
const { isArangoNotFound } = require('./arango-errors');

/** firstExample that treats a not-found as null (real arangojs throws; the
 * unit mock returns null). Rejects falsy ids — an undefined bind key is
 * JSON-dropped by real arangojs, degrading the lookup to repo-wide. */
async function findPiiDoc(col, repo_id, concept_id) {
  if (!repo_id || !concept_id) {
    throw new Error(
      `findPiiDoc requires repo_id and concept_id (got repo_id=${String(repo_id)}, concept_id=${String(concept_id)})`
    );
  }
  try {
    return await col.firstExample({ repo_id, concept_id });
  } catch (err) {
    if (!isArangoNotFound(err)) throw err; // transient — surface
    return null;
  }
}

/**
 * Idempotent upsert of the PII state onto okf_concepts_meta. Creates a minimal
 * doc when absent (Story 2.9.2 formalizes first-class fields). The unique
 * (repo_id, concept_id) index is the race guard: a unique violation on the
 * concurrent-create path retries as an update.
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {object} patch {pii_state, pii_hits_summary?, pii_scanned_at}
 */

async function upsertPiiState(repo_id, concept_id, patch) {
  const db = await getDb();
  const col = db.collection(META);
  const existing = await findPiiDoc(col, repo_id, concept_id);
  if (existing) {
    await col.update(existing._key, patch);
    return 'updated';
  }
  try {
    await col.save({ repo_id, concept_id, ...patch });
    return 'created';
  } catch (err) {
    // Concurrent create lost the race → retry as update (unique index guard).
    if (err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409)) {
      const again = await findPiiDoc(col, repo_id, concept_id);
      if (again) {
        await col.update(again._key, patch);
        return 'updated';
      }
    }
    throw err;
  }
}

// ─── scanConcept (write-path step 4d) ────────────────────────────────────────

/**
 * Scan one concept (frontmatter values + body) via the sidecar; persist state.
 * @returns {Promise<{repo_id, concept_id, pii_state, pii_hits_summary, redacted_text?}>}
 */
/** Recursively flatten frontmatter values (strings/numbers/arrays/objects)
 * into scan text, so PII nested inside objects/arrays is NOT silently missed
 * (code-review fix: previously only top-level scalars were scanned). */
function flattenFrontmatter(value, depth = 0, out = []) {
  if (depth > 6) return out; // guard against pathological nesting
  if (value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    value.forEach((v) => flattenFrontmatter(v, depth + 1, out));
  } else if (typeof value === 'object') {
    Object.values(value).forEach((v) => flattenFrontmatter(v, depth + 1, out));
  }
  return out;
}

async function scanConcept(repo_id, concept_id, frontmatter = {}, body = '') {
  return withSpan('okf.pii.scan', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    // ONE scan implementation (region-split, editor-aligned offsets) serves
    // both the state writer and the occurrence inspector.
    const insp = await inspectConcept(repo_id, concept_id, frontmatter, body);
    let result;
    if (insp.state === 'error') {
      // FAIL-CLOSED: transport failure → pii_state='error' (blocks publish).
      result = { repo_id, concept_id, pii_state: 'error', pii_hits_summary: null };
      await upsertPiiState(repo_id, concept_id, {
        pii_state: 'error',
        pii_hits_summary: null,
        pii_scanned_at: new Date().toISOString()
      });
      recordOp('scan', 'error');
      logger.warn('PII scan errored (fail-closed)', { repo_id, concept_id, error: insp.error });
    } else {
      // PII REMEDIATION (David, 2026-09-09): per-item Accept decisions
      // suppress their occurrence — redact/replace/remove change the text so
      // the re-scan drops them naturally; only 'accept' needs the subtraction.
      const accepted = (await listResolutions(repo_id, concept_id)).filter((r) => r && r.action === 'accept');
      const unresolved = subtractAccepted(insp.occurrences, accepted);
      const summary = countByType(unresolved);
      const state = unresolved.length > 0 ? 'hit' : 'clean';
      result = { repo_id, concept_id, pii_state: state, pii_hits_summary: summary, occurrences: unresolved };
      await upsertPiiState(repo_id, concept_id, {
        pii_state: state,
        pii_hits_summary: summary, // unresolved counts only — NFR-P2
        pii_scanned_at: new Date().toISOString()
      });
      recordOp('scan', state);
    }
    span.setAttribute('okf.pii_state', result.pii_state);
    return result;
  });
}

/**
 * PII INSPECT (David, 2026-09-09: every issue must be flagged, categorized
 * and described in clear language) with FINDINGS REUSE (David, 2026-09-13:
 * "the repo has been scanned already and it was scanned again — this should
 * not have scanned again; we MUST minimize the scanning").
 *
 * The occurrences are PERSISTED on the concept meta doc — SPANS ONLY
 * ({where,type,start,end,score}); the flagged VALUES themselves are never at
 * rest (NFR-P2 preserved: the excerpts are re-sliced server-side from the
 * concept's own stored content on every serve, exactly as the live path does).
 * The cache key is the content signature (sha1 of the flattened frontmatter +
 * body): unchanged content → ZERO Presidio work; edited content → one fresh
 * scan that refreshes the cache; explicit `opts.rescan` bypasses the cache
 * (the panel's Re-scan button).
 */
function findingsSignature(fmText, body) {
  return nodeCrypto
    .createHash('sha1')
    .update(fmText + ' ' + String(body || ''))
    .digest('hex');
}

async function inspectConcept(repo_id, concept_id, frontmatter = {}, body = '', opts = {}) {
  return withSpan('okf.pii.inspect', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    const fmText = flattenFrontmatter(frontmatter).join('\n');
    const bodyText = String(body || '');
    const texts = { frontmatter: fmText, body: bodyText };
    // FINDINGS CACHE HIT: spans persisted from a previous scan of THIS
    // content — re-slice excerpts from our own text (microseconds) and
    // re-apply Accept suppressions recorded since. No sidecar call at all.
    if (!opts.rescan) {
      try {
        const db = await getDb();
        const meta = await findPiiDoc(db.collection(META), repo_id, concept_id);
        const f = meta && meta.pii_findings;
        if (f && f.content_sig === findingsSignature(fmText, bodyText) && Array.isArray(f.occurrences)) {
          const withExcerpts = f.occurrences.map((o) => {
            const text = texts[o.where] !== undefined ? texts[o.where] : '';
            return {
              ...o,
              excerpt: {
                before: text.slice(Math.max(0, o.start - 48), o.start),
                hit: text.slice(o.start, o.end),
                after: text.slice(o.end, o.end + 48)
              }
            };
          });
          const accepted = (await listResolutions(repo_id, concept_id)).filter((r) => r && r.action === 'accept');
          const unresolved = subtractAccepted(withExcerpts, accepted);
          recordOp('inspect', 'cache');
          span.setAttribute('okf.pii_cached', true);
          return { state: 'ok', occurrences: unresolved, counts_by_type: f.counts_by_type || countByType(unresolved) };
        }
      } catch {
        /* cache read failure must never block a scan — fall through to live */
      }
    }
    const out = await piiClient.scan([
      { id: 'frontmatter', text: fmText },
      { id: 'body', text: bodyText }
    ]);
    if (out.state === 'error') {
      recordOp('inspect', 'error');
      return { state: 'error', error: out.error, occurrences: [] };
    }
    const occurrences = [];
    for (const r of out.results) {
      // Slice OUR OWN scanned text — the live Presidio sidecar does NOT echo
      // the request text back (r.text is undefined in production), which
      // emptied every excerpt in the panel (David, 2026-09-09 issue 1+4).
      // r.text remains the fallback for sidecars that do echo it.
      const text = texts[r.id] !== undefined ? texts[r.id] : String(r.text || '');
      for (const h of r.hits || []) {
        occurrences.push({
          where: r.id,
          type: h.type,
          start: h.start,
          end: h.end,
          score: h.score,
          // EXCERPT (server-computed, exact against the scanned region): the
          // editor renders this directly — no client-side text reconstruction.
          excerpt: {
            before: text.slice(Math.max(0, h.start - 48), h.start),
            hit: text.slice(h.start, h.end),
            after: text.slice(h.end, h.end + 48)
          }
        });
      }
    }
    occurrences.sort((a, b) => (a.where === b.where ? a.start - b.start : a.where < b.where ? -1 : 1));
    recordOp('inspect', occurrences.length > 0 ? 'hit' : 'clean');
    const counts_by_type = occurrences.reduce((m, o) => {
      m[o.type] = (m[o.type] || 0) + 1;
      return m;
    }, {});
    // PERSIST THE FINDINGS (spans only — no values at rest, NFR-P2). Any
    // content edit changes the signature and the next inspect re-scans.
    try {
      await upsertPiiState(repo_id, concept_id, {
        pii_findings: {
          content_sig: findingsSignature(fmText, bodyText),
          occurrences: occurrences.map((o) => ({
            where: o.where,
            type: o.type,
            start: o.start,
            end: o.end,
            score: o.score
          })),
          counts_by_type,
          scanned_at: new Date().toISOString()
        }
      });
    } catch {
      /* persistence failure degrades to scan-every-time — never blocks */
    }
    return { state: 'ok', occurrences, counts_by_type };
  });
}

// ─── PII remediation (David, 2026-09-09: process each issue IN PLACE) ───────
// Four per-occurrence actions — Redact (→"REDACTED"), Replace (→ user text),
// Remove (→ deleted), Accept (keep, suppress the flag) — plus Redact-whole-file
// for PII-dominated documents. The server applies every splice against ITS OWN
// scan offsets (no client/server drift), records a persistent resolution
// (before → after) so the panel keeps showing processed items in green, and
// re-scans via Presidio — the remediation result is thereby fed back to the
// scanner and the publish gate (unresolved counts) updates automatically.
//
// NFR-P2 note: the resolution RECORD carries the before/after text by explicit
// user direction — it is the GDPR accountability record of what was redacted.
// The DOCUMENT itself never retains a redacted value, and counts-only
// summaries on pii_hits_summary are unchanged.

const RESOLUTION_CAP = 200; // per concept — the oldest entries roll off
const BEFORE_CAP = 500; // max stored excerpt length per resolution

function countByType(occurrences) {
  return (occurrences || []).reduce((m, o) => {
    m[o.type] = (m[o.type] || 0) + 1;
    return m;
  }, {});
}

/** Occurrences whose (where, type, text) matches an Accept resolution are
 * suppressed — they are reviewed, not outstanding. */
function subtractAccepted(occurrences, accepted) {
  if (!accepted || accepted.length === 0) return occurrences || [];
  const keys = new Set(accepted.map((a) => [a.where, a.type, a.before].join(' ')));
  return (occurrences || []).filter((o) => !keys.has([o.where, o.type, o.excerpt && o.excerpt.hit].join(' ')));
}

/** The concept's persisted remediation ledger (empty when absent). */
async function listResolutions(repo_id, concept_id) {
  const db = await getDb();
  const doc = await findPiiDoc(db.collection(META), repo_id, concept_id);
  return Array.isArray(doc && doc.pii_resolutions) ? doc.pii_resolutions : [];
}

function piiError(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}

/** Locate the span a remediation selection refers to against the STORED
 * content — NO scanner call (David, 2026-09-09: "why two full scans?"). The
 * panel already carries the exact flagged text from its last scan; exact
 * offsets are validated first, then a UNIQUE text match absorbs edits made
 * before the span. Ambiguous or missing → null (caller returns 409). The
 * occurrence TYPE rides the selection (the panel's scan supplied it). */
function locateSpan(fm, bodyText, selection) {
  const sel = selection || {};
  const hit = String(sel.hit || '');
  if (!hit) return null;
  const where = sel.where === 'frontmatter' ? 'frontmatter' : 'body';
  const text = where === 'body' ? bodyText : flattenFrontmatter(fm).join('\n');
  let start = -1;
  if (Number.isInteger(sel.start) && Number.isInteger(sel.end) && text.slice(sel.start, sel.end) === hit) {
    start = sel.start; // offsets still exact — the common case
  } else {
    const first = text.indexOf(hit);
    if (first >= 0 && text.indexOf(hit, first + 1) < 0) start = first; // unambiguous text match
  }
  if (start < 0) return null;
  return { where, type: sel.type || 'UNKNOWN', start, end: start + hit.length };
}

/** Frontmatter segments in flattenFrontmatter's exact join order, each with
 * its [start, end) range in the flattened scan text and the path to the value.
 * (Frontmatter occurrences cannot be spliced on the flattened string — the
 * edit is applied to the owning value, preserving document structure.) */
function fmSegments(value) {
  const segs = [];
  let off = 0;
  (function walk(v, path, depth) {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const text = String(v);
      segs.push({ start: off, end: off + text.length, path, text });
      off += text.length + 1; // the '\n' join between flattened values
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, path.concat(i), depth + 1));
    } else if (typeof v === 'object') {
      Object.keys(v).forEach((k) => walk(v[k], path.concat(k), depth + 1));
    }
  })(value, [], 0);
  return segs;
}

/** Structural clone of `root` with the value at `path` replaced. */
function setAtPath(root, path, value) {
  if (path.length === 0) return value;
  const out = Array.isArray(root) ? root.slice() : { ...root };
  const key = path[0];
  out[key] = setAtPath(out[key], path.slice(1), value);
  return out;
}

/** Apply a frontmatter occurrence splice; null when the occurrence maps to no
 * single value (segment changed shape since the scan → caller returns 409). */
function spliceFrontmatter(frontmatter, occ, replacement, hit) {
  const seg = fmSegments(frontmatter).find((s) => occ.start >= s.start && occ.end <= s.end);
  if (!seg) return null;
  const local = occ.start - seg.start;
  if (seg.text.slice(local, local + (occ.end - occ.start)) !== hit) return null;
  const nextValue = seg.text.slice(0, local) + replacement + seg.text.slice(local + (occ.end - occ.start));
  return setAtPath(frontmatter, seg.path, nextValue);
}

function newResolutionId() {
  return 'pr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function appendResolution(db, docKey, existing, resolution) {
  // Accepts a single resolution OR an array (whole-file accept batch).
  const added = Array.isArray(resolution) ? resolution : [resolution];
  const resolutions = [...(Array.isArray(existing) ? existing : []), ...added].slice(-RESOLUTION_CAP);
  await db.collection(META).update(docKey, { pii_resolutions: resolutions });
  return resolutions;
}

/** Shared tail of every remediation action: audit, re-scan (Presidio feedback
 * + acceptance-aware gate math), and return the fresh panel payload. The
 * ledger was already persisted by the caller (appendResolution). */
async function finishRemediation(repo_id, concept_id, resolutions, updated, auditEntry) {
  const resolution = resolutions[resolutions.length - 1];
  await auditService
    .writeAudit({
      action: auditEntry.action,
      actor: auditEntry.actor,
      actor_name: auditEntry.actor_name,
      repo_id,
      concept_id,
      description: auditEntry.description
    })
    .catch(() => {});
  recordOp('remediate', auditEntry.action);
  const pii = await scanConcept(repo_id, concept_id, updated.frontmatter, updated.body);
  const unresolved = pii.occurrences || []; // scanConcept already subtracted accepts
  logger.info('PII remediation applied', {
    repo_id,
    concept_id,
    action: resolution.action,
    pii_state: pii.pii_state,
    actor: auditEntry.actor
  });
  return {
    ok: true,
    pii_state: pii.pii_state,
    counts_by_type: countByType(unresolved),
    occurrences: unresolved,
    resolutions,
    frontmatter: updated.frontmatter,
    body: updated.body
  };
}

/**
 * Apply ONE remediation action to ONE occurrence.
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {object} selection {action: 'redact'|'replace'|'remove', where,
 *   start, end, type?, hit?, replacement?} — where/start/end/hit come from
 *   the panel's last scan; hit enables the stale-offset text match.
 * @param {object} actor {sub, name}
 */
async function remediatePii(repo_id, concept_id, selection, actor) {
  return withSpan('okf.pii.remediate', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    const action = selection && selection.action;
    if (!['redact', 'replace', 'remove'].includes(action)) {
      throw piiError('VALIDATION_ERROR', "action must be one of 'redact'|'replace'|'remove'", 400);
    }
    let replacement;
    if (action === 'replace') {
      replacement = String(
        selection.replacement === undefined || selection.replacement === null ? '' : selection.replacement
      );
      if (!replacement.trim()) {
        throw piiError('VALIDATION_ERROR', 'replacement text is required for the replace action', 400);
      }
      if (replacement.length > BEFORE_CAP) {
        throw piiError('VALIDATION_ERROR', 'replacement text exceeds ' + BEFORE_CAP + ' characters', 400);
      }
    }
    const after = action === 'redact' ? 'REDACTED' : action === 'remove' ? '' : replacement;
    const db = await getDb();
    const doc = await findPiiDoc(db.collection(META), repo_id, concept_id);
    if (!doc) {
      throw piiError('CONCEPT_NOT_FOUND', `Concept '${concept_id}' not found in repo '${repo_id}'`, 404);
    }
    const fm = doc.frontmatter || {};
    const bodyText = String(doc.body || '');
    // ONE-SCAN PATH (David, 2026-09-09): the span is validated against the
    // STORED content — the scanner is NOT called just to re-derive what the
    // panel already shows. finishRemediation's post-action re-scan is the
    // single Presidio call (state refresh + feedback loop).
    const occ = locateSpan(fm, bodyText, selection);
    if (!occ) {
      throw piiError(
        'PII_OCCURRENCE_STALE',
        'The flagged text changed since the last scan — re-scan and try again',
        409
      );
    }
    const before = selection.hit || '';
    let updated;
    if (occ.where === 'body') {
      updated = await conceptMetaService.patchConceptFields(repo_id, concept_id, {
        body: bodyText.slice(0, occ.start) + after + bodyText.slice(occ.end)
      });
    } else {
      const nextFm = spliceFrontmatter(fm, occ, after, before);
      if (!nextFm) {
        throw piiError(
          'PII_OCCURRENCE_STALE',
          'The frontmatter changed since the last scan — re-scan and try again',
          409
        );
      }
      updated = await conceptMetaService.patchConceptFields(repo_id, concept_id, { frontmatterPatch: nextFm });
    }
    const resolutions = await appendResolution(db, doc._key, doc.pii_resolutions, {
      id: newResolutionId(),
      action,
      type: occ.type,
      where: occ.where,
      before: String(before).slice(0, BEFORE_CAP),
      after: String(after).slice(0, BEFORE_CAP),
      at: new Date().toISOString(),
      actor: (actor && actor.sub) || 'system'
    });
    // REPLACE introduces NEW text the scanner must judge — one Presidio call
    // (post-action refresh). REDACT/REMOVE only destroy a validated span:
    // zero scans — the unresolved state derives arithmetically (David).
    if (action === 'replace') {
      return finishRemediation(repo_id, concept_id, resolutions, updated, {
        action: 'concept.pii_remediate',
        actor: (actor && actor.sub) || 'system',
        actor_name: (actor && actor.name) || null,
        description:
          `PII ${action} on concept "${concept_id}" (${occ.type}, ${occ.where}) — ` +
          `before "${String(before).slice(0, 60)}" → after "${String(after).slice(0, 60)}"`
      });
    }
    const state = await deriveStateAfterResolution(
      repo_id,
      concept_id,
      doc,
      resolutions[resolutions.length - 1],
      selection.suppressCount
    );
    await auditService
      .writeAudit({
        action: 'concept.pii_remediate',
        actor: (actor && actor.sub) || 'system',
        actor_name: (actor && actor.name) || null,
        repo_id,
        concept_id,
        description:
          `PII ${action} on concept "${concept_id}" (${occ.type}, ${occ.where}) — ` +
          `before "${String(before).slice(0, 60)}" → after "${String(after).slice(0, 60)}"`
      })
      .catch(() => {});
    return {
      ok: true,
      pii_state: state.pii_state,
      counts_by_type: state.counts_by_type,
      resolutions,
      frontmatter: updated.frontmatter,
      body: updated.body
    };
  });
}

/** Shared tail of the SCAN-FREE actions (accept / redact / remove): the new
 * unresolved state derives from the STORED counts-only summary minus the
 * suppressed span (NFR-P2 intact). Divergence is only ever TOO-CONSERVATIVE
 * — the fail-closed gate stays safe and self-heals on any natural scan
 * (every save re-scans). */
async function deriveStateAfterResolution(repo_id, concept_id, doc, resolution, suppressCount) {
  const prevSummary = doc.pii_hits_summary && typeof doc.pii_hits_summary === 'object' ? doc.pii_hits_summary : {};
  const nextSummary = { ...prevSummary };
  const remaining = Math.max(0, (nextSummary[resolution.type] || 0) - Math.max(1, Number(suppressCount) || 1));
  if (remaining > 0) nextSummary[resolution.type] = remaining;
  else delete nextSummary[resolution.type];
  const piiState = Object.keys(nextSummary).length > 0 ? 'hit' : 'clean';
  await upsertPiiState(repo_id, concept_id, {
    pii_state: piiState,
    pii_hits_summary: nextSummary,
    pii_scanned_at: new Date().toISOString()
  });
  recordOp('remediate', resolution.action);
  return { pii_state: piiState, counts_by_type: nextSummary };
}

/** ACCEPT one occurrence — ZERO scanner calls (David, 2026-09-09: "we do not
 * need two full Presidio scans"). The text is unchanged, so nothing needs
 * re-scanning: the span is validated against the STORED content, the
 * acceptance is recorded, and the stored unresolved summary is decremented
 * arithmetically. Divergence can only ever be TOO-CONSERVATIVE (a re-scan
 * may find the acceptance suppresses more identical copies than counted) —
 * the fail-closed gate stays safe and the state self-heals on any natural
 * scan (every save re-scans). */
async function acceptPii(repo_id, concept_id, selection, actor) {
  return withSpan('okf.pii.accept', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    const db = await getDb();
    const doc = await findPiiDoc(db.collection(META), repo_id, concept_id);
    if (!doc) {
      throw piiError('CONCEPT_NOT_FOUND', `Concept '${concept_id}' not found in repo '${repo_id}'`, 404);
    }
    const fm = doc.frontmatter || {};
    const bodyText = String(doc.body || '');
    const occ = locateSpan(fm, bodyText, selection);
    if (!occ) {
      throw piiError(
        'PII_OCCURRENCE_STALE',
        'The flagged text changed since the last scan — re-scan and try again',
        409
      );
    }
    const before = selection.hit || '';
    const resolutions = await appendResolution(db, doc._key, doc.pii_resolutions, {
      id: newResolutionId(),
      action: 'accept',
      type: occ.type,
      where: occ.where,
      before: String(before).slice(0, BEFORE_CAP),
      after: null,
      at: new Date().toISOString(),
      actor: (actor && actor.sub) || 'system'
    });
    // Derive the new unresolved state from the STORED summary (NFR-P2: counts
    // only). suppressCount = how many identical occurrences the acceptance
    // suppresses (the panel counts them; 1 when unspecified).
    const suppressCount = Math.max(1, Number(selection && selection.suppressCount) || 1);
    const prevSummary = doc.pii_hits_summary && typeof doc.pii_hits_summary === 'object' ? doc.pii_hits_summary : {};
    const nextSummary = { ...prevSummary };
    const remaining = Math.max(0, (nextSummary[occ.type] || 0) - suppressCount);
    if (remaining > 0) nextSummary[occ.type] = remaining;
    else delete nextSummary[occ.type];
    const piiState = Object.keys(nextSummary).length > 0 ? 'hit' : 'clean';
    await upsertPiiState(repo_id, concept_id, {
      pii_state: piiState,
      pii_hits_summary: nextSummary,
      pii_scanned_at: new Date().toISOString()
    });
    recordOp('remediate', 'concept.pii_accept');
    logger.info('PII acceptance recorded (scan-free)', {
      repo_id,
      concept_id,
      type: occ.type,
      where: occ.where,
      pii_state: piiState,
      actor: (actor && actor.sub) || 'system'
    });
    await auditService
      .writeAudit({
        action: 'concept.pii_accept',
        actor: (actor && actor.sub) || 'system',
        actor_name: (actor && actor.name) || null,
        repo_id,
        concept_id,
        description:
          `PII accepted on concept "${concept_id}" (${occ.type}, ${occ.where}) — ` +
          `"${String(before).slice(0, 80)}" reviewed and kept; the publish gate no longer counts it`
      })
      .catch(() => {});
    return {
      ok: true,
      pii_state: piiState,
      counts_by_type: nextSummary,
      suppressed: { where: occ.where, type: occ.type, hit: before },
      resolutions,
      frontmatter: fm,
      body: bodyText
    };
  });
}

/** WHOLE-FILE ACTION (David, 2026-09-09: "controls for whole files: Redact,
 * Remove and Accept") — three verbs applied to the ENTIRE file, ALL scan-free
 * (occurrences ride the request from the panel's current scan):
 *  - redact → body replaced with the redaction notice (fm kept)
 *  - remove → body emptied (fm kept)
 *  - accept → every occurrence reviewed-and-kept (per-text acceptances,
 *             bounded by RESOLUTION_CAP)
 * Region-split remaining counts derive from the payload: frontmatter hits
 * survive body destruction; body hits die with it. */
const FILE_ACTION_ENUM = ['redact', 'remove', 'accept'];

async function fileActionPii(repo_id, concept_id, payload, actor) {
  return withSpan('okf.pii.fileAction', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    const action = payload && payload.action;
    if (!FILE_ACTION_ENUM.includes(action)) {
      throw piiError('VALIDATION_ERROR', "action must be one of 'redact'|'remove'|'accept'", 400);
    }
    const occurrences = Array.isArray(payload.occurrences) ? payload.occurrences : [];
    const db = await getDb();
    const doc = await findPiiDoc(db.collection(META), repo_id, concept_id);
    if (!doc) {
      throw piiError('CONCEPT_NOT_FOUND', `Concept '${concept_id}' not found in repo '${repo_id}'`, 404);
    }
    const fm = doc.frontmatter || {};
    const oldBody = String(doc.body || '');
    const bodyHits = occurrences.filter((o) => (o ? o.where : '') === 'body');
    const fmHits = occurrences.filter((o) => (o ? o.where : '') === 'frontmatter');
    let newBody;
    let resolution;
    if (action === 'redact') {
      newBody = REDACTED_BODY;
      resolution = {
        id: newResolutionId(),
        action: 'redact_file',
        type: null,
        where: 'body',
        before: null,
        after: 'REDACTED (whole file)',
        hits_summary: countByType(bodyHits.map((o) => ({ type: o.type }))),
        at: new Date().toISOString(),
        actor: (actor && actor.sub) || 'system'
      };
    } else if (action === 'remove') {
      newBody = '';
      resolution = {
        id: newResolutionId(),
        action: 'remove_file',
        type: null,
        where: 'body',
        before: null,
        after: 'removed (whole file)',
        hits_summary: countByType(bodyHits.map((o) => ({ type: o.type }))),
        at: new Date().toISOString(),
        actor: (actor && actor.sub) || 'system'
      };
    }
    // ACCEPT: one acceptance per occurrence (bounded) — per-text suppression
    // keeps future scans consistent; identical texts collapse naturally.
    if (action === 'accept') {
      const accepted = [];
      for (const o of occurrences) {
        if (!o || !o.hit) continue;
        const where = o.where === 'frontmatter' ? 'frontmatter' : 'body';
        const region = where === 'body' ? oldBody : flattenFrontmatter(fm).join('\n');
        if (!region.includes(String(o.hit))) continue; // stale item — skip
        accepted.push({
          id: newResolutionId(),
          action: 'accept',
          type: o.type || 'UNKNOWN',
          where,
          before: String(o.hit).slice(0, BEFORE_CAP),
          after: null,
          at: new Date().toISOString(),
          actor: (actor && actor.sub) || 'system'
        });
      }
      if (accepted.length === 0) {
        throw piiError(
          'PII_OCCURRENCE_STALE',
          'No flagged text in the request still exists — re-scan and try again',
          409
        );
      }
      const resolutions = await appendResolution(db, doc._key, doc.pii_resolutions, accepted);
      // counts suppressed per type → remaining from the stored summary
      const summary = {};
      for (const a of accepted) summary[a.type] = (summary[a.type] || 0) + 1;
      const remaining = {};
      for (const [t, n] of Object.entries(doc.pii_hits_summary || {})) {
        const left = Math.max(0, n - (summary[t] || 0));
        if (left > 0) remaining[t] = left;
      }
      const piiState = Object.keys(remaining).length > 0 ? 'hit' : 'clean';
      await upsertPiiState(repo_id, concept_id, {
        pii_state: piiState,
        pii_hits_summary: remaining,
        pii_scanned_at: new Date().toISOString()
      });
      recordOp('remediate', 'concept.pii_accept_file');
      await auditService
        .writeAudit({
          action: 'concept.pii_accept_file',
          actor: (actor && actor.sub) || 'system',
          actor_name: (actor && actor.name) || null,
          repo_id,
          concept_id,
          description:
            `PII WHOLE-FILE accept on concept "${concept_id}" — ` + `${accepted.length} occurrence(s) reviewed and kept`
        })
        .catch(() => {});
      return {
        ok: true,
        pii_state: piiState,
        counts_by_type: remaining,
        occurrences: [],
        resolutions,
        frontmatter: fm,
        body: oldBody
      };
    }
    // redact / remove: persist the body change — the destroyed body takes
    // every body hit with it; frontmatter hits survive and keep it flagged.
    const updated = await conceptMetaService.patchConceptFields(repo_id, concept_id, { body: newBody });
    const resolutions = await appendResolution(db, doc._key, doc.pii_resolutions, resolution);
    const remaining = {};
    for (const o of fmHits) {
      const t = o.type || 'UNKNOWN';
      remaining[t] = (remaining[t] || 0) + 1;
    }
    const piiState = Object.keys(remaining).length > 0 ? 'hit' : 'clean';
    await upsertPiiState(repo_id, concept_id, {
      pii_state: piiState,
      pii_hits_summary: remaining,
      pii_scanned_at: new Date().toISOString()
    });
    recordOp('remediate', 'concept.pii_file_action');
    await auditService
      .writeAudit({
        action: 'concept.pii_file_action',
        actor: (actor && actor.sub) || 'system',
        actor_name: (actor && actor.name) || null,
        repo_id,
        concept_id,
        description:
          `PII whole-file ${action} on concept "${concept_id}" — body ` +
          (action === 'redact' ? 'redacted' : 'removed') +
          ` (${bodyHits.length} body occurrence(s) destroyed; ${Object.keys(remaining).length} frontmatter type(s) remain)`
      })
      .catch(() => {});
    return {
      ok: true,
      pii_state: piiState,
      counts_by_type: remaining,
      occurrences: [],
      resolutions,
      frontmatter: updated.frontmatter,
      body: updated.body
    };
  });
}
/** REPO BULK PII ACTION (David, 2026-09-12): Redact / Remove / Accept applied
 * to EVERY flagged concept of the repository in ONE steward decision, from
 * the Files-view header. SCAN-FREE: the stored unresolved summary
 * (pii_hits_summary) is the ledger of what the action covers — no Presidio
 * call — and each concept records its resolution (accept_repo / redact_file /
 * remove_file) before landing pii_state='clean'. The repo scan marker is
 * stamped complete: the review IS the scan's purpose, so the publish gate
 * neither blocks nor re-scans afterwards (David: "must be able to be
 * published and must not be scanned again"). Suppressions persist across
 * save-triggered rescans — scanConcept subtracts stored acceptances, and
 * redact/remove destroyed the flagged text — until an EXPLICIT re-scan is
 * requested from the UI. */
const REPO_BULK_ACTION_ENUM = FILE_ACTION_ENUM;

async function repoBulkAction(repo_id, payload, actor) {
  return withSpan('okf.pii.repoBulk', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const action = payload && payload.action;
    if (!REPO_BULK_ACTION_ENUM.includes(action)) {
      throw piiError('VALIDATION_ERROR', "action must be one of 'redact'|'remove'|'accept'", 400);
    }
    const db = await getDb();
    let repo = null;
    try {
      repo = await db.collection(REPOS).document(repo_id);
    } catch (err) {
      if (!isArangoNotFound(err)) throw err;
    }
    if (!repo || repo.deleted_at) {
      throw Object.assign(new Error('Repository ' + repo_id + ' not found'), { code: 'REPO_NOT_FOUND', status: 404 });
    }
    const flagged = await (
      await db.query('FOR m IN @@meta FILTER m.repo_id == @r AND m.pii_state == "hit" SORT m.concept_id RETURN m', {
        '@meta': META,
        r: repo_id
      })
    ).all();
    const by = (actor && actor.sub) || 'system';
    const now = new Date().toISOString();
    let affected = 0;
    for (const doc of flagged) {
      const prevSummary = doc.pii_hits_summary && typeof doc.pii_hits_summary === 'object' ? doc.pii_hits_summary : {};
      if (action === 'accept') {
        // Text stays; the decision suppresses every outstanding hit.
        await appendResolution(db, doc._key, doc.pii_resolutions, {
          id: newResolutionId(),
          action: 'accept_repo',
          type: null,
          where: null,
          before: null,
          after: 'accepted (whole repository)',
          hits_summary: prevSummary,
          at: now,
          actor: by
        });
      } else {
        // redact / remove: destroy the body (frontmatter identity stays so
        // navigation and the RAG labeler keep working). Scan-free ledger:
        // the STORED unresolved summary records what the action covered.
        const newBody = action === 'redact' ? REDACTED_BODY : '';
        await conceptMetaService.patchConceptFields(repo_id, doc.concept_id, { body: newBody });
        await appendResolution(db, doc._key, doc.pii_resolutions, {
          id: newResolutionId(),
          action: action === 'redact' ? 'redact_file' : 'remove_file',
          type: null,
          where: 'body',
          before: null,
          after: action === 'redact' ? 'REDACTED (whole repository)' : 'removed (whole repository)',
          hits_summary: prevSummary,
          at: now,
          actor: by
        });
      }
      await upsertPiiState(repo_id, doc.concept_id, {
        pii_state: 'clean',
        pii_hits_summary: {},
        pii_scanned_at: now
      });
      affected++;
    }
    if (affected > 0) {
      // The review decision doubles as the completed scan for the gate.
      await markRepoPiiScanned(repo_id);
    }
    recordOp('repoBulk', action);
    await auditService
      .writeAudit({
        action: 'repo.pii_bulk_' + action,
        actor: by,
        actor_name: (actor && actor.name) || null,
        repo_id,
        concepts_affected: affected,
        description:
          `PII BULK ${action.toUpperCase()} on repository — ${affected} flagged concept(s) processed ` +
          `(scan-free; publish gate satisfied without a new scan)`
      })
      .catch(() => {});
    logger.info('PII repo bulk action', { repo_id, action, affected, actor: by });
    return { ok: true, action, concepts_affected: affected };
  });
}

/** REDACT THE WHOLE FILE (David, 2026-09-09): when flagged entities dominate
 * a document, per-item work is pointless — the body is replaced wholesale
 * with a redaction notice. Frontmatter (title/labels/source — the concept's
 * identity in the repo) is preserved so navigation and the RAG labeler keep
 * working; any residual frontmatter flags stay visible in the panel. */
const REDACTED_BODY =
  '# REDACTED\n\n' +
  'The entire content of this file was redacted during PII review: it consisted ' +
  'predominantly of flagged personal data. See the repository audit log and the ' +
  'version modification record for what was removed.';

async function redactWholeFile(repo_id, concept_id, actor) {
  return withSpan('okf.pii.redactFile', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    const db = await getDb();
    const doc = await findPiiDoc(db.collection(META), repo_id, concept_id);
    if (!doc) {
      throw piiError('CONCEPT_NOT_FOUND', `Concept '${concept_id}' not found in repo '${repo_id}'`, 404);
    }
    const fm = doc.frontmatter || {};
    const insp = await inspectConcept(repo_id, concept_id, fm, String(doc.body || ''));
    const flaggedSummary = insp.state === 'error' ? null : insp.counts_by_type;
    const updated = await conceptMetaService.patchConceptFields(repo_id, concept_id, { body: REDACTED_BODY });
    const resolutions = await appendResolution(db, doc._key, doc.pii_resolutions, {
      id: newResolutionId(),
      action: 'redact_file',
      type: null,
      where: 'body',
      before: null,
      after: 'REDACTED (whole file)',
      hits_summary: flaggedSummary, // counts only — NFR-P2
      at: new Date().toISOString(),
      actor: (actor && actor.sub) || 'system'
    });
    return finishRemediation(repo_id, concept_id, resolutions, updated, {
      action: 'concept.pii_redact_file',
      actor: (actor && actor.sub) || 'system',
      actor_name: (actor && actor.name) || null,
      description:
        `PII WHOLE-FILE redaction on concept "${concept_id}" — body replaced ` +
        '(frontmatter preserved); flagged before: ' +
        (flaggedSummary ? JSON.stringify(flaggedSummary) : 'unknown')
    });
  });
}

// ─── Steward PII acknowledgement (David, 2026-08-30) ────────────────────────
// The publish PII gate needs a sanctioned release valve for PUBLIC entities
// (government contact details are PII-shaped: phone numbers, emails, names).
// The steward EXPLICITLY acknowledges the flagged entities; the decision is
// stamped on the registry (pii_ack) and audited. A scanner 'error' still
// hard-blocks — only reviewed 'hit's are waivable (version-service enforces).

async function acknowledgePii(repo_id, acknowledge, actor) {
  return withSpan('okf.pii.acknowledge', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    let repo = null;
    try {
      repo = await db.collection(REPOS).document(repo_id);
    } catch (err) {
      if (!isArangoNotFound(err)) throw err;
    }
    if (!repo || repo.deleted_at) {
      throw Object.assign(new Error('Repository ' + repo_id + ' not found'), { code: 'REPO_NOT_FOUND', status: 404 });
    }
    // Count the currently-flagged concepts so the ack carries what was reviewed.
    const flagged = await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.pii_state == "hit" COLLECT WITH COUNT INTO c RETURN c',
        { r: repo_id }
      )
    ).all();
    const ts = new Date().toISOString();
    const patch = acknowledge
      ? { pii_ack: { by: (actor && actor.sub) || 'system', at: ts, flagged_concepts: flagged[0] || 0 } }
      : { pii_ack: null };
    await db.collection(REPOS).update(repo_id, patch);
    await auditService
      .writeAudit({
        actor: (actor && actor.sub) || 'system',
        actor_name: (actor && actor.name) || null,
        action: acknowledge ? 'repo.pii_ack' : 'repo.pii_ack_revoke',
        repo_id,
        flagged_concepts: flagged[0] || 0,
        description: acknowledge
          ? 'Steward acknowledged ' +
            (flagged[0] || 0) +
            ' PII-flagged concept(s) — the publish gate is waived for reviewed public entities'
          : 'Steward revoked the PII acknowledgement — flagged concepts block publishing again'
      })
      .catch(() => {});
    logger.info('PII acknowledgement ' + (acknowledge ? 'recorded' : 'revoked'), {
      repo_id,
      flagged_concepts: flagged[0] || 0,
      actor: (actor && actor.sub) || 'system'
    });
    return { ok: true, acknowledged: !!acknowledge, flagged_concepts: flagged[0] || 0 };
  });
}

// ─── Publish gate (D22/ADR-okf-030) ─────────────────────────────────────────

/**
 * Mark a repo as fully PII-scanned (sets the publish-gate marker). Called by
 * the scan endpoint after a successful scan of the expected concept set.
 */
async function markRepoPiiScanned(repo_id) {
  return withSpan('okf.pii.markScanned', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    await db.collection(REPOS).update(repo_id, {
      pii_scan_status: 'complete',
      pii_scanned_at: new Date().toISOString()
    });
    recordOp('markScanned', 'success');
    logger.info('Repo marked PII-scanned', { repo_id });
  });
}

/**
 * FR-5/NFR-P1 blocking gate. blocked iff:
 *  - the repo has NO 'complete' PII scan marker (unscanned content — absent
 *    meta docs are invisible to a per-doc query, so the repo-level marker is
 *    the source of truth), OR
 *  - ANY concept has pii_state 'hit' | 'error'.
 * A repo with zero concepts AND a completed scan is NOT blocked (nothing to leak).
 * @returns {Promise<{blocked: boolean, reasons: string[]}>}
 */
async function assertPiiClean(repo_id) {
  return withSpan('okf.pii.gate', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    const reasons = [];

    // Repo-level scan marker (the unscanned-content guard).
    let scanStatus = 'pending';
    try {
      const repo = await db.collection(REPOS).document(repo_id);
      scanStatus = (repo && repo.pii_scan_status) || 'pending';
    } catch {
      /* repo missing — the caller enforces existence; gate stays conservative */
    }
    if (scanStatus !== 'complete') {
      reasons.push('repository has not completed a PII scan (pii_scan_status != complete)');
    }

    // Per-concept states.
    const cursor = await db.query(aql`
      FOR d IN ${db.collection(META)}
        FILTER d.repo_id == ${repo_id}
        COLLECT state = d.pii_state WITH COUNT INTO n
        RETURN { state, n }
    `);
    const counts = await cursor.all();
    const byState = Object.fromEntries(counts.map((r) => [r.state, r.n]));
    if ((byState.hit || 0) > 0) reasons.push(`${byState.hit} concept(s) with PII hits (pii_state=hit)`);
    if ((byState.error || 0) > 0) reasons.push(`${byState.error} concept(s) with scan errors (pii_state=error)`);

    const blocked = reasons.length > 0;
    span.setAttribute('okf.pii_gate_blocked', blocked);
    recordOp('gate', blocked ? 'blocked' : 'open');
    logger.info('PII publish gate evaluated', { repo_id, blocked, scanStatus, byState });
    return { blocked, reasons };
  });
}

// ─── FR-3 ingest version record (2.9.7 boundary: upload-moment, NOT publish) ─

/**
 * Record the ingest provenance on the repo doc: file_id, uploaded_at (read
 * from the files doc), curator, and a stable version_id derived from the
 * recorded content hash. bundle_version (2.9.7) stays the publish manifest.
 * @param {string} repo_id
 * @param {object} input {file_id, curator: {sub, name}}
 */
async function recordIngestVersion(repo_id, input) {
  return withSpan('okf.pii.recordIngestVersion', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    let uploadedAt = null;
    let hash = null;
    try {
      const fileDoc = await db.collection(FILES).firstExample({ file_id: input.file_id });
      if (fileDoc) {
        uploadedAt = fileDoc.uploaded_date || null;
        hash = fileDoc.file_hash || null;
      }
    } catch {
      logger.warn('Ingest version: files doc lookup failed', { file_id: input.file_id });
    }
    // Sanitize curator to {sub, name} — never persist source_ip (code-review fix).
    const curator = input.curator ? { sub: input.curator.sub || null, name: input.curator.name || null } : null;
    const lastIngest = {
      file_id: input.file_id,
      uploaded_at: uploadedAt,
      curator,
      version_id: hash ? `sha256:${String(hash).slice(0, 16)}` : null
    };
    await db.collection(REPOS).update(repo_id, { last_ingest: lastIngest });
    recordOp('recordIngestVersion', 'success');
    return lastIngest;
  });
}

// ─── FR-28 document references ───────────────────────────────────────────────

/**
 * Stable document reference for a concept's source file (FR-28) — reuses the
 * doc-repo's EXISTING view/download endpoints (no new doc-repo surface).
 * @param {string} file_id
 */
function getDocumentReference(file_id) {
  if (!file_id) return null;
  return {
    file_id,
    view_url: `/api/files/${file_id}/view`,
    download_url: `/api/files/${file_id}/download`
  };
}

/** Repo-level references: every file stamped with this repo_id (2.5 stamps it). */
async function getRepoDocumentReferences(repo_id) {
  const db = await getDb();
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(FILES)}
      FILTER f.repo_id == ${repo_id}
      SORT f.uploaded_date DESC
      RETURN f.file_id
  `);
  const ids = await cursor.all();
  return ids.map(getDocumentReference).filter(Boolean);
}

// ─── Discovery: repo files → scan inputs ────────────────────────────────────

/** Plain-text file types that can be scanned directly. Everything else (zip,
 * pdf, docx, ...) is rejected — scanning binary bytes as UTF-8 would produce
 * mojibake and a false "clean" (code-review fix: discovery must not silently
 * scan binaries/zips). */
const SCANNABLE_FILE_TYPES = ['text/markdown', 'text/plain', 'text/html', 'text/x-markdown'];

/**
 * Discover the repo's uploaded plain-text files (by repo_id — the field doc-repo stamps) and return
 * them as scan inputs. Binary/zips are skipped with a clear rejection — a
 * bundle zip is unzipped in Story 2.9.5, not scanned as raw bytes.
 * @returns {Promise<Array<{concept_id, frontmatter, body, file_id, file_type}>>}
 */
async function discoverRepoFiles(repo_id) {
  const db = await getDb();
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(FILES)}
      FILTER f.repo_id == ${repo_id}
      SORT f.uploaded_date DESC
      RETURN KEEP(f, ['file_id', 'file_name', 'file_type'])
  `);
  const files = await cursor.all();
  const out = [];
  for (const f of files) {
    if (!SCANNABLE_FILE_TYPES.includes(f.file_type)) {
      logger.warn('PII discovery skipped non-text file', { file_id: f.file_id, file_type: f.file_type });
      continue; // zip/pdf/docx are not scanned as raw bytes
    }
    const bytes = await fetchFileBytes(f.file_id); // FAIL-CLOSED: throws on failure
    const text = bytes ? bytes.toString('utf-8') : '';
    out.push({ concept_id: f.file_id, frontmatter: {}, body: text, file_id: f.file_id, file_type: f.file_type });
  }
  return out;
}

/** Fetch file bytes from the doc-repo view endpoint. FAIL-CLOSED: a fetch
 * failure THROWS (the caller marks pii_state='error'), so a doc-repo blip can
 * never produce a false "clean". The doc-repo view endpoint returns base64 at
 * res.data.data.base64 (verified fileController.viewFile). */
async function fetchFileBytes(fileId) {
  const config = require('../config');
  const { authedAxios } = require('./service-token');
  let res;
  try {
    res = await authedAxios.get(`${config.documentRepository.url}/api/files/${fileId}/view`, { timeout: 30000 });
  } catch (err) {
    const status = err.response && err.response.status;
    logger.warn('Doc-repo view fetch FAILED (fail-closed)', { file_id: fileId, status });
    const e = new Error(`doc-repo view fetch failed (${status || 'network'})`);
    e.code = 'DOCREPO_FETCH_ERROR';
    throw e;
  }
  const b64 = res.data && res.data.data && res.data.data.base64;
  if (typeof b64 !== 'string' || b64.length === 0) {
    logger.warn('Doc-repo view returned no base64 (fail-closed)', { file_id: fileId });
    const e = new Error('doc-repo view returned no base64');
    e.code = 'DOCREPO_FETCH_ERROR';
    throw e;
  }
  return Buffer.from(b64, 'base64');
}

module.exports = {
  scanConcept,
  inspectConcept,
  remediatePii,
  acceptPii,
  fileActionPii,
  repoBulkAction,
  redactWholeFile,
  listResolutions,
  subtractAccepted,
  upsertPiiState,
  assertPiiClean,
  markRepoPiiScanned,
  recordIngestVersion,
  getDocumentReference,
  getRepoDocumentReferences,
  discoverRepoFiles,
  fetchFileBytes,
  flattenFrontmatter,
  acknowledgePii
};
