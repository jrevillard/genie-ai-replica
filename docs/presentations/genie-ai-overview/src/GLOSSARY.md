# Glossary — GENIE.AI walkthrough

Every language of the deck uses these terms. A translator reads this file
before translating, so the six versions say the same thing the same way.

## Product and organisation names — never translated, never localised

`GENIE.AI`, `OPEA`, `ITU`, `ArangoDB`, `Keycloak`, `Docling`, `Vue`,
`Flutter`, `Node.js`, `Express`, `Helm`, `Kong`, `NGINX`, `Envoy Gateway`,
`Docker`, `Docker Compose`, `Docker Swarm`, `Kubernetes`, `OpenTelemetry`,
`Grafana`, `VictoriaMetrics`, `VictoriaLogs`, `VictoriaTraces`, `vLLM`, `TEI`,
`Hugging Face`, `ClamAV`, `Apache 2.0`, `BM25`, `RAG`, `PDF`, `DOCX`,
`XLSX`, `CSV`, `MD`, `HTML`, `TXT`, `JSON`, `API`, `GPU`, `CPU`, `CUDA`,
`ROCm`, `NVIDIA`, `AMD`, `Flutter`, `ClamAV`.

Product names keep their Latin spelling in every language, including the
right-to-left ones. They are never given an Arabic or Chinese translation.

## Terms to translate

| English | What it means |
|---|---|
| walkthrough | the presentation itself — "parcours", "recorrido", "обзор", "جولة", "演示" |
| public sector | the state, government agencies, NGOs serving citizens |
| public service | an administrative service offered to citizens (permit renewal…) |
| frontline staff / frontline officer | civil servants who receive the public |
| citizen | a member of the public using the service |
| the institution | the administration that owns the knowledge and the rules |
| source document | a document the answer is grounded in |
| grounding / grounded response | the answer cites the passage it rests on |
| retrieval | finding candidate passages |
| reranking | re-ordering the candidates before generation |
| chunk | a piece of a document the pipeline indexes |
| ingestion | turning a document into searchable knowledge |
| abstention | the assistant refusing to answer without usable evidence |
| pipeline | the sequence of stages a query goes through |
| deployment | an installed instance, on Compose, Swarm or Kubernetes |
| overlay | the per-cluster configuration layer of the Helm chart |
| scope | a permission attached to a user or a repository |
| restricted repository | a knowledge base only some users may read |

## Style

- **Short.** The English is written for a slide: one clause per line where
  possible. A translation that needs two lines is too long.
- **Plain.** A civil servant with no AI background is the reader.
- **Formal "you"** in French, Spanish, Russian and Chinese; the imperative
  voice of the speaker notes is kept in every language.
- **The fictional example stays fictional.** "Permit Renewal Guide", the
  permit, El Salvador and The Gambia are illustrative, not real policy. The
  translation must not imply they are real.
- **The speaker notes are instructions to the presenter**, not slides. They
  stay in the imperative ("Ask the audience…"), and they keep the same
  length roughly — they are read from a separate window.
- **Numbers, times and chapter markers stay as they are.** `00:00–05:00`,
  `43 slides`, `§2` are not translated.
- **Punctuation.** Use the punctuation of the target language (a Chinese
  full stop is `。`, an Arabic comma is `،`), except inside code, URLs and
  product names.

## Language notes

### Arabic (`ar`)

- Right-to-left. The deck sets `dir="rtl"` on the document; the layout
  mirrors itself. Latin product names inside an Arabic sentence must stay
  readable — the deck isolates them with `<bdi>`-style markup, so simply
  writing `ArangoDB` inside Arabic text is fine.
- Use Arabic comma `،` and Arabic question mark `؟` where the sentence
  calls for them.
- Do not use the Arabic-Indic digits `٠١٢٣` — keep `0 1 2 3`, so that
  figures match the rest of the deck and the source links.

### Chinese (`zh`)

- No spaces between words, no space before full stops.
- Keep Latin terms (`GENIE.AI`, `ArangoDB`, `RAG`) in Latin script — they
  are the names used in the product.
- Chinese is much more compact than English. Do **not** pad the translation
  to match the English length; a slide with too little text is fine, a
  slide with too much is not.

### Russian (`ru`)

- Use the official English product names, transliterated only when a
  Russian-language phrase demands it (`Keycloak` stays `Keycloak`).
- Keep the `·` separator between related items.

### Spanish (`es`) and French (`fr`)

- Keep `fr` informal-neutral: "vous" in the slides, the speaker notes in
  the same register.
- In French, do not leave a space before `:` `;` `?` `!`, but do keep one
  before `»`.
