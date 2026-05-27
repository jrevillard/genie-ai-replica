# Story 1.11: Test Flutter Design System and Core Components

Status: ready-for-dev

## Story

As a developer,
I want comprehensive widget test coverage for the Flutter design system components, tokens, and core shared components,
So that the UI component library is validated against regressions and widget tests establish patterns for future component testing.

## Acceptance Criteria

1. **AC1**: `ds_button.dart` — test all 4 variants (primary, secondary, ghost, danger), both sizes (small/large), disabled state, icon-only mode, icon+label combo, label-only, and color overrides
2. **AC2**: `ds_card.dart` — test all 4 variants (standard, flat, elevated, outline), custom padding/radius, and color overrides
3. **AC3**: `ds_input.dart` — test all 3 sizes (sm, md, lg), enabled/disabled states, obscure text, multiline, prefix icon, suffix widget, placeholder text, and border color overrides
4. **AC4**: `ds_modal.dart` — test all 4 sizes (sm, md, lg, xl), with/without actions, title rendering, content scrolling, and the static `DsModal.show()` method
5. **AC5**: `ds_spinner.dart` — test all 3 sizes (sm, md, lg), custom color, and custom stroke width
6. **AC6**: `ds_state_display.dart` — test all 3 state types (empty, error, loading), custom messages/icons, action button rendering, and custom loading child
7. **AC7**: `color_utils.dart` — test `parseHex`, `parseHexNullable`, `toHex`, `lighten`, `darken`, `brandTinted`, and `withAlpha`
8. **AC8**: `app_tokens.dart` — test `fromConfig` factory for light mode, dark mode, custom brand color, custom navbar config, typography scale, and alpha helper getters
9. **AC9**: `confirm_dialog.dart` — test visibility toggle, default i18n texts, custom texts, confirm/cancel callbacks, and secondary action button
10. **AC10**: `language_selector.dart` — test dropdown renders supported languages, language change callback, and custom colors
11. **AC11**: All existing tests pass (no regressions in `test/services/`, `test/config/`)
12. **AC12**: Coverage increases from ~76.9% to ~82% (target: +5 percentage points)
13. **AC13**: All tests run successfully in CI pipeline (`flutter test`)
14. **AC14**: Shared widget test helper established at `test/helpers/` for ThemeManager setup and widget wrapper

## Tasks / Subtasks

- [ ] Task 1: Create shared widget test helpers (AC: #14)
  - [ ] Create `test/helpers/test_app.dart` — wrapper widget that initializes ThemeManager with test config
  - [ ] Create `test/helpers/theme_helper.dart` — factory functions for test tokens (light, dark, custom brand)
  - [ ] Create `test/helpers/tokens.dart` — sample config maps for testing

- [ ] Task 2: Test `color_utils.dart` (AC: #7)
  - [ ] `parseHex` — 3-digit, 6-digit, 8-digit (ARGB), invalid input throws
  - [ ] `parseHexNullable` — null, non-string, invalid hex returns null
  - [ ] `toHex` — roundtrip with `parseHex`
  - [ ] `lighten` / `darken` — verify HSL lightness changes
  - [ ] `brandTinted` — verify HSL lightness + saturation application
  - [ ] `withAlpha` — verify alpha channel
  - [ ] `toPdfColor` — verify RGB normalization (0–1 range)

- [ ] Task 3: Test `app_tokens.dart` (AC: #8)
  - [ ] `fromConfig` light mode with defaults
  - [ ] `fromConfig` dark mode with defaults
  - [ ] Custom brand color overrides
  - [ ] Custom navbar background/text colors
  - [ ] Custom success/warning/danger/info colors
  - [ ] Font scale multiplication on typography getters
  - [ ] Alpha helper getters (fg70, fg50, muted50, accent10, scrim)

- [ ] Task 4: Test `ds_button.dart` (AC: #1)
  - [ ] Each variant renders with correct background/foreground colors
  - [ ] Small vs default height (36 vs 48)
  - [ ] Disabled state — onPressed is null
  - [ ] Icon-only mode renders IconButton
  - [ ] Icon + label renders Row with Icon + Text
  - [ ] Label-only renders Text
  - [ ] Color overrides (overrideBg, overrideFg)
  - [ ] onPressed callback fires on tap

- [ ] Task 5: Test `ds_card.dart` (AC: #2)
  - [ ] Each variant renders with correct background, border, elevation
  - [ ] Custom padding applied
  - [ ] Custom radius applied
  - [ ] Custom background/border color overrides
  - [ ] Child widget rendered

- [ ] Task 6: Test `ds_input.dart` (AC: #3)
  - [ ] Each size has correct height (36, 44, 52)
  - [ ] Placeholder text displayed
  - [ ] Enabled/disabled state
  - [ ] obscureText mode
  - [ ] Multiline mode (maxLines > 1, height unconstrained)
  - [ ] Prefix icon rendered
  - [ ] Suffix widget rendered
  - [ ] onChanged callback fires on text entry
  - [ ] Color overrides applied

- [ ] Task 7: Test `ds_modal.dart` (AC: #4)
  - [ ] Each size sets correct maxWidth constraint (360, 480, 640, 800)
  - [ ] Title text rendered
  - [ ] Content widget rendered in scrollable area
  - [ ] Actions rendered in footer row
  - [ ] No actions — footer section omitted
  - [ ] `DsModal.show()` displays dialog via `showDialog`

- [ ] Task 8: Test `ds_spinner.dart` (AC: #5)
  - [ ] Each size sets correct dimension (16, 24, 40)
  - [ ] Default color uses tokens.accent
  - [ ] Custom color override
  - [ ] Custom strokeWidth override
  - [ ] CircularProgressIndicator is rendered

- [ ] Task 9: Test `ds_state_display.dart` (AC: #6)
  - [ ] Loading type — renders DsSpinner
  - [ ] Loading type with customChild — renders custom widget
  - [ ] Empty type — renders default icon + message + optional action
  - [ ] Error type — renders danger icon + message + optional action
  - [ ] Custom icon override
  - [ ] Custom message override
  - [ ] Action button fires callback

- [ ] Task 10: Test `confirm_dialog.dart` (AC: #9)
  - [ ] `visible: false` renders SizedBox.shrink
  - [ ] `visible: true` renders dialog with title, message, buttons
  - [ ] Default texts via i18n (tr('common.confirm'), tr('common.ok'), tr('common.cancel'))
  - [ ] Custom confirmText/cancelText/secondaryText
  - [ ] onConfirm callback fires on confirm button tap
  - [ ] onCancel callback fires on cancel button tap
  - [ ] onSecondary callback fires on secondary button tap

- [ ] Task 11: Test `language_selector.dart` (AC: #10)
  - [ ] Dropdown renders with current locale selected
  - [ ] All supported languages appear as dropdown items
  - [ ] onChanged callback fires on selection
  - [ ] Custom textColor applied to items
  - [ ] Custom dropdownColor applied

- [ ] Task 12: Verify all existing tests pass (AC: #11)
  - [ ] Run `flutter test` — all tests pass with 0 failures
  - [ ] No regressions in existing service/config tests

- [ ] Task 13: Verify coverage (AC: #12, #13)
  - [ ] Run `flutter test --coverage` — coverage >= 82%
  - [ ] Verify all tests pass in CI pipeline format

## Dev Notes

### Architecture — Design System Structure

```
lib/design_system/
├── tokens/
│   ├── app_tokens.dart          # 230 lines — Color tokens + typography scale
│   ├── color_utils.dart         # 73 lines  — Hex parsing, HSL manipulation
│   ├── spacing.dart             # 9 lines   — DsSpacing constants
│   └── radii.dart               # 6 lines   — DsRadii constants
├── theme/
│   └── app_theme.dart           # 185 lines — ThemeData builder from AppTokens
└── components/
    ├── ds_button.dart           # 130 lines — 4 variants, icon-only, 2 sizes
    ├── ds_card.dart             # 63 lines  — 4 variants, padding/radius/color
    ├── ds_input.dart            # 114 lines — 3 sizes, multiline, prefix/suffix
    ├── ds_modal.dart            # 103 lines — 4 sizes, static show(), actions
    ├── ds_spinner.dart          # 46 lines  — 3 sizes, custom color/stroke
    └── ds_state_display.dart    # 103 lines — empty/error/loading states

lib/utils/theme_manager.dart     # 122 lines — Singleton, ChangeNotifier, persistence
lib/components/shared/
    ├── confirm_dialog.dart      # 137 lines — Visibility-controlled dialog
    └── language_selector.dart   # 61 lines  — I18nService-driven dropdown
```

### Critical: ThemeManager is a Singleton

All DS components access `ThemeManager().tokens` directly. This is a singleton (`factory constructor → _instance`). Widget tests must call `setConfiguration()` before pumping widgets, otherwise tokens are uninitialized.

```dart
// CORRECT — initialize before testing
final tm = ThemeManager();
tm.setConfiguration({'theme': {}}); // triggers _rebuildTokens

// WRONG — tokens are null/uninitialized
await tester.pumpWidget(DsButton(label: 'Test'));
```

### ThemeManager TearDown

Since ThemeManager is a singleton, state leaks between tests. Reset in `tearDown`:

```dart
tearDown(() {
  final tm = ThemeManager();
  tm.setTheme('light');
  tm.setFontSize(50.0);
  tm.setConfiguration({});
});
```

### Widget Test Wrapper Pattern

Create a `testApp()` helper that wraps any widget with the correct Material + Theme context:

```dart
Widget testApp(Widget child) {
  return MaterialApp(
    theme: ThemeManager().lightTheme,
    home: Scaffold(body: child),
  );
}
```

This is needed because DS components use `ThemeManager().tokens` (not `Theme.of(context)`), so the MaterialApp is mainly for Scaffold/Directionality context.

### No Mockito — Use Manual Mocks

The project has NO mockito/mocktail in dev_dependencies. Follow the existing pattern from `auth_notifier_test.dart` — manual mock classes implementing interfaces. For widget tests, use simple callback recording:

```dart
var pressed = false;
await tester.pumpWidget(testApp(
  DsButton(label: 'Click', onPressed: () => pressed = true),
));
await tester.tap(find.text('Click'));
expect(pressed, isTrue);
```

### I18nService is a Singleton

`LanguageSelector` and `ConfirmDialog` use `I18nService()` and `tr()`. The I18nService singleton must be initialized before tests. If `tr()` fails in test context, mock or skip i18n-dependent assertions.

### DS Component Color Resolution

Colors are resolved via `ThemeManager().tokens` at build time. For color assertions, compare against the known test tokens rather than exact Color values:

```dart
final tokens = ThemeManager().tokens;
// verify the widget exists and type is correct
expect(find.byType(ElevatedButton), findsOneWidget);
// color verification is indirect — the component calls tokens.accent internally
```

### DsModal.show() Testing

The static `show()` method calls `showDialog()`. Test it by pumping a MaterialApp with a button that triggers the modal:

```dart
await tester.pumpWidget(MaterialApp(
  home: Scaffold(
    body: Builder(builder: (ctx) => TextButton(
      onPressed: () => DsModal.show(
        context: ctx,
        title: 'Test',
        content: Text('Body'),
      ),
      child: Text('Open'),
    )),
  ),
));
await tester.tap(find.text('Open'));
await tester.pumpAndSettle();
expect(find.text('Test'), findsOneWidget);
```

### ConfirmDialog — Not a Route Dialog

`ConfirmDialog` is NOT a dialog shown via `showDialog()`. It's a visibility-gated widget that renders inline. Test by pumping it directly:

```dart
await tester.pumpWidget(testApp(
  ConfirmDialog(
    visible: true,
    onConfirm: () {},
    onCancel: () {},
  ),
));
expect(find.byType(ConfirmDialog), findsOneWidget);
```

### Coverage Strategy

Current coverage: ~76.9% (286 tests). Target: ~82%. The DS components and token system are small, high-value files. Focus on:
- `color_utils.dart` — 7 static methods, 73 lines — high ROI
- `app_tokens.dart` — fromConfig factory, 230 lines — high ROI
- `ds_button.dart` — most complex DS component with 4 variants
- Skip `app_theme.dart` — it builds ThemeData, which is integration-level (verified indirectly through component tests)

### Test File Organization

```
test/
├── helpers/
│   ├── test_app.dart              # NEW — widget test wrapper
│   ├── theme_helper.dart          # NEW — ThemeManager test setup
│   └── tokens.dart                # NEW — sample config maps
├── design_system/
│   ├── tokens/
│   │   ├── color_utils_test.dart   # NEW
│   │   └── app_tokens_test.dart    # NEW
│   └── components/
│       ├── ds_button_test.dart     # NEW
│       ├── ds_card_test.dart       # NEW
│       ├── ds_input_test.dart      # NEW
│       ├── ds_modal_test.dart      # NEW
│       ├── ds_spinner_test.dart    # NEW
│       └── ds_state_display_test.dart # NEW
├── components/
│   └── shared/
│       ├── confirm_dialog_test.dart  # NEW
│       └── language_selector_test.dart # NEW
├── services/                      # EXISTING — 13 test files
└── config/                        # EXISTING — 1 test file
```

### What NOT to Test

- **AppTheme.build()** — Integration-level, verified indirectly through DS component rendering
- **DsSpacing / DsRadii** — Pure constants, no logic to test
- **ThemeManager persistence** — SharedPreferences requires platform channel, deferred to integration tests
- **ThemeManager.restorePreferences()** — Requires SharedPreferences plugin, platform-dependent
- **ColorUtils.toPdfColor()** — Requires `pdf` package which needs platform setup; verify RGB math only if feasible

### Previous Story Learnings (1-10)

- 88 new tests added across 8 files, all 286 tests pass
- Manual mocks preferred (no mockito) — project has no mock framework
- `setUp()`/`tearDown()` mandatory for singletons (I18nService, GenieAiConfig, ThemeManager)
- Flutter test env: `rootBundle` uses `TestAssetBundle`, `SharedPreferences` requires plugin mocking
- Coverage measurement: `flutter test --coverage` + `lcov`/`genhtml`
- CI pipeline dynamically reports coverage without hardcoded thresholds
- Test execution: ~60 seconds for 286 tests (well within 10-minute CI budget)

### CI Integration

Flutter tests run in CI via the `test:mobile` job (or similar):
```bash
flutter test --machine | tojunit --output reports/flutter-report.xml
```

All new widget tests must pass via `flutter test` locally and in CI. No additional CI configuration needed — the job runs the full test suite.

### Project Structure Notes

- Test directory mirrors `lib/` structure: `test/design_system/tokens/`, `test/design_system/components/`, `test/components/shared/`
- Widget tests use `testWidgets()` from `flutter_test`
- Unit tests for pure Dart classes (ColorUtils, AppTokens) use `test()` from `flutter_test`
- All imports use package path: `package:genie_ai_mobile/design_system/...`

### References

- [Source: mobile/genie_ai_mobile/lib/design_system/components/ds_button.dart]
- [Source: mobile/genie_ai_mobile/lib/design_system/components/ds_card.dart]
- [Source: mobile/genie_ai_mobile/lib/design_system/components/ds_input.dart]
- [Source: mobile/genie_ai_mobile/lib/design_system/components/ds_modal.dart]
- [Source: mobile/genie_ai_mobile/lib/design_system/components/ds_spinner.dart]
- [Source: mobile/genie_ai_mobile/lib/design_system/components/ds_state_display.dart]
- [Source: mobile/genie_ai_mobile/lib/design_system/tokens/app_tokens.dart]
- [Source: mobile/genie_ai_mobile/lib/design_system/tokens/color_utils.dart]
- [Source: mobile/genie_ai_mobile/lib/utils/theme_manager.dart]
- [Source: mobile/genie_ai_mobile/lib/components/shared/confirm_dialog.dart]
- [Source: mobile/genie_ai_mobile/lib/components/shared/language_selector.dart]
- [Source: mobile/genie_ai_mobile/CLAUDE.md — Design System section]
- [Source: _bmad-output/implementation-artifacts/1-10-test-flutter-service-layer.md — previous story learnings]
- [Source: _bmad-output/project-context.md — Mobile testing rules]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
