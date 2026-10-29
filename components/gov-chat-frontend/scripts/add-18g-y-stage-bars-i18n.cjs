// One-shot i18n codemod — Step 4 per-stage progress bars (David, 2026-10-11:
// "we need progress bars with each of the stages being depicted in Step 4").
// Adds a `stage:` block inside the existing `produce:` namespace in every
// locale. SURGICAL line insertion only — a parse/serialize round-trip is NOT
// safe on these ~2.5k-line files (it destroyed them in the 1-8g-p codemod).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const block = [
  `        stage: {`,
  `          files: 'Files',`,
  `          filesCount: '{done} of {total} documents',`,
  `          concepts: 'Concepts',`,
  `          conceptsCount: '{done} of {total} topics',`,
  `          conceptsSoFar: '{n} topics so far',`,
  `          curating: 'Curating',`,
  `          curatingCount: '{done} of {total} concepts labelled',`,
  `          crosslink: 'Cross-linking topics',`,
  `          linkCount: '{done} of {total} batches · {w} links written',`,
  `          waiting: 'Waiting'`,
  `        },`
];

let changed = 0;
let missed = 0;
for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js'))) {
  const p = path.join(DIR, f);
  const src = fs.readFileSync(p, 'utf8');
  if (/filesCount:/.test(src)) {
    console.log(`skip   ${f}`);
    continue;
  }
  const lines = src.split('\n');
  // Anchor: the produce block's filesNote line, then insert `stage:` right
  // before it (same object, no reserialization).
  const idx = lines.findIndex((l) => /^\s*filesNote: /.test(l));
  if (idx === -1) {
    console.log(`MISS   ${f} — no filesNote anchor`);
    missed += 1;
    continue;
  }
  let produceIdx = -1;
  for (let i = idx; i >= 0; i -= 1) {
    if (/^\s*produce: \{$/.test(lines[i])) {
      produceIdx = i;
      break;
    }
  }
  if (produceIdx === -1) {
    console.log(`MISS   ${f} — no owning produce: { above filesNote`);
    missed += 1;
    continue;
  }
  lines.splice(idx, 0, ...block);
  fs.writeFileSync(p, lines.join('\n'));
  changed += 1;
  console.log(`patch  ${f} (line ${idx + 1})`);
}
console.log(`\n${changed} patched, ${missed} missed`);
if (missed) process.exitCode = 1;
