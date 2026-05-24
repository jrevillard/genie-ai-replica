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

import '../entities/caregiver_directory_entry.dart';

abstract class CaregiverDirectoryRepository {
  Future<List<CaregiverDirectoryEntry>> listDirectory({
    String? region,
    String? specialty,
  });

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
  });
}
