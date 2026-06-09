import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:genie_ai_mobile/services/agricultural_proxy.dart';
import 'package:genie_ai_mobile/services/chatbot_proxy.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

/// Pest Alert Chart Widget
///
/// Displays current pest and disease warnings with severity indicators,
/// expandable cards, and quick action buttons.
class PestAlertChart extends StatefulWidget {
  final String region;
  final bool autoRefresh;
  final Duration refreshInterval;
  final bool compact;

  const PestAlertChart({
    super.key,
    this.region = 'Central America',
    this.autoRefresh = false,
    this.refreshInterval = const Duration(minutes: 10),
    this.compact = false,
  });

  @override
  State<PestAlertChart> createState() => _PestAlertChartState();
}

class _PestAlertChartState extends State<PestAlertChart> {
  final AgriculturalProxy _agriculturalProxy = AgriculturalProxy();
  final ChatbotProxy _chatbotProxy = ChatbotProxy();
  final TextEditingController _userContextController = TextEditingController();
  Map<String, dynamic>? _pestData;
  bool _loading = true;
  String? _error;
  String _selectedSeverity = 'all';
  final Set<String> _expandedAlerts = {};

  @override
  void initState() {
    super.initState();
    _loadPestAlerts();
    if (widget.autoRefresh) {
      Future.delayed(widget.refreshInterval, () {
        if (mounted) _loadPestAlerts();
      });
    }
  }

  @override
  void dispose() {
    _userContextController.dispose();
    super.dispose();
  }

  Future<void> _loadPestAlerts() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await _agriculturalProxy.getPestAlerts(region: widget.region);
      setState(() {
        _pestData = data;
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

  List<dynamic> get _filteredAlerts {
    if (_pestData == null) return [];
    final alerts = _pestData!['alerts'] as List<dynamic>;
    if (_selectedSeverity == 'all') return alerts;
    return alerts.where((a) => a['severity'] == _selectedSeverity).toList();
  }

  void _toggleAlert(String alertId) {
    setState(() {
      if (_expandedAlerts.contains(alertId)) {
        _expandedAlerts.remove(alertId);
      } else {
        _expandedAlerts.add(alertId);
      }
    });
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
                        _translate('charts.pestAlertTitle') ?? 'Pest Alerts',
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _translate('charts.pestAlertSubtitle') ??
                            'Current pest and disease warnings',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(alpha:0.7),
                        ),
                      ),
                    ],
                  ),
                ),
                if (!_loading)
                  IconButton(
                    icon: const Icon(Icons.refresh),
                    onPressed: _loadPestAlerts,
                    tooltip: _translate('charts.refresh') ?? 'Refresh',
                  ),
              ],
            ),
            const SizedBox(height: 16),

            // Severity Filter Chips
            if (!_loading && _pestData != null)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _buildFilterChip(
                      context, 'all', _translate('charts.all') ?? 'All', theme),
                  _buildFilterChip(context, 'high',
                      _translate('charts.severityHigh') ?? 'High', theme),
                  _buildFilterChip(context, 'moderate',
                      _translate('charts.severityModerate') ?? 'Moderate', theme),
                  _buildFilterChip(
                      context, 'low', _translate('charts.severityLow') ?? 'Low', theme),
                ],
              ),

            const SizedBox(height: 16),

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
                      Icon(Icons.error_outline,
                          size: 48, color: theme.colorScheme.error),
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

            // Summary Donut Chart
            if (!_loading && _pestData != null) _buildSummaryChart(theme),

            const SizedBox(height: 16),

            // Alert Cards
            if (!_loading && _filteredAlerts.isNotEmpty)
              ..._filteredAlerts.map((alert) => _buildAlertCard(alert, theme, isDark)),

            // Empty State
            if (!_loading && _filteredAlerts.isEmpty && _pestData != null)
              _buildEmptyState(theme),

            // Last Updated
            if (!_loading && _pestData != null)
              Center(
                child: Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.access_time,
                          size: 14,
                          color: theme.colorScheme.onSurface.withValues(alpha:0.5)),
                      const SizedBox(width: 4),
                      Text(
                        '${_translate('charts.lastUpdated') ?? 'Last updated'}: ${_formatDate(DateTime.now())}',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.onSurface.withValues(alpha:0.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChip(
      BuildContext context, String severity, String label, ThemeData theme) {
    final isDark = theme.brightness == Brightness.dark;
    final isSelected = _selectedSeverity == severity;
    final summary = _pestData?['summary'] as Map<String, dynamic>?;

    int count = 0;
    if (severity == 'all') {
      count = summary?['total'] ?? 0;
    } else {
      count = summary?[severity] ?? 0;
    }

    return FilterChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (severity != 'all')
            Icon(_getSeverityIcon(severity), size: 14),
          if (severity != 'all') const SizedBox(width: 4),
          Text(label),
          const SizedBox(width: 4),
          Text('($count)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
        ],
      ),
      selected: isSelected,
      onSelected: (_) {
        setState(() {
          _selectedSeverity = severity;
        });
      },
      selectedColor: _getSeverityColor(severity).withValues(alpha: 0.2),
      checkmarkColor: _getSeverityColor(severity),
      backgroundColor: isDark ? Colors.grey.shade800 : Colors.grey.shade200,
    );
  }

  Widget _buildSummaryChart(ThemeData theme) {
    final summary = _pestData!['summary'] as Map<String, dynamic>;
    final high = summary['high'] as int? ?? 0;
    final moderate = summary['moderate'] as int? ?? 0;
    final low = summary['low'] as int? ?? 0;
    final total = summary['total'] as int? ?? 0;

    if (total == 0) return const SizedBox.shrink();

    return SizedBox(
      height: 150,
      child: Stack(
        children: [
          PieChart(
            PieChartData(
              sectionsSpace: 2,
              centerSpaceRadius: 50,
              sections: [
                PieChartSectionData(
                  value: high.toDouble(),
                  title: '',
                  color: Colors.red,
                  radius: 20,
                  showTitle: false,
                ),
                PieChartSectionData(
                  value: moderate.toDouble(),
                  title: '',
                  color: Colors.orange,
                  radius: 20,
                  showTitle: false,
                ),
                PieChartSectionData(
                  value: low.toDouble(),
                  title: '',
                  color: Colors.blue,
                  radius: 20,
                  showTitle: false,
                ),
              ],
            ),
          ),
          Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  '$total',
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: theme.colorScheme.onSurface,
                  ),
                ),
                Text(
                  _translate('charts.activeAlerts') ?? 'Active Alerts',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha:0.7),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAlertCard(Map<String, dynamic> alert, ThemeData theme, bool isDark) {
    final severity = alert['severity'] as String;
    final pest = alert['pest'] as String;
    final scientific = alert['scientificName'] as String;
    final description = alert['description'] as String;
    final crops = (alert['affectedCrops'] as List<dynamic>).join(', ');
    final departments = (alert['departments'] as List<dynamic>).join(', ');
    final recommendations = alert['recommendations'] as String;
    final firstDetected = alert['firstDetected'] as String;
    final isExpanded = _expandedAlerts.contains(alert['id']);

    final severityColor = _getSeverityColor(severity);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isDark ? Colors.grey.shade900 : Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border(
          left: BorderSide(color: severityColor, width: 4),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha:0.05),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Header (always visible)
          InkWell(
            onTap: () => _toggleAlert(alert['id']),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: severityColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      _getSeverityIcon(severity),
                      color: severityColor,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          pest,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          scientific,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontStyle: FontStyle.italic,
                            color: theme.colorScheme.onSurface.withValues(alpha:0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Chip(
                    label: Text(
                      _getSeverityLabel(severity),
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    backgroundColor: severityColor,
                    padding: EdgeInsets.zero,
                  ),
                  const SizedBox(width: 8),
                  Icon(
                    isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: theme.colorScheme.onSurface.withValues(alpha:0.5),
                  ),
                ],
              ),
            ),
          ),

          // Expanded content
          if (isExpanded)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Description
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.info_outline,
                            size: 16, color: theme.colorScheme.primary),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            description,
                            style: theme.textTheme.bodyMedium,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Details Grid
                  _buildDetailItem(
                    context,
                    Icons.agriculture,
                    _translate('charts.affectedCrops') ?? 'Affected Crops',
                    crops,
                    theme,
                  ),
                  _buildDetailItem(
                    context,
                    Icons.location_on,
                    _translate('charts.areas') ?? 'Affected Areas',
                    departments,
                    theme,
                  ),
                  _buildDetailItem(
                    context,
                    Icons.calendar_today,
                    _translate('charts.firstDetected') ?? 'First Detected',
                    _formatDate(DateTime.parse(firstDetected)),
                    theme,
                  ),
                  const SizedBox(height: 12),

                  // Recommendations
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.amber.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(8),
                      border: Border(
                        left: BorderSide(color: Colors.amber.shade700, width: 3),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.lightbulb_outline,
                                size: 16, color: Colors.amber.shade700),
                            const SizedBox(width: 8),
                            Text(
                              _translate('charts.recommendations') ??
                                  'Recommendations',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: Colors.amber.shade700,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          recommendations,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Action Buttons
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: () => _viewOnMap(alert),
                        icon: const Icon(Icons.map, size: 16),
                        label: Text(_translate('charts.viewMap') ?? 'View on Map'),
                      ),
                      OutlinedButton.icon(
                        onPressed: () => _shareAlert(alert),
                        icon: const Icon(Icons.share, size: 16),
                        label: Text(_translate('charts.share') ?? 'Share'),
                      ),
                      ElevatedButton.icon(
                        onPressed: () => _getAssistance(alert),
                        icon: const Icon(Icons.help_outline, size: 16),
                        label: Text(
                            _translate('charts.getAssistance') ?? 'Get Assistance'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: theme.colorScheme.primary,
                          foregroundColor: theme.colorScheme.onPrimary,
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

  Widget _buildDetailItem(BuildContext context, IconData icon, String label,
      String value, ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          Text(
            '$label: ',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha:0.7),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          children: [
            Icon(Icons.check_circle_outline,
                size: 64, color: Colors.green.shade400),
            const SizedBox(height: 16),
            Text(
              _translate('charts.noPestAlerts') ?? 'No Active Pest Alerts',
              style: theme.textTheme.titleLarge?.copyWith(
                color: Colors.green.shade700,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _translate('charts.noPestAlertsDesc') ??
                  'No pest alerts for the selected severity level.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha:0.7),
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Color _getSeverityColor(String severity) {
    switch (severity) {
      case 'high':
        return Colors.red;
      case 'moderate':
        return Colors.orange;
      case 'low':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  IconData _getSeverityIcon(String severity) {
    switch (severity) {
      case 'high':
        return Icons.error;
      case 'moderate':
        return Icons.warning;
      case 'low':
        return Icons.info;
      default:
        return Icons.info_outline;
    }
  }

  void _viewOnMap(Map<String, dynamic> alert) async {
    final departments = alert['departments'] as List<dynamic>;
    if (departments.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(tr('charts.noLocationData'))),
      );
      return;
    }

    // Get coordinates for the first affected department
    final firstDept = departments.first as String;
    final coords = _getDepartmentCoordinates(firstDept);

    // Try to open in Google Maps app (geo: URL scheme)
    // Falls back to web URL if app not available
    final searchQuery = '$firstDept, El Salvador ${alert['pest']}';

    // Try Google Maps app first with coordinates or search query
    String mapsUrl;
    if (coords != null) {
      // Use coordinates for direct location
      mapsUrl = 'geo:${coords['lat']},${coords['lng']}?q=${Uri.encodeComponent(searchQuery)}';
    } else {
      // Use search query only
      mapsUrl = 'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(searchQuery)}';
    }

    try {
      final uri = Uri.parse(mapsUrl);
      final launched = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );

      if (!launched && mounted) {
        // Fallback: try web URL
        final webUrl = 'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(searchQuery)}';
        await launchUrl(
          Uri.parse(webUrl),
          mode: LaunchMode.platformDefault,
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${tr('charts.mapError')}: $e')),
        );
      }
    }
  }

  void _shareAlert(Map<String, dynamic> alert) async {
    final pest = alert['pest'] as String;
    final scientific = alert['scientificName'] as String;
    final severity = alert['severity'] as String;
    final description = alert['description'] as String;
    final crops = (alert['affectedCrops'] as List<dynamic>).join(', ');
    final departments = (alert['departments'] as List<dynamic>).join(', ');
    final recommendations = alert['recommendations'] as String;
    final source = alert['source'] as String?;

    // Format the pest alert for sharing
    final shareText = '''
🚨 ${_getSeverityLabel(severity)} SEVERITY PEST ALERT 🚨

🐛 ${tr('charts.pest')}: $pest
🔬 $scientific

📝 ${_translate('charts.description') ?? 'Description'}:
$description

🌾 ${_translate('charts.affectedCrops') ?? 'Affected Crops'}: $crops

📍 ${_translate('charts.areas') ?? 'Affected Areas'}: $departments

💡 ${_translate('charts.recommendations') ?? 'Recommendations'}:
$recommendations

${source != null ? '📊 ${_translate('charts.source') ?? 'Source'}: $source' : ''}

---
${_translate('charts.sharedVia') ?? 'Shared via'} AgroGenio AI
''';

    try {
      await Share.share(
        shareText,
        subject: '$_getSeverityLabel(severity)} Pest Alert: $pest',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${_translate('charts.shareError') ?? 'Error sharing'}: $e')),
        );
      }
    }
  }

  void _getAssistance(Map<String, dynamic> alert) async {
    final pest = alert['pest'] as String;
    final scientific = alert['scientificName'] as String;
    final severity = alert['severity'] as String;
    final crops = (alert['affectedCrops'] as List<dynamic>).join(', ');
    final departments = (alert['departments'] as List<dynamic>).join(', ');
    final recommendations = alert['recommendations'] as String;

    // Clear previous user input
    _userContextController.clear();

    // Create a pre-formatted prompt with pest context
    final basePrompt = '''Pest: $pest ($scientific)
Severity: ${_getSeverityLabel(severity)}
Crops: $crops
Areas: $departments
Recommendations: $recommendations''';

    // Show dialog to add user context
    await showDialog(
      context: context,
      builder: (dialogContext) => _AssistanceDialog(
        pest: pest,
        basePrompt: basePrompt,
        userContextController: _userContextController,
        onSubmit: (userInput) async {
          // Close dialog
          Navigator.of(dialogContext).pop();

          // Combine base prompt with user input
          final finalPrompt = userInput.isEmpty
              ? 'I need assistance with a pest alert:\n\n$basePrompt'
              : 'I need assistance with a pest alert:\n\n$basePrompt\n\nMy situation: $userInput';

          // Show loading overlay
          if (mounted) {
            showDialog(
              context: context,
              barrierDismissible: false,
              builder: (loadingContext) => Center(
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.3),
                        blurRadius: 10,
                        spreadRadius: 5,
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CircularProgressIndicator(),
                      const SizedBox(height: 16),
                      Text(
                        tr('charts.gettingResponse'),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
              ),
            );
          }

          try {
            // Call chatbot proxy API directly
            final currentLocale = I18nService().currentLocale;
            final currentLanguage = currentLocale.languageCode;
            debugPrint("[PEST_ALERT] Current locale: $currentLocale");
            debugPrint("[PEST_ALERT] Language code being sent: '$currentLanguage'");

            final response = await _chatbotProxy.submitQuery(
              sessionId: 'pest-assist-${DateTime.now().millisecondsSinceEpoch}',
              messages: [
                {'role': 'user', 'content': finalPrompt}
              ],
              userId: 'pest-alert-user',
              categoryId: null,
              contextLabels: null,
              language: currentLanguage,
            );

            // Hide loading overlay
            if (mounted) {
              Navigator.of(context).pop();
            }

            // Show response in dialog
            if (mounted) {
              showDialog(
                context: context,
                builder: (responseContext) => _ResponseDialog(
                  response: response,
                  onCopy: () {
                    Clipboard.setData(ClipboardData(text: response['response']?.toString() ?? ''));
                    ScaffoldMessenger.of(responseContext).showSnackBar(
                      SnackBar(
                        content: Text(tr('charts.responseCopied')),
                        duration: const Duration(seconds: 2),
                      ),
                    );
                  },
                ),
              );
            }
          } catch (e) {
            // Hide loading overlay
            if (mounted) {
              Navigator.of(context).pop();
            }

            // Show error
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('${tr('charts.error')}: $e'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          }
        },
      ),
    );
  }

  /// Get coordinates for El Salvador departments
  Map<String, double>? _getDepartmentCoordinates(String department) {
    // Approximate coordinates for El Salvador's 14 departments
    final coordinates = {
      'Ahuachapán': {'lat': 13.9833, 'lng': -89.8333},
      'Santa Ana': {'lat': 13.9936, 'lng': -89.5564},
      'Sonsonate': {'lat': 13.7178, 'lng': -89.7269},
      'Chalatenango': {'lat': 13.9833, 'lng': -88.9167},
      'La Libertad': {'lat': 13.4833, 'lng': -89.3333},
      'San Salvador': {'lat': 13.6894, 'lng': -89.1872},
      'Cuscatlán': {'lat': 13.7333, 'lng': -88.9000},
      'La Paz': {'lat': 13.4833, 'lng': -88.9167},
      'Cabañas': {'lat': 13.8500, 'lng': -88.7000},
      'San Vicente': {'lat': 13.6333, 'lng': -88.7833},
      'Usulután': {'lat': 13.3500, 'lng': -88.4500},
      'San Miguel': {'lat': 13.4833, 'lng': -88.1833},
      'Morazán': {'lat': 13.7500, 'lng': -88.0833},
      'La Unión': {'lat': 13.5333, 'lng': -87.8500},
    };

    return coordinates[department];
  }

  String? _translate(String key) {
    return tr(key);
  }

  String _getSeverityLabel(String severity) {
    switch (severity) {
      case 'high':
        return _translate('charts.severityHigh') ?? 'HIGH';
      case 'moderate':
        return _translate('charts.severityModerate') ?? 'MODERATE';
      case 'low':
        return _translate('charts.severityLow') ?? 'LOW';
      default:
        return severity.toUpperCase();
    }
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year}';
  }
}

/// Dialog for getting user context and submitting to AI
class _AssistanceDialog extends StatefulWidget {
  final String pest;
  final String basePrompt;
  final TextEditingController userContextController;
  final Future<void> Function(String userInput) onSubmit;

  const _AssistanceDialog({
    required this.pest,
    required this.basePrompt,
    required this.userContextController,
    required this.onSubmit,
  });

  @override
  State<_AssistanceDialog> createState() => _AssistanceDialogState();
}

class _AssistanceDialogState extends State<_AssistanceDialog> {
  bool _isSubmitting = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Dialog(
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.7,
          maxWidth: MediaQuery.of(context).size.width * 0.9,
        ),
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Icon(Icons.help_outline, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${tr('charts.getAssistance')}: ${widget.pest}',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
            const Divider(height: 16),

            // Scrollable content
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      tr('charts.assistancePrompt'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: theme.colorScheme.outline.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Text(
                        widget.basePrompt,
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      tr('charts.assistanceInstructions'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: widget.userContextController,
                      decoration: InputDecoration(
                        hintText: tr('charts.assistanceHint'),
                        border: const OutlineInputBorder(),
                      ),
                      maxLines: 3,
                      textInputAction: TextInputAction.done,
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Action buttons
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              runSpacing: 8,
              children: [
                TextButton(
                  onPressed: _isSubmitting ? null : () => Navigator.of(context).pop(),
                  child: Text(tr('common.cancel')),
                ),
                ElevatedButton.icon(
                  onPressed: _isSubmitting
                      ? null
                      : () async {
                          setState(() {
                            _isSubmitting = true;
                          });

                          await widget.onSubmit(widget.userContextController.text.trim());

                          if (mounted) {
                            setState(() {
                              _isSubmitting = false;
                            });
                          }
                        },
                  icon: _isSubmitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.send, size: 16),
                  label: Text(tr('charts.submitQuery')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Dialog for showing AI response
class _ResponseDialog extends StatelessWidget {
  final Map<String, dynamic> response;
  final VoidCallback onCopy;

  const _ResponseDialog({
    required this.response,
    required this.onCopy,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Dialog(
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.7,
          maxWidth: MediaQuery.of(context).size.width * 0.9,
        ),
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Icon(Icons.psychology, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    tr('charts.aiResponse'),
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
            const Divider(height: 16),

            // Scrollable response content
            Expanded(
              child: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: response.containsKey('response')
                      ? MarkdownBody(
                          data: response['response'] ?? tr('charts.noResponse'),
                          styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
                            p: theme.textTheme.bodyMedium,
                          ),
                          selectable: true,
                          onTapLink: (text, href, title) {
                            if (href != null) {
                              launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
                            }
                          },
                        )
                      : response.containsKey('error')
                          ? Text(
                              response['error'] ?? tr('charts.errorOccurred'),
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.error,
                              ),
                            )
                          : Text(
                              response.toString(),
                              style: theme.textTheme.bodyMedium,
                            ),
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Action buttons
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              runSpacing: 8,
              children: [
                TextButton.icon(
                  onPressed: onCopy,
                  icon: const Icon(Icons.copy, size: 16),
                  label: Text(tr('charts.copy')),
                ),
                ElevatedButton.icon(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.done, size: 16),
                  label: Text(tr('charts.close')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
