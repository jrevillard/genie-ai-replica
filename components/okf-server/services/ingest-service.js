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
const typeInference = require('./type-inference-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const parserService = require('./parser-service');
const conformanceService = require('./conformance-service');
const conceptMetaService = require('./concept-meta-service');
const piiService = require('./pii-service');
const repositoryService = require('./repository-service');
const { workingGraphName } = require('./graph-lifecycle-service');
const auditService = require('./audit-service');
const { authedAxios } = require('./service-token');
const dbService = require('../shared-lib/db-connection-service');
const config = require('../config');

const DEFAULT_MAX_CONCEPTS = 200;
const ENQUEUE_TIMEOUT_MS = 30000; // 4f cap — never hang the request on doc-repo
const DEFAULT_MAX_ZIP_BYTES = 26214400; // 25 MiB decompressed cap (zip-bomb guard)

const meter = getMeter();
const opsCounter = meter.createCounter('okf_ingest_operations_total', {
  description: 'OKF orchestrator import operations'
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

/**
 * Label composition — the SINGLE AUTHORITY (David's labels-reach-RAG fix,
 * 2026-09-05): the worker POSTs meta.ingest_labels to dataprep as fileLabels
 * (LLM labeling context + fallback + chunk finalization), so BOTH write paths
 * must compose through here:
 *   - import (4b upsert), and
 *   - concept patch (patchConceptMeta recomputes on every fm change).
 * Invariants preserved: ACL set FIRST (t:/r:/d: from the repo), caller labels
 * after (ACL-prefixed + mint-shaped entries stripped + warned — sole-injector
 * invariant), the STRICT okf:v<N> tag LAST (corrupted tags never trusted),
 * dedupe preserving first occurrence.
 * @param {object} repo the okf_repositories doc (domain/repo_id/okf_tag)
 * @param {string[]} [callerLabels] frontmatter/incoming labels (display set)
 * @returns {string[]} the composed ingest_labels
 */
function composeIngestLabels(repo, callerLabels) {
  const acl = deriveAclLabels(repo);
  const okfTag = typeof repo.okf_tag === 'string' && /^okf:v\d+$/.test(repo.okf_tag) ? repo.okf_tag : null;
  const raw = Array.isArray(callerLabels) ? callerLabels.filter((l) => typeof l === 'string') : [];
  const stripped = raw.filter((l) => ACL_LABEL_RE.test(l) || /^okf:v\d+/i.test(l));
  if (stripped.length > 0) {
    logger.warn('Caller-supplied ACL/version-tag labels stripped (sole-injector invariant)', {
      repo_id: repo.repo_id,
      stripped
    });
  }
  const caller = raw.filter((l) => !ACL_LABEL_RE.test(l) && !/^okf:v\d+/i.test(l));
  const out = [];
  const seen = new Set();
  for (const label of [...acl, ...caller, ...(okfTag ? [okfTag] : [])]) {
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
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
function zipToRawInputs(zipBase64, maxConcepts, bundleName) {
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
    // The concept id comes from the entry's BASENAME, never the zip's internal
    // folder path: a bundle stored under `kenya-okf/concepts/…` used to mint
    // ids WITH slashes, which crashed dataprep's file save (nested dirs) and
    // poisoned chunk/graph keys. Folder structure is presentation, not
    // identity — bare slugs match the editor-created convention.
    // (Live-caught 2026-08-30: "Kenya Government Services" imported from a
    // foldered zip drained 0/6 concepts and its publish was gate-blocked.)
    const base = e.entryName.split('/').pop().replace(/\.md$/, '');
    inputs.push({
      concept_id: null,
      path: `${uniquifySlug(base, text, seen)}.md`,
      frontmatter: {},
      body: text,
      // PROVENANCE (OKF standard — David's completeness review, 2026-09-08):
      // the zip path injected NO source, leaving every bundle concept
      // provenance-less. The bundle stamp rides the input; _importOneConcept
      // applies it only when the concept has no authorial sources.
      provenance: bundleName ? { kind: 'bundle', resource: String(bundleName) } : null
    });
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

/** IMPORT CONCURRENCY (perf, David 2026-09-05: "importing should be much
 * faster"): the per-concept pipeline is dominated by the PII sidecar scan —
 * MEASURED 69-111 s on ~850 KB crawl pages (presidio NER is CPU-bound), so a
 * sequential 999-concept import spent ~2 h almost entirely in 4d. OKF_IMPORT_
 * CONCURRENCY caps how many concepts flow through the 4a→4f pipeline at once
 * (default 1 = the historical sequential behavior, byte-for-byte). Match the
 * cap to the sidecar's PII_WEB_CONCURRENCY (2 uvicorn workers absorb 2
 * concurrent NER scans). parse/conformance/meta stages are ms-scale and
 * overlap under the scans. */
function importConcurrency() {
  const parsed = parseInt(process.env.OKF_IMPORT_CONCURRENCY || '', 10);
  return Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : 1, 1), 16);
}

/** Fixed-size worker pool over items, preserving RESULT positions. */
async function _pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * The per-concept import pipeline (4a parse → 4b upsert → 4c conformance →
 * 4d PII → 4e dedup → 4f enqueue). ONE concept in, ONE outcome object out —
 * never throws (per-concept isolation; failures are the outcome). The
 * orchestrator folds outcomes into the summary so counters stay exact.
 */
async function _importOneConcept(repo_id, raw, ctx) {
  const { bundleVersion, graphName, labels, classification } = ctx;
  // [4a] parse — ALWAYS through the real parser (review fix: the old
  // raw.concept_id skip-branch bypassed frontmatter/link derivation for
  // stored files), and ISOLATED: a malformed concept records a per-concept
  // error; the request stays 202 (AC-2 contract).
  let parsed;
  try {
    parsed = await parserService.parseConcept(markdownFor(raw), { repo_id, path: raw.path });
  } catch (err) {
    logger.error('Import 4a parse failed (isolated)', { repo_id, path: raw.path, error: err.message });
    return { parse_error: err.message, id: raw.concept_id || raw.path };
  }

  // PROVENANCE APPLIED (OKF standard — David's completeness review, 2026-09-08):
  // a zip-imported concept with no authorial sources gets the bundle stamp;
  // authorial sources[] are never touched.
  if (
    raw.provenance &&
    !(parsed.frontmatter && Array.isArray(parsed.frontmatter.sources) && parsed.frontmatter.sources.length > 0)
  ) {
    parsed.frontmatter = { ...(parsed.frontmatter || {}), sources: [raw.provenance] };
    // The meta row's sources come from the PARSER's derived field
    // (concept-meta-service keeps p.sources), not from frontmatter — stamp
    // both or the row stays provenance-less (caught in David's redo).
    if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
      parsed.sources = [raw.provenance];
    }
  }

  // TYPE INFERENCE (David's categorization spec, 2026-09-05): classify when
  // a strategy was requested — unknown/absent resolves to heuristics (the
  // coordinator contract: one clean word, coerced, never a 400). An EXPLICIT
  // authorial type is never clobbered (classifyConcept guards). The resolved
  // type lands in the parsed frontmatter so 4b persists it like any type.
  if (classification) {
    // D-G (#985): the curation PROVENANCE rides the parsed doc so 4b persists
    // it first-class on the meta row (David's activity-log ruling — the log
    // must show the method and each decision's origin). label_source: the
    // labels present after classification are authorial (D-B extends this to
    // 'llm' when the vLLM pass assigns them).
    const authorialLabels = Array.isArray(parsed.frontmatter && parsed.frontmatter.labels)
      ? parsed.frontmatter.labels
      : [];
    const labelSource = authorialLabels.length ? 'author' : 'none';
    try {
      const verdict = typeInference.classifyConcept(
        { frontmatter: parsed.frontmatter, body: parsed.body, url: raw.url || null },
        classification
      );
      parsed.frontmatter = { ...(parsed.frontmatter || {}), type: verdict.type };
      parsed.curation = {
        method: typeInference.resolveStrategy(classification).strategy,
        resolved_by: verdict.resolved_by,
        label_source: labelSource
      };
    } catch (err) {
      logger.warn('Type inference failed (non-fatal — concept keeps its type)', {
        repo_id,
        path: raw.path,
        error: err.message
      });
      parsed.curation = {
        method: typeInference.resolveStrategy(classification).strategy,
        resolved_by: 'error',
        label_source: labelSource
      };
    }
  }

  // [4e-pre] read the PRE-upsert meta doc (review fix: the post-upsert doc
  // always carries THIS run's hash + 'parsed' status — dedupping against it
  // was dead code). The stored hash + index_status is the dedup basis.
  let preDoc = null;
  try {
    preDoc = await conceptMetaService.getConceptMeta(repo_id, parsed.concept_id);
  } catch (err) {
    logger.warn('Import 4e pre-read failed (dedup disabled for this concept)', {
      repo_id,
      concept_id: parsed.concept_id,
      error: err.message
    });
  }

  // [4b] FULL upsert (first-class fields; index_status='parsed'; the writer's
  // minimal-input, pii_state and index_status protections apply automatically).
  let action;
  try {
    const r = await conceptMetaService.upsertConceptMeta(repo_id, parsed, {
      bundle_version: bundleVersion,
      ingest_labels: labels,
      graph_name: graphName // born-right: the row drains into the SAME graph dataprep writes
    });
    action = r.action === 'created' ? 'created' : 'updated';
  } catch (err) {
    logger.error('Import 4b meta upsert failed', { repo_id, concept_id: parsed.concept_id, error: err.message });
    return { parse_ok: true, meta_error: err.message, id: parsed.concept_id };
  }

  // [4c] conformance — validate then persist (patch-only via the writer).
  // ALWAYS after 4b (the 2.9.2 clobber-proof order). HARD errors REJECT the
  // concept at ingest — recorded with index_status='rejected' + the issues,
  // and NEVER chunked into the graph. Warning-only concepts proceed.
  let issues = [];
  let hardErrors = [];
  try {
    ({ issues, hardErrors } = conformanceService.validateConcept(parsed));
    await conformanceService.persistConformanceIssues(repo_id, parsed.concept_id, issues);
  } catch (err) {
    logger.error('Import 4c conformance persist failed (non-fatal)', {
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
      logger.error('Import 4c reject persist failed (non-fatal)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
    }
    logger.warn('Import 4c rejected a non-conformant concept (hard errors — never chunked)', {
      repo_id,
      concept_id: parsed.concept_id,
      hard_errors: hardErrors.map((e) => e.code)
    });
    return { parse_ok: true, action, rejected: true, id: parsed.concept_id };
  }

  // [4d] PII scan — fail-closed: 'error' state blocks publish later; an
  // unexpected throw is isolated and recorded, the ingest continues.
  let piiState;
  try {
    const pii = await piiService.scanConcept(repo_id, parsed.concept_id, parsed.frontmatter, parsed.body);
    piiState = pii.pii_state;
  } catch (err) {
    piiState = 'error';
    logger.error('Import 4d PII scan threw (isolated, recorded as error state)', {
      repo_id,
      concept_id: parsed.concept_id,
      error: err.message
    });
  }

  // [4e] content-hash dedup on the PRE-upsert doc: unchanged hash AND already
  // indexed → skip enqueue (cannot fire until 2.9.4 writes 'indexed').
  if (preDoc && preDoc.index_status === 'indexed' && preDoc.content_hash) {
    const newHash = conceptMetaService.contentHash ? conceptMetaService.contentHash(parsed.body) : null;
    if (newHash && newHash === preDoc.content_hash) {
      return {
        parse_ok: true,
        action,
        pii_state: piiState,
        dedup: true,
        id: parsed.concept_id,
        curation: parsed.curation
      };
    }
  }

  // [4f] enqueue — the meta row (index_status='parsed') IS the queue.
  return {
    parse_ok: true,
    action,
    pii_state: piiState,
    dedup: false,
    id: parsed.concept_id,
    curation: parsed.curation
  };
}
/**
 * Import-time curation FINALIZE (D-B #980 + David's heuristics-labeling
 * ruling, 2026-09-08): stamps the classification on the repo doc, then runs
 * the curation pass ONCE over every parsed concept (KH-L2 labels, LLM
 * descriptions, type taxonomy per mode). SHARED across import adapters —
 * the zip flow calls it after its pool; the crawl conversion calls it once
 * at conversion end (multi-format end goal: adapters produce concepts, this
 * is the one curation entry every adapter reuses). Returns the curation
 * summary, or null on a non-fatal failure (the import never blocks on it).
 */
async function runImportCuration(repo_id, repo, classification) {
  try {
    const clsDb = await dbService.getConnection('default');
    await clsDb.query(
      'LET doc = DOCUMENT(okf_repositories, @r) FILTER doc != null ' +
        'UPDATE doc WITH {classification: @m} IN okf_repositories',
      { r: repo_id, m: classification }
    );
  } catch (err) {
    logger.warn('Repo classification persist failed (non-fatal)', { repo_id, error: err.message });
  }
  try {
    const llmCuration = require('./llm-curation-service');
    const curationDb = await dbService.getConnection('default');
    let lastProgressWrite = 0;
    return await llmCuration.curateRepoConcepts(repo, {
      classification,
      lanes: importConcurrency(),
      onProgress: (p) => {
        // Throttled best-effort progress onto the repo's TOP-LEVEL curation
        // key — the field the Studio card reads (this.view.curation).
        // NEVER merge into repo.conversion: MERGE-manufacturing a conversion
        // object without a status left the building projection stuck on
        // "Building…" forever (David's card, 2026-09-08). At most one write
        // per 2s, plus the final.
        const now = Date.now();
        // `final` bypasses the throttle: total includes the never-curated
        // index row, so the finished pass could never satisfy
        // `curated === total` and the true final counters were throttled
        // away (live: repo.curation showed done=996 of 998, 2026-09-09).
        if (!p.final && p.curated < p.total && now - lastProgressWrite < 2000) return;
        lastProgressWrite = now;
        curationDb
          .query(
            'LET doc = DOCUMENT(okf_repositories, @r) FILTER doc != null ' +
              'UPDATE doc WITH { curation: @c } ' +
              'IN okf_repositories',
            { r: repo_id, c: p }
          )
          .catch(() => {});
      }
    });
  } catch (err) {
    logger.warn('OKF curation pass failed (non-fatal — import continues)', { repo_id, error: err.message });
    return null;
  }
}

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
  // BORN-RIGHT naming (David, 2026-08-31): dataprep CREATES the repo's graph
  // under the versioned draft name on this very write — never OKF_{repo_id}.
  const graphName = workingGraphName(repo);
  // Labels compose through the SINGLE AUTHORITY (shared with the concept-
  // patch path — a post-import label edit must reach dataprep identically).
  const labels = composeIngestLabels(repo, input && input.labels);
  const bundleVersion = repo.version != null ? repo.version : null;

  // Gather concept inputs: a bundle ZIP (the 2.9.5 contract — server-side
  // unzip, one concept per .md entry), explicit concepts[] (D-C — the 7.2
  // producer calls this service directly), or the repo's stored plain-.md docs
  // (file_ids / discover via 2.8's discovery).
  let rawInputs =
    typeof (input || {}).zip === 'string' && input.zip
      ? zipToRawInputs(input.zip, maxConcepts, (input && input.bundle_name) || null)
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
    not_found: notFound,
    // D-G (#985): curation decision tallies by resolved_by ('author' guard vs
    // heuristic hits vs fallbacks) — one audit row per import carries them.
    curation_counts: {}
  };

  // WORKER POOL (OKF_IMPORT_CONCURRENCY, default 1 = the historical
  // sequential behavior): concepts flow through the 4a→4f pipeline N at a
  // time — the PII scans (the ~100% dominant stage, measured 69-111 s per
  // ~850 KB page) then overlap across concepts instead of serializing the
  // import. Outcomes fold back into the summary in COMPLETION order; at
  // concurrency 1 that is byte-for-byte the historical input order.
  // ZIP-IMPORT CONVERSION RECORD (David, 2026-09-08: the dashboard card must
  // show progress for bundle imports too — the Studio create flow now lands
  // on the dashboard while the import runs in the background): zip imports
  // get the same conversion shape as crawls (status 'adding' → 'done'|'failed',
  // both terminal for isBuilding) so the Building card shows real progress
  // and CLEARS on completion.
  const zipTotal = input.zip ? rawInputs.length : 0;
  let zipDone = 0;
  let zipLastTick = 0;
  const zipConvWrite = async (patch) => {
    try {
      const cDb = await dbService.getConnection('default');
      await cDb.query(
        'LET doc = DOCUMENT(okf_repositories, @r) FILTER doc != null ' +
          'UPDATE doc WITH { conversion: MERGE(IS_NULL(doc.conversion) ? {} : doc.conversion, @p) } ' +
          'IN okf_repositories',
        { r: repo_id, p: patch }
      );
    } catch (e) {
      logger.warn('Zip conversion record write failed (non-fatal)', { repo_id, error: e.message });
    }
  };
  if (input.zip) {
    await zipConvWrite({
      status: 'adding',
      stage: 'adding',
      pages_done: 0,
      concepts_total: zipTotal,
      started_at: new Date().toISOString()
    });
  }
  const outcomes = await _pool(rawInputs, importConcurrency(), async (raw) => {
    const o = await _importOneConcept(repo_id, raw, {
      bundleVersion,
      graphName,
      labels,
      classification: input.classification
    });
    if (input.zip) {
      zipDone += 1;
      const now = Date.now();
      if (zipDone === zipTotal || now - zipLastTick > 2000) {
        zipLastTick = now;
        await zipConvWrite({ pages_done: zipDone });
      }
    }
    return o;
  });
  for (const o of outcomes) {
    if (o.parse_error) {
      summary.enqueue_errors.push({ concept_id: o.id, stage: 'parse', error: o.parse_error });
      continue;
    }
    summary.parsed += 1;
    if (o.meta_error) {
      summary.enqueue_errors.push({ concept_id: o.id, stage: 'meta_upsert', error: o.meta_error });
      continue;
    }
    summary[o.action] += 1;
    if (o.rejected) {
      summary.rejected += 1;
      continue;
    }
    if (o.pii_state) summary.pii[o.pii_state] = (summary.pii[o.pii_state] || 0) + 1;
    if (o.dedup) summary.skipped_dedup += 1;
    else summary.enqueued += 1;
    // D-G (#985): tally each concept's curation decision origin.
    if (o.curation && o.curation.resolved_by) {
      summary.curation_counts[o.curation.resolved_by] = (summary.curation_counts[o.curation.resolved_by] || 0) + 1;
    }
  }

  // D-B (#980): import-time curation through the SHARED finalize — the pass
  // runs once per classified import ('llm' | 'hybrid' run the vLLM pass;
  // David's 2026-09-08 ruling adds HEURISTICS labeling: keyword-matched
  // KH-L2 labels, zero LLM). skipCuration: the crawl conversion passes it on
  // every per-batch flush and runs the pass exactly once at conversion end
  // instead (per-flush it would re-run over the ever-growing row set —
  // O(n²) LLM calls). Fail-soft: an LLM outage degrades per-concept with a
  // logged fallback marker — the import NEVER blocks on the LLM.
  summary.curation = null;
  if (input.classification && !input.skipCuration) {
    summary.curation = await runImportCuration(repo_id, repo, input.classification);
  }

  // ZIP CONVERSION RECORD CLOSE — AFTER the curation pass, so the dashboard
  // card does not flip to completed while labels are still landing (live:
  // the card cleared seconds before curation finished, 2026-09-08).
  if (input.zip) {
    await zipConvWrite({
      status: summary.enqueue_errors.length > 0 ? 'failed' : 'done',
      stage: summary.enqueue_errors.length > 0 ? 'failed' : 'done',
      pages_done: zipDone,
      finished_at: new Date().toISOString()
    });
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
      // A bundle whose concepts were ALL dedup-skipped has nothing in flight —
      // the zip must be born 'Ingested' (the state machine only advances on
      // concept callbacks; zero enqueues means it would sit 'Pending' forever
      // and the version mint's D1 gate would block publishing). Live-caught
      // 2026-08-30: a no-op re-ingest of a fully-indexed repo re-stored the
      // zip at Pending and bricked the publish.
      if (summary.enqueued === 0 && bres.data && bres.data.file_id) {
        try {
          await authedAxios.patch(
            `${config.documentRepository.url}/api/files/${encodeURIComponent(bres.data.file_id)}/status`,
            { dataprep: { status: 'Ingested' } },
            { timeout: 10000 }
          );
          logger.info('Bundle zip born Ingested (zero enqueues — nothing in flight)', {
            repo_id,
            bundle_file_id: summary.bundle_file_id
          });
        } catch (patchErr) {
          logger.warn('Bundle born-Ingested patch failed (non-fatal)', { repo_id, error: patchErr.message });
        }
      }
    } catch (err) {
      summary.bundle_storage_error = err.message;
      logger.error('Import 4g bundle-zip store failed (isolated, non-fatal)', { repo_id, error: err.message });
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
  logger.info('OKF repository import orchestrated', { repo_id, total: summary.total, enqueued: summary.enqueued });

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
    // Story #978 (David, 2026-08-28): refresh concept_count in the same write —
    // the dashboard's topic counts went STALE the moment the editor added
    // concepts (the count was written only at create/crawl time, so a
    // populated repo showed "0 topics" forever).
    const countRows = await (
      await db.query('FOR m IN okf_concepts_meta FILTER m.repo_id == @rid COLLECT WITH COUNT INTO c RETURN c', {
        rid: repo_id
      })
    ).all();
    await db.collection('okf_repositories').update(repo_id, {
      last_ingest_summary: lastIngestSummary,
      concept_count: countRows[0] || 0
    });
    // Repo-level PII scan marker (David, 2026-08-30): the mint publish gate
    // requires pii_scan_status === 'complete', but the marker was ONLY set by
    // the file-discovery scan endpoint — a CONTENT-ONLY repository (editor or
    // zip import; every concept scanned inline at 4d) could NEVER publish.
    // When every concept row carries a pii_state, the scan IS complete.
    const unscannedRows = await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND (m.pii_state == null OR m.pii_state == "unknown") COLLECT WITH COUNT INTO c RETURN c',
        { rid: repo_id }
      )
    ).all();
    if ((countRows[0] || 0) > 0 && (unscannedRows[0] || 0) === 0) {
      await db.collection('okf_repositories').update(repo_id, { pii_scan_status: 'complete' });
      logger.info('Repo PII scan marked complete (all concepts scanned inline)', { repo_id });
    }
  } catch (countErr) {
    logger.warn('Import summary surfacing failed (non-fatal)', { repo_id, error: countErr.message });
  }

  // Audit (best-effort, actor = sub string — AC 9) — carries the totals so a
  // partial ingest is visible in the audit trail too.
  auditService
    .writeAudit({
      action: 'repo.import',
      actor: (actor && actor.sub) || null,
      actor_name: (actor && actor.name) || null,
      repo_id,
      source_ip: (actor && actor.source_ip) || null,
      description:
        'Imported ' +
        summary.total +
        ' concept(s): ' +
        summary.enqueued +
        ' stored as parsed rows (RAG preparation waits for the ingest transition), ' +
        summary.skipped_dedup +
        ' deduplicated, ' +
        summary.rejected +
        ' rejected, ' +
        summary.enqueue_errors.length +
        ' error(s)' +
        (input.classification
          ? ' — curation method: ' +
            typeInference.resolveStrategy(input.classification).strategy +
            ' (' +
            Object.entries(summary.curation_counts)
              .map(([k, v]) => k + '=' + v)
              .join(', ') +
            ')'
          : '') +
        (summary.curation
          ? ' — curation pass (' +
            summary.curation.method +
            '): labeled=' +
            summary.curation.labeled +
            ', described=' +
            summary.curation.described +
            ', typed=' +
            summary.curation.typed +
            ', fallbacks=' +
            summary.curation.fallbacks
          : ''),
      details: {
        total: summary.total,
        enqueued: summary.enqueued,
        skipped_dedup: summary.skipped_dedup,
        rejected: summary.rejected,
        error_count: summary.enqueue_errors.length,
        curation: {
          method: input.classification ? typeInference.resolveStrategy(input.classification).strategy : null,
          counts: summary.curation_counts,
          ...(summary.curation ? { [summary.curation.method]: summary.curation } : {})
        }
      }
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

/** Delete all concepts for a repo + truncate the per-repo graph collections.
 * Idempotent — safe to call when the repo has no concepts yet. The content may
 * live under MORE than one graph name across a repo's history (born-right
 * draft name, a pre-convention legacy OKF_{repo_id} graph, a retracted
 * serving name) — the meta rows' graph_name values are the source of truth
 * and are collected BEFORE the rows are removed. */
async function clearRepoConceptsAndGraph(repo_id) {
  const db = await dbService.getConnection('default');
  const meta = db.collection('okf_concepts_meta');
  const rowGraphs = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.graph_name != null COLLECT g = m.graph_name RETURN g',
      { rid: repo_id }
    )
  ).all();
  await db.query(aql`FOR m IN ${meta} FILTER m.repo_id == ${repo_id} REMOVE m IN ${meta}`);

  const repo = await repositoryService.getById(repo_id).catch(() => null);
  const candidates = new Set(rowGraphs);
  if (repo) {
    try {
      candidates.add(workingGraphName(repo));
    } catch {
      /* name derivation is best-effort here */
    }
  }
  candidates.add(`OKF_${repo_id}`); // the legacy pre-convention anchor
  for (const graphName of candidates) {
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
    const slug = (u.hostname + u.pathname)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
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

/**
 * Story #978 — delete ONE concept: meta row + indexed chunks + graph edges.
 * Chunk rows carry `file_id == concept_id` (content-only chunking: "the
 * file_id IS the concept_id" — dataprep), so the SOURCE sweep keys off that.
 * LINKS_TO is ENTITY→ENTITY with vertex key safeKey('c', concept_id), so the
 * edge sweep filters on either endpoint. Returns removal counts (0-safe for
 * repos whose graph collections don't exist yet).
 */
async function deleteConcept(repo_id, concept_id, opts = {}) {
  if (!repo_id || !concept_id) {
    const err = new Error('deleteConcept requires repo_id and concept_id');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  const removed = { meta: null, chunks: 0, has_source: 0, links_to: 0, entity: 0 };

  // 1. Meta row first — the worker's dedup (4e) reads it; once gone, an
  // in-flight re-index of this concept resolves to null and is skipped.
  removed.meta = await conceptMetaService.deleteConceptMeta(repo_id, concept_id);
  if (!removed.meta) return null; // 404 at the controller layer

  // 2. Graph content (best-effort — a fresh repo may have no collections).
  try {
    const db = await dbService.getConnection('default');
    const repo = await repositoryService.getById(repo_id).catch(() => null);
    // The meta row's graph_name is where THIS concept's content actually lives
    // (born-right draft name; a legacy row may still carry OKF_{repo_id}) —
    // fall back to the computed working name for a row that predates the field.
    const graphName = (removed.meta && removed.meta.graph_name) || (repo ? workingGraphName(repo) : `OKF_${repo_id}`);

    // SOURCE chunks for this concept + the HAS_SOURCE edges touching them,
    // in one pass each (bounded by the concept's own chunk count).
    const chunks = await (
      await db.query(
        aql`FOR doc IN ${db.collection(graphName + '_SOURCE')}
            FILTER doc.file_id == ${concept_id} OR doc.metadata.file_id == ${concept_id}
            RETURN doc._id`
      )
    ).all();
    if (chunks.length > 0) {
      const r1 = await db.query(
        aql`FOR edge IN ${db.collection(graphName + '_HAS_SOURCE')}
            FILTER edge._to IN ${chunks}
            REMOVE edge IN ${db.collection(graphName + '_HAS_SOURCE')}`
      );
      removed.has_source = r1.extra ? r1.extra.deleted || 0 : 0;
      const r2 = await db.query(
        aql`FOR doc IN ${db.collection(graphName + '_SOURCE')}
            FILTER doc._id IN ${chunks}
            REMOVE doc IN ${db.collection(graphName + '_SOURCE')}`
      );
      removed.chunks = r2.extra ? r2.extra.deleted || 0 : 0;
    }

    // LINKS_TO edges touching the concept's ENTITY vertex, then the vertex.
    const vertexId = `${graphName}_ENTITY/c:${concept_id}`;
    const r3 = await db.query(
      aql`FOR edge IN ${db.collection(graphName + '_LINKS_TO')}
          FILTER edge._from == ${vertexId} || edge._to == ${vertexId}
          REMOVE edge IN ${db.collection(graphName + '_LINKS_TO')}`
    );
    removed.links_to = r3.extra ? r3.extra.deleted || 0 : 0;
    const r4 = await db.query(
      aql`FOR v IN ${db.collection(graphName + '_ENTITY')}
          FILTER v._id == ${vertexId}
          REMOVE v IN ${db.collection(graphName + '_ENTITY')}`
    );
    removed.entity = r4.extra ? r4.extra.deleted || 0 : 0;
  } catch (err) {
    // Meta row is already gone (source of truth) — graph leftovers are
    // orphaned-but-harmless; log and succeed. Mirrors clearRepoConceptsAndGraph's
    // tolerance of missing collections.
    logger.warn('deleteConcept: graph cleanup partial', {
      repo_id,
      concept_id,
      error: err.message
    });
  }

  try {
    await auditService.writeAudit({
      action: 'concept.delete',
      actor: (opts.actor && opts.actor.sub) || null,
      actor_name: (opts.actor && opts.actor.name) || null,
      repo_id,
      concept_id,
      source_ip: (opts.actor && opts.actor.source_ip) || null,
      description: 'Deleted concept "' + concept_id + '" with its meta row, indexed chunks and graph edges',
      details: removed
    });
  } catch {
    /* audit is best-effort */
  }
  return removed;
}

module.exports = {
  ingestRepoConcepts,
  resplitRepo,
  deleteConcept,
  _ingestWithCap,
  deriveAclLabels,
  composeIngestLabels,
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
  runImportCuration,
  IngestError
};
