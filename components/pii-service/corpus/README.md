# PII corpus — measuring precision and recall

**Owner:** David (corpus contents), Claude (harness).

## Why this exists

David, 2026-10-12: *"presidio also seems to identify a lot of false positives. We
need to review the configuration and how it is used for PII scanning. I have not
yet seen even one genuine PII concern related to GDPR."*

That is two findings, and the second is the more dangerous:

1. Precision is poor enough to be actively noisy.
2. Either genuine findings never reach the curator, or he has stopped believing
   any of them.

Finding 2 is the one that matters. A false-positive flood does not merely annoy —
it **desensitises**. A curator who has learned that every hit is noise stops
reading and starts clicking *Accept*, which inverts the control: the
acknowledgement becomes a rubber stamp and the gate stops meaning anything.

Without a corpus, none of this is measurable. Any config change can be defended by
anecdote. This harness makes every tuning decision falsifiable.

## Setup

```bash
cd components/pii-service
cp corpus/cases.example.json corpus/cases.local.json
# edit cases.local.json with real cases
python corpus/run_corpus.py
```

`cases.local.json` is **gitignored** — it holds real personal data and must never
be committed. The synthetic `cases.example.json` is committed so the format stays
documented.

The harness needs the **real** analyzer (it measures detection, not plumbing), so
the spaCy model must be installed. Locally that is the `.venv-linux/` in this
component; CI installs it.

## Case format

```json
{
  "id": "unique-name-for-the-report",
  "text": "the realistic text to scan",
  "expect":        [{ "entity": "EMAIL_ADDRESS", "value": "..." }],
  "must_not_flag": ["BD_NATIONAL_ID"],
  "note":          "free text, never parsed"
}
```

Two deliberate choices:

**Expectations are keyed on the value, not the offset.** Offsets move whenever the
text is edited, and offset drift is precisely the failure the region-split in
`pii-client.js` can introduce. An offset-keyed corpus would go red for an unrelated
reason. Keying on the value asserts what actually matters: the right entity was
identified over the right text.

**Negative cases are first class.** `expect: []` plus `must_not_flag: [...]` is how
the known-broad national-ID recognizers are pinned down. A corpus containing only
positives actively rewards detectors that find *less* — it would push us straight
into tuning away true positives. That trap is the reason this format exists.

## What to include

Roughly half the corpus should be text that must stay clean:

- **Genuine PII** — contact blocks, author bylines, quoted correspondence,
  structured identifiers (IBAN, national ID), personal references in prose.
- **Look-alikes that must stay clean** — numeric tables, measurements, catalogue
  references, dates, coordinates, institutional names, place names, organisation
  names. This is where a scanner earns or loses your trust.
- **Mixed documents** — real PII buried in otherwise-clean technical prose. The
  realistic case, and the one the region-split could break.

## Reading the report

```
entity                    TP    FP    FN  precision     recall
LS_NATIONAL_ID             0   184     0        0%        n/a
PERSON                    12     3     1       80%       92%
```

Precision is how much of what it said was real. Recall is how much of what was real
it found. **A change that raises precision by lowering recall is a trade, not a
fix** — the report exists so that trade is visible instead of implied.

A `FUZZY` line means the detector found the value inside a *larger* span. That is
sloppy rather than wrong, but it usually signals the recognizer is about to drift.

The report never prints personal data (NFR-P2) — case ids, entity types and counts
only. `--show-values` prints matched text for local debugging and says so loudly;
do not paste its output anywhere.

## A/B-ing a config change

```bash
python corpus/run_corpus.py                                  # baseline
python corpus/run_corpus.py --threshold 0.6                  # candidate
python corpus/run_corpus.py --entities EMAIL_ADDRESS,IBAN_CODE
OKF_PII_NATIONAL_ID_PATTERNS='{"BD_NATIONAL_ID":[{"name":"bd-nid","regex":"...","score":0.5}]}' \
  python corpus/run_corpus.py                                # candidate registry
```

`app.py` already reads `OKF_PII_NATIONAL_ID_PATTERNS`, so a recognizer change can be
evaluated without editing code. Run both, compare the two tables, and the decision
stops being a matter of taste.