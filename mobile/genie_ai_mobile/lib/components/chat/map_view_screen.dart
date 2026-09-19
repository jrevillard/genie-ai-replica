import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/geo_utils.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// Full-screen map for the climate features (parity with the web MapView):
/// a marker at the requested place plus GeoJSON overlays for field
/// boundaries / flood extent. Satellite imagery by default (field boundaries
/// are meaningless on a street map), with a street-map toggle.
class MapViewScreen extends StatefulWidget {
  final double lat;
  final double lon;
  final String name;
  final double zoom;
  final List<GeoLayer> layers;

  const MapViewScreen({
    super.key,
    required this.lat,
    required this.lon,
    this.name = '',
    this.zoom = 12,
    this.layers = const [],
  });

  /// Push the map for a geocoded place or GeoJSON layers.
  static Future<void> open(
    BuildContext context, {
    required double lat,
    required double lon,
    String name = '',
    double zoom = 12,
    List<GeoLayer> layers = const [],
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => MapViewScreen(
          lat: lat,
          lon: lon,
          name: name,
          zoom: zoom,
          layers: layers,
        ),
      ),
    );
  }

  @override
  State<MapViewScreen> createState() => _MapViewScreenState();
}

class _MapViewScreenState extends State<MapViewScreen> {
  static const _satelliteTiles =
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  static const _streetTiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  // Tile providers stop at these levels ("Map data not yet available" tiles
  // beyond them); past the native level flutter_map upscales the last real
  // tiles instead of requesting empty ones.
  static const double _satelliteNativeZoom = 18;
  static const double _streetNativeZoom = 19;
  static const double _maxZoom = 21;

  bool _satellite = true;

  List<Polygon> _polygons() {
    final polygons = <Polygon>[];
    for (final layer in widget.layers) {
      for (final feature in layer.features) {
        final geometry = (feature as Map?)?['geometry'] as Map?;
        if (geometry == null) continue;
        final type = geometry['type']?.toString();
        final coords = geometry['coordinates'];
        final rings = <List<dynamic>>[];
        if (type == 'Polygon' && coords is List) {
          rings.add(coords);
        } else if (type == 'MultiPolygon' && coords is List) {
          rings.addAll(coords.whereType<List<dynamic>>());
        }
        for (final polygon in rings) {
          if (polygon.isEmpty) continue;
          final outer = _toPoints(polygon.first);
          if (outer.length < 3) continue;
          polygons.add(
            Polygon(
              points: outer,
              holePointsList: polygon.skip(1).map(_toPoints).toList(),
              color: layer.fillColor.withValues(alpha: layer.fillOpacity),
              borderColor: layer.lineColor,
              borderStrokeWidth: 2,
            ),
          );
        }
      }
    }
    return polygons;
  }

  static List<LatLng> _toPoints(dynamic ring) => (ring as List)
      .whereType<List>()
      .where((c) => c.length >= 2 && c[0] is num && c[1] is num)
      .map((c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()))
      .toList();

  MapOptions _options() {
    final center = LatLng(widget.lat, widget.lon);
    final features = widget.layers.expand((l) => l.features).toList();
    final bbox = computeGeojsonBbox(features);
    if (bbox != null && (bbox[2] > bbox[0] || bbox[3] > bbox[1])) {
      return MapOptions(
        initialCenter: center,
        initialZoom: widget.zoom,
        maxZoom: _maxZoom,
        initialCameraFit: CameraFit.bounds(
          bounds: LatLngBounds(
            LatLng(bbox[1], bbox[0]),
            LatLng(bbox[3], bbox[2]),
          ),
          padding: const EdgeInsets.all(DsSpacing.xl),
        ),
      );
    }
    return MapOptions(
      initialCenter: center,
      initialZoom: widget.zoom,
      maxZoom: _maxZoom,
    );
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: tokens.navbarBg,
        foregroundColor: tokens.navbarFg,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: tr('map.backToChat'),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          widget.name.isNotEmpty ? widget.name : tr('map.title'),
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          IconButton(
            icon: Icon(_satellite ? Icons.map_outlined : Icons.satellite_alt),
            tooltip: _satellite ? tr('map.streets') : tr('map.satellite'),
            onPressed: () => setState(() => _satellite = !_satellite),
          ),
        ],
      ),
      body: Stack(
        children: [
          FlutterMap(
            options: _options(),
            children: [
              TileLayer(
                urlTemplate: _satellite ? _satelliteTiles : _streetTiles,
                userAgentPackageName: 'com.example.genie_ai_mobile',
                maxNativeZoom:
                    (_satellite ? _satelliteNativeZoom : _streetNativeZoom)
                        .toInt(),
                maxZoom: _maxZoom,
              ),
              if (widget.layers.isNotEmpty) PolygonLayer(polygons: _polygons()),
              MarkerLayer(
                markers: [
                  Marker(
                    point: LatLng(widget.lat, widget.lon),
                    width: 36,
                    height: 36,
                    alignment: Alignment.topCenter,
                    child: Icon(
                      Icons.location_on,
                      color: tokens.danger,
                      size: 36,
                    ),
                  ),
                ],
              ),
              RichAttributionWidget(
                attributions: [
                  TextSourceAttribution(
                    _satellite
                        ? 'Esri, Maxar, Earthstar Geographics'
                        : 'OpenStreetMap contributors',
                  ),
                ],
              ),
            ],
          ),
          if (widget.layers.isNotEmpty)
            Positioned(
              left: DsSpacing.md,
              bottom: DsSpacing.lg,
              child: Container(
                padding: const EdgeInsets.all(DsSpacing.sm),
                decoration: BoxDecoration(
                  color: tokens.surface.withValues(alpha: 0.92),
                  borderRadius: BorderRadius.circular(DsRadii.md),
                  border: Border.all(color: tokens.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final layer in widget.layers)
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: DsSpacing.xs / 2,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 14,
                              height: 14,
                              decoration: BoxDecoration(
                                color: layer.fillColor.withValues(
                                  alpha: layer.fillOpacity,
                                ),
                                border: Border.all(color: layer.lineColor),
                                borderRadius: BorderRadius.circular(DsRadii.sm),
                              ),
                            ),
                            const SizedBox(width: DsSpacing.sm),
                            Text(
                              layer.label,
                              style: TextStyle(
                                color: tokens.fg,
                                fontSize: tokens.textSm,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
