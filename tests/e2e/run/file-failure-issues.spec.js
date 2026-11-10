// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { mentionsPath, trackerReason } = require('./file-failure-issues');

const FILE = 'tests/e2e/theme-runtime-config.spec.js';

/**
 * Unit spec for the failure path's dedupe rule.
 *
 * The rule decides WHICH issue a failure lands on; a rule that swallows one
 * file's failure into another's issue (or files a duplicate for a file that
 * is already tracked) is exactly the tracker damage this path exists to
 * prevent, so both directions are pinned here.
 */
test.describe('the dedupe reads a spec path as a PATH TOKEN', () => {
  test('the repository path matches', () => {
    expect(mentionsPath(`see ${FILE} for the assertions`, FILE)).toBe(true);
    expect(mentionsPath(`\`tests/e2e/theme-runtime-config.spec.js\` is red`, FILE)).toBe(true);
  });

  test('an absolute path matches', () => {
    expect(mentionsPath(`/home/jerome/git_projects/ITU/genie-ai/${FILE}`, FILE)).toBe(true);
  });

  test('a URL that ends with the path matches', () => {
    expect(mentionsPath(`https://gitlab.example/un/itu/genie-ai/-/blob/main/${FILE}`, FILE)).toBe(true);
  });

  test('a path that is only the TAIL of another e2e file does NOT match', () => {
    // tests/e2e/helpers/tests/e2e/theme-runtime-config.spec.js is a
    // different file that happens to carry this one's path as its tail.
    expect(mentionsPath('tests/e2e/helpers/tests/e2e/theme-runtime-config.spec.js', FILE)).toBe(false);
  });

  test('the e2e root itself as the prefix does NOT match either', () => {
    // tests/e2e/tests/e2e/theme-runtime-config.spec.js: the prefix is the
    // e2e root exactly, with no trailing separator to key the refusal on.
    expect(mentionsPath('tests/e2e/tests/e2e/theme-runtime-config.spec.js', FILE)).toBe(false);
  });

  test('an unrelated path does not match', () => {
    expect(mentionsPath('components/gov-chat-frontend/src/App.vue', FILE)).toBe(false);
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
