# Derived Patient Documents

LLM-generated, human-review-pending patient-facing materials, derived from the
clinical and programme sources in `../IEEE/`. These exist to address the
audience-mismatch problem identified in the 2026-05-16 LLM-as-a-judge run:
clinician-targeted source chunks were producing answers that read like
discharge summaries rather than answers for lay patients.

Each NCD subdirectory contains four document types, all written in plain,
benefit-framed, second-person English suitable for patients with limited
medical background:

1. **`patient-faq.md`** — Common patient questions with direct, actionable
   answers. Source-grounded; cites the WHO/BHBM/Gambia documents these were
   derived from.
2. **`fictive-chat.md`** — Realistic dialogues between a patient and a health
   assistant, modelled on the scenarios in the BHBM message libraries. Useful
   both as retrieval examples and as templates for tone.
3. **`if-then-rules.md`** — Decision rules ("if your blood pressure is X,
   then …") that the chatbot can pattern-match against to give specific,
   non-generic guidance. Includes red-flag triage rules.
4. **`risk-questionnaire.md`** — Self-screening questions with scoring and
   plain-language interpretation. Modelled on the BHBM evaluation questions
   (Annex 5 of mHypertension; Annex 1 questionnaire of mTobaccoCessation,
   loosely Fagerström-style for nicotine dependence).

## Scope and limitations

- **v1 covers two NCDs**: hypertension and tobacco cessation. These are the
  minimum specified in the Phase 2 submission plan (M3) and are the two
  conditions with the richest patient-facing source material in `../IEEE/`.
  Diabetes, mental health, etc. require sourcing additional clinical
  documents first (see M2 in the submission plan).
- **Human review is mandatory before clinical use.** The submission promises
  "LLM-generated + human-checked" derived documents. These files are the
  LLM-generated half. A clinician must review them — particularly the
  if-then rules and risk questionnaires — before they are presented to
  patients in any production setting. Until then, treat them as retrieval
  context only.
- **Localisation pending.** The Gambian context is referenced where the
  source documents are Gambia-specific, but these are written in
  international English. Gambian English voicing and any region-specific
  recommendations (where to seek care, local naming for foods, etc.) need a
  local-language pass before deployment.

## Sources

- WHO *A handbook on how to implement mHypertension*, 2020 (ISBN
  978-92-4-000144-2). Table 5 content modules; Annex 3 message library;
  Annex 4 algorithm examples; Annex 5 evaluation questions.
- WHO *A handbook on how to implement mTobaccoCessation*. QuitNowTXT
  message library (Annex 2); Fagerström-style screening (Annex 1).
- WHO *HEARTS technical package* (cited throughout the BHBM handbooks).
- *The Gambia cessation clinical guidelines* (2016), for local context.
- *National Integrated Policy for NCD Prevention and Control 2012-2016*
  (Gambia), for national-programme context.

## Ingestion

These markdown files are intended to be uploaded through the standard
GENIE.AI dataprep pipeline alongside the originals. Suggested labels:
- `audience:patient`
- `derived:true`
- `ncd:hypertension` or `ncd:tobacco-cessation`
- `human_reviewed:false` until a clinician signs off

A `derived:true` filter at retrieval time lets the reranker prefer these
documents when the question appears patient-targeted.
