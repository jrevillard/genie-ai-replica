# Deck-specific assets

Illustrations extracted from the GENIE.AI policy briefing PPTX
(`Téléchargements/GENIE_AI_pres_briefing_policy.pptx`) for the Kenya
Discovery Workshop deck. **Not** part of the shared Marp theme
(`themes/`) — these are content-specific to this workshop and may be
swapped or removed when the deck is repurposed.

| File | Source PPTX asset | Used on slide |
|------|-------------------|---------------|
| `genie-logo-mark.png` | `ppt/media/image8.png` (magic-lamp mark) | Slide 3 · "What is GENIE.AI" (pre-session shared definition) |
| `genie-itud-priorities.png` | `ppt/media/image3.png` (ITU-D priorities + AFR Flagship) | Slide 5 · "Aligned with ITU-D Resolutions" |
| `genie-how-it-works.png` | `ppt/media/image1.png` (4-step workflow) | Slide 9 · "Deploy, Configure, Tune, Pilot" |
| `genie-architecture-icons.png` | `ppt/media/image32.png` (3×3 GENIE.AI icon grid) | Slide 10 · "Six Building Blocks" |
| `genie-brand-pillars.png` | `ppt/media/image7.png` (5-pillar ribbon) | Slide 14 · "The Five Brand Pillars" |
| `genie-country-deployments.png` | `ppt/media/image15.png` (6-country deployment grid) | Slide 20 · "GENIE.AI in the Field" |

All six are inlined as `data:image/png;base64,...` URIs in the deck
markdown rather than referenced by relative path. marp-core v5's XSS
sanitizer strips local-file `src` values from `<img>` and markdown
image syntax even with `--allow-local-files`; data URIs are the only
form it accepts. The deck is therefore fully self-contained.

## Deck structure

21 slides covering Part 1 of the Discovery Workshop (4 × 15 min sessions).

- **Slides 1-3**: pre-session (title, agenda, "What is GENIE.AI")
- **Session 1** (slides 4-7): Why Sovereign AI & Architecture — divider → ITU-D alignment → system architecture with OIDC + OTel rails → sovereignty guarantees
- **Session 2** (slides 8-12): How GENIE.AI Works — divider → 4-step workflow → building blocks → ingestion pipeline → hybrid vector-graph retrieval
- **Session 3** (slides 13-17): Trust, Identity & Observability — divider → 5-pillar ribbon → Keycloak identity Mermaid → zero-hallucination decision tree → W3C trace context + OTel
- **Session 4** (slides 18-21): Deployments & Country Use Cases — divider → docker-compose profiles → 6-country grid → use case matrix + Q&A

Six Mermaid diagrams total: 1 in S1 (architecture), 2 in S2 (ingestion + retrieval),
3 in S3 (identity + grounding + trace). Mermaid is contained per session —
no mid-session jumps to diagrams from a different topic.

The deck was rebuilt from a 3-agent panel debate. Key wins vs the prior
version:
- **OIDC/Keycloak** now has its own slide (was buried in a bullet) +
  appears on the S1 system architecture as an Identity rail.
- **OTel + W3C trace** appears on every slide that touches an Mermaid
  (S1 system + S3 trace) and is named on a dedicated slide with the
  Victoria stack.
- **Internal RAG architecture** is now clear: ingestion pipeline
  (ClamAV → Docling → late label → TEI → ArangoDB) and retrieval
  (vector top-k → graph expansion → rerank → LLM).
- **Session 3 pillars** are no longer interleaved with diagrams from
  other sessions — all 3 Mermaids are about trust mechanics (identity,
  grounding, observability).
