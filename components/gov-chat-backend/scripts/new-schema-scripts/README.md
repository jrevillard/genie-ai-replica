# GENIE.AI Framework Database Setup Scripts

This repository contains database setup and migration scripts for the **GENIE.AI User Interface Framework**. GENIE.AI is an adaptable framework designed to provide intelligent, context-aware query responses through integration with RAG (Retrieval-Augmented Generation) systems.

## 🎯 Framework Overview

The GENIE.AI framework uses a hierarchical knowledge categorization system to enhance AI query responses:

- **Knowledge Areas** (represented as serviceCategories): These form the primary navigation tree in the UI's left panel
- **Services**: Specific topics or functions within each knowledge area
- **Multi-language Support**: Native language interfaces with backend translation handling

### How It Works

1. **UI Navigation**: Users navigate through knowledge areas in their native language via the left tree interface
2. **Context Building**: Selected categories and services are used to build query context
3. **RAG Integration**: Category labels are passed to the backend RAG framework to:
   - Fine-tune model responses
   - Provide domain-specific context
   - Improve response quality and relevance
4. **Translation Layer**: All translations (input/output) are handled by the backend services

### Adaptability

The framework can be adapted to various use cases by modifying the categorization structure:
- **Government Services**: Public service categories and citizen services
- **Healthcare Systems**: Medical specialties and patient services  
- **Educational Platforms**: Subject areas and learning resources
- **Enterprise Knowledge Bases**: Departments and business functions

## 📋 Database Collections

The framework uses these collections to build the knowledge hierarchy:

| Collection | Purpose | Type |
|------------|---------|------|
| `serviceCategories` | Top-level knowledge areas that form the UI navigation tree | Document |
| `services` | Specific topics/functions within each knowledge area | Document |
| `categoryServices` | Links knowledge areas to their services | Edge |
| `serviceCategoryTranslations` | Multi-language support for categories | Document |
| `serviceTranslations` | Multi-language support for services | Document |

## 🚀 Setup Process

These scripts help you:
- **Create new GENIE.AI framework instances** with your custom categorization
- **Migrate existing categorizations** to new environments
- **Upgrade to flexible multi-language support** for global deployments
- **Maintain referential integrity** through proper edge relationships

### Schema Evolution for Multi-language RAG Support

**Legacy Schema (fixed language fields):**

Knowledge Area (ServiceCategory):
```json
{
  "_key": "1",
  "nameEN": "Identity & Civil Registration", 
  "nameFR": "Identité et état civil",
  "nameSW": "Utambulisho na Usajili wa Raia",
  "order": 1
}
```

Service Topic:
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
- Dynamic language addition without schema changes
- Clean separation of concerns for RAG processing
- Efficient context building in user's native language

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
```

This structure enables:
- **RAG Context**: Category labels in user's language provide domain context
- **Query Enhancement**: Selected categories guide the AI model's responses
- **Backend Processing**: All translation complexity handled server-side
- **UI Flexibility**: Easy addition of new languages without database schema changes

## 🛠️ Scripts Overview

| Script | Purpose | Database Impact | Prerequisites |
|--------|---------|-----------------|---------------|
| `arango-schema-extractor.js` | Extract complete database schema | **READ ONLY** | None |
| `arango-schema-creator.js` | Create new database from schema | **CREATES DATABASE** | None |
| `export-service-categories.js` | Export serviceCategories, services, and categoryServices edge data | **READ ONLY** | None |
| `import-service-categories.js` | Import serviceCategories, services, and categoryServices edge data | **WRITES DATA** | **Schema validation must be disabled** |
| `category-migration.js` | Add translation collections & migrate both categories and services | **MODIFIES SCHEMA** | None |

## 🎯 Primary Use Cases

### Use Case 1: Deploy New GENIE.AI Instance
Create a new framework instance with your organization's knowledge categorization for RAG-enhanced responses.

### Use Case 2: Framework with Translation Support  
Deploy GENIE.AI with multi-language capabilities for global users while maintaining RAG context quality.

### Use Case 3: Upgrade Existing Deployment
Add translation support to an existing GENIE.AI instance for expanded language coverage.

---

## 🚀 Complete Workflows

### Prerequisites

1. **Install Dependencies**
```bash
npm install arangojs
```

2. **Set Base Environment Variables**
```bash
export ARANGO_URL="http://localhost:8529"
export ARANGO_USERNAME="root"
export ARANGO_PASSWORD="your-password"
```

3. **⚠️ BACKUP YOUR DATABASES** before running any scripts!

---

## 📋 Workflow 1: Deploy New GENIE.AI Instance

This workflow creates a new GENIE.AI framework instance with your custom knowledge categorization.

### Step 1: Extract Schema from Source Framework

```bash
# Point to your source GENIE.AI database
export ARANGO_DATABASE="genie-ai-source"

# Extract complete schema
node arango-schema-extractor.js
```

**Output:** `arango-schema.json`

**⚠️ Safe:** Read-only operation

### Step 2: Export Knowledge Categories and Services

```bash
# Still pointing to source database
export ARANGO_DATABASE="genie-ai-source"
export EXPORT_DIR="./exports"

# Export all three collections (categories, services, edges)
node export-service-categories.js
```

**Output:** `exports/serviceCategoriesAndServices_export_2025-06-18T10-30-45.json`

**📝 Important:** 
- Exports the complete knowledge hierarchy
- Includes category-service relationships via edges
- Copy the exact filename for import step

**⚠️ Safe:** Read-only operation

### Step 3: Create New Framework Database

```bash
# Point to your NEW GENIE.AI instance
export ARANGO_DATABASE="genie-ai-production"  # or your chosen name

# Create database with GENIE.AI schema
node arango-schema-creator.js ./arango-schema.json
```

**Output:** New database ready for GENIE.AI framework

**⚠️ Caution:** Creates new database - ensure name doesn't conflict

### Step 4: Import Knowledge Hierarchy

**⚠️ IMPORTANT: Disable Schema Validation First!**

Before running the import script, you MUST disable schema validation for all collections:

1. **In ArangoDB Web UI:**
   - Go to your database (e.g., `genie-ai-production`)
   - Navigate to Collections
   - For EACH of these collections (if they exist):
     - `serviceCategories` (knowledge areas)
     - `services` (specific topics)
     - `categoryServices` (hierarchy edges)
   - Click on each collection → Settings/Schema tab
   - Set "Schema Validation Level" to **"None"**
   - Click Save

2. **Or via AQL (run for each collection):**
   ```aql
   // Run these commands in AQL editor
   db.serviceCategories.properties({ schema: null });
   db.services.properties({ schema: null });
   db.categoryServices.properties({ schema: null });
   ```

**Now run the import:**

```bash
# Still pointing to NEW database
export ARANGO_DATABASE="genie-ai-production"
export IMPORT_FILE="./exports/serviceCategoriesAndServices_export_2025-06-18T10-30-45.json"  # USE YOUR ACTUAL FILENAME
export SCHEMA_STRICT="true"

# Import knowledge hierarchy
node import-service-categories.js
```

**Output:** 
- Knowledge areas (categories) imported
- Service topics imported with proper references
- Hierarchy edges imported for navigation tree
- RAG context structure preserved

**📝 Critical:** 
- The knowledge hierarchy is essential for RAG context building
- Categories form the UI navigation and RAG domain context
- Edge relationships maintain the tree structure

**⚠️ Caution:** Writes data to target database

### Result: GENIE.AI Instance Ready
Your new GENIE.AI framework instance is ready with:
- Complete knowledge categorization for RAG enhancement
- UI navigation tree structure
- Backend integration points for context building

---

## 📋 Workflow 2: Deploy GENIE.AI with Translation Support

This workflow creates a new GENIE.AI instance with multi-language support for global deployments.

### Steps 1-4: Same as Workflow 1
Follow all steps from Workflow 1 first to create the base framework.

### Step 5: Add Translation System for Multi-language RAG

```bash
# Still pointing to NEW database  
export ARANGO_DATABASE="genie-ai-production"

# Add translation collections and migrate data
node category-migration.js
```

**Output:**
- `serviceCategoryTranslations` collection created (UI labels in multiple languages)
- `serviceCategoryTranslationsEdge` collection created
- `serviceTranslations` collection created (service labels in multiple languages)
- `serviceTranslationsEdge` collection created
- All EN/FR/SW translations migrated for UI display
- Original fields preserved for backward compatibility

**✅ RAG Integration Benefits:**
- UI displays categories in user's native language
- Selected category labels passed to RAG in user's language
- Improved context understanding for language-specific queries
- Backend handles all translation complexity

**⚠️ Caution:** Modifies database schema

### Result: Multi-language GENIE.AI Framework
Your framework now supports:
- Native language UI navigation
- Language-aware RAG context building
- Seamless backend translation handling
- Easy addition of new languages

---

## 📋 Workflow 3: Upgrade Existing GENIE.AI Deployment

This workflow adds multi-language support to an existing GENIE.AI instance.

### Apply Translation System to Production

```bash
# Point to your PRODUCTION GENIE.AI database
export ARANGO_DATABASE="genie-ai-main"  # your production database

# Add translation system
node category-migration.js
```

**Output:** 
- Translation collections added alongside existing data
- All current language data migrated
- RAG context building enhanced with language awareness
- Zero downtime - existing functionality preserved

**✅ Safe Upgrade Features:**
- Original collections unchanged
- GENIE.AI continues operating during migration
- Gradual rollout possible
- Full rollback capability

### Result: Enhanced GENIE.AI with Multi-language Support
Your production GENIE.AI now features:
- Multi-language UI capabilities
- Enhanced RAG context in user's native language
- Improved query understanding across languages
- Foundation for global expansion

---

## 🔄 Schema Export Considerations

### Important: Schema Export Timing

The schema export will include whatever collections exist at the time of export:

**If you export BEFORE applying translation migration:**
- Schema includes only original collections
- New databases will need translation migration applied separately

**If you export AFTER applying translation migration:**  
- Schema includes all 4 translation collections
- New databases will have translation system ready
- Translation migration script will detect existing collections and skip creation

### Recommended Approach

1. **Apply translation migration to your main database first**
2. **Export schema** (now includes all translation collections)
3. **Create new databases** using the updated schema
4. **Import serviceCategories and services**
5. **Run translation migration** (will detect existing collections and just migrate data)

This ensures all new databases have the updated schema by default.

---

## 📊 Data Structure Details

### Export/Import File Structure (v3.0)

The enhanced export/import format now includes all three collections:

```json
{
  "metadata": {
    "exportDate": "2025-06-18T10:30:45.123Z",
    "sourceDatabase": "node-services",
    "collections": ["serviceCategories", "services", "categoryServices"],
    "documentCounts": {
      "serviceCategories": 12,
      "services": 156,
      "categoryServices": 156
    },
    "exportVersion": "3.0"
  },
  "data": {
    "serviceCategories": [...],
    "services": [...],
    "categoryServices": [
      {
        "_key": "12345",
        "_from": "serviceCategories/1",
        "_to": "services/101",
        "order": 1
      }
    ]
  }
}
```

### Translation Collections Structure

**serviceCategoryTranslations:**
```json
{
  "_key": "1_EN",
  "serviceCategoryId": "1",
  "languageCode": "EN",
  "translation": "Identity & Civil Registration",
  "isActive": true,
  "createdAt": "2025-06-18T10:30:45.123Z",
  "updatedAt": "2025-06-18T10:30:45.123Z"
}
```

**serviceTranslations:**
```json
{
  "_key": "101_EN",
  "serviceId": "101",
  "languageCode": "EN", 
  "translation": "Birth Certificate",
  "isActive": true,
  "createdAt": "2025-06-18T10:30:45.123Z",
  "updatedAt": "2025-06-18T10:30:45.123Z"
}
```

---

## 🛡️ Safety Features

### Translation Migration Script Safety

The `category-migration.js` script is designed to be safe for multiple runs:

```javascript
// ✅ Handles existing collections for both categories and services
if (exists) {
  console.log('⚠ serviceCategoryTranslations collection already exists - using existing collection');
  return collection;
}

// ✅ Handles existing translation data  
if (insertError.code === 1210) {
  console.log('⚠ Translation already exists for serviceCategory/service');
}
```

**This means:**
- ✅ Safe to run on databases that already have translation collections
- ✅ Safe to run multiple times  
- ✅ Won't duplicate data
- ✅ Won't overwrite existing translations
- ✅ Handles both serviceCategories and services atomically

### Import Order Preservation

The import script ensures proper order:
1. Imports serviceCategories first
2. Then imports services (which reference serviceCategories)
3. Finally imports categoryServices edges (which reference both)
4. Validates all references exist

**⚠️ CRITICAL:** Schema validation MUST be disabled for all three collections before import!

---

## 🔍 Verification & Troubleshooting

### Verify Complete Import
```aql
// Check serviceCategories
FOR cat IN serviceCategories
  COLLECT WITH COUNT INTO catCount
  RETURN catCount

// Check services  
FOR svc IN services
  COLLECT WITH COUNT INTO svcCount
  RETURN svcCount

// Verify relationships
FOR svc IN services
  LET cat = DOCUMENT('serviceCategories', svc.categoryId)
  RETURN {
    service: svc.nameEN,
    category: cat.nameEN
  }
```

### Verify Translation Migration for Both Collections
```aql
// Check serviceCategoryTranslations
FOR cat IN serviceCategories
  LIMIT 2
  LET translations = (
    FOR t IN serviceCategoryTranslations
      FILTER t.serviceCategoryId == cat._key
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
    FOR t IN serviceTranslations
      FILTER t.serviceId == svc._key
      RETURN { lang: t.languageCode, text: t.translation }
  )
  RETURN {
    service: svc.nameEN,
    translations: translations
  }
```

### Common Issues

**"Import file format not recognized"**
- Check if using old format (serviceCategories only) vs new format (both collections)
- Script auto-detects format based on exportVersion

**"Service categoryId references not found"**
- Ensure serviceCategories are imported before services
- Check categoryId format (handles both "1" and "serviceCategories/1")

**"Translation already exists"**
- This is safe and expected on re-runs
- Script skips existing translations

---

## 🔄 GENIE.AI Integration Strategy

### RAG Context Flow

**1. User Interaction:**
```javascript
// User selects category in UI (shown in their language)
const selectedCategory = "Identité et état civil"; // French user
const categoryId = "1";
```

**2. Backend Processing:**
```javascript
// Category label passed to RAG for context
const ragContext = {
  domain: selectedCategory,  // Native language label
  categoryId: categoryId,
  language: "FR"
};

// RAG system uses native language context for better understanding
const enhancedQuery = buildQueryWithContext(userQuery, ragContext);
```

**3. Response Generation:**
- RAG system understands domain context in user's language
- Responses are more relevant and culturally appropriate
- Backend handles all translation complexity

### Customizing for Your Use Case

**1. Define Your Knowledge Areas:**
```javascript
// Example: Healthcare System
const categories = [
  { nameEN: "Emergency Services", order: 1 },
  { nameEN: "Specialist Care", order: 2 },
  { nameEN: "Preventive Medicine", order: 3 }
];

// Example: Educational Platform  
const categories = [
  { nameEN: "STEM Subjects", order: 1 },
  { nameEN: "Liberal Arts", order: 2 },
  { nameEN: "Professional Skills", order: 3 }
];
```

**2. Structure Your Services:**
```javascript
// Healthcare services under "Emergency Services"
const services = [
  { nameEN: "Ambulance Dispatch", categoryId: "1" },
  { nameEN: "Emergency Room", categoryId: "1" },
  { nameEN: "Urgent Care", categoryId: "1" }
];
```

**3. Add Language Support:**
```javascript
// Use migration script helpers
await addNewServiceCategoryTranslation('1', 'ES', 'Servicios de Emergencia');
await addNewServiceTranslation('101', 'ES', 'Despacho de Ambulancia');
```
```

---

## 📊 Expected Outcomes

### After GENIE.AI Framework Deployment (Workflow 1):
- ✅ New database with GENIE.AI schema
- ✅ Complete knowledge hierarchy imported
- ✅ Category-service relationships preserved
- ✅ UI navigation tree ready
- ✅ RAG context structure in place
- ✅ Ready for frontend integration

### After Multi-language Enhancement (Workflow 2):  
- ✅ Translation collections for all knowledge areas
- ✅ Native language UI support
- ✅ Enhanced RAG context building
- ✅ Backend translation handling ready
- ✅ Support for dynamic language addition
- ✅ Improved query understanding

### After Production Upgrade (Workflow 3):
- ✅ Existing GENIE.AI enhanced with translations
- ✅ No service interruption
- ✅ Gradual migration path available
- ✅ Better RAG responses in multiple languages
- ✅ Foundation for global deployment

---

## 📞 Best Practices for GENIE.AI Deployment

### Knowledge Categorization Guidelines

1. **Keep Categories Broad**: 8-15 top-level categories work best for UI navigation
2. **Logical Grouping**: Group services by user intent, not organizational structure
3. **Clear Naming**: Use descriptive names that users understand
4. **Order Matters**: Most important categories should appear first

### RAG Context Optimization

1. **Descriptive Labels**: More descriptive category names improve RAG understanding
2. **Consistent Terminology**: Use consistent terms across categories
3. **Language Considerations**: Ensure translations preserve semantic meaning
4. **Testing**: Test RAG responses with different category contexts

### Database Naming Convention
- `genie-ai-dev` - Development environment
- `genie-ai-staging` - Staging environment  
- `genie-ai-production` - Production deployment
- `genie-ai-[client]` - Client-specific instances

### Migration Strategy
1. Deploy to development first
2. Test RAG integration thoroughly
3. Validate UI navigation tree
4. Deploy to staging for user testing
5. Production deployment with monitoring

Remember: The quality of your knowledge categorization directly impacts the quality of RAG responses. Well-structured categories lead to better context understanding and more relevant AI responses.