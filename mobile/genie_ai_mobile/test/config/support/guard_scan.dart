import 'dart:io';

/// A source occurrence that no guard condition protects.
class UnguardedUse {
  const UnguardedUse(this.line, this.text);

  /// 1-based line number of the occurrence.
  final int line;

  /// The source line the occurrence sits on, trimmed.
  final String text;

  @override
  String toString() => 'line $line: $text';
}

/// Finds the occurrences of a token that a guard condition does not protect.
///
/// The check is structural rather than textual: a token counts as guarded when
/// it sits inside a block whose opening condition names the guard, or when the
/// statement that contains it names the guard. Both cases require the guard to
/// appear *before* the token, so a condition that follows it never counts.
///
/// This is deliberately tolerant about formatting — a re-indented, re-wrapped
/// or renamed condition still matches — and strict about meaning: a token that
/// is reachable without the guard is reported.
class GuardScanner {
  GuardScanner(this.source);

  /// The source text to scan.
  final String source;

  late final List<int> _lineStarts = _computeLineStarts();
  late final Map<int, int> _bracePairs = _computeBracePairs();
  late final List<int> _openBraces = _bracePairs.keys.toList()..sort();

  /// The occurrences of [token] that no [guard] protects.
  List<UnguardedUse> unguarded(Pattern token, String guard) {
    final found = <UnguardedUse>[];
    for (final match in token.allMatches(source)) {
      final offset = match.start;
      if (_isGuarded(offset, guard)) {
        continue;
      }
      final line = _lineOf(offset);
      found.add(UnguardedUse(line, _lineText(line).trim()));
    }
    return found;
  }

  /// How many times [token] occurs in the source.
  int count(Pattern token) => token.allMatches(source).length;

  /// The first `{...}` block that follows a match of [signature], with
  /// comments removed — the body of a method or function declared by
  /// [signature]. Returns `null` when the signature does not appear or no
  /// opening brace follows it.
  ///
  /// The scan from the signature to the body's opening brace — and the brace
  /// pairing underneath — skips comments and string literals, so a trailing
  /// `/* ... */` note between the parameter list and the body is not
  /// mistaken for the body, and a brace inside a string cannot desynchronize
  /// the pairing.
  String? blockAfter(Pattern signature) {
    final matches = signature.allMatches(source);
    if (matches.isEmpty) {
      return null;
    }
    final open = _firstStructuralBrace(matches.first.end);
    final close = open < 0 ? null : _bracePairs[open];
    if (close == null) {
      return null;
    }
    return _stripComments(source.substring(open + 1, close));
  }

  /// The offset of the first `{` at or after [from] that is not inside a
  /// comment or a string literal, or -1.
  int _firstStructuralBrace(int from) {
    var i = from;
    while (i < source.length) {
      final trivia = _triviaEnd(i);
      if (trivia != null) {
        i = trivia;
        continue;
      }
      if (source[i] == '{') {
        return i;
      }
      i++;
    }
    return -1;
  }

  bool _isGuarded(int offset, String guard) {
    // Inside a block whose opening condition names the guard.
    for (final open in _openBraces) {
      if (open >= offset) {
        break;
      }
      final close = _bracePairs[open]!;
      if (close <= offset) {
        continue;
      }
      final head = _headOf(open);
      final guardAt = head.indexOf(guard);
      if (guardAt >= 0) {
        return true;
      }
    }
    // Or in a statement that names the guard — a ternary, or an inline
    // condition on the same expression.
    final window = _statementAround(offset);
    return window.contains(guard);
  }

  /// The text between the previous statement boundary and the brace at
  /// [open] — the `if (...)` head of the block that brace opens.
  ///
  /// Comments are removed: a comment that mentions the guard does not guard
  /// anything, and the fork documents its own gates in prose right above them.
  String _headOf(int open) {
    var start = 0;
    for (var i = open - 1; i >= 0; i--) {
      final c = source[i];
      if (c == ';' || c == '{' || c == '}') {
        start = i + 1;
        break;
      }
    }
    return _stripComments(source.substring(start, open));
  }

  /// The text of the statement that contains [offset], without comments.
  String _statementAround(int offset) {
    var start = 0;
    for (var i = offset - 1; i >= 0; i--) {
      final c = source[i];
      if (c == ';' || c == '{' || c == '}') {
        start = i + 1;
        break;
      }
    }
    var end = source.length;
    for (var i = offset; i < source.length; i++) {
      final c = source[i];
      if (c == ';' || c == '{' || c == '}') {
        end = i;
        break;
      }
    }
    return _stripComments(source.substring(start, end));
  }

  /// Removes `/* ... */` and `// ...` comments from [text], leaving string
  /// literals untouched: a `//` inside a Java string is data, not a comment,
  /// and stripping it would truncate the code the guard inspects.
  String _stripComments(String text) {
    final out = StringBuffer();
    var i = 0;
    while (i < text.length) {
      final trivia = _triviaEnd(i, text);
      if (trivia != null) {
        // A comment collapses to a space; a string literal is copied whole.
        out.write(text[i] == '/' ? ' ' : text.substring(i, trivia));
        i = trivia;
        continue;
      }
      out.write(text[i]);
      i++;
    }
    return out.toString();
  }

  /// If [i] starts a comment or string literal in [text] (default: the
  /// scanned source), the index just past it; otherwise null. The single
  /// trivia-skipping rule shared by the brace pairing, the body-locate scan
  /// and the comment stripper.
  int? _triviaEnd(int i, [String? text]) {
    final src = text ?? source;
    if (src[i] == '/' && i + 1 < src.length) {
      if (src[i + 1] == '/') {
        final nl = src.indexOf('\n', i);
        return nl < 0 ? src.length : nl + 1;
      }
      if (src[i + 1] == '*') {
        final end = src.indexOf('*/', i + 2);
        return end < 0 ? src.length : end + 2;
      }
      return null;
    }
    if (src[i] == '"' || src[i] == "'") {
      final quote = src[i];
      var j = i + 1;
      while (j < src.length && src[j] != quote) {
        if (src[j] == r'\') {
          j++;
        }
        j++;
      }
      return j < src.length ? j + 1 : src.length;
    }
    return null;
  }

  Map<int, int> _computeBracePairs() {
    // Brace pairing that skips comments and string literals: a `{` inside
    // either is not structural, and an unpaired one would desynchronize
    // every pair after it (a Java string like "no brace { inside" is enough).
    final pairs = <int, int>{};
    final stack = <int>[];
    var i = 0;
    while (i < source.length) {
      final trivia = _triviaEnd(i);
      if (trivia != null) {
        i = trivia;
        continue;
      }
      final c = source[i];
      if (c == '{') {
        stack.add(i);
      } else if (c == '}') {
        if (stack.isNotEmpty) {
          pairs[stack.removeLast()] = i;
        }
      }
      i++;
    }
    return pairs;
  }

  List<int> _computeLineStarts() {
    final starts = <int>[0];
    for (var i = 0; i < source.length; i++) {
      if (source[i] == '\n') {
        starts.add(i + 1);
      }
    }
    return starts;
  }

  int _lineOf(int offset) {
    var low = 0;
    var high = _lineStarts.length - 1;
    while (low < high) {
      final mid = (low + high + 1) ~/ 2;
      if (_lineStarts[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low + 1;
  }

  String _lineText(int line) {
    final start = _lineStarts[line - 1];
    final end = line < _lineStarts.length
        ? _lineStarts[line] - 1
        : source.length;
    return source.substring(start, end);
  }
}

/// Source files under [root] whose name ends with one of [extensions].
///
/// Paths are returned with forward slashes so that assertions on them hold on
/// every platform.
List<File> sourceFilesUnder(String root, Set<String> extensions) {
  final directory = Directory(root);
  if (!directory.existsSync()) {
    return const <File>[];
  }
  return directory
      .listSync(recursive: true)
      .whereType<File>()
      .where((file) => extensions.any(file.path.endsWith))
      .toList()
    ..sort((a, b) => a.path.compareTo(b.path));
}

/// The path of [file] relative to the current directory, with forward slashes.
String relativePath(File file) {
  final path = file.path.replaceAll('\\', '/');
  return path.startsWith('./') ? path.substring(2) : path;
}
