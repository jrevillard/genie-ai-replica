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
