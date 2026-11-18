const fs = require('fs');

const { parseEnvTemplate } = require('./parse-env');

/**
 * A CI rewrite of a .env variable must target a variable the env template
 * ASSIGNS.
 *
 * Why this exists
 * ---------------
 * The CI builds its .env by copying the repo's `env` template and then
 * rewriting the variables it needs (`sed -i "s|^NAME=.*|NAME=value|" .env`).
 * A `sed` that targets a name the template does not assign matches NOTHING:
 * the rewrite is dead code, the .env keeps the template's default, and the
 * job runs against the wrong artifact — silently.
 *
 * The defect this caught: the image-tag rename moved the stack's version
 * from GENIE_AI_GLOBAL_TAG to GENIE_AI_IMAGE_TAG, and the E2E job's sed
 * kept the old name. The .env stayed on "main" while the job was supposed
 * to pull the candidate build from the registry's tmp/ namespace. Nothing
 * failed: the E2E job only runs on a merge train with E2E_ENABLED=1, so
 * the breakage was invisible to every merge request pipeline.
 *
 * What is checked
 * ---------------
 * Only LITERAL variable names are checked. A rewrite whose name is a shell
 * variable (`${var}`) or a regex (`GENIE_AI_[A-Z0-9_]*_IMAGE=`) is not a
 * name the template can carry — it is a pattern, and the patterns are
 * checked by the gates that own them (the family of repository variables
 * is the compose parser's business).
 *
 * "Assigns" means an ACTIVE assignment in the template (`NAME=...`). A
 * commented-out line is documentation, not configuration: a sed targeting
 * it is as dead as one targeting an unknown name.
 */

/**
 * The literal variable names a CI job rewrites in a .env.
 *
 * @param {string} ciContent - The .gitlab-ci.yml content
 * @returns {Array<{ name: string, line: number, text: string }>}
 */
function findCiEnvRewrites(ciContent) {
  const rewrites = [];
  const lines = ciContent.split('\n');
  lines.forEach((text, index) => {
    // The rewrite must target the .env — a sed on another file says
    // nothing about the template's variable names.
    if (!/\.env\b/.test(text)) {
      return;
    }
    // `sed -i "s|^NAME=...` — a LITERAL name: uppercase letters, digits
    // and underscores, starting with a letter. A `${var}` or a regex
    // (`[A-Z]`-style class, `*`, `?`) does not match.
    const match = text.match(/sed\s+-i\s+["']s\|\^([A-Z][A-Z0-9_]*)=/);
    if (match) {
      rewrites.push({ name: match[1], line: index + 1, text: text.trim() });
    }
  });
  return rewrites;
}

/**
 * The CI rewrites that target a variable the env template does not assign.
 *
 * @param {string} ciPath - Path to .gitlab-ci.yml
 * @param {string} envTemplatePath - Path to the `env` template
 * @returns {Array<{ name: string, line: number, text: string }>}
 */
function findDeadEnvRewrites(ciPath, envTemplatePath) {
  let ciContent;
  try {
    ciContent = fs.readFileSync(ciPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read ${ciPath}`, { cause: err });
  }

  const assigned = new Set(
    parseEnvTemplate(envTemplatePath).variables.map((variable) => variable.name)
  );

  return findCiEnvRewrites(ciContent).filter((rewrite) => !assigned.has(rewrite.name));
}

module.exports = { findCiEnvRewrites, findDeadEnvRewrites };
