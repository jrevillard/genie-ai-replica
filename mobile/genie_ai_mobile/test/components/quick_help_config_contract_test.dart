import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/quick_help_scope.dart';

/// The contract between the SHIPPED configuration and the code that
/// reads it. Issue #1124 was a silent divergence: the widget read an
/// `appearance` block that no shipped file declares, so every card
/// rendered blank while the unit tests stayed green. A hand-written
/// fixture moves with the code and cannot catch that class - this test
/// reads the real asset the app bundles.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Map<String, dynamic> config;

  setUpAll(() async {
    final raw = await rootBundle.loadString(
      'assets/config/genie-ai-config.json',
    );
    config = jsonDecode(raw) as Map<String, dynamic>;
  });

  group('the shipped Quick Help configuration', () {
    test('every button parses to a card the grid can show', () {
      final (layout, buttons) = parseQuickHelpConfig(config, 'en');

      // The grid's layout block: absent in the shipped file, and the
      // grid's own defaults take over.
      expect(layout, isEmpty);
      expect(buttons, isNotEmpty);

      for (final button in buttons) {
        // The card's LABEL: the top-level title locale map, resolved.
        expect(
          button['resolvedTitle'],
          isNotEmpty,
          reason: 'button ${button['id']} has no title',
        );
        // The card's ICON: the top-level icon, as a bundled asset that
        // actually loads (the pre-fix fallback named a file the app
        // never shipped).
        final iconAsset = button['iconAsset']?.toString() ?? '';
        expect(
          iconAsset,
          startsWith('assets/config/quickhelp/'),
          reason: 'button ${button['id']} has no bundled icon',
        );
        expect(
          () => rootBundle.loadString(iconAsset),
          returnsNormally,
          reason: 'button ${button['id']} names a missing asset',
        );
      }
    });
  });
}
