// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// parse-ansible — extract the env vars deploy/ansible/templates/env.j2
// emits, with their defaults. Story 1-8 (David 2026-10-08): "the ansible
// deployment must be kept in step with the local deployment with the right
// env vars AND defaults" — this parser feeds the parity test that enforces
// it. env.j2 has no generic passthrough: every var is an explicit line,
// either unconditional `KEY={{ var | default('x') }}` or guarded by a
// `{% if %}` block (marked conditional — a guarded var still REACHES the
// rendered .env whenever the guard's group_var is set).

'use strict';

const DEFAULT_RE = /\|\s*default\('([^']*)'\)/;
// A default expression that is itself Jinja (inline conditionals etc.) —
// parity checks skip these; presence is still enforced.
const JINJA_EXPR_RE = /[~?]|gpu_node_host|is defined|is not/;

/**
 * @param {string} j2Text raw env.j2 content
 * @returns {Record<string, {count: number, default: string|null, defaultIsJinja: boolean, conditional: boolean}>}
 */
function parseAnsibleEnvVars(j2Text) {
  const lines = j2Text.split(/\r?\n/);
  const out = {};
  let conditional = false;
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Track guard context coarsely: a var emitted between {% if ... %} and
    // its {% endif %} is conditional. Nested ifs counted by depth.
    const opens = (trimmed.match(/{%\s*if /g) || []).length;
    const ends = (trimmed.match(/{%\s*endif/g) || []).length;
    // Guarded emissions put the key AFTER {% %} tags on the same line
    // (e.g. `{% endif %}{% if x %}KEY={{ x }}`) — allow any run of them.
    const m = trimmed.match(/^(?:\{%[^%]*%\}\s*)*([A-Z][A-Z0-9_]+)=(.*)$/);
    if (m) {
      const entry = out[m[1]] || { count: 0, default: null, defaultIsJinja: false, conditional: false };
      entry.count += 1;
      entry.conditional = entry.conditional || conditional || trimmed.startsWith('{% if');
      const dm = m[2].match(DEFAULT_RE);
      if (dm) {
        const isJinja = JINJA_EXPR_RE.test(m[2]);
        entry.defaultIsJinja = entry.defaultIsJinja || isJinja;
        if (entry.default === null && !isJinja) entry.default = dm[1];
      }
      out[m[1]] = entry;
    }
    depth += opens - ends;
    conditional = depth > 0;
  }
  return out;
}

module.exports = { parseAnsibleEnvVars };
