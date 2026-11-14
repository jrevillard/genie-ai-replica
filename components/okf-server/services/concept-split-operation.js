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
//
// ZERO PARTIAL STATE COVERS THE FAILURE PATH TOO (code-review round on this
// file): the writes run parts 2..N FIRST and the part-1 overwrite LAST, so
// the original row's body is only ever replaced by ONE atomic final update
// that happens after every part row already exists — a mid-loop failure can
// never truncate the concept. Any write failure rolls the created rows back
// (deleteConceptMeta, best-effort) and rethrows, leaving the corpus exactly
// as it was.

const { splitConceptBody, partPath } = require('./concept-splitter');
const { maxConceptDocChars, ConceptTooLargeError } = require('./concept-ceiling');
const { workingGraphName } = require('./graph-lifecycle-service');

// The per-split part cap (the MAX_SEGMENTS_PER_FILE precedent): greedyMerge
// fills parts to the ceiling, so a sane body yields ceil(size/ceiling)+seam
// parts — a count beyond this means the ceiling is wrong for the content and
// the curator needs an honest refusal, not a silently huge write.
const MAX_PARTS = 200;

// The PII re-scan pool (the scans are independent per part): the import path
// runs concepts across lanes, so a split at the part cap must not hold one
// request for 200 sequential sidecar roundtrips.
const SCAN_POOL = 4;

// Born-right means CLAIMABLE immediately, not just index_status 'parsed':
// a previously FAILED row carries a backoff park (next_attempt_after up to 6h)
// and an attempt budget near the reaper cap — the split resets both, exactly
// the #1020 reset patchConceptMeta applies on a hash change. (The claim query
// gates on worker_claimed_at and next_attempt_after; ingest_attempts feeds the
// dead-letter cap.)
const DRAIN_RESET = {
  next_attempt_after: null,
  worker_claimed_at: null,
  ingest_attempts: 0,
  reindex_retry: 0,
  last_error: null
};

class SplitOperationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SplitOperationError';
    this.code = code;
    this.status = status;
  }
}

/** The concept_id analog of partPath, SAME ZERO-BASED convention: index 0 →
 * the original id (part 1 keeps it — inbound links keep resolving to a live
 * document), index 1 → `foo-part-2`. The two helpers are always called with
 * the same loop index so ids and paths can never disagree again (the live
 * smoke caught exactly that disagreement when the conventions were mixed). */
function partConceptId(concept_id, index) {
  return index === 0 ? concept_id : `${concept_id}-part-${index + 1}`;
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
 *   400 TOO_MANY_PARTS / 409 PART_ID_CONFLICT; ConceptTooLargeError 409 (the
 *   shared ceiling refusal)
 */
async function splitConcept(repoDoc, concept_id, opts = {}) {
  if (!repoDoc || !repoDoc.repo_id || !concept_id) {
    throw new SplitOperationError('VALIDATION_ERROR', 'splitConcept requires a repo document and concept_id');
  }
  const repo_id = repoDoc.repo_id;
  const metaService = require('./concept-meta-service');
  const meta = await metaService.getConceptMeta(repo_id, concept_id);
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

  // Collision pre-check BEFORE any write: a repo can legitimately hold an
  // unrelated concept whose id happens to be one of this split's part ids
  // (the import derives ids from path slugs, so a real `foo-part-2.md` yields
  // exactly `foo-part-2`). Upserting blindly would SILENTLY OVERWRITE it.
  // The split refuses instead and names the rows to resolve first.
  const collisions = [];
  for (let i = 1; i < result.parts.length; i += 1) {
    const existing = await metaService.getConceptMeta(repo_id, partConceptId(concept_id, i));
    if (existing) collisions.push(partConceptId(concept_id, i));
  }
  if (collisions.length) {
    throw new SplitOperationError(
      'PART_ID_CONFLICT',
      `splitting concept ${concept_id} would overwrite existing concept(s) ${collisions.join(', ')} — ` +
        `rename or delete them first, then split again`,
      409
    );
  }

  const graphName = workingGraphName(repoDoc); // born-right: rows drain into the SAME graph dataprep writes
  const title = meta.title || concept_id;
  const buildParsed = (i) => {
    const isFirst = i === 0;
    return {
      concept_id: partConceptId(concept_id, i),
      path: isFirst ? meta.path || '' : partPath(meta.path || `${concept_id}.md`, i),
      // Frontmatter carries to every part (title lineage suffixed on 2..N);
      // sources[] carried UNCHANGED to all parts — provenance is not
      // partitioned (David, 2026-11-14).
      frontmatter: isFirst ? meta.frontmatter || {} : { ...(meta.frontmatter || {}), title: partTitle(title, i + 1) },
      body: result.parts[i],
      links: meta.links,
      sources: meta.sources,
      status: meta.lifecycle_status, // never downgrade a row's lifecycle below what it held
      trust_tier: meta.trust_tier
    };
  };
  const upsertOpts = {
    graph_name: graphName, // born-right: index_status 'parsed' + the current graph, drains immediately
    bundle_version: meta.bundle_version,
    ingest_labels: meta.ingest_labels,
    patch: { ...DRAIN_RESET } // born-right rows are CLAIMABLE (see DRAIN_RESET)
  };

  const parts = [];
  const parsedParts = [];
  const createdIds = [];
  let updated;
  try {
    // Parts 2..N first (fresh rows after the collision pre-check), the
    // part-1 overwrite LAST — see the zero-partial-state note at the top.
    // The parts ARRAY below is assembled in forward order regardless.
    const written = [];
    for (let i = result.parts.length - 1; i >= 1; i -= 1) {
      const parsed = buildParsed(i);
      await metaService.upsertConceptMeta(repo_id, parsed, upsertOpts);
      createdIds.push(parsed.concept_id);
      written[i] = parsed;
    }
    const first = buildParsed(0);
    await metaService.upsertConceptMeta(repo_id, first, upsertOpts);
    updated = 1;
    written[0] = first;
    for (let i = 0; i < written.length; i += 1) {
      parts.push({ concept_id: written[i].concept_id, chars: result.parts[i].length });
      parsedParts.push(written[i]);
    }
  } catch (err) {
    // Rollback: remove the rows this operation created; the ORIGINAL row was
    // never touched (its overwrite is the last, atomic write), so the corpus
    // returns to the pre-split state even if a rollback delete fails — the
    // error then names the orphan rows for manual cleanup.
    const orphans = [];
    for (const cid of createdIds) {
      try {
        await metaService.deleteConceptMeta(repo_id, cid);
      } catch (delErr) {
        orphans.push(cid);
        require('../shared-lib/logger').logger.error('concept.split rollback delete failed', {
          repo_id,
          concept_id: cid,
          error: delErr.message
        });
      }
    }
    require('../shared-lib/logger').logger.error('concept.split rolled back after a write failure', {
      repo_id,
      concept_id,
      rolled_back: createdIds.length - orphans.length,
      orphan_parts: orphans,
      original_intact: true,
      error: err.message
    });
    throw new SplitOperationError(
      'SPLIT_WRITE_FAILED',
      `the split failed mid-write and was rolled back; concept ${concept_id} is unchanged` +
        (orphans.length ? ` — orphan part rows need manual cleanup: ${orphans.join(', ')}` : ''),
      500
    );
  }
  const created = createdIds.length;

  // PII re-scan per resulting part (the ingest path's per-fragment cost — the
  // scan WRITES the rows' pii_state from the part's content; fail-closed
  // 'error' blocks publish later, an unexpected throw is isolated exactly
  // like the import's [4d]). The scans are independent — bounded pool.
  const piiService = require('./pii-service');
  const scanQueue = [...parsedParts];
  const scanWorkers = Array.from({ length: Math.min(SCAN_POOL, scanQueue.length) }, async () => {
    for (;;) {
      const parsed = scanQueue.shift();
      if (!parsed) return;
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
  });
  await Promise.all(scanWorkers);

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

module.exports = { splitConcept, partConceptId, partTitle, MAX_PARTS, SCAN_POOL, DRAIN_RESET, SplitOperationError };
