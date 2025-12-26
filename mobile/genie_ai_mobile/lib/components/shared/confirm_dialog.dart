import 'package:flutter/material.dart';

class ConfirmDialog extends StatelessWidget {
  final bool visible;
  final String title;
  final String message;
  final String confirmText;
  final String cancelText;
  final String? secondaryText;
  final Map<String, dynamic> parentStyles;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;
  final VoidCallback? onSecondary;

  const ConfirmDialog({
    super.key,
    required this.visible,
    this.title = "Confirm",
    this.message = "Are you sure?",
    this.confirmText = "OK",
    this.cancelText = "Cancel",
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

    return Material(
      color: Colors.transparent,
      child: Center(
        child: Container(
          width: 400,
          constraints: const BoxConstraints(maxWidth: 400),
          margin: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF2A2A2A) : Colors.white,
            borderRadius: BorderRadius.circular(8),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF333333) : Colors.grey[50],
                  border: Border(
                    bottom: BorderSide(color: theme.dividerColor),
                  ),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: isDark ? Colors.white : Colors.black87,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // Body
              Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  message,
                  style: theme.textTheme.bodyLarge?.copyWith(
                    color: isDark ? Colors.white70 : Colors.black87,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),

              // Footer
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  border: Border(
                    top: BorderSide(color: theme.dividerColor),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (secondaryText != null)
                      TextButton(
                        onPressed: onSecondary,
                        child: Text(
                          secondaryText!,
                          style: TextStyle(
                            color: theme.primaryColor,
                          ),
                        ),
                      ),
                    TextButton(
                      onPressed: onCancel,
                      child: Text(
                        cancelText,
                        style: TextStyle(
                          color: isDark ? Colors.white70 : Colors.grey[700],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: onConfirm,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: theme.primaryColor,
                        foregroundColor: Colors.white,
                      ),
                      child: Text(confirmText),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}