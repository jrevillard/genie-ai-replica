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

import '../../domain/entities/bantaba_circle.dart';

class BantabaMemberModel extends BantabaMember {
  const BantabaMemberModel({
    required super.id,
    required super.name,
    required super.age,
    required super.conditions,
    required super.adherenceWeek,
    required super.adherenceTarget,
    required super.isOwner,
    required super.addedAt,
  });

  factory BantabaMemberModel.fromJson(Map<String, dynamic> j) =>
      BantabaMemberModel(
        id:              j['id']               as String? ?? '',
        name:            j['name']             as String? ?? '',
        age:             (j['age']             as num?)?.toInt() ?? 0,
        conditions:      (j['conditions']      as List<dynamic>?)
                             ?.map((e) => e.toString()).toList() ?? [],
        adherenceWeek:   (j['adherence_week']  as num?)?.toInt() ?? 0,
        adherenceTarget: (j['adherence_target']as num?)?.toInt() ?? 7,
        isOwner:         j['is_owner']         as bool? ?? false,
        addedAt:         j['added_at']         as String? ?? '',
      );
}

class BantabaCircleModel extends BantabaCircle {
  const BantabaCircleModel({
    required super.circleId,
    required super.name,
    required super.ownerId,
    required super.ownerName,
    required super.village,
    required super.streakWeeks,
    required super.thisWeekHighlight,
    required super.members,
  });

  factory BantabaCircleModel.fromJson(Map<String, dynamic> j) =>
      BantabaCircleModel(
        circleId:          j['circle_id']            as String? ?? '',
        name:              j['name']                 as String? ?? '',
        ownerId:           j['owner_id']             as String? ?? '',
        ownerName:         j['owner_name']           as String? ?? '',
        village:           j['village']              as String? ?? '',
        streakWeeks:       (j['streak_weeks']        as num?)?.toInt() ?? 0,
        thisWeekHighlight: j['this_week_highlight']  as String? ?? '',
        members: (j['members'] as List<dynamic>? ?? [])
            .map((e) => BantabaMemberModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
