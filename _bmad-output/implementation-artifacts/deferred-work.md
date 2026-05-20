<<<<<<< HEAD
## Deferred from: code review of 1-3-create-ci-pipeline-test-stage (2026-05-19)

- Python venv recreated on every CI run despite cache restoration — `python -m venv .venv` in `before_script` recreates the venv even when cache restores it. Pattern is functional (venv creation is idempotent, pip skips installed packages) but wastes ~5-10s per run. Could be optimized with a conditional check (`if [ ! -d .venv ]; then python -m venv .venv; fi`).

## Deferred from: code review of 3-3-test-critical-vue-components-userprofile-and-admin-dashboard (2026-05-19)

- Deferred promise + setTimeout(300) not awaited — UserProfileComponent.loadUserProfileData has nested $nextTick + setTimeout(300) for country dropdown initialization; tests never await this, but country dropdown interaction is explicitly out of scope per spec "What NOT to Test" section. Revisit if country dropdown tests are added.
- SearchableCountryDropdown stub methods never called — stub defines manuallySetCountryName/loadCountries methods but setTimeout(300) prevents invocation during tests; country dropdown interaction is explicitly out of scope per spec. Revisit if country dropdown tests are added.
- AdminDashboard missing error handling edge cases — tests only cover happy path for service responses; null/malformed/missing response handling not tested but beyond current AC scope. Nice-to-have for future hardening.

## Deferred from: code review of 3-4-test-vuex-store-modules (2026-05-20)

- UPDATE_CHAT: chaîne vide traitée comme "pas de changement" — le code source utilise `title || state.chats[chatIndex].title` qui traite `''` comme falsy. Comportement du code source, pas des tests. Pre-existing.
- Persistence plugin dupliqué au lieu d'être importé — `persistence.test.js` réplique la logique du plugin au lieu d'importer depuis `store/index.js`. Approche délibérée pour isolation; duplication fidèle au source. Pre-existing design choice.
- Edge cases manquants (null inputs, IDs dupliqués, quota localStorage) — amélioration de couverture future, pas bloquant pour cette story.
