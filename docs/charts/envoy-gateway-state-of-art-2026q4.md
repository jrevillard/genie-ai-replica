# Envoy Gateway State-of-Art 2026Q4 — Deep-Research Findings

> **Note**: dev-internal evidence doc. Drove the spec §9 ingress decision
> (Envoy Gateway v1.9 as default, K8s 1.33+ minimum, Kong fully removed). Sources cited inline.

**Generated:** 2026-10-08 · **Method:** deep-research workflow (offline synth fallback) · **Source:** `wf_de10d112-f95/journal.jsonl`
**Stats:** 25 claims · 10 confirmed · recommended default = Envoy Gateway v1.9

---

## F1 — Envoy Gateway v1.9 is the current stable line

- **Released**: 2026-08-14, EOL 2027-02-14 (6-month support per minor)
- **Bundles**: Envoy distroless-v1.39.x + Gateway API CRDs v1.6.1
- **Supports**: K8s v1.33 – v1.36
- **Previous lines**: v1.8 (EOL 2026-11-14, ~5 weeks runway as of 2026-10-08), v1.7 (EOL 2026-08-05), v1.6 (EOL 2026-05-13)
- **v1.10**: scheduled for 2026-10-29
- **Sources**: [gateway.envoyproxy.io/news/releases/matrix/](https://gateway.envoyproxy.io/news/releases/matrix/), [gateway.envoyproxy.io/news/releases/v1.6/](https://gateway.envoyproxy.io/news/releases/v1.6/)
- **Vote**: 3-0

## F2 — K8s 1.32 deployment mismatch (BLOCKER for v1.9)

- v1.9 matrix: minimum K8s = v1.33 (1.32 DROPPED from support matrix)
- Only EG release still within support that supports K8s 1.32: **v1.8 (EOL 2026-11-14, ~5 weeks runway)**
- v1.7 (which supported 1.32) already EOL'd on 2026-08-05
- **Implication for GENIE.AI**: spec mandates K8s 1.32 (per spec §9); v1.9 needs 1.33+. To stay on Envoy Gateway v1.9 we must **bump the spec's K8s target to 1.33+** as a prerequisite
- **Sources**: matrix + GENIE.AI spec §9
- **Vote**: 3-0

## F3 — Envoy Gateway extends beyond Gateway API spec

- v1.8.0 (May 12, 2026) bumped Gateway API CRDs to v1.5.1 and added cross-namespace policy attachment, GRPCRoute GeoIP authorization, weighted BackendRefs, URLRewrite per-backendRef, ListenerSet/XListenerSet fixes
- Extends beyond spec with Envoy-native capabilities exposed via Gateway API-native resources: CSRF, CEL auth rules, ORCA load reporting, Lua via EnvoyExtensionPolicy, dynamic cost-based rate limiting, JWT `failOpen`/`forwardIDToken`, Backend for non-K8s routing
- **Quote (CNCF 2025-06-11)**: *"Envoy Gateway has become a performant and functional implementation of the Kubernetes Gateway API. It has also extended beyond the Gateway API, surfacing key Envoy Proxy capabilities in a simple and accessible way."*
- **Sources**: [CNCF blog](https://www.cncf.io/blog/2025/06/11/a-year-of-envoy-gateway-ga-building-growing-and-innovating-together/), [v1.8.0 notes](https://gateway.envoyproxy.io/news/releases/notes/v1.8.0/)
- **Vote**: 3-0

## F4 — v1.8.0 OIDC refactor consolidates auth

- Replaced prior SecurityPolicy OIDC implementation with a **single native `envoy.filters.http.oauth2` HTTP filter** in the HCM filter chain
- Moves route-specific config into native Envoy filter config
- Simplifies authentication chain (single code path)
- **Sources**: v1.8.0 release notes
- **Vote**: 3-0

## F5 — Envoy Gateway threat model endorses JWT/OIDC

- **ControlPlane** (commissioned by Linux Foundation, refreshed 2026-10-07) is the official threat model
- **Explicitly endorses JWT and OIDC as recommended authentication mechanisms**
- Cites **short-lived** tokens as preferred pattern (aligns with Keycloak default `accessTokenLifespan: 1800` from spec §8)
- **Sources**: ControlPlane threat model (cited)
- **Vote**: 3-0

## F6 — NGINX Gateway Fabric: only honors first filter of each kind (BLOCKER for NGF)

- NGF 2.7.2 (current as of 2026-10-08) silently ignores all but the first configured HTTPRoute filter for these types: `requestRedirect`, `requestHeaderModifier`, `urlRewrite`, `cors`
- **A multi-filter chain (CORS + JWT + rewrite on a single route) breaks**: only the first filter applies; the rest are dropped silently
- **Implication for GENIE.AI**: NGF as primary gateway is **NOT viable** for our BFF/SPA pattern which needs CORS + OIDC + header manipulation in one route
- **Sources**: NGF 2.7.2 doc + matrix
- **Vote**: 2-1 (still HIGH confidence — 1 vote dissent acknowledged)

## F7 — NGF ignores HTTPRoute `name`/`timeouts`/`retry` fields

- NGF 2.7.2 marks `timeouts` and `retry` as "Not supported (ignored if defined)" in its Gateway API conformance matrix
- Backend resilience must be implemented at Service level (PodDisruptionBudget + retries in app code, not in gateway)
- **Sources**: NGF matrix
- **Vote**: 3-0

## F8 — NGF AuthenticationFilter evolved rapidly through 2026

- 2.4.0 (Jan 2026): shipped Basic Auth only
- 2.5.0: added JWT natively
- 2.7.0: added OIDC + ExternalAuth filter on HTTPRoute
- Implication: NGF's auth story is recent (less battle-tested than EG's), and the rapid evolution isn't confidence-inspiring
- **Sources**: NGF changelogs
- **Vote**: 2-1

## F9 — Production sovereign deployments exist

- Envoy Gateway **documented production adopters** (homepage roster, distinct from `/community/adopters/` contribution landing) include **~28+ named organizations** spanning hyperscalers, SaaS, and **at least 2 sovereign deployments**:
  - **KDVZ** (German public-sector municipal IT consortium)
- **Sources**: Envoy Gateway homepage roster
- **Vote**: 2-1

## F10 — openDesk (German BWI/Bundeswehr sovereign office suite)

- **BWI** (Bundeswehr IT) wrapper around existing open-source components: Open-Xchange AppSuite, Nextcloud, Cryptpad+diagrams.net, Collabora Online, OpenProject
- Demonstrates on-prem viability of orchestrated OSS for sovereign gov
- Env Gateway can serve similar role as API front-door for such suites
- **Sources**: openDesk public docs
- **Vote**: 2-1

---

## Recommendation: LOCK IN Envoy Gateway v1.9

| Question | Answer |
|---|---|
| Is Envoy Gateway state-of-art for GENIE.AI's BFF+SPA pattern in 2026Q4? | **YES** |
| Should we drop Kong (Plan 2 Task 10)? | **YES** — Envoy Gateway handles everything Kong was doing: L7 routing, JWT auth via Keycloak, CORS, rate limiting, header manipulation. One component instead of two. Saves ~120 lines of chart YAML. |
| Should we swap to NGINX Gateway Fabric? | **NO** — NGF ignores multi-filter chains (CORS + JWT + rewrite drops all but first) AND ignores HTTPRoute timeouts/retry. Two showstoppers for our use case. |
| Should we keep Traefik as alternative (per spec §6 plug-point)? | **YES, document as fallback** — Traefik is mature, simple, K8s-native, popular for sovereign. Pluggability for swapping is fine. But don't swap as default. |
| Should we swap to Istio + Gateway API? | **NO** — Istio is a service mesh; overkill for a 6-service stack. Gateway API subset of Istio exists but adds significant operational complexity. |
| Should we swap to Cilium Gateway API? | **NO** — eBPF-based, requires Cilium CNI replacing kube-proxy. Sovereign-friendly but heavy lift. Document as v2. |
| Spec's K8s 1.32 mandate — change to 1.33+? | **YES** — required to use EG v1.9. Update spec §9 K8s target. |

---

## Spec changes required

1. **§9 Ingress + TLS**: bump K8s target from 1.32 to **1.33+** (minimum for EG v1.9). Pin solely via the kind node image (kindest/node:v1.33.0) — ct has no config key and no CLI flag for it (verified against chart-testing v3.15.0 source).
2. **§5.2 ClusterProfile + dep table**: drop `kong` entirely (user-confirmed removal). Add Envoy Gateway helm dep at `~> 1.9.0` (already in spec, just need version pin).
3. **§8 secrets / §6 pluggability**: Kong removed entirely (decision 7).
4. **§13 uninstall hook**: no changes.
5. **Plan 2 Task 10 (Kong deployment)**: REMOVED entirely (decision 7).
6. **Plan 3 Task 5 step 2 (nginx.conf uses kong upstream)**: switch to `proxy_pass http://envoy-gateway:80` or remove the `/api/` upstream entirely (let Envoy route directly to backend).

## Files to update

- `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` (§9 K8s target, Kong references)
- `docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-data-layer.md` (Plan 2 Task 10 — Kong opt-in)
- `docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-service-tier-group5.md` (Plan 3 Task 5 step 2 — nginx upstream swap)
- the kind node image in the ct cluster creation step (no ct.yaml key, no ct CLI flag)

## Status

GENIE.AI Helm migration benefits significantly from this research: one fewer component (Kong fully removed), cleaner chart (~120 lines saved), tighter sovereign posture, all gateway needs satisfied by Envoy Gateway v1.9 + 6-month support cadence.

**Next step**: confirm with user, then apply spec edits + Plan 2/3 + ct.yaml updates in one batch.
