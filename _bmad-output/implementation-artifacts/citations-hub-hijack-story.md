# Story — #2198: citations/wire silently no-ops on a title hijack

**Status:** IN PROGRESS (2026-11-26)
**Issue:** #2198 (`bug(okf-server)`, live-measured by David 2026-11-26 05:31 UTC)
**Branch:** `fix/okf-citations-hub-detection` (off main `c133d66de`)
**Worktree:** `D:\ITU-Gitlab\.claude\worktrees\okf-citations-wire`

## The defect (David's live evidence)

Clicking wire-citations on a 4-concept repo returned HTTP 200 three times,
no UI error, and NO Sources page: the index concept is titled
**"28-living-reference"**; the wire query's projection carried no `is_index`
(so `!r.is_index` was vacuously true for every row) and the title branch was
a SUBSTRING match — the index was "found" as the Sources hub, generation
never ran, the 3 citing pages already linked the index, and the response
rode back as bare success (`wired: 0`).

## The fix (the issue's five-point shape)

1. The projection carries `is_index: m.is_index`.
2. The title branch requires `is_index === false` EXPLICITLY and matches
   EXACTLY (`Sources`/`Citations`/`References`) — never a substring; the
   id-regex branch (`^(sources|citations|references)([-._].*)?$`) unchanged.
3. No hub → always generate (the computeReport fixture that encoded the
   substring behavior was corrected to the exact-match contract).
4. A title-alias hub returns `hub_alias: true` + `hub_title` so the UI can
   say "using existing page 'X'".
5. The response distinguishes outcomes: `generated` / `using_existing` /
   `wired` / `nothing_to_do` — rendered in Validate.vue's wire note; never a
   success-shaped no-op.

## Verification

- TDD RED→GREEN: 5 new tests (projection pin, the 28-living-reference case,
  substring-no-hijack, alias usage, nothing_to_do) + the corrected
  computeReport fixture. okf-server **2609/2609**; frontend **4645/4645**
  (the locale-consistency contract caught the man glosses dropping the
  `{n}`/`{hub}` placeholders — fixed verbatim). Coverage at/above baseline
  on all four metrics in both components.
- i18n: `okf.validation.wireAlias` + `wireNothing` ×14 locales.
- Deploy to the local build before merge; live replay is David's click on
  the same repo shape (index titled 28-living-reference).
