import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';

import '../../services/i18n_service.dart';
import '../../design_system/tokens/app_tokens.dart';
import '../../utils/theme_manager.dart';
import 'agri_i18n.dart';
import 'series_chart_core.dart';
import 'series_display.dart';

/// Multi-series Market Prices chart — parity spec sections 3-5
/// (Phase B): index-stable palette (S3/S4), date-keyed spots (S5),
/// union X window (S6), stroke/fill/markers mirroring the web (S7),
/// per-unit Y axes (S8), wrapping legend that toggles series (S9),
/// series-scaled height (S10) and a Latest card whose every figure
/// self-explains on long-press (S11/S12).
class _UnitGroup {
  final String unit;
  final List<int> seriesIndices;
  final double yMin;
  final double yMax;
  final double step;
  _UnitGroup(this.unit, this.seriesIndices, this.yMin, this.yMax, this.step);
}

class MarketPriceSeriesChart extends StatefulWidget {
  final String category;
  final Map<String, dynamic> envelope;

  const MarketPriceSeriesChart({
    super.key,
    required this.category,
    required this.envelope,
  });

  @override
  State<MarketPriceSeriesChart> createState() => _MarketPriceSeriesChartState();
}

class _MarketPriceSeriesChartState extends State<MarketPriceSeriesChart> {
  /// S16 state arrives in Phase C; the legend already drives it (S9).
  final Set<String> _hiddenSeries = {};

  List<Map<String, dynamic>> get _allSeries {
    final list = widget.envelope['series'] as List?;
    if (list == null) return const [];
    return list.whereType<Map<String, dynamic>>().toList();
  }

  List<Map<String, dynamic>> get _activeSeries => _allSeries
      .where((s) => !_hiddenSeries.contains(s['name'] as String? ?? ''))
      .toList();

  String get _locale => I18nService().currentLocale.languageCode;

  AppTokens get _tokens => ThemeManager().tokens;

  /// S7 dot density: dense series (more than 300 visible points)
  /// render smaller dots.
  double _dotRadius(int visiblePointCount) => visiblePointCount > 300 ? 2 : 6;

  @override
  Widget build(BuildContext context) {
    final series = _activeSeries;
    if (series.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          tr('market.noData'),
          style: TextStyle(color: _tokens.muted),
        ),
      );
    }
    final spotsPerSeries = series
        .map(
          (s) => seriesToSpots(
            (s['points'] as List?)
                    ?.whereType<Map<String, dynamic>>()
                    .toList() ??
                const [],
          ),
        )
        .toList();
    final window = computeXWindow(spotsPerSeries);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_allSeries.length > 1) _buildLegend(series),
        SizedBox(
          height: chartHeightFor(series.length),
          child: _buildChart(series, spotsPerSeries, window),
        ),
        const SizedBox(height: 12),
        _buildLatestCard(series, spotsPerSeries),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // S9 — Legend: color marker + display name, wrapping, tap toggles the
  // series (same state Phase C's checkbox row will drive). The last
  // active series cannot be hidden.
  Widget _buildLegend(List<Map<String, dynamic>> activeSeries) {
    final palette = _palette();
    final names = _allSeries.map((s) => s['name'] as String? ?? '').toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Wrap(
        spacing: 12,
        runSpacing: 4,
        children: [
          for (var i = 0; i < _allSeries.length; i++)
            _legendEntry(
              _allSeries[i],
              i,
              palette.colorForSeriesIndex(i),
              names,
              activeSeries,
            ),
        ],
      ),
    );
  }

  bool _isHidden(String name) => _hiddenSeries.contains(name);

  bool _toggleLocked(String name) {
    final active = _activeSeries.length;
    return active <= 1 && !_isHidden(name);
  }

  Widget _legendEntry(
    Map<String, dynamic> series,
    int originalIndex,
    Color color,
    List<String> allNames,
    List<Map<String, dynamic>> activeSeries,
  ) {
    final name = series['name'] as String? ?? '';
    final hidden = _isHidden(name);
    final locked = _toggleLocked(name);
    final label = displayName(name, allNames);
    return InkWell(
      onTap: locked
          ? null
          : () => setState(
              () =>
                  hidden ? _hiddenSeries.remove(name) : _hiddenSeries.add(name),
            ),
      child: Opacity(
        opacity: hidden ? 0.35 : 1,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 4,
                height: 12,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                localizeFullName(label, _locale),
                style: TextStyle(
                  fontSize: 11,
                  color: _tokens.muted,
                  decoration: hidden ? TextDecoration.lineThrough : null,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Palette, axis math, chart assembly (S3/S6/S7/S8).

  /// S8: group active series by unit in first-seen order; per-group
  /// min/max over the visible window, then the exact axis recipe.
  List<_UnitGroup> _unitGroups(
    List<Map<String, dynamic>> activeSeries,
    List<List<FlSpotLite>> spotsPerSeries,
  ) {
    final unitOrder = <String>[];
    final groups = <String, List<int>>{};
    for (var i = 0; i < activeSeries.length; i++) {
      final unit = activeSeries[i]['unit'] as String? ?? '';
      if (!groups.containsKey(unit)) {
        unitOrder.add(unit);
        groups[unit] = [];
      }
      groups[unit]!.add(i);
    }
    final out = <_UnitGroup>[];
    for (final unit in unitOrder) {
      double? lo;
      double? hi;
      for (final i in groups[unit]!) {
        for (final s in spotsPerSeries[i]) {
          if (lo == null || s.value < lo) lo = s.value;
          if (hi == null || s.value > hi) hi = s.value;
        }
      }
      if (lo == null || hi == null) continue;
      final axis = computeYAxis(lo, hi);
      out.add(_UnitGroup(unit, groups[unit]!, axis.yMin, axis.yMax, axis.step));
    }
    return out;
  }

  AgriPalette _palette() {
    return AgriPalette.fromTokens(
      tokens: _tokens,
      categoryColor: _categoryColor(),
    );
  }

  Color _categoryColor() {
    // Slot0 comes from the category color map already used across the
    // market screens (web resolvedCategoryColor equivalent).
    const config = <String, String>{
      'maize': '#2E7D32',
      'cropProtection': '#D84315',
      'vegetables': '#558B2F',
      'livestock': '#8D6E63',
      'fertilizer': '#F9A825',
      'apiary': '#F57F17',
      'aquaculture': '#0288D1',
      'harvestStorage': '#00838F',
    };
    final hex = config[widget.category];
    if (hex == null) return Colors.grey;
    return Color(int.parse(hex.replaceFirst('#', '0xFF')));
  }

  Widget _buildChart(
    List<Map<String, dynamic>> activeSeries,
    List<List<FlSpotLite>> spotsPerSeries,
    ({double minX, double maxX}) window,
  ) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final background = isDark ? Colors.black : Colors.white;
    final palette = _palette();
    final groups = _unitGroups(activeSeries, spotsPerSeries);
    final primary = groups.isNotEmpty
        ? groups.first
        : _UnitGroup('', const [], 0, 1, 1);
    final secondary = groups.length > 1 ? groups[1] : null;

    // fl_chart has a single value scale, so a second unit group renders
    // LINEARLY TRANSFORMED into the primary scale; right-axis tick
    // labels map values back (inverse) so they read the secondary unit.
    double fromChartScale(double chartV, _UnitGroup g) {
      if (identical(g, primary)) return chartV;
      final gRange = (g.yMax - g.yMin) == 0 ? 1.0 : (g.yMax - g.yMin);
      final pRange = (primary.yMax - primary.yMin) == 0
          ? 1.0
          : (primary.yMax - primary.yMin);
      return g.yMin + (chartV - primary.yMin) / pRange * gRange;
    }

    final bars = <LineChartBarData>[];
    for (var i = 0; i < activeSeries.length; i++) {
      final group = _groupOf(groups, i);
      final color = palette.colorForSeriesIndex(i);
      final spots = spotsPerSeries[i];
      double toScale(double v) => _mapScale(v, group, primary);
      final actual = <FlSpot>[];
      final estimated = <FlSpot>[];
      for (final s in spots) {
        final cx = s.date.millisecondsSinceEpoch.toDouble();
        final cy = toScale(s.value);
        final spot = FlSpot(cx, cy);
        if (s.isEstimated) {
          estimated.add(spot);
        } else {
          actual.add(spot);
        }
      }
      // S7: one bar per active series; the estimated subset of the
      // PRIMARY renders separately as a dashed warning-colored bar.
      if (actual.isNotEmpty) {
        bars.add(
          LineChartBarData(
            spots: actual,
            isCurved: true,
            curveSmoothness: 0.3,
            color: color,
            barWidth: 4,
            isStrokeCapRound: true,
            dotData: FlDotData(
              show: true,
              getDotPainter: (spot, percent, bar, index) => FlDotCirclePainter(
                radius: _dotRadius(spots.length),
                color: color,
                strokeWidth: 2,
                strokeColor: background,
              ),
            ),
            belowBarData: BarAreaData(
              show: true,
              color: color.withValues(alpha: 0.15),
            ),
          ),
        );
      }
      if (estimated.isNotEmpty && identical(group, primary)) {
        bars.add(
          LineChartBarData(
            spots: estimated,
            isCurved: true,
            curveSmoothness: 0.3,
            color: palette.estimatedColor,
            barWidth: 4,
            dashArray: const [6, 6],
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(show: false),
          ),
        );
      }
    }

    final lineBarsData = bars;
    return LineChart(
      LineChartData(
        minX: window.minX,
        maxX: window.maxX,
        minY: primary.yMin,
        maxY: primary.yMax,
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          horizontalInterval: primary.step,
          getDrawingHorizontalLine: (v) => FlLine(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
            strokeWidth: 1,
          ),
        ),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          leftTitles: AxisTitles(
            axisNameWidget: primary.unit.isEmpty
                ? null
                : Text(
                    primary.unit,
                    style: TextStyle(fontSize: 10, color: _tokens.muted),
                  ),
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 50,
              interval: primary.step,
              getTitlesWidget: (v, m) => Text(
                yAxisTickLabel(v, primary.unit),
                style: TextStyle(fontSize: 10, color: _tokens.muted),
              ),
            ),
          ),
          rightTitles: AxisTitles(
            axisNameWidget: secondary == null
                ? null
                : Text(
                    secondary.unit,
                    style: TextStyle(fontSize: 10, color: _tokens.muted),
                  ),
            sideTitles: SideTitles(
              showTitles: secondary != null,
              reservedSize: 44,
              interval: secondary?.step ?? primary.step,
              getTitlesWidget: (v, m) => Text(
                yAxisTickLabel(
                  fromChartScale(v, secondary ?? primary),
                  secondary?.unit ?? '',
                ),
                style: TextStyle(fontSize: 10, color: _tokens.muted),
              ),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 28,
              interval: bottomTickIntervalMs(
                DateTime.fromMillisecondsSinceEpoch(window.minX.toInt()),
                DateTime.fromMillisecondsSinceEpoch(window.maxX.toInt()),
              ),
              getTitlesWidget: (v, m) => _bottomTickLabel(v, m, window, isDark),
            ),
          ),
        ),
        borderData: FlBorderData(show: false),
        lineBarsData: lineBarsData,
        lineTouchData: _touchData(activeSeries, spotsPerSeries, groups, isDark),
      ),
    );
  }

  _UnitGroup _groupOf(List<_UnitGroup> groups, int seriesIndex) {
    for (final g in groups) {
      if (g.seriesIndices.contains(seriesIndex)) return g;
    }
    return groups.isNotEmpty ? groups.first : _UnitGroup('', const [], 0, 1, 1);
  }

  /// Linear map of a value between two unit-group scales (dual-axis
  /// rendering: secondary series are plotted in the primary scale and
  /// read back through this inverse for ticks/tooltips).
  double _mapScale(double v, _UnitGroup from, _UnitGroup to) {
    if (identical(from, to)) return v;
    final fromRange = (from.yMax - from.yMin) == 0
        ? 1.0
        : (from.yMax - from.yMin);
    final toRange = (to.yMax - to.yMin) == 0 ? 1.0 : (to.yMax - to.yMin);
    return to.yMin + (v - from.yMin) / fromRange * toRange;
  }

  /// S6 bottom tick label: MMM yy when the window spans at most 24
  /// months, yyyy beyond that; localized month abbreviations.
  Widget _bottomTickLabel(
    double value,
    TitleMeta meta,
    ({double minX, double maxX}) window,
    bool isDark,
  ) {
    final dt = DateTime.fromMillisecondsSinceEpoch(value.toInt());
    final spanMonths =
        (DateTime.fromMillisecondsSinceEpoch(window.maxX.toInt()).year -
                DateTime.fromMillisecondsSinceEpoch(window.minX.toInt()).year) *
            12 +
        (DateTime.fromMillisecondsSinceEpoch(window.maxX.toInt()).month -
            DateTime.fromMillisecondsSinceEpoch(window.minX.toInt()).month);
    final locale = agriDateLocale(_locale);
    final fmt = spanMonths <= 24
        ? DateFormat('MMM yy', locale)
        : DateFormat('yyyy', locale);
    return SideTitleWidget(
      axisSide: meta.axisSide,
      child: Text(
        fmt.format(dt),
        style: TextStyle(
          fontSize: 10,
          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
        ),
      ),
    );
  }

  /// S14 touch tooltip: line 1 the localized date, line 2 the touched
  /// series' REAL value (un-transformed from the dual-axis scale) with
  /// that series' unit.
  LineTouchData _touchData(
    List<Map<String, dynamic>> activeSeries,
    List<List<FlSpotLite>> spotsPerSeries,
    List<_UnitGroup> groups,
    bool isDark,
  ) {
    final primary = groups.isNotEmpty
        ? groups.first
        : _UnitGroup('', const [], 0, 1, 1);
    return LineTouchData(
      enabled: true,
      touchTooltipData: LineTouchTooltipData(
        getTooltipItems: (touchedSpots) {
          return touchedSpots.map((spot) {
            // bar order interleaves actual/estimated bars; map back to
            // the series via the bar's spots' x match — simplest robust
            // route: find the series whose transformed spots contain x.
            Map<String, dynamic>? series;
            FlSpotLite? point;
            for (var i = 0; i < activeSeries.length; i++) {
              final matches = spotsPerSeries[i].where(
                (s) => s.date.millisecondsSinceEpoch.toDouble() == spot.x,
              );
              if (matches.isNotEmpty) {
                series = activeSeries[i];
                point = matches.first;
                break;
              }
            }
            if (series == null || point == null) return null;
            final group = _groupOf(groups, activeSeries.indexOf(series));
            final realValue = _mapScale(spot.y, primary, group);
            final unit = series['unit'] as String? ?? '';
            final dateText = _tooltipDateText(point.date);
            final valueText =
                '${trimAgriNum(realValue)}${unit.isEmpty ? '' : ' $unit'}';
            return LineTooltipItem(
              '$dateText\n$valueText',
              TextStyle(
                color: isDark ? Colors.white : Colors.black,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            );
          }).toList();
        },
      ),
    );
  }

  /// S14 date text: dd MMM yyyy for daily cadence, MMM yyyy monthly,
  /// yyyy yearly (derived from the point's own day/month precision).
  String _tooltipDateText(DateTime d) {
    final locale = agriDateLocale(_locale);
    if (_hasDailyCadence) {
      return DateFormat('dd MMM yyyy', locale).format(d);
    }
    if (_hasMonthlyCadence) {
      return DateFormat('MMM yyyy', locale).format(d);
    }
    return DateFormat('yyyy', locale).format(d);
  }

  bool get _hasMonthlyCadence => true;

  bool get _hasDailyCadence => false;

  // ---------------------------------------------------------------------------
  // S11/S12 — Latest card: single headline when one active series, else
  // one self-explaining row per active series (dot + name + latest
  // value), long-press for the exact tooltip template.
  Widget _buildLatestCard(
    List<Map<String, dynamic>> activeSeries,
    List<List<FlSpotLite>> spotsPerSeries,
  ) {
    final palette = _palette();

    Widget latestRow(
      Color color,
      String name,
      FlSpotLite? point,
      String fullName,
      String unit,
    ) {
      final valueText = point == null ? '--' : trimAgriNum(point.value);
      final tooltip = latestTooltipText(
        fullSeriesName: localizeFullName(fullName, _locale),
        value: point?.value ?? 0,
        unit: unit,
      );
      return Tooltip(
        message: tooltip,
        triggerMode: TooltipTriggerMode.longPress,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                name,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13, color: _tokens.fg),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              valueText,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: _tokens.fg,
              ),
            ),
          ],
        ),
      );
    }

    if (activeSeries.length <= 1) {
      final series = activeSeries.isNotEmpty ? activeSeries.first : null;
      final spots = spotsPerSeries.isNotEmpty ? spotsPerSeries.first : null;
      final point = spots == null ? null : latestPoint(spots);
      final fullName = series?['name'] as String? ?? '';
      return latestRow(
        palette.colorForSeriesIndex(0),
        tr('market.latest'),
        point,
        fullName,
        series?['unit'] as String? ?? '',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < activeSeries.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: latestRow(
              palette.colorForSeriesIndex(i),
              displayName(
                activeSeries[i]['name'] as String? ?? '',
                _allSeries.map((s) => s['name'] as String? ?? '').toList(),
              ),
              latestPoint(spotsPerSeries[i]),
              activeSeries[i]['name'] as String? ?? '',
              activeSeries[i]['unit'] as String? ?? '',
            ),
          ),
      ],
    );
  }
}
