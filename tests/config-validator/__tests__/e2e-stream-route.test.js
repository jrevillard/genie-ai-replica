const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The ONE place the stream interception contract lives: the endpoint is
// defined in helpers/chatbot.js and exported (STREAM_PATH / STREAM_ROUTE);
// every spec imports it. #1271 happened because a copy of the route
// pattern drifted away from the endpoint the app calls — an interception
// that no longer matches silently lets the request reach the real
// network, and the spec then asserts against a live backend. This gate
// closes the class: a spec that carries the endpoint string in ANY
// spelling fails the gate, and a spec that imports the constant passes.
//
// The validator keeps NO copy of the endpoint: it reads the path out of
// the single source, so a rename cannot leave the gate watching a stale
// string — the scan target moves with the definition.
const STREAM_ROUTE_SOURCE = path.join(E2E_ROOT, 'helpers/chatbot.js');

const streamPathFromSource = () => {
  const source = fs.readFileSync(STREAM_ROUTE_SOURCE, 'utf8');
  const match = source.match(/const STREAM_PATH = '([^']+)';/);
  return match ? match[1] : null;
};

// Every .js file under the given root, node_modules excluded — the
// installed dependency tree is not a spec, and a copy of the endpoint
// string inside a dependency is not a drift this gate is for.
const e2eFiles = (root) =>
  fs
    .readdirSync(root, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !f.split(path.sep).includes('node_modules'))
    .map((f) => path.join(root, f));

const filesCarrying = (root, needle) => {
  // The one exemption is the file that DEFINES the endpoint —
  // helpers/chatbot.js relative to the scanned root, so the same scan
  // works over the real tree and over a throwaway mutation tree.
  const defining = path.join(root, 'helpers', 'chatbot.js');
  return e2eFiles(root)
    .filter((f) => path.resolve(f) !== path.resolve(defining))
    .filter((f) => fs.readFileSync(f, 'utf8').includes(needle));
};

describe('the e2e suite intercepts the stream endpoint through the shared constant', () => {
  test('the single source really defines the endpoint path', () => {
    // A gate that silently matches nothing is worse than no gate: if the
    // constant moves (renamed, inlined, moved to another module), this
    // fails and names the file the scan reads.
    expect(streamPathFromSource()).not.toBeNull();
  });

  test('no other e2e file carries the endpoint string in any spelling', () => {
    const endpoint = streamPathFromSource();
    const offenders = filesCarrying(E2E_ROOT, endpoint).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  test('a drifted copy is an offender', () => {
    // Mutation check, on a THROWAWAY tree in the system temp dir — never
    // inside the tracked tests/e2e tree, where a worker killed mid-test
    // would leave a stray that fails the gate forever. The tree models
    // the suite: a helper carrying the definition (excluded) and a spec
    // re-typing the endpoint (reported).
    const endpoint = streamPathFromSource();
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-route-gate-'));
    try {
      fs.mkdirSync(path.join(tree, 'helpers'), { recursive: true });
      fs.writeFileSync(path.join(tree, 'helpers', 'chatbot.js'), `const STREAM_PATH = '${endpoint}';\n`);
      fs.writeFileSync(path.join(tree, 'spec.js'), `await page.route('**${endpoint}**', () => {});\n`);
      fs.writeFileSync(path.join(tree, 'clean.js'), 'await page.goto(BASE_URL);\n');
      const strays = filesCarrying(tree, endpoint).map((f) => path.basename(f));
      expect(strays.sort()).toEqual(['spec.js']);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });
});
