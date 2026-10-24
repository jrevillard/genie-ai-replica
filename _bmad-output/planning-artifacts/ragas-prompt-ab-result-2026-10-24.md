# Prompt A/B — result and verdict (2026-10-24)

**Baseline:** `rr1792807688575-1e1b0c` (old prompt, MiniMax judge) →
**Candidate:** `rr1792843333604-268dad` (new grounding prompt, MiniMax judge).
Same suite (100 entries), same judge pick, same corpus, serve mode.

## 1. The A/B is clean — and that alone is worth stating

`context_precision` and `context_recall` are **bit-identical** between the two
runs (0.9189 / 0.8282 both times). Retrieval was untouched; the only thing that
moved is the answer leg. This is a genuine one-variable experiment.

## 2. What moved

| Metric | Baseline | Candidate | Δ | Verdict |
|---|---:|---:|---:|---|
| faithfulness | 0.8149 | **0.8668** | **+0.052** | ✅ real win |
| noise_sensitivity ↓ | 0.2426 | **0.2055** | −0.037 | ⚠ partly a population artifact (see §5) |
| answer_similarity | 0.9032 | 0.9069 | +0.004 | ~ |
| factual_correctness | 0.6002 | 0.6039 | +0.004 | ~ flat |
| context_entities_recall | 0.4207 | 0.4197 | −0.001 | judge artifact, unchanged |
| context_utilization | 0.9397 | 0.9274 | −0.012 | ~ |
| answer_correctness | 0.7123 | **0.6950** | **−0.017** | ❌ |
| answer_relevancy | 0.8566 | **0.8127** | **−0.044** | ❌ |
| **abstentions** | **4** | **10** | **+6** | ❌ |
| **answer length (avg)** | **1273 ch** | **717 ch** | **−44%** | ⚠ the mechanism |
| null-metric rows | 10 | 2 | −8 | side effect (see §5) |

Row-level: **41 rows improved, 37 regressed** on the answer-side metrics.

## 3. The mechanism — the prompt bought precision and paid in recall

The answers got **44% shorter** (avg 1273 → 717 chars). That single change
explains the whole scoreboard:

- Fewer claims → fewer unsupported claims → **faithfulness +0.052**.
- Less coverage of the reference → **answer_relevancy −0.044**,
  **answer_correctness −0.017**. RAGAS's answer_relevancy generates follow-up
  questions from the answer; a terser answer generates fewer and scores lower.
- The strict "if not in the context, say it is not available" rule turned 6
  previously-answered rows into abstentions (new-43, new-53, new-55, new-68,
  new-72, new-90) — **abstention count went 4 → 10**.

**And the terseness induced fabrication** — the most damaging finding:
- `new-29` (corn earworm): faithfulness **1.00 → 0.09**. The baseline answer
  hedged with the context's own sequence; the terse candidate asserts
  "**Migration into Pods**" as a damage mechanism — corn earworm larvae do not
  do that. It filled the space left by the removed hedging with plausible
  general knowledge, i.e. exactly the failure the prompt was meant to stop.
- `new-86` (bean pest): "**The life cycle of this pest is 20 days**" — a number
  the context may not contain; faithfulness 1.00 → 0.83, factual 0.65 → 0.19.

**Compression pressure did not produce terse-and-safe answers; it produced
terse-and-confident.** "Start with the answer itself. Do not add general
framing" reads to the model as *be brief*, and brief + grounded + confident =
specific claims, sourced from the model's priors rather than the chunk.

## 4. What the advisor got wrong

The advisor's per-row advice on this run says, for ~30 rows, "tighten
CHATQNA_SYSTEM_PROMPT grounding". That is the **opposite** of the correct move:
the grounding is already too tight (10 abstentions, 44% shorter answers, and
faithfulness collapses caused by the very pressure the advisor wants more of).
The advisor's stage→recommendation map is a fixed heuristic; it cannot see the
abstention count, the length distribution, or the fabrication pattern. Its
retrieval advice is sound and is the real remaining wall (§6); its prompt
advice is actively misleading this time.

Two advisor attributions DID stay stable and are trustworthy:
- **judge (28 rows, all `context_entities_recall`)** — unchanged between runs
  (0.4207 → 0.4197). Confirmed judge-side, not corpus.
- **the ~12 vector-recall rows** (new-38, new-52, new-53, new-55, new-56, new-60,
  new-72 …) — the passage is in the corpus but never made it into the served
  contexts (ranks #65, #68, #354, #1, #2 of 1000 in the replay index).

## 5. Two numbers that must not be compared naively

- **noise_sensitivity −0.037** is *partly* a population artifact: the baseline
  had 10 rows with a null on it (9 of them `noise_sensitivity` timeouts), the
  candidate only 2 — because shorter answers make shorter judge prompts that
  stop hitting the 600s ceiling. The means are computed over 90 vs 98 rows.
  Honest statement: *the nulls nearly disappeared* (real improvement in
  run-ability), *the mean moved* (partly population, partly real).
- **100/100 answers changed** — vLLM is near-greedy but not deterministic, so
  some churn is expected even with an identical prompt. The 41/37 split is the
  signal; individual ±0.05 deltas are not.

## 6. Where the remaining points actually are

1. **Retrieval — the biggest remaining lever (~15-20 rows).** The candidate pool
   in the *served* deployment is too small: passages at rank #354 and #68 of
   1000 never reach the model. The benchmark-only knobs (`OKF_RAGAS_CANDIDATE_K`,
   `OKF_RAGAS_TOP_N`) already sit at 192/16 locally; the **served** deployment
   still uses the small default. Porting the sized values to the chatqna
   deployment is a config change with a measurable payoff.
2. **Prompt refinement — keep the grounding, restore the coverage.** Remove the
   brevity pressure; add an explicit coverage requirement. (§7)
3. **Judge — 28 rows stuck on entity extraction.** Needs a different judge to
   settle; MiniMax-M3 (non-flash, same key, plan-included) is the cheap test.
4. **Suite hygiene — 5 rows flagged `unfair question`** (new-17, new-29, new-78,
   new-95, new-96): their reference passages are not in the corpus, so they can
   only ever fail. Regenerate them; they are ~5% dead weight in every score.

## 7. The refined prompt (proposed — one variable changed again)

Keep: verbatim numbers, the not-available rule, the multi-part rule, the
figure clause, terminology fidelity, and the honesty about unsupported parts.
Change: **remove the brevity/compression pressure, add a coverage requirement.**

```text
You are a friendly and polite information assistant.

Answer the user's latest question using only the content provided from the knowledge base.

**Grounding rules:**
- Copy numbers, dates, quantities, rates, dosages, variety names and other named entities VERBATIM from the provided content. Never round, convert or substitute a value from your own knowledge.
- If the asked value or fact is not in the provided content, say plainly that the information is not available in the knowledge base. Do not estimate.
- Answer EVERY part of the question the content supports. For a multi-part question, answer the parts you can and state which parts the content does not cover — do not refuse the whole question because one part is missing.
- Include every relevant fact from the provided content that bears on the question. Do not leave out supporting details that the context provides.
- When the question refers to a figure or table, report only what the content text explicitly says about it. Never describe or infer visual details that are not written.
- Use the documents' own terminology (including non-English terms — e.g. Spanish pest, disease and variety names, or foreign agency and program names) as written; when answering in another language, keep the original term in parentheses.
- Never state a specific mechanism, quantity, name or sequence unless the provided content states it. If you would have to guess, omit it.

Use the user's name, gender, age, preferences, and chat history to tailor and personalise your responses. Keep answers informative but concise — concise means no repetition, not fewer facts.
```

Changes vs the tested version, and why:
- **"Do not add general framing, background knowledge or caveats beyond the
  provided content. Start with the answer itself."** → replaced by "Do not leave
  out supporting details" + "concise means no repetition, not fewer facts".
  The old wording was read as *be brief*; this reads as *no filler*.
- **Added the explicit no-guessing rule** — targets new-29/new-86's fabricated
  specifics directly ("Migration into Pods", "20 days").
- **Kept the multi-part rule** — it worked: new-98's factual_correctness
  0.12 → 0.40.

## 8. Iteration speed — the 3-hour problem

10 metrics × 100 questions = **4,133 judge calls ≈ 3–5 hours**. That is too slow
to iterate on prompts. Proposal for the next A/B:
- **Score 4 metrics** (faithfulness, factual_correctness, answer_relevancy,
  answer_correctness) → ~1,650 calls ≈ **1–1.5 hours**, and those four are the
  ones the prompt moves.
- Keep the 10-metric suite for milestone runs (and for the record).
- Or A/B on a 30-row subset of the same suite (same questions, fewer rows) —
  a third of the time, still comparable row-by-row.
