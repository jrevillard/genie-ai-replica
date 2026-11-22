// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Shared principal extractor — the identical actorFrom helper was duplicated
// in repository-controller and retrieval-config-controller (code-review
// finding 2026-09-20). One definition, both consumers.

/**
 * Extract the acting principal + request IP for audit/metadata.
 *
 * `user_id` is the principal id the record writers read — the same `sub`
 * the audit trail records (audit-service.js writes `req.user.sub` as the
 * actor). It is emitted ALONGSIDE `sub` (additive; `sub` is unchanged)
 * because 25 sites across 5 services read `actor.user_id` to stamp
 * `created_by` / `updated_by` / `approved_by`. Before this field existed,
 * every one of them read `undefined` and fell back to 'system' /
 * 'auto-publish' — so every run record in production was attributed to the
 * literal string "system" no matter which human started it (#2061).
 */
function actorFrom(req) {
  const u = req.user || {};
  return {
    sub: u.sub,
    user_id: u.sub,
    name: u.name || u.preferred_username,
    source_ip: req.ip
  };
}

module.exports = { actorFrom };
