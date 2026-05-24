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
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/repositories/community_repository_impl.dart';
import '../../domain/entities/village_scoreboard.dart';

final villageScoreboardProvider = FutureProvider<VillageScoreboard>((ref) async {
  // Frame-0 compositing safety (same pattern as progressDataProvider).
  await Future<void>.delayed(Duration.zero);

  final village = ref.watch(authProvider).user?.region ?? 'Kerewan';
  return ref.read(communityRepositoryProvider).getVillageScoreboard(village);
});
