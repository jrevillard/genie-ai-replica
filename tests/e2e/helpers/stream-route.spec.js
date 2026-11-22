// The mutation gate for the single-sourced SSE envelope
// (helpers/stream-route.js): the wire contract of a mocked answer, pinned
// frame by frame. What each pin buys:
//
//   - dropping the legacy default (metadata or done lost, order changed)
//     turns the legacy-bytes specs red — every existing mocked spec rides
//     this exact shape;
//   - dropping the agentic extension's pinned positions (activity riding
//     with the chunks, verdict between the last chunk and the metadata
//     frame, done last) turns the extension specs red;
//   - a changed frame payload (type, version, status/operation/callId)
//     turns the exact-frame specs red — the e2e degradation spec asserts
//     the app against these very bytes, so a silent drift here would
//     unhook both.
const { test, expect } = require('@playwright/test');
const { CORS_HEADERS, STREAM_PATH, STREAM_ROUTE, sseBody, sseFrame, sseFulfill } = require('./stream-route');

const GROUNDED_VERDICT = {
  grounding_status: 'grounded',
  is_grounded: true,
  translation_mode: 'none'
};

function parseFrames(body) {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

test.describe('sseBody — the legacy five-type dialect', () => {
  test('two-arg call builds exactly the legacy bytes', () => {
    expect(sseBody(['a', 'b'], { is_grounded: true })).toBe(
      [
        'data: {"type":"chunk","content":"a"}',
        'data: {"type":"chunk","content":"b"}',
        'data: {"type":"metadata","is_grounded":true}',
        '',
        'data: {"type":"done","queryId":"mock-query-1"}',
        ''
      ].join('\n')
    );
  });

  test('no metadata means no metadata frame, done still last', () => {
    const frames = parseFrames(sseBody(['only']));
    expect(frames.map((f) => f.type)).toEqual(['chunk', 'done']);
    expect(frames[0]).toEqual({ type: 'chunk', content: 'only' });
    expect(frames[1]).toEqual({ type: 'done', queryId: 'mock-query-1' });
  });
});

test.describe('sseBody — the agentic extension (story 2.9)', () => {
  test('activity frames interleave with the chunks at their pinned positions', () => {
    const frames = parseFrames(
      sseBody(['Hello ', 'world.'], null, {
        activity: [
          { status: 'started', operation: 'search_knowledge', callId: 'c1' },
          { status: 'completed', operation: 'search_knowledge', callId: 'c1' }
        ]
      })
    );
    expect(frames.map((f) => f.type)).toEqual(['agent_activity', 'chunk', 'agent_activity', 'chunk', 'done']);
    expect(frames[0]).toEqual({
      type: 'agent_activity',
      version: 1,
      status: 'started',
      operation: 'search_knowledge',
      callId: 'c1'
    });
    expect(frames[2]).toEqual({
      type: 'agent_activity',
      version: 1,
      status: 'completed',
      operation: 'search_knowledge',
      callId: 'c1'
    });
  });

  test('the verdict frame lands after the last chunk, before metadata, done last', () => {
    const frames = parseFrames(sseBody(['answer'], { is_grounded: true }, { verdict: GROUNDED_VERDICT }));
    expect(frames.map((f) => f.type)).toEqual(['chunk', 'agent_verdict', 'metadata', 'done']);
    // The projection rides verbatim behind the pinned discriminator and version.
    expect(frames[1]).toEqual({ type: 'agent_verdict', version: 1, ...GROUNDED_VERDICT });
  });

  test('activity without verdict, and verdict without activity, are independent', () => {
    const onlyActivity = parseFrames(sseBody(['x'], null, { activity: [{ status: 'started' }] }));
    expect(onlyActivity.map((f) => f.type)).toEqual(['agent_activity', 'chunk', 'done']);
    const onlyVerdict = parseFrames(sseBody(['x'], null, { verdict: GROUNDED_VERDICT }));
    expect(onlyVerdict.map((f) => f.type)).toEqual(['chunk', 'agent_verdict', 'done']);
  });

  test('a verdict payload cannot override the frame discriminator or version', () => {
    // The BFF frame writer deletes its payload's type/version before
    // spreading — the mock mirrors the rule, so a raw upstream payload copy
    // can never mint a frame the real BFF cannot send.
    const frames = parseFrames(sseBody(['x'], null, { verdict: { ...GROUNDED_VERDICT, type: 'chunk', version: 2 } }));
    expect(frames[1]).toEqual({ type: 'agent_verdict', version: 1, ...GROUNDED_VERDICT });
  });

  test('an activity array that does not match the chunk count throws', () => {
    // No silent misalignment: a spec scripting 3 lifecycle entries for 2
    // chunks must fail loudly, not assert against a stream it did not write.
    expect(() => sseBody(['a', 'b'], null, { activity: [{ status: 'started' }] })).toThrow(
      /1 activity entries for 2 chunks/
    );
    expect(() => sseBody(['a'], null, { activity: [{ status: 'started' }, null] })).toThrow(
      /2 activity entries for 1 chunks/
    );
  });
});

test.describe('sseFulfill — the shared envelope', () => {
  test('fulfills 200, text/event-stream, the CORS header, the given body', async () => {
    const calls = [];
    const route = { fulfill: async (opts) => calls.push(opts) };
    await sseFulfill(route, 'BODY');
    expect(calls).toEqual([{ status: 200, contentType: 'text/event-stream', headers: CORS_HEADERS, body: 'BODY' }]);
    expect(CORS_HEADERS).toEqual({ 'access-control-allow-origin': '*' });
  });
});

test.describe('sseFrame — one line outside a full body', () => {
  // The staged-stream spec sends frames one at a time; the pin is the
  // same wire spelling sseBody uses, so a staged frame cannot drift from
  // a body-built one (the app parses both with the same split).
  test('a frame is the data prefix, the verbatim JSON, and a terminator', () => {
    const payload = {
      type: 'agent_activity',
      version: 1,
      status: 'started',
      operation: 'search_knowledge',
      callId: 'c1'
    };
    expect(sseFrame(payload)).toBe(`data: ${JSON.stringify(payload)}\n\n`);
  });

  test('staged frames splice into the body dialect without changing it', () => {
    const frames = parseFrames(`${sseFrame({ type: 'agent_activity', status: 'started' })}${sseBody(['x'], null)}`);
    expect(frames.map((f) => f.type)).toEqual(['agent_activity', 'chunk', 'done']);
    expect(frames[0]).toEqual({ type: 'agent_activity', status: 'started' });
  });
});

test.describe('the interception route', () => {
  // The endpoint's VALUE is pinned once, in the defining module — the
  // e2e-stream-route gate forbids a second spelling anywhere else in the
  // suite. What this spec pins is the derivation: the interception
  // pattern is the path globbed at both ends.
  test('the route pattern is the stream path globbed at both ends', () => {
    expect(STREAM_ROUTE).toBe(`**${STREAM_PATH}**`);
    expect(STREAM_PATH.startsWith('/')).toBe(true);
  });
});
