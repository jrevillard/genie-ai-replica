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
