# Local RAG corpus

This directory is the corpus the **mobile** LocalRAG CLI indexes before
running the test cases.

## Format

One file per indexed document. Supported extensions:

- `.txt` — plain text
- `.md` — Markdown (treated as plain text)

The filename (with `.pdf` appended if missing) is used as the document
**title** the chatbot must cite. The test cases under `test_cases/`
reference titles like `who-treatment-guidelines-tobacco-use.pdf` — keep
the corpus filenames aligned with what the cases expect.

## What to put here

The canonical corpus for the tobacco-cessation test cases is the
**WHO clinical treatment guideline for tobacco cessation in adults
(2024)**. It is licensed CC BY-NC-SA 3.0 IGO so the text can be
redistributed, but the PDF is large (~5 MB) and binary, so the repo
keeps it out of git and asks you to drop it in locally.

### Quick setup with the WHO PDF

If you already have the PDF (mobile QA flows typically have a copy
under the simulator's offline library):

```bash
# Install poppler-utils for `pdftotext` (macOS)
brew install poppler

# Convert and rename to match the expected document title.
pdftotext -layout /path/to/WHO_tobacco_cessation_guideline_2024.pdf \
  tests/llm-judge/corpus/who-treatment-guidelines-tobacco-use.txt
```

The Swift CLI will rename `.txt` → `.pdf` for the citation title at
index time, so the indexed title becomes
`who-treatment-guidelines-tobacco-use.pdf` — exactly what the test
cases check for.

### Adding more documents

Drop additional `.txt` / `.md` files in this directory and reference
their titles in test cases under `tests/llm-judge/test_cases/`.

## What NOT to put here

- The Gemma GGUF model — that lives wherever you downloaded it; pass
  the path with `--local-model`.
- PII or unredacted patient transcripts — this directory is part of
  the repo's test fixtures.
