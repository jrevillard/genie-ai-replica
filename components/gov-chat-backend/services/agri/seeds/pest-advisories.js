/**
 * Curated seasonal pest advisories (El Salvador).
 *
 * Reframed from the old app's synthetic "alerts": the seasonal biology is
 * real (peak windows per pest), but these are ADVISORIES, not live
 * outbreak detections — the dialog renders them as "Seasonal advisories"
 * alongside live OIRSA news and iNaturalist sightings (honest 3-section
 * design, BMAD-verified). Taxonomy enriched via EPPO (offline).
 */
const ADVISORIES = [
  {
    pest: { en: 'Fall Armyworm', es: 'Cogollero' },
    scientificName: 'Spodoptera frugiperda',
    eppoCode: 'SPODFR',
    affectedCrops: { en: ['Maize', 'Sorghum'], es: ['Maíz', 'Sorgo'] },
    peakWindow: { startMonth: 5, endMonth: 10 }, // rainy season
    departments: ['San Miguel', 'Usulután', 'La Unión', 'Morazán', 'San Vicente'],
    advisory: {
      en: 'Peak activity May–October (rainy season). Larvae feed in maize whorls causing shot-hole damage. Monitor weekly; pheromone traps for detection.',
      es: 'Actividad máxima mayo–octubre (época lluviosa). Las larvas se alimentan en el cogollo del maíz causando daño de perforación. Monitorear semanalmente; usar trampas de feromonas.'
    },
    source: 'MAG / CENTA (curated)'
  },
  {
    pest: { en: 'Coffee Leaf Rust', es: 'Roya del Café' },
    scientificName: 'Hemileia vastatrix',
    eppoCode: 'HEMIVA',
    affectedCrops: { en: ['Coffee'], es: ['Café'] },
    peakWindow: { startMonth: 6, endMonth: 9 }, // humid months
    departments: ['Santa Ana', 'Ahuachapán', 'Sonsonate', 'La Libertad', 'Chalatenango', 'Cabañas'],
    advisory: {
      en: 'Peak June–September at altitudes above 1000 m. Orange-yellow powdery spots on leaf undersides. Preventive copper-based fungicide; improve air circulation via pruning.',
      es: 'Máxima incidencia junio–septiembre en altitudes mayores a 1000 m. Manchas polvosas amarillo-naranja en el envés de las hojas. Fungicida preventivo a base de cobre; mejorar circulación de aire mediante poda.'
    },
    source: 'PROCAFE (curated)'
  },
  {
    pest: { en: 'Whitefly', es: 'Mosca Blanca' },
    scientificName: 'Bemisia tabaci',
    eppoCode: 'BEMITA',
    affectedCrops: {
      en: ['Beans', 'Tomatoes', 'Peppers', 'Cucumbers', 'Squash'],
      es: ['Frijoles', 'Tomates', 'Chiles', 'Pepinos', 'Ayote']
    },
    peakWindow: { startMonth: 3, endMonth: 5, secondary: { startMonth: 9, endMonth: 11 } },
    departments: ['San Salvador', 'La Libertad', 'La Paz', 'San Vicente', 'Usulután'],
    advisory: {
      en: 'Peaks March–May and September–November (transitional periods). Nymphs and adults on leaf undersides; virus transmission risk. Yellow sticky traps; insecticidal soap or neem oil.',
      es: 'Picos marzo–mayo y septiembre–noviembre (períodos de transición). Ninfas y adultos en el envés de las hojas; riesgo de transmisión de virus. Trampas pegajosas amarillas; jabón insecticida o aceite de neem.'
    },
    source: 'CENTA (curated)'
  },
  {
    pest: { en: 'Late Blight', es: 'Tizón Tardío' },
    scientificName: 'Phytophthora infestans',
    eppoCode: 'PHYTIN',
    affectedCrops: { en: ['Tomatoes', 'Potatoes'], es: ['Tomates', 'Papas'] },
    peakWindow: { startMonth: 10, endMonth: 2 }, // crosses year boundary
    departments: ['Chalatenango', 'Cabañas', 'San Vicente', 'Cuscatlán'],
    advisory: {
      en: 'Peak October–February (cool, humid months). Water-soaked lesions with white mold. Copper-based fungicide; remove infected material; avoid overhead irrigation.',
      es: 'Pico octubre–febrero (meses frescos y húmedos). Lesiones empapadas de agua con moho blanco. Fungicida a base de cobre; remover material infectado; evitar riego por aspersión.'
    },
    source: 'CENTA (curated)'
  },
  {
    pest: { en: 'Coffee Berry Borer', es: 'Broca del Café' },
    scientificName: 'Hypothenemus hampei',
    eppoCode: 'HYPHHA',
    affectedCrops: { en: ['Coffee'], es: ['Café'] },
    peakWindow: { startMonth: 11, endMonth: 2 }, // main harvest
    departments: ['Santa Ana', 'Ahuachapán', 'Sonsonate', 'La Libertad'],
    advisory: {
      en: 'Peak during harvest November–February. Adults bore into berries. Harvest all berries (strip-pick if needed), use traps, sanitize equipment, destroy infested berries.',
      es: 'Máximo durante la cosecha noviembre–febrero. Los adultos perforan los granos. Cosechar todos los granos (despalme si es necesario), usar trampas, sanitizar equipos, destruir granos infestados.'
    },
    source: 'PROCAFE (curated)'
  }
];

/** Advisories active in the current month (handles year-crossing windows). */
function activeAdvisories(now = new Date()) {
  const month = now.getMonth() + 1;
  return ADVISORIES.filter((a) => {
    const { startMonth: s, endMonth: e } = a.peakWindow;
    return s <= e ? month >= s && month <= e : month >= s || month <= e;
  });
}

module.exports = { ADVISORIES, activeAdvisories };
