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
