// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  findTrackedIssue,
  specPathsIn,
  titleIsDedicatedTo,
  firstErrorReason,
  groupFailuresByFile,
  issueBody,
  isConnectionSignature,
  partitionVenueNoise,
  venueAvailabilityReport,
  fileTrackedFailures,
  locatorHandles,
  isNotFoundFailure,
  staleVenueHandles,
  partitionStaleVenue,
  venueStalenessReport,
  venueStaleProof,
  handleDeclaredAtBuild,
  handleCommittedAtHead,
  sourceTreeExistsAt,
  ancestryOfHead,
  probeVenueBuildSha,
  bindVenueBuild,
  buildStaleVenueContext,
  classifyVenueFailures,
  runBuildSha,
  sidecarPath
} = require('./file-failure-issues');

const FILE = 'tests/e2e/theme/theme-runtime-config.spec.js';

/**
 * Unit spec for the failure path's dedupe rule.
 *
 * The rule decides WHICH issue a failure lands on; a rule that swallows one
 * file's failure into another's issue (or files a duplicate for a file that
 * is already tracked) is exactly the tracker damage this path exists to
 * prevent, so both directions are pinned here.
 */
test.describe('a dedicated title names ONE spec file', () => {
  test('the paths in a title are the spec paths it names', () => {
    expect(specPathsIn(`see ${FILE} for the assertions`)).toEqual([FILE]);
    expect(specPathsIn('components/gov-chat-frontend/src/App.vue')).toEqual([]);
  });

  test('a title that names this file alone is dedicated to it', () => {
    expect(titleIsDedicatedTo(`test(e2e): ${FILE} is red on the local run`, FILE)).toBe(true);
  });

  test('a title that names SEVERAL spec files is an umbrella, not a dedication', () => {
    // The wave issue that touched a dozen of them names them all: it
    // tracks a GROUP, and a failure on one of them must still get its own
    // issue.
    const umbrella = `test(e2e): ${FILE} and tests/e2e/other.spec.js are red`;
    expect(titleIsDedicatedTo(umbrella, FILE)).toBe(false);
  });

  test('an absolute path or a tracker URL names the same file', () => {
    // The title may name the file the way a human writes it: an
    // absolute path, or the file's URL in a tracker link. Both END with
    // the repository path — the same file, named differently.
    expect(titleIsDedicatedTo(`test(e2e): /home/dev/genie-ai/${FILE} is red`, FILE)).toBe(true);
    expect(
      titleIsDedicatedTo(`test(e2e): https://gitlab.example/un/itu/genie-ai/-/blob/main/${FILE} is red`, FILE)
    ).toBe(true);
  });

  test('a title that names the same file twice is still dedicated to it', () => {
    // The SAME token twice, and the file under TWO spellings: both name
    // this one file, so both are a dedication — the title is judged per
    // FILE, not per token.
    expect(titleIsDedicatedTo(`test(e2e): ${FILE} — ${FILE} again`, FILE)).toBe(true);
    expect(titleIsDedicatedTo(`test(e2e): ${FILE} — /home/dev/genie-ai/${FILE}`, FILE)).toBe(true);
    expect(
      titleIsDedicatedTo(`test(e2e): ${FILE} — https://gitlab.example/un/itu/genie-ai/-/blob/main/${FILE}`, FILE)
    ).toBe(true);
  });

  test('a title that also names a FRONTEND test is still dedicated', () => {
    // The failure path covers the e2e tree: a frontend test is another
    // tree, another failure path — its mention says nothing about this
    // file, and reading it as an umbrella would file a duplicate.
    expect(
      titleIsDedicatedTo(
        `test(e2e): ${FILE} is red (frontend: components/gov-chat-frontend/src/__tests__/chatbotService.test.js)`,
        FILE
      )
    ).toBe(true);
  });

  test('the path relative to the e2e tree names the file too', () => {
    expect(titleIsDedicatedTo('test(e2e): helpers/chatbot.spec.js is red', 'tests/e2e/helpers/chatbot.spec.js')).toBe(
      true
    );
  });

  test('an umbrella in the RELATIVE spelling is an umbrella too', () => {
    // The same umbrella in the RELATIVE spelling: the relative path of
    // another file is this tree's path too, and it must not be dropped
    // from the comparison (that would read the umbrella as a dedication).
    expect(
      titleIsDedicatedTo(
        'test(e2e): helpers/chatbot.spec.js and helpers/other.spec.js are red',
        'tests/e2e/helpers/chatbot.spec.js'
      )
    ).toBe(false);
  });

  test('a path that is only the TAIL of another e2e file does not match', () => {
    // tests/e2e/helpers/tests/e2e/theme-runtime-config.spec.js is a
    // different file that happens to carry this one's path as its tail.
    expect(titleIsDedicatedTo('tests/e2e/helpers/tests/e2e/theme-runtime-config.spec.js', FILE)).toBe(false);
  });

  test('a title that names no spec file is dedicated to nothing', () => {
    expect(titleIsDedicatedTo('the e2e suite is red', FILE)).toBe(false);
  });
});

test.describe('a match must be DEDICATED to the spec file', () => {
  test('the dedicated issue whose title carries the path matches', () => {
    const issue = { title: `test(e2e): ${FILE} is red`, description: '' };
    expect(findTrackedIssue(FILE, [issue])).toBe(issue);
  });

  test("the script's own marker in the description matches", () => {
    const issue = { title: 'local e2e run failures', description: `- spec file: \`${FILE}\`` };
    expect(findTrackedIssue(FILE, [issue])).toBe(issue);
  });

  test('an umbrella that only LISTS the path does not absorb the failure', () => {
    // The wave issue that touched a dozen spec files names them in its
    // description. Absorbing their failures would leave a red file with no
    // issue of its own — the tracker noise this path exists to end.
    const umbrella = {
      title: '13 spec files hardcode the Compose edge',
      description: `The wave touched ${FILE} and twelve other files.`
    };
    expect(findTrackedIssue(FILE, [umbrella])).toBe(null);
  });

  test('an umbrella that LISTS the paths in its TITLE does not absorb the failure either', () => {
    // The title names several spec files: that is a group, not a
    // dedication. The file's own failure still needs its own issue.
    const umbrella = {
      title: `test(e2e): ${FILE} and tests/e2e/other.spec.js are red`,
      description: ''
    };
    expect(findTrackedIssue(FILE, [umbrella])).toBe(null);
  });

  test("another file's marker does not match", () => {
    const issue = { title: 'local e2e run failures', description: '- spec file: `tests/e2e/other.spec.js`' };
    expect(findTrackedIssue(FILE, [issue])).toBe(null);
  });

  test('an issue without a title does not take the filing loop down', () => {
    // The tracker's issues always carry a title; a malformed one must not
    // throw out of the per-file error handling (an undefined title is a
    // TypeError in the path matcher, not a verdict).
    expect(findTrackedIssue(FILE, [{ description: '' }])).toBe(null);
  });

  test('the issue whose TITLE is dedicated wins over one matched by the marker', () => {
    // Both are the file's issue — the marker match names it in the
    // description, the dedicated match in the title. The one a reader
    // lands on is the dedicated one, so that is the one the dedupe must
    // return: a filing that lands on the marker match leaves the
    // dedicated issue open and the file pointing at the other one.
    const byMarker = { title: 'local e2e run failures', description: `- spec file: \`${FILE}\`` };
    const byTitle = { title: `test(e2e): ${FILE} is red`, description: '' };
    expect(findTrackedIssue(FILE, [byMarker, byTitle])).toBe(byTitle);
    // The order does not decide it either way.
    expect(findTrackedIssue(FILE, [byTitle, byMarker])).toBe(byTitle);
  });

  test("a bare name of ANOTHER tree's file is not this tree's path", () => {
    // A title that names an e2e spec AND a frontend unit test by its
    // bare name is still a DEDICATION to the e2e file: the frontend test
    // is not this tree's business. Counting it would make the title look
    // like a group, and the failure path would file a second issue for a
    // file that already has one.
    //
    // The other tree's file lives in a THROWAWAY tree, not in this
    // checkout: the rule is about the names beside the tree, and a case
    // that leaned on a file of ANOTHER component would break when that
    // component renames it.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dedupe-'));
    try {
      // A name NO file in this checkout carries: a name that also exists
      // here would make the case pass whatever root the walk used, and
      // the root is the thing the case is about.
      const frontend = 'SomeOtherTreeOnly.test.js';
      fs.mkdirSync(path.join(root, 'components/gov-chat-frontend'), { recursive: true });
      fs.writeFileSync(path.join(root, 'components/gov-chat-frontend', frontend), '');
      const title = `test(e2e): ${FILE} and ${frontend} are red`;
      expect(titleIsDedicatedTo(title, FILE, root)).toBe(true);
      // And the frontend file on its own names nothing here.
      expect(titleIsDedicatedTo(`test(e2e): ${frontend} is red`, FILE, root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a COPY of this tree elsewhere in the checkout does not make its names another tree's", () => {
    // The operator's checkout carries sibling worktrees, and each of them
    // holds a full copy of tests/e2e. Those copies are THIS tree's own
    // business: if their spec names counted as "another tree's files",
    // this tree's bare names would stop naming this tree — and a title
    // that names one of them by its bare name would no longer be a
    // DEDICATION to it, so the failure path would file a SECOND issue
    // for a file that already has one.
    //
    // The rule is exercised in a checkout shaped like that one — a
    // throwaway tree the rule is pointed at, with this tree's own spec
    // and the same file inside a sibling worktree's copy of the tree.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dedupe-'));
    try {
      fs.mkdirSync(path.join(root, 'tests/e2e'), { recursive: true });
      fs.writeFileSync(path.join(root, 'tests/e2e/thing.spec.js'), '');
      fs.mkdirSync(path.join(root, '.claude/worktrees/wt-a/tests/e2e'), { recursive: true });
      fs.writeFileSync(path.join(root, '.claude/worktrees/wt-a/tests/e2e/thing.spec.js'), '');

      expect(titleIsDedicatedTo('test(e2e): thing.spec.js is red', 'tests/e2e/thing.spec.js', root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a bare spec file name is this tree's path even when the file is gone", () => {
    // A RENAMED file must not drop out of the comparison: a title that
    // names several spec files is a group, not a dedication, and the
    // renamed file's bare name must still count as one of them —
    // otherwise one multi-file title turns into a dedication to a file
    // that is not in it.
    //
    // The rule reads the tree's OWN names (#1802): the files it has now,
    // plus the ones it HAS HAD — "had" is the tree's git history. The
    // case runs in a throwaway GIT repo so it owns that history: a spec
    // the tree carried and then renamed away. (This checkout's real
    // history would do, but the case must not depend on which files THIS
    // tree happens to have renamed.)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dedupe-'));
    const git = (...args) =>
      execFileSync(
        'git',
        ['-C', root, '-c', 'user.email=e2e-dedupe@example.invalid', '-c', 'user.name=e2e-dedupe', ...args],
        { encoding: 'utf-8' }
      );
    try {
      fs.mkdirSync(path.join(root, 'tests/e2e'), { recursive: true });
      fs.writeFileSync(path.join(root, 'tests/e2e/renamed-away.spec.js'), '');
      git('init', '-q');
      git('add', 'tests/e2e/renamed-away.spec.js');
      git('commit', '-q', '-m', 'the tree once carried this spec');
      fs.rmSync(path.join(root, 'tests/e2e/renamed-away.spec.js'));
      git('add', '-A');
      git('commit', '-q', '-m', 'the spec was renamed away');
      // The file is gone; its bare name is still this tree's.
      const renamed = 'tests/e2e/renamed-away.spec.js';
      expect(titleIsDedicatedTo('test(e2e): renamed-away.spec.js is red', renamed, root)).toBe(true);
      // And it must not swallow a file it does not name.
      expect(titleIsDedicatedTo('test(e2e): renamed-away.spec.js is red', FILE, root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test.describe('one issue per failing spec FILE', () => {
  test('two failures in the same file are one issue with two entries', () => {
    // The file is the unit an owner fixes: a file-level title keeps the
    // dedupe stable across runs, and the failing TESTS are the entries
    // inside it.
    const failed = [
      { file: 'tests/e2e/a.spec.js', title: 'a › first', test: { results: [{ error: { message: 'boom' } }] } },
      { file: 'tests/e2e/a.spec.js', title: 'a › second', test: { results: [{ error: { message: 'bang' } }] } },
      { file: 'tests/e2e/b.spec.js', title: 'b › third', test: { results: [{ error: { message: 'snap' } }] } }
    ];
    const byFile = groupFailuresByFile(failed);
    expect(byFile.size).toBe(2);
    expect(byFile.get('tests/e2e/a.spec.js').map((f) => f.title)).toEqual(['a › first', 'a › second']);
    expect(byFile.get('tests/e2e/b.spec.js').map((f) => f.title)).toEqual(['b › third']);
  });

  test('the filed body carries the marker the dedupe reads back', () => {
    // ONE spelling, used both to write the marker and to read it back:
    // a drift between the two would silently degrade the dedupe to
    // title-only.
    const body = issueBody(
      'tests/e2e/a.spec.js',
      [{ title: 'a › first', error: 'boom' }],
      'https://venue.example:4443',
      '2026-11-11T00:00:00Z'
    );
    expect(body).toContain('- spec file: `tests/e2e/a.spec.js`');
    // And the failure it files is in the body.
    expect(body).toContain('a › first');
  });
});

test.describe('the tracker refusal names the tracker, not the command', () => {
  test('the first stderr line is the tracker message', () => {
    const error = new Error('Command failed: glab api projects/90/issues -f title=<the whole body>');
    error.stderr = 'glab: 404 Not found (HTTP 404)\n';
    expect(firstErrorReason(error)).toBe('glab: 404 Not found (HTTP 404)');
  });

  test('without stderr, the error message carries the reason', () => {
    const error = new Error('spawn glab ENOENT\nat ChildProcess');
    expect(firstErrorReason(error)).toBe('spawn glab ENOENT | at ChildProcess');
  });
});

test.describe('a failure carrying an edge-transport signature is venue noise (#1783)', () => {
  // The observed signatures of the 2026-11-10 outage: the edge refused
  // while the k3s node rebooted and the LoadBalancer address moved.
  // The fixture venue is an EXAMPLE address on purpose: the venue-origin
  // gate forbids a local-origin literal anywhere in the tree but the
  // edge's definition, and these fixtures carry a venue as DATA — the
  // report is venue-agnostic, so the fixtures are too.
  const VENUE = 'https://e2e-venue.example:4443';
  const OUTAGE_ERROR =
    'Error: page.goto: net::ERR_CONNECTION_REFUSED at https://e2e-venue.example:4443/\n' +
    '    at loginViaUI (tests/e2e/helpers/chatbot.js:50:9)';

  test('the refused, reset, closed and unresolved-edge signatures match', () => {
    for (const signature of [
      'net::ERR_CONNECTION_REFUSED at https://venue/',
      'page.goto: net::ERR_CONNECTION_RESET',
      'net::ERR_CONNECTION_CLOSED at https://venue/',
      'net::ERR_NAME_NOT_RESOLVED at https://e2e-venue.example:4443/'
    ]) {
      expect(isConnectionSignature({ error: signature }), signature).toBe(true);
    }
  });

  test('a product failure does not match — slow-venue signatures stay product findings', () => {
    for (const error of [
      'expect(received).toBe(expected) // Object.is equality',
      'Test timeout of 60000ms exceeded while running "beforeEach" hook',
      'page.goto: net::ERR_TIMED_OUT at https://venue/',
      'page.expect(locator).toHaveText failed'
    ]) {
      expect(isConnectionSignature({ error }), error).toBe(false);
    }
  });

  test('a missing or empty error carries no signature', () => {
    expect(isConnectionSignature({ error: '' })).toBe(false);
    expect(isConnectionSignature({})).toBe(false);
    expect(isConnectionSignature(null)).toBe(false);
  });

  test('the partition keeps product failures fileable and moves the signature ones to the report', () => {
    // The PRODUCTION partition is what is under test here — not a
    // re-implementation of it. A mixed file: one outage symptom, one
    // real assertion failure — the real one stays fileable, the outage
    // one is noise; an all-signature file drops out of the filing
    // entirely; a clean file passes through untouched.
    const grouped = groupFailuresByFile([
      {
        file: 'tests/e2e/welcome-banner.spec.js',
        title: 'shows the banner',
        test: { results: [{ error: { message: OUTAGE_ERROR, stack: '' } }] }
      },
      {
        file: 'tests/e2e/welcome-banner.spec.js',
        title: 'hides the banner',
        test: { results: [{ error: { message: 'expect(received).toBe(expected)', stack: '' } }] }
      },
      {
        file: 'tests/e2e/resizable-sidebars.spec.js',
        title: 'dies with the edge',
        test: { results: [{ error: { message: 'page.goto: net::ERR_CONNECTION_RESET', stack: '' } }] }
      },
      {
        file: 'tests/e2e/theme-runtime-config.spec.js',
        title: 'never touches the wire',
        test: { results: [{ error: { message: 'expect(received).toBe(expected)', stack: '' } }] }
      }
    ]);

    const { fileable, noise } = partitionVenueNoise(grouped);
    // welcome-banner: mixed — 1 real failure fileable, 1 signature noise.
    expect(fileable.get('tests/e2e/welcome-banner.spec.js').length).toBe(1);
    expect(isConnectionSignature(fileable.get('tests/e2e/welcome-banner.spec.js')[0])).toBe(false);
    expect(noise.get('tests/e2e/welcome-banner.spec.js').length).toBe(1);
    // resizable-sidebars: all-signature — fileable NOWHERE, noise only.
    expect(fileable.has('tests/e2e/resizable-sidebars.spec.js')).toBe(false);
    expect(noise.get('tests/e2e/resizable-sidebars.spec.js').length).toBe(1);
    // theme-runtime-config: no signature — passes through untouched.
    expect(fileable.get('tests/e2e/theme-runtime-config.spec.js').length).toBe(1);
    expect(noise.has('tests/e2e/theme-runtime-config.spec.js')).toBe(false);
  });

  test('the venue-availability report names the venue, the files and the verdict', () => {
    const noise = new Map([
      ['tests/e2e/welcome-banner.spec.js', [{ error: OUTAGE_ERROR }, { error: 'net::ERR_CONNECTION_RESET' }]],
      ['tests/e2e/resizable-sidebars.spec.js', [{ error: 'net::ERR_NAME_NOT_RESOLVED' }]]
    ]);
    const report = venueAvailabilityReport(noise, VENUE);
    expect(report).toContain('venue-availability report: 3 failure(s) across 2 spec file(s)');
    expect(report).toContain('- tests/e2e/welcome-banner.spec.js: 2 (e.g. net::ERR_CONNECTION_REFUSED)');
    expect(report).toContain('- tests/e2e/resizable-sidebars.spec.js: 1 (e.g. net::ERR_NAME_NOT_RESOLVED)');
    expect(report).toContain(`The venue answered the re-probe at ${VENUE}`);
    expect(report).toContain('NOT product findings');
  });
});

test.describe('the filed body names the venue build (#1851)', () => {
  // The stale-venue trap: a venue serving an old build fails specs for
  // product-reasons that read like test defects. An issue that does not
  // name the served build is one an operator cannot diagnose in one read.
  test('a run that carried the marker names the sha it exercised', () => {
    const body = issueBody(
      'tests/e2e/a.spec.js',
      [{ title: 'a › first', error: 'boom' }],
      'https://venue.example:4443',
      '2026-11-11T00:00:00Z',
      'abc1234def'
    );
    expect(body).toContain('- venue build: `abc1234def`');
  });

  test('a run without a marker says so, unknown — not a fabricated sha', () => {
    const body = issueBody(
      'tests/e2e/a.spec.js',
      [{ title: 'a › first', error: 'boom' }],
      'https://venue.example:4443',
      '2026-11-11T00:00:00Z'
    );
    expect(body).toContain('- venue build: unknown');
    expect(body).not.toMatch(/venue build: `[0-9a-f]{7,}`/);
  });
});
test.describe('the filing loop stays loud when the tracker refuses (#1883)', () => {
  // The filing loop's loudness contract: one tracker error never takes the
  // filing down — the failing file is reported, the remaining files are
  // still attempted, and the errors come back so the run can refuse the
  // exit code. A swallow-and-exit-0 regression here is the exact silence
  // the failure path exists to end, so the contract is pinned with fake
  // clients (the same injection seam production leaves on its defaults).

  const byFile = new Map([
    ['tests/e2e/a.spec.js', [{ title: 'a › first', error: 'boom' }]],
    ['tests/e2e/b.spec.js', [{ title: 'b › second', error: 'bang' }]]
  ]);
  const VENUE = 'https://e2e-venue.example:4443';
  const STAMP = '2026-11-15T00:00:00Z';

  function trackerError() {
    const error = new Error('Command failed: glab api projects/90/issues');
    error.stderr = 'glab: 404 Not found (HTTP 404)\n';
    return error;
  }

  test('a file nobody tracks yet gets its own create, and a clean run returns no errors', () => {
    const created = [];
    const commented = [];
    const errors = fileTrackedFailures(byFile, [], VENUE, STAMP, {
      createIssue: (file) => created.push(file),
      commentOnIssue: (issue, files) => commented.push(files.map((f) => f.file))
    });
    expect(created).toEqual(['tests/e2e/a.spec.js', 'tests/e2e/b.spec.js']);
    expect(commented).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a tracked file is grouped under its issue — one comment, no create', () => {
    const tracked = { iid: 7, title: `test(e2e): tests/e2e/a.spec.js is red`, description: '' };
    const created = [];
    const comments = [];
    fileTrackedFailures(byFile, [tracked], VENUE, STAMP, {
      createIssue: (file) => created.push(file),
      commentOnIssue: (issue, files) => comments.push({ iid: issue.iid, files: files.map((f) => f.file) })
    });
    expect(created).toEqual(['tests/e2e/b.spec.js']);
    expect(comments).toEqual([{ iid: 7, files: ['tests/e2e/a.spec.js'] }]);
  });

  test('a create failure is reported and the remaining files are still attempted', () => {
    const created = [];
    const errors = fileTrackedFailures(byFile, [], VENUE, STAMP, {
      createIssue: (file) => {
        if (file === 'tests/e2e/a.spec.js') throw trackerError();
        created.push(file);
      },
      commentOnIssue: () => {}
    });
    // The refused file is named, with the tracker's own reason.
    expect(errors).toEqual(['tests/e2e/a.spec.js: glab: 404 Not found (HTTP 404)']);
    // The file AFTER the refused one still got its create.
    expect(created).toEqual(['tests/e2e/b.spec.js']);
  });

  test('a failed comment puts every file it covers into the errors', () => {
    const tracked = { iid: 7, title: `test(e2e): tests/e2e/a.spec.js is red`, description: '' };
    const errors = fileTrackedFailures(byFile, [tracked], VENUE, STAMP, {
      createIssue: () => {},
      commentOnIssue: () => {
        throw trackerError();
      }
    });
    expect(errors).toEqual(['tests/e2e/a.spec.js: glab: 404 Not found (HTTP 404)']);
  });
});

/**
 * The stale-venue classification (#1895, #1896).
 *
 * A spec that waits for a handle the app declares, against a venue whose
 * build predates the declaration, fails exactly like a product defect —
 * and was FILED as one: two product bugs that were a stale bundle. The
 * classification is the read that tells the two apart, and it is pinned
 * here against the real failure texts of those two reds.
 */
test.describe('a stale venue is told apart from a product defect', () => {
  const HISTORY_ERROR = [
    'Error: the saved chat is listed after the reload',
    '',
    'expect(locator).toBeVisible() failed',
    '',
    "Locator: locator('[data-testid=\"chat-history-item\"]').filter({ hasText: 'E2E Test Chat 1794810494108' })",
    'Expected: visible',
    'Timeout: 15000ms',
    'Error: element(s) not found',
    '',
    'Call log:',
    '  - the saved chat is listed after the reload with timeout 15000ms',
    '',
    '      326 |',
    '      327 |     const row = page.locator(\'[data-testid="chat-history-item"]\').filter({ hasText: chatTitle });',
    '    > 328 |     await expect(row).toBeHidden({ timeout: 15000 });'
  ].join('\n');

  const UPLOAD_ERROR = [
    'Error: expect(locator).toBeEnabled() failed',
    '',
    'Locator: locator(\'[data-test-id="upload-files-dialog"]\').locator(\'[data-test-id="upload-files-dialog-confirm"]\')',
    'Expected: enabled',
    'Timeout: 5000ms',
    'Error: element(s) not found',
    '',
    'Call log:',
    '  - Expect "toBeEnabled" with timeout 5000ms'
  ].join('\n');

  const DECLARED = new Map([
    ['chat-history-item', 'components/gov-chat-frontend/src/components/ChatFolders.vue'],
    ['upload-files-dialog', 'components/gov-chat-frontend/src/components/UploadFilesDialog.vue'],
    ['upload-files-dialog-confirm', 'components/gov-chat-frontend/src/components/UploadFilesDialog.vue']
  ]);

  // A venue that serves the dialog but not its confirm button — the
  // #1896 shape exactly. The committed reader is injected: a spec that
  // reads the real app's source goes red on a rename, and the failure
  // path files that red as a product bug.
  const STALE = {
    servedText: '"upload-files-dialog"',
    declared: DECLARED,
    committedAtHead: () => true
  };

  // The checkout's own HEAD — the build the proof reads the app's source
  // at. It is read from the repository, not hardcoded: the sha of a
  // commit that has been rewritten is not a fact a unit spec may carry.
  const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

  // A handle NO source declares. The proof reads the app's source AT THE
  // VENUE'S BUILD, so a test of the stale-venue verdict needs a build that
  // does not declare the handle it asks about — and a name nothing
  // declares is exactly that. The shape is the stale venue's: the
  // checkout declares it, the venue's build does not.
  const STALE_HANDLE = 'test-only-handle-no-source-declares';
  const STALE_ERROR = [
    'Error: expect(locator).toBeVisible() failed',
    '',
    `Locator: locator('[data-testid="${STALE_HANDLE}"]')`,
    'Expected: visible',
    'Timeout: 15000ms',
    'Error: element(s) not found'
  ].join('\n');
  // The venue serves a bundle WITHOUT the handle, and the checkout
  // declares it — and the venue's build (HEAD) does not declare it
  // either, so the verdict is proven.
  const PROVEN_STALE = {
    servedText: '"some-other-handle"',
    declared: new Map([[STALE_HANDLE, 'components/gov-chat-frontend/src/components/ChatFolders.vue']]),
    boundSha: HEAD_SHA,
    // The build reader is INJECTED: the unit spec must not borrow a
    // commit from the repository's history — a checkout at origin/main
    // carries no commit that is not behind its HEAD, and a spec that
    // needs one goes red exactly where the operator runs the suite. The
    // real read has its own specs (the declared handle at HEAD, a handle
    // nothing declares, a sha no repository holds).
    declaredAtBuild: (sha) => sha === 'HEAD',
    committedAtHead: () => true
  };

  test('the handles a failure waits for are read from the LOCATOR line', () => {
    expect(locatorHandles(HISTORY_ERROR)).toEqual(['chat-history-item']);
    // The compound locator names both — the dialog the venue HAS and the
    // confirm button it does not.
    expect(locatorHandles(UPLOAD_ERROR)).toEqual(['upload-files-dialog', 'upload-files-dialog-confirm']);
  });

  test('a failure with no locator line names no handle', () => {
    expect(locatorHandles('Error: something else entirely')).toEqual([]);
  });

  test('only a NOT FOUND failure is a candidate — an element that is there and misbehaves is a product defect', () => {
    expect(isNotFoundFailure(HISTORY_ERROR)).toBe(true);
    expect(isNotFoundFailure('Error: element is not visible')).toBe(false);
    expect(isNotFoundFailure('Error: element is not enabled')).toBe(false);
  });

  test('a handle the venue does not serve AND the checkout declares is a stale venue', () => {
    const failure = { error: HISTORY_ERROR };
    expect(staleVenueHandles(failure, STALE)).toEqual([
      {
        handle: 'chat-history-item',
        source: 'components/gov-chat-frontend/src/components/ChatFolders.vue',
        specDefect: false
      }
    ]);
  });

  test('the compound locator names the SPECIFIC missing handle — the dialog the venue HAS is not reported', () => {
    // Reporting the outer dialog as missing would send the operator to
    // restart a pod for a defect that is not there: the dialog WAS on
    // screen.
    const missing = staleVenueHandles({ error: UPLOAD_ERROR }, STALE);
    expect(missing.map((entry) => entry.handle)).toEqual(['upload-files-dialog-confirm']);
  });

  test('a handle the VENUE SERVES is never a stale venue', () => {
    const served = { servedText: '"chat-history-item"', declared: DECLARED };
    expect(staleVenueHandles({ error: HISTORY_ERROR }, served)).toEqual([]);
  });

  test('a handle NEITHER the venue nor the checkout has is a spec defect, not a stale venue', () => {
    // The app never declared it: the spec is wrong, and it is filed as
    // the product finding it is. It stays a CANDIDATE — a compound
    // locator carrying it beside a stale handle must be filed, not
    // classified: the spec defect must not disappear behind the stale
    // one.
    const context = { servedText: '', declared: new Map() };
    expect(staleVenueHandles({ error: HISTORY_ERROR }, context)).toEqual([
      { handle: 'chat-history-item', source: null, specDefect: true }
    ]);
  });

  test('a failure that is not a not-found is never a stale venue', () => {
    const failure = {
      error: 'Error: element is not visible\n\nLocator: locator(\'[data-testid="chat-history-item"]\')'
    };
    expect(staleVenueHandles(failure, STALE)).toEqual([]);
  });

  test('a file whose failures are ALL stale drops out of the filing', () => {
    const byFile = new Map([['tests/e2e/chatbot/conversation-history.spec.js', [{ error: STALE_ERROR }]]]);
    const { fileable, stale } = partitionStaleVenue(byFile, PROVEN_STALE);
    expect(fileable.size).toBe(0);
    expect(stale.get('tests/e2e/chatbot/conversation-history.spec.js').failures).toHaveLength(1);
  });

  test('a file whose OTHER failures survive the split stays fileable for exactly those', () => {
    const byFile = new Map([
      [
        'tests/e2e/documents/upload.spec.js',
        [{ error: STALE_ERROR }, { error: 'Error: expect(received).toBe(true) failed' }]
      ]
    ]);
    const { fileable, stale } = partitionStaleVenue(byFile, PROVEN_STALE);
    expect(fileable.get('tests/e2e/documents/upload.spec.js')).toHaveLength(1);
    expect(fileable.get('tests/e2e/documents/upload.spec.js')[0].error).toContain('toBe(true)');
    expect(stale.get('tests/e2e/documents/upload.spec.js').failures).toHaveLength(1);
  });

  test("a handle the VENUE'S OWN BUILD declared is a product defect — it is filed, not classified", () => {
    // The app declared the handle at the venue's build and the venue's
    // bundle does not carry it: the app's build dropped it. That is a
    // defect of the product, and it must be FILED as one — a verdict that
    // called it a stale venue would silence it.
    const context = {
      servedText: '"other"',
      declared: new Map([['chat-history-item', 'components/gov-chat-frontend/src/components/ChatFolders.vue']]),
      boundSha: HEAD_SHA,
      declaredAtBuild: () => true,
      committedAtHead: () => true
    };
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: HISTORY_ERROR }]]]);
    const { fileable, stale } = partitionStaleVenue(byFile, context);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
    expect(stale.size).toBe(0);
  });

  test("a declaration that lives only in the WORKING TREE is not the venue's — the failure is filed", () => {
    // The working tree is what the run exercises, but no build of it
    // exists: a handle in an uncommitted edit is carried by no commit,
    // so no build can serve it — and classifying it as a stale venue
    // would drop the failure out of the filing with a remedy (a venue
    // refresh) that cannot help.
    const context = {
      servedText: '"some-other-handle"',
      declared: new Map([[STALE_HANDLE, 'components/gov-chat-frontend/src/components/ChatFolders.vue']]),
      boundSha: HEAD_SHA,
      declaredAtBuild: () => false,
      // The handle is NOT committed: no build carries it.
      committedAtHead: () => false
    };
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: STALE_ERROR }]]]);
    const { fileable, stale } = partitionStaleVenue(byFile, context);
    expect(stale.size).toBe(0);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
  });

  test("a locator naming a STALE handle AND a handle the app's build dropped is filed, not classified", () => {
    // Two causes in one failure: the venue cannot serve the first, and
    // the app's own build dropped the second. The product defect must
    // not be silenced by the stale one.
    const compound = [
      'Error: expect(locator).toBeVisible() failed',
      '',
      'Locator: locator(\'[data-testid="test-only-handle-no-source-declares"]\').locator(\'[data-testid="chat-history-item"]\')',
      'Error: element(s) not found'
    ].join('\n');
    const context = {
      servedText: '"some-other-handle"',
      declared: new Map([
        [STALE_HANDLE, 'components/gov-chat-frontend/src/components/ChatFolders.vue'],
        ['chat-history-item', 'components/gov-chat-frontend/src/components/ChatFolders.vue']
      ]),
      boundSha: HEAD_SHA,
      // Declared at HEAD; at the venue's build the first handle is
      // missing (stale) and the second one was declared (the app's own
      // build dropped it).
      declaredAtBuild: (sha, handle) => (sha === 'HEAD' ? true : handle === STALE_HANDLE ? false : true),
      committedAtHead: () => true
    };
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: compound }]]]);
    const { fileable, stale } = partitionStaleVenue(byFile, context);
    expect(stale.size).toBe(0);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
  });

  test('a declaration no commit carries is refused, and the refusal is reported', () => {
    // The working tree declares it, no commit does: the failure is
    // filed, and the reason is named — a silent refusal is
    // indistinguishable from a verdict.
    const context = {
      servedText: '"some-other-handle"',
      declared: new Map([[STALE_HANDLE, 'components/gov-chat-frontend/src/components/ChatFolders.vue']]),
      boundSha: HEAD_SHA,
      declaredAtBuild: (sha) => sha === 'HEAD',
      committedAtHead: () => false
    };
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: STALE_ERROR }]]]);
    const { fileable, stale, refused } = partitionStaleVenue(byFile, context);
    expect(stale.size).toBe(0);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
    expect(refused.map((entry) => entry.handle)).toEqual([STALE_HANDLE]);
    expect(refused[0].reason).toContain('no commit declares it');
  });

  test('a checkout that cannot read the committed source is refused, and named', () => {
    const context = {
      servedText: '"some-other-handle"',
      declared: new Map([[STALE_HANDLE, 'components/gov-chat-frontend/src/components/ChatFolders.vue']]),
      boundSha: HEAD_SHA,
      declaredAtBuild: (sha) => sha === 'HEAD',
      committedAtHead: () => null
    };
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: STALE_ERROR }]]]);
    const { fileable, stale, refused } = partitionStaleVenue(byFile, context);
    expect(stale.size).toBe(0);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
    expect(refused[0].reason).toContain('could not read the committed source');
  });

  test('an unbound venue (no build to read) classifies nothing — the failures stay fileable', () => {
    const context = { ...PROVEN_STALE, boundSha: null };
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: STALE_ERROR }]]]);
    const { fileable, stale } = partitionStaleVenue(byFile, context);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
    expect(stale.size).toBe(0);
  });

  test('the report names the venue, the missing handle, the file that declares it, and the remedy', () => {
    const stale = new Map([
      [
        'tests/e2e/documents/upload.spec.js',
        {
          failures: [{ error: UPLOAD_ERROR }],
          missing: new Map([
            ['upload-files-dialog-confirm', 'components/gov-chat-frontend/src/components/UploadFilesDialog.vue']
          ])
        }
      ]
    ]);
    const report = venueStalenessReport(stale, 'https://venue.example:4443');
    expect(report).toContain('venue-staleness report');
    expect(report).toContain('tests/e2e/documents/upload.spec.js');
    expect(report).toContain('upload-files-dialog-confirm');
    expect(report).toContain('components/gov-chat-frontend/src/components/UploadFilesDialog.vue');
    expect(report).toContain('https://venue.example:4443');
    expect(report).toContain('nothing is filed');
    expect(report).toContain('docs/e2e-tests/local-run.md');
    // The handle the venue DOES serve is not reported as missing.
    expect(report).not.toContain('`upload-files-dialog`');
  });

  test('the report names the build the venue was bound to', () => {
    // The bound build is the proof's third link made visible: the
    // operator must be able to read WHICH build did not declare the
    // handle. Without it the report says "a build that predates the
    // declaration" and names none.
    const stale = new Map([
      [
        'tests/e2e/documents/upload.spec.js',
        {
          failures: [{ error: UPLOAD_ERROR }],
          missing: new Map([
            ['upload-files-dialog-confirm', 'components/gov-chat-frontend/src/components/UploadFilesDialog.vue']
          ])
        }
      ]
    ]);
    const report = venueStalenessReport(stale, 'https://venue.example:4443', { boundSha: 'abc1234def' });
    expect(report).toContain("the venue's build `abc1234def` does not declare it either");
  });
});

/**
 * The proof the stale-venue verdict rests on (#1895, #1896).
 *
 * A verdict that calls a failure "the venue's" without proving it silences
 * a real defect; a verdict that refuses to prove it files a venue problem
 * as a product bug. The proof has three links — the bundle does not carry
 * the handle (observed), the checkout declares it (observed), and the app's
 * source AT THE VENUE'S BUILD does not declare it either (read from that
 * build) — and all three must hold.
 */
test.describe("the verdict is proven against the venue's own build", () => {
  const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  // A sha no repository holds: the build cannot be read, and a build that
  // cannot be read proves nothing.
  const UNREADABLE_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  test('a handle the app declares AT THE BUILD is declared — the read answers', () => {
    expect(handleDeclaredAtBuild(HEAD_SHA, 'chat-history-item')).toBe(true);
  });

  test('a handle NO source declares is not declared at the build', () => {
    expect(handleDeclaredAtBuild(HEAD_SHA, 'test-only-handle-no-source-declares')).toBe(false);
  });

  test('a build that cannot be read proves nothing — the answer is null, not false', () => {
    // null and false mean different things: false licenses the verdict,
    // null refuses it. A build that cannot be read must not license
    // anything.
    expect(handleDeclaredAtBuild(UNREADABLE_SHA, 'chat-history-item')).toBe(null);
  });

  test('the proof is stale only when the build does not declare the handle', () => {
    const stale = { handle: 'test-only-handle-no-source-declares', source: 'x.vue' };
    const declared = { handle: 'chat-history-item', source: 'x.vue' };
    const notDeclared = { boundSha: HEAD_SHA, declaredAtBuild: (sha) => sha === 'HEAD' };
    expect(venueStaleProof(stale, notDeclared)).toBe('stale');
    // The build DID declare it: the app's own build dropped it — a
    // product defect, filed as one.
    expect(venueStaleProof(declared, { boundSha: HEAD_SHA, declaredAtBuild: () => true })).toBe('declared');
    // No bound build: nothing to read, so nothing is proven.
    expect(venueStaleProof(stale, { boundSha: null })).toBe('not-stale');
  });
});

/**
 * The bundle read is bound to the build the RUN exercised.
 *
 * The read happens at filing time; the failure was produced earlier. A
 * venue that moved in between answers with a bundle that is not the one
 * the failure was produced against — and a verdict about a stale venue is
 * a verdict about a BUILD.
 */
test.describe("the venue's bundle is bound to the run's build", () => {
  const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  const OTHER_SHA = '1111111111111111111111111111111111111111';

  test("a run and a venue that agree on the build, on this checkout's line, are bound", () => {
    const bound = bindVenueBuild({ runSha: HEAD_SHA, venueSha: HEAD_SHA });
    expect(bound.boundSha).toBe(HEAD_SHA);
    expect(bound.note).toBe(null);
  });

  test('a run that carried no build marker is not bound — the failures are filed as they are', () => {
    const bound = bindVenueBuild({ runSha: null, venueSha: HEAD_SHA });
    expect(bound.boundSha).toBe(null);
    expect(bound.note).toContain('no build marker');
    expect(bound.note).toContain('filed as they are');
  });

  test('a venue with no readable marker is not bound', () => {
    const bound = bindVenueBuild({ runSha: HEAD_SHA, venueSha: null });
    expect(bound.boundSha).toBe(null);
    expect(bound.note).toContain('no readable build marker');
  });

  test("a venue that MOVED since the run is not bound — the bundle read is not the run's build", () => {
    const bound = bindVenueBuild({ runSha: OTHER_SHA, venueSha: HEAD_SHA });
    expect(bound.boundSha).toBe(null);
    expect(bound.note).toContain('MOVED');
    expect(bound.note).toContain(OTHER_SHA);
    expect(bound.note).toContain(HEAD_SHA);
  });

  test("a venue that is NOT behind the checkout is not bound — a missing handle is not the venue's", () => {
    // The ancestry reader is injected: the unit spec must not borrow a
    // commit from the repository's history — a checkout at origin/main
    // carries no commit that is not behind its HEAD, and a spec that
    // needs one goes red exactly where the operator runs the suite.
    const bound = bindVenueBuild({
      runSha: OTHER_SHA,
      venueSha: OTHER_SHA,
      ancestry: () => 'not-ancestor'
    });
    expect(bound.boundSha).toBe(null);
    expect(bound.note).toContain(OTHER_SHA);
    expect(bound.note).toContain('filed as they are');
  });

  test('the ancestry reader tells the three answers apart', () => {
    // The real reader: HEAD is behind itself, and a sha no repository
    // holds cannot be placed at all.
    expect(ancestryOfHead(HEAD_SHA)).toBe('ancestor');
    expect(ancestryOfHead('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe('unknown');
    // Exit 1 is the third answer — the build is known and is not behind.
    const notAncestor = () => {
      const error = new Error('not an ancestor');
      error.status = 1;
      throw error;
    };
    expect(ancestryOfHead('abc1234', notAncestor)).toBe('not-ancestor');
  });
});

/**
 * The run's build travels with the run.
 *
 * The runner exports the sha its pre-flight read; a run filed BY HAND
 * inherits no environment, so the runner writes the sha BESIDE the run's
 * own report.
 */
test.describe('the run carries its build', () => {
  test("the sidecar sits beside the run's own report", () => {
    expect(sidecarPath('/tmp/reports/playwright-report-run-20261116T101112Z.json')).toBe(
      '/tmp/reports/playwright-report-run-20261116T101112Z.build.json'
    );
  });

  test("the sidecar carries the run's build when the environment carries none", () => {
    const previous = process.env.E2E_VENUE_BUILD_GIT_SHA;
    delete process.env.E2E_VENUE_BUILD_GIT_SHA;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-build-'));
    const report = path.join(dir, 'playwright-report-run-20261116T101112Z.json');
    fs.writeFileSync(sidecarPath(report), JSON.stringify({ git_sha: 'abc1234def' }));
    try {
      expect(runBuildSha(report)).toBe('abc1234def');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      if (previous !== undefined) process.env.E2E_VENUE_BUILD_GIT_SHA = previous;
    }
  });

  test('a run with neither an environment nor a sidecar carries no build — the failures are filed as they are', () => {
    const previous = process.env.E2E_VENUE_BUILD_GIT_SHA;
    delete process.env.E2E_VENUE_BUILD_GIT_SHA;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-build-'));
    try {
      expect(runBuildSha(path.join(dir, 'no-such-report.json'))).toBe(null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      if (previous !== undefined) process.env.E2E_VENUE_BUILD_GIT_SHA = previous;
    }
  });
});

test.describe('the locator line names a handle in both spellings', () => {
  test('the getByTestId spelling names the same handle as the attribute spelling', () => {
    // Playwright prints the locator it waited on. `getByTestId('x')`
    // names the same handle as `[data-testid="x"]` — and carries no
    // attribute, so the attribute scan alone would miss it and the
    // classification would go silently inert for that spelling.
    const error = [
      'Error: expect(locator).toBeVisible() failed',
      '',
      "Locator: getByTestId('chat-history-item')",
      'Expected: visible',
      'Error: element(s) not found'
    ].join('\n');
    expect(locatorHandles(error)).toEqual(['chat-history-item']);
  });
});

test.describe('the filed body names a venue that moved', () => {
  test('the body names both builds when the venue answered with another one', () => {
    const body = issueBody(
      'tests/e2e/a.spec.js',
      [{ title: 'a › first', error: 'boom' }],
      'https://venue.example:4443',
      '2026-11-11T00:00:00Z',
      'abc1234def',
      'fedcba987'
    );
    expect(body).toContain('- venue build: `abc1234def`');
    expect(body).toContain('the venue has moved since the run: it now serves `fedcba987`');
  });

  test('a venue that did not move adds no second line', () => {
    const body = issueBody(
      'tests/e2e/a.spec.js',
      [{ title: 'a › first', error: 'boom' }],
      'https://venue.example:4443',
      '2026-11-11T00:00:00Z',
      'abc1234def',
      'abc1234def'
    );
    expect(body).toContain('- venue build: `abc1234def`');
    expect(body).not.toContain('the venue has moved');
  });
});

/**
 * The context that carries the read is built only from what the venue
 * proves — and every arm of it is pinned here, without a venue.
 */
test.describe('the venue context is built only from what the venue proves', () => {
  const INDEX = '<html><script defer src="/js/app.1229e2fc.js"></script></html>';
  const APP = 'i.u=e=>"js/"+e+"."+{73:"7f541a03"}[e]+".js"';
  const transport = (bodies) => async (_method, url) => {
    const key = Object.keys(bodies).find((candidate) => url.endsWith(candidate));
    if (key === undefined) return { status: 404, data: 'not found' };
    return { status: 200, data: bodies[key] };
  };
  const SERVING = transport({
    '/': INDEX,
    '/js/app.1229e2fc.js': APP,
    '/js/73.7f541a03.js': '"chat-history-item"'
  });
  const NOT_FOUND_ERROR = [
    'Error: expect(locator).toBeVisible() failed',
    '',
    'Locator: locator(\'[data-testid="chat-history-item"]\')',
    'Error: element(s) not found'
  ].join('\n');
  const BY_FILE = new Map([['tests/e2e/a.spec.js', [{ error: NOT_FOUND_ERROR }]]]);

  test('a run with no not-found failure needs no read at all', async () => {
    const context = await buildStaleVenueContext('https://venue.example:4443', new Map(), {
      request: SERVING
    });
    expect(context.ok).toBe(false);
    expect(context.note).toBe(null);
  });

  test('a bundle that cannot be read degrades to filing the failures as they are', async () => {
    const context = await buildStaleVenueContext('https://venue.example:4443', BY_FILE, {
      request: async () => {
        throw new Error('the venue answered nothing');
      }
    });
    expect(context.ok).toBe(false);
    expect(context.note).toContain("the venue's served bundle could not be read");
    expect(context.note).toContain('filed as they are');
  });

  test("a bundle carrying NONE of the checkout's handles is not this app — no verdict", async () => {
    const context = await buildStaleVenueContext('https://venue.example:4443', BY_FILE, {
      request: transport({
        '/': INDEX,
        '/js/app.1229e2fc.js': APP,
        '/js/73.7f541a03.js': '"a-handle-the-app-never-declared"'
      })
    });
    expect(context.ok).toBe(false);
    expect(context.note).toContain("carries none of the checkout's handles");
  });

  test('a read that succeeded carries the bundle, the declarations and the binding', async () => {
    const context = await buildStaleVenueContext('https://venue.example:4443', BY_FILE, {
      request: SERVING,
      runSha: 'abc1234def',
      venueSha: 'fedcba987'
    });
    expect(context.ok).toBe(true);
    expect(context.servedText).toContain('"chat-history-item"');
    expect(context.declared.get('chat-history-item')).toBe(
      'components/gov-chat-frontend/src/components/ChatFolders.vue'
    );
    // The two builds disagree: the venue moved since the run — the
    // context says so and binds nothing.
    expect(context.boundSha).toBe(null);
    expect(context.note).toContain('MOVED');
  });
});

/**
 * The marker handover — the one line that broke in production.
 *
 * The pre-flight hands the venue's build over through a scratch file (an
 * env var cannot cross back out of a child process). The scratch path
 * was once a DIRECTORY: the pre-flight's write failed, the venue's build
 * was never read, every stale-venue failure was filed as a product
 * defect — and the run printed a plausible note about it. The handover
 * is pinned here so that class cannot come back.
 */
test.describe('the venue build marker is handed over', () => {
  test('the pre-flight writes the marker into a scratch path it can write to', () => {
    let seen = null;
    const result = probeVenueBuildSha('https://venue.example:4443', (env) => {
      seen = env;
      // The handover's own regression: a scratch path that is a
      // DIRECTORY makes this throw (EISDIR).
      fs.writeFileSync(env.E2E_VENUE_BUILD_FILE, 'abc1234def');
    });
    expect(result.failed).toBe(false);
    expect(result.sha).toBe('abc1234def');
    expect(seen.BASE_URL).toBe('https://venue.example:4443');
    expect(seen.E2E_VENUE_BUILD_FILE).toContain('file-failure-issues-build-');
  });

  test('a pre-flight that fails says so, and no build is read', () => {
    const result = probeVenueBuildSha('https://venue.example:4443', () => {
      throw new Error('the venue is not drivable');
    });
    expect(result.failed).toBe(true);
    expect(result.sha).toBe(null);
  });

  test('a pre-flight that writes no marker leaves the build unknown', () => {
    const result = probeVenueBuildSha('https://venue.example:4443', () => {});
    expect(result.failed).toBe(false);
    expect(result.sha).toBe(null);
  });
});

/**
 * The run's build is the REPORT's build.
 *
 * An ambient marker in the environment names SOME run, not necessarily
 * this one — and binding this report's failures to another run's build is
 * the one confusion the binding exists to prevent.
 */
test.describe('an ambient marker never binds a report', () => {
  test("the environment marker is NOT the report's build", () => {
    const previous = process.env.E2E_VENUE_BUILD_GIT_SHA;
    process.env.E2E_VENUE_BUILD_GIT_SHA = 'ambient1234';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-build-'));
    try {
      // The report carries no sidecar: it carries no build, whatever the
      // environment says.
      expect(runBuildSha(path.join(dir, 'no-sidecar.json'))).toBe(null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      if (previous === undefined) delete process.env.E2E_VENUE_BUILD_GIT_SHA;
      else process.env.E2E_VENUE_BUILD_GIT_SHA = previous;
    }
  });
});

/**
 * A build the checkout cannot read refuses the verdict — and says so.
 */
test.describe('the COMMITTED declaration is read strictly', () => {
  test('the app declares the handle at HEAD', () => {
    expect(handleCommittedAtHead('chat-history-item')).toBe(true);
  });

  test("the frontend's OWN test tree does not declare an app handle", () => {
    // The app never ships `answer-source-card-0`: the frontend's Jest
    // tree declares it. A committed-only-in-a-test handle is carried by
    // no build, so no build can serve it — and a verdict built on it
    // would drop a failure the operator must see.
    expect(handleCommittedAtHead('answer-source-card-0')).toBe(false);
  });

  test('a handle nothing declares is not committed', () => {
    expect(handleCommittedAtHead('test-only-handle-no-source-declares')).toBe(false);
  });

  test('a checkout that CANNOT read the committed source answers null, not false', () => {
    // `git grep` exits 128 when it cannot read the tree (a shallow
    // clone, an unknown revision). "the checkout could not answer" is a
    // DIFFERENT fact from "no commit declares it", and the refusal says
    // which one it is — a reader that answered false would report the
    // wrong reason for every handle.
    const unreadable = () => {
      const error = new Error('git grep exited 128');
      error.status = 128;
      throw error;
    };
    expect(handleCommittedAtHead('chat-history-item', unreadable)).toBe(null);
  });

  test('a DYNAMIC binding is not a declaration', () => {
    // `:data-testid="x"` binds the attribute to a value the build does
    // not know statically: no build serves it as a handle. Counting it
    // would let a handle that lives only in an uncommitted edit pass
    // this gate on the strength of an unrelated dynamic binding — the
    // verdict would fire on a build that never carried the handle, and
    // the failure would be dropped from the filing.
    let pattern = null;
    const run = (_command, args) => {
      pattern = args[args.indexOf('-E') + 1];
      return '';
    };
    handleCommittedAtHead('some-handle', run);
    expect(pattern).not.toBeNull();
    expect(new RegExp(pattern).test(' :data-testid="some-handle"')).toBe(false);
    expect(new RegExp(pattern).test(' data-testid="some-handle"')).toBe(true);
    expect(new RegExp(pattern).test(' :data-test-id="some-handle"')).toBe(false);
    expect(new RegExp(pattern).test(' data-test-id="some-handle"')).toBe(true);
    // The attribute at the START of a line is a static declaration too:
    // dropping the `^|` half of the pattern would stop every
    // column-zero declaration from matching, and the two readers would
    // disagree on what a declaration is.
    expect(new RegExp(pattern).test('data-testid="some-handle"')).toBe(true);
    expect(new RegExp(pattern).test('data-test-id="some-handle"')).toBe(true);
    // The ERE must stay POSIX: `\s` is a GNU extension, and on a host
    // whose grep does not know it every static declaration reads as
    // "not committed" — the verdict is refused forever.
    expect(pattern).not.toMatch(/\\s/);
  });
});

test.describe("the app's source must EXIST at the build", () => {
  test('HEAD carries the app source tree', () => {
    const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    expect(sourceTreeExistsAt(HEAD_SHA)).toBe(true);
  });

  test('a build no repository holds carries no source tree', () => {
    expect(sourceTreeExistsAt('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(false);
  });
});

test.describe('a build that cannot be read refuses the verdict', () => {
  const UNREADABLE_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  test('the proof refuses, it does not answer', () => {
    expect(
      venueStaleProof(
        { handle: 'chat-history-item', source: 'x.vue' },
        { boundSha: UNREADABLE_SHA, declaredAtBuild: () => null }
      )
    ).toBe('unreadable');
  });

  test('the refusals are collected, and the failures stay fileable', () => {
    const context = {
      servedText: '"some-other-handle"',
      declared: new Map([['chat-history-item', 'components/gov-chat-frontend/src/components/ChatFolders.vue']]),
      boundSha: UNREADABLE_SHA,
      declaredAtBuild: (sha) => (sha === 'HEAD' ? true : null),
      committedAtHead: () => true
    };
    const error = [
      'Error: expect(locator).toBeVisible() failed',
      '',
      'Locator: locator(\'[data-testid="chat-history-item"]\')',
      'Error: element(s) not found'
    ].join('\n');
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error }]]]);
    const { fileable, stale, refused } = partitionStaleVenue(byFile, context);
    expect(stale.size).toBe(0);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
    expect(refused.map((entry) => entry.handle)).toEqual(['chat-history-item']);
  });

  test('a build that carries no app source tree refuses the binding, and names why', () => {
    // A grep over a path the build does not have answers "nothing is
    // declared" — a different fact, and one that would license the
    // verdict. The gate is load-bearing, so it is pinned.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    const bound = bindVenueBuild({
      runSha: head,
      venueSha: head,
      sourceTreeExists: () => false
    });
    expect(bound.boundSha).toBe(null);
    expect(bound.note).toContain('carries no app source tree');
    expect(bound.note).toContain('filed as they are');
  });

  test('a checkout that cannot answer the ancestry refuses the binding, and names why', () => {
    const bound = bindVenueBuild({
      runSha: UNREADABLE_SHA,
      venueSha: UNREADABLE_SHA,
      ancestry: () => 'unknown'
    });
    expect(bound.boundSha).toBe(null);
    expect(bound.note).toContain('cannot be read by this checkout');
  });
});

/**
 * The declaration walk is additive: a source tree that cannot be walked
 * degrades to filing the failures as they are.
 */
test.describe('a declaration walk that fails degrades to filing', () => {
  test('the failures are filed as they are, and the reason is named', async () => {
    const error = [
      'Error: expect(locator).toBeVisible() failed',
      '',
      'Locator: locator(\'[data-testid="chat-history-item"]\')',
      'Error: element(s) not found'
    ].join('\n');
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error }]]]);
    const bodies = {
      '/': '<html><script defer src="/js/app.aaaa1111.js"></script></html>',
      '/js/app.aaaa1111.js': 'i.u=e=>"js/"+e+"."+{73:"7f541a03"}[e]+".js"',
      '/js/73.7f541a03.js': '"chat-history-item"'
    };
    const context = await buildStaleVenueContext('https://venue.example:4443', byFile, {
      request: async (_method, url) => {
        const key = Object.keys(bodies).find((candidate) => url.endsWith(candidate));
        return key === undefined ? { status: 404, data: 'not found' } : { status: 200, data: bodies[key] };
      },
      declaredHandles: () => {
        throw new Error('the source tree cannot be read');
      }
    });
    expect(context.ok).toBe(false);
    expect(context.note).toContain("the checkout's declarations could not be walked");
    expect(context.note).toContain('filed as they are');
  });
});

/**
 * The failure path RUNS the classification.
 *
 * The proof and the partition are each pinned, but the WIRING between
 * them and the run is what decides whether the feature works at all:
 * without a spec on this level, the whole block could be deleted and
 * every failure would be filed as a product defect while the suite
 * stayed green.
 */
test.describe('the failure path runs the classification', () => {
  const INDEX = '<html><script defer src="/js/app.aaaa1111.js"></script></html>';
  const APP = 'i.u=e=>"js/"+e+"."+{73:"7f541a03"}[e]+".js"';
  const transport = (bodies) => async (_method, url) => {
    const key = Object.keys(bodies).find((candidate) => url.endsWith(candidate));
    if (key === undefined) return { status: 404, data: 'not found' };
    return { status: 200, data: bodies[key] };
  };
  // A venue that serves a bundle WITHOUT `chat-history-item` — the
  // #1895 shape — and a real handle of the app in it (`sidebar-left`,
  // declared by SideBarComponent.vue), so the walk reads the APP and
  // the sanity guard passes.
  const SERVING = transport({
    '/': INDEX,
    '/js/app.aaaa1111.js': APP,
    '/js/73.7f541a03.js': '"sidebar-left"'
  });
  const HISTORY_NOT_FOUND = [
    'Error: expect(locator).toBeVisible() failed',
    '',
    'Locator: locator(\'[data-testid="chat-history-item"]\')',
    'Expected: visible',
    'Error: element(s) not found'
  ].join('\n');
  // The readers, injected: the venue's build declares the handle (the
  // app's build dropped it) in the product-defect case, and does not in
  // the stale-venue case.
  const readers = (declaredAtBuild) => ({
    request: SERVING,
    runSha: 'abc1234def',
    venueSha: 'abc1234def',
    ancestry: () => 'ancestor',
    sourceTreeExists: () => true,
    declaredAtBuild,
    committedAtHead: () => true
  });

  test('a proven-stale failure is NOT filed, and the run prints the report', async () => {
    const byFile = new Map([['tests/e2e/chatbot/conversation-history.spec.js', [{ error: HISTORY_NOT_FOUND }]]]);
    const result = await classifyVenueFailures(
      'https://venue.example:4443',
      byFile,
      readers((sha) => sha === 'HEAD')
    );
    expect(result.fileable.size).toBe(0);
    expect(result.stale.size).toBe(1);
    const printed = result.reports.join('\n');
    expect(printed).toContain('venue-staleness report');
    expect(printed).toContain('chat-history-item');
    expect(printed).toContain('nothing is filed');
  });

  test('a product defect IS filed', async () => {
    const byFile = new Map([['tests/e2e/chatbot/conversation-history.spec.js', [{ error: HISTORY_NOT_FOUND }]]]);
    const result = await classifyVenueFailures(
      'https://venue.example:4443',
      byFile,
      readers(() => true)
    );
    expect(result.fileable.get('tests/e2e/chatbot/conversation-history.spec.js')).toHaveLength(1);
    expect(result.stale.size).toBe(0);
    expect(result.reports.join('\n')).not.toContain('venue-staleness report');
  });

  test('a refused verdict is PRINTED with the handle and the reason', async () => {
    // A refusal that prints nothing is indistinguishable from a verdict:
    // the operator would read a filed product defect and never learn that
    // the proof could not answer.
    const byFile = new Map([['tests/e2e/chatbot/conversation-history.spec.js', [{ error: HISTORY_NOT_FOUND }]]]);
    const result = await classifyVenueFailures('https://venue.example:4443', byFile, {
      ...readers((sha) => sha === 'HEAD'),
      // No commit declares the handle: the proof refuses.
      committedAtHead: () => false
    });
    expect(result.fileable.get('tests/e2e/chatbot/conversation-history.spec.js')).toHaveLength(1);
    expect(result.refused.length).toBe(1);
    const printed = result.reports.join('\n');
    expect(printed).toContain('chat-history-item');
    expect(printed).toContain('no commit declares it');
  });

  test('a venue the run cannot bind leaves the failures filed, and says why', async () => {
    const byFile = new Map([['tests/e2e/chatbot/conversation-history.spec.js', [{ error: HISTORY_NOT_FOUND }]]]);
    const result = await classifyVenueFailures('https://venue.example:4443', byFile, {
      ...readers(() => true),
      venueSha: 'fedcba987'
    });
    expect(result.fileable.get('tests/e2e/chatbot/conversation-history.spec.js')).toHaveLength(1);
    expect(result.note).toContain('MOVED');
    expect(result.reports.join('\n')).toContain('MOVED');
  });
});

/**
 * The per-candidate committed gate, in the compound case: a locator
 * naming a handle no commit declares beside a handle the venue's build
 * never declared is FILED — the product defect must not be silenced by
 * the stale one.
 */
test.describe('a compound locator with mixed committed answers is filed', () => {
  const compound = [
    'Error: expect(locator).toBeVisible() failed',
    '',
    'Locator: locator(\'[data-testid="test-only-handle-no-source-declares"]\').locator(\'[data-testid="chat-history-item"]\')',
    'Error: element(s) not found'
  ].join('\n');

  test('the uncommitted handle refuses the classification and is reported', () => {
    const context = {
      servedText: '"some-other-handle"',
      declared: new Map([
        ['test-only-handle-no-source-declares', 'components/gov-chat-frontend/src/components/ChatFolders.vue'],
        ['chat-history-item', 'components/gov-chat-frontend/src/components/ChatFolders.vue']
      ]),
      boundSha: 'abc1234def',
      declaredAtBuild: (sha, handle) =>
        sha === 'HEAD' ? true : handle === 'test-only-handle-no-source-declares' ? false : true,
      // The first handle is declared by the working tree but by NO commit.
      committedAtHead: (handle) => handle !== 'test-only-handle-no-source-declares'
    };
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: compound }]]]);
    const { fileable, stale, refused } = partitionStaleVenue(byFile, context);
    expect(stale.size).toBe(0);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
    expect(refused.map((entry) => entry.handle)).toEqual(['test-only-handle-no-source-declares']);
    expect(refused[0].reason).toContain('no commit declares it');
  });

  test('a handle nobody declares is refused with its reason, and the failure is filed', () => {
    const context = {
      servedText: '',
      declared: new Map(),
      boundSha: 'abc1234def',
      declaredAtBuild: () => false,
      committedAtHead: () => true
    };
    const error = [
      'Error: expect(locator).toBeVisible() failed',
      '',
      'Locator: locator(\'[data-testid="chat-history-item"]\')',
      'Error: element(s) not found'
    ].join('\n');
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error }]]]);
    const { fileable, stale, refused } = partitionStaleVenue(byFile, context);
    expect(stale.size).toBe(0);
    expect(fileable.get('tests/e2e/a.spec.js')).toHaveLength(1);
    expect(refused[0].reason).toContain('no build can serve it');
    // The reason must not claim the checkout declares nothing: the app
    // computes some handles at runtime (`:data-test-id="health-${id}"`),
    // and no build carries the literal — so the truth is that no STATIC
    // source declares it, and that neither case can be proven stale.
    expect(refused[0].reason).toContain('no STATIC source');
    expect(refused[0].reason).toContain('computes it at runtime');
  });
});
