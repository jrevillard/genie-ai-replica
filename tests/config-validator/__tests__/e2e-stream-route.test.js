const path = require('path');
const fs = require('fs');
const os = require('os');

const { jsFiles, stripJsComments } = require('../validators/js-files');
const { STREAM_PATH } = require('../../e2e/helpers/stream-route');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');
const FRONTEND_SRC = path.join(ROOT, 'components/gov-chat-frontend/src');

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

// The defining module, resolved — not a literal path: if the module
// moves, the exemption follows it (a hardcoded path would turn a legal
// refactor into a red gate).
const CONTRACT_MODULE = require.resolve('../../e2e/helpers/stream-route');
const CONTRACT_RELATIVE = path.relative(E2E_ROOT, CONTRACT_MODULE);

const filesCarrying = (root, needle) => {
  // The one exemption is the file that DEFINES the endpoint — the
  // resolved module, at the same relative place in the scanned root, so
  // the same scan works over the real tree and over a throwaway
  // mutation tree.
  const defining = path.join(root, CONTRACT_RELATIVE);
  // Both spellings of the path: a glob that drops the leading slash
  // ('**queries/stream**') matches the app's request just as well, and
  // must not slip past the gate. The slash-less needle is dropped when
  // the path IS the slash alone — an empty needle matches every file,
  // and a gate that flags the whole tree is no gate.
  const slashless = needle.replace(/^\//, '');
  const needles = slashless ? [needle, slashless] : [needle];
  return jsFiles(root)
    .filter((f) => path.resolve(f) !== path.resolve(defining))
    .filter((f) => {
      const source = stripJsComments(fs.readFileSync(f, 'utf8'));
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
    const defining = path.join(tree, CONTRACT_RELATIVE);
    fs.mkdirSync(path.dirname(defining), { recursive: true });
    fs.writeFileSync(defining, `const STREAM_PATH = '${endpoint}';\n`);
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

/** Is this file one of the app's tests? A fixture that kept the old
 * spelling would keep the anchor alive. */
const isTestFile = (file) => {
  const parts = file.split(path.sep);
  return parts.includes('__tests__') || /\.(spec|test)\.[cm]?[jt]sx?$/.test(parts[parts.length - 1]);
};

/**
 * The app's own files that carry the endpoint — the app's source is the
 * authority on what it calls. Its test files are excluded: a fixture
 * that kept the old spelling would keep the anchor alive.
 */
/**
 * The endpoint as a PATTERN: the path must END there. A plain substring
 * match is too loose — '/queries/stream' is a prefix of
 * '/queries/streams', so an app that drifted to the longer path would
 * still carry the short one and the anchor would stay green.
 */
const endpointPattern = (needle) => new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_./-])');

const appFilesCarrying = (needle, root) => {
  const pattern = endpointPattern(needle);
  return jsFiles(root)
    .filter((f) => !isTestFile(f))
    .filter((f) => pattern.test(stripJsComments(fs.readFileSync(f, 'utf8'))))
    .map((f) => path.relative(root, f));
};

/** Does this module require anything? */
const requiresSomething = (modulePath) => /require\(/.test(fs.readFileSync(modulePath, 'utf8'));

describe('the e2e suite intercepts the stream endpoint through the shared constant', () => {
  test('the contract module really defines the endpoint', () => {
    // A RENAME (not a move) leaves the require returning undefined: the
    // gate must say so, naming the module it read.
    expect(typeof STREAM_PATH).toBe('string');
    expect(STREAM_PATH.length).toBeGreaterThan(1);
  });

  test('the constant is the path the app calls', () => {
    // The e2e constant is the SUFFIX the app's stream client builds
    // (`${baseUrl}/queries/stream`) and the interception glob matches. If
    // the app's spelling changed and the constant did not, every stream
    // spec would silently stop intercepting and assert against the LIVE
    // backend — the #1271 failure this gate exists for.
    expect(appFilesCarrying(STREAM_PATH, FRONTEND_SRC)).not.toEqual([]);
  });

  test('the anchor reads the APP, not the e2e tree', () => {
    // The anchor's own rule: the app's client counts, its test files do
    // not (a fixture that kept the old spelling would keep the anchor
    // alive), and a tree that does not carry the path reports nothing.
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-anchor-gate-'));
    try {
      fs.writeFileSync(path.join(tree, 'client.js'), `const url = \`\${baseUrl}${STREAM_PATH}\`;\n`);
      fs.writeFileSync(path.join(tree, 'client.spec.js'), `const url = '${STREAM_PATH}';\n`);
      fs.writeFileSync(path.join(tree, 'other.js'), 'const url = 1;\n');
      expect(appFilesCarrying(STREAM_PATH, tree)).toEqual(['client.js']);
      expect(appFilesCarrying('/nothing/carries/this', tree)).toEqual([]);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });

  test('the contract module stays dependency-free', () => {
    // The config-validate job installs only this package's node_modules:
    // a require in the contract module would fail THERE, far from the
    // edit. The module must stay a plain declaration.
    expect(requiresSomething(CONTRACT_MODULE)).toBe(false);
  });

  test('the dependency-free rule reads the module it is given', () => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-free-gate-'));
    try {
      fs.writeFileSync(path.join(tree, 'plain.js'), 'const A = 1;\n');
      fs.writeFileSync(path.join(tree, 'needy.js'), "const B = require('./x');\n");
      expect(requiresSomething(path.join(tree, 'plain.js'))).toBe(false);
      expect(requiresSomething(path.join(tree, 'needy.js'))).toBe(true);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
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
    // in BOTH spellings, a comment that NAMES it (prose, not code), and
    // a dependency that carries it too — the dependency tree is excluded
    // (a copy inside node_modules is not a drift this gate is for, and
    // the exclusion is pinned here, so deleting the filter turns this
    // red).
    const strays = withTree(STREAM_PATH, {
      'spec.js': `await page.route('**${STREAM_PATH}**', () => {});\n`,
      'slashless.js': `await page.route('**${STREAM_PATH.replace(/^\//, '')}**', () => {});\n`,
      'prose.js': `// the old suite intercepted ${STREAM_PATH}\n`,
      'clean.js': 'await page.goto(BASE_URL);\n',
      'node_modules/dep/index.js': `fetch('${STREAM_PATH}')\n`
    });
    expect(strays.sort()).toEqual(['slashless.js', 'spec.js']);
  });
});
