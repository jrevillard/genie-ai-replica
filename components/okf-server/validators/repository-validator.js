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
});

const sourceSchema = Joi.object({
  type: Joi.string().valid('git', 's3').required(),
  endpoint: Joi.string().allow('').optional(),
  ref: Joi.string().allow('').optional(),
  credentialsRef: Joi.string().optional(),
  syncSchedule: Joi.string().optional()
}).allow(null);

const retentionSchema = Joi.object().unknown(true).allow(null);

// Story #978 (crawler→OKF): `.unknown(true)` lets `lifecycle_state` (and any
// other harmless key the 3.x UI sends) flow through to repoService.create()
// via opts. The service validates the enum (LIFECYCLE_STATES). Mirrors
// updateSchema below.
const createSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  domain: Joi.string().min(1).max(200).required(),
  source: sourceSchema.optional(),
  acl: aclSchema.required(),
  retention: retentionSchema.optional(),
  lifecycle_state: Joi.string().optional()
})
  .unknown(true)
  .required();

// .unknown(true) lets graph_name/repo_id/domain through so the service can 409.
// Story 1.7 (2026-10-08, supersedes the Story 1.6 dedicated collection):
// the per-repo frontmatter lives in `okf_repositories.frontmatter` (a new
// doc field, additive — no schema migration beyond a default). The
// curator-facing projection is the index.md YAML frontmatter block in the
// editor's center pane; the index.md YAML is the write target the
// existing concept-meta PATCH updates. The repo PATCH below accepts
// the same `frontmatter` field for symmetry so the wizard's Curate
// step (which edits the YAML) and the lifecycle `publish` hook (which
// reads the gate) share one shape.
const frontmatterSchema = Joi.object({
  topic: Joi.array().items(Joi.string().min(1).max(64)).min(0).max(8),
  entity: Joi.array().items(Joi.string().min(1).max(64)).max(20),
  scope: Joi.string().allow('').max(64),
  forbidden: Joi.array().items(Joi.string().min(1).max(64)).min(0).max(24),
  summary: Joi.string().allow('').max(1024),
  keyword: Joi.array().items(Joi.string().min(1).max(64)).max(20),
  // Per-row approved_at (Story 1.6 carry-over, Story 1.7 keeps it for
  // the partial-approval option). The publish gate checks every
  // approved_at is set.
  _approved: Joi.array()
    .items(
      Joi.object({
        field: Joi.string().valid('topic', 'entity', 'forbidden', 'summary', 'keyword').required(),
        value: Joi.string().required(),
        approved_at: Joi.string().isoDate().required(),
        approved_by: Joi.string().allow(null, '').optional()
      })
    )
    .optional(),
  updated_at: Joi.string().isoDate().optional(),
  updated_by: Joi.string().allow('').max(128).optional()
}).optional();

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  source: sourceSchema.optional(),
  acl: aclSchema.optional(),
  retention: retentionSchema.optional(),
  // Story 1.7: per-repo frontmatter on the repo doc (the canonical store
  // for the routing tags; the index.md YAML is the curator-facing
  // projection that writes through to this field).
  frontmatter: frontmatterSchema
})
  .unknown(true)
  .required();

// Story 4.8 (D-V5 clone): all fields OPTIONAL — an empty body is valid and the
// service derives the target identity (`<source> (clone)` + source domain/acl).
// Deliberately NO `source`/`retention` (D-V5: a clone never inherits the source's
// external origin or retention — upstream never auto-propagates). `.unknown(true)`
// mirrors updateSchema so an extra key the 3.9 UI sends is not silently dropped.
const cloneSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  domain: Joi.string().min(1).max(200).optional(),
  acl: aclSchema.optional()
})
  .unknown(true)
  .required();

// Story #978 lifecycle — ONE action per request; the service owns the
// transition map (409 INVALID_TRANSITION on a state/action mismatch).
// Story 1.6 (2026-10-07): an OPTIONAL `frontmatter` payload accompanies the
// `publish` action — when supplied, the frontmatter is taken as the curator's
// reviewed set (no auto-suggest). When absent, the lifecycle service runs the
// full LLM auto-suggest + validate + publish pipeline.
// Story 1.7 (2026-10-08): the frontmatter payload shape matches the
// okf_repositories.frontmatter field — same validator, same shape. The
// publish action either accepts the curator's pre-reviewed set OR runs
// the LLM auto-suggest + validate + write-to-repo-doc pipeline. Either
// way, the canonical store is okf_repositories.frontmatter.
const lifecycleSchema = Joi.object({
  action: Joi.string().valid('submit', 'approve', 'publish', 'ingest', 'retract', 'unpublish').required(),
  frontmatter: frontmatterSchema
});

// Steward PII acknowledgement (2026-08-30): { acknowledge: true|false }.
const piiAckSchema = Joi.object({
  acknowledge: Joi.boolean().required()
});

module.exports = { createSchema, updateSchema, cloneSchema, aclSchema, sourceSchema, lifecycleSchema, piiAckSchema };
