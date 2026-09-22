import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';

/// Quick-help buttons must derive their retriever filter labels exactly as the
/// Vue client does. An empty label list is not "no matching content" but
/// "no filter" — the retriever then searches the whole corpus and the answer
/// gets grounded in an unrelated topic (issue #1000).
void main() {
  group('quickHelpServiceLabels', () {
    test('uses explicit non-empty serviceLabels as-is', () {
      final labels = quickHelpServiceLabels(<String, dynamic>{
        'id': 'grow-fruits-veggies',
        'serviceLabels': <dynamic>['Tomato', 'Onion'],
      });
      expect(labels, <String>['Tomato', 'Onion']);
    });

    // The exact shape that shipped broken in #1000: `_loadQuickHelpConfig`
    // projects each config button into a new map, so by the time
    // `_quickHelpPressed` runs, an absent `serviceLabels` key may have become
    // an EMPTY list. Forwarding that empty list disables the retriever filter.
    test('falls back to the button id for an empty list, never sending it', () {
      final labels = quickHelpServiceLabels(<String, dynamic>{
        'id': 'manage-poultry-pigs',
        'serviceLabels': <dynamic>[],
      });
      expect(labels, <String>['manage-poultry-pigs']);
    });

    test('falls back to the button id when serviceLabels is absent', () {
      final labels = quickHelpServiceLabels(<String, dynamic>{
        'id': 'manage-poultry-pigs',
      });
      expect(labels, <String>['manage-poultry-pigs']);
    });

    test('falls back to the button id when serviceLabels is null', () {
      final labels = quickHelpServiceLabels(<String, dynamic>{
        'id': 'start-manage-apiary',
        'serviceLabels': null,
      });
      expect(labels, <String>['start-manage-apiary']);
    });

    test('falls back to the English title when there is no id', () {
      final labels = quickHelpServiceLabels(<String, dynamic>{
        'title': <String, dynamic>{'en': 'No Id Button', 'es': 'Sin Id'},
      });
      expect(labels, <String>['No Id Button']);
    });

    test('coerces non-string label entries to strings', () {
      final labels = quickHelpServiceLabels(<String, dynamic>{
        'serviceLabels': <dynamic>[1, 'Tomato'],
      });
      expect(labels, <String>['1', 'Tomato']);
    });
  });

  group('shipped quick-help config', () {
    // Regression guard for the whole class of bug: every button the user can
    // tap must send a non-empty filter, except Just Chat, which clears the
    // filters by design and sends no query of its own.
    test('every button except just-chat yields a non-empty label list', () {
      final file = File('assets/config/genie-ai-config.json');
      expect(
        file.existsSync(),
        isTrue,
        reason: 'config must be at assets/config/genie-ai-config.json',
      );

      final config =
          jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      final buttons =
          (config['features']['chat']['quickHelp']['buttons'] as List)
              .cast<Map<String, dynamic>>();

      expect(buttons, isNotEmpty);

      final empties = <String>[];
      for (final button in buttons) {
        if (button['id'] == 'just-chat') continue;
        if (button['hidden'] == true) continue;
        if (quickHelpServiceLabels(button).isEmpty) {
          empties.add(button['id'].toString());
        }
      }

      expect(
        empties,
        isEmpty,
        reason:
            'These quick-help buttons would send an empty serviceLabels '
            'list, disabling the retriever filter and grounding the answer in '
            'the whole corpus (issue #1000): $empties',
      );
    });

    // The raw-JSON guard above is NOT sufficient on its own — that was the hole
    // that let #1000 ship. `_quickHelpPressed` never sees the raw JSON: it sees
    // the map produced by `_loadQuickHelpConfig`, so drain the shipped config
    // through that projection first and assert on what the button actually
    // sends over the wire.
    test('every button survives the config-loader projection', () {
      final file = File('assets/config/genie-ai-config.json');
      final config =
          jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      final buttons =
          (config['features']['chat']['quickHelp']['buttons'] as List)
              .cast<Map<String, dynamic>>();

      final empties = <String>[];
      for (final button in buttons) {
        if (button['id'] == 'just-chat') continue;
        if (button['action'] == null || (button['action'] as Map).isEmpty) {
          continue; // chat-only buttons never reach _quickHelpPressed
        }

        // Mirror the loader's projection: an absent key becomes an empty list.
        final projected = <String, dynamic>{
          'id': button['id'],
          'serviceLabels':
              (button['serviceLabels'] as List<dynamic>?) ?? const <dynamic>[],
        };

        if (quickHelpServiceLabels(projected).isEmpty) {
          empties.add(button['id'].toString());
        }
      }

      expect(
        empties,
        isEmpty,
        reason:
            'These quick-help buttons send an empty serviceLabels list after '
            'the config-loader projection, which disables the retriever filter '
            '(issue #1000): $empties',
      );
    });
  });
}
