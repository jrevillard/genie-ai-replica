import '../../domain/entities/seasonal_rhythm.dart';

class SeasonalRhythmModel {
  final Map<String, dynamic> season;
  final String         date;
  final TipEntry       featuredTip;
  final List<TipEntry> allTips;
  final bool           isRamadan;
  final List<TipEntry> ramadanTips;
  final String         month;

  const SeasonalRhythmModel({
    required this.season,
    required this.date,
    required this.featuredTip,
    required this.allTips,
    required this.isRamadan,
    required this.ramadanTips,
    required this.month,
  });

  factory SeasonalRhythmModel.fromJson(Map<String, dynamic> json) {
    final rawTips =
        (json['all_tips'] ?? json['tips']) as List<dynamic>? ?? [];

    final rawSeason = json['season'];
    final Map<String, dynamic> season = rawSeason is Map<String, dynamic>
        ? rawSeason
        : {'id': rawSeason?.toString() ?? 'cool_dry'};

    return SeasonalRhythmModel(
      season:      season,
      date:        json['date'] as String? ?? '',
      featuredTip: _extractTip(json['featured_tip']),
      allTips:     rawTips.map(_extractTip).toList(),
      isRamadan:   json['is_ramadan'] as bool? ?? false,
      ramadanTips: (json['ramadan_tips'] as List<dynamic>? ?? [])
          .map(_extractTip)
          .toList(),
      month: json['month'] as String? ?? '',
    );
  }

  // Tip may arrive as a plain string or as {"icon": "…", "tip"/"text": "…"}.
  static TipEntry _extractTip(dynamic item) {
    if (item == null) return const TipEntry(icon: '', text: '');
    if (item is String) return TipEntry(icon: '', text: item);
    if (item is Map<String, dynamic>) {
      final icon = item['icon'] as String? ?? '';
      final text = item['text'] as String? ??
          item['tip'] as String? ??
          item['title'] as String? ??
          '';
      return TipEntry(icon: icon, text: text);
    }
    return TipEntry(icon: '', text: item.toString());
  }

  SeasonalRhythm toSeasonalRhythm() => SeasonalRhythm(
        season: SeasonSummary(
          id: season['id'] as String? ?? 'cool_dry',
          name: season['name'] as String? ??
              season['label'] as String? ??
              season['season_label'] as String? ??
              'Health Tip',
        ),
        date:        date,
        featuredTip: featuredTip,
        allTips:     allTips,
        isRamadan:   isRamadan,
        ramadanTips: ramadanTips,
        month:       month,
      );
}
