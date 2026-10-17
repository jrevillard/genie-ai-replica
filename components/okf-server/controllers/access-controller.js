// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — the OKF admin facility for per-repository access control,
// built for enterprise scale.
//
// Routes (repos-routes.js, admin-scoped per repo):
//   GET   /:repo_id/access             → { restricted, required_scopes,
//                                         user_holders, group_holders, configured }
//   PUT   /:repo_id/access             → { restricted: bool } — toggle the gate
//   POST  /:repo_id/access/grant       → { usernames: [..] | username, level }
//                                         — bulk PER-USER attribute grants
//   POST  /:repo_id/access/revoke      → { usernames: [..] | username }
//   POST  /:repo_id/access/grant-group → { group, level } — one operation,
//                                         any member count (role named as the
//                                         scope string, assigned to the group)
//   POST  /:repo_id/access/revoke-group → { group, level? }
//
// The toggle writes `acl.restricted` DIRECTLY on the repo doc (a serving
// maintenance write — repository-service.update() only accepts frontmatter
// patches while serving, and access restriction must work on LIVE repos).
// Enforcement (access-control-service) reads whatever scope entries the
// token carries — attribute grants and role/group grants are identical to
// it; grants take effect at the user's next login in both cases.

const Joi = require('joi');
const keycloakAccess = require('../services/keycloak-access-service');
const { parseOkfScope } = require('../services/scope-authz-service');
const { writeAudit } = require('../services/audit-service');
const { logger } = require('../shared-lib/logger');
const dbService = require('../shared-lib/db-connection-service');

const toggleSchema = Joi.object({ restricted: Joi.boolean().required() });
const grantSchema = Joi.alternatives()
  .try(
    Joi.object({
      usernames: Joi.array().items(Joi.string().min(1)).min(1).required(),
      level: Joi.string().valid('read', 'admin').default('read')
    }),
    Joi.object({
      username: Joi.string().min(1).required(),
      level: Joi.string().valid('read', 'admin').default('read')
    }),
    // Grant-by-search: EVERY user matching the query, server-side, all pages.
    // The scale path for "100s and 1000s of users" — the picker sends the
    // query, the server walks the directory. No username list on the wire.
    Joi.object({
      query: Joi.string().min(2).max(200).required(),
      level: Joi.string().valid('read', 'admin').default('read')
    })
  )
  .required();
const revokeSchema = Joi.alternatives()
  .try(
    Joi.object({ usernames: Joi.array().items(Joi.string().min(1)).min(1).required() }),
    Joi.object({ username: Joi.string().min(1).required() })
  )
  .required();
const groupGrantSchema = Joi.object({
  group: Joi.string().min(1).required(),
  level: Joi.string().valid('read', 'admin').default('read')
});
const groupRevokeSchema = Joi.object({
  group: Joi.string().min(1).required(),
  level: Joi.string().valid('read', 'admin')
});

class AccessError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function validate(schema, body) {
  const { value, error } = schema.validate(body || {});
  if (error) {
    throw new AccessError('VALIDATION_ERROR', error.details.map((d) => d.message).join('; '), 400);
  }
  return value;
}

/** Normalize {username} | {usernames[]} → string[] with a stable order. */
function usernameList(body) {
  return body.usernames || [body.username];
}

async function loadRepo(repoId) {
  const db = await dbService.getConnection();
  let doc;
  try {
    doc = await db.collection('okf_repositories').document(repoId);
  } catch (err) {
    if (err && (err.code === 404 || err.errorNum === 1202 || err.errorNum === 1204)) {
      throw new AccessError('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404);
    }
    throw err;
  }
  if (doc.deleted_at) {
    throw new AccessError('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404);
  }
  return doc;
}

async function audit(action, req, repoId, details) {
  try {
    await writeAudit({
      action,
      actor: (req.user && req.user.sub) || null,
      actor_name: (req.user && (req.user.preferred_username || req.user.name)) || null,
      repo_id: repoId,
      details
    });
  } catch (err) {
    logger.warn('OKF access: audit write failed', { action, error: err.message });
  }
}

function requireConfigured() {
  if (!keycloakAccess.isConfigured()) {
    throw new AccessError(
      'ACCESS_CONTROL_UNCONFIGURED',
      'Grant/revoke requires Keycloak credentials (KC_OKF_ACCESS_CLIENT_SECRET) on okf-server',
      503
    );
  }
}

/** GET /:repo_id/access — the panel's read model, computed SERVER-SIDE. */
async function getAccess(req, res, next) {
  try {
    const repo = await loadRepo(req.params.repo_id);
    const configured = keycloakAccess.isConfigured();
    const userHolders = [];
    const groupHolders = [];
    if (configured) {
      // Server-side attribute search per level — no realm listing, no cap.
      for (const level of ['read', 'admin']) {
        const scope = `okf:t:${repo.repo_id}:${level}`;
        const users = await keycloakAccess.usersWithAttribute(scope);
        users.forEach((u) => {
          const row = userHolders.find((h) => h.user_id === u.id);
          if (row) row.levels.push(level);
          else userHolders.push({ user_id: u.id, username: u.username, levels: [level], via: 'user' });
        });
      }
      // Group grants: the two roles named as this repo's scopes.
      for (const level of ['read', 'admin']) {
        const scope = `okf:t:${repo.repo_id}:${level}`;
        let members;
        try {
          members = await keycloakAccess.roleMembers(scope);
        } catch (err) {
          if (err.statusCode === 404) continue; // role never created — no group grants
          throw err;
        }
        members.groups.forEach((g) => {
          const row = groupHolders.find((h) => h.group_id === g.id);
          if (row) row.levels.push(level);
          else groupHolders.push({ group_id: g.id, name: g.name, levels: [level] });
        });
        members.users.forEach((u) => {
          // direct user-role assignments (not via attribute) count as user holders
          const row = userHolders.find((h) => h.user_id === u.id);
          if (row && !row.levels.includes(level)) row.levels.push(level);
          else if (!row) userHolders.push({ user_id: u.id, username: u.username, levels: [level], via: 'role' });
        });
      }
    }
    res.status(200).json({
      repo_id: repo.repo_id,
      restricted: Boolean(repo.acl && repo.acl.restricted),
      required_scopes: (repo.acl && repo.acl.required_scopes) || [],
      user_holders: userHolders,
      group_holders: groupHolders,
      configured
    });
  } catch (err) {
    next(err);
  }
}

/** GET /:repo_id/access/users?q= — the grant picker's USER SEARCH.
 * Server-side Keycloak search (username/email/name); each result is marked
 * with whether the user already holds this repo's query access, so the
 * picker can check them off. Admin-scoped: the panel lives in the editor,
 * which regular users never reach. */
async function getAccessUsers(req, res, next) {
  try {
    requireConfigured();
    const repo = await loadRepo(req.params.repo_id);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    // Current query-access holders: attribute grants + direct role grants.
    const readScope = `okf:t:${repo.repo_id}:read`;
    const holderIds = new Set();
    (await keycloakAccess.usersWithAttribute(readScope)).forEach((u) => holderIds.add(u.id));
    try {
      (await keycloakAccess.roleMembers(readScope)).users.forEach((u) => holderIds.add(u.id));
    } catch (err) {
      if (err.statusCode !== 404) throw err; // role never created — no role grants yet
    }
    const users = await keycloakAccess.searchUsers(q, 50);
    // Match count for the "select all N matching" action (grant-by-search).
    // Only for a non-empty query — an empty search is the whole realm, and
    // realm-wide grants go through groups, not through this panel.
    const total_matching = q ? await keycloakAccess.countUsers(q) : null;
    res.status(200).json({
      repo_id: repo.repo_id,
      q,
      total_matching,
      users: users.map((u) => ({ ...u, has_access: holderIds.has(u.id) }))
    });
  } catch (err) {
    next(err);
  }
}

/** GET /:repo_id/access/groups?q= — the group combobox's search. Server-side
 * Keycloak group search; each result marked with whether the group already
 * holds this repo's query access. */
async function getAccessGroups(req, res, next) {
  try {
    requireConfigured();
    const repo = await loadRepo(req.params.repo_id);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const groups = await keycloakAccess.searchGroups(q, 50);
    const holderNames = new Set();
    try {
      (await keycloakAccess.roleMembers(`okf:t:${repo.repo_id}:read`)).groups.forEach((g) => holderNames.add(g.name));
    } catch (err) {
      if (err.statusCode !== 404) throw err; // role never created — no group grants yet
    }
    res.status(200).json({
      repo_id: repo.repo_id,
      q,
      groups: groups.map((g) => ({ ...g, has_access: holderNames.has(g.name) }))
    });
  } catch (err) {
    next(err);
  }
}

/** PUT /:repo_id/access — toggle the restriction gate (works while serving). */
async function putAccess(req, res, next) {
  try {
    const { restricted } = validate(toggleSchema, req.body);
    const repo = await loadRepo(req.params.repo_id);
    const db = await dbService.getConnection();
    const acl = { ...(repo.acl || {}), restricted };
    await db.collection('okf_repositories').update(repo.repo_id, { acl, updated_at: new Date().toISOString() });
    await audit('repo.access.restrict', req, repo.repo_id, { restricted });
    res.status(200).json({ ok: true, repo_id: repo.repo_id, restricted });
  } catch (err) {
    next(err);
  }
}

/** POST /:repo_id/access/grant — bulk per-user attribute grants.
 * Three shapes: {usernames[]} (picker checkboxes), {username} (back-compat),
 * {query} (grant-by-search: every directory user matching the query — the
 * scale path; the server walks all result pages itself). */
async function grantAccess(req, res, next) {
  try {
    const body = validate(grantSchema, req.body);
    const { level } = body;
    requireConfigured();
    const repo = await loadRepo(req.params.repo_id);
    const scope = `okf:t:${repo.repo_id}:${level}`;

    if (body.query) {
      // Grant-by-search: users come FROM the directory (no missing entries
      // possible), granted with a small worker pool so 1000 users ≈ seconds,
      // not minutes. setUserScopes is idempotent for users already holding
      // the scope (the scope is appended to their EXISTING set).
      const users = await keycloakAccess.usersMatching(body.query);
      let granted = 0;
      const failures = [];
      const queue = [...users];
      async function worker() {
        for (;;) {
          const user = queue.shift();
          if (!user) return;
          try {
            const nextScopes = [...keycloakAccess.userScopes(user), scope];
            await keycloakAccess.setUserScopes(user, nextScopes);
            granted += 1;
          } catch {
            failures.push(user.username);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(5, users.length) }, worker));
      await audit('repo.access.grant', req, repo.repo_id, {
        query: body.query,
        matched: users.length,
        granted,
        failed: failures,
        level,
        scope
      });
      res.status(200).json({ ok: granted > 0, query: body.query, matched: users.length, granted, failed: failures });
      return;
    }

    const usernames = usernameList(body);
    const granted = [];
    const missing = [];
    for (const username of usernames) {
      const user = await keycloakAccess.findUserByUsername(username);
      if (!user) {
        missing.push(username);
        continue;
      }
      const nextScopes = [...keycloakAccess.userScopes(user), scope];
      await keycloakAccess.setUserScopes(user, nextScopes);
      granted.push(username);
    }
    await audit('repo.access.grant', req, repo.repo_id, { usernames: granted, missing, level, scope });
    res.status(missing.length && !granted.length ? 404 : 200).json({
      ok: granted.length > 0,
      granted,
      missing,
      level
    });
  } catch (err) {
    next(err);
  }
}

/** POST /:repo_id/access/revoke — strip this repo's attribute scopes from users. */
async function revokeAccess(req, res, next) {
  try {
    const usernames = usernameList(validate(revokeSchema, req.body));
    requireConfigured();
    const repo = await loadRepo(req.params.repo_id);
    const revoked = [];
    const missing = [];
    for (const username of usernames) {
      const user = await keycloakAccess.findUserByUsername(username);
      if (!user) {
        missing.push(username);
        continue;
      }
      const kept = keycloakAccess.userScopes(user).filter((s) => {
        const p = parseOkfScope(s);
        return !(p && p.repo === repo.repo_id);
      });
      await keycloakAccess.setUserScopes(user, kept);
      revoked.push(username);
    }
    await audit('repo.access.revoke', req, repo.repo_id, { usernames: revoked, missing });
    res.status(missing.length && !revoked.length ? 404 : 200).json({ ok: revoked.length > 0, revoked, missing });
  } catch (err) {
    next(err);
  }
}

/** POST /:repo_id/access/grant-group — one grant, any member count. */
async function grantGroupAccess(req, res, next) {
  try {
    const { group, level } = validate(groupGrantSchema, req.body);
    requireConfigured();
    const repo = await loadRepo(req.params.repo_id);
    const scope = `okf:t:${repo.repo_id}:${level}`;
    const role = await keycloakAccess.ensureRole(scope);
    const grp = await keycloakAccess.ensureGroup(group);
    await keycloakAccess.setGroupRole(grp, role, true);
    await audit('repo.access.grant_group', req, repo.repo_id, { group, level, scope });
    res.status(200).json({ ok: true, group, level, scope, note: 'effective at each member next login' });
  } catch (err) {
    next(err);
  }
}

/** POST /:repo_id/access/revoke-group — remove the role from the group. */
async function revokeGroupAccess(req, res, next) {
  try {
    const { group, level } = validate(groupRevokeSchema, req.body);
    requireConfigured();
    const repo = await loadRepo(req.params.repo_id);
    const levels = level ? [level] : ['read', 'admin'];
    const removed = [];
    for (const lv of levels) {
      const scope = `okf:t:${repo.repo_id}:${lv}`;
      let role;
      try {
        role = await keycloakAccess.ensureRole(scope);
      } catch (err) {
        if (err.statusCode === 404) continue;
        throw err;
      }
      const grp = await keycloakAccess.findGroupByName(group);
      if (!grp) continue;
      await keycloakAccess.setGroupRole(grp, role, false);
      removed.push(lv);
    }
    await audit('repo.access.revoke_group', req, repo.repo_id, { group, levels: removed });
    res.status(200).json({ ok: removed.length > 0, group, removed });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAccess,
  getAccessUsers,
  getAccessGroups,
  putAccess,
  grantAccess,
  revokeAccess,
  grantGroupAccess,
  revokeGroupAccess,
  AccessError
};
