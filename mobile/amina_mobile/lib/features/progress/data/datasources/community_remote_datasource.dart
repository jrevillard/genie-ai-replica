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
import '../models/village_scoreboard_model.dart';
import '../../domain/entities/village_scoreboard.dart';

class CommunityRemoteDatasource {
  const CommunityRemoteDatasource(this._dio);

  final Dio _dio;

  Future<VillageScoreboard> getVillageScoreboard(String village) async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/api/v1/community/village',
        queryParameters: {'village': village},
      );
      return VillageScoreboardModel.fromJson(res.data!);
    } on DioException catch (e) {
      final data = e.response?.data;
      final msg  = (data is Map<String, dynamic>)
          ? (data['detail'] as String? ?? data['message'] as String? ?? 'Server error')
          : (e.message ?? 'Network error');
      throw Exception(msg);
    }
  }
}

final communityRemoteDatasourceProvider = Provider<CommunityRemoteDatasource>(
  (ref) => CommunityRemoteDatasource(ref.read(dioProvider)),
);
