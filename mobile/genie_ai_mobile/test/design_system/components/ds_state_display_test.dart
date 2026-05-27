import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
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
        expect(find.byKey(const ValueKey('ds-state-spinner')), findsOneWidget);
      });

      testWidgets('renders customChild when provided', (tester) async {
        await tester.pumpWidget(
          testApp(
            DsStateDisplay(
              type: DsStateType.loading,
              customChild: Text('Loading...', key: const ValueKey('custom-loader')),
            ),
          ),
        );
        final child = tester.widget<Text>(
          find.byKey(const ValueKey('custom-loader')),
        );
        expect(child.data, 'Loading...');
        expect(find.byKey(const ValueKey('ds-state-spinner')), findsNothing);
      });
    });

    group('empty type', () {
      testWidgets('renders default icon and message', (tester) async {
        await tester.pumpWidget(
          testApp(DsStateDisplay(type: DsStateType.empty)),
        );
        final icon = tester.widget<Icon>(
          find.byKey(const ValueKey('ds-state-icon')),
        );
        expect(icon.icon, Icons.inbox_outlined);
        final message = tester.widget<Text>(
          find.byKey(const ValueKey('ds-state-message')),
        );
        expect(message.data, 'No data');
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
        final message = tester.widget<Text>(
          find.byKey(const ValueKey('ds-state-message')),
        );
        expect(message.data, 'Nothing here');
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
        final actionLabel = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(actionLabel.data, 'Retry');
        await tester.tap(find.byKey(const ValueKey('ds-state-action')));
        expect(actionFired, isTrue);
      });
    });

    group('error type', () {
      testWidgets('renders danger icon and message', (tester) async {
        await tester.pumpWidget(
          testApp(DsStateDisplay(type: DsStateType.error)),
        );
        final icon = tester.widget<Icon>(
          find.byKey(const ValueKey('ds-state-icon')),
        );
        expect(icon.icon, Icons.error_outline);
        final message = tester.widget<Text>(
          find.byKey(const ValueKey('ds-state-message')),
        );
        expect(message.data, 'Something went wrong');
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
        final message = tester.widget<Text>(
          find.byKey(const ValueKey('ds-state-message')),
        );
        expect(message.data, 'Custom error');
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
        final actionLabel = tester.widget<Text>(
          find.byKey(const ValueKey('ds-button-label')),
        );
        expect(actionLabel.data, 'Try Again');
        await tester.tap(find.byKey(const ValueKey('ds-state-action')));
        expect(actionFired, isTrue);
      });

      testWidgets('no action when actionLabel is null', (tester) async {
        await tester.pumpWidget(
          testApp(DsStateDisplay(type: DsStateType.error)),
        );
        expect(find.byKey(const ValueKey('ds-state-action')), findsNothing);
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
        final icon = tester.widget<Icon>(
          find.byKey(const ValueKey('ds-state-icon')),
        );
        expect(icon.icon, Icons.cloud_off);
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
        final icon = tester.widget<Icon>(
          find.byKey(const ValueKey('ds-state-icon')),
        );
        expect(icon.icon, Icons.warning);
      });
    });
  });
}
