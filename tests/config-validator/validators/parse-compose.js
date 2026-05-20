const fs = require('fs');

/**
 * Extract environment variable references from docker-compose.yaml using regex.
 *
 * IMPORTANT: docker-compose.yaml contains ${VAR:-default} shell substitution
 * which is NOT valid YAML. Use regex pattern matching on raw file content,
 * NOT js-yaml for variable extraction.
 *
 * Regex: /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g
 *   Group 1: variable name
 *   Group 2: default value (optional, may be empty string for ${VAR:-})
 *
 * @param {string} filePath - Path to docker-compose.yaml
 * @returns {Array<{ name: string, default: string|null, hasDefault: boolean, raw: string }>}
 */
function parseComposeEnvVars(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Filter out comment lines to avoid false positives from documentation text
  const codeLines = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const regex = /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g;
  const seen = new Map();

  let match;
  while ((match = regex.exec(codeLines)) !== null) {
    const name = match[1];
    const rawDefault = match[2];
    // ${VAR:-} means default is empty string; ${VAR} means no default at all
    const hasDefault = match[0].includes(':');
    const defaultVal = hasDefault ? rawDefault : null;

    if (!seen.has(name)) {
      seen.set(name, {
        name,
        default: defaultVal,
        hasDefault,
        raw: match[0]
      });
    } else {
      // If we see the same var with and without a default, prefer the one with default
      const existing = seen.get(name);
      if (!existing.hasDefault && hasDefault) {
        seen.set(name, {
          name,
          default: defaultVal,
          hasDefault,
          raw: match[0]
        });
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Cross-reference docker-compose vars against env template vars.
 *
 * Flags:
 *   - Orphaned: vars in env template but never referenced in docker-compose.yaml
 *   - Undocumented: vars in docker-compose.yaml but not in env template
 *   - Conflicting: same variable with different defaults in compose vs env
 *
 * @param {Array<{ name: string, default: string|null, hasDefault: boolean }>} composeVars
 * @param {{ variables: Array<{ name: string, value: string }> }} envParsed
 * @returns {{ orphaned: string[], undocumented: string[], conflicting: Array<{ name: string, composeDefault: string, envDefault: string }> }}
 */
function crossReference(composeVars, envParsed) {
  const envNames = new Set(envParsed.variables.map((v) => v.name));
  const envDefaults = new Map();
  for (const v of envParsed.variables) {
    envDefaults.set(v.name, v.value);
  }

  const composeNames = new Set(composeVars.map((v) => v.name));

  const orphaned = [...envNames].filter((name) => !composeNames.has(name));

  const undocumented = [...composeNames].filter((name) => !envNames.has(name));

  const conflicting = [];
  for (const cv of composeVars) {
    if (cv.hasDefault && envNames.has(cv.name)) {
      const envVal = envDefaults.get(cv.name);
      // Only flag as conflicting if both have non-empty values and they differ
      if (envVal !== '' && cv.default !== '' && cv.default !== null && envVal !== cv.default) {
        conflicting.push({
          name: cv.name,
          composeDefault: cv.default,
          envDefault: envVal
        });
      }
    }
  }

  return { orphaned, undocumented, conflicting };
}

module.exports = { parseComposeEnvVars, crossReference };
