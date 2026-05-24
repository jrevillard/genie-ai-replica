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
