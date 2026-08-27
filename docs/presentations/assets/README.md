# Deck-specific assets

Illustrations extracted from the GENIE.AI policy briefing PPTX
(`Téléchargements/GENIE_AI_pres_briefing_policy.pptx`) for the Discovery
Workshop deck. **Not** part of the shared Marp theme (`themes/`) — these
are content-specific to this workshop and may be swapped or removed when
the deck is repurposed.

| File | Source PPTX asset | Used on slide |
|------|-------------------|---------------|
| `genie-logo-mark.png` | `ppt/media/image8.png` (magic-lamp mark) | Slide 4 · "What is GENIE.AI" |
| `genie-itud-priorities.png` | `ppt/media/image3.png` (ITU-D priorities + AFR Flagship) | Slide 6 · "Aligned with ITU-D Resolutions" |
| `genie-how-it-works.png` | `ppt/media/image1.png` (4-step workflow) | Slide 10 · "Deploy, Configure, Tune, Pilot" |
| `genie-brand-pillars.png` | `ppt/media/image7.png` (5-pillar ribbon) | Slide 8 · "The Five Brand Pillars" |
| `genie-country-deployments.png` | `ppt/media/image15.png` (6-country deployment grid) | Slide 20 · "GENIE.AI in the Field" |

All images are referenced from this `assets/` directory via relative
paths in the deck markdown (e.g., `assets/genie-brand-pillars.png`).
This works with `--allow-local-files`.

## Deck structure

21 slides covering Part 1 of the Discovery Workshop (4 × 15 min sessions).

- **Slides 1-3**: pre-session (title, agenda, "What is GENIE.AI")
- **Session 1** (slides 4-8): Sovereign AI & Architecture Fundamentals — divider → ITU-D alignment → system architecture with OIDC + OTel rails → sovereignty guarantees → five brand pillars (5 numbered cards)
- **Session 2** (slides 9-13): Hybrid Ingestion, Vector-Graph RAG & Multilingual — divider → 4-step operating model → multilingual engine → ingestion pipeline (ClamAV → Docling → late label → TEI → ArangoDB) → hybrid vector-graph retrieval
- **Session 3** (slides 14-17): Security, IAM & Zero-Hallucination Governance — divider → Keycloak identity (JIT + JWKS) → zero-hallucination decision tree → W3C trace context + OTel
- **Session 4** (slides 18-21): Live Architecture Walkthrough & Case Studies — divider → docker-compose profiles → 6-country grid → use case matrix + Q&A

Seven Mermaid diagrams total: 1 in S1 (system architecture), 3 in S2
(multilingual sequence + ingestion pipeline + retrieval flow), 3 in S3
(identity + grounding + trace).

The deck was rebuilt against the official workshop agenda. Key wins vs
the prior version:
- **Agenda-aligned session titles** (Sovereign AI Fundamentals,
  Hybrid Ingestion, Security & IAM, Live Architecture Walkthrough).
- **Five Brand Pillars moved to S1** — they introduce DPG/OSI/sovereignty
  principles before the technical mechanics, and are formatted as 5
  numbered cards (Local Ownership · Open Source · Zero-Hallucination ·
  Scalability & Accessibility · Real-World Deployment).
- **JIT provisioning + JWKS validation** explicitly called out on the
  Identity slide (was implicit before).
- **W3C trace context** framed around "inspectable by design" — every
  answer carries its source chunk, auditable end-to-end.
- **Kubernetes references corrected** — K8s is on the roadmap (same
  images, different orchestrator); today the stack is Docker Swarm.
