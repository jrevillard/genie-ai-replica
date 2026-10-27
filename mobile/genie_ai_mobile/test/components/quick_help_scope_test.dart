import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/quick_help_scope.dart';

void main() {
  final enTree = <dynamic>[
    {
      'catKey': '2',
      'name': 'État civil',
      'nameEN': 'Civil Registry',
      'children': [
        {'name': 'Naissances', 'nameEN': 'Births'},
      ],
    },
  ];
  final resolver = QuickHelpScopeResolver(enTree);

  group('QuickHelpScopeResolver.stateFor', () {
    test(
      'a declared label the hierarchy no longer carries marks the button broken',
      () {
        final button = {
          'id': 'civil',
          'serviceLabels': ['Registration', 'Births'],
          'category': '2',
        };

        final state = resolver.stateFor(button);

        expect(state['broken'], isTrue);
        expect(state['missingLabels'], ['Registration']);
      },
    );

    test(
      'a category the hierarchy no longer carries marks the button broken',
      () {
        final button = {
          'id': 'tax',
          'serviceLabels': ['Births'],
          'category': '404',
        };

        final state = resolver.stateFor(button);

        expect(state['broken'], isTrue);
        expect(state['categoryMissing'], isTrue);
      },
    );

    test('a button whose labels and category both exist is not broken', () {
      final button = {
        'id': 'civil',
        'serviceLabels': ['Births'],
        'category': '2',
      };

      expect(resolver.stateFor(button)['broken'], isFalse);
    });

    test(
      'an empty tree validates nothing — it says nothing about any button',
      () {
        final button = {
          'id': 'civil',
          'serviceLabels': ['Registration'],
          'category': '404',
        };

        final empty = QuickHelpScopeResolver(<dynamic>[]);

        expect(empty.stateFor(button)['broken'], isFalse);
      },
    );

    test('the general placeholder names no category of the hierarchy', () {
      final button = {
        'id': 'just-chat',
        'serviceLabels': <dynamic>[],
        'category': 'general',
      };

      final state = resolver.stateFor(button);

      expect(state['broken'], isFalse);
      expect(state['categoryMissing'], isFalse);
    });
  });

  group('quickHelpScopeIsNameable', () {
    test('a button that declares no category needs no tree', () {
      expect(
        quickHelpScopeIsNameable(<String, dynamic>{'category': null}, null),
        isTrue,
      );
      expect(
        quickHelpScopeIsNameable(<String, dynamic>{
          'category': 'general',
        }, null),
        isTrue,
      );
    });

    test('a scoped button needs the tree to name its category', () {
      final button = <String, dynamic>{'category': '2'};
      // A tree that did not load cannot name the scope — and a query without
      // it would answer from the whole corpus. No label, no query.
      expect(quickHelpScopeIsNameable(button, null), isFalse);
      expect(quickHelpScopeIsNameable(button, resolver), isTrue);
    });

    test(
      'a scoped button whose entity carries no EN label is not nameable',
      () {
        final tree = <dynamic>[
          {'catKey': '2', 'name': 'X', 'nameEN': null, 'children': <dynamic>[]},
        ];
        expect(
          quickHelpScopeIsNameable(<String, dynamic>{
            'category': '2',
          }, QuickHelpScopeResolver(tree)),
          isFalse,
        );
      },
    );
  });

  group('QuickHelpScopeResolver.categoryLabelEn', () {
    test('resolves the ENGLISH label of the declared category', () {
      expect(resolver.categoryLabelEn({'category': '2'}), 'Civil Registry');
    });

    test('null for a button that declares no category', () {
      expect(resolver.categoryLabelEn({'category': null}), isNull);
    });

    test('null for a category the hierarchy no longer carries', () {
      expect(resolver.categoryLabelEn({'category': '404'}), isNull);
    });

    test('null for an entity that carries no EN translation', () {
      final tree = <dynamic>[
        {'catKey': '2', 'name': 'X', 'nameEN': null, 'children': <dynamic>[]},
      ];
      expect(
        QuickHelpScopeResolver(tree).categoryLabelEn({'category': '2'}),
        isNull,
      );
    });
  });
}
