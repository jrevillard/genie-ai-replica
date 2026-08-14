---
title: 'Mobile Service Test Gaps (DW-206 through DW-210)'
type: 'feature'
created: '2026-08-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
baseline_revision: '96a57d94028a9aac295299f3432d157805846f2f'
warnings: [multiple-goals]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Five Flutter service-layer test gaps deferred from code review (DW-206 through DW-210). ConnectivityService has an `_isChecking` concurrency guard, dispose/timer cleanup, and DNS fallback — all untested. NotificationService stream controller lifecycle untested. AppTokens `fromConfig()` crashes on malformed config (wrong-type casts) with no defensive handling or tests.

**Approach:** Make ConnectivityService testable by injecting a `ConnectivityProvider` abstraction (breaks direct `Connectivity()` dependency). Add `@visibleForTesting` reset for singleton isolation. Add defensive type checking in `AppTokens.fromConfig()` with graceful fallback. Write unit tests covering concurrent calls, dispose lifecycle, DNS fallback, notification stream stress, and malformed config edge cases.

## Boundaries & Constraints

**Always:**
- Existing passing tests must remain green — no regression
- Singleton pattern preserved in production — testability hooks are `@visibleForTesting` only
- AppTokens defaults unchanged for valid configs — defensive handling only affects malformed input

**Block If:**
- Injecting `ConnectivityProvider` requires changes to 3+ production call sites beyond ConnectivityService itself

**Never:**
- Modify `connectivity_plus` plugin or fork it
- Change NotificationService from static singleton to instance-based (architectural change beyond scope)
- Add integration tests — this bundle is unit-test scoped
- Break any existing public API surface

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Concurrent recheck | Two `recheckConnectivity()` calls overlap | Second call returns immediately (`_isChecking` guard) | No error, no double execution |
| DNS fallback success | Hardware=none, DNS lookup succeeds | Treated as mobile/online | No error |
| DNS fallback timeout | Hardware=none, DNS lookup exceeds 2s | Treated as offline | Timeout caught, no crash |
| Dispose then emit | `dispose()` called, then state change attempted | Timer cancelled, stream closed | No error on dispose |
| AppTokens theme=string | `config: {'theme': 'bad'}` | Falls back to defaults | No TypeError thrown |
| AppTokens fontScale=string | `config: {'theme': {'typography': {'fontScale': 'big'}}}` | Falls back to fontScale=1.0 | No TypeError thrown |
| AppColors nested wrong type | `config: {'theme': {'navbar': 'bad'}}` | Navbar defaults to brand | No TypeError thrown |

</intent-contract>

## Code Map

- `mobile/genie_ai_mobile/lib/services/connectivity_service.dart` -- Singleton service with `_isChecking` guard (L19), `_monitorTimer` (L26), `dispose()` (L183), DNS fallback (L100-115). Direct `Connectivity()` instantiation at L12 blocks unit testing of `recheckConnectivity()` and `init()`.
- `mobile/genie_ai_mobile/lib/services/notification_service.dart` -- Static singleton, `static final StreamController.broadcast()` (L13), never closed. All methods static.
- `mobile/genie_ai_mobile/lib/design_system/tokens/app_tokens.dart` -- `fromConfig()` factory (L76). Unsafe casts: `config['theme'] as Map<String, dynamic>?` (L82), `theme['navbar'] as Map<String, dynamic>?` (L103, L156), `theme['colors'] as Map<String, dynamic>?` (L110, L166), `theme['typography'] as Map<String, dynamic>?` (L123, L179), `typography['fontScale'] as num?` (L124, L180).
- `mobile/genie_ai_mobile/test/services/connectivity_service_test.dart` -- 188 lines. Tests only user-override path (`setUserOfflineMode`, `toggleUserOfflineMode`, stream behavior). Does NOT test `recheckConnectivity()`, `init()`, `dispose()`, or concurrent calls.
- `mobile/genie_ai_mobile/test/services/notification_service_test.dart` -- 182 lines. Tests `show()`, convenience methods, subscription management, filtering. Does NOT test stream lifecycle or stress.
- `mobile/genie_ai_mobile/test/services/auth/connectivity_checker_test.dart` -- 49 lines. Interface contract tests only.
- `mobile/genie_ai_mobile/test/design_system/tokens/app_tokens_test.dart` -- 263 lines. Tests valid config paths (light/dark, custom brand/navbar/status colors, typography). No malformed config tests.
- `mobile/genie_ai_mobile/lib/services/auth/connectivity_checker.dart` -- Thin wrapper delegating to ConnectivityService. Not modified in this bundle.

## Tasks & Acceptance

**Execution:**

- `lib/services/connectivity_service.dart` -- Add `ConnectivityProvider` abstract class with `checkConnectivity()` method. Add `RealConnectivityProvider` wrapping `Connectivity()`. Add optional constructor parameter for test injection. Add `@visibleForTesting static void resetForTesting()` to create fresh singleton. Add `@visibleForTesting Timer? get monitorTimer` for test assertions. Refactor `recheckConnectivity()` to use provider. Refactor DNS fallback into testable `_dnsLookup()` method.
- `test/services/connectivity_service_test.dart` -- Add test groups: (1) concurrent recheck — two overlapping calls, verify guard prevents double execution, (2) DNS fallback — mock provider returns none, mock DNS succeeds/fails/timeout, (3) dispose lifecycle — verify timer cancelled, stream closed, no error on double-dispose, (4) resetForTesting — verify fresh state after reset.
- `lib/services/notification_service.dart` -- Add `@visibleForTesting static void resetForTesting()` that closes existing controller and creates fresh one. No production behavior change.
- `test/services/notification_service_test.dart` -- Add test groups: (1) stream lifecycle — verify controller is broadcast, multiple sequential events, (2) rapid-fire stress — 100 events in sequence, all received by listener, (3) resetForTesting — verify clean state.
- `lib/design_system/tokens/app_tokens.dart` -- Replace unsafe `as Map<String, dynamic>?` casts with `_asMap(dynamic value)` helper that returns `Map<String, dynamic>?` (null on type mismatch). Replace `as num?` with `_asNum(dynamic value)` helper. Apply to all nested config access points (theme, navbar, colors, typography, fontScale).
- `test/design_system/tokens/app_tokens_test.dart` -- Add `group('malformed config edge cases')`: theme is string, theme is number, navbar is string, colors is list, typography.fontScale is string, all nested wrong types. Verify defaults used, no exceptions thrown.

**Acceptance Criteria:**

- Given ConnectivityService with injectable provider, when two `recheckConnectivity()` calls overlap, then only one executes the check (second returns immediately via `_isChecking` guard)
- Given hardware reports none, when DNS lookup succeeds within timeout, then status treated as online
- Given hardware reports none, when DNS lookup times out (>2s), then status treated as offline, no unhandled exception
- Given `dispose()` called, when `_monitorTimer` was active, then timer is cancelled and stream controller is closed
- Given NotificationService under rapid event load (100 events), when listener subscribed, then all 100 events received in order
- Given `AppTokens.fromConfig(config: {'theme': 'string'})`, when factory called, then returns default tokens without throwing TypeError
- Given `AppTokens.fromConfig(config: {'theme': {'typography': {'fontScale': 'big'}}})`, when factory called, then fontScale defaults to 1.0
- Given existing test suite, when all tests run, then all previously-passing tests remain green

## Spec Change Log

## Review Triage Log

### 2026-08-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

## Design Notes

**ConnectivityProvider injection:** The `Connectivity()` class from `connectivity_plus` is a final field initialized inline. Extracting it behind an abstract interface allows unit tests to inject a fake that returns controlled results without platform channel mocking. The production path is unchanged — `RealConnectivityProvider` wraps the real `Connectivity()`.

**DNS fallback extraction:** The `InternetAddress.lookup('google.com').timeout(Duration(seconds: 2))` call at L100-115 is directly testable if extracted into a method that can be overridden in test subclasses or mocked. Extract as `Future<List<InternetAddress>> _dnsLookup()` — in tests, override to return controlled results or throw timeout.

**AppTokens safe casts:** Rather than adding try-catch around each cast (verbose), a single `_asMap()` helper centralizes the type check: `if (value is Map<String, dynamic>) return value; return null;`. Same pattern for `_asNum()`. This converts TypeErrors into null returns, which the existing `??` fallback chains already handle.

**Singleton reset for tests:** Both ConnectivityService and NotificationService are singletons. Tests that call `dispose()` or modify static state need isolation. `resetForTesting()` creates a fresh instance / closes and recreates the controller. Called in `tearDown()` to ensure test isolation.

## Verification

**Commands:**
- `cd mobile/genie_ai_mobile && flutter test test/services/connectivity_service_test.dart` -- expected: all tests pass including new concurrent/dispose/DNS groups
- `cd mobile/genie_ai_mobile && flutter test test/services/notification_service_test.dart` -- expected: all tests pass including new lifecycle/stress groups
- `cd mobile/genie_ai_mobile && flutter test test/design_system/tokens/app_tokens_test.dart` -- expected: all tests pass including new malformed config group
- `cd mobile/genie_ai_mobile && flutter test` -- expected: full suite green, no regressions
- `cd mobile/genie_ai_mobile && flutter analyze` -- expected: no errors, no new warnings

## Auto Run Result

**Summary:** Implemented tests for 5 deferred-work items (DW-206 through DW-210) addressing Flutter mobile service test gaps. Added ConnectivityProvider DI for testability, defensive type casts in AppTokens, and 24 new unit tests across 3 test files.

**Files changed:**
- `mobile/genie_ai_mobile/lib/services/connectivity_service.dart` — Added ConnectivityProvider abstraction, test factory, resetForTesting, extracted DNS fallback, defensive dispose
- `mobile/genie_ai_mobile/lib/services/notification_service.dart` — Made _controller reassignable, added resetForTesting
- `mobile/genie_ai_mobile/lib/design_system/tokens/app_tokens.dart` — Added _asMap() and _asNum() safe-cast helpers, replaced 7 unsafe casts
- `mobile/genie_ai_mobile/test/services/connectivity_service_test.dart` — +10 tests (concurrent recheck, DNS fallback, dispose lifecycle, reset)
- `mobile/genie_ai_mobile/test/services/notification_service_test.dart` — +6 tests (stream lifecycle, stress, reset)
- `mobile/genie_ai_mobile/test/design_system/tokens/app_tokens_test.dart` — +8 tests (malformed config edge cases)

**Review findings breakdown:**
- Patches applied: 0
- Items deferred: 0
- Items rejected: 0

**Follow-up review recommendation:** false (0 patches: 0 high, 0 medium, 0 low; score = 0)

**Verification performed:**
- `flutter test test/services/connectivity_service_test.dart` — 28 passed ✅
- `flutter test test/services/notification_service_test.dart` — 18 passed ✅
- `flutter test test/design_system/tokens/app_tokens_test.dart` — 44 passed ✅
- `flutter analyze` (3 modified files) — No issues found ✅
- `flutter test` (full suite) — 348 passed, 3 pre-existing failures (unrelated KeycloakConfig const issues) ✅
- Matrix test audit: all 7 I/O matrix rows covered by passing tests ✅

**Residual risks:**
- `HangingProvider` defined in test file but unused (cosmetic, no functional impact)
- `_connectivity` field retained in ConnectivityService for `init()` stream listener (not injectable, but `init()` is platform-dependent and not unit-tested)
- 3 pre-existing test compilation failures in keycloak_service_test.dart, auth_notifier_test.dart, i18n_service_test.dart (const KeycloakConfig() misuse — unrelated to this bundle)
