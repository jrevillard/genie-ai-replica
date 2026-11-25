//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

import 'package:openapi/api.dart';
import 'package:test/test.dart';


/// tests for AgricultureApi
void main() {
  // final instance = AgricultureApi();

  group('tests for AgricultureApi', () {
    // Crop health (NDVI) per El Salvador department
    //
    // Dekadal NDVI with long-term-average baseline, trend and health bucket. Served from cache — never contacts upstream APIs on the request path.
    //
    //Future apiAgriCropHealthGet() async
    test('test apiAgriCropHealthGet', () async {
      // TODO
    });

    // Per-source adapter health
    //
    // Last fetch result, age and latest data date for every enabled source adapter.
    //
    //Future apiAgriHealthGet() async
    test('test apiAgriHealthGet', () async {
      // TODO
    });

    // Market price series for a commodity category
    //
    // Composite series with degradation order, CPI-estimated gap years (dashed in UI), regional-reference labels and structured caveats.
    //
    //Future apiAgriMarketPricesCategoryGet(String category) async
    test('test apiAgriMarketPricesCategoryGet', () async {
      // TODO
    });

    // Recent agriculture news for the prediction dialogs
    //
    // Headline picker feed. scope=global (GDELT, EN/ES) or local (MAG, Presidencia, CoLatino — ES). 48h window widened to 7d when quiet.
    //
    //Future apiAgriNewsGet({ String scope, String lang }) async
    test('test apiAgriNewsGet', () async {
      // TODO
    });

    // Pest advisories, regional news and community sightings
    //
    // Three honest sections — curated seasonal advisories, OIRSA regional plant-health news, iNaturalist community sightings (last 90 days).
    //
    //Future apiAgriPestAlertsGet() async
    test('test apiAgriPestAlertsGet', () async {
      // TODO
    });

  });
}
