import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/agricultural_proxy.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'crop_health_chart.dart';

/// Simple crop health indicator for QuickHelp overlay
/// Shows a circular progress indicator with health percentage
class CropHealthSummaryCard extends StatefulWidget {
  final String region;

  const CropHealthSummaryCard({
    super.key,
    this.region = 'El Salvador',
  });

  @override
  State<CropHealthSummaryCard> createState() => _CropHealthSummaryCardState();
}

class _CropHealthSummaryCardState extends State<CropHealthSummaryCard> {
  final AgriculturalProxy _agriculturalProxy = AgriculturalProxy();
  Map<String, dynamic>? _healthData;
  bool _isLoading = true;
  String _currentLangCode = '';

  @override
  void initState() {
    super.initState();
    _currentLangCode = I18nService().currentLocale.languageCode;
    I18nService().addListener(_onLanguageChange);
    _loadData();
  }

  @override
  void dispose() {
    I18nService().removeListener(_onLanguageChange);
    super.dispose();
  }

  void _onLanguageChange() {
    final newCode = I18nService().currentLocale.languageCode;
    if (newCode != _currentLangCode) {
      setState(() {
        _currentLangCode = newCode;
      });
    }
  }

  Future<void> _loadData() async {
    try {
      final data = await _agriculturalProxy.getCropHealth(region: widget.region);
      if (mounted) {
        setState(() {
          _healthData = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      // Silently fail - show default state
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  double get _healthPercent {
    if (_healthData == null) return 0.0;
    final average = _healthData!['average'] as Map<String, dynamic>?;
    if (average == null) return 0.0;
    final ndvi = average['ndvi'] as num?;
    if (ndvi == null) return 0.0;
    // Convert NDVI (0-1 scale) to percentage
    return (ndvi * 100).toDouble();
  }

  Map<String, int> get _healthBreakdown {
    if (_healthData == null) return {'good': 0, 'moderate': 0, 'warning': 0};
    final data = _healthData!['data'] as List<dynamic>?;
    if (data == null) return {'good': 0, 'moderate': 0, 'warning': 0};
    return {
      'good': data.where((d) => d['health'] == 'good').length,
      'moderate': data.where((d) => d['health'] == 'moderate').length,
      'warning': data.where((d) => d['health'] == 'warning').length,
    };
  }

  String get _overallHealth {
    if (_healthData == null) return 'unknown';
    final data = _healthData!['data'] as List<dynamic>?;
    if (data == null || data.isEmpty) return 'unknown';

    final warnings = data.where((d) => d['health'] == 'warning').length;
    final good = data.where((d) => d['health'] == 'good').length;

    if (warnings >= 2) return 'warning';
    if (good >= data.length - 1) return 'good';
    return 'moderate';
  }

  String get _healthLabel {
    final health = _overallHealth;
    switch (health) {
      case 'good':
        return 'Good';
      case 'moderate':
        return 'Moderate';
      case 'warning':
        return 'Warning';
      default:
        return 'Unknown';
    }
  }

  Color get _healthColor {
    final health = _overallHealth;
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return InkWell(
      onTap: () => _showFullChart(context),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 70,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isDark ? Colors.grey.shade800 : Colors.grey.shade100,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: _healthColor.withValues(alpha: 0.5),
            width: 2,
          ),
        ),
        child: _isLoading
            ? Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(_healthColor),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    'Loading...',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                ],
              )
            : Row(
                children: [
                  // Donut chart with health breakdown
                  SizedBox(
                    width: 45,
                    height: 45,
                    child: CustomPaint(
                      painter: _HealthDonutPainter(
                        breakdown: _healthBreakdown,
                        total: _healthData != null
                            ? (_healthData!['data'] as List<dynamic>?)?.length ?? 0
                            : 0,
                        backgroundColor: isDark
                            ? Colors.grey.shade700
                            : Colors.grey.shade300,
                      ),
                      child: Center(
                        child: Text(
                          _healthPercent.toInt().toString(),
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: _healthColor,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          tr('charts.cropHealth'),
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 10,
                            color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _healthLabel,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: _healthColor,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.arrow_forward_ios,
                    size: 14,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                  ),
                ],
              ),
      ),
    );
  }

  void _showFullChart(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        child: SizedBox(
          width: MediaQuery.of(context).size.width * 0.95,
          height: MediaQuery.of(context).size.height * 0.85,
          child: Column(
            children: [
              // Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${tr('charts.cropHealth')} - ${tr('charts.details')}',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              // Chart content - make scrollable
              Expanded(
                child: SingleChildScrollView(
                  child: CropHealthChart(region: widget.region, compact: true),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HealthDonutPainter extends CustomPainter {
  final Map<String, int> breakdown;
  final int total;
  final Color backgroundColor;

  _HealthDonutPainter({
    required this.breakdown,
    required this.total,
    required this.backgroundColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 2;
    final strokeWidth = 4.0;

    // Draw background circle
    final backgroundPaint = Paint()
      ..color = backgroundColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, radius, backgroundPaint);

    if (total == 0) return;

    // Define colors for each health status
    final colors = {
      'good': Colors.green,
      'moderate': Colors.orange,
      'warning': Colors.red,
    };

    // Calculate and draw each segment
    double startAngle = -math.pi / 2; // Start from top
    final sweepAnglePerItem = (2 * math.pi) / total;

    breakdown.forEach((status, count) {
      if (count == 0) return;

      final paint = Paint()
        ..color = colors[status] ?? Colors.grey
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round;

      final sweepAngle = count * sweepAnglePerItem;

      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        startAngle,
        sweepAngle,
        false,
        paint,
      );

      startAngle += sweepAngle;
    });
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
