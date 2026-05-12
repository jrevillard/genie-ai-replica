import '../../domain/entities/user.dart';

class UserModel extends User {
  const UserModel({
    required super.id,
    required super.email,
    required super.name,
    required super.accessToken,
    required super.sessionId,
    super.age,
    super.gender,
    super.region,
    super.conditions,
  });

  // Expected response shape:
  // { "success": true, "token": "...", "session_id": "...",
  //   "patient": { "patient_id": "...", "email": "...", "name": "...",
  //                "age": 30, "gender": "female", "region": "Banjul",
  //                "conditions": ["diabetes"] } }
  factory UserModel.fromAuthResponse(Map<String, dynamic> json) {
    final patient = json['patient'] as Map<String, dynamic>;
    final id = patient['patient_id'] as String? ?? patient['email'] as String;
    return UserModel(
      id: id,
      email: patient['email'] as String,
      name: patient['name'] as String,
      accessToken: json['token'] as String,
      sessionId: json['session_id'] as String,
      age: patient['age'] as int?,
      gender: patient['gender'] as String?,
      region: patient['region'] as String?,
      conditions: (patient['conditions'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [],
    );
  }
}
