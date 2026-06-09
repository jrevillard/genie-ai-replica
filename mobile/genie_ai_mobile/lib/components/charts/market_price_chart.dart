import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:genie_ai_mobile/services/chatbot_proxy.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

/// Detailed Market Price Chart
///
/// Shows a comprehensive time-series chart for a specific market category
/// Displayed in a dialog when a summary card is tapped
class MarketPriceChart extends StatefulWidget {
  final String category;
  final Map<String, dynamic>? data;

  const MarketPriceChart({super.key, required this.category, this.data});

  @override
  State<MarketPriceChart> createState() => _MarketPriceChartState();
}

class _MarketPriceChartState extends State<MarketPriceChart> {
  String _currentLangCode = '';

  @override
  void initState() {
    super.initState();
    _currentLangCode = I18nService().currentLocale.languageCode;
    I18nService().addListener(_onLanguageChange);
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

  List<Map<String, dynamic>> get _timeSeries {
    if (widget.data == null) return [];
    final data = widget.data!['data'] as List<dynamic>?;
    if (data == null) return [];
    return data.cast<Map<String, dynamic>>();
  }

  Color get _categoryColor {
    final colorHex = _categoryConfig[widget.category]?['color'] as String?;
    if (colorHex != null) {
      return Color(int.parse(colorHex.replaceFirst('#', '0xFF')));
    }
    return Colors.blue;
  }

  String get _unit {
    if (widget.data == null) return '';
    return widget.data!['unit'] as String? ?? '';
  }

  String get _trend {
    if (widget.data == null) return 'unknown';
    return widget.data!['trend'] as String? ?? 'unknown';
  }

  String get _dataSource {
    if (widget.data == null) return '';
    return widget.data!['dataSource'] as String? ?? '';
  }

  String get _title {
    final config = _categoryConfig[widget.category];
    final i18nKey = config?['i18nKey'] as String?;
    return i18nKey != null ? tr('market.$i18nKey') : widget.category;
  }

  String get _lastUpdated {
    if (widget.data == null || widget.data!['lastUpdated'] == null) {
      final now = DateTime.now();
      return '${now.day}/${now.month}/${now.year}';
    }
    try {
      final date = DateTime.parse(widget.data!['lastUpdated'] as String);
      return '${date.day}/${date.month}/${date.year}';
    } catch (e) {
      return '';
    }
  }

  static const Map<String, dynamic> _categoryConfig = {
    'maize': {'i18nKey': 'maizeGrains', 'color': '#2E7D32'},
    'cropProtection': {'i18nKey': 'cropProtection', 'color': '#D84315'},
    'vegetables': {'i18nKey': 'fruitsVeggies', 'color': '#558B2F'},
    'livestock': {'i18nKey': 'livestock', 'color': '#8D6E63'},
    'fertilizer': {'i18nKey': 'fertilizer', 'color': '#F9A825'},
    'apiary': {'i18nKey': 'apiary', 'color': '#F57F17'},
    'aquaculture': {'i18nKey': 'aquaculture', 'color': '#0288D1'},
    'harvestStorage': {'i18nKey': 'harvestStorage', 'color': '#00838F'},
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    if (_timeSeries.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.show_chart,
              size: 64,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
            ),
            const SizedBox(height: 16),
            Text(
              tr('market.noData'),
              style: theme.textTheme.titleMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Summary Cards
          Row(
            children: [
              Expanded(
                child: _buildSummaryCard(
                  context,
                  tr('market.latest'),
                  _latestValue,
                  _unit,
                  _categoryColor,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildSummaryCard(
                  context,
                  tr('market.trend'),
                  _trendLabel,
                  '',
                  _trendColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Source Badge
          if (_dataSource.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: _categoryColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _categoryColor.withValues(alpha: 0.3),
                  width: 1,
                ),
              ),
              child: Text(
                _dataSource,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: _categoryColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          const SizedBox(height: 16),
          // Get Predictions Button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () => _getPredictions(context),
              icon: const Icon(Icons.psychology, size: 18),
              label: Text(tr('market.getPredictions')),
              style: ElevatedButton.styleFrom(
                backgroundColor: _categoryColor,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          // Chart Title
          Text(
            tr('market.priceHistory'),
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          // Line Chart
          SizedBox(
            height: 250,
            child: LineChart(
              LineChartData(
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: _calculateYInterval(),
                  getDrawingHorizontalLine: (value) {
                    return FlLine(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
                      strokeWidth: 1,
                    );
                  },
                ),
                titlesData: FlTitlesData(
                  show: true,
                  rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 30,
                      interval: _calculateXInterval(),
                      getTitlesWidget: (value, meta) {
                        return _buildXAxisLabel(value, theme);
                      },
                    ),
                  ),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 50,
                      interval: _calculateYInterval(),
                      getTitlesWidget: (value, meta) {
                        return _buildYAxisLabel(value, theme);
                      },
                    ),
                  ),
                ),
                borderData: FlBorderData(show: false),
                minX: 0,
                maxX: (_timeSeries.length - 1).toDouble(),
                minY: _minY,
                maxY: _maxY,
                lineBarsData: [
                  LineChartBarData(
                    spots: _buildSpots(),
                    isCurved: true,
                    curveSmoothness: 0.3,
                    color: _categoryColor,
                    barWidth: 3,
                    isStrokeCapRound: true,
                    dotData: FlDotData(
                      show: true,
                      getDotPainter: (spot, percent, barData, index) {
                        return FlDotCirclePainter(
                          radius: 4,
                          color: _categoryColor,
                          strokeWidth: 2,
                          strokeColor: isDark ? Colors.black : Colors.white,
                        );
                      },
                    ),
                    belowBarData: BarAreaData(
                      show: true,
                      color: _categoryColor.withValues(alpha: 0.15),
                    ),
                  ),
                ],
                lineTouchData: LineTouchData(
                  enabled: true,
                  touchTooltipData: LineTouchTooltipData(
                    getTooltipItems: (touchedSpots) {
                      return touchedSpots.map((spot) {
                        final index = spot.x.toInt();
                        if (index >= 0 && index < _timeSeries.length) {
                          final dataPoint = _timeSeries[index];
                          final year = dataPoint['year'] as String? ?? '';
                          final value = _formatValue(
                            dataPoint['value'] as double?,
                          );
                          return LineTooltipItem(
                            '$year\n$value',
                            TextStyle(
                              color: isDark ? Colors.white : Colors.black,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          );
                        }
                        return null;
                      }).toList();
                    },
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          // Data Table
          Text(
            tr('market.dataTable'),
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          _buildDataTable(theme, isDark),
          const SizedBox(height: 16),
          // Footer
          Center(
            child: Text(
              '${tr('market.lastUpdated')}: $_lastUpdated',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                fontSize: 10,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryCard(
    BuildContext context,
    String label,
    String value,
    String unit,
    Color color,
  ) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isDark ? Colors.grey.shade800 : Colors.grey.shade100,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                fontSize: 11,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: color,
                fontSize: 20,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (unit.isNotEmpty)
              Text(
                unit,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                  fontSize: 11,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildXAxisLabel(double value, ThemeData theme) {
    final index = value.toInt();
    if (index >= 0 && index < _timeSeries.length) {
      final year = _timeSeries[index]['year'] as String?;
      if (year != null && year.length >= 4) {
        return Text(
          year.substring(2), // Show last 2 digits of year
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            fontSize: 10,
          ),
        );
      }
    }
    return const SizedBox.shrink();
  }

  Widget _buildYAxisLabel(double value, ThemeData theme) {
    return Text(
      _formatAxisValue(value),
      style: theme.textTheme.bodySmall?.copyWith(
        color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
        fontSize: 10,
      ),
    );
  }

  Widget _buildDataTable(ThemeData theme, bool isDark) {
    return Container(
      decoration: BoxDecoration(
        color: isDark ? Colors.grey.shade800 : Colors.grey.shade100,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      child: ListView.separated(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _timeSeries.length,
        separatorBuilder: (context, index) => Divider(
          height: 1,
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
        itemBuilder: (context, index) {
          final item = _timeSeries[index];
          final year = item['year'] as String? ?? '';
          final value = item['value'] as double?;

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  year,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Text(
                  _formatValue(value),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: _categoryColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  List<FlSpot> _buildSpots() {
    final spots = <FlSpot>[];
    for (int i = 0; i < _timeSeries.length; i++) {
      final value = _timeSeries[i]['value'] as double?;
      if (value != null) {
        spots.add(FlSpot(i.toDouble(), value));
      }
    }
    return spots;
  }

  double get _minY {
    final values = _timeSeries
        .map((d) => d['value'] as double?)
        .where((v) => v != null)
        .cast<double>()
        .toList();
    if (values.isEmpty) return 0;
    final min = values.reduce((a, b) => a < b ? a : b);
    return (min * 0.95).floorToDouble();
  }

  double get _maxY {
    final values = _timeSeries
        .map((d) => d['value'] as double?)
        .where((v) => v != null)
        .cast<double>()
        .toList();
    if (values.isEmpty) return 100;
    final max = values.reduce((a, b) => a > b ? a : b);
    return (max * 1.05).ceilToDouble();
  }

  double _calculateXInterval() {
    if (_timeSeries.length <= 5) return 1;
    if (_timeSeries.length <= 10) return 2;
    return (_timeSeries.length / 5).ceilToDouble();
  }

  double _calculateYInterval() {
    final range = _maxY - _minY;
    if (range <= 0) return 10;
    final targetIntervals = 5;
    final rawInterval = range / targetIntervals;
    final magnitude = math.pow(10, (math.log(rawInterval) / math.ln10).floor());
    final normalized = rawInterval / magnitude;
    final standardInterval = normalized > 5
        ? 10
        : normalized > 2
        ? 5
        : normalized > 1
        ? 2
        : 1;
    return (standardInterval * magnitude).toDouble();
  }

  String _formatValue(double? value) {
    if (value == null) return '--';

    if (widget.category == 'aquaculture') {
      if (value >= 1000) {
        return '${(value / 1000).toStringAsFixed(1)}K';
      }
      return value.toStringAsFixed(0);
    } else if (widget.category == 'fertilizer') {
      return value.toStringAsFixed(0);
    } else if (widget.category == 'harvestStorage') {
      return '${value.toStringAsFixed(1)}%';
    } else if (widget.category == 'cropProtection') {
      return '${value.toStringAsFixed(1)}%';
    } else {
      return value.toStringAsFixed(0);
    }
  }

  String _formatAxisValue(double value) {
    if (widget.category == 'aquaculture') {
      if (value >= 1000) {
        return '${(value / 1000).toStringAsFixed(0)}K';
      }
      return value.toStringAsFixed(0);
    } else if (widget.category == 'fertilizer') {
      return value.toStringAsFixed(0);
    } else if (widget.category == 'harvestStorage' ||
        widget.category == 'cropProtection') {
      return '${value.toStringAsFixed(0)}%';
    } else {
      return value.toStringAsFixed(0);
    }
  }

  String get _latestValue {
    if (_timeSeries.isEmpty) return '--';
    final latest = _timeSeries.last;
    final value = latest['value'] as double?;
    return _formatValue(value);
  }

  String get _trendLabel {
    switch (_trend) {
      case 'up':
        return '↑ ${tr('market.trendUp')}';
      case 'down':
        return '↓ ${tr('market.trendDown')}';
      case 'stable':
        return '→ ${tr('market.trendStable')}';
      default:
        return tr('market.trendUnknown');
    }
  }

  Color get _trendColor {
    switch (_trend) {
      case 'up':
        return Colors.green;
      case 'down':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  Future<void> _getPredictions(BuildContext context) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => _PredictionInputDialog(
        commodityName: _title,
        categoryColor: _categoryColor,
      ),
    );

    if (result == null || !context.mounted) return;

    // Show loading overlay
    if (!context.mounted) return;
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
                tr('market.analyzing'),
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );

    try {
      // Build the prompt with user inputs
      final currentDate = DateTime.now();
      final timeFrame = result['timeFrame'] as String? ?? '6 months';
      final worldNews = result['worldNews'] as String? ?? '';
      final localNews = result['localNews'] as String? ?? '';

      // Build historical data string
      final historyData = _timeSeries
          .map((item) {
            final year = item['year'] as String;
            final value = _formatValue(item['value'] as double?);
            return '  $year: $value';
          })
          .join('\n');

      // Call chatbot proxy API
      final currentLocale = I18nService().currentLocale;
      final currentLanguage = currentLocale.languageCode;

      // Generate prompt in Spanish or English based on language
      final prompt = currentLanguage == 'es'
          ? '''Solicitud de Predicción de Precios de Mercado para El Salvador

Fecha: ${currentDate.day}/${currentDate.month}/${currentDate.year}

Producto: $_title
Marco Temporal de Predicción: $timeFrame

Datos Actuales del Mercado:
• Último Valor: $_latestValue $_unit
• Tendencia: $_trendLabel
• Fuente de Datos: $_dataSource

Datos Históricos de Precios:
$historyData

Contexto del Usuario:
${worldNews.isNotEmpty ? 'Factores de Noticias Mundiales:\n$worldNews\n' : ''}${localNews.isNotEmpty ? 'Factores de Noticias Locales:\n$localNews\n' : ''}

Por favor, proporcione un análisis y predicción integral de precios de mercado para este producto en El Salvador para el período de $timeFrame, tomando en cuenta:

1. Indicadores y tendencias económicas globales que afectan este producto
2. Situación económica actual y entorno regulatorio de El Salvador
3. Eventos y noticias actuales que podrían impactar los precios
4. Patrones estacionales y ciclos de producción específicos de El Salvador
5. Tendencias del mercado regional en Centroamérica
6. Factores de la cadena de suministro y dinámicas de importación/exportación

Proporcione:
• Pronóstico de precios para el marco temporal solicitado
• Factores de riesgo clave que podrían impactar los precios
• Recomendaciones para agricultores/productores
• Cualquier oportunidad o advertencia relevante del mercado'''
          : '''Market Price Prediction Request for El Salvador

Date: ${currentDate.day}/${currentDate.month}/${currentDate.year}

Commodity: $_title
Prediction Time Frame: $timeFrame

Current Market Data:
• Latest Value: $_latestValue $_unit
• Trend: $_trendLabel
• Data Source: $_dataSource

Historical Price Data:
$historyData

User Context:
${worldNews.isNotEmpty ? 'World News Factors:\n$worldNews\n' : ''}${localNews.isNotEmpty ? 'Local News Factors:\n$localNews\n' : ''}

Please provide a comprehensive market price prediction and analysis for this commodity in El Salvador for the $timeFrame period, taking into account:

1. Global economic indicators and trends affecting this commodity
2. El Salvador's current economic situation and regulatory environment
3. Current events and news that could impact prices
4. Seasonal patterns and production cycles specific to El Salvador
5. Regional market trends in Central America
6. Supply chain factors and import/export dynamics

Provide:
• Price forecast for the requested time frame
• Key risk factors that could impact prices
• Recommendations for farmers/producers
• Any relevant market opportunities or warnings''';

      final chatbotProxy = ChatbotProxy();
      final response = await chatbotProxy.submitQuery(
        sessionId:
            'market-predict-${widget.category}-${DateTime.now().millisecondsSinceEpoch}',
        messages: [
          {'role': 'user', 'content': prompt},
        ],
        userId: 'market-prediction-user',
        categoryId: null,
        contextLabels: null,
        language: currentLanguage,
      );

      // Hide loading overlay
      if (context.mounted) {
        Navigator.of(context).pop();
      }

      // Show response in dialog
      if (context.mounted) {
        showDialog(
          context: context,
          builder: (responseContext) => _PredictionResponseDialog(
            commodityName: _title,
            response: response,
            categoryColor: _categoryColor,
          ),
        );
      }
    } catch (e) {
      // Hide loading overlay
      if (context.mounted) {
        Navigator.of(context).pop();
      }

      // Show error
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${tr('market.error')}: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
}

/// Dialog for getting user input for predictions
class _PredictionInputDialog extends StatefulWidget {
  final String commodityName;
  final Color categoryColor;

  const _PredictionInputDialog({
    required this.commodityName,
    required this.categoryColor,
  });

  @override
  State<_PredictionInputDialog> createState() => _PredictionInputDialogState();
}

class _PredictionInputDialogState extends State<_PredictionInputDialog> {
  final TextEditingController _worldNewsController = TextEditingController();
  final TextEditingController _localNewsController = TextEditingController();
  String _selectedTimeFrame = '6 months';
  bool _isSubmitting = false;

  @override
  void dispose() {
    _worldNewsController.dispose();
    _localNewsController.dispose();
    super.dispose();
  }

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
                Icon(Icons.psychology, color: widget.categoryColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    tr('market.getPredictions'),
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
                      '${tr('market.predictionFor')}: ${widget.commodityName}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Time Frame Selection
                    Text(
                      tr('market.selectTimeFrame'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _buildTimeFrameChip(
                          tr('market.timeFrame3Months'),
                          '3 months',
                          theme,
                        ),
                        _buildTimeFrameChip(
                          tr('market.timeFrame6Months'),
                          '6 months',
                          theme,
                        ),
                        _buildTimeFrameChip(
                          tr('market.timeFrame1Year'),
                          '1 year',
                          theme,
                        ),
                        _buildTimeFrameChip(
                          tr('market.timeFrame2Years'),
                          '2 years',
                          theme,
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // World News Input
                    Text(
                      tr('market.worldNewsFactors'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _worldNewsController,
                      decoration: InputDecoration(
                        hintText: tr('market.worldNewsHint'),
                        border: const OutlineInputBorder(),
                      ),
                      maxLines: 3,
                      textInputAction: TextInputAction.next,
                    ),
                    const SizedBox(height: 16),

                    // Local News Input
                    Text(
                      tr('market.localNewsFactors'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _localNewsController,
                      decoration: InputDecoration(
                        hintText: tr('market.localNewsHint'),
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
                  onPressed: _isSubmitting
                      ? null
                      : () => Navigator.of(context).pop(),
                  child: Text(tr('common.cancel')),
                ),
                ElevatedButton.icon(
                  onPressed: _isSubmitting
                      ? null
                      : () {
                          setState(() {
                            _isSubmitting = true;
                          });

                          // Return the user's input
                          Navigator.of(context).pop({
                            'timeFrame': _selectedTimeFrame,
                            'worldNews': _worldNewsController.text.trim(),
                            'localNews': _localNewsController.text.trim(),
                          });
                        },
                  icon: _isSubmitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.send, size: 16),
                  label: Text(tr('common.submit')),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: widget.categoryColor,
                    foregroundColor: Colors.white,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTimeFrameChip(String label, String value, ThemeData theme) {
    final isSelected = _selectedTimeFrame == value;

    return FilterChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) {
        setState(() {
          _selectedTimeFrame = value;
        });
      },
      selectedColor: widget.categoryColor.withValues(alpha: 0.2),
      checkmarkColor: widget.categoryColor,
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
    );
  }
}

/// Dialog for showing AI prediction response
class _PredictionResponseDialog extends StatelessWidget {
  final String commodityName;
  final Map<String, dynamic> response;
  final Color categoryColor;

  const _PredictionResponseDialog({
    required this.commodityName,
    required this.response,
    required this.categoryColor,
  });

  void _sharePrediction(
    BuildContext context,
    String predictionText,
    String platform,
  ) async {
    // Format the prediction for sharing
    final currentDate = DateTime.now();
    final shareText =
        '''
🤖 *${tr('market.predictionsFor')}: $commodityName* 🤖
📅 ${currentDate.day}/${currentDate.month}/${currentDate.year}

━━━━━━━━━━━━━━━

$predictionText

━━━━━━━━━━━━━━━

${tr('market.sharedVia')}
''';

    try {
      if (platform == 'whatsapp') {
        // Use WhatsApp deep link
        final whatsappUrl = Uri.parse(
          'whatsapp://send?text=${Uri.encodeComponent(shareText)}',
        );
        final launched = await launchUrl(
          whatsappUrl,
          mode: LaunchMode.externalApplication,
        );

        if (!launched) {
          // Fallback to generic share if WhatsApp is not installed
          await Share.share(
            shareText,
            subject: '$commodityName - ${tr('market.predictionsFor')}',
          );
        }
      } else if (platform == 'email') {
        // Use email deep link
        final emailUrl = Uri.parse(
          'mailto:?subject=${Uri.encodeComponent('$commodityName - ${tr('market.predictionsFor')}')}&body=${Uri.encodeComponent(shareText)}',
        );
        final launched = await launchUrl(
          emailUrl,
          mode: LaunchMode.platformDefault,
        );

        if (!launched) {
          // Fallback to generic share if email fails
          await Share.share(
            shareText,
            subject: '$commodityName - ${tr('market.predictionsFor')}',
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${tr('market.shareError')}: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Dialog(
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.8,
          maxWidth: MediaQuery.of(context).size.width * 0.95,
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: categoryColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.psychology, color: categoryColor, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tr('market.predictionsFor'),
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        commodityName,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.7,
                          ),
                        ),
                      ),
                    ],
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
            const Divider(height: 24),

            // Scrollable response content
            Expanded(
              child: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: response.containsKey('response')
                      ? MarkdownBody(
                          data:
                              response['response']?.toString() ??
                              tr('market.noResponse'),
                          styleSheet: MarkdownStyleSheet.fromTheme(theme)
                              .copyWith(
                                p: theme.textTheme.bodyMedium?.copyWith(
                                  height: 1.5,
                                ),
                              ),
                          selectable: true,
                          onTapLink: (text, href, title) {
                            if (href != null) {
                              launchUrl(
                                Uri.parse(href),
                                mode: LaunchMode.externalApplication,
                              );
                            }
                          },
                        )
                      : response.containsKey('error')
                      ? Text(
                          response['error']?.toString() ??
                              tr('market.errorOccurred'),
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
                  onPressed: () {
                    Clipboard.setData(
                      ClipboardData(
                        text: response['response']?.toString() ?? '',
                      ),
                    );
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(tr('market.responseCopied')),
                        duration: const Duration(seconds: 2),
                      ),
                    );
                  },
                  icon: const Icon(Icons.copy, size: 16),
                  label: Text(tr('market.copy')),
                ),
                OutlinedButton.icon(
                  onPressed: () => _sharePrediction(
                    context,
                    response['response']?.toString() ?? '',
                    'whatsapp',
                  ),
                  icon: const Icon(Icons.message, size: 16),
                  label: Text(tr('market.shareViaWhatsApp')),
                ),
                OutlinedButton.icon(
                  onPressed: () => _sharePrediction(
                    context,
                    response['response']?.toString() ?? '',
                    'email',
                  ),
                  icon: const Icon(Icons.email, size: 16),
                  label: Text(tr('market.shareViaEmail')),
                ),
                ElevatedButton.icon(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.done, size: 16),
                  label: Text(tr('market.close')),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: categoryColor,
                    foregroundColor: Colors.white,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
