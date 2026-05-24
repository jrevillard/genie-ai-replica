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
import '../models/assigned_caregiver_model.dart';
import '../../domain/entities/assigned_caregiver.dart';

class CaregiverListDatasource {
  const CaregiverListDatasource(this._dio);

  final Dio _dio;

  Future<List<AssignedCaregiver>> listCaregivers() async {
    try {
      final res = await _dio.get<Map<String, dynamic>>('/api/v1/caregiver/list');
      debugPrint('[Caregiver] list: ${res.data}');
      final list = res.data!['caregivers'] as List<dynamic>? ?? [];
      return list
          .map((e) => AssignedCaregiverModel.fromJson(e as Map<String, dynamic>))
          .where((c) => !c.isRevoked)
          .toList();
    } on DioException catch (e) {
      final data   = e.response?.data;
      final detail = data is Map<String, dynamic> ? data['detail'] : null;
      final msg    = detail is String
          ? detail
          : (detail is List && detail.isNotEmpty)
              ? (detail.first is Map
                  ? (detail.first as Map)['msg']?.toString() ?? 'Validation error'
                  : detail.first.toString())
              : (e.message ?? 'Network error');
      debugPrint('[Caregiver] list error ${e.response?.statusCode}: $msg');
      throw Exception(msg);
    }
  }
}

final caregiverListDatasourceProvider = Provider<CaregiverListDatasource>(
  (ref) => CaregiverListDatasource(ref.read(dioProvider)),
);
