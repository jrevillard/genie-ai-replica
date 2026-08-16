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
const config = require('../config');

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

class IngestError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Sole ACL injector (D-A): t: and d: carry the repo domain in v1 (no tenant
 * field exists; 6.1b's resolver owns per-axis derivation later); r: pins the
 * repo. Lowercase prefixes, case-sensitive — dataprep's pinned boundary. */
function deriveAclLabels(repo) {
  return [`t:${repo.domain}`, `r:${repo.repo_id}`, `d:${repo.domain}`];
}

/** Slugify a title (or name) into a stable path component: "Service Directory"
 * → "service-directory". ASCII-fold, lowercase, non-alphanum → '-'. */
function slugify(value) {
  return (
    String(value || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'concept'
  );
}

/** Explicit concepts[] input → parse inputs (path from explicit path, else the
 * frontmatter title slug, else an index — concept_id derives concepts/<slug>).
 * Stored-file inputs arrive already shaped. */
function normalizeInputs(input) {
  const { concepts } = input || {};
  if (Array.isArray(concepts) && concepts.length > 0) {
    return concepts.map((c, i) => {
      const fm = c.frontmatter || {};
      const name = c.path || fm.title || `concept-${i + 1}`;
      const slug = name.includes('.md') ? name.replace(/\.md$/, '') : slugify(name);
      return { concept_id: null, path: `${slug}.md`, frontmatter: fm, body: c.body || '' };
    });
  }
  return null; // file_ids/discover handled by the caller (async fetch)
}

function markdownFor(input) {
  const fm =
    input.frontmatter && Object.keys(input.frontmatter).length
      ? `---\n${Object.entries(input.frontmatter)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(v).replace(/^"|"$/g, '')}`)
          .join('\n')}\n---\n\n`
      : '';
  return `${fm}${input.body}`;
}

/**
 * Execute the write-side ingest sequence for a repo's concepts.
 * @param {string} repo_id
 * @param {object} input { concepts: [{frontmatter?, body, path?}] } OR
 *        { file_ids: [...] } OR { discover: true } (+ optional labels[])
 * @param {object} actor { sub, name?, source_ip? }
 * @returns {Promise<object>} summary (see AC 1)
 */
async function ingestRepoConcepts(repo_id, input, actor) {
  return withSpan('okf.ingest.repo', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const maxConcepts = parseInt(process.env.OKF_INGEST_MAX_CONCEPTS || '200', 10);
    return _ingestWithCap(repo_id, input, actor, maxConcepts, span);
  });
}

/** Cap-enforcing core (test hook: pass an explicit cap). */
async function _ingestWithCap(repo_id, input, actor, maxConcepts = 200, span) {
  // [2] Resolve repo — authz/existence handled by the controller's getById
  // pre-gate; this fetch carries the derivation fields (domain/graph/version).
  const repo = await repositoryService.getById(repo_id);
  const graphName = repo.graph_name || `OKF_${repo_id}`;
  const aclLabels = deriveAclLabels(repo);
  const bundleVersion = repo.version != null ? repo.version : null;
  const callerLabels = Array.isArray(input && input.labels) ? input.labels.filter((l) => typeof l === 'string') : [];
  const labels = [...aclLabels, ...callerLabels]; // ACL set FIRST (sole injector)

  // Gather concept inputs: explicit concepts[] (D-C — 2.9.5 unzip and the 7.2
  // producer call this service directly with unzipped concepts) or the repo's
  // stored plain-.md docs (file_ids / discover via 2.8's discovery).
  let rawInputs = normalizeInputs(input);
  if (!rawInputs) {
    const { file_ids, discover } = input || {};
    let files;
    if (Array.isArray(file_ids) && file_ids.length > 0) {
      files = (await piiService.discoverRepoFiles(repo_id)).filter((f) => file_ids.includes(f.file_id));
    } else if (discover) {
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
    created: 0,
    updated: 0,
    skipped_dedup: 0,
    pii: { clean: 0, hit: 0, error: 0 },
    enqueued: 0,
    enqueue_errors: []
  };

  for (const raw of rawInputs) {
    // [4a] parse (pure) — or the stored concept's already-parsed shape.
    let parsed;
    if (raw.concept_id && raw.frontmatter && Object.keys(raw.frontmatter).length) {
      parsed = { concept_id: raw.concept_id, repo_id, path: raw.path, ...raw };
    } else {
      parsed = await parserService.parseConcept(markdownFor(raw), { repo_id, path: raw.path });
    }

    // [4b] FULL upsert (first-class fields; index_status='parsed'; the
    // writer's minimal-input and pii_state protections apply automatically).
    let stored;
    try {
      const r = await conceptMetaService.upsertConceptMeta(repo_id, parsed, { bundle_version: bundleVersion });
      stored = r.doc;
      summary[r.action === 'created' ? 'created' : 'updated'] += 1;
    } catch (err) {
      logger.error('Ingest 4b meta upsert failed', { repo_id, concept_id: parsed.concept_id, error: err.message });
      summary.enqueue_errors.push({ concept_id: parsed.concept_id, stage: 'meta_upsert', error: err.message });
      continue; // per-concept isolation
    }

    // [4c] conformance — validate then persist (patch-only via the writer).
    // ALWAYS after 4b (the 2.9.2 clobber-proof order).
    try {
      const { issues } = conformanceService.validateConcept(parsed);
      await conformanceService.persistConformanceIssues(repo_id, parsed.concept_id, issues);
    } catch (err) {
      logger.error('Ingest 4c conformance persist failed (non-fatal)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
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

    // [4e] content-hash dedup: unchanged hash AND already indexed → skip.
    if (stored && stored.index_status === 'indexed' && stored.content_hash) {
      const newHash = conceptMetaService.contentHash ? conceptMetaService.contentHash(parsed.body) : null;
      if (newHash && newHash === stored.content_hash) {
        summary.skipped_dedup += 1;
        continue;
      }
    }

    // [4f] enqueue: per-concept .md stored via doc-repo's bundle route with
    // defer_kick — the files doc lands at 'Pending' for the 2.9.4 worker
    // (per-concept enqueues must NOT race dataprep's single-ingest lock).
    try {
      const conceptMd = markdownFor({ frontmatter: parsed.frontmatter, body: parsed.body });
      await authedAxios.post(`${config.documentRepository.url}/api/files/ingest-bundle`, {
        bundle: Buffer.from(conceptMd).toString('base64'),
        graph_name: graphName,
        repo_id,
        originalFileName: `${parsed.concept_id.replace(/^concepts\//, '')}.md`,
        labels,
        defer_kick: true
      });
      summary.enqueued += 1;
    } catch (err) {
      summary.enqueue_errors.push({ concept_id: parsed.concept_id, stage: 'enqueue', error: err.message });
      logger.error('Ingest 4f enqueue failed (isolated)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
    }
  }

  if (span) {
    span.setAttribute('okf.ingest.total', summary.total);
    span.setAttribute('okf.ingest.enqueued', summary.enqueued);
    span.setAttribute('okf.ingest.skipped_dedup', summary.skipped_dedup);
    span.setAttribute('okf.ingest.pii_error', summary.pii.error);
  }
  recordOp('ingest', summary.enqueue_errors.length === 0 ? 'accepted' : 'partial');
  logger.info('OKF repo ingest orchestrated', { repo_id, total: summary.total, enqueued: summary.enqueued });

  // Audit (best-effort, actor = sub string — AC 9).
  auditService
    .writeAudit({
      action: 'repo.ingest',
      actor: (actor && actor.sub) || null,
      repo_id,
      source_ip: (actor && actor.source_ip) || null
    })
    .catch(() => {
      /* best-effort */
    });

  return summary;
}

module.exports = { ingestRepoConcepts, _ingestWithCap, deriveAclLabels, IngestError };
