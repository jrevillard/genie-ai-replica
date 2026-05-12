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
