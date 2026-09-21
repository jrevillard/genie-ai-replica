import 'dart:ui';

import 'package:flutter/widgets.dart' show Matrix4;
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/zoom_matrix.dart';

void main() {
  const viewport = Size(400, 800);
  const content = Size(400, 2000); // three-ish pages, wider than tall view

  test('zooming in about the centre keeps the centre point fixed', () {
    final m = zoomAbout(
      Matrix4.identity(),
      2,
      viewport: viewport,
      content: content,
    );
    expect(scaleOf(m), closeTo(2, 1e-9));
    // Centre (200, 400) maps to itself: 200*2 + tx == 200 -> tx == -200.
    expect(m.storage[12], closeTo(-200, 1e-9));
    expect(m.storage[13], closeTo(-400, 1e-9));
  });

  test('scale is clamped to the range and zooming out to 1 resets', () {
    var m = Matrix4.identity();
    for (var i = 0; i < 10; i++) {
      m = zoomAbout(m, 1.5, viewport: viewport, content: content);
    }
    expect(scaleOf(m), closeTo(4, 1e-9));

    m = zoomAbout(m, 0.1, viewport: viewport, content: content);
    expect(m, Matrix4.identity());
  });

  test('translation never leaves a gap at the edges', () {
    // Scale 2 with a translation that would expose empty space on the right
    // and bottom.
    final drifted = Matrix4.identity()
      ..scaleByDouble(2, 2, 1, 1)
      ..setTranslationRaw(50, 20, 0); // positive: gap top-left
    final clamped = clampTranslation(
      drifted,
      viewport: viewport,
      content: content,
    );
    expect(clamped.storage[12], 0);
    expect(clamped.storage[13], 0);

    final farOff = Matrix4.identity()
      ..scaleByDouble(2, 2, 1, 1)
      ..setTranslationRaw(-5000, -9000, 0);
    final back = clampTranslation(farOff, viewport: viewport, content: content);
    // Right edge: 400 - 800 = -400; bottom: 800 - 4000 = -3200.
    expect(back.storage[12], -400);
    expect(back.storage[13], -3200);
  });

  test('content shorter than the viewport is pinned to the top', () {
    final m = Matrix4.identity()..setTranslationRaw(0, -100, 0);
    final out = clampTranslation(
      m,
      viewport: viewport,
      content: const Size(400, 300),
    );
    expect(out.storage[13], 0);
  });
}
