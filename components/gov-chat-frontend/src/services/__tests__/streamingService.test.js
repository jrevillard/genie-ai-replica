import { TextEncoder, TextDecoder } from 'util';
// node-env jest lacks the Web APIs the browser service uses
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;
import { createSSEParser, streamChatQuery } from '../streamingService';

describe('createSSEParser', () => {
  it('emits one event per data line, tolerating chunk splits mid-line', () => {
    const events = [];
    const p = createSSEParser((raw) => events.push(raw));
    p.push('data: {"quer');
    p.push('yId":"a1"}\n\n');
    p.push('data: {"delta":"hello "}\ndata: {"delta":"world"}\n');
    p.push('data: {"done":true}');
    p.flush();
    expect(events).toEqual(['{"queryId":"a1"}', '{"delta":"hello "}', '{"delta":"world"}', '{"done":true}']);
  });

  it('ignores non-data lines (comments, event fields)', () => {
    const events = [];
    const p = createSSEParser((raw) => events.push(raw));
    p.push(': keep-alive\n-event: x\ndata: {"delta":"a"}\n');
    p.flush();
    expect(events).toEqual(['{"delta":"a"}']);
  });
});

function sseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader() {
        return {
          read() {
            return Promise.resolve(i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true });
          }
        };
      }
    }
  };
}

describe('streamChatQuery', () => {
  it('aggregates deltas and resolves with the full result', async () => {
    const deltas = [];
    const fetchImpl = jest.fn().mockResolvedValue(
      sseResponse(['data: {"queryId":"q9"}\n', 'data: {"delta":"pl"}\ndata: {"delta":"ant"}\n', 'data: {"done":true,"metadata":{"m":1}}\n'])
    );
    const result = await streamChatQuery({ userId: 'u', sessionId: 's', messages: [] }, { onDelta: (d) => deltas.push(d) }, fetchImpl);
    expect(deltas).toEqual(['pl', 'ant']);
    expect(result.response).toBe('plant');
    expect(result.queryId).toBe('q9');
    expect(result.metadata).toEqual({ m: 1 });
  });

  it('rejects with streamStarted=false on HTTP error (caller falls back)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(sseResponse(['{}'], 500));
    await expect(streamChatQuery({}, {}, fetchImpl)).rejects.toMatchObject({ streamStarted: false });
  });

  // Audit F9: a clean EOF after deltas is a TRUNCATION — never a complete answer.
  it('EOF without done rejects with the partial text attached', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      sseResponse(['data: {"queryId":"q9"}\n', 'data: {"delta":"half an ans"}\n'])
    );
    await expect(streamChatQuery({}, {}, fetchImpl)).rejects.toMatchObject({
      streamStarted: true,
      partial: 'half an ans'
    });
  });

  // Audit F9: the backend's error STRING must survive to the UI.
  it('error events pass their text to onError and land in result.error', async () => {
    const seenErrors = [];
    const fetchImpl = jest.fn().mockResolvedValue(
      sseResponse(['data: {"queryId":"q9"}\n', 'data: {"error":"empty response from pipeline"}\n', 'data: {"done":true}\n'])
    );
    const result = await streamChatQuery({}, { onError: (e) => seenErrors.push(e) }, fetchImpl);
    expect(seenErrors).toEqual(['empty response from pipeline']);
    expect(result.error).toBe('empty response from pipeline');
  });

  it('rejects with streamStarted=false when nothing was ever emitted', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(sseResponse([': silence\n']));
    await expect(streamChatQuery({}, {}, fetchImpl)).rejects.toMatchObject({ streamStarted: false });
  });

  // F4 end-of-stream translation: {translation} replaces the streamed English
  // preview; {translationNotice} is a distinct, non-error event.
  it('dispatches onTranslation with the final text and replaces result.response', async () => {
    const translations = [];
    const fetchImpl = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"queryId":"q9"}\n',
        'data: {"delta":"hello"}\n',
        'data: {"translation":"lumela"}\n',
        'data: {"done":true}\n',
      ])
    );
    const result = await streamChatQuery({}, { onTranslation: (t) => translations.push(t) }, fetchImpl);
    expect(translations).toEqual(['lumela']);
    expect(result.response).toBe('lumela');
  });

  it('dispatches onTranslationNotice without failing the stream', async () => {
    const notices = [];
    const fetchImpl = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"queryId":"q9"}\n',
        'data: {"delta":"hello"}\n',
        'data: {"translationNotice":true}\n',
        'data: {"done":true}\n',
      ])
    );
    const result = await streamChatQuery({}, { onTranslationNotice: () => notices.push(1) }, fetchImpl);
    expect(notices).toHaveLength(1);
    expect(result.error).toBeNull();
    expect(result.response).toBe('hello'); // English answer stands
  });

  it('rejects with streamStarted=true if it dies after emitting deltas', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader() {
          let n = 0;
          return {
            read() {
              n += 1;
              if (n === 1) return Promise.resolve({ done: false, value: encoder.encode('data: {"delta":"par"}\n') });
              return Promise.reject(new Error('connection dropped'));
            }
          };
        }
      }
    });
    await expect(streamChatQuery({}, {}, fetchImpl)).rejects.toMatchObject({ streamStarted: true });
  });
});
