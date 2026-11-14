// run-pool — THE fixed-size worker pool for okf-server (2026-11-14).
//
// Four copies of this idiom already existed (ingest-service _pool,
// llm-curation-service runPool, topic-link-authoring-service runPool, and an
// inline variant in the split operation) — each with slight variation, each a
// separate thing to fix. This module is the one implementation: new callers
// require it; existing copies migrate when their files are next touched.
//
// Fixed-size worker pool over items, preserving RESULT positions.

'use strict';

/** Run `worker(item, index)` over `items` with at most `concurrency` workers
 * in flight. Resolves to the results array, position-aligned with items.
 * A worker rejection rejects the whole pool (callers isolate per item). */
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

module.exports = { runPool };
