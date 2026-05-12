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
