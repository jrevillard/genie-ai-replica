import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:openapi/api.dart';

import 'package:genie_ai_mobile/components/settings/settings_component.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/notification_service.dart';

import '../helpers/test_app.dart';
import '../helpers/theme_helper.dart';

/// The reset-data confirmation must surface the backend's
/// `filesDeletionFailed` flag: when the uploads directory could not be
/// removed after the committed reset, the user gets a WARNING instead of
/// silence, because files that may contain personal data are still on disk.
/// When the flag is absent (backends without it) or false, the behaviour is
/// unchanged (no notification).
class MockCurrentUserApi implements CurrentUserApi {
  MockCurrentUserApi({this.resetBody = const {}});

  final Map<String, dynamic> resetBody;

  @override
  Future<http.Response> apiMeGetWithHttpInfo({String? data}) async {
    return http.Response(
      jsonEncode({
        'id': 'user-1',
        'name': 'Test User',
        'email': 'test@example.test',
      }),
      200,
    );
  }

  @override
  Future<http.Response> apiMeResetDataPostWithHttpInfo() async {
    return http.Response(jsonEncode(resetBody), 200);
  }

  @override
  Future<http.Response> apiMePutWithHttpInfo({
    String? data,
    List<http.MultipartFile>? files,
  }) async {
    return http.Response(jsonEncode({'ok': true}), 200);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  tearDown(() {
    NotificationService.resetForTesting();
    resetThemeManager();
    I18nService().changeLanguage('en');
  });

  /// Pumps a bounded number of frames instead of pumpAndSettle: this test's
  /// tree never settles in the test environment (the loading spinner's
  /// replacement keeps a frame scheduled on every pump), so pumpAndSettle
  /// never returns. A fixed frame budget still flushes the modal's enter and
  /// leave animations and the reset's microtasks.
  Future<void> pumpFrames(WidgetTester tester, {int frames = 20}) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Future<List<NotificationEvent>> pumpAndReset(
    WidgetTester tester,
    MockCurrentUserApi api,
  ) async {
    final events = <NotificationEvent>[];
    final sub = NotificationService.events.listen(events.add);

    setupLightTokens();
    I18nService().changeLanguage('en');

    await tester.pumpWidget(
      ProviderScope(
        overrides: [currentUserApiProvider.overrideWithValue(api)],
        child: testApp(
          SettingsComponent(
            user: {'name': 'Test User', 'email': 'test@example.test'},
          ),
        ),
      ),
    );
    await pumpFrames(tester);

    final resetTile = find.byKey(const Key('settings_reset_data_button'));
    await tester.ensureVisible(resetTile);
    await pumpFrames(tester);
    await tester.tap(resetTile);
    await pumpFrames(tester);

    await tester.tap(find.widgetWithText(DsButton, 'Reset'));
    await pumpFrames(tester);

    // Unmount so the framework's final tree walk sees no live subtree.
    await tester.pumpWidget(const SizedBox.shrink());
    await pumpFrames(tester);

    // AWAITS sub.cancel() deadlocks this Flutter build's test framework at
    // test completion (idle runner after the body returns); schedule the
    // cancellation without awaiting it — the events are already captured.
    unawaited(sub.cancel());
    return events;
  }

  testWidgets('shows a warning notification when filesDeletionFailed is true', (
    tester,
  ) async {
    final events = await pumpAndReset(
      tester,
      MockCurrentUserApi(resetBody: {'filesDeletionFailed': true}),
    );

    expect(events, hasLength(1));
    expect(events.single.type, NotificationType.warning);
    expect(
      events.single.message,
      I18nService().translate('settings.userDataResetFilesFailed'),
    );
  });

  testWidgets('emits no notification when the flag is absent (older backend)', (
    tester,
  ) async {
    final events = await pumpAndReset(tester, MockCurrentUserApi());

    expect(events, isEmpty);
  });
}
