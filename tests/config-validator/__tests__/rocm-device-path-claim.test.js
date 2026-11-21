// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * Contract checks for the DEVICE-PATH claim the ROCm vendor axis depends on.
 *
 * The !968 review found a factual error in the (now deleted) overlay header:
 * it stated that "on this Docker version a device path that does not exist on
 * the host is TOLERATED - the container starts". That is FALSE. The daemon
 * resolves every path in a `devices:` list before it creates the container:
 *
 *   docker run --rm --device /dev/does-not-exist:/dev/does-not-exist alpine:3 true
 *   -> "error gathering device information while adding custom device
 *       "/dev/does-not-exist": no such file or directory"
 *
 * The false claim mattered because it was the stated reason the vendor axis
 * could be spelled as values in the BASE compose files: a base-file
 * `devices:` row renders on EVERY host, NVIDIA included, so its unset state
 * needs device paths that exist everywhere (/dev/null and /dev/zero). Had
 * the paths been "tolerated when missing", arbitrary names would do. They
 * are not: the interpolated rows use paths that exist on every host, and
 * the literal /dev/kfd + /dev/dri rows sit ONLY on profile-disabled or
 * vendor-conditioned services that never render on NVIDIA.
 *
 * These checks pin the corrected wording where the operator and an AI agent
 * will actually read it. A missing device path is a hard error; a base-file
 * `devices:` row needs a path that exists on every host it renders for
 * (`/dev/null` qualifies, which is why the value-axis spelling uses it).
 *
 * The contract is checked over TEXT, not over a live daemon: the daemon
 * behaviour it pins is Docker's, and it is reproduced verbatim in the docs
 * so a reader can re-run it. Asserting on the wording keeps a future edit
 * from re-introducing the false claim under different phrasing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const read = (p) => fs.readFileSync(p, 'utf8');

// Every file that states the claim to a human reader.
const CLAIM_SITES = [
  'docker-compose.yaml',
  'docker-compose.gpu.yaml',
  'site/content/en/docs/deploy/gpu.md',
  'docs/superpowers/specs/2026-11-11-rocm-gpu-tier-design.md'
];

// The FALSE assertion, in the forms it was written in. Matched
// case-insensitively and whitespace-tolerantly.
const FALSE_CLAIMS = [
  /does not exist on the host\s+is\s+TOLERATED/i,
  /missing device path is\s+TOLERATED/i,
  /device path that does not exist[^.]*?\bis tolerated\b/i,
  /a missing device path is tolerated/i
];

// A retraction marker. The false claim MAY still be quoted in a file - a
// doc quotes it in order to retract it, and a reader who only sees the
// quote must be able to tell it was wrong. So the contract is not "the
// string never appears" but "the string never appears as an assertion":
// every occurrence must sit next to a word that marks it as false.
const RETRACTION_MARKERS = [
  /\bFALSE\b/,
  /\bwas wrong\b/i,
  /\boverclaim/i,
  /\bmisread\b/i,
  /\bnot what the daemon does\b/i,
  /\bnot tolerated\b/i,
  /\bhard (create-time )?error\b/i
];

// The window around a match that must contain the retraction marker.
const RETRACTION_WINDOW_CHARS = 320;

// Every occurrence of the false claim must be a retraction. Returns the
// occurrences that are NOT marked as such.
const unretractedOccurrences = (text) => {
  const offenders = [];
  for (const pattern of FALSE_CLAIMS) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'gi'))) {
      const start = Math.max(0, match.index - RETRACTION_WINDOW_CHARS);
      const end = Math.min(text.length, match.index + match[0].length + RETRACTION_WINDOW_CHARS);
      const window = text.slice(start, end);
      if (!RETRACTION_MARKERS.some((marker) => marker.test(window))) {
        offenders.push(match[0]);
      }
    }
  }
  return offenders;
};

describe('the ROCm device-path claim', () => {
  describe('no file states that a missing device path is tolerated', () => {
    for (const site of CLAIM_SITES) {
      it(`${site} does not assert that a missing device path is tolerated`, () => {
        const text = read(path.join(REPO_ROOT, site));
        expect(unretractedOccurrences(text)).toEqual([]);
      });
    }

    it('the deleted overlay is not quietly resurrected', () => {
      // The overlay headers carried the original false claim. They must
      // stay gone: a re-added overlay both resurrects the two-file vendor
      // axis and reintroduces the wording this file polices.
      for (const file of ['docker-compose.rocm.yaml', 'docker-compose.rocm.gpu.yaml']) {
        expect({ file, exists: fs.existsSync(path.join(REPO_ROOT, file)) }).toEqual({ file, exists: false });
      }
    });
  });

  describe('the base compose files state the measured behaviour', () => {
    // The vendor-axis comments on the interpolated device rows.
    for (const [file, service] of [
      ['docker-compose.yaml', 'vllm'],
      ['docker-compose.gpu.yaml', 'vllm-llm']
    ]) {
      test(`${file} (${service}) records that a missing path is a hard create-time error`, () => {
        const text = read(path.join(REPO_ROOT, file));
        expect(text).toMatch(/a missing device path is a hard create-time error/i);
        // And names the every-host paths the unset state renders.
        expect(text).toMatch(/\/dev\/null/);
        expect(text).toMatch(/\/dev\/zero/);
      });
    }
  });

  describe('the site docs state the measured behaviour', () => {
    const doc = read(path.join(REPO_ROOT, 'site/content/en/docs/deploy/gpu.md'));

    it('shows the failing command and the daemon error', () => {
      expect(doc).toMatch(/docker run --rm --device \/dev\/does-not-exist/);
      expect(doc).toMatch(/error gathering device information/);
    });

    it('says the missing path is not tolerated', () => {
      expect(doc).toMatch(/not\*\*?\s+tolerated/i);
    });
  });
});
