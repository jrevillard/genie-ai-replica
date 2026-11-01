import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/quick_help_scope.dart';

/// The contract between the MOBILE'S BUNDLED configuration and the code
/// that reads it. Issue #1124 was a silent divergence: the widget read
/// an `appearance` block that no shipped file declares, so every card
/// rendered blank while the unit tests stayed green. A hand-written
/// fixture moves with the code and cannot catch that class - this test
/// reads the real asset the app bundles.
///
/// The configuration a DEPLOYMENT ships is the web's runtime file
/// (`components/gov-chat-frontend/public/config/`), and the mobile app
/// never reads it: the two are separate artifacts (the gap is tracked
/// in #1211).
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
        // The shipped shape is a locale map; a scalar is a legal title
        // too (resolveConfigText reads one), so it is compared as
        // itself - a shape change FAILS the assertion, it does not
        // throw on the dynamic read.
        final shippedTitle = raw['title'];
        final expectedTitle = shippedTitle is Map
            ? shippedTitle['en']
            : shippedTitle;
        expect(
          button['resolvedTitle'],
          expectedTitle,
          reason: 'button ${button['id']} does not show the shipped title',
        );
        // The card's ICON: the shipped icon's basename, as a bundled
        // asset that actually loads (the pre-fix fallback named a file
        // the app never shipped). A card that declares NO icon carries
        // no asset - the neutral help icon is the contract for it.
        final iconAsset = button['iconAsset']?.toString() ?? '';
        final shippedValue = raw['icon']?['value']?.toString() ?? '';
        if (shippedValue.isEmpty) {
          expect(
            iconAsset,
            isEmpty,
            reason: 'button ${button['id']} declares no icon',
          );
          continue;
        }
        expect(
          iconAsset,
          'assets/config/quickhelp/${shippedValue.split('/').last}',
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
  /// that fails when the contract changes. Two regions, because the
  /// bug had two halves in different places:
  ///
  /// - the RAW config blocks (`appearance`, `action`) must not be read
  ///   ANYWHERE in the widget: the parse owns them, and the press
  ///   path sits far above the grid;
  /// - the grid's card must read the title the parse resolved, scoped
  ///   to the grid itself: a whole-file grep was satisfied by two
  ///   unrelated call sites, and the raw `title` key IS read from
  ///   other maps elsewhere in the file (a conversation's title).
  ///
  /// A source guard has limits a behaviour test does not: it greps
  /// text, and a string literal containing `//` truncates the comment
  /// strip from there (it can miss a violation on that line; it
  /// cannot invent one). #1191 replaces this group.
  group('the chat widget reads the shipped shape', () {
    /// The source with comments stripped: a guard that can be
    /// satisfied by a comment proves nothing (the mutation that
    /// silenced the grid's title read left the identifier in a
    /// neighbouring comment and the guard stayed green).
    String stripComments(String source) {
      return source
          .replaceAll(RegExp(r'///[^\n]*'), '')
          .replaceAll(RegExp(r'//[^\n]*'), '')
          .replaceAll(RegExp(r'/\*[\s\S]*?\*/'), '');
    }

    String sourceOf() =>
        File('lib/components/chat/chatbot_component.dart').readAsStringSync();

    /// The GRID's card only: from the file's single `GridView.builder(`
    /// to the next section marker. Bounded on both ends, because the
    /// dialogs below the grid read their own maps and are not this
    /// contract.
    String gridCode() {
      final source = sourceOf();
      final start = source.indexOf('GridView.builder(');
      expect(
        start,
        greaterThanOrEqualTo(0),
        reason: 'the grid is gone from the widget',
      );
      expect(
        source.indexOf('GridView.builder(', start + 1),
        -1,
        reason: 'a second grid exists - the guard must name its own',
      );
      final end = source.indexOf('// Confirm Dialogs & Save/Export Alerts');
      expect(
        end,
        greaterThan(start),
        reason: 'the section after the grid is gone - re-bound the guard',
      );
      return stripComments(source.substring(start, end));
    }

    test('the widget does not read the raw config blocks', () {
      expect(
        RegExp(
          r'\[\s*[\x27\x22](appearance|action)[\x27\x22]\s*\]',
        ).hasMatch(stripComments(sourceOf())),
        isFalse,
        reason:
            'the parse owns the raw blocks; the widget reads what it '
            'resolved (the grid AND the press path)',
      );
    });

    test('the grid reads the title the parse resolved', () {
      expect(
        RegExp(r'quickHelpTitleOf\s*\(\s*button\s*\)').hasMatch(gridCode()),
        isTrue,
        reason: 'the grid card must show the resolved title',
      );
    });

    test('the grid does not read the raw title key', () {
      expect(
        RegExp(r'\[\s*[\x27\x22]title[\x27\x22]\s*\]').hasMatch(gridCode()),
        isFalse,
        reason: 'the raw title is a locale map, not a label',
      );
    });
  });
}
