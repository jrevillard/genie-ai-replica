import 'package:flutter/material.dart';

import '../../utils/theme_manager.dart' show ThemeManager;
import '../tokens/spacing.dart';

enum DsSpinnerSize { sm, md, lg }

class DsSpinner extends StatelessWidget {
  final DsSpinnerSize size;
  final Color? color;
  final double? strokeWidth;

  const DsSpinner({
    super.key,
    this.size = DsSpinnerSize.md,
    this.color,
    this.strokeWidth,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final effectiveColor = color ?? tokens.accent;
    final effectiveStroke = strokeWidth ?? _strokeForSize;
    return SizedBox(
      key: const ValueKey('ds-spinner-sizer'),
      width: _dimensionForSize,
      height: _dimensionForSize,
      child: CircularProgressIndicator(
        key: const ValueKey('ds-spinner'),
        color: effectiveColor,
        strokeWidth: effectiveStroke,
      ),
    );
  }

  double get _dimensionForSize => switch (size) {
    DsSpinnerSize.sm => DsSpacing.md,
    DsSpinnerSize.md => DsSpacing.lg,
    DsSpinnerSize.lg => DsSpacing.xl + DsSpacing.sm,
  };

  double get _strokeForSize => switch (size) {
    DsSpinnerSize.sm => DsSpacing.xxs,
    DsSpinnerSize.md => DsSpacing.xxs + DsSpacing.xxs * 0.25,
    DsSpinnerSize.lg => DsSpacing.xs - DsSpacing.xxs,
  };
}
