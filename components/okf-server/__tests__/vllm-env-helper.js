// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
'use strict';

/** Save, delete and restore the vLLM env keys around each test — call once
 * inside a describe; it registers its own beforeEach/afterEach.
 * process.env is shared by every test file a Jest worker runs: without the
 * restore, one file's deletes leak into the next suite. Each caller passes
 * the keys IT mutates, so the blast radius stays visible at the call site. */
function isolateVllmEnv(keys) {
  let saved = {};
  beforeEach(() => {
    saved = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

module.exports = { isolateVllmEnv };
