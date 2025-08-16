# GENIE.AI Framework Database Setup Scripts

This repository contains database setup and migration scripts for the **GENIE.AI User Interface Framework**. GENIE.AI is an adaptable framework designed to provide intelligent, context-aware query responses through integration with RAG (Retrieval-Augmented Generation) systems. These scripts facilitate the creation and management of the database schema and knowledge hierarchy for various use cases, such as government services, healthcare systems, educational platforms, and enterprise knowledge bases.

## 🎯 Framework Overview

The GENIE.AI framework uses a hierarchical knowledge categorization system to enhance AI query responses:

  - **Knowledge Areas** (represented as `serviceCategories`): These form the primary navigation tree in the UI's left panel.
  - **Services**: Specific topics or functions within each knowledge area.
  - **Multi-language Support**: Native language interfaces with backend translation handling via the Google Cloud Translate API.

### How It Works

1.  **UI Navigation**: Users navigate through knowledge areas in their native language via the left tree interface.
2.  **Context Building**: Selected categories and services are used to build query context.
3.  **RAG Integration**: Category labels are passed to the backend RAG framework to:
      - Fine-tune model responses.
      - Provide domain-specific context.
      - Improve response quality and relevance.
4.  **Translation Layer**: All translations (input/output) are handled by backend services using the Google Cloud Translate API.

### Adaptability

The framework can be adapted to various use cases by modifying the categorization structure:

  - **Government Services**: Public service categories and citizen services.
  - **Healthcare Systems**: Medical specialties and patient services.
  - **Educational Platforms**: Subject areas and learning resources.
  - **Enterprise Knowledge Bases**: Departments and business functions.

A future utility will allow framework users to create custom left-tree navigation with service categories in English (`nameEN`) and add translations for additional national languages.

## 📋 Database Collections

The framework uses the following collections to build the knowledge hierarchy:

| Collection | Purpose | Type |
|------------|---------|------|
| `serviceCategories` | Top-level knowledge areas forming the UI navigation tree. Includes `nameEN` for English names (required). | Document |
| `services` | Specific topics/functions within each knowledge area. Includes `nameEN` for English names (required). | Document |
| `categoryServices` | Edge collection linking knowledge areas to their services. | Edge |
| `serviceCategoryTranslations` | Multi-language translations for knowledge area names. | Document |
| `serviceTranslations` | Multi-language translations for service names. | Document |
| `serviceCategoryTranslationsEdge` | Edge collection linking `serviceCategories` to their translations. | Edge |
| `serviceTranslationsEdge` | Edge collection linking `services` to their translations. | Edge |

**Note**: The `nameEN` field in both `serviceCategories` and `services` collections is mandatory and must remain in place to ensure compatibility with the RAG system and the translation process.

## 🚀 Setup Process

These scripts enable you to:

  - **Create new GENIE.AI framework instances** with custom knowledge categorizations.
  - **Import existing categorizations** to new environments.
  - **Add multi-language support** for global deployments using the Google Cloud Translate API.
  - **Maintain referential integrity** through proper edge relationships.

### Schema Evolution for Multi-language RAG Support

**Legacy Schema (fixed language fields):**

Knowledge Area (`serviceCategories`):

```json
{
  "_key": "1",
  "nameEN": "Identity & Civil Registration",
  "nameFR": "Identité et état civil",
  "nameSW": "Utambulisho na Usajili wa Raia",
  "order": 1
}
```

Service (`services`):

```json
{
  "_key": "101",
  "categoryId": "1",
  "nameEN": "Birth Certificate",
  "nameFR": "Certificat de naissance",
  "nameSW": "Cheti cha kuzaliwa",
  "description": "Official birth registration document",
  "order": 1
}
```

**New Translation Schema (flexible for RAG context building):**

The new schema separates language concerns to support:

  - Dynamic language addition without schema changes.
  - Clean separation of concerns for RAG processing.
  - Efficient context building in the user's native language.

<!-- end list -->

```json
// serviceCategories (knowledge areas - preserved for compatibility)
{
  "_key": "1",
  "nameEN": "Identity & Civil Registration",
  "order": 1
}

// serviceCategoryTranslations (used for UI display and RAG context)
[
  {
    "_key": "1_EN",
    "serviceCategoryId": "1",
    "languageCode": "EN",
    "translation": "Identity & Civil Registration"
  },
  {
    "_key": "1_FR",
    "serviceCategoryId": "1",
    "languageCode": "FR",
    "translation": "Identité et état civil"
  }
]

// services
{
  "_key": "101",
  "categoryId": "1",
  "nameEN": "Birth Certificate",
  "order": 1
}

// serviceTranslations
[
  {
    "_key": "101_EN",
    "serviceId": "101",
    "languageCode": "EN",
    "translation": "Birth Certificate"
  },
  {
    "_key": "101_FR",
    "serviceId": "101",
    "languageCode": "FR",
    "translation": "Certificat de naissance"
  }
]
```

This structure enables:

  - **RAG Context**: Category and service labels in the user's language provide domain context.
  - **Query Enhancement**: Selected categories and services guide AI model responses.
  - **Backend Processing**: All translation complexity is handled server-side.
  - **UI Flexibility**: Easy addition of new languages without database schema changes.

## 🛠️ Scripts Overview

| Script | Purpose | Database Impact | Prerequisites |
|--------|---------|-----------------|---------------|
| `arango-schema-extractor.js` | Extract complete database schema. | **READ ONLY** | None |
| `arango-schema-creator.js` | Create new database from schema. | **CREATES DATABASE** | None |
| `export-service-categories.js` | Export `serviceCategories`, `services`, `categoryServices`, and translation collections. | **READ ONLY** | None |
| `import-service-categories.js` | Import `serviceCategories`, `services`, `categoryServices`, and translation collections from a full export file. | **WRITES DATA** | **Schema validation must be disabled** |
| `create-knowledge-hierarchy.js` | Interactively or from a simple JSON file, create the initial English `serviceCategories` and `services` hierarchy. | **WRITES DATA** | `npm install inquirer yargs` |
| `create-translations.js` | Create translations for `serviceCategories` and `services` using Google Cloud Translate API. | **WRITES DATA** | Google Cloud credentials, API enabled |

**Note**: The `category-migration.js` script is no longer needed, as translation support is now handled by `create-translations.js` for adding new languages and by `import-service-categories.js` for importing existing translations.

## 🎯 Primary Use Cases

### Use Case 1: Deploy New GENIE.AI Instance

Create a new framework instance with your organization's knowledge categorization for RAG-enhanced responses.

### Use Case 2: Add Multi-language Support

Add translations for service categories and services in additional national languages to support global users while maintaining RAG context quality.

### Use Case 3: Migrate Existing Deployment

Transfer an existing GENIE.AI instance, including knowledge hierarchy and translations, to a new environment.

## 🚀 Complete Workflows

### Prerequisites

1.  **Install Dependencies**

<!-- end list -->

```bash
npm install arangojs dotenv @google-cloud/translate inquirer yargs
```

2.  **Set Base Environment Variables** (in `.env` file)

<!-- end list -->

```bash
export ARANGO_URL="http://localhost:8529"
export ARANGO_USERNAME="root"
export ARANGO_PASSWORD="your-password"
export GOOGLE_CREDENTIALS_PATH="./google-credentials.json"
```

3.  **Set Up Google Cloud Credentials**

      - Create a Google Cloud service account with the 'Cloud Translation API User' role.
      - Download the JSON key file and add an `apiKey` field (generated from Google Cloud Console \> APIs & Services \> Credentials).
      - Save as `google-credentials.json` or specify a custom path via `GOOGLE_CREDENTIALS_PATH`.
      - Enable the Cloud Translation API in Google Cloud Console.

4.  **⚠️ BACKUP YOUR DATABASES** before running any scripts that modify data\!

-----

## 📋 Workflow 1: Deploy New GENIE.AI Instance

This workflow creates a new GENIE.AI framework instance with your custom knowledge categorization.

### Step 1: Extract Schema from Source Framework

```bash
# Point to your source GENIE.AI database
export ARANGO_DATABASE="genie-ai-source"

# Extract complete schema
node arango-schema-extractor.js
```

**Output**: `arango-schema.json`

**⚠️ Safe**: Read-only operation

### Step 2: Export Knowledge Categories, Services, and Translations

```bash
# Still pointing to source database
export ARANGO_DATABASE="genie-ai-source"
export EXPORT_DIR="./exports"

# Export all collections (categories, services, edges, translations)
node export-service-categories.js
```

**Output**: `exports/serviceCategoriesAndServices_export_2025-06-28T10-30-45.json`

**📝 Important**:

  - Exports the complete knowledge hierarchy, including `serviceCategories`, `services`, `categoryServices`, and translation collections.
  - Includes category-service relationships via edges and translation relationships.
  - Copy the exact filename for the import step.

**⚠️ Safe**: Read-only operation

### Step 3: Create New Framework Database

```bash
# Point to your NEW GENIE.AI instance
export ARANGO_DATABASE="genie-ai-production"

# Create database with GENIE.AI schema
node arango-schema-creator.js ./arango-schema.json
```

**Output**: New database ready for GENIE.AI framework

**⚠️ Caution**: Creates a new database; ensure the name doesn't conflict with existing databases.

### Step 4: Import Knowledge Hierarchy and Translations

**⚠️ IMPORTANT: Disable Schema Validation First\!**

Before running the import script, you MUST disable schema validation for all collections to prevent validation errors:

1.  **In ArangoDB Web UI**:

      - Go to your database (e.g., `genie-ai-production`).
      - Navigate to Collections.
      - For each of these collections (if they exist):
          - `serviceCategories`
          - `services`
          - `categoryServices`
          - `serviceCategoryTranslations`
          - `serviceCategoryTranslationsEdge`
          - `serviceTranslations`
          - `serviceTranslationsEdge`
      - Click on each collection → Settings/Schema tab.
      - Set "Schema Validation Level" to **"None"**.
      - Click Save.

2.  **Or via AQL (run for each collection)**:

    ```aql
    db.serviceCategories.properties({ schema: null });
    db.services.properties({ schema: null });
    db.categoryServices.properties({ schema: null });
    db.serviceCategoryTranslations.properties({ schema: null });
    db.serviceCategoryTranslationsEdge.properties({ schema: null });
    db.serviceTranslations.properties({ schema: null });
    db.serviceTranslationsEdge.properties({ schema: null });
    ```

**Now run the import**:

```bash
# Still pointing to NEW database
export ARANGO_DATABASE="genie-ai-production"
export IMPORT_FILE="./exports/serviceCategoriesAndServices_export_2025-06-28T10-30-45.json"  # USE YOUR ACTUAL FILENAME
export SCHEMA_STRICT="true"

# Import knowledge hierarchy and translations
node import-service-categories.js
```

**Output**:

  - Knowledge areas (`serviceCategories`) imported with `nameEN` preserved.
  - Services imported with `nameEN` and proper category references.
  - Hierarchy edges (`categoryServices`) imported for navigation tree.
  - Translation collections (`serviceCategoryTranslations`, `serviceTranslations`) and edges imported.
  - RAG context structure preserved.

**📝 Critical**:

  - The knowledge hierarchy is essential for RAG context building.
  - Categories form the UI navigation and RAG domain context.
  - Edge relationships maintain the tree structure and translation links.
  - The `nameEN` field is retained in `serviceCategories` and `services` for compatibility.

**⚠️ Caution**: Writes data to the target database.

### Result: GENIE.AI Instance Ready

Your new GENIE.AI framework instance is ready with:

  - Complete knowledge categorization for RAG enhancement.
  - UI navigation tree structure.
  - Multi-language support via translation collections.
  - Backend integration points for context building.

-----

## 📋 Workflow 2: Setup New GENIE.AI Use Case From Scratch

This workflow is the standard process for defining a new knowledge hierarchy for a GENIE.AI instance. It involves creating a new database, defining your custom service categories and services in English, and then adding translations.

### Step 1: Create New Framework Database

Follow Step 3 from Workflow 1 to create a new, empty database with the correct schema using `arango-schema-creator.js`.

```bash
# Point to your NEW GENIE.AI instance
export ARANGO_DATABASE="genie-ai-new-use-case"

# Create database with GENIE.AI schema
node arango-schema-creator.js ./arango-schema.json
```

### Step 2: Define and Create the Knowledge Hierarchy

Using the new `create-knowledge-hierarchy.js` script, define your service categories and services. You can do this interactively or by preparing a simple JSON file. This script will only create the English (`nameEN`) entries.

**Option A: Interactive Mode (Recommended for manual setup)**
Run the script without arguments and follow the prompts.

```bash
# Still pointing to your NEW database
export ARANGO_DATABASE="genie-ai-new-use-case"

node create-knowledge-hierarchy.js
```

The script will guide you through entering each category and its associated services, then ask for confirmation before writing to the database.

**Option B: File Mode (Recommended for automated setup)**
Create a simple JSON file (e.g., `my-hierarchy.json`) that defines your categories and services.

**Example `my-hierarchy.json`**:

```json
[
  {
    "category": "Emergency Services",
    "services": [
      "Ambulance Dispatch",
      "Emergency Room Locations",
      "Poison Control Hotline"
    ]
  },
  {
    "category": "Specialist Care",
    "services": [
      "Cardiology Appointments",
      "Neurology Specialist Finder",
      "Oncology Treatment Centers"
    ]
  }
]
```

Then, run the script with the `--file` flag.

```bash
# Still pointing to your NEW database
export ARANGO_DATABASE="genie-ai-new-use-case"

node create-knowledge-hierarchy.js --file ./my-hierarchy.json
```

The script will ask for final confirmation before writing the data.

**Output**:

  - Your custom knowledge areas (`serviceCategories`) and services (`services`) are created in the database.
  - The hierarchy is correctly linked with edges in `categoryServices`.
  - The instance is now ready for translation.

### Step 3: Add National Language Translations

Use `create-translations.js` to automatically generate translations for your new hierarchy. Run the script for each target language (e.g., Indonesian `ID`, French `FR`).

```bash
export ARANGO_DATABASE="genie-ai-new-use-case"
export GOOGLE_CREDENTIALS_PATH="./google-credentials.json"

# Create Indonesian translations
node create-translations.js ID

# Create French translations
node create-translations.js FR
```

**Output**:

  - Translations are created in `serviceCategoryTranslations` and `serviceTranslations`.
  - Edges linking items to their translations are created.

### Result: GENIE.AI Instance with Custom Hierarchy and Multi-language Support

Your framework now supports:

  - A custom knowledge categorization tailored to your specific use case.
  - UI navigation in multiple languages.
  - Language-aware RAG context building.
  - Seamless backend translation handling via Google Cloud Translate API.

-----

## 📋 Workflow 3: Migrate Existing GENIE.AI Deployment

This workflow transfers an existing GENIE.AI instance, including its knowledge hierarchy and translations, to a new environment.

### Step 1: Export Existing Data

Follow Step 2 from Workflow 1 to export `serviceCategories`, `services`, `categoryServices`, and translation collections.

### Step 2: Create New Database

Follow Step 3 from Workflow 1 to create a new database using `arango-schema-creator.js`.

### Step 3: Import Data

Follow Step 4 from Workflow 1 to import the exported data, ensuring schema validation is disabled.

### Result: Migrated GENIE.AI Instance

Your new instance retains:

  - Original knowledge hierarchy with `nameEN` fields preserved.
  - All translations and edge relationships.
  - RAG context building capabilities.
  - No service interruption during migration.

-----

## 🔄 Schema Export Considerations

### Schema Export Timing

The schema export includes all collections present at the time of export:

  - **Before Adding Translations**: Schema includes `serviceCategories`, `services`, and `categoryServices`. New databases will require `create-translations.js` to add translations.
  - **After Adding Translations**: Schema includes all collections (`serviceCategories`, `services`, `categoryServices`, `serviceCategoryTranslations`, `serviceCategoryTranslationsEdge`, `serviceTranslations`, `serviceTranslationsEdge`). New databases will have translation support built-in.

### Recommended Approach

1.  Define or import your knowledge hierarchy.
2.  Run `create-translations.js` to add required languages.
3.  Export the schema using `arango-schema-extractor.js` to include translation collections.
4.  Use the schema for new database creation.
5.  Import data with `import-service-categories.js`.

This ensures new databases have the full schema with translation support.

-----

## 📊 Data Structure Details

### Export/Import File Structure (v4.0)

The export/import format includes all collections:

```json
{
  "metadata": {
    "exportDate": "2025-06-28T10:30:45.123Z",
    "sourceDatabase": "node-services",
    "collections": [
      "serviceCategories",
      "services",
      "categoryServices",
      "serviceCategoryTranslations",
      "serviceCategoryTranslationsEdge",
      "serviceTranslations",
      "serviceTranslationsEdge"
    ],
    "documentCounts": {
      "serviceCategories": 12,
      "services": 156,
      "categoryServices": 156,
      "serviceCategoryTranslations": 36,
      "serviceCategoryTranslationsEdge": 36,
      "serviceTranslations": 468,
      "serviceTranslationsEdge": 468
    },
    "exportVersion": "4.0"
  },
  "data": {
    "serviceCategories": [...],
    "services": [...],
    "categoryServices": [...],
    "serviceCategoryTranslations": [...],
    "serviceCategoryTranslationsEdge": [...],
    "serviceTranslations": [...],
    "serviceTranslationsEdge": [...]
  }
}
```

### Translation Collections Structure

**`serviceCategoryTranslations`**:

```json
{
  "_key": "1_ID",
  "serviceCategoryId": "1",
  "languageCode": "ID",
  "translation": "Layanan Darurat",
  "isActive": true,
  "createdAt": "2025-06-28T21:44:00.123Z",
  "updatedAt": "2025-06-28T21:44:00.123Z"
}
```

**`serviceTranslations`**:

```json
{
  "_key": "101_ID",
  "serviceId": "101",
  "languageCode": "ID",
  "translation": "Pengiriman Ambulans",
  "isActive": true,
  "createdAt": "2025-06-28T21:44:00.123Z",
  "updatedAt": "2025-06-28T21:44:00.123Z"
}
```

**`serviceCategoryTranslationsEdge`**:

```json
{
  "_from": "serviceCategories/1",
  "_to": "serviceCategoryTranslations/1_ID",
  "createdAt": "2025-06-28T21:44:00.123Z"
}
```

**`serviceTranslationsEdge`**:

```json
{
  "_from": "services/101",
  "_to": "serviceTranslations/101_ID",
  "createdAt": "2025-06-28T21:44:00.123Z"
}
```

-----

## 🛡️ Safety Features

### Translation Creation Safety

The `create-translations.js` script:

  - Checks for existing translations to avoid duplicates.
  - Creates collections and indexes if they don’t exist.
  - Uses unique keys (`${key}_${lang}`) to prevent conflicts.
  - Handles Google Translate API errors with fallback translations.

### Import Safety

The `import-service-categories.js` script:

  - Validates data before import.
  - Skips existing documents to prevent duplicates.
  - Imports collections in dependency order (`serviceCategories`, `services`, `categoryServices`, then translations).
  - Preserves `nameEN` fields for compatibility.

### Export Safety

The `export-service-categories.js` script:

  - Includes all relevant collections, even if empty.
  - Validates exported data structure.
  - Supports optional system fields for flexibility.

-----

## 🔍 Verification & Troubleshooting

### Verify Complete Import

```aql
// Check counts
FOR cat IN serviceCategories
  COLLECT WITH COUNT INTO catCount
  RETURN catCount

FOR svc IN services
  COLLECT WITH COUNT INTO svcCount
  RETURN svcCount

FOR trans IN serviceCategoryTranslations
  COLLECT WITH COUNT INTO transCount
  RETURN transCount

FOR trans IN serviceTranslations
  COLLECT WITH COUNT INTO transCount
  RETURN transCount

// Verify relationships
FOR svc IN services
  LET cat = DOCUMENT('serviceCategories', svc.categoryId)
  RETURN {
    service: svc.nameEN,
    category: cat.nameEN
  }
```

### Verify Translations

```aql
// Check serviceCategoryTranslations
FOR cat IN serviceCategories
  LIMIT 2
  LET translations = (
    FOR edge IN serviceCategoryTranslationsEdge
      FILTER edge._from == CONCAT('serviceCategories/', cat._key)
      FOR t IN serviceCategoryTranslations
        FILTER t._id == edge._to
        RETURN { lang: t.languageCode, text: t.translation }
  )
  RETURN {
    category: cat.nameEN,
    translations: translations
  }

// Check serviceTranslations
FOR svc IN services
  LIMIT 2
  LET translations = (
    FOR edge IN serviceTranslationsEdge
      FILTER edge._from == CONCAT('services/', svc._key)
      FOR t IN serviceTranslations
        FILTER t._id == edge._to
        RETURN { lang: t.languageCode, text: t.translation }
  )
  RETURN {
    service: svc.nameEN,
    translations: translations
  }
```

### Common Issues

**"Import file format not recognized"**

  - Ensure the export file is in v4.0 format (includes all collections).
  - Check `exportVersion` in the metadata.

**"Service categoryId references not found"**

  - Verify `serviceCategories` are imported before `services`.
  - Ensure `categoryId` matches `_key` in `serviceCategories`.

**"Translation already exists"**

  - Expected behavior in `create-translations.js` and `import-service-categories.js`.
  - The scripts skip existing translations to avoid duplicates.

**"Google Translate API error"**

  - Verify `google-credentials.json` contains valid credentials and an API key.
  - Ensure the Cloud Translation API is enabled in Google Cloud Console.
  - Check network connectivity and API quota limits.

-----

## 🔄 GENIE.AI Integration Strategy

### RAG Context Flow

**1. User Interaction**:

```javascript
// User selects category in UI (shown in their language)
const selectedCategory = "Layanan Darurat"; // Indonesian user
const categoryId = "1";
```

**2. Backend Processing**:

```javascript
// Category label passed to RAG for context
const ragContext = {
  domain: selectedCategory,  // Native language label
  categoryId: categoryId,
  language: "ID"
};

// RAG system uses native language context for better understanding
const enhancedQuery = buildQueryWithContext(userQuery, ragContext);
```

**3. Response Generation**:

  - RAG system understands domain context in the user's language.
  - Responses are more relevant and culturally appropriate.
  - Backend handles all translation complexity using Google Cloud Translate API.

### Customizing for Your Use Case

**1. Define Knowledge Areas**:

```javascript
// Example: Healthcare System
const categories = [
  { _key: "1", nameEN: "Emergency Services", order: 1 },
  { _key: "2", nameEN: "Specialist Care", order: 2 },
  { _key: "3", nameEN: "Preventive Medicine", order: 3 }
];
```

**2. Structure Services**:

```javascript
const services = [
  { _key: "101", categoryId: "1", nameEN: "Ambulance Dispatch", order: 1 },
  { _key: "102", categoryId: "1", nameEN: "Emergency Room", order: 2 },
  { _key: "103", categoryId: "2", nameEN: "Cardiology", order: 1 }
];
```

**3. Add Language Support**:

```bash
node create-translations.js ID
node create-translations.js ES
```

**Note**: A future utility will simplify this process by providing a UI or CLI to define categories and services in English and generate translations.

-----

## 📊 Expected Outcomes

### After New Instance Deployment (Workflow 1):

  - ✅ New database with GENIE.AI schema.
  - ✅ Complete knowledge hierarchy imported.
  - ✅ Translation collections and edges imported.
  - ✅ UI navigation tree ready.
  - ✅ RAG context structure in place.

### After Adding Translations (Workflow 2):

  - ✅ Custom knowledge hierarchy established.
  - ✅ Translations for multiple languages added.
  - ✅ Native language UI support.
  - ✅ Enhanced RAG context building.
  - ✅ Backend translation handling ready.

### After Migration (Workflow 3):

  - ✅ Existing GENIE.AI instance migrated.
  - ✅ Knowledge hierarchy and translations preserved.
  - ✅ No service interruption.
  - ✅ Enhanced RAG responses in multiple languages.

-----

## 📞 Best Practices for GENIE.AI Deployment

### Knowledge Categorization Guidelines

1.  **Keep Categories Broad**: 8-15 top-level categories work best for UI navigation.
2.  **Logical Grouping**: Group services by user intent, not organizational structure.
3.  **Clear Naming**: Use descriptive `nameEN` fields for clarity.

<!-- end list -->

  - **Order Matters**: Most important categories/services should appear first (lower `order` values).

### RAG Context Optimization

1.  **Descriptive Labels**: Use clear, specific `nameEN` fields to improve RAG understanding.
2.  **Consistent Terminology**: Maintain consistent terms across categories and services.
3.  **Language Considerations**: Ensure translations preserve semantic meaning.
4.  **Testing**: Test RAG responses with different category contexts and languages.

### Database Naming Convention

  - `genie-ai-dev` - Development environment
  - `genie-ai-staging` - Staging environment
  - `genie-ai-production` - Production deployment
  - `genie-ai-[client]` - Client-specific instances

### Deployment Strategy

1.  Deploy to development first.
2.  Test RAG integration and translations thoroughly.
3.  Validate UI navigation tree and language support.
4.  Deploy to staging for user testing.
5.  Monitor production deployment.

**Note**: The quality of your knowledge categorization and translations directly impacts RAG response quality. Well-structured categories and accurate translations lead to better context understanding and more relevant AI responses.