import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/charts/series_display.dart';

/// Parity spec §14 tests 2 and 8 — display names and acronym chips,
/// asserted against the exact outputs verified on the Vue app (spec §2).
void main() {
  group('displayName (spec §2 — grains verified outputs)', () {
    // The 15-series grains envelope, in original order (SV wholesale ×5,
    // GT ×2, NIC ×4, intl benchmarks ×4 — M1).
    final grains = [
      'Maize (white), San Salvador wholesale',
      'Beans (red), San Salvador wholesale',
      'Beans (silk red), Nicaragua wholesale',
      'Rice, San Salvador wholesale',
      'Sorghum, San Salvador wholesale',
      'Beans (black), Nicaragua wholesale',
      'Rice (first quality), Costa Rica wholesale',
      'Maize (white), Nicaragua wholesale',
      'Beans (red), Nicaragua wholesale',
      'Beans, Guatemala wholesale',
      'Sorghum, Nicaragua wholesale',
      'Maize, Guatemala wholesale',
      'Rice, US Gulf intl benchmark [converted to USD/quintal (46 kg)]',
      'Sorghum, US Gulf intl benchmark [converted to USD/quintal (46 kg)]',
      'Wheat, US Gulf intl benchmark [converted to USD/quintal (46 kg)]',
    ];
    final expected = [
      'Maize (white) (SV)',
      'Beans (red) (SV)',
      'Beans (silk red)',
      'Rice (SV)',
      'Sorghum (SV)',
      'Beans (black)',
      'Rice (first quality)',
      'Maize (white) (NIC)',
      'Beans (red) (NIC)',
      'Beans',
      'Sorghum (NIC)',
      'Maize',
      'Rice (intl)',
      'Sorghum (intl)',
      'Wheat',
    ];

    test('produces the exact verified outputs in order', () {
      final actual = grains.map((n) => displayName(n, grains)).toList();
      expect(actual, expected);
    });
  });

  group('commodityCode / commodityCodes (spec §14 test 8)', () {
    test('US Gulf benchmark maize → MAI-US', () {
      expect(commodityCode('Maize (US #2), US Gulf intl benchmark'), 'MAI-US');
    });

    test('strips non-letters and caps at 3 (no padding)', () {
      expect(commodityCode('Beans (red), San Salvador wholesale'), 'BEA-SV');
      expect(commodityCode('Tilapia, El Salvador'), 'TIL-SV');
      expect(
        commodityCode('Rice (first quality), Costa Rica wholesale'),
        'RIC-CR',
      );
      expect(commodityCode('Ox'), 'OX');
    });

    test('duplicate codes gain numeric suffixes, tagged ones gain tags', () {
      // Two untagged bean varieties → BEA and BEA-2; a tagged bean keeps
      // its own code.
      final codes = commodityCodes([
        'Beans (silk red), Ciudad X',
        'Beans (black), Ciudad Y',
        'Beans (red), San Salvador wholesale',
      ]);
      expect(codes, ['BEA', 'BEA-2', 'BEA-SV']);
    });

    test('already-tagged duplicates numeric-suffix without re-tagging', () {
      final codes = commodityCodes([
        'Maize (white), San Salvador wholesale',
        'Maize (white), Nicaragua wholesale',
        'Maize, Guatemala wholesale',
      ]);
      // Every name matches a country tag, so all three are distinct.
      expect(codes, ['MAI-SV', 'MAI-NI', 'MAI-GT']);
    });
  });
}
