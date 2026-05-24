// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

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
