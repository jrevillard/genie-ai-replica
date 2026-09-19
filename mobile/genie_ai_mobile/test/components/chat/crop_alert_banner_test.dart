import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/chat/crop_alert_banner.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/location_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../helpers/test_app.dart';
import '../../helpers/theme_helper.dart';

const _backend = 'https://mewa.test';

Map<String, dynamic> _risk(int tier, {String? report, String? crop}) => {
  'tier': tier,
  'tier_label': const [
    'Normal',
    'Advisory',
    'Warning',
    'Severe',
    'Emergency',
  ][tier],
  'message': 'risk message tier $tier${crop != null ? ' $crop' : ''}',
  'triggers': ['soil moisture'],
  'location': 'Dhaka',
  'report_filename': report ?? '',
  'crop': ?crop,
};

/// The crop-risk endpoint carries one entry per watched crop (`crops`), with
/// the first crop mirrored at the top level for older clients.
Map<String, dynamic> _cropRisk(int eggplant, int riceAman) => {
  ..._risk(eggplant, crop: 'eggplant'),
  'crops': [
    _risk(eggplant, crop: 'eggplant'),
    _risk(riceAman, crop: 'rice_aman'),
  ],
};

MockClient _client({
  int eggplant = 0,
  int riceAman = 0,
  int drought = 0,
  int flood = 0,
  List<Map<String, dynamic>> notices = const [],
  List<Uri>? seen,
}) {
  return MockClient((request) async {
    seen?.add(request.url);
    final p = request.url.path;
    Object? body;
    if (p.endsWith('/weather/potato-risk')) {
      body = _cropRisk(eggplant, riceAman);
    }
    if (p.endsWith('/weather/drought-risk')) {
      body = _risk(drought, report: 'drought_dhaka.pdf');
    }
    if (p.endsWith('/weather/flood-risk')) body = _risk(flood);
    if (p.endsWith('/notifications/latest')) body = {'notices': notices};
    if (body == null) return http.Response('not found', 404);
    return http.Response.bytes(
      utf8.encode(jsonEncode(body)),
      200,
      headers: const {'content-type': 'application/json; charset=utf-8'},
    );
  });
}

Widget _banner(http.Client client) => testApp(
  Column(
    children: [CropAlertBanner(client: client, backendUrl: _backend)],
  ),
);

void main() {
  setUp(() {
    setupLightTokens();
    I18nService().changeLanguage('en');
    SharedPreferences.setMockInitialValues({});
    LocationService().resetForTesting();
    // The banner holds its first poll until the location is known; these
    // tests are about rendering, so start resolved (deployment default).
    LocationService().markReadyForTesting();
  });
  tearDown(() {
    resetThemeManager();
    I18nService().changeLanguage('en');
  });

  testWidgets('does not poll until the location is resolved', (tester) async {
    // Fresh install: no cached district, deployment default not yet fetched.
    LocationService().resetForTesting();
    final seen = <Uri>[];
    await tester.pumpWidget(_banner(_client(drought: 3, seen: seen)));
    await tester.pump();
    await tester.pump();

    expect(seen, isEmpty, reason: 'no request while district is a placeholder');
    expect(find.byKey(const Key('crop_alert_stack')), findsNothing);

    // Resolution settles (LocationService notifies) -> first poll, for the
    // resolved district, not the built-in Dhaka fallback.
    LocationService().markReadyForTesting(defaultDistrict: 'Sapahar');
    await tester.pump();
    await tester.pump();

    expect(seen, isNotEmpty);
    expect(
      seen.every(
        (u) =>
            u.queryParameters['location'] == 'Sapahar' ||
            u.queryParameters['district'] == 'Sapahar',
      ),
      isTrue,
    );
    expect(find.byKey(const Key('crop_alert_drought')), findsOneWidget);
  });

  testWidgets('renders nothing when every risk is below Warning', (
    tester,
  ) async {
    await tester.pumpWidget(_banner(_client(eggplant: 1, riceAman: 1)));
    await tester.pump();
    expect(find.byKey(const Key('crop_alert_stack')), findsNothing);
  });

  testWidgets('one card per active alert, worst first, with report link', (
    tester,
  ) async {
    final seen = <Uri>[];
    await tester.pumpWidget(
      _banner(
        _client(eggplant: 2, riceAman: 1, drought: 3, flood: 2, seen: seen),
      ),
    );
    await tester.pump();

    // Drought (3) > eggplant (2) = flood (2); rice aman (1) is below Warning.
    expect(find.byKey(const Key('crop_alert_drought')), findsOneWidget);
    expect(find.byKey(const Key('crop_alert_crop:eggplant')), findsOneWidget);
    expect(find.byKey(const Key('crop_alert_flood')), findsOneWidget);
    expect(find.byKey(const Key('crop_alert_crop:rice_aman')), findsNothing);
    expect(find.textContaining('Drought'), findsOneWidget);
    expect(find.textContaining('Eggplant'), findsOneWidget);
    expect(find.text('View drought report'), findsOneWidget);

    final droughtY = tester
        .getTopLeft(find.byKey(const Key('crop_alert_drought')))
        .dy;
    final cropY = tester
        .getTopLeft(find.byKey(const Key('crop_alert_crop:eggplant')))
        .dy;
    expect(droughtY < cropY, isTrue, reason: 'worst alert renders first');

    // Every poll targets the resolved district in the UI language.
    final risk = seen.firstWhere((u) => u.path.endsWith('drought-risk'));
    expect(risk.queryParameters, {'location': 'Dhaka', 'lang': 'en'});
    final notices = seen.firstWhere((u) => u.path.endsWith('latest'));
    expect(notices.queryParameters['district'], 'Dhaka');
    expect(notices.queryParameters['hours'], '48');
  });

  testWidgets('crop labels come from i18n with a prettified fallback', (
    tester,
  ) async {
    await tester.pumpWidget(_banner(_client(eggplant: 2, riceAman: 2)));
    await tester.pump();
    expect(find.textContaining('Eggplant'), findsOneWidget);
    expect(find.textContaining('Aman Rice'), findsOneWidget);

    I18nService().changeLanguage('bn');
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('বেগুন'), findsOneWidget);
    expect(find.textContaining('আমন ধান'), findsOneWidget);
  });

  testWidgets('dismissal is per crop and persisted for 12 h', (tester) async {
    await tester.pumpWidget(_banner(_client(eggplant: 3, riceAman: 2)));
    await tester.pump();
    expect(find.byKey(const Key('crop_alert_crop:eggplant')), findsOneWidget);
    expect(find.byKey(const Key('crop_alert_crop:rice_aman')), findsOneWidget);

    await tester.tap(
      find.byKey(const Key("[<'crop_alert_crop:eggplant'>]_dismiss")),
    );
    await tester.pump();
    expect(find.byKey(const Key('crop_alert_crop:eggplant')), findsNothing);
    expect(find.byKey(const Key('crop_alert_crop:rice_aman')), findsOneWidget);

    final prefs = await SharedPreferences.getInstance();
    final until = prefs.getInt('eggplant_alert_dismissed_until');
    expect(until, isNotNull);
    expect(until! > DateTime.now().millisecondsSinceEpoch, isTrue);
    expect(prefs.getInt('rice_aman_alert_dismissed_until'), isNull);
  });

  testWidgets('a flood alert dismisses independently', (tester) async {
    await tester.pumpWidget(_banner(_client(flood: 3)));
    await tester.pump();
    expect(find.byKey(const Key('crop_alert_flood')), findsOneWidget);

    await tester.tap(find.byTooltip('Dismiss'));
    await tester.pump();
    expect(find.byKey(const Key('crop_alert_flood')), findsNothing);
    final until = (await SharedPreferences.getInstance()).getInt(
      'flood_alert_dismissed_until',
    );
    expect(until, isNotNull);
  });

  testWidgets('shows notice cards, hides engine alerts, uses Bengali text', (
    tester,
  ) async {
    final notices = [
      {
        'id': 'n1',
        'title': 'Signal 3',
        'body': 'Maritime warning',
        'title_bn': 'সংকেত ৩',
        'body_bn': 'সামুদ্রিক সতর্কতা',
        'type': 'bmd_warning',
        'districts': ['Chittagong'],
      },
      {
        'id': 'n2',
        'title': 'Engine flood alert',
        'body': 'should not be a card',
        'type': 'flood_ews',
        'districts': [],
      },
      {
        'id': 'n3',
        'title': 'Admin message',
        'body': 'Everyone',
        'type': 'general',
        'districts': [],
      },
    ];
    await tester.pumpWidget(_banner(_client(notices: notices)));
    await tester.pump();

    expect(find.byKey(const Key('notice_n1')), findsOneWidget);
    expect(find.byKey(const Key('notice_n2')), findsNothing);
    expect(find.byKey(const Key('notice_n3')), findsOneWidget);
    expect(find.textContaining('Chittagong'), findsOneWidget);
    expect(find.textContaining('All areas'), findsOneWidget);

    I18nService().changeLanguage('bn');
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('সংকেত ৩'), findsOneWidget);
    expect(find.text('সামুদ্রিক সতর্কতা'), findsOneWidget);

    // Dismissing a notice removes it and persists the id.
    I18nService().changeLanguage('en');
    await tester.pump();
    await tester.pump();
    await tester.tap(find.byKey(const Key("[<'notice_n3'>]_dismiss")));
    await tester.pump();
    expect(find.byKey(const Key('notice_n3')), findsNothing);
    expect(find.byKey(const Key('notice_n1')), findsOneWidget);
    final dismissed = (await SharedPreferences.getInstance()).getStringList(
      'mewa_notices_dismissed',
    );
    expect(dismissed, ['n3']);
  });
}
