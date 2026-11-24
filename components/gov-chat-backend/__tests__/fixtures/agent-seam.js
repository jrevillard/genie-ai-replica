'use strict';

// Shared agent-seam fixtures, ONE home for the two
// consumers' suites (agent-frame-writer.test.js — the streaming entry — and
// agent-json-result.test.js — the non-streaming JSON entry). The run-shaped
// stream script is NOT shared: the frame-writer suite pins the frame order
// around a tool call, the JSON suite pins plain aggregation — each keeps its
// own `answeredRunStream` built on these primitives.

const { Readable } = require('stream');

const USAGE_RECORD = {
  run_id: 'run-abc',
  outcome: 'answered',
  steps: 2,
  model_calls: 2,
  aux_model_calls: 1,
  tool_calls: 1,
  evidence_bytes: 1024,
  prompt_tokens: 90,
  completion_tokens: 30,
  wall_clock_seconds: 4.2,
  error: null
};

// The verdict projection payload, faithful to agent/verification.py
// Verdict.payload() — `insufficient_evidence` ALWAYS rides (a grounded run
// carries the not-required default).
const GROUNDED_VERDICT = {
  grounding_status: 'grounded',
  is_grounded: true,
  translation_mode: 'none',
  policy: 'verdict-marked',
  judge: { model: 'judge', score: null },
  citations: [
    { provenance: { file_id: 'doc_bee_knowledge' }, text: 'bees pollinate', score: 0.9 },
    {
      provenance: { source: 'okf-concept', concept_id: 'kenya_tax_rules', repo_id: 'r-kenya', bundle_version: 3 },
      text: 'taxes apply',
      score: 0.8
    }
  ],
  invalid_citations: [],
  insufficient_evidence: { required: false, reasons: [] },
  marking: { required: false, reason: null }
};

// The insufficiency verdict the verification pipeline emits on the
// early-return path: unverified / not grounded, the mechanical decision and
// its reasons riding verbatim.
const INSUFFICIENCY_VERDICT = {
  grounding_status: 'unverified',
  is_grounded: false,
  translation_mode: 'none',
  policy: 'verdict-marked',
  judge: { ran: false, outcome: 'skipped', verdict: null },
  citations: [],
  invalid_citations: [],
  insufficient_evidence: { required: true, reasons: ['degraded_availability', 'no_successful_retrieval'] },
  findings: [],
  source_documents: [],
  marking: { required: false, reason: null }
};

// verification.py INSUFFICIENCY_RESPONSE — the text the agent loop delivers
// when the ledger requires insufficiency (the BFF never substitutes text).
const INSUFFICIENCY_RESPONSE = 'I could not find supporting evidence in the knowledge base to answer this question.';

function legacyPosture() {
  return {
    available: true,
    mode: 'legacy',
    engaged: false,
    warnings: [],
    postureUnknown: false,
    authorizedGraphs: [],
    authz: null,
    stickyGraphs: [],
    legacyGraph: 'GRAPH',
    correlationId: 'cid-1'
  };
}

function envelope(kind, payload, { seq = 0, call_id = null } = {}) {
  return { run_id: 'run-abc', call_id, seq, kind, payload };
}

function seamStream(frames) {
  const mockStream = new Readable({ read() {} });
  for (const frame of frames) {
    mockStream.push(`data: ${JSON.stringify(frame)}\n\n`);
  }
  mockStream.push(null);
  return mockStream;
}

function dataStream(text) {
  const mockStream = new Readable({ read() {} });
  mockStream.push(text);
  mockStream.push(null);
  return mockStream;
}

module.exports = {
  USAGE_RECORD,
  GROUNDED_VERDICT,
  INSUFFICIENCY_VERDICT,
  INSUFFICIENCY_RESPONSE,
  legacyPosture,
  envelope,
  seamStream,
  dataStream
};
