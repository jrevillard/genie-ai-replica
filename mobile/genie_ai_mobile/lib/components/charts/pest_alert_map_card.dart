import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:genie_ai_mobile/services/agricultural_proxy.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'pest_alert_chart.dart';

/// Simple pest alert map for QuickHelp overlay
/// Shows El Salvador outline with alert dots
class PestAlertSummaryCard extends StatefulWidget {
  final String region;

  const PestAlertSummaryCard({super.key, this.region = 'Central America'});

  @override
  State<PestAlertSummaryCard> createState() => _PestAlertSummaryCardState();
}

class _PestAlertSummaryCardState extends State<PestAlertSummaryCard> {
  final AgriculturalProxy _agriculturalProxy = AgriculturalProxy();
  Map<String, dynamic>? _pestData;
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
      final data = await _agriculturalProxy.getPestAlerts(
        region: widget.region,
      );
      if (mounted) {
        setState(() {
          _pestData = data;
        });
      }
    } catch (e) {
      // Silently fail - show default state
    }
  }

  int get _totalAlerts {
    if (_pestData == null) return 0;
    final summary = _pestData!['summary'] as Map<String, dynamic>?;
    return summary?['total'] as int? ?? 0;
  }

  int get _highSeverity {
    if (_pestData == null) return 0;
    final summary = _pestData!['summary'] as Map<String, dynamic>?;
    return summary?['high'] as int? ?? 0;
  }

  Color get _alertColor {
    if (_pestData == null) return Colors.grey;
    if (_highSeverity > 0) return Colors.red;
    if (_totalAlerts > 0) return Colors.orange;
    return Colors.green;
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
            color: _alertColor.withValues(alpha: 0.5),
            width: 2,
          ),
        ),
        child: Row(
          children: [
            // El Salvador map with alert dots
            SizedBox(
              width: 55,
              height: 55,
              child: Stack(
                children: [
                  // El Salvador map image
                  Positioned.fill(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: SvgPicture.asset(
                        'assets/images/sv.svg',
                        fit: BoxFit.contain,
                      ),
                    ),
                  ),
                  // Alert dots overlay
                  if (_totalAlerts > 0)
                    Positioned.fill(child: _buildAlertDots()),
                ],
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
                    tr('charts.pestAlerts'),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 10,
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        '$_totalAlerts',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: _alertColor,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          tr('charts.active'),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.6,
                            ),
                            fontSize: 11,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
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

  Widget _buildAlertDots() {
    final dotsToShow = _totalAlerts > 3 ? 3 : _totalAlerts;

    return CustomPaint(
      painter: _AlertDotsPainter(
        alertCount: dotsToShow,
        hasHighSeverity: _highSeverity > 0,
        alertColor: _alertColor,
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
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${tr('charts.pestAlerts')} - ${tr('charts.details')}',
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
                  child: PestAlertChart(region: widget.region, compact: true),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AlertDotsPainter extends CustomPainter {
  final int alertCount;
  final bool hasHighSeverity;
  final Color alertColor;

  _AlertDotsPainter({
    required this.alertCount,
    required this.hasHighSeverity,
    required this.alertColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Representative positions for western, central, and eastern regions
    final dotPositions = [
      Offset(size.width * 0.25, size.height * 0.35), // Western region
      Offset(size.width * 0.50, size.height * 0.55), // Central region
      Offset(size.width * 0.70, size.height * 0.70), // Eastern region
    ];

    for (int i = 0; i < alertCount; i++) {
      final dotPaint = Paint()
        ..color = alertColor
        ..style = PaintingStyle.fill;
      canvas.drawCircle(dotPositions[i], 4.0, dotPaint);

      // Add white border for better visibility
      final borderPaint = Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5;
      canvas.drawCircle(dotPositions[i], 4.0, borderPaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
