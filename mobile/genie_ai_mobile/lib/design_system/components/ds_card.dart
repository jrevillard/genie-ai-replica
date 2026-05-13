import 'package:flutter/material.dart';

import '../../utils/theme_manager.dart' show ThemeManager;
import '../tokens/radii.dart';
import '../tokens/spacing.dart';

enum DsCardVariant { standard, flat, elevated, outline }

class DsCard extends StatelessWidget {
  final Widget child;
  final DsCardVariant variant;
  final EdgeInsetsGeometry? padding;
  final double? radius;
  final Color? overrideBg;
  final Color? overrideBorderColor;

  const DsCard({
    super.key,
    required this.child,
    this.variant = DsCardVariant.standard,
    this.padding,
    this.radius,
    this.overrideBg,
    this.overrideBorderColor,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final effectiveRadius = radius ?? DsRadii.lg;
    final effectivePadding = padding ?? const EdgeInsets.all(DsSpacing.md);

    Color? bgColor;
    Color? borderColor;
    double elevation = 0;

    switch (variant) {
      case DsCardVariant.standard:
        bgColor = overrideBg ?? tokens.surface;
        borderColor = overrideBorderColor ?? tokens.borderLight;
      case DsCardVariant.flat:
        bgColor = overrideBg ?? tokens.surface;
      case DsCardVariant.elevated:
        bgColor = overrideBg ?? tokens.surface;
        elevation = 2;
      case DsCardVariant.outline:
        bgColor = overrideBg ?? tokens.surface;
        borderColor = overrideBorderColor ?? tokens.border;
    }

    return Card(
      elevation: elevation,
      color: bgColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(effectiveRadius),
        side: borderColor != null
            ? BorderSide(color: borderColor)
            : BorderSide.none,
      ),
      child: Padding(padding: effectivePadding, child: child),
    );
  }
}
