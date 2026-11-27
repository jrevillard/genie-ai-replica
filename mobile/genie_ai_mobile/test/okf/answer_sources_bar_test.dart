import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/answer_sources_bar.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

void main() {
  setUpAll(() {
    final tm = ThemeManager();
    tm.setTheme('light');
    tm.setFontSize(50.0);
    tm.setConfiguration({});
  });

  final okfRow = <String, dynamic>{
    'document_id': 'hadith-nawawi-36',
    'document_name': 'hadith nawawi 36',
    'url': '',
    'score': 0.42,
    'concept_id': 'hadith-nawawi-36',
    'source': 'okf-concept',
    'repo_id': 'ragas-venue-seed',
  };
  final pdfRow = <String, dynamic>{
    'document_id': 'annual-report.pdf',
    'document_name': 'annual-report.pdf',
    'url': '/api/files/annual-report.pdf/download',
    'score': 0.9,
  };
  final webRow = <String, dynamic>{
    'document_id': 'https://example.gov/policy',
    'document_name': 'The policy',
    'url': 'https://example.gov/policy',
    'source': 'web',
  };

  String label(int n) => 'Related sources ($n)';

  Future<void> pumpBar(
    WidgetTester tester, {
    required List<Map<String, dynamic>> sources,
    Map<String, dynamic>? opened,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnswerSourcesBar(
            sources: sources,
            labelBuilder: label,
            onOpen: (doc) => opened?.addAll(doc),
          ),
        ),
      ),
    );
  }

  testWidgets('an empty source list renders nothing', (tester) async {
    await pumpBar(tester, sources: const []);
    expect(find.text('Related sources (0)'), findsNothing);
    expect(find.byType(InkWell), findsNothing);
    expect(find.byType(GestureDetector), findsNothing);
  });

  testWidgets('collapsed by default: only the toggle is visible', (
    tester,
  ) async {
    await pumpBar(tester, sources: [okfRow, pdfRow]);
    expect(find.text('Related sources (2)'), findsOneWidget);
    expect(find.text('hadith nawawi 36'), findsNothing);
  });

  testWidgets('tapping the toggle reveals the rows', (tester) async {
    await pumpBar(tester, sources: [okfRow, pdfRow]);
    await tester.tap(find.text('Related sources (2)'));
    await tester.pumpAndSettle();
    expect(find.text('hadith nawawi 36'), findsOneWidget);
    expect(find.text('annual-report.pdf'), findsOneWidget);
  });

  testWidgets('the okf row carries the OKF badge', (tester) async {
    await pumpBar(tester, sources: [okfRow]);
    await tester.tap(find.text('Related sources (1)'));
    await tester.pumpAndSettle();
    expect(find.text('OKF'), findsOneWidget);
  });

  testWidgets('a web row carries the WEB badge', (tester) async {
    await pumpBar(tester, sources: [webRow]);
    await tester.tap(find.text('Related sources (1)'));
    await tester.pumpAndSettle();
    expect(find.text('WEB'), findsOneWidget);
  });

  testWidgets('a document row carries its extension badge', (tester) async {
    await pumpBar(tester, sources: [pdfRow]);
    await tester.tap(find.text('Related sources (1)'));
    await tester.pumpAndSettle();
    expect(find.text('PDF'), findsOneWidget);
  });

  testWidgets('tapping a browsable okf row hands the row to onOpen', (
    tester,
  ) async {
    final opened = <String, dynamic>{};
    await pumpBar(tester, sources: [okfRow], opened: opened);
    await tester.tap(find.text('Related sources (1)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('hadith nawawi 36'));
    await tester.pumpAndSettle();
    expect(opened['repo_id'], 'ragas-venue-seed');
    expect(opened['concept_id'], 'hadith-nawawi-36');
  });

  testWidgets('two anonymous rows never share a row key', (tester) async {
    // Rows carrying NEITHER document_id nor id used to interpolate the same
    // 'answer-source-row-null' key — duplicate keys among siblings throw
    // during build (2026-11-20 review finding).
    final anon = <String, dynamic>{'document_name': 'anon doc', 'url': ''};
    await pumpBar(tester, sources: [anon, Map<String, dynamic>.from(anon)]);
    await tester.tap(find.text('Related sources (2)'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('anon doc'), findsNWidgets(2));
  });
}
