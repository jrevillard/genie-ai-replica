# PLAN frontend — Frontend identity & polish (Adem's tracker, temporary)

**HANDOFF NOTE (10-06): Epic L work runs in a NEW chat session. Start from
`sprint/plan.md` §BOOTSTRAP + this file. Artifacts committed on
`feature/2.0-upgrade` (pushed). Assets staged in `sprint/webpage assets/`
(logo.png, logo.webp, palette-logos.jpeg — do not commit binaries into the
component tree until L.1/L.4 pick the finals).**

Epic L (epics.md): frontend identity & polish — one brand logo, a login page,
the pending screen, a new color theme (light-default), and admin-panel fixes.
Same pattern as the other trackers: Adem's file, merges into `sprint/plan.md`
§Log and is deleted when the epic closes. Every story runs the full BMAD loop:
spec → build → adversarial review → gates → Adem's deploy → live test → commit
(his go).

**Skills for this epic (INSTALLED + verified 10-06, ready to use):**
- `frontend-design` (anthropics/skills → ~/.claude/skills) — UI/color-system
  polish; drives L.1/L.4/L.5 (invocation-tested)
- `webapp-testing` (anthropics/skills → ~/.claude/skills) — Playwright visual
  verification; the house "claims must match evidence" law applied to pixels
  (L.2/L.3/L.4 before/after shots). Playwright 1.63 + chromium headless
  installed in genie-ai-overlay/.venv (render+screenshot smoke-tested); helper
  scripts live inside the skill dir
- House-mandatory anyway: ponytail (+review), the bmad suite, dataviz when the
  theme touches admin charts

## Story table — session state 10-07 (pick up here)

**Epic L status: L.1 ✓live · L.3 ✓live · L.5 ✓live · L.2 = one docker
restart from done (row 2) · L.4 (theme/light-default) = last story, not
started. K.9 (app sizing) filed in plan_10_05.md. L.5 part 2's remaining
"layout polish" = nothing named — closed unless Adem names irritants.**

| # | Task | BMAD story | State |
|---|---|---|---|

**Keletso landing work (ported 10-06 from LSO `feature/landing-polish`, not a
numbered L-story):** LIVE-VERIFIED 10-06 ("deployed and everything works")
— KeletsoHero (Lesotho banner + centered greeting pill; MASCOT REMOVED at
Adem's request, live-approved), KeletsoIcon (8 Basotho topic icons mapped
1:1 to the DEC-28 button _keys; admin-created buttons keep their stored
icon img), overlay copy, real-button a11y, tOr() EN-fallback. Rejected:
their a39b1d4c ChatHistoryComponent overwrite (teammate to revert on LSO).
Open for Keletso: st keys for the new strings.

**Session lessons (10-06/07, cost hours — don't relearn):**
1. **(SUPERSEDED 10-08 — the restart advice below was wrong.)** KC theme-css
   staleness = the **gzip disk cache**, not memory: fix with
   `docker exec agrivisory-app-keycloak-1 rm -rf /opt/keycloak/data/tmp/kc-gzip-cache`
   (zero downtime; restart only for theme.properties changes). Full story:
   docs/deploy-rtx6000.md §10 row + memory keycloak-theme-caching.
2. `--tags deploy` alone never syncs files (G1 lesson, bit us twice more).
3. Browser caches the theme css 30 days under a stable URL — verify in a
   private window before believing a deploy "did nothing". curl lies too
   (no gzip header → always served fresh).
4. Local theme preview recipe: docker run the pinned KC image with the
   themes dir mounted + kcadm set master realm loginTheme=agrivisory (full
   commands in git log of 5fea51a3/e9dde400 messages). Dev mode disables
   the gzip/theme caches — local previews never show this class of bug.
| 1 | One brand logo: remove the ITU+FAO+app-icon trio, add Adem's logo | **L.1** | built+review-patched (DEC-31: shield bare+title, webp, navbar-only; gates 297) — awaiting deploy + live verdict + commit |
| 2 | Login page: port main's look, reconciled with Keycloak-hosted reality | **L.2** | **done — LIVE 10-08** (Adem confirmed). Wrapper v2 (DEC-32b) + KC theme final = styled card alone (DEC-32c/32d). The multi-day staleness saga closed by a 6-agent research workflow: root cause = KC's **gzip disk cache** (`/opt/keycloak/data/tmp/kc-gzip-cache/…`) — served with no freshness check, survives restart; fix = `docker exec agrivisory-app-keycloak-1 rm -rf /opt/keycloak/data/tmp/kc-gzip-cache` (zero downtime) + private window. Runbook row in docs/deploy-rtx6000.md §10 |
| 3 | Pending screen: port from LSO repo commit 6b6829b9 | **L.3** | done 10-06 — ported bf57593f+6b6829b9 (Keletso redesign: seedling hero, eyebrow, status steps); F14b logout-first KEPT (relabeled "Sign out"); lineage-verified clean (their base = our HEAD for the file); gates 297 + build DONE; awaiting deploy + live check |
| 4 | Color theme from the new palette; default LIGHT; worked together | **L.4** | todo — collaborative (Adem in the loop) |
| 5 | Admin fixes: translation-model display + Pipeline Settings UI | **L.5** | **done** — part 1 live 10-06; part 2 (screenshot-driven: textareas were intrinsic ~20-col boxes) LIVE-VERIFIED 10-06 "everything works" |

Suggested order: **L.5** (independent quick fixes) → **L.1** (logo) → **L.4**
(theme, informed by the logo) → **L.2** → **L.3** (ports, reference-gated).

---

## Task 1 — One brand logo (L.1)

Recon done 10-06: the main page renders THREE logos in NavBarComponent.vue
(:14-27) — `itu-logo-adjust.png`, `fao-icon.png`, and the config-driven app
icon (`govt-logo`). All three go; Adem's single logo replaces them (candidates
staged: `sprint/webpage assets/logo.png` + `logo.webp` — webp preferred if the
target browsers agree, else png). DECIDE at spec: final asset, size/placement,
light+dark variants, alt text. Verify no other surface still references the
removed assets (splash, favicon, Keycloak realm?) — sweep with grep.

## Task 2 — Login page (L.2)

**⚠ AUTH-LAW TENSION — verify with Adem at spec time (his instruction).**
Our Epic-A convergence (S-1, A4) DELETED the local login screen in favor of
Keycloak's hosted page (oidc-client-ts, PKCE, realm `agrivisory`). Main branch
still has its own LoginScreen lineage (pre-convergence). "Bring the login page
from main" therefore most likely means: port main's login-page LOOK onto the
Keycloak-hosted surface (custom realm theme in genie-realm.yaml / Keycloak
theme assets) or a styled pre-redirect wrapper — NOT reintroducing a local
login form (that would regress S-1). Spec must present the options with
screenshots and Adem picks.

## Task 3 — Pending screen (L.3)

Port the pending-approval screen from the SHARED repo
`ITU-Agrivisory-Agriconnect-LSO`, commit `6b6829b9b32897c4e4b2fff25c3f728010e1a462`
(branch `feature/landing-polish`). No local clone exists — fetch it first
(shallow clone or add a remote; see memory `azure-lso-shared-repo-scrub` for
that repo's state — scrubbed branch, divergent SHAs; verify the commit's
contents against the URL, don't trust local refs). Our current screen:
`PendingApprovalScreen.vue` (F14b-fixed "Back to Login" behavior — keep that
fix while porting the look). Port + attribute (S-2).

## Task 4 — Color theme, light default (L.4) — COLLABORATIVE

Palette source: `sprint/webpage assets/palette-logos.jpeg` (extract hexes at
spec time with Adem). Work the token system (`theme-variables.css` /
`theme-components.css` + the `data-theme` switches), default LIGHT for every
fresh session, keep dark mode available (existing toggle), persisted
preference. Adem works this story together with the session — present palette
mappings before applying, screenshot-gate each surface (chat, admin, login,
pending). Charts in the admin panel must follow (dataviz skill).

## Task 5 — Admin panel fixes (L.5)

Two named defects (Adem 10-06), both in surfaces the K-session just landed or
touched:
- **Translation-model display lies**: shows the legacy CPU model
  (`TRANSLATION_CPU_MODEL_ID` default `Xenova/nllb-200-distilled-600M`,
  docker-compose :547) while the live backend is `facebook/nllb-200-3.3B` on
  the GPU sidecar (DEC-25, compose :494). Fix = display the ACTIVE backend;
  label the CPU value legacy-fallback or drop it from the card.
- **Pipeline Settings section (K1-K3 UI, commit 78b0dcc2) looks bad**:
  layout polish + the system-prompt textareas are too small — make them
  proper multi-line editors (auto-grow or generous fixed height).
**Coordination:** these are NOT K.4's broader staleness sweep — cross-ref
added to plan_10_05.md so the K-session doesn't duplicate them.

## Done definition for this file

All five stories closed (code+tests+live-verified on agriconnect.site, with
before/after screenshots per story) → merge one-line outcomes into
`sprint/plan.md` §Log → delete this file.
