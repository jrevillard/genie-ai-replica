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
const { createSchema, updateSchema, cloneSchema } = require('../validators/repository-validator');

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
 */
function callerAuthz(req) {
  if (req.okfIsSuperAdmin) return { isSuperAdmin: true, authorizedRepoIds: null };
  const scopes = Array.isArray(req.okfScopes) ? req.okfScopes : [];
  const repos = new Set();
  let wildcard = false;
  for (const scope of scopes) {
    const parts = scope.split(':');
    // STRICT (2026-08-16 review fix): a scope is only a grant when its LEVEL
    // is grammar-valid — `okf:t1:*:write` (typo level) must NOT become a
    // wildcard, and `okf:t1:repoB:write` must not enter the read set.
    if (parts.length !== 4 || parts[0] !== 'okf') continue;
    if (parts[3] !== 'read' && parts[3] !== 'admin') continue;
    if (parts[2] === '*') wildcard = true;
    else if (parts[2]) repos.add(parts[2]);
  }
  if (wildcard) return { isSuperAdmin: true, authorizedRepoIds: null };
  return { isSuperAdmin: false, authorizedRepoIds: repos };
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
    const repo = await repoService.create(input, actorFrom(req));
    res.status(201).json(repo);
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
 * Story 2.9.1 — trigger the write-side ingest sequence (ADR-021 4a–4f).
 * Body mirrors pii-scan's shapes: explicit concepts[] (the 2.9.5 unzip and
 * the 7.2 producer call the service directly), file_ids[], or discover:true —
 * plus optional hierarchy labels (appended AFTER the orchestrator's ACL set).
 * Gate order: requireRepoScope (route) → getById existence+authz (404 foreign,
 * anti-enumeration) → orchestrate → 202 with the summary.
 */
async function ingestRepo(req, res, next) {
  try {
    const { repo_id } = req.params;
    const body = req.body || {};
    const { concepts, file_ids, discover, labels, zip, bundle_name } = body;
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
    await repoService.getById(repo_id, { authz: authzForService(req) });
    const summary = await ingestService.ingestRepoConcepts(
      repo_id,
      { concepts, file_ids, discover, labels, zip, bundle_name },
      actorFrom(req)
    );
    res.status(202).json({ success: true, ...summary });
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
    await repoService.getById(repo_id, { authz: authzForService(req) });

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

module.exports = {
  createRepo,
  cloneRepo,
  listRepos,
  getRepo,
  updateRepo,
  deleteRepo,
  piiScan,
  ingestRepo,
  mintRepoVersion,
  listRepoVersions,
  getRepoVersion,
  getRepoManifest,
  discoverFromManifests,
  ValidationError
};
