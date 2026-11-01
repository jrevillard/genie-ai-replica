'use strict';

// Central role policy for the file routes. Each array is the SINGLE
// statement of who may call the surfaces it names — fileRoutes imports them
// for authorizeRole, and the auth tests import them so a policy change and
// its test move together instead of the router carrying test-only exports.

/** Read-only admin surfaces (crawl jobs, metrics, logs, kill switches,
 * single-file batch ingest/retract from the UI). */
const ADMIN_ONLY = ['Admin'];

/** Document lifecycle (update / delete / ingest / retract, single + batch):
 * admins drive it from the UI; the okf-service account drives it from the
 * OKF publish/drain pipeline. */
const DOCUMENT_LIFECYCLE = ['Admin', 'okf-service'];

/** Ingestion status mirror callbacks (dataprep → doc-repo POSTs): the
 * pipeline service accounts plus tools-admin operators. */
const SERVICE_CALLBACK = ['Admin', 'dataprep-service', 'okf-service', 'tools-admin'];

/** Ingestion-log reads: admins and the dataprep pipeline account. */
const INGESTION_LOG_READ = ['Admin', 'dataprep-service'];

module.exports = {
  ADMIN_ONLY,
  DOCUMENT_LIFECYCLE,
  SERVICE_CALLBACK,
  INGESTION_LOG_READ
};
