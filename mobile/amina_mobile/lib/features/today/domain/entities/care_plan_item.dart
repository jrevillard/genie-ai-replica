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

enum CarePlanType { medical, traditional, ai }

enum CarePlanPriority { high, medium, low }

class CarePlanItem {
  final String          id;
  final CarePlanType    type;
  final String          title;
  final String          body;
  final String          source;
  final String          sourceRole;
  final CarePlanPriority priority;
  final DateTime        updatedAt;

  const CarePlanItem({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.source,
    required this.sourceRole,
    required this.priority,
    required this.updatedAt,
  });
}
