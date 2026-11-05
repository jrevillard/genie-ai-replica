/**
 * Keycloak OIDC Authentication Service
 *
 * Wraps oidc-client-ts UserManager to provide OIDC authentication.
 * Tokens are kept in JavaScript memory; a token set rests on disk in two
 * places only: oidc-client-ts's own per-tab user store (sessionStorage by
 * default) and the cross-tab renewal handoff below (same-origin
 * localStorage, RENEW_USER_KEY) — the handoff publishes the renewed user
 * so a second tab can adopt it instead of spending a second grant on an
 * already-rotated refresh token. The handoff entry is wiped at logout and
 * by the TTL cleanup at each renew entry.
 */

import { UserManager, User } from 'oidc-client-ts';
import { jwtDecode } from 'jwt-decode';
import oidcConfig from '@/config/oidcConfig';

let userManager = null;
let currentUser = null;
const accessTokenCallbacks = new Set();
let unsubscribeUserLoaded = null;
let unsubscribeSilentRenewError = null;
/** The ONE in-flight silent renew, shared by every caller (see signinSilent). */
let renewInFlight = null;

// ── CROSS-TAB RENEW (round 20 #80800 → round 21 #80864/#80876) ───────────────
// The in-tab `renewInFlight` promise is one per JavaScript realm — one per
// TAB — so the two-tab race the root-cause comment names needs a CROSS-tab
// mechanism: with refresh_token_max_reuse=0 the second tab's concurrent
// renew reuses a rotated token, is rejected, and after 3 such failures the
// escalation path forces the very logout this fix exists to remove.
//
// Round 21 redesign — the round-20 lease had two holes:
//  (1) NOT ATOMIC (#80864): localStorage has no compare-and-swap, and the
//      write→read-back only proved WE were the last writer AT THE MOMENT WE
//      READ — two tabs whose timers fire together could BOTH hold the lease
//      and both rotate the refresh token. The PRIMARY mechanism is now the
//      Web Locks API (`navigator.locks.request('genie-renew')`), the only
//      genuinely atomic cross-tab claim; the localStorage lease survives as
//      a FALLBACK for engines without Web Locks, hardened with a settle
//      window (write, wait out RENEW_SETTLE_MS, re-read — a simultaneous
//      claimant has already overwritten us by then, so only the LAST writer
//      can still see its own tab id).
//  (2) THE DONE-MARKER CARRIED NO TOKEN (#80876): the waiter's
//      `manager.getUser()` reads THIS tab's per-tab oidc user store
//      (sessionStorage by default — no shared `userStore` is configured), so
//      a "done" flag made the waiter adopt its OWN STALE user: an access
//      token about to 401 and a refresh token Keycloak had already
//      invalidated — the forced logout, relocated to the waiter tab. The
//      holder now PUBLISHES the minted user itself (RENEW_USER_KEY) before
//      the done marker, and waiters adopt THAT (storeUser seeds their own
//      per-tab store with the fresh tokens).
// TTL-bounded either way: a holder that dies without releasing is taken
// over after RENEW_LEASE_TTL_MS (a Web Lock held by a dead tab releases
// automatically; the lease fallback uses the TTL takeover). Storage
// failures degrade to the in-tab serialisation alone.
const RENEW_LOCK_NAME = 'genie-renew';
// Exported for the Reset User Data flow: localStorage.clear() would drop
// them mid-renewal otherwise, reopening the double-rotation race this
// coordination exists to prevent.
export const RENEW_LEASE_KEY = 'genie.renew.lease';
export const RENEW_USER_KEY = 'genie.renew.user';
const RENEW_LEASE_TTL_MS = 20000;
const RENEW_WAIT_POLL_MS = 250;
const RENEW_SETTLE_MS = 80;
const RENEW_TAB_ID = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);

function leaseHeldByOther() {
  try {
    const raw = window.localStorage.getItem(RENEW_LEASE_KEY);
    if (!raw) return false;
    const lease = JSON.parse(raw);
    return !!(lease && lease.tab !== RENEW_TAB_ID && Date.now() - lease.at < RENEW_LEASE_TTL_MS);
  } catch {
    return false;
  }
}

async function acquireRenewLease() {
  if (leaseHeldByOther()) return false;
  try {
    window.localStorage.setItem(RENEW_LEASE_KEY, JSON.stringify({ tab: RENEW_TAB_ID, at: Date.now() }));
    // SETTLE WINDOW (round 21, #80864): localStorage has no compare-and-swap,
    // and the round-20 immediate read-back only proved we were the last
    // writer AT THE MOMENT WE READ — two tabs whose renew timers fire
    // together could BOTH see their own tab id and both rotate the refresh
    // token. Waiting out the settle window before re-reading means a
    // simultaneous claimant has already overwritten us by the time we look;
    // only the LAST writer can still see its own tab id. (Browsers with the
    // Web Locks API never take this path — the lock is the atomic claim.)
    await new Promise((resolve) => setTimeout(resolve, RENEW_SETTLE_MS));
    const raw = window.localStorage.getItem(RENEW_LEASE_KEY);
    const lease = raw ? JSON.parse(raw) : null;
    return !lease || lease.tab === RENEW_TAB_ID;
  } catch {
    return true; // storage unavailable → the in-tab promise is all we have
  }
}

/** Remove the storage entry at `key` only if THIS tab owns it — the guarded
 * wipe shared by the lease release and the publication withdrawal (round 25's
 * rule: kept-in-sync-by-discipline twins drift, so the idiom lives once).
 * Removing a missing key is a no-op. Returns the removed entry's raw JSON —
 * the withdrawal's caller restores it on grant failure — or null. */
function removeOwnTabEntry(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw && (JSON.parse(raw) || {}).tab === RENEW_TAB_ID) {
      window.localStorage.removeItem(key);
      return raw;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

function releaseRenewLease() {
  removeOwnTabEntry(RENEW_LEASE_KEY);
}

/** The holder publishes the minted user (#80876): a timestamp alone carries
 * no token, and the waiter's own per-tab oidc store still holds its
 * PRE-renew user. Same-origin localStorage is synchronous, so whoever
 * observes the entry can always read the user.
 * OWNERSHIP (#1521): the entry carries the publishing tab's id, so a waiter
 * can tell ANOTHER tab's publication (adoptable — the handoff) from its own
 * (never adoptable — a repeat renew in one tab must actually refresh, not
 * re-serve its own previous publication).
 * RETENTION (round 23, review of #80876): the entry carries the full minted
 * tokens, so it must not outlive the handoff — clearStaleRenewPublication()
 * bounds its disk lifetime to one renew window (RENEW_LEASE_TTL_MS) instead
 * of forever. The trade (#1521 review): a waiter starting more than one TTL
 * after the holder's publish finds the entry already wiped and grants on its
 * own (already-rotated) token — the handoff window is one TTL wide, which
 * renew timers sit well inside; before round 23 the entry lived forever. A
 * future-stamped entry (a clock stepped backward after the publish) is
 * bounded too: the single key is overwritten by any tab's next successful
 * renew, and logout wipes it. */
function publishRenewedUser(user) {
  if (!user) return;
  try {
    const at = Date.now();
    window.localStorage.setItem(RENEW_USER_KEY, JSON.stringify({ at, tab: RENEW_TAB_ID, user }));
  } catch {
    /* best-effort — waiters fall back to their own renew */
  }
}

/** One guarded wipe of the publication — round 25 (review): the same 4-line
 * try/removeItem was hand-rolled at three sites (logout + twice in
 * clearStaleRenewPublication); kept-in-sync-by-discipline twins drift. */
function clearRenewPublication() {
  try {
    window.localStorage.removeItem(RENEW_USER_KEY);
  } catch {
    /* best-effort */
  }
}

function clearStaleRenewPublication() {
  try {
    const raw = window.localStorage.getItem(RENEW_USER_KEY);
    if (!raw) return;
    const entry = JSON.parse(raw);
    // A valid-JSON entry without a usable `at` is corruption like a
    // non-parsing one — it can never be TTL-judged, so it would otherwise
    // keep its minted tokens at rest forever (#1521 review).
    if (!entry || typeof entry.at !== 'number' || Date.now() - entry.at > RENEW_LEASE_TTL_MS) {
      clearRenewPublication();
    }
  } catch {
    /* a corrupt entry is worse than a stale one — drop it */
    clearRenewPublication();
  }
}

/** The waiter's side of the handoff (#1521): ANOTHER tab's publication, with
 * a comfortably-future expires_at (the JSON round-trip drops the User class,
 * so check the raw field — oidc stores it in seconds).
 * The gate is ownership, not recency: a publication from THIS tab is never
 * adopted, because a publication read at a renew's entry always predates
 * that renew — re-serving it would skip the actual refresh. ANY OTHER
 * entry is the handoff itself and needs no recency bound beyond the TTL
 * cleanup: the waiter may legitimately start AFTER the holder finished,
 * and the holder withdraws its own entry before any new grant
 * (runRawGrantAndPublish), so an entry on disk is the holder's LATEST
 * settled publication. An owner-LESS entry can never be this tab's own —
 * this tab's publications always carry its tab id while the page lives (a
 * reload re-parents the tab's pre-reload publication as foreign; adopting
 * it re-serves the tokens the reloaded tab already holds — benign, and
 * bounded to one renew inside the TTL) — so it is an older build's handoff
 * (rolling-deploy mixed-version window) and is adopted exactly like a
 * tab-stamped one.
 * CONSUMES the offer (#1521 review): a successful read records the adopted
 * TOKEN in lastAdoptedToken, so this is a one-shot per token — a holder's
 * next renew publishes new tokens, which are adoptable again.
 * tryAdoptPublication is its only caller; a second reader would silently
 * burn the adoption. */
// The token this tab last adopted (#1521 review, loop 5): re-adopting the
// IDENTICAL tokens is never legitimate — it would serve them twice, and
// with a short-lived adopted token the re-armed expiring timer re-enters
// signinSilent within seconds, turning the handoff into a re-adoption loop
// for one TTL. Keyed on the TOKEN, not the timestamp: two publications can
// share a millisecond while carrying different tokens (a holder's next
// renew always publishes new tokens), and the restore path rewrites the
// same tokens — which must stay un-adoptable.
let lastAdoptedToken = null;

function readPublishedRenew() {
  try {
    const raw = window.localStorage.getItem(RENEW_USER_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.user || entry.tab === RENEW_TAB_ID) return null;
    if (!entry.user.access_token || entry.user.access_token === lastAdoptedToken) return null;
    const exp = entry.user.expires_at;
    if (typeof exp !== 'number' || exp * 1000 <= Date.now() + 5000) return null;
    lastAdoptedToken = entry.user.access_token; // these exact tokens are never adoptable again
    return entry.user;
  } catch {
    return null;
  }
}

/** Adopt the holder's published user: seed THIS tab's per-tab oidc store
 * (storeUser) so its next getUser returns the fresh tokens, then serve it.
 * ROUND 23 (review of the adoption): the publication is a JSON round-trip —
 * the User instance's methods are gone — and oidc-client-ts 3.5.0's
 * storeUser calls user.toStorageString() internally, which THROWS on a
 * plain object (the local catch swallowed it and the tab silently kept its
 * stale store). Rehydrate a real User and serve THAT (#1521 review): the
 * plain object has none of oidc's getters, so `expired` (and the
 * isAuthenticated()/escalation checks that read it) silently lie.
 * PARITY (#1521 review, loop 3): a granted renew reaches the app store and
 * the failure counter through oidc's addUserLoaded event; storeUser raises
 * no oidc event, so the adopt path calls the SAME onUserLoaded body
 * directly. TIMER RE-ARM: oidc's expiring/expired timers are ONE-SHOT and
 * re-armed only by the grant's internal _events.load — an adoption would
 * otherwise leave the tab without proactive silent renewal forever (its
 * timer already fired to get here). manager.events.load(user, false) arms
 * them from the USER IN HAND — no store round-trip, so a swallowed
 * storeUser failure cannot leave the timers armed from a stale or expired
 * store user (raiseEvent false — no userLoaded double-fire). */
async function adoptPublishedUser(manager, user) {
  const rehydrated = new User(user);
  try {
    await manager.storeUser(rehydrated);
  } catch {
    /* keep the rehydrated user even if the store write fails */
  }
  // ORDER (parity with the granted path — #1521 review): oidc arms the
  // timers in load() BEFORE raising userLoaded, so a throwing app callback
  // there cannot skip the re-arm. Same order here: events.load first,
  // then the module's user-loaded body.
  try {
    await manager.events.load(rehydrated, false); // re-arm oidc's one-shot renew timers
  } catch {
    /* the re-arm is best-effort — the adopted user is still served below */
  }
  onUserLoaded(rehydrated);
  return rehydrated;
}

/** The RAW grant (#80941) — manager.signinSilent is the WRAPPED module
 * function; calling it here would recurse into this very lease. Shared by
 * every renewal tail (round 23: the grant+publish tail was pasted three
 * times; one paste is how the next poll-semantics change lands everywhere).
 * CLEAR-BEFORE-GRANT (#1521 review): the grant rotates THIS tab's refresh
 * token away from the one its previous publication carries
 * (refresh_token_max_reuse=0) — drop that publication FIRST, so a waiter
 * starting mid-grant finds no handoff, waits under the lock/lease, and
 * adopts the FRESH publication instead of a token being rotated away. Only
 * this tab's own entry — a foreign tab's may be another waiter's only
 * valid handoff. RESTORE-ON-FAILURE (#1521 review, loop 4): a failed grant
 * may or may not have consumed the withdrawn token — the client cannot
 * tell. Restoring gives the other tabs the best available handoff: in the
 * common case (network blip before the request) the token is still valid,
 * and in the lost-response case the restored entry is dead but the waiters
 * re-grant after the TTL — the same trade as not restoring. Restored with
 * its ORIGINAL stamp (the entry is not younger than it was), and only
 * while the slot is still empty: a newer publication (this tab's own fresh
 * one, or another tab's) outranks the saved entry. */
async function runRawGrantAndPublish(manager) {
  // One read+parse serves both the save and the withdrawal: removeOwnTabEntry
  // returns the entry it removed (own tab only — never a foreign handoff).
  const saved = removeOwnTabEntry(RENEW_USER_KEY);
  const restoreSavedPublication = () => {
    // Restored only while the slot is still empty: a newer publication
    // (this tab's own fresh one, or another tab's) outranks the saved entry.
    try {
      if (saved && !window.localStorage.getItem(RENEW_USER_KEY)) {
        window.localStorage.setItem(RENEW_USER_KEY, saved);
      }
    } catch {
      /* best-effort */
    }
  };
  try {
    const user = await (manager.__rawSigninSilent || manager.signinSilent.bind(manager))();
    // A grant that resolves WITHOUT a user publishes nothing and consumed
    // nothing observable — the withdrawn publication goes back (#1521 review).
    if (!user) restoreSavedPublication();
    else {
      currentUser = user;
      publishRenewedUser(user);
    }
    return user;
  } catch (error) {
    restoreSavedPublication();
    throw error;
  }
}

/** One non-queueing Web-Lock probe: run `fn` under the lock if free, else
 * null (ifAvailable:true never queues; a dead holder's lock releases
 * automatically). */
async function tryTakeLock(fn) {
  return navigator.locks.request(RENEW_LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? fn() : null));
}

/** One gate-and-adopt step, shared by both renewal paths (#1521 review):
 * the idiom lives once — the next arm added to readPublishedRenew must not
 * have to be paired with an adopt call at four sites. Null when the gate
 * admits nothing. */
async function tryAdoptPublication(manager) {
  const adopted = readPublishedRenew();
  return adopted ? adoptPublishedUser(manager, adopted) : null;
}

/** Adopt-or-grant, in ONE place (#1521 review): a holder can publish and
 * release between a waiter's consult and its lock/lease claim, so the
 * publication is re-read once the claim is held — a grant then would burn
 * a grant on the token that holder just rotated away. Both renewal paths
 * use this helper, so the policy cannot drift between them. */
async function adoptOrGrant(manager) {
  return (await tryAdoptPublication(manager)) ?? runRawGrantAndPublish(manager);
}

/** PRIMARY cross-tab mechanism (#80864): the Web Locks API — the only
 * genuinely atomic cross-tab claim. ORDERING (round 23, review of the
 * free-lock arm): a waiter can arrive AFTER the holder finished — the lock
 * is free again, and its first `ifAvailable` probe would run a fresh grant
 * with THIS tab's now-rotated-away refresh token while a perfectly good
 * publication sits unread. So the publication is consulted BEFORE the first
 * lock attempt (tryAdoptPublication above; the ownership gate keeps THIS
 * tab's own publication inadmissible, and admits another tab's — #1521);
 * only a miss falls through to taking the lock. Past the TTL with no
 * publication the holder is wedged — bounded degradation: renew without
 * the lock, the same trade the stale-lease takeover always made (a renew
 * wedged >20s went nowhere). */
async function renewViaWebLock(manager, startedAt) {
  // Under the lock the publication is read once more before any grant
  // (adoptOrGrant) — the holder can publish and release between this tab's
  // consult and its lock probe.
  const renewOnce = () => adoptOrGrant(manager);
  const adoptedFirst = await tryAdoptPublication(manager);
  if (adoptedFirst) return adoptedFirst;
  const held = await tryTakeLock(renewOnce);
  if (held) return held;
  while (Date.now() - startedAt < RENEW_LEASE_TTL_MS) {
    await new Promise((resolve) => setTimeout(resolve, RENEW_WAIT_POLL_MS));
    const adopted = await tryAdoptPublication(manager);
    if (adopted) return adopted;
    const got = await tryTakeLock(renewOnce);
    if (got) return got;
  }
  return renewOnce();
}

/** FALLBACK for engines without Web Locks: the settle-window localStorage
 * lease (see acquireRenewLease) + the same publication handoff. */
async function renewViaLease(manager, startedAt) {
  // ROUND 25 (review, twin-miss): the 81377 ordering fix landed on the
  // Web-Locks path only. The same scenario kills here: the holder finished
  // and released → the lease is FREE → acquiring first succeeds immediately
  // and skips the publication-consulting loop entirely → a fresh grant runs
  // on this tab's rotated-away refresh token. Read the publication BEFORE
  // the first lease claim, exactly like renewViaWebLock.
  const adoptedFirst = await tryAdoptPublication(manager);
  if (adoptedFirst) return adoptedFirst;
  let held = await acquireRenewLease();
  while (!held) {
    if (Date.now() - startedAt > RENEW_LEASE_TTL_MS + RENEW_WAIT_POLL_MS) {
      // The holder's lease is stale/dead — its renew went nowhere. Run our
      // own (acquireRenewLease takes over an expired lease).
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, RENEW_WAIT_POLL_MS));
    // After each wake: FIRST look for the holder's publication (the minted
    // tokens, not just a timestamp — #80876), and only then try to take the
    // lease — checking the lease first would grab it the moment the holder
    // releases, without ever reading what it published.
    const adopted = await tryAdoptPublication(manager);
    if (adopted) return adopted;
    held = await acquireRenewLease();
  }
  // The lease is held now: re-read the publication before granting
  // (adoptOrGrant) — the holder can publish and release between this tab's
  // consult and its claim.
  return adoptOrGrant(manager);
}

/** Round 21c (#80941): oidcConfig sets automaticSilentRenew: true, so
 * oidc-client-ts's OWN SilentRenewService runs the access-token-expiry timer
 * and calls userManager.signinSilent() DIRECTLY — a path that bypassed both
 * the renewInFlight promise and the cross-tab lease, i.e. the timer-driven
 * renew (the one that produced the measured 280-POST/two-tab incident) was
 * never serialised. Wrapping the INSTANCE method routes that internal call
 * through the module's signinSilent, so every renewal — timer, 401 retry,
 * error-handler retry — contends for the same lease and adopts the same
 * publication. The RAW grant is kept on the instance (__rawSigninSilent) for
 * the wrapper's own renew paths; per-instance so a re-initialize wraps too. */
function wrapManagerSignin(manager) {
  // No early-return guard: both callers pass a freshly constructed
  // UserManager, so the guard was unreachable — and its failure mode if a
  // double-wrap ever DID happen is a deadlock (round 23: __rawSigninSilent
  // would capture the already-wrapped arrow, renewOnce would re-enter the
  // module signinSilent and await its own renewInFlight). The flag stays as
  // a wrap marker for the tests.
  manager.__rawSigninSilent = manager.signinSilent.bind(manager);
  manager.signinSilent = (...args) => signinSilent(...args);
  manager.__signinWrapped = true;
  return manager;
}

/** ROUND 25 (review): the guarded release of both subscription handles was a
 * verbatim 8-line copy shared by initialize()'s re-init path and logout() —
 * the same commit's reserve()/assertFree() fix (82698) documents why
 * kept-in-sync-by-discipline twins drift. One helper, one call per site. */
function releaseManagerEvents() {
  if (unsubscribeUserLoaded) {
    unsubscribeUserLoaded();
    unsubscribeUserLoaded = null;
  }
  if (unsubscribeSilentRenewError) {
    unsubscribeSilentRenewError();
    unsubscribeSilentRenewError = null;
  }
}

// Bounded-renew state (round 17, #80353): module-level so the adopted path
// shares the counter with the granted one (was a per-initialize closure).
let consecutiveRenewFailures = 0;

/** What a successful renewal means, wherever it comes from (#1521 review):
 * the granted path reaches this through oidc's addUserLoaded event; the
 * adopted path calls it directly — one body, not kept-in-sync twins. Sets
 * the module user, resets the bounded-renew failure counter (round 18,
 * #80469: the invariant is "reset on ANY success") and commits the renewal
 * to the app store's registered callbacks. */
function onUserLoaded(user) {
  currentUser = user;
  consecutiveRenewFailures = 0;
  // Per-subscriber isolation (#1521 review): a subscriber that throws must
  // not abort the renewal (the renewer's failure counter would count a
  // successful renewal as a failure and escalate to a forced logout) and
  // must not silence the subscribers after it.
  accessTokenCallbacks.forEach((cb) => {
    try {
      cb(user);
    } catch (error) {
      console.warn('[KeycloakAuth] Access token callback failed:', error?.message);
    }
  });
}

/**
 * Initialize the OIDC service — creates UserManager, checks for existing session,
 * and registers silent renew event listeners.
 * @returns {Promise<Object|null>} Existing user or null
 */
async function initialize() {
  // ROUND 23 (review): a re-initialize used to orphan the previous manager's
  // event subscriptions — the module-level unsubscribe handles were
  // overwritten without being called, so every re-init leaked a full set of
  // addUserLoaded/addSilentRenewError listeners on a manager nothing else
  // references. Release them before replacing the manager.
  releaseManagerEvents();
  userManager = wrapManagerSignin(new UserManager(oidcConfig));

  // Bounded-renew state (round 17, #80353): a fresh manager starts from a
  // clean failure count.
  consecutiveRenewFailures = 0;
  const MAX_RENEW_FAILURES = 3;

  // Register silent renew event listeners
  unsubscribeUserLoaded = userManager.events.addUserLoaded(onUserLoaded);

  // A FAILED RENEW IS NOT A DEAD SESSION (David's 2026-10-11 logout). This used
  // to call login() unconditionally, so ONE rejected refresh in a burst threw
  // the user to the login page and discarded a perfectly good session — which
  // is exactly what happened mid-import while two tabs were racing. Retry
  // through the shared renew; only a run of consecutive failures justifies a
  // redirect.
  // BOUNDED RETRIES (round 17, #80353): the comment used to say "Retry once"
  // but nothing enforced it — a persistently failing grant re-raised
  // silentRenewError, re-entered this handler, failed again… one renew every
  // few seconds forever with no backoff. The counter below caps consecutive
  // failures (reset on any success) and escalates through the same
  // stored-user/login check as the 401 path.
  unsubscribeSilentRenewError = userManager.events.addSilentRenewError(async () => {
    try {
      const user = await signinSilent();
      if (user && !user.expired) {
        // Recovered — the grant works again. (onUserLoaded also resets the
        // counter on every success path; this line keeps the reset visible
        // on the path that observes the recovery directly.)
        consecutiveRenewFailures = 0;
        return;
      }
    } catch (retryError) {
      console.warn('[KeycloakAuth] Silent renew retry failed:', retryError?.message);
    }
    consecutiveRenewFailures += 1;
    if (consecutiveRenewFailures < MAX_RENEW_FAILURES) return; // back off — let the next timer tick try
    // Still failing after the cap: check whether the session is actually
    // unusable before discarding it. A live, unexpired user is not a reason
    // to log out — but stop re-arming the loop either way.
    consecutiveRenewFailures = 0;
    try {
      const user = await getUser();
      if (user && !user.expired) return;
    } catch (escalationError) {
      console.error('[KeycloakAuth] Session check after renew failures failed:', escalationError?.message);
    }
    login();
  });

  try {
    currentUser = await userManager.getUser();
    return currentUser;
  } catch (error) {
    console.error('[KeycloakAuth] Error during initialization:', error.message);
    currentUser = null;
    return null;
  }
}

/**
 * Get the UserManager instance (creates one if not initialized)
 * @returns {UserManager}
 */
function getUserManager() {
  if (!userManager) {
    userManager = wrapManagerSignin(new UserManager(oidcConfig));
  }
  return userManager;
}

/**
 * Redirect to Keycloak login page
 * @param {Object} [options] - Optional signin options
 * @param {string} [options.returnUrl] - URL to return to after login
 */
async function login(options = {}) {
  const manager = getUserManager();
  const state = options.returnUrl ? { returnUrl: options.returnUrl } : undefined;
  await manager.signinRedirect({ state });
}

/**
 * Process the OIDC callback (authorization code exchange)
 * @returns {Promise<Object>} User object
 */
async function handleCallback() {
  const manager = getUserManager();
  try {
    currentUser = await manager.signinRedirectCallback();
    return currentUser;
  } catch (error) {
    console.error('[KeycloakAuth] Error during callback processing:', error.message);
    currentUser = null;
    throw error;
  }
}

/**
 * Redirect to Keycloak logout
 */
async function logout() {
  // The publication carries full minted tokens — a logout must not leave
  // one on disk (round 23 retention fix; the TTL cleanup misses a fresh
  // publication, which a logout is exactly the wrong place to keep).
  clearRenewPublication();
  // The adoption memo holds an access-token string — a logout ends the
  // session, so the memo goes with it.
  lastAdoptedToken = null;
  releaseManagerEvents();

  const manager = getUserManager();
  // Capture id_token before removeUser() clears stored user —
  // signoutRedirect needs it as id_token_hint so Keycloak properly ends the session.
  const user = await manager.getUser().catch(() => null);
  const idToken = user?.id_token;
  try {
    await manager.removeUser();
  } catch (error) {
    console.error('[KeycloakAuth] Error removing user:', error.message);
  }
  try {
    await manager.clearStaleState();
  } catch (error) {
    console.error('[KeycloakAuth] Error clearing stale state:', error.message);
  }
  try {
    await manager.signoutRedirect({ id_token_hint: idToken });
  } catch (error) {
    console.error('[KeycloakAuth] Error during logout redirect:', error.message);
  } finally {
    currentUser = null;
  }
}

/**
 * Get the current OIDC user profile
 * @returns {Promise<Object|null>} User profile or null
 */
async function getUser() {
  const manager = getUserManager();
  currentUser = await manager.getUser();
  return currentUser;
}

/**
 * Get the access token from the current user
 * @returns {string|null} Access token string
 */
function getAccessToken() {
  return currentUser?.access_token || null;
}

/**
 * Check if the user is currently authenticated
 * @returns {boolean} True if authenticated
 */
function isAuthenticated() {
  return currentUser != null && !currentUser.expired;
}

/**
 * Manually trigger a silent token refresh via iframe
 * @returns {Promise<Object|null>} Refreshed user or null if refresh failed
 */
async function signinSilent() {
  // SERIALISED (David's 2026-10-11 logout, root-caused from the Keycloak log):
  // two browser tabs each renew on their own timer, and the realm runs
  // refresh_token_max_reuse=0 + revoke_refresh_token=false — so every silent
  // renew ROTATES the refresh token and a rotated/reused one is rejected. Two
  // concurrent renews therefore race and kill the session they share. Measured
  // live: 280 token POSTs in 59 seconds from two tabs, 5 rejected with
  // "Session not active", then a forced logout. One shared in-flight promise
  // means concurrent callers wait for ONE refresh instead of racing — WITHIN
  // this tab; across tabs the localStorage lease above serialises it further
  // (round 20, #80800: the module-scoped promise alone left the two-tab
  // race — the measured one — unserialised).
  if (renewInFlight) return renewInFlight;
  // Bound the publication's disk lifetime (round 23 retention): no tokens
  // stay at rest past the TTL. The trade (#1521 review): a waiter arriving
  // more than one TTL after the holder's publish finds the entry already
  // wiped and grants on its own (possibly rotated) token — the ownership
  // gate admits a foreign publication regardless of age, so "stale" is no
  // longer "inadmissible to every reader". Tracked in #1535.
  clearStaleRenewPublication();
  renewInFlight = (async () => {
    const manager = getUserManager();
    // EVERY exit path — adopt, own-renew, rejection — must clear renewInFlight
    // and release the lease: an adopt-path return that skips the finally
    // would pin renewInFlight to a resolved promise forever, making every
    // later renew in this tab return the stale one (caught by the lease
    // tests).
    try {
      const startedAt = Date.now();
      // Web Locks where the engine has them (atomic, #80864); settle-window
      // localStorage lease otherwise. Both publish the minted user (#80876).
      if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        return await renewViaWebLock(manager, startedAt);
      }
      return await renewViaLease(manager, startedAt);
    } catch (error) {
      console.error('[KeycloakAuth] Error during silent renew:', error.message);
      throw error;
    } finally {
      releaseRenewLease();
      renewInFlight = null;
    }
  })();
  return renewInFlight;
}

/**
 * Register a callback to be invoked when the access token is silently refreshed
 * @param {Function} callback - Function called with the updated User object
 */
function onAccessTokenUpdated(callback) {
  accessTokenCallbacks.add(callback);
}

/**
 * Remove a previously registered access token update callback
 * @param {Function} callback - The callback to remove
 */
function removeAccessTokenUpdatedCallback(callback) {
  accessTokenCallbacks.delete(callback);
}

/**
 * Decode claims from the current access token.
 * Uses jwt-decode (same library used internally by oidc-client-ts).
 * @returns {Object|null} Decoded JWT claims or null
 */
function getAccessTokenClaims() {
  const token = currentUser?.access_token;
  if (!token) return null;
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
}

/**
 * Get the internal UserManager (for advanced usage)
 * @returns {UserManager}
 */
function getInternalUserManager() {
  return getUserManager();
}

export default {
  initialize,
  login,
  handleCallback,
  logout,
  getUser,
  getAccessToken,
  getAccessTokenClaims,
  isAuthenticated,
  signinSilent,
  onAccessTokenUpdated,
  removeAccessTokenUpdatedCallback,
  getUserManager: getInternalUserManager
};
