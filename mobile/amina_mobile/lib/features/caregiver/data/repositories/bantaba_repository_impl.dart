import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/bantaba_circle.dart';
import '../../domain/repositories/bantaba_repository.dart';
import '../datasources/bantaba_remote_datasource.dart';

class BantabaRepositoryImpl implements BantabaRepository {
  const BantabaRepositoryImpl(this._remote);

  final BantabaRemoteDatasource _remote;

  @override
  Future<BantabaCircle> getMyCircle() => _remote.getMyCircle();

  @override
  Future<void> removeMember({required String circleId, required String memberId}) =>
      _remote.removeMember(circleId: circleId, memberId: memberId);

  @override
  Future<void> requestAddMemberById({
    required String candidateAminaId,
    required String relation,
  }) =>
      _remote.requestAddMemberById(
        candidateAminaId: candidateAminaId,
        relation:         relation,
      );
}

final bantabaRepositoryProvider = Provider<BantabaRepository>(
  (ref) => BantabaRepositoryImpl(ref.read(bantabaDatasourceProvider)),
);
