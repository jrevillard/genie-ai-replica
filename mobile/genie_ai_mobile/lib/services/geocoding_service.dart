import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

class GeocodedPlace {
  final String query;
  final String displayName;
  final LatLng point;

  const GeocodedPlace({
    required this.query,
    required this.displayName,
    required this.point,
  });

  Map<String, dynamic> toJson() => {
    'query': query,
    'displayName': displayName,
    'lat': point.latitude,
    'lng': point.longitude,
  };

  static GeocodedPlace? fromJson(dynamic value) {
    if (value is! Map) return null;
    final lat = _parseDouble(value['lat']);
    final lng = _parseDouble(value['lng']);
    if (lat == null || lng == null) return null;

    return GeocodedPlace(
      query:
          value['query']?.toString() ?? value['displayName']?.toString() ?? '',
      displayName:
          value['displayName']?.toString() ??
          value['query']?.toString() ??
          'Selected location',
      point: LatLng(lat, lng),
    );
  }

  static double? _parseDouble(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '');
  }
}

class GeocodingService {
  static const _endpoint = 'https://nominatim.openstreetmap.org/search';

  Future<GeocodedPlace?> search(String query) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return null;

    final uri = Uri.parse(_endpoint).replace(
      queryParameters: {
        'q': trimmed,
        'format': 'jsonv2',
        'limit': '1',
        'addressdetails': '1',
      },
    );

    final response = await http.get(
      uri,
      headers: const {
        'User-Agent': 'AgroGenieBangladeshMobile/1.0',
        'Accept': 'application/json',
      },
    );

    if (response.statusCode != 200) return null;

    final decoded = jsonDecode(response.body);
    if (decoded is! List || decoded.isEmpty || decoded.first is! Map) {
      return null;
    }

    final first = decoded.first as Map;
    final lat = double.tryParse(first['lat']?.toString() ?? '');
    final lng = double.tryParse(first['lon']?.toString() ?? '');
    if (lat == null || lng == null) return null;

    return GeocodedPlace(
      query: trimmed,
      displayName: first['display_name']?.toString() ?? trimmed,
      point: LatLng(lat, lng),
    );
  }
}
