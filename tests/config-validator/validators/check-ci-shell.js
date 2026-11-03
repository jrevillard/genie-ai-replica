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

const childProcess = require('child_process');

function checkShellSyntax(blocks) {
  // Group blocks the way the runner concatenates them: before_script and
  // script are ONE shell file per job, after_script runs separately.
  // Boundaries still accepted as limits: extends-inherited scripts and
  // alias-spliced anchor bodies are checked as their own groups, so a
  // construct spanning those joins is (rarely) a false failure.
  const groups = new Map();
  for (const block of blocks) {
    const groupKey = `${block.owner}\u0000${block.key === 'after_script' ? 'after_script' : 'script-group'}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(block);
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
    const run = childProcess.spawnSync('bash', ['-n'], { input: parts.join('\n'), encoding: 'utf8' });
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
        for (let j = 0; j < items.length; j += 1) {
          if (offsets[j] <= concatLine) {
            origin = items[j];
          }
        }
        at = ` (file line ${origin.startLine + (concatLine - offsets[items.indexOf(origin)])})`;
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
