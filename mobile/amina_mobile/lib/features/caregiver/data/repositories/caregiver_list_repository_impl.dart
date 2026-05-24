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
import '../../domain/entities/assigned_caregiver.dart';
import '../../domain/repositories/caregiver_list_repository.dart';
import '../datasources/caregiver_list_datasource.dart';

class CaregiverListRepositoryImpl implements CaregiverListRepository {
  const CaregiverListRepositoryImpl(this._datasource);

  final CaregiverListDatasource _datasource;

  @override
  Future<List<AssignedCaregiver>> listCaregivers() =>
      _datasource.listCaregivers();
}

final caregiverListRepositoryProvider = Provider<CaregiverListRepository>(
  (ref) => CaregiverListRepositoryImpl(ref.read(caregiverListDatasourceProvider)),
);
