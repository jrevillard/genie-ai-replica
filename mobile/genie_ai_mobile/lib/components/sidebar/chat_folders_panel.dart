import 'package:flutter/material.dart';
import 'dart:async';
import 'package:intl/intl.dart';
import 'package:genie_ai_mobile/services/chat_history_proxy.dart';
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

  String _selectedFolderId = "";
  bool _folderSelected = false;
  List<dynamic> _conversations = [];
  bool _isLoading = false;
  String? _errorMessage;
  String _searchTerm = "";
  Timer? _searchDebounceTimeout;

  List<dynamic> _folders = [];
  String _newFolderName = "";
  Map<String, dynamic>? _editingFolder;
  String _editingFolderName = "";

  Map<String, dynamic>? _activeChat;
  String _newChatTitle = "";
  String? _destinationFolderId;

  @override
  void initState() {
    super.initState();
    debugPrint("[CHAT_FOLDERS] Mounting component for user: ${widget.userId}");
    _loadInitialData();
  }

  @override
  void didUpdateWidget(ChatFoldersPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeTab != widget.activeTab) {
      debugPrint(
          "[CHAT_FOLDERS] Tab changed from '${oldWidget.activeTab}' to '${widget.activeTab}'");
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
    debugPrint("[CHAT_FOLDERS] State reset for tab change");
  }

  Future<void> _loadInitialData() async {
    debugPrint("[CHAT_FOLDERS] Loading initial data...");
    await _loadFoldersFromBackend();
    await _loadConversationsForCurrentTab();
  }

  Future<void> _loadFoldersFromBackend() async {
    try {
      debugPrint(
          "[CHAT_FOLDERS] Fetching folders for user ${widget.userId}...");
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
      debugPrint(
          "[CHAT_FOLDERS] Successfully loaded ${_folders.length} folders: ${_folders.map((f) => f['name']).join(', ')}");
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR loading folders: $e");
    }
  }

  Future<void> _loadConversationsForCurrentTab() async {
    if (widget.activeTab == 'folders' && !_folderSelected) {
      debugPrint(
          "[CHAT_FOLDERS] Folders tab active but no folder selected → showing empty list");
      setState(() => _conversations = []);
      return;
    }

    setState(() => _isLoading = true);
    debugPrint(
        "[CHAT_FOLDERS] Loading conversations for tab: ${widget.activeTab}");

    try {
      dynamic response;

      if (widget.activeTab == 'folders' &&
          _folderSelected &&
          _selectedFolderId.isNotEmpty) {
        debugPrint(
            "[CHAT_FOLDERS] Using folder-specific endpoint for folder ID: $_selectedFolderId");
        response = await _chatProxy.getFolderConversations(_selectedFolderId);
      } else {
        final Map<String, dynamic> options = {
          'limit': 100,
          'offset': 0,
          'includeArchived': widget.activeTab == 'archived',
        };

        if (widget.activeTab == 'starred') {
          options['isStarred'] = true;
          debugPrint("[CHAT_FOLDERS] Adding isStarred=true filter");
        }

        debugPrint(
            "[CHAT_FOLDERS] Calling getUserConversations with options: $options");

        response = await _chatProxy.getUserConversations(widget.userId, {},
            options: options);
      }

      if (!mounted) return;

      final List rawConvs = (response is Map<String, dynamic>)
          ? (response['conversations'] as List? ?? [])
          : (response as List? ?? []);

      debugPrint(
          "[CHAT_FOLDERS] API returned ${rawConvs.length} conversations");

      setState(() {
        _conversations = rawConvs.map((c) {
          final Map<String, dynamic> typedChat =
              Map<String, dynamic>.from(c as Map);
          final bool starred = typedChat['isStarred'] == true;
          final bool archived = typedChat['isArchived'] == true;
          final String folderId = typedChat['folderId'] ?? 'none';
          debugPrint(
              "[CHAT_FOLDERS] Chat: ${typedChat['title'] ?? 'Untitled'} | starred: $starred | archived: $archived | folderId: $folderId");
          return <String, dynamic>{
            ...typedChat,
            'isStarred': starred,
            'isArchived': archived,
          };
        }).toList();
        _isLoading = false;
      });

      debugPrint(
          "[CHAT_FOLDERS] Loaded ${_conversations.length} conversations into state");
    } catch (e, stack) {
      debugPrint("[CHAT_FOLDERS] ERROR loading conversations: $e");
      debugPrint("[CHAT_FOLDERS] Stack trace: $stack");
      if (mounted) {
        setState(() {
          _errorMessage = "Failed to load chats";
          _isLoading = false;
        });
      }
    }
  }

  List<dynamic> get _filteredConversations {
    final int before = _conversations.length;
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

    debugPrint(
        "[CHAT_FOLDERS] Filtered: $before → ${chats.length} conversations (tab: ${widget.activeTab}, search: '$_searchTerm')");
    return chats;
  }

  void _handleSearchInput(String val) {
    _searchDebounceTimeout?.cancel();
    _searchDebounceTimeout = Timer(const Duration(milliseconds: 300), () {
      debugPrint("[CHAT_FOLDERS] Search term updated: '$val'");
      setState(() => _searchTerm = val);
    });
  }

  Future<void> _toggleStarred(Map<String, dynamic> chat) async {
    final bool newStatus = !(chat['isStarred'] ?? false);
    final String title = chat['title'] ?? 'Untitled';
    debugPrint(
        "[CHAT_FOLDERS] Toggling starred for chat '$title' (_id: ${chat['_id']}) → $newStatus");

    try {
      // Strip 'conversations/' prefix for backend compatibility
      final String chatId = chat['_id'].replaceFirst('conversations/', '');

      await _chatProxy.updateConversation(chatId, {
        'isStarred': newStatus,
        'userId': widget.userId,
      });
      debugPrint("[CHAT_FOLDERS] Starred update API call successful");

      setState(() {
        chat['isStarred'] = newStatus;
        if (widget.activeTab == 'starred' && !newStatus) {
          _conversations.removeWhere((c) => c['_id'] == chat['_id']);
          debugPrint(
              "[CHAT_FOLDERS] Removed unstarred chat from starred tab list");
        }
      });
      await _loadConversationsForCurrentTab();
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR toggling starred: $e");
    }
  }

  Future<void> _toggleArchived(Map<String, dynamic> chat, bool value) async {
    final String title = chat['title'] ?? 'Untitled';
    debugPrint(
        "[CHAT_FOLDERS] Toggling archived for chat '$title' (_id: ${chat['_id']}) → $value");

    setState(() {
      chat['isArchived'] = value;
      if ((widget.activeTab != 'archived' && value) ||
          (widget.activeTab == 'archived' && !value)) {
        _conversations.removeWhere((c) => c['_id'] == chat['_id']);
        debugPrint(
            "[CHAT_FOLDERS] Optimistically removed chat from current view");
      }
    });

    try {
      // FIXED: Strip 'conversations/' prefix — backend expects bare key
      final String chatId = chat['_id'].replaceFirst('conversations/', '');

      await _chatProxy.updateConversation(chatId, {
        'isArchived': value,
        'userId': widget.userId,
      });
      debugPrint("[CHAT_FOLDERS] Archive update sent successfully");

      await _loadConversationsForCurrentTab();
      debugPrint("[CHAT_FOLDERS] Reloaded conversations after archive toggle");
    } catch (e) {
      debugPrint("[CHAT_FOLDERS] ERROR in archive toggle: $e");
      setState(() => chat['isArchived'] = !value);
      await _loadConversationsForCurrentTab();
    }
  }

  // All other methods (modals, UI) are unchanged — kept exactly as your version

  void _openCreateFolderModal() {
    _newFolderName = "";
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Create Folder"),
        content: TextField(
          autofocus: true,
          onChanged: (v) => _newFolderName = v,
          decoration: const InputDecoration(hintText: "Enter folder name"),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text("Cancel")),
          ElevatedButton(
            onPressed: () async {
              if (_newFolderName.trim().isNotEmpty) {
                await _chatProxy.createFolder(
                    {'userId': widget.userId, 'name': _newFolderName.trim()});
                if (mounted) Navigator.pop(ctx);
                _loadFoldersFromBackend();
              }
            },
            child: const Text("Create"),
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
        title: const Text("Edit Folder"),
        content: TextField(
          autofocus: true,
          controller: TextEditingController(text: _editingFolderName),
          onChanged: (v) => _editingFolderName = v,
          decoration: const InputDecoration(hintText: "Enter folder name"),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text("Cancel")),
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
            child: const Text("Save"),
          )
        ],
      ),
    );
  }

  void _openDeleteFolderDialog(Map<String, dynamic> folder) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Delete Folder"),
        content: Text(
            "Are you sure you want to delete '${folder['name']}'? All chats will be moved to the default folder."),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text("Cancel")),
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
            child: const Text("Delete"),
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
        title: const Text("Rename Conversation"),
        content: TextField(
          autofocus: true,
          controller: TextEditingController(text: _newChatTitle),
          onChanged: (v) => _newChatTitle = v,
          decoration: const InputDecoration(hintText: "Enter new title"),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text("Cancel")),
          ElevatedButton(
            onPressed: () async {
              if (_newChatTitle.trim().isNotEmpty) {
                final String chatId =
                    chat['_id'].replaceFirst('conversations/', '');
                await _chatProxy.updateConversation(chatId,
                    {'title': _newChatTitle.trim(), 'userId': widget.userId});
                setState(() => chat['title'] = _newChatTitle.trim());
                if (mounted) Navigator.pop(ctx);
              }
            },
            child: const Text("Save"),
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
          title: const Text("Move Chat"),
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
                child: const Text("Cancel")),
            ElevatedButton(
              onPressed: () async {
                if (_destinationFolderId != null) {
                  await _chatProxy.addConversationToFolder(
                      _destinationFolderId!, chat['_id'], widget.userId);
                  if (mounted) Navigator.pop(ctx);
                  _loadConversationsForCurrentTab();
                }
              },
              child: const Text("Move"),
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
        title: const Text("Delete Chat"),
        content: const Text("This action cannot be undone. Are you sure?"),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text("Cancel")),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              await _chatProxy.deleteConversation(chat['_id'], widget.userId);
              setState(() =>
                  _conversations.removeWhere((c) => c['_id'] == chat['_id']));
              if (mounted) Navigator.pop(ctx);
            },
            child: const Text("Delete"),
          )
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading)
      return const Center(
          child: CircularProgressIndicator(color: Color(0xFF4E97D1)));

    return Column(
      children: [
        _buildSearchBox(),
        if (widget.activeTab == 'folders') _buildFoldersHeader(),
        if (widget.activeTab == 'folders') _buildFoldersList(),
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

  // All UI builders unchanged — your exact code

  Widget _buildSearchBox() {
    return Padding(
      padding: const EdgeInsets.all(12.0),
      child: TextField(
        onChanged: _handleSearchInput,
        decoration: InputDecoration(
          hintText: "Search conversations...",
          prefixIcon: const Icon(Icons.search, size: 20, color: Colors.grey),
          isDense: true,
          filled: true,
          fillColor: Colors.black.withOpacity(0.04),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide.none),
        ),
      ),
    );
  }

  Widget _buildFoldersHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text("FOLDERS",
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: Colors.grey,
                  letterSpacing: 0.8)),
          IconButton(
            icon: const Icon(Icons.create_new_folder_outlined,
                size: 20, color: Color(0xFF4E97D1)),
            onPressed: _openCreateFolderModal,
          )
        ],
      ),
    );
  }

  Widget _buildFoldersList() {
    final nonDefault = _folders.where((f) => f['isDefault'] != true).toList();
    return Container(
      height: 135,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: nonDefault.length,
        itemBuilder: (ctx, idx) {
          final f = nonDefault[idx];
          final active = _selectedFolderId == f['id'];
          return Container(
            width: 140,
            margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: InkWell(
              onTap: () {
                debugPrint(
                    "[CHAT_FOLDERS] Folder tapped: ${f['name']} (id: ${f['id']})");
                setState(() {
                  _selectedFolderId = f['id'];
                  _folderSelected = true;
                });
                _loadConversationsForCurrentTab();
              },
              child: Card(
                elevation: active ? 4 : 1,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: BorderSide(
                        color: active
                            ? const Color(0xFF4E97D1)
                            : Colors.transparent,
                        width: 2)),
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.folder_open,
                          color: Color(0xFF4E97D1), size: 24),
                      const SizedBox(height: 4),
                      Flexible(
                        child: Text(f['name'],
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 12,
                                fontWeight: active
                                    ? FontWeight.bold
                                    : FontWeight.normal)),
                      ),
                      const Spacer(),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          IconButton(
                              icon: const Icon(Icons.edit, size: 16),
                              onPressed: () => _openEditFolderDialog(f),
                              constraints: const BoxConstraints()),
                          IconButton(
                              icon: const Icon(Icons.delete_outline,
                                  size: 16, color: Colors.red),
                              onPressed: () => _openDeleteFolderDialog(f),
                              constraints: const BoxConstraints()),
                        ],
                      )
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildChatItem(Map<String, dynamic> chat) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withOpacity(0.03),
              blurRadius: 8,
              offset: const Offset(0, 4))
        ],
      ),
      child: ListTile(
        onTap: () => widget.onOpenChat(chat['_id']),
        leading: CircleAvatar(
            backgroundColor: const Color(0xFFF2F6F9),
            child: Icon(
                chat['isArchived'] == true
                    ? Icons.archive_outlined
                    : Icons.chat_bubble_outline,
                size: 18,
                color: const Color(0xFF4E97D1))),
        title: Text(chat['title'] ?? "Untitled",
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(chat['preview'] ?? "No message preview",
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, color: Colors.black54)),
            const SizedBox(height: 4),
            Text(_formatDate(chat['updated']),
                style: const TextStyle(fontSize: 10, color: Colors.black26)),
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
      icon: const Icon(Icons.more_horiz, color: Colors.black26),
      onSelected: (val) {
        if (val == 'rename') _promptRenameChat(chat);
        if (val == 'move') _promptMoveChat(chat);
        if (val == 'archive')
          _toggleArchived(chat, !(chat['isArchived'] ?? false));
        if (val == 'delete') _showDeleteConversationDialog(chat);
      },
      itemBuilder: (ctx) => [
        const PopupMenuItem(
            value: 'rename',
            child: Row(children: [
              Icon(Icons.edit, size: 18),
              SizedBox(width: 8),
              Text("Rename")
            ])),
        const PopupMenuItem(
            value: 'move',
            child: Row(children: [
              Icon(Icons.folder_open, size: 18),
              SizedBox(width: 8),
              Text("Move to Folder")
            ])),
        PopupMenuItem(
            value: 'archive',
            child: Row(children: [
              const Icon(Icons.archive, size: 18),
              const SizedBox(width: 8),
              Text(chat['isArchived'] == true ? "Unarchive" : "Archive")
            ])),
        const PopupMenuDivider(),
        const PopupMenuItem(
            value: 'delete',
            child: Row(children: [
              Icon(Icons.delete_outline, size: 18, color: Colors.red),
              SizedBox(width: 8),
              Text("Delete", style: TextStyle(color: Colors.red))
            ])),
      ],
    );
  }

  Widget _buildEmptyState() {
    String msg = "No conversations found";
    if (widget.activeTab == 'starred') msg = "No starred conversations";
    if (widget.activeTab == 'archived') msg = "No archived conversations";
    if (widget.activeTab == 'folders' && !_folderSelected)
      msg = "Select a folder to view chats";

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
    if (date.day == now.day &&
        date.month == now.month &&
        date.year == now.year) {
      return DateFormat('h:mm a').format(date);
    }
    return DateFormat('MMM d, yyyy').format(date);
  }

  void _handleFoldersTabActivation() {
    debugPrint("[CHAT_FOLDERS] Folders tab activated");
    setState(() {
      _folderSelected = false;
      _conversations = [];
    });
    _loadFoldersFromBackend();
  }
}
