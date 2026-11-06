// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * env.js — capture an environment variable so a test that mutates it can put
 * it back.
 *
 * "Was not set" is not "was set to undefined": restoring the second by
 * assignment would leave the variable present with the string "undefined",
 * and every later test in the file would read a configured deployment. The
 * subtlety lives here, once.
 */

/**
 * Capture `name` and return the function that restores it.
 * @param {string} name the environment variable to capture
 * @returns {() => void} call after the test that mutates it
 */
function captureEnv(name) {
  const value = process.env[name];
  return () => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
}

module.exports = { captureEnv };
