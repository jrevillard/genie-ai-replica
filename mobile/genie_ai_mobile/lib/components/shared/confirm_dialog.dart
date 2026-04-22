import 'package:flutter/material.dart';
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

    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

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
            margin: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF2A2A2A) : Colors.white,
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.2),
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
                  padding: const EdgeInsets.all(20),
                  child: Text(
                    effectiveTitle,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: theme.textTheme.bodyLarge?.color,
                    ),
                  ),
                ),
                // Body
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Text(
                    effectiveMessage,
                    style: TextStyle(
                      fontSize: 14,
                      color: isDark ? Colors.grey[300] : Colors.grey[700],
                      height: 1.5,
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                // Footer / Actions
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: isDark ? Colors.black12 : Colors.grey[50],
                    borderRadius: const BorderRadius.only(
                      bottomLeft: Radius.circular(12),
                      bottomRight: Radius.circular(12),
                    ),
                    border: Border(top: BorderSide(color: theme.dividerColor)),
                  ),
                  child: Wrap(
                    alignment: WrapAlignment.end,
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (secondaryText != null)
                        TextButton(
                          onPressed: onSecondary,
                          child: Text(
                            secondaryText!,
                            style: TextStyle(color: theme.primaryColor),
                          ),
                        ),
                      TextButton(
                        onPressed: onCancel,
                        child: Text(
                          effectiveCancelText,
                          style: TextStyle(
                            color: isDark ? Colors.white70 : Colors.grey[700],
                          ),
                        ),
                      ),
                      ElevatedButton(
                        onPressed: onConfirm,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: theme.primaryColor,
                          foregroundColor: Colors.white,
                        ),
                        child: Text(effectiveConfirmText),
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
