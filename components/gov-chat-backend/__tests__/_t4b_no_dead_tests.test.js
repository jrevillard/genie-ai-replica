'use strict';
const fs = require('fs');
const path = require('path');

const DEAD = [
  'victorialogs-transport.test.js',
  'victorialogs-transport-queue-full.test.js',
  'logger-vl-integration.test.js',
  'log-record-dropped-mirrors.test.js'
];

test('no dead VL transport test files remain', () => {
  const dir = path.resolve(__dirname);
  for (const f of DEAD) {
    expect(fs.existsSync(path.join(dir, f))).toBe(false);
  }
});
