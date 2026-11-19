const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../../..');
const CI_FILE = path.join(ROOT, '.gitlab-ci.yml');

// The PRD umbrella branch rules (#2010).
//
// The umbrella branch `feat/agentic-foundations/prd` is a protected merge
// target: every PRD story merge request targets it. Without a pipeline of its
// own on that branch, the scan-result policies have no target pipeline to
// compare the merge request's pipeline against, and the DPG license rule —
// which declares no `fallback_behavior`, so GitLab's empty default makes it
// fail closed — demands a Maintainer approval the umbrella does not need.
//
// Four properties make that work, and none of them is visible to a "the CI
// file still parses" check:
//
//   1. `workflow:rules` — the `*/prd` entry must not be shadowed by an entry
//      placed above it. GitLab takes the FIRST matching rule, so that earlier
//      entry decides the pipeline instead of the umbrella one.
//   2. `.security_run_rules` — the security suite must run on that branch's
//      pipeline, for the same reason: an entry placed above the `*/prd` entry
//      that suppresses the pipeline skips the security jobs.
//   3. the gemnasium dependency-scanning job must run there too — it is what
//      uploads the SBOM the license rule compares the target pipeline against.
//   4. both entries must cover the whole `*/prd` family, not one branch of it.
//
// The rules are read as STRUCTURE (a YAML parse), not as text: what these
// checks are about is order, the presence of a `when:` key, and which job
// consumes which list — none of which survives a scan that pins one exact
// spelling of one line. The repository root already depends on js-yaml.

const UMBRELLA_BRANCHES = ['feat/agentic-foundations/prd', 'feat/server-side-tools/prd'];
const SUPPRESSING_WHEN = ['never', 'manual'];

let ci;
try {
  ci = yaml.load(fs.readFileSync(CI_FILE, 'utf8'));
} catch (error) {
  throw new Error(
    '.gitlab-ci.yml must stay parseable by js-yaml, which rejects duplicate keys and ' +
      `unknown tags (a \`!reference\` would break this guard): ${error.message}`,
    { cause: error }
  );
}

const workflowRules = ci.workflow.rules;
const securityRules = ci['.security_run_rules'];

function conditionOf(rule) {
  return rule && typeof rule.if === 'string' ? rule.if : '';
}

// The branch pattern a condition states, when it states one. GitLab reads the
// literal between the first `/` after the `=~` operator and the last `/` of
// the condition, so a condition that carries further conjuncts keeps its
// pattern — and `\/` (which YAML unescapes to `/` inside a double-quoted
// scalar) reads as the same pattern.
function patternOf(condition) {
  const operator = condition.indexOf('=~');
  if (operator === -1) return null;
  const start = condition.indexOf('/', operator);
  if (start === -1) return null;
  const end = condition.lastIndexOf('/');
  if (end <= start) return null;
  try {
    return new RegExp(condition.slice(start + 1, end));
  } catch {
    return null;
  }
}

// A rule that covers every umbrella branch: the pattern is applied to the
// branch variable, and it covers the whole `*/prd` family rather than one
// branch of it. Matching the BRANCH rather than one literal spelling is what
// makes this locator semantic.
function coversUmbrella(rule) {
  const condition = conditionOf(rule);
  if (!/\$CI_COMMIT_BRANCH\b/.test(condition)) return false;
  const pattern = patternOf(condition);
  if (!pattern) return false;
  return UMBRELLA_BRANCHES.every((branch) => pattern.test(branch));
}

function umbrellaEntries(rules) {
  return (rules || []).filter(coversUmbrella);
}

// The branch pattern of a rule, normalized: `\/` and `/` denote the same
// character (YAML unescapes the first inside a double-quoted scalar), so the
// two spellings must compare equal.
function normalizedPattern(rule) {
  const pattern = patternOf(conditionOf(rule));
  if (!pattern) return null;
  return pattern.source.replace(/\\\//g, '/').replace(/\s+/g, '');
}

// Can one conjunct of a condition be true for a PUSH pipeline on an umbrella
// branch? GitLab evaluates `rules` in order and takes the first match, so a
// rule that can match such a push decides the outcome.
function conjunctMatchesPush(conjunct) {
  const text = conjunct.trim();
  if (!text) return true;

  let match = /^\$CI_PIPELINE_SOURCE\s*==\s*"([^"]*)"$/.exec(text);
  if (match) return match[1] === 'push';
  match = /^\$CI_PIPELINE_SOURCE\s*!=\s*"([^"]*)"$/.exec(text);
  if (match) return match[1] !== 'push';

  // A tag pipeline is not a branch push; its negation is.
  if (text === '$CI_COMMIT_TAG') return false;
  if (text === '!$CI_COMMIT_TAG') return true;

  match = /^\$CI_COMMIT_BRANCH\s*==\s*"([^"]*)"$/.exec(text);
  if (match) return UMBRELLA_BRANCHES.includes(match[1]);
  match = /^\$CI_COMMIT_BRANCH\s*!=\s*"([^"]*)"$/.exec(text);
  if (match) return !UMBRELLA_BRANCHES.includes(match[1]);

  // The default branch is not an umbrella branch.
  if (/^\$CI_COMMIT_BRANCH\s*==\s*\$CI_DEFAULT_BRANCH$/.test(text)) return false;
  if (/^\$CI_COMMIT_BRANCH\s*!=\s*\$CI_DEFAULT_BRANCH$/.test(text)) return true;

  const pattern = patternOf(text);
  if (pattern) return UMBRELLA_BRANCHES.some((branch) => pattern.test(branch));

  // An unknown shape is assumed to match: a new form of condition must not
  // pass unnoticed.
  return true;
}

function canMatchPushOnUmbrella(rule) {
  return conditionOf(rule)
    .split('&&')
    .every((conjunct) => conjunctMatchesPush(conjunct));
}

// The entries above `index` that would suppress the pipeline — and so the
// rules that would follow — if they matched a push on an umbrella branch.
function shadowingEntries(rules, index) {
  return rules.slice(0, index).filter((rule) => SUPPRESSING_WHEN.includes(rule.when) && canMatchPushOnUmbrella(rule));
}

describe('ci: the PRD umbrella branch rules (#2010)', () => {
  it('reads the real .gitlab-ci.yml', () => {
    expect(Array.isArray(workflowRules)).toBe(true);
    expect(Array.isArray(securityRules)).toBe(true);
  });

  it('grants the */prd branches a pipeline of their own', () => {
    expect(umbrellaEntries(workflowRules)).toHaveLength(1);
    expect(umbrellaEntries(securityRules)).toHaveLength(1);
  });

  it('never suppresses the umbrella rules themselves', () => {
    const rules = [...umbrellaEntries(workflowRules), ...umbrellaEntries(securityRules)];
    for (const rule of rules) {
      expect(SUPPRESSING_WHEN).not.toContain(rule.when);
    }
  });

  it('places the workflow rule where nothing can shadow it', () => {
    const index = workflowRules.indexOf(umbrellaEntries(workflowRules)[0]);
    expect(shadowingEntries(workflowRules, index)).toEqual([]);
  });

  it('places the security rule where nothing can shadow it', () => {
    const index = securityRules.indexOf(umbrellaEntries(securityRules)[0]);
    expect(shadowingEntries(securityRules, index)).toEqual([]);
  });

  it('keeps the two rules covering the same branches, so they cannot drift apart', () => {
    // The two rules are located independently (by the branches they cover), so
    // this compares two separately found conditions — not one literal with
    // itself.
    const workflowPattern = normalizedPattern(umbrellaEntries(workflowRules)[0]);
    const securityPattern = normalizedPattern(umbrellaEntries(securityRules)[0]);
    expect(workflowPattern).not.toBeNull();
    expect(securityPattern).not.toBeNull();
    expect(workflowPattern).toBe(securityPattern);
  });

  it('runs the SBOM uploader on the umbrella branch', () => {
    // The license rule compares the source pipeline against the target
    // pipeline's SBOM report, and the gemnasium dependency-scanning job is
    // what uploads it — so the umbrella's pipeline carries none without it.
    const job = ci['gemnasium-dependency_scanning'];
    expect(job).toBeDefined();
    expect(umbrellaEntries(job.rules)).toHaveLength(1);
  });

  it('keeps the SBOM uploader on the shared security rules', () => {
    // The job must consume the shared list itself: an inline copy that
    // forgets an entry silently drops the SBOM on some branches.
    expect(ci['gemnasium-dependency_scanning'].rules).toBe(securityRules);
  });

  it('keeps the shared security list complete', () => {
    // The entries that give the other branches their SBOM: dropping one
    // leaves those branches with a target pipeline that carries none.
    const conditions = securityRules.map(conditionOf);
    expect(conditions.some((condition) => /\$CI_PIPELINE_SOURCE\s*==\s*"schedule"/.test(condition))).toBe(true);
    expect(conditions.some((condition) => /\$CI_PIPELINE_SOURCE\s*==\s*"merge_request_event"/.test(condition))).toBe(
      true
    );
    expect(conditions.some((condition) => /\$CI_DEFAULT_BRANCH/.test(condition))).toBe(true);
    expect(conditions.some((condition) => /release/.test(condition))).toBe(true);
  });
});
