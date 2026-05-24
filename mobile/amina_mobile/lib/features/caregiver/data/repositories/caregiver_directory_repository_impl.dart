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

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/caregiver_directory_entry.dart';
import '../../domain/repositories/caregiver_directory_repository.dart';
import '../datasources/caregiver_directory_datasource.dart';

class CaregiverDirectoryRepositoryImpl implements CaregiverDirectoryRepository {
  const CaregiverDirectoryRepositoryImpl(this._datasource);

  final CaregiverDirectoryDatasource _datasource;

  @override
  Future<List<CaregiverDirectoryEntry>> listDirectory({
    String? region,
    String? specialty,
  }) =>
      _datasource.listDirectory(region: region, specialty: specialty);

  @override
  Future<String> applyToCaregiver({
    required String caregiverId,
    required String primaryConcern,
    required List<String> healthConditions,
    required List<String> currentMedications,
    required String preferredContact,
    required String emergencyContactName,
    required String emergencyContactPhone,
    required String additionalNotes,
    required String patientFullName,
    required int    patientAge,
    required String patientGender,
    required String patientRegion,
  }) =>
      _datasource.applyToCaregiver(
        caregiverId:            caregiverId,
        primaryConcern:         primaryConcern,
        healthConditions:       healthConditions,
        currentMedications:     currentMedications,
        preferredContact:       preferredContact,
        emergencyContactName:   emergencyContactName,
        emergencyContactPhone:  emergencyContactPhone,
        additionalNotes:        additionalNotes,
        patientFullName:        patientFullName,
        patientAge:             patientAge,
        patientGender:          patientGender,
        patientRegion:          patientRegion,
      );
}

final caregiverDirectoryRepositoryProvider = Provider<CaregiverDirectoryRepository>(
  (ref) => CaregiverDirectoryRepositoryImpl(
    ref.read(caregiverDirectoryDatasourceProvider),
  ),
);
