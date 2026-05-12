import '../entities/seasonal_rhythm.dart';

abstract class InsightsRepository {
  Future<SeasonalRhythm> getSeasonalRhythm(String region);
}
