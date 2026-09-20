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
const authzResolverService = require('../services/authz-resolver-service');
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

/** Extract the acting principal + request IP for audit/metadata. */
function actorFrom(req) {
  const u = req.user || {};
  return { sub: u.sub, name: u.name || u.preferred_username, source_ip: req.ip };
}

/**
 * Default-deny authorization context (Story 6.1 — replaces the no-op
 * okf_domain seam). Derived from req.okfScopes (set by middleware/auth.js):
 * `okf:{tenant}:{repo}:{level}` → the caller's authorized repo set. Wildcard
 * scopes and the tools-admin bootstrap super-role ⇒ isSuperAdmin (unrestricted).
 * A caller with no okf scopes gets an EMPTY set — list returns nothing, and
 * getById 404s every repo (G3 closed).
 *
 * Story 6.1b: the implementation moved to authz-resolver-service (single scope
 * authority shared with the read-side graph-set resolver) — delegated here,
 * byte-identical semantics.
 */
function callerAuthz(req) {
  return authzResolverService.deriveScopeAuthz(req.okfScopes, req.okfIsSuperAdmin);
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
    const repoDomain = body.domain || 'general';
    // TYPE INFERENCE contract (coordinator, 2026-09-05): 'classification' —
    // unknown/absent = heuristics (coerced, never a 400).
    const classification =
      body.classification !== undefined ? typeInference.resolveStrategy(body.classification).strategy : undefined;
    // BORN-RIGHT SLUG (David's subject-area ruling, 2026-09-04): domains are
    // now Knowledge-Hierarchy display text ("Water Supply") — the scope
    // segment must be its SLUG (lowercase [a-z0-9-]), or the string cannot
    // survive JWT scope transport (whitespace-split) or the 4-part scope
    // grammar. Single-sourced with the bundle/graph slug. The stored domain
    // stays display text.
    const acl = { required_scopes: [`okf:t:${bundleExportService.slugFor(repoDomain)}:admin`] };
    const baseName = typeof body.name === 'string' && body.name ? body.name : 'crawled-repository';
    let repo = null;
    for (let attempt = 1; attempt <= 10 && !repo; attempt++) {
      const candidate = attempt === 1 ? baseName : `${baseName}-${attempt}`;
      try {
        repo = await repoService.create({ name: candidate, domain: repoDomain, acl }, actor, {});
      } catch (err) {
        if (!(err && err.code === 'DUPLICATE_REPO')) throw err;
      }
    }
    if (!repo) {
      return res.status(409).json({
        error: 'DUPLICATE_REPO',
        message: `Repository name "${baseName}" (and suffixed variants) already exists in domain "${repoDomain}"`
      });
    }
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
    res.status(202).json({ ...repo, name_adjusted: repo.name !== baseName });
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
    const repoDomain = body.domain || 'general';
    const classification =
      body.classification !== undefined ? typeInference.resolveStrategy(body.classification).strategy : undefined;
    const acl = { required_scopes: [`okf:t:${bundleExportService.slugFor(repoDomain)}:admin`] };
    const baseName = typeof body.name === 'string' && body.name ? body.name : 'imported-repository';
    let repo = null;
    for (let attempt = 1; attempt <= 10 && !repo; attempt++) {
      const candidate = attempt === 1 ? baseName : `${baseName}-${attempt}`;
      try {
        repo = await repoService.create({ name: candidate, domain: repoDomain, acl }, actor, {});
      } catch (err) {
        if (!(err && err.code === 'DUPLICATE_REPO')) throw err;
      }
    }
    if (!repo) {
      return res.status(409).json({
        error: 'DUPLICATE_REPO',
        message: `Repository name "${baseName}" (and suffixed variants) already exists in domain "${repoDomain}"`
      });
    }
    await producerService.startDocumentsConversion({
      repo_id: repo.repo_id,
      file_ids: fileIds,
      requested_name: body.name || null,
      classification,
      actor
    });
    res.status(202).json({ ...repo, name_adjusted: repo.name !== baseName });
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
 * Story 2.8 — PII scan. Two modes (AC 9):
 *  - {concepts: [{concept_id, frontmatter, body}]} — explicit (2.9.1/7.2 call
 *    the service directly in production; the endpoint exists for steward use).
 *  - {file_ids: [...]} or {discover: true} — scan the repo's uploaded
 *    plain-.md files (found via the okf_repo_id stamp from Story 2.5).
 * On success with file input, records the FR-3 ingest version.
 */
async function piiScan(req, res, next) {
  try {
    const { repo_id } = req.params;
    const { concepts, file_ids, discover } = req.body || {};

    // Repo-existence + authorization gate (mirrors every other mutating route) —
    // fail BEFORE writing any meta docs (code-review fix #7). A repo outside
    // the caller's scopes 404s identically to a missing one (Story 6.1).
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    // DRAIN FREEZE (David, 2026-09-12): the scan OVERWRITES pii_state on
    // every concept row — a GDPR re-scan mid-ingest races the drain snapshot
    // and would flag/unflag content under a version being indexed. Frozen
    // with everything else (the panel's read-only inspect stays available).
    assertWritable(repoDoc);

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
      throw new ValidationError(['body must contain concepts[], file_ids[], or discover:true']);
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
    const repoDoc = await repoService.getById(repo_id, { authz: authzForService(req) });
    assertWritable(repoDoc);
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
      const llmCuration = require('../services/llm-curation-service');
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
    const { action } = validate(lifecycleSchema, req.body || {});
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const result = await lifecycleService.transition(repo_id, action, actorFrom(req));
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

module.exports = {
  createRepo,
  convertFromCrawl,
  cloneRepo,
  listRepos,
  getRepo,
  getRepoMetrics,
  updateRepo,
  deleteRepo,
  piiScan,
  importRepoConcepts,
  retiredIngestRoute,
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
  autocorrectRepo,
  transitionLifecycle,
  exportRepoZip,
  getRepoLogs,
  acknowledgePii,
  ValidationError
};
