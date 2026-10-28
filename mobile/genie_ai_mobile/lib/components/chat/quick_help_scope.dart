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
/// about any button ([pending]); a hierarchy that could not be loaded
/// says that no scope can be verified at all ([unavailable]).
class QuickHelpScopeResolver {
  QuickHelpScopeResolver(List<dynamic> enTree, {this.unavailable = false})
    : _enLabels = _collectEnLabels(enTree),
      _categoryLabelsEn = _indexCategories(enTree);

  /// A hierarchy that could not be loaded names no scope at all.
  factory QuickHelpScopeResolver.unavailable() =>
      QuickHelpScopeResolver(const [], unavailable: true);

  /// The scope state of a button whose hierarchy has not loaded yet: it
  /// says nothing about any button.
  static const Map<String, dynamic> pending = {
    'broken': false,
    'unavailable': false,
    'missingLabels': <String>[],
    'categoryMissing': false,
  };

  /// The scope state of every button when the hierarchy could not be
  /// loaded: no scope can be verified, and every button must say so.
  static const Map<String, dynamic> unavailableScope = {
    'broken': true,
    'unavailable': true,
    'missingLabels': <String>[],
    'categoryMissing': false,
  };

  /// The hierarchy could not be loaded: no scope can be verified, and
  /// every button must say so.
  final bool unavailable;

  final Set<String> _enLabels;
  final Map<String, String> _categoryLabelsEn;

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
    if (unavailable) {
      return unavailableScope;
    }

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
  String? categoryLabelEn(Map<String, dynamic> button) {
    final category = button['category']?.toString();
    if (category == null || category.isEmpty) return null;
    final en = _categoryLabelsEn[category];
    if (en == null || en.isEmpty) return null;
    return en;
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
