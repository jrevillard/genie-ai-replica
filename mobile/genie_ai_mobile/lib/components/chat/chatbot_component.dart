import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:genie_ai_mobile/components/shared/confirm_dialog.dart';
import 'package:genie_ai_mobile/services/chat_history_proxy.dart';
import 'package:genie_ai_mobile/services/chatbot_proxy.dart';
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';

class ChatBotComponent extends StatefulWidget {
  final String userId;
  final VoidCallback onRefreshSidebar;
  final Function(List<dynamic>) onRelatedDocumentsUpdate;

  const ChatBotComponent({
    super.key,
    required this.userId,
    required this.onRefreshSidebar,
    required this.onRelatedDocumentsUpdate,
  });

  @override
  // State class is public so GlobalKey in main.dart can access it
  ChatBotComponentState createState() => ChatBotComponentState();
}

class ChatBotComponentState extends State<ChatBotComponent> {
  final ChatHistoryProxy _chatHistoryProxy = ChatHistoryProxy();
  final ChatbotProxy _chatBotProxy = ChatbotProxy();
  final ApiService _api = ApiService();

  // Conversation State
  String? _currentConversationId;
  String _conversationTitle = "New Chat";
  List<Map<String, dynamic>> _messages = [];
  bool _isLoading = false;

  // Inputs
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _inputController = TextEditingController();
  final FocusNode _inputFocusNode = FocusNode();

  // Context & Related Data
  String? _selectedCategoryId;
  String _selectedCategoryName = "";
  List<dynamic> _relatedDocuments = [];
  List<Map<String, dynamic>> _quickHelpButtons = [];

  // Dialog States
  bool _showNewChatConfirm = false;
  bool _showLoadConfirm = false;
  String? _pendingLoadConversationId;
  bool _showExportDialog = false;
  String _exportFilename = "";
  bool _showSaveDialog = false;
  final TextEditingController _titleController = TextEditingController();

  @override
  void initState() {
    super.initState();
    debugPrint("[CHATBOT] Mounting component for user: ${widget.userId}");
    _loadQuickHelpConfig();
    _titleController.text = _conversationTitle;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _inputController.dispose();
    _inputFocusNode.dispose();
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _loadQuickHelpConfig() async {
    try {
      final String jsonString =
          await rootBundle.loadString('assets/config/quickhelp/buttons.json');
      final dynamic data = jsonDecode(jsonString);
      final List buttons = data is List ? data : data['buttons'] ?? [];
      setState(() {
        _quickHelpButtons = buttons.cast<Map<String, dynamic>>();
      });
    } catch (e) {
      debugPrint("[CHATBOT] Failed to load quick help config: $e");
    }
  }

  void _scrollToBottom({bool animated = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        final double maxScroll = _scrollController.position.maxScrollExtent;
        if (animated) {
          _scrollController.animateTo(maxScroll,
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeOut);
        } else {
          _scrollController.jumpTo(maxScroll);
        }
      }
    });
  }

  // ===========================================================================
  // PUBLIC METHODS (Called via GlobalKey from Main)
  // ===========================================================================

  /// Sets the active context (Service Category) for the chatbot
  void setCategoryContext(String categoryId, String categoryName) {
    setState(() {
      _selectedCategoryId = categoryId;
      _selectedCategoryName = categoryName;
    });
    // Optional: Notify user via toast that context changed
    // NotificationService.info("Context set to: $categoryName");
  }

  /// Loads a specific conversation by ID
  Future<void> loadConversation(String conversationId) async {
    if (_messages.isNotEmpty && _currentConversationId == null) {
      _pendingLoadConversationId = conversationId;
      setState(() => _showLoadConfirm = true);
    } else {
      await _loadConversationDirect(conversationId);
    }
  }

  // ===========================================================================
  // LOGIC
  // ===========================================================================

  Future<void> _loadConversationDirect(String conversationId) async {
    setState(() => _isLoading = true);
    // Reset but keep loading spinner active
    _resetChat(keepLoading: true);

    try {
      // 1. Fetch full conversation details from Backend
      // We use the direct API call to ensure we hit the GET /:id endpoint
      // which returns the 'messages' array.
      final cleanId = conversationId.replaceFirst('conversations/', '');
      final res = await _api.get('chat/conversations/$cleanId',
          params: {'userId': widget.userId});

      if (res.statusCode != 200) {
        throw Exception("Failed to load conversation: ${res.statusCode}");
      }

      final Map<String, dynamic> conv = jsonDecode(res.body);

      // 2. Parse Messages
      List<Map<String, dynamic>> loadedMessages = [];
      if (conv['messages'] != null && conv['messages'] is List) {
        loadedMessages = (conv['messages'] as List).map((m) {
          return {
            'role': m['sender'] == 'user' ? 'user' : 'assistant',
            'content': m['content'],
            'timestamp': m['timestamp'],
            'isSaved': true, // Mark as saved so we don't duplicate on next save
            'confidence': m['confidence'],
            'metadata': m['metadata'],
            // Extract sources if available
            'sources': m['metadata'] != null
                ? (m['metadata']['sources'] ??
                    m['metadata']['source_documents'])
                : [],
          };
        }).toList();
      }

      // 3. Restore Context if available
      String? savedCategoryName = "";
      if (conv['category'] != null) {
        // If backend stores the name, use it. If it's just ID, we might fetch name.
        // For now, we leave it blank or use the ID as fallback if needed.
        // _selectedCategoryId = conv['category'];
      }

      // 4. Update UI State
      setState(() {
        _currentConversationId = conv['_id'] ?? conv['_key'];
        _conversationTitle = conv['title'] ?? "Untitled Chat";
        _titleController.text = _conversationTitle;
        _messages = loadedMessages;
        if (savedCategoryName.isNotEmpty)
          _selectedCategoryName = savedCategoryName;
      });

      // 5. Update Right Sidebar with docs from the last assistant message
      final lastAssistant = loadedMessages.lastWhere(
        (m) => m['role'] == 'assistant',
        orElse: () => {},
      );

      if (lastAssistant.isNotEmpty && lastAssistant['sources'] != null) {
        _relatedDocuments = List<dynamic>.from(lastAssistant['sources']);
        widget.onRelatedDocumentsUpdate(_relatedDocuments);
      }

      widget.onRefreshSidebar();
      _scrollToBottom(animated: false);
    } catch (e) {
      NotificationService.error("Failed to load conversation");
      debugPrint("[CHATBOT] Load error: $e");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void startNewChat() {
    if (_messages.isNotEmpty && _currentConversationId == null) {
      setState(() => _showNewChatConfirm = true);
    } else {
      _resetChat();
    }
  }

  void _resetChat({bool keepLoading = false}) {
    setState(() {
      _currentConversationId = null;
      _conversationTitle = "New Chat";
      _titleController.text = _conversationTitle;
      _messages = [];
      _relatedDocuments = [];
      // Note: We typically do NOT clear context (_selectedCategoryId) on New Chat
      // unless user explicitly closes it.
      if (!keepLoading) _isLoading = false;
    });
    widget.onRelatedDocumentsUpdate([]);
    _inputController.clear();
  }

  void _sendMessage(String text) async {
    if (text.trim().isEmpty || _isLoading) return;

    final userMessage = {
      'role': 'user',
      'content': text.trim(),
      'timestamp': DateTime.now().toIso8601String(),
      'isSaved': false,
    };

    setState(() {
      _messages.add(userMessage);
      _isLoading = true;
    });

    _inputController.clear();
    _scrollToBottom();

    try {
      final String sessionId =
          _currentConversationId ?? 'session_${widget.userId}';

      final List<Map<String, dynamic>> messagesForApi = _messages.map((m) {
        return {
          'role': m['role'],
          'content': m['content'],
        };
      }).toList();

      // Submit to AI
      final response = await _chatBotProxy.submitQuery(
        sessionId: sessionId,
        messages: messagesForApi,
        userId: widget.userId,
        categoryId: _selectedCategoryId, 
        contextLabels: _selectedCategoryName, // FIX: Pass the labels string (Context)
      );

      final String? queryId = response['queryId'];
      final Map<String, dynamic>? metadata = response['metadata'];

      final assistantMessage = {
        'role': 'assistant',
        'content': response['response'] ?? 'No response received',
        'timestamp': DateTime.now().toIso8601String(),
        'sources': metadata?['sources'] ?? [],
        'confidence': metadata?['confidence_score'],
        'queryId': queryId,
        'metadata': metadata,
        'isSaved': false,
      };

      final newDocs =
          metadata?['sources'] ?? metadata?['source_documents'] ?? [];

      setState(() {
        _messages.add(assistantMessage);
        _relatedDocuments = List<dynamic>.from(newDocs);
        _isLoading = false;
      });

      widget.onRelatedDocumentsUpdate(_relatedDocuments);
      _scrollToBottom();
    } catch (e) {
      setState(() => _isLoading = false);
      NotificationService.error("Failed to get response");
      debugPrint("[CHATBOT] Send error: $e");
    }
  }

  void _quickHelpPressed(Map<String, dynamic> button) {
    final prompt = button['prompt'] as String;
    _inputController.text = prompt;
    _inputFocusNode.requestFocus();
  }

  // ===========================================================================
  // SAVING LOGIC (CRITICAL FIX FOR VUE COMPATIBILITY)
  // ===========================================================================
  Future<void> saveConversation({String? folderId}) async {
    if (_messages.isEmpty) {
      NotificationService.info("Nothing to save");
      return;
    }

    setState(() {
      _conversationTitle = _titleController.text.trim().isEmpty
          ? "Untitled Chat"
          : _titleController.text.trim();
    });

    try {
      final String sessionId = 'session_${widget.userId}';

      final data = {
        'userId': widget.userId,
        'title': _conversationTitle,
        if (_selectedCategoryId != null) 'categoryId': _selectedCategoryId,
        'sessionId': sessionId,
      };

      // 1. Create or Update Conversation Document
      dynamic conversationResponse;
      if (_currentConversationId == null) {
        conversationResponse = await _chatHistoryProxy.createConversation(data);
      } else {
        final id = _currentConversationId!.replaceFirst('conversations/', '');
        conversationResponse =
            await _chatHistoryProxy.updateConversation(id, data);
      }

      final String conversationId =
          conversationResponse['_key'] ?? conversationResponse['_id'];
      final String conversationIdClean =
          conversationId.replaceFirst('conversations/', '');

      // 2. Iterate and Save Messages individually to the 'messages' collection
      // This is required so the Vue app can load them via ChatHistoryService
      for (int i = 0; i < _messages.length; i++) {
        final msg = _messages[i];

        // Skip if already saved
        if (msg['isSaved'] == true) continue;

        final messagePayload = {
          'conversationId': conversationIdClean,
          'content': msg['content'],
          'sender': msg['role'] == 'user' ? 'user' : 'assistant',
          'userId': widget.userId,
          // Attach technical metadata for assistant messages
          if (msg['queryId'] != null) 'queryId': msg['queryId'],
          if (msg['metadata'] != null) 'metadata': msg['metadata'],
        };

        try {
          await _chatHistoryProxy.addMessage(
              conversationIdClean, messagePayload);
          // Mark locally as saved
          setState(() {
            _messages[i]['isSaved'] = true;
          });
        } catch (msgError) {
          debugPrint("[SAVE] Error saving message index $i: $msgError");
        }
      }

      setState(() {
        _currentConversationId =
            conversationResponse['_id'] ?? _currentConversationId;
        _showSaveDialog = false;
      });

      NotificationService.success("Conversation saved");
      widget.onRefreshSidebar();
    } catch (e) {
      debugPrint("[SAVE] ERROR: $e");
      NotificationService.error("Failed to save conversation");
    }
  }

  // ===========================================================================
  // EXPORT LOGIC
  // ===========================================================================
  Future<void> exportChatToPDF() async {
    final pdf = pw.Document();

    pw.Font? customFont;
    try {
      final fontData = await rootBundle.load("assets/fonts/Roboto-Regular.ttf");
      customFont = pw.Font.ttf(fontData);
    } catch (e) {
      debugPrint("Custom font not available, falling back: $e");
      customFont = null;
    }

    final pages = <pw.Widget>[];

    pages.add(
      pw.Center(
        child: pw.Text(
          _conversationTitle,
          style: pw.TextStyle(
              font: customFont, fontSize: 24, fontWeight: pw.FontWeight.bold),
        ),
      ),
    );
    pages.add(pw.SizedBox(height: 20));

    for (final msg in _messages) {
      final bool isUser = msg['role'] == 'user';
      final String sender = isUser ? "You" : "Genie AI";
      final String content = msg['content'] ?? '';

      final paragraphs = content.split('\n\n');

      for (final paragraph in paragraphs) {
        if (paragraph.trim().isEmpty) continue;

        pages.add(
          pw.Container(
            margin: const pw.EdgeInsets.symmetric(vertical: 8),
            child: pw.Column(
              crossAxisAlignment: isUser
                  ? pw.CrossAxisAlignment.end
                  : pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  sender,
                  style: pw.TextStyle(
                    font: customFont,
                    fontSize: 12,
                    fontWeight: pw.FontWeight.bold,
                    color: isUser ? PdfColors.blue800 : PdfColors.grey800,
                  ),
                ),
                pw.SizedBox(height: 4),
                pw.Container(
                  constraints: const pw.BoxConstraints(maxWidth: 500),
                  padding: const pw.EdgeInsets.all(12),
                  decoration: pw.BoxDecoration(
                    color: isUser ? PdfColors.blue50 : PdfColors.grey100,
                    borderRadius: pw.BorderRadius.circular(12),
                    border: pw.Border.all(color: PdfColors.grey300),
                  ),
                  child: pw.Text(
                    paragraph.trim(),
                    style: pw.TextStyle(
                        font: customFont, fontSize: 14, height: 1.4),
                  ),
                ),
              ],
            ),
          ),
        );
        pages.add(pw.SizedBox(height: 8));
      }
    }

    try {
      pdf.addPage(
        pw.MultiPage(
          pageFormat: PdfPageFormat.a4.copyWith(
              marginBottom: 60, marginTop: 60, marginLeft: 50, marginRight: 50),
          build: (pw.Context context) => pages,
          footer: (pw.Context context) => pw.Container(
            alignment: pw.Alignment.centerRight,
            margin: const pw.EdgeInsets.only(top: 20),
            child: pw.Text(
              'Page ${context.pageNumber} of ${context.pagesCount}',
              style: pw.TextStyle(
                  font: customFont, fontSize: 10, color: PdfColors.grey600),
            ),
          ),
        ),
      );

      final filename = _exportFilename.trim().isEmpty
          ? "genie_chat_${DateTime.now().toIso8601String().split('T').first}"
          : _exportFilename.trim();

      await Printing.sharePdf(
        bytes: await pdf.save(),
        filename: '$filename.pdf',
      );

      NotificationService.success("Chat exported successfully");
      setState(() => _showExportDialog = false);
    } catch (e) {
      debugPrint("PDF Export failed: $e");
      NotificationService.error("Failed to export PDF");
    }
  }

  // ===========================================================================
  // UI BUILD
  // ===========================================================================
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Stack(
      children: [
        Column(
          children: [
            // -----------------------------------------------------------------
            // CONTEXT BAR (Visible only when Service/Context is selected)
            // -----------------------------------------------------------------
            if (_selectedCategoryName.isNotEmpty)
              Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer.withOpacity(0.2),
                  border: Border(bottom: BorderSide(color: theme.dividerColor)),
                ),
                child: Row(
                  children: [
                    Icon(Icons.lightbulb_outline,
                        size: 20, color: theme.colorScheme.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        "Context: $_selectedCategoryName",
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: theme.colorScheme.onSurface,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Tooltip(
                      message: "Remove Context",
                      child: IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        // Clear the context when clicked
                        onPressed: () => setCategoryContext("", ""),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                        splashRadius: 20,
                      ),
                    ),
                  ],
                ),
              ),

            // -----------------------------------------------------------------
            // MESSAGES AREA
            // -----------------------------------------------------------------
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.all(16),
                itemCount: _messages.length + (_isLoading ? 1 : 0),
                itemBuilder: (context, index) {
                  // Loading Indicator
                  if (index == _messages.length && _isLoading) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Row(
                        children: [
                          CircularProgressIndicator(strokeWidth: 2),
                          SizedBox(width: 12),
                          Text("Genie is thinking..."),
                        ],
                      ),
                    );
                  }

                  final msg = _messages[index];
                  final bool isUser = msg['role'] == 'user';

                  return Align(
                    alignment:
                        isUser ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 8),
                      padding: const EdgeInsets.all(16),
                      constraints: BoxConstraints(
                          maxWidth: MediaQuery.of(context).size.width * 0.75),
                      decoration: BoxDecoration(
                        color: isUser
                            ? theme.primaryColor
                            : (theme.brightness == Brightness.dark
                                ? Colors.grey[800]
                                : Colors.grey[200]),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          MarkdownBody(
                            data: msg['content'] ?? '',
                            styleSheet: MarkdownStyleSheet(
                              p: TextStyle(
                                color: isUser
                                    ? Colors.white
                                    : theme.textTheme.bodyLarge?.color,
                                fontSize: 16,
                                height: 1.5,
                              ),
                              codeblockDecoration: BoxDecoration(
                                color: isUser
                                    ? Colors.white.withOpacity(0.1)
                                    : Colors.black12,
                                borderRadius: BorderRadius.circular(8),
                              ),
                            ),
                            selectable: true,
                            onTapLink: (text, href, title) {
                              if (href != null) {
                                launchUrl(Uri.parse(href),
                                    mode: LaunchMode.externalApplication);
                              }
                            },
                          ),
                          if (msg['role'] == 'assistant' &&
                              msg['confidence'] != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Text(
                                "Confidence: ${((msg['confidence'] as num) * 100).toStringAsFixed(1)}%",
                                style: TextStyle(
                                    fontSize: 12,
                                    color: isUser
                                        ? Colors.white70
                                        : theme.textTheme.bodySmall?.color,
                                    fontStyle: FontStyle.italic),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),

            // -----------------------------------------------------------------
            // QUICK HELP BUTTONS
            // -----------------------------------------------------------------
            if (_quickHelpButtons.isNotEmpty && _messages.isEmpty)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _quickHelpButtons.map((btn) {
                    IconData icon;
                    try {
                      icon = IconData(btn['iconCodePoint'],
                          fontFamily: 'MaterialIcons');
                    } catch (e) {
                      icon = Icons.help_outline;
                    }
                    return ActionChip(
                      avatar: Icon(icon, size: 16),
                      label: Text(btn['label']),
                      onPressed: () => _quickHelpPressed(btn),
                      backgroundColor: theme.colorScheme.surface,
                      side: BorderSide(color: theme.dividerColor),
                    );
                  }).toList(),
                ),
              ),

            // -----------------------------------------------------------------
            // INPUT AREA
            // -----------------------------------------------------------------
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: theme.cardColor,
                border: Border(top: BorderSide(color: theme.dividerColor)),
              ),
              child: Column(
                children: [
                  // Action Toolbar
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.add_circle_outline),
                        tooltip: "New Chat",
                        onPressed: startNewChat,
                      ),
                      IconButton(
                        icon: const Icon(Icons.save_outlined),
                        tooltip: "Save Chat",
                        onPressed: () {
                          _titleController.text = _conversationTitle;
                          setState(() => _showSaveDialog = true);
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.picture_as_pdf_outlined),
                        tooltip: "Export to PDF",
                        onPressed: () {
                          _exportFilename =
                              "chat_${DateTime.now().toIso8601String().split('T').first}";
                          setState(() => _showExportDialog = true);
                        },
                      ),
                      const Spacer(),
                    ],
                  ),
                  const SizedBox(height: 8),

                  // Text Input
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _inputController,
                          focusNode: _inputFocusNode,
                          decoration: InputDecoration(
                            hintText: "Type your message...",
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8)),
                            contentPadding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 14),
                          ),
                          maxLines: null,
                          onSubmitted: (_) =>
                              _sendMessage(_inputController.text),
                        ),
                      ),
                      const SizedBox(width: 12),
                      IconButton(
                        icon: const Icon(Icons.send),
                        color: theme.primaryColor,
                        onPressed: _isLoading
                            ? null
                            : () => _sendMessage(_inputController.text),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),

        // ---------------------------------------------------------------------
        // DIALOGS
        // ---------------------------------------------------------------------

        // New Chat Confirmation
        ConfirmDialog(
          visible: _showNewChatConfirm,
          title: "Start New Chat?",
          message: "You have unsaved changes. Start new chat anyway?",
          confirmText: "Discard & New",
          cancelText: "Cancel",
          secondaryText: "Save First",
          onConfirm: () {
            setState(() => _showNewChatConfirm = false);
            _resetChat();
          },
          onCancel: () => setState(() => _showNewChatConfirm = false),
          onSecondary: () {
            setState(() => _showNewChatConfirm = false);
            _titleController.text = _conversationTitle;
            setState(() => _showSaveDialog = true);
          },
        ),

        // Load Confirmation
        ConfirmDialog(
          visible: _showLoadConfirm,
          title: "Load Conversation?",
          message: "You have unsaved changes. Load anyway?",
          confirmText: "Discard & Load",
          cancelText: "Cancel",
          secondaryText: "Save First",
          onConfirm: () {
            setState(() => _showLoadConfirm = false);
            _loadConversationDirect(_pendingLoadConversationId!);
          },
          onCancel: () => setState(() => _showLoadConfirm = false),
          onSecondary: () {
            setState(() => _showLoadConfirm = false);
            _titleController.text = _conversationTitle;
            setState(() => _showSaveDialog = true);
          },
        ),

        // Save Dialog
        if (_showSaveDialog)
          AlertDialog(
            title: const Text("Save Conversation"),
            content: TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                hintText: "Enter conversation title",
                border: OutlineInputBorder(),
              ),
              onChanged: (v) => _conversationTitle = v,
              autofocus: true,
            ),
            actions: [
              TextButton(
                onPressed: () => setState(() => _showSaveDialog = false),
                child: const Text("Cancel"),
              ),
              ElevatedButton(
                onPressed: () {
                  saveConversation().then((_) {
                    // Dialog close handled inside saveConversation
                  });
                },
                child: const Text("Save"),
              ),
            ],
          ),

        // Export Dialog
        if (_showExportDialog)
          AlertDialog(
            title: const Text("Export Chat to PDF"),
            content: TextField(
              decoration:
                  const InputDecoration(hintText: "Filename (without .pdf)"),
              onChanged: (v) => _exportFilename = v,
              controller: TextEditingController(text: _exportFilename),
            ),
            actions: [
              TextButton(
                onPressed: () => setState(() => _showExportDialog = false),
                child: const Text("Cancel"),
              ),
              ElevatedButton(
                onPressed:
                    _exportFilename.trim().isEmpty ? null : exportChatToPDF,
                child: const Text("Export"),
              ),
            ],
          ),
      ],
    );
  }
}