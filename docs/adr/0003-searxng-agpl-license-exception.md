# ADR 0003: SearXNG AGPL-3.0 license exception under NFR26

- **Status:** Accepted
- **Date:** 2026-09-05
- **Decided by:** Adem Mcharek
- **Scope:** Server-Side Tools initiative (PRD NFR26, OQ-SST-5 / plan.md decision D4)
- **Related:** ADR 0002 (Server-Side Tools architecture, Decision 2: SearXNG as backend)

## Context

ADR 0002 selects SearXNG as the web-search backend. SearXNG is licensed
**AGPL-3.0** — a strong copyleft license. GENIE.AI is Apache-2.0, and the PRD's
NFR26 permits AGPL components **only as unmodified, API-consumed services**.
Some public-sector legal teams ban AGPL outright regardless of usage mode, and
DPG compliance reviewers look for recorded license decisions — so this exception
must be written down, not assumed.

## Decision

SearXNG is approved for use under the following constraints, which together
satisfy NFR26's "unmodified, API-consumed services" clause:

1. **Unmodified image.** The deployment runs the official
   `searxng/searxng` Docker image as-published. The only local artifact is
   `configs/searxng/settings.yml` — runtime **configuration**, not a
   modification of SearXNG source. No SearXNG source files are vendored,
   patched, or linked into any GENIE.AI deliverable.
2. **API-only interaction.** All interaction is over the documented HTTP JSON
   API (`genie-ai-overlay/workflows/tools/web_search.py` calls
   `GET {SEARXNG_URL}/search?format=json`). No SearXNG code executes in-process
   with GENIE.AI code; there is no derivative work.
3. **Isolation.** SearXNG runs as a separate container (`genieai=true` node,
   internal-only networking). The AGPL network-use clause (§13) is moot for the
   same reason: SearXNG is not exposed to users, only to the backend service.
4. **No distribution.** GENIE.AI distributions (images, repositories) contain
   no AGPL code. The AGPL's obligations attach to distributing SearXNG itself,
   which we do not do — we consume the upstream image.

## Consequences

- Web search keeps a sovereign, self-hosted, DPG-aligned backend with no data
  exfiltration to commercial APIs.
- If SearXNG is ever modified at source (not configuration), this ADR no longer
  covers that derivative and the exception must be re-reviewed.
- Any future AGPL component beyond "unmodified image + API consumption" needs
  its own decision record.
- A stopped SearXNG degrades gracefully (RAG-only + degradation notice,
  story 2-7) — the dependency is operationally safe as well as legally clean.

## Sign-off

- **Decision owner:** Adem Mcharek — 2026-09-05
- Recorded from plan.md decision D4 (OQ-SST-5); closes OQ-SST-5.

## References

- PRD NFR26 + OQ-SST-5: `_bmad-output/planning-artifacts/prds/prd-server-side-tools.md`
- ADR 0002: `docs/adr/0002-server-side-tools-architecture.md`
- SearXNG license: https://github.com/searxng/searxng/blob/master/LICENSE.md
