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
// The rule is about the LOCAL ORIGIN — the edge the Compose stack
// serves, in every spelling it has (https://localhost/, and
// https://localhost:443/ — the port is part of the address). A spec
// that names one breaks on any venue that is not the Compose stack, in
// a navigation, in a URL comparison, in an API call, anywhere.
//
// A spec that drives a MOCK on a local origin (a mocked identity
// provider, a stub server) goes there on purpose: it lists that origin
// below, and the rule lets it through. The list is empty today — every
// local origin in the tree is the edge itself.
//
// The match is on CODE, not on prose: a comment that names the edge is
// documentation. The scanner (validators/js-files.js) strips comments
// before the match — the same convention the handle-locators gate uses.
const LOCAL_ORIGIN = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi;

// The local origins the suite may drive on purpose: a mocked identity
// provider, a local stub. One per line, with the reason.
const MOCK_ORIGINS = [];

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

const offenders = (root, allowed = MOCK_ORIGINS) =>
  jsFiles(root)
    .filter((f) => path.resolve(f) !== path.resolve(DEFINING_MODULE))
    .filter((f) => {
      const origins = stripJsComments(fs.readFileSync(f, 'utf8')).match(LOCAL_ORIGIN) || [];
      // Every local origin the file names must be one the suite may
      // drive on purpose.
      return origins.some((origin) => !allowed.includes(origin));
    })
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
    // URL comparison and an API call — plus the PORTED spelling of the
    // edge (https://localhost:443/ is the Compose stack's own address).
    // A comment that NAMES the edge is prose, not code, so it is not an
    // offender — and neither is a mock origin the suite may drive.
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-origin-gate-'));
    try {
      fs.writeFileSync(path.join(tree, 'navigation.spec.js'), "await page.goto('https://localhost/');\n");
      fs.writeFileSync(path.join(tree, 'compared.spec.js'), "expect(url).toBe('http://127.0.0.1/');\n");
      fs.writeFileSync(path.join(tree, 'ported.spec.js'), "await page.goto('https://localhost:443/');\n");
      fs.writeFileSync(path.join(tree, 'api.spec.js'), "await apiContext.post('https://localhost/auth/x');\n");
      fs.writeFileSync(path.join(tree, 'prose.spec.js'), '// the old suite navigated to https://localhost/\n');
      fs.writeFileSync(path.join(tree, 'clean.spec.js'), 'await page.goto(`${BASE_URL}/dashboard`);\n');
      // A mocked identity provider or a local mock server is on its own
      // PORT: the rule must let it through — that is not the Compose
      // edge, and the suite may drive such a host on purpose.
      fs.writeFileSync(path.join(tree, 'mock-idp.spec.js'), "await page.goto('http://127.0.0.1:9000/oidc');\n");
      fs.writeFileSync(path.join(tree, 'mock-server.spec.js'), "await page.goto('http://localhost:8123/');\n");
      const strays = offenders(tree, ['http://127.0.0.1:9000', 'http://localhost:8123']).map((f) => path.basename(f));
      expect(strays.sort()).toEqual(['api.spec.js', 'compared.spec.js', 'navigation.spec.js', 'ported.spec.js']);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });
});
