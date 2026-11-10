const path = require('path');
const fs = require('fs');
const os = require('os');

const { e2eJsFiles } = require('../validators/e2e-files');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The venue edge is defined ONCE — tests/e2e/helpers/base-url.js — and
// #1737 was thirteen specs that each carried their own copy of the
// Compose edge: on any venue that is not the Compose stack, each of them
// died with ERR_CONNECTION_REFUSED before its first assertion.
//
// The wave fixed those thirteen. This gate is what keeps the fix: a
// spec that NAVIGATES to an absolute origin is the drift, and it fails
// the gate.
//
// The rule is deliberately narrow — the origin of a NAVIGATION. A spec
// that navigates to a relative path (the app's own routes) or that
// builds its URL from BASE_URL is the correct form, and a spec that
// mocks a server on another origin can say so in one line.
const NAVIGATES_TO_ABSOLUTE_ORIGIN = /goto\(\s*['"`]https?:\/\//;

const offenders = (root) =>
  e2eJsFiles(root)
    .filter((f) => NAVIGATES_TO_ABSOLUTE_ORIGIN.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f));

describe('the e2e suite navigates to the venue it was given', () => {
  test('no spec navigates to an absolute origin', () => {
    expect(offenders(E2E_ROOT)).toEqual([]);
  });

  test('a spec that hardcodes the edge is an offender', () => {
    // Mutation check, on a THROWAWAY tree in the system temp dir — never
    // inside the tracked tests/e2e tree, where a worker killed mid-test
    // would leave a stray that fails the gate forever.
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-origin-gate-'));
    try {
      fs.writeFileSync(path.join(tree, 'hardcoded.spec.js'), "await page.goto('https://localhost/');\n");
      fs.writeFileSync(path.join(tree, 'relative.spec.js'), "await page.goto('/dashboard');\n");
      fs.writeFileSync(path.join(tree, 'from-base-url.spec.js'), 'await page.goto(`${BASE_URL}/`);\n');
      const strays = offenders(tree).map((f) => path.basename(f));
      expect(strays).toEqual(['hardcoded.spec.js']);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });
});
