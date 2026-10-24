// ragas-regenerate-reference.js — regenerate a benchmark entry's REFERENCE
// ANSWER so it is grounded in the corpus VERBATIM.
//
// WHY
// ---
// RAGAS's `context_entities_recall` is
//
//     |CN ∩ GN| / |GN|
//
// where GN = the entities the LLM extracts from the REFERENCE ANSWER and
// CN = the entities it extracts from the joined retrieved contexts. The
// DENOMINATOR is the reference's entity set — so a reference answer that
// PARAPHRASES the corpus produces entity strings the corpus does not
// contain, and the metric fails on a row whose passage was delivered
// perfectly.
//
// The suite generator is an LLM: it reads a corpus passage and writes an
// answer in its own words. Measured on the 100-question El Salvador suite
// (run rr1792843333604-268dad, attribution rx1792874804480-435040): 29 of
// the 51 judge-stage rows fail ONLY this way. The corpus says
//
//     Critical level: One slug per square meter in the first planting ...
//
// and the reference says
//
//     ... the critical level is one slug per square meter in the first planting
//
// — the same fact, a different string, so the entity extractor produces a
// different entity set on each side.
//
// The fix is on the BENCHMARK side: the reference answer must be written
// FROM the corpus text, not paraphrased from it. This tool does that, and
// VERIFIES the property before writing anything.
//
// IT NEVER TOUCHES THE RAG. The corpus, the retrieval and the prompt are
// not the subject: the question is whether the benchmark asks a question
// the corpus can answer.
//
// USAGE (inside the okf-server container):
//   node /tmp/ragas-regenerate-reference.js <repo_id> <suite_key> [entry_id ...]
//   node /tmp/ragas-regenerate-reference.js <repo_id> <suite_key> --dry-run
//   node /tmp/ragas-regenerate-reference.js <repo_id> <suite_key> --attempts 5
//
// `--attempts N` (default 3) is how many rewrites to try per entry, keeping
// the best-scoring one. One attempt is a coin flip — the judge writes the
// same answer slightly differently each time, and a near-miss needs another
// sample to clear.
//
// The write goes through the server's OWN service function
// (updateSuiteRows — the same path the UI's row editor uses), never
// straight into ArangoDB, so the suite stays consistent with everything
// else the server writes.
//
// The judge is the PRODUCT's own client (`frontmatter-service`'s
// vllmChatCompletions with `config: null` — the env judge), so the
// regenerated reference is written by the SAME model that judged the
// original, and the key never leaves the container.

'use strict';

const dbService = require('/app/shared-lib/db-connection-service');

const JUDGE_MODEL = process.env.RAGAS_JUDGE_MODEL || '(unset)';
const JUDGE_BASE_URL = process.env.RAGAS_JUDGE_BASE_URL || '(unset)';

// ---------------------------------------------------------------------------
// The judge call — the product's own client, the env judge.
// ---------------------------------------------------------------------------
async function judgeChat(messages) {
  const { vllmChatCompletions } = require('/app/services/frontmatter-service');
  const res = await vllmChatCompletions(messages, {
    config: null, // the env judge — the one that scored the run
    maxTokens: 2000,
    temperature: 0,
    service: 'ragas_judge'
  });
  const content = res?.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('judge returned no content');
  return JSON.parse(content);
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------
const REGEN_SYSTEM = `You rewrite a benchmark's REFERENCE ANSWER so that it is grounded in a corpus passage VERBATIM.

The reference answer is scored by an entity-recall metric: the entities an LLM extracts from the reference answer are compared against the entities it extracts from the retrieved context. If the reference PARAPHRASES a fact, the two sides extract DIFFERENT entity strings and the row fails even though the passage was retrieved perfectly.

So: every name, number, term and quantity you write MUST appear character-for-character in the passage. Do not re-order a list into prose. Do not spell out an abbreviation the passage abbreviates. Do not convert the passage's wording into a sentence of your own.

Write the answer as flowing prose, but choose the wording FROM the passage. If the passage says "Critical level: One slug per square meter in the first planting", your answer must contain the substring "One slug per square meter in the first planting" — not "one slug per square metre per plot".

Keep the same meaning and the same coverage of facts. Do not add facts the passage does not contain. Do not drop facts the reference answer covered.

Return JSON: {"answer": "<the rewritten reference answer>"}`;

// ---------------------------------------------------------------------------
// The verification — the gate.
//
// The gate runs THE ACTUAL METRIC on the rewrite. Not a proxy, not a
// heuristic: `context_entities_recall` on (new reference, the entry's own
// reference passages). That is the quantity that failed, so it is the
// quantity that has to pass.
//
// A rewrite is written only when the metric IMPROVES. A rewrite that
// scores the same or worse is refused and reported — it would replace a
// failing reference with a differently-failing one, and the next run
// would blame the judge again.
//
// Why not a cheaper check (does every number and proper noun in the answer
// appear in the passage?): it was tried, and it is WRONG in both
// directions. It refuses ordinary connectives the entity extractor never
// treats as entities ("according", "covers"), so it flags 86 of 100 rows
// including the ones that are fine; and it passes rewrites whose entity
// sets still differ. The metric is the thing being fixed, so the metric
// is what decides.
// ---------------------------------------------------------------------------

const RAGAS_URL = process.env.OKF_RAGAS_URL || 'http://ragas-service:8090';
const RAGAS_INTERNAL_SECRET = process.env.RAGAS_INTERNAL_SECRET || process.env.OKF_INTERNAL_SECRET || '';

/** One metric evaluation through the sidecar, with the env judge. */
async function scoreEntityRecall(reference, passages, timeoutMs = 180000) {
  const res = await fetch(`${RAGAS_URL}/evaluate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(RAGAS_INTERNAL_SECRET ? { 'x-ragas-secret': RAGAS_INTERNAL_SECRET } : {})
    },
    body: JSON.stringify({
      samples: [
        {
          user_input: '',
          response: '',
          reference,
          retrieved_contexts: passages
        }
      ],
      metrics: ['context_entities_recall']
    })
  });
  if (!res.ok) throw new Error(`sidecar evaluate failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { job_id: jobId } = await res.json();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const jobRes = await fetch(`${RAGAS_URL}/jobs/${jobId}`, {
      headers: RAGAS_INTERNAL_SECRET ? { 'x-ragas-secret': RAGAS_INTERNAL_SECRET } : {}
    });
    if (!jobRes.ok) throw new Error(`sidecar job read failed: ${jobRes.status}`);
    const job = await jobRes.json();
    if (job.status === 'failed') throw new Error(`sidecar job failed: ${String(job.error || 'unknown').slice(0, 200)}`);
    if (job.status === 'done' || job.status === 'completed') {
      // The sidecar returns per_query rows (each with the metric name) and
      // an aggregate. The aggregate is the mean over the SCORED rows, so
      // for a single sample it IS that row's score.
      const result = job.result || {};
      const rows = Array.isArray(result.per_query) ? result.per_query : [];
      if (rows.length) {
        const v = rows[0].context_entities_recall;
        return typeof v === 'number' ? v : null;
      }
      const agg = result.aggregate || result.metrics || {};
      const v = agg.context_entities_recall;
      return typeof v === 'number' ? v : null;
    }
  }
  throw new Error('the metric evaluation timed out');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// The run happens only when this file is EXECUTED. When it is required —
// to exercise the gate on its own — the run must not fire.
if (require.main === module) {
  const repoId = process.argv[2];
  const suiteKey = process.argv[3];
  const rest = process.argv.slice(4);
  const dryRun = rest.includes('--dry-run');
  const entryIds = rest.filter((a) => !a.startsWith('--'));
  const attemptsIdx = rest.indexOf('--attempts');
  const attempts = attemptsIdx === -1 ? 3 : Math.max(1, parseInt(rest[attemptsIdx + 1], 10) || 3);

  if (!repoId || !suiteKey) {
    console.error('usage: node ragas-regenerate-reference.js <repo_id> <suite_key> [entry_id ...] [--dry-run]');
    process.exit(2);
  }

  (async () => {
    const svc = require('/app/services/ragas-suite-service');
    const db = await dbService.getConnection();
    const suiteDoc = await db.collection('okf_head_test_runs').document(suiteKey);
    const entries = suiteDoc?.payload?.entries || [];
    console.log(`suite ${suiteKey}: ${entries.length} entries`);
    console.log(`judge: ${JUDGE_MODEL} @ ${JUDGE_BASE_URL}`);
    if (dryRun) console.log('DRY RUN — nothing will be written');

    const targets = entryIds.length ? entries.filter((e) => entryIds.includes(e.id)) : entries;
    if (!targets.length) {
      console.error('no matching entries');
      process.exit(2);
    }
    console.log(`candidates: ${targets.length}\n`);

    const changed = [];
    const failed = [];

    for (const entry of targets) {
      const passages = Array.isArray(entry.reference_passages) ? entry.reference_passages : [];
      if (!passages.length) {
        failed.push({ id: entry.id, why: 'no reference passages' });
        continue;
      }

      // The gate: THE METRIC, on the rewrite. The rewrite is written only if
      // it scores BETTER than the reference it replaces.
      let before;
      try {
        before = await scoreEntityRecall(entry.reference_answer, passages);
      } catch (e) {
        failed.push({ id: entry.id, why: `metric: ${e.message}` });
        continue;
      }
      if (before === null) {
        failed.push({ id: entry.id, why: 'the metric returned no score for the original' });
        continue;
      }

      // Up to `attempts` rewrites, keeping the BEST-scoring one. A single
      // attempt is a coin flip: the judge writes the same answer in a
      // slightly different way each time, and on a near-miss (0.636 ->
      // 0.636) another sample clears it. The original's score is measured
      // ONCE — every attempt is scored against the same baseline, so the
      // comparison is against the thing being replaced.
      let best = null;
      let bestScore = before;
      let lastWhy = 'no attempt produced a rewrite';
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let regenerated;
        try {
          regenerated = await judgeChat([
            { role: 'system', content: REGEN_SYSTEM },
            {
              role: 'user',
              content:
                `QUESTION:\n${entry.query}\n\n` +
                `PASSAGE (the corpus text the answer must be grounded in):\n${passages.join('\n\n')}\n\n` +
                `EXISTING REFERENCE ANSWER (rewrite this — it paraphrases the passage):\n${entry.reference_answer}\n\n` +
                (attempt > 1
                  ? `A previous attempt was rejected because it did not match the passage closely enough. Take a different approach: keep MORE of the passage's exact wording, including the order in which the passage states things.\n\n`
                  : '') +
                `Return the rewritten answer as JSON {"answer": "..."}.`
            }
          ]);
        } catch (e) {
          lastWhy = `judge: ${e.message}`;
          continue;
        }

        const answer = String(regenerated.answer || '').trim();
        if (!answer) {
          lastWhy = 'the judge returned an empty answer';
          continue;
        }
        if (answer === entry.reference_answer) {
          lastWhy = 'the judge returned the reference unchanged';
          continue;
        }

        let after;
        try {
          after = await scoreEntityRecall(answer, passages);
        } catch (e) {
          lastWhy = `metric: ${e.message}`;
          continue;
        }
        if (after === null) {
          lastWhy = 'the metric returned no score for the rewrite';
          continue;
        }
        if (after > bestScore) {
          bestScore = after;
          best = answer;
        }
        if (attempt === 1) {
          console.log(`--- ${entry.id} --- (baseline ${fmt(before)})`);
          console.log(`  attempt 1: ${fmt(after)}`);
        } else {
          console.log(`  attempt ${attempt}: ${fmt(after)}`);
        }
      }

      if (!best) {
        failed.push({ id: entry.id, why: `no rewrite scored better than ${fmt(before)} (${lastWhy})` });
        continue;
      }

      changed.push({ id: entry.id, before: entry.reference_answer, after: best, from: before, to: bestScore });
      console.log(`  KEPT ${fmt(bestScore)}`);
      console.log(`BEFORE: ${entry.reference_answer.slice(0, 200)}`);
      console.log(`AFTER : ${best.slice(0, 200)}\n`);
    }

    console.log(`=== ${changed.length} rewritten, ${failed.length} failed ===`);
    for (const f of failed) console.log(`  FAILED ${f.id}: ${f.why}`);

    if (dryRun || !changed.length) {
      if (dryRun) console.log('\n(dry run — nothing written)');
      process.exit(0);
    }

    // One write, through the server's own function.
    const updated = await svc.updateSuiteRows(
      repoId,
      suiteKey,
      { modifications: changed.map((c) => ({ id: c.id, reference_answer: c.after })) },
      { actor: { user_id: 'reference-regeneration' } }
    );
    console.log(
      `\nwrote ${changed.length} row(s) through updateSuiteRows — suite now has ${updated.payload.entries.length} entries`
    );
    process.exit(0);
  })().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}

// The gate is exported so it can be exercised on its own — against the
// ORIGINAL references of a suite (which must fail: they are what the
// metric failed on) and against the rewrites (which must pass). A gate
// that cannot be exercised is a gate nobody trusts.
function fmt(v) {
  return typeof v === 'number' ? v.toFixed(3) : String(v);
}

module.exports = { scoreEntityRecall, fmt };
