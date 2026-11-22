'use strict';

const http = require('http');
const https = require('https');
const { logger, parsePositiveInt } = require('../shared-lib');

// Story 2.4b — the shared agent-run vocabulary. The deadline pair, the
// citation→source_documents mapping, the metadata assembly and the upstream
// body reader live HERE (one home each) so the two consumers of the
// agent-service seam — the streaming frame writer (story 2.4) and the
// non-streaming JSON consumer (story 2.4b) — cannot drift apart. The frame
// writer re-exports the pieces its test pins read; production code imports
// from this module directly.

// ONE shared keepAlive agent pair for the agent leg (both consumers dial the
// same /v1/runs endpoint). Per-request `new Agent({keepAlive:true})` calls
// leaked: the sockets pooled in agents nothing ever destroyed. Shared, the
// keepAlive actually works — one pool, reused across turns, never destroyed.
const agentHttpAgent = new http.Agent({ keepAlive: true });
const agentHttpsAgent = new https.Agent({ keepAlive: true });

// ─── the deadline derivation (docs/agent-budget-deadline-pairs.md) ──────────
//
// The pair rule (`AGENT_UPSTREAM_TIMEOUT_MS >= deadline_ms + reserves`) holds
// by construction: the deadline the BFF communicates is the timeout MINUS the
// named reserves. The reserves are module constants, not knobs — 2.10
// revisits them when translation allowances land. The judge-overrun ceiling
// (AGENT_VERDICT_JUDGE_TIMEOUT_MS, story 2.6) is not part of this derivation
// yet: the run surface bounds its own wall clock and answers honestly, so a
// long run surfaces as the agent's own budget_exhausted/run_error, never as
// a BFF timeout.
const DEFAULT_UPSTREAM_TIMEOUT_MS = 3600000;
const TRANSLATION_RESERVE_MS = 30000; // the GPU translator's own hard timeout
const FINALIZATION_MARGIN_MS = 5000; // metadata persistence + frame write + SSE teardown
const DEADLINE_FLOOR_MS = 1000;

/**
 * The EFFECTIVE upstream timeout — the one value BOTH consumers of the pair
 * read (the deadline derivation and the axios `timeout` option). A configured
 * timeout that cannot cover the reserves plus the floor would break the pair
 * rule (`deadline_ms + reserves > timeout`) and turn a bounded run into a
 * BFF-attributed abort — the misattribution the pairs doc forbids — so it is
 * absorbed: one warning names the knob (configured vs applied) and the
 * default applies to everything downstream.
 * @returns {number}
 */
function resolveUpstreamTimeoutMs() {
  const configured = parsePositiveInt(process.env.AGENT_UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT_MS, { min: 1 });
  if (configured <= TRANSLATION_RESERVE_MS + FINALIZATION_MARGIN_MS + DEADLINE_FLOOR_MS) {
    // The event name keeps the AgentFrameWriter prefix the frame-writer suite
    // pins (`upstream_timeout_below_reserves`) — the helper moved here in
    // 2.4b, the pin followed the rename to the module's own prefix.
    logger.warn('AgentRunContract.upstream_timeout_below_reserves', {
      knob: 'AGENT_UPSTREAM_TIMEOUT_MS',
      configured,
      applied: DEFAULT_UPSTREAM_TIMEOUT_MS
    });
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  return configured;
}

/**
 * The agent-phase deadline the run request communicates: the upstream timeout
 * minus the translation and finalization reserves. The caller passes the
 * EFFECTIVE timeout (`resolveUpstreamTimeoutMs()` — the absorption happens
 * there, once, so the deadline and the wire-level timeout can never read two
 * different values).
 * @param {number} timeoutMs - The effective upstream timeout.
 * @returns {number}
 */
function deriveDeadlineMs(timeoutMs) {
  return Math.max(DEADLINE_FLOOR_MS, timeoutMs - TRANSLATION_RESERVE_MS - FINALIZATION_MARGIN_MS);
}

// ─── verdict projection ─────────────────────────────────────────────────────
//
// The verdict payload is the verification pipeline's projection contract
// (agent/verification.py Verdict.payload()): grounding_status, is_grounded,
// translation_mode, policy, judge, citations, invalid_citations, marking. The
// frame carries it verbatim; the METADATA keeps its existing shape and takes
// only the additive fields the client metadata contract names:
// `grounding_status` (tri-state) + the derived `is_grounded`, plus the
// source_documents mapped from the citations into the deployed envelope
// variants.

/**
 * Map one verdict citation (`{provenance, text, score}`) to the deployed
 * source_documents row shape — the mapping noagent/pipeline.py's
 * `source_document_envelope` performs server-side for the no-agent path:
 * a legacy corpus source carries `document_id` and no source marker; an OKF
 * concept carries the `concept_id`/`repo_id`/`bundle_version` trio and
 * `source: 'okf-concept'`. Identity-derived names, empty url/labels — the
 * deployed shape, no per-answer metadata round-trip.
 * @param {Object} citation
 * @returns {Object|null} The source_documents row, or null for a citation
 *   whose provenance is not an object (nothing invented for it).
 */
function citationToSourceDocument(citation) {
  const provenance = citation && citation.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return null;
  }
  // The row fields both variants share; the variant adds its identity keys.
  const identity = provenance.source === 'okf-concept' ? provenance.concept_id : provenance.file_id;
  const entry = {
    document_id: identity,
    document_name: String(identity ?? '')
      .replace(/_/g, ' ')
      .trim(),
    url: '',
    categoryLabels: [],
    serviceLabels: [],
    score: typeof citation.score === 'number' ? citation.score : null
  };
  if (provenance.source === 'okf-concept') {
    entry.concept_id = provenance.concept_id;
    entry.source = 'okf-concept';
    if (provenance.repo_id) {
      entry.repo_id = provenance.repo_id;
    }
    if (provenance.bundle_version !== undefined && provenance.bundle_version !== null) {
      entry.bundle_version = provenance.bundle_version;
    }
  }
  return entry;
}

/**
 * The legacy empty-stream metadata shape — "chatqna (or the agent) never
 * answered" encoded per field, following the parser convention in
 * query-service.js (parseChatQnASSELine). ONE factory for every agentic
 * finalize path (stream terminal, disconnect partial save, non-streaming
 * JSON completion), so the call sites cannot drift into storing different
 * key sets for the same kind of query.
 *
 * "Not recorded" is encoded per field:
 * - Presence-keyed fields (self_confidence, query_translation_status) stay
 *   ABSENT. The Inspector renders the self-confidence block on
 *   hasOwnProperty, so an explicit null here would claim "feature was on,
 *   no sentinel" on a turn chatqna never answered; absence reads as
 *   "never reported" — the same meaning absence carries on the streamed
 *   path. "chatqna never answered" itself is what `abstained: null` below
 *   marks: no streamed path ever sets it to null.
 * - Value-keyed fields carry the explicit null (or the value default) the
 *   parser normalizes them to: `abstained` is null here, not false — false
 *   would mean "chatqna answered and chose not to abstain" (a clean
 *   low-confidence miss), this is "we never got an answer", and a post-hoc
 *   AQL counting abstentions has to be able to tell them.
 *
 * (Moved here from routes/query-routes.js in story 2.4b: the non-streaming
 * JSON consumer assembles the same base shape and a second copy would drift.)
 *
 * @returns {Object}
 */
const emptyStreamMetadata = () => ({
  source_documents: [],
  confidence_score: 0,
  is_grounded: false,
  retrieval_confidence_score: null,
  abstained: null,
  abstention_reason: null,
  // No metadata event means the turn never reported a scope — null (the
  // Inspector's "not recorded" dash), not an empty list, which would claim
  // the query ran unfiltered.
  filter_labels: null
});

/**
 * Assemble the metadata object one agentic turn persists and streams.
 *
 * Base: the legacy empty-stream shape (`emptyStreamMetadata()` — abstained
 * null, filter_labels null), so an agentic doc is indistinguishable in shape
 * from a legacy one. The verdict overlays the additive grounding fields and
 * the citation set; a run WITHOUT a verdict event defaults to `unverified` —
 * never a confident default. The `agent_run` block (run_id + the terminal
 * usage record when one arrived) rides additively on the wire and into the
 * persisted doc — the version-record persistence of this story.
 *
 * The base factory defaults to THIS module's own `emptyStreamMetadata` — the
 * one home: a caller cannot inject a divergent base shape (the streaming
 * frame writer still passes one explicitly; it is the same function).
 *
 * @param {Object} params
 * @param {Function} [params.emptyStreamMetadata] - The metadata factory
 *   (defaults to the module's own).
 * @param {Object|null} params.verdict - The captured verdict payload.
 * @param {string|null} params.runId - The seam run id.
 * @param {Object|null} params.usageRecord - The terminal usage record.
 * @returns {Object}
 */
function assembleAgentMetadata({
  emptyStreamMetadata: baseFactory = emptyStreamMetadata,
  verdict,
  runId,
  usageRecord
}) {
  const metadata = baseFactory();
  if (verdict) {
    metadata.grounding_status = verdict.grounding_status;
    metadata.is_grounded = verdict.is_grounded === true;
    // The envelope rows are the AGENT SERVICE's projection when the payload
    // carries them (capabilities/citations.py source_documents_from_citations
    // — the one owner of the mapping, shared with the no-agent lane). The
    // BFF-side derivation below is the fallback for an older payload that
    // names only the raw citations.
    metadata.source_documents = Array.isArray(verdict.source_documents)
      ? verdict.source_documents
      : (Array.isArray(verdict.citations) ? verdict.citations : []).map(citationToSourceDocument).filter(Boolean);
  } else {
    metadata.grounding_status = 'unverified';
    metadata.is_grounded = false;
  }
  metadata.agent_run = { run_id: runId ?? null };
  if (usageRecord) {
    metadata.agent_run.usage_record = usageRecord;
  }
  return metadata;
}

/**
 * The upstream JSON body to forward to the client — only a real object passes
 * through; anything else (a string body, an array, garbage) falls back to the
 * documented error name at the caller.
 * @param {Object|null} parsed - The parsed upstream body.
 * @returns {Object|null}
 */
const passthroughBody = (parsed) => (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);

/**
 * Read an upstream non-2xx body (a stream under `responseType: 'stream'`) and
 * parse it as JSON, best-effort — the 429/503 answers are passed through to
 * the client verbatim when they parse, with a generic fallback when they do
 * not. A body beyond the 64 KiB cap stops buffering (the prefix still parses
 * when it can) and warns: an operator must know a real body was cut, not see
 * a silent degrade to the fallback.
 *
 * The event name carries THIS module's prefix (the helper moved here in
 * 2.4b from the frame writer; the suite pins followed the rename).
 *
 * @param {Object} data - The axios response data (a Node stream).
 * @param {number} [status] - The upstream status, for the truncation warning.
 * @returns {Promise<{text: string, parsed: Object|null}>}
 */
function readUpstreamBody(data, status) {
  return new Promise((resolve) => {
    if (!data || typeof data.on !== 'function') {
      resolve({ text: '', parsed: null });
      return;
    }
    const chunks = [];
    let size = 0;
    let truncated = false;
    data.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 65536) {
        chunks.push(chunk);
      } else if (!truncated) {
        truncated = true;
        logger.warn('AgentRunContract.upstream_body_truncated', {
          status,
          bytes: size
        });
      }
    });
    // The body's termination: 'end' for a fully consumed stream, 'close' for
    // a destroyed one (a destroyed body can report 'close' ALONE — settling
    // only on 'end'/'error' would leave this promise pending forever). The
    // flag makes the concat+parse run ONCE — resolve alone is idempotent,
    // but the work before it is not.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      resolve({ text, parsed });
    };
    data.on('end', finish);
    data.on('close', finish);
    data.on('error', () => {
      settled = true;
      resolve({ text: '', parsed: null });
    });
  });
}

module.exports = {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  TRANSLATION_RESERVE_MS,
  FINALIZATION_MARGIN_MS,
  DEADLINE_FLOOR_MS,
  resolveUpstreamTimeoutMs,
  deriveDeadlineMs,
  citationToSourceDocument,
  emptyStreamMetadata,
  assembleAgentMetadata,
  passthroughBody,
  readUpstreamBody,
  // The shared keepAlive pair — BOTH run-body call sites dial with these.
  agentHttpAgent,
  agentHttpsAgent,
  // Exposed for the tests that pin them — production code reads nothing here.
  _internals: {
    DEFAULT_UPSTREAM_TIMEOUT_MS,
    TRANSLATION_RESERVE_MS,
    FINALIZATION_MARGIN_MS,
    deriveDeadlineMs,
    resolveUpstreamTimeoutMs
  }
};
