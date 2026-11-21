import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/okf/markdown_chunker.dart';

/// The concept card's body renders lazily (#1939, 2026-11-20 emulator
/// evidence): a serving repo's citizen card carried a 249,557-character
/// markdown body and one whole-document MarkdownBody wedged the emulator's
/// raster pipeline — the card pane painted nothing for minutes while every
/// other arm rendered instantly. The fix splits the body at paragraph
/// boundaries into chunks the card's ListView renders lazily — viewport-only
/// parses, the FULL content kept (no truncation).
void main() {
  group('chunkMarkdownBody', () {
    test('an empty body answers one empty chunk', () {
      expect(chunkMarkdownBody(''), ['']);
    });

    test('a small body stays one chunk', () {
      const body = '# Title\n\nA short paragraph.';
      expect(chunkMarkdownBody(body), [body]);
    });

    test('paragraphs accumulate past the target into separate chunks', () {
      final paragraph = 'P ${'x' * 600}.\n\n'; // ~600 chars per block
      final body = paragraph * 20; // ~12k chars
      final chunks = chunkMarkdownBody(body, targetChunkChars: 4000);
      expect(chunks.length, greaterThanOrEqualTo(2));
      for (final c in chunks) {
        expect(c.length, lessThan(8000), reason: 'chunks stay near target');
      }
      // No content lost: rejoining the chunks restores the body.
      expect(chunks.join(), body);
    });

    test('a split never lands inside a fenced code block', () {
      final fence =
          '```text\n${'line\n' * 50}\n\nstill inside the fence\n```\n\n';
      final body = '${'Para one.\n\n' * 10}$fence${'Para two.\n\n' * 10}';
      final chunks = chunkMarkdownBody(body, targetChunkChars: 1000);
      for (final c in chunks) {
        final fences = '```'.allMatches(c).length;
        expect(fences.isEven, isTrue, reason: 'a chunk never splits a fence');
      }
      expect(chunks.join(), body);
    });

    test('a single block over the hard cap hard-splits at newlines', () {
      final block = 'line ${'y' * 200}\n' * 100; // one block, ~24k chars
      final chunks = chunkMarkdownBody(block, targetChunkChars: 4000);
      expect(chunks.length, greaterThanOrEqualTo(2));
      expect(chunks.join(), block);
    });

    test('a 250k body produces many bounded chunks without loss', () {
      final body = List.generate(
        800,
        (i) => '## Heading $i\n\nParagraph $i ${'z' * 280}.\n\n',
      ).join();
      final chunks = chunkMarkdownBody(body, targetChunkChars: 4000);
      expect(chunks.length, inInclusiveRange(40, 200));
      expect(chunks.join(), body);
    });
  });
  test(
    // The 2026-11-20 review finding: inside a fence NO flush path fired —
    // one giant fenced block (docs with embedded logs) became ONE chunk and
    // re-wedged the parser the chunker exists to protect against. The hard
    // cap now applies inside fences: a fence splits at line bounds like a
    // pathological paragraph, the rejoin stays byte-for-byte.
    'a giant fenced block splits at the hard cap and rejoins intact',
    () {
      final codeLines = List.generate(300, (i) => 'log line $i ${'x' * 36}');
      final body = '```\n${codeLines.join('\n')}\n```';
      final chunks = chunkMarkdownBody(body);

      expect(
        chunks.length,
        greaterThan(1),
        reason: 'a 12k fence cannot be one chunk',
      );
      for (final c in chunks) {
        expect(
          c.length,
          lessThanOrEqualTo(8000 + 64),
          reason: 'every piece respects the hard cap (plus one line)',
        );
      }
      expect(
        chunks.join(),
        equals(body),
        reason: 'the rejoin is byte-for-byte',
      );
    },
  );
}
