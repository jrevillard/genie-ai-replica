// Unit test for the FAQ markdown parser used by the right-sidebar FAQ
// panel. The parser lives as a private method on _RightSidebarComponentState,
// so we mirror the algorithm here to keep the public surface stable.
//
// The parser must:
//  - split on `## ` headings, taking the rest of the line as the question
//  - strip optional `**…**` emphasis (the Vue counterpart uses
//    marked.parseInline to do the same; mobile doesn't have marked, so
//    the stripping is done by hand — keep them in sync)
//  - concatenate all other lines as the answer body until the next heading
//  - handle an empty trailing block gracefully

import 'package:flutter_test/flutter_test.dart';

List<Map<String, String>> parseFaq(String markdown) {
  final faqs = <Map<String, String>>[];
  final lines = markdown.split('\n');
  String? q;
  final ans = StringBuffer();
  for (final line in lines) {
    if (line.trim().startsWith('## ')) {
      if (q != null) {
        faqs.add({'question': q, 'answer': ans.toString().trim()});
        ans.clear();
      }
      q = line.substring(3).trim().replaceAll('**', '').trim();
    } else {
      if (q != null) ans.writeln(line);
    }
  }
  if (q != null) {
    faqs.add({'question': q, 'answer': ans.toString().trim()});
  }
  return faqs;
}

void main() {
  group('FAQ markdown parser', () {
    test('strips `**…**` emphasis from the heading text', () {
      const md = '''
## **What is AgroGenio AI?**

Body line one.
Body line two.
''';
      final faqs = parseFaq(md);
      expect(faqs, hasLength(1));
      expect(faqs.first['question'], 'What is AgroGenio AI?');
      expect(faqs.first['answer'], contains('Body line one.'));
      expect(faqs.first['answer'], contains('Body line two.'));
    });

    test('keeps plain (non-bolded) headings intact', () {
      const md = '''
## What is X?

Body.
''';
      final faqs = parseFaq(md);
      expect(faqs.single['question'], 'What is X?');
    });

    test('parses multiple headings in order with their bodies', () {
      const md = '''
## **First?**
A1
A2

## **Second?**
B1
''';
      final faqs = parseFaq(md);
      expect(faqs, hasLength(2));
      expect(faqs[0]['question'], 'First?');
      expect(faqs[0]['answer'], contains('A1'));
      expect(faqs[1]['question'], 'Second?');
      expect(faqs[1]['answer'], contains('B1'));
    });

    test('ignores content before the first heading', () {
      const md = '''
preamble that should be discarded
## **Q?**
body.
''';
      final faqs = parseFaq(md);
      expect(faqs.single['question'], 'Q?');
      expect(faqs.single['answer'], contains('body.'));
    });

    test('returns empty list when no heading is present', () {
      final faqs = parseFaq('just some text\nwith no headings');
      expect(faqs, isEmpty);
    });
  });
}
