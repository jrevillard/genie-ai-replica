import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
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
  /// S15/S16/S25 toggle state (shared by masters, chips and legend).
  final Set<String> _hiddenSeries = {};

  /// S17 start-year selection (null = spec default 2015, clamped).
  int? _startYear;

  /// M6 zoom/pan window in epoch millis; null/null = Fit (full range).
  double? _viewStartMs;
  double? _viewEndMs;

  List<Map<String, dynamic>> get _allSeries {
    final list = widget.envelope['series'] as List?;
    if (list == null) return const [];
    return list.whereType<Map<String, dynamic>>().toList();
  }

  List<Map<String, dynamic>> get _activeSeries => _allSeries
      .where((s) => !_hiddenSeries.contains(s['name'] as String? ?? ''))
      .toList();

  /// S17 earliest data year across ALL series (fallback currentYear-5).
  int? _earliestYear;
  int get _earliestDataYear {
    if (_earliestYear != null) return _earliestYear!;
    var earliest = DateTime.now().year - 5;
    for (final s in _allSeries) {
      for (final p in (s['points'] as List?) ?? const []) {
        final y = int.tryParse((p['date']?.toString() ?? '').split('-').first);
        if (y != null && y < earliest) earliest = y;
      }
    }
    _earliestYear = earliest;
    return earliest;
  }

  int get _currentYear => DateTime.now().year;

  List<int> get _yearOptions =>
      startYearOptions(_earliestDataYear, _currentYear);

  int get _effectiveStartYear =>
      _startYear ?? defaultStartYear(_earliestDataYear);

  /// S18 visible series data: start-year filtered (chart, table, CSV).
  List<List<FlSpotLite>> _visibleSpots(List<Map<String, dynamic>> series) {
    final from = DateTime(_effectiveStartYear, 1, 1);
    return series
        .map(
          (s) => filterSpotsFrom(
            seriesToSpots(
              (s['points'] as List?)
                      ?.whereType<Map<String, dynamic>>()
                      .toList() ??
                  const [],
            ),
            from,
          ),
        )
        .toList();
  }

  String get _locale => I18nService().currentLocale.languageCode;

  /// Web `unitExplanation` parity — what the unit means, keyed the same
  /// way (quintal/PPI/index/%/...). Long-press target on the Latest card.
  String _unitExplanation(String unit) {
    final u = unit.toLowerCase();
    if (u.contains('quintal')) return tr('market.unitQuintal');
    if (u.contains('ppi')) return tr('market.unitPpi');
    if (u.contains('index')) return tr('market.unitIndex');
    if (u.contains('%')) return tr('market.unitPercent');
    if (u.contains('usd/kg')) return tr('market.unitUsdKg');
    if (u.contains('usd/mt')) return tr('market.unitUsdMt');
    if (u.contains('short ton')) return tr('market.unitShortTon');
    if (u.contains('usd/lb')) return tr('market.unitUsdLb');
    if (u.contains('usd/dozen')) return tr('market.unitDozen');
    return tr('market.unitGeneric');
  }

  AppTokens get _tokens => ThemeManager().tokens;

  /// Pixel position of the last drawn X label, and the minimum gap below
  /// which a tick is dropped (fl_chart draws min/max on top of the grid).
  double? _lastBottomLabelPx;
  static const double _minBottomLabelGapPx = 30;

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
    final spotsPerSeries = _visibleSpots(series);
    final window = _chartWindow(spotsPerSeries);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // S25 commodity-type masters, then S15 per-series toggles
        // (web order: both above the chart; legend stays by the plot).
        if (_allSeries.length > 1) _buildFamilyMasters(),
        // Per-series on/off stays on the LEGEND tap (user req).
        const SizedBox(height: 4),
        _buildLegend(series),
        _buildStartYearFilter(),
        _buildZoomControls(),
        SizedBox(
          height: chartHeightFor(series.length),
          child: _buildZoomableChart(
            _buildChart(series, spotsPerSeries, window),
            spotsPerSeries,
          ),
        ),
        const SizedBox(height: 12),
        _buildLatestCard(series, spotsPerSeries),
        const SizedBox(height: 16),
        _buildTableSection(series, spotsPerSeries),
      ],
    );
  }

  /// M6 chart x-window: the zoom view when set, else the union range.
  ({double minX, double maxX}) _chartWindow(
    List<List<FlSpotLite>> spotsPerSeries,
  ) {
    final union = computeXWindow(spotsPerSeries);
    if (_viewStartMs != null && _viewEndMs != null) {
      return (
        minX: _viewStartMs!.clamp(union.minX, union.maxX),
        maxX: _viewEndMs!.clamp(union.minX, union.maxX),
      );
    }
    return union;
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
    // Web :title parity — full name + unit on long-press.
    final unit = series['unit'] as String? ?? '';
    final tip = unit.isEmpty
        ? localizeFullName(name, _locale)
        : '${localizeFullName(name, _locale)} ($unit)';
    return Tooltip(
      message: tip,
      triggerMode: TooltipTriggerMode.longPress,
      child: InkWell(
        onTap: locked
            ? null
            : () => setState(
                () => hidden
                    ? _hiddenSeries.remove(name)
                    : _hiddenSeries.add(name),
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
    // The X labels are emitted in ascending order during this build, so
    // the collision guard starts fresh each time the chart is built.
    _lastBottomLabelPx = null;
    final groups = _unitGroups(activeSeries, spotsPerSeries);
    final primary = groups.isNotEmpty
        ? groups.first
        : _UnitGroup('', const [], 0, 1, 1);
    // fl_chart has a single value scale, so a second unit group renders
    // LINEARLY TRANSFORMED into the primary scale. Only the LEFT axis is
    // drawn (user decision 2026-09-21): the right-hand axis was crowded
    // redundant noise, so a secondary-unit series is read relative to the
    // primary scale instead.

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
          rightTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
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

  /// S6 bottom tick label: the pattern tracks the tick STEP (see
  /// [bottomTickLabelPattern]) so labels stay narrow — years for
  /// multi-year steps, month letters for quarters, a single letter for
  /// monthly steps. The old version keyed the format off the window span
  /// and always printed `MMM yy`, which crowded when zoomed in.
  ///
  /// fl_chart's `iterateThroughAxis` yields the axis MIN and MAX as
  /// EXTRA ticks on top of the interval grid, and the grid is aligned to
  /// the interval (not to min), so the first grid tick can land almost on
  /// top of the min label — the "JanFeb" overlap seen on the Crop
  /// Protection chart. Anything that would collide with the previously
  /// drawn label is dropped.
  Widget _bottomTickLabel(
    double value,
    TitleMeta meta,
    ({double minX, double maxX}) window,
    bool isDark,
  ) {
    final px = meta.axisPosition;
    final lastPx = _lastBottomLabelPx;
    if (lastPx != null && (px - lastPx).abs() < _minBottomLabelGapPx) {
      return const SizedBox.shrink();
    }
    _lastBottomLabelPx = px;

    final dt = DateTime.fromMillisecondsSinceEpoch(value.toInt());
    final pattern = bottomTickLabelPattern(
      bottomTickStepMonths(
        DateTime.fromMillisecondsSinceEpoch(window.minX.toInt()),
        DateTime.fromMillisecondsSinceEpoch(window.maxX.toInt()),
      ),
    );
    final fmt = DateFormat(pattern, agriDateLocale(_locale));
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
    final cardUnit = _allSeries.isEmpty
        ? ''
        : (_allSeries.first['unit'] as String? ?? '');

    // Web parity: the unit with an info affordance — long-press explains
    // what the unit means (quintal/PPI/index/... same copy as the web).
    Widget unitInfoLine() {
      if (cardUnit.isEmpty) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Tooltip(
          message: _unitExplanation(cardUnit),
          triggerMode: TooltipTriggerMode.longPress,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                cardUnit,
                style: TextStyle(fontSize: 11, color: _tokens.muted),
              ),
              const SizedBox(width: 4),
              Icon(Icons.info_outline, size: 13, color: _tokens.muted),
            ],
          ),
        ),
      );
    }

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
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          unitInfoLine(),
          latestRow(
            palette.colorForSeriesIndex(0),
            tr('market.latest'),
            point,
            fullName,
            series?['unit'] as String? ?? '',
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        unitInfoLine(),
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

  // ---------------------------------------------------------------------------
  // S25 — commodity-type masters (families with >= 2 members), above the
  // per-series toggles. Tristate: checked = all shown, unchecked = all
  // hidden, indeterminate = mixed. Tapping an all-shown master hides its
  // members (DISABLED when that would empty the chart); otherwise shows
  // them all. Derives from the same _hiddenSeries state — no new state.
  Widget _buildFamilyMasters() {
    final names = _allSeries.map((s) => s['name'] as String? ?? '').toList();
    final masters = agriFamilyMasters(names);
    if (masters.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Wrap(
        spacing: 4,
        runSpacing: 0,
        children: [
          for (final entry in masters.entries)
            _familyMasterChip(entry.key, entry.value),
        ],
      ),
    );
  }

  Widget _familyMasterChip(String family, List<String> members) {
    final allShown = !members.any(_isHidden);
    final allHidden = members.every(_isHidden);
    final activeOutsideFamily = _activeSeries
        .where((s) => !members.contains(s['name']))
        .length;
    // Hiding the whole family must never empty the chart (S25).
    final disableHide = allShown && activeOutsideFamily == 0;

    void toggle() {
      setState(() {
        if (allShown) {
          _hiddenSeries.addAll(members);
        } else {
          _hiddenSeries.removeAll(members);
        }
      });
    }

    // Web :title parity — the family's member names on long-press.
    final tip = members.map((m) => localizeFullName(m, _locale)).join(', ');
    return Tooltip(
      message: tip,
      triggerMode: TooltipTriggerMode.longPress,
      child: InkWell(
        onTap: disableHide ? null : toggle,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 32,
                height: 28,
                child: Checkbox(
                  tristate: true,
                  visualDensity: VisualDensity.compact,
                  value: allShown ? true : (allHidden ? false : null),
                  onChanged: disableHide ? null : (_) => toggle(),
                ),
              ),
              Text(
                '$family (${members.length})',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: disableHide ? _tokens.muted : _tokens.fg,
                ),
              ),
              const SizedBox(width: 8),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // S17/S18 — start-year filter ("From"): options earliest..currentYear-5
  // descending, default 2015 clamped to the earliest data year. Changing
  // it re-renders chart, table and CSV (Latest values always use the
  // full history) and pins the axis minimum at the selection.
  Widget _buildStartYearFilter() {
    final options = _yearOptions;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Text(
            tr('market.startYear'),
            style: TextStyle(fontSize: 12, color: _tokens.muted),
          ),
          const SizedBox(width: 8),
          Container(
            constraints: const BoxConstraints(minWidth: 96),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              border: Border.all(color: _tokens.border),
              borderRadius: BorderRadius.circular(8),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<int>(
                value: options.contains(_effectiveStartYear)
                    ? _effectiveStartYear
                    : options.first,
                isDense: true,
                items: [
                  for (final y in options)
                    DropdownMenuItem(value: y, child: Text('$y')),
                ],
                onChanged: (y) => setState(() {
                  _startYear = y;
                  _viewStartMs = null;
                  _viewEndMs = null;
                }),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // M6 — zoom & pan: [−] [+] [Fit] buttons plus pinch-zoom and
  // horizontal drag-pan driving the view window; the Y axes re-scale to
  // the visible window (the S8 math runs over the windowed spots).
  static const double _minZoomSpanMs = 30 * 24 * 3600 * 1000;

  ({double s, double e})? _dragStartView;
  double? _dragStartX;
  double? _dragFocalMs;

  void _zoomBy(double factor) {
    final spots = _visibleSpots(_activeSeries);
    final union = computeXWindow(spots);
    final s = _viewStartMs ?? union.minX;
    final e = _viewEndMs ?? union.maxX;
    final center = (s + e) / 2;
    final span = ((e - s) * factor).clamp(
      _minZoomSpanMs,
      union.maxX - union.minX,
    );
    setState(() {
      _viewStartMs = (center - span / 2).clamp(union.minX, union.maxX);
      _viewEndMs = (center + span / 2).clamp(union.minX, union.maxX);
    });
  }

  void _fitZoom() => setState(() {
    _viewStartMs = null;
    _viewEndMs = null;
  });

  Widget _zoomButton(String label, VoidCallback? onPressed) {
    // The app theme forces full-width text buttons; inside this
    // scrollable dialog that crashes layout — hug content explicitly.
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        visualDensity: VisualDensity.compact,
      ),
      child: Text(label, style: TextStyle(fontSize: 13, color: _tokens.fg)),
    );
  }

  Widget _buildZoomControls() {
    final zoomed = _viewStartMs != null && _viewEndMs != null;
    return Row(
      children: [
        const Spacer(),
        _zoomButton('\u2212', () => _zoomBy(1.6)),
        const SizedBox(width: 4),
        _zoomButton('+', () => _zoomBy(1 / 1.6)),
        const SizedBox(width: 4),
        _zoomButton(tr('market.fit'), zoomed ? _fitZoom : null),
      ],
    );
  }

  /// Wraps the chart with pinch-zoom and horizontal drag-pan.
  Widget _buildZoomableChart(
    Widget chart,
    List<List<FlSpotLite>> spotsPerSeries,
  ) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth == 0 ? 1.0 : constraints.maxWidth;
        return GestureDetector(
          behavior: HitTestBehavior.translucent,
          onScaleStart: (d) {
            final w = _chartWindow(spotsPerSeries);
            _dragStartView = (s: w.minX, e: w.maxX);
            _dragStartX = d.localFocalPoint.dx;
            _dragFocalMs =
                w.minX + (d.localFocalPoint.dx / width) * (w.maxX - w.minX);
          },
          onScaleUpdate: (d) {
            final start = _dragStartView;
            if (start == null) return;
            final union = computeXWindow(spotsPerSeries);
            final span0 = start.e - start.s;
            double ns;
            double ne;
            if (d.pointerCount > 1) {
              // pinch: scale the span around the focal point
              final factor = d.scale == 0 ? 1.0 : d.scale;
              final span = (span0 / factor).clamp(
                _minZoomSpanMs,
                union.maxX - union.minX,
              );
              final focal = _dragFocalMs ?? (start.s + start.e) / 2;
              ns = focal - (focal - start.s) * (span / span0);
              ne = ns + span;
            } else {
              // single-finger horizontal pan
              final msPerPx = span0 / width;
              final dxMs = (d.localFocalPoint.dx - _dragStartX!) * msPerPx;
              ns = start.s - dxMs;
              ne = start.e - dxMs;
            }
            final span = ne - ns;
            if (ns < union.minX) {
              ns = union.minX;
              ne = ns + span;
            }
            if (ne > union.maxX) {
              ne = union.maxX;
              ns = (ne - span).clamp(union.minX, union.maxX);
            }
            setState(() {
              _viewStartMs = ns;
              _viewEndMs = ne;
            });
          },
          onScaleEnd: (_) => _dragStartView = null,
          child: chart,
        );
      },
    );
  }

  // ---------------------------------------------------------------------------
  // S19 — data table: Period + one column per ACTIVE series (header =
  // display name, tooltip = full name (unit)) + Quality. Rows are the
  // union of dates sorted ascending; empty cell when a series lacks the
  // date; Quality reflects the PRIMARY series. Horizontally scrollable;
  // rows are lazy (grains has ~800 union dates).
  Widget _buildTableSection(
    List<Map<String, dynamic>> activeSeries,
    List<List<FlSpotLite>> spotsPerSeries,
  ) {
    final rows = buildTableRows(spotsPerSeries);
    if (rows.isEmpty) return const SizedBox.shrink();
    final names = activeSeries.map((s) => s['name'] as String? ?? '').toList();
    final allNames = _allSeries.map((s) => s['name'] as String? ?? '').toList();
    final units = activeSeries.map((s) => s['unit'] as String? ?? '').toList();
    final theme = Theme.of(context);

    const periodW = 92.0;
    const seriesW = 108.0;
    const qualityW = 88.0;
    final tableWidth = periodW + seriesW * activeSeries.length + qualityW;

    TextStyle headerStyle() => TextStyle(
      fontSize: 11,
      fontWeight: FontWeight.w700,
      color: _tokens.muted,
    );

    Widget cell(
      String text,
      double w, {
      TextStyle? style,
      String? tooltip,
      Alignment align = Alignment.centerLeft,
    }) {
      final content = Container(
        width: w,
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
        alignment: align,
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: style ?? TextStyle(fontSize: 12, color: _tokens.fg),
        ),
      );
      // Tooltip asserts on a null message — wrap only header cells
      // that carry one (value cells have none). Table crash fix.
      if (tooltip == null) return content;
      return Tooltip(
        message: tooltip,
        triggerMode: TooltipTriggerMode.longPress,
        child: content,
      );
    }

    Widget headerRow() => Container(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: _tokens.border)),
      ),
      child: Row(
        children: [
          cell(tr('market.period'), periodW, style: headerStyle()),
          for (var i = 0; i < activeSeries.length; i++)
            cell(
              displayName(names[i], allNames),
              seriesW,
              style: headerStyle(),
              tooltip: '${localizeFullName(names[i], _locale)} (${units[i]})',
            ),
          cell(tr('market.quality'), qualityW, style: headerStyle()),
        ],
      ),
    );

    Widget dataRow(AgriTableRow r, int rowIndex) {
      final estimated = r.primaryQuality == 'estimated';
      final q = estimated ? tr('market.estimated') : tr('market.actual');
      return Container(
        color: rowIndex.isOdd
            ? Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.03)
            : null,
        child: Row(
          children: [
            cell(
              DateFormat('yyyy-MM-dd').format(r.date),
              periodW,
              style: TextStyle(fontSize: 11, color: _tokens.muted),
            ),
            for (final v in r.values)
              cell(v == null ? '' : trimAgriNum(v), seriesW),
            cell(
              q,
              qualityW,
              // Vue parity: Estimated is warning-tinted, Actual stays muted.
              style: TextStyle(
                fontSize: 11,
                fontWeight: estimated ? FontWeight.w600 : FontWeight.w400,
                color: estimated
                    ? (theme.brightness == Brightness.dark
                          ? Colors.amber.shade300
                          : Colors.amber.shade800)
                    : _tokens.muted,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              tr('market.dataTable'),
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
            _zoomButton(
              tr('market.exportCsv'),
              () => _exportCsv(activeSeries, rows),
            ),
          ],
        ),
        const SizedBox(height: 6),
        SizedBox(
          height: 300,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: tableWidth,
              child: ListView.builder(
                physics: const ClampingScrollPhysics(),
                itemCount: rows.length + 1,
                itemBuilder: (context, i) =>
                    i == 0 ? headerRow() : dataRow(rows[i - 1], i),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // S20 — CSV export of the S19 rows via the system share sheet.
  Future<void> _exportCsv(
    List<Map<String, dynamic>> activeSeries,
    List<AgriTableRow> rows,
  ) async {
    final headers = <String>[
      tr('market.period'),
      for (final s in activeSeries) '${s['name']} (${s['unit']})',
      tr('market.quality'),
    ];
    final bytes = csvFileBytes(
      headers: headers,
      rows: rows,
      formatDate: (d) => DateFormat('yyyy-MM-dd').format(d),
      qualityLabel: (q) =>
          q == 'estimated' ? tr('market.estimated') : tr('market.actual'),
    );
    final dir = await getTemporaryDirectory();
    final stamp = DateTime.now().toIso8601String().substring(0, 10);
    final file = File(
      '${dir.path}/market-prices-${widget.category}-$stamp.csv',
    );
    await file.writeAsBytes(bytes, flush: true);
    await Share.shareXFiles([XFile(file.path)]);
  }
}
