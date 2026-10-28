// The scope of a Quick Help button, checked against the live EN hierarchy.
//
// English is the SSOT of the filter wire: the corpus's chunk_labels carry the
// EN translation, so a declared label the hierarchy no longer carries can
// never match a chunk, and a category that is gone leaves the button with no
// scope at all. A broken button is a VISIBLE failure — error state, caption,
// no query — never a silently reduced one.
//
// The resolver indexes the tree ONCE: the label vocabulary and the category
// keys are walked a single time, then every button is checked against the
// index — never against the tree itself.

/// Whether [id] names a category scope at all. An EMPTY id declares
/// nothing (it is how a selection is cleared), and 'general' is the
/// placeholder a category-less selection is stored under: neither is a
/// scope, in every rule that reads one. This predicate is the ONE copy —
/// the subject of this whole branch is what happens when two copies of a
/// scope rule drift apart.
bool declaresCategoryScope(String? id) {
  return id != null && id.isNotEmpty && id != 'general';
}

/// Checks Quick Help buttons against the live hierarchy.
///
/// The hierarchy is what NAMES a scope: the config carries a category
/// KEY, the wire carries its ENGLISH label, and only the hierarchy can
/// say what that label is. A hierarchy that has not loaded says nothing
/// about any button ([pending]); one that could not be loaded is the
/// CALLER's fact — the widget marks it and passes each button through
/// [unavailableScopeFor].
class QuickHelpScopeResolver {
  /// The ENGLISH spelling of [entry]: its `nameEN`, or its `name` when
  /// the tree predates the dual-spelling response. The fallback is
  /// exact ONLY because this resolver is built from the locale-'en'
  /// fetch — there `name` IS the English translation (the dataprep
  /// keeps the same fallback for the same deploy window). A LOCALIZED
  /// tree must never reach these collectors: its `name` would put a
  /// non-English label on the wire.
  static String _enOf(Map entry) {
    final en = entry['nameEN'];
    if (en is String && en.isNotEmpty) return en;
    // A PRESENT-but-empty nameEN is a real missing translation: the
    // entity stays unnameable (the wire would carry a label no chunk
    // has). An ABSENT key is a pre-dual-spelling response — the deploy
    // window — and the fetch is locale 'en': `name` IS the English
    // translation there.
    if (!entry.containsKey('nameEN')) {
      return entry['name']?.toString() ?? '';
    }
    return '';
  }

  QuickHelpScopeResolver(List<dynamic> enTree)
    : _enLabels = _collectEnLabels(enTree),
      _categoryLabelsEn = _indexCategories(enTree),
      _categoryNames = _indexCategoryNames(enTree);

  /// The scope state of a button whose hierarchy has not loaded yet: it
  /// says nothing about any button.
  static const Map<String, dynamic> pending = {
    'broken': false,
    'unavailable': false,
    'missingLabels': <String>[],
    'categoryMissing': false,
  };

  /// The scope state of [button] when the hierarchy could not be loaded.
  ///
  /// A card that declares NO scope promises nothing the hierarchy could
  /// deny — it is the "just chat" entry, and the composer must stay
  /// reachable when the hierarchy is down. Every card that DOES declare a
  /// scope cannot be verified, so it says so.
  static Map<String, dynamic> unavailableScopeFor(Map<String, dynamic> button) {
    final category = button['category']?.toString();
    final labels =
        (button['serviceLabels'] as List<dynamic>?) ?? const <dynamic>[];
    // 'general' is the placeholder a category-less selection is stored
    // under: it names no category, and every rule treats it as NO scope —
    // this one included, or a category-less card would look healthy in
    // the grid and be refused at send time.
    final declaresScope = declaresCategoryScope(category) || labels.isNotEmpty;
    return {
      'broken': declaresScope,
      'unavailable': declaresScope,
      'missingLabels': const <String>[],
      'categoryMissing': false,
    };
  }

  final Set<String> _enLabels;
  final Map<String, String> _categoryLabelsEn;
  final Map<String, String> _categoryNames;

  static Map<String, String> _indexCategoryNames(List<dynamic> enTree) {
    final byKey = <String, String>{};
    for (final entry in enTree) {
      if (entry is! Map) continue;
      final key = entry['catKey']?.toString();
      if (key == null || key.isEmpty) continue;
      if (byKey.containsKey(key)) continue;
      final name = entry['name'];
      byKey[key] = (name is String && name.isNotEmpty) ? name : '';
    }
    return byKey;
  }

  static Set<String> _collectEnLabels(List<dynamic> enTree) {
    final labels = <String>{};
    for (final entry in enTree) {
      if (entry is! Map) continue;
      final catEn = _enOf(entry);
      if (catEn.isNotEmpty) labels.add(catEn);
      final children = entry['children'];
      if (children is List) {
        for (final child in children) {
          if (child is! Map) continue;
          final childEn = _enOf(child);
          if (childEn.isNotEmpty) labels.add(childEn);
        }
      }
    }
    return labels;
  }

  static Map<String, String> _indexCategories(List<dynamic> enTree) {
    final byKey = <String, String>{};
    for (final entry in enTree) {
      if (entry is! Map) continue;
      final key = entry['catKey']?.toString();
      if (key == null || key.isEmpty) continue;
      if (byKey.containsKey(key)) continue;
      byKey[key] = _enOf(entry);
    }
    return byKey;
  }

  /// The scope state of [button] against the live tree.
  Map<String, dynamic> stateFor(Map<String, dynamic> button) {
    final declared =
        (button['serviceLabels'] as List<dynamic>? ?? const <dynamic>[])
            .map((e) => e.toString())
            .toList();
    final missingLabels = declared
        .where((l) => !_enLabels.contains(l))
        .toList();

    final category = button['category']?.toString();
    // The category is usable only when the hierarchy names it in
    // ENGLISH: that spelling is the wire. A category the hierarchy does
    // not carry, and a category it carries without an EN translation,
    // are the same thing here — a scope that cannot be named.
    final categoryMissing =
        declaresCategoryScope(category) &&
        (_categoryLabelsEn[category] == null ||
            _categoryLabelsEn[category]!.isEmpty);

    return {
      'broken': missingLabels.isNotEmpty || categoryMissing,
      'unavailable': false,
      'missingLabels': missingLabels,
      'categoryMissing': categoryMissing,
    };
  }

  /// The ENGLISH category label of [button], looked up in the live tree.
  /// Null when the button declares no category, the hierarchy no longer
  /// carries it, or the entity has no EN translation (it cannot be filtered
  /// on at all).
  String? categoryLabelEn(Map<String, dynamic> button) =>
      categoryEnLabel(button['category']?.toString());

  /// The ENGLISH label of the category [catKey]. Null when the hierarchy
  /// does not carry it, or carries it without an EN translation — a scope
  /// that cannot be named, and so cannot be put on the wire.
  String? categoryEnLabel(String? catKey) {
    if (catKey == null || catKey.isEmpty) return null;
    final en = _categoryLabelsEn[catKey];
    if (en == null || en.isEmpty) return null;
    return en;
  }

  /// The localized name of the category [catKey] — what the user reads.
  /// Display only: it never filters.
  String? categoryDisplayName(String? catKey) {
    if (catKey == null || catKey.isEmpty) return null;
    final name = _categoryNames[catKey];
    if (name == null || name.isEmpty) return null;
    return name;
  }

  /// Whether [label] is a label of the live hierarchy. A tag that names
  /// no entity is not a filter label: putting it on the wire would filter
  /// on a label no chunk carries, and the follow-up would abstain.
  bool knowsLabel(String label) => _enLabels.contains(label);
}

/// The scope a saved conversation was asked in.
class ConversationScope {
  const ConversationScope({
    this.categoryId,
    this.categoryNameEn,
    this.categoryName,
    this.serviceLabelsEn = const <String>[],
    this.sidebarLabelsEn = const <String>[],
    this.sidebarTagCount = 0,
    this.quickHelpButtonId,
    this.quickHelpScopeState,
  });

  /// The category the conversation was scoped by (its storage key).
  final String? categoryId;

  /// The ENGLISH label of that category — the wire. Null when the
  /// hierarchy can no longer name it.
  final String? categoryNameEn;

  /// The localized name of that category — display only.
  final String? categoryName;

  /// The ENGLISH labels the scope was narrowed by.
  final List<String> serviceLabelsEn;

  /// The ENGLISH sidebar labels selected BESIDE the Quick Help scope — a
  /// conversation can carry both, and the web restores both.
  final List<String> sidebarLabelsEn;

  /// How many sidebar tags the conversation was SAVED with. A tag the
  /// live hierarchy no longer carries is dropped from the labels — and a
  /// dropped tag must refuse the send (the scope it named cannot be
  /// carried), never quietly vanish from it.
  final int sidebarTagCount;

  /// The id of the Quick Help button that produced the conversation, when
  /// it was one.
  final String? quickHelpButtonId;

  /// The button's scope state against the LIVE hierarchy (the same map
  /// [QuickHelpScopeResolver.stateFor] returns). The restore replays the
  /// declared labels verbatim — never a partial drop — and a broken scope
  /// (a dead declared label, a dead category) refuses the follow-up with
  /// a caption that names what is gone, exactly as the press path
  /// refuses the tap. Null when the conversation carries no Quick Help
  /// scope.
  final Map<String, dynamic>? quickHelpScopeState;
}

/// Resolves the scope of a saved conversation against the live hierarchy
/// and the Quick Help buttons.
///
/// A conversation carries the scope it was asked in: the Quick Help button
/// that produced it — by its id, the button's identity — or the ENGLISH
/// labels of the sidebar scope it was narrowed by. The scope is only
/// usable when the live hierarchy can still NAME it: a scope that cannot
/// be named leaves the query unscoped, and an unscoped query answers from
/// the whole corpus.
class ConversationScopeResolver {
  ConversationScopeResolver({
    required QuickHelpScopeResolver hierarchy,
    required List<Map<String, dynamic>> quickHelpButtons,
  }) : _hierarchy = hierarchy,
       _buttons = {
         for (final button in quickHelpButtons)
           if (button['id'] != null) button['id'].toString(): button,
       };

  final QuickHelpScopeResolver _hierarchy;
  final Map<String, Map<String, dynamic>> _buttons;

  /// The scope of the conversation that carries [tags] and was asked in
  /// [categoryKey].
  ConversationScope resolve({List<dynamic>? tags, String? categoryKey}) {
    final tagList = (tags ?? const <dynamic>[])
        .map((tag) => tag.toString())
        .toList();

    // A Quick Help tag is the id of the button that produced the
    // conversation: the button is looked up by that id, and its own scope
    // is replayed. The lookup is on the id and never on a label — a
    // sidebar selection and a Quick Help button can carry the same label,
    // and restoring the wrong one would change the scope of the saved
    // query.
    // A conversation can carry a Quick Help scope AND a sidebar scope
    // side by side (the web writes one tag per context item): the other
    // tags are the sidebar labels, and both are replayed — restoring the
    // button's scope alone would answer WIDER than the same conversation
    // does on the web.
    for (final tag in tagList) {
      final button = _buttons[tag];
      if (button == null) continue;
      final category = button['category']?.toString();
      final labels =
          (button['serviceLabels'] as List<dynamic>? ?? const <dynamic>[])
              .map((label) => label.toString())
              .toList();
      // A LEGACY 'category.<id>' tag beside the button named the same
      // category the button declares (the old web wrote the pair): it is
      // consumed here, not counted as a sidebar tag — counting it refused
      // every follow-up while the web restored both chips and answered.
      final otherTags = tagList
          .where((other) => other != tag && !other.startsWith('category.'))
          .toList();
      final sidebarLabels = otherTags.where(_hierarchy.knowsLabel).toList();
      return ConversationScope(
        categoryId: category,
        categoryNameEn: _hierarchy.categoryEnLabel(category),
        categoryName: _hierarchy.categoryDisplayName(category),
        serviceLabelsEn: labels,
        sidebarLabelsEn: sidebarLabels,
        // The count remembers the tags the conversation was SAVED with
        // (not the ones that survived): a renamed-away sidebar label
        // beside a Quick Help tag must refuse the follow-up, exactly as
        // it does when there is no Quick Help tag.
        sidebarTagCount: otherTags.length,
        quickHelpButtonId: tag,
        quickHelpScopeState: _hierarchy.stateFor(button),
      );
    }

    // A sidebar scope: the tags are the ENGLISH labels it was narrowed
    // by, and the category comes from the conversation's own edge. A tag
    // that names no entity of the LIVE hierarchy (an unknown button id, a
    // label that was renamed away) is not a filter label: it would filter
    // on a label no chunk carries, and the follow-up would abstain. It is
    // dropped here — the send guard then refuses the scope if nothing
    // nameable is left, instead of sending an unfiltered query.
    // A LEGACY tag: conversations saved before the redesign carry
    // 'category.<id>' — the old restore's spelling for a category-only
    // scope. It names the CATEGORY, not a label: reading it as an
    // unknown sidebar tag (count without a label) refused every
    // follow-up on a conversation the web restores and answers.
    // 'category.general' is the no-scope placeholder: it contributes
    // nothing. The legacy tag wins over the conversation's own edge —
    // it IS the scope the conversation was saved with.
    final legacyCategory = RegExp(r'^category\.(.+)$').firstMatch(
      tagList.firstWhere(
        (tag) => tag.startsWith('category.'),
        orElse: () => '',
      ),
    );
    final String? legacyCategoryId =
        legacyCategory != null && declaresCategoryScope(legacyCategory.group(1))
        ? legacyCategory.group(1)
        : null;
    final sidebarTags = tagList
        .where((tag) => !tag.startsWith('category.'))
        .toList();
    final knownLabels = sidebarTags.where(_hierarchy.knowsLabel).toList();
    return ConversationScope(
      categoryId: legacyCategoryId ?? categoryKey,
      categoryNameEn: _hierarchy.categoryEnLabel(
        legacyCategoryId ?? categoryKey,
      ),
      categoryName: _hierarchy.categoryDisplayName(
        legacyCategoryId ?? categoryKey,
      ),
      serviceLabelsEn: knownLabels,
      // The same labels, in their role: a sidebar scope's filter labels
      // ARE its sidebar labels — the chatbot reads one field instead of
      // re-deriving the fallback this used to force.
      sidebarLabelsEn: knownLabels,
      sidebarTagCount: sidebarTags.length,
    );
  }
}

/// Whether the button's scope can be put on the wire.
///
/// The config carries the category KEY; the wire needs its ENGLISH label,
/// and only the live tree can say it. A tree that did not load cannot name
/// the scope — and a query without it would answer from the whole corpus,
/// from a button the user believes is scoped. No label, no query.
bool quickHelpScopeIsNameable(
  Map<String, dynamic> button,
  QuickHelpScopeResolver? resolver,
) {
  final category = button['category']?.toString() ?? '';
  if (category.isEmpty || category == 'general') return true;
  return resolver?.categoryLabelEn(button) != null;
}

/// Whether the query can carry the selection's scope.
///
/// A selection that declares NO scope asks an unscoped question — the
/// user's own choice, and it goes out as it is. A selection that DOES
/// declare a scope must be able to NAME it: the wire speaks ENGLISH, and
/// a scope with no English name would go out with NO filter at all — the
/// corpus answering from outside the scope the selection declared.
bool scopeCanGoOnTheWire({
  String? categoryId,
  String? categoryNameEn,
  List<String> serviceLabels = const <String>[],
  List<String> sidebarServiceLabels = const <String>[],
  int sidebarServiceCount = 0,
  bool quickHelpScopeBroken = false,
}) {
  // A restored Quick Help scope whose button is BROKEN (a declared label
  // or its category left the hierarchy) refuses like the press path
  // refuses the tap: replaying the dead labels would filter on labels no
  // chunk carries — a silent abstention instead of a named failure.
  if (quickHelpScopeBroken) return false;
  final labels = serviceLabels.isNotEmpty
      ? serviceLabels
      : sidebarServiceLabels;
  // An EMPTY category id declares nothing: the context bar's X clears the
  // selection with one, and an empty id is not a scope. Reading it as one
  // would refuse every question the user asks afterwards. 'general' is
  // the placeholder a category-less selection is stored under — it names
  // no category, on either platform.
  final hasScope =
      declaresCategoryScope(categoryId) ||
      labels.isNotEmpty ||
      sidebarServiceCount > 0;
  if (!hasScope) return true;
  // A PICKED service must carry its own ENGLISH name: the category does
  // not stand in for it. A picked service with no EN translation
  // contributes no label — sending anyway would narrow the query to the
  // whole category while the chip still names the service. No partial
  // drop either: one unnamed pick refuses the send.
  if (sidebarServiceCount > sidebarServiceLabels.length) {
    return false;
  }
  return (categoryNameEn != null && categoryNameEn.isNotEmpty) ||
      labels.isNotEmpty;
}

/// The tags a conversation carries: the Quick Help button's id — its
/// identity — and, BESIDE it, the ENGLISH labels of the sidebar scope
/// that was selected with it. The web writes one tag per context item; a
/// conversation carrying both scopes must carry both tags, or the sidebar
/// one is lost on the next restore. A conversation that carries no scope
/// carries no tags.
List<String> conversationScopeTags({
  String? quickHelpButtonId,
  List<String> sidebarServiceLabels = const <String>[],
}) => [?quickHelpButtonId, ...sidebarServiceLabels];
