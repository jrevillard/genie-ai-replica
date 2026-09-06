"""
BMD BAMIS WRF scraper.

Scrapes the Bangladesh Agricultural Meteorological Information Service (BAMIS)
WRF forecast table at https://www.bamis.gov.bd/en/bmd/wrf/table/all/{days}/
and returns structured JSON forecast data for a given district.
"""
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import List

# Bengali → English district name mapping (60+ entries)
BENGALI_TO_ENGLISH = {
    "ঢাকা": "Dhaka", "চট্টগ্রাম": "Chittagong", "খুলনা": "Khulna",
    "রাজশাহী": "Rajshahi", "বরিশাল": "Barisal", "সিলেট": "Sylhet",
    "রংপুর": "Rangpur", "ময়মনসিংহ": "Mymensingh", "কুমিল্লা": "Comilla",
    "নারায়ণগঞ্জ": "Narayanganj", "গাজীপুর": "Gazipur", "টাঙ্গাইল": "Tangail",
    "ফরিদপুর": "Faridpur", "মাদারীপুর": "Madaripur", "শরীয়তপুর": "Shariatpur",
    "রাজবাড়ী": "Rajbari", "গোপালগঞ্জ": "Gopalganj", "কিশোরগঞ্জ": "Kishoreganj",
    "নেত্রকোণা": "Netrokona", "মানিকগঞ্জ": "Manikganj", "মুন্সীগঞ্জ": "Munshiganj",
    "নরসিংদী": "Narsingdi", "পাবনা": "Pabna", "সিরাজগঞ্জ": "Sirajganj",
    "নাটোর": "Natore", "নওগাঁ": "Naogaon", "চাঁপাইনবাবগঞ্জ": "Chapainawabganj",
    "বগুড়া": "Bogura", "জয়পুরহাট": "Joypurhat", "কুষ্টিয়া": "Kushtia",
    "চুয়াডাঙ্গা": "Chuadanga", "মেহেরপুর": "Meherpur", "ঝিনাইদহ": "Jhenaidah",
    "মাগুরা": "Magura", "নড়াইল": "Narail", "সাতক্ষীরা": "Satkhira",
    "বাগেরহাট": "Bagerhat", "যশোর": "Jashore", "কক্সবাজার": "Cox's Bazar",
    "ফেনী": "Feni", "নোয়াখালী": "Noakhali", "লক্ষ্মীপুর": "Lakshmipur",
    "চাঁদপুর": "Chandpur", "ব্রাহ্মণবাড়িয়া": "Brahmanbaria", "হবিগঞ্জ": "Habiganj",
    "মৌলভীবাজার": "Moulvibazar", "সুনামগঞ্জ": "Sunamganj", "দিনাজপুর": "Dinajpur",
    "ঠাকুরগাঁও": "Thakurgaon", "পঞ্চগড়": "Panchagarh", "নীলফামারী": "Nilphamari",
    "লালমনিরহাট": "Lalmonirhat", "কুড়িগ্রাম": "Kurigram", "গাইবান্ধা": "Gaibandha",
    "জামালপুর": "Jamalpur", "শেরপুর": "Sherpur", "বান্দরবান": "Bandarban",
    "রাঙ্গামাটি": "Rangamati", "খাগড়াছড়ি": "Khagrachhari", "পিরোজপুর": "Pirojpur",
    "ঝালকাঠি": "Jhalokati", "বরগুনা": "Barguna", "পটুয়াখালী": "Patuakhali",
    "ভোলা": "Bhola",
}

# English normalisation → canonical name
_ENGLISH_NORMALISED = {v.lower().replace("'", "").replace("-", "").replace(" ", ""): v
                       for v in BENGALI_TO_ENGLISH.values()}

BAMIS_URL = "https://www.bamis.gov.bd/en/bmd/wrf/table/all/{days}/"


def _normalise(name: str) -> str:
    return name.lower().replace("'", "").replace("-", "").replace(" ", "")


def _find_district(target: str) -> str | None:
    """Return the canonical district name for a fuzzy-matched input."""
    key = _normalise(target)
    return _ENGLISH_NORMALISED.get(key)


def fetch_forecast_logic(district_name: str, forecast_days: int, parameters: List[str]) -> str:
    """
    Scrape BAMIS WRF table and return JSON forecast for the given district.

    Column indices in the BAMIS table:
        1 = MinT (°C), 3 = MaxT (°C), 5 = Humidity (%), 10 = Rain (mm)
    """
    db_district = _find_district(district_name)
    if not db_district:
        return json.dumps({"error": f"District '{district_name}' not found in BMD database."})

    try:
        url = BAMIS_URL.format(days=forecast_days)
        headers = {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        rows = soup.select("table tbody tr")
        target_row = None
        for row in rows:
            cells = row.find_all("td")
            if not cells:
                continue
            cell_text = cells[0].get_text(strip=True)
            # Try Bengali text first, then English
            english_name = BENGALI_TO_ENGLISH.get(cell_text, cell_text)
            if _normalise(english_name) == _normalise(db_district):
                target_row = cells
                break

        if not target_row:
            return json.dumps({"error": f"No forecast row found for district '{db_district}'."})

        def safe_float(cells, idx, default=0.0):
            try:
                return float(cells[idx].get_text(strip=True))
            except (IndexError, ValueError):
                return default

        t_min = safe_float(target_row, 1)
        t_max = safe_float(target_row, 3)
        hum = safe_float(target_row, 5)
        total_rain = safe_float(target_row, 10)
        daily_rain = total_rain / max(forecast_days, 1)

        forecast_days_list = [
            {
                "date": (datetime.now() + timedelta(days=i + 1)).strftime("%Y-%m-%d"),
                "parameters": {
                    "temperature": {"min": t_min, "max": t_max, "unit": "Celsius"},
                    "precipitation": {
                        "value": round(daily_rain, 2),
                        "unit": "mm",
                        "probability": min(daily_rain / 10.0, 1.0)
                    },
                    "humidity": {"value": hum, "unit": "percent"}
                }
            }
            for i in range(forecast_days)
        ]

        return json.dumps({
            "location": {"area_name": db_district.title()},
            "forecast": forecast_days_list
        })

    except Exception as exc:
        return json.dumps({"error": f"Failed to fetch BMD forecast: {str(exc)}"})
