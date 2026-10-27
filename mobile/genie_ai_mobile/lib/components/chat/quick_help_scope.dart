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
/// A tree that has not loaded (or failed to) says nothing about any button,
/// so it validates nothing: [stateFor] reports every button as unbroken.
class QuickHelpScopeResolver {
  QuickHelpScopeResolver(List<dynamic> enTree)
    : _enLabels = _collectEnLabels(enTree),
      _categoryLabelsEn = _indexCategories(enTree),
      _hasTree = enTree.isNotEmpty;

  final Set<String> _enLabels;
  final Map<String, String> _categoryLabelsEn;
  final bool _hasTree;

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
    if (!_hasTree) {
      return {
        'broken': false,
        'missingLabels': const <String>[],
        'categoryMissing': false,
      };
    }

    final declared =
        (button['serviceLabels'] as List<dynamic>? ?? const <dynamic>[])
            .map((e) => e.toString())
            .toList();
    final missingLabels = declared
        .where((l) => !_enLabels.contains(l))
        .toList();

    final category = button['category']?.toString();
    final categoryMissing =
        category != null &&
        category.isNotEmpty &&
        category != 'general' &&
        !_categoryLabelsEn.containsKey(category);

    return {
      'broken': missingLabels.isNotEmpty || categoryMissing,
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
