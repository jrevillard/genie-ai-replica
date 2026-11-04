/// The sidebar service-selection wire mapping: a selection map emitted by
/// `ServiceTreePanel.onSelectionChange` translated into the arguments of
/// `ChatBotComponentState.setCategoryContext`.
///
/// ONE copy, owned by the app code: `main.dart`'s `_onServiceSelected`
/// applies it in production, and the tests apply the same function — so a
/// wire field that gains or renames a member cannot leave the tests
/// proving an outdated shape.
///
/// Returns a record because `setCategoryContext` keeps its positional +
/// named signature; the caller passes the five fields through explicitly.
({
  String categoryId,
  String categoryName,
  String categoryNameEn,
  List<String> serviceLabelsEn,
  int serviceCount,
})
categoryContextFromSelection(Map<String, dynamic> selection) {
  final String categoryId = selection['category_id'] ?? selection['id'] ?? '';
  final String categoryName = selection['name'] ?? 'Unknown Service';
  // BOTH spellings travel to the chat: display (name) and the EN wire
  // labels (the SSOT the retriever filters on).
  final String categoryNameEn = selection['categoryNameEn']?.toString() ?? '';
  final List<String> serviceLabelsEn =
      (selection['serviceLabelsEn'] as List<dynamic>? ?? const <dynamic>[])
          .map((e) => e.toString())
          .where((e) => e.isNotEmpty)
          .toList();
  // How many services were picked: a picked service with no EN
  // translation contributes no label, and the chat must refuse the
  // send instead of quietly narrowing the query to the category.
  final int serviceCount =
      (selection['serviceCount'] as num?)?.toInt() ?? serviceLabelsEn.length;
  return (
    categoryId: categoryId,
    categoryName: categoryName,
    categoryNameEn: categoryNameEn,
    serviceLabelsEn: serviceLabelsEn,
    serviceCount: serviceCount,
  );
}
