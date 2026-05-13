import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// ignore: depend_on_referenced_packages
import 'package:intl/intl.dart';
import 'package:openapi/api.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N SERVICE
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_card.dart';
import 'package:genie_ai_mobile/design_system/components/ds_modal.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';

class ChatFoldersPanel extends ConsumerStatefulWidget {
  final String activeTab;
  final String userId;
  final Function(String) onOpenChat;

  const ChatFoldersPanel({
    super.key,
    required this.activeTab,
    required this.userId,
    required this.onOpenChat,
  });

  @override
  ConsumerState<ChatFoldersPanel> createState() => _ChatFoldersPanelState();
}

class _ChatFoldersPanelState extends ConsumerState<ChatFoldersPanel> {
  late final ChatHistoryApi _chatHistoryApi;

  @override
  void initState() {
    super.initState();
    _chatHistoryApi = ref.read(chatHistoryApiProvider);
    _loadInitialData();
  }

  // State
  String _selectedFolderId = "";
  bool _folderSelected = false;
  List<dynamic> _conversations = [];
  bool _isLoading = false;
  String _searchTerm = "";
  Timer? _searchDebounceTimeout;

  // Folder Data
  List<dynamic> _folders = [];
  String _newFolderName = "";
  String _editingFolderName = "";

  // Chat Actions
  String _newChatTitle = "";
  String? _destinationFolderId;

  @override
  void didUpdateWidget(ChatFoldersPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeTab != widget.activeTab) {
      _resetComponentState();
      if (widget.activeTab == 'folders') {
        _handleFoldersTabActivation();
      } else {
        _loadConversationsForCurrentTab();
      }
    }
  }

  @override
  void dispose() {
    _searchDebounceTimeout?.cancel();
    super.dispose();
  }

  void _resetComponentState() {
    setState(() {
      _conversations = [];
      _folderSelected = false;
      _selectedFolderId = "";
      _searchTerm = "";
    });
  }

  Future<void> _loadInitialData() async {
    await _loadFoldersFromBackend();
    await _loadConversationsForCurrentTab();
  }

  Future<void> _loadFoldersFromBackend() async {
    try {
      final response = await _chatHistoryApi.apiChatFoldersGetWithHttpInfo();
      if (response.statusCode != 200) {
        throw Exception('Failed to load folders: ${response.statusCode}');
      }
      final List rawFolders = jsonDecode(response.body) as List;
      setState(() {
        _folders = rawFolders.map((f) {
          final Map<String, dynamic> typedFolder = Map<String, dynamic>.from(
            f as Map,
          );
          return <String, dynamic>{
            ...typedFolder,
            'id': typedFolder['_key'] ?? typedFolder['id'],
            'isDefault': typedFolder['isDefault'] ?? false,
          };
        }).toList();
      });
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR loading folders: $e");
    }
  }

  Future<void> _loadConversationsForCurrentTab() async {
    if (widget.activeTab == 'folders' && !_folderSelected) {
      setState(() => _conversations = []);
      return;
    }

    setState(() => _isLoading = true);

    try {
      final response = widget.activeTab == 'folders' &&
          _folderSelected &&
          _selectedFolderId.isNotEmpty
          ? await _chatHistoryApi.apiChatFoldersFolderIdGetWithHttpInfo(_selectedFolderId)
          : await _chatHistoryApi.apiChatConversationsGetWithHttpInfo(
              limit: 100,
              offset: 0,
              includeArchived: widget.activeTab == 'archived',
              filterStarred: widget.activeTab == 'starred',
            );

      if (!mounted) return;

      if (response.statusCode != 200) {
        throw Exception('Failed to load conversations: ${response.statusCode}');
      }

      final body = jsonDecode(response.body);
      final List rawConvs = (body is Map<String, dynamic>)
          ? (body['conversations'] as List? ?? [])
          : (body as List? ?? []);

      setState(() {
        _conversations = rawConvs.map((c) {
          final Map<String, dynamic> typedChat = Map<String, dynamic>.from(
            c as Map,
          );
          return <String, dynamic>{
            ...typedChat,
            'isStarred': typedChat['isStarred'] == true,
            'isArchived': typedChat['isArchived'] == true,
          };
        }).toList();
        _isLoading = false;
      });
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR loading conversations: $e");
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  List<dynamic> get _filteredConversations {
    var chats = _conversations;

    if (widget.activeTab != 'folders') {
      chats = chats.where((conv) {
        final bool matchesTab =
            (widget.activeTab == 'starred' && conv['isStarred'] == true) ||
            (widget.activeTab == 'archived' && conv['isArchived'] == true) ||
            (widget.activeTab != 'starred' &&
                widget.activeTab != 'archived' &&
                widget.activeTab != 'folders' &&
                conv['isArchived'] != true);
        return matchesTab;
      }).toList();
    }

    if (_searchTerm.isNotEmpty) {
      final term = _searchTerm.toLowerCase().trim();
      chats = chats.where((conv) {
        return (conv['title']?.toString().toLowerCase().contains(term) ??
                false) ||
            (conv['preview']?.toString().toLowerCase().contains(term) ?? false);
      }).toList();
    }

    chats.sort((a, b) {
      final dateA = DateTime.tryParse(a['updated'] ?? '') ?? DateTime(0);
      final dateB = DateTime.tryParse(b['updated'] ?? '') ?? DateTime(0);
      return dateB.compareTo(dateA);
    });

    return chats;
  }

  void _handleSearchInput(String val) {
    _searchDebounceTimeout?.cancel();
    _searchDebounceTimeout = Timer(const Duration(milliseconds: 300), () {
      setState(() => _searchTerm = val);
    });
  }

  // --- ACTIONS ---

  Future<void> _toggleStarred(Map<String, dynamic> chat) async {
    final bool newStatus = !(chat['isStarred'] ?? false);
    try {
      final String chatId = chat['_id'].toString().replaceFirst(
        'conversations/',
        '',
      );
      final request = ApiChatConversationsConversationIdPatchRequest(
        isStarred: newStatus,
      );
      await _chatHistoryApi.apiChatConversationsConversationIdPatchWithHttpInfo(chatId, request);
      setState(() {
        chat['isStarred'] = newStatus;
        if (widget.activeTab == 'starred' && !newStatus) {
          _conversations.removeWhere((c) => c['_id'] == chat['_id']);
        }
      });
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR toggling starred: $e");
    }
  }

  Future<void> _toggleArchived(Map<String, dynamic> chat, bool value) async {
    setState(() {
      chat['isArchived'] = value;
      if ((widget.activeTab != 'archived' && value) ||
          (widget.activeTab == 'archived' && !value)) {
        _conversations.removeWhere((c) => c['_id'] == chat['_id']);
      }
    });
    try {
      final String chatId = chat['_id'].toString().replaceFirst(
        'conversations/',
        '',
      );
      final request = ApiChatConversationsConversationIdPatchRequest(
        isArchived: value,
      );
      await _chatHistoryApi.apiChatConversationsConversationIdPatchWithHttpInfo(chatId, request);
      await _loadConversationsForCurrentTab();
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR in archive toggle: $e");
    }
  }

  // --- DIALOGS ---

  void _openCreateFolderModal() {
    _newFolderName = "";
    DsModal.show(
      context: context,
      title: tr("sidebar.createFolder"),
      content: TextField(
        autofocus: true,
        onChanged: (v) => _newFolderName = v,
        decoration: InputDecoration(
          hintText: tr("sidebar.folderNamePlaceholder"),
        ),
      ),
      actions: [
        DsButton(
          label: tr("common.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          label: tr("common.create"),
          variant: DsButtonVariant.primary,
          onPressed: () async {
            if (_newFolderName.trim().isNotEmpty) {
              try {
                final request = ApiChatFoldersPostRequest(
                  name: _newFolderName.trim(),
                );
                await _chatHistoryApi.apiChatFoldersPostWithHttpInfo(request);
                if (mounted) Navigator.pop(context);
                _loadFoldersFromBackend();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('${tr('sidebar.errorCreatingFolder')}: $e')),
                  );
                }
              }
            }
          },
        ),
      ],
    );
  }

  void _openEditFolderDialog(Map<String, dynamic> folder) {
    _editingFolderName = folder['name'];
    DsModal.show(
      context: context,
      title: tr("sidebar.editFolder"),
      content: TextField(
        autofocus: true,
        controller: TextEditingController(text: _editingFolderName),
        onChanged: (v) => _editingFolderName = v,
        decoration: InputDecoration(
          hintText: tr("sidebar.folderNamePlaceholder"),
        ),
      ),
      actions: [
        DsButton(
          label: tr("common.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          label: tr("common.save"),
          variant: DsButtonVariant.primary,
          onPressed: () async {
            if (_editingFolderName.trim().isNotEmpty) {
              try {
                final request = ApiChatFoldersFolderIdPatchRequest(
                  name: _editingFolderName.trim(),
                );
                await _chatHistoryApi.apiChatFoldersFolderIdPatchWithHttpInfo(folder['id'], request);
                if (mounted) Navigator.pop(context);
                _loadFoldersFromBackend();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('${tr('sidebar.errorUpdatingFolder')}: $e')),
                  );
                }
              }
            }
          },
        ),
      ],
    );
  }

  void _openDeleteFolderDialog(Map<String, dynamic> folder) {
    DsModal.show(
      context: context,
      title: tr("sidebar.deleteFolder"),
      content: Text(
        tr("sidebar.deleteFolderConfirm", args: {'name': folder['name']}),
      ),
      actions: [
        DsButton(
          label: tr("common.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          label: tr("common.delete"),
          variant: DsButtonVariant.danger,
          onPressed: () async {
            try {
              await _chatHistoryApi.apiChatFoldersFolderIdDeleteWithHttpInfo(folder['id']);
              if (mounted) Navigator.pop(context);
              _loadFoldersFromBackend();
              if (_selectedFolderId == folder['id']) {
                setState(() => _folderSelected = false);
              }
            } catch (e) {
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('${tr('sidebar.errorDeletingFolder')}: $e')),
                );
              }
            }
          },
        ),
      ],
    );
  }

  void _promptRenameChat(Map<String, dynamic> chat) {
    _newChatTitle = chat['title'] ?? "";
    DsModal.show(
      context: context,
      title: tr("sidebar.renameChat"),
      content: TextField(
        autofocus: true,
        controller: TextEditingController(text: _newChatTitle),
        onChanged: (v) => _newChatTitle = v,
        decoration: InputDecoration(
          hintText: tr("sidebar.chatTitlePlaceholder"),
        ),
      ),
      actions: [
        DsButton(
          label: tr("common.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          label: tr("common.save"),
          variant: DsButtonVariant.primary,
          onPressed: () async {
            if (_newChatTitle.trim().isNotEmpty) {
              try {
                final String chatId = chat['_id'].toString().replaceFirst(
                  'conversations/',
                  '',
                );
                final request = ApiChatConversationsConversationIdPatchRequest(
                  title: _newChatTitle.trim(),
                );
                await _chatHistoryApi.apiChatConversationsConversationIdPatchWithHttpInfo(chatId, request);
                setState(() => chat['title'] = _newChatTitle.trim());
                if (mounted) Navigator.pop(context);
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('${tr('sidebar.errorUpdatingConversation')}: $e')),
                  );
                }
              }
            }
          },
        ),
      ],
    );
  }

  void _promptMoveChat(Map<String, dynamic> chat) {
    _destinationFolderId = _folders.isNotEmpty ? _folders[0]['id'] : null;
    DsModal.show(
      context: context,
      title: tr("sidebar.moveChat"),
      content: StatefulBuilder(
        builder: (context, setModalState) => DropdownButton<String>(
          value: _destinationFolderId,
          isExpanded: true,
          items: _folders.map((f) {
            return DropdownMenuItem<String>(
              value: f['id'] as String,
              child: Text(f['name']),
            );
          }).toList(),
          onChanged: (v) => setModalState(() => _destinationFolderId = v),
        ),
      ),
      actions: [
        DsButton(
          label: tr("common.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          label: tr("common.move"),
          variant: DsButtonVariant.primary,
          onPressed: () async {
            if (_destinationFolderId != null) {
              try {
                final String convId = chat['_id'].toString().replaceFirst(
                  'conversations/',
                  '',
                );
                await _chatHistoryApi.apiChatFoldersFolderIdConversationsConversationIdPostWithHttpInfo(
                  _destinationFolderId!,
                  convId,
                );
                if (mounted) Navigator.pop(context);
                _loadConversationsForCurrentTab();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('${tr('sidebar.errorMovingChat')}: $e')),
                  );
                }
              }
            }
          },
        ),
      ],
    );
  }

  void _showDeleteConversationDialog(Map<String, dynamic> chat) {
    DsModal.show(
      context: context,
      title: tr("sidebar.deleteChat"),
      content: Text(tr("sidebar.deleteChatWarning")),
      actions: [
        DsButton(
          label: tr("common.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          label: tr("common.delete"),
          variant: DsButtonVariant.danger,
          onPressed: () async {
            try {
              final String chatId = chat['_id'].toString().replaceFirst(
                'conversations/',
                '',
              );
              await _chatHistoryApi.apiChatConversationsConversationIdDeleteWithHttpInfo(chatId);

              if (mounted) {
                setState(
                  () => _conversations.removeWhere(
                    (c) => c['_id'] == chat['_id'],
                  ),
                );
                Navigator.pop(context);
              }
            } catch (e) {
              debugPrint("[CHAT_FOLDERS] ERROR deleting conversation: $e");
              if (mounted) Navigator.pop(context);
            }
          },
        ),
      ],
    );
  }

  // --- BUILD METHODS ---

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    if (_isLoading) {
      return Center(child: CircularProgressIndicator(color: tokens.accent));
    }

    if (widget.activeTab == 'folders' && !_folderSelected) {
      return Column(
        children: [
          _buildSearchBox(),
          _buildFoldersHeader(showBackButton: false),
          Expanded(child: _buildVerticalFolderGrid()),
        ],
      );
    }

    if (widget.activeTab == 'folders' && _folderSelected) {
      return Column(
        children: [
          _buildSearchBox(),
          _buildFoldersHeader(showBackButton: true),
          Expanded(
            child: _filteredConversations.isEmpty
                ? _buildEmptyState()
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: _filteredConversations.length,
                    itemBuilder: (ctx, idx) =>
                        _buildChatItem(_filteredConversations[idx]),
                  ),
          ),
        ],
      );
    }

    return Column(
      children: [
        _buildSearchBox(),
        Expanded(
          child: _filteredConversations.isEmpty
              ? _buildEmptyState()
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: _filteredConversations.length,
                  itemBuilder: (ctx, idx) =>
                      _buildChatItem(_filteredConversations[idx]),
                ),
        ),
      ],
    );
  }

  Widget _buildSearchBox() {
    final tokens = ThemeManager().tokens;

    return Padding(
      padding: const EdgeInsets.all(DsSpacing.md),
      child: TextField(
        onChanged: _handleSearchInput,
        style: TextStyle(color: tokens.fg),
        decoration: InputDecoration(
          hintText: tr(
            "sidebar.searchConversations",
          ), // "Search conversations..."
          hintStyle: TextStyle(color: tokens.muted),
          prefixIcon: Icon(Icons.search, size: 20, color: tokens.muted),
          isDense: true,
          filled: true,
          fillColor: tokens.muted20,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DsRadii.lg),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _buildFoldersHeader({bool showBackButton = false}) {
    final tokens = ThemeManager().tokens;
    String title = tr("sidebar.folders").toUpperCase(); // "FOLDERS"
    if (showBackButton) {
      final folder = _folders.firstWhere(
        (f) => f['id'] == _selectedFolderId,
        orElse: () => {'name': 'Folder'},
      );
      title = folder['name'];
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 16, 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              if (showBackButton)
                DsButton(
                  iconOnly: true,
                  icon: Icons.arrow_back,
                  variant: DsButtonVariant.ghost,
                  overrideFg: tokens.fg,
                  onPressed: () {
                    setState(() {
                      _folderSelected = false;
                      _conversations = [];
                    });
                  },
                ),
              if (!showBackButton) const SizedBox(width: 8),
              Text(
                title.toUpperCase(),
                style: TextStyle(
                  fontSize: ThemeManager().tokens.textXs,
                  fontWeight: FontWeight.bold,
                  color: tokens.muted,
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
          if (!showBackButton)
            DsButton(
              iconOnly: true,
              icon: Icons.create_new_folder_outlined,
              variant: DsButtonVariant.ghost,
              overrideFg: tokens.accent,
              onPressed: _openCreateFolderModal,
            ),
        ],
      ),
    );
  }

  Widget _buildVerticalFolderGrid() {
    final tokens = ThemeManager().tokens;
    final nonDefault = _folders.where((f) => f['isDefault'] != true).toList();

    if (nonDefault.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.folder_open, size: 48, color: tokens.muted20),
            const SizedBox(height: 8),
            Text(
              tr("sidebar.noFolders"), // "No folders yet"
              style: TextStyle(
                color: tokens.muted,
                fontSize: ThemeManager().tokens.textSm,
              ),
            ),
          ],
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(DsSpacing.md),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 1.1,
        crossAxisSpacing: DsSpacing.md,
        mainAxisSpacing: DsSpacing.md,
      ),
      itemCount: nonDefault.length,
      itemBuilder: (ctx, idx) {
        final f = nonDefault[idx];
        return InkWell(
          onTap: () {
            setState(() {
              _selectedFolderId = f['id'];
              _folderSelected = true;
            });
            _loadConversationsForCurrentTab();
          },
          child: DsCard(
            variant: DsCardVariant.elevated,
            overrideBg: tokens.surface,
            padding: const EdgeInsets.all(DsSpacing.sm),
            radius: DsRadii.lg,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const SizedBox(height: 4),
                Icon(Icons.folder_open, color: tokens.accent, size: 32),
                Text(
                  f['name'],
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: ThemeManager().tokens.textSm,
                    fontWeight: FontWeight.bold,
                    color: tokens.fg,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    DsButton(
                      iconOnly: true,
                      icon: Icons.edit,
                      variant: DsButtonVariant.ghost,
                      overrideFg: tokens.fg,
                      small: true,
                      onPressed: () => _openEditFolderDialog(f),
                    ),
                    DsButton(
                      iconOnly: true,
                      icon: Icons.delete_outline,
                      variant: DsButtonVariant.ghost,
                      overrideFg: tokens.danger,
                      small: true,
                      onPressed: () => _openDeleteFolderDialog(f),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildChatItem(Map<String, dynamic> chat) {
    final tokens = ThemeManager().tokens;

    // 1. Calculate Message Count
    final List messages = chat['messages'] as List? ?? [];
    final int msgCount =
        int.tryParse(chat['messageCount']?.toString() ?? '') ?? messages.length;

    // 2. Determine Preview
    String previewText = "";
    if (chat['lastMessage'] != null) {
      if (chat['lastMessage'] is String) {
        previewText = chat['lastMessage'];
      } else if (chat['lastMessage'] is Map) {
        previewText =
            chat['lastMessage']['content'] ?? chat['lastMessage']['text'] ?? "";
      }
    }
    if (previewText.isEmpty && messages.isNotEmpty) {
      final lastMsg = messages.last;
      if (lastMsg is Map) {
        previewText = lastMsg['content'] ?? lastMsg['text'] ?? "";
      } else {
        previewText = lastMsg.toString();
      }
    }
    if (previewText.isEmpty) {
      previewText = tr("chatbot.newChat"); // "New Conversation"
    }

    // 3. Date
    final String dateStr = _formatDate(chat['updated']);

    return Container(
      margin: const EdgeInsets.symmetric(
        horizontal: DsSpacing.md,
        vertical: DsSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: tokens.surface,
        borderRadius: BorderRadius.circular(DsRadii.lg),
        boxShadow: tokens.isDark
            ? []
            : [
                BoxShadow(
                  color: tokens.muted20,
                  blurRadius: 8,
                  offset: const Offset(0, 4),
                ),
              ],
      ),
      child: ListTile(
        onTap: () {
          widget.onOpenChat(chat['_id']);
          Scaffold.maybeOf(context)?.closeDrawer();
        },
        leading: CircleAvatar(
          backgroundColor: tokens.accent10,
          child: Icon(
            chat['isArchived'] == true
                ? Icons.archive_outlined
                : Icons.chat_bubble_outline,
            size: 18,
            color: tokens.accent,
          ),
        ),
        title: Text(
          chat['title'] ?? tr("sidebar.untitled"), // "Untitled"
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: ThemeManager().tokens.textBase,
            color: ThemeManager().tokens.fg,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              previewText,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: ThemeManager().tokens.textSm,
                color: tokens.fg70,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              "$dateStr • $msgCount ${tr('sidebar.messages').toLowerCase()}", // "messages"
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: ThemeManager().tokens.textXs,
                color: tokens.muted,
              ),
            ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            DsButton(
              iconOnly: true,
              icon: chat['isStarred'] == true ? Icons.star : Icons.star_outline,
              variant: DsButtonVariant.ghost,
              overrideFg: tokens.warning,
              onPressed: () => _toggleStarred(chat),
            ),
            _buildChatMenu(chat),
          ],
        ),
      ),
    );
  }

  Widget _buildChatMenu(Map<String, dynamic> chat) {
    final tokens = ThemeManager().tokens;
    return PopupMenuButton<String>(
      icon: Icon(Icons.more_horiz, color: tokens.muted),
      onSelected: (val) {
        if (val == 'rename') {
          _promptRenameChat(chat);
        }
        if (val == 'move') {
          _promptMoveChat(chat);
        }
        if (val == 'archive') {
          _toggleArchived(chat, !(chat['isArchived'] ?? false));
        }
        if (val == 'delete') {
          _showDeleteConversationDialog(chat);
        }
      },
      itemBuilder: (ctx) => [
        PopupMenuItem(
          value: 'rename',
          child: Row(
            children: [
              Icon(Icons.edit, size: 18, color: ThemeManager().tokens.fg),
              const SizedBox(width: 8),
              Text(tr("sidebar.renameChat")), // "Rename"
            ],
          ),
        ),
        PopupMenuItem(
          value: 'move',
          child: Row(
            children: [
              Icon(
                Icons.folder_open,
                size: 18,
                color: ThemeManager().tokens.fg,
              ),
              const SizedBox(width: 8),
              Text(tr("sidebar.moveChat")), // "Move to Folder"
            ],
          ),
        ),
        PopupMenuItem(
          value: 'archive',
          child: Row(
            children: [
              Icon(Icons.archive, size: 18, color: ThemeManager().tokens.fg),
              const SizedBox(width: 8),
              Text(
                chat['isArchived'] == true
                    ? tr("sidebar.unarchive")
                    : tr("sidebar.archive"),
              ), // "Unarchive" / "Archive"
            ],
          ),
        ),
        const PopupMenuDivider(),
        PopupMenuItem(
          value: 'delete',
          child: Row(
            children: [
              Icon(
                Icons.delete_outline,
                size: 18,
                color: ThemeManager().tokens.danger,
              ),
              const SizedBox(width: 8),
              Text(
                tr("common.delete"),
                style: TextStyle(color: ThemeManager().tokens.danger),
              ), // "Delete"
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyState() {
    final tokens = ThemeManager().tokens;
    String msg = tr("sidebar.noConversations");
    if (widget.activeTab == 'starred') {
      msg = tr("sidebar.noStarredChats");
    }
    if (widget.activeTab == 'archived') {
      msg = tr("sidebar.noArchivedChats");
    }
    if (widget.activeTab == 'folders' && _folderSelected) {
      msg = tr("sidebar.folderEmptyState");
    }

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.chat_bubble_outline, size: 60, color: tokens.muted20),
          const SizedBox(height: DsSpacing.md),
          Text(
            msg,
            style: TextStyle(
              color: tokens.muted,
              fontSize: ThemeManager().tokens.textSm,
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(String? dateStr) {
    if (dateStr == null) return "";
    final date = DateTime.tryParse(dateStr) ?? DateTime.now();
    final now = DateTime.now();

    // Pass current locale code to DateFormat
    final String localeCode = I18nService().currentLocale.languageCode;

    if (date.day == now.day &&
        date.month == now.month &&
        date.year == now.year) {
      return DateFormat('h:mm a', localeCode).format(date);
    }
    return DateFormat('MMM d, yyyy', localeCode).format(date);
  }

  void _handleFoldersTabActivation() {
    setState(() {
      _folderSelected = false;
      _conversations = [];
    });
    _loadFoldersFromBackend();
  }
}
