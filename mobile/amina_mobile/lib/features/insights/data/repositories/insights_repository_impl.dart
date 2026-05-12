import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/seasonal_rhythm.dart';
import '../../domain/repositories/insights_repository.dart';
import '../datasources/seasonal_datasource.dart';

class InsightsRepositoryImpl implements InsightsRepository {
  const InsightsRepositoryImpl(this._datasource);

  final SeasonalDatasource _datasource;

  @override
  Future<SeasonalRhythm> getSeasonalRhythm(String region) async {
    final model = await _datasource.getSeasonalRhythm(region);
    return model.toSeasonalRhythm();
  }
}

final insightsRepositoryProvider = Provider<InsightsRepository>(
  (ref) => InsightsRepositoryImpl(ref.read(seasonalDatasourceProvider)),
);
