# Evaluator Instructions — the protocol's judged dimensions

Versioned by content: every run manifest records this file's sha256. Any
edit re-versions the instructions and every run that consumed the previous
version carries the old digest — a verdict set is only comparable to another
set produced under the same instructions digest.

The instructions govern the JUDGED dimensions — the human/LLM-judge verdict
layer that reads the per-case rows the drivers produced. The mechanical
retrieval metrics (recall/precision/ndcg — the anchor's scoring) are NOT
judged by these instructions; they are computed, and computed numbers need
no judge.

## Dimensions

1. **Answer correctness** — the answer addresses the question, and for
   `answerable` cases its content agrees with the case's `reference_answer`
   and the retrieved evidence. Partial coverage of the reference answer is a
   partial verdict, recorded as such — never rounded to a pass.
2. **Answer grounding** — the answer's claims trace to the retrieved
   sources (the row's `source_documents` / the answer's citations). A claim
   that no recorded source supports is ungrounded; ungrounded content fails
   the dimension regardless of factual luck.
3. **Abstention correctness** — the abstention verdict rules below. The
   `abstained` flag and `abstention_reason` from the row are the input;
   neither is re-derived.
4. **Citation validity** — the citation verdict rules below.
5. **Language adherence** — the answer's language matches the case's
   `language` unless the row records a translation status that explains the
   delivered language. A silent wrong-language answer fails the dimension.

## Abstention verdict rules

- An `unanswerable` case that abstains (`abstained: true` with a recorded
  `abstention_reason`) is CORRECT — the honest terminal state. An
  unanswerable case that answers confidently is a finding, whatever the
  answer's fluency.
- An `answerable` case that abstains is an excessive abstention — a finding
  (CM-2's input), unless the row records a typed insufficiency
  (`abstention_reason`) that the case's `expectations` accept.
- An abstention verdict never reads the answer text for hints: the row's
  flag and reason decide. A row that answers AND abstains (`abstained: true`
  with non-empty answer content) is a defect — record it, do not average it.

## Citation verdict rules

- A citation is valid iff it resolves to an entry of the row's recorded
  `source_documents` (the mechanical reference-validity check the serving
  path runs; the judge re-checks it against the row, never against memory).
- A `citation_check` case with `expectations.require_citation: true` fails
  when the answer carries no citation, when every citation is invalid, or
  when the cited sources do not support the answer's load-bearing claims.
- An `unanswerable` case must carry NO citations — a citation on an
  abstention or an unanswerable answer is a finding.
- A restricted-access case whose citations reference sources outside the
  case's authorized set is a finding regardless of the answer's quality
  (the authorization scenario failed).

## Failure and cancellation cases

- A `failure` case's verdict is the recorded outcome itself: the typed error
  the seam returned (429 admission refusal, 503 configuration error) IS the
  expected behavior — the case passes when the outcome is honest and typed,
  and fails when a refusal is masked as an answer or as an untyped crash.
- A `cancellation` case passes iff the outcome is `cancelled` with NO answer
  text. Any answer content on a cancelled row is a fabricated terminal state
  — automatic fail.

## Honesty rules for the judge

- Record the verdict per case with the reason; a negative result is
  recorded, not massaged (the epic's verdict-honesty rule).
- A verdict set is valid only under the instructions digest the run manifest
  recorded; comparing verdicts across different instruction digests is
  invalid — name the digests and refuse the comparison.
