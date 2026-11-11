/*
 * producer-service — Story 7.7 (David, 2026-09-14): import document-repository
 * files (pdf, docx, xlsx, md, html, txt — the repo's accepted upload formats,
 * appConfig.js allowedExtensions) into ONE OKF repository, processed, linked
 * and labeled AS A WHOLE. The Source Adapter Framework's Class-0 flagship
 * adapter: the files are ALREADY staged in doc-repo, so this service is pure
 * CONVERSION — it deliberately mirrors crawl-conversion-service's job pattern
 * (conversion record on the repo doc, shared FIFO slot semaphore, sweep,
 * terminal done|failed, batched ingestRepoConcepts, ONE curation pass at the
 * end, index concept LAST) so the dashboard/progress/lifecycle machinery
 * works unchanged. Downstream of this service everything is the normal
 * six-step OKF workflow.
 *
 * SOURCES-BUSY contract (the reason this story exists): ingested documents
 * CAN be imported, but the repository CANNOT be ingested until its source
 * documents are Retracted — lifecycle-service's buildingBlocker refuses the
 * ingest transition while any source_documents[] entry still serves the
 * free-form corpus (live fail-closed re-check, error SOURCES_NOT_RETRACTED).
 * The repo's OWN bundle zip (is_bundle=true, dataprep 'Ingested') is NOT a
 * source document — the gate keys on source_documents[] exclusively.
 */
const config = require('../config');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { authedAxios } = require('./service-token');
const { isArangoNotFound } = require('./arango-errors');
const { ingestRepoConcepts } = require('./ingest-service');
const { withSpan } = require('../shared-lib/tracing');
const crawlConversion = require('./crawl-conversion-service');
const { fetchDocMeta } = require('./doc-repo-client');
const { convertXlsx, slugify } = require('./converters/xlsxSheetConverter');
// FR-42 for CSV (David 2026-10-12): the SAME dictionary + row-group shape as
// xlsx, plus LLM topics summarised from the dictionary columns. Async (one
// remote LLM call per file), so convertDocument awaits its result.
const { convertCsv } = require('./converters/csvSheetConverter');
// Story 1-8g-p: whole-corpus topic-link authoring. Lazy-required inside the
// runner (house style — the service pulls in the LLM client) but the predicate
// is read at module scope for the early-out below.
const topicLinkAuthoring = require('./topic-link-authoring-service');
const { authorRepoTopicLinks, enabled: topicLinkAuthoringEnabled } = topicLinkAuthoring;

const COLLECTION = 'okf_repositories';

const MAX_FILES = Math.max(1, parseInt(process.env.OKF_MAX_IMPORT_FILES, 10) || 100);
const MAX_SEGMENTS_PER_FILE = 200;
const MIN_SEGMENT_CHARS = 200; // smaller sections merge into the previous one

// The SHARED conversion registry — ONE in-flight conversion per repo_id,
// whichever path started it (documents or crawl). It lives in
// crawl-conversion-service, next to the shared FIFO slot: the producer
// requires the crawl service (the crawl service must NOT require the
// producer — that direction is circular), so this is the one place both
// paths can share. It matters: a crawl conversion and a documents conversion
// write the SAME repo.conversion record (the crawl merges its patch, the
// producer replaces it), so running both on one repo leaves a record that
// describes neither run (issue #1684).
//
// The RESERVATION is the guard: the entry is claimed synchronously, BEFORE
// the awaited stages below, so a second start for the same repo cannot slip
// through a check-then-set window and import the corpus twice.
const live = crawlConversion.live;

// ── the CONTENT claim (issue #1744) ─────────────────────────────────────────
// The DUPLICATE_CONTENT gate READS what another repository already holds, so
// it is a check-then-act: the importing run writes its own source_documents
// only LATER (stampSources), so two runs importing the same corpus into two
// DIFFERENT repositories both read the pre-stamp state and both passed the
// gate — the same content landed in two live repositories. The per-repo
// reservation above does not cover it (different repo ids).
//
// The claim is what closes that window: the candidate files and their
// content hashes are claimed SYNCHRONOUSLY (check and set with no await in
// between, so a second run cannot slip through the gap) BEFORE the duplicate
// query, and released once the sources are stamped — from then on the
// stamped source_documents are what the gate reads.
//
// In-process, like the conversion registry above and the job registry
// (job-registry.js): okf-server runs as a single replica (compose: one
// container; swarm: replicas=${OKF_ENABLED:-0}), so the registry spans
// every import this service can run.
const contentClaims = new Map(); // claim key -> owning repo_id

/**
 * Claim the candidate files + their content hashes for one import.
 * Synchronous on purpose: the check and the set must not be separated by an
 * await, or a concurrent run could slip in between and claim the same
 * content.
 *
 * The rule matches the durable gate's: the same content may not back a
 * DIFFERENT live repository. The target repository is exempt (its own
 * content is its own), exactly as the gate exempts it — so the two guards
 * agree on what "the same content" means.
 *
 * @param {string} repoId the importing repository
 * @param {'file'|'hash'} kind the key namespace
 * @param {string[]} values the candidate file ids or content hashes
 * @returns {string[]} the claim keys (handed back to releaseContent)
 */
function claimContent(repoId, kind, values) {
  const keys = values.map((value) => `${kind}:${value}`);
  for (const key of keys) {
    const owner = contentClaims.get(key);
    if (owner !== undefined && owner !== repoId) {
      logger.warn('Content claim refused — the same content is in flight into another repository', {
        repo_id: repoId,
        claimed_by: owner
      });
      // Its own code: DUPLICATE_CONTENT means "already imported — retract or
      // delete that repository", and that remedy is WRONG for a run that is
      // still in flight. The message says "in flight" so the web client
      // shows its wait-for-the-run advice instead.
      throw Object.assign(
        new Error('the same content is in flight into another OKF repository — wait for that import to finish'),
        { code: 'DUPLICATE_CONTENT_IN_FLIGHT', status: 409 }
      );
    }
  }
  for (const key of keys) contentClaims.set(key, repoId);
  return keys;
}

/**
 * Drop every claim. TEST SUITE ONLY (the registry is private): a test that
 * aborts between a claim and its release would otherwise leave the content
 * claimed for the rest of the process.
 */
function resetContentClaims() {
  contentClaims.clear();
}

/**
 * Release a claim — ONLY the owner's claim: a late release must never drop
 * another import's claim.
 * @param {string} repoId the importing repository
 * @param {string[]|null} keys the keys returned by claimContent
 */
function releaseContent(repoId, keys) {
  if (!keys) return;
  for (const key of keys) {
    if (contentClaims.get(key) === repoId) contentClaims.delete(key);
  }
}

async function getDb() {
  return dbService.getConnection();
}

/**
 * Write the conversion record and hand back the record it REPLACED (AQL
 * RETURN OLD): the snapshot a refused start restores comes from the write
 * itself — no extra read, and exactly the record at the moment we took over.
 * (An ArangoDB UPDATE MERGES the nested `conversion` object by default — the
 * record is a SHARED slot: the crawl path and the zip path write their own
 * fields into it — so a write carries the fields it sets, not a replacement
 * of the whole record.)
 * @param {string} repoId
 * @param {object} patch the conversion record to write
 * @returns {Promise<object|null>} the previous record, or null when there was none
 */
async function patchConversionReturningOld(repoId, patch) {
  const db = await getDb();
  const cursor = await db.query(
    `LET doc = DOCUMENT(${COLLECTION}, @repo_id)
     FILTER doc != null
     UPDATE doc WITH { conversion: @patch, updated_at: @now } IN ${COLLECTION}
     RETURN OLD.conversion`,
    { repo_id: repoId, patch, now: new Date().toISOString() }
  );
  const rows = await cursor.all();
  const previous = rows && rows[0];
  return previous === undefined ? null : previous;
}

/**
 * Close a refused start — ONE atomic statement: the record is written only
 * while it is still THIS run's ('queued' with this run's started_at). The
 * conversion record is a SHARED slot — the zip-ingest path (which takes no
 * reservation) writes its own fields into it — so a read-then-write would
 * clobber a writer that slipped in between.
 * @param {string} repoId
 * @param {string} startedAt the started_at of the run that owns the record
 * @param {object} patch the record to write
 * @returns {Promise<boolean>} true when the record was written
 */
async function closeConversionIfOwned(repoId, startedAt, patch) {
  const db = await getDb();
  const cursor = await db.query(
    `LET doc = DOCUMENT(${COLLECTION}, @repo_id)
     FILTER doc != null
     FILTER doc.conversion != null && doc.conversion.status == 'queued' && doc.conversion.started_at == @startedAt
     UPDATE doc WITH { conversion: @patch, updated_at: @now } IN ${COLLECTION}
     RETURN 1`,
    { repo_id: repoId, patch, now: new Date().toISOString(), startedAt }
  );
  const rows = await cursor.all();
  return !!(rows && rows.length);
}

async function patchConversion(repoId, patch) {
  const db = await getDb();
  await db.query(
    `LET doc = DOCUMENT(${COLLECTION}, @repo_id)
     FILTER doc != null
     UPDATE doc WITH { conversion: @patch, updated_at: @now } IN ${COLLECTION}`,
    { repo_id: repoId || '', patch, now: new Date().toISOString() }
  );
}

/** FIFO slot — SHARED with crawl conversion (one heavy conversion at a time). */
async function acquireSlot() {
  return crawlConversion.acquireSlot();
}
function releaseSlot() {
  return crawlConversion.releaseSlot();
}

// ── source stamping ─────────────────────────────────────────────────────────

/** The doc-repo metadata for one source file: the import pre-flight's cached
 * copy when it carries the file, else a fresh GET. The cache is a FAST PATH,
 * not a contract — a caller that omits an entry gets the GET (issue #1691).
 * The lookup is an OWN-property read: a plain object resolves
 * 'constructor'/'__proto__' to an INHERITED value — truthy — so a cache miss
 * would silently skip the GET and stamp null metadata (issue #1685). */
async function sourceMeta(cache, file_id) {
  const cached = cache && Object.prototype.hasOwnProperty.call(cache, file_id) ? cache[file_id] : undefined;
  return cached || (await fetchDocMeta(file_id));
}

/**
 * Record the repository's source documents — the DURABLE record of what this
 * repository backs. The DUPLICATE_CONTENT gate (issue #1744) and the
 * SOURCES-BUSY lifecycle gate read it, so a FAILED write is FATAL: the
 * repository does not own its sources as far as every other guard is
 * concerned, and the import must not report success. It is written FIRST, so
 * a failure leaves nothing stamped anywhere: the per-file doc-repo stamps
 * would otherwise leave the files owned by a repository that does not list
 * them, and no gate would see the content again. (A missing repository
 * DOCUMENT is a different case: the write matches no row, and the import
 * fails rather than stamping files for a repository that does not exist.)
 *
 * The list is UPSERTED per file: an entry for a file this import carries is
 * replaced, the entries of the OTHER files stay. A second import into the
 * same repository must not erase the first one's sources — the gate reads
 * this list, so an erased hash would let the same content land in another
 * repository.
 *
 * RETENTION: the list only grows. It never forgets what the repository
 * backed — that is the point of the gate — so a retracted source stays listed
 * (with its content hash) until the repository is deleted.
 */
async function recordSourceDocuments(repoId, fileIds, metaByKey = Object.create(null)) {
  const db = await getDb();
  const metas = [];
  for (const file_id of fileIds) {
    let meta = { file_id, file_name: null, file_type: null, size_bytes: null, uploaded_date: null };
    try {
      const f = await sourceMeta(metaByKey, file_id);
      meta = {
        file_id,
        file_name: f.file_name || null,
        file_type: f.file_type || f.type || f.mimetype || null,
        size_bytes: Number.isFinite(f.size) ? f.size : Number.isFinite(f.size_bytes) ? f.size_bytes : null,
        uploaded_date: f.uploaded_date || null,
        file_hash: f.file_hash || null, // content key for the DUPLICATE_CONTENT gate
        dataprep_status: (f.dataprep && f.dataprep.status) || null,
        is_bundle: f.is_bundle === true
      };
    } catch (err) {
      logger.warn('Source-doc meta fetch failed (non-fatal)', { file_id, error: err.message });
    }
    metas.push(meta);
  }
  try {
    const written = await db.query(
      `LET doc = DOCUMENT(${COLLECTION}, @repo_id)
       FILTER doc != null
       LET kept = (
         FOR s IN (doc.source_documents || [])
           FILTER s.file_id NOT IN @file_ids
           RETURN s
       )
       UPDATE doc WITH {
         source_documents: APPEND(kept, @docs),
         updated_at: @now
       } IN ${COLLECTION}
       RETURN 1`,
      {
        repo_id: repoId,
        now: new Date().toISOString(),
        file_ids: fileIds,
        docs: metas.map((m) => ({
          kind: 'document',
          file_id: m.file_id,
          file_name: m.file_name,
          file_type: m.file_type,
          size_bytes: m.size_bytes,
          uploaded_date: m.uploaded_date,
          file_hash: m.file_hash || null,
          import_state: 'imported',
          retracted_at: null
        }))
      }
    );
    // The write updates the repository document when it exists. Zero rows
    // means the document is gone (the repository was deleted mid-import):
    // nothing was recorded, and the doc-repo stamps would then point at a
    // repository that does not exist.
    const rows = await written.all();
    if (!rows || rows.length === 0) {
      // The repository document is gone: nothing was recorded, and the
      // per-file stamps would point at a repository that does not exist.
      logger.error('source_documents record was not written — the repository document is gone', {
        repo_id: repoId
      });
      throw Object.assign(new Error('the repository no longer exists — the import was not completed'), {
        code: 'SOURCE_REPO_VANISHED',
        status: 404
      });
    }
  } catch (err) {
    // The vanished-repository error carries its own message — it is not a
    // write failure, and the client must be able to tell them apart.
    if (err && (err.code === 'SOURCE_STAMP_FAILED' || err.code === 'SOURCE_REPO_VANISHED')) throw err;
    // The internal reason stays in the log — the client gets a fixed sentence.
    logger.error('source_documents record could not be written — the import was not completed', {
      repo_id: repoId,
      error: err.message
    });
    throw Object.assign(
      new Error("the repository's source documents could not be recorded — the import was not completed"),
      { code: 'SOURCE_STAMP_FAILED', status: 500 }
    );
  }
  return metas;
}

/**
 * Stamp okf_repo_id onto each source file's doc-repo metadata (Story 3.6's
 * additive field) so the UI can gate "already in an OKF repo". These stamps
 * are FAIL-SOFT: the conversion reports them, it does not die for them.
 * metaByKey carries the import pre-flight's per-file doc-repo metadata,
 * suppressing the per-file GET; when it does not carry the file, the GET
 * remains the fallback. The cache is read with an OWN-property lookup and
 * defaults to a null-prototype object, so a prototype-named file id can
 * never resolve to an inherited value (issue #1685).
 *
 * @param {string} repoId
 * @param {object[]} metas the recorded source entries
 */
async function stampSourceFiles(repoId, metas) {
  const db = await getDb();
  // D4 (W4 story 2, 2026-11-04): stamp the repo's 6-1c restriction beside the
  // repo id so doc-repo's serve paths can refuse locally (no okf-server
  // round-trip at download time). Read at stamp moment from the repo doc —
  // the Access-panel toggle re-propagates on every later flip.
  let restricted = false;
  try {
    const repoDoc = await db.collection(COLLECTION).document(repoId);
    restricted = Boolean(repoDoc && repoDoc.acl && repoDoc.acl.restricted);
  } catch (err) {
    if (!isArangoNotFound(err)) {
      logger.warn('okf_restricted stamp: repo doc unreadable — stamping unrestricted (non-fatal)', {
        repo_id: repoId,
        error: err.message
      });
    }
  }
  let stampFailures = 0;
  for (const meta of metas) {
    try {
      await authedAxios.patch(
        `${config.documentRepository.url}/api/files/${encodeURIComponent(meta.file_id)}`,
        { okf_repo_id: repoId, okf_restricted: restricted },
        { timeout: 10000 }
      );
    } catch (err) {
      stampFailures += 1;
      logger.warn('okf_repo_id stamp failed (non-fatal)', { file_id: meta.file_id, error: err.message });
    }
  }
  // A stamp failure is per-file and non-fatal (the import must complete), but a
  // 100% failure rate means the "already in an OKF repo" guard is silently
  // DISABLED for the whole repository — which is how a 41/41 stamp failure went
  // unnoticed (2026-10-11: doc-repo's PATCH /api/files/:id was Admin-only while
  // the stamp is sent with the okf-service token). Say so ONCE, loudly, instead
  // of one WARN per file that reads as noise nobody can aggregate.
  if (stampFailures > 0) {
    logger[stampFailures === metas.length ? 'error' : 'warn'](
      `okf_repo_id stamp: ${stampFailures}/${metas.length} source file(s) NOT stamped — ` +
        (stampFailures === metas.length
          ? 'EVERY file failed, so this repository is not protected against a duplicate import. ' +
            'Check that doc-repo PATCH /api/files/:id permits the okf-service role AND its update schema accepts okf_repo_id.'
          : 'some files are not protected against a duplicate import.'),
      { repo_id: repoId, stamp_failures: stampFailures, files: metas.length }
    );
  }
}

/** Stamp the repository's sources: the durable record first (fatal), then
 * the per-file document-repository stamps (fail-soft). */
async function stampSources(repoId, fileIds, metaByKey = Object.create(null)) {
  const metas = await recordSourceDocuments(repoId, fileIds, metaByKey);
  await stampSourceFiles(repoId, metas);
  return metas;
}

/**
 * D4 (W4 story 2, 2026-11-04): re-propagate the repo's restriction snapshot
 * onto every stamped source file AFTER the import — the Access-panel toggle
 * (PUT /:repo_id/access) calls this on every flip so a repo restricted mid-
 * life does not leave its sources downloadable. Best-effort per file (the
 * per-file half of stampSources' contract): the toggle itself has already
 * succeeded and a
 * doc-repo hiccup must never undo it — the caller audits the result so a
 * stale snapshot is VISIBLE (named drift risk of the snapshot mechanism).
 * A source doc that is already gone (repo delete hard-purges backing files)
 * counts as settled, not failed.
 *
 * @param {string} repoId
 * @param {boolean} restricted
 * @returns {Promise<{repo_id, restricted, patched: string[], failed: Array<{file_id, error}>, gone: string[], total: number}>}
 */
async function propagateRestrictedToSources(repoId, restricted) {
  const db = await getDb();
  let fileIds; // the catch returns, so every fall-through use is assigned
  try {
    const repoDoc = await db.collection(COLLECTION).document(repoId);
    fileIds = ((repoDoc && repoDoc.source_documents) || []).map((s) => s && s.file_id).filter(Boolean);
  } catch (err) {
    logger.warn('okf_restricted propagation: repo doc unreadable — nothing propagated', {
      repo_id: repoId,
      error: err.message
    });
    return { repo_id: repoId, restricted, patched: [], failed: [], gone: [], total: 0 };
  }
  const patched = [];
  const failed = [];
  const gone = [];
  for (const file_id of fileIds) {
    try {
      await authedAxios.patch(
        `${config.documentRepository.url}/api/files/${encodeURIComponent(file_id)}`,
        { okf_restricted: restricted },
        { timeout: 10000 }
      );
      patched.push(file_id);
    } catch (err) {
      // 404 = the backing file is already gone (delete cascade) — settled.
      if (err && err.response && err.response.status === 404) gone.push(file_id);
      else failed.push({ file_id, error: err && err.message ? err.message : String(err) });
    }
  }
  if (failed.length > 0) {
    logger.warn(
      `okf_restricted propagation: ${failed.length}/${fileIds.length} source file(s) NOT updated — ` +
        'their snapshot may be stale (a restricted repo whose sources still serve). Audit + re-toggle to repair.',
      { repo_id: repoId, restricted, failed: failed.map((f) => f.file_id) }
    );
  }
  return { repo_id: repoId, restricted, patched, failed, gone, total: fileIds.length };
}

// ── fetch + convert ─────────────────────────────────────────────────────────

/** Stream /download into a Buffer with a hard byte cap (crawl-parity: the
 * content-length is often absent, so the cap is enforced on accumulation). */
async function downloadToBuffer(fileId, cap) {
  const res = await authedAxios.get(
    `${config.documentRepository.url}/api/files/${encodeURIComponent(fileId)}/download`,
    {
      responseType: 'stream',
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    res.data.on('data', (c) => {
      bytes += c.length;
      if (cap && bytes > cap) {
        res.data.destroy();
        const e = new Error(
          `document too large to convert (${bytes} bytes > limit ${cap}). Raise OKF_MAX_CRAWL_SOURCE_MB.`
        );
        e.code = 'DOC_SOURCE_TOO_LARGE';
        reject(e);
        return;
      }
      chunks.push(c);
    });
    res.data.on('end', () => resolve(Buffer.concat(chunks)));
    res.data.on('error', reject);
  });
}

/** Append a line to a SOURCE file's ingestion log — the operator-visible
 * channel for a document import (the admin's file view shows it). The
 * conversion report carries the same fact, but the report is a record; the
 * ingestion log is where the operator looks. Non-fatal by design: a failed
 * mirror never aborts an import.
 *
 * Distinct from the worker's bundle mirror (workers/ingestWorker.js), which
 * resolves the repo's BUNDLE zip and keys per-concept progress on it — that
 * one cannot carry a per-source-file entry. */
async function mirrorIngestionLog(fileId, message) {
  try {
    await authedAxios.post(
      `${config.documentRepository.url}/api/files/${encodeURIComponent(fileId)}/ingestion-log`,
      { level: 'WARN', stage: 'OKF topics', message },
      { timeout: 10000 }
    );
  } catch (err) {
    // The diagnosis travels IN the message string: the winston console
    // formatter strips metadata fields, so a mirror failure logged as
    // metadata would be invisible in the log stream.
    const status = err && err.response && err.response.status;
    const body = err && err.response && err.response.data ? JSON.stringify(err.response.data).substring(0, 200) : '';
    logger.warn(
      `Ingestion-log mirror failed (non-fatal): [${fileId}] status=${status || 'n/a'} err=${err.message}` +
        `${body ? ' body=' + body : ''}`
    );
  }
}

/** Extract text (or structured drafts) from a document buffer by extension. */
async function convertDocument(buffer, ext, meta) {
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const out = await pdfParse(buffer);
    return { text: structurePlainText((out && out.text) || '') };
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ buffer });
    return { text: structurePlainText((out && out.value) || '') };
  }
  if (ext === '.html' || ext === '.htm') {
    const TurndownService = require('turndown');
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    return { text: td.turndown(buffer.toString('utf8')) };
  }
  if (ext === '.xlsx') {
    return convertXlsx(buffer, meta); // FR-42: dictionary + row-groups, own links
  }
  if (ext === '.csv') {
    // FR-42: a CSV is ONE sheet — dictionary + row-groups, plus topics
    // summarised from the dictionary columns (csvSheetConverter). Without
    // this branch a CSV would fall through to the raw-text fallback below and
    // land as ONE comma-dense prose blob — content in the repo, but with no
    // table structure and nothing a row-level question could retrieve.
    return convertCsv(buffer, meta);
  }
  // .md / .txt and every text/* fallback
  return { text: buffer.toString('utf8') };
}

/** T6-lite (David, 2026-09-29: "I expected to see multiple markdown concept
 * files from the imported PDF"). pdf-parse/mammoth return FLAT text — no
 * heading structure — so segmentMarkdown kept the whole document as ONE
 * blob concept. This pass reconstructs conservative markdown structure so
 * the EXISTING segmenter can split:
 *   - numbered headings ("1. Introduction", "2.4 Filing") → "## …"
 *   - short standalone Title Case / ALL-CAPS lines → "## …"
 * Guard rails: text that already carries markdown headings is respected
 * (numbered headings only — never double-promote); prose lines never match
 * (word cap + standalone-line requirement); a hard cap on promotions bounds
 * garbage on pathological extractions. The full docling→producer pipeline
 * (real layout/table awareness) remains the P1 T6 item. */
function structurePlainText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return raw;
  const lines = raw.split(/\r?\n/);
  // Respect real markdown: if headings already exist, leave the text alone.
  if (/^#{1,6}\s+\S/m.test(raw)) return raw;
  const out = [];
  let promotions = 0;
  const PROMOTION_CAP = 200;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      out.push('');
      continue;
    }
    if (promotions < PROMOTION_CAP && isHeadingCandidate(t, lines[i + 1])) {
      out.push(`## ${t.replace(/\s+/g, ' ')}`);
      promotions += 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** A conservative heading candidate: numbered sections always; otherwise a
 * SHORT standalone line in Title Case or ALL CAPS followed by body text. */
function isHeadingCandidate(t, nextLine) {
  if (t.length > 80) return false;
  const words = t.split(/\s+/);
  if (words.length > 10) return false;
  // numbered: "1. Foo", "2.4 Bar", "3) Baz" — must carry text after the number
  if (/^\d+(\.\d+)*[.)]\s+\S/.test(t)) return nextLine !== undefined;
  // ALL CAPS (with digits/punct allowed), short
  if (/^[A-Z0-9][A-Z0-9 ,'&/().-]{2,59}$/.test(t) && /[A-Z]{2,}/.test(t)) {
    return nextLine === '' || (nextLine !== undefined && nextLine.trim().length > 0);
  }
  // Title Case-ish: most words capitalised, no trailing sentence punctuation
  const capitalised = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  if (words.length >= 2 && capitalised / words.length >= 0.6 && !/[.!?,;:]$/.test(t)) {
    return nextLine !== undefined;
  }
  return false;
}

// ── segmentation + cross-file links ─────────────────────────────────────────

/** WHOLE-FILE MARKDOWN IMPORT (field fix 2026-09-29, David's slaughterhouse
 * round-trip: "exported to a zip … imported the concept files … none of the
 * concept-to-concept links were created"). A .md file that already carries
 * frontmatter IS a curated concept file: it imports WHOLE — one concept,
 * concept id = the file stem (so exported repos round-trip and their
 * cross-file links resolve), frontmatter respected, body verbatim.
 * Re-segmenting such a file renamed every concept and stranded every link
 * (the editor graph drops dangling targets) and even produced empty
 * pre-heading fragments. Returns null for frontmatter-less markdown —
 * unstructured content keeps the T6-lite segmentation. */
function draftWholeMarkdown(text, { baseSlug, title: _title, meta }) {
  const raw = String(text || '');
  if (!/^---\r?\n/.test(raw)) return null; // no frontmatter block at all
  let fm;
  let content;
  try {
    const matter = require('gray-matter');
    const parsed = matter(raw); // gray-matter wants the WHOLE document (delimiters included)
    fm = parsed.data || {};
    content = parsed.content || '';
  } catch (err) {
    logger.warn('Whole-markdown frontmatter parse failed — falling back to segmentation', {
      baseSlug,
      error: err.message
    });
    return null;
  }
  if (!fm || typeof fm !== 'object' || !fm.title) return null; // no usable frontmatter
  const body = content.replace(/^\s*\n/, '').trim() + '\n';
  const frontmatter = { ...fm, title: String(fm.title).trim() };
  // Provenance (the standard rule — authorial sources are never touched):
  // a file with no authorial sources gets the importing document's stamp.
  if (!Array.isArray(frontmatter.sources) || frontmatter.sources.length === 0) {
    frontmatter.sources = [
      {
        kind: 'document',
        resource: meta.baseResource,
        file_id: meta.file_id,
        file_name: meta.file_name,
        locator: 'whole document'
      }
    ];
  }
  return [
    {
      path: `${baseSlug}.md`,
      frontmatter,
      body
    }
  ];
}

/** Split markdown text into section concepts on H1/H2/H3 headings; a document
 * without usable headings stays ONE concept. Tiny sections merge forward.
 * The locator rides sources[] so popup cards can point at the exact section. */
function segmentMarkdown(text, { baseSlug, title, meta }) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let cur = { heading: null, lines: [] };
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (m) {
      if (cur.heading !== null || cur.lines.join('').trim()) sections.push(cur);
      cur = { heading: m[2], lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.heading !== null || cur.lines.join('').trim()) sections.push(cur);

  if (sections.length === 0) return [];
  let usable = sections.filter((s) => s.lines.join('').trim().length >= MIN_SEGMENT_CHARS);
  if (usable.length === 0) usable = [sections[0]];
  if (usable.length > MAX_SEGMENTS_PER_FILE) {
    const overflow = usable.slice(MAX_SEGMENTS_PER_FILE - 1).join('');
    usable = usable.slice(0, MAX_SEGMENTS_PER_FILE - 1);
    usable[usable.length - 1].lines.push(overflow); // merged tail — never silently dropped
  }

  return usable.map((s, i) => {
    const multi = usable.length > 1;
    const path = multi ? `${baseSlug}-sec${i + 1}.md` : `${baseSlug}.md`;
    const secTitle = (s.heading && s.heading.trim()) || title || baseSlug;
    return {
      path,
      frontmatter: {
        type: 'topic',
        title: secTitle,
        sources: [
          {
            kind: 'document',
            resource: meta.baseResource,
            file_id: meta.file_id,
            file_name: meta.file_name,
            locator: multi ? `section "${secTitle}"` : 'whole document'
          }
        ]
      },
      body: `${s.lines.join('\n').trim()}\n`
    };
  });
}

/** Cross-file link resolution (the crawl rewriteCrossLinks analog, generalized
 * to the whole corpus): a markdown link whose target resolves to ANOTHER
 * concept in THIS import becomes frontmatter links[]. Self-references and
 * dangling targets never enter the list. Runs AFTER all files are drafted —
 * a file may link to any other. */
function resolveCrossFileLinks(drafts) {
  const pathSet = new Set(drafts.map((d) => d.path.replace(/\.md$/, '')));
  let links = 0;
  for (const d of drafts) {
    const ownId = d.path.replace(/\.md$/, '');
    const resolved = [];
    const seen = new Set();
    const body = String(d.body || '');
    const re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      let target = m[2].replace(/^\.\//, '').split('#')[0].trim();
      if (!target.toLowerCase().endsWith('.md')) target += '.md';
      const id = target.replace(/\.md$/, '');
      if (id === ownId || seen.has(id) || !pathSet.has(id)) continue;
      seen.add(id);
      resolved.push({ to_concept_id: id, label: (m[1] || '').trim() || 'related' });
    }
    if (resolved.length) {
      d.frontmatter = Object.assign({}, d.frontmatter, { links: resolved });
      links += resolved.length;
    }
  }
  return links;
}

// ── the run ──────────────────────────────────────────────────────────────────

async function runDocumentsConversion(job) {
  const { repo_id, file_ids, requested_name, classification, actor } = job;
  const startedAt = new Date().toISOString();
  await patchConversion(repo_id, {
    status: 'converting',
    stage: 'converting',
    requested_name,
    files_done: 0,
    files_total: file_ids.length,
    concepts_done: 0,
    batches_done: 0,
    per_file: [],
    error: null,
    started_at: startedAt,
    finished_at: null
  });

  const assertRepoAlive = async () => {
    const db = await getDb();
    let repo = null;
    try {
      repo = await db.collection(COLLECTION).document(repo_id);
    } catch (err) {
      if (!isArangoNotFound(err)) throw err;
    }
    if (!repo || repo.deleted_at) {
      const e = new Error('repository ' + repo_id + ' was deleted mid-conversion — terminating the import');
      e.code = 'REPO_GONE';
      throw e;
    }
  };

  const cap = crawlConversion.maxSourceBytesFromEnv();
  const allDrafts = [];
  const perFile = [];
  let filesDone = 0;
  // B1 parity (audit 2026-09-29): the terminal record's summary now carries
  // the slug-merge counts too, so the wizard's accounting renders
  // "N new · M merged by slug" for BOTH conversion routes (the crawl path
  // writes the same shape). Index/meta rows are not special-cased here —
  // the documents route produces none.
  const ingestSummary = { created: 0, updated: 0, skipped_dedup: 0 };

  const flush = async (batch) => {
    if (batch.length === 0) return;
    await assertRepoAlive();
    const s = await ingestRepoConcepts(repo_id, { concepts: batch, classification, skipCuration: true }, actor); // IMPORT (not RAG)
    if (s) {
      ingestSummary.created += s.created || 0;
      ingestSummary.updated += s.updated || 0;
      ingestSummary.skipped_dedup += s.skipped_dedup || 0;
    }
  };

  try {
    for (const file_id of file_ids) {
      await assertRepoAlive();
      const meta = {
        file_id,
        file_name: file_id,
        baseResource: `${config.documentRepository.url}/api/files/${file_id}`
      };
      try {
        // SELF-SUFFICIENT metadata (issue #1691): the caller's cache is a fast
        // path, not a contract — a caller that omits an entry gets the
        // doc-repo GET instead of a per-file TypeError swallowed by the
        // per-file catch (every file reported CONVERSION_FAILED).
        const f = await sourceMeta(job.source_metas, file_id);
        meta.file_name = f.file_name || file_id;
        meta.file_type = f.file_type || f.type || f.mimetype || null;
        const size = Number.isFinite(f.size) ? f.size : null;
        if (size && size > cap) {
          throw Object.assign(new Error(`document too large (${size} > ${cap}) — raise OKF_MAX_CRAWL_SOURCE_MB`), {
            code: 'DOC_SOURCE_TOO_LARGE'
          });
        }
        const buf = await downloadToBuffer(file_id, cap);
        const ext = (String(meta.file_name).match(/(\.[a-z0-9]+)\s*$/i) || [])[1];
        const lower = (ext || '').toLowerCase();
        if (!['.pdf', '.docx', '.xlsx', '.csv', '.md', '.html', '.htm', '.txt'].includes(lower)) {
          throw Object.assign(new Error(`unsupported document format "${lower || meta.file_name}"`), {
            code: 'DOC_FORMAT_UNSUPPORTED'
          });
        }
        const converted = await convertDocument(buf, lower, meta);
        // BOTH tabular converters return {concepts, sheets} (an ARRAY of drafts)
        // while every other converter returns {text}. A .csv sibling of .xlsx MUST be
        // listed here too, or its concepts are silently dropped and the file
        // reports "imported" with nothing in the repo.
        if (lower === '.xlsx' || lower === '.csv') {
          allDrafts.push(...converted.concepts);
          const entry = { file_id, file_name: meta.file_name, status: 'imported', concepts: converted.concepts.length };
          // The topics leg states WHY it degraded (the fallback owner owns
          // the vocabulary); the importer copies that reason into the import
          // report and into the file's ingestion log. The import lands
          // anyway, but the operator must see the degradation.
          const topics = converted.topics;
          if (topics && topics.reason) {
            entry.topics_source = topics.source;
            // Phrased as the decision taken, not as an import outcome: the
            // ingestion log is append-only, so a warning that asserts
            // completion would survive a later failed flush as a lie. And
            // the two degradation shapes differ: a leg that degraded still
            // carries a fallback topic, a summariser that threw carries
            // none — the sentence says which.
            const hasFallbackTopic = Array.isArray(topics.topics) && topics.topics.length > 0;
            const warning = hasFallbackTopic
              ? `Topics degraded — ${topics.reason}. The concepts carry a fallback topic instead of an LLM-derived one.`
              : `Topics degraded — ${topics.reason}. No topic was applied to the concepts.`;
            entry.warning = warning;
            // NOT awaited: the mirror is best-effort (the same channel and the
            // same call the ingest worker fires without await — workers/ingestWorker.js),
            // and a doc-repo round trip per file has no business on the import's
            // critical path. The conversion report above carries the same fact.
            mirrorIngestionLog(file_id, `[${repo_id}] ${warning}`);
          }
          perFile.push(entry);
        } else {
          const baseSlug = slugify(String(meta.file_name).replace(/\.[^.]+$/, '')) || `document-${perFile.length + 1}`;
          const title =
            String(meta.file_name)
              .replace(/\.[^.]+$/, '')
              .replace(/[-_]+/g, ' ')
              .trim() || baseSlug;
          // WHOLE-FILE first: a frontmatter-bearing .md is already a curated
          // concept (see draftWholeMarkdown) — never re-segment it.
          const drafts =
            (lower === '.md' && draftWholeMarkdown(converted.text, { baseSlug, title, meta })) ||
            segmentMarkdown(converted.text, { baseSlug, title, meta });
          allDrafts.push(...drafts);
          perFile.push({ file_id, file_name: meta.file_name, status: 'imported', concepts: drafts.length });
        }
      } catch (err) {
        // PER-FILE ISOLATION (the import report's partial-failure framing):
        // one bad document never aborts the batch.
        logger.warn(`Document import failed for file=${file_id}: ${err.message}`);
        perFile.push({
          file_id,
          file_name: meta.file_name,
          status: 'failed',
          error: err.message,
          code: err.code || 'CONVERSION_FAILED'
        });
      }
      filesDone += 1;
      await patchConversion(repo_id, {
        status: 'converting',
        files_done: filesDone,
        per_file: perFile.slice()
      });
    }

    if (allDrafts.length === 0) {
      throw Object.assign(new Error('no concepts could be derived from the selected documents'), {
        code: 'NOTHING_IMPORTED'
      });
    }

    // WHOLE-CORPUS LINKING (David: "processed, linked … as a whole"): one pass
    // across ALL drafts — a file may link any other.
    await patchConversion(repo_id, { status: 'cross-linking', stage: 'cross-linking' });
    const linkCount = resolveCrossFileLinks(allDrafts);

    // Batched ingest (crawl-parity sizes).
    // CONCEPTS TOTAL published up front (David, 2026-10-11: "we need progress
    // bars with each of the stages being depicted in Step 4"). allDrafts is
    // complete by now — the file loop above drafted every topic — so the
    // denominator is known and the bar is a REAL count, not a guess. Without it
    // the concepts stage had no bar at all and Step 4 sat at 100% on files
    // while the topics were still being written.
    await patchConversion(repo_id, {
      status: 'classifying',
      stage: 'classifying',
      concepts_total: allDrafts.length
    });
    const BATCH = 200;
    let batches = 0;
    for (let i = 0; i < allDrafts.length; i += BATCH) {
      await flush(allDrafts.slice(i, i + BATCH));
      batches += 1;
      await patchConversion(repo_id, { concepts_done: Math.min(allDrafts.length, i + BATCH), batches_done: batches });
    }

    // Rooted-graph index concept LAST (links resolve per-path) — the file set
    // becomes the repository's table of contents. Bypasses the accumulating
    // flush() on purpose (verifier B5, 2026-09-29): the index is a meta row,
    // not a produced topic — folding its created:1 into ingestSummary
    // over-counted every fresh repo's summary by exactly one. Mirrors the
    // crawl route, which never folds its index in.
    const indexTitle = requested_name || 'Imported knowledge base';
    const contents = allDrafts
      .map((d) => `- [${(d.frontmatter && d.frontmatter.title) || d.path.replace(/\.md$/, '')}](./${d.path})`)
      .join('\n');
    await ingestRepoConcepts(
      repo_id,
      {
        concepts: [
          {
            path: 'index.md',
            frontmatter: {
              type: 'index',
              title: indexTitle,
              // Born-right (#1651): every sources entry carries its resource —
              // the same baseResource shape every topic concept gets below —
              // or the conformance validator flags all 50 and the autocorrect
              // sheet has nothing derivable to propose (El Salvador, live).
              sources: file_ids.map((file_id) => ({
                kind: 'document',
                file_id,
                resource: `${config.documentRepository.url}/api/files/${file_id}`
              }))
            },
            body:
              `# ${indexTitle}\n\nThis repository was imported from ${file_ids.length} document(s). ` +
              `The concepts below are the imported content, linked where the documents reference each other.\n\n## Contents\n\n${contents}\n`
          }
        ],
        classification,
        skipCuration: true
      },
      actor
    );
    batches += 1;

    // WHOLE-CORPUS LABELING: ONE curation pass over the whole import — the
    // SAME shared finalize every adapter uses (crawl parity; fail-soft).
    if (classification) {
      await patchConversion(repo_id, { status: 'classifying', stage: 'curating' });
      try {
        const cDb = await getDb();
        const cRepo = await cDb.collection(COLLECTION).document(repo_id);
        const { runImportCuration } = require('./ingest-service');
        await runImportCuration(repo_id, cRepo, classification);
      } catch (err) {
        logger.warn('Documents curation pass failed (non-fatal)', { repo_id, error: err.message });
      }
    }

    // WHOLE-CORPUS TOPIC LINK AUTHORING (Story 1-8g-p): the import above only
    // links what the source documents already cite. A corpus of bulletins that
    // never cites itself lands with an empty graph — this authors the missing
    // edges with the SAME generic service the editor exposes on demand
    // (POST /repos/:id/topic-links). Runs AFTER labeling so the neighbour index
    // sees labels + summaries. Fail-soft: a failed pass leaves the structural
    // links intact and the import still reports done.
    let topicLinks = null;
    if (topicLinkAuthoringEnabled()) {
      await patchConversion(repo_id, { status: 'linking-topics', stage: 'linking-topics' });
      try {
        const cDb = await getDb();
        const cRepo = await cDb.collection(COLLECTION).document(repo_id);
        // Per-batch progress so Step 4 can draw a REAL bar for this stage
        // (David, 2026-10-11: "we need progress bars with each of the stages
        // being depicted in Step 4"). Without it the stage is a flat panel for
        // ~3 minutes with no indication anything is happening — the exact
        // complaint. Throttled to one write per 2s; the final call passes
        // through unthrottled so the terminal counters are never lost.
        let lastLinkWrite = 0;
        // Progress writes are SERIALISED through one chain and the chain is
        // awaited before the run returns. Fired detached, an intermediate
        // write could land AFTER the terminal one, so the last value the UI
        // ever saw was a stale partial counter rather than the final state.
        let linkWrites = Promise.resolve();
        const writeLinkProgress = (p) => {
          linkWrites = linkWrites
            .then(() =>
              patchConversion(repo_id, {
                link_progress: {
                  phase: p.phase || null,
                  batches_done: p.batches_done || 0,
                  batches_total: p.batches_total || 0,
                  written: p.written || 0
                }
              })
            )
            .catch((e) => logger.warn('OKF topic-link progress write failed: ' + e.message, { repo_id }));
          return linkWrites;
        };
        topicLinks = await authorRepoTopicLinks(cRepo, {
          actor,
          onProgress: (p) => {
            const now = Date.now();
            if (!p.final && now - lastLinkWrite < 2000) return;
            lastLinkWrite = now;
            writeLinkProgress(p);
          }
        });
        await linkWrites; // the terminal counters are durable before the run moves on
        logger.info(
          `Documents topic-link authoring: ${topicLinks.written} link(s) across ${topicLinks.concepts_linked}/${topicLinks.total} concept(s) in ${topicLinks.elapsed_ms}ms`
        );
      } catch (err) {
        logger.warn('Documents topic-link authoring failed (non-fatal)', { repo_id, error: err.message });
      }
    }

    const failedFiles = perFile.filter((p) => p.status === 'failed').length;
    await patchConversion(repo_id, {
      status: 'done',
      stage: 'done',
      files_done: filesDone,
      files_total: file_ids.length,
      per_file: perFile.slice(),
      concepts_done: allDrafts.length,
      batches_done: batches,
      links: linkCount,
      summary: {
        files_total: file_ids.length,
        files_imported: filesDone - failedFiles,
        files_failed: failedFiles,
        concepts: allDrafts.length,
        links: linkCount,
        // Story 1-8g-p: structural (authored-in-source) vs AUTHORED
        // (whole-corpus semantic) edges are counted separately so the wizard
        // can say which mechanism produced the graph.
        authored_links: topicLinks ? topicLinks.written : 0,
        created: ingestSummary.created,
        updated: ingestSummary.updated,
        skipped_dedup: ingestSummary.skipped_dedup
      },
      finished_at: new Date().toISOString()
    });
    logger.info(
      `Documents conversion DONE repo=${repo_id} files=${filesDone}/${file_ids.length} concepts=${allDrafts.length} links=${linkCount}` +
        (topicLinks ? ` authored=${topicLinks.written}` : '')
    );
  } catch (err) {
    logger.error(`Documents conversion FAILED repo=${repo_id} code=${err.code || '-'}: ${err.message}`);
    await patchConversion(repo_id, {
      status: 'failed',
      stage: 'failed',
      error: err.message,
      code: err.code || 'CONVERSION_FAILED',
      summary: null, // the record is merged — the previous run's summary must not survive
      per_file: perFile.slice(),
      finished_at: new Date().toISOString()
    });
    throw err;
  }
}

// ── entry ────────────────────────────────────────────────────────────────────

async function startDocumentsConversion({ repo_id, file_ids, requested_name, classification, actor }) {
  if (!repo_id) throw Object.assign(new Error('repo_id is required'), { code: 'VALIDATION_ERROR', status: 400 });
  if (!Array.isArray(file_ids) || file_ids.length === 0) {
    throw Object.assign(new Error('file_ids must be a non-empty array'), { code: 'VALIDATION_ERROR', status: 400 });
  }
  if (file_ids.length > MAX_FILES) {
    throw Object.assign(
      new Error(`too many documents selected (${file_ids.length} > ${MAX_FILES}) — raise OKF_MAX_IMPORT_FILES`),
      { code: 'TOO_MANY_FILES', status: 400 }
    );
  }
  if (new Set(file_ids).size !== file_ids.length) {
    throw Object.assign(new Error('file_ids contains duplicates'), { code: 'VALIDATION_ERROR', status: 400 });
  }

  // ONE conversion per repo at a time, whichever path started it — claimed
  // synchronously by the one shared guard implementation (issue #1684), so
  // the repo is invisible to a second start for the whole of the awaited
  // window below (the pre-flight + the queued patch + the per-file source
  // stamping).
  //
  // The claim is taken BEFORE the import pre-flight (issue #1775): the
  // pre-flight costs up to OKF_MAX_IMPORT_FILES doc-repo metadata GETs plus
  // the duplicate query, and a racing start used to pay all of it before it
  // was refused. The cheap shape validations above still come first, so a
  // malformed request keeps its own VALIDATION_ERROR.
  await crawlConversion.sweepInterruptedOnce();
  const settleInFlight = crawlConversion.reserveConversion(repo_id);

  // Idempotency contract (story 7.7): a document stamped by a DIFFERENT,
  // still-existing OKF repository is a 409 — the UI badge is advisory only.
  // A stamp whose repo no longer exists is STALE and self-heals (restamped
  // by stampSources below), so a deleted repo never bricks its documents.
  // CONTENT contract (David, 2026-09-14): the same is true for the same
  // CONTENT in a DIFFERENT file — doc-repo stores every file's SHA-256, and
  // a candidate whose hash already backs a LIVE repository is refused, so
  // re-uploaded copies of one corpus can never fork the knowledge base.
  //
  // ONE metadata fetch per file: this pre-flight read is the import's single
  // doc-repo metadata round trip — it rides on to stamping (metaByKey) and
  // the conversion (job.source_metas). The cache is null-prototype: a plain
  // object resolves a prototype-named file id to an INHERITED value (issue
  // #1685).
  const queued = {
    status: 'queued',
    stage: 'queued',
    files_done: 0,
    files_total: file_ids.length,
    error: null,
    started_at: new Date().toISOString()
  };
  const metaByKey = Object.create(null);
  // The content claim (issue #1744) — released on every path below.
  let claimed = [];
  // The conversion record as it stands BEFORE this run writes anything (the
  // queued write below hands it back): a refused start must leave the
  // repository as it found it.
  let previous = null;
  try {
    // The conversion record is written FIRST, so the repository SHOWS the run
    // while the pre-flight works: the reservation now spans the pre-flight,
    // and a lock with no visible owner is a lock nobody can explain (#1775).
    // The write hands back the record it replaced: a refused start restores
    // exactly that one (see the catch below).
    previous = await patchConversionReturningOld(repo_id, queued);

    // The FILES are claimed BEFORE the pre-flight: the claim is what closes
    // the duplicate-content window, and claiming the files first also keeps
    // a refused RETRY (the web client retries an in-flight answer) from
    // paying the pre-flight again.
    claimed = claimContent(repo_id, 'file', file_ids);

    const db = await getDb();
    const candidateHashes = []; // the content hashes — the gate matches on them
    for (const file_id of file_ids) {
      let meta;
      try {
        meta = await fetchDocMeta(file_id);
        metaByKey[file_id] = meta;
      } catch (err) {
        // The internal reason stays in the log — the client gets a fixed
        // sentence naming the document, not the upstream error text.
        logger.warn('Source document could not be verified in the document repository', {
          repo_id,
          file_id,
          error: err.message
        });
        throw Object.assign(new Error(`source document ${file_id} could not be verified in the document repository`), {
          code: 'SOURCE_UNVERIFIABLE',
          status: 502
        });
      }
      const stamped = meta && meta.okf_repo_id;
      if (stamped && stamped !== repo_id) {
        let exists;
        try {
          exists = !!(await db.collection(COLLECTION).document(stamped));
        } catch {
          exists = false; // tombstoned/gone → stale stamp, import proceeds
        }
        if (exists) {
          throw Object.assign(
            new Error(`document "${meta.file_name || file_id}" is already the source of OKF repository ${stamped}`),
            { code: 'DOCUMENT_IN_ANOTHER_REPO', status: 409 }
          );
        }
      }
      if (meta && meta.file_hash) {
        candidateHashes.push(meta.file_hash);
      }
    }
    // The CONTENT is claimed too, now that the hashes are known (issue
    // #1744): the duplicate query reads the OTHER repositories' stamped
    // sources, and this run's own stamp only lands later — so without the
    // claim two concurrent runs into two DIFFERENT repositories both pass the
    // query and the same content ends up in two live repositories.
    claimed = claimed.concat(claimContent(repo_id, 'hash', candidateHashes));
    if (candidateHashes.length > 0) {
      const dupRows = await db.query(
        `FOR r IN ${COLLECTION}
           FILTER r.deleted_at == null AND r.repo_id != @rid AND r.lifecycle_state != 'retracted'
           LET dupFiles = (
             FOR s IN (r.source_documents || [])
               FILTER s.file_hash != null AND POSITION(@hashes, s.file_hash)
               RETURN {file_id: s.file_id, file_name: s.file_name}
           )
           FILTER LENGTH(dupFiles) > 0
           SORT r.created_at
           LIMIT 1
           RETURN {repo_id: r.repo_id, name: r.name, dupFiles}`,
        { rid: repo_id, hashes: candidateHashes }
      );
      const dup = (await dupRows.all())[0];
      if (dup) {
        const names = dup.dupFiles.map((d) => d.file_name || d.file_id).join(', ');
        throw Object.assign(
          new Error(
            `the same content is already imported into OKF repository "${dup.name}" (files: ${names}) — delete that repository before importing these documents`
          ),
          { code: 'DUPLICATE_CONTENT', status: 409 }
        );
      }
    }
    await stampSources(repo_id, file_ids, metaByKey);
  } catch (err) {
    // A refused start must leave the repository as it found it. The
    // conversion record is merged, so a prior TERMINAL record
    // — a healthy 'done' with its summary — is RESTORED instead of being
    // overwritten with 'failed': the web client renders a failed record as
    // "import failed — delete the repository", which would be a lie about a
    // healthy repository. With no prior terminal record, the record is
    // closed as failed: the interrupted-conversion sweep is one-shot per
    // process and has already run, so nothing else would ever close a queued
    // record with no worker. It is written BEFORE the reservation is
    // released — a write landing after a concurrent start's own record
    // would clobber it.
    //
    // COMPARE-AND-SET: the record is written only while it is still THIS
    // run's ('queued', with this run's started_at). The zip-ingest path does
    // NOT take the conversion reservation and MERGEs into the same
    // attribute — a blind write here would destroy that writer's progress
    // record, which is the very clobber this restore exists to avoid.
    const close =
      previous && crawlConversion.isTerminal(previous)
        ? previous
        : {
            status: 'failed',
            stage: 'failed',
            error: err.message,
            code: err.code || 'CONVERSION_FAILED',
            summary: null, // the record is merged — the previous run's summary must not survive
            files_done: 0,
            files_total: file_ids.length,
            per_file: [],
            started_at: queued.started_at,
            finished_at: new Date().toISOString()
          };
    try {
      // ONE atomic statement: the record is written only while it is still
      // THIS run's. The conversion record is a shared slot — the zip-ingest
      // path (which takes no reservation) writes its own fields into it — so
      // a blind write would clobber that writer.
      const written = await closeConversionIfOwned(repo_id, queued.started_at, close);
      if (!written) {
        logger.warn("Conversion record is not this run's — left untouched", { repo_id });
      }
    } catch (patchErr) {
      // The request is already an error; this is the SECOND failure — the
      // repository keeps a 'queued' record it never closes, which blocks its
      // transitions. It must not be a quiet warning.
      logger.error('Failed-start record could not be written — the repository keeps a queued conversion', {
        repo_id,
        error: patchErr.message
      });
    }
    // The reservation must not outlive a failed start — the repo is free again.
    releaseContent(repo_id, claimed);
    crawlConversion.releaseConversion(repo_id, settleInFlight);
    throw err;
  }
  // The sources are stamped: from here on the DUPLICATE_CONTENT gate reads
  // this repository's own content, so the claim has done its job.
  releaseContent(repo_id, claimed);

  const job = { repo_id, file_ids, source_metas: metaByKey, requested_name, classification, actor: actor || null };
  const runner = (async () => {
    let acquired = false;
    try {
      // The slot acquire is INSIDE the try: a rejection there must still
      // release the reservation, or the repo stays 409-locked forever.
      await acquireSlot();
      acquired = true;
      await withSpan('okf.documents.conversion', async (span) => {
        span.setAttribute('okf.repo_id', repo_id);
        span.setAttribute('okf.files_total', file_ids.length);
        await runDocumentsConversion(job);
      });
    } catch {
      // Terminal state already recorded by runDocumentsConversion.
    } finally {
      if (acquired) releaseSlot();
      crawlConversion.releaseConversion(repo_id, settleInFlight);
    }
  })();
  // The runner swallows its own errors (the terminal state is recorded by
  // runDocumentsConversion); this guard keeps a rejection raised in its
  // finally from surfacing as an unhandled rejection — Node 22 treats those
  // as fatal.
  runner.catch(() => {});
  return queued;
}

module.exports = {
  startDocumentsConversion,
  live, // the SHARED conversion registry (documents + crawl), see crawl-conversion-service
  // The content claim registry (issue #1744) stays PRIVATE — a consumer
  // that could wipe it would silently re-open the window it closes. The
  // reset below is the only seam, and it exists for the test suite: a test
  // that aborts between the claim and its release would otherwise leave the
  // content claimed for the rest of the process.
  resetContentClaims,
  // D4: the restricted-snapshot stamp + the Access-toggle propagation
  stampSources,
  propagateRestrictedToSources,
  // exported for unit tests (pure functions)
  segmentMarkdown,
  draftWholeMarkdown,
  resolveCrossFileLinks,
  structurePlainText,
  isHeadingCandidate
};
