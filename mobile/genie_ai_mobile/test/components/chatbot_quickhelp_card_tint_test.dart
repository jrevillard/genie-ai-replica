import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/tokens/color_utils.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

import '../helpers/chatbot_harness.dart';
import '../helpers/theme_helper.dart';

// The per-card TINT the configuration declares (`styles`). The web
// paints each card with the declared background and outline (the
// theme layer's `--qh-bg` / `--qh-outline` card override); the parse
// dropped the block, so every mobile card painted the surface tokens.
// The assertions read the RESOLVED values off the rendered card — the
// mobile Visual Fidelity rule — never a hex literal copied into the
// test beyond the declaration itself.
void main() {
  // The shape every web product config ships for a card.
  final tintedCard = <String, dynamic>{
    'id': 'tinted-id',
    'title': {'en': 'Tinted Card'},
    'category': '2',
    'serviceLabels': ['Births'],
    'styles': {
      'backgroundColor': '#D9E2EA',
      'hoverColor': '#C2CED8',
      'outlineColor': '#A9B6C2',
    },
  };

  final untintedCard = <String, dynamic>{
    'id': 'plain-id',
    'title': {'en': 'Plain Card'},
    'category': '2',
    'serviceLabels': ['Births'],
  };

  final outlineOnlyCard = <String, dynamic>{
    'id': 'outline-only-id',
    'title': {'en': 'Outline Only Card'},
    'category': '2',
    'serviceLabels': ['Births'],
    'styles': {'outlineColor': '#A9B6C2'},
  };

  // An alpha-carrying outline: the DERIVED dark surface is a
  // synthesis and paints opaque, whatever alpha the declaration had.
  final alphaOutlineCard = <String, dynamic>{
    'id': 'alpha-outline-id',
    'title': {'en': 'Alpha Outline Card'},
    'category': '2',
    'serviceLabels': ['Births'],
    'styles': {'outlineColor': '#A9B6C280'},
  };

  final malformedCard = <String, dynamic>{
    'id': 'malformed-id',
    'title': {'en': 'Malformed Card'},
    'category': '2',
    'serviceLabels': ['Births'],
    'styles': {'backgroundColor': 'not-a-color', 'outlineColor': 42},
  };

  final tree = quickHelpTreeFixture();

  // A tinted card whose title is empty in the loaded language —
  // broken, but still the deployment's colour under the danger border.
  final brokenTintedCard = <String, dynamic>{
    'id': 'broken-tinted-id',
    'title': {'en': ''},
    'category': '2',
    'serviceLabels': ['Births'],
    'styles': {'backgroundColor': '#D9E2EA', 'outlineColor': '#A9B6C2'},
  };

  late Uint8List tintedConfig;
  late Uint8List brokenConfig;
  late Uint8List malformedConfig;
  setUpAll(() async {
    tintedConfig = await chatbotConfigBytesWithButtons([
      tintedCard,
      untintedCard,
    ]);
    brokenConfig = await chatbotConfigBytesWithButtons([
      brokenTintedCard,
      untintedCard,
    ]);
    malformedConfig = await chatbotConfigBytesWithButtons([
      outlineOnlyCard,
      tintedCard,
      alphaOutlineCard,
      malformedCard,
    ]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  /// The Card the tile's shell renders — the resolved chrome.
  Card cardOf(WidgetTester tester, String title) {
    final inkWell = find.ancestor(
      of: find.text(title),
      matching: find.byType(InkWell),
    );
    return tester.widget<Card>(
      find.descendant(of: inkWell, matching: find.byType(Card)),
    );
  }

  testWidgets(
    'a declared tint paints the card; an undeclared one keeps the tokens',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, tintedConfig);
      await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

      final tokens = ThemeManager().tokens;

      final tinted = cardOf(tester, 'Tinted Card');
      expect(tinted.color, ColorUtils.parseHex('#D9E2EA'));
      expect(tinted.shape, isA<RoundedRectangleBorder>());
      final tintedShape = tinted.shape! as RoundedRectangleBorder;
      expect(tintedShape.borderRadius, BorderRadius.circular(DsRadii.lg));
      expect(tintedShape.side.color, ColorUtils.parseHex('#A9B6C2'));

      final plain = cardOf(tester, 'Plain Card');
      expect(plain.color, tokens.surface);
      final plainShape = plain.shape! as RoundedRectangleBorder;
      expect(plainShape.side.color, tokens.borderLight);
    },
  );

  testWidgets(
    'a malformed hex falls back to the tokens; an outline-only tint names the dark surface hue',
    (tester) async {
      usePhoneSurface(tester);
      mockChatbotConfigAsset(tester, malformedConfig);
      // The dark card's derivation reads the LIVE surface token: the
      // dark tokens are the state the mount asserts against (a wrapper
      // on the default light tokens would derive at white and the
      // assertion could not tell the tint from the fallback).
      setupDarkTokens();
      await pumpChatBot(
        tester,
        QuickHelpTreeMockClient(tree),
        theme: ThemeManager().darkTheme,
      );

      final tokens = ThemeManager().tokens;

      // The malformed hex values are NULL fields — the card paints the
      // tokens, it is not dropped.
      final malformed = cardOf(tester, 'Malformed Card');
      expect(malformed.color, tokens.surface);

      // The dark card derives its surface from the declared OUTLINE (the
      // background is a pale step that cannot carry a hue at surface
      // depth): the outline's hue at the LIVE surface token's lightness.
      final outline = ColorUtils.parseHex('#A9B6C2');
      Color darkDerived(String title) => cardOf(tester, title).color!;
      final expected = HSLColor.fromColor(
        outline,
      ).withLightness(HSLColor.fromColor(tokens.surface).lightness).toColor();
      expect(darkDerived('Outline Only Card'), expected);
      final outlineShape =
          cardOf(tester, 'Outline Only Card').shape! as RoundedRectangleBorder;
      expect(outlineShape.side.color, outline);

      // A card declaring BOTH fields derives from the outline in dark
      // mode too — the pale declared background would be unreadable
      // against the near-white dark foreground (the web's dark rule
      // ignores --qh-bg the same way).
      expect(darkDerived('Tinted Card'), expected);

      // The derived surface is opaque: the alpha-carrying outline's
      // alpha does not bleed the overlay's background through the
      // synthesized card.
      final derivedAlpha = darkDerived('Alpha Outline Card');
      expect(derivedAlpha.toARGB32() >>> 24, 0xFF);
    },
  );

  testWidgets('a broken card keeps the declared tint under its danger border', (
    tester,
  ) async {
    usePhoneSurface(tester);
    mockChatbotConfigAsset(tester, brokenConfig);
    await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

    // The diagnosis row carries the tint; the DANGER BORDER is the
    // failure's colour (the web's .config-error overrides only the
    // border too).
    final caption = find.textContaining('no title in this language');
    expect(caption, findsOneWidget);
    final card = tester.widget<Card>(
      find.ancestor(of: caption, matching: find.byType(Card)),
    );
    expect(card.color, ColorUtils.parseHex('#D9E2EA'));
    final shape = card.shape! as RoundedRectangleBorder;
    expect(shape.side.color, ThemeManager().tokens.danger);
  });
}
