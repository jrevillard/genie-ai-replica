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
  // Every field coerces through toString(): the panel's tree is decoded
  // JSON, and a numeric id or name in the source data must reach the
  // chat as a String, not crash the assignment.
  final String categoryId =
      selection['category_id']?.toString() ?? selection['id']?.toString() ?? '';
  final String categoryName =
      selection['name']?.toString() ?? 'Unknown Service';
  // BOTH spellings travel to the chat: display (name) and the EN wire
  // labels (the SSOT the retriever filters on). The labels tolerate the
  // same shape the web's button mapping tolerates: a bare String is ONE
  // label — the hard List cast would crash on it instead.
  final String categoryNameEn = selection['categoryNameEn']?.toString() ?? '';
  final rawLabels = selection['serviceLabelsEn'];
  final List<String> serviceLabelsEn = rawLabels is List
      ? rawLabels.map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
      : rawLabels is String && rawLabels.isNotEmpty
      ? <String>[rawLabels]
      : <String>[];
  // How many services were picked: a picked service with no EN
  // translation contributes no label, and the chat must refuse the
  // send instead of quietly narrowing the query to the category.
  // Parsed through tryParse so a string count coerces like the other
  // fields instead of throwing on the cast.
  final int serviceCount =
      num.tryParse(selection['serviceCount']?.toString() ?? '')?.toInt() ??
      serviceLabelsEn.length;
  return (
    categoryId: categoryId,
    categoryName: categoryName,
    categoryNameEn: categoryNameEn,
    serviceLabelsEn: serviceLabelsEn,
    serviceCount: serviceCount,
  );
}
