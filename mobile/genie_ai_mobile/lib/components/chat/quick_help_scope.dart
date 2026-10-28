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

/// Checks Quick Help buttons against the live hierarchy.
///
/// The hierarchy is what NAMES a scope: the config carries a category
/// KEY, the wire carries its ENGLISH label, and only the hierarchy can
/// say what that label is. A hierarchy that has not loaded says nothing
/// about any button ([pending]); one that could not be loaded is the
/// CALLER's fact — the widget marks it and passes each button through
/// [unavailableScopeFor].
class QuickHelpScopeResolver {
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
    final declaresScope =
        (category != null && category.isNotEmpty && category != 'general') ||
        labels.isNotEmpty;
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
      final catEn = entry['nameEN'];
      if (catEn is String && catEn.isNotEmpty) labels.add(catEn);
      final children = entry['children'];
      if (children is List) {
        for (final child in children) {
          if (child is! Map) continue;
          final childEn = child['nameEN'];
          if (childEn is String && childEn.isNotEmpty) labels.add(childEn);
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
      final en = entry['nameEN'];
      byKey[key] = (en is String && en.isNotEmpty) ? en : '';
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
        category != null &&
        category.isNotEmpty &&
        category != 'general' &&
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
      final sidebarLabels = tagList
          .where((other) => other != tag)
          .where(_hierarchy.knowsLabel)
          .toList();
      return ConversationScope(
        categoryId: category,
        categoryNameEn: _hierarchy.categoryEnLabel(category),
        categoryName: _hierarchy.categoryDisplayName(category),
        serviceLabelsEn: labels,
        sidebarLabelsEn: sidebarLabels,
        sidebarTagCount: sidebarLabels.length,
        quickHelpButtonId: tag,
      );
    }

    // A sidebar scope: the tags are the ENGLISH labels it was narrowed
    // by, and the category comes from the conversation's own edge. A tag
    // that names no entity of the LIVE hierarchy (an unknown button id, a
    // label that was renamed away) is not a filter label: it would filter
    // on a label no chunk carries, and the follow-up would abstain. It is
    // dropped here — the send guard then refuses the scope if nothing
    // nameable is left, instead of sending an unfiltered query.
    final knownLabels = tagList.where(_hierarchy.knowsLabel).toList();
    return ConversationScope(
      categoryId: categoryKey,
      categoryNameEn: _hierarchy.categoryEnLabel(categoryKey),
      categoryName: _hierarchy.categoryDisplayName(categoryKey),
      serviceLabelsEn: knownLabels,
      sidebarTagCount: tagList.length,
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
}) {
  final labels = serviceLabels.isNotEmpty
      ? serviceLabels
      : sidebarServiceLabels;
  // An EMPTY category id declares nothing: the context bar's X clears the
  // selection with one, and an empty id is not a scope. Reading it as one
  // would refuse every question the user asks afterwards.
  final hasScope =
      (categoryId != null && categoryId.isNotEmpty) ||
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
