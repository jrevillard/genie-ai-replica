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

class CaregiverDirectoryEntry {
  final String       id;
  final String       name;
  final String       specialization;
  final String       bio;
  final List<String> specialtyTags;
  final String       region;
  final int          experienceYears;
  final List<String> languages;
  final bool         acceptingPatients;

  const CaregiverDirectoryEntry({
    required this.id,
    required this.name,
    required this.specialization,
    required this.bio,
    required this.specialtyTags,
    required this.region,
    required this.experienceYears,
    required this.languages,
    required this.acceptingPatients,
  });
}
