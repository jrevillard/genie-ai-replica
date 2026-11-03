const path = require('path');
const fs = require('fs');
const { extractCiShellBlocks } = require('../validators/extract-ci-shell');
const { checkShellSyntax } = require('../validators/check-ci-shell');

const ROOT = path.resolve(__dirname, '../../..');
const CI_FILE = path.join(ROOT, '.gitlab-ci.yml');

// The shell-syntax gate (#1306, #1322): every multiline script item embedded
// in .gitlab-ci.yml is shell-extracted and parsed with `bash -n`. Nothing
// else in the pipeline parses that shell — the pipeline lint validates YAML
// structure only — so a stray `done` or an unbalanced quote ships green
// until the first merge train (measured on !674). The fixtures below pin
// the extraction shapes the file uses today; an unhandled shape fails
// loudly instead of silently leaving shell unextracted.

const FIXTURE = `
.node_base:
  image: node:20-alpine

job-one:
  stage: lint
  script:
    - echo "plain item"
    - |
      for x in a b; do
        echo "$x"
      done
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
      when: never

.other_job:
  before_script:
    - >
      apt-get update &&
      apt-get install -y curl
`;

describe('ci shell gate: extraction', () => {
  test('extracts plain list items with owner attribution', () => {
    const { blocks, errors } = extractCiShellBlocks(FIXTURE);
    expect(errors).toEqual([]);
    const plain = blocks.find((b) => b.text === 'echo "plain item"');
    expect(plain).toBeDefined();
    expect(plain.owner).toBe('job-one');
    expect(plain.key).toBe('script');
    expect(plain.startLine).toBeGreaterThan(0);
  });

  test('extracts literal block scalar items verbatim', () => {
    const { blocks } = extractCiShellBlocks(FIXTURE);
    const literal = blocks.find((b) => b.text.includes('for x in a b'));
    expect(literal).toBeDefined();
    expect(literal.owner).toBe('job-one');
    // The scalar body keeps its newlines — bash sees a loop, not a fold.
    expect(literal.text).toBe('for x in a b; do\n  echo "$x"\ndone');
  });

  test('extracts folded block scalar items', () => {
    const { blocks } = extractCiShellBlocks(FIXTURE);
    const folded = blocks.find((b) => b.text.includes('apt-get update'));
    expect(folded).toBeDefined();
    expect(folded.owner).toBe('.other_job');
    expect(folded.key).toBe('before_script');
  });

  test('the list ends at the next sibling key', () => {
    const { blocks } = extractCiShellBlocks(FIXTURE);
    // `- if: ...` under rules: is YAML, not shell — it must not be captured.
    expect(blocks.some((b) => b.text.includes('CI_PIPELINE_SOURCE'))).toBe(false);
    expect(blocks.some((b) => b.text.includes('when: never'))).toBe(false);
  });

  test('an unhandled script shape is reported as an error, not skipped', () => {
    const inline = 'job:\n  script: npm test\n';
    const { errors } = extractCiShellBlocks(inline);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('script');
  });
});

describe('ci shell gate: bash -n', () => {
  test('a stray done fails — the !674 class', () => {
    const content = 'job:\n  script:\n    - |\n      for x in a b; do\n        echo "$x"\n      done\n      done\n';
    const { blocks } = extractCiShellBlocks(content);
    const errors = checkShellSyntax(blocks);
    expect(errors).toHaveLength(1);
    expect(errors[0].owner).toBe('job');
    expect(errors[0].message).toMatch(/syntax error/);
  });

  test('an unbalanced quote fails', () => {
    const content = 'job:\n  script:\n    - echo "unterminated\n';
    const { blocks } = extractCiShellBlocks(content);
    expect(checkShellSyntax(blocks)).toHaveLength(1);
  });

  test('good shell passes', () => {
    const { blocks } = extractCiShellBlocks(FIXTURE);
    expect(checkShellSyntax(blocks)).toEqual([]);
  });

  test('missing bash fails loudly instead of passing vacuously', () => {
    // Determinism: a gate that cannot run must not read as green.
    expect(() =>
      checkShellSyntax([{ owner: 'j', key: 'script', startLine: 1, text: 'echo hi' }], {
        bashPath: '/nonexistent/bash'
      })
    ).toThrow(/bash/);
  });
});

describe('ci shell gate: the real .gitlab-ci.yml', () => {
  const { blocks, errors } = extractCiShellBlocks(fs.readFileSync(CI_FILE, 'utf-8'));

  test('extracts a non-trivial number of blocks (the gate must not go vacuous)', () => {
    // If extraction collapses to zero, every assertion below passes on an
    // empty set and the gate is gone while still green. The file carries
    // ~100 script items today; a floor of 10 survives large refactors
    // while still catching a vanished extraction.
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });

  test('no unhandled script shapes', () => {
    expect(errors).toEqual([]);
  });

  test('every extracted block passes bash -n', () => {
    expect(checkShellSyntax(blocks)).toEqual([]);
  });
});
