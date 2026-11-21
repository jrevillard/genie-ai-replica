// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { execFileSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

let tracked = null;

/**
 * The repository's tracked files, optionally under one directory.
 *
 * The enumeration is `git ls-files`, exactly what the pipeline checks out —
 * a scratch file a developer left in the tree is not a pipeline input, and
 * neither is it one here. The full list is enumerated once and filtered per
 * call, so a caller that asks for several directories pays one subprocess.
 *
 * @param {string} [directory] - The repository-relative directory to filter by
 * @returns {string[]} The repository-relative tracked file paths
 */
function trackedFiles(directory) {
  if (!tracked) {
    tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
      .split('\0')
      .filter(Boolean);
  }
  if (!directory) {
    return tracked;
  }
  const prefix = `${directory}/`;
  return tracked.filter((file) => file.startsWith(prefix));
}

module.exports = { trackedFiles };
