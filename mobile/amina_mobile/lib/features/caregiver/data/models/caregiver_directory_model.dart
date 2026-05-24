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
