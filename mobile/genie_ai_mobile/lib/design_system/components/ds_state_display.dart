import 'package:flutter/material.dart';

import '../../utils/theme_manager.dart' show ThemeManager;
import '../tokens/spacing.dart';
import 'ds_button.dart';
import 'ds_spinner.dart';

enum DsStateType { empty, error, loading }

class DsStateDisplay extends StatelessWidget {
  final DsStateType type;
  final String? message;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final Widget? customChild;

  const DsStateDisplay({
    super.key,
    required this.type,
    this.message,
    this.icon,
    this.actionLabel,
    this.onAction,
    this.customChild,
  });

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;

    switch (type) {
      case DsStateType.loading:
        return customChild ??
            Center(
              child: DsSpinner(
                size: DsSpinnerSize.lg,
                key: const ValueKey('ds-state-spinner'),
              ),
            );
      case DsStateType.empty:
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(DsSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon ?? Icons.inbox_outlined,
                  key: const ValueKey('ds-state-icon'),
                  size: 48,
                  color: tokens.muted,
                ),
                const SizedBox(height: DsSpacing.md),
                Text(
                  message ?? 'No data',
                  key: const ValueKey('ds-state-message'),
                  style: TextStyle(
                    color: tokens.muted,
                    fontSize: tokens.textBase,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (actionLabel != null && onAction != null) ...[
                  const SizedBox(height: DsSpacing.md),
                  DsButton(
                    key: const ValueKey('ds-state-action'),
                    label: actionLabel!,
                    variant: DsButtonVariant.secondary,
                    onPressed: onAction,
                  ),
                ],
              ],
            ),
          ),
        );
      case DsStateType.error:
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(DsSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon ?? Icons.error_outline,
                  key: const ValueKey('ds-state-icon'),
                  size: 48,
                  color: tokens.danger,
                ),
                const SizedBox(height: DsSpacing.md),
                Text(
                  message ?? 'Something went wrong',
                  key: const ValueKey('ds-state-message'),
                  style: TextStyle(
                    color: tokens.muted,
                    fontSize: tokens.textBase,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (actionLabel != null && onAction != null) ...[
                  const SizedBox(height: DsSpacing.md),
                  DsButton(
                    key: const ValueKey('ds-state-action'),
                    label: actionLabel!,
                    variant: DsButtonVariant.primary,
                    onPressed: onAction,
                  ),
                ],
              ],
            ),
          ),
        );
    }
  }
}
