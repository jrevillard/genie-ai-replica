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
