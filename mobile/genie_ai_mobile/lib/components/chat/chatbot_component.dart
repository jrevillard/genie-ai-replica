import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:genie_ai_mobile/components/shared/confirm_dialog.dart';
import 'package:genie_ai_mobile/services/chat_history_proxy.dart';
import 'package:genie_ai_mobile/services/chatbot_proxy.dart';
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
  State<ChatBotComponent> createState() => _ChatBotComponentState();
}

class _ChatBotComponentState extends State<ChatBotComponent> {
  final ChatHistoryProxy _chatHistoryProxy = ChatHistoryProxy();
  final ChatbotProxy _chatBotProxy = ChatbotProxy();

  String? _currentConversationId;
  String _conversationTitle = "New Chat";
  List<Map<String, dynamic>> _messages = [];
  bool _isLoading = false;
  bool _isStreaming = false;
  String _streamingText = "";
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _inputController = TextEditingController();
  final FocusNode _inputFocusNode = FocusNode();

  String? _selectedCategoryId;
  String _selectedCategoryName = "";

  List<dynamic> _relatedDocuments = [];

  List<Map<String, dynamic>> _quickHelpButtons = [];

  bool _showNewChatConfirm = false;
  bool _showLoadConfirm = false;
  String? _pendingLoadConversationId;
  bool _showExportDialog = false;
  String _exportFilename = "";

  // Save dialog state
  bool _showSaveDialog = false;
  final TextEditingController _titleController = TextEditingController();

  @override
  void initState() {
    super.initState();
    debugPrint("[CHAT_FOLDERS] Mounting component for user: ${widget.userId}");
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
    if (!_scrollController.hasClients) return;
    final double maxScroll = _scrollController.position.maxScrollExtent;
    if (animated) {
      _scrollController.animateTo(maxScroll,
          duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
    } else {
      _scrollController.jumpTo(maxScroll);
    }
  }

  void setCategoryContext(String categoryId, String categoryName) {
    setState(() {
      _selectedCategoryId = categoryId;
      _selectedCategoryName = categoryName;
    });
    NotificationService.info("Context set to: $categoryName");
  }

  Future<void> startNewChat() async {
    if (_messages.isNotEmpty && _currentConversationId == null) {
      setState(() => _showNewChatConfirm = true);
    } else {
      _resetChat();
    }
  }

  void _resetChat() {
    setState(() {
      _currentConversationId = null;
      _conversationTitle = "New Chat";
      _titleController.text = _conversationTitle;
      _messages = [];
      _relatedDocuments = [];
      _streamingText = "";
      _isStreaming = false;
    });
    widget.onRelatedDocumentsUpdate([]);
    _inputController.clear();
    _scrollToBottom();
  }

  Future<void> loadConversation(String conversationId) async {
    if (_messages.isNotEmpty && _currentConversationId == null) {
      _pendingLoadConversationId = conversationId;
      setState(() => _showLoadConfirm = true);
    } else {
      await _loadConversationDirect(conversationId);
    }
  }

  Future<void> _loadConversationDirect(String conversationId) async {
    setState(() => _isLoading = true);
    try {
      final response = await _chatHistoryProxy.getUserConversations(
        widget.userId,
        {},
        options: {
          'conversationId': conversationId.replaceFirst('conversations/', '')
        },
      );

      if (response['conversations'] == null ||
          response['conversations'].isEmpty) {
        NotificationService.error("Conversation not found");
        setState(() => _isLoading = false);
        return;
      }

      final conv = response['conversations'][0];

      setState(() {
        _currentConversationId = conv['_id'];
        _conversationTitle = conv['title'] ?? "Untitled Chat";
        _titleController.text = _conversationTitle;
        // Note: Flutter currently resets messages on load as the proxy doesn't
        // fetch message history yet. Ideally, you would fetch messages here.
        _messages = [];
        _relatedDocuments = [];
      });

      widget.onRelatedDocumentsUpdate([]);

      _scrollToBottom();
      widget.onRefreshSidebar();
    } catch (e) {
      NotificationService.error("Failed to load conversation");
      debugPrint("[CHATBOT] Load conversation error: $e");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _sendMessage(String text) async {
    if (text.trim().isEmpty || _isLoading) return;

    final userMessage = {
      'role': 'user',
      'content': text.trim(),
      'timestamp': DateTime.now().toIso8601String(),
      'isSaved': false, // Track if saved to backend
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

      // The user message is already in _messages, but for the API payload
      // we need to ensure we send the current context if it wasn't added yet
      // (Though here we just added it to _messages, so the map above covers it)

      final response = await _chatBotProxy.submitQuery(
        sessionId: sessionId,
        messages: messagesForApi,
        userId: widget.userId,
        categoryId: _selectedCategoryId,
      );

      // Extract queryId and metadata for correct saving
      final String? queryId = response['queryId'];
      final Map<String, dynamic>? metadata = response['metadata'];

      final assistantMessage = {
        'role': 'assistant',
        'content': response['response'] ?? 'No response received',
        'timestamp': DateTime.now().toIso8601String(),
        'sources': metadata?['sources'] ?? [],
        'confidence': metadata?['confidence_score'],
        // Store technical fields for saving
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
      NotificationService.error("Failed to get response from server");
      debugPrint("[CHATBOT] Send error: $e");
    }
  }

  void _quickHelpPressed(Map<String, dynamic> button) {
    final prompt = button['prompt'] as String;
    _inputController.text = prompt;
    _inputFocusNode.requestFocus();
  }

  // UPDATED: Save Conversation logic that persists messages
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
        // Create new
        conversationResponse = await _chatHistoryProxy.createConversation(data);
      } else {
        // Update existing
        final id = _currentConversationId!.replaceFirst('conversations/', '');
        conversationResponse =
            await _chatHistoryProxy.updateConversation(id, data);
      }

      final String conversationId =
          conversationResponse['_key'] ?? conversationResponse['_id'];
      final String conversationIdClean =
          conversationId.replaceFirst('conversations/', '');

      // 2. Iterate and Save Messages
      for (int i = 0; i < _messages.length; i++) {
        final msg = _messages[i];

        // Skip if already saved
        if (msg['isSaved'] == true) continue;

        final messagePayload = {
          'conversationId': conversationIdClean,
          'content': msg['content'],
          'sender': msg['role'] == 'user' ? 'user' : 'assistant',
          'userId': widget.userId,
          // Only assistant messages typically have queryId and metadata
          if (msg['queryId'] != null) 'queryId': msg['queryId'],
          if (msg['metadata'] != null) 'metadata': msg['metadata'],
        };

        try {
          await _chatHistoryProxy.addMessage(
              conversationIdClean, messagePayload);
          // Mark as saved locally so we don't save duplicates next time
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
    } catch (e, stackTrace) {
      debugPrint("[SAVE] ERROR: $e");
      debugPrint("$stackTrace");
      NotificationService.error("Failed to save conversation");
    }
  }

  // Robust PDF export with font fallback
  Future<void> exportChatToPDF() async {
    final pdf = pw.Document();

    pw.Font? customFont;
    try {
      final fontData = await rootBundle.load("assets/fonts/Roboto-Regular.ttf");
      customFont = pw.Font.ttf(fontData);
    } catch (e) {
      debugPrint("Custom font not available, falling back to Helvetica: $e");
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Stack(
      children: [
        Column(
          children: [
            // Context Bar
            if (_selectedCategoryName.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                color: theme.primaryColor.withOpacity(0.1),
                child: Row(
                  children: [
                    Text(
                      "Context: $_selectedCategoryName",
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.close, size: 20),
                      onPressed: () {
                        setState(() {
                          _selectedCategoryId = null;
                          _selectedCategoryName = "";
                        });
                      },
                    ),
                  ],
                ),
              ),

            // Messages
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.all(16),
                itemCount: _messages.length + (_isLoading ? 1 : 0),
                itemBuilder: (context, index) {
                  if (index == _messages.length && _isLoading) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Row(
                        children: [
                          CircularProgressIndicator(),
                          SizedBox(width: 12),
                          Text("Thinking..."),
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
                                : Colors.grey[100]),
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
                              codeblockPadding: const EdgeInsets.all(12),
                              codeblockDecoration: BoxDecoration(
                                color: isUser
                                    ? Colors.white.withOpacity(0.1)
                                    : (theme.brightness == Brightness.dark
                                        ? Colors.grey[900]
                                        : Colors.grey[100]),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              blockquoteDecoration: BoxDecoration(
                                color:
                                    isUser ? Colors.white10 : Colors.grey[300],
                                border: Border(
                                    left: BorderSide(
                                        color: theme.primaryColor, width: 4)),
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

            // Quick Help Buttons
            if (_quickHelpButtons.isNotEmpty)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _quickHelpButtons.map((btn) {
                    return ElevatedButton.icon(
                      icon: Icon(IconData(btn['iconCodePoint'],
                          fontFamily: 'MaterialIcons')),
                      label: Text(btn['label']),
                      onPressed: () => _quickHelpPressed(btn),
                      style: ElevatedButton.styleFrom(
                          backgroundColor:
                              theme.colorScheme.secondaryContainer),
                    );
                  }).toList(),
                ),
              ),

            // Input Area with Action Buttons
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: theme.cardColor,
                border: Border(top: BorderSide(color: theme.dividerColor)),
              ),
              child: Column(
                children: [
                  // Action Buttons Row
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.add_circle_outline),
                        tooltip: "New Chat",
                        onPressed: startNewChat,
                      ),
                      IconButton(
                        icon: const Icon(Icons.save),
                        tooltip: "Save Chat",
                        onPressed: () {
                          _titleController.text = _conversationTitle;
                          setState(() => _showSaveDialog = true);
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.picture_as_pdf),
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
                  // Text Input Row
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

        // Confirm Dialogs
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
            ),
            actions: [
              TextButton(
                onPressed: () => setState(() => _showSaveDialog = false),
                child: const Text("Cancel"),
              ),
              ElevatedButton(
                onPressed: () {
                  saveConversation().then((_) {
                    setState(() => _showSaveDialog = false);
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
