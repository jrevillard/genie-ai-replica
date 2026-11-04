// Syntax-checks the shell blocks extracted from .gitlab-ci.yml
// (extract-ci-shell.js) with `bash -n` — parse only, no execution (#1306,
// #1322). GitLab concatenates a script value's items into one shell file
// at runtime, so the blocks of one (owner, key) pair are checked as a
// single script: control flow split across items is legal and must parse
// as a whole. Reported line numbers map back to the .gitlab-ci.yml line
// of the offending item.
//
// Parser caveat (accepted limitation): alpine-based jobs (node:20-alpine
// and friends) execute scripts under busybox ash, not bash — a bashism in
// such a job passes this gate and can still fail on the runner. The gate's
// target class (stray `done`, unbalanced quotes, unterminated blocks) is
// rejected by both parsers.
//
// A missing bash binary is a thrown error, never an empty result: a gate
// that cannot run must not read as green.
//
// The reported file line is exact for literal blocks and plain items; for
// a folded scalar the rendered text has fewer lines than the source, so
// the hint points at the block's start line rather than at the exact
// source line.

const childProcess = require('child_process');

function checkShellSyntax(blocks) {
  // Group blocks the way the runner concatenates them: before_script and
  // script are ONE shell file per job, after_script runs separately.
  // Boundaries still accepted as limits: extends-inherited scripts,
  // alias-spliced anchor bodies, and a `default: before_script:` a job
  // inherits are checked as their own groups, so a construct spanning
  // those joins is (rarely) a false failure.
  const groups = new Map();
  for (const block of blocks) {
    const groupKey = `${block.owner}\u0000${block.key === 'after_script' ? 'after_script' : 'script-group'}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(block);
  }
  // The runner runs before_script before script, whatever order the YAML
  // mapping lists them in — order the group the same way.
  for (const items of groups.values()) {
    items.sort((a, b) => (a.key === 'before_script' ? 0 : 1) - (b.key === 'before_script' ? 0 : 1));
  }

  const errors = [];
  for (const items of groups.values()) {
    // Concatenate with newline separators, recording each item's 1-based
    // start line inside the concatenated text so a bash-reported line maps
    // back to the item and the .gitlab-ci.yml line it came from.
    const offsets = [];
    let cursor = 1;
    const parts = items.map((block) => {
      offsets.push(cursor);
      cursor += block.text.split('\n').length; // the separator adds no line
      return block.text;
    });
    // LC_ALL=C pins the locale so the parsed stderr (the `line (\d+)`
    // mapping and the forwarded message) is locale-independent — bash's
    // localized messages (`ligne 3`, #1423) would drop the line attribution.
    const run = childProcess.spawnSync('bash', ['-n'], {
      input: parts.join('\n'),
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' }
    });
    if (run.error) {
      throw new Error(`cannot run bash -n: ${run.error.message}`);
    }
    if (run.status !== 0) {
      const stderr = (run.stderr || '').trim();
      const rel = stderr.match(/line (\d+)/);
      let at = '';
      let origin = items[items.length - 1];
      if (rel) {
        const concatLine = Number(rel[1]);
        // Last item whose offset precedes the reported line.
        let originIdx = items.length - 1;
        for (let j = 0; j < items.length; j += 1) {
          if (offsets[j] <= concatLine) {
            origin = items[j];
            originIdx = j;
          }
        }
        // EOF-class errors report lastLine+1 — clamp to the item's span so
        // the hint never points past it into the next YAML construct.
        const relLine = Math.min(concatLine - offsets[originIdx], origin.text.split('\n').length - 1);
        at = ` (file line ${origin.startLine + Math.max(relLine, 0)})`;
      }
      const first =
        stderr.split('\n')[0] || `bash -n exited abnormally (status ${run.status}, signal ${run.signal || 'none'})`;
      errors.push({
        owner: origin.owner,
        key: origin.key,
        startLine: origin.startLine,
        message: `${first}${at}`
      });
    }
  }
  return errors;
}

module.exports = { checkShellSyntax };
