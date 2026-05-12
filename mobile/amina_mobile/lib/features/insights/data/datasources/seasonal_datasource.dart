import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/dio_client.dart';
import '../models/seasonal_rhythm_model.dart';

class SeasonalDatasource {
  SeasonalDatasource(this._dio);

  final Dio _dio;

  Future<SeasonalRhythmModel> getSeasonalRhythm(String region) async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/api/v1/community/seasonal',
        queryParameters: {'region': region},
      );
      return SeasonalRhythmModel.fromJson(res.data!);
    } on DioException catch (e) {
      throw Exception(
          'Seasonal rhythm error: ${e.response?.statusCode ?? e.message}');
    }
  }
}

final seasonalDatasourceProvider = Provider<SeasonalDatasource>(
  (ref) => SeasonalDatasource(ref.read(dioProvider)),
);
