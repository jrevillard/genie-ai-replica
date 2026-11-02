import 'package:flutter/material.dart';
import 'dart:async';
import 'package:intl/intl.dart';
import 'package:genie_ai_mobile/services/chat_history_proxy.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N SERVICE
import 'dart:convert';

class ChatFoldersPanel extends StatefulWidget {
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
  State<ChatFoldersPanel> createState() => _ChatFoldersPanelState();
}

class _ChatFoldersPanelState extends State<ChatFoldersPanel> {
  final ChatHistoryProxy _chatProxy = ChatHistoryProxy();

  // State
  String _selectedFolderId = "";
  bool _folderSelected = false;
  List<dynamic> _conversations = [];
  bool _isLoading = false;
  String? _errorMessage;
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
  void initState() {
    super.initState();
    _loadInitialData();
  }

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
      _errorMessage = null;
    });
  }

  Future<void> _loadInitialData() async {
    await _loadFoldersFromBackend();
    await _loadConversationsForCurrentTab();
  }

  Future<void> _loadFoldersFromBackend() async {
    try {
      final List rawFolders = await _chatProxy.getUserFolders(widget.userId);
      setState(() {
        _folders = rawFolders.map((f) {
          final Map<String, dynamic> typedFolder =
              Map<String, dynamic>.from(f as Map);
          return <String, dynamic>{
            ...typedFolder,
            'id': typedFolder['_key'] ?? typedFolder['id'],
            'isDefault': typedFolder['isDefault'] ?? false
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
      dynamic response;

      if (widget.activeTab == 'folders' &&
          _folderSelected &&
          _selectedFolderId.isNotEmpty) {
        response = await _chatProxy.getFolderConversations(_selectedFolderId);
      } else {
        final Map<String, dynamic> options = {
          'limit': 100,
          'offset': 0,
          'includeArchived': widget.activeTab == 'archived',
        };

        if (widget.activeTab == 'starred') {
          options['isStarred'] = true;
        }

        response = await _chatProxy.getUserConversations(widget.userId, {},
            options: options);
      }

      if (!mounted) return;

      final List rawConvs = (response is Map<String, dynamic>)
          ? (response['conversations'] as List? ?? [])
          : (response as List? ?? []);

      setState(() {
        _conversations = rawConvs.map((c) {
          final Map<String, dynamic> typedChat =
              Map<String, dynamic>.from(c as Map);
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
          _errorMessage =
              tr("sidebar.errorLoadingConversations"); // "Failed to load chats"
          _isLoading = false;
        });
      }
    }
  }

  List<dynamic> get _filteredConversations {
    var chats = _conversations;

    if (widget.activeTab != 'folders') {
      chats = chats.where((conv) {
        final bool matchesTab = (widget.activeTab == 'starred' &&
                conv['isStarred'] == true) ||
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
      final String chatId =
          chat['_id'].toString().replaceFirst('conversations/', '');
      await _chatProxy.updateConversation(chatId, {
        'isStarred': newStatus,
        'userId': widget.userId,
      });
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
      final String chatId =
          chat['_id'].toString().replaceFirst('conversations/', '');
      await _chatProxy.updateConversation(chatId, {
        'isArchived': value,
        'userId': widget.userId,
      });
      await _loadConversationsForCurrentTab();
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR in archive toggle: $e");
    }
  }

  // --- DIALOGS ---

  void _openCreateFolderModal() {
    _newFolderName = "";
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr("sidebar.createFolder")),
        content: TextField(
          autofocus: true,
          onChanged: (v) => _newFolderName = v,
          decoration:
              InputDecoration(hintText: tr("sidebar.folderNamePlaceholder")),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(tr("common.cancel"))),
          ElevatedButton(
            onPressed: () async {
              if (_newFolderName.trim().isNotEmpty) {
                await _chatProxy.createFolder(
                    {'userId': widget.userId, 'name': _newFolderName.trim()});
                if (mounted) Navigator.pop(ctx);
                _loadFoldersFromBackend();
              }
            },
            child: Text(tr("common.create")),
          )
        ],
      ),
    );
  }

  void _openEditFolderDialog(Map<String, dynamic> folder) {
    _editingFolderName = folder['name'];
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr("sidebar.editFolder")),
        content: TextField(
          autofocus: true,
          controller: TextEditingController(text: _editingFolderName),
          onChanged: (v) => _editingFolderName = v,
          decoration:
              InputDecoration(hintText: tr("sidebar.folderNamePlaceholder")),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(tr("common.cancel"))),
          ElevatedButton(
            onPressed: () async {
              if (_editingFolderName.trim().isNotEmpty) {
                await _chatProxy.updateFolder(folder['id'], {
                  'name': _editingFolderName.trim(),
                  'userId': widget.userId
                });
                if (mounted) Navigator.pop(ctx);
                _loadFoldersFromBackend();
              }
            },
            child: Text(tr("common.save")),
          )
        ],
      ),
    );
  }

  void _openDeleteFolderDialog(Map<String, dynamic> folder) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr("sidebar.deleteFolder")),
        content: Text(
            tr("sidebar.deleteFolderConfirm", args: {'name': folder['name']})),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(tr("common.cancel"))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              await _chatProxy.deleteFolder(folder['id'], widget.userId);
              if (mounted) Navigator.pop(ctx);
              _loadFoldersFromBackend();
              if (_selectedFolderId == folder['id']) {
                setState(() => _folderSelected = false);
              }
            },
            child: Text(tr("common.delete")),
          )
        ],
      ),
    );
  }

  void _promptRenameChat(Map<String, dynamic> chat) {
    _newChatTitle = chat['title'] ?? "";
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr("sidebar.renameChat")),
        content: TextField(
          autofocus: true,
          controller: TextEditingController(text: _newChatTitle),
          onChanged: (v) => _newChatTitle = v,
          decoration:
              InputDecoration(hintText: tr("sidebar.chatTitlePlaceholder")),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(tr("common.cancel"))),
          ElevatedButton(
            onPressed: () async {
              if (_newChatTitle.trim().isNotEmpty) {
                final String chatId =
                    chat['_id'].toString().replaceFirst('conversations/', '');
                await _chatProxy.updateConversation(chatId,
                    {'title': _newChatTitle.trim(), 'userId': widget.userId});
                setState(() => chat['title'] = _newChatTitle.trim());
                if (mounted) Navigator.pop(ctx);
              }
            },
            child: Text(tr("common.save")),
          )
        ],
      ),
    );
  }

  void _promptMoveChat(Map<String, dynamic> chat) {
    _destinationFolderId = _folders.isNotEmpty ? _folders[0]['id'] : null;
    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          title: Text(tr("sidebar.moveChat")),
          content: DropdownButton<String>(
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
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(tr("common.cancel"))),
            ElevatedButton(
              onPressed: () async {
                if (_destinationFolderId != null) {
                  final String convId =
                      chat['_id'].toString().replaceFirst('conversations/', '');
                  await _chatProxy.addConversationToFolder(
                      _destinationFolderId!, convId, widget.userId);
                  if (mounted) Navigator.pop(ctx);
                  _loadConversationsForCurrentTab();
                }
              },
              child: Text(tr("common.move")),
            )
          ],
        ),
      ),
    );
  }

  void _showDeleteConversationDialog(Map<String, dynamic> chat) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr("sidebar.deleteChat")),
        content: Text(tr("sidebar.deleteChatWarning")),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(tr("common.cancel"))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              try {
                final String chatId =
                    chat['_id'].toString().replaceFirst('conversations/', '');
                await _chatProxy.deleteConversation(chatId, widget.userId);

                if (mounted) {
                  setState(() => _conversations
                      .removeWhere((c) => c['_id'] == chat['_id']));
                  Navigator.pop(ctx);
                }
              } catch (e) {
                debugPrint("[CHAT_FOLDERS] ERROR deleting conversation: $e");
                if (mounted) Navigator.pop(ctx);
              }
            },
            child: Text(tr("common.delete")),
          )
        ],
      ),
    );
  }

  // --- BUILD METHODS ---

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Center(
          child:
              CircularProgressIndicator(color: Theme.of(context).primaryColor));
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
    final colors = ThemeManager().getColors();
    final bool isDark = ThemeManager().isDarkMode;

    return Padding(
      padding: const EdgeInsets.all(12.0),
      child: TextField(
        onChanged: _handleSearchInput,
        style: TextStyle(color: colors['text']),
        decoration: InputDecoration(
          hintText:
              tr("sidebar.searchConversations"), // "Search conversations..."
          hintStyle:
              TextStyle(color: isDark ? Colors.grey[500] : Colors.grey[600]),
          prefixIcon: Icon(Icons.search,
              size: 20, color: isDark ? Colors.grey[500] : Colors.grey),
          isDense: true,
          filled: true,
          fillColor: isDark
              ? Colors.white.withOpacity(0.05)
              : Colors.black.withOpacity(0.04),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide.none),
        ),
      ),
    );
  }

  Widget _buildFoldersHeader({bool showBackButton = false}) {
    final theme = Theme.of(context);
    String title = tr("sidebar.folders").toUpperCase(); // "FOLDERS"
    if (showBackButton) {
      final folder = _folders.firstWhere((f) => f['id'] == _selectedFolderId,
          orElse: () => {'name': 'Folder'});
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
                IconButton(
                  icon: const Icon(Icons.arrow_back, size: 20),
                  color: theme.primaryColor,
                  onPressed: () {
                    setState(() {
                      _folderSelected = false;
                      _conversations = [];
                    });
                  },
                ),
              if (!showBackButton) const SizedBox(width: 8),
              Text(title.toUpperCase(),
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: Colors.grey,
                      letterSpacing: 0.8)),
            ],
          ),
          if (!showBackButton)
            IconButton(
              icon: Icon(Icons.create_new_folder_outlined,
                  size: 20, color: theme.primaryColor),
              onPressed: _openCreateFolderModal,
            )
        ],
      ),
    );
  }

  Widget _buildVerticalFolderGrid() {
    final theme = Theme.of(context);
    final nonDefault = _folders.where((f) => f['isDefault'] != true).toList();

    if (nonDefault.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.folder_open, size: 48, color: Colors.black12),
            const SizedBox(height: 8),
            Text(tr("sidebar.noFolders"), // "No folders yet"
                style: const TextStyle(color: Colors.grey, fontSize: 13)),
          ],
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 1.1,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
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
          child: Card(
            elevation: 1,
            color: theme.cardColor, // Dynamic Card Background
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            child: Padding(
              padding: const EdgeInsets.all(8.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const SizedBox(height: 4),
                  Icon(Icons.folder_open, color: theme.primaryColor, size: 32),
                  Text(f['name'],
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: theme.textTheme.bodyLarge?.color)),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      IconButton(
                          icon: const Icon(Icons.edit, size: 18),
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          onPressed: () => _openEditFolderDialog(f)),
                      IconButton(
                          icon: const Icon(Icons.delete_outline,
                              size: 18, color: Colors.red),
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          onPressed: () => _openDeleteFolderDialog(f)),
                    ],
                  )
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildChatItem(Map<String, dynamic> chat) {
    final theme = Theme.of(context);
    final isDark = ThemeManager().isDarkMode;

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
    if (previewText.isEmpty)
      previewText = tr("chatbot.newChat"); // "New Conversation"

    // 3. Date
    final String dateStr = _formatDate(chat['updated']);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: theme.cardColor, // Dynamic Background
        borderRadius: BorderRadius.circular(12),
        // Lighter shadow for Light mode, subtle or no shadow for Dark mode
        boxShadow: isDark
            ? []
            : [
                BoxShadow(
                    color: Colors.black.withOpacity(0.03),
                    blurRadius: 8,
                    offset: const Offset(0, 4))
              ],
      ),
      child: ListTile(
        onTap: () {
          widget.onOpenChat(chat['_id']);
          Scaffold.maybeOf(context)?.closeDrawer();
        },
        leading: CircleAvatar(
            backgroundColor: theme.primaryColor.withOpacity(0.1),
            child: Icon(
                chat['isArchived'] == true
                    ? Icons.archive_outlined
                    : Icons.chat_bubble_outline,
                size: 18,
                color: theme.primaryColor)),
        title: Text(chat['title'] ?? tr("sidebar.untitled"), // "Untitled"
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(previewText,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 12,
                    color:
                        theme.textTheme.bodyMedium?.color?.withOpacity(0.7))),
            const SizedBox(height: 4),
            Text(
              "$dateStr • $msgCount ${tr('sidebar.messages').toLowerCase()}", // "messages"
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 10, color: Colors.grey),
            ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: Icon(
                  chat['isStarred'] == true ? Icons.star : Icons.star_outline,
                  color: Colors.orange,
                  size: 20),
              onPressed: () => _toggleStarred(chat),
            ),
            _buildChatMenu(chat),
          ],
        ),
      ),
    );
  }

  Widget _buildChatMenu(Map<String, dynamic> chat) {
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_horiz, color: Colors.grey),
      onSelected: (val) {
        if (val == 'rename') _promptRenameChat(chat);
        if (val == 'move') _promptMoveChat(chat);
        if (val == 'archive')
          _toggleArchived(chat, !(chat['isArchived'] ?? false));
        if (val == 'delete') _showDeleteConversationDialog(chat);
      },
      itemBuilder: (ctx) => [
        PopupMenuItem(
            value: 'rename',
            child: Row(children: [
              const Icon(Icons.edit, size: 18),
              const SizedBox(width: 8),
              Text(tr("sidebar.renameChat")) // "Rename"
            ])),
        PopupMenuItem(
            value: 'move',
            child: Row(children: [
              const Icon(Icons.folder_open, size: 18),
              const SizedBox(width: 8),
              Text(tr("sidebar.moveChat")) // "Move to Folder"
            ])),
        PopupMenuItem(
            value: 'archive',
            child: Row(children: [
              const Icon(Icons.archive, size: 18),
              const SizedBox(width: 8),
              Text(chat['isArchived'] == true
                  ? tr("sidebar.unarchive")
                  : tr("sidebar.archive")) // "Unarchive" / "Archive"
            ])),
        const PopupMenuDivider(),
        PopupMenuItem(
            value: 'delete',
            child: Row(children: [
              const Icon(Icons.delete_outline, size: 18, color: Colors.red),
              const SizedBox(width: 8),
              Text(tr("common.delete"),
                  style: const TextStyle(color: Colors.red)) // "Delete"
            ])),
      ],
    );
  }

  Widget _buildEmptyState() {
    String msg = tr("sidebar.noConversations"); // "No conversations found"
    if (widget.activeTab == 'starred') msg = tr("sidebar.noStarredChats");
    if (widget.activeTab == 'archived') msg = tr("sidebar.noArchivedChats");
    if (widget.activeTab == 'folders' && _folderSelected)
      msg = tr("sidebar.folderEmptyState"); // "Folder is empty"

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.chat_bubble_outline,
              size: 60, color: Colors.grey.withOpacity(0.2)),
          const SizedBox(height: 16),
          Text(msg, style: const TextStyle(color: Colors.grey, fontSize: 13)),
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
