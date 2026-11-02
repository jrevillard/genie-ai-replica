# Changelog

All notable changes to the GENIE.AI Agriculture Advisory Service are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — 2026-08-26

### Added

- **Weather card in Farmer Profile** — current temperature, condition, humidity, wind speed, and 5-day forecast strip using the farmer's mapped farm location coordinates
- **Weather Service health check** — `checkWeather()` probe in Admin Dashboard verifies WeatherService initialization and Open-Meteo API reachability
- **Farmer Profile Service health check** — `checkFarmerProfile()` probe verifies UserProfileService initialization and queries users collection for existing farmer profiles
- **AI Configuration panel** — new `GET /api/admin/ai-config` endpoint exposes LLM, Translation, Embedding, Reranker, RAG Pipeline, and Ingestion parameters (no secrets); rendered as a full-width card in Admin Dashboard overview tab
- **AI Engineer role access** for AI Configuration endpoint via `isAIEngineerOrAbove` middleware

### Changed

- **WeatherService resilience** — lazy initialization with retry logic; if startup fails, retries on next request with a 10-second rate limit between attempts
- **WeatherService init fallback** — falls back to `WEATHER_DEFAULT_LATITUDE` / `WEATHER_DEFAULT_LONGITUDE` env vars (Maseru) when ipapi.co geolocation fails
- **Weather route error handling** — returns 503 Service Unavailable (instead of generic 500) when WeatherService is temporarily down
- Added `initializing` guard to WeatherService to prevent concurrent init attempts

### Fixed

- WeatherService no longer crashes the application on startup when external geolocation API is unreachable
