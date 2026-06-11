import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:genie_ai_mobile/components/shared/confirm_dialog.dart';
import 'package:genie_ai_mobile/components/chat/chat_response_feedback_dialog.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/tokens/color_utils.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N
import 'package:genie_ai_mobile/services/notification_service.dart';
import 'package:genie_ai_mobile/services/sse_parser.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:genie_ai_mobile/utils/config_resolver.dart';

class ChatBotComponent extends ConsumerStatefulWidget {
  final String userId;
  final VoidCallback onRefreshSidebar;
  final Function(List<dynamic>) onRelatedDocumentsUpdate;
  final VoidCallback? onChatStateChanged;

  /// AuthInterceptor-wrapped client for streaming requests.
  /// When null, the component falls back to non-streaming mode.
  final http.Client? httpClient;

  /// Base URL for the backend API (e.g. 'https://example.com/api').
  /// Required when [httpClient] is provided for streaming support.
  final String? streamBaseUrl;

  const ChatBotComponent({
    super.key,
    required this.userId,
    required this.onRefreshSidebar,
    required this.onRelatedDocumentsUpdate,
    this.onChatStateChanged,
    this.httpClient,
    this.streamBaseUrl,
  });

  @override
  ChatBotComponentState createState() => ChatBotComponentState();
}

class ChatBotComponentState extends ConsumerState<ChatBotComponent> {
  // Conversation State
  String? _currentConversationId;
  String _conversationTitle = "New Chat";
  List<Map<String, dynamic>> _messages = [];
  List<Map<String, dynamic>> get messages => _messages;
  bool get isQuickHelpVisible => _showQuickHelpOverlay;
  bool _isLoading = false;
  bool _isStreaming = false;
  StreamSubscription<String>? _streamSubscription;

  bool get _canStream => httpClient != null && streamBaseUrl != null;
  http.Client? get httpClient => widget.httpClient;
  String? get streamBaseUrl => widget.streamBaseUrl;

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

  // Cached config and locale
  Map<String, dynamic>? _cachedConfig;
  String _currentLocale = 'en';

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
    _welcomeMessage = _getConfigWelcomeMessage();

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
    _streamSubscription?.cancel();
    _scrollController.dispose();
    _inputController.dispose();
    _inputFocusNode.dispose();
    _titleController.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();

    // Track current locale
    _currentLocale = Localizations.localeOf(context).languageCode;

    // Check for language changes and update welcome message
    final String newWelcomeMessage = _getConfigWelcomeMessage();

    if (_welcomeMessage != newWelcomeMessage) {
      // If the first message is the welcome message, update it in the UI
      if (_messages.isNotEmpty &&
          _messages.first['role'] == 'assistant' &&
          _messages.first['content'] == _welcomeMessage) {
        setState(() {
          _messages.first['content'] = newWelcomeMessage;
        });
      }
      // Reload quick help buttons with new locale
      _loadQuickHelpConfig();
      _welcomeMessage = newWelcomeMessage;
    }
  }

  String _getConfigWelcomeMessage() {
    final welcomeConfig =
        _cachedConfig?['features']?['chat']?['welcomeMessage'];
    if (welcomeConfig != null) {
      return resolveConfigText(welcomeConfig, _currentLocale);
    }
    return tr('chatbot.welcomeMessage');
  }

  Future<void> _loadQuickHelpConfig() async {
    try {
      final String configString = await rootBundle.loadString(
        'assets/config/genie-ai-config.json',
      );
      final Map<String, dynamic> config = jsonDecode(configString);

      // Cache the config for later use
      _cachedConfig = config;

      final Map<String, dynamic> quickHelpConfig =
          config['features']?['chat']?['quickHelp'] ?? {};

      setState(() {
        _quickHelpLayout = quickHelpConfig['layout'] ?? {};
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

        // Resolve text with locale maps
        final resolvedTitle = resolveConfigText(btn['title'], _currentLocale);
        final action = btn['action'] as Map<String, dynamic>?;
        final resolvedVisibleText = resolveConfigText(
          action?['visibleText'],
          _currentLocale,
        );
        final resolvedHiddenPrompt = resolveConfigText(
          action?['hiddenPrompt'],
          _currentLocale,
        );

        loadedButtons.add({
          'id': btn['id'],
          'category': btn['category'],
          'action': action ?? {},
          'appearance': appearance ?? {},
          'iconAsset': localIconAsset,
          'resolvedTitle': resolvedTitle,
          'resolvedVisibleText': resolvedVisibleText,
          'resolvedHiddenPrompt': resolvedHiddenPrompt,
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
    final bool hasInteraction = _messages.any(
      (m) =>
          m['role'] == 'user' ||
          (m['role'] == 'assistant' && m['content'] != _welcomeMessage),
    );

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
          _scrollController.animateTo(
            maxScroll,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
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
    if (_isStreaming) return;
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
      final chatHistoryApi = ref.read(chatHistoryApiProvider);
      final res = await chatHistoryApi
          .apiChatConversationsConversationIdGetWithHttpInfo(cleanId);

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
    if (_isStreaming) return;
    if (_hasUnsavedChanges) {
      setState(() => _showNewChatConfirm = true);
    } else {
      _resetChat();
    }
  }

  void _resetChat({bool keepLoading = false}) {
    _streamSubscription?.cancel();
    _streamSubscription = null;
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
    if (text.trim().isEmpty || _isLoading || _isStreaming) return;

    final userMessage = {
      'role': 'user',
      'content': text.trim(),
      'actualContent': hiddenPrompt ?? text.trim(),
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

    final String sessionId =
        _currentConversationId ?? 'session_${widget.userId}';

    final List<Map<String, dynamic>> messagesForApi = _messages.map((m) {
      return {'role': m['role'], 'content': m['actualContent'] ?? m['content']};
    }).toList();

    if (_canStream) {
      _sendStreaming(sessionId, messagesForApi);
    } else {
      _sendNonStreaming(sessionId, messagesForApi);
    }
  }

  void _sendStreaming(
    String sessionId,
    List<Map<String, dynamic>> messagesForApi,
  ) async {
    // Cancel any previous stream before starting new one
    _streamSubscription?.cancel();
    _streamSubscription = null;

    final uri = Uri.parse('$streamBaseUrl/api/queries/stream');
    final hasContext = _selectedCategoryId != null;
    final request = http.Request('POST', uri)
      ..headers['Content-Type'] = 'application/json'
      ..headers['Accept'] = 'text/event-stream'
      ..body = jsonEncode({
        'sessionId': sessionId,
        if (_currentConversationId != null)
          'conversationId': _currentConversationId,
        if (hasContext) ...{
          'messages': messagesForApi,
          'context': {
            'categoryLabel': _selectedCategoryName,
            'serviceLabels': <String>[],
            'language': I18nService().currentLocale.languageCode.toUpperCase(),
          },
          'contextOption': 'conversation-with-context-labels',
        } else ...{
          'messages': messagesForApi,
          'context': {
            'language': I18nService().currentLocale.languageCode.toUpperCase(),
          },
          'contextOption': 'single-message',
        },
        'timestamp': DateTime.now().toUtc().toIso8601String(),
      });

    String? streamQueryId;
    String accumulatedContent = '';
    List<dynamic>? sources;
    double? confidence;

    final String streamingId =
        'stream_${DateTime.now().millisecondsSinceEpoch}';
    setState(() {
      _isStreaming = true;
      _messages.add({
        'id': streamingId,
        'role': 'assistant',
        'content': '',
        'timestamp': DateTime.now().toIso8601String(),
        'isSaved': false,
      });
    });
    _scrollToBottom();

    Map<String, dynamic>? findStreamingMessage() {
      try {
        return _messages.firstWhere((m) => m['id'] == streamingId);
      } catch (_) {
        return null;
      }
    }

    try {
      final streamedResponse = await httpClient!.send(request);

      if (!mounted) return;

      if (streamedResponse.statusCode != 200) {
        throw Exception('SSE returned ${streamedResponse.statusCode}');
      }

      final parser = SseParser();

      _streamSubscription = streamedResponse.stream
          .transform(utf8.decoder)
          .listen(
            (chunk) {
              if (!mounted) return;
              for (final event in parser.parseChunk(chunk)) {
                final msg = findStreamingMessage();
                if (msg == null) {
                  _streamSubscription?.cancel();
                  return;
                }
                switch (event) {
                  case SseChunkEvent(:final content):
                    accumulatedContent += content;
                    setState(() {
                      msg['content'] = accumulatedContent;
                    });
                    _scrollToBottom();
                  case SseMetadataEvent(
                    :final sourceDocuments,
                    :final confidenceScore,
                  ):
                    sources = sourceDocuments;
                    confidence = confidenceScore;
                  case SseTranslationEvent(:final content):
                    accumulatedContent = content;
                    setState(() {
                      msg['content'] = content;
                    });
                    _scrollToBottom();
                  case SseDoneEvent(:final queryId):
                    streamQueryId = queryId;
                  case SseErrorEvent(:final message):
                    debugPrint('[SSE] Error event: $message');
                }
              }
            },
            onDone: () {
              if (!mounted) return;
              for (final event in parser.flush()) {
                switch (event) {
                  case SseChunkEvent(:final content):
                    accumulatedContent += content;
                  case SseDoneEvent(:final queryId):
                    streamQueryId = queryId;
                  case SseMetadataEvent(
                    :final sourceDocuments,
                    :final confidenceScore,
                  ):
                    sources = sourceDocuments;
                    confidence = confidenceScore;
                  case SseTranslationEvent(:final content):
                    accumulatedContent = content;
                  case SseErrorEvent(:final message):
                    debugPrint('[SSE] Error event (flush): $message');
                }
              }

              final msg = findStreamingMessage();
              if (msg != null) {
                setState(() {
                  msg['content'] = accumulatedContent.isNotEmpty
                      ? accumulatedContent
                      : 'No response received';
                  msg['queryId'] = streamQueryId;
                  msg['sources'] = sources ?? [];
                  msg['confidence'] = confidence;
                  msg['metadata'] = {
                    'sources': sources,
                    'confidence_score': confidence,
                  }..removeWhere((key, value) => value == null);
                });
              }

              setState(() {
                _isStreaming = false;
                _isLoading = false;
              });

              if (sources != null && sources!.isNotEmpty) {
                _relatedDocuments = _mergeUniqueDocs(
                  sources!,
                  _relatedDocuments,
                );
                widget.onRelatedDocumentsUpdate(_relatedDocuments);
              }
              _updateQuickHelpVisibility();
            },
            onError: (error) {
              if (!mounted) return;
              debugPrint('[SSE] Stream error: $error');
              final msg = findStreamingMessage();
              if (msg != null) {
                setState(() {
                  msg['content'] = accumulatedContent.isNotEmpty
                      ? accumulatedContent
                      : 'Streaming error';
                });
              }
              setState(() {
                _isStreaming = false;
                _isLoading = false;
              });
            },
            cancelOnError: true,
          );
    } catch (e) {
      debugPrint('[SSE] Connection error: $e');
      if (!mounted) return;
      final msg = findStreamingMessage();
      if (msg != null) {
        setState(() {
          msg['content'] = accumulatedContent.isNotEmpty
              ? accumulatedContent
              : 'Connection error';
        });
      }
      setState(() {
        _isStreaming = false;
        _isLoading = false;
      });
      NotificationService.error(tr('chatbot.processingError'));
    }
  }

  void _sendNonStreaming(
    String sessionId,
    List<Map<String, dynamic>> messagesForApi,
  ) async {
    try {
      final queriesApi = ref.read(queriesApiProvider);

      final request = ApiQueriesPostRequest(
        sessionId: sessionId,
        messages: messagesForApi
            .map(
              (m) => ApiQueriesPostRequestMessagesInner(
                role: m['role'] == 'user'
                    ? ApiQueriesPostRequestMessagesInnerRoleEnum.user
                    : ApiQueriesPostRequestMessagesInnerRoleEnum.assistant,
                content: m['content'] as String,
              ),
            )
            .toList(),
        categoryId: _selectedCategoryId,
        timestamp: DateTime.now().toUtc(),
      );

      final res = await queriesApi.apiQueriesPostWithHttpInfo(request);

      if (res.statusCode != 200 && res.statusCode != 201) {
        throw Exception("Query failed: ${res.statusCode}");
      }

      final response = jsonDecode(res.body) as Map<String, dynamic>;
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
    List<dynamic> priorityDocs,
    List<dynamic> secondaryDocs,
  ) {
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

    // Use pre-resolved values from button map with i18n fallback
    final String visibleText =
        button['resolvedVisibleText'] ??
        (visibleTextKey.isNotEmpty ? tr(visibleTextKey) : '');
    // If hiddenPromptKey is empty, fallback to visible text
    final String hiddenPrompt =
        button['resolvedHiddenPrompt'] ??
        (hiddenPromptKey.isNotEmpty ? tr(hiddenPromptKey) : visibleText);

    setState(() {
      _showQuickHelpOverlay = false;
    });

    // Send using the 2-prompt system
    // The UI shows 'visibleText', API receives 'hiddenPrompt'
    _sendMessage(visibleText, hiddenPrompt: hiddenPrompt);
  }

  void _openFeedbackDialog(Map<String, dynamic> message) {
    final tokens = ThemeManager().tokens;
    showDialog(
      context: context,
      barrierColor: tokens.scrim,
      builder: (context) => ChatResponseFeedbackDialog(
        message: message,
        onSubmit: (feedbackData) async {
          final String? queryId = message['queryId'] ?? message['id'];

          if (queryId == null) {
            NotificationService.error(tr('feedback.error'));
            return;
          }

          try {
            final queriesApi = ref.read(queriesApiProvider);
            final cleanQueryId = queryId.replaceFirst('queries/', '');

            final feedbackRequest = ApiQueriesQueryIdFeedbackPostRequest(
              rating: feedbackData['rating'],
              comment: feedbackData['text'],
            );

            final res = await queriesApi
                .apiQueriesQueryIdFeedbackPostWithHttpInfo(
                  cleanQueryId,
                  feedbackRequest,
                );

            if (res.statusCode != 200 && res.statusCode != 201) {
              throw Exception("Feedback failed: ${res.statusCode}");
            }

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
      dynamic conversationResponse;
      final chatHistoryApi = ref.read(chatHistoryApiProvider);

      if (_currentConversationId == null) {
        final createRequest = ApiChatConversationsPostRequest(
          title: _conversationTitle,
          categoryId: _selectedCategoryId,
        );
        final res = await chatHistoryApi.apiChatConversationsPostWithHttpInfo(
          createRequest,
        );

        if (res.statusCode != 200 && res.statusCode != 201) {
          throw Exception("Create conversation failed: ${res.statusCode}");
        }

        conversationResponse = jsonDecode(res.body);
      } else {
        final id = _currentConversationId!.replaceFirst('conversations/', '');
        final updateRequest = ApiChatConversationsConversationIdPatchRequest(
          title: _conversationTitle,
          categoryId: _selectedCategoryId,
        );
        final res = await chatHistoryApi
            .apiChatConversationsConversationIdPatchWithHttpInfo(
              id,
              updateRequest,
            );

        if (res.statusCode != 200 && res.statusCode != 201) {
          throw Exception("Update conversation failed: ${res.statusCode}");
        }

        conversationResponse = jsonDecode(res.body);
      }

      final String conversationId =
          conversationResponse['_key'] ?? conversationResponse['_id'];
      final String conversationIdClean = conversationId.replaceFirst(
        'conversations/',
        '',
      );

      for (int i = 0; i < _messages.length; i++) {
        final msg = _messages[i];
        if (msg['isSaved'] == true) continue;

        // CRITICAL: We save msg['content'] (Visible prompt), NOT actualContent (hidden prompt).
        // This ensures the user sees exactly what they clicked in history.
        try {
          final addMessageRequest =
              ApiChatConversationsConversationIdMessagesPostRequest(
                content: msg['content'] as String,
                sender: msg['role'] == 'user'
                    ? ApiChatConversationsConversationIdMessagesPostRequestSenderEnum
                          .user
                    : ApiChatConversationsConversationIdMessagesPostRequestSenderEnum
                          .assistant,
                queryId: msg['queryId']?.toString(),
                metadata: msg['metadata'] as Map<String, dynamic>?,
              );

          final res = await chatHistoryApi
              .apiChatConversationsConversationIdMessagesPostWithHttpInfo(
                conversationIdClean,
                addMessageRequest,
              );

          if (res.statusCode != 200 && res.statusCode != 201) {
            throw Exception("Add message failed: ${res.statusCode}");
          }
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

  pw.TextSpan _buildInlineSpans(
    String text,
    pw.Font? font, {
    double fontSize = 14,
    PdfColor? color,
  }) {
    final baseStyle = pw.TextStyle(
      font: font,
      fontSize: fontSize,
      color: color,
    );
    final boldStyle = pw.TextStyle(
      font: font,
      fontSize: fontSize,
      fontWeight: pw.FontWeight.bold,
      color: color,
    );
    final italicStyle = pw.TextStyle(
      font: font,
      fontSize: fontSize,
      fontStyle: pw.FontStyle.italic,
      color: color,
    );

    final pattern = RegExp(r'\*\*(.+?)\*\*|\*([^*]+?)\*');
    final spans = <pw.TextSpan>[];
    int lastEnd = 0;

    for (final match in pattern.allMatches(text)) {
      if (match.start > lastEnd) {
        spans.add(
          pw.TextSpan(
            text: text.substring(lastEnd, match.start),
            style: baseStyle,
          ),
        );
      }
      if (match.group(1) != null) {
        spans.add(pw.TextSpan(text: match.group(1), style: boldStyle));
      } else if (match.group(2) != null) {
        spans.add(pw.TextSpan(text: match.group(2), style: italicStyle));
      }
      lastEnd = match.end;
    }

    if (lastEnd < text.length) {
      spans.add(pw.TextSpan(text: text.substring(lastEnd), style: baseStyle));
    }

    if (spans.isEmpty) {
      return pw.TextSpan(text: text, style: baseStyle);
    }
    return pw.TextSpan(children: spans);
  }

  pw.Widget _parseMarkdownBlock(
    String block,
    pw.Font? font,
    PdfColor textColor,
  ) {
    final trimmed = block.trim();
    if (trimmed.isEmpty) return pw.SizedBox.shrink();

    // Headers: # text → 18, ## text → 16, ### text → 15
    final headerMatch = RegExp(r'^(#{1,3})\s+(.*)').firstMatch(trimmed);
    if (headerMatch != null) {
      final level = headerMatch.group(1)!.length;
      final headerText = headerMatch.group(2)!;
      final headerSize = level == 1
          ? 18.0
          : level == 2
          ? 16.0
          : 15.0;
      return pw.RichText(
        text: _buildInlineSpans(
          headerText,
          font,
          fontSize: headerSize,
          color: textColor,
        ),
      );
    }

    // Bullet list: lines starting with - or *
    final lines = trimmed.split('\n');
    final isBulletList = lines.every(
      (l) =>
          l.trimLeft().startsWith('- ') ||
          l.trimLeft().startsWith('* ') ||
          l.trimLeft().isEmpty,
    );

    if (isBulletList) {
      return pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: lines.where((l) => l.trimLeft().isNotEmpty).map((line) {
          final bulletText =
              RegExp(r'^[-*]\s+(.*)').firstMatch(line.trimLeft())?.group(1) ??
              line.trimLeft();
          return pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                '•  ',
                style: pw.TextStyle(font: font, fontSize: 14, color: textColor),
              ),
              pw.Expanded(
                child: pw.RichText(
                  text: _buildInlineSpans(
                    bulletText,
                    font,
                    fontSize: 14,
                    color: textColor,
                  ),
                ),
              ),
            ],
          );
        }).toList(),
      );
    }

    // Default: paragraph with inline formatting
    return pw.RichText(
      text: _buildInlineSpans(trimmed, font, fontSize: 14, color: textColor),
    );
  }

  Future<void> exportChatToPDF() async {
    final pdf = pw.Document();
    final tokens = ThemeManager().tokens;
    pw.Font? customFont;
    try {
      final fontData = await rootBundle.load("assets/fonts/Roboto-Regular.ttf");
      customFont = pw.Font.ttf(fontData);
    } catch (e) {
      customFont = null;
    }

    final pages = <pw.Widget>[];
    pages.add(
      pw.Center(
        child: pw.Text(
          _conversationTitle,
          style: pw.TextStyle(
            font: customFont,
            fontSize: 24,
            fontWeight: pw.FontWeight.bold,
          ),
        ),
      ),
    );
    pages.add(pw.SizedBox(height: 20));

    for (final msg in _messages) {
      final bool isUser = msg['role'] == 'user';
      final String sender = isUser ? "You" : "Genie";
      final String content = msg['content'] ?? '';
      if (content.trim().isEmpty) continue;

      final PdfColor bgColor = isUser
          ? ColorUtils.toPdfColor(tokens.accent10)
          : PdfColors.grey100;
      final PdfColor accentColor = isUser
          ? ColorUtils.toPdfColor(tokens.accent)
          : ColorUtils.toPdfColor(tokens.success);
      final PdfColor textColor = isUser
          ? ColorUtils.toPdfColor(tokens.fg)
          : PdfColors.grey800;

      // One sender label per message
      pages.add(
        pw.Text(
          sender,
          style: pw.TextStyle(
            font: customFont,
            fontSize: 12,
            fontWeight: pw.FontWeight.bold,
            color: isUser
                ? ColorUtils.toPdfColor(tokens.accent)
                : PdfColors.grey800,
          ),
        ),
      );
      pages.add(pw.SizedBox(height: 2));

      // Split by \n\n into blocks for markdown parsing
      final blocks = content.split('\n\n');
      for (final block in blocks) {
        if (block.trim().isEmpty) continue;
        pages.add(
          pw.Container(
            width: double.infinity,
            margin: const pw.EdgeInsets.only(bottom: 2),
            padding: const pw.EdgeInsets.only(
              left: 10,
              top: 6,
              bottom: 6,
              right: 12,
            ),
            decoration: pw.BoxDecoration(
              color: bgColor,
              border: pw.Border(
                left: pw.BorderSide(color: accentColor, width: 3),
              ),
            ),
            child: _parseMarkdownBlock(block, customFont, textColor),
          ),
        );
      }

      pages.add(pw.SizedBox(height: 12));
    }

    try {
      pdf.addPage(
        pw.MultiPage(
          pageFormat: PdfPageFormat.a4.copyWith(
            marginBottom: 60,
            marginTop: 60,
            marginLeft: 50,
            marginRight: 50,
          ),
          build: (pw.Context context) => pages,
        ),
      );

      final filename = _exportFilename.trim().isEmpty
          ? "genie_chat_${DateTime.now().toIso8601String().split('T').first}"
          : _exportFilename.trim();

      await Printing.sharePdf(
        bytes: await pdf.save(),
        filename: '$filename.pdf',
      );
      NotificationService.success(tr('chatbot.exportSuccess'));
      setState(() => _showExportDialog = false);
    } catch (e) {
      debugPrint("[PDF EXPORT] ERROR: $e");
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
    buffer.writeln("Conversation with Genie ($_conversationTitle):\n");

    for (final msg in _messages) {
      // Skip system/welcome messages if desired, or keep them all
      final String role = msg['role'] == 'user' ? "Me" : "Genie";
      // Share visible content
      final String content = msg['content'] ?? "";

      // clear formatting for cleaner text sharing if needed
      buffer.writeln("*$role*: $content\n");
    }

    final String text = buffer.toString();

    // 1. Try launching the native app scheme first
    final Uri whatsappAppUrl = Uri.parse(
      "whatsapp://send?text=${Uri.encodeComponent(text)}",
    );

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
  // UI BUILD
  // ===========================================================================
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = ThemeManager().tokens;
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
                  padding: const EdgeInsets.symmetric(
                    horizontal: DsSpacing.md,
                    vertical: DsSpacing.sm,
                  ),
                  decoration: BoxDecoration(
                    color: tokens.accent10,
                    border: Border(bottom: BorderSide(color: tokens.border)),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.lightbulb_outline,
                        size: 20,
                        color: tokens.accent,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          "${tr('chatbot.contextPrefix')} $_selectedCategoryName",
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: tokens.fg,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      DsButton(
                        iconOnly: true,
                        icon: Icons.close,
                        variant: DsButtonVariant.ghost,
                        overrideFg: tokens.fg,
                        onPressed: () => setCategoryContext("", ""),
                      ),
                    ],
                  ),
                ),

              // Messages
              Expanded(
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(DsSpacing.md),
                  itemCount:
                      _messages.length + (_isLoading || _isStreaming ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (index == _messages.length &&
                        (_isLoading || _isStreaming)) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: DsSpacing.md,
                        ),
                        child: Row(
                          children: [
                            const CircularProgressIndicator(strokeWidth: 2),
                            const SizedBox(width: 12),
                            Text(
                              _isStreaming
                                  ? tr('chatbot.generating')
                                  : tr('chatbot.thinking'),
                              style: TextStyle(color: tokens.fg),
                            ),
                          ],
                        ),
                      );
                    }

                    final msg = _messages[index];
                    final bool isUser = msg['role'] == 'user';

                    return Align(
                      alignment: isUser
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.symmetric(
                          vertical: DsSpacing.sm,
                        ),
                        padding: const EdgeInsets.all(DsSpacing.md),
                        constraints: BoxConstraints(
                          maxWidth: MediaQuery.of(context).size.width * 0.75,
                        ),
                        decoration: BoxDecoration(
                          color: isUser
                              ? tokens.accent
                              : (isDark ? tokens.surface : tokens.muted20),
                          borderRadius: BorderRadius.circular(DsRadii.xl),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            MarkdownBody(
                              data: msg['content'] ?? '',
                              styleSheet: MarkdownStyleSheet(
                                p: TextStyle(
                                  color: isUser ? tokens.accentFg : tokens.fg,
                                  fontSize: tokens.textMd,
                                  height: 1.5,
                                ),
                                codeblockDecoration: BoxDecoration(
                                  color: isUser
                                      ? tokens.accentFg.withValues(alpha: 0.1)
                                      : (isDark ? tokens.fg30 : tokens.muted20),
                                  borderRadius: BorderRadius.circular(
                                    DsRadii.md,
                                  ),
                                ),
                              ),
                              selectable: true,
                              onTapLink: (text, href, title) {
                                if (href != null) {
                                  launchUrl(
                                    Uri.parse(href),
                                    mode: LaunchMode.externalApplication,
                                  );
                                }
                              },
                            ),

                            // Footer: Confidence & Feedback
                            if (!isUser)
                              Padding(
                                padding: const EdgeInsets.only(
                                  top: DsSpacing.md,
                                ),
                                child: Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    if (msg['confidence'] != null)
                                      Text(
                                        "${tr('sidebar.confidence')}: ${((msg['confidence'] as num) * 100).toStringAsFixed(1)}%",
                                        style: TextStyle(
                                          fontSize: tokens.textXs,
                                          color: tokens.fg50,
                                          fontStyle: FontStyle.italic,
                                        ),
                                      ),
                                    // Feedback Button
                                    Tooltip(
                                      message: tr('feedback.title'),
                                      child: InkWell(
                                        onTap: () => _openFeedbackDialog(msg),
                                        borderRadius: BorderRadius.circular(
                                          DsRadii.lg,
                                        ),
                                        child: Padding(
                                          padding: const EdgeInsets.all(
                                            DsSpacing.xs,
                                          ),
                                          child: Icon(
                                            Icons.thumb_up_alt_outlined,
                                            size: 16,
                                            color: tokens.fg50,
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
                padding: const EdgeInsets.all(DsSpacing.md),
                decoration: BoxDecoration(
                  color: tokens.surface,
                  border: Border(top: BorderSide(color: tokens.border)),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Tooltip(
                          message: tr('chatbot.newChatTitle'),
                          child: DsButton(
                            iconOnly: true,
                            icon: Icons.add_circle_outline,
                            variant: DsButtonVariant.ghost,
                            overrideFg: tokens.fg,
                            onPressed: startNewChat,
                          ),
                        ),
                        Tooltip(
                          message: tr('chatbot.saveChat'),
                          child: DsButton(
                            iconOnly: true,
                            icon: Icons.save_outlined,
                            variant: DsButtonVariant.ghost,
                            overrideFg: tokens.fg,
                            onPressed: () {
                              _titleController.text = _conversationTitle;
                              setState(() => _showSaveDialog = true);
                            },
                          ),
                        ),
                        Tooltip(
                          message: tr('chatbot.exportChat'),
                          child: DsButton(
                            iconOnly: true,
                            icon: Icons.picture_as_pdf_outlined,
                            variant: DsButtonVariant.ghost,
                            overrideFg: tokens.fg,
                            onPressed: () {
                              _exportFilename =
                                  "chat_${DateTime.now().toIso8601String().split('T').first}";
                              setState(() => _showExportDialog = true);
                            },
                          ),
                        ),
                        const SizedBox(width: DsSpacing.sm),
                        Tooltip(
                          message: tr('chatbot.shareWhatsApp'),
                          child: IconButton(
                            onPressed: _shareToWhatsApp,
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
                        ),
                      ],
                    ),
                    const SizedBox(height: DsSpacing.sm),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _inputController,
                            focusNode: _inputFocusNode,
                            style: TextStyle(color: tokens.fg),
                            decoration: InputDecoration(
                              hintText: tr('chatbot.placeholder'),
                              hintStyle: TextStyle(color: tokens.mutedSoft),
                              filled: true,
                              fillColor: isDark
                                  ? tokens.muted20
                                  : Colors.transparent,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(DsRadii.md),
                                borderSide: BorderSide(color: tokens.border),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(DsRadii.md),
                                borderSide: BorderSide(color: tokens.border),
                              ),
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: DsSpacing.md,
                                vertical: 14,
                              ),
                            ),
                            maxLines: null,
                            onSubmitted: (_) =>
                                _sendMessage(_inputController.text),
                          ),
                        ),
                        const SizedBox(width: 12),
                        DsButton(
                          iconOnly: true,
                          icon: Icons.send,
                          variant: DsButtonVariant.ghost,
                          overrideFg: tokens.accent,
                          onPressed: _isLoading || _isStreaming
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

          // Quick Help Overlay
          if (_showQuickHelpOverlay && _quickHelpButtons.isNotEmpty)
            Container(
              color: tokens.bg,
              padding: const EdgeInsets.symmetric(
                horizontal: DsSpacing.md,
                vertical: DsSpacing.xl,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    tr('chatbot.whatCanIHelp'),
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: tokens.fg,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: DsSpacing.lg),
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
                                crossAxisSpacing: 10,
                              ),
                          itemCount: _quickHelpButtons.length,
                          itemBuilder: (context, index) {
                            final button = _quickHelpButtons[index];
                            final labelMap =
                                button['appearance']?['label']
                                    as Map<String, dynamic>? ??
                                {};
                            final String titleKey =
                                labelMap['text']?.toString() ?? '';
                            final String translatedTitle = tr(titleKey);
                            final String iconAsset =
                                button['iconAsset']?.toString() ?? '';

                            return Material(
                              color: Colors.transparent,
                              child: InkWell(
                                borderRadius: BorderRadius.circular(DsRadii.lg),
                                onTap: () => _quickHelpPressed(button),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 8,
                                  ),
                                  decoration: BoxDecoration(
                                    color: tokens.surface,
                                    borderRadius: BorderRadius.circular(
                                      DsRadii.lg,
                                    ),
                                    border: Border.all(
                                      color: tokens.borderLight,
                                    ),
                                  ),
                                  child: Row(
                                    children: [
                                      SvgPicture.asset(
                                        iconAsset,
                                        width: 18,
                                        height: 18,
                                        placeholderBuilder: (_) => Icon(
                                          Icons.help_outline,
                                          size: 20,
                                          color: tokens.accent,
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Text(
                                          translatedTitle,
                                          style: theme.textTheme.labelMedium
                                              ?.copyWith(
                                                fontWeight: FontWeight.w600,
                                                fontSize: tokens.textXs,
                                                color: tokens.fg,
                                              ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
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
            Dialog(
              backgroundColor: tokens.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DsRadii.xl),
              ),
              insetPadding: const EdgeInsets.all(DsSpacing.md),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
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
                        tr('chatbot.dialogs.saveTitle'),
                        style: TextStyle(
                          color: tokens.fg,
                          fontSize: tokens.textLg,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const Divider(height: 1),
                    Padding(
                      padding: const EdgeInsets.all(DsSpacing.lg),
                      child: TextField(
                        controller: _titleController,
                        style: TextStyle(color: tokens.fg),
                        decoration: InputDecoration(
                          hintText: tr('chatbot.dialogs.saveHint'),
                          hintStyle: TextStyle(color: tokens.mutedSoft),
                          border: const OutlineInputBorder(),
                        ),
                        onChanged: (v) => _conversationTitle = v,
                        autofocus: true,
                      ),
                    ),
                    const Divider(height: 1),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        DsSpacing.md,
                        DsSpacing.sm,
                        DsSpacing.md,
                        DsSpacing.md,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          DsButton(
                            label: tr('common.cancel'),
                            variant: DsButtonVariant.ghost,
                            onPressed: () =>
                                setState(() => _showSaveDialog = false),
                          ),
                          const SizedBox(width: DsSpacing.sm),
                          DsButton(
                            label: tr('common.save'),
                            variant: DsButtonVariant.primary,
                            onPressed: () {
                              saveConversation().then((_) {});
                            },
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (_showExportDialog)
            Dialog(
              backgroundColor: tokens.surface,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DsRadii.xl),
              ),
              insetPadding: const EdgeInsets.all(DsSpacing.md),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
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
                        tr('chatbot.dialogs.exportTitle'),
                        style: TextStyle(
                          color: tokens.fg,
                          fontSize: tokens.textLg,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const Divider(height: 1),
                    Padding(
                      padding: const EdgeInsets.all(DsSpacing.lg),
                      child: TextField(
                        style: TextStyle(color: tokens.fg),
                        decoration: InputDecoration(
                          hintText: tr('chatbot.dialogs.exportHint'),
                          hintStyle: TextStyle(color: tokens.mutedSoft),
                        ),
                        onChanged: (v) => _exportFilename = v,
                        controller: TextEditingController(
                          text: _exportFilename,
                        ),
                      ),
                    ),
                    const Divider(height: 1),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        DsSpacing.md,
                        DsSpacing.sm,
                        DsSpacing.md,
                        DsSpacing.md,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          DsButton(
                            label: tr('common.cancel'),
                            variant: DsButtonVariant.ghost,
                            onPressed: () =>
                                setState(() => _showExportDialog = false),
                          ),
                          const SizedBox(width: DsSpacing.sm),
                          DsButton(
                            label: tr('chatbot.dialogs.actions.export'),
                            variant: DsButtonVariant.primary,
                            onPressed: _exportFilename.trim().isEmpty
                                ? null
                                : exportChatToPDF,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
