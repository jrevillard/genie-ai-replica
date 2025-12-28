import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:cached_network_image/cached_network_image.dart';
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

  // Dirty State Tracking (New)
  int _lastSavedMessageCount = 0;

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

  // Quick Help Overlay Visibility
  bool _showQuickHelpOverlay = true;

  // Welcome message & translations
  String _welcomeMessage = "Welcome to GENIE.AI! How can I help you today?";
  Map<String, dynamic> _translations = {};

  // --- DIRTY STATE CHECK ---
  bool get _hasUnsavedChanges {
    // Case 1: New Conversation
    // Considered "dirty" only if there are user messages (count > 1, assuming Welcome msg is index 0)
    if (_currentConversationId == null) {
      return _messages.length > 1;
    }

    // Case 2: Existing Conversation
    // Considered "dirty" if new messages/context have been added since load/save
    return _messages.length > _lastSavedMessageCount;
  }

  @override
  void initState() {
    super.initState();
    debugPrint("[CHATBOT] Mounting component for user: ${widget.userId}");
    _loadTranslations();
    _loadQuickHelpConfig();
    _titleController.text = _conversationTitle;

    // Initial welcome message
    _messages.add({
      'role': 'assistant',
      'content': _welcomeMessage,
      'timestamp': DateTime.now().toIso8601String(),
      'isSaved': true,
    });
    // Set initial state: 1 message (Welcome) is the baseline
    _lastSavedMessageCount = 1;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _inputController.dispose();
    _inputFocusNode.dispose();
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _loadTranslations() async {
    try {
      String assetPath = kIsWeb ? 'i18n/en.json' : 'assets/i18n/en.json';

      final String jsonString = await rootBundle.loadString(assetPath);
      setState(() {
        _translations = jsonDecode(jsonString);
      });
    } catch (e) {
      debugPrint("[CHATBOT] Failed to load translations: $e");
    }
  }

  String _t(String key, [String fallback = '']) {
    final keys = key.split('.');
    dynamic current = _translations;
    for (var k in keys) {
      if (current is Map<String, dynamic> && current.containsKey(k)) {
        current = current[k];
      } else {
        return fallback.isNotEmpty ? fallback : key;
      }
    }
    return current?.toString() ?? (fallback.isNotEmpty ? fallback : key);
  }

  Future<void> _loadQuickHelpConfig() async {
    try {
      final String configString =
          await rootBundle.loadString('assets/config/genie-ai-config.json');
      final Map<String, dynamic> config = jsonDecode(configString);

      // Welcome message from config
      final String? welcome = config['features']?['chat']?['welcomeMessage'];
      if (welcome != null && welcome.isNotEmpty) {
        _welcomeMessage = welcome;
        // Update existing welcome message if already added
        if (_messages.isNotEmpty &&
            _messages.first['content'].contains('Welcome')) {
          setState(() {
            _messages.first['content'] = _welcomeMessage;
          });
        }
      }

      // Quick help buttons
      final List<dynamic> buttonsJson =
          config['features']?['chat']?['quickHelp']?['buttons'] ?? [];

      final List<Map<String, dynamic>> loadedButtons = [];

      for (var btn in buttonsJson) {
        final String iconPath = btn['icon']?['value'] ?? '';
        final String localIconAsset = iconPath.isNotEmpty
            ? 'assets/config/quickhelp/${iconPath.split('/').last}'
            : 'assets/config/quickhelp/default.svg';

        loadedButtons.add({
          'id': btn['id'],
          'titleKey': btn['title'], // e.g. "quickhelp.applyForID"
          'promptKey': btn['prompt'], // e.g. "quickhelp.applyForIDPrompt"
          'iconAsset': localIconAsset,
          'category': btn['category'],
          'styles': btn['styles'],
        });
      }

      setState(() {
        _quickHelpButtons = loadedButtons;
      });

      debugPrint(
          "[CHATBOT] Loaded ${_quickHelpButtons.length} quick help buttons from config");
    } catch (e) {
      debugPrint("[CHATBOT] Failed to load genie-ai-config.json: $e");
      // Fallback preserved
      try {
        final String jsonString =
            await rootBundle.loadString('assets/config/quickhelp/buttons.json');
        final dynamic data = jsonDecode(jsonString);
        final List buttons = data is List ? data : data['buttons'] ?? [];
        setState(() {
          _quickHelpButtons = buttons.cast<Map<String, dynamic>>();
        });
      } catch (fallbackError) {
        debugPrint(
            "[CHATBOT] Fallback quick help config failed: $fallbackError");
      }
    }
  }

  void _updateQuickHelpVisibility() {
    final bool hasInteraction = _messages.any((m) =>
        m['role'] == 'user' ||
        (m['role'] == 'assistant' && m['content'] != _welcomeMessage));

    setState(() {
      _showQuickHelpOverlay = !hasInteraction;
    });
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
  }

  /// Loads a specific conversation by ID
  Future<void> loadConversation(String conversationId) async {
    // FIX: Only confirm if there are actual unsaved changes
    if (_hasUnsavedChanges) {
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
    _resetChat(keepLoading: true);

    try {
      final cleanId = conversationId.replaceFirst('conversations/', '');
      final res = await _api.get('chat/conversations/$cleanId',
          params: {'userId': widget.userId});

      if (res.statusCode != 200) {
        throw Exception("Failed to load conversation: ${res.statusCode}");
      }

      final Map<String, dynamic> conv = jsonDecode(res.body);

      List<Map<String, dynamic>> loadedMessages = [];
      if (conv['messages'] != null && conv['messages'] is List) {
        loadedMessages = (conv['messages'] as List).map((m) {
          return {
            'role': m['sender'] == 'user' ? 'user' : 'assistant',
            'content': m['content'],
            'timestamp': m['timestamp'],
            'isSaved': true,
            'confidence': m['confidence'],
            'metadata': m['metadata'],
            'sources': m['metadata'] != null
                ? (m['metadata']['sources'] ??
                    m['metadata']['source_documents'])
                : [],
          };
        }).toList();
      }

      setState(() {
        _currentConversationId = conv['_id'] ?? conv['_key'];
        _conversationTitle = conv['title'] ?? "Untitled Chat";
        _titleController.text = _conversationTitle;
        _messages = loadedMessages;
        // Update baseline count to match loaded messages
        _lastSavedMessageCount = loadedMessages.length;
      });

      // --- AGGREGATE SOURCES FROM HISTORY ---
      List<dynamic> accumulatedDocs = [];
      for (final msg in loadedMessages.reversed) {
        if (msg['role'] == 'assistant' && msg['sources'] != null) {
          final List sources = msg['sources'];
          accumulatedDocs = _mergeUniqueDocs(accumulatedDocs, sources);
        }
      }

      _relatedDocuments = accumulatedDocs;
      widget.onRelatedDocumentsUpdate(_relatedDocuments);

      widget.onRefreshSidebar();
      _scrollToBottom(animated: false);
      _updateQuickHelpVisibility();
    } catch (e) {
      NotificationService.error("Failed to load conversation");
      debugPrint("[CHATBOT] Load error: $e");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void startNewChat() {
    // FIX: Only confirm if there are actual unsaved changes
    if (_hasUnsavedChanges) {
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
      _relatedDocuments = []; // Clears the doc list on new chat
      if (!keepLoading) _isLoading = false;
    });
    widget.onRelatedDocumentsUpdate([]);
    _inputController.clear();

    _messages.add({
      'role': 'assistant',
      'content': _welcomeMessage,
      'timestamp': DateTime.now().toIso8601String(),
      'isSaved': true,
    });
    // Reset baseline: 1 message (Welcome)
    _lastSavedMessageCount = 1;
    _updateQuickHelpVisibility();
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
    _updateQuickHelpVisibility();

    try {
      final String sessionId =
          _currentConversationId ?? 'session_${widget.userId}';

      final List<Map<String, dynamic>> messagesForApi = _messages.map((m) {
        return {
          'role': m['role'],
          'content': m['content'],
        };
      }).toList();

      final response = await _chatBotProxy.submitQuery(
        sessionId: sessionId,
        messages: messagesForApi,
        userId: widget.userId,
        categoryId: _selectedCategoryId,
        contextLabels: _selectedCategoryName,
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

      final List<dynamic> newDocs =
          metadata?['sources'] ?? metadata?['source_documents'] ?? [];

      setState(() {
        _messages.add(assistantMessage);
        _relatedDocuments = _mergeUniqueDocs(newDocs, _relatedDocuments);
        _isLoading = false;
      });

      widget.onRelatedDocumentsUpdate(_relatedDocuments);
      _scrollToBottom();
      _updateQuickHelpVisibility();
    } catch (e) {
      setState(() => _isLoading = false);
      NotificationService.error("Failed to get response");
      debugPrint("[CHATBOT] Send error: $e");
    }
  }

  List<dynamic> _mergeUniqueDocs(
      List<dynamic> priorityDocs, List<dynamic> secondaryDocs) {
    final List<dynamic> merged = List.from(priorityDocs);

    for (var doc in secondaryDocs) {
      final String? docId = doc['id'] ?? doc['_id'] ?? doc['document_id'];
      bool exists = false;

      if (docId != null) {
        exists = merged.any((m) {
          final String? mId = m['id'] ?? m['_id'] ?? m['document_id'];
          return mId == docId;
        });
      } else {
        exists = merged.contains(doc);
      }

      if (!exists) {
        merged.add(doc);
      }
    }
    return merged;
  }

  void _quickHelpPressed(Map<String, dynamic> button) {
    final String promptKey = button['promptKey'] as String;
    final String translatedPrompt = _t(promptKey, promptKey);

    setState(() {
      _showQuickHelpOverlay = false;
    });

    _inputController.text = translatedPrompt;
    _sendMessage(translatedPrompt);
  }

  // ===========================================================================
  // SAVING LOGIC
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

      for (int i = 0; i < _messages.length; i++) {
        final msg = _messages[i];
        if (msg['isSaved'] == true) continue;

        final messagePayload = {
          'conversationId': conversationIdClean,
          'content': msg['content'],
          'sender': msg['role'] == 'user' ? 'user' : 'assistant',
          'userId': widget.userId,
          if (msg['queryId'] != null) 'queryId': msg['queryId'],
          if (msg['metadata'] != null) 'metadata': msg['metadata'],
        };

        try {
          await _chatHistoryProxy.addMessage(
              conversationIdClean, messagePayload);
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
        _lastSavedMessageCount = _messages.length;
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
    final colors = ThemeManager().getColors();
    final isDark = ThemeManager().isDarkMode;

    return Stack(
      children: [
        Column(
          children: [
            // -----------------------------------------------------------------
            // CONTEXT BAR
            // -----------------------------------------------------------------
            if (_selectedCategoryName.isNotEmpty)
              Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: colors['primary'].withOpacity(0.1),
                  border: Border(bottom: BorderSide(color: colors['border'])),
                ),
                child: Row(
                  children: [
                    Icon(Icons.lightbulb_outline,
                        size: 20, color: colors['primary']),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        "Context: $_selectedCategoryName",
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: colors['text'],
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Tooltip(
                      message: "Remove Context",
                      child: IconButton(
                        icon:
                            Icon(Icons.close, size: 18, color: colors['text']),
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
                            ? colors['primary']
                            : isDark
                                ? colors['surface']
                                : Colors.grey[200],
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          MarkdownBody(
                            data: msg['content'] ?? '',
                            styleSheet: MarkdownStyleSheet(
                              p: TextStyle(
                                color: isUser ? Colors.white : colors['text'],
                                fontSize: 16,
                                height: 1.5,
                              ),
                              codeblockDecoration: BoxDecoration(
                                color: isUser
                                    ? Colors.white.withOpacity(0.1)
                                    : (isDark
                                        ? Colors.white10
                                        : Colors.black12),
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
                                        : colors['text'].withOpacity(0.6),
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
            // INPUT AREA
            // -----------------------------------------------------------------
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: colors['surface'],
                border: Border(top: BorderSide(color: colors['border'])),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      IconButton(
                        icon: Icon(Icons.add_circle_outline,
                            color: colors['text']),
                        tooltip: "New Chat",
                        onPressed: startNewChat,
                      ),
                      IconButton(
                        icon: Icon(Icons.save_outlined, color: colors['text']),
                        tooltip: "Save Chat",
                        onPressed: () {
                          _titleController.text = _conversationTitle;
                          setState(() => _showSaveDialog = true);
                        },
                      ),
                      IconButton(
                        icon: Icon(Icons.picture_as_pdf_outlined,
                            color: colors['text']),
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
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _inputController,
                          focusNode: _inputFocusNode,
                          style: TextStyle(color: colors['text']),
                          decoration: InputDecoration(
                            hintText: "Type your message...",
                            hintStyle: TextStyle(
                                color: isDark
                                    ? Colors.grey[500]
                                    : Colors.grey[600]),
                            filled: true,
                            fillColor: isDark
                                ? Colors.white.withOpacity(0.05)
                                : Colors.transparent,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide:
                                    BorderSide(color: colors['border'])),
                            enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide:
                                    BorderSide(color: colors['border'])),
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
                        color: colors['primary'],
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

        // -----------------------------------------------------------------
        // QUICK HELP OVERLAY
        // -----------------------------------------------------------------
        if (_showQuickHelpOverlay && _quickHelpButtons.isNotEmpty)
          Container(
            color: colors['background'].withOpacity(0.98),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  _t('chatbot.whatCanIHelp', 'How can I help you today?'),
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: colors['text'],
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final int crossAxisCount = constraints.maxWidth > 900
                          ? 4
                          : constraints.maxWidth > 600
                              ? 3
                              : 2;

                      return GridView.builder(
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: crossAxisCount,
                          childAspectRatio: 2.2,
                          mainAxisSpacing: 10,
                          crossAxisSpacing: 10,
                        ),
                        itemCount: _quickHelpButtons.length,
                        itemBuilder: (context, index) {
                          final button = _quickHelpButtons[index];
                          final String titleKey = button['titleKey'] as String;
                          final String translatedTitle = _t(titleKey, titleKey);
                          final String iconAsset =
                              button['iconAsset'] as String;
                          final Map<String, dynamic>? styles = button['styles'];
                          final bool isJustChat = button['category'] == null;

                          // Dynamic Button Style based on Mode
                          final Color btnBgColor = isDark
                              ? colors[
                                  'surface'] // Dark Mode: Use surface color
                              : (styles != null
                                  ? Color(int.parse(styles['backgroundColor']
                                      .replaceAll('#', '0xFF')))
                                  : theme
                                      .cardColor); // Light Mode: Config or Card

                          final Color btnBorderColor = isDark
                              ? colors['border']
                              : (styles != null
                                  ? Color(int.parse(styles['outlineColor']
                                      .replaceAll('#', '0xFF')))
                                  : (isJustChat
                                      ? colors['primary']
                                      : colors['border']));

                          return Material(
                            color: Colors.transparent,
                            child: InkWell(
                              borderRadius: BorderRadius.circular(10),
                              onTap: () => _quickHelpPressed(button),
                              child: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: btnBgColor,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: btnBorderColor,
                                    width: isJustChat ? 1.8 : 1,
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.05),
                                      blurRadius: 4,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    SvgPicture.asset(
                                      iconAsset,
                                      width: 28,
                                      height: 28,
                                      placeholderBuilder: (_) => Icon(
                                        Icons.help_outline,
                                        size: 28,
                                        color: colors['text'],
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      translatedTitle,
                                      style:
                                          theme.textTheme.labelMedium?.copyWith(
                                        fontWeight: FontWeight.w600,
                                        height: 1.1,
                                        // Ensure text is visible: Light on Dark / Dark on Light
                                        color: isDark
                                            ? colors['text']
                                            : Colors.black87,
                                      ),
                                      textAlign: TextAlign.center,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),

        // -----------------------------------------------------------------
        // DIALOGS
        // -----------------------------------------------------------------
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
                  saveConversation().then((_) {});
                },
                child: const Text("Save"),
              ),
            ],
          ),

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
