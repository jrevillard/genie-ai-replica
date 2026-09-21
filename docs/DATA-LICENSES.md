# Third-Party Data — Licenses & Attribution

This project bundles or consumes data from the following third-party sources.
Each source retains its own license; attribution is preserved here.

## GeoNames cities500

- **Source:** https://download.geonames.org/export/dump/cities500.zip
- **Bundled at:** `/app/geo-data/cities500.txt` (downloaded at Docker build time, see `components/gov-chat-backend/Dockerfile`). Not `/app/data/` — see compose volume mounts.
- **Used by:** `WeatherService.getCityName()` (offline reverse geocoding, via `geokdbush` + `kdbush`)
- **License:** [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) (CC-BY 4.0)
- **Attribution:** "GeoNames data is provided by GeoNames under the CC-BY 4.0 license."
- **Update cadence:** GeoNames publishes a fresh export regularly; each backend image build pulls the latest copy. The Dockerfile enforces `wc -l > 200000` as a truncation guard (a healthy file has ~235k rows).
- **Runtime cost:** the in-memory KDBush index holds all ~200k points + name/country strings, costing roughly **50–100 MB of RSS per backend replica**. Operators sizing a Swarm cluster should account for this when picking replica counts and per-container memory limits.

The license requires attribution and notification of changes. Any redistribution
of this dataset (e.g. derived products, public docs) must preserve the credit.
