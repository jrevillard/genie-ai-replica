import 'dart:convert';
import '../../domain/entities/caregiver_directory_entry.dart';

class CaregiverDirectoryModel extends CaregiverDirectoryEntry {
  const CaregiverDirectoryModel({
    required super.id,
    required super.name,
    required super.specialization,
    required super.bio,
    required super.specialtyTags,
    required super.region,
    required super.experienceYears,
    required super.languages,
    required super.acceptingPatients,
  });

  // ArcadeDB stores specialty_tags and languages as JSON-encoded strings,
  // e.g. "[\"antenatal care\", \"child nutrition\"]". This helper handles
  // both a proper List and that encoded-string format.
  static List<String> _parseList(dynamic v) {
    if (v == null) return const [];
    if (v is List) return v.map((e) => e.toString()).toList();
    if (v is String && v.trim().startsWith('[')) {
      try {
        final decoded = jsonDecode(v);
        if (decoded is List) return decoded.map((e) => e.toString()).toList();
      } catch (_) {}
    }
    return const [];
  }

  factory CaregiverDirectoryModel.fromJson(Map<String, dynamic> j) =>
      CaregiverDirectoryModel(
        id:               j['caregiver_id'] as String?
                       ?? j['id']          as String?
                       ?? j['@rid']        as String?
                       ?? '',
        name:             j['name']           as String? ?? '',
        specialization:   j['specialization'] as String? ?? '',
        bio:              j['bio']            as String? ?? '',
        specialtyTags:    _parseList(j['specialty_tags']),
        region:           j['region']         as String? ?? '',
        // DB field is years_experience; fallback keeps old name working too.
        experienceYears:  (j['years_experience'] as num?)?.toInt()
                       ?? (j['experience_years'] as num?)?.toInt()
                       ?? 0,
        languages:        _parseList(j['languages']),
        acceptingPatients: j['accepting_patients'] as bool? ?? true,
      );
}
