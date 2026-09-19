import 'package:flutter/material.dart';

import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_modal.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// A folder the user can file a conversation into.
class SaveFolder {
  final String id;
  final String name;
  const SaveFolder({required this.id, required this.name});
}

/// "Save Chat" prompt for a NEW conversation - the web ChatBotComponent
/// `saveChatDialog`, field for field: close (x), "Chat Title", "Select
/// Folder" (All Chats first), Cancel / Save, a saving indicator, and neither
/// close nor Cancel while the save runs.
///
/// Presentation-agnostic: it reports through [onDismiss] instead of popping a
/// route, so the chat can host it inline (see `InlineModal`) and keep the nav
/// bar live above it.
///
/// [onDismiss] receives `true` once [onSave] succeeds, `false` on Cancel, and
/// `null` on close (x).
class SaveConversationDialog extends StatefulWidget {
  static const String defaultFolderId = 'default';

  final String initialTitle;

  /// Folders to offer besides All Chats. Resolved after the dialog opens so
  /// the prompt never waits on the network; failures leave All Chats only.
  final Future<List<SaveFolder>> Function() loadFolders;

  /// Performs the save. `folderId` is null for All Chats. Returns success; on
  /// failure the dialog stays open so the user can retry or cancel.
  final Future<bool> Function(String title, String? folderId) onSave;

  final void Function(bool? result) onDismiss;

  const SaveConversationDialog({
    super.key,
    required this.initialTitle,
    required this.loadFolders,
    required this.onSave,
    required this.onDismiss,
  });

  @override
  State<SaveConversationDialog> createState() => _SaveConversationDialogState();
}

class _SaveConversationDialogState extends State<SaveConversationDialog> {
  late final TextEditingController _title = TextEditingController(
    text: widget.initialTitle,
  );
  List<SaveFolder> _folders = const [];
  String _folderId = SaveConversationDialog.defaultFolderId;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    // Re-evaluate the Save button's enabled state as the user types.
    _title.addListener(() => setState(() {}));
    widget.loadFolders().then(
      (folders) {
        if (mounted) setState(() => _folders = folders);
      },
      onError: (Object _) {
        // All Chats only - the folder list is a convenience, never a blocker.
      },
    );
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  bool get _canSave => !_saving && _title.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (!_canSave) return;
    setState(() => _saving = true);
    final folderId = _folderId == SaveConversationDialog.defaultFolderId
        ? null
        : _folderId;
    final ok = await widget.onSave(_title.text.trim(), folderId);
    if (!mounted) return;
    if (ok) {
      widget.onDismiss(true);
      return;
    }
    setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    final labelStyle = TextStyle(
      color: tokens.fg,
      fontSize: tokens.textSm,
      fontWeight: FontWeight.w500,
    );
    return DsModal(
      title: tr('chatbot.saveChat'),
      // Close (x) stays visible but is inert while the request runs (web:
      // close-on-click-modal / @close guard on isSaving).
      onClose: () {
        if (!_saving) widget.onDismiss(null);
      },
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(tr('chatbot.chatTitle'), style: labelStyle),
          const SizedBox(height: DsSpacing.xs),
          TextField(
            key: const Key('save_dialog_title'),
            controller: _title,
            enabled: !_saving,
            autofocus: true,
            style: TextStyle(color: tokens.fg),
            decoration: InputDecoration(
              hintText: tr('chatbot.chatTitlePlaceholder'),
              hintStyle: TextStyle(color: tokens.mutedSoft),
              border: const OutlineInputBorder(),
              isDense: true,
            ),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: DsSpacing.md),
          Text(tr('chatbot.selectFolder'), style: labelStyle),
          const SizedBox(height: DsSpacing.xs),
          DropdownButtonFormField<String>(
            key: const Key('save_dialog_folder'),
            initialValue: _folderId,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: [
              DropdownMenuItem(
                value: SaveConversationDialog.defaultFolderId,
                child: Text(tr('sidebar.allChats')),
              ),
              for (final f in _folders)
                DropdownMenuItem(value: f.id, child: Text(f.name)),
            ],
            onChanged: _saving
                ? null
                : (v) => setState(
                    () =>
                        _folderId = v ?? SaveConversationDialog.defaultFolderId,
                  ),
          ),
          if (_saving)
            Padding(
              padding: const EdgeInsets.only(top: DsSpacing.md),
              child: Row(
                key: const Key('save_dialog_saving'),
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: tokens.accent,
                    ),
                  ),
                  const SizedBox(width: DsSpacing.sm),
                  Text(
                    tr('chatbot.dialogs.saving'),
                    style: TextStyle(color: tokens.muted),
                  ),
                ],
              ),
            ),
        ],
      ),
      actions: [
        DsButton(
          key: const Key('save_dialog_cancel'),
          label: tr('common.cancel'),
          variant: DsButtonVariant.secondary,
          disabled: _saving,
          onPressed: _saving ? null : () => widget.onDismiss(false),
        ),
        Padding(
          padding: const EdgeInsets.only(left: DsSpacing.sm),
          child: DsButton(
            key: const Key('save_dialog_save'),
            label: tr('common.save'),
            variant: DsButtonVariant.primary,
            disabled: !_canSave,
            onPressed: _canSave ? _submit : null,
          ),
        ),
      ],
    );
  }
}
