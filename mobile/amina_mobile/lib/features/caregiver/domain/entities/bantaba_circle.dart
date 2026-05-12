class BantabaMember {
  final String       id;
  final String       name;
  final int          age;
  final List<String> conditions;
  final int          adherenceWeek;
  final int          adherenceTarget;
  final bool         isOwner;
  final String       addedAt;

  const BantabaMember({
    required this.id,
    required this.name,
    required this.age,
    required this.conditions,
    required this.adherenceWeek,
    required this.adherenceTarget,
    required this.isOwner,
    required this.addedAt,
  });
}

class BantabaCircle {
  final String             circleId;
  final String             name;
  final String             ownerId;
  final String             ownerName;
  final String             village;
  final int                streakWeeks;
  final String             thisWeekHighlight;
  final List<BantabaMember> members;

  const BantabaCircle({
    required this.circleId,
    required this.name,
    required this.ownerId,
    required this.ownerName,
    required this.village,
    required this.streakWeeks,
    required this.thisWeekHighlight,
    required this.members,
  });

  /// Non-owner members = family/caregivers connected to the circle.
  List<BantabaMember> get familyMembers =>
      members.where((m) => !m.isOwner).toList();

  /// First 6 alphanumeric chars of circleId, uppercased — used as share code.
  String get shareCode {
    final clean = circleId.replaceAll(RegExp(r'[^A-Za-z0-9]'), '').toUpperCase();
    final padded = clean.padRight(6, '0');
    return padded.substring(0, 6);
  }
}
