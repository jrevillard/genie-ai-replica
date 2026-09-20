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

  group('bottomTickIntervalMs (S6)', () {
    test('monthly ticks for spans up to 24 months', () {
      final i = bottomTickIntervalMs(DateTime(2023, 1), DateTime(2024, 12));
      expect(i, const Duration(days: 31).inMilliseconds.toDouble());
    });

    test('yearly to 5-yearly as the span grows', () {
      final yearly = bottomTickIntervalMs(DateTime(2015, 1), DateTime(2024, 6));
      expect(yearly, const Duration(days: 366).inMilliseconds.toDouble());
      final five = bottomTickIntervalMs(DateTime(2000, 1), DateTime(2024, 6));
      expect(five, const Duration(days: 366 * 5).inMilliseconds.toDouble());
    });
  });

  group('computeYAxis (S8) — spec section 14 test 4', () {
    test('chicken/beef 0.3-8.21 gives yMin 0, yMax 12.32', () {
      final a = computeYAxis(0.3, 8.21);
      expect(a.yMin, 0.0);
      expect(a.yMax, 12.32);
      expect(a.step, 1.0);
    });

    test('negative data keeps the unclamped floor', () {
      final a = computeYAxis(-5.0, -1.0);
      expect(a.yMin, lessThan(0));
      expect(a.yMax, -1.5); // -1 * 1.5
    });

    test('flat series do not divide by zero', () {
      final a = computeYAxis(7.0, 7.0);
      expect(a.step, greaterThanOrEqualTo(1));
      expect(a.yMax, 10.5);
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
