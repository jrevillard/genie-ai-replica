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

class User {
  final String id;
  final String email;
  final String name;
  final String accessToken;
  final String sessionId;
  final int? age;
  final String? gender;
  final String? region;
  final List<String> conditions;

  const User({
    required this.id,
    required this.email,
    required this.name,
    required this.accessToken,
    required this.sessionId,
    this.age,
    this.gender,
    this.region,
    this.conditions = const [],
  });

  bool get isProfileComplete =>
      age != null && gender != null && region != null;

  User copyWith({
    String? id,
    String? email,
    String? name,
    String? accessToken,
    String? sessionId,
    int? age,
    String? gender,
    String? region,
    List<String>? conditions,
  }) =>
      User(
        id: id ?? this.id,
        email: email ?? this.email,
        name: name ?? this.name,
        accessToken: accessToken ?? this.accessToken,
        sessionId: sessionId ?? this.sessionId,
        age: age ?? this.age,
        gender: gender ?? this.gender,
        region: region ?? this.region,
        conditions: conditions ?? this.conditions,
      );
}
