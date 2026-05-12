import '../entities/assigned_caregiver.dart';

abstract class CaregiverListRepository {
  Future<List<AssignedCaregiver>> listCaregivers();
}
