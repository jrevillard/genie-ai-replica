import argparse
import ee

from drought_report.generate_report import (
    generate_pdf_report,
    get_daily_trend_message,
)
from fetch_dataset.fetch_data import fetch_recent_data
from utils.helper_functions import get_district_info


def main() -> None:
    parser = argparse.ArgumentParser(description="Drought point-query monitor")
    parser.add_argument("--lat", type=float, required=True, help="Latitude")
    parser.add_argument("--lon", type=float, required=True, help="Longitude")
    parser.add_argument(
        "--days", type=int, default=7, help="Look-back window in days (default: 7)"
    )
    parser.add_argument(
        "--project",
        type=str,
        default="ieee-challenge",
        help="Google Earth Engine project ID",
    )
    args = parser.parse_args()

    print(f"\n{'═' * 78}")
    print(
        f"  lat={args.lat}  lon={args.lon}  window={args.days}d  project={args.project}"
    )
    print(f"{'═' * 78}")

    print("  Authenticating with Google Earth Engine …")
    ee.Initialize(project=args.project)
    print("  ✓ GEE ready")

    print("  Reverse-geocoding coordinate …")
    geo_info = get_district_info(args.lat, args.lon)
    print(f"  ✓ {geo_info['district']}, {geo_info['division']}")
    print(f"    bbox: {[round(x, 3) for x in geo_info['bbox']]}")
    print(f"    area: {geo_info['area_km2']:.1f} km²")

    print("  Fetching satellite data …")
    averages, daily_df, start, end = fetch_recent_data(
        geo_info["bbox"], days=args.days, return_daily=True
    )
    print("  ✓ Data fetched")

    trend_message = get_daily_trend_message(daily_df)
    print(f"  {trend_message}")

    generate_pdf_report(
        geo_info,
        averages,
        start,
        end,
        lat=args.lat,
        lon=args.lon,
        output_path="output/drought_report.pdf",
        daily_df=daily_df,
    )
    print("Report saved to drought_report.pdf")


if __name__ == "__main__":
    main()
