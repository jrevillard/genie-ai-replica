const path = require('path');
const yaml = require('js-yaml');
const { readFileOrThrow } = require('../validators/parse-env-template');

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
// Five properties make that work, and none of them is visible to a "the CI
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
//   5. both entries must admit a PUSH pipeline on an umbrella branch, without
//      depending on the merge-request state.
//
// The rules are read as STRUCTURE (a YAML parse), not as text: what these
// checks are about is order, the presence of a `when:` key, and which job
// consumes which list — none of which survives a scan that pins one exact
// spelling of one line. The repository root already depends on js-yaml.

const UMBRELLA_BRANCHES = ['feat/agentic-foundations/prd', 'feat/server-side-tools/prd'];
// A member of the protected `*/prd` family that does not exist today: the
// rule must cover the family, not the branches it happens to know.
const PRD_FAMILY_PROBE = 'other/prd';
// The project's default branch: the CI file compares against it through
// `$CI_DEFAULT_BRANCH`, and a condition naming it cannot match an umbrella
// branch nor a story branch.
const DEFAULT_BRANCH = 'main';
const SUPPRESSING_WHEN = ['never', 'manual'];

const ciFile = readFileOrThrow(CI_FILE, 'GitLab CI file');

let ci;
try {
  ci = yaml.load(ciFile);
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

// The branch pattern a condition states, when it states one. GitLab ends the
// literal at the first unescaped `/` after the `=~` operator, so the scan
// honours the `\/` escape: `/\/prd$/` carries the pattern `\/prd$`.
function patternOf(condition) {
  const operator = condition.indexOf('=~');
  if (operator === -1) return null;
  let index = condition.indexOf('/', operator);
  if (index === -1) return null;
  let source = '';
  for (index += 1; index < condition.length; index += 1) {
    const character = condition[index];
    if (character === '\\') {
      source += character + (condition[index + 1] || '');
      index += 1;
      continue;
    }
    if (character === '/') break;
    source += character;
  }
  if (!source) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

// The variable a condition applies its pattern to. The pattern must be
// applied to the branch variable: applied to anything else, the rule never
// matches a branch pipeline.
function operandOf(condition) {
  const at = condition.indexOf('=~');
  if (at === -1) return null;
  const match = /([$A-Za-z_][$A-Za-z0-9_]*)\s*$/.exec(condition.slice(0, at));
  return match ? match[1] : null;
}

// A rule that covers every umbrella branch: the pattern is applied to the
// branch variable, and it covers the whole `*/prd` family rather than one
// branch of it. Matching the BRANCH rather than one literal spelling is what
// makes this locator semantic.
function coversUmbrella(rule) {
  const condition = conditionOf(rule);
  if (operandOf(condition) !== '$CI_COMMIT_BRANCH') return false;
  const pattern = patternOf(condition);
  if (!pattern) return false;
  return UMBRELLA_BRANCHES.every((branch) => pattern.test(branch)) && pattern.test(PRD_FAMILY_PROBE);
}

function umbrellaEntries(rules) {
  return (rules || []).filter(coversUmbrella);
}

// The branch pattern of a rule, normalized: `\/` and `/` denote the same
// character, so the two spellings must compare equal.
function normalizedPattern(rule) {
  const pattern = patternOf(conditionOf(rule));
  if (!pattern) return null;
  return pattern.source.replace(/\\\//g, '/').replace(/\s+/g, '');
}

// The branch a pipeline of the given kind runs on, as far as a condition can
// name it: the umbrella's own branch for a push, the merge request's source
// branch for a merge-request pipeline. A story branch is neither an umbrella
// branch nor the default branch.
function branchConjunctMatches(text, kind) {
  let match = /^\$CI_COMMIT_BRANCH\s*==\s*"([^"]*)"$/.exec(text);
  if (match) {
    if (kind === 'push') return UMBRELLA_BRANCHES.includes(match[1]);
    return match[1] !== DEFAULT_BRANCH && !UMBRELLA_BRANCHES.includes(match[1]);
  }
  match = /^\$CI_COMMIT_BRANCH\s*!=\s*"([^"]*)"$/.exec(text);
  if (match) {
    if (kind === 'push') return !UMBRELLA_BRANCHES.includes(match[1]);
    return match[1] === DEFAULT_BRANCH || UMBRELLA_BRANCHES.includes(match[1]);
  }
  // The default branch is neither an umbrella branch nor a story branch.
  if (/^\$CI_COMMIT_BRANCH\s*==\s*\$CI_DEFAULT_BRANCH$/.test(text)) return false;
  if (/^\$CI_COMMIT_BRANCH\s*!=\s*\$CI_DEFAULT_BRANCH$/.test(text)) return true;
  return null;
}

// Can one conjunct of a condition be true for a pipeline of the given kind on
// an umbrella branch? `kind` is the pipeline source GitLab would create:
// `push` (the umbrella's own branch pipeline) or `merge_request_event` (the
// story merge requests' pipeline, whose source branch is the story branch).
// `openMergeRequests` says whether merge requests are open on the umbrella:
// the pipeline the umbrella needs must not depend on that state, but an entry
// that suppresses while merge requests ARE open does shadow the push today.
function conjunctMatches(conjunct, kind, openMergeRequests) {
  const text = conjunct.trim();
  if (!text) return true;

  let match = /^\$CI_PIPELINE_SOURCE\s*==\s*"([^"]*)"$/.exec(text);
  if (match) return match[1] === kind;
  match = /^\$CI_PIPELINE_SOURCE\s*!=\s*"([^"]*)"$/.exec(text);
  if (match) return match[1] !== kind;

  // A tag pipeline is neither of the two kinds; its negation is.
  if (text === '$CI_COMMIT_TAG') return false;
  if (text === '!$CI_COMMIT_TAG') return true;

  if (text === '$CI_OPEN_MERGE_REQUESTS') return openMergeRequests;

  const branch = branchConjunctMatches(text, kind);
  if (branch !== null) return branch;

  const pattern = patternOf(text);
  if (pattern) {
    return kind === 'push' ? UMBRELLA_BRANCHES.some((branch) => pattern.test(branch)) : true;
  }

  // An unknown shape is assumed to match: a new form of condition must not
  // pass unnoticed.
  return true;
}

function canMatchOnUmbrella(rule, kind, openMergeRequests) {
  return conditionOf(rule)
    .split('&&')
    .every((conjunct) => conjunctMatches(conjunct, kind, openMergeRequests));
}

// The entries above `index` that would suppress a pipeline the umbrella
// needs — its own push pipeline, or the merge-request pipeline of a story
// merge request that targets it — if they matched one.
function shadowingEntries(rules, index) {
  return rules
    .slice(0, index)
    .filter(
      (rule) =>
        SUPPRESSING_WHEN.includes(rule.when) &&
        (canMatchOnUmbrella(rule, 'push', true) || canMatchOnUmbrella(rule, 'merge_request_event', true))
    );
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

  it('grants the umbrella a push pipeline, whatever the merge-request state', () => {
    // The rule must BE the branch condition: a conjunct of its own (a
    // pipeline source, an open merge request, anything this guard does not
    // model) could gate the umbrella's push pipeline away — and with it the
    // target pipeline the policies need. One conjunct, and that conjunct the
    // branch pattern the locator already matched.
    const rules = [...umbrellaEntries(workflowRules), ...umbrellaEntries(securityRules)];
    for (const rule of rules) {
      expect(conditionOf(rule).split('&&')).toHaveLength(1);
      expect(canMatchOnUmbrella(rule, 'push', false)).toBe(true);
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

  it('keeps the security suite on the shared security rules', () => {
    // Every consumer must consume the shared list itself: an inline copy that
    // forgets an entry silently drops that job on some branches.
    for (const job of [
      'secret_detection',
      'semgrep-sast',
      'gemnasium-dependency_scanning',
      'gemnasium-python-dependency_scanning',
      'kics-iac-sast'
    ]) {
      expect(ci[job].rules).toBe(securityRules);
    }
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
