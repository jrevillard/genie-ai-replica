import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/utils/service_selection_context.dart';

// The wire mapping's FALLBACKS, pinned at the helper's own boundary (the
// panel-flow test exercises the happy path; these pin what a partial
// selection map produces — the shapes main.dart's _onServiceSelected
// must survive).
void main() {
  test('a selection with neither category_id nor id yields an empty id', () {
    final context = categoryContextFromSelection({'name': 'Births'});
    expect(context.categoryId, '');
  });

  test('id falls back to id when category_id is absent', () {
    final context = categoryContextFromSelection({'id': 'svc-1'});
    expect(context.categoryId, 'svc-1');
  });

  test('a missing name yields the Unknown Service placeholder', () {
    final context = categoryContextFromSelection({'category_id': '2'});
    expect(context.categoryName, 'Unknown Service');
  });

  test('non-string fields are coerced, and an absent serviceCount falls back '
      'to the label count', () {
    final context = categoryContextFromSelection(<String, dynamic>{
      'category_id': 7,
      'name': 42,
      'categoryNameEn': 42,
      'serviceLabelsEn': <dynamic>['Births', ''],
    });
    // The tree is decoded JSON: a numeric id or name must arrive as a
    // String, not crash the assignment.
    expect(context.categoryId, '7');
    expect(context.categoryName, '42');
    expect(context.categoryNameEn, '42');
    // The empty element drops — it names no label on the wire.
    expect(context.serviceLabelsEn, ['Births']);
    expect(context.serviceCount, 1);
  });

  test('an explicit serviceCount wins over the label count', () {
    final context = categoryContextFromSelection(<String, dynamic>{
      'serviceLabelsEn': <dynamic>['Births'],
      'serviceCount': 3,
    });
    expect(context.serviceCount, 3);
  });

  test('a string serviceCount coerces like the other fields', () {
    final context = categoryContextFromSelection(<String, dynamic>{
      'serviceLabelsEn': <dynamic>['Births'],
      'serviceCount': '2',
    });
    expect(context.serviceCount, 2);
  });
}
