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
