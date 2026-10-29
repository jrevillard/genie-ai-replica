// One-shot i18n codemod — Story 1-8g-p (whole-corpus topic-link authoring).
// SURGICAL: inserts ONE block before the `action: {` line that owns the
// existing `suggestLinks` key, so `topicLinks` lands as a SIBLING of `action`
// (okf.validation.topicLinks.*), not inside it.
// A parse/serialize round-trip is NOT safe here — these locale files are ~2.5k
// lines each and reserializing them produced a 37k-line diff that destroyed
// `export default`. Line-level insertion only.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

// English text (the source of truth for the OKF UI; the other locales fall
// back to it via the translate() default argument).
const T = {
  title: 'Cross-link topics',
  tip: 'Reads every page in this repository and writes links between the pages that genuinely belong together — the same processing the import wizard runs. It is safe to re-run: existing links are kept and only new ones are added.',
  progress: 'Cross-linking… {done} of {total} batches',
  progressIdle: 'Cross-linking… reading the repository',
  done: 'Added {n} link(s) across {c} page(s).',
  failed: 'Cross-linking failed: {msg}'
};

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const block = [
  `      topicLinks: {`,
  `        title: '${esc(T.title)}',`,
  `        tip: '${esc(T.tip)}',`,
  `        progress: '${esc(T.progress)}',`,
  `        progressIdle: '${esc(T.progressIdle)}',`,
  `        done: '${esc(T.done)}',`,
  `        failed: '${esc(T.failed)}'`,
  `      },`
];

let changed = 0;
let missed = 0;
for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js'))) {
  const p = path.join(DIR, f);
  const src = fs.readFileSync(p, 'utf8');
  if (/topicLinks: \{/.test(src)) {
    console.log(`skip   ${f} (already has the keys)`);
    continue;
  }
  const lines = src.split('\n');
  const suggest = lines.findIndex((l) => /^\s*suggestLinks: /.test(l));
  if (suggest === -1) {
    console.log(`MISS   ${f} — no suggestLinks anchor`);
    missed += 1;
    continue;
  }
  let actionIdx = -1;
  for (let i = suggest; i >= 0; i -= 1) {
    if (/^\s*action: \{$/.test(lines[i])) {
      actionIdx = i;
      break;
    }
  }
  if (actionIdx === -1) {
    console.log(`MISS   ${f} — no owning action: { above suggestLinks`);
    missed += 1;
    continue;
  }
  lines.splice(actionIdx, 0, ...block);
  fs.writeFileSync(p, lines.join('\n'));
  changed += 1;
  console.log(`patch  ${f} (line ${actionIdx + 1})`);
}
console.log(`\n${changed} patched, ${missed} missed`);
if (missed) process.exitCode = 1;
