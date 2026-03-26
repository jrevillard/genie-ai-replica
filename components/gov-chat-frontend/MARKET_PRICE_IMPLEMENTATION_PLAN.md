# Market Price Dashboard Implementation Plan

## Overview
Implement 8 market price summary cards and detailed charts in Vue 3 web application, matching the Flutter mobile app functionality 100%.

## Architecture Analysis

### Existing Vue 3 Infrastructure
- **Summary Cards**: `CropHealthSummaryCard.vue`, `PestAlertSummaryCard.vue`
- **Detailed Charts**: `CropHealthChart.vue`, `PestAlertChart.vue`
- **Dialog System**: `ChartDialog.vue` (generic reusable dialog component)
- **Services**: `agriculturalService.js`, `usdaRssService.js` (with caching, error handling)
- **i18n**: `en.js`, `es.js` with `$t()` function
- **Integration**: `ChatBotComponent.vue` - insights section with `openChart()` method

### Flutter Mobile App Features (to replicate)
- 8 market categories: maize, cropProtection, vegetables, livestock, fertilizer, apiary, aquaculture, harvestStorage
- Line charts with ApexCharts
- Data tables
- Summary cards with latest value and trend
- AI Predictions with input dialog (time frame, world news, local news)
- AI response dialog with share functionality (WhatsApp, Email, Copy)
- World Bank Open Data API integration
- Complete i18n support (English/Spanish)
- Refresh button with cache clearing
- Dark mode support

## Implementation Steps

### Phase 1: Create World Bank Service
**File**: `src/services/worldBankService.js`

**Features**:
- Singleton service class with caching (24 hours)
- 8 data fetching methods (one per category):
  - `getMaizePrices()`
  - `getCropProtectionCosts()`
  - `getVegetablePrices()`
  - `getPoultryPorkFeedCosts()`
  - `getFertilizerPrices()`
  - `getHoneyMarketData()`
  - `getTilapiaMarketData()`
  - `getHarvestStorageData()`
- `getAllMarketData()` - fetches all categories in parallel
- `clearCache()` - manual cache refresh
- `getCacheInfo()` - debugging
- Fallback to regional (LCN) and global (1W) data
- Error handling with console logging

**World Bank API Endpoints**:
- Base URL: `https://api.worldbank.org/v2`
- Indicators:
  - Maize: `AG.PRD.CROP.XD` (Crop production index)
  - Crop Protection: `TM.VAL.AGRI.ZS.UN` (Agricultural exports)
  - Vegetables: `AG.PRD.FOOD.XD` (Food production index)
  - Livestock: `AG.PRD.LVSK.XD` (Livestock production index)
  - Fertilizer: `AG.CON.FERT.ZS` (Fertilizer consumption kg/hectare)
  - Apiary: `AG.PRD.LVSK.XD` (Livestock production index)
  - Aquaculture: `ER.FSH.AQUA.MT` (Aquaculture production metric tons)
  - Harvest Storage: `SP.RUR.TOTL.ZS` (Rural population %)

**Data Format**:
```javascript
{
  category: 'maize',
  title: 'Maize & Basic Grains',
  unit: 'Production Index (2014-2016=100)',
  color: '#2E7D32',
  dataSource: 'El Salvador',
  data: [
    { year: '2020', value: 95.2, decimal: 95.2 },
    { year: '2021', value: 98.5, decimal: 98.5 },
    // ...
  ],
  trend: 'up' | 'down' | 'stable',
  lastUpdated: '2026-03-26T10:30:00.000Z'
}
```

### Phase 2: Create i18n Translations

**Files**: `src/i18n/locales/en.js`, `src/i18n/locales/es.js`

**Add to `charts` section**:
```javascript
// Market Price Section
market: {
  sectionTitle: 'Market Prices',
  maizeGrains: 'Maize & Grains',
  cropProtection: 'Crop Protection',
  fruitsVeggies: 'Fruits & Veggies',
  livestock: 'Livestock',
  fertilizer: 'Fertilizer',
  apiary: 'Apiary & Honey',
  aquaculture: 'Aquaculture',
  harvestStorage: 'Harvest & Storage',

  // Trend labels
  trendUp: 'Rising',
  trendDown: 'Falling',
  trendStable: 'Stable',
  trendUnknown: 'Unknown',

  // Summary card labels
  latest: 'Latest',
  trend: 'Trend',
  priceHistory: 'Price History',
  dataTable: 'Data Table',
  lastUpdated: 'Last updated',
  noData: 'No data available',

  // AI Predictions
  getPredictions: 'Get AI Predictions',
  predictionFor: 'Prediction for',
  selectTimeFrame: 'Select Prediction Time Frame',
  timeFrame3Months: '3 months',
  timeFrame6Months: '6 months',
  timeFrame1Year: '1 year',
  timeFrame2Years: '2 years',
  worldNewsFactors: 'World News Factors (Optional)',
  worldNewsHint: 'E.g., Global supply chain issues, trade policies, etc.',
  localNewsFactors: 'El Salvador News Factors (Optional)',
  localNewsHint: 'E.g., Local regulations, weather events, policies, etc.',
  analyzing: 'Analyzing market data...',
  error: 'Error',
  predictionsFor: 'AI Predictions',
  noResponse: 'No response received',
  errorOccurred: 'An error occurred',
  responseCopied: 'Response copied to clipboard',
  copy: 'Copy',
  close: 'Close',
  share: 'Share',
  shareViaWhatsApp: 'WhatsApp',
  shareViaEmail: 'Email',
  sharedVia: 'Shared via AgroGenio AI',
  shareError: 'Error sharing'
}
```

### Phase 3: Create Market Price Summary Cards

**File**: `src/components/charts/MarketPriceSummaryCard.vue`

**Features**:
- Component props: `category` (string)
- Sparkline chart with SVG circle (custom painter equivalent)
- Category icon (using Font Awesome icons)
- Category color (from configuration)
- Latest value display (formatted by category)
- Trend indicator with icon (up/down/stable)
- Click to open detailed chart
- Loading state with spinner
- Dark mode support
- Responsive design (70px height, compact layout)

**Configuration** (static in component):
```javascript
const categoryConfig = {
  maize: {
    i18nKey: 'market.maizeGrains',
    icon: 'fa-grass',
    color: '#2E7D32'
  },
  cropProtection: {
    i18nKey: 'market.cropProtection',
    icon: 'fa-bug',
    color: '#D84315'
  },
  vegetables: {
    i18nKey: 'market.fruitsVeggies',
    icon: 'fa-leaf',
    color: '#558B2F'
  },
  livestock: {
    i18nKey: 'market.livestock',
    icon: 'fa-paw',
    color: '#8D6E63'
  },
  fertilizer: {
    i18nKey: 'market.fertilizer',
    icon: 'fa-flask',
    color: '#F9A825'
  },
  apiary: {
    i18nKey: 'market.apiary',
    icon: 'fa-hexagon-nodes', // or similar
    color: '#F57F17'
  },
  aquaculture: {
    i18nKey: 'market.aquaculture',
    icon: 'fa-fish',
    color: '#0288D1'
  },
  harvestStorage: {
    i18nKey: 'market.harvestStorage',
    icon: 'fa-warehouse',
    color: '#00838F'
  }
}
```

**Data Fetching**:
- On mount: call `worldBankService.get{Category}Data()`
- Cache handling: service manages caching
- Error handling: show error state gracefully

### Phase 4: Create Market Price Detailed Chart

**File**: `src/components/charts/MarketPriceChart.vue`

**Features**:
- Props: `category`, `data` (pre-fetched data)
- Two summary cards (latest value, trend) at top
- Source badge (with data source attribution)
- "Get AI Predictions" button (prominent, category-colored)
- ApexCharts line chart (250px height):
  - Smooth curves
  - Gradient fill under line
  - Markers with stroke
  - Custom tooltips (year + formatted value)
  - Y-axis with formatted labels
  - X-axis with 2-digit years
  - Grid lines (horizontal only)
- Data table (scrollable):
  - Year column
  - Value column (formatted, category-colored)
  - Sorted by year
- Last updated footer
- Refresh button (in dialog header)
- Responsive design
- Dark mode support

**Value Formatting** (by category):
- Aquaculture: Metric tons → K for thousands
- Fertilizer: kg per hectare → integer
- Harvest Storage: Percentage → 1 decimal
- Crop Protection: Percentage → 1 decimal
- Others: Index values → integer

### Phase 5: AI Predictions Implementation

**Input Dialog Component**: `src/components/charts/MarketPredictionInputDialog.vue`

**Features**:
- Modal dialog with form
- Commodity name in header
- Time frame selection (FilterChips):
  - 3 months
  - 6 months (default)
  - 1 year
  - 2 years
- World news text area (optional)
- Local news text area (optional)
- Cancel button
- Submit button (with loading state)
- Returns object: `{ timeFrame, worldNews, localNews }`

**Response Dialog Component**: `src/components/charts/MarketPredictionResponseDialog.vue`

**Features**:
- Modal dialog with AI response
- Header with commodity name and icon
- Scrollable response content
- Action buttons (wrapped):
  - Copy button (copies to clipboard with SnackBar feedback)
  - WhatsApp button (deep link with fallback)
  - Email button (mailto: link with fallback)
  - Close button (primary, category-colored)
- Loading overlay during AI call
- Error handling with retry option

**AI Service Integration**:
- Use existing `chatbotService.js`
- Method: `submitQuery(sessionId, messages, userId, categoryId, contextLabels, language)`
- Session ID: `market-predict-{category}-{timestamp}`
- Language: from i18n current locale
- Prompt generation (bilingual):
  - Current date
  - Commodity name
  - Time frame
  - Latest market data
  - Trend
  - Data source
  - Historical data (all years)
  - User context (world news, local news)
  - Request for: price forecast, risk factors, recommendations, opportunities

**Share Functionality**:
```javascript
// WhatsApp deep link
`whatsapp://send?text=${encodedText}`

// Email deep link
`mailto:?subject=${encodedSubject}&body=${encodedText}`

// Fallback to Share API (if available)
navigator.share({ title, text })
```

**Share Text Format**:
```
🤖 *AI Predictions: [Commodity Name]* 🤖
📅 [DD/MM/YYYY]

━━━━━━━━━━━━━━━

[AI Prediction Response]

━━━━━━━━━━━━━━━

Shared via AgroGenio AI
```

### Phase 6: Integration into ChatBotComponent

**File**: `src/components/ChatBotComponent.vue`

**Changes**:
1. Import components:
```javascript
import MarketPriceSummaryCard from "./charts/MarketPriceSummaryCard.vue";
import MarketPriceChart from "./charts/MarketPriceChart.vue";
```

2. Add to components section

3. Add to insights-section template:
```html
<div class="insights-cards">
  <CropHealthSummaryCard ... />
  <PestAlertSummaryCard ... />
  <!-- 8 Market Price Cards -->
  <MarketPriceSummaryCard category="maize" @open-chart="openChart" />
  <MarketPriceSummaryCard category="cropProtection" @open-chart="openChart" />
  <MarketPriceSummaryCard category="vegetables" @open-chart="openChart" />
  <MarketPriceSummaryCard category="livestock" @open-chart="openChart" />
  <MarketPriceSummaryCard category="fertilizer" @open-chart="openChart" />
  <MarketPriceSummaryCard category="apiary" @open-chart="openChart" />
  <MarketPriceSummaryCard category="aquaculture" @open-chart="openChart" />
  <MarketPriceSummaryCard category="harvestStorage" @open-chart="openChart" />
</div>
```

4. Update openChart method:
```javascript
openChart(type, category = null) {
  const titles = {
    'crop-health': this.t('charts.cropHealth'),
    'pest-alert': this.t('charts.pestAlertTitle'),
    'market-price': this.t('market.maizeGrains') // Will be dynamic
  };

  // For market prices, use category-specific title
  if (type === 'market-price' && category) {
    const categoryTitles = {
      maize: this.t('market.maizeGrains'),
      cropProtection: this.t('market.cropProtection'),
      // ... etc
    };
    this.chartDialog.title = categoryTitles[category] || 'Market Price';
  }

  this.chartDialog.type = type;
  this.chartDialog.category = category; // New property
  this.chartDialog.visible = true;
}
```

5. Add market price chart to ChartDialog:
```html
<ChartDialog v-if="chartDialog.visible" :title="chartDialog.title" @close="closeChartDialog">
  <!-- Existing charts -->

  <!-- Market Price Chart (8 categories) -->
  <MarketPriceChart
    v-if="chartDialog.type === 'market-price'"
    :category="chartDialog.category"
    :region="'El Salvador'"
    :userId="$store.getters.currentUser?._key || 'anonymous'"
    :sessionId="currentSessionId || 'market-price-session'"
  />
</ChartDialog>
```

6. Update data() to include `chartDialog.category`:
```javascript
chartDialog: {
  visible: false,
  type: null,
  title: '',
  category: null  // New property
}
```

7. Update closeChartDialog to reset category:
```javascript
closeChartDialog() {
  this.chartDialog.visible = false;
  this.chartDialog.type = null;
  this.chartDialog.title = "";
  this.chartDialog.category = null; // Reset category
}
```

### Phase 7: Styling and Polish

**CSS Architecture**:
- Use CSS custom properties for theming (matching existing patterns)
- Dark mode support via `data-theme="dark"` attribute
- Responsive breakpoints: 768px for mobile
- Smooth transitions and hover effects
- Consistent spacing and sizing with existing charts

**Key Styles**:
```css
/* Summary Cards */
- Height: 70px (desktop), 65px (mobile)
- Padding: 12px
- Border-radius: 8px
- Border: 2px solid category-color (with 0.5 alpha)
- Hover: transform translateY(-2px), box-shadow

/* Sparkline */
- Size: 36x36px
- SVG circle with gradient fill
- Line stroke width: 2px
- Dot marker: 3px radius

/* Chart Dialog */
- Max width: 95vw
- Height: 85vh
- Responsive: 100vw/100vh on mobile

/* Line Chart */
- Height: 250px
- Smooth curves (cubic bezier)
- Gradient fill (0.5 to 0.1 opacity)

/* Data Table */
- Max-height: 300px
- Overflow-y: auto
- Border-bottom separators
- Category-colored values

/* Buttons */
- Primary: category-colored with white text
- Secondary: outlined
- Icon buttons: compact with tooltips
```

### Phase 8: Testing and Validation

**Functionality Testing**:
- [ ] All 8 summary cards load and display data
- [ ] Click on card opens correct chart dialog
- [ ] Chart displays line chart correctly
- [ ] Data table shows all historical data
- [ ] Refresh button clears cache and reloads
- [ ] Dark mode toggles correctly
- [ ] Responsive design works on mobile

**AI Predictions Testing**:
- [ ] "Get Predictions" button opens input dialog
- [ ] Time frame selection works
- [ ] Text inputs accept user input
- [ ] Submit button shows loading state
- [ ] AI response displays in response dialog
- [ ] Copy button copies to clipboard
- [ ] WhatsApp button opens WhatsApp (or fallback)
- [ ] Email button opens email client (or fallback)
- [ ] Spanish prompts generate Spanish responses
- [ ] English prompts generate English responses

**i18n Testing**:
- [ ] All labels translate correctly
- [ ] Spanish translations are accurate
- [ ] No hardcoded English text
- [ ] RTL support (if needed)

**Error Handling Testing**:
- [ ] Network errors show user-friendly messages
- [ ] Cache fallback works
- [ ] API errors don't break UI
- [ ] Missing data shows "No data available"

**Performance Testing**:
- [ ] Initial page load < 3 seconds
- [ ] Chart opens < 1 second after card click
- [ ] AI prediction response < 10 seconds
- [ ] Cache reduces subsequent loads to < 500ms

## File Structure

```
src/
├── components/
│   ├── charts/
│   │   ├── MarketPriceSummaryCard.vue       (NEW)
│   │   ├── MarketPriceChart.vue             (NEW)
│   │   ├── MarketPredictionInputDialog.vue  (NEW)
│   │   ├── MarketPredictionResponseDialog.vue (NEW)
│   │   ├── ChartDialog.vue                   (EXISTING)
│   │   ├── CropHealthSummaryCard.vue         (EXISTING)
│   │   ├── CropHealthChart.vue               (EXISTING)
│   │   ├── PestAlertSummaryCard.vue          (EXISTING)
│   │   └── PestAlertChart.vue                (EXISTING)
│   └── ChatBotComponent.vue                  (MODIFY)
├── services/
│   ├── worldBankService.js                   (NEW)
│   ├── chatbotService.js                     (EXISTING)
│   └── agriculturalService.js                (EXISTING)
└── i18n/
    └── locales/
        ├── en.js                             (MODIFY)
        └── es.js                             (MODIFY)
```

## Dependencies

**Existing** (already in project):
- apexcharts (for line charts)
- vue-i18n (for translations)
- font-awesome (for icons)
- vue3 (component framework)

**None needed** - all functionality can be built with existing dependencies!

## Notes

1. **Code Consistency**: Follow exact patterns from existing Vue components (CropHealth, PestAlert)
2. **i18n First**: All user-facing text must use `$t()` function
3. **Dark Mode**: All components must support dark mode via CSS custom properties
4. **Responsive**: Mobile-first design with breakpoints matching existing components
5. **Error Handling**: Graceful degradation with user-friendly error messages
6. **Performance**: Leverage caching, lazy loading, and code splitting
7. **Accessibility**: ARIA labels, keyboard navigation, semantic HTML
8. **Testing**: Manual testing of all features before marking complete

## Success Criteria

✅ All 8 market price categories display summary cards
✅ Clicking cards opens detailed charts with historical data
✅ AI predictions work in both English and Spanish
✅ Share functionality works (WhatsApp, Email, Copy)
✅ Complete i18n support (no hardcoded text)
✅ Dark mode works throughout
✅ Responsive on mobile devices
✅ Matches mobile app UI/UX as closely as possible
✅ All features from mobile app are implemented (100% parity)

## Estimated Complexity

- **World Bank Service**: Low (straightforward API calls with caching)
- **Summary Cards**: Low (similar to existing PestAlertSummaryCard)
- **Detailed Chart**: Medium (similar to CropHealthChart with more features)
- **AI Predictions**: Medium (2 dialogs + chatbot integration + share)
- **i18n**: Low (translation keys already defined from mobile app)
- **Integration**: Low (following existing patterns)
- **Testing**: Medium (thorough testing of 8 categories × multiple features)

**Overall**: Medium complexity - mostly following existing patterns with no new dependencies
