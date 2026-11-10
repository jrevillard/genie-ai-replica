// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const fs = require('fs');
const path = require('path');

/**
 * Every .js file under a root, with the dependency tree pruned.
 *
 * The tree under tests/e2e holds hundreds of .js files inside
 * node_modules — a copy of a contract inside a dependency is not a drift
 * these gates are for, and reading them costs time on every run.
 *
 * The pruning happens on the RESULT, before anything is read: the
 * recursive listing names the dependency files, and they are filtered out
 * here — the gates never open them.
 *
 * @param {string} root - the directory to walk
 * @returns {string[]} the absolute paths of the .js files
 */
const e2eJsFiles = (root) =>
  fs
    .readdirSync(root, { recursive: true })
    .filter((entry) => entry.endsWith('.js'))
    .filter((entry) => !entry.split(path.sep).includes('node_modules'))
    .map((entry) => path.join(root, entry));

module.exports = { e2eJsFiles };
