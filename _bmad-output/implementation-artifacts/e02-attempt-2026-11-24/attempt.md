# The E02 attempt — the gate's refusals, 2026-11-24 (story 4.5)

The E02 pair (B vs C) needs two GATED legs: config B (the fixed pipeline) and
config C (the agent) measured under the same corpus, the same assessment set
and the same signed thresholds. This directory is that attempt's record. It
holds **no measured leg** — the protocol refused both, before any query ran.

The attempt was run TWICE: before MR !1063 merged, and re-run AFTER it merged
(squash `9ca967274`) with this branch carrying the signed M-1 registry. Both
runs refuse, with the same reference manifest digest (`8dc67fa1804e`) — the
signature the merged registry carries does not change the gate's answer.

## What is here

| File | What it is |
|---|---|
| `assessment-set.json` | the reference's own assessment set, byte-identical (digest `58850161afeb…` — the digest the signed thresholds bind to) |
| `reference.manifest.json` | the measured config-A reference (issue #2118) — the gate finds its predecessor IN THIS DIRECTORY (`gate.py` scans the run dir), so its digest is the lineage the thresholds must reference |
| `config-b.gate-refusal.txt` | the gate's refusal of the config-B leg, verbatim (post-!1063) |
| `config-c.gate-refusal.txt` | the gate's refusal of the config-C leg, verbatim (post-!1063), with the #2145 hold recorded |
| `thresholds-promotion-refusal.txt` | the promotion decision over the MERGED registry, verbatim: the sign-off IS signed, M-1 carries the five signed bounds, and the decision is still BLOCKED on M-2..M-5 |
| `e02.refusal.txt` | the E02 join's refusal, verbatim (the B leg's manifest does not exist) |

The corpus fingerprint was **pinned** to the measured reference's
(`6c9f73719c04…`) — the operator's declaration, the same value the reference
manifest carries. No query, no venue access, no deployment: the refusal
happens in the gate, before the driver.

## Why the gate refuses — the state after !1063 merged

```
REFUSED: gated run refused (config B): reference manifest 8dc67fa1804e covers
corpus 6c9f73719c0451cdcbca19e86bc38476ade96be9945811133c5a23071377eb98, but
no signed thresholds file references it.
```

The FIRST predecessor is present (the reference manifest covers the corpus and
the set). The SECOND is missing: a **signed** thresholds artifact. Story 4.4's
registry produces that artifact only when every measured dimension (M-1..M-5)
carries an agreed value. The operator's 2026-11-23 signature (MR !1063,
merged as `9ca967274`) covers **M-1 only** — the registry's own sign-off is
SIGNED and M-1 carries the five agreed bounds, but M-2 (answer grounding),
M-3 (abstention correctness), M-4 (latency) and M-5 (resource consumption)
stay explicitly absent, so `promotion_decision` stays BLOCKED and
`derive_thresholds_artifact` REFUSES (see
`thresholds-promotion-refusal.txt` for the verbatim decision over the merged
registry). An absent dimension blocks promotion and is never defaulted —
that is the protocol's load-bearing order working (PRD §8), not a defect.

**Consequence: the gated B/C legs stay refused after !1063.** The unblocking
decision is the operator's: M-2..M-5 agreed against the measured reference.
Nothing in the harness needs to change.

## The second hold on the C leg — issue #2145

Even once the gate opens, the C verdict must not be composed before #2145 is
handled: 10 of the assessment set's answerable cases carry no gold annotation
(empty gold), so the agent's answers on them are not judgeable — a C verdict
composed today would score the set's unannotable cases as if they were. The
C leg's refusal record carries that hold.

## What unblocks it

1. The operator agrees M-2..M-5 (the gate's blocker).
2. #2145 lands (the gold annotations) — the C leg's blocker.
3. A new assessment set with the multi-hop / ambiguous classes (the gains the
   PRD §4.1 note describes are otherwise NOT COVERED — the set is frozen at
   the digest the signed thresholds bind to).
