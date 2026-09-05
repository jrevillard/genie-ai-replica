// components/shared/lib/otel-batch-config.js
'use strict';
module.exports = {
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  maxQueueSize: 2048
};
