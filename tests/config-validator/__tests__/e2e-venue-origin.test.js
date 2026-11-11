const path = require('path');
const fs = require('fs');
const os = require('os');

const { jsFiles, stripJsComments } = require('../validators/js-files');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The venue edge is defined ONCE — tests/e2e/helpers/base-url.js — and
// #1737 was thirteen specs that each carried their own copy of the
// Compose edge: on any venue that is not the Compose stack, each of them
// died with ERR_CONNECTION_REFUSED before its first assertion.
//
// The wave fixed those thirteen. This gate is what keeps the fix: the
// EDGE may not appear anywhere else in the suite.
//
// The rule is about the EDGE, not about origins in general: a spec that
// drives a mocked identity provider on its own host navigates somewhere
// else on purpose, and that is not the drift this gate is for. What
// breaks a run is the Compose edge itself — in a navigation, in a URL
// comparison, in an API call, anywhere.
//
// The match is on CODE, not on prose: a comment that names the edge is
// documentation. The scanner (validators/js-files.js) strips comments
// before the match — the same convention the handle-locators gate uses.
const VENUE_EDGE = /https?:\/\/(localhost|127\.0\.0\.1)/;

// The defining module, resolved — not a literal path: if the module
// moves, the exemption follows it (a hardcoded path would turn a legal
// refactor into a red gate).
const DEFINING_MODULE = require.resolve('../../e2e/helpers/base-url');

/**
 * The files that read the venue from the environment — the edge's
 * definition, wherever it is.
 */
const baseUrlReaders = (root) =>
  jsFiles(root)
    .filter((f) => stripJsComments(fs.readFileSync(f, 'utf8')).includes('process.env.BASE_URL'))
    .map((f) => path.relative(root, f));

const offenders = (root) =>
  jsFiles(root)
    .filter((f) => path.resolve(f) !== path.resolve(DEFINING_MODULE))
    .filter((f) => VENUE_EDGE.test(stripJsComments(fs.readFileSync(f, 'utf8'))))
    .map((f) => path.relative(ROOT, f));

describe('the e2e suite names the venue it was given, and names it once', () => {
  test('no file but the definition carries the venue edge', () => {
    expect(offenders(E2E_ROOT)).toEqual([]);
  });

  test('the edge is defined ONCE — one module reads the environment', () => {
    // Before the wave, five files read the environment and each carried
    // its own default — that IS the drift this gate is for, and it is
    // invisible to the edge match above (a spec that builds its URL
    // from a variable breaks just as hard).
    expect(baseUrlReaders(E2E_ROOT)).toEqual([path.relative(E2E_ROOT, DEFINING_MODULE)]);
  });

  test('every reader of the environment is reported, not only the first', () => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-readers-gate-'));
    try {
      fs.writeFileSync(path.join(tree, 'a.spec.js'), "const BASE_URL = process.env.BASE_URL || 'x';\n");
      fs.writeFileSync(path.join(tree, 'b.spec.js'), 'const EDGE = process.env.BASE_URL;\n');
      expect(baseUrlReaders(tree).sort()).toEqual(['a.spec.js', 'b.spec.js']);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });

  test('every spelling that breaks a run is an offender', () => {
    // Mutation check, on a THROWAWAY tree in the system temp dir — never
    // inside the tracked tests/e2e tree, where a worker killed mid-test
    // would leave a stray that fails the gate forever. The three
    // spellings are the ones the wave itself deleted: a navigation, a
    // URL comparison and an API call — and a comment that NAMES the
    // edge is prose, not code, so it is not an offender.
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-origin-gate-'));
    try {
      fs.writeFileSync(path.join(tree, 'navigation.spec.js'), "await page.goto('https://localhost/');\n");
      fs.writeFileSync(path.join(tree, 'compared.spec.js'), "expect(url).toBe('http://127.0.0.1:4443/');\n");
      fs.writeFileSync(path.join(tree, 'api.spec.js'), "await apiContext.post('https://localhost/auth/x');\n");
      fs.writeFileSync(path.join(tree, 'prose.spec.js'), '// the old suite navigated to https://localhost/\n');
      fs.writeFileSync(path.join(tree, 'clean.spec.js'), 'await page.goto(`${BASE_URL}/dashboard`);\n');
      const strays = offenders(tree).map((f) => path.basename(f));
      expect(strays.sort()).toEqual(['api.spec.js', 'compared.spec.js', 'navigation.spec.js']);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });
});
