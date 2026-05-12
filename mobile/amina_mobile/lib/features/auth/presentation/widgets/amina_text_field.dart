import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

/// Branded text field used across all auth screens.
///
/// Colours are fully theme-driven — reads from the nearest Theme so it adapts
/// automatically whether the parent forces dark (auth screens) or light.
/// Handles password visibility toggle internally.

class AminaTextField extends StatefulWidget {
  final String label;
  final String hint;
  final IconData prefixIcon;
  final bool isPassword;
  final TextEditingController controller;
  final TextInputType keyboardType;
  final String? Function(String?)? validator;

  const AminaTextField({
    super.key,
    required this.label,
    required this.hint,
    required this.prefixIcon,
    required this.controller,
    this.isPassword = false,
    this.keyboardType = TextInputType.text,
    this.validator,
  });

  @override
  State<AminaTextField> createState() => _AminaTextFieldState();
}

class _AminaTextFieldState extends State<AminaTextField> {
  bool _obscure = true;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;

    return TextFormField(
      controller: widget.controller,
      keyboardType: widget.isPassword
          ? TextInputType.visiblePassword
          : widget.keyboardType,
      obscureText:       widget.isPassword && _obscure,
      autocorrect:       !widget.isPassword,
      enableSuggestions: !widget.isPassword,
      validator: widget.validator,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      style: TextStyle(
        fontSize: 16,
        color: cs.onSurface,
        fontFamily: 'Inter',
      ),
      decoration: InputDecoration(
        labelText: widget.label,
        labelStyle: TextStyle(
          color: cs.onSurfaceVariant,
          fontFamily: 'Inter',
        ),
        hintText: widget.hint,
        hintStyle: TextStyle(
          color: cs.onSurfaceVariant.withValues(alpha: 0.55),
          fontSize: 14,
          fontFamily: 'Inter',
        ),

        // ── Prefix icon — sage accent ──────────────────────────────────
        prefixIcon: Icon(widget.prefixIcon, color: cs.primary, size: 20),

        // ── Suffix: visibility toggle ──────────────────────────────────
        suffixIcon: widget.isPassword
            ? IconButton(
                icon: Icon(
                  _obscure
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  color: cs.onSurfaceVariant,
                  size: 20,
                ),
                onPressed: () => setState(() => _obscure = !_obscure),
              )
            : null,
        filled: true,
        fillColor: amina.inputFill,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 20, vertical: 18),

        // Borders: inputFill → cardBorder → primary on focus → error
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: amina.cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: amina.cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: cs.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: cs.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: cs.error, width: 1.5),
        ),
        errorStyle: TextStyle(color: cs.error, fontFamily: 'Inter'),
      ),
    );
  }
}
