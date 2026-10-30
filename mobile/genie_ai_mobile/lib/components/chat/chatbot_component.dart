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
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';
import 'package:genie_ai_mobile/design_system/tokens/color_utils.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N
import 'package:genie_ai_mobile/services/language_refusal.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';
import 'package:genie_ai_mobile/services/sse_parser.dart';
import 'package:genie_ai_mobile/services/translation_status.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:genie_ai_mobile/utils/config_resolver.dart';

import 'quick_help_scope.dart';

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
  // The bound every hierarchy fetch (the EN tree, the localized title
  // tree) rides under: the generated client carries no timeout of its
  // own, and a request that never answers must land in the FAILED state
  // the captions describe, not wedge the scope.
  static const Duration _treeFetchTimeout = Duration(seconds: 15);

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
  // The ENGLISH spellings of the sidebar scope — the SSOT the wire speaks.
  // The localized name (_selectedCategoryName) is display-only.
  String _selectedCategoryNameEn = "";
  List<String> _sidebarServiceLabelsEn = [];
  // How many services the sidebar selection named (labels or not).
  int _sidebarServiceCount = 0;
  // The live hierarchy, indexed once: the EN label vocabulary (what the
  // corpus filters on) and the categories, by key and by English name. Null
  // until the tree loads — then no button is judged broken, because a tree
  // that has not loaded says nothing.
  QuickHelpScopeResolver? _scopeResolver;

  /// The hierarchy has settled — it loaded, or it failed. Derivable from
  /// the two outcomes' own marks (a resolver exists, or the outage flag
  /// is up): a third field would only have to be kept in phase with them.
  bool get _treeSettled => _scopeResolver != null || _treeUnavailable;
  // The hierarchy load has settled — it loaded, or it failed. The Quick
  // Help grid waits for it: a button carries a scope, and the hierarchy
  // is what names it, so a button rendered before the hierarchy is known
  // cannot say whether its scope is valid — and a tap it cannot answer is
  // a dead tap.
  // The hierarchy could not be loaded: it names no scope at all, so every
  // button says so instead of looking healthy and swallowing the tap.
  bool _treeUnavailable = false;
  // The in-flight hierarchy fetch. It runs ONCE: every button is checked
  // against the resolver it builds, and a tap must not start a second one.
  Future<void>? _enTreeFuture;
  // The id of the Quick Help button whose scope is active — the IDENTITY
  // the conversation carries, so a reopened conversation can be re-scoped
  // by the button (a Quick Help tag is the button id, never a label: a
  // sidebar selection and a button can carry the same label).
  String? _activeQuickHelpButtonId;
  // The scope state of the ACTIVE Quick Help button against the live
  // hierarchy (stateFor's map): a restored button whose declared labels
  // or category left the hierarchy refuses the follow-up, with a caption
  // naming what is gone — the same refusal the press path gives the tap.
  Map<String, dynamic>? _activeQuickHelpScope;
  // English KB labels for the retriever filter, sourced from a Quick Help button's
  // serviceLabels. Set in _quickHelpPressed, kept for the conversation's turns.
  // Sidebar tree selections use _selectedCategoryId/_selectedCategoryName instead.
  List<String> _activeServiceLabels = [];
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

  // The locale the Quick Help buttons were last resolved under. A
  // didChangeDependencies locale drift against it re-resolves the
  // buttons (and the active scope's context-bar title) — the marker,
  // not the welcome text, is what says the language changed.
  //
  // Two states:
  //   null — the FIRST load is in flight. That load resolves under the
  //          locale live at its completion and sets the marker itself,
  //          so the mount's own dependency change must not reload.
  //   else — the locale of the last load, WHETHER IT SUCCEEDED OR
  //          FAILED. A failed attempt marks the locale it ran under:
  //          the retry is then scoped to a LOCALE change (the trigger
  //          the pre-fix code used), not to every dependency change —
  //          a keyboard opening must not re-read the asset.
  String? _quickHelpButtonsLocale;

  // The locale the sidebar scope's title was last re-fetched under — the
  // drift marker the same way _quickHelpButtonsLocale is one, scoped to
  // its own fetch. A null marker names the state before any fetch: a
  // title the selection itself installed is current, and the first
  // dependency change must not start one. The fetch's completion guard
  // reads it as its staleness fact: a response whose captured locale no
  // longer matches the marker is a stale one (a newer drift started a
  // newer fetch), and its names — of the locale the UI has left — are
  // dropped. Same-locale responses are interchangeable: each carries the
  // join the current inputs produce.
  String? _sidebarTitleLocale;
  // Whether the active scope was installed by a LIVE sidebar selection —
  // the only scope whose context-bar title is the joined localized names
  // a localized tree can re-name. A restore or a button press installs a
  // title from another source (the conversation's edge, the button id)
  // and unsets it; the scope clears unset it through
  // _clearQuickHelpScopeFields.
  bool _sidebarTitleIsSelection = false;

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

    // Through the single-flight wrapper: a bare _loadQuickHelpConfig
    // here left _quickHelpConfigFuture unpopulated, so a startup restore
    // started a SECOND full config parse — and this load's late failure
    // nulled the future of that in-flight second load (a third fetch).
    _ensureQuickHelpConfig();
    _ensureEnTree();
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

    // The Quick Help buttons are per-locale text: a switch re-resolves
    // them by the LOCALE they were last resolved under. The welcome
    // message is not the trigger — a deployment whose welcome text is a
    // plain, locale-invariant string would otherwise pin the cards (and
    // the active scope's context-bar title) to one language.
    if (shouldReloadQuickHelpButtons(
      loadedLocale: _quickHelpButtonsLocale,
      currentLocale: _currentLocale,
    )) {
      _startQuickHelpConfigReload();
    }

    // A sidebar scope's context-bar title is the JOIN of the localized
    // service names the panel installed it with — a locale switch leaves
    // those names in the language they were picked under, while the web
    // re-maps its chips from the per-locale tree it re-fetches. A drift
    // re-fetches the hierarchy in the CURRENT locale — display only, the
    // wire keeps the stored ENGLISH labels — and re-titles the bar from
    // it. The marker is consumed by every dependency change, whether or
    // not a title is re-fetched: the FIRST marking is not a drift (the
    // title the selection installed is current), and a marker left behind
    // would hide the NEXT switch. A failed fetch marked its locale — the
    // retry is scoped to the next one.
    final bool titleDrift = isLocaleDrift(
      loadedLocale: _sidebarTitleLocale,
      currentLocale: _currentLocale,
    );
    _sidebarTitleLocale = _currentLocale;
    if (titleDrift &&
        sidebarTitleFollowsLocale(
          fromSelection: _sidebarTitleIsSelection,
          activeButtonId: _activeQuickHelpButtonId,
          serviceCount: _sidebarServiceCount,
          serviceLabelsEn: _sidebarServiceLabelsEn,
        )) {
      _fetchSidebarTitleTree();
    }

    // Check for language changes and update welcome message
    _refreshWelcomeMessage();
  }

  String _getConfigWelcomeMessage() {
    // The rule lives in the config layer, where it is unit-tested: a
    // configuration that declares no usable message leaves the built-in
    // greeting in place.
    final resolved = resolveWelcomeMessage(
      _cachedConfig ?? const {},
      _currentLocale,
    );
    return resolved ?? tr('chatbot.welcomeMessage');
  }

  /// Recomputes the welcome message under the CURRENT config and locale.
  ///
  /// The config load is asynchronous: the first render ran before the
  /// config was cached, and the load's completion — not only a locale
  /// switch — must land the configured message (the web is config-ready
  /// at mount). The FIELD always follows, so a New Chat opened after the
  /// load seeds the configured text; the VISIBLE bubble follows only
  /// while NO conversation is open — the first bubble of a restored
  /// conversation is history, not the welcome slot.
  void _refreshWelcomeMessage() {
    final String newWelcomeMessage = _getConfigWelcomeMessage();
    if (_welcomeMessage == newWelcomeMessage) {
      return;
    }
    if (_currentConversationId == null &&
        _messages.isNotEmpty &&
        _messages.first['role'] == 'assistant' &&
        _messages.first['content'] == _welcomeMessage) {
      setState(() {
        _messages.first['content'] = newWelcomeMessage;
      });
    }
    _welcomeMessage = newWelcomeMessage;
  }

  /// The Quick Help configuration load, once started. A restore that
  /// needs the buttons (a Quick Help tag is a button id) awaits this —
  /// resolving a tag against a config that has not parsed yet loses the
  /// conversation's scope.
  Future<void>? _quickHelpConfigFuture;

  Future<void> _ensureQuickHelpConfig() {
    // A failed load is not cached: the next need for the buttons retries
    // it (the tree's fetch does the same).
    return _quickHelpConfigFuture ??= _loadQuickHelpConfig().whenComplete(() {
      if (_quickHelpLoadFailed) _quickHelpConfigFuture = null;
    });
  }

  /// A FORCED reload (a locale drift). The single-flight wrapper caches a
  /// completed load, so a reload cannot go through it as-is: the cached
  /// future is invalidated and the wrapper re-entered, which re-resolves
  /// the config under the wrapper's own failure policy — a restore
  /// arriving mid-reload awaits THIS load, not a duplicate one.
  ///
  /// One reload at a time. A reload over a CACHED config resolves in
  /// memory and finishes inside the dependency change that triggered it;
  /// a reload after a FAILED load has nothing cached and reads the asset
  /// asynchronously — and a second dependency change arriving then would
  /// start a concurrent load, whose late failure would null the tracked
  /// future of the load still in flight.
  bool _quickHelpReloadInFlight = false;

  void _startQuickHelpConfigReload() {
    if (_quickHelpReloadInFlight) return;
    _quickHelpReloadInFlight = true;
    _quickHelpConfigFuture = null;
    _ensureQuickHelpConfig().whenComplete(() {
      _quickHelpReloadInFlight = false;
    });
  }

  bool _quickHelpLoadFailed = false;

  Future<void> _loadQuickHelpConfig() async {
    _quickHelpLoadFailed = false;
    try {
      // The bundled config is immutable per build: a reload (a locale
      // drift) re-resolves the CACHED parse instead of re-reading the
      // asset — the same rule the web states for its own re-resolve.
      // A failed first load caches nothing, so its retry re-reads.
      final Map<String, dynamic> config =
          _cachedConfig ??
          jsonDecode(
            await rootBundle.loadString('assets/config/genie-ai-config.json'),
          );
      // A setState after dispose is a FlutterError in debug and E2E runs
      // — the same guard the other async loaders carry. A locale switch
      // can start this load and unmount the screen before it lands.
      if (!mounted) return;

      // Cache the config for later use
      _cachedConfig = config;

      // The config just landed: the welcome message it declares lands
      // NOW - before the Quick Help section is parsed, so a malformed
      // button cannot keep the greeting stale.
      _refreshWelcomeMessage();

      // The section pipeline — descent, container guards, hidden filter,
      // per-entry skip, button parse, dedupe — runs beside the other
      // config rules, where it is unit-tested; the widget keeps only
      // cache, mount and state.
      final (layout, buttons) = parseQuickHelpConfig(config, _currentLocale);

      setState(() {
        _quickHelpLayout = layout;
        // The id is the button's IDENTITY. Two cards sharing one is a
        // configuration error: the FIRST wins and the duplicate never
        // becomes a card — the same rule the web applies at its own load.
        _quickHelpButtons = buttons;
        // The locale these titles were resolved under — the drift marker
        // didChangeDependencies reloads on.
        _quickHelpButtonsLocale = _currentLocale;
        // The config just settled: a restore resolved while it was
        // unavailable re-resolves now (button tags read as dead sidebar
        // tags against an empty button list).
        _maybeReResolveRestoredScope();
        // A locale switch reloaded the buttons in the new language: the
        // context bar's title of an ACTIVE Quick Help scope follows, by
        // id. The restore path above only re-resolves a scope it still
        // owns — a PRESSED scope would otherwise keep the title of the
        // language it was pressed under (the web re-titles the same way
        // on its locale watcher). A sidebar scope has no active button
        // id and keeps its own name.
        final activeTitle = activeQuickHelpTitleFor(
          _quickHelpButtons,
          _activeQuickHelpButtonId,
        );
        if (activeTitle != null) {
          _selectedCategoryName = activeTitle;
        }
      });
    } catch (e) {
      debugPrint("[CHATBOT] Failed to load genie-ai-config.json: $e");
      _quickHelpLoadFailed = true;
      // The attempt ran under this locale, whether it succeeded or not:
      // a marker left at the OLD locale would hide the failure for the
      // rest of the session (the buttons would never speak the new
      // language), and a marker of "nothing resolved" would re-read the
      // asset on every dependency change.
      _quickHelpButtonsLocale = _currentLocale;
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

  /// The live hierarchy at locale=en — the label vocabulary the corpus
  /// filters on. The fetch runs once per SUCCESS: a failed one is not
  /// cached, so the next need for the hierarchy retries it — one
  /// transient error must not disable every scope for the whole session.
  Future<void> _ensureEnTree() {
    return _enTreeFuture ??= _fetchEnTree().whenComplete(() {
      if (_treeUnavailable) _enTreeFuture = null;
    });
  }

  /// Applies a resolved conversation scope to the chat state. Called by
  /// the restore and by the hierarchy-retry re-resolve — the SAME
  /// mapping, never two copies of it.
  void _applyRestoredScope(ConversationScope scope) {
    _selectedCategoryId = scope.categoryId;
    _selectedCategoryNameEn = scope.categoryNameEn ?? '';
    // A restored scope's title comes from the conversation's edge and the
    // button list, not from a live selection's join — no localized tree
    // re-names it.
    _sidebarTitleIsSelection = false;
    // The resolver's tree is the ENGLISH one (the wire's
    // vocabulary): its display name is English too. A Quick Help
    // scope shows the button's own localized title — the same thing
    // the press and the web show. (A sidebar scope still shows the
    // EN name: the localized tree lives in the panel, not here.)
    // The button the conversation's tag names — ONE lookup (the same
    // shared one the locale re-title reads), and both reads below
    // (the title, the outage state) resolve the same entity.
    final button = quickHelpButtonById(
      _quickHelpButtons,
      scope.quickHelpButtonId,
    );
    // An EMPTY title is no title (the same rule the locale re-title
    // applies): the saved category name is the fallback, never a blank
    // context bar.
    _selectedCategoryName =
        quickHelpTitleOf(button) ?? scope.categoryName ?? '';
    _activeQuickHelpButtonId = scope.quickHelpButtonId;
    // During a hierarchy OUTAGE the resolver was built over an
    // empty tree: every declared label reads as missing, and the
    // refusal would name a configuration problem that may not exist.
    // The outage is the CALLER's fact — the grid handles it through
    // unavailableScopeFor, and the restore does the same.
    if (_treeUnavailable && scope.quickHelpButtonId != null) {
      _activeQuickHelpScope = button != null
          ? QuickHelpScopeResolver.unavailableScopeFor(button)
          : scope.quickHelpScopeState;
    } else {
      _activeQuickHelpScope = scope.quickHelpScopeState;
    }
    // A Quick Help scope narrows the FIRST follow-up by its declared
    // labels (the mobile's one-turn scope); the sidebar labels that
    // were selected BESIDE it keep narrowing the whole conversation —
    // a conversation can carry both, and the web restores both.
    _activeServiceLabels = scope.quickHelpButtonId == null
        ? const []
        : scope.serviceLabelsEn;
    // Both branches of the resolver set this field — a sidebar
    // scope's filter labels are its sidebar labels, a Quick Help
    // scope carries the ones selected beside the button.
    _sidebarServiceLabelsEn = scope.sidebarLabelsEn;
    // How many sidebar tags the conversation was saved with: a tag
    // the hierarchy no longer carries is dropped from the labels, and
    // the send guard refuses it instead of letting it vanish.
    _sidebarServiceCount = scope.sidebarTagCount;
  }

  /// Re-resolves the RESTORE's scope against whichever source just
  /// settled (the tree, the Quick Help config): a restore resolved
  /// during an outage of either froze its scope against empty data. Only
  /// when the restore still OWNS the scope — a user action since (epoch
  /// moved) means the saved scope no longer applies. The ownership rule
  /// lives in one predicate; a restore with NO tags (a category-only
  /// scope) is re-resolved too.
  void _maybeReResolveRestoredScope() {
    if (!shouldReResolveRestoredScope(
      restoredTags: _restoredTags,
      restoredCategoryKey: _restoredCategoryKey,
      restoredScopeEpoch: _restoredScopeEpoch,
      scopeEpoch: _scopeEpoch,
      hierarchyReady: _scopeResolver != null,
    )) {
      return;
    }
    final scope = ConversationScopeResolver(
      hierarchy: _scopeResolver!,
      quickHelpButtons: _quickHelpButtons,
    ).resolve(tags: _restoredTags, categoryKey: _restoredCategoryKey);
    _applyRestoredScope(scope);
  }

  Future<void> _fetchEnTree() async {
    try {
      final categoriesApi = ref.read(serviceCategoriesApiProvider);
      // A BOUNDED fetch: a request that never answers left the
      // hierarchy 'loading' forever — _isLoading stayed true, the send
      // returned early and the chat was unusable. The generated client
      // carries no timeout of its own (it is generated code), so the
      // bound is applied here: a timeout is the visible FAILED state
      // the captions describe.
      final response = await categoriesApi
          .apiServiceCategoriesCategoriesGetWithHttpInfo(locale: 'en')
          .timeout(_treeFetchTimeout);
      if (!mounted) return;
      if (response.statusCode == 200) {
        final tree = jsonDecode(response.body) as List<dynamic>;
        setState(() {
          _scopeResolver = QuickHelpScopeResolver(tree);
          // A retry that succeeded ends the outage: the cards are checked
          // against the tree that IS here now, not against the one that
          // failed to load.
          _treeUnavailable = false;
          // A restore resolved during an outage froze its whole scope
          // against an empty tree — a successful retry must RE-RESOLVE
          // it. The config retry below runs the same recovery.
          _maybeReResolveRestoredScope();
        });
        return;
      }
      _markTreeUnavailable();
    } catch (e) {
      debugPrint("[CHATBOT] EN tree fetch failed: $e");
      _markTreeUnavailable();
    }
  }

  /// The hierarchy could not be loaded: it names no scope, so every scope
  /// is unverifiable — and every button says so.
  void _markTreeUnavailable() {
    if (!mounted) return;
    setState(() {
      _treeUnavailable = true;
    });
  }

  /// The DISPLAY-only localized hierarchy fetch behind the sidebar
  /// scope's locale re-title. The EN tree above stays the wire's
  /// vocabulary; this one only names what the user reads.
  Future<void> _fetchSidebarTitleTree() async {
    // The scope the title will be rebuilt for, captured now: a fetch is
    // only allowed to re-title THE SELECTION it was started for. A
    // selection that changes while the fetch is in flight installs its
    // OWN localized names, and this response — of the locale the UI may
    // have left — must not overwrite them.
    final List<String> labels = List<String>.of(_sidebarServiceLabelsEn);
    final int serviceCount = _sidebarServiceCount;
    final String locale = _currentLocale;
    try {
      final categoriesApi = ref.read(serviceCategoriesApiProvider);
      final response = await categoriesApi
          .apiServiceCategoriesCategoriesGetWithHttpInfo(locale: locale)
          .timeout(_treeFetchTimeout);
      // A newer drift superseded this fetch, or the widget left.
      if (!mounted || locale != _sidebarTitleLocale) return;
      if (response.statusCode != 200) return;
      // The scope the fetch was started for must still be the scope
      // installed — the capture rule lives beside the other sidebar
      // rules, where it is clause-tested.
      if (!sidebarTitleCaptureMatchesSelection(
        capturedLabels: labels,
        capturedCount: serviceCount,
        labels: _sidebarServiceLabelsEn,
        count: _sidebarServiceCount,
        fromSelection: _sidebarTitleIsSelection,
        activeButtonId: _activeQuickHelpButtonId,
      )) {
        return;
      }
      final title = sidebarScopeTitleFor(
        labels,
        localizedDisplayNamesOf(jsonDecode(response.body) as List<dynamic>),
      );
      // The tree names every stored label, or the title stays as it is —
      // a partial join would show a scope narrower than the one the
      // query filters on.
      if (title == null) return;
      setState(() {
        _selectedCategoryName = title;
      });
    } catch (e) {
      debugPrint("[CHATBOT] Localized tree fetch failed: $e");
    }
  }

  String _quickHelpErrorCaption(Map<String, dynamic> scope) {
    if (scope['unavailable'] as bool? ?? false) {
      return tr('chatbot.quickHelpScopeUnavailable');
    }
    final missing = (scope['missingLabels'] as List).cast<String>();
    final parts = <String>[];
    if (missing.isNotEmpty) {
      // Through the i18n service's own substitution: the web half of
      // this MR documented a hand-rolled replaceAll as exactly the bug
      // a locale copy edit re-introduces.
      parts.add(
        tr('chatbot.quickHelpLabelGone', args: {'labels': missing.join(', ')}),
      );
    }
    if (scope['categoryMissing'] as bool) {
      parts.add(tr('chatbot.quickHelpCategoryGone'));
    }
    return parts.join(' ');
  }

  void setCategoryContext(
    String categoryId,
    String categoryName, {
    String categoryNameEn = '',
    List<String> serviceLabelsEn = const [],
    int serviceCount = 0,
  }) {
    setState(() {
      // A sidebar selection REPLACES the Quick Help scope: the two are
      // alternative ways of scoping the same query.
      _clearQuickHelpScopeFields();
      _selectedCategoryId = categoryId;
      _selectedCategoryName = categoryName;
      _selectedCategoryNameEn = categoryNameEn;
      // A LIVE selection installs this title (a non-empty serviceCount —
      // the clear's empty payload is not one): it is the one shape a
      // localized tree can re-name on a locale switch. The write lands
      // AFTER the clear, whose own rule unsets the flag.
      _sidebarTitleIsSelection = serviceCount > 0;
      _sidebarServiceLabelsEn = serviceLabelsEn;
      // How many services the selection named, beside the labels that
      // carry an EN translation. The send guard refuses when a picked
      // one contributed no label (its scope cannot be named).
      _sidebarServiceCount = serviceCount;
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

  // The restore's staleness guard: a slower load must never commit over
  // a newer one (the web's loadSeq, ported — the scope block added an
  // await into the window).
  int _loadSeq = 0;

  // The epoch of the LAST USER scope action (a card press, a sidebar
  // pick, a reset). A restore whose awaits outlive a user action must
  // not commit the conversation's saved scope OVER the one the user just
  // chose — loadSeq guards newer LOADS, this guards user actions.
  int _scopeEpoch = 0;
  // The restore's raw inputs, kept so a hierarchy retry that SUCCEEDS
  // can re-resolve the whole scope (a restore resolved during an outage
  // froze labels, count and names against an empty tree). Null when no
  // restore owns the current scope.
  List<dynamic>? _restoredTags;
  String? _restoredCategoryKey;
  int? _restoredScopeEpoch;

  Future<void> _loadConversationDirect(String conversationId) async {
    final seq = ++_loadSeq;
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
      // The fetch resolved — a NEWER load may have landed while it was
      // in flight. The transcript commit carries the SAME seq guard the
      // scope commit below has: without it, a superseded-but-slower load
      // overwrote the newer conversation's messages with its own while
      // its scope commit was correctly thrown away.
      if (!mounted || seq != _loadSeq) return;

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

      // The scope the conversation was asked in: its category, and the
      // labels it was narrowed by. The hierarchy NAMES the scope, so the
      // tree is awaited first — a scope that cannot be named must not
      // leave the follow-up unscoped, and an unscoped query answers from
      // the whole corpus.
      // The scope is resolved against BOTH async sources: the hierarchy
      // (a category key is named through it) and the Quick Help config
      // (a Quick Help tag is a button id). Waiting for the one and not
      // the other drops the scope of the other kind of tag.
      final scopeEpoch = _scopeEpoch;
      final restoredTags = conv['tags'] is List
          ? conv['tags'] as List<dynamic>
          : null;
      final restoredCategoryKey = _conversationCategoryKey(conv);
      await Future.wait([_ensureEnTree(), _ensureQuickHelpConfig()]);
      // BOTH guards: a NEWER load replaced this one, or the USER set a
      // scope while the fetches were pending — either way this restore
      // no longer owns the view.
      if (!mounted || seq != _loadSeq || scopeEpoch != _scopeEpoch) return;
      final scope = ConversationScopeResolver(
        hierarchy: _scopeResolver ?? QuickHelpScopeResolver(const []),
        quickHelpButtons: _quickHelpButtons,
      ).resolve(tags: restoredTags, categoryKey: restoredCategoryKey);
      setState(() {
        _restoredTags = restoredTags;
        _restoredCategoryKey = restoredCategoryKey;
        _restoredScopeEpoch = scopeEpoch;
        _applyRestoredScope(scope);
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
      // The load AWAITS the hierarchy and the config before it commits
      // its scope: the user can navigate away inside that window, and a
      // setState after dispose is a FlutterError in debug and E2E runs.
      // The SEQ gate keeps a superseded load's finally from killing the
      // spinner of the NEWER load that replaced it.
      if (mounted && seq == _loadSeq) {
        setState(() => _isLoading = false);
      }
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
      // A new chat inherits NOTHING from the previous one: a scope left
      // standing would filter the new conversation's questions and be
      // written into its tags at save time.
      _selectedCategoryId = null;
      _selectedCategoryName = '';
      _selectedCategoryNameEn = '';
      _sidebarServiceLabelsEn = [];
      _sidebarServiceCount = 0;
      _clearQuickHelpScopeFields();
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

    // The scope the user SEES is the scope the query must carry. A
    // selection whose scope has no ENGLISH name — an entity without an EN
    // translation, a label the hierarchy no longer carries — would leave
    // the query with NO filter at all: the corpus would answer from
    // outside the scope the selection declared. The send is refused, and
    // the user is told why (the refusal happens BEFORE the turn is
    // committed, so the question stays in the composer).
    // A restored Quick Help scope whose button is broken refuses with
    // the caption that NAMES what is gone — before the nameable guard,
    // whose generic message would point at the wrong thing.
    final quickHelpBroken =
        (_activeQuickHelpScope?['broken'] as bool?) ?? false;
    if (quickHelpBroken) {
      NotificationService.error(_quickHelpErrorCaption(_activeQuickHelpScope!));
      return;
    }
    if (!scopeCanGoOnTheWire(
      categoryId: _selectedCategoryId,
      categoryNameEn: _selectedCategoryNameEn,
      serviceLabels: _activeServiceLabels,
      sidebarServiceLabels: _sidebarServiceLabelsEn,
      sidebarServiceCount: _sidebarServiceCount,
    )) {
      // A hierarchy that could not be loaded is not a configuration
      // problem: naming it as one points the operator at the wrong thing.
      NotificationService.error(
        _treeUnavailable
            ? tr('chatbot.quickHelpScopeUnavailable')
            : tr('chatbot.scopeNotNameable'),
      );
      return;
    }

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
    // Quick Help sets _activeServiceLabels; sidebar sets _selectedCategoryId.
    // Either constitutes a context-filtered query.
    final hasContext =
        _selectedCategoryId != null ||
        _activeServiceLabels.isNotEmpty ||
        _sidebarServiceLabelsEn.isNotEmpty;
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
            // ENGLISH is the SSOT of the filter wire: chunk_labels carry the
            // EN translation, so the query speaks EN. The localized name is
            // display-only.
            'categoryLabel': _selectedCategoryNameEn.isNotEmpty
                ? _selectedCategoryNameEn
                : null,
            'serviceLabels': mergeServiceLabels(
              _activeServiceLabels,
              _sidebarServiceLabelsEn,
            ),
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
    bool? isGrounded;
    // Whether the backend could not translate the answer into the requested
    // language. The answer that arrives is then the English original, and the
    // user has to be told — an English answer presented as a translated one
    // is the failure this flag exists to prevent. Each answer carries its own
    // outcome: a failure reported for the previous answer must not follow
    // this one.
    bool answerTranslationFailed = false;

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
        // The backend refuses a language the deployment cannot answer in
        // before the stream opens. The refusal names the refused side in its
        // body: the client shows its own text for it.
        final String body = await streamedResponse.stream.bytesToString();
        final String? code = languageRefusalCode(body);
        if (code != null) {
          throw LanguageRefusal(code);
        }
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
                    isGrounded: final grounded,
                  ):
                    sources = sourceDocuments;
                    confidence = confidenceScore;
                    isGrounded = grounded;
                  case SseTranslationEvent(:final content):
                    accumulatedContent = content;
                    setState(() {
                      msg['content'] = content;
                    });
                    _scrollToBottom();
                  case SseDoneEvent(:final queryId, :final translationFailed):
                    streamQueryId = queryId;
                    answerTranslationFailed = translationFailed;
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
                  case SseDoneEvent(:final queryId, :final translationFailed):
                    streamQueryId = queryId;
                    answerTranslationFailed = translationFailed;
                  case SseMetadataEvent(
                    :final sourceDocuments,
                    :final confidenceScore,
                    isGrounded: final grounded,
                  ):
                    sources = sourceDocuments;
                    confidence = confidenceScore;
                    isGrounded = grounded;
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
                      : tr('chatbot.noResponse');
                  msg['queryId'] = streamQueryId;
                  msg['sources'] = sources ?? [];
                  msg['confidence'] = confidence;
                  msg['isGrounded'] = isGrounded;
                  msg['translationFailed'] = answerTranslationFailed;
                  msg['metadata'] = {
                    'sources': sources,
                    'confidence_score': confidence,
                    'is_grounded': isGrounded,
                  }..removeWhere((key, value) => value == null);
                });
              }

              setState(() {
                _isStreaming = false;
                _isLoading = false;
              });

              // NOTE: _activeServiceLabels is NOT cleared here. Quick Help is a
              // persistent mode (parity with web: the selection stays in
              // selectedContextItems until replaced/removed). Follow-up manual
              // messages in the same Quick Help session remain filtered by the
              // labels. Cleared only in _quickHelpPressed (re-set) or on context reset.

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
                      : tr('chatbot.processingError');
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
              : _failureMessage(e);
        });
      }
      setState(() {
        _isStreaming = false;
        _isLoading = false;
      });
      NotificationService.error(_failureMessage(e));
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
        // The language the user reads. Without it the backend answers in
        // English, whatever the interface language is.
        context: QueryContext(
          language: I18nService().currentLocale.languageCode.toUpperCase(),
        ),
        categoryId: _selectedCategoryId,
        timestamp: DateTime.now().toUtc(),
      );

      final res = await queriesApi.apiQueriesPostWithHttpInfo(request);

      if (res.statusCode != 200 && res.statusCode != 201) {
        // The backend refuses a language the deployment cannot answer in with
        // a body that names the refused side: the client shows its own text
        // for it instead of a bare status code.
        final String? code = languageRefusalCode(res.body);
        if (code != null) {
          throw LanguageRefusal(code);
        }
        throw Exception("Query failed: ${res.statusCode}");
      }

      final response = jsonDecode(res.body) as Map<String, dynamic>;
      final Map<String, dynamic>? metadata = response['metadata'];

      // What happened to the language of the answer: chatqna reports whether
      // it translated it. An answer that was not translated is flagged, so
      // the English original is never read as a translation of it.
      final bool translationFailed = isTranslationFailed(metadata);

      final assistantMessage = {
        'id': response['queryId'],
        'queryId': response['queryId'],
        'role': 'assistant',
        'content': response['response'] ?? tr('chatbot.noResponse'),
        'timestamp': DateTime.now().toIso8601String(),
        'sources': metadata?['sources'] ?? [],
        'confidence': metadata?['confidence_score'],
        'metadata': metadata,
        'translationFailed': translationFailed,
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
      NotificationService.error(_failureMessage(e));
      debugPrint("[CHATBOT] Send error: $e");
    }
  }

  /// The message a failed request is shown with.
  ///
  /// A refused language is the caller's side of the boundary: the deployment
  /// cannot answer in that language, and saying so is more useful than a
  /// generic failure. Every other failure is shown as the generic one.
  String _failureMessage(Object error) {
    if (error is LanguageRefusal && error.code == unsupportedLanguageCode) {
      return tr('chatbot.unsupportedLanguage');
    }
    return tr('chatbot.processingError');
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

  // Installs a pressed Quick Help card as THE scope. ONE copy of the
  // field list for the press paths; the caller owns its own setState.
  void _installQuickHelpScopeFields(Map<String, dynamic> button) {
    // A card with no title installs NOTHING: the context bar would go
    // blank. The press gate refuses such a card before it gets here —
    // this is the callee's own guarantee, not the caller's.
    final name = quickHelpTitleOf(button);
    if (name == null) return;
    // A COPY: the conversation's filter labels live as long as the
    // scope, and the card's own list must not be aliased by them (an
    // in-place edit would rewrite the card's scope verdict).
    final declaredLabels = List<String>.of(quickHelpServiceLabelsOf(button));
    _showQuickHelpOverlay = false;
    // The configuration names its category; the hierarchy's own key is
    // what the conversation's edge speaks.
    final categoryRef = quickHelpFieldOf(button, 'category');
    _selectedCategoryId =
        _scopeResolver?.categoryIdFor(categoryRef) ?? categoryRef;
    _selectedCategoryNameEn = _scopeResolver?.categoryLabelEn(button) ?? '';
    // The context bar carries the card's TITLE — the same name the
    // web's chip shows.
    _selectedCategoryName = name;
    // A button press is not a live selection: the title is the button's,
    // re-titled by the config reload on a locale switch.
    _sidebarTitleIsSelection = false;
    _sidebarServiceLabelsEn = [];
    // A mode switch clears the sidebar count: the send guard would read a
    // count that remembers services that are no longer selected.
    _sidebarServiceCount = 0;
    _scopeEpoch++;
    _restoredTags = null;
    _activeServiceLabels = declaredLabels;
    _activeQuickHelpButtonId = quickHelpFieldOf(button, 'id');
    _activeQuickHelpScope = _scopeResolver?.stateFor(button);
  }

  // Clears the Quick Help half of the scope. ONE field list for the three
  // clears (a new chat, a sidebar pick, a scope-less card press): an
  // eleventh scope field must be remembered here once, not three times.
  // The sidebar-title flag belongs here too — a clear is never a live
  // selection, whatever shape of clear it is.
  void _clearQuickHelpScopeFields() {
    _scopeEpoch++;
    _restoredTags = null;
    _activeQuickHelpButtonId = null;
    _activeQuickHelpScope = null;
    _activeServiceLabels = const [];
    _sidebarTitleIsSelection = false;
  }

  /// The icon a Quick Help card shows: the warning of a broken scope,
  /// the card's own bundled asset, or the neutral help icon (no asset at
  /// all, an asset still loading, or an asset the flavour did not
  /// bundle). ONE copy of the neutral icon, built only where it is used.
  Widget _quickHelpCardIcon({
    required bool broken,
    required String iconAsset,
    required AppTokens tokens,
  }) {
    if (broken) {
      return Icon(Icons.warning_amber_rounded, size: 18, color: tokens.danger);
    }
    Widget neutralIcon() =>
        Icon(Icons.help_outline, size: 18, color: tokens.accent);
    if (iconAsset.isEmpty) return neutralIcon();
    return SvgPicture.asset(
      iconAsset,
      width: 18,
      height: 18,
      placeholderBuilder: (_) => neutralIcon(),
      // A well-formed path that names an asset the flavour did not
      // bundle degrades to the same neutral icon, instead of an empty
      // slot.
      errorBuilder: (_, _, _) => neutralIcon(),
    );
  }

  void _quickHelpPressed(Map<String, dynamic> button) {
    // One predicate for the three press refusals — a broken scope (a
    // VISIBLE failure: the overlay caption names the problem), a scope
    // the tree cannot EN-name, a card with no title — the same gates the
    // web's selectQuickHelpOption applies before any branch.
    if (!quickHelpPressable(button, _scopeResolver)) {
      return;
    }
    // The parse resolved the action texts under the load's locale (the
    // same values the web resolves at map time); the gates read the
    // RESOLVED strings — the raw config values are locale maps, whose
    // string form is never empty.
    final String visibleText = button['resolvedVisibleText']?.toString() ?? '';
    final String hiddenPrompt =
        button['resolvedHiddenPrompt']?.toString() ?? '';

    // ONE scope rule, shared with the grid's unavailable verdict.
    final declaresScope = quickHelpDeclaresScope(button);

    // The AUTO-SEND is armed only when BOTH texts resolved: a card with
    // a visible text but no hidden prompt would wire an EMPTY question
    // to the LLM while the bubble showed the visible text, and a card
    // with a hidden prompt but no visible text would ask the send guard
    // to bounce it after the overlay already closed. Net rule on the
    // web too: it arms on the hidden prompt but its sendMessage bounces
    // the empty composer (it also honours a legacy i18n-KEY shape the
    // mobile bundle never carries).
    if (hiddenPrompt.isEmpty || visibleText.isEmpty) {
      // A card that DECLARES a scope but has no hidden prompt is still a
      // scoped card — the web installs the same card's labels without
      // asking for a prompt, and wiping the scope here sent the question
      // over the whole corpus while the card promised its declared one.
      if (declaresScope) {
        setState(() {
          _installQuickHelpScopeFields(button);
        });
        _inputFocusNode.requestFocus();
        return;
      }
      setState(() {
        // A mode switch clears the WHOLE prior scope: a stale count would
        // make the send guard refuse every subsequent send (no label can
        // ever satisfy a count that remembers a selection that is gone),
        // and a stale button id would tag the next conversation with a
        // scope it never had.
        _showQuickHelpOverlay = false;
        _selectedCategoryId = null;
        _selectedCategoryName = '';
        _selectedCategoryNameEn = '';
        _sidebarServiceLabelsEn = [];
        _sidebarServiceCount = 0;
        _clearQuickHelpScopeFields();
      });
      _inputFocusNode.requestFocus();
      return;
    }

    // The card's declared English KB labels become the retriever filter —
    // the helper installs them; _sendStreaming reads them off the scope.
    setState(() {
      _installQuickHelpScopeFields(button);
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
  /// The scope of the conversation, as the web writes it.
  List<String> _contextTags() => conversationScopeTags(
    quickHelpButtonId: _activeQuickHelpButtonId,
    sidebarServiceLabels: _sidebarServiceLabelsEn,
  );

  /// The category a saved conversation was asked in: its own field, or
  /// the edge the backend created for it.
  String? _conversationCategoryKey(Map<String, dynamic> conversation) {
    final categoryId = conversation['categoryId'];
    if (categoryId != null && categoryId.toString().isNotEmpty) {
      return categoryId.toString();
    }
    final categories = conversation['categories'];
    if (categories is List && categories.isNotEmpty) {
      final first = categories.first;
      if (first is Map) {
        final key = first['_key'];
        if (key != null && key.toString().isNotEmpty) return key.toString();
      }
    }
    return null;
  }

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
          tags: _contextTags(),
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
          tags: _contextTags(),
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

                            // The backend could not translate the answer into
                            // the requested language: the text above is the
                            // original answer, not a translation of it. Saying
                            // so is what keeps an English answer from being
                            // read as a translated one.
                            if (!isUser && msg['translationFailed'] == true)
                              Padding(
                                padding: const EdgeInsets.only(
                                  top: DsSpacing.sm,
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.translate,
                                      size: 14,
                                      color: tokens.warning,
                                    ),
                                    const SizedBox(width: DsSpacing.xs),
                                    Expanded(
                                      child: Text(
                                        tr('chatbot.translationUnavailable'),
                                        style: TextStyle(
                                          fontSize: tokens.textXs,
                                          color: tokens.warning,
                                          fontStyle: FontStyle.italic,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
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
                                    if (msg['isGrounded'] == false)
                                      Text(
                                        tr('chatbot.aiGeneratedNoDocs'),
                                        style: TextStyle(
                                          fontSize: tokens.textXs,
                                          color: tokens.warning,
                                          fontStyle: FontStyle.italic,
                                        ),
                                      )
                                    else if (msg['confidence'] != null)
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
          if (_showQuickHelpOverlay &&
              _quickHelpButtons.isNotEmpty &&
              _treeSettled)
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
                        // The layout reads degrade to the defaults for
                        // any malformed value — one copy beside the other
                        // config rules (see quick_help_scope.dart).
                        final int crossAxisCount = quickHelpGridColumns(
                          _quickHelpLayout,
                          maxWidth: constraints.maxWidth,
                        );
                        final double aspectRatio = quickHelpGridAspectRatio(
                          _quickHelpLayout,
                        );

                        return GridView.builder(
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: crossAxisCount,
                                childAspectRatio: aspectRatio,
                                mainAxisSpacing: quickHelpGridSpacing,
                                crossAxisSpacing: quickHelpGridSpacing,
                              ),
                          itemCount: _quickHelpButtons.length,
                          itemBuilder: (context, index) {
                            final button = _quickHelpButtons[index];
                            final String translatedTitle =
                                quickHelpTitleOf(button) ?? '';
                            final String iconAsset =
                                button['iconAsset']?.toString() ?? '';
                            final scope = _treeUnavailable
                                ? QuickHelpScopeResolver.unavailableScopeFor(
                                    button,
                                  )
                                : (_scopeResolver?.stateFor(button) ??
                                      QuickHelpScopeResolver.pending);
                            // The caption below names WHICH failure the
                            // card carries. Its conditions read these two
                            // hoisted facts; the verdict derives its own
                            // copy through the same predicates
                            // (quickHelpTitleOf, the scope's 'broken')
                            // — keep the three in step.
                            final bool scopeBroken =
                                scope['broken'] as bool? ?? false;
                            final bool titleMissing = translatedTitle.isEmpty;
                            final broken = quickHelpCardBroken(button, scope);

                            return Material(
                              color: Colors.transparent,
                              child: InkWell(
                                borderRadius: BorderRadius.circular(DsRadii.lg),
                                // A card the tap would silently refuse —
                                // a broken scope, or one with no title —
                                // is a VISIBLE failure: the caption below
                                // names the configuration problem, and
                                // the tap sends nothing.
                                onTap: broken
                                    ? null
                                    : () => _quickHelpPressed(button),
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
                                      color: broken
                                          ? tokens.danger
                                          : tokens.borderLight,
                                    ),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          // ONE copy of the neutral help
                                          // icon: the no-icon card, the
                                          // loading placeholder and the
                                          // failed asset all degrade to
                                          // it.
                                          _quickHelpCardIcon(
                                            broken: broken,
                                            iconAsset: iconAsset,
                                            tokens: tokens,
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
                                      if (broken)
                                        Flexible(
                                          // The tile's height is the
                                          // grid's aspect ratio — the
                                          // caption can never grow it —
                                          // so a long caption (the
                                          // outage text, two joined
                                          // defects) must clamp instead
                                          // of overflowing the tile. The
                                          // clamp covers the caption
                                          // only: at an extreme
                                          // accessibility font scale the
                                          // icon row alone can outgrow
                                          // the tile, the grid's own
                                          // fixed-aspect property long
                                          // before this caption.
                                          child: Text(
                                            // The missing-title text
                                            // first: the clamp below
                                            // truncates what does not
                                            // fit, and the config
                                            // defect is the diagnosis
                                            // that outlives a hierarchy
                                            // outage (the outage text
                                            // describes a state that
                                            // recovery ends).
                                            [
                                              if (titleMissing)
                                                tr(
                                                  'chatbot.quickHelpTitleMissing',
                                                ),
                                              if (scopeBroken)
                                                _quickHelpErrorCaption(scope),
                                            ].join(' '),
                                            style: theme.textTheme.bodySmall
                                                ?.copyWith(
                                                  fontSize: tokens.textXs,
                                                  color: tokens.danger,
                                                ),
                                            maxLines: 3,
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
