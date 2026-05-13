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


/// tests for AnalyticsApi
void main() {
  // final instance = AnalyticsApi();

  group('tests for AnalyticsApi', () {
    // Get dashboard analytics
    //
    // Retrieves analytics data for the dashboard within a date range
    //
    //Future<ApiAnalyticsDashboardGet200Response> apiAnalyticsDashboardGet({ DateTime startDate, DateTime endDate, String locale }) async
    test('test apiAnalyticsDashboardGet', () async {
      // TODO
    });

    // Get events records
    //
    // Retrieves event records with pagination
    //
    //Future<List<Event>> apiAnalyticsEventsGet({ int limit, int offset }) async
    test('test apiAnalyticsEventsGet', () async {
      // TODO
    });

    // Track an event
    //
    // Records a user event for analytics
    //
    //Future<Event> apiAnalyticsEventsPost(ApiAnalyticsEventsPostRequest apiAnalyticsEventsPostRequest) async
    test('test apiAnalyticsEventsPost', () async {
      // TODO
    });

    // Get general analytics
    //
    // Retrieves general analytics data with optional filters and date range
    //
    //Future<ApiAnalyticsGet200Response> apiAnalyticsGet({ DateTime startDate, DateTime endDate, String filters, String locale }) async
    test('test apiAnalyticsGet', () async {
      // TODO
    });

    // Get specific metric data
    //
    // Retrieves data for a specific analytics metric
    //
    //Future<ApiAnalyticsMetricMetricGet200Response> apiAnalyticsMetricMetricGet(String metric, DateTime startDate, DateTime endDate) async
    test('test apiAnalyticsMetricMetricGet', () async {
      // TODO
    });

    // Get analytics records
    //
    // Retrieves analytics records with pagination
    //
    //Future<List<Analytics>> apiAnalyticsRecordsGet({ int limit, int offset }) async
    test('test apiAnalyticsRecordsGet', () async {
      // TODO
    });

    // Get satisfaction gauge data
    //
    // Retrieves satisfaction percentage data for the gauge visualization
    //
    //Future<ApiAnalyticsSatisfactionGaugeGet200Response> apiAnalyticsSatisfactionGaugeGet({ DateTime startDate, DateTime endDate, String locale }) async
    test('test apiAnalyticsSatisfactionGaugeGet', () async {
      // TODO
    });

    // Get satisfaction heatmap data
    //
    // Retrieves satisfaction percentage data by knowledge area over time
    //
    //Future<List<ApiAnalyticsSatisfactionHeatmapGet200ResponseInner>> apiAnalyticsSatisfactionHeatmapGet({ DateTime startDate, DateTime endDate, String locale }) async
    test('test apiAnalyticsSatisfactionHeatmapGet', () async {
      // TODO
    });

    // Get time series data
    //
    // Retrieves time series data for a specific metric, interval, and date range
    //
    //Future<List<ApiAnalyticsTimeseriesMetricTypeGet200ResponseInner>> apiAnalyticsTimeseriesMetricTypeGet(String metricType, { String interval, DateTime startDate, DateTime endDate }) async
    test('test apiAnalyticsTimeseriesMetricTypeGet', () async {
      // TODO
    });

  });
}
