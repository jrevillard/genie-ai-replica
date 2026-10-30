/**
 * services/llm-curation-service.js
 *
 * OKF import-time curation engine — Stage-1 fix D-B (issue #980) and the
 * autocorrect PROPOSE endpoint (D-L, issue #990). David's acceptance bar:
 * LLM-assisted must be far more accurate and complete than heuristics —
 * a real KH-L2 label auto-assigned per concept (bounded to the repo's
 * Subject Area), a proper type, and a description — slower is acceptable,
 * progress must be visible, and every decision must be logged
 * (spans + INFO decisions + OKF_CONVERSION_DEBUG transcripts).
 *
 * Contract:
 *   classification 'heuristics' -> zero LLM calls (labels stay a visible gap).
 *   classification 'llm'        -> LLM classifies type (TAXONOMY ALWAYS:
 *                                  clobbered), labels, describes every concept.
 *   classification 'hybrid'     -> heuristics type kept; LLM reviews only
 *                                  absent/'topic' placeholder types; LLM
 *                                  labels + describes everything.
 *   Fail-soft: any LLM failure degrades that concept to heuristics with
 *   curation.resolved_by='llm-error' — import NEVER blocks on the LLM.
 *   Bounded labels: a proposed label must be in the Subject Area's L2 list
 *   (or 'no_label') — the LLM can never invent knowledge-hierarchy entries.
 *
 * KH source of truth: `serviceCategories` (L1, nameEN) + `services`
 * (L2, categoryId). The repo's Subject Area is its `domain`, matched to L1
 * by slugified nameEN (verified live: domain 'Indonesia' -> L1 'Indonesia'
 * -> services History/Culture/Politics/...).
 */

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const modelCache = require('./vllm-model-cache');
const { withSpan } = require('../shared-lib/tracing');

// Shared vocabulary (okf-vocabulary). CONTENT_TYPES only: this is what the
// model may CHOOSE, so the reserved root type is deliberately not offered.
const TYPE_ENUM = require('./okf-vocabulary').CONTENT_TYPES;
const NO_LABEL = 'no_label';
const DEFAULT_LANES = 4;
const CURATION_TIMEOUT_MS = parseInt(process.env.OKF_CURATION_TIMEOUT_MS, 10) || 30000;
const BODY_SNIPPET_CHARS = 1200;

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function debugEnabled() {
  return process.env.OKF_CONVERSION_DEBUG === '1';
}

/** Resolve the repo's Subject Area to its KH L1 + bounded L2 label list. */
async function resolveAreaContext(domain) {
  const db = await dbService.getConnection('default');
  const cats = await (await db.query('FOR c IN serviceCategories RETURN {key: c._key, name: c.nameEN}')).all();
  const hit = cats.find((c) => slugify(c.name) === slugify(domain));
  if (!hit) return null;
  const svcs = await (
    await db.query('FOR s IN services FILTER s.categoryId == @k SORT s.nameEN RETURN s.nameEN', {
      k: hit.key
    })
  ).all();
  return { key: hit.key, nameEN: hit.name, labels: svcs };
}

/** vLLM chat call — mirrors runLlmSummary's endpoint/bearer normalization
 * (concept-meta-service) with strict-JSON output and curation-sized limits.
 * 8-7 model configs: an ACTIVE configuration checked for 'okf_curation'
 * (openai-wire provider only — this client speaks chat/completions) takes
 * precedence over env. Resolution failure falls back to env silently: a
 * model-config outage must never break curation.
 *
 * Model-agnostic adaptivity (David 2026-10-20: "work within reason for any
 * selected model"): override-routed calls ask for thinking-disabled and a
 * starved answer gets one budget-raised retry — see
 * services/adaptive-llm-call.js. Curation's 300-token budget was sized for
 * non-reasoning models; a reasoning model gets room instead of an empty
 * JSON 502. */
async function callVllm(messages, { timeoutMs = CURATION_TIMEOUT_MS } = {}) {
  const t0 = Date.now();
  // The opt-in gate: compose ships VLLM_ENDPOINT empty (the OKF LLM legs
  // stay off until a deployment names the endpoint).
  let rawBase = modelCache.optedInVllmBase();
  let model = null; // resolved below — explicit pick > pin > discovery (!631)
  // Both key spellings — the chat call and the probe must agree on the
  // credential (a probe that authenticates while the chat call does not
  // fails with a bare 401).
  let apiKey = modelCache.deploymentKey();
  let viaOverride = false;
  let configIsDeployment = false;
  try {
    const ovr = await require('./model-config-service').resolveModelOverride({ service: 'okf_curation' });
    if (ovr && ovr.provider === 'openai') {
      rawBase = ovr.base_url;
      if (ovr.model) model = ovr.model;
      // The named-config base carries ITS key — or, when the config points
      // at the deployment endpoint itself, the deployment credential. A
      // third-party base gets neither: the GPU bearer must never leave the
      // deployment endpoint (probe AND chat call).
      apiKey = modelCache.credentialForBase(rawBase, ovr.api_key);
      viaOverride = true;
      // A config pointing at the DEPLOYMENT endpoint resolves like the
      // deployment path (the pin applies — it exists for endpoints whose
      // /v1/models is unreachable); any other base resolves its own served
      // model.
      configIsDeployment = modelCache.sameOrigin(rawBase, modelCache.deploymentVllmBase());
    }
  } catch {
    /* env fallback — see docblock */
  }
  // No endpoint at all = the deliberate opt-out (compose ships it empty).
  if (!rawBase) throw new Error('llm-not-configured');
  // Model-id resolution, !631 policy (services/vllm-model-cache.js): a
  // named-config base resolves its OWN served model; the deployment path
  // is pin -> /v1/models discovery -> loud ModelDiscoveryError (#1181).
  // Resolution inside the call budget (the helper keeps what is left for
  // the chat call — never less than a usable minimum).
  let chatTimeoutMs = timeoutMs;
  if (!model) {
    const resolved =
      viaOverride && !configIsDeployment
        ? await modelCache.resolveForeignModel({ baseUrl: rawBase, apiKey, budgetMs: timeoutMs })
        : await modelCache.resolveDeploymentModel({ baseUrl: rawBase, apiKey, budgetMs: timeoutMs });
    model = resolved.model;
    chatTimeoutMs = resolved.remainingMs;
  }
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = { model, messages, temperature: 0.0, max_tokens: 300, response_format: { type: 'json_object' } };
  const r = await require('./adaptive-llm-call').adaptiveChatCompletion({
    // Shared URL rule (services/llm-url.js): a versioned base (…/v1,
    // …/paas/v4) takes /chat/completions directly; a bare host gets /v1.
    url: require('./llm-url').openAiChatUrl(rawBase),
    headers,
    body,
    timeoutMs: chatTimeoutMs,
    disableThinking: viaOverride
  });
  // DEBUG (David, 2026-09-08 "prove the LLM ran"): every call logs its
  // target, latency and token usage when OKF_CONVERSION_DEBUG=1.
  if (debugEnabled()) {
    logger.info(
      '[ llm-curation ] vLLM call OK ' +
        (r.data?.usage?.total_tokens != null ? 'tokens=' + r.data.usage.total_tokens + ' ' : '') +
        'in ' +
        (Date.now() - t0) +
        'ms model=' +
        model
    );
  }
  return (r.data?.choices?.[0]?.message?.content || '').trim();
}

function buildCurationPrompt(concept, areaLabels) {
  const system =
    'You are a knowledge-base curator. Answer with STRICT JSON only: ' +
    '{"type": one of ' +
    JSON.stringify(TYPE_ENUM) +
    ', ' +
    '"label": one of ' +
    JSON.stringify(areaLabels.concat([NO_LABEL])) +
    ', ' +
    '"summary": "one or two factual sentences describing this entry"}. ' +
    'The label MUST come from the provided list (use "' +
    NO_LABEL +
    '" if none fits) — ' +
    "never invent labels. The type is the entry's fundamental nature.";
  const user =
    'Title: ' +
    (concept.title || concept.concept_id) +
    '\n' +
    'Content:\n' +
    String(concept.body || '').slice(0, BODY_SNIPPET_CHARS);
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
}

/** Parse + validate a curation response. Returns the SAFE subset only —
 * anything outside the bounded lists is dropped (bounded-growth rule). */
function parseCurationResponse(raw, areaLabels) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  const type = TYPE_ENUM.includes(j.type) ? j.type : null;
  const label = areaLabels.includes(j.label) ? j.label : null;
  const summary = typeof j.summary === 'string' && j.summary.trim() ? j.summary.trim() : null;
  const proposedOutsideList = Boolean(j.label) && label === null;
  return { ok: true, type, label, summary, proposedOutsideList };
}

/** Lane-bounded worker pool. Never more than `lanes` concurrent LLM calls. */
async function runPool(items, lanes, worker) {
  let next = 0;
  const n = Math.max(1, Math.min(lanes, items.length));
  const runners = Array.from({ length: n }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Import-time curation pass over every parsed concept of a repo.
 *
 * THE COUNTER CONTRACT (server ⇄ UI). `repo.curation` (patched by
 * ingest-service.runImportCuration from these payloads) draws the Studio
 * "Curating" bar, so numerator and denominator MUST describe the SAME
 * population:
 *   total   = the CURATABLE population — every parsed, non-rejected row EXCEPT
 *             the structural index root, which no work set ever curates. The
 *             index row used to sit in the denominator while being filtered
 *             out of the work, so `curated === total` was unreachable BY
 *             CONSTRUCTION (see the throttle workaround in ingest-service.js,
 *             live: "done=996 of 998", 2026-09-09).
 *   curated = how many concepts CARRY LABELS right now — seeded from ground
 *             truth BEFORE the pass, then incremented once per concept this
 *             pass actually persists a label for. It answers the curator's
 *             only question ("how many of my concepts are labelled?"), not
 *             "how many did this pass touch?" — concepts labelled by ANY
 *             route count: the FR-42 tabular import path (labels assigned at
 *             CREATION time, commit 419c01885), a prior pass, an earlier
 *             import, the LLM, or a keyword match.
 *   done    = an ALIAS of `curated`, kept because the UI reads
 *             `curation.done || curation.curated`; the pass-local work-item
 *             count that used to live under `done` shadowed the honest
 *             number on every llm/hybrid tick.
 * Pass-local quality counters (labeled / described / typed / fallbacks) keep
 * their meaning: "of the concepts THIS pass touched, how many got X".
 *
 * Properties this shape guarantees: one population on both sides; a reachable
 * terminal state; monotonic growth within a pass (the terminal write takes the
 * database count with Math.max, so a concurrent writer can only raise it); no
 * per-tick corpus scan (the seed is free — the rows are already loaded — and
 * the single authoritative query runs at the FINAL tick only).
 * @returns {Promise<{method, total, curated, pre_labelled, labeled, described, typed, fallbacks}>}
 * Caller wires onProgress into the repo progress payload (BuildProgressCard).
 */
/** Deterministic keyword labeler (David's heuristics ruling, 2026-09-08):
 * match the concept's own words against the Subject Area's KH L2 service
 * names — zero LLM, fully reproducible. Distinctive tokens only (no
 * stopwords/short words); the label with the most token hits wins, ties go
 * to the first. No hit → no label (an honest gap, visible in the counters). */
function keywordLabelFor(meta, areaLabels) {
  const STOP = new Set([
    'the',
    'and',
    'of',
    'for',
    'with',
    'from',
    'service',
    'services',
    'general',
    'other',
    'management',
    'information'
  ]);
  const text = (
    (meta.title || '') +
    '\n' +
    (meta.summary || '') +
    '\n' +
    String(meta.body || '').slice(0, 4000)
  ).toLowerCase();
  const tokens = new Set(String(text).match(/[a-z]{4,}/g) || []);
  let best = null;
  let bestHits = 0;
  for (const label of areaLabels) {
    const words =
      String(label)
        .toLowerCase()
        .match(/[a-z]{4,}/g) || [];
    let hits = 0;
    for (const w of words) {
      if (!STOP.has(w) && tokens.has(w)) hits += 1;
      else if (!STOP.has(w) && w.length >= 6) {
        // prefix hit for inflections (financ*/govern*/entit* — plural, -ing, -ion)
        for (const t of tokens) {
          if (t.startsWith(w.slice(0, 5))) {
            hits += 1;
            break;
          }
        }
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = label;
      }
    }
  }
  return bestHits > 0 ? best : null;
}

/** Does this concept row already carry at least one label? The one predicate
 * that decides both the work set and the seed count — a concept that answers
 * true is ALREADY labelled, by whichever route got it there. */
function hasLabels(meta) {
  return Array.isArray(meta.labels) && meta.labels.length > 0;
}

/** ONE authoritative count of labelled CURATABLE concepts for a repo, computed
 * in the database (COLLECT WITH COUNT — no documents crossing the wire). Runs
 * once per pass, at the terminal write: the mid-pass numbers are seeded and
 * incremented from ground truth already in hand, so no tick needs a re-scan. */
const LABELLED_COUNT_AQL =
  'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status != "rejected" ' +
  'FILTER !m.is_index && IS_ARRAY(m.labels) && LENGTH(m.labels) > 0 ' +
  'COLLECT WITH COUNT INTO labelled RETURN labelled';

async function countLabelledConcepts(db, repoId) {
  const res = await (await db.query(LABELLED_COUNT_AQL, { r: repoId })).all();
  const n = Array.isArray(res) && res[0] && res[0].labelled != null ? Number(res[0].labelled) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function curateRepoConcepts(repo, { classification, lanes, onProgress } = {}) {
  const mode = classification === 'llm' || classification === 'hybrid' ? classification : 'heuristics';
  const stats = {
    method: mode,
    total: 0,
    curated: 0,
    pre_labelled: 0,
    labeled: 0,
    described: 0,
    typed: 0,
    fallbacks: 0
  };
  const db = await dbService.getConnection('default');
  const rows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status != "rejected" SORT m.concept_id RETURN m',
      { r: repo.repo_id }
    )
  ).all();
  // Denominator = the curatable population (the index root is excluded — see
  // the counter contract above). Numerator = seeded from ground truth, so the
  // FIRST tick already answers "how many of my concepts are labelled?" instead
  // of "how many has this pass got to?" — free, the rows are already loaded.
  const curatable = rows.filter((m) => !m.is_index);
  stats.total = curatable.length;
  stats.pre_labelled = curatable.filter(hasLabels).length;
  stats.curated = stats.pre_labelled;

  /** One progress tick. `done` rides along as an alias of `curated` (see the
   * counter contract) so no consumer can read a pass-local count. */
  const emit = (extra) => {
    if (onProgress) onProgress({ ...stats, done: stats.curated, ...extra });
  };

  /** The TERMINAL write: reconcile the counter against the database once, then
   * emit unthrottled (`final: true` is what ingest-service's throttle lets
   * through). Math.max keeps the sequence monotonic — a concurrent writer, a
   * retry or a partial apply can only lift the number, never walk it back —
   * and the Math.min keeps it inside the population the bar divides by. */
  const finish = async () => {
    try {
      const labelled = await countLabelledConcepts(db, repo.repo_id);
      stats.curated = Math.max(stats.curated, Math.min(stats.total, labelled));
    } catch (e) {
      logger.warn(
        'OKF curation: final labelled reconcile failed — reporting the pass count ' +
          '(repo=' +
          repo.repo_id +
          '): ' +
          e.message
      );
    }
    emit({ final: true });
  };

  const area = await resolveAreaContext(repo.domain);
  const areaLabels = area ? area.labels : [];
  const areaOk = Boolean(area) && areaLabels.length > 0;
  if (mode === 'heuristics') {
    // HEURISTICS LABELS (David's ruling, 2026-09-08): keyword-match the
    // Subject Area's KH L2 services — deterministic, zero-LLM, reproducible;
    // no match stays an honest visible gap. Rows already carrying labels
    // (authorial) are never touched.
    if (rows.length === 0 || !areaOk) {
      if (!areaOk) {
        logger.warn(
          'OKF heuristics labeling: no KH L2 labels for the Subject Area — skipped (repo=' + repo.repo_id + ')'
        );
      }
      // An early return is a TERMINAL state, not a stalled pass: it emits
      // `final` (an untagged write was throttled away as "still running") and
      // it reports the seeded count, so a repo whose concepts were ALL labelled
      // by the tabular import path or a prior pass shows its real total instead
      // of a misleading 0.
      await finish();
      return stats;
    }
    // Authorial / pre-existing labels are never overwritten by a keyword match,
    // so those rows are out of the work set — they are already IN the numerator
    // via the seed, which is exactly why the two must share the same predicate.
    const work = curatable.filter((m) => !hasLabels(m));
    emit(); // baseline tick: the curator sees the starting position immediately
    await runPool(work, parseInt(process.env.OKF_CURATION_LANES, 10) || lanes || DEFAULT_LANES, async (meta) => {
      const label = keywordLabelFor(meta, areaLabels);
      if (label) {
        try {
          await applyDecision(
            db,
            repo,
            meta,
            { label, summary: null, type: null, typeApplied: false, resolved_by: 'keyword-match' },
            mode
          );
          stats.labeled += 1;
          // Only a PERSISTED label joins the numerator. A concept the keyword
          // matcher could not place stays an honest gap — a concept with no
          // label must never be counted as labelled.
          stats.curated += 1;
        } catch (e) {
          logger.warn('OKF heuristics labeling: apply failed for ' + meta.concept_id + ': ' + e.message);
        }
      }
      emit();
    });
    logger.info(
      'OKF heuristics labeling complete: total=' +
        stats.total +
        ' labeled=' +
        stats.labeled +
        ' pre_labelled=' +
        stats.pre_labelled +
        ' (repo=' +
        repo.repo_id +
        ' area=' +
        (area ? area.nameEN : 'none') +
        ')'
    );
    await finish(); // bypasses the caller's throttle
    return stats;
  }
  if (!areaOk) {
    logger.warn(
      'OKF curation: repo Subject Area has no KH L2 labels — labeling skipped as a visible gap' +
        ' (repo=' +
        repo.repo_id +
        ' domain=' +
        JSON.stringify(repo.domain) +
        ')'
    );
  }

  // llm/hybrid label EVERY curatable concept (an authorial label is re-verified
  // against the taxonomy, not preserved) — so the work set is the whole
  // denominator. Concepts that arrive already labelled are still in it, but
  // they are already in the numerator via the seed, which is why the
  // increment below only fires for a concept that gains a label.
  const work = curatable;
  const laneCount = parseInt(process.env.OKF_CURATION_LANES, 10) || lanes || DEFAULT_LANES;
  const passT0 = Date.now();

  emit(); // baseline tick: the curator sees the starting position immediately

  await withSpan('okf.llm.curation', async (span) => {
    span.setAttribute('okf.repo_id', repo.repo_id);
    span.setAttribute('okf.curation.mode', mode);
    span.setAttribute('okf.curation.concepts', work.length);
    span.setAttribute('okf.curation.lanes', laneCount);
    span.setAttribute('okf.curation.area', area ? area.nameEN : 'none');
    span.setAttribute('okf.curation.pre_labelled', stats.pre_labelled);

    await runPool(work, laneCount, async (meta) => {
      const t0 = Date.now();
      // Snapshot BEFORE the decision: a pre-labelled concept stays counted even
      // if this pass's verdict carries no label (applyDecision never clears
      // labels — a no_label verdict leaves the authorial label in place).
      const hadLabels = hasLabels(meta);
      const decision = await curateOne(meta, { mode, areaLabels, areaOk });
      if (debugEnabled()) {
        logger.info(
          '[ llm-curation ] ' +
            meta.concept_id +
            ' → label=' +
            (decision.label || NO_LABEL) +
            ' described=' +
            (decision.summary ? 'yes' : 'no') +
            ' type=' +
            (decision.typeApplied ? decision.type : 'authorial-kept') +
            ' resolved_by=' +
            decision.resolved_by +
            ' in ' +
            (Date.now() - t0) +
            'ms'
        );
      }
      let applied = true;
      try {
        await applyDecision(db, repo, meta, decision, mode);
      } catch (e) {
        applied = false;
        logger.warn('OKF curation: apply failed for ' + meta.concept_id + ': ' + e.message);
        decision.resolved_by = 'apply-error';
      }
      // The numerator gains a concept only when a label actually LANDED on it.
      // A no_label verdict, an LLM error or a failed apply leaves the concept
      // unlabelled, and counting it would make the bar claim work that is not
      // there. `fallbacks` already surfaces the degraded concepts.
      if (!hadLabels && decision.label && applied) stats.curated += 1;
      if (decision.label) stats.labeled += 1;
      if (decision.summary) stats.described += 1;
      if (decision.typeApplied) stats.typed += 1;
      if (decision.resolved_by === 'llm-error' || decision.resolved_by === 'llm-unparseable') stats.fallbacks += 1;
      emit();
    });
  });

  logger.info(
    'OKF curation complete: method=' +
      mode +
      ' took=' +
      (Date.now() - passT0) +
      'ms total=' +
      stats.total +
      ' labelled=' +
      stats.curated +
      ' (this pass labeled=' +
      stats.labeled +
      ' pre_labelled=' +
      stats.pre_labelled +
      ')' +
      ' described=' +
      stats.described +
      ' typed=' +
      stats.typed +
      ' fallbacks=' +
      stats.fallbacks +
      ' (repo=' +
      repo.repo_id +
      ' area=' +
      (area ? area.nameEN : 'none') +
      ')'
  );
  await finish(); // bypasses the caller's throttle
  return stats;
}

/** Curate a single concept. Pure decision + LLM call; no writes. */
async function curateOne(meta, { mode, areaLabels, areaOk }) {
  const decision = {
    type: null,
    typeApplied: false,
    label: null,
    summary: null,
    method: mode,
    resolved_by: 'llm',
    label_source: 'none'
  };
  if (!areaOk) {
    decision.resolved_by = 'no-subject-area-labels';
    return decision;
  }
  try {
    const { messages } = buildCurationPrompt(meta, areaLabels);
    if (debugEnabled()) {
      logger.debug('[curation:prompt] ' + meta.concept_id + ' :: ' + JSON.stringify(messages));
    }
    const raw = await withSpan('okf.llm.curation.concept', async (span) => {
      span.setAttribute('okf.concept_id', meta.concept_id);
      span.setAttribute('okf.curation.mode', mode);
      return callVllm(messages);
    });
    if (debugEnabled()) {
      logger.debug('[curation:response] ' + meta.concept_id + ' :: ' + String(raw).slice(0, 2000));
    }
    const parsed = parseCurationResponse(raw, areaLabels);
    if (!parsed.ok) {
      decision.resolved_by = 'llm-unparseable';
      return decision;
    }
    // TYPE TAXONOMY (David, 2026-09-08: "type: topic, entity, process, event,
    // source"): EVERY concept carries a taxonomy type — the LLM verdict
    // replaces authorial vocabularies (Subsidiary, FinancialLedger, …).
    // Only the structural 'index' root keeps its type.
    if (parsed.type && mode === 'llm' && meta.type !== 'index') {
      decision.type = parsed.type;
      decision.typeApplied = true;
    }
    // Label: bounded to the area list by parseCurationResponse.
    if (parsed.label) {
      decision.label = parsed.label;
      decision.label_source = 'llm';
    }
    decision.summary = parsed.summary;
    return decision;
  } catch (e) {
    logger.warn('OKF curation: LLM call failed for ' + meta.concept_id + ' — falling back: ' + e.message);
    decision.resolved_by = 'llm-error';
    return decision;
  }
}

/** Persist one decision. Recomposes ingest_labels through the single
 * authority so the drain sees the label (lazy require: ingest-service
 * requires this module for wiring — cycle broken at call time, house style). */
async function applyDecision(db, repo, meta, decision) {
  const { composeIngestLabels } = require('./ingest-service');
  const patch = {
    curation: { method: decision.method, resolved_by: decision.resolved_by, label_source: decision.label_source }
  };
  if (decision.typeApplied) patch.type = decision.type;
  if (decision.summary) patch.summary = decision.summary;
  if (decision.label) {
    patch.labels = [decision.label];
    patch.ingest_labels = composeIngestLabels(repo, [decision.label]);
  }
  await db.collection('okf_concepts_meta').update(meta._key, patch);
}

/**
 * D-L propose — autocorrect PROPOSE for one concept (concept_id) or the whole
 * repo (concept_id null). Returns {before, after, changes[]} with from-empty
 * support: a concept with NO frontmatter yields before={} and after=the full
 * correct frontmatter proposal. Mode-aware per David: heuristics proposes
 * mechanical fixes only; llm/hybrid propose curated type/label/summary too.
 */
// Max concepts for a REPO-WIDE curated (llm/hybrid) propose — each concept is
// one synchronous LLM call. Heuristics (pure planning) is unbounded.
const CURATED_REPO_PROPOSE_CAP = 25;

async function proposeFrontmatter(repo, concept_id, { classification } = {}) {
  const mode = classification === 'llm' || classification === 'hybrid' ? classification : 'heuristics';
  const db = await dbService.getConnection('default');
  // Bind vars MUST match the query text: the repo-wide pass (concept_id null)
  // omits the @c filter, and ArangoDB rejects a query that declares binds the
  // text never uses ("bind parameter 'c' was not declared") — the repo-wide
  // autocorrect proposal 500'd on exactly that (live, 2026-09-12; the unit
  // mocks never execute AQL so they couldn't see it).
  const query = concept_id
    ? 'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id == @c SORT m.concept_id RETURN m'
    : 'FOR m IN okf_concepts_meta FILTER m.repo_id == @r SORT m.concept_id RETURN m';
  const bindVars = concept_id ? { r: repo.repo_id, c: concept_id } : { r: repo.repo_id };
  const rows = await (await db.query(query, bindVars)).all();
  if (concept_id && rows.length === 0) return null;
  // BOUNDED CURATED PROPOSE (David, 2026-09-12: "WTF is going on?" — the
  // gov-uk crawl repo, 997 concepts, llm-classified): a repo-wide curated
  // proposal fires ONE LLM call PER CONCEPT, synchronously — big crawls hold
  // the request until the gateway times out. Heuristics is pure and stays
  // unbounded; curated repo-wide passes beyond the cap are refused with the
  // per-concept remedy instead of hanging.
  if (mode !== 'heuristics' && !concept_id && rows.length > CURATED_REPO_PROPOSE_CAP) {
    const err = new Error(
      `repo-wide ${mode} proposal covers ${rows.length} concepts (cap ${CURATED_REPO_PROPOSE_CAP}) — ` +
        'propose per concept, or use the heuristics mode for mechanical fixes'
    );
    err.code = 'CURATED_PROPOSE_TOO_BROAD';
    err.status = 409;
    throw err;
  }

  const area = mode === 'heuristics' ? null : await resolveAreaContext(repo.domain);
  const areaLabels = area ? area.labels : [];
  const proposals = [];
  for (const meta of rows) {
    const before = meta.frontmatter || {};
    const after = { ...before };
    const changes = [];
    const push = (field, value, reason) => {
      if (value === null || value === undefined) return;
      if (JSON.stringify(before[field]) === JSON.stringify(value)) return;
      after[field] = value;
      changes.push({ field, before: before[field] === undefined ? null : before[field], after: value, reason });
    };
    // Mechanical corrections (always — superset of Story #978).
    if (!after.type) push('type', 'topic', 'MISSING_TYPE');
    if (!after.title) {
      const m = String(meta.body || '').match(/^#{1,2}\s+(.+?)\s*$/m);
      push('title', m ? m[1].trim() : meta.title || meta.concept_id, 'MISSING_TITLE');
    }
    if (!Array.isArray(after.sources)) push('sources', [], 'MISSING_SOURCES');
    // Curated corrections (llm/hybrid — the D-L point: from-empty means the
    // proposal is the WHOLE correct frontmatter, not just placeholders).
    if (mode !== 'heuristics' && areaLabels.length > 0) {
      const decision = await curateOne(meta, { mode, areaLabels, areaOk: true });
      if (decision.type) push('type', decision.type, 'CURATED_TYPE');
      if (decision.label) push('labels', [decision.label], 'CURATED_LABEL');
      if (decision.summary) push('summary', decision.summary, 'CURATED_SUMMARY');
    }
    proposals.push({ concept_id: meta.concept_id, before, after, changes });
  }
  return concept_id ? proposals[0] || null : proposals;
}

/**
 * Link SUGGESTIONS for orphaned/low-degree concepts (David, 2026-10-02,
 * #1036 Class A): given one concept and the repo's concept list, the LLM
 * proposes which concepts this page genuinely references. Bounded by design —
 * max 5 proposals, targets validated against the ACTUAL concept ids (the LLM
 * can never invent a target), self and already-linked targets dropped.
 * Read-only: nothing is written — the steward accepts/rejects in Step 7 and
 * an accepted proposal becomes a frontmatter links[] entry (born right).
 * Fail-soft: any error returns { proposals: [], error } — never a 500.
 */
const LINK_PROPOSAL_MAX = 5;
const LINK_SNIPPET_CHARS = 4000;

async function proposeLinks(repo, concept_id) {
  const db = await dbService.getConnection('default');
  const self = (
    await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id == @c RETURN { concept_id: m.concept_id, title: m.title, body: m.body, links: m.links }',
        { r: repo.repo_id, c: concept_id }
      )
    ).all()
  )[0];
  if (!self) return { concept_id, proposals: [], error: 'concept not found' };
  const peers = (
    await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id != @c SORT m.concept_id RETURN { id: m.concept_id, title: m.title }',
        { r: repo.repo_id, c: concept_id }
      )
    ).all()
  ).slice(0, 200);
  if (peers.length === 0) return { concept_id, proposals: [] };

  const alreadyLinked = new Set(
    (Array.isArray(self.links) ? self.links : []).map((l) => String(l && l.to_concept_id).replace(/^concepts\//, ''))
  );
  const catalog = peers.map((p) => `- ${p.id} — ${p.title || p.id}`).join('\n');
  const system =
    'You are a knowledge-base curator. Answer with STRICT JSON only: ' +
    '{"links": [{"to_concept_id": "<id from the list>", "label": "<short anchor text>"}]}. ' +
    `Propose at most ${LINK_PROPOSAL_MAX} links, ONLY to ids from the provided list, ONLY where this document ` +
    'genuinely references or materially relates to the target. Return {"links": []} when nothing is related. ' +
    'Never invent ids.';
  const user =
    'Document: ' +
    (self.title || concept_id) +
    '\nContent:\n' +
    String(self.body || '').slice(0, LINK_SNIPPET_CHARS) +
    '\n\nAvailable concepts:\n' +
    catalog;
  try {
    const raw = await withSpan('okf.llm.link-proposals', async (span) => {
      span.setAttribute('okf.repo_id', repo.repo_id);
      span.setAttribute('okf.concept_id', concept_id);
      return callVllm(
        [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        {
          timeoutMs: CURATION_TIMEOUT_MS
        }
      );
    });
    let j;
    try {
      j = JSON.parse(raw);
    } catch {
      return { concept_id, proposals: [], error: 'unparseable LLM response' };
    }
    const peerById = new Map(peers.map((p) => [p.id, p]));
    const proposals = [];
    for (const l of Array.isArray(j.links) ? j.links : []) {
      if (!l || proposals.length >= LINK_PROPOSAL_MAX) break;
      const target = String(l.to_concept_id || '').replace(/^concepts\//, '');
      if (!peerById.has(target) || target === concept_id || alreadyLinked.has(target)) continue;
      proposals.push({
        to_concept_id: target,
        label: String(l.label || peerById.get(target).title || target).slice(0, 80),
        title: peerById.get(target).title || target
      });
    }
    return { concept_id, proposals };
  } catch (e) {
    logger.warn('OKF link proposals failed for ' + concept_id + ': ' + e.message);
    return { concept_id, proposals: [], error: e.message };
  }
}

module.exports = {
  resolveAreaContext,
  curateRepoConcepts,
  proposeFrontmatter,
  proposeLinks,
  parseCurationResponse,
  buildCurationPrompt,
  TYPE_ENUM,
  NO_LABEL
};
