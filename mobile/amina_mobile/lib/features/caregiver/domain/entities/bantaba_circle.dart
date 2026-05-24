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

class BantabaMember {
  final String       id;
  final String       name;
  final int          age;
  final List<String> conditions;
  final int          adherenceWeek;
  final int          adherenceTarget;
  final bool         isOwner;
  final String       addedAt;

  const BantabaMember({
    required this.id,
    required this.name,
    required this.age,
    required this.conditions,
    required this.adherenceWeek,
    required this.adherenceTarget,
    required this.isOwner,
    required this.addedAt,
  });
}

class BantabaCircle {
  final String             circleId;
  final String             name;
  final String             ownerId;
  final String             ownerName;
  final String             village;
  final int                streakWeeks;
  final String             thisWeekHighlight;
  final List<BantabaMember> members;

  const BantabaCircle({
    required this.circleId,
    required this.name,
    required this.ownerId,
    required this.ownerName,
    required this.village,
    required this.streakWeeks,
    required this.thisWeekHighlight,
    required this.members,
  });

  /// Non-owner members = family/caregivers connected to the circle.
  List<BantabaMember> get familyMembers =>
      members.where((m) => !m.isOwner).toList();

  /// First 6 alphanumeric chars of circleId, uppercased — used as share code.
  String get shareCode {
    final clean = circleId.replaceAll(RegExp(r'[^A-Za-z0-9]'), '').toUpperCase();
    final padded = clean.padRight(6, '0');
    return padded.substring(0, 6);
  }
}
