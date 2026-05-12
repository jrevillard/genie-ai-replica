// Pure Dart — no Flutter imports.

class TipEntry {
  final String icon;
  final String text;

  const TipEntry({required this.icon, required this.text});
}

class SeasonSummary {
  final String id;
  final String name;

  const SeasonSummary({required this.id, required this.name});
}

class SeasonalRhythm {
  final SeasonSummary  season;
  final String         date;
  final TipEntry       featuredTip;
  final List<TipEntry> allTips;
  final bool           isRamadan;
  final List<TipEntry> ramadanTips;
  final String         month;

  const SeasonalRhythm({
    required this.season,
    required this.date,
    required this.featuredTip,
    required this.allTips,
    required this.isRamadan,
    required this.ramadanTips,
    required this.month,
  });
}
