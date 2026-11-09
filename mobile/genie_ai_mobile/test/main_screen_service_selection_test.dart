import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/main.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';
import 'package:genie_ai_mobile/services/genie_ai_config.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import 'helpers/chatbot_harness.dart';

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
// tree gesture, and asserts what lands in the chatbot.

/// The REAL bundled configuration with NO Quick Help buttons: the
/// chatbot still loads a config, but the context-bar assertions must not
/// depend on the shipped buttons' labels.
late Uint8List configBytes;

Future<void> pumpMainScreen(WidgetTester tester, http.BaseClient mock) async {
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
      overrides: [
        serviceCategoriesApiProvider.overrideWithValue(
          ServiceCategoriesApi(ApiClient()..client = mock),
        ),
        chatHistoryApiProvider.overrideWithValue(
          ChatHistoryApi(ApiClient()..client = mock),
        ),
      ],
      child: testAppShell(
        () => MainScreen(
          user: const {'id': 'user-1'},
          isDarkMode: false,
          toggleTheme: () {},
          onLogout: () {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Expands the category by its test handle (a second tap would collapse
/// it — ExpansionTile toggles).
Future<void> expandCategory(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('cat_2')));
  await tester.pumpAndSettle();
}

/// Taps the service row [index] inside the expanded category, by the
/// rows' test handles.
Future<void> tapService(WidgetTester tester, int index) async {
  await tester.tap(find.byKey(Key('svc_2_$index')));
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

    // Open the sidebar the way the app offers it: the left-edge swipe
    // (drawerEdgeDragWidth is 40, so the drag starts inside the edge).
    await tester.dragFrom(const Offset(20, 300), const Offset(300, 0));
    await tester.pumpAndSettle();

    await expandCategory(tester);
    await tapService(tester, 0);

    // The row's ink follows its rounded decoration: the tile carries the
    // shape the InkWell paints its highlight through (the structural
    // half of the ink behaviour — the visible result itself is a device
    // check, outside what a widget test can see).
    expect(
      tester.widget<ListTile>(find.byKey(const Key('svc_2_0'))).shape,
      RoundedRectangleBorder(borderRadius: BorderRadius.circular(DsRadii.md)),
    );

    // The selection's display name landed in the chat's context bar:
    // the call carried the payload's name as the POSITIONAL category
    // name (a swap with the category id would render 'Context: 2').
    expect(find.text('Context: Births'), findsOneWidget);

    // Deselecting passes the clear payload through the same call.
    await tapService(tester, 0);

    expect(find.text('Context: Births'), findsNothing);
  });
}
