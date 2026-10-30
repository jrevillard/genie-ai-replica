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

  // The category a CONFIGURATION names.
  //
  // The configuration writes the category's ENGLISH NAME — the label the
  // hierarchy publishes and the corpus filters on. The database key stays
  // accepted: a configuration written before the change still names a
  // category, and a deployment's configuration is edited on its own.
  // The resolution is asserted at the boundaries that consume it — the
  // grid's verdict (stateFor), the names the user reads, and the id the
  // conversation's edge speaks (categoryIdFor) — never at the internal
  // accessor those boundaries share.
  group('QuickHelpScopeResolver.categoryReference', () {
    test('a category named by its ENGLISH name resolves', () {
      final button = {
        'id': 'civil',
        'serviceLabels': ['Births'],
        'category': 'Civil Registry',
      };

      expect(resolver.stateFor(button)['broken'], isFalse);
      expect(resolver.categoryLabelEn(button), 'Civil Registry');
    });

    test('a category named by its database key still resolves', () {
      final button = {
        'id': 'civil',
        'serviceLabels': ['Births'],
        'category': '2',
      };

      expect(resolver.stateFor(button)['broken'], isFalse);
      expect(resolver.categoryLabelEn(button), 'Civil Registry');
    });

    test('a name the hierarchy does not carry names no category', () {
      final state = resolver.stateFor({'id': 'civil', 'category': 'Taxes'});

      expect(state['broken'], isTrue);
      expect(state['categoryMissing'], isTrue);
      expect(resolver.categoryLabelEn({'category': 'Taxes'}), isNull);
    });

    test('the localized name of a category named by its ENGLISH name', () {
      expect(resolver.categoryDisplayName('Civil Registry'), 'État civil');
    });

    test('the category id a reference speaks is the hierarchy key', () {
      expect(resolver.categoryIdFor('Civil Registry'), '2');
      expect(resolver.categoryIdFor('2'), '2');
    });

    test(
      'a hierarchy key that equals another category NAME resolves the keyed category',
      () {
        // A re-created hierarchy can mint a key that equals another
        // category's name. The key-typed consumers — the conversation's
        // edge, the legacy tags — must keep resolving to the KEYED
        // category: the name interpretation would restore the wrong scope.
        final tree = <dynamic>[
          {
            'catKey': '2024',
            'name': 'The Year Area',
            'nameEN': 'The Year Area',
            'children': <dynamic>[],
          },
          {
            'catKey': '7',
            'name': '2024',
            'nameEN': '2024',
            'children': <dynamic>[],
          },
        ];
        final resolver = QuickHelpScopeResolver(tree);

        expect(resolver.categoryDisplayName('2024'), 'The Year Area');
        expect(resolver.categoryLabelEn({'category': '2024'}), 'The Year Area');
      },
    );

    test('the no-scope placeholder is never reinterpreted', () {
      // 'general' declares NO scope in every rule of the file. A hierarchy
      // category literally named "general" must not hijack a category-less
      // selection into a real scope.
      final tree = <dynamic>[
        {
          'catKey': '2',
          'name': 'Civil Registry',
          'nameEN': 'Civil Registry',
          'children': <dynamic>[],
        },
        {
          'catKey': '9',
          'name': 'General',
          'nameEN': 'general',
          'children': <dynamic>[],
        },
      ];
      final resolver = QuickHelpScopeResolver(tree);

      expect(resolver.categoryIdFor('general'), 'general');
      expect(resolver.categoryIdFor(''), '');
      expect(resolver.categoryIdFor(null), isNull);
    });

    test('a reference the hierarchy cannot name keeps its own spelling', () {
      // The scope is broken — a broken scope sends nothing — but what the
      // configuration wrote is still what the conversation carries.
      expect(resolver.categoryIdFor('Taxes'), 'Taxes');
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

    test('a button that names its category by ENGLISH resolves to the key', () {
      // The configuration names the category; the conversation's edge
      // speaks the hierarchy's own key — the one the backend writes as
      // `serviceCategories/<key>`.
      final scope = convResolver([
        {
          'id': 'civil',
          'category': 'Civil Registry',
          'serviceLabels': ['Births'],
        },
      ]).resolve(tags: ['civil']);

      expect(scope.categoryId, '2');
      expect(scope.categoryNameEn, 'Civil Registry');
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
      'two buttons sharing an id resolve to the FIRST one, like the web',
      () {
        // A configuration error: two cards with the same id. The web keeps
        // the FIRST (the grid's verdict map, and the restore's lookup, are
        // both first-wins), so the mobile must too — otherwise the same
        // saved conversation restores a DIFFERENT scope on the two
        // platforms, which is the drift this work exists to remove.
        final duplicated = <Map<String, dynamic>>[
          {
            'id': 'civil',
            'category': '2',
            'serviceLabels': ['Births'],
          },
          {
            'id': 'civil',
            'category': '2',
            'serviceLabels': ['No Such Service'],
          },
        ];

        final scope = convResolver(
          duplicated,
        ).resolve(tags: ['civil'], categoryKey: '2');

        // The FIRST button's scope: its label survives, the second one's
        // label is not sent.
        expect(scope.serviceLabelsEn, ['Births']);
        expect(scope.quickHelpScopeState!['missingLabels'], isEmpty);
        expect(scope.quickHelpScopeState!['broken'], isFalse);
      },
    );

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

  group('shouldReResolveRestoredScope', () {
    test('a restore with NO tags still owns the re-resolve', () {
      // A conversation saved without a `tags` array restores a
      // category-only scope — the one scope the tree alone names. Keying
      // the re-resolve on the tags (the old guard) froze exactly that
      // scope against the outage's empty tree forever.
      expect(
        shouldReResolveRestoredScope(
          restoredTags: null,
          restoredCategoryKey: '2',
          restoredScopeEpoch: 3,
          scopeEpoch: 3,
          hierarchyReady: true,
        ),
        isTrue,
      );
    });

    test('no restore ever committed — nothing is re-resolved', () {
      expect(
        shouldReResolveRestoredScope(
          restoredTags: const <dynamic>['births'],
          restoredCategoryKey: '2',
          restoredScopeEpoch: null,
          scopeEpoch: 0,
          hierarchyReady: true,
        ),
        isFalse,
      );
    });

    test(
      'a user action since the restore — the saved scope no longer applies',
      () {
        expect(
          shouldReResolveRestoredScope(
            restoredTags: const <dynamic>['births'],
            restoredCategoryKey: '2',
            restoredScopeEpoch: 3,
            scopeEpoch: 4,
            hierarchyReady: true,
          ),
          isFalse,
        );
      },
    );

    test(
      'the hierarchy is still not there — re-resolving would freeze again',
      () {
        expect(
          shouldReResolveRestoredScope(
            restoredTags: const <dynamic>['births'],
            restoredCategoryKey: '2',
            restoredScopeEpoch: 3,
            scopeEpoch: 3,
            hierarchyReady: false,
          ),
          isFalse,
        );
      },
    );

    test(
      'a restore that carried neither tags nor a category has nothing to re-resolve',
      () {
        expect(
          shouldReResolveRestoredScope(
            restoredTags: const <dynamic>[],
            restoredCategoryKey: null,
            restoredScopeEpoch: 3,
            scopeEpoch: 3,
            hierarchyReady: true,
          ),
          isFalse,
        );
      },
    );
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

  /// The id is the button's identity: the loaded list is unique by id, the
  /// FIRST of any duplicate winning, on both platforms.
  group('dedupeQuickHelpButtons', () {
    test('a duplicated id keeps only the FIRST entry', () {
      final first = {
        'id': 'civil',
        'serviceLabels': ['Births'],
      };
      final second = {
        'id': 'civil',
        'serviceLabels': ['No Such Service'],
      };

      final unique = dedupeQuickHelpButtons([first, second]);

      expect(unique, hasLength(1));
      // The FIRST card's scope survives — its labels are the ones a click
      // would put on the wire, and the ones a saved conversation restores.
      expect(unique.single, same(first));
    });

    test('a button with no id is kept as-is', () {
      final idless = {
        'serviceLabels': ['Births'],
      };

      expect(dedupeQuickHelpButtons([idless]), [idless]);
    });

    test('distinct ids are all kept', () {
      final a = {'id': 'a'};
      final b = {'id': 'b'};

      expect(dedupeQuickHelpButtons([a, b]), [a, b]);
    });
  });

  /// A locale switch reloads the buttons with the new locale's titles: the
  /// context bar's title of an ACTIVE Quick Help scope must follow, and it
  /// follows by IDENTITY (the button id), never by the pressed title.
  group('activeQuickHelpTitleFor', () {
    test('returns the reloaded button title for the active id', () {
      // The button was pressed under 'en' ('Births'); the reload carried
      // the 'fr' title. The active scope reads the FRENCH one.
      final buttons = [
        {'id': 'births', 'resolvedTitle': 'Naissances'},
        {'id': 'crops', 'resolvedTitle': 'Cultures'},
      ];

      expect(activeQuickHelpTitleFor(buttons, 'births'), 'Naissances');
    });

    test('a null active id (sidebar scope or none) resolves nothing', () {
      final buttons = [
        {'id': 'births', 'resolvedTitle': 'Naissances'},
        // A card with no id of its own must not adopt a scope-less
        // selection: the null guard is what keeps it from matching.
        {'resolvedTitle': 'Just chat'},
      ];

      expect(activeQuickHelpTitleFor(buttons, null), isNull);
    });

    test('an EMPTY active id declares nothing, like the scope rule', () {
      // declaresCategoryScope treats '' as no identity; the re-title
      // must agree, or a config card with "id": "" would adopt the
      // FIRST such card's title on the next locale switch.
      final buttons = [
        {'id': '', 'resolvedTitle': 'Card A'},
        {'id': '', 'resolvedTitle': 'Card B'},
      ];

      expect(activeQuickHelpTitleFor(buttons, ''), isNull);
    });

    test('an empty resolved title is absent, not a title', () {
      // A config card with no title text must not BLANK the context
      // bar: null lets the caller keep the title it already shows.
      final buttons = [
        {'id': 'births', 'resolvedTitle': ''},
      ];

      expect(activeQuickHelpTitleFor(buttons, 'births'), isNull);
    });

    test('a button the config no longer declares keeps its last title', () {
      // The scope's identity is the id: a gone button must not blank the
      // context bar — null lets the caller keep the title it has.
      final buttons = [
        {'id': 'crops', 'resolvedTitle': 'Cultures'},
      ];

      expect(activeQuickHelpTitleFor(buttons, 'births'), isNull);
    });
  });

  /// A locale drift re-resolves the buttons; the mount's own dependency
  /// change (the first load still in flight) must not.
  group('shouldReloadQuickHelpButtons', () {
    test('a settled locale that is not the live one reloads', () {
      expect(
        shouldReloadQuickHelpButtons(loadedLocale: 'en', currentLocale: 'fr'),
        isTrue,
      );
    });

    test('the locale the buttons already speak does not', () {
      expect(
        shouldReloadQuickHelpButtons(loadedLocale: 'fr', currentLocale: 'fr'),
        isFalse,
      );
    });

    test('a null loaded locale (first load in flight) does not', () {
      // The first load resolves under the locale live at its completion
      // — reloading beside it would be a duplicate parse on every mount.
      expect(
        shouldReloadQuickHelpButtons(loadedLocale: null, currentLocale: 'fr'),
        isFalse,
      );
    });

    test('a failed load marks the locale it failed under', () {
      // The retry is scoped to a LOCALE change — the trigger the pre-fix
      // code used. A keyboard opening (a dependency change under the
      // same locale) must not re-read the asset.
      expect(
        shouldReloadQuickHelpButtons(loadedLocale: 'en', currentLocale: 'en'),
        isFalse,
      );
      expect(
        shouldReloadQuickHelpButtons(loadedLocale: 'en', currentLocale: 'fr'),
        isTrue,
      );
    });
  });

  /// One rule for every path that shows a Quick Help title: an EMPTY
  /// title is no title, so the context bar never blanks.
  group('quickHelpTitleOf', () {
    test('a card title is the title', () {
      expect(
        quickHelpTitleOf({'id': 'births', 'resolvedTitle': 'Naissances'}),
        'Naissances',
      );
    });

    test('an empty title is no title', () {
      expect(quickHelpTitleOf({'id': 'births', 'resolvedTitle': ''}), isNull);
    });

    test('a card without a title has no title', () {
      expect(quickHelpTitleOf({'id': 'births'}), isNull);
      expect(quickHelpTitleOf(null), isNull);
    });
  });

  /// The ONE button-identity lookup — the restore and the locale
  /// re-title must resolve the same entity for the same id.
  group('quickHelpButtonById', () {
    test('finds the button an id names', () {
      final births = {'id': 'births', 'resolvedTitle': 'Births'};
      final crops = {'id': 'crops', 'resolvedTitle': 'Crops'};

      expect(quickHelpButtonById([births, crops], 'crops'), same(crops));
    });

    test('a null or empty id names no button', () {
      final buttons = [
        {'id': 'births', 'resolvedTitle': 'Births'},
      ];

      expect(quickHelpButtonById(buttons, null), isNull);
      expect(quickHelpButtonById(buttons, ''), isNull);
    });

    test('an id no button declares names none', () {
      final buttons = [
        {'id': 'births', 'resolvedTitle': 'Births'},
      ];

      expect(quickHelpButtonById(buttons, 'crops'), isNull);
    });
  });

  /// The config-side parse of a Quick Help button — the shape the shipped
  /// configurations declare: a top-level `title` locale map, a top-level
  /// `icon` object and an optional `action`. The grid card's label and the
  /// card icon are the two reads that drifted to a non-existent
  /// `appearance` block; the parse is where the shipped shape is read.
  ///
  /// One malformed value degrades ONE card (the default asset, an empty
  /// text), never the whole load — the same isolation the web applies
  /// to the same file.
  group('parseQuickHelpButton', () {
    final shippedButton = {
      'id': 'just-chat',
      'title': {'en': 'Just Chat', 'fr': 'Discuter'},
      'icon': {'type': 'file', 'value': '/config/quickhelp/just-chat.svg'},
      'category': null,
    };

    test(
      'a shipped button resolves its title locale map and its icon basename',
      () {
        final parsed = parseQuickHelpButton(shippedButton, 'en');

        expect(parsed['id'], 'just-chat');
        expect(parsed['resolvedTitle'], 'Just Chat');
        expect(parsed['iconAsset'], 'assets/config/quickhelp/just-chat.svg');
      },
    );

    test('a title missing the active locale falls back to English', () {
      final parsed = parseQuickHelpButton({
        ...shippedButton,
        'title': {'en': 'Just Chat'},
      }, 'fr');

      expect(parsed['resolvedTitle'], 'Just Chat');
    });

    test('a button with no icon carries no asset', () {
      final parsed = parseQuickHelpButton({
        ...shippedButton,
        'icon': null,
      }, 'en');

      expect(parsed['iconAsset'], '');
    });

    test('a malformed icon (a bare string) carries no asset', () {
      final parsed = parseQuickHelpButton({
        ...shippedButton,
        'icon': '/config/quickhelp/just-chat.svg',
      }, 'en');

      expect(parsed['iconAsset'], '');
    });

    test('a malformed action (a bare string) carries no action texts', () {
      final parsed = parseQuickHelpButton({
        ...shippedButton,
        'action': 'ask',
      }, 'en');

      expect(parsed['resolvedVisibleText'], '');
      expect(parsed['resolvedHiddenPrompt'], '');
    });

    test('an empty title locale map resolves to no text', () {
      final parsed = parseQuickHelpButton({
        ...shippedButton,
        'title': {},
      }, 'en');

      expect(parsed['resolvedTitle'], '');
    });

    test('a bare-string serviceLabel is wrapped as ONE label', () {
      final parsed = parseQuickHelpButton({
        ...shippedButton,
        'serviceLabels': 'Births',
      }, 'en');

      expect(parsed['serviceLabels'], ['Births']);
    });

    test('the action texts resolve their locale maps', () {
      final parsed = parseQuickHelpButton({
        ...shippedButton,
        'action': {
          'visibleText': {'en': 'Ask about IDs', 'fr': 'Demander une CNI'},
          'hiddenPrompt': {'en': 'prompt-en'},
        },
      }, 'fr');

      expect(parsed['resolvedVisibleText'], 'Demander une CNI');
      expect(parsed['resolvedHiddenPrompt'], 'prompt-en');
    });
  });
}
