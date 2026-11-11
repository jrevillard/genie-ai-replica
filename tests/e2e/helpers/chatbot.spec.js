// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { streamingFlagOf } = require('./chatbot');

/**
 * Unit spec for the streaming-flag read — the helper's side of the store
 * contract (#1738).
 *
 * The helper reads the app's store through its PUBLIC getter
 * (`conversation/openConversation`), not through the raw state shape. The
 * read itself happens in the page; this is the half that decides what the
 * read MEANS, and it is where the two contracts that are easy to break by
 * accident live.
 */
test.describe('the streaming flag is read through the store getter', () => {
  test('a store without the open conversation is a broken contract, named', () => {
    // Not a slow answer: the wait must fail NOW, with the cause in the
    // message, instead of polling to a cause-less timeout.
    expect(() => streamingFlagOf({ state: 'no-open-conversation' })).toThrow(
      /conversation\/openConversation/
    );
    // Two causes, two messages: an app that is not booted and a booted
    // app whose store lost the getter are different findings.
    expect(() => streamingFlagOf({ state: 'no-store' })).toThrow(/not booted/);
  });

  test('no bot message yet is NOT "not streaming" — the wait continues', () => {
    // null is not false: a turn that has not produced an answer must keep
    // the wait alive. Treating it as false would end the wait on an
    // empty conversation.
    expect(streamingFlagOf({ state: 'ok', bots: [] })).toBe(null);
  });

  test('the LAST bot message decides the flag', () => {
    // The page sends the bot messages' flags in order; the last one is
    // the turn that is still open.
    expect(streamingFlagOf({ state: 'ok', bots: [true, false] })).toBe(false);
    expect(streamingFlagOf({ state: 'ok', bots: [true] })).toBe(true);
  });

  test('a conversation without bot messages is empty, not broken', () => {
    expect(streamingFlagOf({ state: 'ok' })).toBe(null);
  });
});
