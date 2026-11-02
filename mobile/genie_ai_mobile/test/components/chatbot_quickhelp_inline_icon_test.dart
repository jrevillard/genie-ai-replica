import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/chatbot_harness.dart';

// The `icon.type: "inline"` card renders its declared SVG markup. The
// bundled schema documents the type; before the inline branch the value
// went through the basename rule, produced a garbage asset key, and
// degraded to the neutral help icon — an icon the configuration DID
// declare rendered as if it had declared none.
void main() {
  const inlineMarkup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      '<circle cx="12" cy="12" r="10"/></svg>';

  final inlineCard = <String, dynamic>{
    'id': 'inline-id',
    'title': {'en': 'Inline Card'},
    'category': '2',
    'serviceLabels': ['Births'],
    'icon': {'type': 'inline', 'value': inlineMarkup},
  };

  final fileCard = <String, dynamic>{
    'id': 'file-id',
    'title': {'en': 'File Card'},
    'category': '2',
    'serviceLabels': ['Births'],
    'icon': {'type': 'file', 'value': '/config/quickhelp/just-chat.svg'},
  };

  final tree = quickHelpTreeFixture();

  late Uint8List config;
  setUpAll(() async {
    config = await chatbotConfigBytesWithButtons([inlineCard, fileCard]);
  });

  setUp(resetChatbotTestState);
  tearDown(resetChatbotTestState);

  bool isStringLoader(Widget w) =>
      w is SvgPicture && w.bytesLoader is SvgStringLoader;

  bool isAssetLoader(Widget w) =>
      w is SvgPicture && w.bytesLoader is SvgAssetLoader;

  // The file-typed card's bundled asset, served by the mock: an
  // unmocked asset load reports its failure AFTER the test completed
  // (the errorBuilder answers the icon slot, but the framework still
  // records the async exception).
  const svgAssetKey = 'assets/config/quickhelp/just-chat.svg';
  const svgBytes =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      '<rect width="24" height="24"/></svg>';

  testWidgets('an inline icon renders from its markup string', (tester) async {
    usePhoneSurface(tester);
    mockChatbotConfigAsset(
      tester,
      config,
      extraAssets: {svgAssetKey: svgBytes},
    );
    await pumpChatBot(tester, QuickHelpTreeMockClient(tree));

    // The two cards carry exactly one icon each: the inline card's is
    // a string-loaded SVG picture (the declared markup, not the
    // neutral fallback), the file-typed card's still loads its bundled
    // asset — the inline branch did not displace the basename rule.
    // (The icon and the title are SIBLINGS in the header row, and the
    // screen carries other string-loaded SVGs — the finders scope to
    // each card's press surface, then match the loader type.)
    Finder cardIconOf(String title, bool Function(Widget) predicate) =>
        find.descendant(
          of: find.ancestor(
            of: find.text(title),
            matching: find.byType(InkWell),
          ),
          matching: find.byWidgetPredicate(predicate),
        );
    expect(find.text('Inline Card'), findsOneWidget);
    expect(cardIconOf('Inline Card', isStringLoader), findsOneWidget);
    expect(cardIconOf('File Card', isAssetLoader), findsOneWidget);
  });
}
