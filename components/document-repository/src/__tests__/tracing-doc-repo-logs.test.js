'use strict';
const fs = require('fs');
const path = require('path');

test('document-repository tracing does not push OTLP /v1/logs (LoggerProvider gone)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../tracing.js'), 'utf8');
  expect(src).not.toMatch(/OTLPLogExporter/);
  expect(src).not.toMatch(/new LoggerProvider\(/);
  expect(src).not.toMatch(/logs\.setGlobalLoggerProvider/);
  expect(src).not.toMatch(/PIIRedactingLogRecordProcessor/);
});
