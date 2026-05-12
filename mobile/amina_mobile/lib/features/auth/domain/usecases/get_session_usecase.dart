import '../entities/session_status.dart';
import '../repositories/auth_repository.dart';

class GetSessionUsecase {
  const GetSessionUsecase(this._repository);

  final AuthRepository _repository;

  Future<SessionStatus> call() => _repository.getSession();
}
