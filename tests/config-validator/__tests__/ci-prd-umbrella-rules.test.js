const path = require('path');
const yaml = require('js-yaml');
const { readFileOrThrow } = require('../validators/parse-env-template');

const ROOT = path.resolve(__dirname, '../../..');
const CI_FILE = path.join(ROOT, '.gitlab-ci.yml');

// The PRD umbrella branch rules (#2010).
//
// The `*/prd` umbrella branch is a protected merge target: every PRD story
// merge request targets it, and without a pipeline of its own the scan-result
// policies have no target pipeline to compare the merge request's pipeline
// against — the DPG license rule (which declares no `fallback_behavior`, so
// GitLab's empty default makes it fail closed) then demands a Maintainer
// approval the umbrella does not need. The CI file's own comments state that
// mechanism; these are the properties they rely on:
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
// A branch the protected pattern does NOT cover, whose name carries the same
// word: the rule must not reach past the family.
const PRD_OUTSIDE_PROBE = 'feature/prd-work';
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

// The operand and the pattern of a `=~` condition, in one scan. GitLab ends
// the literal at the first unescaped `/` after the operator, so the capture
// honours the `\/` escape: `/\/prd$/` carries the pattern `\/prd$`. An empty
// literal is no literal at all.
function regexOf(condition) {
  const match = /([$A-Za-z_][$A-Za-z0-9_]*)\s*=~\s*\/((?:\\.|[^/\\])*)\//.exec(condition);
  if (!match || !match[2]) return null;
  try {
    return { operand: match[1], pattern: new RegExp(match[2]) };
  } catch {
    return null;
  }
}

// A rule that covers every umbrella branch: the pattern is applied to the
// branch variable, and it covers the whole `*/prd` family rather than one
// branch of it. Matching the BRANCH rather than one literal spelling is what
// makes this locator semantic.
function coversUmbrella(rule) {
  const regex = regexOf(conditionOf(rule));
  if (!regex || regex.operand !== '$CI_COMMIT_BRANCH') return false;
  return (
    UMBRELLA_BRANCHES.every((branch) => regex.pattern.test(branch)) &&
    regex.pattern.test(PRD_FAMILY_PROBE) &&
    !regex.pattern.test(PRD_OUTSIDE_PROBE)
  );
}

function umbrellaEntries(rules) {
  return (rules || []).filter(coversUmbrella);
}

const workflowUmbrella = umbrellaEntries(workflowRules);
const securityUmbrella = umbrellaEntries(securityRules);
const umbrellaRules = [...workflowUmbrella, ...securityUmbrella];

// The branch pattern of a rule, normalized: `\/` and `/` denote the same
// character, so the two spellings must compare equal.
function normalizedPattern(rule) {
  const regex = regexOf(conditionOf(rule));
  if (!regex) return null;
  return regex.pattern.source.replace(/\\\//g, '/').replace(/\s+/g, '');
}

// Is this the branch a pipeline of the given kind runs on? The umbrella's own
// branch for a push, the merge request's source branch for a merge-request
// pipeline. A story branch is neither an umbrella branch nor the default one.
function isPipelineBranch(branch, kind) {
  if (kind === 'push') return UMBRELLA_BRANCHES.includes(branch);
  return branch !== DEFAULT_BRANCH && !UMBRELLA_BRANCHES.includes(branch);
}

function branchConjunctMatches(text, kind) {
  const match = /^\$CI_COMMIT_BRANCH\s*(==|!=)\s*(?:"([^"]*)"|\$CI_DEFAULT_BRANCH)$/.exec(text);
  if (!match) return null;
  const branch = match[2] === undefined ? DEFAULT_BRANCH : match[2];
  const isOfKind = isPipelineBranch(branch, kind);
  return match[1] === '==' ? isOfKind : !isOfKind;
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

  const regex = regexOf(text);
  if (regex) {
    return kind === 'push' ? UMBRELLA_BRANCHES.some((branch) => regex.pattern.test(branch)) : true;
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

// The entries above the umbrella rule that would suppress a pipeline the
// umbrella needs — its own push pipeline, or the merge-request pipeline of a
// story merge request that targets it — if they matched one.
function shadowingEntries(rules) {
  return rules
    .slice(0, rules.findIndex(coversUmbrella))
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
    expect(workflowUmbrella).toHaveLength(1);
    expect(securityUmbrella).toHaveLength(1);
  });

  it('never suppresses the umbrella rules themselves', () => {
    expect(umbrellaRules).toHaveLength(2);
    for (const rule of umbrellaRules) {
      expect(SUPPRESSING_WHEN).not.toContain(rule.when);
    }
  });

  it('grants the umbrella a push pipeline, whatever the merge-request state', () => {
    // The rule must admit a PUSH pipeline on an umbrella branch, whatever
    // the merge-request state: a condition that admits only merge-request
    // pipelines (or only another source) leaves the umbrella with no branch
    // pipeline at all — and the policies with no target again.
    expect(umbrellaRules).toHaveLength(2);
    for (const rule of umbrellaRules) {
      expect(canMatchOnUmbrella(rule, 'push', false)).toBe(true);
    }
  });

  it.each([
    ['workflow', workflowRules],
    ['security', securityRules]
  ])('places the %s rule where nothing can shadow it', (_name, rules) => {
    expect(rules.findIndex(coversUmbrella)).toBeGreaterThanOrEqual(0);
    expect(shadowingEntries(rules)).toEqual([]);
  });

  it('keeps the two rules covering the same branches, so they cannot drift apart', () => {
    // The two rules are located independently (by the branches they cover), so
    // this compares two separately found conditions — not one literal with
    // itself.
    const workflowPattern = normalizedPattern(workflowUmbrella[0]);
    const securityPattern = normalizedPattern(securityUmbrella[0]);
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

  it.each([
    ['the schedule entry', /\$CI_PIPELINE_SOURCE\s*==\s*"schedule"/],
    ['the merge_request_event entry', /\$CI_PIPELINE_SOURCE\s*==\s*"merge_request_event"/],
    ['the default-branch entry', /\$CI_DEFAULT_BRANCH/],
    ['the release entry', /release/]
  ])('keeps %s in the shared security list', (_name, expression) => {
    // The entries that give the other branches their SBOM: dropping one
    // leaves those branches with a target pipeline that carries none.
    expect(securityRules.map(conditionOf).some((condition) => expression.test(condition))).toBe(true);
  });
});
