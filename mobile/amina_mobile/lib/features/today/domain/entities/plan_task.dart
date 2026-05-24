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

enum PlanTrack { medical, traditional, ai }

extension PlanTrackX on PlanTrack {
  String get label => const ['Medical', 'Traditional', 'AI'][index];
  String get emoji => const ['💊', '🌿', '✨'][index];
}

class PlanTask {
  final String    id;
  final PlanTrack track;
  final String    title;
  final String    emoji;
  final bool      completed;

  const PlanTask({
    required this.id,
    required this.track,
    required this.title,
    required this.emoji,
    this.completed = false,
  });

  PlanTask copyWith({bool? completed}) => PlanTask(
        id:        id,
        track:     track,
        title:     title,
        emoji:     emoji,
        completed: completed ?? this.completed,
      );
}
