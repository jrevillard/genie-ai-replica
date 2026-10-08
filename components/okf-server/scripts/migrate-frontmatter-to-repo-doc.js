#!/usr/bin/env node
/*
 * Story 1.7 (2026-10-08) — one-shot migration: lift every row in
 * okf_repo_frontmatter + okf_repositories_frontmatter_summary into
 * the new okf_repositories.frontmatter doc field, then drop the two
 * old collections.
 *
 * David 2026-10-08 (architectural correction to Story 1.6): the
 * per-repo tag set should live in the repo doc field (canonical
 * store) and the index.md YAML frontmatter block (curator-facing
 * projection), not in a dedicated ArangoDB collection. The old
 * okf_repo_frontmatter + okf_repositories_frontmatter_summary
 * collections were deployed only on the local build (one repo, ~28
 * tag rows produced by the republish-with-tags script) before Story
 * 1.7 was decided, so the migration is bounded.
 *
 * USAGE:
 *   node components/okf-server/scripts/migrate-frontmatter-to-repo-doc.js
 *   node ... --dry-run     # compute the new state, print, no writes
 *   node ... --force       # drop the two old collections after migration
 *
 * The script is idempotent: re-running on an already-migrated DB is
 * a no-op (the per-tag rows are filtered by `version` to avoid
 * re-importing the same data).
 */
'use strict';

const { dbService, close } = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');

const FRONTMATTER_COLLECTION = 'okf_repo_frontmatter';
const FRONTMATTER_SUMMARY_COLLECTION = 'okf_repositories_frontmatter_summary';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const force = args.has('--force');
  const db = await dbService.getConnection('default');

  // 1. Read every row in okf_repo_frontmatter, group by repo_id.
  const allRows = (await db.query(`FOR d IN ${FRONTMATTER_COLLECTION} RETURN d`)).all();
  const byRepo = new Map();
  for (const r of allRows) {
    if (!byRepo.has(r.repo_id)) byRepo.set(r.repo_id, []);
    byRepo.get(r.repo_id).push(r);
  }
  logger.info('migration.scan', {
    row_count: allRows.length,
    repo_count: byRepo.size
  });

  if (byRepo.size === 0) {
    logger.info('migration.noop', { reason: 'no rows in okf_repo_frontmatter' });
  }

  // 2. For each repo, read the existing okf_repositories.frontmatter
  //    (may already be set if the curator saved via the new code path
  //    during the migration window) and merge — the old rows go in
  //    only for fields the new doc field doesn't already have.
  let updatedRepos = 0;
  let skippedRepos = 0;
  for (const [repoId, rows] of byRepo) {
    const repoRow = (
      await db.query(
        'FOR r IN okf_repositories FILTER r._key == @rid RETURN r.frontmatter',
        { rid: repoId }
      )
    ).all();
    const existing = (repoRow && repoRow[0] && repoRow[0][0]) || null;
    if (existing && existing.updated_at) {
      // The repo already has frontmatter in the new field — skip
      // (idempotent: re-running the migration is a no-op once the
      // new field is set).
      logger.info('migration.skip', { repo_id: repoId, reason: 'already set' });
      skippedRepos += 1;
      continue;
    }
    const merged = mergeRowsIntoFrontmatter(repoId, rows, existing);
    if (dryRun) {
      logger.info('migration.dry_run.preview', {
        repo_id: repoId,
        topic: merged.topic.length,
        entity: merged.entity.length,
        forbidden: merged.forbidden.length
      });
      continue;
    }
    await db.collection('okf_repositories').update(repoId, { frontmatter: merged });
    updatedRepos += 1;
    logger.info('migration.update', {
      repo_id: repoId,
      topic: merged.topic.length,
      entity: merged.entity.length,
      forbidden: merged.forbidden.length
    });
  }

  // 3. Drop the two old collections if --force is set and the
  //    migration produced no errors.
  if (force && !dryRun) {
    try {
      await db.collection(FRONTMATTER_COLLECTION).drop();
      logger.info('migration.drop', { collection: FRONTMATTER_COLLECTION });
    } catch (e) {
      logger.warn('migration.drop_failed', { collection: FRONTMATTER_COLLECTION, err: e.message });
    }
    try {
      await db.collection(FRONTMATTER_SUMMARY_COLLECTION).drop();
      logger.info('migration.drop', { collection: FRONTMATTER_SUMMARY_COLLECTION });
    } catch (e) {
      logger.warn('migration.drop_failed', {
        collection: FRONTMATTER_SUMMARY_COLLECTION,
        err: e.message
      });
    }
  } else if (!dryRun) {
    logger.info('migration.keep_collections', {
      reason: 'no --force flag; drop manually after verification',
      collections: [FRONTMATTER_COLLECTION, FRONTMATTER_SUMMARY_COLLECTION]
    });
  }

  logger.info('migration.done', {
    updated_repos: updatedRepos,
    skipped_repos: skippedRepos,
    dry_run: dryRun,
    force: force
  });
  await close();
}

// Pure helper: take the per-row collection rows for a repo, return
// the new frontmatter field shape. Approved rows are carried over;
// unapproved rows are dropped (the migration runs after the publish
// gate, so the rows should be approved, but be defensive).
function mergeRowsIntoFrontmatter(repoId, rows, existing) {
  const byField = { topic: [], entity: [], scope: '', forbidden: [], summary: '', keyword: [] };
  const _approved = [];
  for (const r of rows) {
    if (!r.field || !VALID_FIELDS.includes(r.field)) continue;
    if (r.field === 'scope' || r.field === 'summary') {
      // Take the first approved value for single-value fields.
      if (!byField[r.field] && r.value) {
        byField[r.field] = r.value;
        if (r.approved_at) {
          _approved.push({
            field: r.field,
            value: r.value,
            approved_at: r.approved_at,
            approved_by: r.approved_by
          });
        }
      }
    } else {
      byField[r.field].push(r.value);
      if (r.approved_at) {
        _approved.push({
          field: r.field,
          value: r.value,
          approved_at: r.approved_at,
          approved_by: r.approved_by
        });
      }
    }
  }
  // Deduplicate values (the old collection had a per-row _key, so
  // duplicates shouldn't exist, but be safe).
  for (const f of ['topic', 'entity', 'forbidden', 'keyword']) {
    byField[f] = Array.from(new Set(byField[f]));
  }
  return {
    ...byField,
    _approved,
    version: rows[0] && rows[0].version ? rows[0].version : Date.now(),
    updated_at: new Date().toISOString(),
    updated_by: 'migration-script'
  };
}

const VALID_FIELDS = ['topic', 'entity', 'scope', 'forbidden', 'summary', 'keyword'];

if (require.main === module) {
  main().catch((err) => {
    logger.error('migration.fatal', { err: err.message, stack: err.stack });
    process.exit(1);
  });
}
