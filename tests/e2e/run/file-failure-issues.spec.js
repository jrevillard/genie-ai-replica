// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  findTrackedIssue,
  specPathsIn,
  titleIsDedicatedTo,
  trackerReason,
  groupFailuresByFile,
  issueBody,
  isConnectionSignature,
  venueAvailabilityReport,
} = require('./file-failure-issues');

const FILE = 'tests/e2e/theme-runtime-config.spec.js';

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
    expect(
      titleIsDedicatedTo(`test(e2e): /home/dev/genie-ai/${FILE} is red`, FILE)
    ).toBe(true);
    expect(
      titleIsDedicatedTo(
        `test(e2e): https://gitlab.example/un/itu/genie-ai/-/blob/main/${FILE} is red`,
        FILE
      )
    ).toBe(true);
  });

  test('a title that names the same file twice is still dedicated to it', () => {
    // The SAME token twice, and the file under TWO spellings: both name
    // this one file, so both are a dedication — the title is judged per
    // FILE, not per token.
    expect(titleIsDedicatedTo(`test(e2e): ${FILE} — ${FILE} again`, FILE)).toBe(true);
    expect(titleIsDedicatedTo(`test(e2e): ${FILE} — /home/dev/genie-ai/${FILE}`, FILE)).toBe(true);
    expect(
      titleIsDedicatedTo(
        `test(e2e): ${FILE} — https://gitlab.example/un/itu/genie-ai/-/blob/main/${FILE}`,
        FILE
      )
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
      description: `The wave touched ${FILE} and twelve other files.`,
    };
    expect(findTrackedIssue(FILE, [umbrella])).toBe(null);
  });

  test('an umbrella that LISTS the paths in its TITLE does not absorb the failure either', () => {
    // The title names several spec files: that is a group, not a
    // dedication. The file's own failure still needs its own issue.
    const umbrella = {
      title: `test(e2e): ${FILE} and tests/e2e/other.spec.js are red`,
      description: '',
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

  test('a bare name of ANOTHER tree\'s file is not this tree\'s path', () => {
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

  test('a COPY of this tree elsewhere in the checkout does not make its names another tree\'s', () => {
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

      expect(
        titleIsDedicatedTo('test(e2e): thing.spec.js is red', 'tests/e2e/thing.spec.js', root)
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a bare spec file name is this tree\'s path even when the file is gone', () => {
    // A RENAMED file must not drop out of the comparison: a title that
    // names several spec files is a group, not a dedication, and the
    // renamed file's bare name must still count as one of them —
    // otherwise one multi-file title turns into a dedication to a file
    // that is not in it.
    //
    // The BARE spelling is the one that decides it: a token that carries
    // the tree's root ('tests/e2e/...') is recognised by the root alone,
    // whether the file exists or not. The bare name is recognised by its
    // OWN shape — it names a spec file — so a file that was renamed
    // away still counts.
    const renamed = 'tests/e2e/renamed-away.spec.js';
    expect(titleIsDedicatedTo('test(e2e): renamed-away.spec.js is red', renamed)).toBe(true);
    // And it must not swallow a file it does not name.
    expect(titleIsDedicatedTo('test(e2e): renamed-away.spec.js is red', FILE)).toBe(false);
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
      { file: 'tests/e2e/b.spec.js', title: 'b › third', test: { results: [{ error: { message: 'snap' } }] } },
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
    const body = issueBody('tests/e2e/a.spec.js', [{ title: 'a › first', error: 'boom' }], 'https://venue.example:4443', '2026-11-11T00:00:00Z');
    expect(body).toContain('- spec file: `tests/e2e/a.spec.js`');
    // And the failure it files is in the body.
    expect(body).toContain('a › first');
  });
});

test.describe('the tracker refusal names the tracker, not the command', () => {
  test('the first stderr line is the tracker message', () => {
    const error = new Error('Command failed: glab api projects/90/issues -f title=<the whole body>');
    error.stderr = 'glab: 404 Not found (HTTP 404)\n';
    expect(trackerReason(error)).toBe('glab: 404 Not found (HTTP 404)');
  });

  test('without stderr, the error message carries the reason', () => {
    const error = new Error('spawn glab ENOENT\nat ChildProcess');
    expect(trackerReason(error)).toBe('spawn glab ENOENT | at ChildProcess');
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
    // A mixed file: one outage symptom, one real assertion failure — the
    // real one stays fileable, the outage one does not.
    const byFile = groupFailuresByFile([
      {
        file: 'tests/e2e/welcome-banner.spec.js',
        title: 'shows the banner',
        test: { results: [{ error: { message: OUTAGE_ERROR, stack: '' } }] }
      },
      {
        file: 'tests/e2e/welcome-banner.spec.js',
        title: 'hides the banner',
        test: { results: [{ error: { message: 'expect(received).toBe(expected)', stack: '' } }] }
      }
    ]);
    expect(byFile.get('tests/e2e/welcome-banner.spec.js').length).toBe(2);
    const failures = byFile.get('tests/e2e/welcome-banner.spec.js');
    expect(failures.filter(isConnectionSignature).length).toBe(1);
    expect(failures.filter((f) => !isConnectionSignature(f)).length).toBe(1);
  });

  test('the venue-availability report names the venue, the files and the verdict', () => {
    const noise = new Map([
      [
        'tests/e2e/welcome-banner.spec.js',
        [
          { error: OUTAGE_ERROR },
          { error: 'net::ERR_CONNECTION_RESET' }
        ]
      ],
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
