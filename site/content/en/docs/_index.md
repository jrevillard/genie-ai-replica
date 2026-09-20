---
title: "GENIE.AI Documentation"
weight: 1
description: "Sovereign, multilingual RAG for the public sector — installation, operations, architecture, and contribution guides."
---

**GENIE.AI — Sovereign, multilingual RAG for the public sector.**

GENIE.AI is an open-source generative-AI framework that lets public-sector
organizations run a **retrieval-augmented-generation** (RAG) chat assistant on
their own infrastructure — no third-party model API required, no data leaves
your perimeter, fully configurable, and shipped under a DPG-compliant license.
The stack is built on [OPEA](https://opea.dev) (Open Platform for Enterprise AI)
and supports 14+ languages out of the box.

## Pick your path

GENIE.AI serves four audiences. Pick the one that matches your goal — each
links to a 10-minute quickstart and a curated set of follow-on docs.

<div class="row row-cols-1 row-cols-md-2 g-4 mt-3">
  <div class="col">
    <a class="card h-100 text-decoration-none border-primary" href="/docs/get-started/quickstart-user/">
      <div class="card-body">
        <h5 class="card-title">End user</h5>
        <p class="card-text">Use the chat assistant, switch language, give feedback. No installation.</p>
        <ol class="small mb-0">
          <li>Open the chat URL your admin gave you</li>
          <li>Sign in with the SSO button</li>
          <li>Ask a question about an indexed document</li>
        </ol>
      </div>
    </a>
  </div>
  <div class="col">
    <a class="card h-100 text-decoration-none border-primary" href="/docs/get-started/quickstart-deployer/">
      <div class="card-body">
        <h5 class="card-title">Deployer</h5>
        <p class="card-text">Install GENIE.AI on a single host with Docker Compose — production-ready in 15 minutes.</p>
        <ol class="small mb-0">
          <li>Clone the repo and <code>cp env .env</code></li>
          <li>Set the required secrets (DB, Keycloak, HF token)</li>
          <li><code>docker compose up -d</code> and verify the health endpoint</li>
        </ol>
      </div>
    </a>
  </div>
  <div class="col">
    <a class="card h-100 text-decoration-none border-primary" href="/docs/get-started/quickstart-developer/">
      <div class="card-body">
        <h5 class="card-title">Developer</h5>
        <p class="card-text">Extend the backend or the RAG pipeline — local dev loop in 10 minutes.</p>
        <ol class="small mb-0">
          <li>Run <code>npm install</code> in <code>components/gov-chat-backend</code></li>
          <li>Spin up dependencies with <code>docker compose up -d</code></li>
          <li>Run <code>npm run dev</code> and hit <code>localhost:3000/api/health</code></li>
        </ol>
      </div>
    </a>
  </div>
  <div class="col">
    <a class="card h-100 text-decoration-none border-primary" href="/docs/get-started/quickstart-contributor/">
      <div class="card-body">
        <h5 class="card-title">Contributor</h5>
        <p class="card-text">Open your first merge request — fork, branch, test, request review.</p>
        <ol class="small mb-0">
          <li>Fork and clone the repo</li>
          <li>Create a feature branch and write tests first</li>
          <li>Open the MR using the template — CI + review gate the merge</li>
        </ol>
      </div>
    </a>
  </div>
</div>

## Sections

13 sections, ordered by the path most readers take. Each card lists the
section's mission in one line.

<div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4 mt-3">
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/get-started/"><div class="card-body"><h5 class="card-title">Get started</h5><p class="card-text small">Be productive in 15 minutes — quickstarts for all four personas, concepts, and FAQ.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/deploy/"><div class="card-body"><h5 class="card-title">Deploy</h5><p class="card-text small">Install GENIE.AI on Docker Compose, Swarm, or a remote GPU node.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/operate/"><div class="card-body"><h5 class="card-title">Operate</h5><p class="card-text small">Run a live deployment — backup, scaling, updates, troubleshooting.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/observe/"><div class="card-body"><h5 class="card-title">Observe</h5><p class="card-text small">Metrics, logs, traces, dashboards, and alerting via VictoriaMetrics + Grafana.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/configure/"><div class="card-body"><h5 class="card-title">Configure</h5><p class="card-text small">Realm setup, IdP integration, service banner, CORS / CSP, locale whitelist.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/architecture/"><div class="card-body"><h5 class="card-title">Architecture</h5><p class="card-text small">C4 context/container view, auth flows, trust boundaries, OPEA contract.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/rag-pipeline/"><div class="card-body"><h5 class="card-title">RAG pipeline</h5><p class="card-text small">Embedding, retrieval, reranking, generation, translation — every stage.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/knowledge-base/"><div class="card-body"><h5 class="card-title">Knowledge base</h5><p class="card-text small">Ingestion, taxonomy, document lifecycle, content quality guidance.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/backend/"><div class="card-body"><h5 class="card-title">Backend</h5><p class="card-text small">HTTP API contracts, auth flow, rate limits, defense-in-depth surface.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/frontend/"><div class="card-body"><h5 class="card-title">Frontend</h5><p class="card-text small">Vue 3 SPA — auth flow, chat UX, sidebar, admin dashboard, theming.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/mobile/"><div class="card-body"><h5 class="card-title">Mobile</h5><p class="card-text small">Flutter app — architecture, deployment, OIDC PKCE login, SSE chat.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/contribute/"><div class="card-body"><h5 class="card-title">Contribute</h5><p class="card-text small">Repo layout, dev workflow, MR guide, i18n, security triage, style.</p></div></a></div>
  <div class="col"><a class="card h-100 text-decoration-none" href="/docs/reference/"><div class="card-body"><h5 class="card-title">Reference</h5><p class="card-text small">Single-source env-var table, HTTP API, OPEA extensions, glossary.</p></div></a></div>
</div>

## Search the docs

Use the **search box** at the top (or press <kbd>/</kbd>). It indexes titles,
headings, and body text — search by:

- an **env-var name** (e.g. `RERANKER_TOP_N`)
- a **service name** (e.g. `chatqna`, `dataprep`, `keycloak`)
- an **error message** (e.g. `dataprep.status failed`)
- a **command** (e.g. `docker stack deploy`)

For the canonical reference of every supported env-var with default and scope,
see [Environment variables](/docs/reference/env-vars/).

## Recent updates

This site is rebuilt continuously. Major waves in the past 48 hours:

- **2026-09-19**: Wave 22-25 cleanup — ghost env vars removed (LOG_TO_VICTORIALOGS, LOG_TO_FILE, VL_FAIL_OPEN), backup-restore extended to all 4 stateful stores, scaling.md covers all services, OTel log export unconditional, VL_QUERY_TIMEOUT_MS wired as user-configurable.
- **2026-09-18**: Wave 1-3 initial audit + restructure — site rebuilt from 40 → 105 docs across 15 sections (deploy / operate / observe / configure / rag-pipeline renames), Diataxis mode coverage 0% → 100%, mermaid diagrams added (29 blocks).
- **2026-09-18**: Wave 0 — initial audit baseline (score 42/100, 127 drift errors identified).

For per-file changes, see each doc's footer "last_reviewed" stamp.

## Report a problem

Docs are maintained alongside the code in the same repository. If a page is
wrong, missing, or out of date, [open an issue](https://opensource.unicc.org/un/itu/genie-ai/-/issues)
or send a merge request following the [contribution flow](/docs/contribute/how-to-mr/).

Latest review stamp on this site: **2026-09-18**. Pages show their own
`last_reviewed` in the footer.