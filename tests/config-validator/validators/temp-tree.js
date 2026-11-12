// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * A throwaway tree in the system temp dir, removed when the case ends.
 *
 * NEVER inside the tracked tests/e2e tree: a worker killed mid-test would
 * leave a stray there, and a stray fails a gate forever. The system temp
 * dir is the only place a gate may write.
 *
 * `files` maps a path INSIDE the tree to its content; `fn` receives the
 * tree's root and its return value is the case's.
 *
 * `fn` may be ASYNC: the tree is removed when the callback's promise
 * settles, not when the callback returns it. A callback that returned a
 * promise would find its tree deleted under it, mid-run. The synchronous
 * path is unchanged — the helper stays synchronous for the callers that
 * are, and only an async callback gets a promise back.
 */
function withTree(prefix, files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const remove = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(root, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const result = fn(root);
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => {
          remove();
          return value;
        },
        (error) => {
          remove();
          throw error;
        }
      );
    }
    remove();
    return result;
  } catch (e) {
    remove();
    throw e;
  }
}

module.exports = { withTree };
