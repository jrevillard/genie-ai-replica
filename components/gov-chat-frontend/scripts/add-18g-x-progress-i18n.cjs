// One-shot i18n codemod — Story 1-8g-x (run progress bar).
// SURGICAL line insertion: adds a `run:` block inside `headTest` in every
// locale, anchored on the existing `running:` key of the suites block. A
// parse/serialize round-trip is NOT safe here — these files are ~2.5k lines
// each and reserializing produced a 37k-line diff in the 1-8g-p codemod.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const block = [
  `      run: {`,
  `        progress: '{done} of {total} queries ({pct}%)',`,
  `        progressStarting: 'Starting the run…',`,
  `        phase: {`,
  `          routing: 'Scoring routes',`,
  `          corpus: 'Checking the corpus'`,
  `        }`,
  `      },`
];

let changed = 0;
let missed = 0;
for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js'))) {
  const p = path.join(DIR, f);
  const src = fs.readFileSync(p, 'utf8');
  if (/progressStarting:/.test(src)) {
    console.log(`skip   ${f} (already has the keys)`);
    continue;
  }
  const lines = src.split('\n');
  // Anchor on the headTest `suites.running` string, then insert `run:` as a
  // sibling of `suites:` inside headTest.
  const idx = lines.findIndex((l) => /^\s*running: '.*[Rr]unning every suite query/.test(l));
  if (idx === -1) {
    console.log(`MISS   ${f} — no suites.running anchor`);
    missed += 1;
    continue;
  }
  let suitesIdx = -1;
  for (let i = idx; i >= 0; i -= 1) {
    if (/^\s*suites: \{$/.test(lines[i])) {
      suitesIdx = i;
      break;
    }
  }
  if (suitesIdx === -1) {
    console.log(`MISS   ${f} — no owning suites: { above running`);
    missed += 1;
    continue;
  }
  lines.splice(suitesIdx, 0, ...block);
  fs.writeFileSync(p, lines.join('\n'));
  changed += 1;
  console.log(`patch  ${f} (line ${suitesIdx + 1})`);
}
console.log(`\n${changed} patched, ${missed} missed`);
if (missed) process.exitCode = 1;
void esc;
