import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:genie_ai_mobile/services/agricultural_proxy.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

/// Crop Health Chart Widget
///
/// Displays NDVI (Normalized Difference Vegetation Index) data
/// across different departments using FL Chart's LineChart.
class CropHealthChart extends StatefulWidget {
  final String region;
  final bool autoRefresh;
  final Duration refreshInterval;
  final bool compact;

  const CropHealthChart({
    super.key,
    this.region = 'El Salvador',
    this.autoRefresh = false,
    this.refreshInterval = const Duration(minutes: 5),
    this.compact = false,
  });

  @override
  State<CropHealthChart> createState() => _CropHealthChartState();
}

class _CropHealthChartState extends State<CropHealthChart> {
  final AgriculturalProxy _agriculturalProxy = AgriculturalProxy();
  Map<String, dynamic>? _cropData;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCropHealthData();
    if (widget.autoRefresh) {
      Future.delayed(widget.refreshInterval, () {
        if (mounted) _loadCropHealthData();
      });
    }
  }

  Future<void> _loadCropHealthData() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await _agriculturalProxy.getCropHealth(
        region: widget.region,
      );
      setState(() {
        _cropData = data;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = I18nService().currentLocale.languageCode == 'es'
            ? 'Error al cargar datos'
            : 'Failed to load data';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Card(
      elevation: 2,
      margin: widget.compact
          ? const EdgeInsets.symmetric(horizontal: 8, vertical: 4)
          : const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: widget.compact
            ? const EdgeInsets.all(12)
            : const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _translate('charts.cropHealthTitle') ??
                            'Crop Health - NDVI Index',
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _translate('charts.cropHealthSubtitle') ??
                            'Vegetation health across departments',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.7,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (!_loading)
                  IconButton(
                    icon: const Icon(Icons.refresh),
                    onPressed: _loadCropHealthData,
                    tooltip: _translate('charts.refresh') ?? 'Refresh',
                  ),
              ],
            ),
            const SizedBox(height: 20),

            // Loading State
            if (_loading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(40),
                  child: CircularProgressIndicator(),
                ),
              ),

            // Error State
            if (_error != null)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      Icon(
                        Icons.error_outline,
                        size: 48,
                        color: theme.colorScheme.error,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        style: TextStyle(color: theme.colorScheme.error),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),

            // Chart Content
            if (!_loading && _cropData != null) ...[
              // NDVI Line Chart
              SizedBox(
                height: 200,
                child: LineChart(
                  LineChartData(
                    gridData: FlGridData(
                      show: true,
                      drawVerticalLine: false,
                      getDrawingHorizontalLine: (value) {
                        return FlLine(
                          color: isDark
                              ? Colors.white.withValues(alpha: 0.1)
                              : Colors.black.withValues(alpha: 0.1),
                          strokeWidth: 1,
                        );
                      },
                    ),
                    titlesData: FlTitlesData(
                      show: true,
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 60,
                          getTitlesWidget: (value, meta) {
                            final departments =
                                _cropData!['data'] as List<dynamic>;
                            if (value.toInt() >= 0 &&
                                value.toInt() < departments.length) {
                              final dept = departments[value.toInt()];
                              final name = dept['department'] as String;
                              // Show first 3 chars for mobile
                              return Padding(
                                padding: const EdgeInsets.only(top: 8.0),
                                child: Text(
                                  name.length > 8
                                      ? '${name.substring(0, 6)}...'
                                      : name,
                                  style: TextStyle(
                                    fontSize: 9,
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.7),
                                  ),
                                ),
                              );
                            }
                            return const SizedBox.shrink();
                          },
                        ),
                      ),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 35,
                          getTitlesWidget: (value, meta) {
                            if (value >= 0 && value <= 1) {
                              return Text(
                                value.toStringAsFixed(1),
                                style: TextStyle(
                                  fontSize: 10,
                                  color: theme.colorScheme.onSurface.withValues(
                                    alpha: 0.7,
                                  ),
                                ),
                              );
                            }
                            return const SizedBox.shrink();
                          },
                        ),
                      ),
                      topTitles: const AxisTitles(
                        sideTitles: SideTitles(showTitles: false),
                      ),
                      rightTitles: const AxisTitles(
                        sideTitles: SideTitles(showTitles: false),
                      ),
                    ),
                    borderData: FlBorderData(show: false),
                    minX: 0,
                    maxX: (_cropData!['data'] as List<dynamic>).length - 1.0,
                    minY: 0,
                    maxY: 1,
                    lineBarsData: [
                      LineChartBarData(
                        spots: _buildSpots(),
                        isCurved: true,
                        gradient: LinearGradient(
                          colors: [
                            Colors.green.shade400,
                            Colors.green.shade700,
                          ],
                        ),
                        barWidth: 3,
                        isStrokeCapRound: true,
                        dotData: FlDotData(
                          show: true,
                          getDotPainter: (spot, percent, barData, index) {
                            final dept = _cropData!['data'][index];
                            final health = dept['health'] as String;
                            return FlDotCirclePainter(
                              radius: 5,
                              color: _getHealthColor(health),
                              strokeWidth: 2,
                              strokeColor: isDark ? Colors.white : Colors.white,
                            );
                          },
                        ),
                        belowBarData: BarAreaData(
                          show: true,
                          gradient: LinearGradient(
                            colors: [
                              Colors.green.withValues(alpha: 0.3),
                              Colors.green.withValues(alpha: 0.05),
                            ].reversed.toList(),
                          ),
                        ),
                      ),
                    ],
                    lineTouchData: LineTouchData(
                      enabled: true,
                      touchTooltipData: LineTouchTooltipData(
                        getTooltipItems: (touchedSpots) {
                          return touchedSpots.map((spot) {
                            final dept = _cropData!['data'][spot.x.toInt()];
                            final name = dept['department'] as String;
                            final ndvi = dept['ndvi'] as double;
                            return LineTooltipItem(
                              '$name\nNDVI: ${ndvi.toStringAsFixed(3)}',
                              TextStyle(
                                color: isDark ? Colors.white : Colors.black,
                                fontWeight: FontWeight.bold,
                              ),
                            );
                          }).toList();
                        },
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Summary Cards
              Row(
                children: [
                  Expanded(
                    child: _buildSummaryCard(
                      theme,
                      isDark,
                      icon: Icons.grass,
                      iconColor: Colors.green,
                      label: _translate('charts.averageNDVI') ?? 'Average NDVI',
                      value: _cropData!['average']['ndvi'].toString(),
                      trend: _cropData!['average']['trend'],
                      change: _cropData!['average']['change'],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: _buildHealthStatusCard(theme, isDark)),
                ],
              ),
              const SizedBox(height: 16),

              // Department Details
              _buildDepartmentDetails(theme, isDark),

              // Last Updated
              Center(
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.access_time,
                        size: 14,
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.5,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '${_translate('charts.lastUpdated') ?? 'Last updated'}: ${_formatDate(DateTime.now())}',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<FlSpot> _buildSpots() {
    if (_cropData == null) return [];

    final data = _cropData!['data'] as List<dynamic>;
    return List.generate(data.length, (index) {
      final item = data[index];
      final ndvi = (item['ndvi'] as num).toDouble();
      return FlSpot(index.toDouble(), ndvi);
    });
  }

  Widget _buildSummaryCard(
    ThemeData theme,
    bool isDark, {
    required IconData icon,
    required Color iconColor,
    required String label,
    required String value,
    required String trend,
    required double change,
  }) {
    final isCompact = widget.compact;

    return Container(
      padding: EdgeInsets.all(isCompact ? 8 : 12),
      decoration: BoxDecoration(
        color: isDark
            ? Colors.white.withValues(alpha: 0.05)
            : Colors.grey.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(icon, color: iconColor, size: isCompact ? 20 : 24),
          SizedBox(height: isCompact ? 4 : 8),
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              fontSize: isCompact ? 10 : null,
            ),
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          SizedBox(height: isCompact ? 2 : 4),
          Text(
            value,
            style: theme.textTheme.titleMedium?.copyWith(
              color: iconColor,
              fontWeight: FontWeight.bold,
              fontSize: isCompact ? 14 : null,
            ),
          ),
          if (!isCompact) ...[
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  _getTrendIcon(trend),
                  color: _getTrendColor(trend),
                  size: 16,
                ),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    _translate('charts.$trend')?.toUpperCase() ??
                        trend.toUpperCase(),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: _getTrendColor(trend),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                if (change != 0) ...[
                  const SizedBox(width: 2),
                  Text(
                    '(${change > 0 ? '+' : ''}${change.toStringAsFixed(1)}%)',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: _getTrendColor(trend),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildHealthStatusCard(ThemeData theme, bool isDark) {
    final health = _calculateOverallHealth();
    final healthColor = _getHealthColor(health);
    final healthLabel = _translate('charts.$health') ?? health;

    final healthyDepts = (_cropData!['data'] as List<dynamic>)
        .where((d) => d['health'] == 'good')
        .length;
    final totalDepts = (_cropData!['data'] as List<dynamic>).length;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDark
            ? Colors.white.withValues(alpha: 0.05)
            : Colors.grey.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(_getHealthIcon(health), color: healthColor, size: 24),
          const SizedBox(height: 8),
          Text(
            _translate('charts.overallHealth') ?? 'Overall Health',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 4),
          Text(
            healthLabel,
            style: theme.textTheme.titleMedium?.copyWith(
              color: healthColor,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '$healthyDepts/$totalDepts ${_translate('charts.departments') ?? 'departments'}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDepartmentDetails(ThemeData theme, bool isDark) {
    final departments = _cropData!['data'] as List<dynamic>;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _translate('charts.byDepartment') ?? 'By Department',
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 8),
        ...departments.map((dept) {
          final name = dept['department'] as String;
          final ndvi = (dept['ndvi'] as num).toDouble();
          final health = dept['health'] as String;
          final trend = dept['trend'] as String;
          final change = (dept['change'] as num).toDouble();

          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isDark
                  ? Colors.white.withValues(alpha: 0.03)
                  : Colors.grey.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(8),
              border: Border(
                left: BorderSide(color: _getHealthColor(health), width: 4),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'NDVI: ${ndvi.toStringAsFixed(3)}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.7,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Icon(
                      _getTrendIcon(trend),
                      color: _getTrendColor(trend),
                      size: 16,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${change > 0 ? '+' : ''}${change.toStringAsFixed(1)}%',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: _getTrendColor(trend),
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  String _calculateOverallHealth() {
    if (_cropData == null) return 'unknown';
    final data = _cropData!['data'] as List<dynamic>;
    final warnings = data.where((d) => d['health'] == 'warning').length;
    final good = data.where((d) => d['health'] == 'good').length;

    if (warnings >= 2) return 'warning';
    if (good >= data.length - 1) return 'good';
    return 'moderate';
  }

  Color _getHealthColor(String health) {
    switch (health) {
      case 'good':
        return Colors.green;
      case 'moderate':
        return Colors.orange;
      case 'warning':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  IconData _getHealthIcon(String health) {
    switch (health) {
      case 'good':
        return Icons.check_circle;
      case 'moderate':
        return Icons.warning;
      case 'warning':
        return Icons.error;
      default:
        return Icons.help;
    }
  }

  IconData _getTrendIcon(String trend) {
    switch (trend) {
      case 'improving':
        return Icons.arrow_upward;
      case 'declining':
        return Icons.arrow_downward;
      default:
        return Icons.remove;
    }
  }

  Color _getTrendColor(String trend) {
    switch (trend) {
      case 'improving':
        return Colors.green;
      case 'declining':
        return Colors.red;
      default:
        return Colors.amber;
    }
  }

  String? _translate(String key) {
    return tr(key);
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year} ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }
}
