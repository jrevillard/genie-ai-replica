const path = require('path');
const fs = require('fs');

const { jsFiles, stripJsComments } = require('../validators/js-files');
const { withTree } = require('../validators/temp-tree');
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
const withContractTree = (endpoint, files) =>
  withTree('stream-route-gate-', { [CONTRACT_RELATIVE]: `const STREAM_PATH = '${endpoint}';\n`, ...files }, (tree) =>
    filesCarrying(tree, endpoint).map((f) => path.basename(f))
  );

/** The call SITE the gate anchors on: the app's own stream client
 * module — the file the gate's contract names as the authority on what
 * the app calls. A bare existence check over the tree proved only that
 * SOME file carried the endpoint, so a stale copy elsewhere satisfied
 * the gate while the real client had drifted (#1809). The scan below
 * therefore requires the endpoint to appear in EXACTLY the call site:
 * a stale copy elsewhere, a second unwatched caller, and a client that
 * drifted off the path are all the same red. The scan is the app's .js
 * files (jsFiles); a caller in another extension is outside this scan —
 * supporting one is a gate edit. */
const CLIENT_RELATIVE = 'services/chatbotService.js';
const CLIENT_MODULE = path.join(FRONTEND_SRC, CLIENT_RELATIVE);

/**
 * The endpoint as a PATTERN: the path must END there. A plain substring
 * match is too loose — '/queries/stream' is a prefix of
 * '/queries/streams', so an app that drifted to the longer path would
 * still carry the short one and the anchor would stay green.
 */
const endpointPattern = (needle) => new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_./-])');

/** Is this file one of the app's tests? A fixture that kept the old
 * spelling would keep the anchor alive. */
const isTestFile = (file) => {
  const parts = file.split(path.sep);
  return parts.includes('__tests__') || /\.(spec|test)\.[cm]?[jt]sx?$/.test(parts[parts.length - 1]);
};

/**
 * The app's .js files that carry the endpoint — read over the given
 * root, so the same scan reads the real frontend tree and a throwaway
 * mutation tree. The call site sits at the same relative place in both.
 * Files whose RAW source carries neither the needle nor a block-comment
 * opener cannot gain the needle from comment stripping (stripping only
 * deletes block comments and rewrites line comments as a newline), so
 * they skip the strip — the scan cost drops without changing any
 * verdict.
 */
const appFilesCarrying = (needle, root) => {
  const pattern = endpointPattern(needle);
  return jsFiles(root)
    .filter((f) => !isTestFile(f))
    .filter((f) => {
      const raw = fs.readFileSync(f, 'utf8');
      if (!raw.includes(needle) && !raw.includes('/*')) return false;
      return pattern.test(stripJsComments(raw));
    })
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

  test('the call site is where the gate says it is', () => {
    // The anchor names the app's stream client module; if the frontend
    // moved the call, this fails NAMING the file it did not find — the
    // anchor moves WITH the call, in this file, never silently.
    if (!fs.existsSync(CLIENT_MODULE)) {
      throw new Error(`the anchor's call site is missing: ${CLIENT_MODULE}`);
    }
  });

  test('the constant is the path the app calls — from the call site, only', () => {
    // The e2e constant is the SUFFIX the app's stream client builds
    // (`${baseUrl}/queries/stream`) and the interception glob matches. If
    // the app's spelling changed and the constant did not, every stream
    // spec would silently stop intercepting and assert against the LIVE
    // backend — the #1271 failure this gate exists for.
    expect(appFilesCarrying(STREAM_PATH, FRONTEND_SRC)).toEqual([CLIENT_RELATIVE]);
  });

  test('a stale copy elsewhere does not satisfy the anchor', () => {
    // The mutation the anchor exists to catch (#1809): the client moves
    // off the endpoint AND a stale copy of the old path survives in
    // another file — the set is then NOT the call site alone, and the
    // equality above reds. (The scan inventing nothing is pinned by the
    // real-tree equality, which reads exactly the call site, plus this
    // tree, which reads exactly the stale file.)
    withTree(
      'stream-call-site-',
      {
        [CLIENT_RELATIVE]: 'const url = baseUrl + "/queries/stream-v2";\n',
        'services/other.js': `const legacy = '${STREAM_PATH}';\n`
      },
      (tree) => {
        expect(appFilesCarrying(STREAM_PATH, tree)).toEqual(['services/other.js']);
      }
    );
  });

  test('the contract module stays dependency-free', () => {
    // The config-validate job installs only this package's node_modules:
    // a require in the contract module would fail THERE, far from the
    // edit. The module must stay a plain declaration.
    expect(requiresSomething(CONTRACT_MODULE)).toBe(false);
  });

  test('the dependency-free rule reads the module it is given', () => {
    withTree(
      'stream-free-gate-',
      { 'plain.js': 'const A = 1;\n', 'needy.js': "const B = require('./x');\n" },
      (tree) => {
        expect(requiresSomething(path.join(tree, 'plain.js'))).toBe(false);
        expect(requiresSomething(path.join(tree, 'needy.js'))).toBe(true);
      }
    );
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
    const strays = withContractTree('/', {
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
    const strays = withContractTree(STREAM_PATH, {
      'spec.js': `await page.route('**${STREAM_PATH}**', () => {});\n`,
      'slashless.js': `await page.route('**${STREAM_PATH.replace(/^\//, '')}**', () => {});\n`,
      'prose.js': `// the old suite intercepted ${STREAM_PATH}\n`,
      'clean.js': 'await page.goto(BASE_URL);\n',
      'node_modules/dep/index.js': `fetch('${STREAM_PATH}')\n`
    });
    expect(strays.sort()).toEqual(['slashless.js', 'spec.js']);
  });
});
