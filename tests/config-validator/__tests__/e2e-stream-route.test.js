const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');

// The ONE place the stream interception contract lives: the route glob is
// defined in helpers/chatbot.js and exported (STREAM_ROUTE); every spec
// imports it. #1271 happened because a copy of the glob drifted away from
// the endpoint the app calls — an interception that no longer matches
// silently lets the request reach the real network, and the spec then
// asserts against a live backend. This gate closes the class: a spec that
// re-types the glob fails the same pipeline that runs it.
const STREAM_ROUTE_SOURCE = 'tests/e2e/helpers/chatbot.js';
const STREAM_ROUTE_GLOB = '**/queries/stream**';

const e2eFiles = () =>
  fs
    .readdirSync(E2E_ROOT, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(E2E_ROOT, f))
    .sort();

const straySources = () =>
  e2eFiles()
    .filter((f) => path.relative(ROOT, f) !== STREAM_ROUTE_SOURCE)
    .filter((f) => fs.readFileSync(f, 'utf8').includes(STREAM_ROUTE_GLOB))
    .map((f) => path.relative(ROOT, f));

describe('the e2e suite intercepts the stream endpoint through the shared constant', () => {
  test('the route glob literal lives only in helpers/chatbot.js', () => {
    expect(straySources()).toEqual([]);
  });

  test('the shared source really carries the glob', () => {
    // A gate that silently matches nothing is worse than no gate: if the
    // glob moves (the endpoint is renamed, the helper is refactored),
    // this fails and names the file the offenders list must point at.
    expect(fs.existsSync(path.join(ROOT, STREAM_ROUTE_SOURCE))).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, STREAM_ROUTE_SOURCE), 'utf8')).toContain(STREAM_ROUTE_GLOB);
  });

  test('a drifted copy is an offender', () => {
    // Mutation check: a spec that re-types the glob must fail the gate,
    // not pass it. The fixture is removed before the test returns, so no
    // other suite sees it.
    const stray = path.join(E2E_ROOT, 'gate-mutation-fixture.tmp.js');
    try {
      fs.writeFileSync(stray, "await page.route('**/queries/stream**', () => {});\n");
      expect(straySources()).toEqual(['tests/e2e/gate-mutation-fixture.tmp.js']);
    } finally {
      fs.unlinkSync(stray);
    }
  });
});
