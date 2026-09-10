# UI Smoke Test — Session Work (browser-only, local build)

Target: https://localhost (main-* stack). Log in as the admin user.
Start with a HARD REFRESH (Ctrl+Shift+R) — the frontend bundle changed (new app hash).
No API tools needed; everything is clickable. Estimated time: ~30 min (plus waiting for concept indexing).

Fixtures to type into the editor (PII-clean — no place names, no phone-like numbers):

```
index.md   → frontmatter: title: Services Index, type: index
             body: # Services\n\n- [Health services](health.md)\n- [Water services](water.md)
health.md  → frontmatter: title: Health Services, type: service
             body: # Health\n\nClinics and hospitals serve every district. See [water services](water.md).
water.md   → frontmatter: title: Water Services, type: service
             body: # Water\n\nClean drinking water supply for all households.
```

---

## Part 1 — Existing data (5 min, no setup)

| # | Do | EXPECTED / PASS |
|---|----|-----------------|
| 1.1 | OKF Studio → Dashboard. Look at ANY repo card's action strip | A **Logs** button sits **between Versions and Export** on every card, all five lanes (In progress, In review, Published, Ingested, Retracted) |
| 1.2 | Click **Logs** on the **Kenya Government Services** card (Ingested lane) | Dialog opens titled for Kenya; table lists rows newest-first with columns **when / user / action / description**; user shows "Admin GENIE"; past actions visible (e.g. "Ingested version 3 — graph ... is now serving") |
| 1.3 | Close the dialog; click into Kenya (open the editor) | The editor's action strip ALSO has **Logs** in the same Versions…Export position; it opens the same trail |
| 1.4 | With Kenya open (serving repo) | **READ ONLY** pill visible; the serving-graph chip shows the born-right name **OKF_kenya-government-services_v3**; the concept editor is read-only; back on the card there is **no Delete** |
| 1.5 | Open **Versions** on the Kenya card | The ledger shows version 3 and its bundle entry — bundle name carries the version (kenya…-v3.zip pattern) |

## Part 2 — Fresh repo, full machine walk (~25 min)

Create → enrich → review → publish → serve → retract → re-publish.

| # | Do | EXPECTED / PASS |
|---|----|-----------------|
| 2.1 | **+ New repository** (name: `UI Smoke <two digits>`, domain: Social) | Card appears in **In progress**, status Draft; action strip reads Submit for review · Versions · **Logs** · Export · Delete |
| 2.2 | Click Logs on the fresh card | The trail ALREADY has `repo.create` — "Created repository … in domain …" with your user and a timestamp (audit starts at creation, A) |
| 2.3 | Open the repo (click the card) → add the three fixture concepts (index/health/water) via the editor's add-concept flow | Each concept parses; status shows **Pending/indexing** → flips to **Indexed** (drain). If it stays Pending >10 min, the shared worker queue is busy — wait, or tell me and I'll check |
| 2.4 | In the concept list, check each concept's state | All **Indexed**; no Rejected, no Failed |
| 2.5 | (Rejection escape, F) Add a 4th concept `broken.md` WITHOUT a `type:` line | Its status shows **Rejected** (conformance) |
| 2.6 | Edit `broken.md` in the editor: add ONLY `type: service` to the frontmatter — change nothing else — save | Status flips **Rejected → Pending** (re-enters validation) without touching the body → then **Indexed**. THIS IS THE FIX — previously it stayed Rejected forever |
| 2.7 | Card: **Submit for review** | Card moves to **In review**; next action reads **Approve** |
| 2.8 | Click Logs on the card | New rows: `Submitted for review`, then `Approved (review sign-off)` with your user + time |
| 2.9 | **Approve** → then **Publish** | Card moves through Published; **Versions** dialog now shows **version 1** with a bundle `ui-smoke-<nn>-v1.zip` |
| 2.10 | Click Logs | Rows for `Minted version 1`, `Published version 1 — bundle "ui-smoke-<nn>-v1.zip" stored in the document repository`, and a `Serving graph name promoted` row reading `OKF_ui-smoke-<nn>_v1 -> OKF_ui-smoke-<nn>_v1` (a no-op promote — the graph was born right) |
| 2.11 | **Ingest** (serving flip) | Card moves to **Ingested**; **READ ONLY pill + chip `OKF_ui-smoke-<nn>_v1`** in the editor; Delete gone from the card; Publish disabled |
| 2.12 | Try to edit anything while serving | Refused — the repo is READ ONLY until retracted |
| 2.13 | Open the graph view (RepoGraphView) from the editor | Entities + edges render; traversal from the index concept reaches its linked concepts (health, water) — the graph was born correctly, not renamed |
| 2.14 | **Retract** on the card | Card moves to **Rettracted**; Logs gains `Retracted version 1 — taken out of service; the repository is editable again`; the READ ONLY pill is gone; editing works again |
| 2.15 | Edit a concept (small text change), wait for re-index, then **Publish** again | **Version 2** appears in Versions with `ui-smoke-<nn>-v2.zip`; ingest serves `OKF_ui-smoke-<nn>_v2` (chip shows v2) |
| 2.16 | Click **Export** on the card | The zip downloads; its manifest names graph `OKF_ui-smoke-<nn>_v2` and version 2 (born-right naming travels with the artifact) |

## Part 3 — Audit completeness sweep (3 min)

| # | Do | PASS |
|---|----|------|
| 3.1 | Open Logs on the Part-2 repo and read top-to-bottom | You should find, in order: create → 4× concept indexed (+edges rows) → submit → approve → version_mint → publish → graph_promote → ingest → retract → (edit/re-index) → version_mint → publish → graph_promote → ingest. EVERY row has user + when + a human-readable description — no blank actors, no blank descriptions on lifecycle rows |
| 3.2 | Check two different cards' Logs | Trails are per-repo — Kenya's rows never bleed into the smoke repo's |

## Part 4 — Negative checks a user can do (2 min)

| # | Do | PASS |
|---|----|------|
| 4.1 | On a Draft card, look at the strip order | Submit for review · Versions · **Logs** · Export · Delete — Logs strictly between Versions and Export |
| 4.2 | While ANY repo is serving (Kenya), try its card actions | Only Retract · Versions · Logs · Export — **no Delete** (a serving repo cannot be deleted) |
| 4.3 | In the Versions dialog of a serving repo, try "Create new version"/Publish | Disabled with the READ ONLY reason (retract first) |

## If something fails

Note the step number + what you saw. Useful evidence: a screenshot, and the exact description text of any odd Logs row. Known environmental caveats: a busy shared worker queue delays Pending→Indexed (step 2.3) — that is contention, not a bug; and if you were logged in before today, log out/in once (Keycloak was rebuilt yesterday).
