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

## Deferred from: code review of 3-5-test-http-services (2026-05-20)

- submitQuery edge cases (null queryId, empty response, non-string response) — source code edge cases beyond spec scope. Pre-existing.
- Partial PATCH failure in submitQuery (time recorded but not answered, or vice versa) — internal orchestration edge case. Pre-existing.
- Missing individual error tests (500/404/401) for every service method — error pattern is consistent across methods; tested for main paths. Nice-to-have hardening.
- Missing pagination edge cases (limit:0, negative offset) — source validation concern, beyond spec scope.
- Search term special characters and whitespace — source validation concern, beyond spec scope.
- Missing locale parameter inheritance test — service might have locale resolution bug when param omitted; nice-to-have.
- Missing folder reorder edge cases (duplicate orders, non-existent folders) — nice-to-have hardening.
- getComparisonData partial failure (first succeeds, second fails) — returns both null even on partial failure; source edge case.
- getTimeSeriesData/getUniqueUsersCount edge cases (null items in array, string values) — source data shape edge cases beyond spec scope.
