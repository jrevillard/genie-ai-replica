import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/agri_api_service.dart';
import 'package:genie_ai_mobile/components/charts/pest_alert_chart.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// Simple pest alert summary card for QuickHelp overlay
/// Shows just the count of active alerts with severity indicator
class PestAlertSummaryCard extends StatefulWidget {
  final String region;

  const PestAlertSummaryCard({super.key, this.region = 'Central America'});

  @override
  State<PestAlertSummaryCard> createState() => _PestAlertSummaryCardState();
}

class _PestAlertSummaryCardState extends State<PestAlertSummaryCard> {
  final AgriApiService _agriService = AgriApiService();
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
      final data = await _agriService.getPestAlerts(); // region is server-side
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
    final summary = (_pestData!['summary'] as Map?)?.cast<String, dynamic>();
    return summary?['total'] as int? ?? 0;
  }

  int get _highSeverity {
    if (_pestData == null) return 0;
    final summary = (_pestData!['summary'] as Map?)?.cast<String, dynamic>();
    return summary?['high'] as int? ?? 0;
  }

  Color _getAlertColor() {
    // DS token values (danger/warning/success), matching the web pills.
    final tokens = ThemeManager().tokens;
    if (_pestData == null) return tokens.muted;
    if (_highSeverity > 0) return tokens.danger;
    if (_totalAlerts > 0) return tokens.warning;
    return tokens.success;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Tap opens the full Pest Alerts chart dialog (web parity: the
    // summary card opens the chart). The card previously had NO tap
    // target at all.
    return InkWell(
      onTap: () => _showFullChart(context),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        // 68: 60 clipped the two-line text column by 3px (overflow in the
        // hosted Insights row).
        height: 68,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: ThemeManager().tokens.surface,
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
                        '${tr('charts.pestAlerts')} - ${tr('charts.details')}',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
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

  String? _translate(String key) {
    return I18nService().translate(key);
  }
}
