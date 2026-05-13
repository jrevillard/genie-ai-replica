import 'package:flutter/material.dart';

import '../../utils/theme_manager.dart' show ThemeManager;
import '../tokens/spacing.dart';

enum DsModalSize { sm, md, lg, xl }

class DsModal extends StatelessWidget {
  final String title;
  final Widget content;
  final List<Widget>? actions;
  final DsModalSize size;

  const DsModal({
    super.key,
    required this.title,
    required this.content,
    this.actions,
    this.size = DsModalSize.md,
  });

  static Future<T?> show<T>({
    required BuildContext context,
    required String title,
    required Widget content,
    List<Widget>? actions,
    DsModalSize size = DsModalSize.md,
  }) {
    return showDialog<T>(
      context: context,
      builder: (_) => DsModal(
        title: title,
        content: content,
        actions: actions,
        size: size,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final maxWidth = switch (size) {
      DsModalSize.sm => 360.0,
      DsModalSize.md => 480.0,
      DsModalSize.lg => 640.0,
      DsModalSize.xl => 800.0,
    };

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(
        horizontal: DsSpacing.lg,
        vertical: DsSpacing.xl,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                DsSpacing.lg,
                DsSpacing.lg,
                DsSpacing.md,
                DsSpacing.md,
              ),
              child: Text(
                title,
                style: TextStyle(
                  color: tokens.fg,
                  fontSize: 18 * tokens.fontScale,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  DsSpacing.lg,
                  DsSpacing.md,
                  DsSpacing.lg,
                  DsSpacing.lg,
                ),
                child: content,
              ),
            ),
            if (actions != null && actions!.isNotEmpty) ...[
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  DsSpacing.md,
                  DsSpacing.sm,
                  DsSpacing.md,
                  DsSpacing.md,
                ),
                child: Row(
                  children: actions!,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
