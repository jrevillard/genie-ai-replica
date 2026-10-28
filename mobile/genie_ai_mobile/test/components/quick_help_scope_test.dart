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

    test('an empty hierarchy says every scoped category is missing', () {
      // A hierarchy that LOADED and carries nothing is not a hierarchy
      // that knows nothing: every category a button names is absent
      // from it, and the button cannot keep the scope it promised.
      final button = {
        'id': 'civil',
        'serviceLabels': ['Registration'],
        'category': '404',
      };

      final empty = QuickHelpScopeResolver(<dynamic>[]);

      expect(empty.stateFor(button)['broken'], isTrue);
      expect(empty.stateFor(button)['categoryMissing'], isTrue);
    });

    test(
      'a category the hierarchy carries without an EN translation is missing',
      () {
        // The wire speaks EN: a category the hierarchy carries only in
        // the localized spelling has no filterable label at all, so the
        // scope it names cannot be put on the wire.
        final tree = <dynamic>[
          {'catKey': '2', 'name': 'X', 'nameEN': null, 'children': <dynamic>[]},
        ];
        final resolver = QuickHelpScopeResolver(tree);

        final state = resolver.stateFor({'id': 'civil', 'category': '2'});

        expect(state['broken'], isTrue);
        expect(state['categoryMissing'], isTrue);
      },
    );

    test('a hierarchy that has not loaded says nothing about any button', () {
      expect(QuickHelpScopeResolver.pending['broken'], isFalse);
      expect(QuickHelpScopeResolver.pending['unavailable'], isFalse);
    });

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

  // The scope of a saved conversation: what the conversation was asked in,
  // resolved against the live hierarchy and the Quick Help buttons.
  group('ConversationScopeResolver.resolve', () {
    final convTree = <dynamic>[
      {
        'catKey': '2',
        'name': 'Estado civil',
        'nameEN': 'Civil Registry',
        'children': [
          {'name': 'Nacimientos', 'nameEN': 'Births'},
        ],
      },
    ];
    final convButtons = <Map<String, dynamic>>[
      {
        'id': 'civil',
        'category': '2',
        'serviceLabels': ['Births'],
      },
    ];

    ConversationScopeResolver convResolver([
      List<Map<String, dynamic>>? buttons,
    ]) => ConversationScopeResolver(
      hierarchy: QuickHelpScopeResolver(convTree),
      quickHelpButtons: buttons ?? convButtons,
    );

    test('a Quick Help tag restores the scope of that button', () {
      final scope = convResolver().resolve(tags: ['civil'], categoryKey: '2');

      expect(scope.quickHelpButtonId, 'civil');
      expect(scope.categoryId, '2');
      expect(scope.categoryNameEn, 'Civil Registry');
      expect(scope.categoryName, 'Estado civil');
      expect(scope.serviceLabelsEn, ['Births']);
    });

    test('a conversation carrying BOTH scopes restores both', () {
      // The web writes one tag per context item, and a sidebar selection
      // survives beside a Quick Help one: the conversation carries the
      // button id AND the sidebar's EN labels. Restoring the button's
      // scope alone would answer wider than the web does.
      final scope = convResolver().resolve(tags: ['civil', 'Births']);

      expect(scope.quickHelpButtonId, 'civil');
      expect(scope.serviceLabelsEn, ['Births']);
      expect(scope.sidebarLabelsEn, ['Births']);
    });

    test('a sidebar tag restores the ENGLISH labels and the category', () {
      final scope = convResolver().resolve(tags: ['Births'], categoryKey: '2');

      expect(scope.quickHelpButtonId, isNull);
      expect(scope.categoryId, '2');
      expect(scope.categoryNameEn, 'Civil Registry');
      expect(scope.serviceLabelsEn, ['Births']);
    });

    test('a scope the hierarchy can no longer name has no EN label', () {
      // The category left the hierarchy: the conversation carries the key,
      // but nothing can NAME it any more — the scope cannot go on the wire.
      final scope = convResolver().resolve(
        tags: ['Renamed'],
        categoryKey: '404',
      );

      expect(scope.categoryNameEn, isNull);
      expect(scope.categoryName, isNull);
      // A tag the live hierarchy does not carry is not a label: it would
      // filter on a label no chunk carries, and the follow-up would
      // abstain instead of telling the user the scope is gone.
      expect(scope.serviceLabelsEn, isEmpty);
    });

    test('a tag that names no button stays a sidebar scope', () {
      // 'Births' is a service of the hierarchy: it survives the filter.
      final scope = convResolver().resolve(tags: ['Births'], categoryKey: '2');

      expect(scope.quickHelpButtonId, isNull);
      expect(scope.categoryNameEn, 'Civil Registry');
      expect(scope.serviceLabelsEn, ['Births']);
      // A sidebar scope's filter labels are its sidebar labels: the
      // chatbot reads this field directly, no fallback re-derivation.
      expect(scope.sidebarLabelsEn, ['Births']);
    });

    test(
      'a PRE-nameEN tree (deploy window) still names scopes through name',
      () {
        // The mobile fetches the tree with locale 'en': there, `name` IS
        // the English translation. A backend one version behind (no
        // nameEN in the response) left every scoped card reading broken
        // for the whole deploy window — the dataprep keeps exactly this
        // fallback for the same window.
        final preNameEnTree = <dynamic>[
          {
            'catKey': '2',
            'name': 'Civil Registry',
            'children': [
              {'name': 'Births'},
            ],
          },
        ];
        final resolver = QuickHelpScopeResolver(preNameEnTree);

        expect(resolver.knowsLabel('Births'), isTrue);
        expect(resolver.categoryEnLabel('2'), 'Civil Registry');
        expect(
          resolver.stateFor({
            'id': 'civil',
            'category': '2',
            'serviceLabels': const <dynamic>['Births'],
          })['broken'],
          isFalse,
        );
      },
    );

    test('a LEGACY category.<id> tag restores the category, not a refusal', () {
      // Conversations saved before the redesign carry 'category.<id>' —
      // the old restore's spelling for a category-only scope. The web
      // restores it as the category; the mobile resolver counted it as
      // an unknown sidebar tag (count 1, labels 0) and refused EVERY
      // follow-up on a conversation the web answers.
      final scope = convResolver().resolve(tags: ['category.2']);

      expect(scope.categoryId, '2');
      expect(scope.categoryNameEn, 'Civil Registry');
      expect(scope.serviceLabelsEn, isEmpty);
      // The legacy tag is not a sidebar tag: it names the CATEGORY, and
      // the count must not read it as a dropped label.
      expect(scope.sidebarTagCount, 0);
      expect(
        scopeCanGoOnTheWire(
          categoryId: scope.categoryId,
          categoryNameEn: scope.categoryNameEn,
          serviceLabels: scope.serviceLabelsEn,
          sidebarServiceLabels: scope.sidebarLabelsEn,
          sidebarServiceCount: scope.sidebarTagCount,
        ),
        isTrue,
      );
    });

    test('TWO button tags restore BOTH scopes, not a refusal', () {
      // The old web could save a conversation carrying two button ids.
      // The web restores both chips and sends the union of their labels;
      // the mobile returned on the FIRST and counted the second as an
      // unknown sidebar tag — a permanent refusal on data the web
      // answers.
      final convButtons7 = <Map<String, dynamic>>[
        {
          'id': 'btn-a',
          'category': '2',
          'serviceLabels': const <dynamic>['Births'],
        },
        {
          'id': 'btn-b',
          'category': '2',
          'serviceLabels': const <dynamic>['Marriages'],
        },
      ];
      final scope = ConversationScopeResolver(
        hierarchy: QuickHelpScopeResolver(convTree),
        quickHelpButtons: convButtons7,
      ).resolve(tags: ['btn-a', 'btn-b']);

      expect(scope.quickHelpButtonId, 'btn-a');
      // The union — the scope the web sends for the same conversation.
      expect(scope.serviceLabelsEn, ['Births', 'Marriages']);
      // The second button tag is CONSUMED, not counted as a dropped
      // sidebar tag.
      expect(scope.sidebarTagCount, 0);
      expect(
        scopeCanGoOnTheWire(
          categoryId: scope.categoryId,
          categoryNameEn: scope.categoryNameEn,
          serviceLabels: scope.serviceLabelsEn,
          sidebarServiceLabels: scope.sidebarLabelsEn,
          sidebarServiceCount: scope.sidebarTagCount,
        ),
        isTrue,
      );
    });

    test('a BROKEN second button refuses the two-button conversation', () {
      // The web checks every chip at send; the mobile carried the FIRST
      // button's state alone and sent the union including the dead
      // labels — a silent abstention.
      final convButtons8 = <Map<String, dynamic>>[
        {
          'id': 'btn-a',
          'category': '2',
          'serviceLabels': const <dynamic>['Births'],
        },
        {
          'id': 'btn-b',
          'category': '2',
          'serviceLabels': const <dynamic>['Renamed Away'],
        },
      ];
      final scope = ConversationScopeResolver(
        hierarchy: QuickHelpScopeResolver(convTree),
        quickHelpButtons: convButtons8,
      ).resolve(tags: ['btn-a', 'btn-b']);

      expect(scope.quickHelpScopeState!['broken'], isTrue);
      expect(scope.quickHelpScopeState!['missingLabels'], ['Renamed Away']);
      expect(
        scopeCanGoOnTheWire(
          categoryId: scope.categoryId,
          categoryNameEn: scope.categoryNameEn,
          serviceLabels: scope.serviceLabelsEn,
          sidebarServiceLabels: scope.sidebarLabelsEn,
          sidebarServiceCount: scope.sidebarTagCount,
          quickHelpScopeBroken: scope.quickHelpScopeState!['broken'] as bool,
        ),
        isFalse,
      );
    });

    test(
      'a button with NO category keeps the conversation own category edge',
      () {
        // A legacy pair: the conversation carries a category edge, the
        // button declares none. Dropping the edge sent the follow-up
        // UNscoped — a silent widening — while the web kept the edge.
        final convButtons6 = <Map<String, dynamic>>[
          {
            'id': 'no-cat',
            'category': null,
            'serviceLabels': const <dynamic>[],
          },
        ];
        final scope = ConversationScopeResolver(
          hierarchy: QuickHelpScopeResolver(convTree),
          quickHelpButtons: convButtons6,
        ).resolve(tags: ['no-cat'], categoryKey: '2');

        expect(scope.quickHelpButtonId, 'no-cat');
        expect(scope.categoryId, '2');
        expect(scope.categoryNameEn, 'Civil Registry');
        expect(
          scopeCanGoOnTheWire(
            categoryId: scope.categoryId,
            categoryNameEn: scope.categoryNameEn,
            serviceLabels: scope.serviceLabelsEn,
            sidebarServiceLabels: scope.sidebarLabelsEn,
            sidebarServiceCount: scope.sidebarTagCount,
          ),
          isTrue,
        );
      },
    );

    test(
      'a LEGACY category tag BESIDE a Quick Help tag does not refuse the send',
      () {
        // Old-web conversations can carry both: a button tag and the
        // category-only chip's legacy spelling. The legacy tag is not a
        // sidebar label — counting it refused every follow-up while the
        // web restored both chips and answered.
        final convButtons5 = <Map<String, dynamic>>[
          {
            'id': 'civil',
            'category': '2',
            'serviceLabels': const <dynamic>['Births'],
          },
        ];
        final scope = ConversationScopeResolver(
          hierarchy: QuickHelpScopeResolver(convTree),
          quickHelpButtons: convButtons5,
        ).resolve(tags: ['civil', 'category.2']);

        expect(scope.quickHelpButtonId, 'civil');
        expect(scope.serviceLabelsEn, ['Births']);
        // The legacy tag named the same category the button declares: it
        // is consumed, not counted as a dropped sidebar tag.
        expect(scope.sidebarTagCount, 0);
        expect(
          scopeCanGoOnTheWire(
            categoryId: scope.categoryId,
            categoryNameEn: scope.categoryNameEn,
            serviceLabels: scope.serviceLabelsEn,
            sidebarServiceLabels: scope.sidebarLabelsEn,
            sidebarServiceCount: scope.sidebarTagCount,
            quickHelpScopeBroken: scope.quickHelpScopeState!['broken'] as bool,
          ),
          isTrue,
        );
      },
    );

    test('a LEGACY category.general tag names no scope', () {
      final scope = convResolver().resolve(tags: ['category.general']);

      expect(scope.categoryId, isNull);
      expect(scope.sidebarTagCount, 0);
      expect(
        scopeCanGoOnTheWire(
          categoryId: scope.categoryId,
          categoryNameEn: scope.categoryNameEn,
          serviceLabels: scope.serviceLabelsEn,
          sidebarServiceLabels: scope.sidebarLabelsEn,
          sidebarServiceCount: scope.sidebarTagCount,
        ),
        isTrue,
      );
    });

    test(
      'a restored QUICK HELP scope with a DEAD declared label refuses the send',
      () {
        // The button's declared labels are replayed VERBATIM — never
        // dropped, the press path refuses the tap rather than narrowing.
        // The restore is the third entry to the same rule: a label the
        // hierarchy no longer carries must refuse the follow-up too, with
        // the broken state carried so the refusal can NAME what is gone.
        final convButtons3 = <Map<String, dynamic>>[
          {
            'id': 'civil',
            'category': '2',
            'serviceLabels': const <dynamic>['Registration'],
          },
        ];
        final scope = ConversationScopeResolver(
          hierarchy: QuickHelpScopeResolver(convTree),
          quickHelpButtons: convButtons3,
        ).resolve(tags: ['civil']);

        expect(scope.quickHelpButtonId, 'civil');
        // Replayed verbatim: a partial drop is the silent narrowing this
        // rule forbids.
        expect(scope.serviceLabelsEn, ['Registration']);
        expect(scope.quickHelpScopeState!['broken'], isTrue);
        expect(scope.quickHelpScopeState!['missingLabels'], ['Registration']);
        expect(
          scopeCanGoOnTheWire(
            categoryId: scope.categoryId,
            categoryNameEn: scope.categoryNameEn,
            serviceLabels: scope.serviceLabelsEn,
            sidebarServiceLabels: scope.sidebarLabelsEn,
            sidebarServiceCount: scope.sidebarTagCount,
            quickHelpScopeBroken: scope.quickHelpScopeState!['broken'] as bool,
          ),
          isFalse,
        );
      },
    );

    test(
      'a restored QUICK HELP scope with a DEAD category refuses the send',
      () {
        final convButtons4 = <Map<String, dynamic>>[
          {
            'id': 'gone-cat',
            'category': '404',
            'serviceLabels': const <dynamic>[],
          },
        ];
        final scope = ConversationScopeResolver(
          hierarchy: QuickHelpScopeResolver(convTree),
          quickHelpButtons: convButtons4,
        ).resolve(tags: ['gone-cat']);

        expect(scope.quickHelpScopeState!['broken'], isTrue);
        expect(scope.quickHelpScopeState!['categoryMissing'], isTrue);
        expect(
          scopeCanGoOnTheWire(
            categoryId: scope.categoryId,
            categoryNameEn: scope.categoryNameEn,
            serviceLabels: scope.serviceLabelsEn,
            sidebarServiceLabels: scope.sidebarLabelsEn,
            sidebarServiceCount: scope.sidebarTagCount,
            quickHelpScopeBroken: scope.quickHelpScopeState!['broken'] as bool,
          ),
          isFalse,
        );
      },
    );

    test('a dropped tag beside a QUICK HELP tag refuses the send too', () {
      // The conversation was saved with a Quick Help scope AND a sidebar
      // label that was renamed away. The guard must refuse the follow-up
      // in this branch too — not only when there is no Quick Help tag.
      final convButtons2 = <Map<String, dynamic>>[
        {'id': 'btn-x', 'category': '2', 'serviceLabels': const <dynamic>[]},
      ];
      final scope = ConversationScopeResolver(
        hierarchy: QuickHelpScopeResolver(convTree),
        quickHelpButtons: convButtons2,
      ).resolve(tags: ['btn-x', 'Renamed Away']);

      expect(scope.quickHelpButtonId, 'btn-x');
      expect(scope.sidebarLabelsEn, isEmpty);
      expect(scope.sidebarTagCount, 1);
      expect(
        scopeCanGoOnTheWire(
          categoryId: scope.categoryId,
          categoryNameEn: scope.categoryNameEn,
          serviceLabels: scope.serviceLabelsEn,
          sidebarServiceLabels: scope.sidebarLabelsEn,
          sidebarServiceCount: scope.sidebarTagCount,
        ),
        isFalse,
      );
    });

    test('a DROPPED tag refuses the send, not vanishes from it', () {
      // The conversation was saved with two sidebar tags; one was renamed
      // away. The label list carries one, the count remembers two — the
      // send guard then refuses instead of quietly narrowing the scope.
      final scope = convResolver().resolve(
        tags: ['Births', 'Renamed Away'],
        categoryKey: '2',
      );

      expect(scope.serviceLabelsEn, ['Births']);
      expect(scope.sidebarTagCount, 2);
      expect(
        scopeCanGoOnTheWire(
          categoryId: scope.categoryId,
          categoryNameEn: scope.categoryNameEn,
          sidebarServiceLabels: scope.serviceLabelsEn,
          sidebarServiceCount: scope.sidebarTagCount,
        ),
        isFalse,
      );
    });

    test('a tag the hierarchy does not carry is not a filter label', () {
      // An unknown button id (the web's runtime config has a button the
      // mobile's build-time config does not), or a label renamed away:
      // the tag must not reach the wire — it filters on nothing.
      final scope = convResolver().resolve(tags: ['gone', 'Births']);

      expect(scope.serviceLabelsEn, ['Births']);
    });

    test('a conversation with no scope at all resolves to nothing', () {
      final scope = convResolver().resolve();

      expect(scope.categoryId, isNull);
      expect(scope.categoryNameEn, isNull);
      expect(scope.serviceLabelsEn, isEmpty);
      expect(scope.quickHelpButtonId, isNull);
    });
  });

  group('scopeCanGoOnTheWire', () {
    test('a selection that declares NO scope asks an unscoped question', () {
      // The user's own choice: nothing was selected, so nothing is
      // declared and the query goes out as it is.
      expect(scopeCanGoOnTheWire(), isTrue);
    });

    test('an EMPTY category id declares no scope — the chat stays usable', () {
      // The context bar's X clears the selection with an empty id, and the
      // tree panel's empty selection carries one. Reading it as a scope
      // would refuse EVERY question the user asks afterwards.
      expect(scopeCanGoOnTheWire(categoryId: '', categoryNameEn: ''), isTrue);
    });

    test('a scope with an ENGLISH category label goes on the wire', () {
      expect(
        scopeCanGoOnTheWire(categoryId: '2', categoryNameEn: 'Civil Registry'),
        isTrue,
      );
    });

    test('a scope with ENGLISH service labels goes on the wire', () {
      expect(
        scopeCanGoOnTheWire(categoryId: '2', serviceLabels: ['Births']),
        isTrue,
      );
      expect(
        scopeCanGoOnTheWire(categoryId: '2', sidebarServiceLabels: ['Births']),
        isTrue,
      );
    });

    test(
      'a PICKED service with no ENGLISH name is refused — the category does not stand in',
      () {
        // The user picked the SERVICE; without its English name the wire
        // would carry the CATEGORY alone — the query silently narrowing to
        // the whole category while the chip still names the service.
        expect(
          scopeCanGoOnTheWire(
            categoryId: '2',
            categoryNameEn: 'Crops',
            sidebarServiceLabels: const [],
            sidebarServiceCount: 1,
          ),
          isFalse,
        );
        // No partial drop either: one unnamed pick among two refuses.
        expect(
          scopeCanGoOnTheWire(
            categoryId: '2',
            categoryNameEn: 'Crops',
            sidebarServiceLabels: ['Births'],
            sidebarServiceCount: 2,
          ),
          isFalse,
        );
        // A fully named selection goes through.
        expect(
          scopeCanGoOnTheWire(
            categoryId: '2',
            categoryNameEn: 'Crops',
            sidebarServiceLabels: ['Births', 'Deaths'],
            sidebarServiceCount: 2,
          ),
          isTrue,
        );
      },
    );

    test('a scope with no ENGLISH name at all does NOT go on the wire', () {
      // The category has no EN translation: the wire would carry no
      // label, and the query would leave with NO filter — the corpus
      // answering from outside the scope the selection declared.
      expect(scopeCanGoOnTheWire(categoryId: '2', categoryNameEn: ''), isFalse);
      expect(
        scopeCanGoOnTheWire(
          categoryId: '2',
          categoryNameEn: null,
          serviceLabels: const [],
          sidebarServiceLabels: const [],
        ),
        isFalse,
      );
    });
  });

  group('QuickHelpScopeResolver.unavailableScopeFor', () {
    test(
      "'general' names no category — a card stored under it stays usable",
      () {
        // selectQuickHelpOption stores a category-less selection under the
        // 'general' placeholder: the grid treats the raw card (category
        // null) as scope-free, and the send guard treats the STORED item —
        // so the two must agree on 'general' too, or the card looks
        // healthy and is refused at send time.
        final scope = QuickHelpScopeResolver.unavailableScopeFor({
          'id': 'free',
          'category': 'general',
          'serviceLabels': const <dynamic>[],
        });

        expect(scope['broken'], isFalse);
      },
    );

    test('a card that declares no scope stays usable', () {
      // The "just chat" card promises nothing the hierarchy could deny,
      // and the composer must stay reachable when the hierarchy is down.
      final scope = QuickHelpScopeResolver.unavailableScopeFor({
        'id': 'just-chat',
        'category': null,
        'serviceLabels': null,
      });

      expect(scope['broken'], isFalse);
      expect(scope['unavailable'], isFalse);
    });

    test('a card that declares a scope cannot be verified', () {
      final scoped = QuickHelpScopeResolver.unavailableScopeFor({
        'id': 'tax',
        'category': '5',
        'serviceLabels': null,
      });
      final labelled = QuickHelpScopeResolver.unavailableScopeFor({
        'id': 'civil',
        'category': null,
        'serviceLabels': ['Births'],
      });

      expect(scoped['broken'], isTrue);
      expect(scoped['unavailable'], isTrue);
      expect(labelled['broken'], isTrue);
    });
  });

  group('conversationScopeTags', () {
    test('a Quick Help scope travels as the button id, beside the sidebar', () {
      // Both scopes must survive the save: the web writes one tag per
      // item, and dropping the sidebar labels here would lose them on the
      // next restore.
      expect(
        conversationScopeTags(
          quickHelpButtonId: 'civil',
          sidebarServiceLabels: ['Births'],
        ),
        ['civil', 'Births'],
      );
    });

    test('a sidebar scope travels as its ENGLISH labels', () {
      expect(
        conversationScopeTags(sidebarServiceLabels: ['Births', 'Deaths']),
        ['Births', 'Deaths'],
      );
    });

    test('a conversation with no scope carries no tags', () {
      expect(conversationScopeTags(), isEmpty);
    });
  });
}
