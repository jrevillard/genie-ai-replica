'use strict';

const { createHash } = require('node:crypto');

/**
 * Compute the erasure tombstone key — the SHA-256 hex digest of iss_sub.
 *
 * Contract shared by the GDPR erasure path (keycloak-proxy-service.deleteUser,
 * which writes erased_key before nulling iss_sub) and the provisioning path
 * (user-provisioning-service._doProvision, which compares it to recognize and
 * refuse an erased subject). The digest is pseudonymous: it cannot be reversed
 * to the subject it was derived from and is retained solely to keep an erasure
 * permanent across provisioning cycles. Both sides MUST call this function —
 * never reimplement the digest inline.
 *
 * @param {string} issSub - User identifier (iss#sub format)
 * @returns {string} SHA-256 hex digest
 */
function erasureTombstoneKey(issSub) {
  return createHash('sha256').update(issSub).digest('hex');
}

module.exports = { erasureTombstoneKey };
