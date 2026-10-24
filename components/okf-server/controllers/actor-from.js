// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Shared principal extractor — the identical actorFrom helper was duplicated
// in repository-controller and retrieval-config-controller (code-review
// finding 2026-09-20). One definition, both consumers.

/** Extract the acting principal + request IP for audit/metadata. */
function actorFrom(req) {
  const u = req.user || {};
  return { sub: u.sub, name: u.name || u.preferred_username, source_ip: req.ip };
}

module.exports = { actorFrom };
