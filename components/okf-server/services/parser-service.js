// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF concept parser — a PURE, stateless transform. NO database I/O (does not
// import db-connection-service), NO HTTP route. The caller (Story 2.5 ingest /
// 2.4 conformance / 4.1 CRUD) persists the result to okf_concepts_meta; the
// physical _LINKS_TO edge write is also the caller's job.
//
// parseConcept(markdown, ctx) → { concept_id, frontmatter, body, links, families }
// Implements OKF v0.2 families (ADR-okf-017) + legacy fallbacks, trust_tier
// derivation, and structural link extraction (FR-6, FR-7). Broken links tolerated.
// MELT-instrumented (withSpan + shared logger + okf_parse_operations_total counter).

const matter = require('gray-matter');
const MarkdownIt = require('markdown-it');
const { DateTime } = require('luxon');

const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');

const md = new MarkdownIt();

// MELT — OKF parse operations counter (no-op when observability is off).
const meter = getMeter();
const opsCounter = meter.createCounter('okf_parse_operations_total', {
  description: 'OKF concept parsing operations'
});
function recordOp(status) {
  try {
    opsCounter.add(1, { operation: 'parse', status });
  } catch {
    /* meter is a no-op when observability is disabled — ignore */
  }
}

class ParseError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Derive trust_tier from the `verified` list (ADR-okf-017 §3).
 *   unverified      — no/empty verified
 *   machine-confirmed — all `by` actors are non-`human:`
 *   human-reviewed    — any `by` actor starts with `human:`
 * Defensive: a bare-object `verified` is normalized to an array; an entry
 * missing `by` is treated as non-`human:` so it can't falsely promote.
 */
function deriveTrustTier(verified) {
  const list = Array.isArray(verified) ? verified : verified ? [verified] : [];
  if (list.length === 0) return 'unverified';
  const anyHuman = list.some((entry) => String((entry && entry.by) || '').startsWith('human:'));
  return anyHuman ? 'human-reviewed' : 'machine-confirmed';
}

/**
 * Normalize a concept path / link target to a concept_id: POSIX separators,
 * strip leading `/` and `./`, strip the `.md` suffix (PRD glossary).
 */
function conceptIdFromPath(p) {
  if (!p) return undefined;
  let s = String(p).replace(/\\/g, '/'); // force POSIX
  // strip leading slashes and ./ segments (loop to handle combinations like .//foo)
  let changed = true;
  while (changed) {
    changed = false;
    if (s.startsWith('/')) {
      s = s.replace(/^\/+/, '');
      changed = true;
    }
    if (s.startsWith('./')) {
      s = s.slice(2);
      changed = true;
    }
  }
  if (s.toLowerCase().endsWith('.md')) s = s.slice(0, -3);
  // Concept ids are BASENAMES (zip intake strips folder prefixes — 2026-08-30):
  // a link target like "concepts/service-directory.md" or "kenya-okf/index.md"
  // must resolve to "service-directory" / "index", or the author link points
  // at a concept id that does not exist (live-caught: the Kenya Government
  // Services index's links carried a concepts/ prefix and its graph edges
  // dead-ended). Folder structure in a link target is presentation.
  s = s.split('/').pop() || s;
  return s || undefined;
}

/**
 * Legacy fallback (ADR-okf-017 §2): parse a body `# Citations` list into the
 * `sources` provenance family. Each list item → { resource: <text> }.
 */
function extractCitationsFromBody(body) {
  const lines = String(body || '').split('\n');
  let inCitations = false;
  const sources = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#\s+citations\s*$/i.test(trimmed)) {
      inCitations = true;
      continue;
    }
    if (!inCitations) continue;
    if (/^#+\s+/.test(trimmed)) break; // next heading ends the section
    const m = trimmed.match(/^[-*+]\s+(.+)$/);
    if (m) sources.push({ resource: m[1].trim() });
  }
  return sources;
}

/**
 * Wiki-style body links (David's link-resolution spec, 2026-09-05):
 * `[[entities/google_services.md|Google Inc.]]` → { to_concept_id, label }.
 * Used BOTH for body text and for frontmatter relation strings.
 */
function extractWikiLinks(text) {
  const out = [];
  const re = /\[\[([^\]|]+?\.md)(?:\|([^\]]*))?\]\]/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out.push({ to_concept_id: conceptIdFromPath(m[1]), label: (m[2] || '').trim() });
  }
  return out;
}

/**
 * Extract structural concept→concept links from the markdown body (FR-7).
 * Walks markdown-it `link_open` tokens ONLY (image tokens excluded). For each
 * link whose target ends in `.md`, emits { to_concept_id, label }. Broken
 * targets are emitted as-is (no existence check — the parser has no DB).
 * SELF-REFERENCES ARE DROPPED (David's link-resolution spec, 2026-09-05:
 * 444/999 wikipedia concepts carried useless self-loops — wiki pages link to
 * themselves constantly). Wiki-style [[target.md|label]] links are parsed
 * with the same contract. Emits one edge per occurrence (no dedup —
 * conformance counts per-occurrence).
 * @param {string} body
 * @param {string} [ownId] this concept's own id — links to it are dropped
 */
function extractLinks(body, ownId) {
  const links = [];
  const collectLabel = (toks, i) => {
    let label = '';
    for (; i < toks.length; i += 1) {
      const t = toks[i];
      if (t.type === 'link_close') return label;
      if (t.type === 'text' || t.type === 'code_inline') label += t.content;
      if (t.children && t.children.length) label += collectLabel(t.children, 0);
    }
    return label;
  };
  const getHref = (token) => {
    if (!token.attrs) return null;
    const found = token.attrs.find((a) => a[0] === 'href');
    return found ? found[1] : null;
  };
  const push = (toConceptId, label) => {
    if (toConceptId && toConceptId !== ownId) links.push({ to_concept_id: toConceptId, label });
  };
  const walk = (toks) => {
    for (let i = 0; i < toks.length; i += 1) {
      const t = toks[i];
      if (t.type === 'link_open') {
        const href = getHref(t);
        if (href && href.toLowerCase().endsWith('.md')) {
          push(conceptIdFromPath(href), collectLabel(toks, i + 1));
        }
      }
      if (t.children && t.children.length) walk(t.children);
    }
  };
  walk(md.parse(String(body || ''), {}));
  for (const wl of extractWikiLinks(body)) push(wl.to_concept_id, wl.label);
  return links;
}

// js-yaml coerces ISO timestamps to Date objects; normalize them back to the
// spec'd string forms (ISO-8601 for generated/verified, YYYY-MM-DD for stale_after).
const toIso = (v) => (v instanceof Date ? DateTime.fromJSDate(v).toUTC().toISO() : v);
const toDateOnly = (v) => (v instanceof Date ? DateTime.fromJSDate(v).toUTC().toISODate() : v);

/**
 * Normalize frontmatter into the v0.2 families with legacy fallbacks.
 * Preserves the FULL frontmatter object (unknown keys kept — ADR-okf-017 §6/§7).
 */
function normalizeFrontmatter(frontmatter, body) {
  const fm = frontmatter || {};

  // generated — v0.2 {by, at}; legacy fallback: frontmatter `timestamp` → generated.at
  let generated = fm.generated;
  if (generated && generated.at !== undefined) {
    generated = { ...generated, at: toIso(generated.at) };
  }
  if (!generated && fm.timestamp !== undefined) {
    generated = { at: toIso(fm.timestamp) };
  }

  // verified — normalize to array; normalize .at dates
  let verified = fm.verified;
  if (verified === null) verified = undefined; // null = explicit "no verifications" → unverified
  if (verified !== undefined && !Array.isArray(verified)) verified = [verified];
  if (Array.isArray(verified)) {
    verified = verified.map((e) => (e && e.at !== undefined ? { ...e, at: toIso(e.at) } : e));
  }

  // sources — v0.2 array; legacy fallback: body `# Citations` list
  let sources = fm.sources;
  if (sources === undefined) {
    const cited = extractCitationsFromBody(body);
    if (cited.length) sources = cited;
  }
  if (sources !== undefined && !Array.isArray(sources)) sources = [sources];

  return {
    generated,
    verified,
    status: fm.status,
    stale_after: toDateOnly(fm.stale_after),
    sources,
    trust_tier: deriveTrustTier(verified)
  };
}

/**
 * Parse one OKF concept markdown file into metadata + body + links.
 * @param {string} markdown - raw concept .md content (frontmatter + body)
 * @param {object} ctx - { repo_id, path, bundle_version }
 * @returns {Promise<object>} parsed concept: { concept_id, repo_id, path,
 *   bundle_version, frontmatter, body, generated, verified, trust_tier, status,
 *   stale_after, sources, links }
 */
async function parseConcept(markdown, ctx = {}) {
  return withSpan('okf.parse.concept', async (span) => {
    span.setAttribute('okf.operation', 'parse');
    if (ctx.repo_id) span.setAttribute('okf.repo_id', ctx.repo_id);
    logger.info('Parsing OKF concept', { repo_id: ctx.repo_id, path: ctx.path });

    let parsed;
    try {
      parsed = matter(String(markdown || ''));
    } catch (err) {
      recordOp('error');
      logger.error('OKF parse failed (malformed frontmatter)', { path: ctx.path, error: err.message });
      throw new ParseError('PARSE_ERROR', `Malformed frontmatter: ${err.message}`, 400);
    }

    const body = parsed.content;
    const families = normalizeFrontmatter(parsed.data, body);
    const concept_id = conceptIdFromPath(ctx.path);
    if (concept_id) span.setAttribute('okf.concept_id', concept_id);

    // LINK RESOLUTION (David's spec, 2026-09-05): the author graph composes
    // from THREE sources, all self-filtered (rule 2) — body .md hyperlinks
    // (FR-7), wiki-style [[target.md|label]] links, and the frontmatter's OWN
    // links[] + relations entries (the converter writes the resolved crawl
    // cross-links into frontmatter so stewards can curate them in markdown).
    let links = [];
    try {
      links = extractLinks(body, concept_id);
      // frontmatter links[] — shapes tolerated: {target: './x.md', label?} |
      // {to_concept_id} | './x.md'. A target ending .md resolves via
      // conceptIdFromPath (folder prefixes are presentation).
      const fmLinks = Array.isArray(parsed.data && parsed.data.links) ? parsed.data.links : [];
      for (const fl of fmLinks) {
        if (!fl) continue;
        const target = typeof fl === 'string' ? fl : fl.target || (fl.to_concept_id ? fl.to_concept_id + '.md' : null);
        if (typeof target !== 'string' || !target.toLowerCase().endsWith('.md')) continue;
        const cid = conceptIdFromPath(target);
        if (cid && cid !== concept_id)
          links.push({ to_concept_id: cid, label: (typeof fl === 'object' && (fl.label || fl.anchor)) || '' });
      }
      // frontmatter relations — { relation_type: ['[[x.md|label]]', ...] }.
      const rel = parsed.data && parsed.data.relations;
      if (rel && typeof rel === 'object') {
        for (const [relation, value] of Object.entries(rel)) {
          const entries = Array.isArray(value) ? value : [value];
          for (const entry of entries) {
            if (typeof entry !== 'string') continue;
            for (const wl of extractWikiLinks(entry)) {
              if (wl.to_concept_id && wl.to_concept_id !== concept_id) {
                links.push({ to_concept_id: wl.to_concept_id, label: wl.label || relation });
              }
            }
          }
        }
      }
    } catch (err) {
      // Broken/malformed links are tolerated (FR-7); never fatal.
      logger.warn('OKF link extraction failed (non-fatal)', { path: ctx.path, error: err.message });
    }
    span.setAttribute('okf.link_count', links.length);

    recordOp('success');
    logger.info('OKF concept parsed', {
      repo_id: ctx.repo_id,
      concept_id,
      trust_tier: families.trust_tier,
      links: links.length
    });

    return {
      concept_id,
      repo_id: ctx.repo_id,
      path: ctx.path,
      bundle_version: ctx.bundle_version,
      frontmatter: parsed.data,
      body,
      generated: families.generated,
      verified: families.verified,
      trust_tier: families.trust_tier,
      status: families.status,
      stale_after: families.stale_after,
      sources: families.sources,
      links
    };
  });
}

module.exports = {
  parseConcept,
  ParseError,
  // exported for unit testing
  deriveTrustTier,
  conceptIdFromPath,
  extractLinks,
  extractWikiLinks,
  extractCitationsFromBody,
  normalizeFrontmatter
};
