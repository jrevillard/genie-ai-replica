/**
 * OKF OPERATION FAILURE MESSAGES — the ONE copy of the two failure-message
 * composers the Studio surfaces share (#80930 / #80931).
 *
 * WHY THIS EXISTS: the bulk-PII catch shipped VERBATIM in both
 * steps/Input.vue and editor/RepoEditor.vue, and the create-failure branch in
 * both steps/Entry.vue and StudioTab.vue. Duplication is exactly how the
 * round-19 fix landed on one copy while its twin kept the bug (#80776) — so
 * each message now has a single, tested owner and every handler assigns the
 * returned string to its own error field.
 *
 * PLACEMENT: okfRepoOps.js would have been the natural home, but that file is
 * owned by another workstream in this round — this util imports its two
 * lifecycle helpers instead of re-implementing them. No user-facing string is
 * introduced here: every fallback below is the EXISTING catalogue default of
 * an existing key (okf.editor.piiBulk.failed, okf.create.*).
 */

import { friendlyLifecycleError, translateLifecycleError } from '../../../services/okfRepoOps';

/**
 * Message for a REJECTED bulkPiiAction (#80480 / #80773 / #80930):
 * httpService rejects on HTTP errors (409 drain freeze, 5xx, network) — the
 * gate code rides err.code or the response envelope (err.data.error), and a
 * recognized lifecycle code renders its catalogue sentence through
 * translateLifecycleError; anything else falls back to the generic
 * `okf.editor.piiBulk.failed` sentence.
 *
 * @param {Error|any} err the rejection from repoOkfService.bulkPiiAction
 * @param {Function} translate the component's translate(key, fallback)
 * @returns {string} user-facing message
 */
export function bulkPiiFailureMessage(err, translate) {
  const code = (err && (err.code || (err.data && err.data.error))) || '';
  return translateLifecycleError(
    friendlyLifecycleError(
      code,
      err && err.message,
      translate('okf.editor.piiBulk.failed', 'The bulk PII action failed — try again.')
    ),
    translate
  );
}

/**
 * Message for a FAILED `okf/createRepo` result (#80123 / #80931): a result
 * carrying `repo` means the repository EXISTS server-side but its starter
 * index failed to import — say THAT, not a blind "failed", or the steward
 * retries and mints a second repo while the first lingers as an orphan draft
 * card. DUPLICATE_REPO points at the existing repository; anything else
 * passes the server's own message or the generic sentence.
 *
 * @param {Object|null} result the store action's { ok, repo?, code?, message? }
 * @param {Function} translate the component's translate(key, fallback)
 * @returns {string} user-facing message
 */
export function describeCreateFailure(result, translate) {
  if (result && result.repo) {
    return translate(
      'okf.create.indexImportFailed',
      'The repository was created, but its starter index could not be imported. Open it from the dashboard to continue.'
    );
  }
  return result && result.code === 'DUPLICATE_REPO'
    ? translate(
        'okf.create.duplicate',
        'A repository with this name already exists - open it from the dashboard or pick another name.'
      )
    : (result && result.message) || translate('okf.create.failed', 'Repository creation failed');
}
