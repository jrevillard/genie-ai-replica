// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 2 — E-1, the Evaluation Context API.
//
// The WRITE surface (create / refresh) is SUPERADMIN-ONLY, and the operator
// decision says that means BOTH superadmin populations: the `tools-admin`
// realm role OR a wildcard `okf:*:*:admin` scope. A repo-scoped admin scope
// is NOT enough — a context can name any repository, so the authority to
// write one is deployment-wide.
//
// The READ surface (list / get) is open to the same population: the contexts
// are the operator-facing catalogue, and a curator CONSUMES a context by
// name, never by editing one.

const evalCtxService = require('../services/evaluation-context-service');
const { parseOkfScope, LEVEL_SATISFIES } = require('../services/scope-authz-service');
const { actorFrom } = require('./actor-from');

/**
 * The superadmin gate for the context write surface: the `tools-admin`
 * realm role OR a wildcard admin scope. A repo-scoped admin is NOT
 * superadmin here — a context may name ANY repository, so writing one is a
 * deployment-wide power.
 *
 * The PREDICATE is exported so the run leg asks the same question in the
 * same place: the cross-context experiment is a deployment-wide power too.
 */
function isSuperadminCaller(req) {
  if (req.okfIsSuperAdmin) return true;
  const wildcardAdmin = (Array.isArray(req.okfScopes) ? req.okfScopes : []).some((s) => {
    const p = parseOkfScope(s);
    return !!p && p.repo === '*' && LEVEL_SATISFIES.admin(p.level);
  });
  return wildcardAdmin;
}

function requireSuperadmin(req, res, next) {
  if (isSuperadminCaller(req)) return next();
  return res.status(403).json({
    error: 'FORBIDDEN_SCOPE',
    message:
      'an evaluation context may be created and refreshed only by a superadmin (the tools-admin role or a wildcard okf:*:*:admin scope)'
  });
}

/** The service-call opts: the actor shape (the principal who did it). */
const opts = (req) => ({ actor: actorFrom(req) });

async function createContext(req, res, next) {
  try {
    const doc = await evalCtxService.createContext(req.body || {}, opts(req));
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
}

async function listContexts(req, res, next) {
  try {
    res.status(200).json({ items: await evalCtxService.listContexts() });
  } catch (err) {
    next(err);
  }
}

async function getContext(req, res, next) {
  try {
    res.status(200).json(await evalCtxService.getContext(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function refreshContext(req, res, next) {
  try {
    res.status(200).json(await evalCtxService.refreshContext(req.params.id, opts(req)));
  } catch (err) {
    next(err);
  }
}

/**
 * #2061 phase 4 (E-5) — the composer's PREVIEW.
 *
 * The resolution a create WOULD freeze, without writing anything: a context
 * is immutable and has no delete route, so the operator must see the union
 * before it commits. The same `resolveContext` the create calls — the
 * preview and the created context cannot disagree.
 */
async function previewContext(req, res, next) {
  try {
    res.status(200).json(await evalCtxService.previewContext(req.body || {}));
  } catch (err) {
    next(err);
  }
}

/**
 * #2061 phase 4 (E-5) — the composer's SOURCE: the deployment's groups,
 * each with the grants it carries and the members it holds.
 *
 * Superadmin-gated for the same reason the write surface is: a group is a
 * deployment-wide principal, and its membership is not a per-repo fact.
 */
async function listGroups(req, res, next) {
  try {
    const q = req.query && typeof req.query.q === 'string' ? req.query.q : '';
    res.status(200).json({ items: await evalCtxService.listGroups(q) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requireSuperadmin,
  isSuperadminCaller,
  createContext,
  listContexts,
  getContext,
  refreshContext,
  previewContext,
  listGroups
};
