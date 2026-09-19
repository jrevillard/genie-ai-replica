import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/services/location_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _backend = 'https://mewa.test';

MockClient _client({
  String defaultLocation = 'Naogaon',
  String? nearestDistrict = 'Rangpur',
  List<Uri>? seen,
}) {
  return MockClient((request) async {
    seen?.add(request.url);
    if (request.url.path.endsWith('/api/weather/default-location')) {
      return http.Response(
        jsonEncode({'location': defaultLocation, 'lat': 24.8, 'lon': 88.9}),
        200,
      );
    }
    if (request.url.path.endsWith('/api/weather/nearest-district')) {
      return http.Response(
        jsonEncode({'district': nearestDistrict, 'distanceKm': 3.2}),
        200,
      );
    }
    return http.Response('not found', 404);
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    LocationService().resetForTesting();
  });

  test('defaults to Dhaka before init and fills {{location}}', () {
    final svc = LocationService();
    expect(svc.district, 'Dhaka');
    expect(
      svc.fillPlaceholder('Weather in {{location}} for {{location}}?'),
      'Weather in Dhaka for Dhaka?',
    );
    expect(svc.fillPlaceholder(null), isNull);
    expect(svc.fillPlaceholder('no placeholder'), 'no placeholder');
  });

  test('resolves the device district, caches it and notifies', () async {
    final svc = LocationService();
    var notified = 0;
    svc.addListener(() => notified++);
    final seen = <Uri>[];

    await svc.init(
      client: _client(seen: seen),
      backendUrl: _backend,
      positionProvider: () async => (lat: 25.74, lon: 89.27),
    );

    expect(svc.defaultDistrict, 'Naogaon');
    expect(svc.district, 'Rangpur');
    expect(notified, 1);
    final nearest = seen.firstWhere((u) => u.path.endsWith('nearest-district'));
    expect(nearest.queryParameters, {'lat': '25.74', 'lon': '89.27'});
    final cached = jsonDecode(
      (await SharedPreferences.getInstance()).getString(
        LocationService.cacheKey,
      )!,
    );
    expect(cached['district'], 'Rangpur');
    expect(
      svc.fillPlaceholder('Drought in {{location}}'),
      'Drought in Rangpur',
    );
  });

  test(
    'falls back to the deployment default when location is refused',
    () async {
      final svc = LocationService();
      await svc.init(
        client: _client(),
        backendUrl: _backend,
        positionProvider: () async => null,
      );
      expect(svc.district, 'Naogaon');
    },
  );

  test('keeps the default when the point is outside Bangladesh', () async {
    final svc = LocationService();
    await svc.init(
      client: _client(nearestDistrict: null),
      backendUrl: _backend,
      positionProvider: () async => (lat: 48.8, lon: 2.3),
    );
    expect(svc.district, 'Naogaon');
  });

  test('uses a fresh cache without asking for the position', () async {
    SharedPreferences.setMockInitialValues({
      LocationService.cacheKey: jsonEncode({
        'district': 'Bogura',
        'at': DateTime.now().millisecondsSinceEpoch,
      }),
    });
    final svc = LocationService();
    var positionAsked = false;
    await svc.init(
      client: _client(),
      backendUrl: _backend,
      positionProvider: () async {
        positionAsked = true;
        return (lat: 25.74, lon: 89.27);
      },
    );
    expect(svc.district, 'Bogura');
    expect(positionAsked, isFalse);
  });

  test('ignores a stale cache and re-resolves', () async {
    SharedPreferences.setMockInitialValues({
      LocationService.cacheKey: jsonEncode({
        'district': 'Bogura',
        'at': DateTime.now()
            .subtract(const Duration(hours: 25))
            .millisecondsSinceEpoch,
      }),
    });
    final svc = LocationService();
    await svc.init(
      client: _client(),
      backendUrl: _backend,
      positionProvider: () async => (lat: 25.74, lon: 89.27),
    );
    expect(svc.district, 'Rangpur');
  });

  test(
    'ensureReady retries a failed default fetch before a prompt is filled',
    () async {
      final svc = LocationService();
      // First init runs while the gateway is down: everything falls back.
      final failing = MockClient((_) async => throw Exception('502'));
      await svc.init(
        client: failing,
        backendUrl: _backend,
        positionProvider: () async => null,
      );
      expect(svc.district, 'Dhaka');
      expect(
        svc.fillPlaceholder('Fields around {{location}}'),
        'Fields around Dhaka',
      );

      // The chip is tapped once the server is back: the default is re-fetched
      // and the prompt no longer carries the built-in fallback.
      var notified = 0;
      svc.addListener(() => notified++);
      await svc.ensureReady(client: _client(), backendUrl: _backend);
      expect(svc.district, 'Naogaon');
      expect(notified, 1);
      expect(
        svc.fillPlaceholder('Fields around {{location}}'),
        'Fields around Naogaon',
      );

      // Once loaded it is not fetched again.
      final seen = <Uri>[];
      await svc.ensureReady(
        client: _client(seen: seen),
        backendUrl: _backend,
      );
      expect(seen, isEmpty);
    },
  );

  test(
    'ensureReady starts init when nothing ran yet, bounded by the cap',
    () async {
      final svc = LocationService();
      await svc.ensureReady(
        client: _client(),
        backendUrl: _backend,
        cap: const Duration(seconds: 2),
      );
      expect(svc.district, 'Naogaon');
    },
  );

  test('survives a backend outage and is idempotent', () async {
    final svc = LocationService();
    final failing = MockClient((_) async => throw Exception('offline'));
    await svc.init(
      client: failing,
      backendUrl: _backend,
      positionProvider: () async => (lat: 25.74, lon: 89.27),
    );
    expect(svc.district, 'Dhaka');
    expect(svc.isInitialized, isTrue);
    // A second init is a no-op (no re-fetch, no throw).
    await svc.init(client: _client(), backendUrl: _backend);
    expect(svc.district, 'Dhaka');
  });

  test('hasResolvedDistrict is false until a real place is known', () async {
    final svc = LocationService();
    expect(svc.hasResolvedDistrict, isFalse, reason: 'built-in placeholder');

    // Backend down, location refused: still nothing better than the placeholder.
    final failing = MockClient((_) async => throw Exception('offline'));
    await svc.init(
      client: failing,
      backendUrl: _backend,
      positionProvider: () async => null,
    );
    expect(svc.isInitialized, isTrue);
    expect(svc.hasResolvedDistrict, isFalse);

    // The deployment default arriving later (ensureReady retry) resolves it.
    await svc.ensureReady(client: _client(), backendUrl: _backend);
    expect(svc.hasResolvedDistrict, isTrue);
    expect(svc.district, 'Naogaon');
  });

  test(
    'init notifies once when it settles even if the district is unchanged',
    () async {
      final svc = LocationService();
      var notified = 0;
      svc.addListener(() => notified++);
      // Server default equals the built-in placeholder and location is refused:
      // the name never changes, but the banner still needs the "settled" wake-up.
      await svc.init(
        client: _client(defaultLocation: 'Dhaka'),
        backendUrl: _backend,
        positionProvider: () async => null,
      );
      expect(svc.district, 'Dhaka');
      expect(svc.hasResolvedDistrict, isTrue);
      expect(notified, 1);
    },
  );

  test('markReadyForTesting resolves without I/O and notifies', () {
    final svc = LocationService();
    var notified = 0;
    svc.addListener(() => notified++);
    svc.markReadyForTesting(defaultDistrict: 'Sapahar');
    expect(svc.hasResolvedDistrict, isTrue);
    expect(svc.district, 'Sapahar');
    expect(notified, 1);
  });
}
