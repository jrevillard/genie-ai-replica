// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const welcome = require('./welcome');
const chatbot = require('./chatbot');

/**
 * Unit spec for the welcome session's close verdict.
 *
 * The close guarantee is #1888's whole point: the session is closed in
 * the helper's own control flow, whatever the body throws, and the
 * cleanup stays loud without stealing the verdict — a close that itself
 * fails joins the body's error message (which keeps its type, stack and
 * verdict flags), it never replaces the failure that caused the unwind.
 *
 * That contract is pinned here, OFFLINE: the browser, the context and
 * the page are fakes, and the login is swapped through the chatbot
 * module object (the codebase's substitution idiom — helpers/auth.js
 * reads its transport the same way), so every arm of the verdict runs
 * without a venue. The four paths are the ones the helper's doc block
 * names:
 *
 *   body ok    + close ok      the body's value is returned, the context
 *                                 is closed once
 *   body ok    + close fails    the teardown failure throws, and it is a
 *                                 TEARDOWN verdict — the body's value is
 *                                 lost with it, not a body failure
 *   body fails + close ok       the body's error is rethrown AS ITSELF
 *   body fails + close fails    the body's error is rethrown as itself
 *                                 and the close failure JOINS its
 *                                 message
 *
 * The open path's own verdict is pinned beside them: a throw after the
 * context exists closes the context before rethrowing, and a close that
 * fails there joins the OPEN error the same way.
 */

/**
 * A fake browser whose context counts its closes and can refuse to
 * close. The page answers every call the open path makes — the waits
 * resolve immediately, because what is under test is the CLOSE, not
 * the page.
 *
 * `lang` is what the fake page reports for <html lang>: the adoption
 * pin reads it, and it is the app's own signal of the locale it
 * adopted at boot.
 */
function fakeBrowser({ closeFails = false, lang = 'en' } = {}) {
  const log = { closes: 0, pages: 0, contexts: 0 };
  const page = {
    async evaluate(fn) {
      // The adoption pin reads <html lang>; the seeds write
      // localStorage and their result is not read.
      if (typeof fn === 'function' && /documentElement\.lang/.test(fn.toString())) return lang;
      return undefined;
    },
    async waitForSelector() {
      return null;
    },
    async reload() {
      return null;
    },
    async waitForFunction() {
      return undefined;
    }
  };
  const ctx = {
    async newPage() {
      log.pages += 1;
      return page;
    },
    async close() {
      log.closes += 1;
      if (closeFails) throw new Error('the context refused to close');
    }
  };
  return {
    log,
    browser: {
      async newContext() {
        log.contexts += 1;
        return ctx;
      }
    }
  };
}

// The login is swapped, not faked around: the helper reads it through
// the module object, and the real one is restored after every test
// (workers=1 means every later spec file sees this module).
const realLoginViaUI = chatbot.loginViaUI;

test.beforeEach(() => {
  chatbot.loginViaUI = async () => {};
});

test.afterEach(() => {
  chatbot.loginViaUI = realLoginViaUI;
});

test.describe('the welcome session closes itself', () => {
  test('a body that succeeds returns its value, and the context is closed once', async () => {
    const { browser, log } = fakeBrowser();

    const measured = await welcome.withWelcomeSession(browser, {}, async () => 'the measurement');

    expect(measured, "the body's own resolution is passed through").toBe('the measurement');
    expect(log.closes, 'the context is closed exactly once').toBe(1);
  });

  test('a close that fails after a successful body throws the TEARDOWN failure', async () => {
    const { browser } = fakeBrowser({ closeFails: true });

    // The body's value is lost with the teardown failure — loudly, and
    // the verdict names the teardown, not a body failure that never
    // happened.
    await expect(welcome.withWelcomeSession(browser, {}, async () => 'the measurement')).rejects.toThrow(
      /the context refused to close/
    );
  });

  test('a body that throws is rethrown AS ITSELF, and the context is still closed', async () => {
    const { browser, log } = fakeBrowser();
    const bodyError = new Error('the body failed');

    let caught = null;
    try {
      await welcome.withWelcomeSession(browser, {}, async () => {
        throw bodyError;
      });
    } catch (e) {
      caught = e;
    }

    expect(caught, 'the body failure is the verdict').toBe(bodyError);
    expect(caught.stack, "the stack is the body's own").toBe(bodyError.stack);
    expect(log.closes, 'a failed body does not skip the close').toBe(1);
  });

  test('a close that fails after a failed body JOINS the body error, which stays the verdict', async () => {
    const { browser, log } = fakeBrowser({ closeFails: true });
    const bodyError = new Error('the body failed');

    let caught = null;
    try {
      await welcome.withWelcomeSession(browser, {}, async () => {
        throw bodyError;
      });
    } catch (e) {
      caught = e;
    }

    expect(caught, 'the body failure is still the verdict').toBe(bodyError);
    expect(caught.message, 'the close failure joins the body failure').toContain('the body failed');
    expect(caught.message, 'the close failure is named').toContain('the context refused to close');
    expect(log.closes, 'the close was attempted').toBe(1);
  });
});

test.describe('a session that fails to open closes itself too', () => {
  test('a login that fails closes the context and rethrows the login error', async () => {
    const { browser, log } = fakeBrowser();
    const loginError = new Error('the login failed');
    chatbot.loginViaUI = async () => {
      throw loginError;
    };

    let caught = null;
    try {
      await welcome.withWelcomeSession(browser, {}, async () => 'never runs');
    } catch (e) {
      caught = e;
    }

    expect(caught, 'the login failure is the verdict').toBe(loginError);
    expect(log.closes, 'a failed open does not leak the context').toBe(1);
  });

  test('a close that fails during the unwind JOINS the open error', async () => {
    const { browser, log } = fakeBrowser({ closeFails: true });
    const loginError = new Error('the login failed');
    chatbot.loginViaUI = async () => {
      throw loginError;
    };

    let caught = null;
    try {
      await welcome.withWelcomeSession(browser, {}, async () => 'never runs');
    } catch (e) {
      caught = e;
    }

    expect(caught, 'the open failure is still the verdict').toBe(loginError);
    expect(caught.message, 'the close failure joins the open failure').toContain('the login failed');
    expect(caught.message, 'the close failure is named').toContain('the context refused to close');
    expect(log.closes, 'the close was attempted').toBe(1);
  });
});

test.describe('the seeded locale is proved, not assumed', () => {
  test('a seeded locale with no reload is refused BEFORE a context exists', async () => {
    const { browser, log } = fakeBrowser();

    // The seed lands after the login and only the next boot reads it,
    // so the pair is a contradiction: the session must refuse it rather
    // than open on the locale it booted with.
    await expect(
      welcome.withWelcomeSession(browser, { locale: 'fr', reload: false }, async () => 'never runs')
    ).rejects.toThrow(/needs the reload that adopts it/);
    expect(log.contexts, 'no context was opened for a refused session').toBe(0);
  });

  test('a locale the app adopted is accepted', async () => {
    const { browser } = fakeBrowser({ lang: 'fr' });

    const value = await welcome.withWelcomeSession(browser, { locale: 'fr' }, async () => 'the measurement');

    expect(value, 'the session ran on the adopted locale').toBe('the measurement');
  });

  test('a locale the app did NOT adopt fails the session', async () => {
    // The app fell back to English (its active-locale set drops 'fr'):
    // every measurement in this session would read the fallback and pass
    // vacuously, so the session says so instead of measuring nothing.
    const { browser } = fakeBrowser({ lang: 'en' });

    await expect(welcome.withWelcomeSession(browser, { locale: 'fr' }, async () => 'never runs')).rejects.toThrow(
      /<html lang> reads 'en', not the seeded 'fr'/
    );
  });
});

/**
 * The entrance gate's own condition, pinned OFFLINE.
 *
 * The gate owns the banner's VISIBILITY, not only its presence: a banner
 * that is mounted but hidden (or collapsed to a zero-size box) is not a
 * page anybody can measure — the box reads come back zeroed and the
 * pixel capture has no clip to take. The post-reload selector wait used
 * to enforce that, and when the reload path left the banner to this gate
 * alone, the guarantee would have gone with it — silently, because
 * nothing failed until a capture read an empty clip.
 */
test.describe("the banner gate owns the banner's visibility", () => {
  const banner = ({ width = 800, height = 120, animations = [] } = {}) => ({
    getBoundingClientRect: () => ({ width, height }),
    getAnimations: () => animations
  });
  const doc = (element, { visibility = 'visible' } = {}) => ({
    querySelector: () => element,
    defaultView: { getComputedStyle: () => ({ visibility }) }
  });

  test('a banner that is not mounted is not settled', () => {
    expect(welcome.bannerIsSettled(doc(null))).toBe(false);
  });

  test('a banner with no box is not settled', () => {
    expect(welcome.bannerIsSettled(doc(banner({ width: 0, height: 120 })))).toBe(false);
    expect(welcome.bannerIsSettled(doc(banner({ width: 800, height: 0 })))).toBe(false);
  });

  test('a hidden banner is not settled', () => {
    expect(welcome.bannerIsSettled(doc(banner(), { visibility: 'hidden' }))).toBe(false);
  });

  test('a banner whose entrance animation still runs is not settled', () => {
    expect(welcome.bannerIsSettled(doc(banner({ animations: [{ playState: 'running' }] })))).toBe(false);
  });

  test('a visible, settled banner is settled', () => {
    expect(welcome.bannerIsSettled(doc(banner({ animations: [{ playState: 'finished' }] })))).toBe(true);
  });
});
