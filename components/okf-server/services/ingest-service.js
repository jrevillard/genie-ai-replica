// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Write-side orchestrator (Story 2.9.1, gap G1 — ADR-okf-021 §2.3 steps 4a–4f).
// Owns the per-concept ingest sequence and is the SOLE ACL-label injector
// (the only component that knows repo→tenant/domain):
//   4a parseConcept → 4b FULL meta upsert → 4c validate+persist (patch-only)
//   → 4d PII scan (fail-closed: 'error' blocks publish, never fails ingest)
//   → 4e content-hash dedup → 4f enqueue (doc-repo ingest-bundle, defer_kick)
// The HTTP layer returns 202 once every concept completes 4a–4f (or its
// per-concept error) — the request NEVER blocks on dataprep; draining Pending
// files docs is the 2.9.4 worker's job. No Redis here (decision D-D).
//
// 2026-08-16 review fixes: markdown serialization via gray-matter (js-yaml),
// 4a parse isolation, pre-upsert 4e dedup read, caller ACL-label stripping,
// slug collision handling, 30s enqueue timeout, file_ids not_found
// reconciliation, stored-file branch always re-parses, summary.parsed/success.

const AdmZip = require('adm-zip');
const matter = require('gray-matter');
const { aql } = require('arangojs');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const parserService = require('./parser-service');
const conformanceService = require('./conformance-service');
const conceptMetaService = require('./concept-meta-service');
const piiService = require('./pii-service');
const repositoryService = require('./repository-service');
const auditService = require('./audit-service');
const { authedAxios } = require('./service-token');
const dbService = require('../shared-lib/db-connection-service');
const config = require('../config');

const DEFAULT_MAX_CONCEPTS = 200;
const ENQUEUE_TIMEOUT_MS = 30000; // 4f cap — never hang the request on doc-repo
const DEFAULT_MAX_ZIP_BYTES = 26214400; // 25 MiB decompressed cap (zip-bomb guard)

const meter = getMeter();
const opsCounter = meter.createCounter('okf_ingest_operations_total', {
  description: 'OKF orchestrator ingest operations'
});
function recordOp(operation, status) {
  try {
    opsCounter.add(1, { operation, status });
  } catch {
    /* meter no-op when observability off */
  }
}

/** Caller-supplied labels with an ACL prefix are NEVER trusted — the
 * orchestrator is the sole injector (a caller must not re-scope concepts). */
const ACL_LABEL_RE = /^t:|^r:|^d:/i;

class IngestError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** OKF_INGEST_MAX_CONCEPTS resolver shared by the controller pre-check and
 * the service cap (a garbage env value falls back to the default — parseInt's
 * NaN silently disables a hand-rolled `x > NaN` comparison). */
function maxConceptsFromEnv() {
  const parsed = parseInt(process.env.OKF_INGEST_MAX_CONCEPTS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCEPTS;
}

/** Decompressed zip size cap (zip-bomb guard). */
function maxZipBytesFromEnv() {
  const parsed = parseInt(process.env.OKF_INGEST_MAX_ZIP_BYTES || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ZIP_BYTES;
}

/** Sole ACL injector (D-A): t: and d: carry the repo domain in v1 (no tenant
 * field exists; 6.1b's resolver owns per-axis derivation later); r: pins the
 * repo. Lowercase prefixes, case-sensitive — dataprep's pinned boundary. */
function deriveAclLabels(repo) {
  return [`t:${repo.domain}`, `r:${repo.repo_id}`, `d:${repo.domain}`];
}

/** Slugify a title (or name) into a stable path component: "Service Directory"
 * → "service-directory". ASCII-fold, lowercase, non-alphanum → '-'. May return
 * '' for non-Latin input — uniquifySlug() handles that (empty is a collision
 * class of its own: every non-Latin title would otherwise collide). */
function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Collision-free slug per batch (review fix): an empty slug (non-Latin) or an
 * in-batch duplicate gets a '-' + 8-hex content-hash suffix; identical title
 * AND body (hash collision too) falls back to a numeric tiebreaker. */
function uniquifySlug(base, body, seen) {
  let slug = base;
  if (!slug || seen.has(slug)) {
    const hash8 = conceptMetaService.contentHash(body).slice(0, 8);
    slug = `${slug || 'concept'}-${hash8}`;
    for (let n = 2; seen.has(slug); n += 1) slug = `${base || 'concept'}-${hash8}-${n}`;
  }
  seen.add(slug);
  return slug;
}

/** Explicit concepts[] input → parse inputs (path from explicit path, else the
 * frontmatter title slug, else an index — concept_id derives concepts/<slug>). */
function normalizeInputs(input) {
  const { concepts } = input || {};
  if (Array.isArray(concepts) && concepts.length > 0) {
    const seen = new Set();
    return concepts.map((c, i) => {
      const fm = c.frontmatter || {};
      const body = c.body || '';
      const name = c.path || fm.title || `concept-${i + 1}`;
      const base = name.includes('.md') ? name.replace(/\.md$/, '') : slugify(name);
      return { concept_id: null, path: `${uniquifySlug(base, body, seen)}.md`, frontmatter: fm, body };
    });
  }
  return null; // file_ids/discover handled by the caller (async fetch)
}

/** Serialize concept input back to .md via gray-matter's js-yaml engine
 * (review fix — live-confirmed corruption: the hand-rolled line emitter
 * produced invalid YAML the moment a value carried a colon/quote, so 4a
 * re-parse threw PARSE_ERROR 400 mid-batch). Empty frontmatter emits NO block
 * (verified) — a stored file's own frontmatter stays intact for 4a to lift. */
function markdownFor(input) {
  return matter.stringify(input.body || '', input.frontmatter || {});
}

/** Duplicate entry names in a bundle's central directory (crafted by foreign
 * zip tools; adm-zip's own writer dedups) — an ambiguous bundle is rejected,
 * never silently disambiguated. Pure, exported for unit tests. */
function findDuplicateEntryNames(entryNames) {
  return [...new Set(entryNames.filter((n, i) => entryNames.indexOf(n) !== i))];
}

/** OKF bundle zip intake (Story 2.9.5 contract, pulled into 2.9.1 by the
 * 2026-08-16 directive): a bundle IS a zip of `.md` concept files. Server-side
 * unzip → one raw input per entry; each entry's own frontmatter is lifted by
 * the 4a parser (frontmatter:{} + body passthrough — markdownFor emits no
 * block for empty fm, keeping the stored .md byte-faithful). Guards: .md-only
 * entries, junk filtered, duplicate rejection, entry cap, decompressed-size
 * cap (zip bomb).
 * @throws IngestError BAD_ZIP | VALIDATION_ERROR | TOO_MANY_CONCEPTS | ZIP_TOO_LARGE (400) */
function zipToRawInputs(zipBase64, maxConcepts) {
  let zip;
  try {
    zip = new AdmZip(Buffer.from(String(zipBase64), 'base64'));
  } catch (err) {
    throw new IngestError('BAD_ZIP', `bundle zip could not be read: ${err.message}`, 400);
  }
  const entries = zip
    .getEntries()
    .filter(
      (e) =>
        !e.isDirectory &&
        e.entryName.endsWith('.md') &&
        !e.entryName.startsWith('__MACOSX/') &&
        !e.entryName.split('/').pop().startsWith('.')
    );
  if (entries.length === 0) {
    throw new IngestError('VALIDATION_ERROR', 'bundle zip contains no .md concept files', 400);
  }
  // Input integrity (design addendum D-V3): a duplicate .md entry path makes
  // the bundle AMBIGUOUS — which copy is the concept? Reject loudly instead of
  // silently inventing a suffixed second concept.
  const dupes = findDuplicateEntryNames(entries.map((e) => e.entryName));
  if (dupes.length > 0) {
    throw new IngestError(
      'VALIDATION_ERROR',
      `bundle zip contains duplicate concept entries: ${dupes.join(', ')}`,
      400
    );
  }
  if (entries.length > maxConcepts) {
    throw new IngestError(
      'TOO_MANY_CONCEPTS',
      `bundle zip contains ${entries.length} concepts; the cap is ${maxConcepts} (OKF_INGEST_MAX_CONCEPTS)`,
      400
    );
  }
  const maxZipBytes = maxZipBytesFromEnv();
  const seen = new Set();
  const inputs = [];
  let totalBytes = 0;
  for (const e of entries) {
    const text = e.getData().toString('utf8');
    totalBytes += text.length;
    if (totalBytes > maxZipBytes) {
      throw new IngestError(
        'ZIP_TOO_LARGE',
        `bundle zip decompresses beyond the ${maxZipBytes}-byte cap (OKF_INGEST_MAX_ZIP_BYTES)`,
        400
      );
    }
    const base = e.entryName.replace(/\.md$/, '');
    inputs.push({ concept_id: null, path: `${uniquifySlug(base, text, seen)}.md`, frontmatter: {}, body: text });
  }
  return inputs;
}

/**
 * Execute the write-side ingest sequence for a repo's concepts.
 * @param {string} repo_id
 * @param {object} input { zip: base64 } (bundle zip of .md — 2.9.5 contract)
 *        OR { concepts: [{frontmatter?, body, path?}] } OR { file_ids: [...] }
 *        OR { discover: true } (+ optional labels[])
 * @param {object} actor { sub, name?, source_ip? }
 * @returns {Promise<object>} summary (see AC 1)
 */
async function ingestRepoConcepts(repo_id, input, actor) {
  return withSpan('okf.ingest.repo', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    return _ingestWithCap(repo_id, input, actor, maxConceptsFromEnv(), span);
  });
}

/** Cap-enforcing core (test hook: pass an explicit cap). */
async function _ingestWithCap(repo_id, input, actor, maxConcepts = maxConceptsFromEnv(), span) {
  // [2] Resolve repo — authz/existence handled by the controller's getById
  // pre-gate; this fetch carries the derivation fields (domain/graph/version).
  const repo = await repositoryService.getById(repo_id);
  const graphName = repo.graph_name || `OKF_${repo_id}`;
  const aclLabels = deriveAclLabels(repo);
  const bundleVersion = repo.version != null ? repo.version : null;
  // Story 2.9.7 (D-V1): the minted version tag rides the labels so it is
  // in-band on files docs + chunks. Review fix P9: the guard is STRICT —
  // `/^okf:v\d+$/` — so a corrupted repo.okf_tag ('okf:virus') is never
  // trusted, and only an actual minted tag is appended.
  const okfTag = typeof repo.okf_tag === 'string' && /^okf:v\d+$/.test(repo.okf_tag) ? repo.okf_tag : null;

  // Caller labels are appended AFTER the ACL set — but an ACL-prefixed caller
  // label would re-scope the concept, so it is stripped + warned (sole
  // injector invariant; review fix). The version-tag strip is equally strict:
  // only an actual minted-shaped `okf:v<N>` label is reserved (a steward's
  // 'okf:Vision' hierarchy label is NOT a spoof).
  const rawCallerLabels = Array.isArray(input && input.labels) ? input.labels.filter((l) => typeof l === 'string') : [];
  const strippedLabels = rawCallerLabels.filter((l) => ACL_LABEL_RE.test(l) || /^okf:v\d+/i.test(l));
  if (strippedLabels.length > 0) {
    logger.warn('Caller-supplied ACL/version-tag labels stripped (sole-injector invariant)', {
      repo_id,
      stripped: strippedLabels
    });
  }
  const callerLabels = rawCallerLabels.filter((l) => !ACL_LABEL_RE.test(l) && !/^okf:v\d+/i.test(l));
  const labels = [...aclLabels, ...callerLabels, ...(okfTag ? [okfTag] : [])]; // ACL set FIRST, version tag LAST

  // Gather concept inputs: a bundle ZIP (the 2.9.5 contract — server-side
  // unzip, one concept per .md entry), explicit concepts[] (D-C — the 7.2
  // producer calls this service directly), or the repo's stored plain-.md docs
  // (file_ids / discover via 2.8's discovery).
  let rawInputs =
    typeof (input || {}).zip === 'string' && input.zip
      ? zipToRawInputs(input.zip, maxConcepts)
      : normalizeInputs(input);
  let notFound = [];
  if (!rawInputs) {
    const { file_ids, discover } = input || {};
    let files;
    if (Array.isArray(file_ids) && file_ids.length > 0) {
      // Reconcile requested vs found — a silently-dropped id must be visible
      // in the summary (review fix), never a phantom success.
      const discovered = await piiService.discoverRepoFiles(repo_id);
      const foundIds = new Set(discovered.map((f) => f.file_id));
      notFound = file_ids.filter((id) => !foundIds.has(id));
      files = discovered.filter((f) => file_ids.includes(f.file_id));
    } else if (discover === true) {
      files = await piiService.discoverRepoFiles(repo_id);
    } else {
      throw new IngestError('VALIDATION_ERROR', 'body must contain concepts[], file_ids[], or discover:true', 400);
    }
    rawInputs = files.map((f) => ({
      concept_id: f.concept_id,
      path: `${f.file_id}.md`,
      frontmatter: f.frontmatter || {},
      body: f.body || ''
    }));
  }
  if (rawInputs.length > maxConcepts) {
    throw new IngestError(
      'TOO_MANY_CONCEPTS',
      `body contains ${rawInputs.length} concepts; the cap is ${maxConcepts} (OKF_INGEST_MAX_CONCEPTS)`,
      400
    );
  }

  const summary = {
    repo_id,
    total: rawInputs.length,
    parsed: 0,
    created: 0,
    updated: 0,
    skipped_dedup: 0,
    rejected: 0,
    pii: { clean: 0, hit: 0, error: 0 },
    enqueued: 0,
    enqueue_errors: [],
    not_found: notFound
  };

  for (const raw of rawInputs) {
    // [4a] parse — ALWAYS through the real parser (review fix: the old
    // raw.concept_id skip-branch bypassed frontmatter/link derivation for
    // stored files), and ISOLATED: a malformed concept records a per-concept
    // error; the request stays 202 (AC-2 contract).
    let parsed;
    try {
      parsed = await parserService.parseConcept(markdownFor(raw), { repo_id, path: raw.path });
    } catch (err) {
      logger.error('Ingest 4a parse failed (isolated)', { repo_id, path: raw.path, error: err.message });
      summary.enqueue_errors.push({ concept_id: raw.concept_id || raw.path, stage: 'parse', error: err.message });
      continue;
    }
    summary.parsed += 1;

    // [4e-pre] read the PRE-upsert meta doc (review fix: the post-upsert doc
    // always carries THIS run's hash + 'parsed' status — dedupping against it
    // was dead code). The stored hash + index_status is the dedup basis.
    let preDoc = null;
    try {
      preDoc = await conceptMetaService.getConceptMeta(repo_id, parsed.concept_id);
    } catch (err) {
      logger.warn('Ingest 4e pre-read failed (dedup disabled for this concept)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
    }

    // [4b] FULL upsert (first-class fields; index_status='parsed'; the
    // writer's minimal-input, pii_state and index_status protections apply
    // automatically). Story 4.8-amend: the concept's body + the ingest labels
    // (ACL + KH + okf:v tag) are persisted so the worker can chunk content-only.
    try {
      const r = await conceptMetaService.upsertConceptMeta(repo_id, parsed, {
        bundle_version: bundleVersion,
        ingest_labels: labels
      });
      summary[r.action === 'created' ? 'created' : 'updated'] += 1;
    } catch (err) {
      logger.error('Ingest 4b meta upsert failed', { repo_id, concept_id: parsed.concept_id, error: err.message });
      summary.enqueue_errors.push({ concept_id: parsed.concept_id, stage: 'meta_upsert', error: err.message });
      continue; // per-concept isolation
    }

    // [4c] conformance — validate then persist (patch-only via the writer).
    // ALWAYS after 4b (the 2.9.2 clobber-proof order). HARD errors (missing type /
    // invalid provenance actor) REJECT the concept at ingest — recorded with
    // index_status='rejected' + the issues, and NEVER chunked into the graph
    // (Story 4.8-amend, 2026-08-19: "no invalid concept reaches the graph").
    // Warning-only concepts proceed (recorded + gated at publish).
    let issues = [];
    let hardErrors = [];
    try {
      ({ issues, hardErrors } = conformanceService.validateConcept(parsed));
      await conformanceService.persistConformanceIssues(repo_id, parsed.concept_id, issues);
    } catch (err) {
      logger.error('Ingest 4c conformance persist failed (non-fatal)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
    }
    if (hardErrors.length > 0) {
      try {
        await conceptMetaService.upsertConceptMeta(
          repo_id,
          { concept_id: parsed.concept_id, repo_id },
          {
            patch: { index_status: 'rejected', conformance_issues: issues }
          }
        );
      } catch (err) {
        logger.error('Ingest 4c reject persist failed (non-fatal)', {
          repo_id,
          concept_id: parsed.concept_id,
          error: err.message
        });
      }
      summary.rejected += 1;
      logger.warn('Ingest 4c rejected a non-conformant concept (hard errors — never chunked)', {
        repo_id,
        concept_id: parsed.concept_id,
        hard_errors: hardErrors.map((e) => e.code)
      });
      continue; // skip 4d PII, 4e dedup, 4f enqueue
    }

    // [4d] PII scan — fail-closed: 'error' state blocks publish later; an
    // unexpected throw is isolated and recorded, the ingest continues.
    try {
      const pii = await piiService.scanConcept(repo_id, parsed.concept_id, parsed.frontmatter, parsed.body);
      summary.pii[pii.pii_state] = (summary.pii[pii.pii_state] || 0) + 1;
    } catch (err) {
      summary.pii.error += 1;
      logger.error('Ingest 4d PII scan threw (isolated, recorded as error state)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
    }

    // [4e] content-hash dedup on the PRE-upsert doc: unchanged hash AND
    // already indexed → skip enqueue (cannot fire until 2.9.4 writes
    // 'indexed'; the rule is implemented now — NFR-S4).
    if (preDoc && preDoc.index_status === 'indexed' && preDoc.content_hash) {
      const newHash = conceptMetaService.contentHash ? conceptMetaService.contentHash(parsed.body) : null;
      if (newHash && newHash === preDoc.content_hash) {
        summary.skipped_dedup += 1;
        continue;
      }
    }

    // [4f] enqueue — Story 4.8-amend (content-only): NO doc-repo files doc is
    // created for a concept. The concept's meta row (index_status='parsed',
    // body + ingest_labels persisted at 4b) IS the queue — the 2.9.4 worker
    // claims it and POSTs the concept's markdown DIRECTLY to dataprep. This is
    // what keeps the document-repository list showing ONLY the bundle zip.
    summary.enqueued += 1;
  }

  // [4g] Story 2.9.5-amend (2026-08-18): when the input was a ZIP bundle, ALSO
  // store the bundle zip itself as a file doc in the doc-repo — associated with
  // the OKF repo (repo_id + graph_name) + the SAME knowledge-hierarchy labels
  // that flow to dataprep. The bundle is the ingestion INPUT (a means to feed
  // the process), stored at 'Ingested' + is_bundle=true so the worker ignores it.
  // Isolated + non-fatal: a bundle-doc store failure never fails the ingest.
  if (typeof (input || {}).zip === 'string' && input.zip) {
    const bundleFileName = (input && input.bundle_name) || `${repo.name || 'repo'}-bundle.zip`;
    try {
      const bres = await authedAxios.post(
        `${config.documentRepository.url}/api/files/ingest-bundle`,
        {
          bundle: input.zip,
          graph_name: graphName,
          repo_id,
          originalFileName: bundleFileName,
          labels, // the ACL + caller hierarchy labels — the SAME set dataprep's
          // LLM labeler selects from (per-concept 4f + the bundle doc both carry it)
          bundle_version: bundleVersion,
          is_bundle: true
        },
        { timeout: ENQUEUE_TIMEOUT_MS }
      );
      summary.bundle_stored = bundleFileName;
      summary.bundle_file_id = bres.data && bres.data.file_id;
      logger.info('OKF bundle zip stored as a file doc', { repo_id, bundle_file_id: summary.bundle_file_id });
    } catch (err) {
      summary.bundle_storage_error = err.message;
      logger.error('Ingest 4g bundle-zip store failed (isolated, non-fatal)', { repo_id, error: err.message });
    }
  }

  // success=false + metric 'error' when every enqueue failed (nothing was
  // queued and nothing was a dedup skip — the request accomplished nothing).
  const allEnqueuesFailed = summary.enqueue_errors.length > 0 && summary.enqueued === 0;
  summary.success = !allEnqueuesFailed;
  if (span) {
    span.setAttribute('okf.ingest.total', summary.total);
    span.setAttribute('okf.ingest.parsed', summary.parsed);
    span.setAttribute('okf.ingest.enqueued', summary.enqueued);
    span.setAttribute('okf.ingest.skipped_dedup', summary.skipped_dedup);
    span.setAttribute('okf.ingest.pii_error', summary.pii.error);
  }
  recordOp('ingest', allEnqueuesFailed ? 'error' : summary.enqueue_errors.length === 0 ? 'accepted' : 'partial');
  logger.info('OKF repo ingest orchestrated', { repo_id, total: summary.total, enqueued: summary.enqueued });

  // 2-9-5 atomicity pass (2026-08-24): surface the per-bundle totals on the
  // repo doc — a PARTIAL ingest (per-concept isolation means the 202 stays
  // valid even when concepts fail 4a/4b) was previously visible only in the
  // orchestrator's return value; the repo registry now carries the last
  // ingest's outcome so the admin UI / discovery can show it. Best-effort +
  // capped: a store failure never fails the ingest, and the error detail is
  // bounded (first 10 concepts, 200-char messages).
  const lastIngestSummary = {
    at: new Date().toISOString(),
    total: summary.total,
    parsed: summary.parsed,
    enqueued: summary.enqueued,
    skipped_dedup: summary.skipped_dedup,
    rejected: summary.rejected,
    error_count: summary.enqueue_errors.length,
    errors: summary.enqueue_errors.slice(0, 10).map((e) => ({
      concept_id: e.concept_id,
      stage: e.stage,
      error: String(e.error || '').slice(0, 200)
    })),
    bundle_stored: summary.bundle_stored || null
  };
  try {
    const db = await dbService.getConnection('default');
    await db.collection('okf_repositories').update(repo_id, { last_ingest_summary: lastIngestSummary });
  } catch (err) {
    logger.warn('Ingest summary surfacing failed (non-fatal)', { repo_id, error: err.message });
  }

  // Audit (best-effort, actor = sub string — AC 9) — carries the totals so a
  // partial ingest is visible in the audit trail too.
  auditService
    .writeAudit({
      action: 'repo.ingest',
      actor: (actor && actor.sub) || null,
      repo_id,
      source_ip: (actor && actor.source_ip) || null,
      total: summary.total,
      enqueued: summary.enqueued,
      skipped_dedup: summary.skipped_dedup,
      rejected: summary.rejected,
      error_count: summary.enqueue_errors.length
    })
    .catch(() => {
      /* best-effort */
    });

  return summary;
}

/**
 * Story #978 — Editor "Re-split from source" action.
 *
 * Workflow:
 *   1. Look up the doc-repo file by file_id (the frontend passes the file_id
 *      it tracked when the OKF repo was created; eventually we'll wire
 *      `files.okf_repo_id` to remove that contract — see #978 risk section).
 *   2. Fetch the raw .md bytes from doc-repo via `authedAxios`.
 *   3. Delete all `okf_concepts_meta` rows for this repo + clear the per-repo
 *      graph collections (`OKF_<rid>_SOURCE`/`_ENTITY`/`_HAS_SOURCE`/`_LINKS_TO`)
 *      to avoid stale chunks re-referenced after split.
 *   4. Build the concepts[] payload from the .md per `mode`:
 *        A — 1 concept = the whole body (mega-concept).
 *        B — split on the `## Source: <url>` markers the crawler writes;
 *            each section becomes one concept with `sources[0].resource = <url>`.
 *        C — reserved for Story 10.6 LLM topic extraction. Today returns
 *            MODE_NOT_IMPLEMENTED.
 *   5. Call the existing `ingestRepoConcepts` (4a–4f) and return the summary.
 *
 * Errors:
 *   - 404 FILE_NOT_FOUND: no file_id provided or doc-repo returned 404.
 *   - 400 MODE_NOT_IMPLEMENTED: mode === 'C'.
 *
 * @param {string} repo_id
 * @param {'A'|'B'|'C'} mode
 * @param {{file_id?: string}} opts
 * @returns {Promise<Object>} ingest summary {total, parsed, created, rejected, enqueued, mode, file_id}
 */
async function resplitRepo(repo_id, mode, opts = {}) {
  const fileId = opts.file_id;
  if (!fileId) {
    const e = new Error('resplitRepo requires opts.file_id');
    e.code = 'FILE_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  if (mode === 'C') {
    const e = new Error("mode 'C' (LLM topic extraction) is not yet shipped (Story 10.6)");
    e.code = 'MODE_NOT_IMPLEMENTED';
    e.status = 400;
    throw e;
  }
  if (!['A', 'B'].includes(mode)) {
    const e = new Error(`mode must be 'A', 'B', or 'C' (got ${JSON.stringify(mode)})`);
    e.code = 'VALIDATION_ERROR';
    e.status = 400;
    throw e;
  }

  // Fetch the raw markdown from doc-repo via the existing fetchFileBytes helper
  // (same path used by PII discovery — DRY).
  const { fetchFileBytes } = require('./pii-service');
  const bytes = await fetchFileBytes(fileId);
  const raw = bytes ? bytes.toString('utf-8') : '';

  // Delete existing concepts + per-repo graph collections.
  await clearRepoConceptsAndGraph(repo_id);

  // Build the concepts[] payload per mode.
  const concepts = mode === 'A' ? buildMegaConcept(raw, fileId) : splitBySourceMarkers(raw, fileId);
  if (concepts.length === 0) {
    return {
      mode,
      file_id: fileId,
      total: 0,
      parsed: 0,
      created: 0,
      updated: 0,
      skipped_dedup: 0,
      rejected: 0,
      enqueued: 0,
      enqueue_errors: [],
      not_found: []
    };
  }

  // Run the existing 4a–4f sequence.
  const summary = await ingestRepoConcepts(repo_id, { concepts }, opts.actor || null);
  return { ...summary, mode, file_id: fileId };
}

/** Delete all concepts for a repo + drop the 4 per-repo graph collections.
 * Idempotent — safe to call when the repo has no concepts yet. */
async function clearRepoConceptsAndGraph(repo_id) {
  const db = await dbService.getConnection('default');
  const meta = db.collection('okf_concepts_meta');
  await db.query(aql`FOR m IN ${meta} FILTER m.repo_id == ${repo_id} REMOVE m IN ${meta}`);

  const repo = await repositoryService.getById(repo_id).catch(() => null);
  const graphName = (repo && repo.graph_name) || `OKF_${repo_id}`;
  const collections = ['_SOURCE', '_ENTITY', '_HAS_SOURCE', '_LINKS_TO'].map((s) => `${graphName}${s}`);
  for (const collName of collections) {
    try {
      const c = db.collection(collName);
      // Truncate (faster than REMOVE each row; both are fine since the
      // collection will be re-populated by the worker).
      await c.truncate();
    } catch {
      /* collection may not exist yet on a fresh repo — that's fine */
    }
  }
}

/** Build a single mega-concept from the full markdown body (mode A). */
function buildMegaConcept(raw, fileId) {
  // Strip the leading "## Source: <url>" header the crawler prepends (so the
  // concept's body starts at the actual content; the provenance goes on
  // frontmatter.sources).
  const body = raw.replace(/^## Source:[^\n]*\n+/i, '').trim();
  if (!body) return [];
  return [
    {
      path: `crawl-${fileId}.md`,
      frontmatter: {
        type: 'topic',
        title: 'Crawled page',
        sources: [{ kind: 'crawl', resource: null, file_id: fileId }]
      },
      body
    }
  ];
}

/** Split the combined .md on `## Source: <url>` markers (mode B).
 * Each section becomes one concept. */
function splitBySourceMarkers(raw, fileId) {
  if (!raw) return [];
  // Split on the marker — keep the URL captured so we can attribute it.
  const re = /^## Source:\s*([^\n]*)\s*\n([\s\S]*?)(?=^## Source:|$)/gm;
  const concepts = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    const url = (m[1] || '').trim();
    const body = (m[2] || '').replace(/^---\s*\n/, '').trim(); // strip the page separator
    if (!body) continue;
    const path = urlToConceptPath(url) || `crawl-${fileId}-${concepts.length + 1}.md`;
    const title = deriveTitleFromBody(body) || url;
    concepts.push({
      path,
      frontmatter: {
        type: 'topic',
        title,
        sources: url ? [{ kind: 'crawl', resource: url, file_id: fileId }] : [{ kind: 'crawl', file_id: fileId }]
      },
      body
    });
  }
  // If no `## Source:` markers are present (single-page crawl), fall back to
  // mode-A behavior — the body becomes one concept.
  if (concepts.length === 0) return buildMegaConcept(raw, fileId);
  return concepts;
}

/** Derive a path-safe concept_id from a URL. */
function urlToConceptPath(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const slug = (u.hostname + u.pathname).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug || 'concept'}.md`;
  } catch {
    return null;
  }
}

/** Pull a sensible title from the first H1/H2 in the body. */
function deriveTitleFromBody(body) {
  if (!body) return null;
  const m = body.match(/^#{1,2}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

module.exports = {
  ingestRepoConcepts,
  resplitRepo,
  _ingestWithCap,
  deriveAclLabels,
  maxConceptsFromEnv,
  maxZipBytesFromEnv,
  slugify,
  uniquifySlug,
  markdownFor,
  zipToRawInputs,
  findDuplicateEntryNames,
  clearRepoConceptsAndGraph,
  buildMegaConcept,
  splitBySourceMarkers,
  IngestError
};
