// concept-split-operation.js — #1577 story 1: the CURATOR-INITIATED,
// PER-CONCEPT, LOSSLESS split (the ceiling initiative's deferred half).
//
// Spec: _bmad-output/specs/spec-okf-curator-split/SPEC.md (CAP-1, CAP-2, the
// drain constraint). Grounding: implementation-grounding.md. Story 2 adds
// previewConceptSplit — the PREFLIGHT both surfaces run.
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
//
// ONE PREFLIGHT, ONE REFUSAL SOURCE (story 2): previewConceptSplit runs the
// checks — meta load, engine, within-ceiling, part cap, collision — and
// returns the plan or the typed refusal. splitConcept calls the SAME
// function and throws exactly what the preview returned, so the dialog's
// preview and the POST's refusal can never disagree. The preview writes
// nothing: there is no write call anywhere under the preflight.

const { logger } = require('../shared-lib/logger');
const { splitConceptBody, partPath, MAX_PARTS } = require('./concept-splitter');
const { maxConceptDocChars, conceptTooLargeError } = require('./concept-ceiling');
const { workingGraphName } = require('./graph-lifecycle-service');
const { runPool } = require('./run-pool');

// The PII re-scan pool width (the scans are independent per part): the import
// path runs concepts across lanes, so a split at the part cap must not hold
// one request for 200 sequential sidecar roundtrips.
const SCAN_POOL = 4;

// The concept_id analog of partPath, SAME ZERO-BASED convention: index 0 →
// the original id (part 1 keeps it — inbound links keep resolving to a live
// document), index 1 → `foo-part-2`. All three part helpers take the same
// loop index, so ids, paths and titles can never disagree (the live smoke
// caught exactly that disagreement when the conventions were mixed).
function partConceptId(concept_id, index) {
  return index === 0 ? concept_id : `${concept_id}-part-${index + 1}`;
}

/** The human-legible title for parts 2..N: an explicit suffix beats the
 * path-derived fallback the upsert would otherwise use. Same zero-based loop
 * index as the other helpers; the RENDERED suffix is 1-based ("— part 2"),
 * matching the -part-2 identity convention inbound links rely on. */
function partTitle(title, index) {
  return `${title || ''} — part ${index + 1}`.trim();
}

/** The typed refusal the preview returns and the write throws — ONE
 * vocabulary (code + message + HTTP status), two surfaces. `details` rides
 * only the CONCEPT_TOO_LARGE refusal: the shared factory's inputs, so the
 * write path can re-throw the REAL ConceptTooLargeError (not a lookalike)
 * from the same source. */
function refusal(code, message, status, details) {
  return { ok: false, code, message, status, details: details || null };
}

/**
 * The PREFLIGHT both surfaces run (#1577 story 2): load the meta row, run
 * the ONE lossless engine, apply the ceiling/cap/collision checks — and
 * return the resulting plan or the typed refusal WITHOUT writing anything.
 *
 * This is the whole preview endpoint's body and the write path's first half:
 * one seam engine (splitConceptBody), one ceiling (maxConceptDocChars()),
 * one refusal source. A preview can never mutate the corpus — there is no
 * write call anywhere under this function.
 *
 * The plan additionally carries the WRITE-PAYLOAD fields the confirm leg
 * needs (the part bodies + the meta row the parts clone their metadata from)
 * under `bodies` / `_meta`; the preview ENDPOINT serializes only the
 * legible fields (concept_id, parts[{concept_id, path, title, chars}],
 * ceiling, body_chars) — the bodies would double the answer's weight, and
 * the caller can already read the body through the concept GET.
 *
 * @param {object} repoDoc the repo document (the controller's getById result)
 * @param {string} concept_id
 * @returns {Promise<{ok: true, plan}|{ok: false, code, message, status, details?}>}
 *   plan: { concept_id, parts: [{concept_id, path, title, chars}], ceiling,
 *   body_chars, bodies: string[], _meta }
 */
async function previewConceptSplit(repoDoc, concept_id) {
  if (!repoDoc || !repoDoc.repo_id || !concept_id) {
    return refusal('VALIDATION_ERROR', 'splitConcept requires a repo document and concept_id', 400);
  }
  const repo_id = repoDoc.repo_id;
  const metaService = require('./concept-meta-service');
  const meta = await metaService.getConceptMeta(repo_id, concept_id);
  if (!meta) {
    return refusal('CONCEPT_NOT_FOUND', `concept ${concept_id} not found in repo ${repo_id}`, 404);
  }

  const ceiling = maxConceptDocChars();
  const body = typeof meta.body === 'string' ? meta.body : '';
  const result = splitConceptBody(body, ceiling);
  if (result.unsplittable) {
    // The SHARED ceiling refusal (409), through the shared factory: the
    // import path, the editor save, the publish gate and this split all
    // answer the same question with the same message shape. The refusal
    // carries the factory's INPUTS so the write path re-throws the real
    // ConceptTooLargeError from this one source. ZERO rows written — the
    // concept is left exactly as it was.
    const details = {
      label: concept_id,
      chars: body.length,
      ceiling,
      remedy:
        'Shorten the source content for this concept (its largest unbreakable section has no heading, ' +
        'paragraph or line boundary that fits), or raise OKF_MAX_CONCEPT_DOC_CHARS if the served ' +
        "model's context window allows a larger document."
    };
    return refusal('CONCEPT_TOO_LARGE', conceptTooLargeError(details).message, 409, details);
  }
  if (result.parts.length <= 1) {
    // The body already fits: an honest no-op, not a fake success. The
    // affordance may still be offered (finer granularity is a legitimate
    // goal), but there is nothing for the engine to divide here.
    return refusal(
      'CONCEPT_WITHIN_CEILING',
      `concept ${concept_id} is ${body.length} characters, within the ${ceiling}-character ceiling — there is nothing to split`,
      400
    );
  }
  if (result.parts.length > MAX_PARTS) {
    return refusal(
      'TOO_MANY_PARTS',
      `splitting concept ${concept_id} would produce ${result.parts.length} parts (cap ${MAX_PARTS}) — ` +
        `raise OKF_MAX_CONCEPT_DOC_CHARS or shorten the source`,
      400
    );
  }

  // Collision pre-check BEFORE any write, ONE batched existence query: a repo
  // can legitimately hold an unrelated concept whose id happens to be one of
  // this split's part ids (the import derives ids from path slugs, so a real
  // `foo-part-2.md` yields exactly `foo-part-2`). Upserting blindly would
  // SILENTLY OVERWRITE it — the split refuses instead and names the rows.
  // The preview runs the SAME check so the dialog lists the collisions
  // before the curator commits to anything.
  const partIds = result.parts.map((_, i) => partConceptId(concept_id, i)).slice(1);
  const collisions = (await metaService.conceptIdsExist(repo_id, partIds)).sort();
  if (collisions.length) {
    return refusal(
      'PART_ID_CONFLICT',
      `splitting concept ${concept_id} would overwrite existing concept(s) ${collisions.join(', ')} — ` +
        `rename or delete them first, then split again`,
      409
    );
  }

  // The plan: identity (partConceptId), path (partPath) and title lineage
  // (partTitle) computed by the SAME helpers the write will use — the
  // preview cannot drift from what the confirm actually writes.
  const title = meta.title || concept_id;
  const plan = {
    concept_id,
    parts: result.parts.map((partBody, i) => ({
      concept_id: partConceptId(concept_id, i),
      path: i === 0 ? meta.path || '' : partPath(meta.path || `${concept_id}.md`, i),
      title: i === 0 ? title : partTitle(title, i),
      chars: partBody.length
    })),
    ceiling,
    body_chars: body.length,
    // WRITE-PAYLOAD ONLY — never serialized by the preview endpoint (see
    // the doc comment above).
    bodies: result.parts,
    _meta: meta
  };
  return { ok: true, plan };
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
 *   shared ceiling refusal, via the shared factory)
 */
async function splitConcept(repoDoc, concept_id, opts = {}) {
  // ONE preflight, ONE refusal source: the write throws exactly what the
  // preview returned (the TOO_LARGE case re-thrown through the shared
  // factory so the error CLASS matches the other ceiling-enforcing paths).
  const pre = await previewConceptSplit(repoDoc, concept_id);
  if (!pre.ok) {
    if (pre.code === 'CONCEPT_TOO_LARGE') throw conceptTooLargeError(pre.details);
    throw new SplitOperationError(pre.code, pre.message, pre.status);
  }
  const repo_id = repoDoc.repo_id;
  const metaService = require('./concept-meta-service');
  const { plan } = pre;
  const ceiling = plan.ceiling;
  const meta = plan._meta;

  const graphName = workingGraphName(repoDoc); // born-right: rows drain into the SAME graph dataprep writes
  // Claim-stamp reset on a content change is owned by the ONE update path
  // (concept-meta-service applyUpdate, the #1020 contract) — every
  // hash-changing update inherits it; this caller carries no patch.
  const parsedParts = plan.parts.map((part, i) => ({
    concept_id: part.concept_id,
    path: part.path,
    // Frontmatter carries to every part (title lineage suffixed on 2..N);
    // sources[] carried UNCHANGED to all parts — provenance is not
    // partitioned (David, 2026-11-14). The lineage string comes from the
    // plan the preflight computed — ONE computation, never re-derived here.
    frontmatter: i === 0 ? meta.frontmatter || {} : { ...(meta.frontmatter || {}), title: part.title },
    body: plan.bodies[i],
    links: meta.links,
    sources: meta.sources,
    status: meta.lifecycle_status, // never downgrade a row's lifecycle below what it held
    trust_tier: meta.trust_tier
  }));
  const upsertOpts = {
    graph_name: graphName, // born-right: index_status 'parsed' + the current graph, drains immediately
    bundle_version: meta.bundle_version,
    ingest_labels: meta.ingest_labels
  };

  const parts = [];
  const createdIds = [];
  let updated; // set to 1 by the final (part-1) write; any earlier failure throws
  try {
    // Parts 2..N first (fresh rows after the collision pre-check), the
    // part-1 overwrite LAST — see the zero-partial-state note at the top.
    // parsedParts is forward-ordered; the WRITE order below is not.
    for (let i = parsedParts.length - 1; i >= 1; i -= 1) {
      await metaService.upsertConceptMeta(repo_id, parsedParts[i], upsertOpts);
      createdIds.push(parsedParts[i].concept_id);
    }
    await metaService.upsertConceptMeta(repo_id, parsedParts[0], upsertOpts);
    updated = 1;
    for (let i = 0; i < parsedParts.length; i += 1) {
      parts.push({ concept_id: parsedParts[i].concept_id, chars: parsedParts[i].body.length });
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
        logger.error('concept.split rollback delete failed', {
          repo_id,
          // The ORPHANED PART id, not the parent — this log names the row a
          // curator must clean up manually (the story-1 contract for it).
          part_id: cid,
          error: delErr.message
        });
      }
    }
    logger.error('concept.split rolled back after a write failure', {
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
  // like the import's [4d]). The scans are independent — THE shared pool.
  const piiService = require('./pii-service');
  await runPool(parsedParts, SCAN_POOL, async (parsed) => {
    try {
      await piiService.scanConcept(repo_id, parsed.concept_id, parsed.frontmatter, parsed.body);
    } catch (err) {
      logger.error('concept.split PII scan threw (isolated)', {
        repo_id,
        concept_id: parsed.concept_id,
        error: err.message
      });
    }
  });

  logger.info('concept.split done', {
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

class SplitOperationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SplitOperationError';
    this.code = code;
    this.status = status;
  }
}

module.exports = { splitConcept, previewConceptSplit };
