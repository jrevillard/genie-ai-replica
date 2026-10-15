// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// !1073 — the env→compose direction, which no check asserted.
//
// The generic sweep (`crossReference`) computes `orphaned = env − compose`,
// but only the compose→env direction was asserted (AC2), and AC4's orphan gate
// subtracts a KNOWN_ORPHANS allowlist instead of requiring plumbing. Worse, all
// 28 affected knobs are documented as COMMENTED `# NAME=value` lines, which
// `parseEnvTemplate` skipped entirely — so they could not reach the orphan gate
// even in principle.
//
// The failure this produced is the expensive kind: an operator sets a
// documented knob in .env, nothing happens, and nothing says so. It was hit
// three separate times in one session.
//
// A variable counts as WIRED only if it appears in a service's `environment:`
// block. `parseComposeEnvVars` strips comment lines before matching, so a
// comment that merely NAMES a knob is not a wiring — the distinction that
// matters here.

/**
 * Documented-but-unwired knobs, from the commented `# NAME=value` channel.
 *
 * @param {Array<{name:string,value:string,section:string}>} documented - from parseEnvTemplate
 * @param {Array<{name:string}>} composeVars - from parseComposeEnvVars (comments already stripped)
 * @param {object} [opts]
 * @param {RegExp} [opts.prefix] - only consider variables matching this (default OKF_*)
 * @param {Set<string>} [opts.allowlist] - names exempt, each with a written justification
 * @returns {{ unwired: Array<{name:string,section:string,value:string}>, allowlisted: string[], prefix: string }}
 */
function findUnwiredDocumented(documented, composeVars, opts = {}) {
  const prefix = opts.prefix || /^OKF_/;
  const allowlist = opts.allowlist || new Set();
  const wired = new Set(composeVars.map((v) => v.name));

  const unwired = [];
  const allowlisted = [];
  for (const d of documented || []) {
    if (!prefix.test(d.name)) continue;
    if (wired.has(d.name)) continue;
    if (allowlist.has(d.name)) {
      allowlisted.push(d.name);
      continue;
    }
    unwired.push({ name: d.name, section: d.section, value: d.value });
  }
  return { unwired, allowlisted, prefix: prefix.source };
}

/**
 * Documented knobs that appear in `env` more than once, with their values.
 *
 * `env` documents 22 OKF_* knobs in TWO sections each — the operator-facing
 * block and a deeper reference section. They agree today; nothing enforces it.
 * That is the same "the same fact stated in two places" shape as BUG-11 (the
 * type enum), BUG-12 (the hardcoded counters) and BUG-15 (the tag ceilings), all
 * of which drifted. Worth a guard rather than a refactor of `env`.
 *
 * SCOPED BY PREFIX ON PURPOSE. Unscoped it flags 12 legitimate multi-context
 * examples — `<gateway-node-fqdn>`, `secret`, `https://${GPU_NODE_HOST}/llm` —
 * where Section 1 documents a local install and Section 14 a remote GPU node.
 * Those are not contradictions; they are two different deployments. The
 * duplication worth policing is within one knob family.
 *
 * @param {Array<{name:string,value:string}>} documented - from parseEnvTemplate
 * @param {object} [opts]
 * @param {RegExp} [opts.prefix] - only consider variables matching this (default OKF_*)
 * @returns {Array<{name:string, values: string[], count: number}>}
 */
function findDuplicatedDocumented(documented, opts = {}) {
  const prefix = opts.prefix || /^OKF_/;
  const byName = new Map();
  for (const d of documented || []) {
    if (!prefix.test(d.name)) continue;
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d.value);
  }
  const out = [];
  for (const [name, values] of byName) {
    if (values.length > 1) out.push({ name, values: [...new Set(values)], count: values.length });
  }
  return out;
}

module.exports = { findUnwiredDocumented, findDuplicatedDocumented };
