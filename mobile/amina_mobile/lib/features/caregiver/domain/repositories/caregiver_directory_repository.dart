import '../entities/caregiver_directory_entry.dart';

abstract class CaregiverDirectoryRepository {
  Future<List<CaregiverDirectoryEntry>> listDirectory({
    String? region,
    String? specialty,
  });

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
  });
}
