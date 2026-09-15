// components/shared/lib/boolean-env.js
'use strict';
function booleanEnv(name, defaultValue = false) {
  const v = process.env[name];
  if (typeof v === 'undefined') return Boolean(defaultValue);
  return /^(1|true|TRUE|yes)$/.test(String(v).trim());
}
module.exports = { booleanEnv };
