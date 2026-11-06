// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * job-registry — the ONE in-memory 202+poll job registry (UX-4, #1514
 * review round: the bulk-PII job was a verbatim clone of the suggest-job
 * skeleton in frontmatter-service.js; this module is the extraction so the
 * next detached job stops copy-pasting it).
 *
 * Contract shared by both call sites:
 *  - jobs are in-memory (single-replica service; the same class of registry
 *    as genInFlight/runInFlight) — a restart loses them, which every arm
 *    route's 404-on-poll already answers honestly;
 *  - the cap prunes OLDEST FINISHED jobs first and never evicts a running
 *    one, so a burst of finished jobs cannot squeeze an active one out;
 *  - get() returns a SHALLOW COPY — a poller can never mutate the live entry.
 */
const nodeCrypto = require('node:crypto');

/**
 * @param {object} opts
 * @param {string} opts.prefix  job-id prefix, one per registry (sg/bp/…)
 * @param {number} [opts.cap]   max live jobs before finished ones prune (default 100)
 */
function createJobRegistry({ prefix, cap = 100 }) {
  const jobs = new Map();
  return {
    /** Create + register a running job. Returns the LIVE object (the caller's
     * worker writes onto it); routes hand pollers the get() copy instead. */
    create(seed = {}) {
      const id = `${prefix}${Date.now()}-${nodeCrypto.randomUUID().slice(0, 6)}`;
      const job = { job_id: id, status: 'running', started_at: new Date().toISOString(), ...seed };
      jobs.set(id, job);
      if (jobs.size > cap) {
        for (const [k, v] of jobs) {
          if (jobs.size <= cap) break;
          if (v.status !== 'running') jobs.delete(k);
        }
      }
      return job;
    },
    /** Snapshot copy, or null for an unknown id. */
    get(id) {
      const job = jobs.get(id);
      return job ? { ...job } : null;
    }
  };
}

module.exports = { createJobRegistry };
