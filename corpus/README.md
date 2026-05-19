# Corpus

Source documents and LLM-generated derived material used by the
GENIE.AI Gambia NCD prototype's RAG pipeline.

```
corpus/
├── sources/          # Original third-party documents (WHO, BHBM, MoH Gambia, …)
└── derived/          # LLM-generated derived patient documents (FAQs, fictive chats,
                      # if-then rules, risk questionnaires) — human review pending.
```

## `sources/`

External clinical and policy documents. **All rights belong to their
respective publishers**; they are bundled here under the same terms
they were originally released for non-commercial, public-health-
research re-use. The team did not author these documents.

| File | Publisher | Notes |
|---|---|---|
| `who-treatment-guidelines-tobacco-use.pdf` | World Health Organization | WHO clinical treatment guideline for tobacco cessation in adults |
| `who-treatment-guidelines-hypertension.pdf` | World Health Organization | WHO clinical treatment guideline for hypertension |
| `BHBM-mHypertension.pdf` | World Health Organization | *A handbook on how to implement mHypertension*. ISBN 978-92-4-000144-2. |
| `BHBM-mTabaccoCessation.pdf` | World Health Organization | *A handbook on how to implement mTobaccoCessation*. Includes the QuitNowTXT message library (Annex 2). |
| `The Gambia cessation clinical guidelines 2016.pdf` | Ministry of Health, The Gambia | National tobacco cessation clinical guidelines |
| `National-Integrated-Policy-for-Non-Communicable-Diseases-Prevention-Control-2012-2016.pdf` | Government of The Gambia (MoH) | National NCD prevention and control policy |
| `Hypertension Package for Community Health Workers- Gambia (1).pptx` | Source TBD | Training material for community health workers |
| `mHypertension_MessageLibrary.xlsx` | World Health Organization (BHBM) | Companion message library to mHypertension handbook |
| `mTobaccoCessation_MessageLibrary.xlsx` | World Health Organization (BHBM) | Companion message library to mTobaccoCessation handbook |

Of the PDFs in this directory, six have been ingested end-to-end
through the production dataprep pipeline (see
[`docs/phase2-prototype.md`](../docs/phase2-prototype.md) §3.1).
The `.pptx` and `.xlsx` files are present for future ingestion and
are not yet indexed.

### Region-mismatch note

`BHBM-mTabaccoCessation.pdf` embeds the QuitNowTXT message library
in Annex 2. Those messages reference US-specific resources
(`1-877-448-7848`, `smokefree.gov`, `cancer.gov`) which are wrong for
a Gambia deployment. The LLM-as-a-judge run on 2026-05-19 surfaced
this as a regression on the `tobacco-quit-basic` test case (the
chatbot faithfully echoed US helplines for a Gambian patient).
Re-chunking with Annex 2 skipped, or generation-time region-token
filtering, is on the next-iteration list — see
[`docs/phase2-submission-plan.md`](../docs/phase2-submission-plan.md).

## `derived/`

LLM-generated patient-facing material derived from the documents in
`sources/`, addressing the audience-mismatch problem found in
earlier LLM-as-a-judge runs (clinician-targeted source chunks
producing answers that read like discharge summaries). Eight
documents in total, covering two NCDs × four document types:

```
derived/
├── README.md                         # Scope, sources, ingestion guidance
├── hypertension/
│   ├── patient-faq.md
│   ├── fictive-chat.md
│   ├── if-then-rules.md
│   ├── risk-questionnaire.md
│   └── pdf/                          # pandoc → pypdf MediaBox-pushed PDFs
└── tobacco-cessation/
    ├── patient-faq.md
    ├── fictive-chat.md
    ├── if-then-rules.md
    ├── risk-questionnaire.md
    └── pdf/
```

The Markdown originals are the canonical authoring format; the PDFs
in `pdf/` are rendered for ingestion through the existing dataprep
pipeline (which expects PDF). See `derived/README.md` for source
attribution, scope, and labels.

**Human review pending.** Every chunk in `derived/` carries the
label `human_reviewed:false`. A clinician must review at least the
if-then-rules and risk-questionnaire scoring before any of this
material is presented to real patients in production.

### PDF rebuild gotcha

Three of the eight PDFs (`hypertension/if-then-rules.pdf`,
`tobacco-cessation/if-then-rules.pdf`,
`tobacco-cessation/risk-questionnaire.pdf`) initially failed Docling
parsing with "could not find the page-dimensions". The cause: pandoc
+ xelatex puts `/MediaBox` only on the parent `/Pages` node and
relies on inheritance; Docling's parser doesn't walk the chain. The
fix is a small `pypdf` post-pass that copies the inherited MediaBox
onto each leaf `/Page`:

```python
from pypdf import PdfReader, PdfWriter
reader = PdfReader(src)
writer = PdfWriter()
for page in reader.pages:
    page.mediabox = page.mediabox  # resolves inheritance, writes back directly
    writer.add_page(page)
with open(dst, "wb") as f:
    writer.write(f)
```

The PDFs in `derived/*/pdf/` have all been run through this step.

## Re-ingesting from this corpus

```bash
# Authenticated (Keycloak admin token in $TOKEN):
curl -X POST https://<host>/api/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@corpus/sources/who-treatment-guidelines-hypertension.pdf"
# Then either trigger /api/files/<file_id>/ingest, or rely on the upload
# flow to chain into dataprep automatically.
```

See `tests/llm-judge/README.md` for the full end-to-end ingestion
verification workflow.
