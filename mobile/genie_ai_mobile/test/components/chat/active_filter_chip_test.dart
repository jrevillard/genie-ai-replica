/// M28 — Quick Help filter chip lifecycle. The chip makes the active filter
/// visible (and clearable), so a stale `serviceLabels` list can no longer
/// silently answer an unrelated typed question.
///
/// The component is a full-screen chat surface; widget-level rendering tests
/// need the AppAuth + Keycloak providers in scope (heavy scaffolding). The
/// determinism that matters lives in the helper and the button derivation,
/// so this file pins both with the same patterns used by the existing
/// `quickhelp_labels_test.dart`.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';

void main() {
  group('quickHelpServiceLabels (the foundation helper)', () {
    test('absent / empty / null all fall back to [button id]', () {
      expect(
        quickHelpServiceLabels(<String, dynamic>{'id': 'manage-poultry-pigs'}),
        <String>['manage-poultry-pigs'],
      );
      expect(
        quickHelpServiceLabels(<String, dynamic>{
          'id': 'manage-poultry-pigs',
          'serviceLabels': <dynamic>[],
        }),
        <String>['manage-poultry-pigs'],
      );
      expect(
        quickHelpServiceLabels(<String, dynamic>{
          'id': 'manage-poultry-pigs',
          'serviceLabels': null,
        }),
        <String>['manage-poultry-pigs'],
      );
    });

    test('explicit non-empty list passes through unchanged', () {
      expect(
        quickHelpServiceLabels(<String, dynamic>{
          'id': 'grow-fruits-veggies',
          'serviceLabels': <dynamic>['Tomato', 'Onion'],
        }),
        <String>['Tomato', 'Onion'],
      );
    });
  });

  group('shipped config regression guard', () {
    test(
      'every Quick Help button in the shipped config yields a non-empty label list',
      () {
        // Regression guard for both M28 and issue #1000: the chip text AND
        // the retriever filter both depend on a non-empty label list. If
        // the helper ever regresses, every visible-and-grounded bug returns
        // in one stroke.
        final file = File('assets/config/genie-ai-config.json');
        if (!file.existsSync()) return; // CI may not have the asset

        final config =
            jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
        final buttons =
            (config['features']['chat']['quickHelp']['buttons'] as List)
                .cast<Map<String, dynamic>>();

        final empties = <String>[];
        for (final b in buttons) {
          if (quickHelpServiceLabels(b).isEmpty) {
            empties.add((b['id'] ?? '?').toString());
          }
        }
        expect(
          empties,
          isEmpty,
          reason:
              'These Quick Help buttons would send an empty serviceLabels list, '
              'disabling the retriever filter and silently grounding answers '
              'in the whole corpus (issue #1000 / M28).',
        );
      },
    );
  });
}
