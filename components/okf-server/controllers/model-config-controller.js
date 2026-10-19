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

async function list(_req, res, next) {
  try {
    res.status(200).json({ configs: await svc.listConfigs() });
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
    res.status(200).json(await svc.updateConfig(req.params.key, req.body || {}, { actor: actorFrom(req), source_ip: req.ip }));
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

module.exports = { list, create, update, copy, activate, deactivate, remove, models };
