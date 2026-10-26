// ragas-regenerate-entry.js — regenerate a benchmark entry so it asks what
// the corpus CAN answer.
//
// WHY
// ---
// Two populations of rows in a RAGAS suite measure the BENCHMARK, not the
// assistant:
//
//   1. the UNFAIR questions — their expected passage is proven ABSENT from
//      the indexed corpus, so the row can never be retrieved;
//   2. the rows whose reference answer names facts the corpus does not
//      contain — no rewording of the answer can fix that.
//
// `ragas-regenerate-reference.js` repairs the WORDING of a reference
// answer. It cannot repair either of the two above: the defect is the
// ENTRY (the question and the passage it expects), not the wording.
//
// So this tool replaces the entry. It picks corpus chunks that are on the
// old question's TOPIC but that actually exist in the published corpus,
// asks the sidecar's synthesizer for a question grounded in exactly those
// chunks, and writes the result back under the SAME entry id — so the
// run history stays coherent.
//
// IT NEVER TOUCHES THE RAG. The corpus, the retrieval and the prompt are
// not the subject: the question is whether the benchmark asks something
// the corpus can answer.
//
// THE GATE — the new entry must clear all of it before anything is written:
//
//   a. CORPUS PRESENCE — the new expected passages must be present in the
//      published corpus chunks they were generated from. This is the defect
//      class being fixed, so it is checked directly, not inferred.
//   b. THE METRIC — `context_entities_recall` of the new reference answer
//      against the new passages must reach the floor. The metric is the
//      thing being repaired, so the metric decides (see the note in
//      ragas-regenerate-reference.js on why a cheaper proxy was wrong).
//   c. NO DUPLICATE — the new question must not repeat an existing entry's
//      question (normalized).
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-regenerate-entry.js <repo_id> <suite_key> [entry_id ...]
//   node /tmp/ragas-regenerate-entry.js <repo_id> <suite_key> --dry-run
//   node /tmp/ragas-regenerate-entry.js <repo_id> <suite_key> --floor 0.6
//
// `--floor N` (default 0.5) is the minimum entity recall a regenerated
// entry must reach.
//
// The write goes through the server's OWN service function
// (updateSuiteRows — the same path the UI's row editor uses), so the suite
// stays consistent with everything else the server writes.
//
// The judge is the suite's own judge (the suite records the pick it was
// generated with), so the replacement entry is written by the same model
// as its neighbours. When the suite used the env judge, no override rides
// the request and the key never leaves the container.

'use strict';

const dbService = require('/app/shared-lib/db-connection-service');

// The reference-scoring helper is copied into the container by the operator
// (it is not shipped in the image). A bare require would print a
// module-not-found stack trace and bury the actual instruction.
//
// It is loaded LAZILY, on first use: the module also exports the pure
// helpers (topic tokens, the chunk score, the normalized question, the
// passage lookup) that decide what may be rewritten, and those must be
// usable — and testable — without the operator's copy present. The old
// module-level require called process.exit(2) on a missing copy, which
// killed any importer, not just this script.
let _reference = null;
function referenceHelper() {
  if (_reference) return _reference;
  try {
    _reference = require('/tmp/ragas-regenerate-reference.js');
  } catch (e) {
    throw new Error(
      'ragas-regenerate-entry: /tmp/ragas-regenerate-reference.js is missing.\n' +
        '  Copy it into the container first:\n' +
        '  docker cp <path>/ragas-regenerate-reference.js <container>:/tmp/ragas-regenerate-reference.js\n' +
        `  (${e.message})`
    );
  }
  return _reference;
}
const scoreEntityRecall = (...args) => referenceHelper().scoreEntityRecall(...args);
const fmt = (...args) => referenceHelper().fmt(...args);

const RAGAS_URL = process.env.OKF_RAGAS_URL || 'http://ragas-service:8090';
const RAGAS_INTERNAL_SECRET = process.env.RAGAS_INTERNAL_SECRET || process.env.OKF_INTERNAL_SECRET || '';
const ENV_PICK = '__env__';

// The run leg's per-context cap — the same cap the suite stores passages
// under (ragas-suite-service CONTEXT_CHARS).
const CONTEXT_CHARS = 2000;

const STOPWORDS = new Set(
  (
    'the of and to in a is are for on with what which how when why does do did it its this that as be by from at ' +
    'can could should would will shall may might must have has had not no nor so than then there their they them ' +
    'you your we our us i me my if but about into over under between during before after above below up down out'
  ).split(/\s+/)
);

/** Words that carry the topic of a question. */
function topicTokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñü\s-]/gi, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^[-\s]+|[-\s]+$/g, ''))
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  );
}

/** How much of the question's vocabulary a chunk carries (0..1). */
function topicScore(chunkText, tokens) {
  if (!tokens.size) return 0;
  const chunkTokens = topicTokens(chunkText);
  if (!chunkTokens.size) return 0;
  let hits = 0;
  for (const t of tokens) if (chunkTokens.has(t)) hits += 1;
  return hits / tokens.size;
}

/** Normalized form for duplicate detection. */
function normalizeQuestion(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The published corpus chunks of a repo — the retrievable unit. */
async function loadCorpus(db, repoId) {
  const repo = await db.collection('okf_repositories').document(repoId);
  const graph = repo && repo.ingested_graph_name;
  if (!graph) return { docs: [], graph: null, repo: null };
  const rows = await (
    await db.query(`FOR c IN \`${graph}_SOURCE\` FILTER c.text != null RETURN { key: c._key, text: c.text }`)
  ).all();
  const docs = [];
  for (const r of rows) {
    const text = String(r.text || '').trim();
    if (!text) continue;
    docs.push({ page_content: text, metadata: { repo_id: repoId, graph, chunk_key: r.key } });
  }
  return { docs, graph, repo };
}

/** Is this passage present in the corpus chunk it was generated from? */
function passageInCorpus(passage, docs) {
  const needle = normalizeQuestion(passage).slice(0, 220);
  if (!needle) return false;
  for (const d of docs) {
    if (normalizeQuestion(d.page_content).includes(needle)) return true;
  }
  return false;
}

/** One sidecar generation job. */
async function generateEntry(documents, judge) {
  const body = {
    documents,
    testset_size: 1,
    query_distribution: [{ synthesizer: 'single_hop_specific', weight: 1 }],
    num_personas: 1
  };
  if (judge) body.judge = judge;
  const res = await fetch(`${RAGAS_URL}/generate-testset`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(RAGAS_INTERNAL_SECRET ? { 'x-ragas-secret': RAGAS_INTERNAL_SECRET } : {})
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`sidecar generate failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { job_id: jobId } = await res.json();

  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const jobRes = await fetch(`${RAGAS_URL}/jobs/${jobId}`, {
      headers: RAGAS_INTERNAL_SECRET ? { 'x-ragas-secret': RAGAS_INTERNAL_SECRET } : {}
    });
    if (!jobRes.ok) throw new Error(`sidecar job read failed: ${jobRes.status}`);
    const job = await jobRes.json();
    if (job.status === 'failed') throw new Error(`sidecar job failed: ${String(job.error || 'unknown').slice(0, 300)}`);
    // A cancelled job is a TERMINAL state, not a slow one: the old loop
    // only checked for 'failed' and 'done', so a cancellation was reported
    // ten minutes later as "the generation timed out" — which sends the
    // operator looking at the wrong thing entirely.
    if (job.status === 'cancelled') {
      throw new Error('the sidecar generation was CANCELLED — nothing was regenerated');
    }
    if (job.status === 'done' || job.status === 'completed') {
      const samples = (job.result && job.result.samples) || [];
      if (!samples.length) throw new Error('the generator produced no sample');
      return samples[0];
    }
  }
  throw new Error('the generation timed out');
}

/**
 * The suite's own judge, as a sidecar override. The suite records the pick
 * it was generated with; a suite generated with the env judge has no
 * override — the sidecar's own default is then the right judge.
 *
 * `force` overrides the pick. The env judge is the fallback when the
 * suite's own judge cannot drive the synthesizer: RAGAS parses the
 * synthesizer's output with a pydantic parser, and a judge that answers in
 * a shape the parser cannot read fails the whole job with
 * `RagasOutputParserException` (measured 2026-10-25 with the suite's GLM
 * pick on this deployment). The env judge parses.
 */
async function suiteJudge(suiteDoc, force) {
  if (force === 'env') return null; // no override — the sidecar's env default
  const modelConfigService = require('/app/services/model-config-service');
  const pick = (suiteDoc && suiteDoc.payload && suiteDoc.payload.judge_pick) || {};
  const configKey = pick.config_key || null;
  const model = pick.model || null;
  if (!configKey || configKey === ENV_PICK) return null; // the env judge — no override
  const override = await modelConfigService.resolveModelOverride({ config_key: configKey, model });
  if (!override) return null;
  return {
    provider: override.provider,
    base_url: override.base_url,
    model: override.model,
    api_key: override.api_key
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (require.main === module) {
  const repoId = process.argv[2];
  const suiteKey = process.argv[3];
  const rest = process.argv.slice(4);
  const dryRun = rest.includes('--dry-run');
  // The token AFTER a flag is that flag's VALUE, not an entry id. Without
  // this, `--floor 0.6` put "0.6" into the entry-id list — so the tool
  // targeted a non-existent entry, regenerated nothing, printed "0
  // regenerated" and exited 0. A silent no-op is the worst possible
  // outcome for a tool that writes to a live suite.
  const FLAGS_WITH_VALUE = new Set(['--floor', '--judge']);
  const entryIds = [];
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i];
    if (tok.startsWith('--')) {
      if (FLAGS_WITH_VALUE.has(tok)) i += 1; // skip the flag's value
      continue;
    }
    entryIds.push(tok);
  }
  const floorIdx = rest.indexOf('--floor');
  // `Number(x) || 0.5` turned a floor of 0 into 0.5 — so an operator asking
  // for "regenerate everything below zero" got the default instead, with
  // no warning.
  const rawFloor = floorIdx === -1 ? 0.5 : Number(rest[floorIdx + 1]);
  const floor = Number.isFinite(rawFloor) ? rawFloor : 0.5;
  const judgeIdx = rest.indexOf('--judge');
  const judgeForce = judgeIdx === -1 || !rest[judgeIdx + 1] ? null : rest[judgeIdx + 1]; // 'env' | 'suite'

  if (!repoId || !suiteKey) {
    console.error('usage: node ragas-regenerate-entry.js <repo_id> <suite_key> [entry_id ...] [--dry-run] [--floor N]');
    process.exit(2);
  }

  (async () => {
    const svc = require('/app/services/ragas-suite-service');
    const db = await dbService.getConnection();
    // The driver's document() THROWS on a 404, so `if (!suiteDoc)` never
    // fired and the operator got a raw ArangoDB stack instead of "suite
    // not found" — the one line that tells them what to do.
    let suiteDoc;
    try {
      suiteDoc = await db.collection('okf_head_test_runs').document(suiteKey);
    } catch (e) {
      if (e && (e.code === 404 || e.statusCode === 404)) {
        throw new Error(`suite ${suiteKey} not found — check the suite key (list them with ragas-compare-runs.js)`);
      }
      throw e;
    }
    if (!suiteDoc) throw new Error(`suite ${suiteKey} not found`);
    const entries = suiteDoc.payload.entries || [];
    const { docs, graph } = await loadCorpus(db, repoId);
    console.log(`suite ${suiteKey}: ${entries.length} entries`);
    console.log(`corpus: ${docs.length} published chunks (${graph || 'NO GRAPH'})`);
    console.log(`judge pick: ${JSON.stringify(suiteDoc.payload.judge_pick || null)}`);
    console.log(`floor: ${fmt(floor)}`);
    if (!docs.length) {
      console.error('the repo has no published corpus chunks — nothing can be regenerated against it');
      process.exit(2);
    }
    if (dryRun) console.log('DRY RUN — nothing will be written');

    const judge = await suiteJudge(suiteDoc, judgeForce);
    console.log(`judge: ${judge ? `${judge.model} @ ${judge.base_url}` : 'the env default'}`);
    const existingQuestions = new Set(entries.map((e) => normalizeQuestion(e.query)));

    const targets = entryIds.length ? entries.filter((e) => entryIds.includes(e.id)) : entries;
    console.log(`candidates: ${targets.length}\n`);

    // AUDIT — which entries need regenerating, and why. Read-only.
    //
    // Two independent defects, both checked here:
    //   (a) the entry's expected passage is NOT in the published corpus —
    //       the row measures the benchmark, not the assistant (the ladder's
    //       corpus verdict, via the product's own probe);
    //   (b) the entry's reference answer does not ground in its own
    //       passages — the metric the benchmark scores on.
    // A row is flagged when EITHER holds.
    if (rest.includes('--audit')) {
      const suiteSvc = require('/app/services/ragas-suite-service');
      const flagged = [];
      for (const entry of targets) {
        let verdict = 'error';
        let note = '';
        try {
          const probe = await suiteSvc.probeEntry(repoId, suiteKey, { id: entry.id });
          verdict = (probe && probe.verdict) || 'error';
          note = (probe && probe.note) || '';
        } catch (e) {
          note = e.message;
        }
        let score = null;
        try {
          score = await scoreEntityRecall(entry.reference_answer, entry.reference_passages || []);
        } catch (e) {
          note = `${note} | metric: ${e.message}`;
        }
        const ungrounded = verdict === 'unanswerable';
        const weak = score !== null && score < floor;
        if (ungrounded || weak) {
          flagged.push({ id: entry.id, verdict, score, ungrounded, weak, note });
          console.log(
            `  ${entry.id}: ${ungrounded ? 'PASSAGE NOT IN THE CORPUS' : ''}${weak ? ` entity recall ${fmt(score)}` : ''}` +
              `${note ? ` — ${String(note).slice(0, 90)}` : ''}`
          );
        }
      }
      console.log(`\n=== ${flagged.length} of ${targets.length} entries need regenerating ===`);
      console.log(`\nNEEDS_REGENERATION=${flagged.map((f) => f.id).join(',')}`);
      process.exit(0);
    }

    const changed = [];
    const refused = [];

    for (const entry of targets) {
      const tokens = topicTokens(entry.query);
      // The candidate chunks: the corpus that is ON the old question's topic
      // and that actually EXISTS. The old expected passage is (by
      // definition of this population) absent — so the candidates are found
      // by the QUESTION's vocabulary, not by the missing passage.
      const ranked = docs
        .map((d) => ({ doc: d, score: topicScore(d.page_content, tokens) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((r) => r.doc);
      if (!ranked.length) {
        refused.push({ id: entry.id, why: 'no corpus chunk shares the question’s vocabulary' });
        continue;
      }

      let sample;
      try {
        sample = await generateEntry(ranked, judge);
      } catch (e) {
        refused.push({ id: entry.id, why: `generation: ${e.message}` });
        continue;
      }

      const query = String(sample.user_input || '').trim();
      const answer = String(sample.reference || '');
      const passages = (Array.isArray(sample.reference_contexts) ? sample.reference_contexts : [])
        .map((p) => String(p).slice(0, CONTEXT_CHARS))
        .filter(Boolean);
      if (!query || !answer || !passages.length) {
        refused.push({ id: entry.id, why: 'the generator returned an incomplete entry' });
        continue;
      }

      // GATE (c) — no duplicate question.
      const norm = normalizeQuestion(query);
      if (existingQuestions.has(norm)) {
        refused.push({ id: entry.id, why: 'the regenerated question duplicates an existing entry' });
        continue;
      }

      // GATE (a) — the expected passages must exist in the corpus.
      const absent = passages.filter((p) => !passageInCorpus(p, ranked));
      if (absent.length) {
        refused.push({
          id: entry.id,
          why: `the expected passage is not in the corpus (${absent.length} of ${passages.length})`
        });
        continue;
      }

      // GATE (b) — the metric.
      let score = null;
      try {
        score = await scoreEntityRecall(answer, passages);
      } catch (e) {
        refused.push({ id: entry.id, why: `metric: ${e.message}` });
        continue;
      }
      if (score === null) {
        refused.push({ id: entry.id, why: 'the metric returned no score' });
        continue;
      }
      if (score < floor) {
        refused.push({ id: entry.id, why: `entity recall ${fmt(score)} is below the floor ${fmt(floor)}` });
        continue;
      }

      existingQuestions.add(norm);
      changed.push({ id: entry.id, query, answer, passages, score });
      console.log(`--- ${entry.id} --- entity recall ${fmt(score)}`);
      console.log(`  Q: ${query.slice(0, 200)}`);
      console.log(`  A: ${answer.slice(0, 200).replace(/\s+/g, ' ')}`);
    }

    console.log(`\n=== ${changed.length} regenerated, ${refused.length} refused ===`);
    for (const r of refused) console.log(`  REFUSED ${r.id}: ${r.why}`);

    if (dryRun || !changed.length) {
      if (dryRun) console.log('\n(dry run — nothing written)');
      process.exit(0);
    }

    const updated = await svc.updateSuiteRows(
      repoId,
      suiteKey,
      {
        modifications: changed.map((c) => ({
          id: c.id,
          query: c.query,
          reference_answer: c.answer,
          reference_passages: c.passages
        }))
      },
      { actor: { user_id: 'entry-regeneration' } }
    );
    console.log(
      `\nwrote ${changed.length} entry/entries through updateSuiteRows — suite now has ${updated.payload.entries.length} entries`
    );
    process.exit(0);
  })().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { topicTokens, topicScore, normalizeQuestion, passageInCorpus };
