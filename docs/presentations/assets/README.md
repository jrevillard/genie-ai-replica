# Deck-specific assets

Illustrations extracted from the GENIE.AI policy briefing PPTX
(`Téléchargements/GENIE_AI_pres_briefing_policy.pptx`) for the Discovery
Workshop deck. **Not** part of the shared Marp theme (`themes/`) — these
are content-specific to this workshop and may be swapped or removed when
the deck is repurposed.

| File | Source PPTX asset | Used on slide |
|------|-------------------|---------------|
| `genie-itud-priorities.png` | `ppt/media/image3.png` (ITU-D priorities + AFR Flagship) | Slide 4 · "Aligned with ITU-D Resolutions" |
| `genie-logo-mark.png` | `ppt/media/image8.png` (magic-lamp mark) | Slide 5 · "What is GENIE.AI" |
| `genie-brand-pillars.png` | `ppt/media/image7.png` (5-pillar ribbon) | Slide 11 · "The Five Brand Pillars" |
| `genie-country-deployments.png` | `ppt/media/image15.png` (6-country deployment grid) | Slide 27 · "GENIE.AI in the Field" |

All images are referenced from this `assets/` directory via relative
paths in the deck markdown (e.g., `assets/genie-brand-pillars.png`).
This works with `--allow-local-files`.

## Deck structure

28 slides covering the technical part of the Discovery Workshop
(Part 1 of 2 — 30 min):

- **Slides 1-2**: title + master workshop agenda (all parts)
- **Slides 3-6**: ITU mandate, ITU-D alignment, GENIE.AI definition, Part 1 divider
- **Session 1** (slides 7-11): Sovereign AI & Architecture Fundamentals —
  agenda → divider → architecture → sovereignty guarantees → five brand pillars
- **Session 2** (slides 12-17): Ingestion, Graph-RAG & Multilingual —
  divider → operating model → ingestion pipeline → hybrid retrieval →
  multilingual engine → live demo (multilingual retrieval)
- **Session 3** (slides 18-21): Security, IAM & Governance —
  divider → auth (Keycloak OIDC + JWKS) → observability (W3C traceparent) →
  live demo (trace + abstention)
- **Session 4** (slides 22-28): Live Architecture Walkthrough & Case Studies —
  divider → deployment paths → air-gapped GPU → configuration → branding →
  country deployments → open floor

Mermaid diagrams: system architecture (S9), operating model (S13),
ingestion pipeline (S14), hybrid retrieval (S15), multilingual sequence (S16),
auth flow (S19), trace sequence (S20), air-gapped GPU topology (S24).
