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
