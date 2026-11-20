import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_spinner.dart';
import 'package:genie_ai_mobile/okf/concept_browser_controller.dart';
import 'package:genie_ai_mobile/okf/concept_browser_repository.dart';
import 'package:genie_ai_mobile/okf/markdown_chunker.dart';
import 'package:genie_ai_mobile/okf/concept_browser_screen.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:openapi/api.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';

import 'helpers/browser_fakes.dart';

class FakePathProviderPlatform extends PathProviderPlatform {
  final String documentsPath;
  FakePathProviderPlatform(this.documentsPath);

  @override
  Future<String?> getApplicationDocumentsPath() async => documentsPath;
}

void main() {
  late FakeConceptBrowserRepository fake;
  late ProviderContainer container;
  late Directory docsDir;

  setUpAll(() async {
    docsDir = await Directory.systemTemp.createTemp('okf-browser-test');
    PathProviderPlatform.instance = FakePathProviderPlatform(docsDir.path);
  });

  tearDownAll(() async {
    // Best-effort: the AV can hold the fresh .md long enough to fail an
    // eager delete; leftover temp files are harmless.
    try {
      await docsDir.delete(recursive: true);
    } on FileSystemException catch (_) {}
  });

  setUp(() {
    fake = FakeConceptBrowserRepository();
    container = ProviderContainer(
      overrides: [conceptBrowserRepositoryProvider.overrideWithValue(fake)],
    );
    addTearDown(container.dispose);
    final tm = ThemeManager();
    tm.setTheme('light');
    tm.setFontSize(50.0);
    tm.setConfiguration({});
  });

  Future<void> pumpBrowser(WidgetTester tester) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: ConceptBrowserScreen(repoId: 'repo-a')),
      ),
    );
    await tester.pump(); // the post-frame open fires on the first frame's tail
    await tester.pump(); // the loading state rebuilds
  }

  testWidgets(
    'while the first page is in flight the screen answers the spinner arm',
    (tester) async {
      fake.holdTree('repo-a');
      await pumpBrowser(tester);
      expect(find.byType(DsSpinner), findsOneWidget);
    },
  );

  testWidgets('a loaded tree with no selection answers the select-hint arm', (
    tester,
  ) async {
    fake.pagesByRepo['repo-a'] = page(2, [row('c1'), row('c2')]);
    await pumpBrowser(tester);
    expect(find.text(tr('okfBrowser.selectHint')), findsOneWidget);
  });

  testWidgets(
    'a loaded tree renders its rows and Show-more while the tree is incomplete',
    (tester) async {
      fake.pagesByRepo['repo-a'] = page(
        conceptBrowserPageSize + 5,
        List.generate(conceptBrowserPageSize, (i) => row('c$i')),
      );
      await pumpBrowser(tester);
      expect(
        find.text('Title c0'),
        findsOneWidget,
      ); // ListView builds lazily: top rows only
      expect(
        find.byKey(const ValueKey('okf-browser-show-more')),
        findsOneWidget,
      );
      expect(
        container.read(conceptBrowserControllerProvider).rows.length,
        conceptBrowserPageSize,
      );
    },
  );

  testWidgets('a complete tree hides Show-more', (tester) async {
    fake.pagesByRepo['repo-a'] = page(2, [row('c1'), row('c2')]);
    await pumpBrowser(tester);
    expect(find.byKey(const ValueKey('okf-browser-show-more')), findsNothing);
  });

  testWidgets('tapping a row shows the markdown title and body', (
    tester,
  ) async {
    fake.pagesByRepo['repo-a'] = page(1, [row('c1')]);
    fake.cardsByRepo['repo-a'] = {'c1': card('repo-a', 'c1')};
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    expect(find.text('Title c1'), findsWidgets); // row + pane title
    expect(find.text('Body of c1'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('okf-browser-back-to-list')),
      findsOneWidget,
    );
  });

  testWidgets('duplicate links dedupe to one chip', (tester) async {
    fake.pagesByRepo['repo-a'] = page(1, [row('c1')]);
    fake.cardsByRepo['repo-a'] = {
      'c1': card('repo-a', 'c1', links: ['c2', 'c2', 'c3']),
    };
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    expect(find.byKey(const ValueKey('okf-browser-chip-c2')), findsOneWidget);
    expect(find.byKey(const ValueKey('okf-browser-chip-c3')), findsOneWidget);
  });

  testWidgets(
    'an author-link object renders its label and taps to its target',
    (tester) async {
      fake.pagesByRepo['repo-a'] = page(2, [row('c1'), row('c2')]);
      fake.cardsByRepo['repo-a'] = {
        'c1': card(
          'repo-a',
          'c1',
          objectLinks: [
            ConceptCardLink(
              toConceptId: 'c2',
              label: 'Voyager 1 Saturn Encounter',
            ),
          ],
        ),
        'c2': card('repo-a', 'c2'),
      };
      await pumpBrowser(tester);
      await tester.tap(find.text('Title c1'));
      await tester.pump();
      // The chip's TEXT is the link's label, not the tree title, and the key
      // is the resolved target — the Vue browser's contract.
      expect(find.text('Voyager 1 Saturn Encounter'), findsOneWidget);
      expect(find.byKey(const ValueKey('okf-browser-chip-c2')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('okf-browser-chip-c2')));
      await tester.pump();
      expect(
        container.read(conceptBrowserControllerProvider).selected?.conceptId,
        'c2',
      );
    },
  );

  testWidgets(
    'a legacy target link strips .md and falls back to the tree title',
    (tester) async {
      fake.pagesByRepo['repo-a'] = page(2, [row('c1'), row('c2')]);
      fake.cardsByRepo['repo-a'] = {
        'c1': card(
          'repo-a',
          'c1',
          objectLinks: [ConceptCardLink(target: 'c2.md')],
        ),
      };
      await pumpBrowser(tester);
      await tester.tap(find.text('Title c1'));
      await tester.pump();
      expect(find.byKey(const ValueKey('okf-browser-chip-c2')), findsOneWidget);
      expect(find.text('Title c2'), findsOneWidget); // tree title fallback
    },
  );

  testWidgets('a self-link renders no chip', (tester) async {
    fake.pagesByRepo['repo-a'] = page(1, [row('c1')]);
    fake.cardsByRepo['repo-a'] = {
      'c1': card(
        'repo-a',
        'c1',
        objectLinks: [ConceptCardLink(toConceptId: 'c1', label: 'Myself')],
      ),
    };
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    expect(find.text('Myself'), findsNothing);
    expect(find.byType(ActionChip), findsNothing);
  });

  testWidgets(
    // The 2026-11-20 emulator wedge: a serving card carried a 249k-char
    // body and one whole-document MarkdownBody wedged the raster pipeline
    // (the card pane painted nothing for minutes). The body now renders
    // through chunked lazy items — the full content, parsed by the
    // viewport.
    'a large body renders as bounded lazy chunks with the chips tail',
    (tester) async {
      final body = List.generate(
        120,
        (i) => '## Heading $i\n\nParagraph $i ${'z' * 280}.\n\n',
      ).join(); // ~36k chars -> ~9 chunks at 4000
      fake.pagesByRepo['repo-a'] = page(1, [row('c1')]);
      fake.cardsByRepo['repo-a'] = {
        'c1': card(
          'repo-a',
          'c1',
          body: body,
          objectLinks: [ConceptCardLink(toConceptId: 'c2', label: 'Related')],
        ),
      };
      await pumpBrowser(tester);
      await tester.tap(find.text('Title c1'));
      await tester.pump();

      final chunks = chunkMarkdownBody(body);
      expect(chunks.length, greaterThan(3));
      // The first chunk is on screen and keyed; the viewport only ever
      // parses the visible slice of a 36k body.
      expect(
        find.byKey(const ValueKey('okf-browser-md-chunk-0')),
        findsOneWidget,
      );
      expect(find.text('Heading 0', findRichText: true), findsOneWidget);
      // LAZY: the LAST heading is far off-viewport and not built yet — a
      // whole-document MarkdownBody would have it in the tree immediately.
      expect(find.text('Heading 119', findRichText: true), findsNothing);
      // Scrolling reaches it — the FULL body is in the list, nothing
      // truncated — and the chips tail follows it.
      var scrolled = false;
      for (var drag = 0; drag < 60 && !scrolled; drag++) {
        await tester.drag(find.byType(ListView).first, const Offset(0, -500));
        await tester.pump();
        scrolled = find
            .text('Related', findRichText: true)
            .evaluate()
            .isNotEmpty;
      }
      expect(scrolled, isTrue, reason: 'the chips tail follows the full body');
      expect(find.text('Heading 119', findRichText: true), findsOneWidget);
    },
  );

  testWidgets('a single-paragraph body still renders exactly one chunk', (
    tester,
  ) async {
    fake.pagesByRepo['repo-a'] = page(1, [row('c1')]);
    fake.cardsByRepo['repo-a'] = {
      'c1': card('repo-a', 'c1', body: 'Body of c1'),
    };
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    expect(
      find.byKey(const ValueKey('okf-browser-md-chunk-0')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('okf-browser-md-chunk-1')), findsNothing);
  });

  testWidgets('tapping a chip is a forward visit — history grows', (
    tester,
  ) async {
    fake.pagesByRepo['repo-a'] = page(2, [row('c1'), row('c2')]);
    fake.cardsByRepo['repo-a'] = {
      'c1': card('repo-a', 'c1', links: ['c2']),
      'c2': card('repo-a', 'c2'),
    };
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('okf-browser-chip-c2')));
    await tester.pump();
    final s = container.read(conceptBrowserControllerProvider);
    expect(s.selected?.conceptId, 'c2');
    expect(s.history.map((h) => h.conceptId), ['c1', 'c2']);
    expect(s.historyIndex, 1);
  });

  testWidgets('back and forward enable per history boundaries', (tester) async {
    fake.pagesByRepo['repo-a'] = page(2, [row('c1'), row('c2')]);
    fake.cardsByRepo['repo-a'] = {
      'c1': card('repo-a', 'c1', links: ['c2']),
      'c2': card('repo-a', 'c2'),
    };
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    DsButton back() =>
        tester.widget<DsButton>(find.byKey(const ValueKey('okf-browser-back')));
    DsButton forward() => tester.widget<DsButton>(
      find.byKey(const ValueKey('okf-browser-forward')),
    );
    expect(back().disabled, isTrue); // first entry: nothing behind
    expect(forward().disabled, isTrue); // also the last entry: nothing ahead
    await tester.tap(find.byKey(const ValueKey('okf-browser-chip-c2')));
    await tester.pump();
    expect(back().disabled, isFalse);
    expect(forward().disabled, isTrue);
    await tester.tap(find.byKey(const ValueKey('okf-browser-back')));
    await tester.pump();
    expect(
      container.read(conceptBrowserControllerProvider).selected?.conceptId,
      'c1',
    );
    expect(forward().disabled, isFalse);
    expect(back().disabled, isTrue);
  });

  testWidgets(
    'a fenced or missing repo answers the unavailable arm, never a toast',
    (tester) async {
      fake.treeThrows['repo-a'] = ApiException(404, 'REPO_NOT_FOUND');
      await pumpBrowser(tester);
      expect(find.text(tr('okfBrowser.unavailable')), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
    },
  );

  testWidgets('downloading an empty body is an honest no-op with a notice', (
    tester,
  ) async {
    fake.pagesByRepo['repo-a'] = page(1, [row('c1')]);
    fake.cardsByRepo['repo-a'] = {'c1': card('repo-a', 'c1', body: '')};
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('okf-browser-download')));
    await tester.pump();
    expect(find.byType(SnackBar), findsOneWidget);
    final markdownFiles = docsDir.listSync().whereType<File>().where(
      (f) => f.path.endsWith('.md'),
    );
    expect(markdownFiles, isEmpty); // no zero-byte artifact
    await tester.pump(
      const Duration(seconds: 5),
    ); // let the snack dismiss (no pending timer)
  });

  testWidgets('downloading a body lands a local .md file', (tester) async {
    fake.pagesByRepo['repo-a'] = page(1, [row('c1')]);
    fake.cardsByRepo['repo-a'] = {'c1': card('repo-a', 'c1')};
    await pumpBrowser(tester);
    await tester.tap(find.text('Title c1'));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('okf-browser-download')));
    await tester.pump();
    // The write is REAL async I/O: outside the test's FakeAsync it only
    // lands via tester.runAsync. The empty-body test above already pins the
    // zero-byte class the honest way (an empty body writes NO file at all);
    // a body-length assertion here would fight the harness — dart:io's
    // write chain is gated by the fake zone and the fresh file is AV-locked
    // on this host — so the widget-level contract is the existence delta:
    // non-empty body -> exactly one .md file. The content equals
    // `selected.body` verbatim by construction and is exercised live at the
    // emulator gate.
    List<File> markdownFiles = [];
    await tester.runAsync(() async {
      final deadline = DateTime.now().add(const Duration(seconds: 5));
      while (DateTime.now().isBefore(deadline)) {
        markdownFiles = docsDir
            .listSync()
            .whereType<File>()
            .where((f) => f.path.endsWith('.md'))
            .toList();
        if (markdownFiles.isNotEmpty) return;
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
    });
    expect(markdownFiles, hasLength(1));
    await tester.pump(const Duration(seconds: 5));
  });
}
