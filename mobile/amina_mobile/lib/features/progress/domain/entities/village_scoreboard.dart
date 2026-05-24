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

class VillagePillar {
  final String id;
  final String name;
  final int    score;
  final int    max;
  final String detail;

  const VillagePillar({
    required this.id,
    required this.name,
    required this.score,
    required this.max,
    required this.detail,
  });

  double get pct => max > 0 ? score / max : 0;
}

class VillageScoreboard {
  final String  village;
  final String  region;
  final int     score;
  final int     maxScore;
  final int     regionalRank;
  final int     regionalTotal;
  final String  trend; // 'up' | 'flat' | 'down'
  final int     deltaFromLastMonth;
  final List<VillagePillar> pillars;
  final String? leadingVillageName;
  final int?    leadingVillageScore;
  final String  messageToAlkallo;

  const VillageScoreboard({
    required this.village,
    required this.region,
    required this.score,
    required this.maxScore,
    required this.regionalRank,
    required this.regionalTotal,
    required this.trend,
    required this.deltaFromLastMonth,
    required this.pillars,
    this.leadingVillageName,
    this.leadingVillageScore,
    required this.messageToAlkallo,
  });

  double get pct => maxScore > 0 ? score / maxScore : 0;
}
