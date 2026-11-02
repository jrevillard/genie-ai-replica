# RAG Evaluation Report — knee_threshold + concision prompt

**Run date:** 2026-10-23 · **Config:** `reranker.strategy = knee_threshold` (now the
production cell, Adem's pick) + the new concision systemPrompt + new abstention text
(applied by Adem via Pipeline Settings; revert snapshot in
[prompt-concision-2026-10-23.md](prompt-concision-2026-10-23.md) + box backup
`llm-settings.json.pre-concision-bak`). Same 42-question gold, granite judge, bge-m3.
**Comparison baseline:** the knee run of 10-22 (same retrieval config, old prompt).
**Raw artifacts:** `logs/eval-2026-10-23/`.

---

## 1. Before / after (same retrieval, only the prompt changed)

| Metric | knee (old prompt) | **knee + concision** | Change | Reading |
|---|---|---|---|---|
| **avg answer length** | 1,762 chars | **571 chars** | **−68%** | the headline: 3× shorter answers |
| **faithfulness** | 0.911 | **0.932** | +0.02 | shorter = every claim grounded; best score of any config tested |
| context_precision | 0.961 | 0.959 | −0.002 | unchanged (retrieval untouched — expected) |
| context_recall | 0.892 | 0.879 | −0.013 | unchanged within noise |
| answer_relevancy | 0.496 | 0.490 | −0.006 | **did not move — see §3** |

## 2. What happened (plain words)

The prompt change did exactly what it was designed to do: answers now lead with the
action, carry exact figures, and stop. Average length fell from ~1,760 to ~570
characters while faithfulness — the "is every claim backed by the evidence" score —
ROSE to 0.932, the highest of every configuration measured across this epic. The
old prompt's mandatory closing question and "friendly" padding are gone, and the
model didn't compensate by drifting from the sources; it simply says less, all of it
grounded. Live spot-check before the run: "How deep should I plant maize seeds?" →
one sentence, both depth figures, nothing else.

The extension-officer referral also now lives in the main prompt, so questions the
knowledge base only partially covers get a one-line referral instead of a half-answer
(the abstention path only fires when retrieval is completely empty — that gap was
the reason for the move).

## 3. The honest surprise: answer_relevancy is insensitive (≈0.49–0.53 everywhere)

| Config | answer_relevancy |
|---|---|
| slice topN=1 | 0.527 |
| slice topN=2 | 0.516 |
| knee | 0.496 |
| knee + 3× shorter answers | 0.490 |

A 68% length cut moved it by less than noise. Across four configs it has never
left the 0.49–0.53 band. Conclusion: **this metric, with this judge+embedder pair,
is not measuring answer concision or quality in a way we can optimize** — it embeds
question↔answer similarity in a way that saturates for advisory-style answers
(RAGAS generates candidate questions from the answer and compares embeddings; short
advisory answers give it little to work with). Recommendation: stop treating
answer_relevancy as a target; the human eyeball test against your benchmark
responses (the comparison workbook) and faithfulness are the real instruments.

## 4. Production state after this run

- **Live cell: knee_threshold + concision prompt** (both applied by Adem; this is
  the best-measured configuration of the epic: recall .890 / passage .881 /
  faithfulness .932 / answers 3× shorter)
- Revert paths: strategy → `rag-tuning.json` (slice/topN=1 cell recorded in the
  knee report); prompt → box backup + the snapshot doc
- Not yet re-tested: none pending on this lever. Next levers remain N.8 re-chunking
  (structural) and the adaptive-tuned cell (optional, likely superseded by knee).

## 5. Reproduce

Identical to the knee run (§5 of [knee-run-2026-10-22.md](knee-run-2026-10-22.md));
only llm-settings.json differs. Tuples + RAGAS report preserved under
`logs/eval-2026-10-23/`.
