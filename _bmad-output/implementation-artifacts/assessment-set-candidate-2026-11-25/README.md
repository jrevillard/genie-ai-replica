# The CANDIDATE multi-hop/ambiguous assessment set (#2146, 2026-11-25)

**Status: CANDIDATE — a proposal artifact, never signed.** The digest below
moves with any edit until the operator agrees; the re-signature on the
agreed set's own digest is the operator's later step (issue #2146 blocker
3's unblocking path: "a new assessment set with the classes, agreed and
signed against, plus the thresholds re-signed on its digest").

- `assessment-set.json` — 71 cases: the signed FINAL A reference set's 67
  cases byte-identical + 4 new-class cases (2 `multi_hop`, 2 `ambiguous`).
  The signed set's `match_run` block is deliberately NOT carried: it is the
  Phase-2 record of the SIGNED set's campaign (57 previews, 2026-11-24) and
  never measured this candidate — the candidate's own match record is
  produced by the ingestion campaign that follows the operator's agreement.
  Digest at authoring time:
  `9d1bfa240d16f14749980089382abb56896ff5ac87c87274d02d0ed3fd9d5bdb`.
- `build-candidate-2146.py` — the derivation script (the only writer; the
  signed source file is only ever read).

## What the additions are

The PRD §4.1 note positions the agentic benefit on multi-hop and ambiguous
queries; the protocol's composition vocabulary carries neither class before
this extension. The four cases use the committed security-corpus fixtures
(`tests/rag-benchmarks/fixtures/security-corpus/`) — public access, the
legacy graph the config-A reference serves:

| id | class | the join / the ambiguity |
|---|---|---|
| `e01-mh-desk` | multi_hop | servicerequest follow-up desk + catalogue registration desks (two documents) |
| `e01-mh-permit` | multi_hop | servicerequest SR-2026-0871 reviewing office + catalogue commercial-filings desk (two documents) |
| `e01-amb-permit-time` | ambiguous | "how long does a permit take" spans the dredging (30 days) and building (60 days) interpretations |
| `e01-amb-request-status` | ambiguous | "what is the status of the service request" spans the three request rows |

The gold carries the Phase-1 shape (`preview` + `source_doc`, no identity):
the previews are verbatim committed-fixture text (enforced mechanically by
`tests/rag-benchmarks/test_assessment_candidate_set.py`, the #2145 rule),
and the content hashes are venue-resolved by the Phase-2 match pass during
the ingestion campaign — the same protocol the graded `e01g-*` cases used.

## The floor

`_meta.minimums` carries `{"multi_hop": 2, "ambiguous": 2}` — the
candidate REQUIRES the classes it exists to carry. The vocabulary's default
floor carries them at 0 (a required floor would retroactively refuse the
signed reference set at every driver's re-validation); only sets that opt
in, like this one, demand presence.

## What agreement changes

On agreement, this set becomes the assessment set of a new reference
campaign: ingest the corpus, run the Phase-2 match (resolving the four
new cases' content hashes), re-measure, and the operator re-signs the
thresholds onto THIS set's digest. Until then nothing consumes it — the
signed chain (thresholds ↔ digest `cb371f1a…`) stays exactly as it is.
