import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/caregiver_directory_entry.dart';
import '../../domain/repositories/caregiver_directory_repository.dart';
import '../datasources/caregiver_directory_datasource.dart';

class CaregiverDirectoryRepositoryImpl implements CaregiverDirectoryRepository {
  const CaregiverDirectoryRepositoryImpl(this._datasource);

  final CaregiverDirectoryDatasource _datasource;

  @override
  Future<List<CaregiverDirectoryEntry>> listDirectory({
    String? region,
    String? specialty,
  }) =>
      _datasource.listDirectory(region: region, specialty: specialty);

  @override
  Future<String> applyToCaregiver({
    required String caregiverId,
    required String primaryConcern,
    required List<String> healthConditions,
    required List<String> currentMedications,
    required String preferredContact,
    required String emergencyContactName,
    required String emergencyContactPhone,
    required String additionalNotes,
    required String patientFullName,
    required int    patientAge,
    required String patientGender,
    required String patientRegion,
  }) =>
      _datasource.applyToCaregiver(
        caregiverId:            caregiverId,
        primaryConcern:         primaryConcern,
        healthConditions:       healthConditions,
        currentMedications:     currentMedications,
        preferredContact:       preferredContact,
        emergencyContactName:   emergencyContactName,
        emergencyContactPhone:  emergencyContactPhone,
        additionalNotes:        additionalNotes,
        patientFullName:        patientFullName,
        patientAge:             patientAge,
        patientGender:          patientGender,
        patientRegion:          patientRegion,
      );
}

final caregiverDirectoryRepositoryProvider = Provider<CaregiverDirectoryRepository>(
  (ref) => CaregiverDirectoryRepositoryImpl(
    ref.read(caregiverDirectoryDatasourceProvider),
  ),
);
