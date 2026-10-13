'use strict';
const fs = require('fs');
const path = require('path');

test('logs-service does not advertise _vlFilter (dedup gone)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../services/logs-service.js'), 'utf8');
  expect(src).not.toMatch(/_vlFilter/);
  expect(src).not.toMatch(/NOT\s+fluent\.tag/);
});
