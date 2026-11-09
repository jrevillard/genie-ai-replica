import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/main.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:http/http.dart' as http;

import 'helpers/chatbot_harness.dart';
import 'helpers/test_app.dart';

// MainScreen's own service-selection pass-through: the sidebar tree emits
// a selection payload, `_onServiceSelected` translates it through the
// shared `categoryContextFromSelection` helper into ONE
// `ChatBotComponentState.setCategoryContext` call, and the chat's context
// bar carries the selection. The mapping itself is owned by
// test/utils/service_selection_context_test.dart, and the context bar's
// behaviour after `setCategoryContext` by the chatbot widget tests —
// what NO test owned is main.dart's own call (a swap of its two
// positional arguments — both String — compiles and would stay green
// everywhere else). This file pumps the real MainScreen, drives the real
// tree gesture, and asserts BOTH halves of what lands in the chatbot:
// the rendered context bar for the display name, and the outgoing query
// wire for the EN SSOT the named arguments carry (a dropped
// `categoryNameEn` or `serviceLabelsEn` compiles — both have defaults —
// and would send every query UNSCOPED while the bar still shows a
// scope); the send-guard leg of `serviceCount` is owned by the
// label-less pick whose send must be refused.

/// The REAL bundled configuration with NO Quick Help buttons: the
/// chatbot still loads a config, but the context-bar assertions must not
/// depend on the shipped buttons' labels.
late Uint8List configBytes;

/// The harness tree with a second, label-less service appended: a pick
/// the sidebar count names but the EN labels cannot — the scope the
/// send guard must refuse.
List<dynamic> treeWithLabellessService() =>
    quickHelpTreeFixture()
      ..first['children'].add({'_key': 'svc-2', 'name': 'Mystery'});

/// The base URL pumpMainScreen hands MainScreen, beside the path the
/// capture matches: ONE pair, so a change to either cannot drift past
/// the other.
const streamBaseUrl = 'http://mock';

/// The harness tree client with a CAPTURING streaming endpoint: the
/// bodies of the streaming query POSTs are recorded verbatim and the
/// stream closes immediately — the send completes with an empty answer,
/// which is all the wire assertions need.
class _CapturingStreamClient extends QuickHelpTreeMockClient {
  _CapturingStreamClient(super.tree, this.bodies);

  final List<String> bodies;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.toString() == '$streamBaseUrl/api/queries/stream') {
      bodies.add(utf8.decode((request as http.Request).bodyBytes));
      return http.StreamedResponse(
        http.ByteStream.fromBytes(utf8.encode('')),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    }
    return super.send(request);
  }
}

Future<void> pumpMainScreen(
  WidgetTester tester,
  http.BaseClient mock, {
  http.BaseClient? chatClient,
}) async {
  // The phone surface (the default test viewport is below the 1200px
  // wide-screen threshold): the sidebar lives in the drawer the binder
  // tab opens — the gesture a phone user actually makes.
  mockChatbotConfigAsset(
    tester,
    configBytes,
    extraAssets: {
      // The navbar's branding icon: an unserved asset throws in the test
      // binding instead of degrading.
      GenieAiConfig.iconPath:
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
    },
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: apiOverrides(mock),
      child: testAppShell(
        () => MainScreen(
          user: const {'id': 'user-1'},
          isDarkMode: false,
          toggleTheme: () {},
          onLogout: () {},
          // A non-null client + base URL turn the chat's send path to
          // STREAMING — the production shape — with the requests
          // answering through the test's mock.
          httpClient: chatClient,
          streamBaseUrl: chatClient == null ? null : streamBaseUrl,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Opens the sidebar the way the app offers it: the left-edge swipe
/// (drawerEdgeDragWidth is 40, so the drag starts inside the edge).
Future<void> openSidebar(WidgetTester tester) async {
  await tester.dragFrom(const Offset(20, 300), const Offset(300, 0));
  await tester.pumpAndSettle();
}

/// Taps the service row [index] of the expanded category 2, by the
/// rows' test handles.
Future<void> tapService(WidgetTester tester, int index) async {
  await tester.tap(find.byKey(Key('svc_2_$index')));
  await tester.pumpAndSettle();
}

/// Closes the drawer through its own close affordance: the translucent
/// header strip the component puts above its content — a tap there pops
/// the drawer (the gesture a user makes to get back to the chat).
Future<void> closeDrawer(WidgetTester tester) async {
  await tester.tapAt(const Offset(400, 20));
  await tester.pumpAndSettle();
}

/// Types a question into the composer and sends it the way the suite's
/// send-driving tests do.
Future<void> sendQuestion(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField).first, text);
  await tester.tap(find.byIcon(Icons.send));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    configBytes = await chatbotConfigBytesWithButtons(<Map<String, dynamic>>[]);
  });

  setUp(() {
    resetChatbotTestState();
    ConnectivityService.resetForTesting();
  });

  tearDown(() {
    resetChatbotTestState();
    ConnectivityService.resetForTesting();
  });

  testWidgets('a sidebar tree selection reaches the chatbot context through '
      'MainScreen\'s pass-through', (tester) async {
    await pumpMainScreen(
      tester,
      QuickHelpTreeMockClient(quickHelpTreeFixture()),
    );

    await openSidebar(tester);
    // Expand the category by its handle (a second tap would collapse it
    // — ExpansionTile toggles), then pick its one service.
    await tester.tap(find.byKey(const Key('cat_2')));
    await tester.pumpAndSettle();
    await tapService(tester, 0);

    // The selection's display name landed in the chat's context bar:
    // the call carried the payload's name as the POSITIONAL category
    // name (a swap with the category id would render 'Context: 2').
    expect(find.text('Context: Births'), findsOneWidget);

    // Deselecting passes the clear payload through the same call.
    await tapService(tester, 0);

    expect(find.text('Context: Births'), findsNothing);
  });

  testWidgets('the selection\'s EN scope travels the send wire', (
    tester,
  ) async {
    final bodies = <String>[];
    final mock = _CapturingStreamClient(quickHelpTreeFixture(), bodies);
    await pumpMainScreen(tester, mock, chatClient: mock);

    await openSidebar(tester);
    // Expand the category (a second tap would collapse it), pick Births.
    await tester.tap(find.byKey(const Key('cat_2')));
    await tester.pumpAndSettle();
    await tapService(tester, 0);
    await closeDrawer(tester);
    await sendQuestion(tester, 'tomato question');

    // The named half of the pass-through is ON THE WIRE: the EN SSOT the
    // named arguments carry is what filters the corpus — a dropped
    // `categoryNameEn` or `serviceLabelsEn` sends this query unscoped
    // while the context bar still shows a scope.
    expect(bodies, hasLength(1));
    final body = jsonDecode(bodies.single) as Map<String, dynamic>;
    final context = body['context'] as Map<String, dynamic>;
    expect(context['categoryLabel'], 'Civil Registry');
    expect(context['serviceLabels'], ['Births']);
    expect(body['contextOption'], 'conversation-with-context-labels');
  });

  testWidgets('a pick with no EN label cannot send', (tester) async {
    final bodies = <String>[];
    final mock = _CapturingStreamClient(treeWithLabellessService(), bodies);
    await pumpMainScreen(tester, mock, chatClient: mock);

    await openSidebar(tester);
    // Expand the category, pick the label-less service.
    await tester.tap(find.byKey(const Key('cat_2')));
    await tester.pumpAndSettle();
    await tapService(tester, 1);
    await closeDrawer(tester);
    await sendQuestion(tester, 'mystery question');

    // The count leg of the send guard: the selection picked one service
    // (serviceCount 1) whose labels carry no EN name, and the refusal
    // must keep the question off the wire — a drop of the `serviceCount`
    // argument would empty the count and let this send through.
    expect(bodies, isEmpty);
  });
}
