/**
 * Deterministic Arango _key derivation for agri docs.
 *
 * Uses SHA-256 + base64url. Collision-resistant (SHA-1 has practical
 * collision attacks — see mr388-followups.md L-1). The output length
 * differs from the previous SHA-1 keys (27 → 43 chars), so a re-ingest
 * is required to drop the old SHA-1-keyed docs (combined with the bge
 * re-ingest from O-1).
 */
const nodeCrypto = require('node:crypto');

function docKey(logical) {
  return nodeCrypto.createHash('sha256').update(logical).digest('base64url');
}

module.exports = { docKey };
