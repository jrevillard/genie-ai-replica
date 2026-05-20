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
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const variables = [];
  const sections = [];
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

  return { variables, sections };
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
