// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { readStreamingState, streamingFlagOf, botStreamingFlag } = require('./chatbot');

/**
 * Unit spec for the streaming-flag read — the helper's side of the store
 * contract (#1738).
 *
 * The helper reads the app's store through its PUBLIC getter
 * (`conversation/openConversation`), not through the raw state shape. The
 * read itself happens in the page; this is the half that decides what the
 * read MEANS, and it is where the cases that are easy to break by
 * accident live — each of them named in the helper's own doc block.
 */
test.describe('the streaming flag is read through the store getter', () => {
  test('a store without the getter is a broken contract, named', () => {
    // Not a slow answer: the wait must fail NOW, with the cause in the
    // message, instead of polling to a cause-less timeout.
    expect(() => streamingFlagOf({ state: 'no-getter' })).toThrow(/conversation\/openConversation/);
    // NOT booted is transient: the wait continues.
    expect(streamingFlagOf({ state: 'not-booted' })).toBe(null);
    // A BOOTED app without a store is broken, and says so.
    expect(() => streamingFlagOf({ state: 'no-store' })).toThrow(/no store/);
    // A getter that returns NOTHING is not a broken contract: no
    // conversation is open yet, so the turn has no answer — the wait
    // continues. Reporting it as a missing getter named a cause the
    // operator cannot act on.
    expect(streamingFlagOf({ state: 'no-open-conversation' })).toBe(null);
  });

  test('no bot message yet is NOT "not streaming" — the wait continues', () => {
    // null is not false: a turn that has not produced an answer must keep
    // the wait alive. Treating it as false would end the wait on an
    // empty conversation.
    expect(streamingFlagOf({ state: 'ok', messages: [] })).toBe(null);
    // A user message is not a bot message: the wait continues.
    expect(streamingFlagOf({ state: 'ok', messages: [{ sender: 'user', isStreaming: false }] })).toBe(null);
  });

  test('the WELCOME bubble is not the turn — the wait continues', () => {
    // The app appends a welcome bot message on mount, and it carries no
    // streaming flag at all. Reading it as "not streaming" would end the
    // wait BEFORE the turn's answer exists.
    expect(streamingFlagOf({ state: 'ok', messages: [{ sender: 'bot' }] })).toBe(null);
  });

  test('the LAST bot message decides the flag', () => {
    // The page sends each message's sender and flag; the LAST BOT one is
    // the turn that is still open.
    expect(
      streamingFlagOf({
        state: 'ok',
        messages: [
          { sender: 'bot', isStreaming: true },
          { sender: 'user', isStreaming: false },
          { sender: 'bot', isStreaming: false },
        ],
      })
    ).toBe(false);
    expect(streamingFlagOf({ state: 'ok', messages: [{ sender: 'bot', isStreaming: true }] })).toBe(true);
  });

  test('a conversation without bot messages is empty, not broken', () => {
    expect(streamingFlagOf({ state: 'ok' })).toBe(null);
  });
});

/**
 * The PAGE-SIDE read — the half that was never tested, and the half the
 * bug lived in.
 *
 * The decision above is pure and easy to test, but what the page HANDS
 * OVER is a separate contract: the welcome bubble carries no `isStreaming`
 * key at all (the app commits it without one), and the read must let that
 * absence reach the decision as an absence. Coercing it to `false` on the
 * page says "the turn finished" — the wait ends before the answer exists.
 *
 * The read runs in the browser, so it is exercised in one: a fake `#app`
 * carrying a fake store, and the helper's own read function, called in the
 * page. The functions here are the REAL ones — not a copy of them.
 */
test.describe('the page-side read keeps the flag\'s ABSENCE an absence', () => {
  // A page whose store answers the open conversation with the given
  // messages. The store shape is the app's: the getter
  // 'conversation/openConversation' and the messages under it.
  const pageWith = async (page, messages) => {
    await page.setContent('<div id="app"></div>');
    await page.evaluate((msgs) => {
      const app = document.querySelector('#app');
      app.__vue_app__ = {
        config: {
          globalProperties: {
            $store: {
              getters: { 'conversation/openConversation': { messages: msgs } },
            },
          },
        },
      };
    }, messages);
  };

  test('the WAIT reads the flag through this read — not the old store path', async ({ page }) => {
    // The wiring is what #1738 was about: the wait used to ask the store
    // for a path the frontend no longer exposes, and nothing could see
    // it, because the wait only runs against a live venue.
    //
    // The fake store carries BOTH shapes, and they answer DIFFERENTLY:
    // the getter the frontend exposes now (a welcome bubble with no
    // flag — "not the turn"), and the state path it used to expose (a
    // message that carries the flag — "the turn is over"). A reader that
    // asks the wrong one is therefore visible.
    await page.setContent('<div id="app"></div>');
    await page.evaluate(() => {
      const app = document.querySelector('#app');
      app.__vue_app__ = {
        config: {
          globalProperties: {
            $store: {
              getters: {
                'conversation/openConversation': { messages: [{ sender: 'bot', content: 'Welcome!' }] },
              },
              state: {
                conversation: { messages: [{ sender: 'bot', content: 'Welcome!', isStreaming: false }] },
              },
            },
          },
        },
      };
    });
    // The wait's own reader, driven in the browser: the welcome bubble
    // carries no flag, so the answer is "not the turn" (null) — the
    // wait must NOT end there.
    expect(await botStreamingFlag(page)).toBe(null);
  });

  test('a message with no flag crosses the wire with no flag', async ({ page }) => {
    // The WELCOME bubble: the app commits it with a sender and content,
    // and no isStreaming key.
    await pageWith(page, [{ sender: 'bot', content: 'Welcome! How can I assist you today?' }]);
    const read = await page.evaluate(readStreamingState);
    expect(read.state).toBe('ok');
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0].sender).toBe('bot');
    // The flag is ABSENT — not false. A false here would say the turn
    // finished, and the wait would end before the answer existed.
    expect(read.messages[0].isStreaming).toBe(undefined);
    // And the decision reads it as "not the turn".
    expect(streamingFlagOf(read)).toBe(null);
  });

  test('a message that HAS the flag crosses with its value', async ({ page }) => {
    await pageWith(page, [{ sender: 'bot', content: '', isStreaming: true }]);
    const read = await page.evaluate(readStreamingState);
    expect(read.messages[0].isStreaming).toBe(true);
    expect(streamingFlagOf(read)).toBe(true);
  });

  test('a finished turn crosses with false — which is NOT the absence', async ({ page }) => {
    await pageWith(page, [{ sender: 'bot', content: 'The answer.', isStreaming: false }]);
    const read = await page.evaluate(readStreamingState);
    expect(read.messages[0].isStreaming).toBe(false);
    // The wait ends: the turn is over.
    expect(streamingFlagOf(read)).toBe(false);
  });

  test('the welcome bubble before the turn does not end the wait', async ({ page }) => {
    // The exact shape the defect took: the welcome bubble is the last
    // bot message, and the turn's placeholder has not landed yet.
    await pageWith(page, [
      { sender: 'user', content: 'What is GENIE.AI?' },
      { sender: 'bot', content: 'Welcome! How can I assist you today?' },
    ]);
    const read = await page.evaluate(readStreamingState);
    expect(streamingFlagOf(read)).toBe(null);
  });

  test('an app that is not booted is transient, not broken', async ({ page }) => {
    await page.setContent('<div></div>');
    const read = await page.evaluate(readStreamingState);
    expect(read.state).toBe('not-booted');
    expect(streamingFlagOf(read)).toBe(null);
  });

  test('a booted app without the getter is a broken contract, named', async ({ page }) => {
    await page.setContent('<div id="app"></div>');
    await page.evaluate(() => {
      document.querySelector('#app').__vue_app__ = { config: { globalProperties: { $store: {} } } };
    });
    const read = await page.evaluate(readStreamingState);
    // The store has NO getters at all: the getter is MISSING, which is
    // the broken contract — not a conversation that is not open.
    expect(read.state).toBe('no-getter');
    expect(() => streamingFlagOf(read)).toThrow(/openConversation/);
  });

  test('a getter that returns nothing means no conversation is open yet', async ({ page }) => {
    await page.setContent('<div id="app"></div>');
    await page.evaluate(() => {
      document.querySelector('#app').__vue_app__ = {
        config: { globalProperties: { $store: { getters: { 'conversation/openConversation': undefined } } } }
      };
    });
    const read = await page.evaluate(readStreamingState);
    expect(read.state).toBe('no-open-conversation');
    // Not a broken contract: the wait continues.
    expect(streamingFlagOf(read)).toBe(null);
  });
});
