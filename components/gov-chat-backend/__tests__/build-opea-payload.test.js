// D4: pins the REAL QueryService.buildOpeaPayload (no stub) — the text→messages
// normalization that fixed the live ChatCompletionRequest rejection: the
// frontend may send `text` instead of a messages array, and chatqna rejects a
// payload without messages. Sync function, plain jest.
const queryService = require('../services/query-service');

describe('QueryService.buildOpeaPayload (real)', () => {
  it('synthesizes messages from a text-only body (conversation-with-context-labels)', () => {
    const payload = queryService.buildOpeaPayload(
      { text: 'hi', context: { categoryLabel: 'General', serviceLabels: [] } },
      'conversation-with-context-labels',
      true
    );
    expect(payload.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(payload.stream).toBe(true);
    expect(payload.context).toMatchObject({ categoryLabel: 'General', serviceLabels: [] });
  });

  it('leaves a messages-bearing body unchanged', () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }
    ];
    const payload = queryService.buildOpeaPayload(
      { messages, context: { categoryLabel: 'X', serviceLabels: ['s'] } },
      'conversation-with-context-labels'
    );
    expect(payload.messages).toEqual(messages);
    expect(payload.stream).toBe(false);
    expect(payload.user_id).toBeUndefined();
  });

  it('single-message mode extracts the last message content', () => {
    const payload = queryService.buildOpeaPayload(
      { messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'last' }] },
      'single-message',
      true
    );
    expect(payload).toEqual({ messages: 'last', stream: true });
  });

  // G.2a (FR13): single-message mode forwards the UI locale — the old branch
  // stripped context/language entirely, so chatqna auto-detected (langdetect
  // has no Sesotho) and the ST machinery was bypassed (live-proven 10-01).
  it('single-message mode forwards the top-level language to chatqna', () => {
    const payload = queryService.buildOpeaPayload(
      { messages: [{ role: 'user', content: 'last' }], language: 'ST' },
      'single-message',
      true
    );
    expect(payload.messages).toBe('last');
    expect(payload.language).toBe('ST');
    expect(payload.stream).toBe(true);
  });

  it('single-message mode falls back to context.language when top-level absent', () => {
    const payload = queryService.buildOpeaPayload(
      { messages: [{ role: 'user', content: 'last' }], context: { language: 'ST' } },
      'single-message',
      true
    );
    expect(payload.language).toBe('ST');
  });

  it('upper-cases a lowercase locale before forwarding (chatqna compares exact "EN")', () => {
    const payload = queryService.buildOpeaPayload(
      { messages: [{ role: 'user', content: 'last' }], language: 'st' },
      'single-message',
      true
    );
    expect(payload.language).toBe('ST');
    const conv = queryService.buildOpeaPayload(
      { messages: [{ role: 'user', content: 'hi' }], context: { language: 'en' } },
      'conversation-with-context-labels'
    );
    expect(conv.context.language).toBe('EN');
  });

  it('omits the language key entirely when no locale is known (old-client compat)', () => {
    const payload = queryService.buildOpeaPayload(
      { messages: [{ role: 'user', content: 'last' }] },
      'single-message',
      true
    );
    expect(payload).not.toHaveProperty('language');
    // And on the wire: JSON serialization must not resurrect it.
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('language');
  });

  it('conversation mode context.language falls back to the top-level field', () => {
    const payload = queryService.buildOpeaPayload(
      { messages: [{ role: 'user', content: 'hi' }], language: 'ST', context: {} },
      'conversation-with-context-labels'
    );
    expect(payload.context.language).toBe('ST');
  });
});
