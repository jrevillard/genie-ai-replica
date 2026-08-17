# Mobile Race Condition Guards

**Story Key:** dw-mobile-race-condition-guards  
**DW References:** DW-34, DW-35, DW-36, DW-38  
**Baseline Commit:** 335d698bd7f6e084fbd15115f6d421943ea9b66a  
**Status:** ready-for-dev  
**Location:** mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart

## Intent

Add concurrency guards to `validateTokens()` and `logout()` to prevent race conditions when these methods are called concurrently with each other or with `authorize()`/`refreshToken()`. Follow existing pattern: boolean flags with `finally` block reset.

## Context

Current code has `_isAuthorizing` (line 55) and `_isRefreshing` (line 56) guards, but `validateTokens()` (line 533) and `logout()` (line 504) have no guards. This causes:
- Multiple `resumed` lifecycle events trigger overlapping `validateTokens()` calls (DW-34)
- `logout()` during `validateTokens()` refresh allows refresh to re-save tokens logout deleted (DW-35)
- `validateTokens()` during `authorize()` triggers redundant refresh competing with in-flight authorize (DW-36)
- `logout()` during `authorize()` allows authorize to save tokens after logout cleared them (DW-38)

## Frozen Intent

### Changes Required

1. **Add field `bool _isValidating = false;`** (after line 56, next to `_isRefreshing`)

2. **Add field `bool _isLoggedOut = false;`** (after `_isValidating`)

3. **Guard `validateTokens()`** (method starts line 533):
   - Early return if `_isValidating == true`
   - Set `_isValidating = true` at method start
   - Reset `_isValidating = false` in `finally` block
   - Early return if `_isLoggedOut == true` (logout in progress)

4. **Guard `logout()`** (method starts line 504):
   - Set `_isLoggedOut = true` at method start (before any async work)
   - Reset `_isLoggedOut = false` in `finally` block
   - If `_isAuthorizing == true` or `_isRefreshing == true` or `_isValidating == true`, await completion or cancel (simplest: set flag, let them check `_isLoggedOut` and exit early)

5. **Coordinate existing guards**:
   - `authorize()` (line 152): add early return if `_isLoggedOut == true` (after `_isAuthorizing` check)
   - `refreshToken()` (line 330): add early return if `_isLoggedOut == true` (after `_isRefreshing` check)
   - `validateTokens()`: add early return if `_isAuthorizing == true` or `_isRefreshing == true` (let them complete first, avoid redundant work)

6. **Lifecycle handler** (line 572, `didChangeAppLifecycleState`):
   - `validateTokens()` call already guarded by `_isValidating` check inside method
   - No change needed here

### Implementation Pattern

Follow existing pattern from `authorize()` and `refreshToken()`:

```dart
Future<void> validateTokens() async {
  if (_isLoggedOut || _isValidating) return;
  if (_isAuthorizing || _isRefreshing) return; // let them complete first
  _isValidating = true;
  _lastFailedOperation = _FailedOperation.validateTokens;
  try {
    // existing body
  } finally {
    _isValidating = false;
  }
}

Future<void> logout() async {
  _isLoggedOut = true;
  try {
    // existing body
  } finally {
    _isLoggedOut = false;
  }
}
```

### Acceptance Criteria

- [ ] `validateTokens()` has `_isValidating` guard preventing concurrent calls
- [ ] `validateTokens()` early returns if `_isLoggedOut == true`
- [ ] `validateTokens()` early returns if `_isAuthorizing == true` or `_isRefreshing == true`
- [ ] `logout()` sets `_isLoggedOut = true` before async work
- [ ] `logout()` resets `_isLoggedOut = false` in `finally` block
- [ ] `authorize()` early returns if `_isLoggedOut == true`
- [ ] `refreshToken()` early returns if `_isLoggedOut == true`
- [ ] All guards reset in `finally` blocks (no leaked state on exception)
- [ ] No `Completer` or mutex patterns — use simple boolean flags (codebase convention)
- [ ] Test file `auth_notifier_race_test.dart` exists with all 7 Test Matrix scenarios covered
- [ ] All tests pass via `flutter test test/services/auth/auth_notifier_race_test.dart`

### Test Matrix

| Scenario | Expected Behavior |
|----------|-------------------|
| Two concurrent `validateTokens()` calls from lifecycle events | Second call early returns (`_isValidating == true`) |
| `logout()` during `validateTokens()` refresh | `validateTokens()` checks `_isLoggedOut` flag, exits early |
| `validateTokens()` during `authorize()` | `validateTokens()` early returns (`_isAuthorizing == true`) |
| `logout()` during `authorize()` | `authorize()` checks `_isLoggedOut` flag after each await, exits early |
| `validateTokens()` during `refreshToken()` | `validateTokens()` early returns (`_isRefreshing == true`) |
| Exception in `validateTokens()` | `_isValidating` reset in `finally`, next call succeeds |
| Exception in `logout()` | `_isLoggedOut` reset in `finally`, next logout succeeds |

### Out of Scope

- DW-37 (lost state on app close after network error) — separate story, different root cause
- DW-39 (fragile keyword-based classification) — separate concern
- DW-40 (no runtime validation of scheme coherence) — separate concern
- DW-41 (no backchannel logout configuration) — separate concern
- Adding `Completer` or mutex patterns — codebase uses boolean flags, follow convention
- Refactoring auth flow architecture — focused fix, not redesign

### Non-Goals

- Do not change `authorize()` or `refreshToken()` logic beyond adding `_isLoggedOut` early return
- Do not add logging for race condition detection (existing `AuthLogger` sufficient)

### Test Requirements

Implement automated tests in `mobile/genie_ai_mobile/test/services/auth/auth_notifier_race_test.dart` covering all scenarios in Test Matrix below. Use `flutter_test` with `FakeAsync` for concurrent async testing. Each test must verify the specific guard behavior (early return, flag reset, state transition).

## Review Triage Log

*(empty — first implementation)*
