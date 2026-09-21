/**
 * Bengali spellings of the district (and pilot sub-district) names that appear
 * in answers. Copied from weather-mcp-service/mcp_weather/tools/weather_forecast.py
 * (BENGALI_TO_ENGLISH), which the backend cannot import; a test pins the two in
 * step. Kept in services/, NOT data/ (see bd-districts.js for why).
 *
 * Used by protect-tokens.js: a place name is shielded from the translator and
 * then restored to THIS spelling for a Bengali target. Left to the model, a
 * bare name after a dash came back as "সকাল" (morning), "সাফার" or a French
 * word - there is no context to transliterate from, so it guesses. Names not
 * listed here are restored in Latin rather than guessed.
 */
const PLACE_NAMES_BN = new Map([
  ['Bagerhat', 'বাগেরহাট'],
  ['Bandarban', 'বান্দরবান'],
  ['Barguna', 'বরগুনা'],
  ['Barisal', 'বরিশাল'],
  ['Bhola', 'ভোলা'],
  ['Bogura', 'বগুড়া'],
  ['Brahmanbaria', 'ব্রাহ্মণবাড়িয়া'],
  ['Chandpur', 'চাঁদপুর'],
  ['Chapainawabganj', 'চাঁপাইনবাবগঞ্জ'],
  ['Chittagong', 'চট্টগ্রাম'],
  ['Chuadanga', 'চুয়াডাঙ্গা'],
  ['Comilla', 'কুমিল্লা'],
  ["Cox's Bazar", 'কক্সবাজার'],
  ['Dhaka', 'ঢাকা'],
  ['Dinajpur', 'দিনাজপুর'],
  ['Faridpur', 'ফরিদপুর'],
  ['Feni', 'ফেনী'],
  ['Gaibandha', 'গাইবান্ধা'],
  ['Gazipur', 'গাজীপুর'],
  ['Gopalganj', 'গোপালগঞ্জ'],
  ['Habiganj', 'হবিগঞ্জ'],
  ['Jamalpur', 'জামালপুর'],
  ['Jashore', 'যশোর'],
  ['Jhalokathi', 'ঝালকাঠি'],
  ['Jhalokati', 'ঝালকাঠি'],
  ['Jhenaidah', 'ঝিনাইদহ'],
  ['Joypurhat', 'জয়পুরহাট'],
  ['Khagrachhari', 'খাগড়াছড়ি'],
  ['Khulna', 'খুলনা'],
  ['Kishoreganj', 'কিশোরগঞ্জ'],
  ['Kurigram', 'কুড়িগ্রাম'],
  ['Kushtia', 'কুষ্টিয়া'],
  ['Lakshmipur', 'লক্ষ্মীপুর'],
  ['Lalmonirhat', 'লালমনিরহাট'],
  ['Madaripur', 'মাদারীপুর'],
  ['Magura', 'মাগুরা'],
  ['Manikganj', 'মানিকগঞ্জ'],
  ['Meherpur', 'মেহেরপুর'],
  ['Moulvibazar', 'মৌলভীবাজার'],
  ['Munshiganj', 'মুন্সীগঞ্জ'],
  ['Mymensingh', 'ময়মনসিংহ'],
  ['Naogaon', 'নওগাঁ'],
  ['Narail', 'নড়াইল'],
  ['Narayanganj', 'নারায়ণগঞ্জ'],
  ['Narsingdi', 'নরসিংদী'],
  ['Natore', 'নাটোর'],
  ['Netrokona', 'নেত্রকোণা'],
  ['Nilphamari', 'নীলফামারী'],
  ['Noakhali', 'নোয়াখালী'],
  ['Pabna', 'পাবনা'],
  ['Panchagarh', 'পঞ্চগড়'],
  ['Patuakhali', 'পটুয়াখালী'],
  ['Pirojpur', 'পিরোজপুর'],
  ['Rajbari', 'রাজবাড়ী'],
  ['Rajshahi', 'রাজশাহী'],
  ['Rangamati', 'রাঙ্গামাটি'],
  ['Rangpur', 'রংপুর'],
  ['Sapahar', 'সাপাহার'],
  ['Satkhira', 'সাতক্ষীরা'],
  ['Shariatpur', 'শরীয়তপুর'],
  ['Sherpur', 'শেরপুর'],
  ['Sirajganj', 'সিরাজগঞ্জ'],
  ['Sunamganj', 'সুনামগঞ্জ'],
  ['Sylhet', 'সিলেট'],
  ['Tangail', 'টাঙ্গাইল'],
  ['Thakurgaon', 'ঠাকুরগাঁও']
]);

/**
 * Crop names, shielded the same way. In isolation each translates correctly,
 * but inside a long multi-crop answer the model drifted: "Mango" became আমড়া
 * (hog plum, a different fruit) and "Rice Aman" became চাল আমান (চাল = the
 * grain, not the crop). Spellings match weather-mcp's Bengali crop keyword
 * table (_CROP_QUERY_PATTERNS), which is what farmers type.
 */
const CROP_NAMES_BN = new Map([
  ['Rice Aman', 'আমন ধান'],
  ['Eggplant', 'বেগুন'],
  ['Mango', 'আম']
]);

/** Everything restored to a fixed Bengali spelling: districts + crops. */
const NAMES_BN = new Map([...PLACE_NAMES_BN, ...CROP_NAMES_BN]);

module.exports = { PLACE_NAMES_BN, CROP_NAMES_BN, NAMES_BN };
