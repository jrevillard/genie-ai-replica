// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// joi schemas for repository CRUD request bodies (project standard: validate at
// the route/controller boundary). POST required: name, domain, acl. PATCH: only
// updatable fields validated; immutable keys (graph_name/repo_id/domain) are
// allowed through (.unknown(true)) so the SERVICE can return FIELD_IMMUTABLE (409)
// rather than a generic 400.

const Joi = require('joi');

const aclSchema = Joi.object({
  required_scopes: Joi.array().items(Joi.string()).optional(),
  sensitivity: Joi.string().optional()
}).default({});

const sourceSchema = Joi.object({
  type: Joi.string().valid('git', 's3').required(),
  endpoint: Joi.string().allow('').optional(),
  ref: Joi.string().allow('').optional(),
  credentialsRef: Joi.string().optional(),
  syncSchedule: Joi.string().optional()
}).allow(null);

const retentionSchema = Joi.object().unknown(true).allow(null);

const createSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  domain: Joi.string().min(1).max(200).required(),
  source: sourceSchema.optional(),
  acl: aclSchema.required(),
  retention: retentionSchema.optional()
}).required();

// .unknown(true) lets graph_name/repo_id/domain through so the service can 409.
const updateSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  source: sourceSchema.optional(),
  acl: aclSchema.optional(),
  retention: retentionSchema.optional()
})
  .unknown(true)
  .required();

module.exports = { createSchema, updateSchema, aclSchema, sourceSchema };
