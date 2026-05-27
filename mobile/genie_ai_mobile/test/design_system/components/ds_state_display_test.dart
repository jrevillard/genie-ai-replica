import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_spinner.dart';
import 'package:genie_ai_mobile/design_system/components/ds_state_display.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

void main() {
  setUp(setupLightTokens);
  tearDown(resetThemeManager);

  group('DsStateDisplay', () {
    group('loading type', () {
      testWidgets('renders DsSpinner by default', (tester) async {
        await tester.pumpWidget(
          testApp(DsStateDisplay(type: DsStateType.loading)),
        );
        expect(find.byType(DsSpinner), findsOneWidget);
      });

      testWidgets('renders customChild when provided', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.loading,
              customChild: Text('Loading...'),
            ),
          ),
        );
        expect(find.text('Loading...'), findsOneWidget);
        expect(find.byType(DsSpinner), findsNothing);
      });
    });

    group('empty type', () {
      testWidgets('renders default icon and message', (tester) async {
        await tester.pumpWidget(
          testApp(DsStateDisplay(type: DsStateType.empty)),
        );
        expect(find.byIcon(Icons.inbox_outlined), findsOneWidget);
        expect(find.text('No data'), findsOneWidget);
      });

      testWidgets('renders custom message', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.empty,
              message: 'Nothing here',
            ),
          ),
        );
        expect(find.text('Nothing here'), findsOneWidget);
      });

      testWidgets('renders action button when provided', (tester) async {
        var actionFired = false;
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.empty,
              actionLabel: 'Retry',
              onAction: () => actionFired = true,
            ),
          ),
        );
        expect(find.text('Retry'), findsOneWidget);
        await tester.tap(find.text('Retry'));
        expect(actionFired, isTrue);
      });
    });

    group('error type', () {
      testWidgets('renders danger icon and message', (tester) async {
        await tester.pumpWidget(
          testApp(DsStateDisplay(type: DsStateType.error)),
        );
        expect(find.byIcon(Icons.error_outline), findsOneWidget);
        expect(find.text('Something went wrong'), findsOneWidget);
      });

      testWidgets('renders custom message', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.error,
              message: 'Custom error',
            ),
          ),
        );
        expect(find.text('Custom error'), findsOneWidget);
      });

      testWidgets('renders action button', (tester) async {
        var actionFired = false;
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.error,
              actionLabel: 'Try Again',
              onAction: () => actionFired = true,
            ),
          ),
        );
        expect(find.text('Try Again'), findsOneWidget);
        await tester.tap(find.text('Try Again'));
        expect(actionFired, isTrue);
      });

      testWidgets('no action when actionLabel is null', (tester) async {
        await tester.pumpWidget(
          testApp(DsStateDisplay(type: DsStateType.error)),
        );
        // Should not find any DsButton in error state without action
        // The error state without actionLabel/onAction has no DsButton
        final dsButtons = find.byType(DsButton);
        // dsButtons evaluates to zero since no actionLabel provided
        expect(dsButtons.evaluate().isEmpty, isTrue);
      });
    });

    group('custom icon', () {
      testWidgets('overrides default icon for empty state', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.empty,
              icon: Icons.cloud_off,
            ),
          ),
        );
        expect(find.byIcon(Icons.cloud_off), findsOneWidget);
        expect(find.byIcon(Icons.inbox_outlined), findsNothing);
      });

      testWidgets('overrides default icon for error state', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.error,
              icon: Icons.warning,
            ),
          ),
        );
        expect(find.byIcon(Icons.warning), findsOneWidget);
      });
    });
  });
}
