// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// #1074 — one variable, one interpolation form.
//
// docker-compose.yaml interpolates the same source variable in several
// services. When the forms disagree — bare `${VAR}` in one service,
// defaulted `${VAR:-x}` in another — an unset variable reaches the two
// services with DIFFERENT values and the system half-configures instead of
// failing. Compose does not fail on a bare `${VAR}`: it warns once and
// substitutes the empty string, so the asymmetry was invisible to CI (AC2
// checks presence in `env`, and no check inspected the FORM of an
// interpolation).
//
// The gate: a variable must not mix a bare form with a defaulted or
// error form anywhere in docker-compose.yaml. Presence operators
// (`${VAR:+true}`) are neither bare nor defaulted — they key on the
// variable's presence and are exempt.

/**
 * Classify one `${VAR...}` interpolation occurrence.
 *
 * @param {string} raw - the matched `${...}` text
 * @returns {'bare'|'default'|'error'|'presence'} the form
 */
function classifyForm(raw) {
  // Classify by the TOP-LEVEL separator — the character right after the
  // variable name. A nested inner interpolation (e.g. the URL-building
  // `${X:+:${X}}` form) must not classify the enclosing occurrence by the
  // inner one's shape.
  const m = /^\$\{([A-Z_][A-Z0-9_]*)([^}])?/.exec(raw);
  const sep = m[2];
  if (sep === undefined) return 'bare';
  if (sep === ':') {
    const next = raw[m[0].length];
    if (next === '+') return 'presence';
    if (next === '?') return 'error';
    return 'default'; // :- (unset-or-empty) and :- (unset-only)
  }
  if (sep === '+') return 'presence';
  if (sep === '?') return 'error';
  return 'default'; // - (unset-only)
}

/**
 * Every TOP-LEVEL `${VAR...}` interpolation in the compose file, classified
 * by form, with its line number. Comment-only lines are skipped (same rule
 * as `parseComposeEnvVars`) so a comment that merely NAMES a knob is not a
 * form occurrence.
 *
 * Nested interpolations (e.g. the URL-building form
 * `${NGINX_HTTPS_PORT:+:${NGINX_HTTPS_PORT}}`) are consumed with their
 * enclosing expression and classified by the enclosing form only — the
 * inner occurrence is part of that expression's value, not an independent
 * use of the variable.
 *
 * @param {string} content - raw docker-compose.yaml content
 * @returns {Array<{name: string, form: string, line: number, raw: string}>}
 */
function collectInterpolations(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('#')) continue;
    const line = lines[i];
    let pos = 0;
    for (;;) {
      const start = line.indexOf('${', pos);
      if (start === -1) break;
      const nameMatch = /^\$\{([A-Z_][A-Z0-9_]*)/.exec(line.slice(start));
      if (!nameMatch) {
        pos = start + 2;
        continue;
      }
      // Find the matching closing brace, honouring nested `${...}`.
      let depth = 1;
      let j = start + 2;
      while (j < line.length && depth > 0) {
        if (line.startsWith('${', j)) {
          depth += 1;
          j += 2;
        } else if (line[j] === '}') {
          depth -= 1;
          j += 1;
        } else {
          j += 1;
        }
      }
      if (depth !== 0) break; // unbalanced — nothing more to classify here
      const raw = line.slice(start, j);
      out.push({ name: nameMatch[1], form: classifyForm(raw), line: i + 1, raw });
      pos = j;
    }
  }
  return out;
}

/**
 * Variables whose interpolation forms disagree across the file.
 *
 * @param {string} content - raw docker-compose.yaml content
 * @returns {Array<{name: string, forms: Record<string, number[]>, message: string}>}
 */
function findMixedInterpolationForms(content) {
  const occurrences = collectInterpolations(content);
  const byVar = new Map();
  for (const occ of occurrences) {
    if (occ.form === 'presence') continue;
    if (!byVar.has(occ.name)) byVar.set(occ.name, {});
    const forms = byVar.get(occ.name);
    (forms[occ.form] = forms[occ.form] || []).push(occ.line);
  }
  const mixed = [];
  for (const [name, forms] of byVar) {
    const kinds = Object.keys(forms);
    if (kinds.length <= 1) continue;
    const detail = kinds.map((k) => `${k} at line${forms[k].length > 1 ? 's' : ''} ${forms[k].join(', ')}`).join('; ');
    mixed.push({
      name,
      forms,
      message: `${name} is interpolated with mixed forms — ${detail}. Pick ONE form per variable: a bare \${VAR} and a defaulted \${VAR:-x} deliver different values to different services when the variable is unset (#1074).`
    });
  }
  return mixed.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { classifyForm, collectInterpolations, findMixedInterpolationForms };
