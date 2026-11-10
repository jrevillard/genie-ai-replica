// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
'use strict';

/**
 * THE doc-repo client — one metadata GET + the envelope unwrap (issue #1686).
 *
 * Three services read doc-repo metadata: the importer (producer-service), the
 * crawl provenance stamper (crawl-conversion-service) and the SOURCES-BUSY
 * gate (lifecycle-service). They used to carry their OWN copy of the GET, and
 * the envelope handling drifted between them (a copy that handled only
 * {file} | {data} silently degraded the {data: {file}} shape to id-only
 * stamping — review 2026-10-29).
 *
 * A LEAF module on purpose: hosting this helper inside producer-service made
 * the crawl stamper and the lifecycle gate depend on the whole conversion
 * require chain (ingest-service, the converters, the pii client chain) for a
 * single HTTP GET.
 */
const config = require('../config');
const { authedAxios } = require('./service-token');

/** doc-repo GET /api/files/:id response envelopes have varied across versions
 * ({file}, {data: {file}}, {data}) — unwrap every shape the fleet ships. */
function docRepoFileOf(res) {
  const d = (res && res.data) || {};
  return d.file || (d.data && d.data.file) || d.data || d || {};
}

/** The doc-repo metadata for one file. `timeout` is a parameter because the
 * SOURCES-BUSY gate is latency-critical (5 s fail-closed re-check) while the
 * import path tolerates 10 s. */
async function fetchDocMeta(fileId, timeout = 10000) {
  const res = await authedAxios.get(`${config.documentRepository.url}/api/files/${encodeURIComponent(fileId)}`, {
    timeout
  });
  return docRepoFileOf(res);
}

module.exports = { fetchDocMeta };
