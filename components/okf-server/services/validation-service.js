// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * services/validation-service.js
 *
 * Step-7 VALIDATION REPORT (David, 2026-10-02 — issues #1030 + #1036): the
 * wizard's Validate step must LIST every issue with concept, severity and the
 * remedy process — never a percentage. One service composes the unified issue
 * list from four check families:
 *
 *   conformance   — the per-concept frontmatter issues conformance-service
 *                   already persists on the meta row (MISSING_TYPE,
 *                   BAD_ACTOR_PREFIX, ...), mapped to severity + remedy.
 *   orphan        — zero links out AND zero links in on the AUTHOR graph
 *                   (okf_concepts_meta.links[] — the markdown-link projection,
 *                   the same graph the editor renders). A real-content orphan
 *                   is unreachable by graph retrieval; the remedy is link
 *                   suggestions (llm-curation.proposeLinks) or manual edits.
 *   near_duplicate— near-identical bodies (same-length window + shingle
 *                   Jaccard ≥ 0.9). Near-copies dilute retrieval; remedy is
 *                   keep-one-delete-the-rest.
 *   citation      — pages carrying frontmatter citations (sources[]) that are
 *                   not yet linked to the repo's Sources hub page. David's
 *                   rule: wherever a document is cited it must be LINKED, so
 *                   the citation rides into the OKF repo and the ArangoDB
 *                   graph at ingest. The hub does not need to exist in the
 *                   bundle — wireCitationHub generates it from the union of
 *                   the citing pages' own metadata.
 *
 * All checks are read-only; the only mutations live in wireCitationHub
 * (hub creation through the SAME import pipeline — born right) and the
 * frontmatter links[] appends (patchConceptFields — the channel that
 * survives every body save and feeds both projections).
 */

const { withSpan } = require('../shared-lib/tracing');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');

const norm = (id) => String(id || '').replace(/^concepts\//, '');

/** Blocker codes (conformance-service vocabulary) — everything else warns. */
const BLOCKER_CODES = new Set(['MISSING_TYPE', 'BAD_ACTOR_PREFIX']);

const REMEDIES = {
  conformance: 'Run Autocorrect (Step 8) — it fixes frontmatter issues automatically — or edit the page in the editor.',
  orphan: 'Accept link suggestions for this page, or add links to related pages in the editor.',
  near_duplicate: 'Keep one copy and delete the others, or rewrite them so each carries distinct content.',
  citation:
    'Create (or link to) the Sources page so every citing page links to it — the links then reach the graph at ingest.'
};

/** Pure orphan computation over meta rows. Returns the set of orphan ids. */
function findOrphans(rows) {
  const out = new Map();
  const inc = new Map();
  for (const r of rows) {
    const id = norm(r.concept_id);
    let deg = 0;
    for (const l of Array.isArray(r.links) ? r.links : []) {
      const t = norm(l && l.to_concept_id);
      if (!t || t === id) continue;
      deg += 1;
      inc.set(t, (inc.get(t) || 0) + 1);
    }
    out.set(id, deg);
  }
  return rows.map((r) => norm(r.concept_id)).filter((id) => (out.get(id) || 0) === 0 && !inc.has(id));
}

/** Char 8-gram shingles of normalized text — cheap near-dup fingerprint. */
function shingles(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const set = new Set();
  for (let i = 0; i + 8 <= s.length; i += 1) set.add(s.slice(i, i + 8));
  return set;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const v of small) if (big.has(v)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const DUP_MIN_BODY = 400; // too short to judge similarity meaningfully
const DUP_SIM = 0.9;
const DUP_MAX_COMPARISONS = 20000; // runaway guard for pathological repos

/**
 * Pure near-duplicate grouping: bodies within a 5% length window (sorted
 * slide, break when the window exits) with shingle Jaccard ≥ 0.9 union-find
 * into groups. Returns [[id, id, ...], ...] with only multi-member groups.
 */
function findNearDuplicateGroups(rows) {
  const cand = rows
    .filter((r) => (r.body_len || 0) >= DUP_MIN_BODY)
    .map((r) => ({ id: norm(r.concept_id), len: r.body_len, sh: shingles(r.body_head) }))
    .sort((a, b) => a.len - b.len);
  const parent = new Map(cand.map((c) => [c.id, c.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  let comparisons = 0;
  for (let i = 0; i < cand.length; i += 1) {
    for (let j = i + 1; j < cand.length; j += 1) {
      if (cand[j].len - cand[i].len > Math.max(cand[i].len, cand[j].len) * 0.05) break;
      if (comparisons >= DUP_MAX_COMPARISONS) {
        logger.warn('validation near-dup scan hit the comparison cap — results may be partial', {
          comparisons
        });
        break;
      }
      comparisons += 1;
      if (cand[i].sh.size && jaccard(cand[i].sh, cand[j].sh) >= DUP_SIM) {
        const ra = find(cand[i].id);
        const rb = find(cand[j].id);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }
  const groups = new Map();
  for (const c of cand) {
    const root = find(c.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c.id);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Citation state: which pages carry frontmatter sources[], and which existing
 * concept is the repo's Sources hub (id or title match — e.g. 'who-sources',
 * 'Sources', 'References'). Pure.
 */
function citationState(rows) {
  const citing = rows
    .map((r) => norm(r.concept_id))
    .filter((id, i) => Array.isArray(rows[i].sources) && rows[i].sources.length > 0);
  const hub =
    rows.find((r) => /^(sources|citations|references)([-._].*)?$/i.test(norm(r.concept_id))) ||
    rows.find((r) => !r.is_index && /citation|reference|sources/i.test(String(r.title || ''))) ||
    null;
  const hubId = hub ? norm(hub.concept_id) : null;
  const needingLink = hubId
    ? citing.filter(
        (id) =>
          id !== hubId &&
          !(
            Array.isArray((rows.find((r) => norm(r.concept_id) === id) || {}).links) &&
            (rows.find((r) => norm(r.concept_id) === id).links || []).some((l) => norm(l && l.to_concept_id) === hubId)
          )
      )
    : citing;
  return { citing, hub_concept_id: hubId, needing_link: needingLink };
}

/**
 * Compose the unified issue list (pure — the DB wrapper feeds it rows).
 * Row shape: { concept_id, title, is_index, links, issues, sources,
 *              body_head, body_len }.
 */
function computeReport(rows) {
  const issues = [];
  const titleOf = (r) => (r && (r.title || norm(r.concept_id))) || '';

  // 1. Per-concept conformance issues (already persisted on the meta row).
  for (const r of rows) {
    for (const iss of Array.isArray(r.issues) ? r.issues : []) {
      const code = (iss && (iss.code || iss.rule)) || 'CONFORMANCE';
      issues.push({
        type: 'conformance',
        severity: BLOCKER_CODES.has(code) ? 'blocker' : 'warning',
        concept_id: norm(r.concept_id),
        title: titleOf(r),
        code,
        message: (iss && (iss.message || iss.detail)) || code,
        remedy: REMEDIES.conformance
      });
    }
  }

  // 2. Orphans (author graph — in AND out both zero).
  for (const id of findOrphans(rows)) {
    const r = rows.find((x) => norm(x.concept_id) === id) || {};
    issues.push({
      type: 'orphan',
      severity: 'warning',
      concept_id: id,
      title: titleOf(r),
      message:
        'No page links to this concept and it links to no other page — graph retrieval cannot relate it to the rest of the repository.',
      remedy: REMEDIES.orphan
    });
  }

  // 3. Near-duplicate groups (one issue per group).
  for (const members of findNearDuplicateGroups(rows)) {
    issues.push({
      type: 'near_duplicate',
      severity: 'warning',
      concept_id: null,
      title: `${members.length} near-identical pages`,
      members,
      message: `${members.length} pages carry near-identical content — retrieval returns the same material for each instead of distinct answers.`,
      remedy: REMEDIES.near_duplicate
    });
  }

  // 4. Citations not yet linked to a Sources hub (one repo-level issue).
  const cit = citationState(rows);
  if (cit.citing.length > 0 && (cit.needing_link || []).length > 0) {
    issues.push({
      type: 'citation',
      severity: 'warning',
      concept_id: null,
      title: cit.hub_concept_id ? 'Citations not linked to the Sources page' : 'Citations have no Sources page',
      message:
        `${cit.needing_link.length} page(s) cite documents but do not link to the Sources page` +
        (cit.hub_concept_id ? ` (${cit.hub_concept_id})` : ' — none exists yet') +
        '. Citations only reach the graph when they are links.',
      remedy: REMEDIES.citation,
      citing_count: cit.citing.length,
      hub_concept_id: cit.hub_concept_id
    });
  }

  return {
    issues,
    citations: cit,
    summary: {
      total: issues.length,
      blockers: issues.filter((i) => i.severity === 'blocker').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      orphans: issues.filter((i) => i.type === 'orphan').length,
      near_duplicate_groups: issues.filter((i) => i.type === 'near_duplicate').length
    }
  };
}

/** One meta query feeds every check. Body is bounded to a 24K head — enough
 * for the shingle fingerprint, cheap even on big bundles. */
async function loadRows(repo_id) {
  const db = await dbService.getConnection('default');
  return (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status != "rejected" SORT m.concept_id ' +
        'RETURN { concept_id: m.concept_id, title: m.title, is_index: m.is_index == true, links: m.links, ' +
        'issues: m.conformance_issues, sources: m.frontmatter.sources, body_head: SUBSTRING(m.body, 0, 24000), ' +
        'body_len: LENGTH(m.body) }',
      { r: repo_id }
    )
  ).all();
}

/** GET /repos/:repo_id/validation — the Step-7 issue list. */
async function getValidationReport(repo_id) {
  return withSpan('okf.validation.report', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const rows = await loadRows(repo_id);
    span.setAttribute('okf.concepts', rows.length);
    const report = computeReport(rows);
    logger.info('OKF validation report', {
      repo_id,
      concepts: rows.length,
      issues: report.summary.total,
      blockers: report.summary.blockers
    });
    return { repo_id, generated_at: new Date().toISOString(), ...report };
  });
}

/**
 * POST /repos/:repo_id/citations/wire — David's citation rule (#1036): every
 * citing page must LINK to the Sources hub. Creates the hub when the bundle
 * has none (generated from the union of the citing pages' own sources —
 * through the SAME import pipeline, so it is born right and indexed), then
 * appends a frontmatter links[] entry on every citing page that lacks one
 * (patchConceptFields — the channel that survives body edits and feeds both
 * the editor projection and the ingest graph).
 * @returns {Promise<{hub_concept_id, hub_created, wired, already_linked}>}
 */
async function wireCitationHub(repo_id, { hub_concept_id, actor } = {}) {
  return withSpan('okf.validation.citations.wire', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const repositoryService = require('./repository-service');
    const repo = await repositoryService.getById(repo_id);
    const frozen = !!(repo.ingested_at || repo.lifecycle_state === 'publish');
    if (frozen) {
      const err = new Error('Repository is serving — retract before restructuring citations');
      err.code = 'CONTENT_FROZEN';
      err.status = 409;
      throw err;
    }

    const db = await dbService.getConnection('default');
    const rows = await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status != "rejected" SORT m.concept_id ' +
          'RETURN { concept_id: m.concept_id, title: m.title, links: m.links, sources: m.frontmatter.sources, ' +
          'fm_links: m.frontmatter.links }',
        { r: repo_id }
      )
    ).all();

    const cit = citationState(rows);
    let hubId = hub_concept_id ? norm(hub_concept_id) : cit.hub_concept_id;
    let hubCreated = false;

    if (!hubId) {
      // Generate the hub from the union of the citing pages' sources.
      const byId = new Map();
      for (const r of rows) {
        for (const s of Array.isArray(r.sources) ? r.sources : []) {
          if (!s) continue;
          const key = s.id || s.resource || s.title;
          if (!key || byId.has(key)) continue;
          byId.set(key, s);
        }
      }
      const lines = [...byId.values()].map((s) => `- **${s.title || s.id}**${s.resource ? ` — ${s.resource}` : ''}`);
      const body =
        '# Sources\n\nCitations used across this repository.\n\n' +
        (lines.join('\n') || '_No citations recorded._') +
        '\n';
      const ingestService = require('./ingest-service');
      const summary = await ingestService.ingestRepoConcepts(
        repo_id,
        {
          concepts: [
            {
              concept_id: 'sources',
              path: 'sources.md',
              title: 'Sources',
              frontmatter: { title: 'Sources', type: 'source' },
              body
            }
          ],
          skipCuration: true
        },
        actor
      );
      hubId = 'sources';
      hubCreated = true;
      span.setAttribute('okf.citations.hub_created', true);
      logger.info('OKF citation hub created', { repo_id, summary: summary && summary.summary });
    }

    // Wire: every citing page (except the hub itself) without a hub link
    // gets one — a frontmatter links[] append through the field-scoped patch.
    const conceptMeta = require('./concept-meta-service');
    let wired = 0;
    let alreadyLinked = 0;
    for (const r of rows) {
      const id = norm(r.concept_id);
      if (id === hubId) continue;
      const hasSources = Array.isArray(r.sources) && r.sources.length > 0;
      if (!hasSources) continue;
      const links = Array.isArray(r.links) ? r.links : [];
      if (links.some((l) => norm(l && l.to_concept_id) === hubId)) {
        alreadyLinked += 1;
        continue;
      }
      const fmLinks = Array.isArray(r.fm_links) ? r.fm_links : [];
      await conceptMeta.patchConceptFields(repo_id, id, {
        frontmatterPatch: { links: [...fmLinks, { target: `${hubId}.md`, label: 'Sources' }] }
      });
      wired += 1;
    }
    span.setAttribute('okf.citations.wired', wired);
    logger.info('OKF citations wired to hub', {
      repo_id,
      hub: hubId,
      hub_created: hubCreated,
      wired,
      already_linked: alreadyLinked
    });
    return { hub_concept_id: hubId, hub_created: hubCreated, wired, already_linked: alreadyLinked };
  });
}

module.exports = {
  getValidationReport,
  wireCitationHub,
  // pure, exported for tests
  computeReport,
  findOrphans,
  findNearDuplicateGroups,
  citationState
};
