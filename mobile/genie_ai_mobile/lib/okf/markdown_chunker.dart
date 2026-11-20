/// Splits a concept body into lazily-renderable markdown chunks (#1939,
/// 2026-11-20): a serving repo's citizen card carried a 249,557-character
/// body and a single whole-document MarkdownBody wedged the raster pipeline
/// — the card pane painted nothing while every lighter arm rendered
/// instantly. The chunker cuts ONLY at paragraph boundaries (`\n\n`) and
/// never inside a fenced code block, accumulating blocks up to
/// [targetChunkChars]; the card's ListView renders the chunks lazily, so a
/// 250k body parses viewport-sized pieces instead of the whole document.
/// Rejoining the chunks restores the body byte-for-byte.
List<String> chunkMarkdownBody(String body, {int targetChunkChars = 4096}) {
  if (body.isEmpty) return const [''];

  final chunks = <String>[];
  final current = StringBuffer();
  var currentLen = 0;
  var inFence = false;

  void flush() {
    if (currentLen > 0) {
      chunks.add(current.toString());
      current.clear();
      currentLen = 0;
    }
  }

  // Blocks are separated by blank lines; walk the text line-wise so a
  // ``` toggle anywhere keeps the fence state honest across blocks. The
  // final line carries no trailing newline (split() dropped it), so every
  // write re-attaches '\n' except the last.
  final lines = body.split('\n');
  final block = StringBuffer();
  var blockLen = 0;

  void flushBlock({bool force = false}) {
    final text = block.toString();
    block.clear();
    if (blockLen == 0 && !force) return;
    current.write(text);
    currentLen += blockLen;
    blockLen = 0;
    if (currentLen >= targetChunkChars && !inFence) flush();
  }

  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l.endsWith('\r')) l = l.substring(0, l.length - 1);
    final isLast = i == lines.length - 1;
    if (l.trimLeft().startsWith('```')) inFence = !inFence;
    block.write(isLast ? l : '$l\n');
    blockLen += l.length + (isLast ? 0 : 1);
    final blank = l.trim().isEmpty;
    if (blank && !inFence) {
      flushBlock();
    } else if (!inFence && blockLen >= _hardChunkCap) {
      // A single paragraph over the hard cap: hard-split at line bounds so
      // one pathological block cannot wedge the parser again.
      flushBlock();
    }
  }
  flushBlock(force: true);
  flush();
  return chunks.isEmpty ? const [''] : chunks;
}

/// A block larger than this hard-splits at line bounds even alone — a
/// 250k-character single-paragraph body must never become one chunk.
const int _hardChunkCap = 8000;
