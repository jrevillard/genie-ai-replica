// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Repository CRUD controller — thin HTTP layer: joi validate → call service → shape
// snake_case response → next(err) on failure. No business logic.

const repoService = require('../services/repository-service');
const conceptMetaService = require('../services/concept-meta-service');
const piiService = require('../services/pii-service');
const ingestService = require('../services/ingest-service');
const versionService = require('../services/version-service');
const auditService = require('../services/audit-service');
const parserService = require('../services/parser-service');
const scopeAuthzService = require('../services/scope-authz-service');
const { getMeter } = require('../shared-lib/metrics');
const {
  createSchema,
  updateSchema,
  cloneSchema,
  lifecycleSchema,
  piiAckSchema
} = require('../validators/repository-validator');
const lifecycleService = require('../services/lifecycle-service');
const { assertWritable } = lifecycleService;
const bundleExportService = require('../services/bundle-export-service');
const conformanceService = require('../services/conformance-service');
const typeInference = require('../services/type-inference-service');
const crawlConversionService = require('../services/crawl-conversion-service');
const producerService = require('../services/producer-service'); // Story 7.7 documents import
// Review !622 round 9, #78670: the suite/studio/head handlers call these
// modules — required ONCE here instead of inside every handler (61
// in-handler requires). The services never require this controller, so
// there is no import cycle to defer.
const headTestService = require('../services/head-test-service');
const headSuiteService = require('../services/head-suite-service');
const studioDraftService = require('../services/studio-draft-service');
const ragasSuiteService = require('../services/ragas-suite-service');
// ...and the three the topic-link/validation/autocorrect handlers called
// for — same rule: no cycle, no reason to defer.
const validationService = require('../services/validation-service');
const topicLinks = require('../services/topic-link-authoring-service');
const llmCuration = require('../services/llm-curation-service');

// Story #978 — metrics helpers (fail-soft if OTel collector is unavailable).
// Lazy + try/catch because getMeter() may throw at module-load when the SDK
// is uninitialized (notably in jest unit tests that mock the shared-lib).
let meter = null;
try {
  meter = getMeter('okf.controller');
} catch {
  meter = { counter: () => ({ add: () => {} }) }; // no-op shim
}

class ValidationError extends Error {
  constructor(details) {
    super('Request validation failed');
    this.code = 'VALIDATION_ERROR';
    this.status = 400;
    this.details = details;
  }
}

/** Extract the acting principal + request IP for audit/metadata — the shared
 * helper (controllers/actor-from.js); the local byte-identical copy was the
 * exact duplication that file exists to prevent (review !622 wave 2, #78671). */
const { actorFrom } = require('./actor-from');

/**
 * Default-deny authorization context (Story 6.1 — replaces the no-op
 * okf_domain seam). Derived from req.okfScopes (set by middleware/auth.js):
 * `okf:{tenant}:{repo}:{level}` → the caller's authorized repo set. Wildcard
 * scopes and the tools-admin bootstrap super-role ⇒ isSuperAdmin (unrestricted).
 * A caller with no okf scopes gets an EMPTY set — list returns nothing, and
 * getById 404s every repo (G3 closed).
 *
 * Story 6.1b: the implementation moved to scope-authz-service (single scope
 * authority shared with the read-side graph-set resolver) — delegated here,
 * byte-identical semantics.
 */
function callerAuthz(req) {
  return scopeAuthzService.deriveScopeAuthz(req.okfScopes, req.okfIsSuperAdmin);
}

/** Service-facing authz param: null = unrestricted, Set = filter. */
function authzForService(req) {
  const { isSuperAdmin, authorizedRepoIds } = callerAuthz(req);
  return isSuperAdmin ? null : authorizedRepoIds;
}

function validate(schema, body) {
  const { value, error } = schema.validate(body);
  if (error) throw new ValidationError(error.details.map((d) => d.message));
  return value;
}
// Review !622 round 9, #78670: ONE envelope for the suite/studio/
// frontmatter handlers — each used to paste try/require/opts/status/json/
// next verbatim (~40 handlers). The thunk performs the service call and
// returns the JSON body; `call` owns the status (200 default) and error
// forwarding. Handlers with custom transports (xlsx bytes, zip streams,
// the metrics aggregation) stay written out.
const call =
  (fn, { status = 200 } = {}) =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
// The service-call opts, spelled twice instead of ~80 times.
const adminOpts = (req) => ({ authz: authzForService(req), actor: actorFrom(req) });
const readOpts = (req) => ({ authz: authzForService(req) });

async function createRepo(req, res, next) {
  try {
    const input = validate(createSchema, req.body);
    // BORN-RIGHT SLUG — SERVER AUTHORITY (coordinator ruling on David's
    // subject-area contract, 2026-09-04): the DOMAIN-DERIVED okf:t:* scope
    // segment is ALWAYS computed here from slug(body.domain). Clients
    // (okfRepoOps.createRepo) hand-build it from raw domain text, which after
    // the KH wave is display text ("Water Supply") — a scope that cannot
    // survive JWT scope transport (whitespace-split) or the 4-part grammar.
    // The stored domain stays display text; every OTHER caller-supplied
    // scope (other tenants, repo-uuid scopes) is preserved untouched.
    // Idempotent: an already-slugged scope matches the filter and is re-added
    // exactly once.
    const domainSlug = bundleExportService.slugFor(input.domain);
    const callerScopes = ((input.acl && input.acl.required_scopes) || []).filter(
      (s) => !(typeof s === 'string' && /^okf:t:[^:]+:(read|admin)$/.test(s))
    );
    input.acl = {
      ...(input.acl || {}),
      required_scopes: [...callerScopes, `okf:t:${domainSlug}:admin`]
    };
    // Story #978 (crawler→OKF): forward optional lifecycle_state to the
    // service opts (the service validates it against LIFECYCLE_STATES). Joi
    // already validated the string shape via createSchema; the service
    // enforces the enum. R5-additive — default behaviour (no body field) is
    // unchanged.
    const opts = {};
    if (typeof input.lifecycle_state === 'string' && input.lifecycle_state) {
      opts.lifecycle_state = input.lifecycle_state;
    }
    const repo = await repoService.create(input, actorFrom(req), opts);
    res.status(201).json(repo);
  } catch (err) {
    next(err);
  }
}

/**
/**
 * Review !622 round 9, #78672: the repo-targeting half of BOTH conversion
 * endpoints, previously ~55 verbatim lines pasted twice (repo_id targeting,
 * the 10-attempt duplicate-name suffix loop, the 409, the born-right ACL
 * slug). An optional body.repo_id targets an EXISTING repo — authz-scoped
 * fetch (F15: a domain-A caller cannot target a domain-B repo by id) plus
 * writability (serving/drain-frozen content 409s); absent repo_id mints a
 * uniquely-named repo (Wizard B1, Amendment A, 2026-09-27). Returns
 * { repo, baseName, name_adjusted } or { failure: { status, payload } } —
 * the caller renders the envelope since this helper owns no res.
 *
 * name_adjusted (round 20, #80807) is computed ONLY on the CREATE path,
 * where the suffix loop can genuinely rename (baseName → baseName-N). On the
 * repo_id path NOTHING is renamed — body.name is ignored for targeting — so
 * the flag is always false there; the old `repo.name !== baseName` comparison
 * reported true whenever the caller passed a name different from the existing
 * repo's, lying about a rename that never happened. The response field stays
 * (asserted by tests; the frontend reads only repo.name).
 */
async function resolveTargetRepo(body, authz, actor, defaultName) {
  const repoDomain = body.domain || 'general';
  const acl = { required_scopes: [`okf:t:${bundleExportService.slugFor(repoDomain)}:admin`] };
  const baseName = typeof body.name === 'string' && body.name ? body.name : defaultName;
  if (typeof body.repo_id === 'string' && body.repo_id.trim()) {
    const existing = await repoService.getById(body.repo_id.trim(), { authz });
    if (!existing || existing.deleted_at) {
      return {
        failure: { status: 404, payload: { error: 'REPO_NOT_FOUND', message: `Repository ${body.repo_id} not found` } }
      };
    }
    assertWritable(existing);
    return { repo: existing, baseName, name_adjusted: false };
  }
  for (let attempt = 1; attempt <= 10; attempt++) {
    const candidate = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    try {
      const repo = await repoService.create({ name: candidate, domain: repoDomain, acl }, actor, {});
      return { repo, baseName, name_adjusted: repo.name !== baseName };
    } catch (err) {
      if (!(err && err.code === 'DUPLICATE_REPO')) throw err;
    }
  }
  return {
    failure: {
      status: 409,
      payload: {
        error: 'DUPLICATE_REPO',
        message: `Repository name "${baseName}" (and suffixed variants) already exists in domain "${repoDomain}"`
      }
    }
  };
}

/**
 * POST /okf/repos/convert-from-crawl — trigger a SERVER-SIDE crawl→OKF
 * conversion (David, 2026-09-02: "a long running service through Kong will
 * not cut it" + "must support files up to 10GB").
 *
 * Creates the repo with a UNIQUE name (retry loop over DUPLICATE_REPO —
 * the same crawl file can become multiple repos, each traceable), then
 * starts the streaming conversion job in okf-server and returns 202
 * immediately with the repo (its `conversion` field carries live progress:
 * status/stage/bytes/pages/batches — the UI polls GET /okf/repos/:id).
 */
async function convertFromCrawl(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.file_id) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'file_id is required' });
    }
    if (!['A', 'B'].includes(body.split_mode)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `split_mode must be 'A' or 'B' (got ${JSON.stringify(body.split_mode || null)})`
      });
    }
    const actor = actorFrom(req);
    // TYPE INFERENCE contract (coordinator, 2026-09-05): 'classification' —
    // unknown/absent = heuristics (coerced, never a 400).
    const classification =
      body.classification !== undefined ? typeInference.resolveStrategy(body.classification).strategy : undefined;
    // Repo targeting (see resolveTargetRepo — #78672): existing-repo branch
    // or the create-with-suffix loop, one implementation for both endpoints.
    const target = await resolveTargetRepo(body, authzForService(req), actor, 'crawled-repository');
    if (target.failure) return res.status(target.failure.status).json(target.failure.payload);
    const repo = target.repo;
    await crawlConversionService.startConversion({
      repo_id: repo.repo_id,
      file_id: body.file_id,
      url: body.url || null,
      crawl_job_id: body.crawl_job_id || null,
      split_mode: body.split_mode,
      requested_name: body.name || null,
      classification, // TYPE INFERENCE (David, 2026-09-05): rides the job → flushes
      actor
    });
    // name_adjusted comes from resolveTargetRepo (#80807): true only when the
    // create-path suffix loop renamed; false on the repo_id path.
    res.status(202).json({ ...repo, name_adjusted: target.name_adjusted });
  } catch (err) {
    next(err);
  }
}

/**
 * Story 7.7 (David, 2026-09-14): convert-from-documents — multi-select
 * document-repository files into ONE OKF repository. Mirrors convertFromCrawl:
 * create the repo (duplicate-suffix loop, born-right ACL slug), resolve the
 * classification strategy (unknown/absent = heuristics, never a 400), then
 * hand to producer-service (which stamps source_documents[] + okf_repo_id on
 * each source doc and runs the whole-corpus conversion under the SHARED
 * conversion slot). Ingested documents are ALLOWED here — the repo's own
 * ingest transition is gated downstream (SOURCES_NOT_RETRACTED).
 */
async function convertFromDocuments(req, res, next) {
  try {
    const body = req.body || {};
    const fileIds = Array.isArray(body.file_ids) ? body.file_ids.filter((f) => typeof f === 'string' && f.trim()) : [];
    if (fileIds.length === 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'file_ids (non-empty array) is required' });
    }
    const actor = actorFrom(req);
    const classification =
      body.classification !== undefined ? typeInference.resolveStrategy(body.classification).strategy : undefined;
    const target = await resolveTargetRepo(body, authzForService(req), actor, 'imported-repository');
    if (target.failure) return res.status(target.failure.status).json(target.failure.payload);
    const repo = target.repo;
    await producerService.startDocumentsConversion({
      repo_id: repo.repo_id,
      file_ids: fileIds,
      requested_name: body.name || null,
      classification,
      actor
    });
    // name_adjusted comes from resolveTargetRepo (#80807): true only when the
    // create-path suffix loop renamed; false on the repo_id path.
    res.status(202).json({ ...repo, name_adjusted: target.name_adjusted });
  } catch (err) {
    next(err);
  }
}

async function listRepos(req, res, next) {
  try {
    const { cursor, limit } = req.query;
    const result = await repoService.list({
      authz: authzForService(req),
      cursor,
      limit: parseInt(limit, 10)
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getRepo(req, res, next) {
  // AC7 (review fix): the getById-gate denial (foreign repo 404) is audited.
  // Missing and foreign are indistinguishable BY DESIGN, so the row records
  // the ambiguity; only written when a Set authz was actually in play.
  const authz = authzForService(req);
  try {
    const repo = await repoService.getById(req.params.repo_id, { authz });
    res.status(200).json(repo);
  } catch (err) {
    if (authz instanceof Set && err && err.code === 'REPO_NOT_FOUND') {
      auditService
        .writeAudit({
          action: 'authz.denied.repo',
          actor: (req.user && req.user.sub) || null,
          repo_id: req.params.repo_id,
          source_ip: req.ip
        })
        .catch(() => {
          /* best-effort */
        });
    }
    next(err);
  }
}

/**
 * Concept IMPORT (Story 2.9.1 — ADR-021 4a–4f; route /import since David's
 * 2026-09-04 vocabulary ruling: "import" creates the repository, "ingest" is
 * the RAG pipeline). Body mirrors pii-scan's shapes: explicit concepts[] (the
 * 2.9.5 unzip and the 7.2 producer call the service directly), file_ids[], or
 * discover:true — plus optional hierarchy labels (appended AFTER the
 * orchestrator's ACL set). Gate order: requireRepoScope (route) → getById
 * existence+authz (404 foreign, anti-enumeration) → orchestrate → 202 with
 * the summary.
 */
async function importRepoConcepts(req, res, next) {
  try {
    const { repo_id } = req.params;
    const body = req.body || {};
    const { concepts, file_ids, discover, labels, zip, bundle_name } = body;
    // TYPE INFERENCE contract (coordinator, 2026-09-05): the key is
    // `classification` with values heuristics|llm|hybrid — unknown or absent
    // = heuristics (COERCED, never a 400). See type-inference-service.
    let classification;
    if (body.classification !== undefined) {
      classification = typeInference.resolveStrategy(body.classification).strategy;
    }
    const hasZip = typeof zip === 'string' && zip.length > 0;
    if (!hasZip) {
      if (!Array.isArray(concepts) || concepts.length === 0) {
        if (!Array.isArray(file_ids) || file_ids.length === 0) {
          if (discover !== true) {
            throw new ValidationError([
              'body must contain zip (base64 bundle), concepts[], file_ids[], or discover:true'
            ]);
          }
        }
      }
    }
    // Explicit concepts must carry a non-empty body — an empty concept has
    // nothing to parse/index and would silently count as "processed"
    // (2026-08-16 review fix). (zip concept bodies are validated post-unzip
    // by the service — BAD_ZIP/VALIDATION_ERROR there.)
    if (Array.isArray(concepts)) {
      const badIndex = concepts.findIndex((c) => !c || typeof c.body !== 'string' || c.body.trim() === '');
      if (badIndex >= 0) {
        throw new ValidationError([`concepts[${badIndex}].body must be a non-empty string`]);
      }
    }
    const cap = ingestService.maxConceptsFromEnv();
    if (concepts && concepts.length > cap) {
      return res.status(400).json({
        error: 'TOO_MANY_CONCEPTS',
        message: `body contains ${concepts.length} concepts; the cap is ${cap} (OKF_INGEST_MAX_CONCEPTS)`
      });
    }
    // Repo-existence + authorization gate (mirrors every other mutating route).
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const summary = await ingestService.ingestRepoConcepts(
      repo_id,
      { concepts, file_ids, discover, labels, zip, bundle_name, classification },
      actorFrom(req)
    );
    res.status(202).json({ success: true, ...summary });
  } catch (err) {
    next(err);
  }
}

/**
 * RETIRED ROUTE (import ≠ RAG, David 2026-09-04): POST /ingest used to be the
 * concept-import trigger — the word now belongs to the RAG pipeline ONLY.
 * 410 GONE with the two routes that replaced it (import vs lifecycle ingest).
 */
async function retiredIngestRoute(req, res) {
  res.status(410).json({
    error: 'ROUTE_RETIRED',
    message:
      'POST /ingest no longer imports concepts. Import: POST /api/okf/repos/' +
      (req.params && req.params.repo_id) +
      '/import. RAG ingestion: POST /api/okf/repos/' +
      (req.params && req.params.repo_id) +
      '/lifecycle with body {"action":"ingest"}.'
  });
}

/**
 * STEP-7 VALIDATION REPORT (David, 2026-10-02 — #1030 + #1036): the unified
 * issue list — per-concept conformance, orphaned concepts, near-duplicate
 * groups, and unlinked citations — each with severity and the remedy process.
 * Read-scope: it inspects, it does not mutate.
 */
async function getRepoValidation(req, res, next) {
  try {
    const { repo_id } = req.params;
    await repoService.getById(repo_id, { authz: authzForService(req) }); // 404 foreign repos
    const report = await validationService.getValidationReport(repo_id);
    res.status(200).json(report);
  } catch (err) {
    next(err);
  }
}

/**
 * START A WHOLE-CORPUS TOPIC-LINK RUN (Story 1-8g-p). The SAME
 * authorRepoTopicLinks pass the wizard runs at import time — generic by
 * construction (no domain lexicon): it authors the cross-links a corpus that
 * never cites itself is born without.
 *
 * DETACHED by design: a 1000-concept repo costs minutes of LLM time and the
 * gateway caps a request at 60s, so the work is started and the caller polls
 * GET /:repo_id/topic-links. Returns 202 with the initial run state.
 * Admin-scope mutation; frozen repos refuse (same gate as other restructurings).
 */
async function startTopicLinks(req, res, next) {
  try {
    const { repo_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const run = await topicLinks.startTopicLinkRun(repoDoc, {
      dryRun: (req.body || {}).dry_run === true,
      actor: actorFrom(req).sub || 'system'
    });
    await auditService.writeAudit({
      actor: actorFrom(req).sub || 'system',
      actor_name: actorFrom(req).name || null,
      action: 'repo.topic_links.start',
      repo_id,
      source_ip: actorFrom(req).source_ip || null,
      description: `Started a whole-corpus topic-link run${run.dry_run ? ' (dry run)' : ''}`
    });
    res.status(202).json({ success: true, ...run });
  } catch (err) {
    next(err);
  }
}

/**
 * The topic-link run state (poll target for the editor). Read-scope. A run left
 * 'running' by a dead process is reported as failed rather than shown as an
 * eternal spinner.
 */
async function getTopicLinks(req, res, next) {
  try {
    const { repo_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    res.status(200).json({ success: true, run: await topicLinks.getTopicLinkRunState(repoDoc) });
  } catch (err) {
    next(err);
  }
}

/**
 * CITATION HUB WIRING (#1036, David's rule: every citing page must LINK to
 * the Sources hub so citations reach the graph at ingest). Creates the hub
 * when the bundle has none; wires frontmatter links[] on every citing page.
 * Admin-scope mutation; frozen repos refuse (same gate as other restructurings).
 */
async function wireRepoCitations(req, res, next) {
  try {
    const { repo_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const result = await validationService.wireCitationHub(repo_id, {
      hub_concept_id: (req.body || {}).hub_concept_id,
      actor: actorFrom(req)
    });
    await auditService.writeAudit({
      actor: actorFrom(req).sub || 'system',
      actor_name: actorFrom(req).name || null,
      action: 'repo.citations.wire',
      repo_id,
      source_ip: actorFrom(req).source_ip || null,
      description: `Wired ${result.wired} citing page(s) to the Sources page${result.hub_created ? ' (created)' : ''}`
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * LINK SUGGESTIONS (#1036 Class A): the LLM proposes which existing concepts
 * an orphaned page genuinely references. Read-only — nothing is written until
 * the steward accepts a proposal via POST .../links.
 */
async function suggestConceptLinks(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    const result = await llmCuration.proposeLinks(repoDoc, concept_id);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * ACCEPT one suggested (or hand-entered) link: a frontmatter links[] append
 * through the field-scoped patch — the born-right channel that survives body
 * edits and feeds both the editor projection and the ingest graph. The target
 * MUST exist in this repo (a dangling edge is never created); self-links and
 * duplicates are refused.
 */
async function acceptConceptLink(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const to = String((req.body || {}).to_concept_id || '').replace(/^concepts\//, '');
    if (!to) throw new ValidationError(['to_concept_id is required']);
    if (to === concept_id) throw new ValidationError(['a concept cannot link to itself']);
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const target = await conceptMetaService.getConceptMeta(repo_id, to);
    if (!target) throw new ValidationError([`target concept '${to}' does not exist in this repository`]);
    const current = await conceptMetaService.getConceptMeta(repo_id, concept_id);
    if (!current) return res.status(404).json({ error: 'NOT_FOUND', message: 'concept not found' });
    const fmLinks = Array.isArray(current.frontmatter && current.frontmatter.links) ? current.frontmatter.links : [];
    if (
      fmLinks.some(
        (l) =>
          String((l && l.target) || '')
            .replace(/\.md$/i, '')
            .replace(/^concepts\//, '') === to
      )
    ) {
      return res.status(200).json({ success: true, already_linked: true, concept_id, to_concept_id: to });
    }
    const label = String((req.body || {}).label || target.title || to).slice(0, 80);
    await conceptMetaService.patchConceptFields(repo_id, concept_id, {
      frontmatterPatch: { links: [...fmLinks, { target: `${to}.md`, label }] }
    });
    await auditService.writeAudit({
      actor: actorFrom(req).sub || 'system',
      actor_name: actorFrom(req).name || null,
      action: 'concept.link.accept',
      repo_id,
      source_ip: actorFrom(req).source_ip || null,
      description: `Linked "${concept_id}" → "${to}" (label: ${label})`
    });
    res.status(200).json({ success: true, concept_id, to_concept_id: to, label });
  } catch (err) {
    next(err);
  }
}

/**
 * Story 2.9.7 — mint the repository's next version (ADR-031: repo-level,
 * monotonic, immutable manifest; a publish/crawl side-effect, never a
 * lifecycle state). Body: { trigger?: 'manual'|'publish'|'crawl', source_ref? }.
 * Gate order mirrors ingest: requireRepoScope (route) → getById (404 foreign).
 */
async function mintRepoVersion(req, res, next) {
  try {
    const { repo_id } = req.params;
    const { trigger, source_ref } = req.body || {};
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const minted = await versionService.mintVersion(repo_id, { trigger, source_ref }, actorFrom(req));
    res.status(201).json(minted);
  } catch (err) {
    next(err);
  }
}

/** Story 2.9.7 — list a repo's version manifests, newest first (read scope). */
async function listRepoVersions(req, res, next) {
  try {
    const { repo_id } = req.params;
    await repoService.getById(repo_id, { authz: authzForService(req) });
    res.status(200).json({ repo_id, versions: await versionService.listVersions(repo_id) });
  } catch (err) {
    next(err);
  }
}

/** Story 2.9.7 — one full manifest (read scope; version-pinned citation).
 * Strict integer-format param (review fix P6: parseInt silently prefix-parsed
 * '1.9'→1 and turned 'abc'→NaN 404 — a client error must 400, never a wrong
 * resource or an internal-key leak). */
async function getRepoVersion(req, res, next) {
  try {
    const { repo_id, bundle_version } = req.params;
    if (!/^\d+$/.test(String(bundle_version))) {
      throw new ValidationError([`bundle_version must be a positive integer (got "${bundle_version}")`]);
    }
    await repoService.getById(repo_id, { authz: authzForService(req) });
    res.status(200).json(await versionService.getVersion(repo_id, parseInt(bundle_version, 10)));
  } catch (err) {
    next(err);
  }
}

/**
 * Story 4.8 (D-V5) — clone an OKF repository: create a NEW draft repo that copies
 * the source's concepts + meta verbatim + records cloned_from lineage. Gate order
 * mirrors ingest: requireRepoScope('source_id','admin') (route) → getById pre-gate
 * (404 foreign/missing, anti-enumeration) → cloneRepository → 201. All body fields
 * optional (defaults derived by the service); a duplicate (name,domain) → 409.
 */
async function cloneRepo(req, res, next) {
  try {
    const { source_id } = req.params;
    const input = validate(cloneSchema, req.body || {});
    // Repo-existence + authorization gate (mirrors every other mutating route).
    await repoService.getById(source_id, { authz: authzForService(req) });
    const clone = await repoService.cloneRepository(source_id, input, actorFrom(req));
    res.status(201).json(clone);
  } catch (err) {
    next(err);
  }
}

async function updateRepo(req, res, next) {
  try {
    const patch = validate(updateSchema, req.body);
    const repo = await repoService.update(req.params.repo_id, patch, actorFrom(req));
    res.status(200).json(repo);
  } catch (err) {
    next(err);
  }
}

async function deleteRepo(req, res, next) {
  try {
    const result = await repoService.remove(req.params.repo_id, actorFrom(req));
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Story 2.8 — PII scan. Four modes (AC 9):
 *  - {concepts: [{concept_id, frontmatter, body}]} — explicit (2.9.1/7.2 call
 *    the service directly in production; the endpoint exists for steward use).
 *  - {file_ids: [...]} or {discover: true} — scan the repo's uploaded
 *    plain-.md files (found via the okf_repo_id stamp from Story 2.5).
 *  - {scope: 'concepts'} — REPO-WIDE CONCEPT RESCAN: enumerate every
 *    concept_id of the repo from okf_concepts_meta and run the real
 *    persisting scanConcept on each. This is the mode the publish gate's
 *    subjects need (the gate reads pii_state on the concept ROWS, not on
 *    source files), and it is what clears a concept stuck in pii_state
 *    'error'. It is ASYNC — 202 + poll, because 141 concepts x one sidecar
 *    round-trip each cannot finish inside a gateway timeout. Poll with
 *    GET /:repo_id/pii-scan/:scan_key.
 * On success with file input, records the FR-3 ingest version.
 */
async function piiScan(req, res, next) {
  try {
    const { repo_id } = req.params;
    const { concepts, file_ids, discover, scope } = req.body || {};

    // Repo-existence + authorization gate (mirrors every other mutating route) —
    // fail BEFORE writing any meta docs (code-review fix #7). A repo outside
    // the caller's scopes 404s identically to a missing one (Story 6.1).
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    // DRAIN FREEZE (David, 2026-09-12): the scan OVERWRITES pii_state on
    // every concept row — a GDPR re-scan mid-ingest races the drain snapshot
    // and would flag/unflag content under a version being indexed. Frozen
    // with everything else (the panel's read-only inspect stays available).
    assertWritable(repoDoc);

    // Repo-wide concept rescan: ASYNC (202 + poll). The 202+poll idiom is the
    // codebase's established one for long jobs (head-suite beginRunSuite) —
    // NOT a new shape. The drain freeze above applies here too: this mode
    // overwrites pii_state on EVERY concept row.
    if (scope === 'concepts') {
      const { scan_key, done } = await piiService.beginRepoConceptScan(repo_id, { actor: actorFrom(req) });
      done.catch(() => {}); // the service logs + records the failure doc
      auditService
        .writeAudit({
          action: 'repo.pii_concept_scan',
          actor: actorFrom(req).sub,
          actor_name: actorFrom(req).name,
          repo_id,
          source_ip: req.ip,
          description: `PII repo-wide concept rescan queued — ${scan_key}`,
          details: { scan_key }
        })
        .catch(() => {
          /* best-effort */
        });
      return res.status(202).json({ repo_id, scan_key, status: 'running' });
    }

    let inputs = [];
    let sourceFileIds = [];
    if (Array.isArray(concepts) && concepts.length > 0) {
      inputs = concepts;
    } else if (Array.isArray(file_ids) && file_ids.length > 0) {
      sourceFileIds = file_ids;
      inputs = (await piiService.discoverRepoFiles(repo_id)).filter((c) => file_ids.includes(c.file_id));
    } else if (discover) {
      inputs = await piiService.discoverRepoFiles(repo_id);
      sourceFileIds = inputs.map((c) => c.file_id);
    } else {
      throw new ValidationError(['body must contain concepts[], file_ids[], discover:true, or scope:"concepts"']);
    }

    const results = [];
    for (const c of inputs) {
      results.push(await piiService.scanConcept(repo_id, c.concept_id, c.frontmatter, c.body));
    }

    // FR-3: record the ingest version on the latest file (discovery sorts DESC).
    let version = null;
    if (sourceFileIds.length > 0) {
      version = await piiService.recordIngestVersion(repo_id, {
        file_id: sourceFileIds[0],
        curator: { sub: actorFrom(req).sub, name: actorFrom(req).name } // no source_ip
      });
    }

    // NO FALSE ATTESTATION: a scan that examined NOTHING must not stamp the
    // repo "PII scanned / complete". Discovery legitimately finds zero rows
    // (sources stamped with okf_repo_id rather than repo_id, or all-binary
    // sources), and the old unconditional stamp turned that into a
    // compliance claim for content nobody looked at. Fail loudly instead.
    if (results.length === 0) {
      const err = new Error(
        `PII scan examined no content for repo ${repo_id} — the repository was NOT marked PII-scanned. ` +
          'Use {scope:"concepts"} to rescan the concepts the publish gate actually reads.'
      );
      err.code = 'PII_SCAN_NOTHING_SCANNED';
      err.status = 400;
      throw err;
    }

    // Mark the repo PII-scanned (unscanned content blocks publish — gate #3).
    await piiService.markRepoPiiScanned(repo_id);

    const gate = await piiService.assertPiiClean(repo_id);
    // AUDIT: a PII scan is a compliance action over the full content set.
    auditService
      .writeAudit({
        action: 'repo.pii_scan',
        actor: actorFrom(req).sub,
        actor_name: actorFrom(req).name,
        repo_id,
        source_ip: req.ip,
        description:
          'PII scan completed — ' +
          results.length +
          ' concept(s) scanned; gate ' +
          (gate.blocked ? 'BLOCKED (' + gate.reasons.join('; ') + ')' : 'clean'),
        details: { scanned: results.length, gate }
      })
      .catch(() => {
        /* best-effort */
      });
    res.status(200).json({
      repo_id,
      scanned: results.length,
      results: results.map((r) => ({
        concept_id: r.concept_id,
        pii_state: r.pii_state,
        pii_hits_summary: r.pii_hits_summary
      })),
      gate,
      ...(version ? { version } : {})
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/okf/repos/:repo_id/pii-scan/:scan_key — the poll for the ASYNC
 * repo-wide concept rescan (POST /:repo_id/pii-scan {"scope":"concepts"}).
 * Read scope, mirroring the suite-run poll: {status:'running', progress}
 * keep waiting, {status:'failed', error} is terminal, otherwise the full
 * tally {scanned, clean, hit, error, missing, results[], gate}.
 */
async function getPiiConceptScan(req, res, next) {
  try {
    const { repo_id, scan_key } = req.params;
    // Anti-enumeration: a repo outside the caller's scopes 404s identically
    // to a missing one, exactly like every other read on this router.
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const doc = await piiService.getRepoConceptScan(repo_id, scan_key);
    res.status(200).json(doc);
  } catch (err) {
    next(err);
  }
}

/**
 * Story B+C — read the settled bundle's manifest (the bundle's structural
 * self-description: concepts, author links, root, stats). ?summary=1 lazily
 * generates + caches the LLM summary (David's directive: the summary is
 * LLM-authored from ingest-time metadata). 404 until the bundle settles —
 * the manifest is written by the settle path, not at ingest time.
 */
async function getRepoManifest(req, res, next) {
  try {
    const { repo_id } = req.params;
    // getById pre-gate (404 foreign, anti-enumeration — mirrors getRepo).
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const wantSummary = req.query.summary === '1' || req.query.summary === 'true';
    const manifest = wantSummary
      ? await conceptMetaService.ensureSummary(repo_id)
      : await conceptMetaService.readManifest(repo_id);
    if (!manifest) {
      return res.status(404).json({ error: 'MANIFEST_NOT_FOUND', message: 'bundle has not settled yet' });
    }
    res.status(200).json(manifest);
  } catch (err) {
    next(err);
  }
}

/**
 * Editor graph projection (David, 2026-09-04): the LIVE author-stated edges
 * from okf_concepts_meta — the graph view in the editor renders this, never
 * the ArangoDB serving graph (which exists only post-drain and would freeze
 * the picture at ingest time). Availability differs from /manifest by design:
 * links exist from the FIRST import (curation-time truth), no settle needed.
 */
async function getRepoLinks(req, res, next) {
  try {
    const { repo_id } = req.params;
    // getById pre-gate (404 foreign, anti-enumeration — mirrors getRepoManifest).
    await repoService.getById(repo_id, { authz: authzForService(req) });
    res.status(200).json(await conceptMetaService.getRepoLinks(repo_id));
  } catch (err) {
    next(err);
  }
}

/**
 * Story E — multi-domain discovery (tier 1 of the retrieval fan-out): score
 * every settled bundle manifest against the query and return the top-K
 * candidate repos. Body: { query: string, labels?: string[], domain?: string,
 * k?: number }. The client then drills per-repo (tier 2 chunk-label scan,
 * tier 3 graph walk) against the repos this returns, each behind its own
 * read scope.
 */
async function discoverFromManifests(req, res, next) {
  try {
    const { query, labels, domain, k } = req.body || {};
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'query (string) required' });
    }
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2);
    const result = await conceptMetaService.discoverRepos(
      { tokens, labels: Array.isArray(labels) ? labels : [], domain: typeof domain === 'string' ? domain : null },
      { k: Number.isInteger(k) ? k : undefined }
    );
    res.status(200).json({ query, candidates: result });
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 — GET /api/okf/repos/:repo_id/concepts.
 * Lists the repo's concept meta rows for the Studio editor's left rail
 * (read scope). Errors-first sort + no bodies — bodies ride on the
 * per-concept GET below.
 *
 * NON-BLOCKING LOAD (David, 2026-09-12): with ?limit=&offset= the response is
 * { total, offset, limit, concepts } so the editor fetches in chunks and shows
 * a real progress bar; without them the legacy full-array shape is returned
 * (backward compatible with every existing consumer).
 */
async function listConcepts(req, res, next) {
  try {
    const { repo_id } = req.params;
    // getById pre-gate (404 foreign, anti-enumeration — mirrors getRepoManifest).
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const { limit, offset } = req.query || {};
    if (limit === undefined && offset === undefined) {
      const concepts = await conceptMetaService.listConceptsMeta(repo_id);
      return res.status(200).json(concepts);
    }
    const page = await conceptMetaService.listConceptsMeta(repo_id, { limit, offset });
    return res.status(200).json(page);
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 — GET /api/okf/repos/:repo_id/concepts/:concept_id.
 * Full meta row — frontmatter + body included — so the editor can round-trip
 * the markdown (body is persisted on the meta doc since Story 4.8-amend
 * content-only chunking).
 */
async function getConcept(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const concept = await conceptMetaService.getConceptMeta(repo_id, concept_id);
    if (!concept) {
      return res.status(404).json({
        error: 'CONCEPT_NOT_FOUND',
        message: `Concept '${concept_id}' not found in repo '${repo_id}'`
      });
    }
    res.status(200).json(concept);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/okf/repos/:repo_id/pii-bulk — REPO BULK PII ACTION (David,
 * 2026-09-12): Redact / Remove / Accept applied to EVERY flagged concept in
 * one steward decision (Files-view header controls). Scan-free — the stored
 * unresolved summary is the ledger — and the repo scan marker is stamped
 * complete, so the repository is publishable immediately and is NOT scanned
 * again by the publish gate. Writability asserted; audited.
 */
async function repoBulkPii(req, res, next) {
  try {
    const { repo_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const out = await piiService.repoBulkAction(repo_id, req.body || {}, actorFrom(req));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/okf/repos/:repo_id/concepts/:concept_id/pii-inspect — PII REVIEW
 * (David, 2026-09-09: every issue flagged, categorized and described in clear
 * language). A LIVE Presidio scan of the concept's CURRENT content returning
 * per-occurrence {where, type, start, end, score} so the editor can locate
 * each finding. Nothing persisted; flagged VALUES never returned (the editor
 * renders excerpts from content it already has).
 */
async function inspectPii(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const concept = await conceptMetaService.getConceptMeta(repo_id, concept_id);
    if (!concept) {
      return res.status(404).json({ error: 'CONCEPT_NOT_FOUND', message: `Concept '${concept_id}' not found` });
    }
    // FINDINGS REUSE (David, 2026-09-13): unchanged content is served from
    // the persisted span cache (no Presidio call). The panel's explicit
    // Re-scan button sends {rescan:true} to force a live scan.
    const out = await piiService.inspectConcept(repo_id, concept_id, concept.frontmatter || {}, concept.body || '', {
      rescan: Boolean(req.body && req.body.rescan)
    });
    res.status(200).json({
      ok: out.state !== 'error',
      state: out.state,
      occurrences: out.occurrences,
      counts_by_type: out.counts_by_type || {},
      // PII REMEDIATION (David, 2026-09-09): the persisted before/after
      // ledger rides the inspect response so a fresh panel shows the
      // processed (green) items too.
      resolutions: Array.isArray(concept.pii_resolutions) ? concept.pii_resolutions : []
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/okf/repos/:repo_id/concepts/:concept_id/pii-remediate — PII
 * REVIEW (David, 2026-09-09): in-place remediation. The server applies the
 * splice against ITS OWN scan offsets (redact → "REDACTED", replace → user
 * text, remove → deleted), records the before/after resolution for the
 * green processed list, re-scans (Presidio feedback), and returns the fresh
 * panel payload. Writability asserted — a serving repo is frozen.
 */
async function remediatePii(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const out = await piiService.remediatePii(repo_id, concept_id, req.body || {}, actorFrom(req));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/okf/repos/:repo_id/concepts/:concept_id/pii-accept — ACCEPT one
 * flagged occurrence: the text stays, the flag is suppressed (the steward's
 * reviewed decision for legitimate public entities; audited, and visible in
 * the panel's green processed list).
 */
async function acceptPii(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const out = await piiService.acceptPii(repo_id, concept_id, req.body || {}, actorFrom(req));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/okf/repos/:repo_id/concepts/:concept_id/pii-file-action — WHOLE-FILE
 * PII ACTION (David, 2026-09-09): Redact / Remove / Accept applied to the
 * ENTIRE file. Occurrences ride the request (the panel's current scan); the
 * path is scan-free. Writability asserted; audited; ledger recorded.
 */
async function fileActionPii(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const out = await piiService.fileActionPii(repo_id, concept_id, req.body || {}, actorFrom(req));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/okf/repos/:repo_id/concepts/:concept_id/pii-redact-file — REDACT
 * THE WHOLE FILE (David, 2026-09-09): when flagged entities dominate a
 * document, the body is replaced wholesale with a redaction notice
 * (frontmatter identity preserved). Audited; recorded in the version
 * modification ledger.
 */
async function redactWholeFilePii(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const out = await piiService.redactWholeFile(repo_id, concept_id, actorFrom(req));
    res.status(200).json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 — PATCH /api/okf/repos/:repo_id/concepts/:concept_id.
 * THREE mutually-exclusive body modes (labels write-through, 2026-09-05):
 *  - { markdown }  full markdown — frontmatter + body replaced (legacy)
 *  - { frontmatter }  merged onto the CURRENT stored frontmatter (no
 *    snapshot round-trip → a label write can't clobber a concurrent edit)
 *  - { body }  body replaced, frontmatter untouched
 * Updates the meta row in place; if the body hash CHANGED, resets
 * index_status='parsed' so the worker re-indexes on the next poll. A
 * frontmatter merge keeps the hash → labels never trigger a re-embed.
 * Writability (REPO_READ_ONLY on a serving repo) is asserted for every mode.
 *
 * - 404 if the concept doesn't exist in this repo
 * - 400 if the payload doesn't match exactly one mode / is malformed
 * - 409 REPO_READ_ONLY when the repo is serving (ingested)
 * - 200 with { ok, concept_id, content_hash, index_status, updated_at }
 */
async function patchConcept(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const payload = req.body || {};
    const hasMarkdown = typeof payload.markdown === 'string';
    const hasFrontmatter =
      payload.frontmatter !== null &&
      payload.frontmatter !== undefined &&
      typeof payload.frontmatter === 'object' &&
      !Array.isArray(payload.frontmatter);
    const hasBody = typeof payload.body === 'string';
    if ([hasMarkdown, hasFrontmatter, hasBody].filter(Boolean).length !== 1) {
      throw new ValidationError([
        'exactly one of markdown (string), frontmatter (object) or body (string) is required'
      ]);
    }
    // Authz + writability FIRST — a frozen repo 409s before content parsing.
    // 1-8g-q (David, 2026-10-11: "I see it as a maintenance operation,
    // similar to indexing a database"): the INDEX concept IS the head — its
    // markdown carries the repo frontmatter YAML (the tag-set the vectorized
    // head is built from), and the FrontmatterPanel saves exactly this. A
    // serving repo accepts that ONE maintenance write; every other concept,
    // and body/label writes anywhere else, stay frozen until retract (their
    // content is baked into the serving graph's chunks).
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    if (!(concept_id === 'index' && hasMarkdown)) {
      assertWritable(repoDoc);
    }
    let updated;
    let mode;
    if (hasMarkdown) {
      mode = 'markdown';
      // Parse the markdown — gray-matter splits frontmatter from body.
      const parsed = await parserService.parseConcept(payload.markdown, {
        repo_id,
        path: `${concept_id}.md` // path determines concept_id (unchanged on patch)
      });
      updated = await conceptMetaService.patchConceptMeta(repo_id, concept_id, parsed);
    } else {
      mode = hasFrontmatter ? 'frontmatter' : 'body';
      updated = await conceptMetaService.patchConceptFields(
        repo_id,
        concept_id,
        hasFrontmatter ? { frontmatterPatch: payload.frontmatter } : { body: payload.body }
      );
    }
    if (!updated) {
      return res.status(404).json({
        error: 'CONCEPT_NOT_FOUND',
        message: `Concept '${concept_id}' not found in repo '${repo_id}'`
      });
    }
    // PII RE-SCAN ON EDIT (David, 2026-09-09: the user must be advised on the
    // specifics of each flag and how to remediate it): flags were stamped only
    // at IMPORT, so an edit that removed the entity never cleared its flag and
    // the blanket acknowledgement was the only way through. Every content patch
    // now re-scans the concept (fail-closed, same as import): removing the
    // entity clears the flag on save; introducing one flags it before publish.
    // The response carries the fresh state so the editor can show it inline.
    const pii = await piiService.scanConcept(repo_id, concept_id, updated.frontmatter, updated.body);
    // Audit + counter (best-effort — audit failure is non-fatal)
    try {
      await auditService.writeAudit({
        action: 'concept.patch',
        actor: actorFrom(req).sub,
        actor_name: actorFrom(req).name,
        repo_id,
        source_ip: req.ip,
        concept_id,
        content_hash: updated.content_hash,
        index_status: updated.index_status,
        description:
          'Edited concept "' +
          concept_id +
          '" (' +
          mode +
          ' patch) — re-index ' +
          (updated.index_status === 'parsed' ? 'queued (content changed)' : 'not needed (content unchanged)') +
          // PII REVIEW (David, 2026-09-09): the adjustment's PII outcome rides
          // the audit trail so the APPROVER sees what each correction did.
          ' — PII: ' +
          (pii
            ? pii.pii_state === 'hit'
              ? 'still flagged (' +
                Object.entries(pii.pii_hits_summary || {})
                  .map(([t, n]) => t + '×' + n)
                  .join(', ') +
                ')'
              : pii.pii_state
            : 're-scan pending')
      });
    } catch {
      /* ignore — audit is best-effort */
    }
    try {
      meter.counter('okf.concept.patch').add(1);
    } catch {
      /* metrics are best-effort */
    }
    res.status(200).json({
      ok: true,
      concept_id: updated.concept_id,
      content_hash: updated.content_hash,
      index_status: updated.index_status,
      updated_at: updated.updated_at,
      pii_state: pii ? pii.pii_state : null,
      pii_hits_summary: pii ? pii.pii_hits_summary || {} : null,
      // OVERHEAD FIX (David, 2026-09-09): the save's server-side re-scan
      // already produced the fresh occurrences — ride them on THIS response
      // so the editor never needs a second pii-inspect call after a save
      // (that redundant scan was saturating the Presidio sidecar queue).
      pii_occurrences: pii ? pii.occurrences || [] : []
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 — DELETE /api/okf/repos/:repo_id/concepts/:concept_id.
 * Removes the concept's meta row + indexed chunks + graph edges (admin
 * scope). 404 when the concept doesn't exist in this repo.
 */
async function deleteConcept(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const removed = await ingestService.deleteConcept(repo_id, concept_id, { actor: actorFrom(req) });
    if (!removed) {
      return res.status(404).json({
        error: 'CONCEPT_NOT_FOUND',
        message: `Concept '${concept_id}' not found in repo '${repo_id}'`
      });
    }
    res.status(200).json({ ok: true, concept_id, ...removed });
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 — POST /api/okf/repos/:repo_id/resplit.
 * Body: { mode: 'A'|'B'|'C' }.
 * Deletes all concepts for this repo + clears the per-repo graph collections,
 * then re-ingests from the linked doc-repo file (looked up via files.okf_repo_id).
 *
 * - 400 if mode is unknown
 * - 404 if no doc-repo file is linked to the repo
 * - 200 with the ingest summary { total, parsed, created, rejected, enqueued, mode }
 */
async function resplitRepo(req, res, next) {
  try {
    const { repo_id } = req.params;
    const { mode, file_id } = req.body || {};
    if (!['A', 'B', 'C'].includes(mode)) {
      throw new ValidationError(["mode must be one of 'A', 'B', 'C'"]);
    }
    // Story #978 — pass file_id from the body to ingestService.resplitRepo
    // so the service can fetch the right .md from doc-repo. Today the link
    // lives in the frontend (we tracked it at create time); once we wire
    // `files.okf_repo_id` server-side, the service can look it up itself and
    // file_id becomes optional.
    // READ-ONLY guard: getById pre-gate (anti-enumeration 404, mirrors the
    // other mutating routes) + serving repos cannot be re-split.
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    const opts = { ...actorFrom(req), file_id };
    const summary = await ingestService.resplitRepo(repo_id, mode, opts);
    // AUDIT: a re-split DELETES every concept and rebuilds from the source —
    // one of the most destructive repository actions; it must be in the log.
    auditService
      .writeAudit({
        action: 'repo.resplit',
        actor: actorFrom(req).sub,
        actor_name: actorFrom(req).name,
        repo_id,
        source_ip: req.ip,
        description:
          'Re-split the repository from its source file (mode ' +
          mode +
          ') — ' +
          summary.total +
          ' concept(s) re-ingested',
        details: { mode, ...summary }
      })
      .catch(() => {
        /* best-effort */
      });
    res.status(200).json({ ok: true, mode, ...summary });
  } catch (err) {
    next(err);
  }
}

/**
 * RE-INGEST FAILED CONCEPTS (David, 2026-10-14). Serves BOTH routes:
 *   POST /:repo_id/reingest-failed                  (all failed concepts)
 *   POST /:repo_id/concepts/:concept_id/reingest    (one concept)
 *
 * Read-only with respect to CONTENT — it requeues meta rows and re-arms the
 * drain. That is why it must NOT use assertWritable: re-ingest exists for a
 * SERVING repo, which is exactly the state assertWritable refuses.
 */
async function reingestFailed(req, res, next) {
  try {
    const { repo_id, concept_id } = req.params;
    // getById pre-gate first: anti-enumeration 404 for a foreign repo, and the
    // authz narrowing every other mutating handler does.
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    if (!repoDoc) throw new ValidationError(['repository not found']);
    // Throws 409 NOT_INGESTED / DRAIN_IN_PROGRESS with actionable messages.
    lifecycleService.assertReingestable(repoDoc);

    const result = await lifecycleService.reingestFailed(repo_id, { conceptId: concept_id || null }, actorFrom(req));

    // AUDIT is written inside the service for the armed path (it carries the
    // concept ids the requeue actually touched, which the controller does not
    // see). Nothing to add here.
    res.status(200).json({
      ok: true,
      repo_id,
      concept_id: concept_id || null,
      requeued: result.requeued,
      concept_ids: result.conceptIds || [],
      pending: result.pending === undefined ? null : result.pending
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 — POST /api/okf/repos/:repo_id/autocorrect.
 * Body: { dry_run?: boolean }.
 * Scans all concepts and applies frontmatter-only autocorrect rules. With
 * dry_run=true, returns the planned changes without applying. With dry_run=false
 * (default), applies atomically.
 *
 * Returns { ok, changes, warnings }.
 */
async function autocorrectRepo(req, res, next) {
  try {
    const { repo_id } = req.params;
    const { dry_run, concept_id: bodyConceptId, mode: bodyMode } = req.body || {};
    // READ-ONLY guard: getById pre-gate (anti-enumeration 404) + serving
    // repos cannot be autocorrected.
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
    // D-L (#990): llm/hybrid curated propose — per-concept or whole-repo
    // {concept_id, before, after, changes[]} with from-empty support (blank
    // frontmatter proposes the FULL correct frontmatter: type, bounded KH-L2
    // label, summary). Applying reuses the concept PATCH ({frontmatter} merge
    // incl. RFC-7386 null-deletes). dry_run defaults TRUE for curated
    // proposals — an LLM apply is always an explicit second step. Mode:
    // explicit body mode WINS — including explicit 'heuristics' (David,
    // 2026-09-12: the Autocorrect panel pins heuristics; the previous
    // resolution only recognized llm/hybrid as explicit, so an
    // llm-classified repo silently rerouted the panel's mechanical scan
    // into per-concept LLM proposals). OMITTED routes by the repo's
    // PERSISTED classification (set at import).
    const mode = ['llm', 'hybrid', 'heuristics'].includes(bodyMode)
      ? bodyMode
      : ['llm', 'hybrid'].includes(repoDoc.classification)
        ? repoDoc.classification
        : 'heuristics';
    if (mode !== 'heuristics') {
      const proposals = await llmCuration.proposeFrontmatter(repoDoc, bodyConceptId || null, { classification: mode });
      let appliedCount = 0;
      if (!(dry_run === true)) {
        const list = Array.isArray(proposals) ? proposals : [proposals];
        for (const p of list) {
          if (!p || !p.changes || p.changes.length === 0) continue;
          await conceptMetaService.patchConceptMeta(repo_id, p.concept_id, { frontmatter: p.after });
          appliedCount += 1;
        }
        auditService
          .writeAudit({
            action: 'repo.autocorrect',
            actor: actorFrom(req).sub,
            actor_name: actorFrom(req).name,
            repo_id,
            source_ip: req.ip,
            description: 'Applied curated frontmatter proposals (' + mode + ') — ' + appliedCount + ' concept(s)',
            details: { mode, applied: appliedCount }
          })
          .catch(() => {
            /* best-effort */
          });
      }
      return res.status(200).json({ ok: true, mode, dry_run: dry_run === true, proposals, applied: appliedCount });
    }
    const applied = !(dry_run === true);
    const result = await conceptMetaService.autocorrectRepo(
      repo_id,
      typeof dry_run === 'boolean' ? dry_run : true,
      actorFrom(req)
    );
    // AUDIT: only an APPLYING run modifies concepts; a dry run is a read.
    if (applied) {
      auditService
        .writeAudit({
          action: 'repo.autocorrect',
          actor: actorFrom(req).sub,
          actor_name: actorFrom(req).name,
          repo_id,
          source_ip: req.ip,
          description:
            'Applied frontmatter autocorrect — ' +
            ((result.changes && result.changes.length) || 0) +
            ' change(s) across the repository',
          details: { changes: result.changes, warnings: result.warnings }
        })
        .catch(() => {
          /* best-effort */
        });
    }
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 (David, 2026-08-31) — GET /api/okf/repos/:repo_id/logs.
 * The repository's action/audit log (okf_audit_logs, linked by repo_id):
 * every state transition and every modification with the user, date/time,
 * action and a human-readable description. Read scope; newest first.
 */
async function getRepoLogs(req, res, next) {
  try {
    const { repo_id } = req.params;
    // getById pre-gate (404 foreign, anti-enumeration — mirrors getRepoManifest).
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const logs = await auditService.listRepoLogs(repo_id, { limit: req.query.limit });
    res.status(200).json({ repo_id, logs });
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 lifecycle (David, 2026-08-28) — apply ONE lifecycle transition.
 * Body: { action: 'submit'|'approve'|'publish'|'ingest'|'retract' }.
 * publish = mint (the real gates) + bundle-zip export + lifecycle flip;
 * ingest/retract set/clear the serving version. 409 on invalid transitions.
 */
async function transitionLifecycle(req, res, next) {
  try {
    const { repo_id } = req.params;
    const body = validate(lifecycleSchema, req.body || {});
    const { action, frontmatter } = body;
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const result = await lifecycleService.transition(repo_id, action, actorFrom(req), {
      payload: frontmatter ? { frontmatter } : {}
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 (David, 2026-08-28) — EXPORT a repo as a zip bundle (download).
 * Works in ANY lifecycle state (the on-the-fly zip is built from the current
 * concept set; the PUBLISHED artifact zip is a separate doc-repo file). Read
 * scope; response is the zip stream with a repo+version-named file.
 */
async function exportRepoZip(req, res, next) {
  try {
    const repo = await repoService.getById(req.params.repo_id, { authz: authzForService(req) });
    const { buffer } = await bundleExportService.buildBundleZip(repo.repo_id);
    const fileName = bundleExportService.bundleFileName(repo, repo.version || 0);
    // AUDIT (David, 2026-08-31: every repository action is traceable) — an
    // export hands the full content to the caller; it belongs in the log.
    auditService
      .writeAudit({
        action: 'repo.export',
        actor: actorFrom(req).sub,
        actor_name: actorFrom(req).name,
        repo_id: repo.repo_id,
        source_ip: req.ip,
        description: 'Exported the repository as bundle "' + fileName + '"'
      })
      .catch(() => {
        /* best-effort */
      });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

/**
 * Story #978 (David, 2026-08-30) — steward PII acknowledgement. Body:
 * { acknowledge: true|false }. Records the review on the registry (pii_ack)
 * + audit; the publish mint then waives the PII 'hit' gate (errors still
 * block). This is the sanctioned valve for PUBLIC entities — a government
 * services directory is SUPPOSED to carry contact details.
 */
async function acknowledgePii(req, res, next) {
  try {
    const { repo_id } = req.params;
    const { acknowledge } = validate(piiAckSchema, req.body || {});
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const result = await piiService.acknowledgePii(repo_id, acknowledge !== false, actorFrom(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/okf/repos/:repo_id/metrics (David's wizard-idempotency directive,
 * 2026-09-04): the aggregate block the dashboard popups and the wizard
 * render. Combines the conformance metrics (concept_count, conformance/
 * stale/link/pii counters), the index-status breakdown (parsed/indexed/
 * failed/rejected — all PRE-INGEST state is normal; nothing is chunked
 * before the lifecycle ingest) and the repo-level mirrors (lifecycle_state,
 * conversion, rag_ingestion). Read scope; getById pre-gate (404 foreign).
 */
async function getRepoMetrics(req, res, next) {
  try {
    const { repo_id } = req.params;
    const repo = await repoService.getById(repo_id, { authz: authzForService(req) });
    const [conformance, parsed, indexed, failed, rejected] = await Promise.all([
      conformanceService.getRepoMetrics(repo_id),
      conceptMetaService.countByIndexStatus(repo_id, 'parsed'),
      conceptMetaService.countByIndexStatus(repo_id, 'indexed'),
      conceptMetaService.countByIndexStatus(repo_id, 'failed'),
      conceptMetaService.countByIndexStatus(repo_id, 'rejected')
    ]);
    res.status(200).json({
      repo_id,
      lifecycle_state: repo.lifecycle_state || null,
      version: repo.version || null,
      conversion: repo.conversion || null,
      rag_drain_active: repo.rag_drain_active === true,
      rag_ingestion: repo.rag_ingestion || null,
      indexing: { parsed, indexed, failed, rejected },
      ...conformance
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Story 1-8 (2026-10-08) — POST /api/okf/repos/:repo_id/head/rebuild.
 * Re-runs buildVectorizedHead from the CURRENT stored frontmatter.
 * Fixes a missing head (publish is warn-only on a TEI outage) or a
 * stale one (frontmatter edited after publish). Admin-scoped.
 */
const rebuildRepoHead = call(async (req) => {
  const head = await headTestService.rebuildHead(req.params.repo_id, adminOpts(req));
  return { ok: true, repo_id: req.params.repo_id, head };
});
/**
 * Story 1-8 (2026-10-08) — POST /api/okf/repos/:repo_id/routing-test.
 * The Testing Lab: embeds the query with production
 * fidelity (TEI + BGE query-instruction prefix), scores the head leg
 * (works PRE-INGEST — graph-less repos compete on signalling), and
 * replays the Story 1.3 chunk-probe routing for repos with graphs.
 * Admin-scoped (LLM/TEI-burning surface).
 */
const routingTest = call((req) => headTestService.routingTest(req.params.repo_id, req.body || {}, adminOpts(req)));
/**
 * Story 1-8d — POST /api/okf/repos/:repo_id/routing-advisor.
 * The comprehensive advisor: aggregates the queries of the last N runs
 * (all classes), simulates candidate tag-set configurations against the
 * production gate, and recommends the globally-optimal add/remove set
 * under a hard zero-positive-harm constraint. Admin-scoped (LLM call).
 *
 * 2026-10-20 — ASYNC (202 + poll): with a thinking model configured the
 * advisor takes minutes (embed every query, simulate, an LLM call that
 * climbs the adaptive ladder) and the synchronous POST died at the
 * gateway while the server kept working. Same shape as the run/explain
 * endpoints: 202 {job_key, status:'running'}, poll
 * GET /routing-advisor/jobs/:job_key.
 */
const recommendTagSet = call(
  async (req) => {
    const started = await headSuiteService.beginRecommendTagSet(req.params.repo_id, req.body || {}, adminOpts(req));
    return { repo_id: req.params.repo_id, job_key: started.job_key, status: 'running' };
  },
  { status: 202 }
);
/**
 * 2026-10-20 — GET /api/okf/repos/:repo_id/routing-advisor/jobs/:job_key.
 * The async advisor's poll: {status:'running'} | {status:'failed', error}
 * | the finished advice in `payload`.
 */
const recommendJob = call((req) => headSuiteService.getRecommendJob(req.params.repo_id, req.params.job_key));
/**
 * Story 1-8d — GET /api/okf/repos/:repo_id/frontmatter/history.
 * Bounded save history for the Lab's Revert-tags panel (read scope).
 */
const frontmatterHistory = call((req) => repoService.frontmatterHistory(req.params.repo_id, readOpts(req)));
/**
 * Story 1-8d — POST /api/okf/repos/:repo_id/frontmatter/revert  {saved_at}.
 * Restores the frontmatter shape snapshotted at saved_at. Goes back
 * through update(), so the revert itself is snapshotted. Admin-scoped.
 */
const revertFrontmatter = call(async (req) => {
  const savedAt = req.body && typeof req.body.saved_at === 'string' ? req.body.saved_at : '';
  if (!savedAt) {
    const err = new Error('saved_at is required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  return repoService.revertFrontmatter(req.params.repo_id, savedAt, actorFrom(req));
});
/**
 * Story 10.5 — GET /api/okf/repos/:repo_id/draft.
 * The wizard's resumable curation state. Read scope (inherited from the
 * okf-routes router gate). `draft:null` means "repo exists, no draft yet" —
 * NEVER a 404, so the resume UI can tell that apart from a missing endpoint
 * (whose 404 it already maps to NOT_READY).
 */
const getStudioDraft = call((req) => studioDraftService.getDraft(req.params.repo_id, readOpts(req)));
/**
 * Story 10.5 — PUT /api/okf/repos/:repo_id/draft.
 * Upserts the flat wire draft (the store passes its whole draft object
 * through unchanged). Admin-scoped. Deliberately does NOT touch
 * okf_repositories.studio_step — that pointer keeps exactly one writer (the
 * audited, lifecycle-guarded PATCH /:repo_id), so this route never doubles the
 * audit rows directive G4 removed from the wizard.
 */
const putStudioDraft = call((req) => studioDraftService.saveDraft(req.params.repo_id, req.body || {}, adminOpts(req)));
/**
 * Story 10.5 — DELETE /api/okf/repos/:repo_id/draft.
 * Idempotent 200 (`deleted:false` when there was nothing to remove) so the
 * frontend's `catch -> {ok:true}` stays correct. Admin-scoped.
 */
const deleteStudioDraft = call((req) => studioDraftService.clearDraft(req.params.repo_id, adminOpts(req)));
/**
 * Story 1-8c — POST /api/okf/repos/:repo_id/routing-explain.
 * Explains one query's gate outcome; when it (wrongly) CLAIMS, proposes
 * forbidden tags that would exclude it. Admin-scoped — may burn one LLM
 * call for the suggestion.
 */
const routingExplain = call((req) =>
  headTestService.explainRouting(req.params.repo_id, req.body || {}, adminOpts(req))
);
/**
 * Story 1-8 MR-B (2026-10-08) — POST /api/okf/repos/:repo_id/routing-testsuite.
 * Generates a test suite: ONE guided-JSON vLLM call (positives +
 * confusable-sibling negatives + keywords) plus deterministic
 * forbidden-derived negatives. Persists a suite doc. Admin-scoped —
 * LLM-burning (5-15s).
 */
const generateTestSuite = call(
  async (req) => {
    const { suite_key, done } = await headSuiteService.beginSuiteGeneration(
      req.params.repo_id,
      req.body || {},
      adminOpts(req)
    );
    done.catch(() => {}); // the service logs; the poll surfaces the timeout
    return { suite_key, status: 'generating' };
  },
  { status: 202 }
);
/**
 * Story 1-8 MR-B — POST /repos/:repo_id/routing-testsuite/:suite_key/queries.
 * Curator free-text additions to an existing suite (kind positive|negative).
 * Admin-scoped.
 */
const addTestSuiteQueries = call((req) =>
  headSuiteService.addQueries(req.params.repo_id, req.params.suite_key, req.body || {}, adminOpts(req))
);
// Story 1-8f — load ONE saved suite (full rows) back into the Lab, and
// edit its rows in place (kind flips + removes; adds stay on /queries).
// Read scope for the load, admin for the edit — same split as the
// runs listing vs the suite mutations.
const getTestSuite = call((req) => headSuiteService.getSuite(req.params.repo_id, req.params.suite_key, readOpts(req)));
const updateTestSuiteRows = call((req) =>
  headSuiteService.updateSuiteRows(req.params.repo_id, req.params.suite_key, req.body || {}, adminOpts(req))
);
// Story 1-8f — name/rename a suite (the Saved-suites table renders it).
const renameTestSuite = call((req) =>
  headSuiteService.renameSuite(req.params.repo_id, req.params.suite_key, req.body || {}, adminOpts(req))
);
// 1-8g — DELETE the suite + its run docs (the curator's list cleanup).
const deleteTestSuite = call((req) =>
  headSuiteService.deleteSuite(req.params.repo_id, req.params.suite_key, adminOpts(req))
);
// 1-8g — the click-test: one query against the LIVE corpus (embed → top-K
// from the repo's SOURCE → the pipeline's TEI rerank → coverage verdict),
// persisted on the matching suite rows.
const probeTestSuiteQuery = call((req) =>
  headSuiteService.probeSuiteQuery(req.params.repo_id, req.params.suite_key, req.body || {}, adminOpts(req))
);
/**
 * Story 1-8 MR-B — POST /repos/:repo_id/routing-testsuite/:suite_key/run.
 * Executes every suite query through the routing test, aggregates
 * pass rates / margins / steals, persists a run doc. Admin-scoped
 * (one TEI embed per query).
 */
const runTestSuite = call(
  async (req) => {
    // 1-8g: the corpus probe leg defaults ON (Run All fills the Corpus
    // column); scripts can opt out with {"probe": false}.
    const { run_key, done } = await headSuiteService.beginRunSuite(req.params.repo_id, req.params.suite_key, {
      ...adminOpts(req),
      probe: !(req.body && req.body.probe === false)
    });
    done.catch(() => {}); // the service logs + records the failure doc
    return { run_key, status: 'running' };
  },
  { status: 202 }
);
/**
 * 1-8g-v — GET /repos/:repo_id/routing-testsuite/:suite_key/runs/:run_key.
 * The async run's poll: {status:'running'} keep-waiting, {status:'failed',
 * error}, or the full run doc. Read scope. Also the UI's load-one-run path
 * (a timed-out run's results were invisible even though persisted).
 */
const getTestSuiteRun = call((req) =>
  headSuiteService.getRunSuite(req.params.repo_id, req.params.suite_key, req.params.run_key, readOpts(req))
);
/**
 * Story 1-8c — POST /api/okf/repos/:repo_id/routing-testsuite/:suite_key/explain.
 * BATCH advice for the latest run of the suite: every failing negative in
 * one pass, consolidated suggested forbidden tags. Admin-scoped.
 *
 * 1-8g-y: now ASYNC — 202 + poll, like the run endpoint. Explain fans out
 * over the shared remote GPU node (one embed per failing negative in
 * guardSuggestions, plus the LLM pass), so the synchronous version outran
 * the gateway: the curator saw a spinner, no local GPU activity (the work
 * is not local), and then a 504 — with the advice never reaching the UI.
 * The placeholder doc carries status:'running'; the poll endpoint answers
 * running / failed / the finished advice.
 */
const explainTestSuiteFailures = call(
  async (req) => {
    const { run_key, done } = await headSuiteService.beginExplainFailures(
      req.params.repo_id,
      req.params.suite_key,
      adminOpts(req)
    );
    done.catch(() => {}); // the service logs + records the failure doc
    return { run_key, status: 'running' };
  },
  { status: 202 }
);
/**
 * 1-8g-y — GET /repos/:repo_id/routing-testsuite/:suite_key/explain/:run_key.
 * The async explain's poll: {status:'running'} keep waiting, {status:'failed',
 * error}, or the finished advice in payload. Read scope (same as the runs
 * listing and the load-one-run path).
 */
const getExplainFailures = call((req) =>
  headSuiteService.getExplainFailures(req.params.repo_id, req.params.suite_key, req.params.run_key)
);
/**
 * Story 1-8 MR-B — GET /repos/:repo_id/routing-testsuite/runs?limit&kind.
 * Analytics history: runs (default) or suites or both — newest first,
 * summary metrics only (the full per-query payload stays in the docs).
 * Read scope.
 */
const listTestSuiteRuns = call(async (req) => ({
  runs: await headSuiteService.listRuns(req.params.repo_id, req.query || {})
}));
// ---------- Story 8-6 — RAGAS benchmark suites (ADR-okf-043) --------------
// Thin wrappers over ragas-suite-service, mirroring the head-suite shapes:
// 202+poll for the three async jobs (generate / run / explain), 200 JSON
// for reads, xlsx bytes for the interchange routes. Sidecar absence maps
// to 503 RAGAS_UNAVAILABLE (the service owns that mapping).

const generateRagasSuite = call(
  async (req) => {
    const { suite_key, done } = await ragasSuiteService.beginSuiteGeneration(
      req.params.repo_id,
      req.body || {},
      adminOpts(req)
    );
    done.catch(() => {});
    return { suite_key, status: 'generating' };
  },
  { status: 202 }
);
const getRagasSuite = call((req) => ragasSuiteService.getSuite(req.params.repo_id, req.params.suite_key));
const cancelRagasSuiteGeneration = call((req) => ragasSuiteService.cancelSuiteGeneration(req.params.repo_id));
const cancelRagasSuiteRun = call((req) =>
  ragasSuiteService.cancelSuiteRun(req.params.repo_id, req.params.suite_key, req.params.run_key)
);
const updateRagasSuiteRows = call((req) =>
  ragasSuiteService.updateSuiteRows(req.params.repo_id, req.params.suite_key, req.body || {}, adminOpts(req))
);
const addRagasSuiteQueries = call(async (req) => {
  const { suite, added, duplicates_dropped } = await ragasSuiteService.addQueries(
    req.params.repo_id,
    req.params.suite_key,
    req.body || {},
    adminOpts(req)
  );
  return { suite, added, duplicates_dropped };
});
const renameRagasSuite = call((req) =>
  ragasSuiteService.renameSuite(req.params.repo_id, req.params.suite_key, req.body || {}, adminOpts(req))
);
const deleteRagasSuite = call((req) => ragasSuiteService.deleteSuite(req.params.repo_id, req.params.suite_key));
const deleteRagasSuiteRun = call((req) =>
  ragasSuiteService.deleteRun(req.params.repo_id, req.params.suite_key, req.params.run_key)
);
/** Re-score a finished run with a different judge (David 2026-10-24). The
 * answers are reused verbatim; a NEW run doc carries the new scores and
 * names its judge. 202 + poll, like the other long operations. */
const rescoreRagasSuiteRun = call(
  async (req) => {
    const out = await ragasSuiteService.rescoreRun(
      req.params.repo_id,
      req.params.suite_key,
      req.params.run_key,
      req.body || {},
      { actor: actorFrom(req) }
    );
    out.done.catch(() => {});
    return { run_key: out.run_key, source_run_key: out.source_run_key, status: out.status };
  },
  { status: 202 }
);
const runRagasSuite = call(
  async (req) => {
    const { run_key, done } = await ragasSuiteService.beginRunSuite(
      req.params.repo_id,
      req.params.suite_key,
      req.body || {},
      adminOpts(req)
    );
    done.catch(() => {});
    return { run_key, status: 'running' };
  },
  { status: 202 }
);
const getRagasSuiteRun = call((req) =>
  ragasSuiteService.getRunSuite(req.params.repo_id, req.params.suite_key, req.params.run_key)
);
const listRagasSuiteRuns = call(async (req) => ({
  runs: await ragasSuiteService.listRuns(req.params.repo_id, req.query || {})
}));
const explainRagasFailures = call(
  async (req) => {
    const { run_key, explain_key, done } = await ragasSuiteService.beginExplainFailures(
      req.params.repo_id,
      req.params.suite_key,
      req.body || {},
      adminOpts(req)
    );
    done.catch(() => {});
    return { run_key, explain_key, status: 'running' };
  },
  { status: 202 }
);
const getRagasExplainFailures = call((req) =>
  ragasSuiteService.getExplainFailures(req.params.repo_id, req.params.suite_key, req.params.run_key)
);
const probeRagasEntry = call((req) =>
  ragasSuiteService.probeEntry(req.params.repo_id, req.params.suite_key, req.body || {}, adminOpts(req))
);
async function exportRagasSuiteXlsx(req, res, next) {
  try {
    const { body, filename } = await ragasSuiteService.exportSuiteXlsx(req.params.repo_id, req.params.suite_key);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(body);
  } catch (err) {
    next(err);
  }
}

async function importRagasSuiteXlsx(req, res, next) {
  try {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!bytes.length) {
      const err = new Error('empty upload — expected the suite xlsx as the request body');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      return next(err);
    }
    const suite = await ragasSuiteService.importSuiteXlsx(req.params.repo_id, bytes, {
      authz: authzForService(req),
      actor: actorFrom(req)
    });
    res.status(201).json(suite);
  } catch (err) {
    next(err);
  }
}

async function exportRagasResultsXlsx(req, res, next) {
  try {
    const { body, filename } = await ragasSuiteService.exportResultsXlsx(req.params.repo_id, req.body || {});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(body);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRepo,
  convertFromCrawl,
  cloneRepo,
  listRepos,
  getRepo,
  getRepoMetrics,
  updateRepo,
  deleteRepo,
  rebuildRepoHead,
  routingTest,
  routingExplain,
  frontmatterHistory,
  revertFrontmatter,
  getStudioDraft,
  putStudioDraft,
  deleteStudioDraft,
  recommendTagSet,
  recommendJob,
  generateTestSuite,
  addTestSuiteQueries,
  getTestSuite,
  getTestSuiteRun,
  updateTestSuiteRows,
  renameTestSuite,
  deleteTestSuite,
  probeTestSuiteQuery,
  runTestSuite,
  explainTestSuiteFailures,
  getExplainFailures,
  listTestSuiteRuns,
  generateRagasSuite,
  getRagasSuite,
  cancelRagasSuiteGeneration,
  cancelRagasSuiteRun,
  updateRagasSuiteRows,
  addRagasSuiteQueries,
  renameRagasSuite,
  deleteRagasSuite,
  deleteRagasSuiteRun,
  rescoreRagasSuiteRun,
  runRagasSuite,
  getRagasSuiteRun,
  listRagasSuiteRuns,
  explainRagasFailures,
  getRagasExplainFailures,
  probeRagasEntry,
  exportRagasSuiteXlsx,
  importRagasSuiteXlsx,
  exportRagasResultsXlsx,
  piiScan,
  getPiiConceptScan,
  importRepoConcepts,
  retiredIngestRoute,
  getRepoValidation,
  startTopicLinks,
  getTopicLinks,
  wireRepoCitations,
  suggestConceptLinks,
  acceptConceptLink,
  listConcepts,
  getConcept,
  inspectPii,
  remediatePii,
  acceptPii,
  fileActionPii,
  repoBulkPii,
  redactWholeFilePii,
  deleteConcept,
  mintRepoVersion,
  listRepoVersions,
  getRepoVersion,
  getRepoManifest,
  getRepoLinks,
  convertFromDocuments,
  discoverFromManifests,
  patchConcept,
  resplitRepo,
  reingestFailed,
  autocorrectRepo,
  transitionLifecycle,
  exportRepoZip,
  getRepoLogs,
  acknowledgePii,
  ValidationError
};
