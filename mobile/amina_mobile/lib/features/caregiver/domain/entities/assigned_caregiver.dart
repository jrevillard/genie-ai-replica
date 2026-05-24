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

class AssignedCaregiver {
  final String       id;
  final String       name;
  final String       phone;
  final String?      relationship;
  final List<String> permissions;
  final String?      consentDate;
  final bool         isRevoked;
  final String       note;

  const AssignedCaregiver({
    required this.id,
    required this.name,
    required this.phone,
    this.relationship,
    this.permissions = const [],
    this.consentDate,
    this.isRevoked   = false,
    this.note        = '',
  });
}
