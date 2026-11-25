//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgricultureApi {
  AgricultureApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Crop health (NDVI) per El Salvador department
  ///
  /// Dekadal NDVI with long-term-average baseline, trend and health bucket. Served from cache — never contacts upstream APIs on the request path.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAgriCropHealthGetWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/agri/crop-health';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Crop health (NDVI) per El Salvador department
  ///
  /// Dekadal NDVI with long-term-average baseline, trend and health bucket. Served from cache — never contacts upstream APIs on the request path.
  Future<void> apiAgriCropHealthGet() async {
    final response = await apiAgriCropHealthGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Per-source adapter health
  ///
  /// Last fetch result, age and latest data date for every enabled source adapter.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAgriHealthGetWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/agri/health';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Per-source adapter health
  ///
  /// Last fetch result, age and latest data date for every enabled source adapter.
  Future<void> apiAgriHealthGet() async {
    final response = await apiAgriHealthGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Market price series for a commodity category
  ///
  /// Composite series with degradation order, CPI-estimated gap years (dashed in UI), regional-reference labels and structured caveats.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] category (required):
  Future<Response> apiAgriMarketPricesCategoryGetWithHttpInfo(String category,) async {
    // ignore: prefer_const_declarations
    final path = r'/api/agri/market-prices/{category}'
      .replaceAll('{category}', category);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Market price series for a commodity category
  ///
  /// Composite series with degradation order, CPI-estimated gap years (dashed in UI), regional-reference labels and structured caveats.
  ///
  /// Parameters:
  ///
  /// * [String] category (required):
  Future<void> apiAgriMarketPricesCategoryGet(String category,) async {
    final response = await apiAgriMarketPricesCategoryGetWithHttpInfo(category,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Recent agriculture news for the prediction dialogs
  ///
  /// Headline picker feed. scope=global (GDELT, EN/ES) or local (MAG, Presidencia, CoLatino — ES). 48h window widened to 7d when quiet.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] scope:
  ///
  /// * [String] lang:
  Future<Response> apiAgriNewsGetWithHttpInfo({ String? scope, String? lang, }) async {
    // ignore: prefer_const_declarations
    final path = r'/api/agri/news';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (scope != null) {
      queryParams.addAll(_queryParams('', 'scope', scope));
    }
    if (lang != null) {
      queryParams.addAll(_queryParams('', 'lang', lang));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Recent agriculture news for the prediction dialogs
  ///
  /// Headline picker feed. scope=global (GDELT, EN/ES) or local (MAG, Presidencia, CoLatino — ES). 48h window widened to 7d when quiet.
  ///
  /// Parameters:
  ///
  /// * [String] scope:
  ///
  /// * [String] lang:
  Future<void> apiAgriNewsGet({ String? scope, String? lang, }) async {
    final response = await apiAgriNewsGetWithHttpInfo( scope: scope, lang: lang, );
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Pest advisories, regional news and community sightings
  ///
  /// Three honest sections — curated seasonal advisories, OIRSA regional plant-health news, iNaturalist community sightings (last 90 days).
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> apiAgriPestAlertsGetWithHttpInfo() async {
    // ignore: prefer_const_declarations
    final path = r'/api/agri/pest-alerts';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
    );
  }

  /// Pest advisories, regional news and community sightings
  ///
  /// Three honest sections — curated seasonal advisories, OIRSA regional plant-health news, iNaturalist community sightings (last 90 days).
  Future<void> apiAgriPestAlertsGet() async {
    final response = await apiAgriPestAlertsGetWithHttpInfo();
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
