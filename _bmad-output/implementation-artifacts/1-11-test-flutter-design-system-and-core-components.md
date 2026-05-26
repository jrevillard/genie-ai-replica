# Story 1-11: Test Flutter Design System and Core Components

Status: backlog

## Story

As a developer,
I want comprehensive widget test coverage for the design system and core UI components,
So that UI rendering and user interactions are validated and visual regressions are prevented.

## Acceptance Criteria

1. **AC1**: DS Button — test all variants (primary, secondary, ghost, danger), sizes (sm, md, lg), disabled state, loading state, and onTap callback
2. **AC2**: DS Input — test text input, validation error display, disabled state, obscure text (password mode), and onChanged callback
3. **AC3**: DS Modal — test visibility, title rendering, content display, action buttons (confirm/cancel), and close behavior (tap outside, close button)
4. **AC4**: DS Card — test variants (elevated, outlined, flat), padding configuration, child rendering, and onTap behavior
5. **AC5**: DS Spinner — test all sizes (sm, md, lg), overlay mode (full-screen vs inline), and color customization
6. **AC6**: DS StateDisplay — test empty state (icon + message), loading state (spinner + message), and error state (error icon + message + retry action)
7. **AC7**: Theme and tokens — test `AppTheme` generation (light/dark themes), `ColorUtils` (fromHex, withOpacity), and token constants (spacing, radii, breakpoints)
8. **AC8**: Shared components — test `ConfirmDialog` (title, message, actions), `LanguageSelector` (language list, selection callback), and `NavBarComponent` (tab navigation)
9. **AC9**: Config — test `dev_config.dart`, `staging_config.dart`, and `flavors/template.dart` for correct environment values
10. **AC10**: All existing tests pass (no regressions in widget tests)
11. **AC11**: Coverage increases from ~75% to ~80% (target: +5 percentage points)

## Tasks / Subtasks

- [ ] Task 1: Create test file for DS Button (`lib/ui/design_system/ds_button.dart`)
  - [ ] Test primary variant renders with correct colors
  - [ ] Test secondary variant renders with correct colors
  - [ ] Test ghost variant renders with correct colors
  - [ ] Test danger variant renders with correct colors
  - [ ] Test size variants (sm, md, lg) affect padding/font size
  - [ ] Test disabled state (grayed out, no callback)
  - [ ] Test loading state (spinner visible, no callback)
  - [ ] Test onTap callback invoked on tap
  - [ ] Test icon rendering (left/right icons)
- [ ] Task 2: Create test file for DS Input (`lib/ui/design_system/ds_input.dart`)
  - [ ] Test label rendering
  - [ ] Test text input and onChanged callback
  - [ ] Test validation error display (error text color, icon)
  - [ ] Test disabled state (no keyboard input, grayed out)
  - [ ] Test obscure text (password mode, toggle visibility)
  - [ ] Test placeholder/hint text
  - [ ] Test max lines and character counter
- [ ] Task 3: Create test file for DS Modal (`lib/ui/design_system/ds_modal.dart`)
  - [ ] Test modal visibility (show/hide)
  - [ ] Test title rendering
  - [ ] Test content display (custom widget)
  - [ ] Test action buttons (confirm/cancel callbacks)
  - [ ] Test close behavior (tap outside dismisses)
  - [ ] Test close button (X icon) dismisses modal
  - [ ] Test modal size variants (sm, md, lg, full)
- [ ] Task 4: Create test file for DS Card (`lib/ui/design_system/ds_card.dart`)
  - [ ] Test elevated variant (shadow, border)
  - [ ] Test outlined variant (border, no shadow)
  - [ ] Test flat variant (no border, no shadow)
  - [ ] Test padding configuration (default, custom)
  - [ ] Test child rendering
  - [ ] Test onTap behavior (callback invoked)
  - [ ] Test custom background color
- [ ] Task 5: Create test file for DS Spinner (`lib/ui/design_system/ds_spinner.dart`)
  - [ ] Test size variants (sm, md, lg) render different dimensions
  - [ ] Test inline mode (spinner without overlay)
  - [ ] Test overlay mode (full-screen with backdrop)
  - [ ] Test custom color (applies to spinner)
  - [ ] Test overlay backdrop color and opacity
- [ ] Task 6: Create test file for DS StateDisplay (`lib/ui/design_system/ds_state_display.dart`)
  - [ ] Test empty state (icon + message)
  - [ ] Test loading state (spinner + message)
  - [ ] Test error state (error icon + message)
  - [ ] Test retry action (error state with button)
  - [ ] Test custom icons and messages
  - [ ] Test action callback invocation
- [ ] Task 7: Create test file for theme and tokens
  - [ ] Test `AppTheme.lightTheme` generates correct ThemeData
  - [ ] Test `AppTheme.darkTheme` generates correct ThemeData
  - [ ] Test `ColorUtils.fromHex` parses hex strings
  - [ ] Test `ColorUtils.withOpacity` adds transparency
  - [ ] Test spacing constants (AppTokens) match design spec
  - [ ] Test radii constants (border radius tokens)
  - [ ] Test breakpoint constants (responsive design)
- [ ] Task 8: Create test file for shared components
  - [ ] Test `ConfirmDialog` (title, message, confirm/cancel callbacks)
  - [ ] Test `LanguageSelector` (language list rendering, selection callback)
  - [ ] Test `NavBarComponent` (tab navigation, active tab highlighting)
- [ ] Task 9: Create test file for config files
  - [ ] Test `dev_config.dart` has correct dev environment values
  - [ ] Test `staging_config.dart` has correct staging environment values
  - [ ] Test `flavors/template.dart` provides config template
- [ ] Task 10: Verify all existing tests still pass
  - [ ] Run tests locally: `flutter test`
  - [ ] Run widget tests specifically: `flutter test test/widget/`
  - [ ] Check coverage report: `flutter test --coverage`
  - [ ] Fix any regressions introduced by new tests
- [ ] Task 11: Update CI pipeline expectations
  - [ ] Verify coverage threshold increased to 80%
  - [ ] Ensure widget test execution time remains acceptable
  - [ ] Document any test utilities or helpers created

## Dev Notes

**Test Patterns:**
- Use `testWidgets()` for all widget tests (design system components are UI widgets)
- Wrap widgets in `MaterialApp` or `WidgetTester.pumpWidget()` for proper theme/context
- Use `Finder` APIs (`find.byType`, `find.byKey`, `find.text`) to locate widgets
- Use `expect()` to verify widget properties, visibility, and callbacks

**Widget Testing Best Practices:**
- Test behavior (callbacks, state changes) rather than exact pixel rendering
- Use `pump()` and `pumpAndSettle()` for async operations (animations, futures)
- Test user interactions with `tap()`, `enterText()`, `drag()`
- Use `tester.widget<E>()` to inspect widget properties
- For modal testing, verify `Navigator` state changes

**Key Finding Strategies:**
- `find.byType(DsButton)` — find widget by type
- `find.byKey(Key('my-widget'))` — find widget by key (add keys to components if needed)
- `find.text('Submit')` — find widget by text content
- `find.byIcon(Icons.close)` — find widget by icon

**Theme Testing:**
- Verify `ThemeData` properties (colorScheme, textTheme, etc.)
- Test theme switching (light/dark) affects widget rendering
- Use `Theme.of(tester.element)` to access theme in tests
- For design tokens, test that constants match expected values

**Coverage Tracking:**
- Focus on testing interactive components (buttons, inputs, modals)
- For visual-only components (icons, spacing), test configuration and rendering
- Test error states and edge cases (empty data, disabled states)
- Exclude purely visual variations from coverage (e.g., all color combinations)

**Common Pitfalls:**
- Always use `pumpAndSettle()` after async operations (modals, dialogs)
- For overlay widgets (modal, spinner), test both overlay and inline modes
- Use `expect(find.byType(DsButton), findsOneWidget)` to verify widget presence
- Test callbacks using mock functions or state tracking variables
- For form inputs, test validation error states explicitly

**Test Utilities:**
- Create helper functions to wrap common widget setups (e.g., `pumpDsButton()`)
- Use `testWidgets()` with descriptive descriptions for each test case
- Group related tests using `groupWidgets()` (or `group()` with testWidgets)
- Use `setUp()` and `tearDown()` for shared test initialization/cleanup

**CI Integration:**
- Widget tests run in GitHub Actions Flutter job
- Coverage threshold will be updated after completion
- All widget tests should complete within 15 minutes (CI timeout)
- Consider splitting into multiple test files if execution time is too high

## Change Log
