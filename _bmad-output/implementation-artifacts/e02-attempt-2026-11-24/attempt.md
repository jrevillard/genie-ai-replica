# The E02 attempt — the gate's refusals, 2026-11-24 (story 4.5)

The E02 pair (B vs C) needs two GATED legs: config B (the fixed pipeline) and
config C (the agent) measured under the same corpus, the same assessment set
and the same signed thresholds. This directory is that attempt's record. It
holds **no measured leg** — the protocol refused both, before any query ran.

## What is here

| File | What it is |
|---|---|
| `assessment-set.json` | the reference's own assessment set, byte-identical (digest `58850161afeb…` — the digest the signed thresholds bind to) |
| `reference.manifest.json` | the measured config-A reference (issue #2118) — the gate finds its predecessor IN THIS DIRECTORY (`gate.py` scans the run dir), so its digest is the lineage the thresholds must reference |
| `config-b.gate-refusal.txt` | the gate's refusal of the config-B leg, verbatim |
| `config-c.gate-refusal.txt` | the gate's refusal of the config-C leg, verbatim |
| `e02.refusal.txt` | the E02 join's refusal, verbatim (the B leg's manifest does not exist) |

The corpus fingerprint was **pinned** to the measured reference's
(`6c9f73719c04…`) — the operator's declaration, the same value the reference
manifest carries. No query, no venue access, no deployment: the refusal
happens in the gate, before the driver.

## Why the gate refuses

```
REFUSED: gated run refused (config B): reference manifest 8dc67fa1804e covers
corpus 6c9f73719c0451cdcbca19e86bc38476ade96be9945811133c5a23071377eb98, but
no signed thresholds file references it.
```

The FIRST predecessor is present (the reference manifest covers the corpus and
the set). The SECOND is missing: a **signed** thresholds artifact. Story 4.4's
registry produces that artifact only when every measured dimension (M-1..M-5)
carries an agreed value; the operator's 2026-11-23 signature (MR !1063) covers
**M-1 only**, so M-2 (answer grounding), M-3 (abstention correctness), M-4
(latency) and M-5 (resource consumption) stay explicitly absent and the
promotion decision stays BLOCKED — an absent dimension blocks promotion and is
never defaulted.

This is the protocol's load-bearing order working, not a defect (PRD §8). The
same refusal closed the E01 config-B leg on 2026-11-23 — the reference
manifest digest in both refusals is the same (`8dc67fa1804e`), which is the
evidence that the chain did not drift.

## What unblocks it

An operator decision: the M-2..M-5 thresholds, agreed against the measured
reference. Nothing in the harness needs to change — `run_protocol.py
thresholds` then derives the signed artifact and both legs run.

The E02 report also has a second, separate absence that the gate does not
cause: the assessment set carries no multi-hop or ambiguous case, so the
agentic gains the PRD §4.1 note describes stay a HYPOTHESIS. The set is frozen
at the digest the signed thresholds bind to, so it cannot be extended without
invalidating the signature — that is a separate, operator-owned decision (see
`docs/baselines/s4-exit-checklist.md`, check 2).
