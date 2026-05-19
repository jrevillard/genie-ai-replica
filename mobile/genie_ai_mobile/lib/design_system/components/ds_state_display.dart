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
        return customChild ?? Center(child: DsSpinner(size: DsSpinnerSize.lg));
      case DsStateType.empty:
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(DsSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon ?? Icons.inbox_outlined,
                  size: 48,
                  color: tokens.muted,
                ),
                const SizedBox(height: DsSpacing.md),
                Text(
                  message ?? 'No data',
                  style: TextStyle(
                    color: tokens.muted,
                    fontSize: tokens.textBase,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (actionLabel != null && onAction != null) ...[
                  const SizedBox(height: DsSpacing.md),
                  DsButton(
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
                  size: 48,
                  color: tokens.danger,
                ),
                const SizedBox(height: DsSpacing.md),
                Text(
                  message ?? 'Something went wrong',
                  style: TextStyle(
                    color: tokens.muted,
                    fontSize: tokens.textBase,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (actionLabel != null && onAction != null) ...[
                  const SizedBox(height: DsSpacing.md),
                  DsButton(
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
