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
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/dio_client.dart';
import '../models/bantaba_circle_model.dart';
import '../../domain/entities/bantaba_circle.dart';

class BantabaRemoteDatasource {
  const BantabaRemoteDatasource(this._dio);

  final Dio _dio;

  Future<void> requestAddMemberById({
    required String candidateAminaId,
    required String relation,
  }) async {
    try {
      await _dio.post<void>(
        '/api/v1/bantaba/members/request-by-id',
        data: {
          'candidate_amina_id': candidateAminaId,
          'relation':           relation,
          'reason':             '',
        },
      );
      debugPrint('[Bantaba] requestAddMemberById ok: $candidateAminaId');
    } on DioException catch (e) {
      final data = e.response?.data;
      final msg  = (data is Map<String, dynamic>)
          ? (data['detail'] as String? ?? data['message'] as String? ?? 'Server error')
          : (e.message ?? 'Network error');
      debugPrint('[Bantaba] requestAddMemberById error ${e.response?.statusCode}: $msg');
      throw Exception(msg);
    }
  }

  Future<void> removeMember({
    required String circleId,
    required String memberId,
    String role = 'alkalo',
  }) async {
    try {
      await _dio.delete<void>(
        '/api/v1/community/bantaba/members/${Uri.encodeComponent(memberId)}',
        queryParameters: {'circle_id': circleId, 'role': role},
      );
      debugPrint('[Bantaba] removeMember ok: $memberId');
    } on DioException catch (e) {
      final data = e.response?.data;
      final msg  = (data is Map<String, dynamic>)
          ? (data['detail'] as String? ?? data['message'] as String? ?? 'Server error')
          : (e.message ?? 'Network error');
      debugPrint('[Bantaba] removeMember error ${e.response?.statusCode}: $msg');
      throw Exception(msg);
    }
  }

  Future<BantabaCircle> getMyCircle() async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/api/v1/community/bantaba/mine',
      );
      debugPrint('[Bantaba] response: ${res.data}');
      return BantabaCircleModel.fromJson(res.data!);
    } on DioException catch (e) {
      final data = e.response?.data;
      final msg  = (data is Map<String, dynamic>)
          ? (data['detail'] as String? ?? data['message'] as String? ?? 'Server error')
          : (e.message ?? 'Network error');
      debugPrint('[Bantaba] error ${e.response?.statusCode}: $msg');
      throw Exception(msg);
    }
  }
}

final bantabaDatasourceProvider = Provider<BantabaRemoteDatasource>(
  (ref) => BantabaRemoteDatasource(ref.read(dioProvider)),
);
