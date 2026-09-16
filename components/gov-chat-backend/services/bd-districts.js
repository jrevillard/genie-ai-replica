/**
 * Bangladesh district centroids (kept in services/, NOT data/: /app/data is a persistent
 * volume that would shadow updates to this file). Copied from weather-mcp-service/data_ingestor.py
 * (the table the warning system assesses). Used to map a browser geolocation to
 * the district whose alerts the web banner should show.
 */
const { getDefaultLocation } = require('./default-location');

const DISTRICTS = [
  ['Dhaka', 23.8103, 90.4125],
  ['Gazipur', 23.9999, 90.4272],
  ['Narayanganj', 23.6238, 90.5],
  ['Tangail', 24.2513, 89.9167],
  ['Kishoreganj', 24.4449, 90.7766],
  ['Mymensingh', 24.7471, 90.4203],
  ['Netrokona', 24.8703, 90.7271],
  ['Jamalpur', 24.9375, 89.9375],
  ['Sherpur', 25.0204, 90.019],
  ['Manikganj', 23.8613, 89.9917],
  ['Munshiganj', 23.542, 90.5313],
  ['Narsingdi', 23.931, 90.7152],
  ['Faridpur', 23.607, 89.8429],
  ['Madaripur', 23.164, 90.2007],
  ['Gopalganj', 23.005, 89.8268],
  ['Rajbari', 23.7574, 89.6437],
  ['Shariatpur', 23.2427, 90.4352],
  ['Chittagong', 22.3569, 91.7832],
  ["Cox's Bazar", 21.4272, 92.0058],
  ['Comilla', 23.4607, 91.1809],
  ['Brahmanbaria', 23.9608, 91.1116],
  ['Chandpur', 23.2333, 90.6699],
  ['Feni', 23.0233, 91.3979],
  ['Lakshmipur', 22.9449, 90.8412],
  ['Noakhali', 22.8696, 91.0993],
  ['Khagrachhari', 23.1193, 91.9847],
  ['Rangamati', 22.7324, 92.2985],
  ['Bandarban', 22.1953, 92.2184],
  ['Rajshahi', 24.3636, 88.6241],
  ['Chapainawabganj', 24.5953, 88.276],
  ['Naogaon', 24.8033, 88.9347],
  ['Natore', 24.4203, 89.0],
  ['Pabna', 24.0064, 89.2372],
  ['Sirajganj', 24.4535, 89.7001],
  ['Bogura', 24.851, 89.3697],
  ['Joypurhat', 25.1031, 89.0225],
  ['Khulna', 22.8456, 89.5403],
  ['Bagerhat', 22.6602, 89.7895],
  ['Satkhira', 22.7185, 89.0705],
  ['Jashore', 23.1664, 89.2082],
  ['Narail', 23.1724, 89.5118],
  ['Magura', 23.4878, 89.4193],
  ['Jhenaidah', 23.5448, 89.1527],
  ['Kushtia', 23.9013, 89.119],
  ['Chuadanga', 23.6401, 88.8418],
  ['Meherpur', 23.7625, 88.6318],
  ['Barisal', 22.701, 90.3535],
  ['Bhola', 22.178, 90.7174],
  ['Patuakhali', 22.3596, 90.3296],
  ['Barguna', 22.0904, 90.112],
  ['Pirojpur', 22.5793, 89.974],
  ['Jhalokathi', 22.6402, 90.1878],
  ['Sylhet', 24.8949, 91.8687],
  ['Moulvibazar', 24.4829, 91.7774],
  ['Habiganj', 24.3745, 91.4152],
  ['Sunamganj', 25.0667, 91.399],
  ['Rangpur', 25.7439, 89.2752],
  ['Dinajpur', 25.6279, 88.6337],
  ['Thakurgaon', 26.0336, 88.4616],
  ['Panchagarh', 26.3411, 88.5548],
  ['Nilphamari', 25.9308, 88.8563],
  ['Lalmonirhat', 25.9217, 89.2849],
  ['Kurigram', 25.8057, 89.6367],
  ['Gaibandha', 25.3283, 89.5288]
];

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km (haversine). */
function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Nearest district to a coordinate. Returns null when the point is far outside
 * Bangladesh (> maxKm from every centroid) so callers can fall back to a default.
 */
/**
 * Districts the resolver may return: the static table plus the deployment
 * fallback (DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON) when it is not already
 * listed. The warning system always assesses the fallback district (see
 * warning_system_engine defaults.ensure_default_in_list), so a device located
 * there must register under the same name for its pushes to match — e.g. the
 * Sapahar pilot would otherwise resolve to "Naogaon" and miss Sapahar alerts.
 */
function resolvableDistricts() {
  const { name, latitude, longitude } = getDefaultLocation();
  if (!name || DISTRICTS.some(([district]) => district === name)) return DISTRICTS;
  return [...DISTRICTS, [name, latitude, longitude]];
}

function nearestDistrict(lat, lon, maxKm = 150) {
  let best = null;
  for (const [name, dLat, dLon] of resolvableDistricts()) {
    const km = distanceKm(lat, lon, dLat, dLon);
    if (!best || km < best.distanceKm) best = { district: name, distanceKm: km };
  }
  if (!best || best.distanceKm > maxKm) return null;
  return { district: best.district, distanceKm: Math.round(best.distanceKm * 10) / 10 };
}

module.exports = { DISTRICTS, resolvableDistricts, nearestDistrict, distanceKm };
