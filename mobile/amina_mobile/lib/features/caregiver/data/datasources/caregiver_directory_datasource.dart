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
import '../models/caregiver_directory_model.dart';
import '../../domain/entities/caregiver_directory_entry.dart';

// Safely extracts a human-readable message from a DioException response body.
// Handles both plain-string `detail` and Pydantic's List-of-errors format.
String _extractMsg(DioException e) {
  final data = e.response?.data;
  if (data is Map<String, dynamic>) {
    final detail = data['detail'];
    if (detail is String) return detail;
    if (detail is List && detail.isNotEmpty) {
      final first = detail.first;
      if (first is Map) {
        return first['msg']?.toString() ?? 'Validation error';
      }
      return first.toString();
    }
    final msg = data['message'];
    if (msg is String) return msg;
  }
  return e.message ?? 'Network error';
}

class CaregiverDirectoryDatasource {
  const CaregiverDirectoryDatasource(this._dio);

  final Dio _dio;

  Future<List<CaregiverDirectoryEntry>> listDirectory({
    String? region,
    String? specialty,
  }) async {
    try {
      final params = <String, String>{};
      if (region    != null && region.isNotEmpty)    params['region']    = region;
      if (specialty != null && specialty.isNotEmpty) params['specialty'] = specialty;

      final res = await _dio.get<Map<String, dynamic>>(
        '/api/v1/cg-apply/directory',
        queryParameters: params.isEmpty ? null : params,
      );
      debugPrint('[CaregiverDirectory] list: ${res.data}');
      final list = res.data!['caregivers'] as List<dynamic>? ?? [];
      return list
          .map((e) => CaregiverDirectoryModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      final msg = _extractMsg(e);
      debugPrint('[CaregiverDirectory] list error ${e.response?.statusCode}: $msg');
      throw Exception(msg);
    }
  }

  Future<String> applyToCaregiver({
    required String       caregiverId,
    required String       primaryConcern,
    required List<String> healthConditions,
    required List<String> currentMedications,
    required String       preferredContact,
    required String       emergencyContactName,
    required String       emergencyContactPhone,
    required String       additionalNotes,
    required String       patientFullName,
    required int          patientAge,
    required String       patientGender,
    required String       patientRegion,
  }) async {
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/v1/cg-apply/apply',
        data: {
          'caregiver_id':            caregiverId,
          'primary_concern':         primaryConcern,
          'health_conditions':       healthConditions,
          'current_medications':     currentMedications,
          'preferred_contact':       preferredContact,
          'emergency_contact_name':  emergencyContactName,
          'emergency_contact_phone': emergencyContactPhone,
          'additional_notes':        additionalNotes,
          'patient_full_name':       patientFullName,
          'patient_age':             patientAge == 0 ? null : patientAge,
          'patient_gender':          patientGender.isEmpty ? null : patientGender,
          'patient_region':          patientRegion.isEmpty ? null : patientRegion,
          'patient_phone':           null,
        },
      );
      debugPrint('[CaregiverDirectory] apply ok appId=${res.data!['app_id']}');
      return res.data!['app_id'] as String? ?? '';
    } on DioException catch (e) {
      final msg = _extractMsg(e);
      debugPrint('[CaregiverDirectory] apply error ${e.response?.statusCode}: $msg | caregiver_id=$caregiverId');
      throw Exception(msg);
    }
  }
}

final caregiverDirectoryDatasourceProvider = Provider<CaregiverDirectoryDatasource>(
  (ref) => CaregiverDirectoryDatasource(ref.read(dioProvider)),
);
