import 'package:flutter/material.dart';

import '../../utils/theme_manager.dart' show ThemeManager;
import '../tokens/app_tokens.dart';
import '../tokens/radii.dart';
import '../tokens/spacing.dart';

enum DsButtonVariant { primary, secondary, ghost, danger }

class DsButton extends StatelessWidget {
  final String? label;
  final IconData? icon;
  final DsButtonVariant variant;
  final VoidCallback? onPressed;
  final bool small;
  final bool disabled;
  final bool iconOnly;
  final Color? overrideBg;
  final Color? overrideFg;

  const DsButton({
    super.key,
    this.label,
    this.icon,
    this.variant = DsButtonVariant.primary,
    this.onPressed,
    this.small = false,
    this.disabled = false,
    this.iconOnly = false,
    this.overrideBg,
    this.overrideFg,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final colors = _resolveColors(tokens);

    if (iconOnly && icon != null) {
      return IconButton(
        key: const ValueKey('ds-button'),
        onPressed: disabled ? null : onPressed,
        icon: Icon(
          icon,
          size: small ? 18 : 24,
          key: const ValueKey('ds-button-icon'),
        ),
        color: colors.fg,
        style: IconButton.styleFrom(
          backgroundColor: colors.bg,
          disabledBackgroundColor: colors.bg,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
          ),
        ),
      );
    }

    return SizedBox(
      key: const ValueKey('ds-button-sizer'),
      height: small ? 36 : 48,
      child: ElevatedButton(
        key: const ValueKey('ds-button'),
        onPressed: disabled ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: colors.bg,
          foregroundColor: colors.fg,
          disabledBackgroundColor: colors.bg.withValues(alpha: 0.5),
          elevation: 0,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
            side: colors.border != null
                ? BorderSide(color: colors.border!)
                : BorderSide.none,
          ),
          padding: EdgeInsets.symmetric(
            horizontal: small ? DsSpacing.sm : DsSpacing.md,
          ),
        ),
        child: _buildChild(colors),
      ),
    );
  }

  Widget _buildChild(_ButtonColors colors) {
    final textStyle = TextStyle(
      color: colors.fg,
      fontSize: small ? 13 : 14,
      fontWeight: FontWeight.w500,
    );

    if (icon != null && label != null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: small ? 16 : 20,
            key: const ValueKey('ds-button-icon'),
          ),
          SizedBox(width: DsSpacing.sm),
          Flexible(
            child: Text(
              label!,
              style: textStyle,
              key: const ValueKey('ds-button-label'),
            ),
          ),
        ],
      );
    }
    if (icon != null) {
      return Icon(
        icon,
        size: small ? 16 : 20,
        key: const ValueKey('ds-button-icon'),
      );
    }
    return Text(
      label ?? '',
      style: textStyle,
      key: const ValueKey('ds-button-label'),
    );
  }

  _ButtonColors _resolveColors(AppTokens t) {
    final bg = overrideBg;
    final fg = overrideFg;

    switch (variant) {
      case DsButtonVariant.primary:
        return _ButtonColors(bg: bg ?? t.accent, fg: fg ?? t.accentFg);
      case DsButtonVariant.secondary:
        return _ButtonColors(
          bg:
              bg ??
              (t.isDark ? const Color(0xFF3A3A3A) : const Color(0xFFE5E7EB)),
          fg: fg ?? t.fg,
          border: t.borderLight,
        );
      case DsButtonVariant.ghost:
        return _ButtonColors(bg: Colors.transparent, fg: fg ?? t.accent);
      case DsButtonVariant.danger:
        return _ButtonColors(bg: bg ?? t.danger, fg: fg ?? Colors.white);
    }
  }
}

class _ButtonColors {
  final Color bg;
  final Color fg;
  final Color? border;
  const _ButtonColors({required this.bg, required this.fg, this.border});
}
