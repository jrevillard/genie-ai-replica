// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const {
  findTrackedIssue,
  specPathsIn,
  titleIsDedicatedTo,
  trackerReason,
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
    expect(titleIsDedicatedTo(`test(e2e): ${FILE} — ${FILE} again`, FILE)).toBe(true);
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
