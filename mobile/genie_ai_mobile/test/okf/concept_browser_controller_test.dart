import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/okf/concept_browser_controller.dart';
import 'package:genie_ai_mobile/okf/concept_browser_repository.dart';
import 'package:openapi/api.dart';

import 'helpers/browser_fakes.dart';

// The shared fakes carry the fixtures; the test keeps its local names.
ConceptTreePage _page(int total, List<ConceptTreeRow> rows) =>
    page(total, rows);

ConceptTreeRow _row(String id) => row(id);

ConceptCard _card(String repoId, String id) => card(repoId, id);

void main() {
  late FakeConceptBrowserRepository fake;
  late ProviderContainer container;

  setUp(() {
    fake = FakeConceptBrowserRepository();
    container = ProviderContainer(
      overrides: [conceptBrowserRepositoryProvider.overrideWithValue(fake)],
    );
    addTearDown(container.dispose);
  });

  ConceptBrowserController controller() =>
      container.read(conceptBrowserControllerProvider.notifier);

  group('tree loading', () {
    test(
      'first page load commits rows and marks the tree complete under one page',
      () async {
        fake.pagesByRepo['repo-a'] = _page(3, [
          _row('c1'),
          _row('c2'),
          _row('c3'),
        ]);
        await controller().open('repo-a');
        final s = container.read(conceptBrowserControllerProvider);
        expect(s.repoId, 'repo-a');
        expect(s.rows.map((r) => r.conceptId), ['c1', 'c2', 'c3']);
        expect(s.total, 3);
        expect(s.loading, isFalse);
        expect(s.treeComplete, isTrue);
        expect(s.unavailable, isFalse);
        expect(s.error, isNull);
      },
    );

    test(
      'extend past the boundary makes no further request and leaves the state unchanged',
      () async {
        fake.pagesByRepo['repo-a'] = _page(3, [
          _row('c1'),
          _row('c2'),
          _row('c3'),
        ]);
        final c = controller();
        await c.open('repo-a');
        await c.extend();
        expect(fake.treeCalls, 1); // the guard refused the out-of-range page
        final s = container.read(conceptBrowserControllerProvider);
        expect(s.rows.length, 3);
        expect(s.extending, isFalse);
        expect(s.treeComplete, isTrue);
      },
    );

    test('a full page under the total leaves the tree incomplete', () async {
      fake.pagesByRepo['repo-b'] = _page(
        conceptBrowserPageSize + 5,
        List.generate(conceptBrowserPageSize, (i) => _row('c$i')),
      );
      await controller().open('repo-b');
      final s = container.read(conceptBrowserControllerProvider);
      expect(s.treeComplete, isFalse);
      expect(s.rows.length, conceptBrowserPageSize);
    });

    test('a superseded tree response never commits over a newer run', () async {
      fake.pagesByRepo['repo-a'] = _page(1, [_row('a-only')]);
      fake.pagesByRepo['repo-b'] = _page(1, [_row('b-only')]);
      final held = fake.holdTree('repo-a');
      final c = controller();
      final slow = c.open('repo-a'); // held open by the completer
      await c.open('repo-b'); // fast run supersedes
      held.complete(_page(1, [_row('late-a')]));
      await slow;
      final s = container.read(conceptBrowserControllerProvider);
      expect(s.repoId, 'repo-b');
      expect(s.rows.map((r) => r.conceptId), ['b-only']);
    });

    test('the unavailable arm answers 403, 404 and 501 honestly', () async {
      for (final code in [403, 404, 501]) {
        fake.treeThrows.clear();
        fake.treeThrows['repo-x'] = ApiException(code, 'REPO_NOT_FOUND');
        await controller().open('repo-x');
        final s = container.read(conceptBrowserControllerProvider);
        expect(
          s.unavailable,
          isTrue,
          reason: 'status $code must map to the unavailable arm',
        );
        expect(
          s.error,
          isNull,
          reason: 'status $code must not surface as an error',
        );
        expect(s.loading, isFalse);
      }
    });

    test('401 propagates to the app auth flow instead of an arm', () async {
      fake.treeThrows['repo-auth'] = ApiException(401, 'session dead');
      await expectLater(
        controller().open('repo-auth'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 401)),
      );
      final s = container.read(conceptBrowserControllerProvider);
      expect(s.unavailable, isFalse);
      expect(s.loading, isFalse);
    });

    test(
      'a server error answers the error arm, not the unavailable arm',
      () async {
        fake.treeThrows['repo-500'] = ApiException(500, 'boom');
        await controller().open('repo-500');
        final s = container.read(conceptBrowserControllerProvider);
        expect(s.unavailable, isFalse);
        expect(s.error, isNotNull);
        expect(s.loading, isFalse);
      },
    );
  });

  group('selection and history', () {
    void seedTwoConcepts() {
      fake.pagesByRepo['repo-a'] = _page(2, [_row('c1'), _row('c2')]);
      fake.cardsByRepo['repo-a'] = {
        'c1': _card('repo-a', 'c1'),
        'c2': _card('repo-a', 'c2'),
      };
    }

    test('select commits the card and appends to history', () async {
      seedTwoConcepts();
      final c = controller();
      await c.open('repo-a');
      await c.select('c1');
      final s = container.read(conceptBrowserControllerProvider);
      expect(s.selected?.conceptId, 'c1');
      expect(s.history.map((h) => h.conceptId), ['c1']);
      expect(s.historyIndex, 0);
      expect(s.selectedLoading, isFalse);
    });

    test('repeat-tapping the current concept is a no-op', () async {
      seedTwoConcepts();
      final c = controller();
      await c.open('repo-a');
      await c.select('c1');
      await c.select('c1');
      expect(fake.cardCalls, 1);
      expect(
        container.read(conceptBrowserControllerProvider).history.length,
        1,
      );
    });

    test('a new visit after going back truncates the forward tail', () async {
      seedTwoConcepts();
      fake.cardsByRepo['repo-a']!['c2bis'] = _card('repo-a', 'c2bis');
      final c = controller();
      await c.open('repo-a');
      await c.select('c1');
      await c.select('c2');
      c.goBack(); // now at c1, forward tail holds c2
      expect(
        container.read(conceptBrowserControllerProvider).selected?.conceptId,
        'c1',
      );
      await c.select('c2bis'); // a NEW visit — the tail dies
      final s = container.read(conceptBrowserControllerProvider);
      expect(s.selected?.conceptId, 'c2bis');
      expect(s.history.map((h) => h.conceptId), ['c1', 'c2bis']);
      expect(s.historyIndex, 1);
    });

    test('boundary back and forward are no-ops', () async {
      seedTwoConcepts();
      final c = controller();
      await c.open('repo-a');
      await c.select('c1');
      c.goBack(); // at the first entry — no-op
      expect(container.read(conceptBrowserControllerProvider).historyIndex, 0);
      await c.select('c2');
      c.goForward(); // at the last entry — no-op
      expect(container.read(conceptBrowserControllerProvider).historyIndex, 1);
      expect(
        container.read(conceptBrowserControllerProvider).selected?.conceptId,
        'c2',
      );
    });

    test(
      'the visit history is capped — oldest entries drop, index follows',
      () async {
        seedTwoConcepts();
        final c = controller();
        await c.open('repo-a');
        // Twelve visits: the cap (10) drops the two oldest, keeping back and
        // forward working inside the window (the /simplify review's
        // retention finding — 50 × 250k bodies do not stay alive).
        for (var i = 1; i <= 12; i++) {
          final id = i <= 2 ? 'c$i' : 'extra$i';
          fake.cardsByRepo['repo-a']![id] = _card('repo-a', id);
          await c.select(id);
        }
        final s = container.read(conceptBrowserControllerProvider);
        expect(s.history.length, 10);
        expect(s.history.first.conceptId, 'extra3');
        expect(s.selected?.conceptId, 'extra12');
        expect(s.historyIndex, 9);
        // Back walks the capped window.
        c.goBack();
        expect(
          container.read(conceptBrowserControllerProvider).selected?.conceptId,
          'extra11',
        );
      },
    );

    test(
      'backToList clears the selection but keeps history and the position',
      () async {
        seedTwoConcepts();
        final c = controller();
        await c.open('repo-a');
        await c.select('c1');
        await c.select('c2');
        c.goBack();
        c.backToList();
        var s = container.read(conceptBrowserControllerProvider);
        expect(s.selected, isNull);
        expect(s.history.map((h) => h.conceptId), ['c1', 'c2']);
        expect(s.historyIndex, 0);
        c.goForward(); // forward from the list re-opens the next entry
        s = container.read(conceptBrowserControllerProvider);
        expect(s.selected?.conceptId, 'c2');
        expect(s.historyIndex, 1);
      },
    );
  });
  // The 2026-11-20 review findings, pinned at the controller boundary:
  group('selection races and error recovery', () {
    test('a slow earlier select never commits over a newer one', () async {
      fake.pagesByRepo['repo-a'] = _page(2, [_row('c1'), _row('c2')]);
      fake.cardsByRepo['repo-a'] = {
        'c1': _card('repo-a', 'c1'),
        'c2': _card('repo-a', 'c2'),
      };
      final c = controller();
      await c.open('repo-a');
      // Tap row A (its fetch HANGS on the fake's held completer), then row
      // B (answers immediately).
      final holdA = fake.holdCard('c1');
      final slowA = c.select('c1');
      await c.select('c2');
      var s = container.read(conceptBrowserControllerProvider);
      expect(s.selected?.conceptId, 'c2');
      expect(s.history.map((h) => h.conceptId), ['c2']);
      // A's fetch finally lands — it must NOT replace B or rebuild the
      // history from its stale snapshot (the old code committed history
      // from the pre-fetch state: B was erased, A took the pane).
      holdA.complete(_card('repo-a', 'c1'));
      await slowA;
      s = container.read(conceptBrowserControllerProvider);
      expect(s.selected?.conceptId, 'c2');
      expect(s.history.map((h) => h.conceptId), ['c2']);
      expect(s.historyIndex, 0);
    });

    test('a successful select clears a prior select error', () async {
      fake.pagesByRepo['repo-a'] = _page(2, [_row('c1'), _row('c2')]);
      fake.cardsByRepo['repo-a'] = {
        'c1': _card('repo-a', 'c1'),
        'c2': _card('repo-a', 'c2'),
      };
      final c = controller();
      await c.open('repo-a');
      fake.cardThrows['c1'] = Exception('backend 500');
      await c.select('c1');
      expect(container.read(conceptBrowserControllerProvider).error, isNotNull);
      // The user taps another row: the error must not survive the success —
      // the pane would show a stale failure over a working card.
      fake.cardThrows.remove('c1');
      await c.select('c2');
      expect(container.read(conceptBrowserControllerProvider).error, isNull);
    });
  });
}
