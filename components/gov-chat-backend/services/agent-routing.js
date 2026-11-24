'use strict';

// The shared routing helper for the agentic branch. This
// module is the ONLY place in the component that reads AGENT_ENABLED (the
// invariant is pinned by a test in __tests__/services/agent-routing.test.js),
// and the only way either agentic query entry is exposed routes through it —
// BOTH entries are wired now: the streaming one and the
// non-streaming JSON one (both call this same helper). The
// cross-entry disagreement guard depends on it; this module pins the
// single-read invariant that guard builds on.

/**
 * OKF_ENABLED pattern (see retrieval-config-client.js): the flag is read ONCE
 * at module load, dark-launch polarity — DISABLED when unset. Compose states
 * the variable for the whole stack (`AGENT_ENABLED=${AGENT_ENABLED:-0}`), and
 * any non-compose run without the entry stays parked instead of silently
 * flipping the routing on. The value MUST be `0` or `1` (the deployment
 * contract the compose block and the env template document): any other value
 * — `true` included — parks the branch.
 */
const AGENT_ENABLED = (process.env.AGENT_ENABLED ?? '0').trim() === '1';

// The compose service name + the port the agent-service binds (the healthcheck
// probes 127.0.0.1:8010). The code default matches the compose entry, so an
// operator override is optional, never required.
const DEFAULT_AGENT_SERVICE_URL = 'http://agent-service:8010';

/**
 * Whether the agentic branch of the query entries is exposed.
 *
 * @returns {boolean} True when AGENT_ENABLED=1 at module load.
 */
function isAgentPathEnabled() {
  return AGENT_ENABLED;
}

/**
 * The agent-service internal endpoint the BFF POSTs `/v1/runs` to.
 *
 * Read per call (a constant, not a knob an operator flips at runtime — but a
 * function keeps the test surface honest about where the value comes from).
 *
 * @returns {string} The AGENT_SERVICE_URL override, or the compose default.
 */
function agentServiceUrl() {
  const configured = (process.env.AGENT_SERVICE_URL ?? '').trim();
  return configured || DEFAULT_AGENT_SERVICE_URL;
}

module.exports = { isAgentPathEnabled, agentServiceUrl };
