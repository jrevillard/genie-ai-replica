// concept-split-operation.js — #1577 story 1: the CURATOR-INITIATED,
// PER-CONCEPT, LOSSLESS split (the ceiling initiative's deferred half).
//
// Spec: _bmad-output/specs/spec-okf-curator-split/SPEC.md (CAP-1, CAP-2, the
// drain constraint). Grounding: implementation-grounding.md.
//
// What this is NOT (additive-first): it is NOT resplitRepo — that operation
// deletes every concept + derived graph of a repo and re-ingests from one
// doc-repo file (ingest-service.js). This operation splits ONE concept in
// place through the ONE lossless engine, writing part rows that re-drain.
//
// Losslessness is structural, inherited from splitConceptBody: contiguous
// half-open line ranges whose concatenation reproduces the body byte-for-byte
// (original EOLs preserved). The legacy segmentMarkdown behavior — silently
// discarding sub-200-char sections — is never invoked.

const { splitConceptBody } = require('./concept-splitter');
const { maxConceptDocChars, ConceptTooLargeError } = require('./concept-ceiling');
const { workingGraphName } = require('./graph-lifecycle-service');
const { partPath } = require('./ingest-service');

// The per-split part cap (the MAX_SEGMENTS_PER_FILE precedent): greedyMerge
// fills parts to the ceiling, so a sane body yields ceil(size/ceiling)+seam
// parts — a count beyond this means the ceiling is wrong for the content and
// the curator needs an honest refusal, not a silently huge write.
const MAX_PARTS = 200;

class SplitOperationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SplitOperationError';
    this.code = code;
    this.status = status;
  }
}

/** The concept_id analog of partPath: `foo` → `foo-part-2`. Part 1 keeps the
 * original id (inbound links keep resolving to a live document). */
function partConceptId(concept_id, index) {
  return `${concept_id}-part-${index}`;
}

/** The human-legible title for parts 2..N: an explicit suffix beats the
 * path-derived fallback the upsert would otherwise use. */
function partTitle(title, index) {
  return `${title || ''} — part ${index}`.trim();
}

/**
 * Split ONE concept into ceiling-bounded parts.
 *
 * @param {object} repoDoc the repo document (the controller's getById result —
 *   the caller has already applied the read fence + assertWritable)
 * @param {string} concept_id
 * @param {object} opts { actor } — audit-context only; never an authz input
 * @returns {Promise<{concept_id, parts: Array<{concept_id, chars}>, created, updated, ceiling}>}
 * @throws SplitOperationError 404 CONCEPT_NOT_FOUND / 400 CONCEPT_WITHIN_CEILING /
 *   400 TOO_MANY_PARTS; ConceptTooLargeError 409 (the shared ceiling refusal)
 */
async function splitConcept(repoDoc, concept_id, opts = {}) {
  if (!repoDoc || !repoDoc.repo_id || !concept_id) {
    throw new SplitOperationError('VALIDATION_ERROR', 'splitConcept requires a repo document and concept_id');
  }
  const repo_id = repoDoc.repo_id;
  const meta = await require('./concept-meta-service').getConceptMeta(repo_id, concept_id);
  if (!meta) {
    throw new SplitOperationError('CONCEPT_NOT_FOUND', `concept ${concept_id} not found in repo ${repo_id}`, 404);
  }

  const ceiling = maxConceptDocChars();
  const body = typeof meta.body === 'string' ? meta.body : '';
  const result = splitConceptBody(body, ceiling);
  if (result.unsplittable) {
    // The shared ceiling refusal (409): names size, ceiling and remedy. ZERO
    // rows written — the concept is left exactly as it was.
    throw new ConceptTooLargeError(
      `concept ${concept_id} is ${body.length} characters and its largest unbreakable section exceeds the ` +
        `${ceiling}-character ceiling (no heading, paragraph or line boundary fits inside it) — ` +
        `shorten the source content for this concept, or raise OKF_MAX_CONCEPT_DOC_CHARS`
    );
  }
  if (result.parts.length <= 1) {
    // The body already fits: an honest no-op, not a fake success.
    throw new SplitOperationError(
      'CONCEPT_WITHIN_CEILING',
      `concept ${concept_id} is ${body.length} characters, within the ${ceiling}-character ceiling — there is nothing to split`
    );
  }
  if (result.parts.length > MAX_PARTS) {
    throw new SplitOperationError(
      'TOO_MANY_PARTS',
      `splitting concept ${concept_id} would produce ${result.parts.length} parts (cap ${MAX_PARTS}) — ` +
        `raise OKF_MAX_CONCEPT_DOC_CHARS or shorten the source`
    );
  }

  const graphName = workingGraphName(repoDoc); // born-right: rows drain into the SAME graph dataprep writes
  const metaService = require('./concept-meta-service');
  const title = meta.title || concept_id;
  const parts = [];
  const parsedParts = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < result.parts.length; i += 1) {
    const isFirst = i === 0;
    const partBody = result.parts[i];
    const parsed = {
      // Part 1 keeps the ORIGINAL concept_id — every inbound link keeps
      // resolving to a document that still exists. Parts 2..N take -part-N ids.
      concept_id: isFirst ? concept_id : partConceptId(concept_id, i + 1),
      // partPath takes the ZERO-BASED part index (same convention as
      // ingest-service: index 1 → -part-2.md) — the live smoke caught the
      // off-by-one the unit suite missed (live: -part-3 path on part 2).
      path: isFirst ? meta.path || '' : partPath(meta.path || `${concept_id}.md`, i),
      // Frontmatter carries to every part (title lineage suffixed on 2..N);
      // sources[] carried UNCHANGED to all parts — provenance is not
      // partitioned (David, 2026-11-14).
      frontmatter: isFirst ? meta.frontmatter || {} : { ...(meta.frontmatter || {}), title: partTitle(title, i + 1) },
      body: partBody,
      links: meta.links,
      sources: meta.sources,
      status: meta.lifecycle_status, // never downgrade a row's lifecycle below what it held
      trust_tier: meta.trust_tier
    };
    const action = await metaService.upsertConceptMeta(repo_id, parsed, {
      graph_name: graphName, // born-right: index_status 'parsed' + the current graph, drains immediately
      bundle_version: meta.bundle_version,
      ingest_labels: meta.ingest_labels
    });
    if (action.action === 'created') created += 1;
    else updated += 1;
    parts.push({ concept_id: parsed.concept_id, chars: partBody.length });
    parsedParts.push(parsed);
  }

  // PII re-scan per resulting part (the ingest path's per-fragment cost — the
  // scan WRITES the rows' pii_state from the part's content; fail-closed
  // 'error' blocks publish later, an unexpected throw is isolated exactly
  // like the import's [4d]).
  const piiService = require('./pii-service');
  for (const parsed of parsedParts) {
    try {
      await piiService.scanConcept(repo_id, parsed.concept_id, parsed.frontmatter, parsed.body);
    } catch (err) {
      require('../shared-lib/logger').logger.error('concept.split PII scan threw (isolated)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
    }
  }

  require('../shared-lib/logger').logger.info('concept.split done', {
    repo_id,
    concept_id,
    actor: opts.actor || null,
    parts: parts.length,
    created,
    updated,
    ceiling
  });
  return { concept_id, parts, created, updated, ceiling };
}

module.exports = { splitConcept, partConceptId, partTitle, MAX_PARTS, SplitOperationError };
