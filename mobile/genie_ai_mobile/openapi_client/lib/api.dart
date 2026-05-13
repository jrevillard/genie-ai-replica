//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

library openapi.api;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:collection/collection.dart';
import 'package:http/http.dart';
import 'package:intl/intl.dart';
import 'package:meta/meta.dart';

part 'api_client.dart';
part 'api_helper.dart';
part 'api_exception.dart';
part 'auth/authentication.dart';
part 'auth/api_key_auth.dart';
part 'auth/oauth.dart';
part 'auth/http_basic_auth.dart';
part 'auth/http_bearer_auth.dart';

part 'api/admin_api.dart';
part 'api/analytics_api.dart';
part 'api/authentication_api.dart';
part 'api/chat_history_api.dart';
part 'api/current_user_api.dart';
part 'api/database_operations_api.dart';
part 'api/logger_api.dart';
part 'api/queries_api.dart';
part 'api/service_categories_api.dart';
part 'api/services_api.dart';
part 'api/translation_api.dart';
part 'api/weather_api.dart';

part 'model/analytics.dart';
part 'model/api_analytics_dashboard_get200_response.dart';
part 'model/api_analytics_dashboard_get200_response_categories_inner.dart';
part 'model/api_analytics_dashboard_get200_response_feedback.dart';
part 'model/api_analytics_dashboard_get200_response_queries.dart';
part 'model/api_analytics_dashboard_get200_response_top_queries_inner.dart';
part 'model/api_analytics_dashboard_get200_response_users.dart';
part 'model/api_analytics_events_post_request.dart';
part 'model/api_analytics_get200_response.dart';
part 'model/api_analytics_metric_metric_get200_response.dart';
part 'model/api_analytics_satisfaction_gauge_get200_response.dart';
part 'model/api_analytics_satisfaction_gauge_get200_response_historical_data_inner.dart';
part 'model/api_analytics_satisfaction_heatmap_get200_response_inner.dart';
part 'model/api_analytics_satisfaction_heatmap_get200_response_inner_data_inner.dart';
part 'model/api_analytics_timeseries_metric_type_get200_response_inner.dart';
part 'model/api_chat_conversations_conversation_id_messages_post_request.dart';
part 'model/api_chat_conversations_conversation_id_messages_read_post_request.dart';
part 'model/api_chat_conversations_conversation_id_move_post_request.dart';
part 'model/api_chat_conversations_conversation_id_patch_request.dart';
part 'model/api_chat_conversations_post_request.dart';
part 'model/api_chat_folders_folder_id_patch_request.dart';
part 'model/api_chat_folders_post_request.dart';
part 'model/api_chat_folders_reorder_post_request.dart';
part 'model/api_chat_folders_reorder_post_request_folder_orders_inner.dart';
part 'model/api_chat_query_query_id_conversation_post_request.dart';
part 'model/api_database_backup_post200_response.dart';
part 'model/api_database_optimize_post200_response.dart';
part 'model/api_database_optimize_post200_response_results_inner.dart';
part 'model/api_logger_configure_post200_response.dart';
part 'model/api_logger_configure_post400_response.dart';
part 'model/api_logger_configure_post500_response.dart';
part 'model/api_logger_configure_post_request.dart';
part 'model/api_logger_rollover_post200_response.dart';
part 'model/api_logger_rollover_post500_response.dart';
part 'model/api_queries_get200_response.dart';
part 'model/api_queries_get200_response_pagination.dart';
part 'model/api_queries_get200_response_queries_inner.dart';
part 'model/api_queries_post_request.dart';
part 'model/api_queries_post_request_context.dart';
part 'model/api_queries_post_request_messages_inner.dart';
part 'model/api_queries_query_id_answered_patch200_response.dart';
part 'model/api_queries_query_id_conversation_post201_response.dart';
part 'model/api_queries_query_id_feedback_post200_response.dart';
part 'model/api_queries_query_id_feedback_post200_response_feedback.dart';
part 'model/api_queries_query_id_feedback_post_request.dart';
part 'model/api_queries_query_id_link_message_id_post_request.dart';
part 'model/api_queries_query_id_responsetime_patch200_response.dart';
part 'model/api_queries_query_id_responsetime_patch_request.dart';
part 'model/api_service_categories_categories_get200_response_inner.dart';
part 'model/api_service_categories_category_id_translations_get200_response_inner.dart';
part 'model/api_service_categories_init_post200_response.dart';
part 'model/api_service_categories_post_request.dart';
part 'model/api_service_categories_search_get200_response.dart';
part 'model/api_service_categories_search_get200_response_categories_inner.dart';
part 'model/api_service_categories_search_get200_response_services_inner.dart';
part 'model/api_services_categories_get200_response_inner.dart';
part 'model/api_services_categories_get200_response_inner_services_inner.dart';
part 'model/api_services_search_get200_response.dart';
part 'model/api_services_search_get200_response_categories_inner.dart';
part 'model/api_services_search_get200_response_services_inner.dart';
part 'model/api_translate_markdown_post200_response.dart';
part 'model/api_translate_markdown_post_request.dart';
part 'model/api_translate_post200_response.dart';
part 'model/api_translate_post_request.dart';
part 'model/api_weather_post200_response.dart';
part 'model/api_weather_post200_response_current.dart';
part 'model/api_weather_post200_response_forecast_inner.dart';
part 'model/api_weather_post_request.dart';
part 'model/event.dart';
part 'model/user.dart';


/// An [ApiClient] instance that uses the default values obtained from
/// the OpenAPI specification file.
var defaultApiClient = ApiClient();

const _delimiters = {'csv': ',', 'ssv': ' ', 'tsv': '\t', 'pipes': '|'};
const _dateEpochMarker = 'epoch';
const _deepEquality = DeepCollectionEquality();
final _dateFormatter = DateFormat('yyyy-MM-dd');
final _regList = RegExp(r'^List<(.*)>$');
final _regSet = RegExp(r'^Set<(.*)>$');
final _regMap = RegExp(r'^Map<String,(.*)>$');

bool _isEpochMarker(String? pattern) => pattern == _dateEpochMarker || pattern == '/$_dateEpochMarker/';
