// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-7 — model-configuration HTTP surface. All tools-admin (platform
// level, same posture as repo creation). Thin: policy lives in the service.

const svc = require('../services/model-config-service');

function actorFrom(req) {
  return {
    user_id: req.user ? req.user.sub : 'system',
    name: req.user && (req.user.preferred_username || req.user.name)
  };
}

async function list(req, res, next) {
  try {
    // listConfigs returns the full envelope {configs, env_judge, env_pick}.
    // The LIST is readable by any OKF user (David 2026-10-25) — the RAGAS
    // judge picker needs the env judge, and gating the read made the whole
    // model selection disappear for anyone without tools-admin. The key
    // HINT stays admin-only: it is a fragment of a deployment-wide
    // credential and has no use outside the admin Models tab.
    const roles = (req.user && req.user.realm_access && req.user.realm_access.roles) || [];
    const isAdmin = Array.isArray(roles) && roles.includes('tools-admin');
    res.status(200).json(await svc.listConfigs({ includeKeyHint: isAdmin }));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    res.status(201).json(await svc.createConfig(req.body || {}, { actor: actorFrom(req), source_ip: req.ip }));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    res
      .status(200)
      .json(await svc.updateConfig(req.params.key, req.body || {}, { actor: actorFrom(req), source_ip: req.ip }));
  } catch (err) {
    next(err);
  }
}

async function copy(req, res, next) {
  try {
    res.status(201).json(await svc.copyConfig(req.params.key, { actor: actorFrom(req), source_ip: req.ip }));
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    res.status(200).json(await svc.activateConfig(req.params.key, { actor: actorFrom(req), source_ip: req.ip }));
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    res.status(200).json(await svc.deactivateConfig(req.params.key, { actor: actorFrom(req), source_ip: req.ip }));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    res.status(200).json(await svc.deleteConfig(req.params.key, { actor: actorFrom(req), source_ip: req.ip }));
  } catch (err) {
    next(err);
  }
}

async function models(req, res, next) {
  try {
    res.status(200).json(await svc.listModels(req.params.key));
  } catch (err) {
    next(err);
  }
}

/** Unsaved-credential dropdown listing (create form) — key used once, never stored. */
async function modelsPreview(req, res, next) {
  try {
    res.status(200).json(await svc.listModelsPreview(req.body || {}));
  } catch (err) {
    next(err);
  }
}

/**
 * Connection test. Probe failures are NOT errors — the diagnostic is the
 * 200 payload; only shape errors (400) propagate to the error middleware.
 */
async function test(req, res, next) {
  try {
    res.status(200).json(await svc.testConnection(req.body || {}));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, copy, activate, deactivate, remove, models, modelsPreview, test };
