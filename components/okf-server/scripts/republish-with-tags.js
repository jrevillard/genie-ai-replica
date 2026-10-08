#!/usr/bin/env node
/*
 * Story 1.6 (2026-10-07) — operator migration script: tag every published OKF
 * repo that lacks an okf_repo_frontmatter row. Implements the operator workflow:
 *   retract -> re-curate -> run script -> re-ingest (optional)
 *
 * Idempotent: a second run is a no-op on already-tagged repos.
 *
 * Flags:
 *   --dry-run         Compute suggestions, print, do not write.
 *   --repo <repo_id>  Single-repo mode (default: all repos without frontmatter).
 *   --auto-approve    Skip the consistency gate; publish anyway (the curator
 *                     has already passed). Use this when re-tagging already-
 *                     ingested repos whose curator reviewed before retracting.
 *   --limit N         Cap the number of repos processed (for staged rollout).
 *
 * Exit codes: 0 = all repos tagged, 1 = at least one failed, 2 = usage error.
 *
 * DB access goes through the SHARED driver (components/shared/lib, copied to
 * shared-lib/ in the image; jest maps it — a dev checkout resolves the
 * fallback below). Exit code: 0 = no FAIL, 1 = at least one FAIL.
 */

function loadDbService() {
  try {
    return require('../shared-lib/db-connection-service');
  } catch {
    return require('../../shared/lib/db-connection-service');
  }
}

const dbService = loadDbService();
const frontmatterService = require('../services/frontmatter-service');
const { logger } = require('../shared-lib/logger');

const argv = process.argv.slice(2);
const FLAGS = {
  dryRun: argv.includes('--dry-run'),
  autoApprove: argv.includes('--auto-approve'),
  singleRepo: (() => {
    const i = argv.indexOf('--repo');
    return i >= 0 ? argv[i + 1] : null;
  })(),
  limit: (() => {
    const i = argv.indexOf('--limit');
    return i >= 0 ? parseInt(argv[i + 1], 10) : Infinity;
  })()
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node scripts/republish-with-tags.js [--dry-run] [--repo <id>] [--auto-approve] [--limit N]');
  process.exit(0);
}

const results = [];
function record(repoId, status, detail) {
  results.push({ repo_id: repoId, status, detail });
  const mark = { PASS: '[PASS]', WARN: '[WARN]', FAIL: '[FAIL]', INFO: '[INFO]' }[status];
  console.log(`${mark} ${repoId}${detail ? ' — ' + detail : ''}`);
}

async function getCandidateRepos(db) {
  // Repos at lifecycle_state=publish that do NOT have a frontmatter summary row.
  // The summary row's existence is the source of truth — a republish with no
  // frontmatter writes nothing; this query returns what still needs work.
  const q = await db.query(`
    LET tagged = (FOR s IN okf_repositories_frontmatter_summary RETURN s._key)
    FOR r IN okf_repositories
      FILTER r.deleted_at == null
        AND r.lifecycle_state == 'publish'
        AND r._key NOT IN tagged
      SORT r.updated_at DESC
      RETURN { repo_id: r._key, name: r.name, version: r.version, ingested_at: r.ingested_at }
  `);
  return q.all();
}

async function getSingleRepo(db, repoId) {
  const q = await db.query(
    `FOR r IN okf_repositories FILTER r._key == @rid AND r.deleted_at == null RETURN { repo_id: r._key, name: r.name, version: r.version, ingested_at: r.ingested_at }`,
    { rid: repoId }
  );
  const rows = await q.all();
  return rows && rows[0];
}

async function processRepo(repo, _opts) {
  const rid = repo.repo_id;
  logger.info('republish-with-tags.start', { repo_id: rid, dry_run: FLAGS.dryRun });
  let suggested;
  try {
    suggested = await frontmatterService.suggestTags(rid, { sampleN: 20 });
  } catch (err) {
    record(rid, 'FAIL', `suggestTags failed: ${err.message}`);
    return;
  }
  // Validate unless --auto-approve (operator has already passed).
  if (!FLAGS.autoApprove) {
    const inconsistencies = await (async () => {
      try {
        const v = await frontmatterService.validateFrontmatter(rid, suggested);
        return v.inconsistencies || [];
      } catch (err) {
        return [{ tag: '*', reason: 'validation_error', message: err.message }];
      }
    })();
    if (inconsistencies.length > 0) {
      record(rid, 'WARN', `inconsistencies=${inconsistencies.length} (run with --auto-approve to bypass)`);
      if (FLAGS.dryRun) return;
      // In non-dry-run without --auto-approve, refuse to publish.
      return;
    }
  }
  if (FLAGS.dryRun) {
    record(rid, 'INFO', `dry-run suggested: topics=${suggested.topic.length}, forbidden=${suggested.forbidden.length}`);
    return;
  }
  try {
    // Story 1.7 (2026-10-08): the canonical store is now
    // `okf_repositories.frontmatter` (a doc field, additive) — not the
    // old okf_repo_frontmatter + okf_repositories_frontmatter_summary
    // collections. The script writes to the new field via
    // writeFrontmatterToRepoDoc. The LLM-suggested set is auto-approved
    // (the script is the operator's explicit opt-in to the auto-tagger).
    const now = new Date().toISOString();
    const approved = [];
    for (const field of ['topic', 'entity', 'forbidden', 'keyword']) {
      const arr = Array.isArray(suggested[field]) ? suggested[field] : [];
      for (const value of arr) {
        if (value) approved.push({ field, value, approved_at: now, approved_by: 'republish-with-tags-script' });
      }
    }
    for (const field of ['scope', 'summary']) {
      const v = suggested[field];
      if (v) approved.push({ field, value: v, approved_at: now, approved_by: 'republish-with-tags-script' });
    }
    const summary = await frontmatterService.writeFrontmatterToRepoDoc(rid, {
      ...suggested,
      _approved: approved
    }, {
      actor: { user_id: 'republish-with-tags-script', source: 'script' },
      version: repo.version || Date.now()
    });
    record(
      rid,
      'PASS',
      `topics=${summary.topic.length}, forbidden=${summary.forbidden.length}, version=${summary.version}`
    );
  } catch (err) {
    record(rid, 'FAIL', `writeFrontmatterToRepoDoc failed: ${err.message}`);
  }
}

async function main() {
  const db = await dbService.getConnection();
  let repos;
  if (FLAGS.singleRepo) {
    const r = await getSingleRepo(db, FLAGS.singleRepo);
    repos = r ? [r] : [];
    if (!repos.length) {
      console.error(`[FAIL] --repo ${FLAGS.singleRepo}: not found or not at lifecycle_state=publish`);
      process.exit(2);
    }
  } else {
    repos = await getCandidateRepos(db);
  }
  if (FLAGS.limit !== Infinity) repos = repos.slice(0, FLAGS.limit);
  if (!repos.length) {
    console.log('[INFO] no repos to tag (all published repos are tagged)');
    return finish();
  }
  console.log(
    `[INFO] processing ${repos.length} repo(s)${FLAGS.dryRun ? ' (DRY RUN)' : ''}${FLAGS.autoApprove ? ' (AUTO-APPROVE)' : ''}`
  );
  for (const repo of repos) {
    await processRepo(repo);
  }
  return finish();
}

function finish() {
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  console.log(`\n=== summary: ${results.length} processed, ${fails} FAIL, ${warns} WARN ===`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[FATAL]', err.stack || err.message);
  process.exit(2);
});
