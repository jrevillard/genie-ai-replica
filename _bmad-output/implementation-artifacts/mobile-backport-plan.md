# Mobile Backport Plan — el-salvador → main

**Scope:** Carry the mobile bug fixes shipped on `release/el-salvador` (branch
`fix/mobile-nonstreaming-label-reset`, head `145822b6d`) into `origin/main`'s
`mobile/genie_ai_mobile/` tree once the El Salvador deployment is stable.

**Source branch (this branch is the reference for "what shipped"):**
`fix/mobile-nonstreaming-label-reset` @ `145822b6d`. Tree:
`mobile/genie_ai_mobile/` — branched from `release/el-salvador` and carries the
agri overlays (market prices, crop health, pest alerts) plus the M25/M28/M30/
M31/M33 mobile bug-fix layer.

**Target branch:** `origin/main` @ `86f30cb2f` (latest as of 2026-09-23).

**Method:** read-only diff investigation. NO code changes were made; the table
and notes below are the contract for the backport work to come.

---

## 1. Executive summary

| Fix | Branch / MR | Shipped on this branch? | Main has equivalent? | Classification |
|-----|-------------|-------------------------|----------------------|----------------|
| **M25** Auth session recovery (DW-325) — `deleteAll()` only on `invalid_grant`; proactive refresh; concurrency fix; navigator reset on dead session | `fix/mobile-auth-session-recovery` / MR !427 | Partial — `58ee68d44` (batch 1) | Yes — identical auth subtree | **DIRECTLY BACKPORTABLE** (adapts clean to main; the follow-up `bec100a1d` adds `_refreshMutex` token-diff + `AuthException.code` but is NOT on this branch — see §6 risk) |
| **quickhelp label fallback** (`quickHelpServiceLabels()` helper, issue #1000) | `fix/mobile-quickhelp-label-parity` / MR !422 | Yes — `4ba6d043b` | Yes — main has the file | **DIRECTLY BACKPORTABLE** |
| **M28** Visible Quick Help filter chip (D1a) — `_activeQuickHelpId`, `clearQuickHelpContext()`, `_contextBarText()`, context bar render, reset sites | `feat/mobile-quickhelp-filter-chip` / MR !436 | Yes — `9430a2d51` | Yes — main has the chat subtree + `contextPrefix` key | **NEEDS ADAPTATION** — diff is tangled with el-salvador agri overlays (charts imports, `_agriSectionTitle`, `_showExportDialog` removal, Just Chat filter, etc.). The transport layer (chip itself) backports cleanly; the agri-only lines need to be excluded |
| **M30** "Filter matched no documents" banner — warning-tinted above the assistant bubble | `feat/mobile-ungrounded-answer-label` / MR !437 | Yes — `a4451b2d7` | Yes — main has `chatbot.*` i18n keys (the `noDocsMatchingFilter` en/es additions don't exist on main) | **NEEDS ADAPTATION** — backport the banner render + use `tr('chatbot.noDocsMatchingFilter')`, add the new `noDocsMatchingFilter` + `submit` keys to **all 14 locale files** on main (en+es is not enough — see §6 risk) |
| **M31** Non-streaming label reset (DW-247 partial) — `clearQuickHelpContext()` in `_sendNonStreaming` success + error paths | (stacked on M28 / !422 / URL fix) | Yes — `56b4b1adc` | Yes — main has `_sendNonStreaming` | **DIRECTLY BACKPORTABLE** (only after M28 lands) |
| **M33** Release readiness — branded AgroGenio, R8/ProGuard config | `chore/mobile-release-readiness` / MR !435 | Yes — `d39af4c2c` | Partial — main has its own `build.gradle` but no `el_salvador`/`agro-genio` flavor / branding | **MAIN HAS NOTHING TO BACKPORT TO (label)** — see §3. The R8/ProGuard config is **directly backportable** (the brand relabel is not) |
| **URL regression** — strip trailing `/api` from `el_salvador` backendUrl | Commit `145822b6d` on the M31 stack | Yes — `145822b6d` | No — main has no `el_salvador` flavor file | **MAIN HAS NOTHING TO BACKPORT TO (flavor)** |
| **M32** Typed SSE errors (`streamErrorKey` helper, `AuthException.code` field) | `fix/mobile-sse-auth-retry` / MR !428 | **NO — not on this branch.** Reachable only via `fix/mobile-sse-auth-retry` (which is NOT merged into `release/el-salvador`) | Yes (after M25) | **OUT OF SCOPE FOR THIS BACKPORT** — listed for completeness; would need its own investigation if M25 is backported without M32 (see §6 risk) |

**Counts**
- **DIRECTLY BACKPORTABLE** (as-is on el-salvador): M25 (partial), M22-style label fallback, M31 (after M28), M33 (R8/ProGuard only)
- **NEEDS ADAPTATION**: M28, M30
- **MAIN HAS NOTHING TO BACKPORT TO**: brand relabel (`AgroGenio`), El Salvador flavor backendUrl fix
- **OUT OF SCOPE FOR THIS BRANCH**: M32

---

## 2. Per-fix table

> Columns: Fix | Branch / MR (commit) | Files touched on this branch | Equivalent on main? | Classification | Notes

### M25 — Auth session recovery (DW-325)

| Field | Value |
|---|---|
| **Fix** | M25 — auth recovery (deleteAll only on invalid_grant + proactive refresh + concurrency fix + navigator reset) |
| **Branch / MR** | `fix/mobile-auth-session-recovery` / MR !427 |
| **Commit(s) on this branch** | `58ee68d44` (batch 1) |
| **Files changed** | `mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart` (+124 / −12), `mobile/genie_ai_mobile/lib/services/auth/auth_interceptor.dart` (+28 / −6), `mobile/genie_ai_mobile/lib/main.dart` (+21 navigatorKey + listener), `mobile/genie_ai_mobile/test/services/auth/auth_notifier_test.dart` (+98 / −12), `mobile/genie_ai_mobile/test/services/auth/auth_interceptor_test.dart` (+27) |
| **Equivalent on main?** | **Yes — identical auth subtree.** `auth_notifier.dart`, `auth_interceptor.dart`, `token_storage.dart` exist on main with the same shape (token_storage.dart is byte-identical) |
| **Classification** | **DIRECTLY BACKPORTABLE** — but only the `58ee68d44` portion of M25. The follow-up `bec100a1d` (which adds `AuthException.code`, `AuthException.transientFailure`, and the `_refreshMutex` token-diff) is NOT on `fix/mobile-nonstreaming-label-reset`; if M32 (`70e7da0fc`) is also in scope, they must come along together |
| **Notes** | The el-salvador copy of `auth_notifier.dart` carries `_pushTokenToApiService()` and `_installApiServiceRefreshHook()` that are unique to the agri ApiService path. Those are el-salvador-specific and should NOT be backported (main has no AgriApiService). The 4 hunks to keep: (a) `invalid_grant`-only `deleteAll()` in `refreshToken()`'s catch — only when the inner exception's `code == 'invalid_grant'`; (b) `INTERCEPTOR_REFRESH_*` retry logic in `AuthInterceptor.send()` for ANY 401 (not just non-null-token 401); (c) the `ref.listen<AuthState>` navigator reset in `main.dart`; (d) the concurrent-refresh `_refreshCompleter` mutex in `AuthInterceptor._refreshMutex()` |

### quickhelp label fallback (issue #1000)

| Field | Value |
|---|---|
| **Fix** | `quickHelpServiceLabels()` helper: derivable KB filter labels for a quick-help button, never returns an empty list (mirrors Vue's behavior so retriever filter stays active) |
| **Branch / MR** | `fix/mobile-quickhelp-label-parity` / MR !422 |
| **Commit(s) on this branch** | `4ba6d043b` |
| **Files changed** | `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart` (+53 / −7), `mobile/genie_ai_mobile/test/components/chat/quickhelp_labels_test.dart` (new, 144 lines) |
| **Equivalent on main?** | **Yes — main has the file at the same path.** The hunk in `_loadQuickHelpConfig` that preserved `serviceLabels` as `null` instead of normalizing to `[]` backports cleanly; main's copy already has the bug fix |
| **Classification** | **DIRECTLY BACKPORTABLE** — but the test file lands in `test/components/chat/` which main does NOT have (see M28 note below) |
| **Notes** | Add the test under a directory that main already has (`test/components/shared/`?). OR introduce `test/components/chat/` on main. Decision belongs to the test-area owner |

### M28 — Visible Quick Help filter chip (D1a)

| Field | Value |
|---|---|
| **Fix** | `_activeQuickHelpId` field, `clearQuickHelpContext()` method, `_contextBarText()` helper, context-bar render, reset sites (new chat, quick-help press, error fallback) |
| **Branch / MR** | `feat/mobile-quickhelp-filter-chip` / MR !436 |
| **Commit(s) on this branch** | `9430a2d51` (+74 / −6) |
| **Files changed** | `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart`, `mobile/genie_ai_mobile/test/components/chat/active_filter_chip_test.dart` (new, 86 lines) |
| **Equivalent on main?** | **Yes — main has `lib/components/chat/chatbot_component.dart`** (1844 lines vs el-salvador's 2154). Main already has `_activeServiceLabels`, `_loadQuickHelpConfig`, the `contextPrefix` i18n key. But main's file is masked by agri overlays in the el-salvador copy (~310 lines of agri-only diff), so cherry-picking the el-salvador commit verbatim onto main would drag in chart imports and `_agriSectionTitle` |
| **Classification** | **NEEDS ADAPTATION** — the M28 chip hunk is tangled with agri-only lines. Surgical approach: copy the 5 chip-related hunks (declaration of `_activeQuickHelpId`, `clearQuickHelpContext()`, `_contextBarText()`, set-active site, reset sites) — do not apply `9430a2d51` as a whole commit |
| **Notes** | The i18n key `chatbot.contextPrefix` already exists on main, so no locale change is needed for M28. The chat tests directory does NOT exist on main — see §6 risk #3 |

### M30 — "Filter matched no documents" banner

| Field | Value |
|---|---|
| **Fix** | Warning-tinted banner rendered above the assistant bubble when the stream returns an ungrounded answer (filter matched no documents) |
| **Branch / MR** | `feat/mobile-ungrounded-answer-label` / MR !437 |
| **Commit(s) on this branch** | `a4451b2d7` (+55 / −0, +2 en, +2 es) |
| **Files changed** | `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart` (banner render + key reference), `mobile/genie_ai_mobile/lib/i18n/locales/en.dart` (+2 — `noDocsMatchingFilter`, `submit`), `mobile/genie_ai_mobile/lib/i18n/locales/es.dart` (+2 — Spanish translations), `mobile/genie_ai_mobile/test/components/chat/m30_filter_banner_test.dart` (new, 49 lines) |
| **Equivalent on main?** | **Partial** — main has the file (`lib/components/chat/chatbot_component.dart`) and the i18n subtree (`lib/i18n/locales/*.dart`, all 14 files). Main does NOT have `chatbot.noDocsMatchingFilter` in any locale yet |
| **Classification** | **NEEDS ADAPTATION** — banner code is fine; must add `noDocsMatchingFilter` (and the redundant `submit` for the feedback dialog) to **all 14 locale files** to follow the project's "all locales stay key-complete" rule (see §6 risk #1). The el-salvador MR only added en+es; main's CI will fail on the missing translations |
| **Notes** | The banner itself is just a `Container(...child: Text(tr('chatbot.noDocsMatchingFilter')))` render. Translating the message into non-en/es is the actual work (the 14-locale rule is a project convention enforced by locale completeness tests) |

### M31 — Non-streaming label reset (DW-247 partial)

| Field | Value |
|---|---|
| **Fix** | `clearQuickHelpContext()` in `_sendNonStreaming` success + error paths so the Quick Help filter doesn't leak across non-streaming turns |
| **Branch / MR** | (stacked on M28 / quickhelp-labels / URL fix); no dedicated branch |
| **Commit(s) on this branch** | `56b4b1adc` (+12 / −0) |
| **Files changed** | `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart`, `mobile/genie_ai_mobile/test/components/chat/m31_nonstreaming_reset_test.dart` (new, 58 lines) |
| **Equivalent on main?** | **Yes — main has `_sendNonStreaming`** (verified by grep against `origin/main:mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart`) |
| **Classification** | **DIRECTLY BACKPORTABLE** — but ONLY after M28 lands (M31 uses `clearQuickHelpContext()`, which is M28's method). Order: M28 → quickhelp-labels → M31 |
| **Notes** | Single hunk insertion: one `clearQuickHelpContext()` call in each of the success and error branches of `_sendNonStreaming` |

### M33 — Release readiness (R8/ProGuard)

| Field | Value |
|---|---|
| **Fix** | (a) R8/ProGuard enabled for release builds (silences `flutter_secure_storage` → Tink → `javax.annotation.*` missing-class errors). (b) Brand relabel: `Genie AI Mobile` → `AgroGenio`. (c) Splash metadata for the AgroGenio farmer hero |
| **Branch / MR** | `chore/mobile-release-readiness` / MR !435 |
| **Commit(s) on this branch** | `d39af4c2c` (+31 / −2 across 4 files) |
| **Files changed** | `mobile/genie_ai_mobile/android/app/build.gradle` (+9 — `minifyEnabled`, `shrinkResources`, `proguardFiles`, splash dependency), `mobile/genie_ai_mobile/android/app/proguard-rules.pro` (new, 19 lines), `mobile/genie_ai_mobile/android/app/src/main/AndroidManifest.xml` (+1 / −1 — label), `mobile/genie_ai_mobile/android/app/src/el_salvador/AndroidManifest.xml` (+2 / −1 — label + `tools:replace`) |
| **Equivalent on main?** | **Partial** — main has `android/app/build.gradle` (with a near-identical shape to el-salvador's), `android/app/src/main/AndroidManifest.xml` (label is `Genie AI Mobile`, identical to el-salvador's pre-M33). Main does NOT have `android/app/proguard-rules.pro` or an `el_salvador` flavor directory |
| **Classification** | **MIXED** — the **R8/ProGuard** config is **DIRECTLY BACKPORTABLE**. The **brand relabel** is **MAIN HAS NOTHING TO BACKPORT TO** (main has no AgroGenio brand — it uses `Genie AI Mobile`). The **splash dependency** (`androidx.core:core-splashscreen`) is only needed if el-salvador's branded splash is also being backported (it isn't, because main uses the default) |
| **Notes** | Apply the R8 block: 3 new lines in `android/app/build.gradle` (`minifyEnabled true`, `shrinkResources true`, `proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'`) + the new file `android/app/proguard-rules.pro`. Skip the `implementation "androidx.core:core-splashscreen:1.0.1"` line and the brand relabel hunks |

### URL regression fix (commit `145822b6d`)

| Field | Value |
|---|---|
| **Fix** | Strip trailing `/api` from `el_salvador` flavor `backendUrl` (the OpenAPI client builds paths that already start with `/api/…`, so including `/api` here produced `…/api/api/…` and every chat/folder/service-category call 404'd) |
| **Branch / MR** | Commit `145822b6d` on the M31 stack |
| **Commit(s) on this branch** | `145822b6d` (+6 / −1) |
| **Files changed** | `mobile/genie_ai_mobile/lib/config/flavors/el_salvador.dart` (`backendUrl: 'https://mvp.ai.assembly.govstack.global/api'` → `'https://mvp.ai.assembly.govstack.global'`) |
| **Equivalent on main?** | **No — main has no `el_salvador` flavor file.** `git ls-tree origin/main mobile/genie_ai_mobile/lib/config/flavors/` returns only `itu.dart` and `template.dart` |
| **Classification** | **MAIN HAS NOTHING TO BACKPORT TO** — purely an el-salvador-flavor configuration fix |
| **Notes** | Document the root cause in the project backlog under a "non-obvious gotchas" section so the next deployment doesn't repeat it (also relevant to the chat-stream comment in el_salvador.dart which says `'$streamBaseUrl/api/queries/stream'`) |

---

## 3. Recommended backport order

> Each step is independent; the order is by least risk + highest value. Steps
> 1-3 are the core M25/M28 chain. Steps 4-5 are the brand & flavor exclusions.

### Step 1 — M25 Auth recovery (must come first; everything else depends on it)

- **Why first:** All other fixes build on top of an assumed-correct auth layer; locking this in stabilizes the test surface for steps 2-5.
- **What to apply:** the M25 batch-1 hunks from `58ee68d44` ONLY (not `bec100a1d`'s `_refreshMutex` token-diff or M32's `streamErrorKey` unless M32 is in scope).
- **Estimated surface:** 4 files (auth_notifier, auth_interceptor, main, 2 test files). Clean diff in main's auth subtree.
- **Risk:** low. The `_pushTokenToApiService()` and `_installApiServiceRefreshHook()` lines in el-salvador's `auth_notifier.dart` are agri-only — leave them out on the backport. The remaining hunks are shape-preserving.

### Step 2 — quickhelp label fallback (M-22 / issue #1000)

- **Why second:** Tiny, isolated hunk. Pins the Vue-mobile filter parity invariant before M28 starts reading `_activeServiceLabels`.
- **What to apply:** the `quickHelpServiceLabels()` helper (lines ~2140 of chatbot_component.dart on el-salvador) and the `serviceLabels` null-preservation in `_loadQuickHelpConfig`.
- **Estimated surface:** 1 file (chatbot_component.dart). Test lands in `test/components/chat/quickhelp_labels_test.dart` — see §6 risk #3 on directory existence.
- **Risk:** very low. The diff is purely local to chatbot_component.dart.

### Step 3 — M28 Quick Help chip + M30 banner + M31 reset (the chain)

- **Why together:** each calls into the others (M31 calls M28's `clearQuickHelpContext()`; M30 reads the same state). Easier to land as one MR than three.
- **What to apply:**
  - M28: 5 surgical hunks (declaration + 2 reset helpers + 2 reset sites + 1 active site).
  - M30: 1 banner hunk + 14 locale files for the new keys.
  - M31: 2 calls in `_sendNonStreaming` success/error paths.
- **Estimated surface:** 1 chatbot_component.dart hunk set + 14 locale files (`chatbot.noDocsMatchingFilter` key, plus optional `submit` for the dialog) + 3 test files into a new `test/components/chat/` directory.
- **Risk:** medium — the locale fan-out is the real work, not the Dart.

### Step 4 — M33 R8/ProGuard only

- **Why after step 3:** release-config changes ship last; once a feature-flagged change enters release, you want the minification to catch any debug-only assumptions that crept in.
- **What to apply:** `minifyEnabled true`, `shrinkResources true`, `proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'` in `android/app/build.gradle` (release block) + a new `android/app/proguard-rules.pro` (the 19-line comment-only file copied verbatim).
- **Estimated surface:** 2 files (build.gradle, proguard-rules.pro). Skip the splash dependency, brand relabel, and `el_salvador/AndroidManifest.xml` changes — they're el-salvador-only.
- **Risk:** low. Should smoke-test a release build for the missing-class warnings before merge (the el-salvador copy proves the rules silence them).

### Step 5 (NOT BACKPORTING) — URL fix, M32 typed SSE errors, M33 brand relabel

- URL fix (`145822b6d`): el-salvador flavor only — no-op on main. Skip; document in the el-salvador-flavor onboarding guide only.
- M32 (`70e7da0fc`): only reachable via `fix/mobile-sse-auth-retry`, which is not on this branch. Carry separately if the project's M25 plan picked up `bec100a1d` first.
- M33 brand relabel: main uses `Genie AI Mobile`; that is correct, not a regression. Skip.

---

## 4. Risks & open questions

1. **14-locale fan-out for M30.** M30 added `chatbot.noDocsMatchingFilter` to only `en.dart` and `es.dart` on el-salvador. The project rule (memory) is "EN-fallback the rest, but keep keys present in all 14 locale files". So the backport MR must add the key to `ar.dart`, `bn.dart`, `de.dart`, `fr.dart`, `id.dart`, `man.dart`, `pt.dart`, `ru.dart`, `st.dart`, `sw.dart`, `th.dart`, `zh.dart` — even if the value is the English string. Verify locale-completeness tests pass (the project runs them per CLAUDE.md). **DECIDE FIRST:** is the agreed approach "EN-fallback the rest" or "delegate translation per locale owner"? That decision is the same one you've previously made for agri-i18n.

2. **M25 fragmentation.** The M25 work on `release/el-salvador` is TWO commits: `58ee68d44` (batch 1) and `bec100a1d` (batch 2). **Only `58ee68d44` is on the working branch `fix/mobile-nonstreaming-label-reset`.** `bec100a1d` lives on `fix/mobile-auth-session-recovery` only. The plan above assumes you backport the el-salvador branch as-is — confirm whether `bec100a1d` should ship in the same MR, or as a follow-up.

3. **`test/components/chat/` does not exist on main.** `git ls-tree origin/main mobile/genie_ai_mobile/test/components/` shows only `chat/...` is absent; the directory tree on main has `auth/`, `chat/` (under components? actually: `shared/` is the only sibling). All four M28/M30/M31/quickhelp-labels test files would land in a NEW directory. Confirm with the test-area owner whether the convention is to introduce `test/components/chat/` or move tests into `test/services/` instead.

4. **`flutter_appauth` local fork.** The `lib/services/auth/...` files on el-salvador are pinned via a `path: flutter_appauth/flutter_appauth` reference in pubspec.yaml (per the project's mobile CLAUDE.md). Main's pubspec.yaml should be re-checked to ensure the local fork is NOT pulled in by the backport — that dependency exists only to work around `flutter_appauth` upstream issue #386, not for any M25 reason. Verify `flutter_appauth: ^11.0.0` in main's `pubspec.yaml`.

5. **`bec100a1d` is on local branch only.** If M32 is desired in the same MR as M25, both `bec100a1d` and `70e7da0fc` must be cherry-picked into the backport MR (they're on `fix/mobile-auth-session-recovery` and `fix/mobile-sse-auth-retry` respectively, neither of which exists on main).

6. **N33 R8/ProGuard rule soundness.** The `proguard-rules.pro` on el-salvador silence warnings for `flutter_secure_storage` → Tink → `javax.annotation.*` and `errorprone.*`. Main's dependency tree may differ — re-verify by inspecting main's `pubspec.yaml` before copying the rules verbatim.

7. **M30 banner key naming.** The key `chatbot.noDocsMatchingFilter` on el-salvador was added in a different scope than the rest of the chatbot.* i18n group. It is placed immediately after `chatbot.contextPrefix` in the locale file. Confirm with i18n owner whether the canonical placement is under a `chatbot.filterBanner.*` namespace instead.

8. **Stream-throttling included.** While investigating, I noticed the el-salvador chatbot adds `// Throttle repaints: ...` SSE chunk batching (~310 L/s) in commit `9430a2d51` alongside the M28 chip (`_lastStreamUiMs`). This is unrelated to the chip but lives in the same commit. **Do not include in the M28 cherry-pick** — backport only the chip-related hunks.

---

## 5. Backport queue

> Empty when this plan was written. Add a row per MR as new mobile work lands on
> `release/el-salvador` that may eventually backport to `main`. Suggested
> columns: Date | Fix ID | Branch / MR | Commit | Files | Classification | MR to main | Shipped

| Date | Fix ID | Branch / MR | Commit | Files | Classification | MR to main | Shipped |
|------|--------|-------------|--------|-------|----------------|------------|---------|
| —    | —      | —           | —      | —     | —              | —          | —       |

---

## 6. Reference

### Source-tree inventory on `fix/mobile-nonstreaming-label-reset` @ `145822b6d`

```
mobile/genie_ai_mobile/
├── lib/
│   ├── components/chat/
│   │   ├── active_filter_chip_test.dart          (M28, new)
│   │   ├── m30_filter_banner_test.dart           (M30, new)
│   │   ├── m31_nonstreaming_reset_test.dart      (M31, new)
│   │   ├── quickhelp_labels_test.dart            (M-22, new)
│   │   ├── stream_error_message_test.dart        (M32, new — NOT on this branch)
│   │   ├── right_sidebar_faq_parse_test.dart     (preexisting)
│   │   └── chatbot_component.dart                (everything)
│   ├── config/flavors/
│   │   ├── el_salvador.dart                      (URL fix `145822b6d`)
│   │   ├── itu.dart                              (unchanged vs main)
│   │   └── template.dart                         (unchanged vs main)
│   ├── i18n/locales/{en,es,...}.dart             (M30 added 2 keys in en+es)
│   ├── services/auth/
│   │   ├── auth_interceptor.dart                 (M25 batch 1 — no `code` field)
│   │   ├── auth_notifier.dart                    (M25 batch 1 + agri ApiService hooks)
│   │   └── token_storage.dart                    (byte-identical to main)
│   └── main.dart                                 (M25 navigatorKey + listener)
├── android/app/
│   ├── build.gradle                              (M33 minify + splash dep)
│   ├── proguard-rules.pro                        (M33, new — 19 lines)
│   └── src/
│       ├── main/AndroidManifest.xml              (M33 brand relabel — skip)
│       └── el_salvador/AndroidManifest.xml       (M33 brand relabel — skip)
```

### Target-tree inventory on `origin/main` @ `86f30cb2f`

```
mobile/genie_ai_mobile/
├── lib/
│   ├── components/chat/
│   │   ├── auth/oidc_login_screen.dart
│   │   ├── chat_response_feedback_dialog.dart
│   │   ├── chatbot_component.dart                ← 1844 lines (cleaner than el-salvador's 2154)
│   │   ├── right_sidebar_component.dart
│   │   ├── right_sidebar_stub.dart
│   │   ├── stub_file_utils.dart
│   │   └── web_file_utils.dart
│   ├── config/
│   │   ├── dev_config.dart, e2e_config.dart, keycloak_config.dart, staging_config.dart
│   │   └── flavors/
│   │       ├── itu.dart                           ← only "production" flavor
│   │       └── template.dart
│   ├── i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.dart   ← 14 locales, en doesn't have `chatbot.noDocsMatchingFilter`
│   ├── services/auth/
│   │   ├── app_auth.dart, auth_interceptor.dart, auth_logger.dart, auth_notifier.dart
│   │   ├── auth_providers.dart, auth_state.dart, connectivity_checker.dart
│   │   ├── insecure_http_client.dart, network_error_classifier.dart, token_storage.dart
│   │   └── (no api_service.dart with refreshHook on main; that's the agri-only ApiService)
│   └── main.dart
├── android/app/
│   ├── build.gradle                              ← release block has NO minify; no proguardFiles
│   └── src/main/AndroidManifest.xml             ← label "Genie AI Mobile"
└── test/services/auth/                           ← has 9 test files; no `test/components/chat/`
```

### Key file diffs (el-salvador ⟶ origin/main, abs path under project root)

- `mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart` — origin/main 582 L, el-salvador 613 L. Net delta from el-salvador M25: +28 net (mainly the agri `_pushTokenToApiService` / `_installApiServiceRefreshHook` pair that is el-salvador-only). M25 actual hunk size: ~124 +auth_recovery.
- `mobile/genie_ai_mobile/lib/services/auth/auth_interceptor.dart` — el-salvador has the M25 retry logic + `_refreshCompleter` mutex, but does NOT have `bec100a1d`'s token-diff logic nor M32's `code` field (those are on `fix/mobile-auth-session-recovery` and `fix/mobile-sse-auth-retry` respectively).
- `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart` — origin/main 1844 L, el-salvador 2154 L. ~310 L diff is agri charts/Just Chat removal/`_agriSectionTitle`. The M22/M28/M30/M31 hunks are ~200 L and tangled with the agri lines.
- `mobile/genie_ai_mobile/lib/i18n/locales/en.dart` — origin/main 1157 L, el-salvador 1284 L. M30 adds 2 keys; the rest is agri+charts i18n blocks.
- `mobile/genie_ai_mobile/lib/i18n/locales/es.dart` — same shape: +2 M30 keys, +agri.
- `mobile/genie_ai_mobile/lib/i18n/locales/*.dart` (other 12) — el-salvador backfills M30? Not from this commit alone — need to verify on `release/el-salvador` HEAD whether the agri mobile parity backfill (`cbe4e8d22 feat(i18n-mobile): backfill market + charts blocks in 12 non-en/es locales`) added `chatbot.noDocsMatchingFilter` to non-en/es. **Assumption: NO — that backfill is for agri + charts blocks, not for chatbot.**
- `mobile/genie_ai_mobile/android/app/build.gradle` — origin/main lacks `minifyEnabled true` and `proguardFiles`. Splash dependency is el-salvador-only.

### Mobile-related background on `release/el-salvador` (NOT on this branch, listed for completeness)

| Commit | Title | Relevance |
|---|---|---|
| `bec100a1d` | fix(mobile): distinguish a transient refresh failure (M25 batch 2) | M25 follow-up; adds `INTERCEPTOR_REFRESH_NO_NEW_TOKEN`, `AuthException.code`, `AuthException.transientFailure`. NOT on `fix/mobile-nonstreaming-label-reset`. Reachable from `fix/mobile-auth-session-recovery`. Pair with M32. |
| `70e7da0fc` | fix(mobile): the chat stream reports a typed failure (M32) | Adds `streamErrorKey` helper + `_streamErrorMessage` mapper; reuses 14-locale i18n keys (`auth.timeout`, `auth.sessionExpired`). NOT on this branch. Reachable from `fix/mobile-sse-auth-retry`. |
| `43444bcc3` | fix(mobile): align el_salvador flavor with main conventions after rebase | el-salvador-flavor cleanup only; no impact on main |
| `f5eec9cce` | fix(mobile): correct el_salvador backendUrl and pin both test targets | el-salvador-flavor cleanup only; no impact on main |
| `cbe4e8d22` | feat(i18n-mobile): backfill market + charts blocks in 12 non-en/es locales | Verifies whether `chatbot.noDocsMatchingFilter` is in non-en/es after the M30 commit — see Risk #1 |

### How to run the backport once you've decided the scope

```bash
# Create the backport branch from origin/main
git checkout origin/main
git checkout -b backport/mobile-auth-and-quickhelp-2026q3

# Cherry-pick per the order in §3
# Verify each pick with `flutter test` and `flutter analyze` before proceeding.

# Push branch, open MR, gate on the el-salvador deployment stability criteria.
```

### Approximate PR split (if you prefer one-MR-per-fix)

| MR | Source commits | Affected files | Risk |
|---|---|---|---|
| MR-A: M25 auth recovery | `58ee68d44` | 4 dart, 2 test | low |
| MR-B: quickhelp label fallback | `4ba6d043b` | 1 dart, 1 test | very low |
| MR-C: M28 chip + M30 banner + M31 reset (the chain) | `9430a2d51`, `a4451b2d7`, `56b4b1adc` | 1 dart, 14 i18n, 3 test | medium (locale fan-out) |
| MR-D: M33 R8/ProGuard | `d39af4c2c` (R8-only hunks) | 2 android | low (smoke-test release build) |

Skip MRs for the el-salvador-flavor-only fix (`145822b6d`) and the M33 brand relabel.
