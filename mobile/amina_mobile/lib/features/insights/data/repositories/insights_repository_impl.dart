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
