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
// Three properties make that work, and none of them is visible to a "the CI
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
//
// The failure mode of losing any of them is silent: the CI file still parses,
// the pipeline is still green, and the merge requests simply keep demanding
// the approval.
//
// The rules are read as STRUCTURE (a YAML parse), not as text: what these
// checks are about is order, the presence of a `when:` key, and which job
// consumes which list — none of which survives a scan that pins one exact
// spelling of one line. The repository root already depends on js-yaml.

const UMBRELLA = 'feat/agentic-foundations/prd';
const SUPPRESSING_WHEN = ['never', 'manual'];

const ci = yaml.load(fs.readFileSync(CI_FILE, 'utf8'));

const workflowRules = ci.workflow.rules;
const securityRules = ci['.security_run_rules'];

function conditionOf(rule) {
  return rule && typeof rule.if === 'string' ? rule.if : '';
}

// The branch pattern a condition matches, when it states one.
function branchPattern(rule) {
  const match = /=~\s*\/(.+)\/\s*$/.exec(conditionOf(rule));
  if (!match) return null;
  try {
    return new RegExp(match[1]);
  } catch {
    return null;
  }
}

// A condition that covers the umbrella branch. Matching the BRANCH rather
// than one literal spelling is what makes this locator semantic: quoting,
// spacing and the pattern's wording do not matter, but a condition that stops
// covering the umbrella is caught.
function coversUmbrella(rule) {
  const pattern = branchPattern(rule);
  return pattern !== null && pattern.test(UMBRELLA);
}

function umbrellaEntries(rules) {
  return (rules || []).filter(coversUmbrella);
}

// The branch pattern a condition states, normalized: `\/` and `/` denote the
// same character (YAML unescapes the first inside a double-quoted scalar),
// so the two spellings must compare equal.
function normalizedPattern(rule) {
  const pattern = branchPattern(rule);
  if (!pattern) return null;
  return pattern.source.replace(/\\\//g, '/').replace(/\s+/g, '');
}

// Can this rule match a PUSH pipeline on the umbrella branch? A rule that
// cannot is harmless above the umbrella entry, whatever its `when:` says.
function canMatchPushOnUmbrella(rule) {
  const condition = conditionOf(rule);

  // A condition pinned to one pipeline source only matches pipelines of that
  // source, and a push is not it.
  const source = /\$CI_PIPELINE_SOURCE\s*==\s*"([^"]+)"/.exec(condition);
  if (source && source[1] !== 'push') return false;

  // A branch pattern that does not cover the umbrella cannot match it.
  const pattern = branchPattern(rule);
  if (pattern && !pattern.test(UMBRELLA)) return false;

  // The default branch is not the umbrella, and a tag pipeline is not a push.
  if (/\$CI_DEFAULT_BRANCH/.test(condition)) return false;
  if (/\$CI_COMMIT_TAG/.test(condition)) return false;

  return true;
}

// The entries above `index` that would suppress the pipeline — and so the
// rules that would follow — if they matched a push on the umbrella.
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
    // The two rules are located independently (by the branch they cover), so
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
});
