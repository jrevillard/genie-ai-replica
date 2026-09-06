"""
Manual test/debug script for BMD BAMIS WRF scraping.
Run directly: python scripts/fetch_bmd_data.py [district_name] [days]
"""
import sys
import os
import json

# Allow running from repo root or scripts/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mcp_weather.tools.weather_forecast import fetch_forecast_logic

if __name__ == "__main__":
    district = sys.argv[1] if len(sys.argv) > 1 else "Dhaka"
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    print(f"Fetching {days}-day forecast for district: {district}")
    result = fetch_forecast_logic(district, days, [])
    print(json.dumps(json.loads(result), indent=2))
