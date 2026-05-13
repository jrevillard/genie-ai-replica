import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N

class ConfirmDialog extends StatelessWidget {
  final bool visible;
  final String? title;
  final String? message;
  final String? confirmText;
  final String? cancelText;
  final String? secondaryText;
  final Map<String, dynamic> parentStyles;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;
  final VoidCallback? onSecondary;

  const ConfirmDialog({
    super.key,
    required this.visible,
    this.title,
    this.message,
    this.confirmText,
    this.cancelText,
    this.secondaryText,
    this.parentStyles = const {},
    required this.onConfirm,
    required this.onCancel,
    this.onSecondary,
  });

  @override
  Widget build(BuildContext context) {
    if (!visible) return const SizedBox.shrink();

    final tokens = ThemeManager().tokens;

    // Resolve translations for defaults
    final String effectiveTitle = title ?? tr('common.confirm');
    final String effectiveMessage =
        message ?? "Are you sure?"; // No generic key in en.dart yet
    final String effectiveConfirmText = confirmText ?? tr('common.ok');
    final String effectiveCancelText = cancelText ?? tr('common.cancel');

    return Material(
      color: Colors.transparent,
      child: SafeArea(
        child: Center(
          child: Container(
            width: 400,
            constraints: const BoxConstraints(maxWidth: 400),
            margin: const EdgeInsets.all(DsSpacing.xl),
            decoration: BoxDecoration(
              color: tokens.surface,
              borderRadius: BorderRadius.circular(DsRadii.lg),
              boxShadow: [
                BoxShadow(
                  color: tokens.scrim,
                  blurRadius: 16,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                Padding(
                  padding: const EdgeInsets.all(DsSpacing.xl),
                  child: Text(
                    effectiveTitle,
                    style: TextStyle(
                      fontSize: ThemeManager().tokens.textMd,
                      fontWeight: FontWeight.bold,
                      color: tokens.fg,
                    ),
                  ),
                ),
                // Body
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: DsSpacing.xl),
                  child: Text(
                    effectiveMessage,
                    style: TextStyle(
                      fontSize: ThemeManager().tokens.textBase,
                      color: tokens.muted,
                      height: 1.5,
                    ),
                  ),
                ),
                const SizedBox(height: DsSpacing.xl),
                // Footer / Actions
                Container(
                  padding: const EdgeInsets.all(DsSpacing.md),
                  decoration: BoxDecoration(
                    color: tokens.bg,
                    borderRadius: const BorderRadius.only(
                      bottomLeft: Radius.circular(DsRadii.lg),
                      bottomRight: Radius.circular(DsRadii.lg),
                    ),
                    border: Border(top: BorderSide(color: tokens.border)),
                  ),
                  child: Wrap(
                    alignment: WrapAlignment.end,
                    spacing: DsSpacing.sm,
                    runSpacing: DsSpacing.sm,
                    children: [
                      if (secondaryText != null)
                        DsButton(
                          label: secondaryText!,
                          variant: DsButtonVariant.ghost,
                          onPressed: onSecondary ?? () {},
                        ),
                      DsButton(
                        label: effectiveCancelText,
                        variant: DsButtonVariant.ghost,
                        onPressed: onCancel,
                      ),
                      DsButton(
                        label: effectiveConfirmText,
                        variant: DsButtonVariant.primary,
                        onPressed: onConfirm,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
