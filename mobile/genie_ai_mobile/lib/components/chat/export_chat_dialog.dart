import 'package:flutter/material.dart';

import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_modal.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// "Export chat to PDF" prompt: file name, close (x), Cancel / Export.
/// Presentation-agnostic like [SaveConversationDialog]: reports through
/// [onDismiss] (`true` = exported, `false` = Cancel, `null` = close).
class ExportChatDialog extends StatefulWidget {
  final String initialFilename;

  /// Performs the export; returns success. On failure the dialog stays open.
  final Future<bool> Function(String filename) onExport;

  final void Function(bool? result) onDismiss;

  const ExportChatDialog({
    super.key,
    required this.initialFilename,
    required this.onExport,
    required this.onDismiss,
  });

  @override
  State<ExportChatDialog> createState() => _ExportChatDialogState();
}

class _ExportChatDialogState extends State<ExportChatDialog> {
  late final TextEditingController _name = TextEditingController(
    text: widget.initialFilename,
  );
  bool _exporting = false;

  @override
  void initState() {
    super.initState();
    _name.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  bool get _canExport => !_exporting && _name.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (!_canExport) return;
    setState(() => _exporting = true);
    final ok = await widget.onExport(_name.text.trim());
    if (!mounted) return;
    if (ok) {
      widget.onDismiss(true);
      return;
    }
    setState(() => _exporting = false);
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    return DsModal(
      title: tr('chatbot.dialogs.exportTitle'),
      // Close (x) stays visible but is inert while the request runs (web:
      // close-on-click-modal / @close guard on isSaving).
      onClose: () {
        if (!_exporting) widget.onDismiss(null);
      },
      content: TextField(
        key: const Key('export_dialog_filename'),
        controller: _name,
        enabled: !_exporting,
        autofocus: true,
        style: TextStyle(color: tokens.fg),
        decoration: InputDecoration(
          hintText: tr('chatbot.dialogs.exportHint'),
          hintStyle: TextStyle(color: tokens.mutedSoft),
          border: const OutlineInputBorder(),
          suffixText: '.pdf',
          isDense: true,
        ),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        DsButton(
          key: const Key('export_dialog_cancel'),
          label: tr('common.cancel'),
          variant: DsButtonVariant.secondary,
          disabled: _exporting,
          onPressed: _exporting ? null : () => widget.onDismiss(false),
        ),
        Padding(
          padding: const EdgeInsets.only(left: DsSpacing.sm),
          child: DsButton(
            key: const Key('export_dialog_export'),
            label: tr('chatbot.dialogs.actions.export'),
            variant: DsButtonVariant.primary,
            disabled: !_canExport,
            onPressed: _canExport ? _submit : null,
          ),
        ),
      ],
    );
  }
}
