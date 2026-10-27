const fs = require('fs');

/**
 * Validators for the Ansible env template (deploy/ansible/templates/env.j2).
 *
 * env.j2 is rendered by Ansible into the runtime .env — it is NOT the repo
 * `env` file that parse-env.js covers. The per-service image vars it renders
 * (GENIE_AI_<NAME>_IMAGE / _IMAGE_TAG) must match what docker-compose.yaml
 * references, otherwise compose silently falls back to GENIE_AI_GLOBAL_TAG
 * (the doubled-prefix bug class: overrides become a no-op with no error).
 *
 * Regex-on-raw-file like the other validators — Jinja syntax is not YAML.
 */

function readFileOrThrow(filePath, what) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read ${what}: ${filePath}`, { cause: err });
  }
}

/**
 * Extract the genieai_images names from deploy-shared-facts.yml.
 *
 * The set_fact block lists entries as `- { name: "genie-ai-frontend" }`.
 * Returns the bare names, e.g. ['genie-ai-frontend', ...].
 *
 * @param {string} sharedFactsPath - Path to deploy/ansible/tasks/deploy-shared-facts.yml
 * @returns {string[]}
 */
function parseGenieAiImageNames(sharedFactsPath) {
  const content = readFileOrThrow(sharedFactsPath, 'shared facts file');
  const lines = content.split('\n');
  const names = [];
  let inBlock = false;

  for (const line of lines) {
    if (/^\s*genieai_images:/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      const match = line.match(/^\s*-\s*\{\s*name:\s*["']([\w.-]+)["']/);
      if (match) {
        names.push(match[1]);
      } else if (!/^\s*-\s/.test(line)) {
        break; // first non-list line ends the block
      }
    }
  }

  if (names.length === 0) {
    throw new Error(`No genieai_images entries found in ${sharedFactsPath}`);
  }
  return names;
}

/**
 * Apply one Jinja filter to a string. Unknown filters throw so a template
 * change cannot silently pass through this validator.
 */
function applyJinjaFilter(value, filter) {
  const match = filter.trim().match(/^(\w+)(?:\((.*)\))?$/);
  if (!match) {
    throw new Error(`Unparseable Jinja filter: ${filter}`);
  }
  const [, name, rawArgs] = match;
  // Args are simple quoted string literals ('x' or "x"), comma-separated
  const args = [];
  if (rawArgs !== undefined) {
    const argRe = /'([^']*)'|"([^"]*)"/g;
    let argMatch;
    while ((argMatch = argRe.exec(rawArgs)) !== null) {
      args.push(argMatch[1] !== undefined ? argMatch[1] : argMatch[2]);
    }
  }

  const filters = {
    upper: () => value.toUpperCase(),
    lower: () => value.toLowerCase(),
    replace: () => {
      if (args.length !== 2) throw new Error(`replace() needs 2 args: ${filter}`);
      return value.split(args[0]).join(args[1]);
    },
    regex_replace: () => {
      if (args.length !== 2) throw new Error(`regex_replace() needs 2 args: ${filter}`);
      return value.replace(new RegExp(args[0], 'g'), args[1]);
    }
  };
  if (!Object.prototype.hasOwnProperty.call(filters, name)) {
    throw new Error(`Unsupported Jinja filter "${name}" in env.j2 — extend parse-env-template.js to cover it`);
  }
  return filters[name]();
}

/**
 * Evaluate `img.name | filter1 | filter2 | ...` for one image name.
 * Splitting on top-level `|` is safe while filter args stay quoted-literal
 * and pipe-free (true of this template; the throw in applyJinjaFilter and
 * the integration test on the real template guard drift).
 */
function evalImgNameExpression(expression, imageName) {
  const parts = expression.split('|').map((p) => p.trim());
  if (parts[0] !== 'img.name') {
    throw new Error(`Expression must start with img.name, got: ${expression}`);
  }
  return parts.slice(1).reduce((acc, filter) => applyJinjaFilter(acc, filter), imageName);
}

/**
 * The environment variable names the Ansible template renders.
 *
 * A name inside a Jinja comment is not rendered, so it does not count.
 *
 * @param {string} envJ2Path - Path to deploy/ansible/templates/env.j2
 * @param {string} prefix - The prefix of the names to collect (e.g. 'RETRIEVER_')
 * @returns {Set<string>} The names the template renders
 */
function parseEnvTemplateVarNames(envJ2Path, prefix) {
  const content = readFileOrThrow(envJ2Path, 'env template');
  const rendered = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .map((line) => line.replace(/\{#[\s\S]*?#\}/g, ''))
    .join('\n');
  const names = new Set();
  const namePattern = new RegExp(`(?<![A-Z0-9_])(${prefix}[A-Z0-9_]+)`, 'g');
  for (const match of rendered.matchAll(namePattern)) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Derive the per-service env var names env.j2 renders inside its
 * genieai_images loop, for every image in deploy-shared-facts.yml.
 *
 * Supports both loop-body forms the template has used:
 *   - inline:  GENIE_AI_{{ img.name | <filters> }}_IMAGE...
 *   - hoisted: {% set env_name = img.name | <filters> %} + GENIE_AI_{{ env_name }}_IMAGE...
 *
 * @param {string} envJ2Path - Path to deploy/ansible/templates/env.j2
 * @param {string} sharedFactsPath - Path to deploy/ansible/tasks/deploy-shared-facts.yml
 * @returns {Array<{ image: string, imageVar: string, tagVar: string }>}
 */
function parseEnvTemplateImageVars(envJ2Path, sharedFactsPath) {
  const content = readFileOrThrow(envJ2Path, 'env template');

  const forMatch = content.match(/{%-?\s*for\s+img\s+in\s+genieai_images[^%]*%-?}/);
  if (!forMatch) {
    throw new Error(`No {% for img in genieai_images %} loop found in ${envJ2Path}`);
  }
  const loopStart = forMatch.index + forMatch[0].length;
  const endIdx = content.indexOf('{% endfor %}', loopStart);
  if (endIdx === -1) {
    throw new Error(`Unterminated genieai_images loop in ${envJ2Path}`);
  }
  const loopBody = content.slice(loopStart, endIdx);

  // {% set NAME = img.name | ... %} bindings declared inside the loop
  const bindings = new Map();
  const setRe = /\{%-?\s*set\s+(\w+)\s*=\s*(img\.name[^%]*?)\s*-?%\}/g;
  let setMatch;
  while ((setMatch = setRe.exec(loopBody)) !== null) {
    bindings.set(setMatch[1], setMatch[2].trim());
  }

  // GENIE_AI_{{ expr }}_IMAGE / _IMAGE_TAG lines
  const varRe = /^GENIE_AI_\{\{\s*([^}]+?)\s*\}\}_(IMAGE_TAG|IMAGE)=/gm;
  const expressions = new Map(); // IMAGE / IMAGE_TAG → expression string
  let varMatch;
  while ((varMatch = varRe.exec(loopBody)) !== null) {
    expressions.set(varMatch[2], varMatch[1].trim());
  }
  if (!expressions.has('IMAGE') || !expressions.has('IMAGE_TAG')) {
    throw new Error(`genieai_images loop must render both _IMAGE and _IMAGE_TAG vars in ${envJ2Path}`);
  }

  return parseGenieAiImageNames(sharedFactsPath).map((imageName) => {
    const derived = {};
    for (const [suffix, expression] of expressions) {
      const expr = bindings.has(expression) ? bindings.get(expression) : expression;
      derived[suffix] = evalImgNameExpression(expr, imageName);
    }
    return {
      image: imageName,
      imageVar: `GENIE_AI_${derived.IMAGE}_IMAGE`,
      tagVar: `GENIE_AI_${derived.IMAGE_TAG}_IMAGE_TAG`
    };
  });
}

module.exports = { parseGenieAiImageNames, parseEnvTemplateImageVars, parseEnvTemplateVarNames };
