import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../design_system/tokens/app_tokens.dart';
import 'series_display.dart';

/// Pure chart-core logic for the multi-series Market Prices chart
/// (parity spec sections 3-5, Phase B). Plain Dart only so it stays
/// unit-testable (spec section 14 tests 3 and 4).

/// S3 palette: 5 semantic slots. slot0 = category color, slot1 =
/// warning, slot2 = muted, slot3 = info, slot4 = danger.
class AgriPalette {
  final List<Color> slots;

  AgriPalette(this.slots);

  /// S4 — color is keyed to the position in the FULL series array,
  /// never a filtered/visible list, so toggling never re-colors
  /// survivors (the web's black-marker bug class).
  Color colorForSeriesIndex(int originalIndex) =>
      slots[originalIndex % slots.length];

  /// S7 the estimated overlay always uses slot1 (warning).
  Color get estimatedColor => slots[1];

  static AgriPalette fromTokens({
    required AppTokens tokens,
    required Color categoryColor,
  }) {
    return AgriPalette([
      categoryColor,
      tokens.warning,
      tokens.muted,
      tokens.info,
      tokens.danger,
    ]);
  }
}

/// One plotted point: date-keyed value plus the quality marker the
/// estimated overlay splits on (S7).
class FlSpotLite {
  final DateTime date;
  final double value;
  final String? quality;

  const FlSpotLite(this.date, this.value, this.quality);

  bool get isEstimated => quality == 'estimated';
}

/// S5 accepted date shapes: YYYY-MM-DD, YYYY-MM, YYYY (missing
/// day/month default to 1). Returns null for anything unparseable.
DateTime? parseAgriDate(String? raw) {
  if (raw == null) return null;
  final s = raw.trim();
  final m = RegExp(r'^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$').firstMatch(s);
  if (m == null) return null;
  final year = int.tryParse(m.group(1)!);
  if (year == null) return null;
  final month = int.tryParse(m.group(2) ?? '1') ?? 1;
  final day = int.tryParse(m.group(3) ?? '1') ?? 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return DateTime(year, month, day);
}

/// S5 date-keyed spots (NOT index-keyed). Points with unparseable
/// dates or null/non-finite values are dropped. `points` items are
/// the Phase-A mapped {date, value, quality} maps.
List<FlSpotLite> seriesToSpots(List<Map<String, dynamic>> points) {
  final spots = <FlSpotLite>[];
  for (final p in points) {
    final date = parseAgriDate(p['date'] as String?);
    final value = (p['value'] as num?)?.toDouble();
    if (date == null || value == null || value.isNaN || value.isInfinite) {
      continue;
    }
    spots.add(FlSpotLite(date, value, p['quality'] as String?));
  }
  return spots;
}

/// S6 minX/maxX over ALL active series' spots, as epoch-millis
/// doubles. Falls back to a trailing-1-year window when empty.
({double minX, double maxX}) computeXWindow(
  List<List<FlSpotLite>> activeSpots,
) {
  double? minX;
  double? maxX;
  for (final spots in activeSpots) {
    for (final s in spots) {
      final x = s.date.millisecondsSinceEpoch.toDouble();
      if (minX == null || x < minX) minX = x;
      if (maxX == null || x > maxX) maxX = x;
    }
  }
  if (minX == null || maxX == null) {
    final now = DateTime.now();
    final from = DateTime(now.year - 1, now.month);
    return (
      minX: from.millisecondsSinceEpoch.toDouble(),
      maxX: now.millisecondsSinceEpoch.toDouble(),
    );
  }
  return (minX: minX, maxX: maxX);
}

/// S6 bottom-tick interval in CHART x units (epoch millis, since the
/// x axis is date-keyed): span of at most 24 months ticks monthly, at
/// most 120 months yearly, otherwise every 5 years.
double bottomTickIntervalMs(DateTime minX, DateTime maxX) {
  final months = (maxX.year - minX.year) * 12 + (maxX.month - minX.month);
  final days = months <= 24 ? 31 : (months <= 120 ? 366 : 366 * 5);
  return Duration(days: days).inMilliseconds.toDouble();
}

/// S8 Y-axis math for one unit group over its VISIBLE window:
/// range = maxVal - minVal (or 1 when flat); step = 10^floor(log10(
/// range/4)) with a floor of 1; yMin = max(0, floor((minVal -
/// range*0.05)/step)*step) when minVal >= 0, else the unclamped
/// floor; yMax = round(maxVal*1.2*100)/100 — the axis tops out only
/// 20% above the highest rendered point (user req 2026-09-20: keeps
/// the plot area tight and readable).
({double yMin, double yMax, double step}) computeYAxis(
  double minVal,
  double maxVal,
) {
  final range = (maxVal - minVal) == 0 ? 1.0 : maxVal - minVal;
  final rawStep = range / 4;
  var step = rawStep > 0
      ? math.pow(10, (math.log(rawStep) / math.ln10).floorToDouble()).toDouble()
      : 1.0;
  if (step < 1) step = 1.0;
  final floorVal = ((minVal - range * 0.05) / step).floorToDouble() * step;
  final yMin = minVal >= 0 ? (floorVal < 0 ? 0.0 : floorVal) : floorVal;
  final yMax = (maxVal * 1.2 * 100).roundToDouble() / 100;
  return (yMin: yMin, yMax: yMax, step: step);
}

/// S8 tick label: currency units get a $ prefix, % units a suffix,
/// others bare.
String yAxisTickLabel(double value, String unit) {
  final u = unit.toLowerCase();
  if (u.contains('usd')) return '\$${trimAgriNum(value)}';
  if (u.contains('%') || u == 'percent') return '${trimAgriNum(value)}%';
  return trimAgriNum(value);
}

/// Whole numbers render without decimals; anything else at 2.
String trimAgriNum(double v) {
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v.toStringAsFixed(2);
}

/// S10 chart height scales with the active series count.
double chartHeightFor(int activeSeriesCount) =>
    math.max(320, 240 + 45 * activeSeriesCount).toDouble();

/// S11 the last finite point of a series (Latest card + tooltips).
/// Input spots are already finite-only; returns the last one.
FlSpotLite? latestPoint(List<FlSpotLite> spots) =>
    spots.isEmpty ? null : spots.last;

/// S12 exact tooltip template: "Latest month-end price of {full
/// series name} — {value}{' ' + unit}", value at 2 decimals. The
/// caller localizes the name (S27) before calling.
String latestTooltipText({
  required String fullSeriesName,
  required double value,
  required String unit,
}) {
  final unitPart = unit.isEmpty ? '' : ' $unit';
  return 'Latest month-end price of $fullSeriesName'
      ' — ${value.toStringAsFixed(2)}$unitPart';
}

// ---------------------------------------------------------------------------
// Phase C pure logic: family masters (S25), start-year filter (S17/S18),
// table rows (S19) and the exact CSV file (S20).

/// S25 commodity family = first word of the base series name
/// (Beans, Maize, Rice, Sorghum, Wheat, Tomatoes, ...).
String agriFamily(String name) {
  final base = baseSeriesName(name);
  return base.split(' ').first.trim();
}

/// S25 masters: only families with >= 2 members get one. Returns
/// family -> member full names, in original series order.
Map<String, List<String>> agriFamilyMasters(List<String> allNames) {
  final map = <String, List<String>>{};
  for (final n in allNames) {
    map.putIfAbsent(agriFamily(n), () => []).add(n);
  }
  map.removeWhere((_, members) => members.length < 2);
  return map;
}

/// S17 options: from max(earliest, currentYear - 5) down to earliest,
/// inclusive, descending.
List<int> startYearOptions(int earliestYear, int currentYear) {
  final top = math.max(earliestYear, currentYear - 5);
  if (top <= earliestYear) return [earliestYear];
  return [for (var y = top; y >= earliestYear; y--) y];
}

/// S17 default selection: 2015, clamped up to the earliest data year.
int defaultStartYear(int earliestYear) => math.max(2015, earliestYear);

/// S16 guard: a series checkbox is locked when it is the LAST active
/// series and currently shown (unchecking it must be a no-op so the
/// chart never empties).
bool toggleLocked({required int activeCount, required bool isHidden}) =>
    activeCount <= 1 && !isHidden;

/// S25 guard: hiding a whole family is disabled when no active series
/// exists outside it (the chart would empty).
bool masterHideDisabled({required int activeOutsideFamily}) =>
    activeOutsideFamily == 0;

/// S18 visible-window filter (start-year side; the zoom window applies
/// to the chart only, never to table/CSV/Latest).
List<FlSpotLite> filterSpotsFrom(List<FlSpotLite> spots, DateTime from) =>
    spots.where((s) => !s.date.isBefore(from)).toList();

/// S19 table row: the union of all active series' dates, sorted
/// ascending; a cell is null when that series has no point for the
/// date; quality reflects the PRIMARY series for that date.
class AgriTableRow {
  final DateTime date;
  final List<double?> values;
  final String? primaryQuality;
  const AgriTableRow(this.date, this.values, this.primaryQuality);
}

List<AgriTableRow> buildTableRows(List<List<FlSpotLite>> seriesSpots) {
  if (seriesSpots.isEmpty) return const [];
  final primaryQuality = <int, String?>{
    for (final p in seriesSpots.first) p.date.millisecondsSinceEpoch: p.quality,
  };
  final dates = <int>{};
  final cells = <int, List<double?>>{};
  for (final spots in seriesSpots) {
    for (final s in spots) {
      final k = s.date.millisecondsSinceEpoch;
      dates.add(k);
      cells.putIfAbsent(
        k,
        () => List<double?>.filled(seriesSpots.length, null),
      );
    }
  }
  for (var i = 0; i < seriesSpots.length; i++) {
    for (final s in seriesSpots[i]) {
      cells[s.date.millisecondsSinceEpoch]![i] = s.value;
    }
  }
  final sorted = dates.toList()..sort();
  return [
    for (final k in sorted)
      AgriTableRow(
        DateTime.fromMillisecondsSinceEpoch(k),
        cells[k]!,
        primaryQuality[k],
      ),
  ];
}

/// S20 RFC-4180 field quoting.
String csvEscapeField(String field) {
  if (field.contains(RegExp('[,"\n\r]'))) {
    return '"${field.replaceAll('"', '""')}"';
  }
  return field;
}

/// S20 exact file bytes: UTF-8 BOM + CRLF line endings. headers =
/// ['Period', '{full series name} ({unit})' per active series,
/// 'Quality']; values raw (no thousands separators), empty when
/// missing.
List<int> csvFileBytes({
  required List<String> headers,
  required List<AgriTableRow> rows,
  required String Function(DateTime date) formatDate,
  required String Function(String? quality) qualityLabel,
}) {
  final sb = StringBuffer();
  sb.write([for (final h in headers) csvEscapeField(h)].join(','));
  sb.write('\r\n');
  for (final r in rows) {
    final cells = <String>[formatDate(r.date)];
    for (final v in r.values) {
      cells.add(v == null ? '' : trimAgriNum(v));
    }
    cells.add(qualityLabel(r.primaryQuality));
    sb.write([for (final c in cells) csvEscapeField(c)].join(','));
    sb.write('\r\n');
  }
  return utf8.encode(String.fromCharCodes([0xFEFF]) + sb.toString());
}
