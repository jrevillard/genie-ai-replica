// Copyright (C) 2025-2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0

/**
 * Pipeline Settings Service (K.1)
 *
 * One shared, audited, no-restart mechanism for runtime-editable pipeline
 * settings (LLM prompts/params, RAG tuning) backed by JSON files under the
 * bind-mounted /configs/pipeline directory (backend mounts it rw, the
 * pipeline readers ro).
 *
 * Ported from Vladimir Daigele's file-registry mechanism on `main`:
 *   - llm-registry-service.js @ 3b547456 (env-var path override,
 *     sanitized reads, write semantics)
 *   - rag-tuning-service.js @ 845b8ae6 -> 54ab1459 (validated writes,
 *     defaults-merge on read, audit stamps, env = seed)
 * The second attribution site is
 * _bmad-output/implementation-artifacts/spec-k1-settings-foundation.md.
 *
 * Divergence from his write path, deliberate: he wrote the file IN PLACE
 * because his registry was a SINGLE-FILE bind mount (rename over it fails
 * with EBUSY — the target is its own mount point). Ours is a DIRECTORY
 * mount, so the atomic temp-file + rename swap is legal and readers can
 * never observe a torn file.
 *
 * Precedence law (B3 SSOT): the on-box file is the source of truth once
 * seeded; the env var names the file (SEED path) only. A missing or invalid
 * file on read = WARN naming the path + the caller's defaults — never
 * silent, never a crashed chat. There are no admin routes here: K.2/K.3
 * bring the route pair and register their real schemas.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { logger } = require('../shared-lib');

// resolvedPath -> { sig: "<mtimeMs>:<size>" | "missing", merged: object|null }
// merged === null marks a bad state (missing/invalid) whose WARN already fired.
const _cache = new Map();

// resolvedPath -> tail promise of the serialized write queue (K.2 review:
// express does NOT serialize async handlers — two concurrent PUTs used to
// race their read-merge-write and lose one update).
const _writeQueues = new Map();

/**
 * Resolve a settings file path: env-var override (containers) else a
 * repo-relative fallback (local dev/tests). His exact pattern.
 * @param {string} envVar names the LIVE file — in containers compose sets it
 *   to the bind-mounted path (/configs/pipeline/<name>.json)
 * @param {string} fallbackRepoRelative local-dev/tests-only path relative to
 *   this services dir — keeps the committed SEED name, e.g.
 *   '../../../configs/pipeline/llm-settings.seed.json'
 * @returns {string} absolute path
 */
function resolvePath(envVar, fallbackRepoRelative) {
  return process.env[envVar] || path.resolve(__dirname, fallbackRepoRelative);
}

function _signature(stat) {
  return `${stat.mtimeMs}:${stat.size}`;
}

function _deepMerge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    const b = base[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) &&
      b && typeof b === 'object' && !Array.isArray(b)
        ? _deepMerge(b, value)
        : value;
  }
  return out;
}

/**
 * Read settings: file values deep-merged over `defaults` (a partial file is
 * legal — missing keys fall back). mtime/size-guarded module cache, so the
 * per-request call is cheap and an edited file is picked up with no restart.
 * Never throws: a missing/invalid file WARNs (once per state change) and
 * returns defaults. Treat the returned object as read-only.
 * @param {string} envVar
 * @param {string} fallbackRepoRelative
 * @param {Object} defaults caller-documented defaults for this settings file
 * @returns {Promise<Object>}
 */
async function readSettings(envVar, fallbackRepoRelative, defaults) {
  const file = resolvePath(envVar, fallbackRepoRelative);
  const entry = _cache.get(file);
  let sig = 'missing';
  try {
    sig = _signature(fs.statSync(file));
  } catch {
    // missing — handled below with the cached-state WARN guard
  }

  if (sig !== 'missing' && entry && entry.sig === sig) {
    return entry.merged === null ? defaults : entry.merged;
  }

  if (sig === 'missing') {
    if (!entry || entry.sig !== 'missing') {
      logger.warn(`[PIPELINE-SETTINGS] '${file}' missing; using defaults.`);
    }
    _cache.set(file, { sig, merged: null });
    return defaults;
  }

  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('top-level JSON is not an object');
    }
    const merged = _deepMerge(defaults, parsed);
    _cache.set(file, { sig, merged });
    return merged;
  } catch (error) {
    if (!entry || entry.sig !== sig) {
      logger.warn(`[PIPELINE-SETTINGS] '${file}' unreadable (${error.message}); using defaults.`);
    }
    _cache.set(file, { sig, merged: null });
    return defaults;
  }
}

/**
 * Validated, atomic, audited write. The patch is checked against the
 * caller-supplied schema ({ topLevelKey: (value) => true | errorMessage } —
 * K.2/K.3 register their real schemas), merged onto the current file,
 * stamped, then written via a `.<name>.tmp` + rename swap inside the mounted
 * dir (see header). Envelope keys (version/updatedAt/updatedBy) are managed
 * here and rejected in patches by construction (absent from any schema).
 * @param {string} envVar
 * @param {string} fallbackRepoRelative
 * @param {Object} opts { patch, schema, updatedBy, validateMerged? }
 *   validateMerged(mergedDoc) -> errorMessage | null, run on the CLEAN
 *   MERGED doc INSIDE the serialized write — for cross-field constraints
 *   (K.3: fetchK >= retrievalK) that must hold on the doc that lands on
 *   disk, not just the patch, and that must not race a concurrent PUT.
 * @returns {Promise<Object>} the merged, stamped settings now on disk
 * @throws {Error} with .status=400 when the patch fails validation — the
 *   on-disk file is untouched
 */
async function writeSettings(envVar, fallbackRepoRelative, { patch, schema, updatedBy, validateMerged }) {
  const badRequest = (message) => {
    const err = new Error(message);
    err.status = 400;
    throw err;
  };

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    badRequest('A settings patch object is required.');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    badRequest('An empty patch is not a settings change.');
  }
  for (const key of keys) {
    const check = schema && schema[key];
    if (typeof check !== 'function') {
      badRequest(`Unknown settings key '${key}' (not in this settings schema).`);
    }
    const verdict = check(patch[key]);
    if (verdict !== true) {
      badRequest(`Invalid value for '${key}': ${verdict || 'failed schema validation'}.`);
    }
  }

  // A backend started WITHOUT the env var resolves to the repo-relative
  // committed SEED — writing there would corrupt the checked-in source, so
  // refuse loudly instead (containers always set the var via compose).
  if (!process.env[envVar]) {
    const err = new Error(
      `settings path not configured: ${envVar} is unset — refusing to write the seed fallback.`
    );
    err.status = 503;
    throw err;
  }

  // Serialize the read-merge-write per resolved file: express does not
  // serialize async handlers, so two concurrent PUTs would otherwise race
  // and lose one update (the per-file queue this function's original
  // single-writer comment deferred — it has now landed).
  const file = resolvePath(envVar, fallbackRepoRelative);
  const tail = _writeQueues.get(file) || Promise.resolve();
  const run = tail.then(writeNow, writeNow);
  // Keep the queue alive whether or not this job rejects; the caller sees `run`.
  _writeQueues.set(file, run.then(() => {}, () => {}));
  return run;

  async function writeNow() {
    // Parse the CURRENT file directly — NOT via readSettings' loud-degrade: an
    // existing-but-corrupt file must abort the write (409, file untouched)
    // rather than be silently reduced to patch+stamps. A MISSING file is the
    // legal self-heal case and starts from an empty base.
    let base = {};
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('top-level JSON is not an object');
      }
      base = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const err = new Error(
          `settings file '${file}' is corrupt (${error.message}) — fix or remove it before writing.`
        );
        err.status = 409;
        throw err;
      }
    }

    const merged = _deepMerge(base, patch);
    // Cross-field constraints run on the CLEAN merged doc, inside the
    // per-file queue: the patch was schema-validated above, so values here
    // are numbers/strings of the right types, and the serialized context
    // kills the two-concurrent-PUTs merged-violation window.
    if (typeof validateMerged === 'function') {
      const verdict = validateMerged(merged);
      if (verdict) {
        badRequest(typeof verdict === 'string' ? verdict : 'Merged settings failed cross-field validation.');
      }
    }
    merged.version = (Number(merged.version) || 0) + 1;
    merged.updatedAt = new Date().toISOString();
    merged.updatedBy = String(updatedBy || 'unknown');

    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    // Drop the cache entry: rename's new mtime normally invalidates it anyway,
    // but an identical mtimeMs+size collision must not serve a stale read.
    _cache.delete(file);

    logger.info(`[PIPELINE-SETTINGS] ${file} updated by ${merged.updatedBy}.`);
    return merged;
  }
}

module.exports = {
  resolvePath,
  readSettings,
  writeSettings,
  // exported for testing
  _deepMerge,
  _resetCache: () => _cache.clear(),
};
