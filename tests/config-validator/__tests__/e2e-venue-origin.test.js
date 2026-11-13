const path = require('path');
const fs = require('fs');

const { jsFiles, stripJsComments } = require('../validators/js-files');
const { withTree } = require('../validators/temp-tree');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The venue edge is defined ONCE — tests/e2e/helpers/base-url.js — and
// #1737 was thirteen specs that each carried their own copy of the
// Compose edge: on any venue that is not the Compose stack, each of them
// died with ERR_CONNECTION_REFUSED before its first assertion.
//
// The wave fixed those thirteen. This gate is what keeps the fix: the
// EDGE may not appear anywhere else in the JS TREE this gate reads (the
// `.js` files under tests/e2e and playwright.config.js). The run SCRIPT
// names its own default venue outside that tree — it is the shell that
// starts the run, so it must say which venue it starts against.
//
// The rule is about the LOCAL ORIGIN — the edge the Compose stack
// serves, in every spelling it has (https://localhost/, and
// https://localhost:443/ — the port is part of the address). A spec
// that names one breaks on any venue that is not the Compose stack, in
// a navigation, in a URL comparison, in an API call, anywhere.
//
// A spec that drives a MOCK on a local origin (a mocked identity
// provider, a stub server) goes there on purpose: it lists that origin
// below, and the rule lets it through.
//
// The match is on CODE, not on prose: a comment that names the edge is
// documentation. The scanner (validators/js-files.js) strips comments
// before the match — the same convention the handle-locators gate uses.
// The local origins the repo runs against: the Compose stack
// (localhost), the loopback, and the two k8s venues — the shared forge
// edge (genieai-forge.local) and the deployment edge (genieai.local).
// A spec that hardcodes ANY of them names one venue instead of the one
// it was given, and dies before its first assertion everywhere else.
//
// The boundary is the HOST's: the origin must not be followed by another
// host character (a letter, a digit, a dot or a dash), so
// `https://localhost` matches — the spelling with no trailing slash, the
// one a bare address carries — while `https://localhost.example.com`
// and `https://localhostevil` do not: those are other hosts. A lookahead
// for `/`, `:` or the end of the string misses the first case, because a
// string literal carries a closing quote after the host.
const LOCAL_ORIGIN = /https?:\/\/(?:localhost|127\.0\.0\.1|genieai(?:-forge)?\.local)(?::\d+)?(?![A-Za-z0-9.-])/gi;

// The local origins the suite may drive on purpose: a mocked identity
// provider, a local stub. One per line, with the reason. It is EMPTY on
// purpose today — every local origin in the tree is the edge itself — and
// it is the escape hatch a spec that needs a local mock adds to.
const MOCK_ORIGINS = [
  // The transport owner test (#1804) drives its own local TLS server on
  // an ephemeral loopback port (helpers/auth-request.spec.js) — the
  // loopback prefix is the fixture's address, never a venue.
  'https://127.0.0.1'
];

// The defining module, resolved — not a literal path: if the module
// moves, the exemption follows it (a hardcoded path would turn a legal
// refactor into a red gate).
const DEFINING_MODULE = require.resolve('../../e2e/helpers/base-url');

// The suite's OTHER owner of the edge: playwright.config.js sets the
// baseURL. It is watched with the tree, because a second definition
// there would break every spec at once — and the wave changed that file
// (it reads the published address now), so the gate must watch the file
// it changed.
const CONFIG_FILE = path.join(ROOT, 'playwright.config.js');

/** The files the gate watches. */
const WATCHED = [...jsFiles(E2E_ROOT), CONFIG_FILE];

/**
 * The files that read the venue from the environment — the edge's
 * definition, wherever it is.
 */
const baseUrlReaders = (files) =>
  files.filter((f) => READS_EDGE.test(stripJsComments(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f));

/**
 * The spellings of the edge's read: the property
 * (`process.env.BASE_URL`), the bracket form (`process.env['BASE_URL']`)
 * and the destructuring (`const { BASE_URL } = process.env`).
 *
 * The destructuring's gap stops at a COMMA and at a NEWLINE: the gap is
 * what stands between the closing brace and the `= process.env`, and a
 * gap that crosses a line (or a comma) can reach an UNRELATED
 * `process.env` — a function parameter named `BASE_URL` followed by any
 * later `= process.env` would then read as a read of the environment.
 * The gate reports every reader, so a false positive there is a file
 * that is wrongly named.
 */
const READS_EDGE =
  /process\.env\.BASE_URL\b|process\.env\s*\[\s*['"]BASE_URL['"]\s*\]|\{\s*BASE_URL\s*[:=,}][^=,\n]*=\s*process\.env/;

const offenders = (files, allowed = MOCK_ORIGINS) =>
  files
    .filter((f) => path.resolve(f) !== path.resolve(DEFINING_MODULE))
    .filter((f) => {
      const origins = stripJsComments(fs.readFileSync(f, 'utf8')).match(LOCAL_ORIGIN) || [];
      // Every local origin the file names must be one the suite may
      // drive on purpose.
      return origins.some((origin) => !allowed.includes(origin));
    })
    .map((f) => path.relative(ROOT, f));

describe('the e2e suite names the venue it was given, and names it once', () => {
  test("the suite's config is watched with the tree", () => {
    // The watched SET is part of the contract: the config is the suite's
    // other owner of the edge, and a watch that dropped it would let a
    // second definition back in — silently.
    expect(WATCHED).toContain(CONFIG_FILE);
  });

  test('no file but the definition carries the venue edge', () => {
    expect(offenders(WATCHED)).toEqual([]);
  });

  test('the edge is defined ONCE — one module reads the environment', () => {
    // Before the wave, FOUR files read the environment — five read sites
    // — measured over the wave's base tree (`fa192ab7`; the composer spec
    // it cites now lives at `tests/e2e/chatbot/chat-composer.spec.js`
    // after the #1741 reorganization):
    // `playwright.config.js` (1), `tests/e2e/chat-composer.spec.js` (1),
    // `tests/e2e/helpers/chatbot.js` (1) and
    // `tests/e2e/theme-runtime-config.spec.js` (2). Every one of them
    // carried its OWN default, so the edge could drift — and the drift is
    // invisible to the edge match above (a spec that builds its URL from
    // a variable breaks just as hard).
    //
    // The config is watched too: it is the suite's other owner of the
    // edge, and the gate counts the readers of the tree AND of the
    // config.
    expect(baseUrlReaders(WATCHED)).toEqual([path.relative(ROOT, DEFINING_MODULE)]);
  });

  test('every reader of the environment is reported, not only the first', () => {
    withTree(
      'venue-readers-gate-',
      {
        'a.spec.js': "const BASE_URL = process.env.BASE_URL || 'x';\n",
        'b.spec.js': 'const EDGE = process.env.BASE_URL;\n',
        // The destructuring spelling is a read too.
        'c.spec.js': 'const { BASE_URL } = process.env;\n',
        // The RENAMED destructuring is a read too.
        'd.spec.js': 'const { BASE_URL: EDGE } = process.env;\n',
        // A function PARAMETER named BASE_URL is not a read of the
        // environment — and a later `= process.env` must not make it one.
        'param.spec.js': 'function f({ BASE_URL }) {\n  return 1;\n}\nconst y = process.env;\n'
      },
      (tree) => {
        expect(
          baseUrlReaders(jsFiles(tree))
            .map((f) => path.basename(f))
            .sort()
        ).toEqual(['a.spec.js', 'b.spec.js', 'c.spec.js', 'd.spec.js']);
      }
    );
  });

  test('every spelling that breaks a run is an offender', () => {
    // Mutation check, on a THROWAWAY tree in the system temp dir — never
    // inside the tracked tests/e2e tree, where a worker killed mid-test
    // would leave a stray that fails the gate forever. The three
    // spellings are the ones the wave itself deleted: a navigation, a
    // URL comparison and an API call — plus the PORTED spelling of the
    // edge (https://localhost:443/ is the Compose stack's own address).
    // A comment that NAMES the edge is prose, not code, so it is not an
    // offender — and neither is a mock origin the suite may drive, nor a
    // host that merely STARTS with a local origin
    // (`localhost.example.com`, `localhost-evil`, `127.0.0.10`): the
    // boundary is the HOST's, so those are other hosts.
    withTree(
      'venue-origin-gate-',
      {
        'navigation.spec.js': "await page.goto('https://localhost/');\n",
        'compared.spec.js': "expect(url).toBe('http://127.0.0.1/');\n",
        'ported.spec.js': "await page.goto('https://localhost:443/');\n",
        'api.spec.js': "await apiContext.post('https://localhost/auth/x');\n",
        // The slashless spellings: a bare address, with no trailing slash.
        'bare.spec.js': "await page.goto('https://localhost');\n",
        'bare-k8s.spec.js': "await page.goto('https://genieai.local');\n",
        'prose.spec.js': '// the old suite navigated to https://localhost/\n',
        'clean.spec.js': 'await page.goto(`${BASE_URL}/dashboard`);\n',
        // A mocked identity provider or a local mock server is on its own
        // PORT: the rule must let it through — that is not the Compose
        // edge, and the suite may drive such a host on purpose.
        'mock-idp.spec.js': "await page.goto('http://127.0.0.1:9000/oidc');\n",
        'mock-server.spec.js': "await page.goto('http://localhost:8123/');\n",
        // The venues this repo actually runs against: the shared forge
        // edge and the deployment edge.
        'forge.spec.js': "await page.goto('https://genieai-forge.local:4443/');\n",
        'k8s.spec.js': "await page.goto('https://genieai.local:4443/');\n",
        // The NEGATIVE half of the boundary: a host that merely STARTS
        // with a local origin is ANOTHER host, and the gate must not
        // claim it. These files are written but NOT listed among the
        // expected offenders — the assertion is an exact equality on the
        // offender list, so a file that must not be an offender pins
        // itself by being absent.
        'lookalike-dot.spec.js': "await page.goto('https://localhost.example.com/');\n",
        'lookalike-dash.spec.js': "await page.goto('https://localhost-evil/');\n",
        'lookalike-ip.spec.js': "await page.goto('http://127.0.0.10/');\n"
      },
      (tree) => {
        const strays = offenders(jsFiles(tree), ['http://127.0.0.1:9000', 'http://localhost:8123']).map((f) =>
          path.basename(f)
        );
        expect(strays.sort()).toEqual([
          'api.spec.js',
          'bare-k8s.spec.js',
          'bare.spec.js',
          'compared.spec.js',
          'forge.spec.js',
          'k8s.spec.js',
          'navigation.spec.js',
          'ported.spec.js'
        ]);
      }
    );
  });
});
