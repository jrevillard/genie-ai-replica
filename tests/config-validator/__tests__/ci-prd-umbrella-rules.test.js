const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const CI_FILE = path.join(ROOT, '.gitlab-ci.yml');

// The PRD umbrella branch rules (#2010).
//
// The umbrella branch `feat/agentic-foundations/prd` is a protected merge
// target: every PRD story merge request targets it. Without a pipeline of its
// own on that branch, the scan-result policies have no target pipeline to
// compare the merge request's pipeline against, and the DPG license rule
// (which declares no fallback) fails closed — it demands a Maintainer
// approval the umbrella does not need.
//
// Two rules make that work, and BOTH are load-bearing in a way that a plain
// "the CI file still parses" check cannot see:
//
//   1. `workflow:rules` — the `*/prd` entry must sit BEFORE the
//      push-suppression rule (`when: never`). GitLab takes the FIRST matching
//      rule, so an entry placed after it never applies to a push on a branch
//      that has an open merge request — which is exactly the umbrella.
//   2. `.security_run_rules` — the security suite must run on that branch's
//      pipeline, because the license rule compares against the target
//      pipeline's SBOM report, and the gemnasium dependency-scanning job is
//      what uploads it.
//
// The failure mode of losing either is silent: the CI file still parses, the
// pipeline is still green, and the merge requests simply keep demanding the
// approval. These checks make that loud.
//
// The suite has no YAML parser (docker-compose.yaml is not valid YAML, so
// parse-compose.js scans text), so this check scans text too — the rules it
// pins are single-line `if:` entries, which is exactly how they are written.

const PRD_RULE_LINE = /^\s*- if: \$CI_COMMIT_BRANCH =~ \/\\\/prd\$\/\s*$/;
const SUPPRESS_RULE_LINE = /^\s*- if: \$CI_COMMIT_BRANCH && \$CI_OPEN_MERGE_REQUESTS/;

const lines = fs.readFileSync(CI_FILE, 'utf8').split('\n');

function blockAfter(headerPattern) {
  const start = lines.findIndex((line) => headerPattern.test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line));
  return { start, end: end === -1 ? lines.length : end };
}

function findRuleLines(block) {
  const found = [];
  for (let index = block.start; index < block.end; index += 1) {
    if (PRD_RULE_LINE.test(lines[index])) found.push(index);
  }
  return found;
}

describe('ci: the PRD umbrella branch rules (#2010)', () => {
  const workflow = blockAfter(/^workflow:\s*$/);
  const security = blockAfter(/^\.security_run_rules:/);

  it('reads the real .gitlab-ci.yml', () => {
    expect(workflow).not.toBeNull();
    expect(security).not.toBeNull();
  });

  it('grants the */prd branches a pipeline of their own', () => {
    expect(findRuleLines(workflow)).toHaveLength(1);
    expect(findRuleLines(security)).toHaveLength(1);
  });

  it('places the workflow rule BEFORE the push-suppression rule', () => {
    const prdIndex = findRuleLines(workflow)[0];
    const suppressIndex = lines.findIndex(
      (line, index) => index > workflow.start && index < workflow.end && SUPPRESS_RULE_LINE.test(line)
    );
    expect(suppressIndex).toBeGreaterThan(-1);
    // GitLab takes the first matching workflow rule: an entry after the
    // `when: never` suppression never applies to a push on a branch that has
    // an open merge request.
    expect(prdIndex).toBeLessThan(suppressIndex);
  });

  it('keeps the two conditions identical, so they cannot drift apart', () => {
    const workflowCondition = lines[findRuleLines(workflow)[0]].trim();
    const securityCondition = lines[findRuleLines(security)[0]].trim();
    expect(workflowCondition).toBe(securityCondition);
  });
});
