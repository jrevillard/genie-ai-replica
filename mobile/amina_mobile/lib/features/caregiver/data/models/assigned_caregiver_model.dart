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
