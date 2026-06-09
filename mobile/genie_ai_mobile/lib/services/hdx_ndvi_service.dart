import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:csv/csv.dart';

/// HDX NDVI Service
///
/// Fetches NDVI (Normalized Difference Vegetation Index) data from
/// Humanitarian Data Exchange (HDX) - El Salvador dataset.
///
/// Data Source: WFP (World Food Programme)
/// Satellite Data: NASA MODIS Collection 6.1
/// Dataset: https://data.humdata.org/dataset/slv-ndvi-subnational
///
/// Features:
/// - Direct CSV download (no API key required)
/// - Municipality-level data aggregated to departments
/// - Update checking and automatic refresh
/// - Offline caching with file persistence
class HdxNdviService {
  // HDX Dataset URLs
  static const String _datasetUrl =
      'https://data.humdata.org/dataset/slv-ndvi-subnational';
  static const String _csvUrl =
      'https://data.humdata.org/dataset/slv-ndvi-subnational/resource/2151cc86-c933-440d-b6ad-4de7e9dfc115/download/slv-ndvi-adm2-5ytd.csv';

  // SharedPreferences keys
  static const String _lastUpdateKey = 'hdx_last_update';
  static const String _lastModifiedKey = 'hdx_last_modified';
  static const String _cachedDataKey = 'hdx_cached_data';

  // El Salvador departments (ADM1) mapping from municipalities (ADM2)
  // Simplified mapping - includes major municipalities for each department
  static const Map<String, List<String>> _departmentToMunicipalities = {
    'San Salvador': [
      'San Salvador',
      'Mejicanos',
      'Santa Tecla',
      'Apopa',
      'Soyapango',
      'Ilopango',
    ],
    'La Libertad': [
      'Santa Tecla',
      'Nueva San Salvador',
      'Antiguo Cuscatlán',
      'Huizúcar',
    ],
    'San Miguel': [
      'San Miguel',
      'Moncagua',
      'Chinameca',
    ],
    'Santa Ana': [
      'Santa Ana',
      'Chalchuapa',
      'Metapán',
      'Coatepeque',
    ],
    'Usulután': [
      'Usulután',
      'Jiquilisco',
      'Puerto El Triunfo',
    ],
    'La Unión': [
      'La Unión',
      'Conchagua',
      'San Alejo',
    ],
    'Chalatenango': [
      'Chalatenango',
      'Agua Caliente',
      'Nombre de Jesús',
    ],
  };

  /// Get NDVI data for El Salvador departments
  ///
  /// [checkForUpdates] - If true, checks HDX for newer data before returning cached data
  /// [forceRefresh] - If true, downloads fresh data even if cache is valid
  Future<Map<String, dynamic>> getCropHealthData({
    String region = 'El Salvador',
    bool checkForUpdates = false,
    bool forceRefresh = false,
  }) async {
    try {
      print('[HDX NDVI] Fetching crop health data for $region');

      // Check if we need to look for updates
      if (checkForUpdates) {
        await _checkForUpdates();
      }

      // Try to load from cache first
      if (!forceRefresh) {
        final cachedData = await _loadCachedData();
        if (cachedData != null) {
          print('[HDX NDVI] Returning cached data');
          return cachedData;
        }
      }

      // Download fresh data
      print('[HDX NDVI] Downloading fresh data from HDX');
      final data = await _downloadAndParseCSV();

      // Save to cache
      await _saveCachedData(data);
      await _saveLastUpdateTimestamp();

      return data;
    } catch (e) {
      print('[HDX NDVI] Error: $e');

      // Try to return cached data even on error
      final cachedData = await _loadCachedData();
      if (cachedData != null) {
        print('[HDX NDVI] Returning cached data due to error');
        return cachedData;
      }

      // If no cache, return mock data
      return _getMockData();
    }
  }

  /// Check for updates on HDX
  ///
  /// Returns true if new data is available, false otherwise
  Future<bool> checkForUpdates() async {
    return await _checkForUpdates();
  }

  /// Internal method to check HDX for dataset updates
  Future<bool> _checkForUpdates() async {
    try {
      print('[HDX NDVI] Checking for updates...');

      // Fetch the dataset page to get the last modified date
      final response = await http
          .get(Uri.parse(_datasetUrl))
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        // Look for the "Modified" date in the HTML
        // HDX typically shows this as "Modified: <date>"
        final html = response.body;

        // Extract date from HTML (look for common patterns)
        String? modifiedDate;
        final patterns = [
          RegExp(r'"modified":\s*"([^"]+)"'),
          RegExp(r'Modified:\s*(\d{4}-\d{2}-\d{2})'),
          RegExp(r'data-last-modified="([^"]+)"'),
        ];

        for (final pattern in patterns) {
          final match = pattern.firstMatch(html);
          if (match != null) {
            modifiedDate = match.group(1);
            break;
          }
        }

        if (modifiedDate != null) {
          final prefs = await SharedPreferences.getInstance();
          final lastKnownModified = prefs.getString(_lastModifiedKey);

          if (lastKnownModified != modifiedDate) {
            print('[HDX NDVI] New data available! Modified: $modifiedDate');
            await prefs.setString(_lastModifiedKey, modifiedDate);
            return true;
          } else {
            print('[HDX NDVI] Data is up to date. Modified: $modifiedDate');
            return false;
          }
        }
      }

      print('[HDX NDVI] Could not determine last modified date');
      return false;
    } catch (e) {
      print('[HDX NDVI] Error checking for updates: $e');
      return false;
    }
  }

  /// Download and parse the HDX CSV file
  Future<Map<String, dynamic>> _downloadAndParseCSV() async {
    try {
      // Download CSV
      final response =
          await http.get(Uri.parse(_csvUrl)).timeout(const Duration(seconds: 60));

      if (response.statusCode != 200) {
        throw Exception('Failed to download CSV: ${response.statusCode}');
      }

      // Parse CSV
      final csvString = utf8.decode(response.bodyBytes);
      final rows = const CsvToListConverter().convert(csvString);

      if (rows.isEmpty) {
        throw Exception('CSV file is empty');
      }

      // Extract headers (skip first row)
      final headers = rows[0] as List<dynamic>;
      print('[HDX NDVI] CSV has ${rows.length} rows, ${headers.length} columns');

      // Parse data rows
      final deptData = <String, List<double>>{};
      final deptRecords = <String, List<Map<String, dynamic>>>{};

      // Initialize department data
      for (final dept in _departmentToMunicipalities.keys) {
        deptData[dept] = [];
        deptRecords[dept] = [];
      }

      // Process data rows (skip header row)
      for (var i = 1; i < rows.length; i++) {
        final row = rows[i] as List<dynamic>;

        if (row.length < 5) continue;

        // Extract data from columns
        // Expected columns based on HDX dataset:
        // admin0, admin1, admin2, date, vim, vim_lta, viq, n_pixels
        final admin0 = row[0]?.toString() ?? '';
        final admin1 = row[1]?.toString() ?? ''; // Department
        final admin2 = row[2]?.toString() ?? ''; // Municipality
        final date = row[3]?.toString() ?? '';
        final vim = _parseDouble(row[4]); // NDVI value
        final vim_lta = _parseDouble(row[5]); // Long-term average
        final viq = _parseDouble(row[6]); // Anomaly %

        if (admin0 == 'El Salvador' && vim != null) {
          // Find which department this municipality belongs to
          String? targetDept;
          for (final entry in _departmentToMunicipalities.entries) {
            if (entry.value.contains(admin2) ||
                admin1.contains(entry.key)) {
              targetDept = entry.key;
              break;
            }
          }

          if (targetDept != null) {
            deptData[targetDept]!.add(vim);

            // Calculate trend if we have long-term average
            String trend = 'stable';
            double? change;
            if (vim_lta != null) {
              final diff = ((vim - vim_lta) / vim_lta) * 100;
              change = double.parse(diff.toStringAsFixed(1));
              if (diff > 2) {
                trend = 'improving';
              } else if (diff < -2) {
                trend = 'declining';
              }
            }

            deptRecords[targetDept]!.add({
              'department': targetDept,
              'municipality': admin2,
              'date': date,
              'ndvi': double.parse(vim.toStringAsFixed(3)),
              'trend': trend,
              if (change != null) 'change': change,
              'health': _getHealthStatus(vim),
            });
          }
        }
      }

      // Calculate department-level summaries
      final departmentSummaries = <Map<String, dynamic>>[];

      for (final entry in deptRecords.entries) {
        final dept = entry.key;
        final records = entry.value;

        if (records.isEmpty) continue;

        // Calculate average NDVI
        final avgNdvi = deptData[dept]!.reduce((a, b) => a + b) / deptData[dept]!.length;

        // Get most recent record
        final mostRecent = records.last;

        departmentSummaries.add({
          'department': dept,
          'ndvi': double.parse(avgNdvi.toStringAsFixed(3)),
          'trend': mostRecent['trend'],
          'change': mostRecent['change'] ?? 0.0,
          'health': _getHealthStatus(avgNdvi),
        });
      }

      // Calculate overall average
      final allNdvi = deptData.values.expand((e) => e).toList();
      final overallAvg = allNdvi.isEmpty
          ? 0.0
          : allNdvi.reduce((a, b) => a + b) / allNdvi.length;

      // Calculate overall trend
      final overallTrend = departmentSummaries.isEmpty
          ? 'stable'
          : _getOverallTrend(departmentSummaries);

      return {
        'region': 'El Salvador',
        'timeRange': '5ytd',
        'dataSource': 'HDX (NASA MODIS via WFP)',
        'data': departmentSummaries,
        'average': {
          'ndvi': double.parse(overallAvg.toStringAsFixed(3)),
          'trend': overallTrend,
          'change': 0.0,
        },
        'lastUpdate': DateTime.now().toIso8601String(),
      };
    } catch (e) {
      print('[HDX NDVI] Error parsing CSV: $e');
      rethrow;
    }
  }

  /// Parse double from dynamic value
  double? _parseDouble(dynamic value) {
    if (value == null) return null;
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  /// Determine health status based on NDVI value
  String _getHealthStatus(double ndvi) {
    if (ndvi >= 0.65) return 'good';
    if (ndvi >= 0.50) return 'moderate';
    return 'warning';
  }

  /// Calculate overall trend from department summaries
  String _getOverallTrend(List<Map<String, dynamic>> departments) {
    int improving = 0;
    int declining = 0;

    for (final dept in departments) {
      final trend = dept['trend'] as String;
      if (trend == 'improving') improving++;
      if (trend == 'declining') declining++;
    }

    if (improving > declining) return 'improving';
    if (declining > improving) return 'declining';
    return 'stable';
  }

  /// Load cached data from SharedPreferences
  Future<Map<String, dynamic>?> _loadCachedData() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cachedJson = prefs.getString(_cachedDataKey);

      if (cachedJson != null) {
        final data = json.decode(cachedJson) as Map<String, dynamic>;

        // Check if cache is still valid (7 days)
        final lastUpdate = data['lastUpdate'] as String?;
        if (lastUpdate != null) {
          final lastUpdateDate = DateTime.parse(lastUpdate);
          final age = DateTime.now().difference(lastUpdateDate);

          if (age.inDays < 7) {
            return data;
          } else {
            print('[HDX NDVI] Cached data is too old (${age.inDays} days)');
          }
        }
      }

      return null;
    } catch (e) {
      print('[HDX NDVI] Error loading cached data: $e');
      return null;
    }
  }

  /// Save data to cache
  Future<void> _saveCachedData(Map<String, dynamic> data) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonStr = json.encode(data);
      await prefs.setString(_cachedDataKey, jsonStr);
      print('[HDX NDVI] Data cached successfully');
    } catch (e) {
      print('[HDX NDVI] Error saving cached data: $e');
    }
  }

  /// Save last update timestamp
  Future<void> _saveLastUpdateTimestamp() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_lastUpdateKey, DateTime.now().toIso8601String());
    } catch (e) {
      print('[HDX NDVI] Error saving timestamp: $e');
    }
  }

  /// Mock data when all else fails
  Map<String, dynamic> _getMockData() {
    return {
      'region': 'El Salvador',
      'timeRange': '5ytd',
      'dataSource': 'HDX (mock - data unavailable)',
      'offline': true,
      'data': [
        {
          'department': 'San Salvador',
          'ndvi': 0.72,
          'trend': 'stable',
          'change': 0.5,
          'health': 'good',
        },
        {
          'department': 'La Libertad',
          'ndvi': 0.68,
          'trend': 'improving',
          'change': 2.1,
          'health': 'good',
        },
        {
          'department': 'San Miguel',
          'ndvi': 0.55,
          'trend': 'declining',
          'change': -3.2,
          'health': 'moderate',
        },
        {
          'department': 'Santa Ana',
          'ndvi': 0.71,
          'trend': 'stable',
          'change': 1.0,
          'health': 'good',
        },
        {
          'department': 'Usulután',
          'ndvi': 0.48,
          'trend': 'declining',
          'change': -5.1,
          'health': 'warning',
        },
        {
          'department': 'La Unión',
          'ndvi': 0.52,
          'trend': 'stable',
          'change': -0.8,
          'health': 'moderate',
        },
        {
          'department': 'Chalatenango',
          'ndvi': 0.65,
          'trend': 'improving',
          'change': 1.8,
          'health': 'good',
        },
      ],
      'average': {
        'ndvi': 0.63,
        'trend': 'stable',
        'change': -0.8,
      },
      'message': 'Unable to fetch HDX data. Please check your connection.',
    };
  }

  /// Clear cached data
  Future<void> clearCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_cachedDataKey);
      await prefs.remove(_lastUpdateKey);
      print('[HDX NDVI] Cache cleared');
    } catch (e) {
      print('[HDX NDVI] Error clearing cache: $e');
    }
  }

  /// Get cache information
  Future<Map<String, dynamic>> getCacheInfo() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final lastUpdate = prefs.getString(_lastUpdateKey);
      final lastModified = prefs.getString(_lastModifiedKey);
      final hasCachedData = prefs.containsKey(_cachedDataKey);

      return {
        'hasCachedData': hasCachedData,
        'lastUpdate': lastUpdate,
        'lastKnownModified': lastModified,
        'maxCacheAge': '7 days',
        'datasetUrl': _datasetUrl,
      };
    } catch (e) {
      return {
        'error': e.toString(),
      };
    }
  }
}
