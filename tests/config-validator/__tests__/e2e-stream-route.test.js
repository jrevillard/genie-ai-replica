const path = require('path');
const fs = require('fs');
const os = require('os');

const { e2eJsFiles } = require('../validators/e2e-files');
const { STREAM_PATH } = require('../../e2e/helpers/stream-route');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The ONE place the stream interception contract lives: the endpoint is
// defined in helpers/stream-route.js — a dependency-free module — and
// every spec imports it. #1271 happened because a copy of the route
// pattern drifted away from the endpoint the app calls — an interception
// that no longer matches silently lets the request reach the real
// network, and the spec then asserts against a live backend. This gate
// closes the class: a spec that carries the endpoint string in ANY
// spelling fails the gate, and a spec that imports the constant passes.
//
// The validator reads the endpoint from the module itself — the LIVE
// value, not a copy of a declaration whose spelling it would have to
// guess — so a rename or a reformat cannot leave the gate watching a
// stale string.

const filesCarrying = (root, needle) => {
  // The one exemption is the file that DEFINES the endpoint —
  // helpers/stream-route.js relative to the scanned root, so the same
  // scan works over the real tree and over a throwaway mutation tree.
  const defining = path.join(root, 'helpers', 'stream-route.js');
  // Both spellings of the path: a glob that drops the leading slash
  // ('**queries/stream**') matches the app's request just as well, and
  // must not slip past the gate. The slash-less needle is dropped when
  // the path IS the slash alone — an empty needle matches every file,
  // and a gate that flags the whole tree is no gate.
  const slashless = needle.replace(/^\//, '');
  const needles = slashless ? [needle, slashless] : [needle];
  return e2eJsFiles(root)
    .filter((f) => path.resolve(f) !== path.resolve(defining))
    .filter((f) => {
      const source = fs.readFileSync(f, 'utf8');
      return needles.some((n) => source.includes(n));
    });
};

/**
 * A throwaway tree in the system temp dir — never inside the tracked
 * tests/e2e tree, where a worker killed mid-test would leave a stray
 * that fails the gate forever. The tree models the suite: a helper
 * carrying the definition (excluded) and specs re-typing the endpoint
 * (reported).
 */
const withTree = (endpoint, files) => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-route-gate-'));
  try {
    fs.mkdirSync(path.join(tree, 'helpers'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'helpers', 'stream-route.js'), `const STREAM_PATH = '${endpoint}';\n`);
    for (const [name, source] of Object.entries(files)) {
      const full = path.join(tree, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, source);
    }
    return filesCarrying(tree, endpoint).map((f) => path.basename(f));
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
  }
};

describe('the e2e suite intercepts the stream endpoint through the shared constant', () => {
  test('the single source really defines the endpoint path', () => {
    // A gate that silently matches nothing is worse than no gate: if the
    // constant moves (renamed, inlined, moved to another module), the
    // require fails loudly and names the file the gate reads.
    expect(STREAM_PATH).toMatch(/^\/.+/);
  });

  test('no other e2e file carries the endpoint string in any spelling', () => {
    const offenders = filesCarrying(E2E_ROOT, STREAM_PATH).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  test('the slash-less needle is dropped when the path IS the slash alone', () => {
    // An empty needle matches EVERY file, and a gate that flags the whole
    // tree is no gate. The endpoint is read from the source, so the
    // degenerate case is reachable by a rename — and the guard is what
    // keeps it from reporting files that carry no path at all.
    const strays = withTree('/', {
      'with-path.js': "await page.goto('/somewhere');\n",
      'without-path.js': 'const x = 1;\n'
    });
    expect(strays).toContain('with-path.js');
    // The slash-free file is NOT an offender: the empty needle is gone.
    expect(strays).not.toContain('without-path.js');
  });

  test('a drifted copy is an offender', () => {
    // Mutation check: the tree carries a spec that re-typed the endpoint
    // in BOTH spellings, and a dependency that carries it too — the
    // dependency tree is excluded (a copy inside node_modules is not a
    // drift this gate is for, and the exclusion is pinned here, so
    // deleting the filter turns this red).
    const strays = withTree(STREAM_PATH, {
      'spec.js': `await page.route('**${STREAM_PATH}**', () => {});\n`,
      'slashless.js': `await page.route('**${STREAM_PATH.replace(/^\//, '')}**', () => {});\n`,
      'clean.js': 'await page.goto(BASE_URL);\n',
      'node_modules/dep/index.js': `fetch('${STREAM_PATH}')\n`
    });
    expect(strays.sort()).toEqual(['slashless.js', 'spec.js']);
  });
});
