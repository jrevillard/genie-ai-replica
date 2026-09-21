import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/widgets.dart' show Matrix4;

/// Helpers for a zoomable, pannable canvas driven by an
/// `InteractiveViewer` transformation matrix (drought report viewer).

/// Current uniform scale of [m].
double scaleOf(Matrix4 m) => m.getMaxScaleOnAxis();

/// [m] scaled by [factor] about the centre of [viewport], with the resulting
/// scale clamped to [minScale]..[maxScale] and the translation clamped so the
/// [content] (its unscaled size) keeps covering the viewport - no empty
/// margins after zooming out or drifting past an edge.
Matrix4 zoomAbout(
  Matrix4 m,
  double factor, {
  required Size viewport,
  required Size content,
  double minScale = 1,
  double maxScale = 4,
}) {
  final current = scaleOf(m);
  final target = (current * factor).clamp(minScale, maxScale);
  if (target == minScale) return Matrix4.identity();
  final f = target / current;
  final c = viewport.center(Offset.zero);
  final zoom = Matrix4.identity()
    ..translateByDouble(c.dx, c.dy, 0, 1)
    ..scaleByDouble(f, f, 1, 1)
    ..translateByDouble(-c.dx, -c.dy, 0, 1);
  return clampTranslation(zoom * m, viewport: viewport, content: content);
}

/// [m] with its translation limited so scaled [content] never leaves a gap
/// inside [viewport]; content shorter than the viewport is pinned to the top.
Matrix4 clampTranslation(
  Matrix4 m, {
  required Size viewport,
  required Size content,
}) {
  final s = scaleOf(m);
  final minX = math.min(0.0, viewport.width - content.width * s);
  final minY = math.min(0.0, viewport.height - content.height * s);
  final out = m.clone();
  out.storage[12] = m.storage[12].clamp(minX, 0.0);
  out.storage[13] = m.storage[13].clamp(minY, 0.0);
  return out;
}
