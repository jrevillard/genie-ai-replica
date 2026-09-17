'use strict';
const fs = require('fs');
const path = require('path');

test('shared lib barrel does not advertise VictoriaLogsTransport', () => {
  const barrelSrc = fs.readFileSync(path.resolve(__dirname, '../../shared/lib/index.js'), 'utf8');
  expect(barrelSrc).not.toMatch(/VictoriaLogsTransport/);
});

test('logger config does not register VictoriaLogsTransport', () => {
  const loggerSrc = fs.readFileSync(path.resolve(__dirname, '../../shared/lib/logger.js'), 'utf8');
  expect(loggerSrc).not.toMatch(/VictoriaLogsTransport/);
});

test('logger config does not read LOG_TO_VICTORIALOGS env (env gate removed)', () => {
  const loggerSrc = fs.readFileSync(path.resolve(__dirname, '../../shared/lib/logger.js'), 'utf8');
  expect(loggerSrc).not.toMatch(/LOG_TO_VICTORIALOGS/);
});

test('victorialogs-transport source file is deleted', () => {
  const transportFile = path.resolve(__dirname, '../../shared/lib/victorialogs-transport.js');
  expect(fs.existsSync(transportFile)).toBe(false);
});

test('backend tracing-pii-logs source file is deleted', () => {
  const srcFile = path.resolve(__dirname, '../tracing-pii-logs.js');
  expect(fs.existsSync(srcFile)).toBe(false);
});
