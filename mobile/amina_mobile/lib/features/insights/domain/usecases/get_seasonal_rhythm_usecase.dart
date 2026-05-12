import '../entities/seasonal_rhythm.dart';
import '../repositories/insights_repository.dart';

class GetSeasonalRhythmUsecase {
  const GetSeasonalRhythmUsecase(this._repository);

  final InsightsRepository _repository;

  Future<SeasonalRhythm> call(String region) =>
      _repository.getSeasonalRhythm(region);
}
