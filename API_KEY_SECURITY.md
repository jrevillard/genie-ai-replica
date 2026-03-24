# API Key Security Instructions

## Overview
This document provides explicit instructions for securing API keys in the Genie AI mobile application.

## ✅ Good News: HDX CSV Requires NO API Key!

The primary data source (HDX - Humanitarian Data Exchange) provides **100% FREE access** to NDVI data:
- **Direct CSV download** - No authentication required
- **NASA MODIS satellite data** via WFP (World Food Programme)
- **No account registration needed**
- **No rate limits** for CSV downloads
- **Updated every 2 weeks** automatically

## Golden Rule: NEVER Commit API Keys to Git

**⚠️ CRITICAL**: API keys must NEVER be:
- Committed to version control (Git)
- Stored in plain text files in the project
- Hardcoded in source code
- Shared in chat, email, or public forums
- Uploaded to public repositories

## Architecture

### Mobile App (Flutter)
- **Storage**: `flutter_secure_storage` (Android KeyStore / iOS Keychain)
- **Service**: `ApiKeyService` provides secure storage methods
- **Runtime**: Keys loaded into memory only when needed

### Web App (Vue 3) - To be implemented later
- **Storage**: Environment variables on server
- **API Keys**: NEVER exposed to client-side JavaScript
- **Proxy**: Backend proxy server handles all API calls

## Step-by-Step Setup

### 1. Data Sources (NO API KEYS NEEDED!)

#### Crop Health Data: HDX (Humanitarian Data Exchange) ✅ **100% FREE - PRIMARY**

1. **No Setup Required!**
   - Public Dataset: https://data.humdata.org/dataset/slv-ndvi-subnational
   - Direct CSV download - No API key needed
   - No registration required
   - Works immediately!

2. **Data Details:**
   - **Source**: NASA MODIS Collection 6.1 satellite data
   - **Provider**: WFP (World Food Programme)
   - **Coverage**: All 262 municipalities in El Salvador
   - **Updates**: Every 2 weeks
   - **Format**: CSV files (5-year or full historical)
   - **License**: Creative Commons Attribution International

3. **CSV Download URL:**
   ```
   https://data.humdata.org/dataset/slv-ndvi-subnational/resource/2151cc86-c933-440d-b6ad-4de7e9dfc115/download/slv-ndvi-adm2-5ytd.csv
   ```

4. **Features:**
   - Automatic update checking implemented
   - Offline caching (7-day persistence)
   - Municipality-level data aggregated to departments
   - Real NDVI trends and health indicators

#### Alternative: NASA POWER API ✅ **100% FREE - BACKUP**

1. **No Setup Required!**
   - Public API: https://power.larc.nasa.gov/data-access-viewer/
   - No API key needed
   - No registration required
   - Fair use policy applies
   - Works immediately!

2. **API Details:**
   - Endpoint: `https://power.larc.nasa.gov/api/temporal/daily/point`
   - Parameters: NDVI (Normalized Difference Vegetation Index)
   - Coverage: Global (including El Salvador)
   - Updates: Daily
   - **Date Format**: YYYYMMDD (e.g., 20260320)

#### Pest Alerts: USDA APHIS RSS ✅ **100% FREE**

1. **No Setup Required!**
   - Public RSS feeds
   - No API key needed
   - No registration required
   - Works immediately!

2. **Feed URL:**
   ```
   https://www.aphis.usda.gov/aphis/newsroom/rss
   ```

### 2. Secure Storage (If You Add More APIs Later)

#### Development & Production

**✅ NO CONFIGURATION NEEDED!**

The primary data service works immediately without setup:

1. **HDX (Crop Health)**
   - Direct CSV download
   - No API key required
   - 100% free
   - Automatic update checking
   - Works out of the box!

2. **USDA APHIS RSS** (Pest Alerts)
   - Public RSS feeds
   - No authentication
   - 100% free
   - Works out of the box!

If you add other APIs later that need keys, use the secure storage pattern in `ApiKeyService`.

### 3. Environment-Specific Configuration

**No Configuration Required** ✅

Both services work immediately in:
- Development environment
- Production environment
- No setup screens needed
- No API keys to manage
- HDX data updates every 2 weeks (automatic detection)

### 4. API Key Rotation (For Future APIs)

**Rotation Process:**
1. Generate new API key
2. Update secure storage
3. Test new key works
4. Revoke old key
5. Document rotation

### 5. Secure Key Distribution

#### For Team Development

**NEVER** share keys via:
- Slack/Teams
- Email
- Shared Google Docs

**USE INSTEAD:**
- Password manager (1Password, Bitwarden)
- Secure vault (AWS Secrets Manager, HashiCorp Vault)
- Encrypted files with shared passphrase

#### For Production Deployment

**Mobile Apps:**
- Do NOT embed keys in APK/IPA
- Use runtime configuration
- Consider backend proxy for high-security APIs

**CI/CD Pipelines:**
- Use encrypted secrets
- GitHub Actions: Use repository secrets
- Bitbucket: Use repository variables
- GitLab: Use protected variables

### 6. Audit and Monitoring

**Monthly Checklist:**
- [ ] Review who has access to keys
- [ ] Check API usage logs
- [ ] Verify no keys in code repositories
- [ ] Test key rotation process
- [ ] Update documentation

**Automated Scanning:**
```bash
# Scan for accidentally committed keys
git log --all --full-history --source -- "*" | tr 'A-Z' 'a-z' | grep -i "api[_-]key\|secret\|password"

# Use truffleHog (advanced tool)
npm install -g trufflehog
trufflehog --regex --entropy=False /path/to/repo
```

## Specific API Instructions

### HDX (Currently Used - Primary) ✅

**100% FREE - No API Key Required!**

**Dataset Details:**
- **Documentation**: https://data.humdata.org/dataset/slv-ndvi-subnational
- **Provider**: WFP (World Food Programme)
- **Source**: NASA MODIS Collection 6.1 satellite
- **Data**: NDVI measurements at municipality level
- **Coverage**: El Salvador (262 municipalities)
- **Cost**: FREE
- **Updates**: Every 2 weeks
- **Authentication**: None required for CSV download

**Best Practices:**
- Cache CSV results (7-day cache implemented)
- Implement update checking (already implemented)
- Parse CSV efficiently (csv package used)
- Aggregate municipality data to department level

### NASA POWER (Alternative) ✅

**100% FREE - No API Key Required!**

**API Details:**
- **Documentation**: https://power.larc.nasa.gov/data-access-viewer/
- **Endpoint**: https://power.larc.nasa.gov/api/temporal/daily/point
- **Parameters**: NDVI (Normalized Difference Vegetation Index)
- **Data**: Daily satellite measurements
- **Coverage**: Global
- **Cost**: FREE
- **Rate Limits**: Fair use policy (no strict limits)
- **Authentication**: None required
- **Date Format**: YYYYMMDD (e.g., 20260320)

**Best Practices:**
- Cache results for 1 hour
- Implement retry logic for network failures
- Use appropriate date ranges (30 days recommended)

### USDA RSS Feeds (Currently Used) ✅

**100% FREE - No API Key Required!**

**Feed Details:**
- **URL**: https://www.aphis.usda.gov/aphis/newsroom/rss
- **Format**: RSS/XML
- **Authentication**: None required
- **Cost**: FREE
- **Rate Limits**: Respect robots.txt (don't hammer the server)

**Best Practices:**
- Cache RSS feed results
- Only fetch every 1 hour max
- Parse XML carefully
- Handle missing or malformed data gracefully

## Troubleshooting

### HDX CSV Not Working

**Checklist:**
1. [ ] Network connectivity working
2. [ ] CSV URL accessible (try in browser)
3. [ ] CSV file downloads successfully
4. [ ] CSV parsing works correctly
5. [ ] SharedPreferences cache accessible

**Test URL:**
```
https://data.humdata.org/dataset/slv-ndvi-subnational/resource/2151cc86-c933-440d-b6ad-4de7e9dfc115/download/slv-ndvi-adm2-5ytd.csv
```

### NASA POWER API Not Working

**Checklist:**
1. [ ] Network connectivity working
2. [ ] API endpoint accessible (try in browser)
3. [ ] Date format is YYYYMMDD (not YYYY-MM-DD)
4. [ ] Coordinates are correct
5. [ ] Response format is JSON

**Test URL:**
```
https://power.larc.nasa.gov/api/temporal/daily/point?parameters=NDVI&community=AG&latitude=13.69&longitude=-89.21&start=20260220&end=20260320&format=JSON
```

### USDA RSS Feed Not Working

**Checklist:**
1. [ ] Network connectivity working
2. [ ] Feed URL accessible
3. [ ] XML parser working correctly
4. [ ] Response format is valid RSS

**Test URL:**
```
https://www.aphis.usda.gov/aphis/newsroom/rss
```

### Data Not Loading in App

**Checklist:**
1. [ ] Internet connection active
2. [ ] Check app logs for errors
3. [ ] Verify API endpoints are accessible
4. [ ] Review caching (1-hour cache may be stale)
5. [ ] Try clearing app cache

## Summary

✅ **DO:**
- Use HDX CSV for NDVI data (free, no key needed)
- Use USDA RSS feeds (free, no key needed)
- Cache results appropriately (7-day cache for HDX)
- Handle network failures gracefully
- Use secure storage for any future APIs
- Add .env to .gitignore (for future use)
- Check for HDX updates regularly (feature implemented)

❌ **DON'T:**
- Commit API keys to Git
- Hardcode credentials in source
- Share keys via chat/email
- Ignore rate limits
- Hammer the APIs with requests

## Getting Started Checklist

- [ ] Run `flutter pub get` to install dependencies
- [ ] Test HDX CSV download (works immediately!)
- [ ] Verify NDVI data displays correctly in app
- [ ] Test update checking feature
- [ ] Test offline caching
- [ ] Find working pest alert data source
- [ ] Apply same changes to Vue 3 app
- [ ] Document any additional APIs added later

## Support

- HDX: https://data.humdata.org/
- WFP: https://www.wfp.org/data
- NASA POWER: https://power.larc.nasa.gov/data-access-viewer/
- USDA APHIS: https://www.aphis.usda.gov/
- API Security: https://owasp.org/www-project-api-security/
