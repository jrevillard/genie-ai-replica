// #1667 — one-shot operator migration: normalize legacy `concepts/`-prefixed
// concept ids in okf_concepts_meta to the bare form (the only form the
// writers have produced since 2026-08-30, and the only form the readers
// query by). DRY-RUN by default: run with --fix to write.
//
// Handles two kinds of legacy data:
//   1. a prefixed concept_id on the meta doc itself (stored ids);
//   2. prefixed to_concept_id entries inside the doc's stored links array.
//
// COLLISION SAFETY: a prefixed row is rewritten only when its bare form is
// free in the same repo. When BOTH forms exist for one id in one repo the
// script REFUSES that row and names it — never a silent merge (the unique
// (repo_id, concept_id) index would reject the write anyway; the refusal
// makes the operator decide which row is authoritative).
//
// Usage (from the repo root, against the build's ArangoDB):
//   node scripts/okf-testing-lab/normalize-concept-ids.js           # report
//   node scripts/okf-testing-lab/normalize-concept-ids.js --fix     # write
const http = require('http');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const pw = ((env.match(/^ARANGO_PASSWORD=(.*)$/m) || [])[1] || '').replace(/[\r\n]+/g, '').replace(/^"|"$/g, '');
const auth = 'Basic ' + Buffer.from('root:' + pw).toString('base64');
const FIX = process.argv.includes('--fix');

function q(aql, bindVars) {
  return new Promise((res, rej) => {
    const d = JSON.stringify({ query: aql, bindVars });
    const r = http.request(
      {
        method: 'POST',
        host: 'localhost',
        port: 8529,
        path: '/_db/genie-ai/_api/cursor',
        headers: { 'Content-Type': 'application/json', Authorization: auth, 'Content-Length': Buffer.byteLength(d) }
      },
      (resp) => {
        let s = '';
        resp.on('data', (c) => (s += c));
        resp.on('end', () => res(JSON.parse(s)));
      }
    );
    r.on('error', rej);
    r.write(d);
    r.end();
  });
}
const strip = (id) => String(id || '').replace(/^concepts\//, '');

(async () => {
  // 1. Prefixed STORED ids.
  const rows =
    (
      await q(
        'FOR m IN okf_concepts_meta FILTER CONTAINS(m.concept_id, "concepts/") RETURN KEEP(m, ["_id", "repo_id", "concept_id"])',
        {}
      )
    ).result || [];
  console.log(`prefixed stored ids: ${rows.length}`);

  // 2. Prefixed LINK TARGETS inside stored links arrays.
  const linkDocs =
    (
      await q(
        'FOR m IN okf_concepts_meta FILTER IS_ARRAY(m.links) AND LENGTH(FOR l IN m.links FILTER l.to_concept_id != null AND CONTAINS(l.to_concept_id, "concepts/") RETURN 1) > 0 RETURN KEEP(m, ["_id", "repo_id", "links"])',
        {}
      )
    ).result || [];
  console.log(`docs with prefixed link targets: ${linkDocs.length}`);

  if (!FIX) {
    console.log('dry run — re-run with --fix to write. (No rows were touched.)');
    process.exit(0);
  }

  let fixedIds = 0;
  let refused = 0;
  for (const row of rows) {
    const bare = strip(row.concept_id);
    // The bare twin in the same repo: a unique-index collision — refuse, name it.
    const twin =
      (
        await q('FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.concept_id == @cid RETURN m._id', {
          rid: row.repo_id,
          cid: bare
        })
      ).result || [];
    if (twin.length > 0) {
      refused += 1;
      console.log(
        `REFUSED (both forms in one repo — decide the authoritative row):\n  ${row._id} (${row.concept_id}) collides with ${twin[0]} (${bare})`
      );
      continue;
    }
    // The collection's _key is auto-generated (numeric), NOT derived from
    // concept_id — a plain attribute update is safe; the unique
    // (repo_id, concept_id) index rejects a colliding write server-side and
    // the catch names it.
    await q('UPDATE @key WITH { concept_id: @bare } IN okf_concepts_meta', {
      key: row._key,
      bare
    }).catch((e) => {
      refused += 1;
      console.log(`REFUSED (write failed): ${row._id} — ${e.errorMessage || e.message || 'unique-index collision?'}`);
    });
    fixedIds += 1;
  }

  let fixedLinks = 0;
  for (const doc of linkDocs) {
    const links = (doc.links || []).map((l) =>
      l && typeof l.to_concept_id === 'string' && l.to_concept_id.includes('concepts/')
        ? { ...l, to_concept_id: strip(l.to_concept_id) }
        : l
    );
    await q('UPDATE @key WITH { links: @links } IN okf_concepts_meta', { key: doc._key, links });
    fixedLinks += 1;
  }

  console.log(
    `done: ${fixedIds} stored ids rewritten, ${fixedLinks} link arrays rewritten, ${refused} refused (see above — decide each).`
  );
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
