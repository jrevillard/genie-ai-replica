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
 */
function withTree(prefix, files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(root, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { withTree };
