const path = require('path');
const fs = require('fs');
const { extractCiShellBlocks } = require('../validators/extract-ci-shell');
const { checkShellSyntax } = require('../validators/check-ci-shell');

const ROOT = path.resolve(__dirname, '../../..');
const CI_FILE = path.join(ROOT, '.gitlab-ci.yml');

// The shell-syntax gate (#1306, #1322): every multiline script item embedded
// in .gitlab-ci.yml is shell-extracted and parsed with `bash -n`. The full
// rationale lives in the extractor's header comment (extract-ci-shell.js);
// the fixtures below pin the extraction shapes and the fail-loud contract
// for shapes the extractor does not understand.

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
    // Exact pin: the bash -n failure line mapping depends on this number.
    expect(plain.startLine).toBe(8);
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

  test('extracts an inline scalar value (script: npm test)', () => {
    const content = 'job:\n  script: npm test\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('npm test');
    expect(blocks[0].startLine).toBe(2);
  });

  test('extracts a key-level alias (script: *anchor)', () => {
    const content = ['.shared: &shared', '  - echo from anchor', '', 'job:', '  script: *shared'].join('\n');
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    const anchored = blocks.find((b) => b.text === 'echo from anchor');
    expect(anchored).toBeDefined();
    expect(anchored.owner).toBe('.shared');
  });

  test('an unhandled script shape (unknown tag) is reported as an error, not skipped', () => {
    const tagged = 'job:\n  script: !reference [.x]\n';
    const { errors } = extractCiShellBlocks(tagged);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('script');
  });

  test('extracts a same-indent YAML sequence (dash at the key indent)', () => {
    const content = 'job:\n  script:\n  - echo hi\n  - echo bye\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks.map((b) => b.text)).toEqual(['echo hi', 'echo bye']);
  });

  test('extracts a key-level block scalar (script: |)', () => {
    const content = 'job:\n  script: |\n    echo one\n    echo two\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('echo one\necho two');
    expect(blocks[0].owner).toBe('job');
  });

  describe('anchor definitions + alias items', () => {
    const ALIAS = [
      '.net_setup: &net_setup',
      '  - |',
      '    docker network connect "$NET" || true',
      '    echo connected',
      '',
      'job:',
      '  script:',
      '    - echo before',
      '    - *net_setup',
      '    - echo after'
    ].join('\n');

    test('the anchor body is shell-extracted at its definition', () => {
      const { blocks, errors } = extractCiShellBlocks(ALIAS);
      expect(errors).toEqual([]);
      const anchored = blocks.find((b) => b.text.includes('docker network connect'));
      expect(anchored).toBeDefined();
      expect(anchored.owner).toBe('.net_setup');
    });

    test('a stray done inside the anchor body fails the gate', () => {
      const broken = ALIAS.replace('echo connected', 'done\necho connected');
      const { blocks } = extractCiShellBlocks(broken);
      expect(checkShellSyntax(blocks)).toHaveLength(1);
    });

    test('an alias to an unknown anchor is a loud error', () => {
      const unknown = 'job:\n  script:\n    - *nope\n';
      const { errors } = extractCiShellBlocks(unknown);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('nope');
    });

    test('an anchor defined on a script key can be aliased later', () => {
      const content = ['job-one:', '  script: &s |', '    echo anchored', 'job-two:', '  script: *s'].join('\n');
      const { blocks, errors } = extractCiShellBlocks(content);
      expect(errors).toEqual([]);
      // Two shells run: job-one's own script, and job-two through the
      // alias — both are checked.
      expect(blocks.map((b) => b.text)).toEqual(['echo anchored', 'echo anchored']);
    });

    test('an item-level anchor can be aliased from another job', () => {
      const content = ['job-one:', '  script:', '    - &first echo hi', 'job-two:', '  script:', '    - *first'].join(
        '\n'
      );
      const { blocks, errors } = extractCiShellBlocks(content);
      expect(errors).toEqual([]);
      expect(blocks.filter((b) => b.text === 'echo hi')).toHaveLength(2);
    });

    test('a scalar anchor body aliases as one block', () => {
      const content = ['.common: &common', '  echo hello', '', 'job:', '  script: *common'].join('\n');
      const { blocks, errors } = extractCiShellBlocks(content);
      expect(errors).toEqual([]);
      expect(blocks.map((b) => b.text)).toEqual(['echo hello']);
    });

    test('a mapping anchor body aliased into a script is a loud error', () => {
      const content = ['.tmpl: &tmpl', '  image: alpine', '', 'job:', '  script: *tmpl'].join('\n');
      const { errors } = extractCiShellBlocks(content);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/mapping|tmpl/);
    });
  });

  test('a folded block scalar folds like the runtime shell receives it', () => {
    // Runtime: the fold joins the two quoted fragments with a space — valid.
    // Verbatim extraction would see an unterminated quote and false-fail.
    const content = 'job:\n  script:\n    - >\n      echo "a\n      b"\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(checkShellSyntax(blocks)).toEqual([]);
    expect(blocks[0].text).toBe('echo "a b"');
  });

  test('a more-indented line inside a folded scalar stays literal', () => {
    const content = 'job:\n  script:\n    - >\n      echo a\n        echo b\n      echo c\n';
    const { blocks } = extractCiShellBlocks(content);
    // The break into the more-indented b stays literal (folding never
    // applies around a more-indented line); c is back at the base indent,
    // but the break after a more-indented line stays literal too.
    expect(blocks[0].text).toBe('echo a\n  echo b\necho c');
  });

  test('a flow-style job definition is a loud unhandled shape', () => {
    const content = 'job: {script: ["echo a"]}\n';
    const { errors } = extractCiShellBlocks(content);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/flow/);
  });

  test('a script key with a space before the colon still extracts', () => {
    const content = 'job:\n  script :\n    - echo hi\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks.map((b) => b.text)).toEqual(['echo hi']);
  });

  test('extraction errors carry the checker error shape', () => {
    const tagged = 'job:\n  script: !reference [.x]\n';
    const { errors } = extractCiShellBlocks(tagged);
    expect(errors[0]).toMatchObject({ owner: 'job', key: 'script', startLine: 2 });
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
    jest.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      error: Object.assign(new Error('spawn bash ENOENT'), { code: 'ENOENT' }),
      status: null,
      signal: null,
      stderr: '',
      stdout: ''
    });
    try {
      expect(() => checkShellSyntax([{ owner: 'j', key: 'script', startLine: 1, text: 'echo hi' }])).toThrow(
        /cannot run bash/
      );
    } finally {
      jest.restoreAllMocks();
    }
  });

  test('an abnormal bash exit with empty stderr still names the failure', () => {
    jest.spyOn(require('child_process'), 'spawnSync').mockReturnValue({
      status: null,
      signal: 'SIGSEGV',
      stderr: '',
      stdout: ''
    });
    try {
      const errors = checkShellSyntax([{ owner: 'j', key: 'script', startLine: 1, text: 'echo hi' }]);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/abnormal/);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('ci shell gate: runtime-accurate checking', () => {
  test('a loop split across items passes — GitLab concatenates them', () => {
    const content = 'job:\n  script:\n    - for x in a b; do\n    - echo "$x"\n    - done\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(3);
    expect(checkShellSyntax(blocks)).toEqual([]);
  });

  test('an error in a concatenated group attributes the right item and line', () => {
    const content = 'job:\n  script:\n    - echo ok\n    - echo "unterminated\n';
    const { blocks } = extractCiShellBlocks(content);
    const errors = checkShellSyntax(blocks);
    expect(errors).toHaveLength(1);
    expect(errors[0].startLine).toBe(4);
  });

  test('a script-shaped line inside a data block scalar is not extracted', () => {
    const content = [
      'job:',
      '  variables:',
      '    TXT: |',
      '      script: for x in a; do done',
      '  script:',
      '    - echo real'
    ].join('\n');
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('echo real');
    expect(checkShellSyntax(blocks)).toEqual([]);
  });

  test('a flow-sequence script value is a loud unhandled shape', () => {
    const content = 'job:\n  script: ["echo a", "done"]\n';
    const { errors } = extractCiShellBlocks(content);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/unhandled/);
  });

  test('an alias item with a trailing comment still resolves', () => {
    const content = [
      '.a: &a',
      '  - echo from anchor',
      '',
      'job:',
      '  script:',
      '    - *a  # reuse the shared setup'
    ].join('\n');
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks.some((b) => b.text === 'echo from anchor')).toBe(true);
    expect(blocks.some((b) => b.text.includes('*a'))).toBe(false);
  });

  test('an anchor token on the script key itself parses either value shape', () => {
    const scalar = 'job:\n  script: &s |\n    echo anchored\n';
    const s1 = extractCiShellBlocks(scalar);
    expect(s1.errors).toEqual([]);
    expect(s1.blocks.map((b) => b.text)).toEqual(['echo anchored']);

    const list = 'job:\n  script: &s\n    - echo anchored\n';
    const s2 = extractCiShellBlocks(list);
    expect(s2.errors).toEqual([]);
    expect(s2.blocks.map((b) => b.text)).toEqual(['echo anchored']);
  });

  test('a block scalar with an explicit indentation indicator (|2) extracts verbatim', () => {
    const content = 'job:\n  script:\n    - |2\n      echo a\n      echo b\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks[0].text).toBe('echo a\necho b');
  });

  test('block scalar startLine survives trailing blank lines', () => {
    const content = 'job:\n  script:\n    - |\n      echo a\n\n\n';
    const { blocks } = extractCiShellBlocks(content);
    expect(blocks[0].startLine).toBe(4);
    expect(blocks[0].text).toBe('echo a');
  });

  test('an anchor token on a script item is stripped, not parsed as shell', () => {
    const content = 'job:\n  script:\n    - &first echo hi\n    - echo hi\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks.map((b) => b.text)).toEqual(['echo hi', 'echo hi']);
  });

  test('a block scalar header may carry a trailing comment', () => {
    const item = 'job:\n  script:\n    - | # run the loop\n      echo a\n';
    const itemParsed = extractCiShellBlocks(item);
    expect(itemParsed.errors).toEqual([]);
    expect(itemParsed.blocks.map((b) => b.text)).toEqual(['echo a']);

    const key = 'job:\n  script: | # run the loop\n    echo a\n';
    const keyParsed = extractCiShellBlocks(key);
    expect(keyParsed.errors).toEqual([]);
    expect(keyParsed.blocks.map((b) => b.text)).toEqual(['echo a']);
  });

  test('a variable named script is data, not a script key', () => {
    const content = ['job:', '  variables:', '    script: echo "unterminated', '  script:', '    - echo real'].join(
      '\n'
    );
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks.map((b) => b.text)).toEqual(['echo real']);
    expect(checkShellSyntax(blocks)).toEqual([]);
  });

  test('empty flow collections are a legal no-op (no shell)', () => {
    const content = 'job:\n  before_script: []\n  script: {}\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(blocks).toEqual([]);
  });

  test('before_script and script are one runtime shell — a construct spanning them parses', () => {
    const content = 'job:\n  before_script:\n    - echo "start\n  script:\n    - end"\n';
    const { blocks, errors } = extractCiShellBlocks(content);
    expect(errors).toEqual([]);
    expect(checkShellSyntax(blocks)).toEqual([]);
  });

  test('after_script is a separate shell from script', () => {
    const content = 'job:\n  script:\n    - echo "open\n  after_script:\n    - echo still-open"\n';
    const { blocks } = extractCiShellBlocks(content);
    const errors = checkShellSyntax(blocks);
    expect(errors).toHaveLength(2); // each is unterminated on its own
  });
});

describe('ci shell gate: the real .gitlab-ci.yml', () => {
  const { blocks, errors } = extractCiShellBlocks(fs.readFileSync(CI_FILE, 'utf-8'));

  test('extraction is substantial and reaches the whole file (anti-vacuity)', () => {
    // If extraction collapses, every assertion below passes on an empty or
    // partial set and the gate is gone while still green. The floor guards
    // against wholesale collapse; the named owners guard against a shape
    // regression that silently drops one extraction family (a plain-key
    // job, the alias-carrying base, the shell anchor, a folded scalar).
    expect(blocks.length).toBeGreaterThanOrEqual(40);
    const owners = new Set(blocks.map((b) => b.owner));
    for (const expected of ['.e2e_web_base', '.connect_compose_network', 'config:validate']) {
      expect(owners.has(expected)).toBe(true);
    }
  });

  test('no unhandled script shapes', () => {
    expect(errors).toEqual([]);
  });

  test('every extracted block passes bash -n', () => {
    expect(checkShellSyntax(blocks)).toEqual([]);
  });
});
