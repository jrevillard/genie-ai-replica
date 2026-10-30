import 'dart:convert';
import 'dart:io';

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
    test('every button parses to a card the grid can show', () async {
      final (layout, buttons) = parseQuickHelpConfig(config, 'en');

      // The grid's layout block: absent in the shipped file, and the
      // grid's own defaults take over.
      expect(layout, isEmpty);
      expect(buttons, isNotEmpty);

      // The shipped entries, read raw: the card the widget shows must
      // BE the shipped card, not merely a card with some text.
      final shipped =
          (config['features']['chat']['quickHelp']['buttons'] as List<dynamic>)
              .cast<Map<String, dynamic>>();

      for (var i = 0; i < buttons.length; i++) {
        final button = buttons[i];
        final raw = shipped.firstWhere(
          (entry) => entry['id'] == button['id'],
          orElse: () => <String, dynamic>{},
        );

        // The card's LABEL: the shipped title, resolved under English.
        expect(
          button['resolvedTitle'],
          raw['title']?['en'],
          reason: 'button ${button['id']} does not show the shipped title',
        );
        // The card's ICON: the shipped icon's basename, as a bundled
        // asset that actually loads (the pre-fix fallback named a file
        // the app never shipped).
        final iconAsset = button['iconAsset']?.toString() ?? '';
        final shippedFile = (raw['icon']?['value']?.toString() ?? '')
            .split('/')
            .last;
        expect(
          iconAsset,
          'assets/config/quickhelp/$shippedFile',
          reason: 'button ${button['id']} does not show the shipped icon',
        );
        // The asset must LOAD: an async call cannot throw
        // synchronously, so the explicit form is the awaited future.
        await expectLater(
          rootBundle.loadString(iconAsset),
          completes,
          reason: 'button ${button['id']} names a missing asset',
        );
      }
    });
  });

  /// The widget's OWN read of the button, not the parse's. The bug of
  /// issue #1124 lived here - the grid read `button['appearance']`
  /// while the parse was correct - and a widget test would bind it
  /// (#1191). Until that harness exists, this is the cheapest guard
  /// that fails when the contract changes: the shipped key is the one
  /// the grid must read, and the block that does not exist must not be
  /// read.
  group('the chat widget reads the shipped shape', () {
    test('the grid does not read the appearance block', () {
      final source = File(
        'lib/components/chat/chatbot_component.dart',
      ).readAsStringSync();

      expect(
        source.contains("['appearance']"),
        isFalse,
        reason: 'the widget must not read the appearance block again',
      );
    });

    test('the grid reads the title the parse resolved', () {
      final source = File(
        'lib/components/chat/chatbot_component.dart',
      ).readAsStringSync();

      expect(
        source.contains('quickHelpTitleOf(button)'),
        isTrue,
        reason: 'the grid card must show the resolved title',
      );
    });
  });
}
