// USDA RSS Service - Pest Alerts Data
// Enhanced seasonal mock data for El Salvador

class UsdaRssService {
  constructor() {
    this.departmentCoordinates = {
      'Ahuachapán': { lat: 13.9833, lng: -89.8333 },
      'Santa Ana': { lat: 13.9936, lng: -89.5564 },
      'Sonsonate': { lat: 13.7167, lng: -89.7267 },
      'Chalatenango': { lat: 14.0333, lng: -88.9167 },
      'La Libertad': { lat: 13.4833, lng: -89.3167 },
      'San Salvador': { lat: 13.7000, lng: -89.2000 },
      'Cuscatlán': { lat: 13.7333, lng: -88.9000 },
      'La Paz': { lat: 13.4500, lng: -88.9167 },
      'Cabañas': { lat: 13.8500, lng: -88.6667 },
      'San Vicente': { lat: 13.6167, lng: -88.7833 },
      'Usulután': { lat: 13.3667, lng: -88.4500 },
      'San Miguel': { lat: 13.4833, lng: -88.1833 },
      'Morazán': { lat: 13.7500, lng: -88.0000 },
      'La Unión': { lat: 13.5333, lng: -87.8500 }
    };
  }

  async getPestAlerts(region = 'Central America') {
    console.log('[UsdaRssService] Fetching pest alerts for', region);

    try {
      // Return enhanced seasonal mock data
      return await this.getMockData();
    } catch (error) {
      console.error('[UsdaRssService] Error fetching alerts:', error);
      return await this.getMockData();
    }
  }

  async getMockData() {
    console.log('[UsdaRssService] Using enhanced seasonal mock data');

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // JavaScript months are 0-based
    const currentYear = now.getFullYear();

    // Generate seasonally appropriate alerts
    const alerts = this.generateSeasonalAlerts(currentMonth, currentYear);

    // Calculate summary statistics
    const summary = this.calculateSummary(alerts);

    return {
      region: 'El Salvador',
      lastUpdated: now.toISOString(),
      dataSource: 'Enhanced seasonal data (demo mode)',
      alerts: alerts,
      summary: summary,
      season: this.getSeasonName(currentMonth),
      notes: 'This data uses realistic seasonal patterns for El Salvador. Replace with actual API data when available.'
    };
  }

  generateSeasonalAlerts(month, year) {
    const alerts = [];
    const isSpanish = this.getCurrentLanguage() === 'es';

    // FALL ARMYWORM (Spodoptera frugiperda)
    // Peak: May-October (rainy season)
    const armywormSeverity = this.getSeasonalSeverity(month, {
      peakStart: 5,
      peakEnd: 10
    });

    if (armywormSeverity !== 'none') {
      const affectedDepts = this.getDepartmentsForPest('fall_armyworm', month);
      alerts.push({
        id: `fall-armyworm-${year}-${month.toString().padStart(2, '0')}`,
        pest: isSpanish ? 'Cogollero' : 'Fall Armyworm',
        scientificName: 'Spodoptera frugiperda',
        severity: armywormSeverity,
        affectedCrops: isSpanish ? ['Maíz', 'Sorgo'] : ['Maize', 'Sorghum'],
        departments: affectedDepts,
        description: this.getFallArmywormDescription(month, armywormSeverity, isSpanish),
        recommendations: this.getFallArmywormRecommendations(armywormSeverity, isSpanish),
        firstDetected: this.getFirstDetectedDate(month, year),
        source: isSpanish ? 'MAG - Ministerio de Agricultura y Ganadería' : 'MAG - Ministry of Agriculture and Livestock',
        link: 'https://www.gob.sv/ministerio-de-agricultura-y-ganaderia/',
        seasonalPattern: isSpanish ? 'Actividad máxima: Mayo-Octubre (época lluviosa)' : 'Peak activity: May-October (rainy season)',
        trend: this.getTrend(month, 5, 10)
      });
    }

    // COFFEE LEAF RUST (Hemileia vastatrix)
    // Peak: June-September (humid months)
    const coffeeRustSeverity = this.getSeasonalSeverity(month, {
      peakStart: 6,
      peakEnd: 9
    });

    if (coffeeRustSeverity !== 'none') {
      const affectedDepts = this.getDepartmentsForPest('coffee_rust', month);
      alerts.push({
        id: `coffee-rust-${year}-${month.toString().padStart(2, '0')}`,
        pest: isSpanish ? 'Roya del Café' : 'Coffee Leaf Rust',
        scientificName: 'Hemileia vastatrix',
        severity: coffeeRustSeverity,
        affectedCrops: isSpanish ? ['Café'] : ['Coffee'],
        departments: affectedDepts,
        description: this.getCoffeeRustDescription(month, coffeeRustSeverity, isSpanish),
        recommendations: this.getCoffeeRustRecommendations(coffeeRustSeverity, isSpanish),
        firstDetected: this.getFirstDetectedDate(month, year),
        source: isSpanish ? 'PROCAFE - Programa Cooperativo Regional para el Desarrollo Tecnológico Moderno de la Caficultura' : 'PROCAFE - Regional Cooperative Program for Technological Development of Coffee Growing',
        link: 'https://www.procafe.org.sv/',
        seasonalPattern: isSpanish ? 'Actividad máxima: Junio-Septiembre (meses húmedos)' : 'Peak activity: June-September (humid months)',
        trend: this.getTrend(month, 6, 9)
      });
    }

    // WHITEFLY (Bemisia tabaci)
    // Peak: March-May and September-November
    const whiteflySeverity = this.getSeasonalSeverity(month, {
      peakStart: 3,
      peakEnd: 5,
      secondaryPeakStart: 9,
      secondaryPeakEnd: 11
    });

    if (whiteflySeverity !== 'none') {
      const affectedDepts = this.getDepartmentsForPest('whitefly', month);
      alerts.push({
        id: `whitefly-${year}-${month.toString().padStart(2, '0')}`,
        pest: isSpanish ? 'Mosca Blanca' : 'Whitefly',
        scientificName: 'Bemisia tabaci',
        severity: whiteflySeverity,
        affectedCrops: isSpanish ? ['Frijoles', 'Tomates', 'Chiles', 'Pepinos', 'Ayote'] : ['Beans', 'Tomatoes', 'Peppers', 'Cucumbers', 'Squash'],
        departments: affectedDepts,
        description: this.getWhiteflyDescription(month, whiteflySeverity, isSpanish),
        recommendations: this.getWhiteflyRecommendations(whiteflySeverity, isSpanish),
        firstDetected: this.getFirstDetectedDate(month, year),
        source: isSpanish ? 'CENTA - Centro Nacional de Tecnología Agropecuaria y Forestal' : 'CENTA - National Center for Agricultural and Forestry Technology',
        link: 'https://www.centa.gob.sv/',
        seasonalPattern: isSpanish ? 'Actividad máxima: Marzo-Mayo y Septiembre-Noviembre (períodos de transición)' : 'Peak activity: March-May and September-November (transitional periods)',
        trend: this.getTrend(month, 3, 5)
      });
    }

    // LATE BLIGHT (Phytophthora infestans)
    // Peak: October-February (crosses year boundary)
    const lateBlightSeverity = this.getSeasonalSeverity(month, {
      peakStart: 10,
      peakEnd: 2
    });

    if (lateBlightSeverity !== 'none') {
      const affectedDepts = this.getDepartmentsForPest('late_blight', month);
      alerts.push({
        id: `late-blight-${year}-${month.toString().padStart(2, '0')}`,
        pest: isSpanish ? 'Tizón Tardío' : 'Late Blight',
        scientificName: 'Phytophthora infestans',
        severity: lateBlightSeverity,
        affectedCrops: isSpanish ? ['Tomates', 'Papas'] : ['Tomatoes', 'Potatoes'],
        departments: affectedDepts,
        description: this.getLateBlightDescription(month, lateBlightSeverity, isSpanish),
        recommendations: this.getLateBlightRecommendations(lateBlightSeverity, isSpanish),
        firstDetected: this.getFirstDetectedDate(month, year),
        source: isSpanish ? 'CENTA - Centro Nacional de Tecnología Agropecuaria y Forestal' : 'CENTA - National Center for Agricultural and Forestry Technology',
        link: 'https://www.centa.gob.sv/boletines-para-hortalizas/',
        seasonalPattern: isSpanish ? 'Actividad máxima: Octubre-Febrero (meses frescos y húmedos)' : 'Peak activity: October-February (cooler, humid months)',
        trend: this.getTrend(month, 10, 12)
      });
    }

    // COFFEE BORER BEETLE (Hypothenemus hampei)
    // Peak: November-February
    if (month >= 11 || month <= 2) {
      const borerSeverity = (month === 12 || month === 1) ? 'high' : 'moderate';
      alerts.push({
        id: `coffee-borer-${year}-${month.toString().padStart(2, '0')}`,
        pest: isSpanish ? 'Broca del Café' : 'Coffee Berry Borer',
        scientificName: 'Hypothenemus hampei',
        severity: borerSeverity,
        affectedCrops: isSpanish ? ['Café'] : ['Coffee'],
        departments: ['Santa Ana', 'Ahuachapán', 'Sonsonate', 'La Libertad'],
        description: (month === 1 || month === 2)
          ? (isSpanish
              ? 'Actividad máxima de la broca durante la cosecha principal. Adultos perforando los granos de café.'
              : 'Peak borer activity during main harvest season. Adults boring into coffee berries.')
          : (isSpanish
              ? 'Monitoreo postcosecha crítico. Procesamiento y almacenamiento adecuados esenciales.'
              : 'Post-harvest monitoring critical. Proper processing and storage essential.'),
        recommendations: isSpanish
          ? 'Cosechar todos los granos, despalmar si es necesario. Usar trampas, sanitizar equipos, garantizar procesamiento adecuado. Eliminar y destruir granos infestados.'
          : 'Harvest all berries, strip-pick if necessary. Use traps, sanitize equipment, ensure proper processing. Remove and destroy infested berries.',
        firstDetected: new Date(month <= 2 ? year - 1 : year, 11, 1).toISOString().split('T')[0],
        source: 'PROCAFE',
        link: 'https://www.procafe.org.sv/',
        seasonalPattern: isSpanish ? 'Máximo durante cosecha de café: Noviembre-Febrero' : 'Peak during coffee harvest: November-February',
        trend: month <= 2 ? 'decreasing' : 'increasing'
      });
    }

    return alerts;
  }

  getSeasonalSeverity(month, { peakStart, peakEnd, secondaryPeakStart, secondaryPeakEnd }) {
    // Check primary peak
    let inPrimaryPeak = false;
    if (peakStart <= peakEnd) {
      inPrimaryPeak = month >= peakStart && month <= peakEnd;
    } else {
      // Crosses year boundary (e.g., October to February)
      inPrimaryPeak = month >= peakStart || month <= peakEnd;
    }

    // Check secondary peak
    let inSecondaryPeak = false;
    if (secondaryPeakStart !== undefined && secondaryPeakEnd !== undefined) {
      if (secondaryPeakStart <= secondaryPeakEnd) {
        inSecondaryPeak = month >= secondaryPeakStart && month <= secondaryPeakEnd;
      } else {
        inSecondaryPeak = month >= secondaryPeakStart || month <= secondaryPeakEnd;
      }
    }

    if (inPrimaryPeak || inSecondaryPeak) {
      return 'high';
    }

    // Check shoulder months (1 month before/after peak)
    let inShoulder = false;
    if (peakStart <= peakEnd) {
      inShoulder = month === peakStart - 1 || month === peakEnd + 1;
    } else {
      inShoulder = month === peakStart - 1 || month === peakEnd + 1 || month === 12 || month === 1;
    }

    if (secondaryPeakStart !== undefined && secondaryPeakEnd !== undefined) {
      if (secondaryPeakStart <= secondaryPeakEnd) {
        inShoulder = inShoulder || month === secondaryPeakStart - 1 || month === secondaryPeakEnd + 1;
      } else {
        inShoulder = inShoulder || month === secondaryPeakStart - 1 || month === secondaryPeakEnd + 1;
      }
    }

    if (inShoulder) {
      return 'moderate';
    }

    // Check off-season
    let inOffSeason = false;
    if (peakStart <= peakEnd) {
      inOffSeason = month === peakStart - 2 || month === peakEnd + 2;
    } else {
      inOffSeason = month === peakStart - 2 || month === peakEnd + 2;
    }

    if (inOffSeason) {
      return 'low';
    }

    return 'none';
  }

  getDepartmentsForPest(pestType, month) {
    const allDepts = [
      'Ahuachapán', 'Santa Ana', 'Sonsonate', 'Chalatenango',
      'La Libertad', 'San Salvador', 'Cuscatlán', 'La Paz',
      'Cabañas', 'San Vicente', 'Usulután', 'San Miguel',
      'Morazán', 'La Unión'
    ];

    switch (pestType) {
      case 'fall_armyworm':
        return (month >= 5 && month <= 10)
          ? ['San Miguel', 'Usulután', 'La Unión', 'Morazán', 'San Vicente']
          : ['Usulután', 'San Miguel'];

      case 'coffee_rust':
        return ['Santa Ana', 'Ahuachapán', 'Sonsonate', 'La Libertad', 'Chalatenango', 'Cabañas'];

      case 'whitefly':
        return ['San Salvador', 'La Libertad', 'La Paz', 'San Vicente', 'Usulután'];

      case 'late_blight':
        return ['Chalatenango', 'Cabañas', 'San Vicente', 'Cuscatlán'];

      default:
        return allDepts.slice(0, 4);
    }
  }

  getTrend(currentMonth, peakStart, peakEnd) {
    if (peakStart <= peakEnd) {
      if (currentMonth < peakStart) return 'increasing';
      if (currentMonth > peakEnd) return 'decreasing';
      return 'stable';
    } else {
      // Crosses year boundary
      if (currentMonth > peakEnd && currentMonth < peakStart) return 'decreasing';
      return 'stable';
    }
  }

  getFirstDetectedDate(month, year) {
    const weeksAgo = (month % 3) + 1;
    const date = new Date(year, month - 1, 1);
    date.setDate(date.getDate() - (weeksAgo * 7));
    return date.toISOString().split('T')[0];
  }

  getSeasonName(month) {
    const isSpanish = this.getCurrentLanguage() === 'es';
    if (month >= 11 || month <= 4) {
      return isSpanish ? 'Estación Seca (Nov-Abril)' : 'Dry Season (Nov-April)';
    }
    if (month >= 5 && month <= 10) {
      return isSpanish ? 'Estación Lluviosa (May-Octubre)' : 'Rainy Season (May-October)';
    }
    return isSpanish ? 'Transición' : 'Transition';
  }

  getCurrentLanguage() {
    // Get language from Vue i18n or localStorage
    if (typeof window !== 'undefined') {
      const lang = localStorage.getItem('preferredLanguage') || 'en';
      return lang;
    }
    return 'en';
  }

  // FALL ARMYWORM
  getFallArmywormDescription(month, severity, isSpanish) {
    const severityDesc = severity === 'high'
      ? (isSpanish ? 'severa' : 'severe')
      : severity === 'moderate'
          ? (isSpanish ? 'moderada' : 'moderate')
          : (isSpanish ? 'baja' : 'low');

    if (isSpanish) {
      return `La actividad del Cogollero es ${severityDesc} en los departamentos del oriente y costeros. ` +
        `Las larvas se alimentan en las cogollas del maíz causando daño de "perforación". ${month >= 5 && month <= 10
          ? 'Las lluvias fuertes promueven la reproducción rápida y propagación. Monitorear de cerca.'
          : 'Las condiciones secas limitan la propagación pero las poblaciones persisten en áreas irrigadas.'}`;
    } else {
      return `Fall Armyworm activity is ${severityDesc} in eastern and coastal departments. ` +
        `Larvae feeding in maize whorls causing "shot-hole" damage. ${month >= 5 && month <= 10
          ? 'Heavy rains promoting rapid reproduction and spread. Monitor closely.'
          : 'Dry conditions limiting spread but populations persist in irrigated areas.'}`;
    }
  }

  getFallArmywormRecommendations(severity, isSpanish) {
    if (severity === 'high') {
      return isSpanish
        ? 'URGENTE: Aplicar insecticida a la cogolla si >20% de plantas infestadas. Usar trampas de feromonas para monitoreo. Considerar control biológico: avispas Trichogramma, Bacillus thuringiensis. Destruir residuos de cultivos, rotar cultivos, mantener sanidad del campo.'
        : 'URGENT: Apply insecticide to whorl if >20% plants infested. Use pheromone traps for monitoring. Consider biological control: Trichogramma wasps, Bacillus thuringiensis. Destroy crop residue, rotate crops, maintain field sanitation.';
    } else if (severity === 'moderate') {
      return isSpanish
        ? 'Monitorear campos semanalmente buscando daño en cogollas y frass. Aplicar trampas de feromonas. Si >10% de infestación, considerar aplicación dirigida de insecticida. Fomentar enemigos naturales (aves, avispas parasitoides).'
        : 'Monitor fields weekly for whorl damage and frass. Apply pheromone traps. If >10% infestation, consider targeted insecticide application. Encourage natural enemies (birds, parasitoid wasps).';
    } else {
      return isSpanish
        ? 'Monitoreo rutinario. Revisar cogollas buscando daño alimenticio y frass. Mantener higiene del campo. Prepararse para temporada máxima (Mayo-Octubre).'
        : 'Routine monitoring. Check whorls for feeding damage and frass. Maintain field hygiene. Prepare for peak season (May-October).';
    }
  }

  // COFFEE RUST
  getCoffeeRustDescription(month, severity, isSpanish) {
    if (isSpanish) {
      return `La Roya del Café muestra incidencia ${severity} en altitudes >1000m. ` +
        `Manchas polvorientas amarillo-naranja en el envés de las hojas. ${month >= 6 && month <= 9
          ? 'Condiciones húmedas favoreciendo la dispersión rápida de esporas. Período crítico para prevención.'
          : 'Menor humedad reduciendo la propagación pero manteniendo vigilancia en plantaciones sombreadas.'}`;
    } else {
      return `Coffee Leaf Rust showing ${severity} incidence in altitudes >1000m. ` +
        `Orange-yellow powdery spots on lower leaf surfaces. ${month >= 6 && month <= 9
          ? 'Humid conditions favoring rapid spore dispersal. Critical period for prevention.'
          : 'Lower humidity reducing spread but maintaining vigilance in shaded plantations.'}`;
    }
  }

  getCoffeeRustRecommendations(severity, isSpanish) {
    if (severity === 'high') {
      return isSpanish
        ? 'CRÍTICO: Aplicar fungicida sistémico inmediatamente. Remover y destruir hojas infectadas. Mejorar circulación de aire mediante poda. Usar variedades resistentes (Caturra, Bourbon). Monitorear semanalmente - la roya se propaga rápido en humedad.'
        : 'CRITICAL: Apply systemic fungicide immediately. Remove and destroy infected leaves. Improve air circulation through pruning. Use resistant varieties (Caturra, Bourbon). Monitor weekly - rust spreads rapidly in humidity.';
    } else if (severity === 'moderate') {
      return isSpanish
        ? 'Aplicar fungicida preventivo (base de cobre). Remover hojas muy infectadas. Garantizar espaciamiento adecuado y manejo de sombra. Monitorear huerta quincenalmente.'
        : 'Apply preventive fungicide (copper-based). Remove heavily infected leaves. Ensure proper spacing and shade management. Monitor orchard biweekly.';
    } else {
      return isSpanish
        ? 'Monitoreo rutinario. Revisar envés de hojas buscando pústulas anaranjadas. Mantener salud de las plantas mediante nutrición y poda adecuadas.'
        : 'Routine monitoring. Check lower leaf surfaces for orange pustules. Maintain plant health through proper nutrition and pruning.';
    }
  }

  // WHITEFLY
  getWhiteflyDescription(month, severity, isSpanish) {
    if (isSpanish) {
      return `Poblaciones de Mosca Blanca en niveles ${severity} en valles productores de vegetales. ` +
        `Ninfas y adultos en el envés de las hojas. ${month >= 3 && month <= 5
          ? 'Temperaturas primaverales favoreciendo reproducción rápida. Riesgo de transmisión de virus elevado.'
          : 'Monitoreo crítico. Puede transmitir virus Gemini y otras enfermedades.'}`;
    } else {
      return `Whitefly populations at ${severity} levels in vegetable-producing valleys. ` +
        `Nymphs and adults on leaf undersides. ${month >= 3 && month <= 5
          ? 'Spring temperatures favoring rapid reproduction. Virus transmission risk elevated.'
          : 'Monitoring critical. Can transmit Gemini virus and other diseases.'}`;
    }
  }

  getWhiteflyRecommendations(severity, isSpanish) {
    if (severity === 'high') {
      return isSpanish
        ? 'Aplicar jabón insecticida o aceite de neem al envés de las hojas. Instalar trampas pegajosas amarillas (20/hectárea). Evitar insecticidas de amplio espectro para preservar enemigos naturales (Encarsia formosa). Remover plantas muy infestadas. Rotar modos de acción de insecticidas.'
        : 'Apply insecticidal soap or neem oil to undersides of leaves. Install yellow sticky traps (20/acre). Avoid broad-spectrum insecticides to preserve natural enemies (Encarsia formosa). Remove heavily infested plants. Rotate insecticide modes of action.';
    } else if (severity === 'moderate') {
      return isSpanish
        ? 'Monitorear el envés de las hojas semanalmente. Usar trampas pegajosas amarillas para detección temprana. Fomentar depredadores naturales. Aplicar aceites hortícolas si es necesario.'
        : 'Monitor leaf undersides weekly. Use yellow sticky traps for early detection. Encourage natural predators. Apply horticultural oils if needed.';
    } else {
      return isSpanish
        ? 'Monitoreo rutinario con trampas pegajosas amarillas. Revisar envés de las hojas. Mantener plantas saludables - el estrés aumenta la susceptibilidad.'
        : 'Routine monitoring with yellow sticky traps. Check undersides of leaves. Maintain healthy plants - stress increases susceptibility.';
    }
  }

  // LATE BLIGHT
  getLateBlightDescription(month, severity, isSpanish) {
    if (isSpanish) {
      return `Condiciones de Tizón Tardío ${severity} en zonas de altura. ` +
        `Lesiones empapadas de agua, crecimiento de moho blanco en hojas. ${month >= 10 || month <= 2
          ? 'Clima fresco y húmedo ideal para desarrollo de la enfermedad. Riesgo de propagación rápida.'
          : 'Temperaturas más cálidas limitando propagación pero monitorear en zonas sombreadas y de gran altitud.'}`;
    } else {
      return `Late Blight conditions ${severity} in highland areas. ` +
        `Water-soaked lesions, white mold growth on leaves. ${month >= 10 || month <= 2
          ? 'Cool, humid weather ideal for disease development. Risk of rapid spread.'
          : 'Warmer temperatures limiting spread but monitor in shaded, high-altitude areas.'}`;
    }
  }

  getLateBlightRecommendations(severity, isSpanish) {
    if (severity === 'high') {
      return isSpanish
        ? 'URGENTE: Aplicar fungicida base de cobre o sistémico inmediatamente. Remover y destruir material vegetal infectado. Garantizar buen drenaje y circulación de aire. Evitar riego por aspersión. Rotar cultivos - evitar solanáceas en la misma ubicación por 3 años.'
        : 'URGENT: Apply copper-based or systemic fungicide immediately. Remove and destroy infected plant material. Ensure good drainage and air circulation. Avoid overhead irrigation. Rotate crops - avoid nightshades in same location for 3 years.';
    } else if (severity === 'moderate') {
      return isSpanish
        ? 'Aplicar fungicida preventivo (cobre o clotalonil). Garantizar buen drenaje. Espaciar plantas para flujo de aire. Remover hojas infectadas rápidamente. Regar en base, no en hojas.'
        : 'Apply preventive fungicide (copper or chlorothalonil). Ensure good drainage. Space plants for airflow. Remove infected leaves promptly. Water at base, not leaves.';
    } else {
      return isSpanish
        ? 'Monitorear lesiones empapadas de agua, especialmente después de lluvia. Garantizar buen drenaje. Usar variedades resistentes cuando estén disponibles. Evitar riego por aspersión.'
        : 'Monitor for water-soaked lesions, especially after rain. Ensure good drainage. Use resistant varieties when available. Avoid overhead irrigation.';
    }
  }

  calculateSummary(alerts) {
    const high = alerts.filter(a => a.severity === 'high').length;
    const moderate = alerts.filter(a => a.severity === 'moderate').length;
    const low = alerts.filter(a => a.severity === 'low').length;

    return {
      total: alerts.length,
      high: high,
      moderate: moderate,
      low: low
    };
  }

  getDepartmentCoordinates(department) {
    return this.departmentCoordinates[department] || null;
  }
}

export default new UsdaRssService();
