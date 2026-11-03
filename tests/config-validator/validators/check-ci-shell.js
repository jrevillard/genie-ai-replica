// Syntax-checks the shell blocks extracted from .gitlab-ci.yml
// (extract-ci-shell.js) with `bash -n` — parse only, no execution (#1306,
// #1322). GitLab runs script segments with bash on every runner image this
// repo uses, so bash's parser is the contract. A missing bash binary is a
// thrown error, never an empty result: a gate that cannot run must not
// read as green.

const childProcess = require('child_process');

function checkShellSyntax(blocks, opts = {}) {
  const bashPath = opts.bashPath || 'bash';
  const errors = [];
  for (const block of blocks) {
    const run = childProcess.spawnSync(bashPath, ['-n'], { input: block.text, encoding: 'utf8' });
    if (run.error) {
      throw new Error(`cannot run ${bashPath} -n: ${run.error.message}`);
    }
    if (run.status !== 0) {
      // bash reports line numbers relative to the extracted text; map the
      // first reported line back to the .gitlab-ci.yml line it came from.
      const stderr = (run.stderr || '').trim();
      const rel = stderr.match(/line (\d+)/);
      const at = rel ? ` (file line ${block.startLine + Number(rel[1]) - 1})` : '';
      const first =
        stderr.split('\n')[0] || `bash -n exited abnormally (status ${run.status}, signal ${run.signal || 'none'})`;
      errors.push({
        owner: block.owner,
        key: block.key,
        startLine: block.startLine,
        message: `${first}${at}`
      });
    }
  }
  return errors;
}

module.exports = { checkShellSyntax };
