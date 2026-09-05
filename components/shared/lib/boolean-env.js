// components/shared/lib/boolean-env.js
'use strict';
function booleanEnv(name) {
  const v = process.env[name];
  if (typeof v === 'undefined') return false;
  return /^(1|true|TRUE|yes)$/.test(String(v).trim());
}
module.exports = { booleanEnv };
