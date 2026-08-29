/**
 * Maps firebase-admin messaging error codes to an action.
 *
 *   prune  — the token is permanently dead; soft-deactivate it
 *   retry  — transient; the token goes back into the chunk's retry list
 *   fail   — permanent for this send, but the token itself may be fine
 *   abort  — the whole broadcast cannot proceed (credential problems)
 *
 * `messaging/invalid-argument` is deliberately NOT in the prune set here:
 * it means "bad token" OR "bad message payload". A bad payload stamps the
 * code onto every response in the chunk, and pruning on it would deactivate
 * hundreds of valid tokens. guardMassInvalidArgument() decides which case
 * applies per chunk.
 */

const PRUNE_CODES = new Set([
  'messaging/registration-token-not-registered', // UNREGISTERED — uninstalled / rotated
  'messaging/invalid-registration-token',        // malformed token
  'messaging/mismatched-credential',             // SENDER_ID_MISMATCH — token from another project
]);

const RETRY_CODES = new Set([
  'messaging/quota-exceeded',      // 429
  'messaging/server-unavailable',  // 503
  'messaging/internal-error',      // 500
  'messaging/unknown-error',
]);

const ABORT_CODES = new Set([
  'app/invalid-credential', // service account broken — nothing will send
]);

const INVALID_ARGUMENT = 'messaging/invalid-argument';

// Above this share of a chunk's failures, invalid-argument is treated as a
// payload bug: fail the job loudly, prune nothing.
const MASS_INVALID_ARGUMENT_RATIO = 0.5;

function classify(error) {
  const code = error?.code || '';
  if (ABORT_CODES.has(code)) return 'abort';
  if (PRUNE_CODES.has(code)) return 'prune';
  if (RETRY_CODES.has(code)) return 'retry';
  if (code === INVALID_ARGUMENT) return 'invalid-argument';
  if (code === 'messaging/third-party-auth-error') return 'fail'; // APNs config — never prune
  // Network / timeout / anything unrecognised: safest to retry.
  return 'retry';
}

/**
 * Returns true when invalid-argument failures look like a payload bug
 * rather than genuinely bad tokens.
 */
function isMassInvalidArgument(invalidArgumentCount, totalFailures) {
  if (invalidArgumentCount === 0 || totalFailures === 0) return false;
  return invalidArgumentCount / totalFailures > MASS_INVALID_ARGUMENT_RATIO;
}

module.exports = { classify, isMassInvalidArgument, INVALID_ARGUMENT };
