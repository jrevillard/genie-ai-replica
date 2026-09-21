import 'package:flutter/material.dart';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:genie_ai_mobile/components/charts/series_chart_core.dart';

void main() {
  group('parseAgriDate (S5)', () {
    test('accepts YYYY-MM-DD, YYYY-MM, YYYY', () {
      expect(parseAgriDate('2024-03-15'), DateTime(2024, 3, 15));
      expect(parseAgriDate('2024-03'), DateTime(2024, 3, 1));
      expect(parseAgriDate('2024'), DateTime(2024, 1, 1));
    });

    test('rejects unparseable input', () {
      expect(parseAgriDate(null), isNull);
      expect(parseAgriDate(''), isNull);
      expect(parseAgriDate('not-a-date'), isNull);
      expect(parseAgriDate('2024-13-01'), isNull); // month 13
      expect(parseAgriDate('15/03/2024'), isNull);
    });
  });

  group('seriesToSpots (S5)', () {
    test('drops unparseable dates and null/non-finite values', () {
      final spots = seriesToSpots([
        {'date': '2024-01-31', 'value': 1.5},
        {'date': 'bad', 'value': 2.0},
        {'date': '2024-02-29', 'value': null},
        {'date': '2024-03-15', 'value': double.nan},
        {'date': '2024-04-30', 'value': 3.0},
      ]);
      expect(spots.length, 2);
      expect(spots[0].date, DateTime(2024, 1, 31));
      expect(spots[0].value, 1.5);
      expect(spots[1].date, DateTime(2024, 4, 30));
    });

    test('date-keyed, not index-keyed', () {
      final spots = seriesToSpots([
        {'date': '2020-06-01', 'value': 9.0},
        {'date': '2024-01-01', 'value': 1.0},
      ]);
      expect(spots.first.date.year, 2020);
      expect(
        spots.first.date.millisecondsSinceEpoch,
        lessThan(spots.last.date.millisecondsSinceEpoch),
      );
    });
  });

  group('computeXWindow (S6)', () {
    test('union min/max across active series', () {
      final a = seriesToSpots([
        {'date': '2020-01-01', 'value': 1},
        {'date': '2023-06-01', 'value': 2},
      ]);
      final b = seriesToSpots([
        {'date': '2019-05-01', 'value': 3},
        {'date': '2024-02-01', 'value': 4},
      ]);
      final w = computeXWindow([a, b]);
      expect(w.minX, DateTime(2019, 5).millisecondsSinceEpoch.toDouble());
      expect(w.maxX, DateTime(2024, 2).millisecondsSinceEpoch.toDouble());
    });
  });

  group('bottomTickIntervalMs (S6) — X label density survives zooming', () {
    /// How many ticks land inside the window, for the given bounds.
    int ticksIn(int y1, int m1, int y2, int m2) {
      final a = DateTime(y1, m1);
      final b = DateTime(y2, m2);
      final span = b.difference(a).inMilliseconds.toDouble();
      return (span / bottomTickIntervalMs(a, b)).ceil();
    }

    test('a long history gets multi-year, not monthly, ticks', () {
      final i = bottomTickIntervalMs(DateTime(2000, 1), DateTime(2024, 6));
      expect(i, greaterThan(const Duration(days: 366 * 4).inMilliseconds));
      expect(ticksIn(2000, 1, 2024, 6), lessThanOrEqualTo(7));
    });

    test('no window crowds the labels (regression)', () {
      // A 23-month window used to return a flat 31-day step, drawing ~23
      // overlapping "MMM yy" labels when the user zoomed in. Every window
      // must now stay at 7 ticks or fewer.
      const windows = [
        [2024, 1, 2024, 3], //  2 months
        [2024, 1, 2025, 1], // 12 months
        [2023, 1, 2024, 12], // 23 months (the reported case)
        [2018, 1, 2024, 6], // 65 months
        [2015, 1, 2024, 6], // 113 months
        [2000, 1, 2024, 6], // 293 months
        [1991, 1, 2026, 9], // 425 months
      ];
      for (final w in windows) {
        final ticks = ticksIn(w[0], w[1], w[2], w[3]);
        expect(
          ticks,
          inInclusiveRange(1, 7),
          reason: '${w[0]}-${w[1]} .. ${w[2]}-${w[3]} drew $ticks X ticks',
        );
      }
    });

    test('zooming in shortens the step, so the axis follows the zoom', () {
      final wide = bottomTickIntervalMs(DateTime(1991, 1), DateTime(2026, 9));
      final mid = bottomTickIntervalMs(DateTime(2015, 1), DateTime(2024, 6));
      final tight = bottomTickIntervalMs(DateTime(2024, 1), DateTime(2024, 3));
      expect(mid, lessThan(wide));
      expect(tight, lessThan(mid));
    });

    test('years give way to QUARTERS, not straight to months', () {
      // The reported crowding: a year-wide window stepped monthly.
      expect(bottomTickStepMonths(DateTime(2024, 1), DateTime(2025, 1)), 3);
      expect(bottomTickStepMonths(DateTime(2024, 1), DateTime(2025, 9)), 3);
      // Only a genuinely short window drops to monthly.
      expect(bottomTickStepMonths(DateTime(2024, 1), DateTime(2024, 6)), 1);
      expect(bottomTickStepMonths(DateTime(2000, 1), DateTime(2024, 6)), 60);
    });

    test('label pattern narrows with the step (letters only)', () {
      expect(bottomTickLabelPattern(120), 'yyyy');
      expect(bottomTickLabelPattern(12), 'yyyy');
      expect(bottomTickLabelPattern(6), 'MMM'); // quarterly: "Jan"
      expect(bottomTickLabelPattern(3), 'MMM');
      expect(bottomTickLabelPattern(1), 'MMMMM'); // monthly: "J"
    });
  });

  group('computeYAxis (S8) — axis tops out 20% above the data max', () {
    test('chicken/beef 0.3-8.21 gives yMin 0, yMax 9.85, step 2', () {
      final a = computeYAxis(0.3, 8.21);
      expect(a.yMin, 0.0);
      expect(a.yMax, 9.85); // 8.21 * 1.2, 2-dp rounded
      expect(a.step, 2.0); // nice step ~= drawn span / 5
    });

    test('negative data keeps the unclamped floor', () {
      final a = computeYAxis(-5.0, -1.0);
      expect(a.yMin, lessThan(0));
      expect(a.yMax, -1.2); // -1 * 1.2
    });

    test('flat series do not divide by zero', () {
      final a = computeYAxis(7.0, 7.0);
      expect(a.step, greaterThanOrEqualTo(1));
      expect(a.yMax, 8.4);
    });

    test('dense ranges stay sparse (Crop Protection / Harvest & Storage)', () {
      // range 20, yMax 33.6 -> span 25.6 -> step 10: four gridlines.
      // The old floor-based step picked 1 here -> ~29 gridlines.
      final a = computeYAxis(8.0, 28.0);
      expect(a.step, 10.0);
      expect(a.yMin, 0.0);
      final gridlines = ((a.yMax - a.yMin) / a.step).ceil();
      expect(gridlines, lessThanOrEqualTo(6));
    });

    test('gridline count stays sparse across real agri ranges', () {
      // (min, max) pairs roughly matching the live series: grain prices,
      // PPI/BLS indices, SDG percentages, WFP index values.
      const cases = [
        (170.0, 200.0), // cropProtection index
        (5.0, 25.0), // harvest & storage %
        (8.0, 28.0), // storage lower band
        (1200.0, 1800.0), // fertilizer USD/mt
        (0.3, 8.21), // livestock USD/kg
        (2.5, 4.0), // aquaculture USD/lb
      ];
      for (final (lo, hi) in cases) {
        final a = computeYAxis(lo, hi);
        final gridlines = ((a.yMax - a.yMin) / a.step).ceil();
        expect(
          gridlines,
          inInclusiveRange(3, 12),
          reason: '($lo, $hi) produced $gridlines gridlines at step ${a.step}',
        );
      }
    });
  });

  group('AgriPalette (S3/S4) — spec section 14 test 3', () {
    final palette = AgriPalette([
      Colors.green,
      Colors.orange,
      Colors.grey,
      Colors.blue,
      Colors.red,
    ]);

    test('color keyed to ORIGINAL index, immune to visibility changes', () {
      final before = palette.colorForSeriesIndex(2);
      // Simulate hiding series[1]: the visible list shifts, but the
      // palette lookup must stay keyed to the original index.
      final visibleIndices = [0, 2, 3, 4];
      final after = palette.colorForSeriesIndex(visibleIndices[1]);
      expect(after, before);
      expect(palette.colorForSeriesIndex(7), palette.slots[2]); // wraps
    });

    test('estimated overlay color is always slot1 (warning)', () {
      expect(palette.estimatedColor, Colors.orange);
    });
  });

  group('latest helpers (S11/S12)', () {
    test('latestPoint returns the last finite point', () {
      final spots = seriesToSpots([
        {'date': '2024-01-31', 'value': 1.5},
        {'date': '2024-02-29', 'value': 2.5},
      ]);
      expect(latestPoint(spots)!.value, 2.5);
      expect(latestPoint(<FlSpotLite>[]), isNull);
    });

    test('latestTooltipText matches the exact S12 template', () {
      expect(
        latestTooltipText(
          fullSeriesName: 'Maize (white)',
          value: 123.456,
          unit: 'USD/mt',
        ),
        'Latest month-end price of Maize (white) — 123.46 USD/mt',
      );
      expect(
        latestTooltipText(fullSeriesName: 'X', value: 1, unit: ''),
        'Latest month-end price of X — 1.00',
      );
    });
  });

  group('chartHeightFor (S10)', () {
    test('scales with active series, floored at 320', () {
      expect(chartHeightFor(0), 320);
      expect(chartHeightFor(1), 320); // 240+45=285 -> 320 floor
      expect(chartHeightFor(4), 420);
      expect(chartHeightFor(15), 915);
    });
  });
  group('S16/S25 toggle guards (section 14 test 5)', () {
    test('unchecking the last active series is locked', () {
      expect(
        toggleLocked(activeCount: 1, isHidden: false),
        isTrue,
        reason: 'the last active series must be locked',
      );
      expect(toggleLocked(activeCount: 3, isHidden: false), isFalse);
      expect(
        toggleLocked(activeCount: 1, isHidden: true),
        isFalse,
        reason: 're-showing is always allowed',
      );
    });

    test('family master hide disabled when it would empty the chart', () {
      expect(masterHideDisabled(activeOutsideFamily: 0), isTrue);
      expect(masterHideDisabled(activeOutsideFamily: 2), isFalse);
    });
  });

  group('S17 start-year (section 14 test 6)', () {
    test('options descend from max(earliest, currentYear-5) to earliest', () {
      final opts = startYearOptions(1991, 2026);
      expect(opts.first, 2021);
      expect(opts.last, 1991);
      expect(opts.length, 31);
      expect(opts, orderedEquals([for (var y = 2021; y >= 1991; y--) y]));
    });

    test('short history clamps the top to earliest', () {
      final opts = startYearOptions(2024, 2026);
      expect(opts, [2024]);
    });

    test('default 2015 clamps UP to the earliest data year', () {
      expect(defaultStartYear(1991), 2015);
      expect(defaultStartYear(2024), 2024);
    });
  });

  group('S19 table rows (section 14 test 7)', () {
    test('union dates ascending, empty cells for missing, primary quality', () {
      final a = seriesToSpots([
        {'date': '2024-01-01', 'value': 1.0},
        {'date': '2024-03-01', 'value': 3.0, 'quality': 'estimated'},
      ]);
      final b = seriesToSpots([
        {'date': '2024-02-01', 'value': 2.0},
        {'date': '2024-03-01', 'value': 9.0},
      ]);
      final rows = buildTableRows([a, b]);
      expect(rows.length, 3);
      expect(rows[0].date, DateTime(2024, 1, 1));
      expect(rows[0].values, [1.0, null]);
      expect(rows[1].date, DateTime(2024, 2, 1));
      expect(rows[1].values, [null, 2.0]);
      expect(rows[2].values, [3.0, 9.0]);
      expect(rows[2].primaryQuality, 'estimated');
      expect(rows[0].primaryQuality, isNull);
    });
  });

  group('S20 CSV', () {
    test('BOM + CRLF + RFC4180 quoting + empty cells', () {
      final a = seriesToSpots([
        {'date': '2024-01-01', 'value': 1.5},
        {'date': '2024-02-01', 'value': 2.0, 'quality': 'estimated'},
      ]);
      final rows = buildTableRows([a]);
      String fmt(DateTime d) =>
          '${d.year.toString().padLeft(4, '0')}-'
          '${d.month.toString().padLeft(2, '0')}-'
          '${d.day.toString().padLeft(2, '0')}';
      final bytes = csvFileBytes(
        // 'Maize, white' carries a real comma -> must be quoted; the
        // comma-less 'X (USD/mt)' header must stay unquoted.
        headers: ['Period', 'Maize, white (USD/mt)', 'X (USD/mt)'],
        rows: rows,
        formatDate: fmt,
        qualityLabel: (q) => q == 'estimated' ? 'Estimated' : 'Actual',
      );
      expect(bytes.take(3).toList(), [
        0xEF,
        0xBB,
        0xBF,
      ], reason: 'UTF-8 BOM required');
      final text = utf8.decode(bytes);
      expect(text.contains('\r\n'), isTrue, reason: 'CRLF endings required');
      expect(
        text,
        contains('"Maize, white (USD/mt)"'),
        reason: 'fields containing commas must be quoted',
      );
      expect(text, contains('Period,"Maize, white (USD/mt)",X (USD/mt)'));
      expect(text, contains('2024-01-01,1.50,Actual'));
      expect(text, contains('2024-02-01,2,Estimated'));
    });
  });
}
