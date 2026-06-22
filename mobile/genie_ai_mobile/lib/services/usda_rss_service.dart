import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:xml/xml.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';

/// USDA RSS Feed Service
///
/// Parses pest alert data from USDA APHIS RSS feeds.
/// Also provides fallback to other public pest alert sources.
class UsdaRssService {
  // USDA APHIS RSS feeds
  static const String _usdaAphisNewsUrl =
      'https://www.aphis.usda.gov/aphis/newsroom/rss';

  /// Get pest alerts for Central America
  Future<Map<String, dynamic>> getPestAlerts({
    String region = 'Central America',
  }) async {
    try {
      debugPrint('[UsdaRssService] Fetching pest alerts for $region');

      // Try to fetch from USDA RSS feed first
      final alerts = await _fetchFromUSDA();

      // If USDA doesn't have enough data, supplement with other sources
      if (alerts.isEmpty) {
        debugPrint(
          '[UsdaRssService] No USDA alerts found, trying alternative sources',
        );
        return await _getMockData();
      }

      // Filter for Central America/El Salvador relevant alerts
      final relevantAlerts = _filterForRegion(alerts, region);

      // Calculate summary statistics
      final summary = _calculateSummary(relevantAlerts);

      return {
        'region': region,
        'lastUpdated': DateTime.now().toIso8601String(),
        'dataSource': 'USDA APHIS RSS',
        'alerts': relevantAlerts,
        'summary': summary,
      };
    } catch (e) {
      debugPrint('[UsdaRssService] Error fetching alerts: $e');
      return await _getMockData();
    }
  }

  /// Fetch and parse USDA RSS feed
  Future<List<Map<String, dynamic>>> _fetchFromUSDA() async {
    try {
      final response = await http
          .get(Uri.parse(_usdaAphisNewsUrl))
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        // Parse RSS feed
        final document = XmlDocument.parse(response.body);
        final items = document.findAllElements('item');

        return items
            .map((item) {
              final title = item.findElements('title').first.innerText;
              final description = item
                  .findElements('description')
                  .first
                  .innerText;
              final link = item.findElements('link').first.innerText;
              final pubDate = item.findElements('pubDate').first.innerText;

              return _parseRssItem(title, description, link, pubDate);
            })
            .where((alert) => alert != null)
            .cast<Map<String, dynamic>>()
            .toList();
      }

      return [];
    } catch (e) {
      debugPrint('[UsdaRssService] Error parsing RSS feed: $e');
      return [];
    }
  }

  /// Parse an RSS item into a pest alert
  Map<String, dynamic>? _parseRssItem(
    String title,
    String description,
    String link,
    String pubDate,
  ) {
    // Extract pest information from title and description
    final lowerTitle = title.toLowerCase();
    final lowerDesc = description.toLowerCase();

    // Check if it's relevant to Central America/El Salvador
    final relevantKeywords = [
      'el salvador',
      'central america',
      'guatemala',
      'honduras',
      'nicaragua',
      'costa rica',
    ];

    final isRelevant = relevantKeywords.any(
      (keyword) => lowerDesc.contains(keyword) || lowerTitle.contains(keyword),
    );

    if (!isRelevant) return null;

    // Determine pest type
    String? pest;
    String? scientificName;

    if (lowerTitle.contains('armyworm') || lowerDesc.contains('armyworm')) {
      pest = 'Fall Armyworm';
      scientificName = 'Spodoptera frugiperda';
    } else if (lowerTitle.contains('coffee rust') ||
        lowerDesc.contains('coffee rust')) {
      pest = 'Coffee Leaf Rust';
      scientificName = 'Hemileia vastatrix';
    } else if (lowerTitle.contains('medfly') ||
        lowerDesc.contains('medfly') ||
        lowerDesc.contains('fruit fly')) {
      pest = 'Mediterranean Fruit Fly';
      scientificName = 'Ceratitis capitata';
    } else if (lowerTitle.contains('rust') || lowerDesc.contains('rust')) {
      pest = 'Plant Rust Disease';
      scientificName = 'Pucciniales';
    }

    if (pest == null) return null;

    // Determine severity
    String severity;
    if (lowerDesc.contains('high') ||
        lowerDesc.contains('severe') ||
        lowerDesc.contains('outbreak') ||
        lowerDesc.contains('emergency')) {
      severity = 'high';
    } else if (lowerDesc.contains('moderate') ||
        lowerDesc.contains('warning') ||
        lowerDesc.contains('monitor')) {
      severity = 'moderate';
    } else {
      severity = 'low';
    }

    // Extract affected crops
    final crops = <String>[];
    if (lowerDesc.contains('maize') || lowerDesc.contains('corn')) {
      crops.add('Maize');
    }
    if (lowerDesc.contains('coffee')) {
      crops.add('Coffee');
    }
    if (lowerDesc.contains('bean')) {
      crops.add('Beans');
    }
    if (lowerDesc.contains('sorghum')) {
      crops.add('Sorghum');
    }
    if (lowerDesc.contains('tomato')) {
      crops.add('Tomatoes');
    }
    if (lowerDesc.contains('fruit')) {
      crops.add('Fruits');
    }

    // Parse date
    DateTime firstDetected;
    try {
      firstDetected = DateTime.parse(pubDate);
    } catch (e) {
      firstDetected = DateTime.now();
    }

    return {
      'id': 'usda-${DateTime.now().millisecondsSinceEpoch}',
      'pest': pest,
      'scientificName': scientificName,
      'severity': severity,
      'affectedCrops': crops.isEmpty ? ['Multiple'] : crops,
      'departments': [
        'El Salvador',
      ], // RSS feeds don't always have specific departments
      'description': _stripHtmlTags(description),
      'recommendations':
          'Monitor fields regularly. Contact local agricultural extension for specific treatment recommendations.',
      'firstDetected': firstDetected.toIso8601String().split('T')[0],
      'source': 'USDA APHIS',
      'link': link,
    };
  }

  /// Strip HTML tags from text
  String _stripHtmlTags(String html) {
    // Simple HTML tag removal
    return html.replaceAll(RegExp(r'<[^>]*>'), '').trim();
  }

  /// Filter alerts for specific region
  List<Map<String, dynamic>> _filterForRegion(
    List<Map<String, dynamic>> alerts,
    String region,
  ) {
    // For now, return all alerts since RSS filtering is limited
    // In production, you'd use more sophisticated filtering
    return alerts.take(10).toList();
  }

  /// Calculate summary statistics
  Map<String, int> _calculateSummary(List<Map<String, dynamic>> alerts) {
    final high = alerts.where((a) => a['severity'] == 'high').length;
    final moderate = alerts.where((a) => a['severity'] == 'moderate').length;
    final low = alerts.where((a) => a['severity'] == 'low').length;

    return {
      'total': alerts.length,
      'high': high,
      'moderate': moderate,
      'low': low,
    };
  }

  /// Mock data when RSS feeds are unavailable
  /// Enhanced with realistic seasonal patterns for El Salvador
  Future<Map<String, dynamic>> _getMockData() async {
    debugPrint('[UsdaRssService] Using enhanced seasonal mock data');

    final now = DateTime.now();
    final currentMonth = now.month;
    final currentYear = now.year;
    final isSpanish = I18nService().currentLocale.languageCode == 'es';

    // Generate seasonally appropriate alerts
    final alerts = _generateSeasonalAlerts(currentMonth, currentYear);

    // Calculate summary statistics
    final summary = _calculateSummary(alerts);

    return {
      'region': isSpanish ? 'El Salvador' : 'El Salvador',
      'lastUpdated': now.toIso8601String(),
      'dataSource': isSpanish
          ? 'Datos estacionales mejorados (modo demo)'
          : 'Enhanced seasonal data (demo mode)',
      'alerts': alerts,
      'summary': summary,
      'season': _getSeasonName(currentMonth),
      'notes': isSpanish
          ? 'Estos datos usan patrones estacionales realistas para El Salvador. '
                'Reemplazar con datos reales de API cuando estén disponibles.'
          : 'This data uses realistic seasonal patterns for El Salvador. '
                'Replace with actual API data when available.',
    };
  }

  /// Generate pest alerts based on seasonal patterns
  List<Map<String, dynamic>> _generateSeasonalAlerts(int month, int year) {
    final alerts = <Map<String, dynamic>>[];
    final isSpanish = I18nService().currentLocale.languageCode == 'es';

    // El Salvador has two main seasons:
    // - Dry season (Nov-April): Cooler, less humidity
    // - Rainy season (May-October): Hot, humid, peak pest activity

    // El Salvador has two main seasons:
    // - Dry season (Nov-April): Cooler, less humidity
    // - Rainy season (May-October): Hot, humid, peak pest activity

    // Month-based pest activation (1-12 scale)
    // Each pest has peak months where it's most severe

    // FALL ARMYWORM (Spodoptera frugiperda)
    // Peak: May-October (rainy season)
    // Severity: Increases with humidity and temperature
    final armywormSeverity = _getSeasonalSeverity(
      month,
      peakStart: 5, // May
      peakEnd: 10, // October
    );

    if (armywormSeverity != 'none') {
      final affectedDepts = _getDepartmentsForPest('fall_armyworm', month);
      alerts.add({
        'id': 'fall-armyworm-$year-${month.toString().padLeft(2, '0')}',
        'pest': isSpanish ? 'Cogollero' : 'Fall Armyworm',
        'scientificName': 'Spodoptera frugiperda',
        'severity': armywormSeverity,
        'affectedCrops': isSpanish ? ['Maíz', 'Sorgo'] : ['Maize', 'Sorghum'],
        'departments': affectedDepts,
        'description': _getFallArmywormDescription(
          month,
          armywormSeverity,
          isSpanish,
        ),
        'recommendations': _getFallArmywormRecommendations(
          armywormSeverity,
          isSpanish,
        ),
        'firstDetected': _getFirstDetectedDate(month, year),
        'source': isSpanish
            ? 'MAG - Ministerio de Agricultura y Ganadería'
            : 'MAG - Ministry of Agriculture and Livestock',
        'link': 'https://www.gob.sv/ministerio-de-agricultura-y-ganaderia/',
        'seasonalPattern': isSpanish
            ? 'Actividad máxima: Mayo-Octubre (época lluviosa)'
            : 'Peak activity: May-October (rainy season)',
        'trend': _getTrend(month, 5, 10), // Peak months
      });
    }

    // COFFEE LEAF RUST (Hemileia vastatrix)
    // Peak: June-September (humid months in coffee zones)
    // Severity: Highest in high-altitude areas during humid period
    final coffeeRustSeverity = _getSeasonalSeverity(
      month,
      peakStart: 6, // June
      peakEnd: 9, // September
    );

    if (coffeeRustSeverity != 'none') {
      final affectedDepts = _getDepartmentsForPest('coffee_rust', month);
      alerts.add({
        'id': 'coffee-rust-$year-${month.toString().padLeft(2, '0')}',
        'pest': isSpanish ? 'Roya del Café' : 'Coffee Leaf Rust',
        'scientificName': 'Hemileia vastatrix',
        'severity': coffeeRustSeverity,
        'affectedCrops': isSpanish ? ['Café'] : ['Coffee'],
        'departments': affectedDepts,
        'description': _getCoffeeRustDescription(
          month,
          coffeeRustSeverity,
          isSpanish,
        ),
        'recommendations': _getCoffeeRustRecommendations(
          coffeeRustSeverity,
          isSpanish,
        ),
        'firstDetected': _getFirstDetectedDate(month, year),
        'source': isSpanish
            ? 'PROCAFE - Programa Cooperativo Regional para el Desarrollo Tecnológico Moderno de la Caficultura'
            : 'PROCAFE - Regional Cooperative Program for Technological Development of Coffee Growing',
        'link': 'https://www.procafe.org.sv/',
        'seasonalPattern': isSpanish
            ? 'Actividad máxima: Junio-Septiembre (meses húmedos)'
            : 'Peak activity: June-September (humid months)',
        'trend': _getTrend(month, 6, 9),
      });
    }

    // WHITEFLY (Bemisia tabaci)
    // Peak: March-May (spring), September-November (fall)
    // Year-round pest but peaks in transitional periods
    final whiteflySeverity = _getSeasonalSeverity(
      month,
      peakStart: 3, // March
      peakEnd: 5, // May
      secondaryPeakStart: 9,
      secondaryPeakEnd: 11,
    );

    if (whiteflySeverity != 'none') {
      final affectedDepts = _getDepartmentsForPest('whitefly', month);
      alerts.add({
        'id': 'whitefly-$year-${month.toString().padLeft(2, '0')}',
        'pest': isSpanish ? 'Mosca Blanca' : 'Whitefly',
        'scientificName': 'Bemisia tabaci',
        'severity': whiteflySeverity,
        'affectedCrops': isSpanish
            ? ['Frijoles', 'Tomates', 'Chiles', 'Pepinos', 'Ayote']
            : ['Beans', 'Tomatoes', 'Peppers', 'Cucumbers', 'Squash'],
        'departments': affectedDepts,
        'description': _getWhiteflyDescription(
          month,
          whiteflySeverity,
          isSpanish,
        ),
        'recommendations': _getWhiteflyRecommendations(
          whiteflySeverity,
          isSpanish,
        ),
        'firstDetected': _getFirstDetectedDate(month, year),
        'source': isSpanish
            ? 'CENTA - Centro Nacional de Tecnología Agropecuaria y Forestal'
            : 'CENTA - National Center for Agricultural and Forestry Technology',
        'link': 'https://www.centa.gob.sv/',
        'seasonalPattern': isSpanish
            ? 'Actividad máxima: Marzo-Mayo y Septiembre-Noviembre (períodos de transición)'
            : 'Peak activity: March-May and September-November (transitional periods)',
        'trend': _getTrend(month, 3, 5),
      });
    }

    // LATE BLIGHT (Phytophthora infestans)
    // Peak: October-February (cooler, humid months)
    // Severity: Higher in highland areas during cooler periods
    final lateBlightSeverity = _getSeasonalSeverity(
      month,
      peakStart: 10, // October
      peakEnd: 2, // February (crosses year boundary)
    );

    if (lateBlightSeverity != 'none') {
      final affectedDepts = _getDepartmentsForPest('late_blight', month);
      alerts.add({
        'id': 'late-blight-$year-${month.toString().padLeft(2, '0')}',
        'pest': isSpanish ? 'Tizón Tardío' : 'Late Blight',
        'scientificName': 'Phytophthora infestans',
        'severity': lateBlightSeverity,
        'affectedCrops': isSpanish
            ? ['Tomates', 'Papas']
            : ['Tomatoes', 'Potatoes'],
        'departments': affectedDepts,
        'description': _getLateBlightDescription(
          month,
          lateBlightSeverity,
          isSpanish,
        ),
        'recommendations': _getLateBlightRecommendations(
          lateBlightSeverity,
          isSpanish,
        ),
        'firstDetected': _getFirstDetectedDate(month, year),
        'source': isSpanish
            ? 'CENTA - Centro Nacional de Tecnología Agropecuaria y Forestal'
            : 'CENTA - National Center for Agricultural and Forestry Technology',
        'link': 'https://www.centa.gob.sv/boletines-para-hortalizas/',
        'seasonalPattern': isSpanish
            ? 'Actividad máxima: Octubre-Febrero (meses frescos y húmedos)'
            : 'Peak activity: October-February (cooler, humid months)',
        'trend': _getTrend(month, 10, 12), // Handle December+
      });
    }

    // COFFEE BORER BEETLE (Hypothenemus hampei)
    // Year-round but peak during coffee harvest (Nov-February)
    // Severity: Highest during harvest and processing
    if (month >= 11 || month <= 2) {
      final borerSeverity = month == 12 || month == 1 ? 'high' : 'moderate';
      alerts.add({
        'id': 'coffee-borer-$year-${month.toString().padLeft(2, '0')}',
        'pest': isSpanish ? 'Broca del Café' : 'Coffee Berry Borer',
        'scientificName': 'Hypothenemus hampei',
        'severity': borerSeverity,
        'affectedCrops': isSpanish ? ['Café'] : ['Coffee'],
        'departments': ['Santa Ana', 'Ahuachapán', 'Sonsonate', 'La Libertad'],
        'description': month == 1 || month == 2
            ? isSpanish
                  ? 'Actividad máxima de la broca durante la cosecha principal. Adultos perforando los granos de café.'
                  : 'Peak borer activity during main harvest season. Adults boring into coffee berries.'
            : isSpanish
            ? 'Monitoreo postcosecha crítico. Procesamiento y almacenamiento adecuados esenciales.'
            : 'Post-harvest monitoring critical. Proper processing and storage essential.',
        'recommendations': isSpanish
            ? 'Cosechar todos los granos, despalmar si es necesario. Usar trampas, sanitizar equipos, garantizar procesamiento adecuado. Eliminar y destruir granos infestados.'
            : 'Harvest all berries, strip-pick if necessary. Use traps, sanitize equipment, ensure proper processing. Remove and destroy infested berries.',
        'firstDetected': DateTime(
          month <= 2 ? year - 1 : year,
          11,
          1,
        ).toIso8601String().split('T')[0],
        'source': 'PROCAFE',
        'link': 'https://www.procafe.org.sv/',
        'seasonalPattern': isSpanish
            ? 'Máximo durante cosecha de café: Noviembre-Febrero'
            : 'Peak during coffee harvest: November-February',
        'trend': month <= 2 ? 'decreasing' : 'increasing',
      });
    }

    return alerts;
  }

  /// Get severity level based on current month relative to peak season
  String _getSeasonalSeverity(
    int currentMonth, {
    required int peakStart,
    required int peakEnd,
    int? secondaryPeakStart,
    int? secondaryPeakEnd,
  }) {
    // Check if we're in primary peak season
    bool inPrimaryPeak = false;
    if (peakStart <= peakEnd) {
      inPrimaryPeak = currentMonth >= peakStart && currentMonth <= peakEnd;
    } else {
      // Crosses year boundary (e.g., October to February)
      inPrimaryPeak = currentMonth >= peakStart || currentMonth <= peakEnd;
    }

    // Check if we're in secondary peak season
    bool inSecondaryPeak = false;
    if (secondaryPeakStart != null && secondaryPeakEnd != null) {
      if (secondaryPeakStart <= secondaryPeakEnd) {
        inSecondaryPeak =
            currentMonth >= secondaryPeakStart &&
            currentMonth <= secondaryPeakEnd;
      } else {
        inSecondaryPeak =
            currentMonth >= secondaryPeakStart ||
            currentMonth <= secondaryPeakEnd;
      }
    }

    // Determine severity based on proximity to peak
    if (inPrimaryPeak || inSecondaryPeak) {
      return 'high';
    }

    // Check shoulder months (1 month before/after peak)
    bool inShoulder = false;
    if (peakStart <= peakEnd) {
      inShoulder = currentMonth == peakStart - 1 || currentMonth == peakEnd + 1;
    } else {
      inShoulder =
          currentMonth == peakStart - 1 ||
          currentMonth == peakEnd + 1 ||
          currentMonth == 12 ||
          currentMonth == 1;
    }

    if (secondaryPeakStart != null && secondaryPeakEnd != null) {
      if (secondaryPeakStart <= secondaryPeakEnd) {
        inShoulder =
            inShoulder ||
            currentMonth == secondaryPeakStart - 1 ||
            currentMonth == secondaryPeakEnd + 1;
      } else {
        inShoulder =
            inShoulder ||
            currentMonth == secondaryPeakStart - 1 ||
            currentMonth == secondaryPeakEnd + 1;
      }
    }

    if (inShoulder) {
      return 'moderate';
    }

    // Check off-season (2 months away from peak)
    bool inOffSeason = false;
    if (peakStart <= peakEnd) {
      inOffSeason =
          currentMonth == peakStart - 2 || currentMonth == peakEnd + 2;
    } else {
      inOffSeason =
          currentMonth == peakStart - 2 || currentMonth == peakEnd + 2;
    }

    if (inOffSeason) {
      return 'low';
    }

    // Otherwise, pest is not active
    return 'none';
  }

  /// Get affected departments for specific pest based on season
  List<String> _getDepartmentsForPest(String pestType, int month) {
    // El Salvador's 14 departments
    final allDepts = [
      'Ahuachapán',
      'Santa Ana',
      'Sonsonate',
      'Chalatenango',
      'La Libertad',
      'San Salvador',
      'Cuscatlán',
      'La Paz',
      'Cabañas',
      'San Vicente',
      'Usulután',
      'San Miguel',
      'Morazán',
      'La Unión',
    ];

    switch (pestType) {
      case 'fall_armyworm':
        // Prefers lowland, hot, humid areas
        return month >= 5 && month <= 10
            ? ['San Miguel', 'Usulután', 'La Unión', 'Morazán', 'San Vicente']
            : ['Usulután', 'San Miguel'];

      case 'coffee_rust':
        // High-altitude coffee zones
        return [
          'Santa Ana',
          'Ahuachapán',
          'Sonsonate',
          'La Libertad',
          'Chalatenango',
          'Cabañas',
        ];

      case 'whitefly':
        // Valley regions, vegetable-producing areas
        return [
          'San Salvador',
          'La Libertad',
          'La Paz',
          'San Vicente',
          'Usulután',
        ];

      case 'late_blight':
        // Cooler highland areas
        return ['Chalatenango', 'Cabañas', 'San Vicente', 'Cuscatlán'];

      default:
        return allDepts.sublist(0, 4); // Return first 4 departments
    }
  }

  /// Get trend direction based on current month relative to peak
  String _getTrend(int currentMonth, int peakStart, int peakEnd) {
    if (peakStart <= peakEnd) {
      if (currentMonth < peakStart) return 'increasing';
      if (currentMonth > peakEnd) return 'decreasing';
      return 'stable';
    } else {
      // Crosses year boundary
      if (currentMonth > peakEnd && currentMonth < peakStart) {
        return 'decreasing';
      }
      return 'stable';
    }
  }

  /// Get first detected date (relative to current month)
  String _getFirstDetectedDate(int month, int year) {
    // Pest was detected 1-3 weeks ago
    final weeksAgo = (month % 3) + 1;
    final date = DateTime(
      year,
      month,
      1,
    ).subtract(Duration(days: weeksAgo * 7));
    return date.toIso8601String().split('T')[0];
  }

  /// Get season name
  String _getSeasonName(int month) {
    final isSpanish = I18nService().currentLocale.languageCode == 'es';
    if (month >= 11 || month <= 4) {
      return isSpanish ? 'Estación Seca (Nov-Abril)' : 'Dry Season (Nov-April)';
    }
    if (month >= 5 && month <= 10) {
      return isSpanish
          ? 'Estación Lluviosa (May-Octubre)'
          : 'Rainy Season (May-October)';
    }
    return isSpanish ? 'Transición' : 'Transition';
  }

  // FALL ARMYWORM descriptions and recommendations
  String _getFallArmywormDescription(
    int month,
    String severity,
    bool isSpanish,
  ) {
    final severityDesc = severity == 'high'
        ? (isSpanish ? 'severa' : 'severe')
        : severity == 'moderate'
        ? (isSpanish ? 'moderada' : 'moderate')
        : (isSpanish ? 'baja' : 'low');

    if (isSpanish) {
      return 'La actividad del Cogollero es $severityDesc en los departamentos del oriente y costeros. '
          'Las larvas se alimentan en las cogollas del maíz causando daño de "perforación". ${month >= 5 && month <= 10 ? 'Las lluvias fuertes promueven la reproducción rápida y propagación. Monitorear de cerca.' : 'Las condiciones secas limitan la propagación pero las poblaciones persisten en áreas irrigadas.'}';
    } else {
      return 'Fall Armyworm activity is $severityDesc in eastern and coastal departments. '
          'Larvae feeding in maize whorls causing "shot-hole" damage. ${month >= 5 && month <= 10 ? 'Heavy rains promoting rapid reproduction and spread. Monitor closely.' : 'Dry conditions limiting spread but populations persist in irrigated areas.'}';
    }
  }

  String _getFallArmywormRecommendations(String severity, bool isSpanish) {
    if (severity == 'high') {
      return isSpanish
          ? 'URGENTE: Aplicar insecticida a la cogolla si >20% de plantas infestadas. Usar trampas de feromonas para monitoreo. '
                'Considerar control biológico: avispas Trichogramma, Bacillus thuringiensis. '
                'Destruir residuos de cultivos, rotar cultivos, mantener sanidad del campo.'
          : 'URGENT: Apply insecticide to whorl if >20% plants infested. Use pheromone traps for monitoring. '
                'Consider biological control: Trichogramma wasps, Bacillus thuringiensis. '
                'Destroy crop residue, rotate crops, maintain field sanitation.';
    } else if (severity == 'moderate') {
      return isSpanish
          ? 'Monitorear campos semanalmente buscando daño en cogollas y frass. Aplicar trampas de feromonas. '
                'Si >10% de infestación, considerar aplicación dirigida de insecticida. '
                'Fomentar enemigos naturales (aves, avispas parasitoides).'
          : 'Monitor fields weekly for whorl damage and frass. Apply pheromone traps. '
                'If >10% infestation, consider targeted insecticide application. '
                'Encourage natural enemies (birds, parasitoid wasps).';
    } else {
      return isSpanish
          ? 'Monitoreo rutinario. Revisar cogollas buscando daño alimenticio y frass. '
                'Mantener higiene del campo. Prepararse para temporada máxima (Mayo-Octubre).'
          : 'Routine monitoring. Check whorls for feeding damage and frass. '
                'Maintain field hygiene. Prepare for peak season (May-October).';
    }
  }

  // COFFEE RUST descriptions and recommendations
  String _getCoffeeRustDescription(int month, String severity, bool isSpanish) {
    if (isSpanish) {
      return 'La Roya del Café muestra incidencia $severity en altitudes >1000m. '
          'Manchas polvorientas amarillo-naranja en el envés de las hojas. ${month >= 6 && month <= 9 ? 'Condiciones húmedas favoreciendo la dispersión rápida de esporas. Período crítico para prevención.' : 'Menor humedad reduciendo la propagación pero manteniendo vigilancia en plantaciones sombreadas.'}';
    } else {
      return 'Coffee Leaf Rust showing $severity incidence in altitudes >1000m. '
          'Orange-yellow powdery spots on lower leaf surfaces. ${month >= 6 && month <= 9 ? 'Humid conditions favoring rapid spore dispersal. Critical period for prevention.' : 'Lower humidity reducing spread but maintaining vigilance in shaded plantations.'}';
    }
  }

  String _getCoffeeRustRecommendations(String severity, bool isSpanish) {
    if (severity == 'high') {
      return isSpanish
          ? 'CRÍTICO: Aplicar fungicida sistémico inmediatamente. Remover y destruir hojas infectadas. '
                'Mejorar circulación de aire mediante poda. Usar variedades resistentes (Caturra, Bourbon). '
                'Monitorear semanalmente - la roya se propaga rápido en humedad.'
          : 'CRITICAL: Apply systemic fungicide immediately. Remove and destroy infected leaves. '
                'Improve air circulation through pruning. Use resistant varieties (Caturra, Bourbon). '
                'Monitor weekly - rust spreads rapidly in humidity.';
    } else if (severity == 'moderate') {
      return isSpanish
          ? 'Aplicar fungicida preventivo (base de cobre). Remover hojas muy infectadas. '
                'Garantizar espaciamiento adecuado y manejo de sombra. Monitorear huerta quincenalmente.'
          : 'Apply preventive fungicide (copper-based). Remove heavily infected leaves. '
                'Ensure proper spacing and shade management. Monitor orchard biweekly.';
    } else {
      return isSpanish
          ? 'Monitoreo rutinario. Revisar envés de hojas buscando pústulas anaranjadas. '
                'Mantener salud de las plantas mediante nutrición y poda adecuadas.'
          : 'Routine monitoring. Check lower leaf surfaces for orange pustules. '
                'Maintain plant health through proper nutrition and pruning.';
    }
  }

  // WHITEFLY descriptions and recommendations
  String _getWhiteflyDescription(int month, String severity, bool isSpanish) {
    if (isSpanish) {
      return 'Poblaciones de Mosca Blanca en niveles $severity en valles productores de vegetales. '
          'Ninfas y adultos en el envés de las hojas. ${month >= 3 && month <= 5 ? 'Temperaturas primaverales favoreciendo reproducción rápida. Riesgo de transmisión de virus elevado.' : 'Monitoreo crítico. Puede transmitir virus Gemini y otras enfermedades.'}';
    } else {
      return 'Whitefly populations at $severity levels in vegetable-producing valleys. '
          'Nymphs and adults on leaf undersides. ${month >= 3 && month <= 5 ? 'Spring temperatures favoring rapid reproduction. Virus transmission risk elevated.' : 'Monitoring critical. Can transmit Gemini virus and other diseases.'}';
    }
  }

  String _getWhiteflyRecommendations(String severity, bool isSpanish) {
    if (severity == 'high') {
      return isSpanish
          ? 'Aplicar jabón insecticida o aceite de neem al envés de las hojas. Instalar trampas pegajosas amarillas (20/hectárea). '
                'Evitar insecticidas de amplio espectro para preservar enemigos naturales (Encarsia formosa). '
                'Remover plantas muy infestadas. Rotar modos de acción de insecticidas.'
          : 'Apply insecticidal soap or neem oil to undersides of leaves. Install yellow sticky traps (20/acre). '
                'Avoid broad-spectrum insecticides to preserve natural enemies (Encarsia formosa). '
                'Remove heavily infested plants. Rotate insecticide modes of action.';
    } else if (severity == 'moderate') {
      return isSpanish
          ? 'Monitorear el envés de las hojas semanalmente. Usar trampas pegajosas amarillas para detección temprana. '
                'Fomentar depredadores naturales. Aplicar aceites hortícolas si es necesario.'
          : 'Monitor leaf undersides weekly. Use yellow sticky traps for early detection. '
                'Encourage natural predators. Apply horticultural oils if needed.';
    } else {
      return isSpanish
          ? 'Monitoreo rutinario con trampas pegajosas amarillas. Revisar envés de las hojas. '
                'Mantener plantas saludables - el estrés aumenta la susceptibilidad.'
          : 'Routine monitoring with yellow sticky traps. Check undersides of leaves. '
                'Maintain healthy plants - stress increases susceptibility.';
    }
  }

  // LATE BLIGHT descriptions and recommendations
  String _getLateBlightDescription(int month, String severity, bool isSpanish) {
    if (isSpanish) {
      return 'Condiciones de Tizón Tardío $severity en zonas de altura. '
          'Lesiones empapadas de agua, crecimiento de moho blanco en hojas. ${month >= 10 || month <= 2 ? 'Clima fresco y húmedo ideal para desarrollo de la enfermedad. Riesgo de propagación rápida.' : 'Temperaturas más cálidas limitando propagación pero monitorear en zonas sombreadas y de gran altitud.'}';
    } else {
      return 'Late Blight conditions $severity in highland areas. '
          'Water-soaked lesions, white mold growth on leaves. ${month >= 10 || month <= 2 ? 'Cool, humid weather ideal for disease development. Risk of rapid spread.' : 'Warmer temperatures limiting spread but monitor in shaded, high-altitude areas.'}';
    }
  }

  String _getLateBlightRecommendations(String severity, bool isSpanish) {
    if (severity == 'high') {
      return isSpanish
          ? 'URGENTE: Aplicar fungicida base de cobre o sistémico inmediatamente. Remover y destruir material vegetal infectado. '
                'Garantizar buen drenaje y circulación de aire. Evitar riego por aspersión. '
                'Rotar cultivos - evitar solanáceas en la misma ubicación por 3 años.'
          : 'URGENT: Apply copper-based or systemic fungicide immediately. Remove and destroy infected plant material. '
                'Ensure good drainage and air circulation. Avoid overhead irrigation. '
                'Rotate crops - avoid nightshades in same location for 3 years.';
    } else if (severity == 'moderate') {
      return isSpanish
          ? 'Aplicar fungicida preventivo (cobre o clotalonil). Garantizar buen drenaje. '
                'Espaciar plantas para flujo de aire. Remover hojas infectadas rápidamente. Regar en base, no en hojas.'
          : 'Apply preventive fungicide (copper or chlorothalonil). Ensure good drainage. '
                'Space plants for airflow. Remove infected leaves promptly. Water at base, not leaves.';
    } else {
      return isSpanish
          ? 'Monitorear lesiones empapadas de agua, especialmente después de lluvia. Garantizar buen drenaje. '
                'Usar variedades resistentes cuando estén disponibles. Evitar riego por aspersión.'
          : 'Monitor for water-soaked lesions, especially after rain. Ensure good drainage. '
                'Use resistant varieties when available. Avoid overhead irrigation.';
    }
  }
}
