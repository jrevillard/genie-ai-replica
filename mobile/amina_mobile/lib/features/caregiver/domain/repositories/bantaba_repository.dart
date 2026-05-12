import '../entities/bantaba_circle.dart';

abstract class BantabaRepository {
  Future<BantabaCircle> getMyCircle();
  Future<void> removeMember({required String circleId, required String memberId});
  Future<void> requestAddMemberById({
    required String candidateAminaId,
    required String relation,
  });
}
