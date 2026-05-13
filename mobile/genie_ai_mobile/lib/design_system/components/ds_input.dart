import 'package:flutter/material.dart';

import '../../utils/theme_manager.dart' show ThemeManager;
import '../tokens/radii.dart';
import '../tokens/spacing.dart';

enum DsInputSize { sm, md, lg }

class DsInput extends StatelessWidget {
  final String? value;
  final ValueChanged<String>? onChanged;
  final String? placeholder;
  final bool obscureText;
  final bool enabled;
  final int maxLines;
  final DsInputSize size;
  final TextEditingController? controller;
  final TextInputType? keyboardType;
  final IconData? prefixIcon;
  final Widget? suffix;
  final FocusNode? focusNode;
  final Color? overrideFillColor;
  final Color? overrideBorderColor;

  const DsInput({
    super.key,
    this.value,
    this.onChanged,
    this.placeholder,
    this.obscureText = false,
    this.enabled = true,
    this.maxLines = 1,
    this.size = DsInputSize.md,
    this.controller,
    this.keyboardType,
    this.prefixIcon,
    this.suffix,
    this.focusNode,
    this.overrideFillColor,
    this.overrideBorderColor,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final verticalPadding = _verticalPadding;

    return SizedBox(
      height: maxLines > 1 ? null : _height,
      child: TextField(
        controller: controller,
        obscureText: obscureText,
        enabled: enabled,
        maxLines: maxLines,
        keyboardType: keyboardType,
        focusNode: focusNode,
        onChanged: onChanged,
        style: TextStyle(color: tokens.fg, fontSize: _fontSize),
        decoration: InputDecoration(
          hintText: placeholder,
          hintStyle: TextStyle(color: tokens.muted, fontSize: _fontSize),
          prefixIcon: prefixIcon != null
              ? Icon(prefixIcon, color: tokens.muted, size: _fontSize + 4)
              : null,
          suffixIcon: suffix,
          filled: true,
          fillColor: overrideFillColor ?? (tokens.isDark ? tokens.surface : tokens.bg),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
            borderSide: BorderSide(color: tokens.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
            borderSide: BorderSide(color: tokens.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
            borderSide: BorderSide(
              color: overrideBorderColor ?? tokens.accent,
              width: 2,
            ),
          ),
          disabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
            borderSide: BorderSide(color: tokens.borderLight),
          ),
          contentPadding: EdgeInsets.symmetric(
            horizontal: DsSpacing.md,
            vertical: verticalPadding,
          ),
        ),
      ),
    );
  }

  double get _height => switch (size) {
    DsInputSize.sm => 36,
    DsInputSize.md => 44,
    DsInputSize.lg => 52,
  };

  double get _fontSize => switch (size) {
    DsInputSize.sm => 13,
    DsInputSize.md => 14,
    DsInputSize.lg => 16,
  };

  double get _verticalPadding => switch (size) {
    DsInputSize.sm => 6,
    DsInputSize.md => 10,
    DsInputSize.lg => 14,
  };
}
