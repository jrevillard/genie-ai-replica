enum InsightSeverity { good, caution, alert }

extension InsightSeverityX on InsightSeverity {
  String get badge => const ['Normal', 'Elevated', 'Alert'][index];
}

class HealthMetric {
  final String          id;
  final String          label;
  final String          unit;
  final double          value;
  final double          rangeMin;
  final double          rangeMax;
  final double          normalMax;
  final double          cautionMax;
  final List<double>    weekTrend;
  final InsightSeverity severity;
  final String          tip;

  const HealthMetric({
    required this.id,
    required this.label,
    required this.unit,
    required this.value,
    required this.rangeMin,
    required this.rangeMax,
    required this.normalMax,
    required this.cautionMax,
    required this.weekTrend,
    required this.severity,
    required this.tip,
  });

  double get fill =>
      ((value - rangeMin) / (rangeMax - rangeMin)).clamp(0.0, 1.0);

  double get goodFill =>
      ((normalMax - rangeMin) / (rangeMax - rangeMin)).clamp(0.0, 1.0);
}
