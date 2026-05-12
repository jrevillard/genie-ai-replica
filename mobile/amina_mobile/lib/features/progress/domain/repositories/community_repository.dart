import '../entities/village_scoreboard.dart';

abstract class CommunityRepository {
  Future<VillageScoreboard> getVillageScoreboard(String village);
}
