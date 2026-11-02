import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:genie_ai_mobile/components/shared/confirm_dialog.dart';
import 'package:genie_ai_mobile/components/chat/chat_response_feedback_dialog.dart';
import 'package:genie_ai_mobile/services/chat_history_proxy.dart';
import 'package:genie_ai_mobile/services/chatbot_proxy.dart';
import 'package:genie_ai_mobile/services/api_service.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';

class ChatBotComponent extends StatefulWidget {
  final String userId;
  final VoidCallback onRefreshSidebar;
  final Function(List<dynamic>) onRelatedDocumentsUpdate;
  final VoidCallback? onChatStateChanged;
  const ChatBotComponent({
    super.key,
    required this.userId,
    required this.onRefreshSidebar,
    required this.onRelatedDocumentsUpdate,
    this.onChatStateChanged,
  });

  @override
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
  List<Map<String, dynamic>> get messages => _messages;
  bool get isQuickHelpVisible => _showQuickHelpOverlay;
  bool _isLoading = false;

  // Dirty State Tracking
  int _lastSavedMessageCount = 0;

  // Inputs
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _inputController = TextEditingController();
  final FocusNode _inputFocusNode = FocusNode();

  // Context & Related Data
  String? _selectedCategoryId;
  String _selectedCategoryName = "";
  List<dynamic> _relatedDocuments = [];

  // Quick Help Configuration
  List<Map<String, dynamic>> _quickHelpButtons = [];
  Map<String, dynamic> _quickHelpLayout = {};
  Map<String, dynamic> _quickHelpDefaults = {};

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

  // Welcome message
  late String _welcomeMessage;

  bool get _hasUnsavedChanges {
    if (_currentConversationId == null) {
      return _messages.length > 1;
    }
    return _messages.length > _lastSavedMessageCount;
  }

  @override
  void initState() {
    super.initState();
    debugPrint("[CHATBOT] Mounting component for user: ${widget.userId}");

    // Initialize default text from I18n
    _conversationTitle = tr('chatbot.newChatTitle');
    _welcomeMessage = tr('chatbot.welcomeMessage');

    _loadQuickHelpConfig();
    _titleController.text = _conversationTitle;

    _messages.add({
      'role': 'assistant',
      'content': _welcomeMessage,
      'timestamp': DateTime.now().toIso8601String(),
      'isSaved': true,
    });
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

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();

    // Check for language changes and update welcome message
    final String newWelcomeMessage = tr('chatbot.welcomeMessage');

    if (_welcomeMessage != newWelcomeMessage) {
      // If the first message is the welcome message, update it in the UI
      if (_messages.isNotEmpty &&
          _messages.first['role'] == 'assistant' &&
          _messages.first['content'] == _welcomeMessage) {
        setState(() {
          _messages.first['content'] = newWelcomeMessage;
        });
      }

      // Update the state variable for future resets
      _welcomeMessage = newWelcomeMessage;
    }
  }

  // Bridging method for translations
  String _t(String key, [String fallback = '']) {
    // tr() handles the lookup globally
    return tr(key);
  }

  Future<void> _loadQuickHelpConfig() async {
    try {
      final String configString =
          await rootBundle.loadString('assets/config/genie-ai-config.json');
      final Map<String, dynamic> config = jsonDecode(configString);

      final Map<String, dynamic> quickHelpConfig =
          config['features']?['chat']?['quickHelp'] ?? {};

      setState(() {
        _quickHelpLayout = quickHelpConfig['layout'] ?? {};
        _quickHelpDefaults = quickHelpConfig['defaults'] ?? {};
      });

      final List<dynamic> buttonsJson = quickHelpConfig['buttons'] ?? [];
      final List<Map<String, dynamic>> loadedButtons = [];

      for (var btn in buttonsJson) {
        // Safe parsing: use map access with defaults to prevent null crashes
        final appearance = btn['appearance'] as Map<String, dynamic>?;
        final iconMap = appearance?['icon'] as Map<String, dynamic>?;
        final iconPath = iconMap?['value']?.toString() ?? '';

        final String localIconAsset = iconPath.isNotEmpty
            ? 'assets/config/quickhelp/${iconPath.split('/').last}'
            : 'assets/config/quickhelp/default.svg';

        loadedButtons.add({
          'id': btn['id'],
          'category': btn['category'],
          'action': btn['action'] ?? {},
          'appearance': appearance ?? {},
          'iconAsset': localIconAsset,
          'darkMode': appearance?['darkMode'] ?? {},
        });
      }

      setState(() {
        _quickHelpButtons = loadedButtons;
      });
    } catch (e) {
      debugPrint("[CHATBOT] Failed to load genie-ai-config.json: $e");
    }
  }

  void _updateQuickHelpVisibility() {
    final bool hasInteraction = _messages.any((m) =>
        m['role'] == 'user' ||
        (m['role'] == 'assistant' && m['content'] != _welcomeMessage));

    setState(() {
      _showQuickHelpOverlay = !hasInteraction;
    });
    widget.onChatStateChanged?.call();
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

  void setCategoryContext(String categoryId, String categoryName) {
    setState(() {
      _selectedCategoryId = categoryId;
      _selectedCategoryName = categoryName;
    });
  }

  Future<void> loadConversation(String conversationId) async {
    if (_hasUnsavedChanges) {
      _pendingLoadConversationId = conversationId;
      setState(() => _showLoadConfirm = true);
    } else {
      await _loadConversationDirect(conversationId);
    }
  }

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
            'id': m['_id'] ?? m['id'],
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
        _conversationTitle = conv['title'] ?? tr('chatbot.newChatTitle');
        _titleController.text = _conversationTitle;
        _messages = loadedMessages;
        _lastSavedMessageCount = loadedMessages.length;
      });

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
      NotificationService.error(tr('chatbot.loadError'));
      debugPrint("[CHATBOT] Load error: $e");
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void startNewChat() {
    if (_hasUnsavedChanges) {
      setState(() => _showNewChatConfirm = true);
    } else {
      _resetChat();
    }
  }

  void _resetChat({bool keepLoading = false}) {
    setState(() {
      _currentConversationId = null;
      _conversationTitle = tr('chatbot.newChatTitle');
      _titleController.text = _conversationTitle;
      _messages = [];
      _relatedDocuments = [];
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
    _lastSavedMessageCount = 1;
    _updateQuickHelpVisibility();
  }

  void _sendMessage(String text, {String? hiddenPrompt}) async {
    if (text.trim().isEmpty || _isLoading) return;

    final userMessage = {
      'role': 'user',
      'content': text.trim(), // Visible to user in UI
      'actualContent': hiddenPrompt ?? text.trim(), // Hidden Prompt for LLM
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
          // Send actualContent (hidden prompt) to the LLM if it exists, else content
          'content': m['actualContent'] ?? m['content'],
        };
      }).toList();

      final String currentLanguage = I18nService().currentLocale.languageCode;

      final response = await _chatBotProxy.submitQuery(
        sessionId: sessionId,
        messages: messagesForApi,
        userId: widget.userId,
        categoryId: _selectedCategoryId,
        contextLabels: _selectedCategoryName,
        language: currentLanguage,
      );

      final String? queryId = response['queryId'];
      final Map<String, dynamic>? metadata = response['metadata'];

      final assistantMessage = {
        'id': response['queryId'],
        'queryId': response['queryId'],
        'role': 'assistant',
        'content': response['response'] ?? 'No response received',
        'timestamp': DateTime.now().toIso8601String(),
        'sources': metadata?['sources'] ?? [],
        'confidence': metadata?['confidence_score'],
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
      NotificationService.error(tr('chatbot.processingError'));
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
    final Map<String, dynamic> action = button['action'] ?? {};
    final String visibleTextKey = action['visibleText']?.toString() ?? '';
    final String hiddenPromptKey = action['hiddenPrompt']?.toString() ?? '';

    // If both are empty, just enter Chat Mode (close overlay, focus is on input)
    if (visibleTextKey.isEmpty && hiddenPromptKey.isEmpty) {
      setState(() {
        _showQuickHelpOverlay = false;
      });
      // Ensure the keyboard/input is ready
      _inputFocusNode.requestFocus();
      return;
    }

    // Translate both
    final String visibleText =
        visibleTextKey.isNotEmpty ? _t(visibleTextKey) : '';
    // If hiddenPromptKey is empty, fallback to visible text
    final String hiddenPrompt =
        hiddenPromptKey.isNotEmpty ? _t(hiddenPromptKey) : visibleText;

    setState(() {
      _showQuickHelpOverlay = false;
    });

    // Send using the 2-prompt system
    // The UI shows 'visibleText', API receives 'hiddenPrompt'
    _sendMessage(visibleText, hiddenPrompt: hiddenPrompt);
  }

  void _openFeedbackDialog(Map<String, dynamic> message) {
    showDialog(
      context: context,
      barrierColor: Colors.black54,
      builder: (context) => ChatResponseFeedbackDialog(
        message: message,
        translate: _t,
        onSubmit: (feedbackData) async {
          final String? queryId = message['queryId'] ?? message['id'];

          if (queryId == null) {
            NotificationService.error(tr('feedback.error'));
            return;
          }

          try {
            final payload = {
              'userId': widget.userId,
              'rating': feedbackData['rating'],
              'feedbackText': feedbackData['text'],
              'thumb': feedbackData['thumbFeedback'],
              'metadata': {'skinTone': feedbackData['skinTone']}
            };

            await _chatBotProxy.submitFeedback(
                queryId: queryId, feedback: payload);

            NotificationService.success(tr('feedback.success'));
          } catch (e) {
            debugPrint("[FEEDBACK] Error submitting: $e");
            NotificationService.error(tr('feedback.error'));
          }
        },
      ),
    );
  }

  // ===========================================================================
  // SAVING & EXPORT LOGIC
  // ===========================================================================
  Future<void> saveConversation({String? folderId}) async {
    if (_messages.isEmpty) {
      NotificationService.info("Nothing to save");
      return;
    }

    setState(() {
      _conversationTitle = _titleController.text.trim().isEmpty
          ? tr('chatbot.newChatTitle')
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

        // CRITICAL: We save msg['content'] (Visible prompt), NOT actualContent (hidden prompt).
        // This ensures the user sees exactly what they clicked in history.
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

      NotificationService.success(tr('chatbot.chatSaved'));
      widget.onRefreshSidebar();
    } catch (e) {
      debugPrint("[SAVE] ERROR: $e");
      NotificationService.error(tr('chatbot.errorUpdatingChat'));
    }
  }

  Future<void> exportChatToPDF() async {
    final pdf = pw.Document();
    pw.Font? customFont;
    try {
      final fontData = await rootBundle.load("assets/fonts/Roboto-Regular.ttf");
      customFont = pw.Font.ttf(fontData);
    } catch (e) {
      customFont = null;
    }

    final pages = <pw.Widget>[];
    pages.add(pw.Center(
        child: pw.Text(_conversationTitle,
            style: pw.TextStyle(
                font: customFont,
                fontSize: 24,
                fontWeight: pw.FontWeight.bold))));
    pages.add(pw.SizedBox(height: 20));

    for (final msg in _messages) {
      final bool isUser = msg['role'] == 'user';
      final String sender = isUser ? "You" : "NAAT";
      // Export visible content for PDF (user expectation)
      final String content = msg['content'] ?? '';
      final paragraphs = content.split('\n\n');

      for (final paragraph in paragraphs) {
        if (paragraph.trim().isEmpty) continue;
        pages.add(pw.Container(
          margin: const pw.EdgeInsets.symmetric(vertical: 8),
          child: pw.Column(
            crossAxisAlignment: isUser
                ? pw.CrossAxisAlignment.end
                : pw.CrossAxisAlignment.start,
            children: [
              pw.Text(sender,
                  style: pw.TextStyle(
                      font: customFont,
                      fontSize: 12,
                      fontWeight: pw.FontWeight.bold,
                      color: isUser ? PdfColors.blue800 : PdfColors.grey800)),
              pw.SizedBox(height: 4),
              pw.Container(
                constraints: const pw.BoxConstraints(maxWidth: 500),
                padding: const pw.EdgeInsets.all(12),
                decoration: pw.BoxDecoration(
                    color: isUser ? PdfColors.blue50 : PdfColors.grey100,
                    borderRadius: pw.BorderRadius.circular(12),
                    border: pw.Border.all(color: PdfColors.grey300)),
                child: pw.Text(paragraph.trim(),
                    style: pw.TextStyle(
                        font: customFont, fontSize: 14, height: 1.4)),
              ),
            ],
          ),
        ));
        pages.add(pw.SizedBox(height: 8));
      }
    }

    try {
      pdf.addPage(pw.MultiPage(
        pageFormat: PdfPageFormat.a4.copyWith(
            marginBottom: 60, marginTop: 60, marginLeft: 50, marginRight: 50),
        build: (pw.Context context) => pages,
      ));

      final filename = _exportFilename.trim().isEmpty
          ? "genie_chat_${DateTime.now().toIso8601String().split('T').first}"
          : _exportFilename.trim();

      await Printing.sharePdf(
          bytes: await pdf.save(), filename: '$filename.pdf');
      NotificationService.success(tr('chatbot.exportSuccess'));
      setState(() => _showExportDialog = false);
    } catch (e) {
      NotificationService.error(tr('chatbot.exportError'));
    }
  }

  Future<void> _shareToWhatsApp() async {
    if (_messages.isEmpty) {
      NotificationService.info("Nothing to share");
      return;
    }

    final StringBuffer buffer = StringBuffer();
    // Optional header
    buffer.writeln("Conversation with NAAT (${_conversationTitle}):\n");

    for (final msg in _messages) {
      // Skip system/welcome messages if desired, or keep them all
      final String role = msg['role'] == 'user' ? "Me" : "NAAT";
      // Share visible content
      final String content = msg['content'] ?? "";

      // clear formatting for cleaner text sharing if needed
      buffer.writeln("*$role*: $content\n");
    }

    final String text = buffer.toString();

    // 1. Try launching the native app scheme first
    final Uri whatsappAppUrl =
        Uri.parse("whatsapp://send?text=${Uri.encodeComponent(text)}");

    // 2. Fallback to web browser if app is not installed
    final Uri whatsappWebUrl = Uri.https("wa.me", "/", {"text": text});

    try {
      if (await canLaunchUrl(whatsappAppUrl)) {
        await launchUrl(whatsappAppUrl, mode: LaunchMode.externalApplication);
      } else {
        // Fallback to web
        await launchUrl(whatsappWebUrl, mode: LaunchMode.externalApplication);
      }
    } catch (e) {
      NotificationService.error("Could not launch WhatsApp");
      debugPrint("[SHARE] Error: $e");
    }
  }

  // ===========================================================================
  // HELPER FOR GRADIENT
  // ===========================================================================
  Alignment _getGradientAlignment(String direction, bool isStart) {
    switch (direction) {
      case 'vertical':
        return isStart ? Alignment.topCenter : Alignment.bottomCenter;
      case 'diagonal':
        return isStart ? Alignment.topLeft : Alignment.bottomRight;
      case 'horizontal':
      default:
        return isStart ? Alignment.centerLeft : Alignment.centerRight;
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

    // Wrap entire layout to detect taps outside input
    return GestureDetector(
      onTap: () {
        // Explicitly kill focus node to prevent "phantom" keyboard popups
        if (_inputFocusNode.hasFocus) _inputFocusNode.unfocus();
      },
      child: Stack(
        children: [
          Column(
            children: [
              // Context Bar
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
                            "${tr('chatbot.contextPrefix')} $_selectedCategoryName",
                            style: TextStyle(
                                fontWeight: FontWeight.w600,
                                color: colors['text']),
                            overflow: TextOverflow.ellipsis),
                      ),
                      Tooltip(
                          message: tr('chatbot.removeContext'),
                          child: IconButton(
                              icon: Icon(Icons.close,
                                  size: 18, color: colors['text']),
                              onPressed: () => setCategoryContext("", ""),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(),
                              splashRadius: 20)),
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
                      return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          child: Row(children: [
                            const CircularProgressIndicator(strokeWidth: 2),
                            const SizedBox(width: 12),
                            Text(tr('chatbot.thinking'))
                          ]));
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
                              : (isDark ? colors['surface'] : Colors.grey[200]),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            MarkdownBody(
                              data: msg['content'] ?? '',
                              styleSheet: MarkdownStyleSheet(
                                p: TextStyle(
                                    color:
                                        isUser ? Colors.white : colors['text'],
                                    fontSize: 16,
                                    height: 1.5),
                                codeblockDecoration: BoxDecoration(
                                    color: isUser
                                        ? Colors.white.withOpacity(0.1)
                                        : (isDark
                                            ? Colors.white10
                                            : Colors.black12),
                                    borderRadius: BorderRadius.circular(8)),
                              ),
                              selectable: true,
                              onTapLink: (text, href, title) {
                                if (href != null) {
                                  launchUrl(Uri.parse(href),
                                      mode: LaunchMode.externalApplication);
                                }
                              },
                            ),

                            // Footer: Confidence & Feedback
                            if (!isUser)
                              Padding(
                                padding: const EdgeInsets.only(top: 12),
                                child: Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    if (msg['confidence'] != null)
                                      Text(
                                        "${tr('sidebar.confidence')}: ${((msg['confidence'] as num) * 100).toStringAsFixed(1)}%",
                                        style: TextStyle(
                                            fontSize: 11,
                                            color:
                                                colors['text'].withOpacity(0.6),
                                            fontStyle: FontStyle.italic),
                                      ),
                                    // Feedback Button
                                    Tooltip(
                                      message: tr('feedback.title'),
                                      child: InkWell(
                                        onTap: () => _openFeedbackDialog(msg),
                                        borderRadius: BorderRadius.circular(12),
                                        child: Padding(
                                          padding: const EdgeInsets.all(4.0),
                                          child: Icon(
                                            Icons.thumb_up_alt_outlined,
                                            size: 16,
                                            color:
                                                colors['text'].withOpacity(0.5),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),

              // Input Area
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: colors['surface'],
                    border: Border(top: BorderSide(color: colors['border']))),
                child: Column(
                  children: [
                    Row(children: [
                      IconButton(
                          icon: Icon(Icons.add_circle_outline,
                              color: colors['text']),
                          tooltip: tr('chatbot.newChatTitle'),
                          onPressed: startNewChat),
                      IconButton(
                          icon:
                              Icon(Icons.save_outlined, color: colors['text']),
                          tooltip: tr('chatbot.saveChat'),
                          onPressed: () {
                            _titleController.text = _conversationTitle;
                            setState(() => _showSaveDialog = true);
                          }),
                      IconButton(
                          icon: Icon(Icons.picture_as_pdf_outlined,
                              color: colors['text']),
                          tooltip: tr('chatbot.exportChat'),
                          onPressed: () {
                            _exportFilename =
                                "chat_${DateTime.now().toIso8601String().split('T').first}";
                            setState(() => _showExportDialog = true);
                          }),
                      const SizedBox(width: 8),
                      IconButton(
                        tooltip: tr('chatbot.shareWhatsApp'),
                        onPressed:
                            _shareToWhatsApp, // Ensure you added the function from the previous step
                        icon: SvgPicture.string(
                          '''
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path fill="#25D366" d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 16.61c-1.48 0-2.94-.4-4.21-1.15l-.3-.18-3.11.82.83-3.04-.19-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.183 8.183 0 0 1 2.41 5.83c.02 4.54-3.68 8.23-8.23 8.23m4.53-6.18c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43s.17-.25.25-.41c.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18s-.22-.16-.47-.28z"/>
    </svg>
    ''',
                          width: 24,
                          height: 24,
                        ),
                      ),
                    ]),
                    const SizedBox(height: 8),
                    Row(children: [
                      Expanded(
                        child: TextField(
                          controller: _inputController,
                          focusNode: _inputFocusNode,
                          style: TextStyle(color: colors['text']),
                          decoration: InputDecoration(
                            hintText: tr('chatbot.placeholder'),
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
                    ]),
                  ],
                ),
              ),
            ],
          ),

          // Quick Help Overlay
          if (_showQuickHelpOverlay && _quickHelpButtons.isNotEmpty)
            Container(
              color: colors['background'].withOpacity(0.98),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    tr('chatbot.whatCanIHelp'),
                    style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold, color: colors['text']),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final int crossAxisCount =
                            _quickHelpLayout['columns'] as int? ?? 2;
                        final double aspectRatio =
                            (_quickHelpLayout['childAspectRatio'] as num?)
                                    ?.toDouble() ??
                                3.5;

                        return GridView.builder(
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                                  crossAxisCount: crossAxisCount,
                                  childAspectRatio: aspectRatio,
                                  mainAxisSpacing: 10,
                                  crossAxisSpacing: 10),
                          itemCount: _quickHelpButtons.length,
                          itemBuilder: (context, index) {
                            final button = _quickHelpButtons[index];
                            // Use safe access with casting to Map to prevent null cast errors
                            final appearance =
                                button['appearance'] as Map<String, dynamic>? ??
                                    {};
                            final action =
                                button['action'] as Map<String, dynamic>? ?? {};
                            final darkMode =
                                button['darkMode'] as Map<String, dynamic>? ??
                                    {};

                            // Determine active styles based on Theme
                            // If in Dark Mode and darkMode overrides exist, merge them
                            final Map<String, dynamic> activeAppearance;
                            if (isDark && darkMode.isNotEmpty) {
                              // Deep merge logic simplified: override top-level keys if present
                              activeAppearance = {
                                ...appearance,
                                'label': {
                                  ...(appearance['label']
                                          as Map<String, dynamic>? ??
                                      {}),
                                  ...(darkMode['label']
                                          as Map<String, dynamic>? ??
                                      {})
                                },
                                'icon': {
                                  ...(appearance['icon']
                                          as Map<String, dynamic>? ??
                                      {}),
                                  ...(darkMode['icon']
                                          as Map<String, dynamic>? ??
                                      {})
                                },
                                'style': {
                                  ...(appearance['style']
                                          as Map<String, dynamic>? ??
                                      {}),
                                  ...(darkMode['style']
                                          as Map<String, dynamic>? ??
                                      {})
                                },
                              };

                              // Handle nested background style merge if needed
                              if (darkMode['style'] != null &&
                                  (darkMode['style'] as Map)['background'] !=
                                      null) {
                                final baseStyle = appearance['style']
                                        as Map<String, dynamic>? ??
                                    {};
                                final darkStyle = darkMode['style']
                                        as Map<String, dynamic>? ??
                                    {};

                                final baseBg = baseStyle['background']
                                        as Map<String, dynamic>? ??
                                    {};
                                final darkBg = darkStyle['background']
                                        as Map<String, dynamic>? ??
                                    {};

                                final mergedBg = {...baseBg, ...darkBg};

                                final mergedStyle = {
                                  ...(activeAppearance['style']
                                      as Map<String, dynamic>),
                                  'background': mergedBg
                                };
                                activeAppearance['style'] = mergedStyle;
                              }
                            } else {
                              activeAppearance = appearance;
                            }

                            // CORRECTED: Use label text key for button display
                            final labelMap = activeAppearance['label']
                                as Map<String, dynamic>?;
                            final String titleKey =
                                labelMap?['text']?.toString() ?? '';
                            final String translatedTitle = _t(titleKey);
                            final String iconAsset =
                                button['iconAsset']?.toString() ?? '';

                            // Style Extraction from Active Appearance
                            final styles = activeAppearance['style']
                                    as Map<String, dynamic>? ??
                                {};
                            final bg =
                                styles['background'] as Map<String, dynamic>? ??
                                    {};
                            final gradientConfig =
                                bg['gradient'] as Map<String, dynamic>? ?? {};
                            final borderConfig =
                                styles['border'] as Map<String, dynamic>? ?? {};
                            final shadowConfig =
                                styles['shadow'] as Map<String, dynamic>? ?? {};

                            // Colors
                            final String startColorHex =
                                gradientConfig['start']?.toString() ??
                                    '#FFFFFF';
                            final String endColorHex =
                                gradientConfig['end']?.toString() ??
                                    startColorHex;
                            final String gradientDirection =
                                gradientConfig['direction']?.toString() ??
                                    'horizontal';

                            final Color startColor = Color(int.parse(
                                startColorHex.replaceAll('#', '0xFF')));
                            final Color endColor = Color(
                                int.parse(endColorHex.replaceAll('#', '0xFF')));

                            final bool showShadow =
                                (_quickHelpDefaults['showShadow'] == true) ||
                                    (shadowConfig['enabled'] == true);
                            final bool showBorder =
                                (_quickHelpDefaults['showBorder'] == true) ||
                                    (borderConfig['enabled'] == true);

                            // Label Color
                            final labelConfig = activeAppearance['label']
                                    as Map<String, dynamic>? ??
                                {};
                            final String labelColorHex =
                                labelConfig['color']?.toString() ??
                                    (isDark ? '#FFFFFF' : '#000000');
                            final Color labelColor = Color(int.parse(
                                labelColorHex.replaceAll('#', '0xFF')));

                            // Icon Color (if you want to tint icons, though SVGs might have own colors)
                            // final iconConfig = activeAppearance['icon'] as Map<String, dynamic>? ?? {};
                            // final String iconColorHex = iconConfig['color']?.toString() ?? labelColorHex;
                            // final Color iconColor = Color(int.parse(iconColorHex.replaceAll('#', '0xFF')));

                            // Shadow Configuration (Stronger defaults)
                            final defaultShadow = _quickHelpDefaults['shadow']
                                    as Map<String, dynamic>? ??
                                {};
                            final double shadowOpacity =
                                (defaultShadow['opacity'] as num?)
                                        ?.toDouble() ??
                                    0.25; // Stronger default
                            final double shadowBlur = _parsePixelValue(
                                defaultShadow['blur']?.toString() ??
                                    '8px'); // Stronger default

                            return Material(
                              color: Colors.transparent,
                              child: InkWell(
                                borderRadius: BorderRadius.circular(12),
                                onTap: () => _quickHelpPressed(button),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 12, vertical: 8),
                                  decoration: BoxDecoration(
                                    // Gradient Fill with Direction
                                    gradient: LinearGradient(
                                      colors: [startColor, endColor],
                                      begin: _getGradientAlignment(
                                          gradientDirection, true),
                                      end: _getGradientAlignment(
                                          gradientDirection, false),
                                    ),
                                    borderRadius: BorderRadius.circular(12),
                                    // Border
                                    border: showBorder
                                        ? Border.all(color: colors['border'])
                                        : null,
                                    // Shadow
                                    boxShadow: showShadow
                                        ? [
                                            BoxShadow(
                                                color: Colors.black
                                                    .withOpacity(shadowOpacity),
                                                blurRadius: shadowBlur,
                                                offset: const Offset(0, 2))
                                          ]
                                        : null,
                                  ),
                                  child: Row(
                                    // Changed to Row for Slimline
                                    children: [
                                      SvgPicture.asset(iconAsset,
                                          width:
                                              18, // Smaller icon for slimline
                                          height: 18,
                                          placeholderBuilder: (_) => Icon(
                                              Icons.help_outline,
                                              size: 20,
                                              // Fallback icon color matches text if not specified in SVG
                                              color: labelColor)),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Text(translatedTitle,
                                            style: theme.textTheme.labelMedium
                                                ?.copyWith(
                                                    fontWeight: FontWeight.w600,
                                                    fontSize:
                                                        11, // Smaller font
                                                    color: labelColor),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis),
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

          // Confirm Dialogs & Save/Export Alerts
          ConfirmDialog(
            visible: _showNewChatConfirm,
            title: tr('chatbot.dialogs.newChatTitle'),
            message: tr('chatbot.dialogs.newChatContent'),
            confirmText: tr('chatbot.dialogs.actions.discardAndNew'),
            cancelText: tr('common.cancel'),
            secondaryText: tr('chatbot.dialogs.actions.saveFirst'),
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
            title: tr('chatbot.dialogs.loadChatTitle'),
            message: tr('chatbot.dialogs.loadChatContent'),
            confirmText: tr('chatbot.dialogs.actions.discardAndLoad'),
            cancelText: tr('common.cancel'),
            secondaryText: tr('chatbot.dialogs.actions.saveFirst'),
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
              title: Text(tr('chatbot.dialogs.saveTitle')),
              content: TextField(
                  controller: _titleController,
                  decoration: InputDecoration(
                      hintText: tr('chatbot.dialogs.saveHint'),
                      border: const OutlineInputBorder()),
                  onChanged: (v) => _conversationTitle = v,
                  autofocus: true),
              actions: [
                TextButton(
                    onPressed: () => setState(() => _showSaveDialog = false),
                    child: Text(tr('common.cancel'))),
                ElevatedButton(
                    onPressed: () {
                      saveConversation().then((_) {});
                    },
                    child: Text(tr('common.save')))
              ],
            ),
          if (_showExportDialog)
            AlertDialog(
              title: Text(tr('chatbot.dialogs.exportTitle')),
              content: TextField(
                  decoration: InputDecoration(
                      hintText: tr('chatbot.dialogs.exportHint')),
                  onChanged: (v) => _exportFilename = v,
                  controller: TextEditingController(text: _exportFilename)),
              actions: [
                TextButton(
                    onPressed: () => setState(() => _showExportDialog = false),
                    child: Text(tr('common.cancel'))),
                ElevatedButton(
                    onPressed:
                        _exportFilename.trim().isEmpty ? null : exportChatToPDF,
                    child: Text(tr('chatbot.dialogs.actions.export')))
              ],
            ),
        ],
      ),
    );
  }

  // Helper to parse pixel string to double
  double _parsePixelValue(String val) {
    return double.tryParse(val.replaceAll('px', '')) ?? 0.0;
  }
}
