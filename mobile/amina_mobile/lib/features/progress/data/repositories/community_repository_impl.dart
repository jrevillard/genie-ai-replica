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
import '../../domain/entities/village_scoreboard.dart';
import '../../domain/repositories/community_repository.dart';
import '../datasources/community_remote_datasource.dart';

class CommunityRepositoryImpl implements CommunityRepository {
  const CommunityRepositoryImpl(this._remote);

  final CommunityRemoteDatasource _remote;

  @override
  Future<VillageScoreboard> getVillageScoreboard(String village) =>
      _remote.getVillageScoreboard(village);
}

final communityRepositoryProvider = Provider<CommunityRepository>(
  (ref) => CommunityRepositoryImpl(ref.read(communityRemoteDatasourceProvider)),
);
