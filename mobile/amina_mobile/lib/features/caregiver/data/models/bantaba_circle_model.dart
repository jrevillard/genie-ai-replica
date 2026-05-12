import '../../domain/entities/bantaba_circle.dart';

class BantabaMemberModel extends BantabaMember {
  const BantabaMemberModel({
    required super.id,
    required super.name,
    required super.age,
    required super.conditions,
    required super.adherenceWeek,
    required super.adherenceTarget,
    required super.isOwner,
    required super.addedAt,
  });

  factory BantabaMemberModel.fromJson(Map<String, dynamic> j) =>
      BantabaMemberModel(
        id:              j['id']               as String? ?? '',
        name:            j['name']             as String? ?? '',
        age:             (j['age']             as num?)?.toInt() ?? 0,
        conditions:      (j['conditions']      as List<dynamic>?)
                             ?.map((e) => e.toString()).toList() ?? [],
        adherenceWeek:   (j['adherence_week']  as num?)?.toInt() ?? 0,
        adherenceTarget: (j['adherence_target']as num?)?.toInt() ?? 7,
        isOwner:         j['is_owner']         as bool? ?? false,
        addedAt:         j['added_at']         as String? ?? '',
      );
}

class BantabaCircleModel extends BantabaCircle {
  const BantabaCircleModel({
    required super.circleId,
    required super.name,
    required super.ownerId,
    required super.ownerName,
    required super.village,
    required super.streakWeeks,
    required super.thisWeekHighlight,
    required super.members,
  });

  factory BantabaCircleModel.fromJson(Map<String, dynamic> j) =>
      BantabaCircleModel(
        circleId:          j['circle_id']            as String? ?? '',
        name:              j['name']                 as String? ?? '',
        ownerId:           j['owner_id']             as String? ?? '',
        ownerName:         j['owner_name']           as String? ?? '',
        village:           j['village']              as String? ?? '',
        streakWeeks:       (j['streak_weeks']        as num?)?.toInt() ?? 0,
        thisWeekHighlight: j['this_week_highlight']  as String? ?? '',
        members: (j['members'] as List<dynamic>? ?? [])
            .map((e) => BantabaMemberModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
