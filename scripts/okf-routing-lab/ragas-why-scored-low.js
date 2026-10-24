// ragas-why-scored-low.js — READ-ONLY: for the judge-stage rows, WHAT is
// actually missing? The reference answer's content vs the retrieved
// contexts, with the entities the reference mentions that the contexts do
// not contain.
//
// Why: the stronger judge reproduced the low scores, so "judge noise" is
// excluded. The remaining question is whether the gap is in the SYSTEM's
// retrieval/answer or in the REFERENCE. This prints the evidence.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-why-scored-low.js <run_key> [n]
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
const LIMIT = Number(process.argv[3] || 3);
const STOP = new Set(
  'a an the of and or to in on for with by is are was were be been being as at from that this these those it its which who whom whose when where how what why not no yes do does did have has had can could may might will would shall should must if then than so such other more most some any each all both few many much very there here their them they he she his her our your my me we you i'.split(
    ' '
  )
);

(async () => {
  const db = await dbService.getConnection();
  const runDoc = await db.collection('okf_head_test_runs').document(runKey);
  const run = runDoc.payload;
  const rows = run.results || [];

  const exCur = await db.query(
    'FOR d IN okf_head_test_runs FILTER d.kind == "ragas_explain" && d.payload.run_key == @rk ' +
      'SORT d.created_at DESC LIMIT 1 RETURN d',
    { rk: runKey }
  );
  const explain = (await exCur.all())[0];
  const attrs = (explain && explain.payload.attributions) || [];
  const byId = new Map(attrs.map((a) => [a.id, a]));

  const suiteCur = await db.query(
    'FOR d IN okf_head_test_runs FILTER d.kind == "ragas_suite" && d._key == @sk RETURN d',
    { sk: runDoc.suite_key }
  );
  const suite = (await suiteCur.all())[0];
  const entries = new Map((((suite || {}).payload || {}).entries || []).map((e) => [e.id, e]));

  // The judge-stage rows, worst entity-recall first.
  const judged = rows
    .filter((r) => byId.get(r.id) && byId.get(r.id).stage === 'judge')
    .sort((a, b) => (a.metrics.context_entities_recall || 0) - (b.metrics.context_entities_recall || 0))
    .slice(0, LIMIT);

  for (const r of judged) {
    const e = entries.get(r.id) || {};
    const a = byId.get(r.id);
    console.log(`\n${'='.repeat(78)}\n${r.id}  stage=${a.stage}  fails=${(a.fails || []).join(',')}`);
    console.log(`entity_recall=${r.metrics.context_entities_recall} factual_correctness=${r.metrics.factual_correctness} answer_relevancy=${r.metrics.answer_relevancy} faithfulness=${r.metrics.faithfulness}`);
    console.log(`ladder_stage=${(a.evidence || {}).ladder_stage} in_corpus=${(a.evidence || {}).in_corpus} in_contexts=${(a.evidence || {}).in_contexts}`);
    console.log(`\nQUERY: ${r.query}`);
    console.log(`\nREFERENCE ANSWER:\n  ${String(e.reference_answer || '').slice(0, 600)}`);
    console.log(`\nEXPECTED PASSAGES (reference_passages):`);
    (e.reference_passages || []).forEach((p, i) => console.log(`  [${i}] ${String(p).slice(0, 260)}`));
    console.log(`\nRETRIEVED CONTEXTS (${(r.contexts || []).length}):`);
    (r.contexts || []).forEach((c, i) => console.log(`  [${i}] ${String(c).slice(0, 220)}`));
    console.log(`\nANSWER:\n  ${String(r.answer || '').slice(0, 500)}`);

    // The reference's content words, and which of them the contexts lack.
    const words = (s) =>
      new Set(
        String(s || '')
          .toLowerCase()
          .split(/[^a-z0-9áéíóúñü]+/)
          .filter((w) => w.length > 3 && !STOP.has(w))
      );
    const refWords = words(e.reference_answer);
    const ctxWords = new Set();
    (r.contexts || []).forEach((c) => words(c).forEach((w) => ctxWords.add(w)));
    const missing = [...refWords].filter((w) => !ctxWords.has(w));
    const cov = refWords.size ? (refWords.size - missing.length) / refWords.size : 1;
    console.log(
      `\nREFERENCE CONTENT WORDS: ${refWords.size}  covered by the contexts: ${refWords.size - missing.length} (${(cov * 100).toFixed(0)}%)`
    );
    console.log(`  MISSING from the contexts: ${missing.slice(0, 25).join(', ')}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
