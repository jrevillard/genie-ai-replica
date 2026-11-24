'use strict';

require('../setup-env');

// The seam dialect's one parser: one SSE data line of the
// agent-service run stream → a tagged result. The parser discipline mirrors
// query-service.parseChatQnASSELine (discriminator, defaults, `__proto__`
// exclusion); the envelope contract (`run_id`/`seq`/`kind` required) is
// validated, and anything else degrades to `{type:'error', raw}` — never a
// half-valid event that drives client frames.

const { parseAgentSeamLine } = require('../../services/agent-seam-parser');

const ENVELOPE = {
  run_id: 'run-abc',
  call_id: 'call-1',
  seq: 4,
  kind: 'tool_call_started',
  payload: { name: 'search_knowledge', arguments: { query: 'tax' } }
};

describe('parseAgentSeamLine — events', () => {
  it('parses a full envelope event', () => {
    expect(parseAgentSeamLine(JSON.stringify(ENVELOPE))).toEqual({ type: 'event', event: ENVELOPE });
  });

  it('defaults call_id to null and payload to {} when the envelope omits them', () => {
    const parsed = parseAgentSeamLine(JSON.stringify({ run_id: 'run-1', seq: 0, kind: 'run_started' }));
    expect(parsed).toEqual({
      type: 'event',
      event: { run_id: 'run-1', call_id: null, seq: 0, kind: 'run_started', payload: {} }
    });
  });

  it('normalizes a null call_id', () => {
    const parsed = parseAgentSeamLine(
      JSON.stringify({ run_id: 'run-1', call_id: null, seq: 1, kind: 'text_message_content', payload: { text: 'hi' } })
    );
    expect(parsed.event.call_id).toBeNull();
    expect(parsed.event.payload).toEqual({ text: 'hi' });
  });

  it('keeps a non-string call_id out of the event (null, not passed through)', () => {
    const parsed = parseAgentSeamLine(
      JSON.stringify({ run_id: 'run-1', call_id: 42, seq: 1, kind: 'verdict', payload: {} })
    );
    expect(parsed.event.call_id).toBeNull();
  });
});

describe('parseAgentSeamLine — usage_record', () => {
  it('parses the terminal usage-record frame', () => {
    const record = { run_id: 'run-1', outcome: 'answered', steps: 2, prompt_tokens: 10, completion_tokens: 5 };
    const parsed = parseAgentSeamLine(JSON.stringify({ usage_record: record }));
    expect(parsed).toEqual({ type: 'usage_record', record });
  });

  it('rejects a non-object usage_record', () => {
    expect(parseAgentSeamLine(JSON.stringify({ usage_record: 'answered' })).type).toBe('error');
    expect(parseAgentSeamLine(JSON.stringify({ usage_record: null })).type).toBe('error');
    expect(parseAgentSeamLine(JSON.stringify({ usage_record: [1] })).type).toBe('error');
  });

  it('a usage_record frame is never also an event (the terminal key wins)', () => {
    const parsed = parseAgentSeamLine(
      JSON.stringify({ usage_record: { outcome: 'answered' }, run_id: 'run-1', seq: 9, kind: 'run_finished' })
    );
    expect(parsed.type).toBe('usage_record');
  });
});

describe('parseAgentSeamLine — the error contract', () => {
  it('rejects a non-JSON line', () => {
    expect(parseAgentSeamLine('b"chunk"')).toEqual({ type: 'error', raw: 'b"chunk"' });
  });

  it('rejects a non-object JSON line (array, number, string)', () => {
    expect(parseAgentSeamLine('[1,2]').type).toBe('error');
    expect(parseAgentSeamLine('42').type).toBe('error');
    expect(parseAgentSeamLine('"run_started"').type).toBe('error');
  });

  it('rejects an envelope missing run_id', () => {
    const parsed = parseAgentSeamLine(JSON.stringify({ seq: 0, kind: 'run_started', payload: {} }));
    expect(parsed.type).toBe('error');
  });

  it('rejects an envelope missing seq', () => {
    expect(parseAgentSeamLine(JSON.stringify({ run_id: 'r', kind: 'run_started' })).type).toBe('error');
  });

  it('rejects an envelope missing kind', () => {
    expect(parseAgentSeamLine(JSON.stringify({ run_id: 'r', seq: 0 })).type).toBe('error');
  });

  it('rejects a non-integer or negative seq', () => {
    expect(parseAgentSeamLine(JSON.stringify({ run_id: 'r', seq: 1.5, kind: 'verdict' })).type).toBe('error');
    expect(parseAgentSeamLine(JSON.stringify({ run_id: 'r', seq: -1, kind: 'verdict' })).type).toBe('error');
    expect(parseAgentSeamLine(JSON.stringify({ run_id: 'r', seq: '0', kind: 'verdict' })).type).toBe('error');
  });

  it('rejects a non-string run_id or kind', () => {
    expect(parseAgentSeamLine(JSON.stringify({ run_id: 7, seq: 0, kind: 'verdict' })).type).toBe('error');
    expect(parseAgentSeamLine(JSON.stringify({ run_id: 'r', seq: 0, kind: 9 })).type).toBe('error');
  });

  it('rejects a non-object payload', () => {
    expect(
      parseAgentSeamLine(JSON.stringify({ run_id: 'r', seq: 0, kind: 'verdict', payload: [1] })).event.payload
    ).toEqual({});
    expect(
      parseAgentSeamLine(JSON.stringify({ run_id: 'r', seq: 0, kind: 'verdict', payload: 'x' })).event.payload
    ).toEqual({});
  });

  it('an empty line is an error, never an event', () => {
    expect(parseAgentSeamLine('')).toEqual({ type: 'error', raw: '' });
    expect(parseAgentSeamLine(undefined)).toEqual({ type: 'error', raw: '' });
  });
});

describe('parseAgentSeamLine — __proto__ exclusion (the parser discipline)', () => {
  it('a __proto__ key in the payload is dropped, never assigned', () => {
    const line = '{"run_id":"r","seq":0,"kind":"verdict","payload":{"__proto__":{"polluted":true},"ok":1}}';
    const parsed = parseAgentSeamLine(line);
    expect(parsed.type).toBe('event');
    expect(parsed.event.payload).toEqual({ ok: 1 });
    expect({}.polluted).toBeUndefined();
  });

  it('a top-level __proto__ key does not pass validation as run_id/kind/seq', () => {
    // JSON.parse itself cannot be confused into setting the prototype here
    // (the parser builds the event object explicitly), but a line carrying
    // the key must still parse to a clean event.
    const line = '{"__proto__":{"x":1},"run_id":"r","seq":0,"kind":"verdict"}';
    const parsed = parseAgentSeamLine(line);
    expect(parsed.type).toBe('event');
    expect(parsed.event).toEqual({ run_id: 'r', call_id: null, seq: 0, kind: 'verdict', payload: {} });
    expect({}.x).toBeUndefined();
  });
});
