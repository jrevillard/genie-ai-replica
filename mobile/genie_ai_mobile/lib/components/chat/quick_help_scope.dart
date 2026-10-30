import 'package:genie_ai_mobile/utils/config_resolver.dart';

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
//
// The CONFIG-side rules of a Quick Help button live here too: its identity
// (its id), the title it displays, and when the loaded buttons must
// re-resolve for a new locale. They are the same kind of rule — one copy,
// read by every path — and they belong to the button, not to the widget
// that shows it.

/// Whether [id] names a category scope at all. An EMPTY id declares
/// nothing (it is how a selection is cleared), and 'general' is the
/// placeholder a category-less selection is stored under: neither is a
/// scope, in every rule that reads one. This predicate is the ONE copy —
/// the subject of this whole branch is what happens when two copies of a
/// scope rule drift apart.
bool declaresCategoryScope(String? id) {
  return id != null && id.isNotEmpty && id != 'general';
}

/// The loaded shape of one Quick Help button, parsed from its config
/// entry [btn] under [locale].
///
/// The shipped configurations declare the button's texts at the TOP
/// level: `title` is a locale map (resolved here, once, like the
/// welcome message), `icon` is an object whose `value` is a served
/// path whose basename names the bundled asset, and `action` carries
/// the visible and hidden texts. A button with no icon — or a
/// malformed one — carries NO asset: the card renders its neutral
/// help icon, the way the web renders an empty image. A bare STRING
/// where the label array belongs is wrapped as ONE label — the
/// wire's own bare-string rule.
Map<String, dynamic> parseQuickHelpButton(
  Map<String, dynamic> btn,
  String locale,
) {
  // One malformed value degrades ONE card, never the whole load — the
  // same isolation the web applies to the same file. A non-map icon or
  // action is the config-typo class the bare-string label rule answers.
  final dynamic rawIcon = btn['icon'];
  final iconMap = rawIcon is Map<String, dynamic> ? rawIcon : null;
  // The served path's BASENAME names the bundled asset: an empty one (a
  // value ending in '/', a bare key) names nothing — no asset, not a
  // directory path the card cannot load.
  final iconFile = iconMap?['value']?.toString().split('/').last ?? '';
  final String iconAsset = iconFile.isNotEmpty
      ? 'assets/config/quickhelp/$iconFile'
      : '';

  final dynamic rawAction = btn['action'];
  final action = rawAction is Map<String, dynamic> ? rawAction : null;

  final dynamic rawServiceLabels = btn['serviceLabels'];
  final List<dynamic> serviceLabels;
  if (rawServiceLabels is List<dynamic>) {
    serviceLabels = rawServiceLabels;
  } else if (rawServiceLabels is String && rawServiceLabels.isNotEmpty) {
    serviceLabels = [rawServiceLabels];
  } else {
    serviceLabels = const <dynamic>[];
  }

  return {
    'id': btn['id'],
    'category': btn['category'],
    'serviceLabels': serviceLabels,
    'iconAsset': iconAsset,
    'resolvedTitle': resolveConfigText(btn['title'], locale),
    'resolvedVisibleText': resolveConfigText(action?['visibleText'], locale),
    'resolvedHiddenPrompt': resolveConfigText(action?['hiddenPrompt'], locale),
  };
}

/// The card's declared English KB labels, as strings — the ONE read of a
/// loaded button's label list. Every scope rule (the grid verdict, the
/// unavailable caption, the restore union, the press filter) shares it, so
/// a change to the rule cannot drift between the copies.
List<String> quickHelpServiceLabelsOf(Map<String, dynamic> button) {
  final labels = button['serviceLabels'];
  if (labels is List) {
    return labels.map((label) => label.toString()).toList();
  }
  return const <String>[];
}

/// The loaded Quick Help buttons, with a duplicated id keeping only the
/// FIRST entry.
///
/// The id is the button's IDENTITY: the conversation tag carries it, the
/// restore resolves it, the grid's verdict keys on it. Two cards with one
/// id cannot both be honoured — the web keeps the first and drops the
/// duplicate at load, so the mobile must too, or the same saved
/// conversation would carry a different scope on the two platforms.
List<Map<String, dynamic>> dedupeQuickHelpButtons(
  List<Map<String, dynamic>> buttons,
) {
  final seen = <String>{};
  final unique = <Map<String, dynamic>>[];
  for (final button in buttons) {
    final id = button['id']?.toString();
    if (id == null || id.isEmpty || seen.add(id)) {
      unique.add(button);
    }
  }
  return unique;
}

/// The button [id] names in [buttons], or null when no button declares
/// it. The chatbot's two reads of a button by id — the restore path and
/// the locale re-title — share this one lookup, so a change to the
/// matching rule (trimming ids, a new id shape) cannot drift between
/// them. (ConversationScopeResolver keeps its OWN first-wins index in
/// _indexButtons — a different rule over a different structure.)
Map<String, dynamic>? quickHelpButtonById(
  List<Map<String, dynamic>> buttons,
  String? id,
) {
  if (id == null || id.isEmpty) return null;
  for (final button in buttons) {
    if (button['id']?.toString() == id) {
      return button;
    }
  }
  return null;
}

/// Whether the Quick Help buttons must re-resolve for [currentLocale].
///
/// The buttons are per-locale text resolved by a load; [loadedLocale] is
/// the locale the last load ran under — whether it succeeded or failed, a
/// failure marks the locale it failed under, so the retry is scoped to a
/// locale change. A null loadedLocale names the first, still-in-flight
/// load — that load resolves under the locale live at its completion, so
/// the mount's own dependency change must not start a second parse. A
/// drift (a load under another locale) re-resolves.
bool shouldReloadQuickHelpButtons({
  required String? loadedLocale,
  required String currentLocale,
}) {
  return loadedLocale != null && loadedLocale != currentLocale;
}

/// The title [button] carries, or null when it carries no title.
///
/// An EMPTY title is no title: a config card with a blank title text
/// must not blank the context bar — the caller keeps the name it has
/// (the saved category name on a restore, the caller's fallback on a
/// press). One rule for every path that shows a Quick Help title.
String? quickHelpTitleOf(Map<String, dynamic>? button) {
  final title = button?['resolvedTitle']?.toString() ?? '';
  return title.isNotEmpty ? title : null;
}

/// The title of the ACTIVE Quick Help scope, re-resolved from the button
/// list by its id — the mobile twin of the web's quickHelpTitleFor.
///
/// A locale switch re-resolves the buttons (a load in the new locale) and
/// the context bar's title must follow: the scope's identity is the button
/// id, not the title it was pressed under. A button the config no longer
/// declares, or a null or EMPTY id (empty declares nothing — the file's
/// own scope rule — and a sidebar scope has no id at all), resolves to
/// null so the caller keeps the title it already has.
String? activeQuickHelpTitleFor(
  List<Map<String, dynamic>> buttons,
  String? activeQuickHelpButtonId,
) {
  return quickHelpTitleOf(
    quickHelpButtonById(buttons, activeQuickHelpButtonId),
  );
}

/// Checks Quick Help buttons against the live hierarchy.
///
/// The hierarchy is what NAMES a scope: the config carries the category's
/// name (or its key, for a configuration written before that spelling), the
/// wire carries its ENGLISH label, and only the hierarchy can say what that
/// label is. A hierarchy that has not loaded says nothing about any button
/// ([pending]); one that could not be loaded is the CALLER's fact — the
/// widget marks it and passes each button through [unavailableScopeFor].
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
      _categoryLabelsEn = _indexByCatKey(enTree, _enOf),
      _categoryNames = _indexByCatKey(enTree, (entry) {
        final name = entry['name'];
        return (name is String && name.isNotEmpty) ? name : '';
      });

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
    final labels = quickHelpServiceLabelsOf(button);
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

  /// The category keys by their ENGLISH name — the identifier a
  /// CONFIGURATION names a category by. The inversion of the label index
  /// above: an entry the hierarchy cannot address by key cannot be
  /// addressed by name either, and the first of two categories sharing a
  /// name wins.
  late final Map<String, String> _categoryKeysByName = _invertByNameEn(
    _categoryLabelsEn,
  );

  /// Categories by key, FIRST-wins, each mapped by [valueOf]. The one
  /// walk behind the two key indexes (the EN-label index and the
  /// display-name index) — a skip rule added to one belongs to both.
  static Map<String, String> _indexByCatKey(
    List<dynamic> enTree,
    String Function(Map entry) valueOf,
  ) {
    final byKey = <String, String>{};
    for (final entry in enTree) {
      if (entry is! Map) continue;
      final key = entry['catKey']?.toString();
      if (key == null || key.isEmpty) continue;
      if (byKey.containsKey(key)) continue;
      byKey[key] = valueOf(entry);
    }
    return byKey;
  }

  /// The category keys by their ENGLISH name, FIRST-wins — the label
  /// index read backwards. The name is the identifier a configuration
  /// writes down; the key it resolves to is what the rest of the app
  /// speaks. The walk that built the label index owns the tree's skip
  /// rules; this is only its inversion.
  static Map<String, String> _invertByNameEn(Map<String, String> labelsByKey) {
    final byName = <String, String>{};
    labelsByKey.forEach((key, en) {
      if (en.isEmpty) return;
      if (byName.containsKey(en)) return;
      byName[en] = key;
    });
    return byName;
  }

  /// The hierarchy's own key for the category the [reference] names, or
  /// null when the hierarchy carries no such category.
  ///
  /// The configuration names a category by its ENGLISH NAME — the label
  /// the hierarchy publishes and the corpus filters on, and the one a
  /// deployment can write down without reading the database. The
  /// database key stays accepted: a configuration written before that
  /// spelling was adopted still names a category, and a deployment's
  /// configuration is edited on its own.
  ///
  /// The KEY is tried first, deliberately: the consumers of the resolved
  /// key — the conversation's edge, the legacy `category.<id>` tags — all
  /// speak keys, and a hierarchy can mint a key that equals ANOTHER
  /// category's name. On such a collision the key interpretation is the
  /// only one those consumers can survive; a configuration spelling that
  /// names nothing else unambiguously anyway.
  String? _categoryKeyFor(String? reference) {
    if (reference == null || reference.isEmpty) return null;
    // The legacy spelling: the key the hierarchy itself minted.
    if (_categoryLabelsEn.containsKey(reference)) return reference;
    return _categoryKeysByName[reference];
  }

  /// The category id a configuration reference speaks: the hierarchy's own
  /// key for the category it names.
  ///
  /// The configuration names its category; the key is what the app speaks
  /// everywhere else — the conversation's edge (`serviceCategories/<key>`)
  /// among them. A reference the hierarchy cannot name keeps its own
  /// spelling: the scope is then broken, and a broken scope is a visible
  /// error, never a silently unscoped query. 'general' (and empty) declare
  /// NO scope in every rule of this file: they are never looked up, or a
  /// hierarchy category literally named "general" would hijack a
  /// category-less selection into a real scope.
  String? categoryIdFor(String? reference) {
    if (!declaresCategoryScope(reference)) return reference;
    return _categoryKeyFor(reference) ?? reference;
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

  /// The scope state of [button] against the live tree.
  Map<String, dynamic> stateFor(Map<String, dynamic> button) {
    final declared = quickHelpServiceLabelsOf(button);
    final missingLabels = declared
        .where((l) => !_enLabels.contains(l))
        .toList();

    final category = button['category']?.toString();
    // The category is usable only when the hierarchy names it in
    // ENGLISH: that spelling is the wire. A category the hierarchy does
    // not carry, and a category it carries without an EN translation,
    // are the same thing here — a scope that cannot be named.
    // categoryEnLabel is the ONE predicate for that rule.
    final categoryMissing =
        declaresCategoryScope(category) && categoryEnLabel(category) == null;

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

  /// The ENGLISH label of the category the [reference] names. Null when
  /// the hierarchy does not carry it, or carries it without an EN
  /// translation — a scope that cannot be named, and so cannot be put on
  /// the wire.
  String? categoryEnLabel(String? reference) {
    final key = _categoryKeyFor(reference);
    if (key == null) return null;
    final en = _categoryLabelsEn[key];
    if (en == null || en.isEmpty) return null;
    return en;
  }

  /// The localized name of the category the [reference] names — what the
  /// user reads. Display only: it never filters.
  String? categoryDisplayName(String? reference) {
    final key = _categoryKeyFor(reference);
    if (key == null) return null;
    final name = _categoryNames[key];
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
       _buttons = _indexButtons(quickHelpButtons);

  /// The buttons by id, FIRST-wins.
  ///
  /// A configuration error can give two cards the same id. The web keeps
  /// the FIRST — its verdict map and its restore lookup are both
  /// first-wins — so the mobile must too, or the same saved conversation
  /// restores a DIFFERENT scope on the two platforms. A map literal would
  /// keep the LAST: the later key overwrites the earlier one.
  static Map<String, Map<String, dynamic>> _indexButtons(
    List<Map<String, dynamic>> buttons,
  ) {
    final byId = <String, Map<String, dynamic>>{};
    for (final button in buttons) {
      final id = button['id']?.toString();
      if (id == null || id.isEmpty) continue;
      if (byId.containsKey(id)) continue;
      byId[id] = button;
    }
    return byId;
  }

  final QuickHelpScopeResolver _hierarchy;
  final Map<String, Map<String, dynamic>> _buttons;

  /// The merged scope state of [buttons]: broken if ANY is, with the
  /// missing labels unioned and the flags OR-ed — one conversation, one
  /// verdict.
  Map<String, dynamic> _mergedScopeState(List<Map<String, dynamic>> buttons) {
    final states = buttons.map(_hierarchy.stateFor).toList();
    return {
      'broken': states.any((st) => st['broken'] as bool? ?? false),
      'unavailable': states.any((st) => st['unavailable'] as bool? ?? false),
      'missingLabels': [
        for (final st in states)
          ...(st['missingLabels'] as List? ?? const <dynamic>[]),
      ],
      'categoryMissing': states.any(
        (st) => st['categoryMissing'] as bool? ?? false,
      ),
    };
  }

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
      final buttonLabels = quickHelpServiceLabelsOf(button);
      // A legacy conversation can carry SEVERAL button ids: the web
      // restores every chip and sends the union of their labels. Every
      // other button tag is CONSUMED here (counted as a sidebar tag, it
      // read as a dropped label and refused the follow-up forever).
      final otherButtons = tagList
          .where((other) => other != tag && _buttons.containsKey(other))
          .map((other) => _buttons[other]!)
          .toList();
      final labels = [
        ...buttonLabels,
        for (final other in otherButtons) ...quickHelpServiceLabelsOf(other),
      ];
      // A LEGACY 'category.<id>' tag beside the button named the same
      // category the button declares (the old web wrote the pair): it is
      // consumed here, not counted as a sidebar tag — counting it refused
      // every follow-up while the web restored both chips and answered.
      final otherTags = tagList
          .where(
            (other) =>
                other != tag &&
                !_buttons.containsKey(other) &&
                !other.startsWith('category.'),
          )
          .toList();
      final sidebarLabels = otherTags.where(_hierarchy.knowsLabel).toList();
      // The button's own category WINS; a button that declares NONE keeps
      // the conversation's own edge — dropping it sent the follow-up
      // unscoped (a silent widening) while the web kept the edge.
      // The configuration names its category; the hierarchy's own key is
      // what the conversation's edge speaks.
      final effectiveCategory = category == null
          ? categoryKey
          : _hierarchy.categoryIdFor(category);
      return ConversationScope(
        categoryId: effectiveCategory,
        categoryNameEn: _hierarchy.categoryEnLabel(effectiveCategory),
        categoryName: _hierarchy.categoryDisplayName(effectiveCategory),
        serviceLabelsEn: labels,
        sidebarLabelsEn: sidebarLabels,
        // The count remembers the tags the conversation was SAVED with
        // (not the ones that survived): a renamed-away sidebar label
        // beside a Quick Help tag must refuse the follow-up, exactly as
        // it does when there is no Quick Help tag.
        sidebarTagCount: otherTags.length,
        quickHelpButtonId: tag,
        // EVERY restored button's state, merged: the web checks every
        // chip at send, and a broken SECOND button must refuse here too
        // — carrying the first button's state alone sent the union
        // including the dead labels, a silent abstention.
        quickHelpScopeState: _mergedScopeState([button, ...otherButtons]),
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

/// Whether a committed restore should be re-resolved now that a source it
/// depended on (the hierarchy, the config) settled.
///
/// The restore's OWNERSHIP is its epoch marker, never its tags: a
/// conversation saved without a `tags` array restores a category-only
/// scope — the one scope the tree alone names — and keying the re-resolve
/// on the tags left exactly that scope frozen against the outage's empty
/// tree, unanswerable forever after the tree recovered. A user action
/// since the restore (the epoch moved) means the saved scope no longer
/// applies, and a restore that carried neither tags nor a category has
/// nothing to re-resolve.
bool shouldReResolveRestoredScope({
  required List<dynamic>? restoredTags,
  required String? restoredCategoryKey,
  required int? restoredScopeEpoch,
  required int scopeEpoch,
  required bool hierarchyReady,
}) {
  // A null epoch (no restore ever committed) never equals the live one —
  // the comparison alone refuses it.
  if (restoredScopeEpoch != scopeEpoch || !hierarchyReady) {
    return false;
  }
  return (restoredTags?.isNotEmpty ?? false) || restoredCategoryKey != null;
}

/// Whether the button's scope can be put on the wire.
///
/// The config names the category; the wire needs its ENGLISH label, and
/// only the live tree can say it. A tree that did not load cannot name the
/// scope — and a query without it would answer from the whole corpus, from
/// a button the user believes is scoped. No label, no query.
bool quickHelpScopeIsNameable(
  Map<String, dynamic> button,
  QuickHelpScopeResolver? resolver,
) {
  final category = button['category']?.toString();
  // An id that declares NO category scope (empty, or the 'general'
  // placeholder) is how a selection is cleared — the hierarchy has
  // nothing to deny. declaresCategoryScope is the ONE predicate.
  if (!declaresCategoryScope(category)) return true;
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
  final labels = mergeServiceLabels(serviceLabels, sidebarServiceLabels);
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

/// The labels a request carries: the Quick Help card's declared labels
/// BESIDE the sidebar's — one merge rule, read by the send path (the
/// payload) and the wire guard (the emptiness check) alike. A pick
/// between the two would have to be re-derived everywhere the payload is
/// built; the concat is the payload, and emptiness is the same under it.
List<String> mergeServiceLabels(List<String> active, List<String> sidebar) => [
  ...active,
  ...sidebar,
];

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
