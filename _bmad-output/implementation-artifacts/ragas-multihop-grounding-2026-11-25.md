# RAGAS multi-hop grounding — the 20-questions-that-kept-10 defect (2026-11-25)

Branch `fix/okf-ragas-multihop-attribution`, cut from `origin/main` @
`a2cca4ca8`. Live-reported by David on the local build: a context-bound
benchmark requested 20 questions and generated 10.

## Root cause (verified, not hypothesised)

Ragas's multi-hop synthesizers prefix EVERY reference context with a literal
hop marker — `"<1-hop>\n\n" + chunk.page_content`
(`ragas/testset/synthesizers/multi_hop/base.py`, `make_contexts`, vendored
in the sidecar image). The OKF-side attribution match keys on the first 120
normalised characters of a passage, so `<1-hop> …` matched NO chunk and
every multi-hop question was falsely discarded as "unattributable" —
although its content is verbatim corpus text. The default mix is
50% single_hop / 25% multi_hop_abstract / 25% multi_hop_specific → exactly
10 of 20 discarded (the suite doc's own `dimensions` named the mix; the
sidecar's accounting said `dropped: 0` — the discard was ours).

## David's rulings (AskUserQuestion, 2026-11-25)

1. **Strip the hop marker** at mint (keep the full mix; passages stored as
   clean chunk text).
2. **Re-ask the shortfall** like the head-suite generator — capped at
   THREE extra rounds, honestly tallied (an uncapped loop can spin forever
   on a corpus that genuinely cannot ground more).
3. **Notify the admin on the suite record + panel line** (evidence-grade;
   never only a log).

## What shipped

- `HOP_MARKER_RE` strips the marker at mint: the stored passages ARE the
  chunk text and the attribution keys on content.
- The generation runs in ROUNDS: one first pass, then up to
  `MAX_GROUNDING_ROUNDS` (3) re-asks sized to the shortfall, with the
  head-suite's uniqueness rule (a re-ask never mints the same question
  twice). Unbound generations are exactly one pass, unchanged.
- `dimensions.grounding` rides every suite:
  `{requested, kept, discarded_unattributed, discarded_duplicate, rounds}`.
- The panel renders the tally beside the entries ("18 of 20 questions
  grounded — 2 could not be tied to the evaluated corpus (re-asked 2
  round(s))"), silent when the request was fully met. i18n ×14.
- The generating envelope stays live until the LAST round lands (the
  genProgress delete moved after the loop — the live-judge test caught its
  misplacement).

## Proof

- RED→GREEN: multi-hop stamps to its chunk with clean passages; the
  shortfall is re-asked at exactly the shortfall size and fulfils the
  request; the cap stops at 4 submits and tallies honestly.
- okf-server 2603/2603 (the 3 melt subprocess failures on first run were
  the fresh worktree missing `components/shared/lib/node_modules` — an
  install, not the diff); frontend suite green with the new tally test.
- Coverage above the main baseline on all four metrics in both components.
- Live verification on the local build: regenerate the slaughterhouse
  benchmark at 20 → 20 kept (the marker fix), tally absent (fully met).
