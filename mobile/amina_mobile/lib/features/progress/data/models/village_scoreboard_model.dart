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

import '../../domain/entities/village_scoreboard.dart';

class VillagePillarModel extends VillagePillar {
  const VillagePillarModel({
    required super.id,
    required super.name,
    required super.score,
    required super.max,
    required super.detail,
  });

  factory VillagePillarModel.fromJson(Map<String, dynamic> json) =>
      VillagePillarModel(
        id:     json['id']     as String? ?? '',
        name:   json['name']   as String? ?? '',
        score:  (json['score'] as num?)?.toInt() ?? 0,
        max:    (json['max']   as num?)?.toInt() ?? 20,
        detail: json['detail'] as String? ?? '',
      );
}

class VillageScoreboardModel extends VillageScoreboard {
  const VillageScoreboardModel({
    required super.village,
    required super.region,
    required super.score,
    required super.maxScore,
    required super.regionalRank,
    required super.regionalTotal,
    required super.trend,
    required super.deltaFromLastMonth,
    required super.pillars,
    super.leadingVillageName,
    super.leadingVillageScore,
    required super.messageToAlkallo,
  });

  factory VillageScoreboardModel.fromJson(Map<String, dynamic> json) {
    final leading     = json['leading_village'] as Map<String, dynamic>?;
    final pillarsJson = (json['pillars'] as List<dynamic>?) ?? [];

    return VillageScoreboardModel(
      village:            json['village']                as String? ?? '',
      region:             json['region']                 as String? ?? '',
      score:              (json['score']                 as num?)?.toInt() ?? 0,
      maxScore:           (json['max_score']             as num?)?.toInt() ?? 100,
      regionalRank:       (json['regional_rank']         as num?)?.toInt() ?? 0,
      regionalTotal:      (json['regional_total']        as num?)?.toInt() ?? 0,
      trend:              json['trend']                  as String? ?? 'flat',
      deltaFromLastMonth: (json['delta_from_last_month'] as num?)?.toInt() ?? 0,
      pillars:            pillarsJson
          .map((e) => VillagePillarModel.fromJson(e as Map<String, dynamic>))
          .toList(),
      leadingVillageName:  leading?['name']  as String?,
      leadingVillageScore: (leading?['score'] as num?)?.toInt(),
      messageToAlkallo:    json['message_to_alkallo'] as String? ?? '',
    );
  }
}
