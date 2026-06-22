import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/world_bank_service.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'market_price_chart.dart';

/// Market Price Summary Card
///
/// Shows a sparkline chart with latest value and trend for a specific market category
/// Tapping opens a detailed chart view
class MarketPriceSummaryCard extends StatefulWidget {
  final String category; // 'maize', 'cropProtection', 'vegetables', etc.

  const MarketPriceSummaryCard({super.key, required this.category});

  @override
  State<MarketPriceSummaryCard> createState() => _MarketPriceSummaryCardState();
}

class _MarketPriceSummaryCardState extends State<MarketPriceSummaryCard> {
  final WorldBankService _worldBankService = WorldBankService();
  Map<String, dynamic>? _priceData;
  bool _isLoading = true;
  String _currentLangCode = '';

  // Category configuration
  static const Map<String, dynamic> _categoryConfig = {
    'maize': {
      'i18nKey': 'maizeGrains',
      'icon': Icons.grass,
      'color': '#2E7D32',
    },
    'cropProtection': {
      'i18nKey': 'cropProtection',
      'icon': Icons.bug_report,
      'color': '#D84315',
    },
    'vegetables': {
      'i18nKey': 'fruitsVeggies',
      'icon': Icons.eco,
      'color': '#558B2F',
    },
    'livestock': {
      'i18nKey': 'livestock',
      'icon': Icons.pets,
      'color': '#8D6E63',
    },
    'fertilizer': {
      'i18nKey': 'fertilizer',
      'icon': Icons.compost,
      'color': '#F9A825',
    },
    'apiary': {
      'i18nKey': 'apiary',
      'icon': Icons.hexagon_outlined,
      'color': '#F57F17',
    },
    'aquaculture': {
      'i18nKey': 'aquaculture',
      'icon': Icons.set_meal,
      'color': '#0288D1',
    },
    'harvestStorage': {
      'i18nKey': 'harvestStorage',
      'icon': Icons.storage,
      'color': '#00838F',
    },
  };

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
    _worldBankService.dispose();
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
      Map<String, dynamic>? data;

      switch (widget.category) {
        case 'maize':
          data = await _worldBankService.getMaizePrices();
          break;
        case 'cropProtection':
          data = await _worldBankService.getCropProtectionCosts();
          break;
        case 'vegetables':
          data = await _worldBankService.getVegetablePrices();
          break;
        case 'livestock':
          data = await _worldBankService.getPoultryPorkFeedCosts();
          break;
        case 'fertilizer':
          data = await _worldBankService.getFertilizerPrices();
          break;
        case 'apiary':
          data = await _worldBankService.getHoneyMarketData();
          break;
        case 'aquaculture':
          data = await _worldBankService.getTilapiaMarketData();
          break;
        case 'harvestStorage':
          data = await _worldBankService.getHarvestStorageData();
          break;
      }

      if (mounted) {
        setState(() {
          _priceData = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint(
        '[MarketPriceSummaryCard] Error loading data for ${widget.category}: $e',
      );
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  String get _title {
    final config = _categoryConfig[widget.category];
    final i18nKey = config?['i18nKey'] as String?;
    return i18nKey != null ? tr('market.$i18nKey') : widget.category;
  }

  Color get _categoryColor {
    final colorHex = _categoryConfig[widget.category]?['color'] as String?;
    if (colorHex != null) {
      return Color(int.parse(colorHex.replaceFirst('#', '0xFF')));
    }
    return Colors.blue;
  }

  IconData get _categoryIcon {
    return _categoryConfig[widget.category]?['icon'] as IconData? ??
        Icons.show_chart;
  }

  List<Map<String, dynamic>> get _timeSeries {
    if (_priceData == null) return [];
    final data = _priceData!['data'] as List<dynamic>?;
    if (data == null) return [];
    return data.cast<Map<String, dynamic>>();
  }

  String get _trend {
    if (_priceData == null) return 'unknown';
    return _priceData!['trend'] as String? ?? 'unknown';
  }

  String get _latestValue {
    if (_timeSeries.isEmpty) return '--';
    final latest = _timeSeries.last;
    final value = latest['value'] as double?;

    if (value == null) return '--';

    // Format based on category
    if (widget.category == 'aquaculture') {
      // Metric tons - show as K for thousands
      if (value >= 1000) {
        return '${(value / 1000).toStringAsFixed(1)}K';
      }
      return value.toStringAsFixed(0);
    } else if (widget.category == 'fertilizer') {
      // kg per hectare
      return value.toStringAsFixed(0);
    } else if (widget.category == 'harvestStorage') {
      // Percentage
      return '${value.toStringAsFixed(1)}%';
    } else if (widget.category == 'cropProtection') {
      // Percentage
      return '${value.toStringAsFixed(1)}%';
    } else {
      // Index values
      return value.toStringAsFixed(0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return InkWell(
      onTap: () => _showDetailedChart(context),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 100,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: isDark ? Colors.grey.shade800 : Colors.grey.shade100,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: _categoryColor.withValues(alpha: 0.5),
            width: 2,
          ),
        ),
        child: _isLoading
            ? Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(_categoryColor),
                  ),
                ),
              )
            : Row(
                children: [
                  // Sparkline chart
                  SizedBox(
                    width: 36,
                    height: 36,
                    child: CustomPaint(
                      painter: _PriceSparklinePainter(
                        data: _timeSeries,
                        lineColor: _categoryColor,
                        fillColor: _categoryColor.withValues(alpha: 0.2),
                        backgroundColor: isDark
                            ? Colors.grey.shade700
                            : Colors.grey.shade300,
                      ),
                      child: Center(
                        child: Icon(
                          _categoryIcon,
                          size: 16,
                          color: _categoryColor,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _title,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 9,
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.7,
                            ),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Flexible(
                              child: Text(
                                _latestValue,
                                style: theme.textTheme.titleSmall?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: _categoryColor,
                                  fontSize: 10,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 2),
                            Icon(
                              _trend == 'up'
                                  ? Icons.trending_up
                                  : _trend == 'down'
                                  ? Icons.trending_down
                                  : Icons.trending_flat,
                              size: 9,
                              color: _trend == 'up'
                                  ? Colors.green
                                  : _trend == 'down'
                                  ? Colors.red
                                  : Colors.grey,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  void _showDetailedChart(BuildContext context) {
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
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        _title,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh),
                      tooltip: 'Refresh data',
                      onPressed: () async {
                        // Clear cache and reload
                        _worldBankService.clearCache();
                        await _loadData();
                        if (mounted) {
                          setState(() {});
                        }
                      },
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
                  child: MarketPriceChart(
                    category: widget.category,
                    data: _priceData,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PriceSparklinePainter extends CustomPainter {
  final List<Map<String, dynamic>> data;
  final Color lineColor;
  final Color fillColor;
  final Color backgroundColor;

  _PriceSparklinePainter({
    required this.data,
    required this.lineColor,
    required this.fillColor,
    required this.backgroundColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 2;

    // Draw background circle
    final backgroundPaint = Paint()
      ..color = backgroundColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.0
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, radius, backgroundPaint);

    if (data.length < 2) return;

    // Calculate min/max for normalization
    final values = data.map((d) => d['value'] as double).toList();
    final minVal = values.reduce(math.min);
    final maxVal = values.reduce(math.max);
    final range = maxVal - minVal;

    // Convert data points to chart coordinates
    final points = <Offset>[];
    for (int i = 0; i < values.length; i++) {
      final x = center.dx - radius + (i / (values.length - 1)) * (2 * radius);
      final normalizedValue = range == 0 ? 0.5 : (values[i] - minVal) / range;
      final y = center.dy + radius - (normalizedValue * (2 * radius));
      points.add(Offset(x, y));
    }

    // Draw filled area
    final fillPath = Path()..moveTo(points.first.dx, center.dy + radius);
    for (final point in points) {
      fillPath.lineTo(point.dx, point.dy);
    }
    fillPath.lineTo(points.last.dx, center.dy + radius);
    fillPath.close();

    final fillPaint = Paint()
      ..color = fillColor
      ..style = PaintingStyle.fill;
    canvas.drawPath(fillPath, fillPaint);

    // Draw line
    final linePath = Path()..moveTo(points.first.dx, points.first.dy);
    for (int i = 1; i < points.length; i++) {
      linePath.lineTo(points[i].dx, points[i].dy);
    }

    final linePaint = Paint()
      ..color = lineColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(linePath, linePaint);

    // Draw dot at last point
    final lastPoint = points.last;
    final dotPaint = Paint()
      ..color = lineColor
      ..style = PaintingStyle.fill;
    canvas.drawCircle(lastPoint, 3.0, dotPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
