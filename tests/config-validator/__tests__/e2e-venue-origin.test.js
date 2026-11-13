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
// The boundary is the HOST's: the origin must not be continued by another
// host character (a letter, a digit, an underscore or a dash), nor by a
// dot that starts ANOTHER label — `https://localhost` matches (the
// spelling with no trailing slash, the one a bare address carries),
// while `https://localhost.example.com`, `https://localhostevil` and
// `https://localhost_evil` do not: those are other hosts. A dot that
// does NOT continue a host — the rooted-FQDN trailing dot
// (`https://localhost./` is the same host), one the previous lookahead
// `[A-Za-z0-9.-]` wrongly treated as a continuation and let through —
// belongs to the host, so it matches. A lookahead for `/`, `:` or the
// end of the string misses the bare case, because a string literal
// carries a closing quote after the host. The class enumerates the
// OPEN-ENDED set of host-continuation characters, which is why DNS
// oddities keep landing as one more character here; the planned
// inversion for the next touch of this predicate is a POSITIVE
// terminator boundary enumerating the CLOSED set of what ends a host
// in JS source (port colon, path slash, quotes, end).
//
// The private ranges are in the list because a venue is also named by
// its ADDRESS: the shared k8s venues sit on private addresses (RFC1918
// and link-local), and a spec that hardcodes the deployment's address
// (`https://10.42.0.189:4443` — #1801) passes a host-NAME list and then
// dies with ERR_CONNECTION_REFUSED on every other venue, exactly the
// failure class the host names are here for. `127.0.0.1` stays a
// LITERAL on purpose: the whole loopback block would pull `127.0.0.10`
// — a lookalike the negative half pins — into the list, and the pinned
// negative half must stay out.
const LOCAL_ORIGIN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|genieai(?:-forge)?\.local|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})(?::\d+)?(?![A-Za-z0-9_-]|\.[A-Za-z0-9_-])/gi;

// The local origins the suite may drive on purpose: a mocked identity
// provider, a local stub. One per line, with the reason. It is EMPTY on
// purpose today — every local origin in the tree is the edge itself — and
// it is the escape hatch a spec that needs a local mock adds to.
const MOCK_ORIGINS = [];

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
    // `tests/e2e/theme/theme-runtime-config.spec.js` (2). Every one of them
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
        // The venue ADDRESS (#1801): a private-IP literal is the same
        // offender class.
        'private-address.spec.js': "await page.goto('https://10.42.0.189:4443/');\n",
        'docker-range.spec.js': "await page.goto('https://172.20.0.5/');\n",
        'link-local.spec.js': "await page.goto('http://169.254.1.1/');\n",
        'home-range.spec.js': "await page.goto('http://192.168.1.10:3000/');\n",
        // The ROOTED-FQDN spelling: a trailing dot is the DNS root, not
        // another label — the same host, so an offender.
        'rooted-localhost.spec.js': "await page.goto('https://localhost./');\n",
        'rooted-forge.spec.js': "await page.goto('https://genieai-forge.local.:4443/');\n",
        'rooted-private.spec.js': "await page.goto('https://10.42.0.189./');\n",
        // The NEGATIVE half of the boundary: a host that merely STARTS
        // with a local origin is ANOTHER host, and the gate must not
        // claim it. These files are written but NOT listed among the
        // expected offenders — the assertion is an exact equality on the
        // offender list, so a file that must not be an offender pins
        // itself by being absent.
        'lookalike-dot.spec.js': "await page.goto('https://localhost.example.com/');\n",
        'lookalike-dash.spec.js': "await page.goto('https://localhost-evil/');\n",
        'lookalike-ip.spec.js': "await page.goto('http://127.0.0.10/');\n",
        // The private ranges have lookalikes too: an address outside the
        // RFC1918 block, a private address that is a SUBDOMAIN of
        // another host, and underscore/dash-led continuations of the
        // pinned hosts must stay out.
        'lookalike-172.spec.js': "await page.goto('https://172.1.0.5/');\n",
        'lookalike-private-host.spec.js': "await page.goto('https://10.42.0.189.example.com/');\n",
        'lookalike-underscore.spec.js': "await page.goto('https://localhost_evil/');\n",
        'lookalike-underscore-label.spec.js': "await page.goto('https://localhost._evil.x/');\n"
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
          'docker-range.spec.js',
          'forge.spec.js',
          'home-range.spec.js',
          'k8s.spec.js',
          'link-local.spec.js',
          'navigation.spec.js',
          'ported.spec.js',
          'private-address.spec.js',
          'rooted-forge.spec.js',
          'rooted-localhost.spec.js',
          'rooted-private.spec.js'
        ]);
      }
    );
  });
});
