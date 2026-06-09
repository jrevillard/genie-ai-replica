import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/agricultural_proxy.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

/// Simple pest alert summary card for QuickHelp overlay
/// Shows just the count of active alerts with severity indicator
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

  Color _getAlertColor() {
    if (_pestData == null) return Colors.grey;
    if (_highSeverity > 0) return Colors.red;
    if (_totalAlerts > 0) return Colors.orange;
    return Colors.green;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Container(
      height: 60,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDark ? Colors.grey.shade800 : Colors.grey.shade100,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: _getAlertColor().withValues(alpha: 0.5),
          width: 2,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: _getAlertColor().withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(
              _highSeverity > 0 ? Icons.warning : Icons.info,
              color: _getAlertColor(),
              size: 20,
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
                  _translate('charts.pestAlerts') ?? 'Pest Alerts',
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
                        color: _getAlertColor(),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        _translate('charts.active') ?? 'active',
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
        ],
      ),
    );
  }

  String? _translate(String key) {
    return I18nService().translate(key);
  }
}
