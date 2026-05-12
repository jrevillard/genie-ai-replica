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
