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

// The run surface the agent-service serves (POST /v1/runs). The BFF posts
// the configured url VERBATIM (axios.post(agentRunUrl(), …)), so the url the
// BFF dials must NAME the run surface: a base url without the path answers
// 404 on a real deployment — the defect #2072 records (both sides were green
// under a mocked axios; the live hop answered "POST / HTTP/1.1 404").
const AGENT_RUN_PATH = '/v1/runs';

/**
 * Whether the agentic branch of the query entries is exposed.
 *
 * @returns {boolean} True when AGENT_ENABLED=1 at module load.
 */
function isAgentPathEnabled() {
  return AGENT_ENABLED;
}

/**
 * The agent-service BASE url — the operator's AGENT_SERVICE_URL override, or
 * the compose default.
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

/**
 * The agent-service RUN endpoint the BFF POSTs to — the base url with the
 * run surface named.
 *
 * The path is appended HERE, once, so every consumer of the agent seam dials
 * the same url and the shipped default works without an operator override
 * (#2072). A configured url that ALREADY names the run surface is used as
 * it stands: a deployment that pinned the full path (the V08 rehearsal's
 * `…:8080/v1/runs`) keeps working, and the two spellings cannot disagree
 * about where the seam lives.
 *
 * @returns {string} The absolute url of POST /v1/runs.
 */
function agentRunUrl() {
  const base = agentServiceUrl().replace(/\/+$/, '');
  return base.endsWith(AGENT_RUN_PATH) ? base : `${base}${AGENT_RUN_PATH}`;
}

module.exports = { isAgentPathEnabled, agentServiceUrl, agentRunUrl };
