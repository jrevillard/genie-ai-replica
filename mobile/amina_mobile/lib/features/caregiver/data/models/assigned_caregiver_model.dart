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

import '../../domain/entities/assigned_caregiver.dart';

class AssignedCaregiverModel extends AssignedCaregiver {
  const AssignedCaregiverModel({
    required super.id,
    required super.name,
    required super.phone,
    super.relationship,
    super.permissions,
    super.consentDate,
    super.isRevoked,
    super.note,
  });

  factory AssignedCaregiverModel.fromJson(Map<String, dynamic> j) =>
      AssignedCaregiverModel(
        id:           j['caregiver_id'] as String? ?? '',
        name:         j['name']         as String? ?? '',
        phone:        j['phone']        as String? ?? '',
        relationship: j['relationship'] as String?,
        permissions:  (j['permissions'] as List<dynamic>?)
                          ?.map((e) => e.toString()).toList() ??
                      const [],
        consentDate:  j['consent_date'] as String?,
        isRevoked:    j['is_revoked']   as bool? ?? false,
        note:         j['note']         as String? ?? '',
      );
}
