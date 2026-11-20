// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * Contract checks for the DEVICE-PATH claim the ROCm overlays document.
 *
 * The !968 review found a factual error in the overlay header: it stated
 * that "on this Docker version a device path that does not exist on the host
 * is TOLERATED - the container starts". That is FALSE. The daemon resolves
 * every path in a `devices:` list before it creates the container:
 *
 *   docker run --rm --device /dev/does-not-exist:/dev/does-not-exist alpine:3 true
 *   -> "error gathering device information while adding custom device
 *       "/dev/does-not-exist": no such file or directory"
 *
 * The false claim mattered twice over:
 *
 *   1. it was the stated reason the vendor axis could be spelled as values
 *      in the base compose file - a claim that only holds because the
 *      missing path was assumed to be survivable;
 *   2. the probe that "proved" it ran on a host where the probed path
 *      EXISTED, so it exercised the other branch and could not have
 *      detected the difference.
 *
 * These checks pin the corrected wording where the operator and an AI agent
 * will actually read it. A missing device path is a hard error; a base-file
 * `devices:` row needs a path that exists on every host it renders for
 * (`/dev/null` qualifies, which is why the value-axis spelling uses it).
 *
 * The contract is checked over TEXT, not over a live daemon: the daemon
 * behaviour it pins is Docker's, and it is reproduced verbatim in the
 * header so a reader can re-run it. Asserting on the wording keeps a
 * future edit from re-introducing the false claim under different phrasing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const read = (p) => fs.readFileSync(p, 'utf8');

// Every file that states the claim to a human reader.
const CLAIM_SITES = [
  'docker-compose.rocm.yaml',
  'site/content/en/docs/deploy/gpu.md',
  'docs/superpowers/specs/2026-11-11-rocm-gpu-tier-design.md'
];

// The FALSE assertion, in the forms it was written in. Matched
// case-insensitively and whitespace-tolerantly: "is TOLERATED", "is
// tolerated", "the container starts" after a missing-path clause.
const FALSE_CLAIMS = [
  /does not exist on the host\s+is\s+TOLERATED/i,
  /missing device path is\s+TOLERATED/i,
  /device path that does not exist[^.]*?\bis tolerated\b/i,
  /a missing device path is tolerated/i
];

// A retraction marker. The false claim MAY still be quoted in a file - the
// overlay header quotes it in order to retract it, and a reader who only
// sees the quote must be able to tell it was wrong. So the contract is not
// "the string never appears" but "the string never appears as an
// assertion": every occurrence must sit next to a word that marks it as
// false.
const RETRACTION_MARKERS = [
  /\bFALSE\b/,
  /\bwas wrong\b/i,
  /\boverclaim/i,
  /\bmisread\b/i,
  /\bnot what the daemon does\b/i,
  /\bnot tolerated\b/i
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
  });

  describe('the overlay header states the measured behaviour', () => {
    const header = read(path.join(REPO_ROOT, 'docker-compose.rocm.yaml'));

    it('records that a missing path is a hard error', () => {
      expect(header).toMatch(/missing device path is NOT tolerated/i);
      expect(header).toMatch(/does-not-exist/);
    });

    it('records why the false probe missed it', () => {
      // The header must say the probe exercised the OTHER branch - that is
      // the reason the claim survived review, and the reason a reader
      // re-running the probe would not see the error.
      expect(header).toMatch(/EXISTED/i);
      expect(header).toMatch(/the other branch/i);
    });

    it('points the value axis at /dev/null, a path that exists everywhere', () => {
      expect(header).toMatch(/\/dev\/null/);
    });
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
