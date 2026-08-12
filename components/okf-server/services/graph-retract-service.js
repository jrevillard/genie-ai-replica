// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Retracts the per-repository graph (OKF_{repo_id}_*) on repository delete.
// NO-OP STUB: the graph collections don't exist until first ingest (Story 2.6,
// dataprep, gated by OPEA 1.5). Story 2.6 will replace the body with an HTTP
// call to the document-repository bundle-retract route — THIS STUB IS THE
// CONTRACT 2.6 WIRES INTO. Must not throw if the graph collections are absent.

const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

/**
 * Retract the entire graph for a repository. No-op until Story 2.6.
 * @param {string} repo_id
 */
async function retractRepoGraph(repo_id) {
  return withSpan('okf.graph.retract', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.operation', 'graph_retract');
    // Story 2.6 will implement the real retract (HTTP → document-repository bundle-retract).
    logger.info('Graph retract is a no-op (deferred to Story 2.6)', { repo_id });
    return { repo_id, retracted: false, reason: 'graph-retract-deferred-to-2.6' };
  });
}

module.exports = { retractRepoGraph };
