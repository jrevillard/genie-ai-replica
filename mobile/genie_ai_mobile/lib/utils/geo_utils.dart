import 'dart:ui';

/// A GeoJSON overlay rendered on the map screen (mirrors the web MapView
/// `geojsonLayers` items).
class GeoLayer {
  final String id;
  final Map<String, dynamic> geojson;
  final Color fillColor;
  final Color lineColor;
  final double fillOpacity;
  final String label;

  const GeoLayer({
    required this.id,
    required this.geojson,
    required this.fillColor,
    required this.lineColor,
    required this.fillOpacity,
    required this.label,
  });

  List<dynamic> get features =>
      (geojson['features'] as List<dynamic>?) ?? const [];
}

/// Bounding box `[minLon, minLat, maxLon, maxLat]` of every coordinate in
/// [features], or null when there is none.
List<double>? computeGeojsonBbox(List<dynamic> features) {
  double minLng = double.infinity,
      minLat = double.infinity,
      maxLng = double.negativeInfinity,
      maxLat = double.negativeInfinity;

  void visit(dynamic coords) {
    if (coords is! List || coords.isEmpty) return;
    if (coords[0] is num) {
      final lng = (coords[0] as num).toDouble();
      final lat = (coords[1] as num).toDouble();
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (final c in coords) {
        visit(c);
      }
    }
  }

  for (final f in features) {
    if (f is Map) visit((f['geometry'] as Map?)?['coordinates']);
  }
  return minLng.isFinite ? [minLng, minLat, maxLng, maxLat] : null;
}

/// Layers for the map overlay when a response's metadata carries
/// field-delineation or flood-analysis GeoJSON (weather-mcp-service via
/// geo-inference-worker). Same rules and colours as the web
/// `openMapFromMetadata`. Empty when there is nothing to draw.
List<GeoLayer> geoLayersFromMetadata(Map<String, dynamic>? metadata) {
  if (metadata == null) return const [];
  final layers = <GeoLayer>[];

  final fd = metadata['field_delineation'];
  final fieldsGeojson = fd is Map ? fd['fields_geojson'] : null;
  if (fieldsGeojson is Map &&
      (fieldsGeojson['features'] as List?)?.isNotEmpty == true) {
    final count =
        fd!['field_count'] ?? (fieldsGeojson['features'] as List).length;
    layers.add(
      GeoLayer(
        id: 'field-boundaries',
        geojson: Map<String, dynamic>.from(fieldsGeojson),
        fillColor: const Color(0xFF22C55E),
        lineColor: const Color(0xFF16A34A),
        fillOpacity: 0.4,
        label: 'Field boundaries ($count)',
      ),
    );
  }

  final fa = metadata['flood_analysis'];
  final floodGeojson = fa is Map ? fa['flood_geojson'] : null;
  if (floodGeojson is Map &&
      (floodGeojson['features'] as List?)?.isNotEmpty == true) {
    layers.add(
      GeoLayer(
        id: 'flood-areas',
        geojson: Map<String, dynamic>.from(floodGeojson),
        fillColor: const Color(0xFF3B82F6),
        lineColor: const Color(0xFF1D4ED8),
        fillOpacity: 0.5,
        label: 'Flood extent',
      ),
    );
  }
  return layers;
}

/// `show me the map <place>` intent (English, Banglish, Bengali) — returns the
/// place or null. Same patterns as the web `sendMessage` map intercept.
String? parseMapIntent(String content) {
  final text = content.trim();
  final leading = RegExp(
    r'^(?:show me the map|manchitro dekhao|মানচিত্র দেখা[ওন])\s+(.+)$',
    caseSensitive: false,
  ).firstMatch(text);
  if (leading != null) return leading.group(1)!.trim();
  final trailing = RegExp(
    r'^(.+?)\s*(?:এর)?\s*মানচিত্র\s*দেখা[ওন]$',
  ).firstMatch(text);
  return trailing?.group(1)?.trim();
}
