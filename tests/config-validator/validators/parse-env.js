const fs = require('fs');

/**
 * Parse the env template file (KEY=VALUE format with comments).
 *
 * Extracts variable names, values, section headers, and inline comments.
 * Handles:
 *   - Section headers: # ========= Section N =========
 *   - Inline comments: KEY=VALUE # comment
 *   - Empty-value secrets: KEY=
 *   - Commented-out vars: # KEY=VALUE
 *   - Values with spaces/commas/colons
 *
 * @param {string} filePath - Absolute or relative path to the env file
 * @returns {{ variables: Array<{ name: string, value: string, default: string, section: string, comment: string, commentedOut: boolean }>, sections: string[] }}
 */
function parseEnvTemplate(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read env template file: ${filePath}`, { cause: err });
  }
  const lines = content.split('\n');

  const variables = [];
  const sections = [];
  // Commented-out variable definitions (`# NAME=value`) — the operator-facing
  // DOCUMENTATION of a knob that is not active config. Kept apart from
  // `variables` on purpose (!1073): `env` has 300 of these against 61 active
  // lines, so merging them would swamp every check that reads `variables`.
  const documented = [];
  let currentSection = 'Uncategorized';

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers like: # ========= Section N: Title =========
    const sectionMatch = trimmed.match(/^#\s*=+\s*(Section\s+\d+[a-z]*(?:[:]?\s*.+?)?)\s*=+\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections.push(currentSection);
      continue;
    }

    // Detect non-section header comments like: # SECTION 1: TITLE
    const altSectionMatch = trimmed.match(/^#\s*=+\s*(.+?)\s*=+\s*$/);
    if (altSectionMatch && !sectionMatch) {
      const candidate = altSectionMatch[1].trim();
      if (
        candidate.match(/SECTION/i) ||
        candidate.match(/GPU/i) ||
        candidate.match(/DOCKER/i) ||
        candidate.match(/PROXY/i) ||
        candidate.match(/TELEMETRY/i) ||
        candidate.match(/LLM/i) ||
        candidate.match(/IDENTITY/i) ||
        candidate.match(/SSE/i) ||
        candidate.match(/EXTERNAL/i)
      ) {
        currentSection = candidate;
        sections.push(currentSection);
        continue;
      }
    }

    // Skip empty lines and pure comment lines (not variable definitions)
    if (trimmed === '' || trimmed.startsWith('#')) {
      // ...EXCEPT a commented-out variable DEFINITION (`# OKF_X=200`). Those
      // are not active config, but they ARE the operator-facing documentation
      // of a knob, and `env` carries 300 of them against only 61 active lines.
      // They used to be dropped entirely, which is why 28 documented OKF_*
      // knobs could sit in `env` while reaching no container at all — the
      // orphan gate could not see them even in principle (!1073).
      //
      // They are returned SEPARATELY rather than merged into `variables`:
      // merging would make all 300 look like active config and swamp every
      // existing check that reads `variables`.
      const docMatch = trimmed.match(/^#\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (docMatch) {
        const name = docMatch[1];
        const rawValue = docMatch[2];
        const commentMatch = rawValue.match(/^(.*?)\s+#\s+(.+)$/);
        documented.push({
          name,
          value: commentMatch ? commentMatch[1].trim() : rawValue.trim(),
          section: currentSection,
          comment: commentMatch ? commentMatch[2] : '',
          commentedOut: true
        });
      }
      continue;
    }

    // Parse KEY=VALUE or KEY= (empty value)
    const varMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (varMatch) {
      const name = varMatch[1];
      let rawValue = varMatch[2];

      // Extract inline comment (value#comment) but preserve # inside values
      // Only split on # preceded by a space that looks like a comment
      let value = rawValue;
      let comment = '';
      const commentMatch = rawValue.match(/^(.*?)\s+#\s+(.+)$/);
      if (commentMatch) {
        value = commentMatch[1];
        comment = commentMatch[2];
      }

      variables.push({
        name,
        value: value,
        default: value,
        section: currentSection,
        comment,
        commentedOut: false
      });
      continue;
    }
  }

  return { variables, sections, documented };
}

/**
 * Get variables that are required secrets (no default value or empty default).
 * A variable is "required" if its value is empty string (KEY=) or unset.
 *
 * @param {{ variables: Array }} parsed - Output from parseEnvTemplate
 * @returns {Array<{ name: string, section: string }>}
 */
function getRequiredSecrets(parsed) {
  return parsed.variables
    .filter((v) => !v.commentedOut && v.value === '')
    .map((v) => ({ name: v.name, section: v.section }));
}

/**
 * Get optional variables (those with default values).
 *
 * @param {{ variables: Array }} parsed - Output from parseEnvTemplate
 * @returns {Array<{ name: string, value: string, section: string }>}
 */
function getOptionalVars(parsed) {
  return parsed.variables
    .filter((v) => !v.commentedOut && v.value !== '')
    .map((v) => ({ name: v.name, value: v.value, section: v.section }));
}

module.exports = { parseEnvTemplate, getRequiredSecrets, getOptionalVars };
