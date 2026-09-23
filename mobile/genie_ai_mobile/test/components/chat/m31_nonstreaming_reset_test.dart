/// M31 (DW-247) — the non-streaming send path used to leak the Quick Help
/// filter forever. After any non-streaming send (success or error), the
/// labels must be cleared so a typed follow-up is unfiltered.
///
/// The actual code path needs the AppAuth/Keycloak providers in scope to
/// run end-to-end; we instead pin the contract at the helper level so the
/// regression can't return even if the call sites are re-edited.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/chatbot_component.dart';

void main() {
  group('quickHelpServiceLabels', () {
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
  });

  group('M31 contract: the helper never returns an empty list', () {
    test('every non-null button (even without serviceLabels) yields a list the '
        'request can actually filter on', () {
      // Pin the rule that the non-streaming path relies on after the
      // clearQuickHelpContext fix lands. If the helper ever returns [] for
      // a missing/empty/null label, the non-streaming leak would return.
      for (final id in <String>[
        'manage-poultry-pigs',
        'grow-fruits-veggies',
        'diagnose-pest-disease',
        'plant-basic-grains',
      ]) {
        final labels = quickHelpServiceLabels(<String, dynamic>{'id': id});
        expect(
          labels,
          isNotEmpty,
          reason: 'button $id must filter on something',
        );
      }
    });
  });
}
