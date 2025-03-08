// service-category-service.js
const { Database, aql } = require('arangojs');

// Initialize ArangoDB connection
const initDB = () => {
  const db = new Database({
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: process.env.ARANGO_DB || 'chatbot_analytics',
    auth: {
      username: process.env.ARANGO_USERNAME || 'root',
      password: process.env.ARANGO_PASSWORD || ''
    }
  });

  return db;
};

class ServiceCategoryService {
  constructor() {
    this.db = initDB();
    this.serviceCategories = this.db.collection('serviceCategories');
    this.services = this.db.collection('services');
    this.categoryServices = this.db.collection('categoryServices');
  }

  /**
   * Create or update service categories from the tree panel component
   * @param {Array} categories - Array of category objects
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} The created/updated categories
   */
  async upsertCategories(categories, locale = 'en') {
    try {
      const results = [];
      const nameField = `name${locale.toUpperCase()}`;

      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const categoryKey = category.catKey || `cat${i + 1}`;
        
        // Prepare category document
        const categoryDoc = {
          _key: categoryKey,
          order: i + 1
        };
        
        // Set the locale-specific name
        categoryDoc[nameField] = category.name;
        
        // Check if category already exists
        const exists = await this.categoryExists(categoryKey);
        
        if (exists) {
          // Update existing category
          const updateData = {};
          updateData[nameField] = category.name;
          updateData.order = i + 1;
          
          const updatedCategory = await this.serviceCategories.update(
            categoryKey,
            updateData,
            { returnNew: true }
          );
          
          results.push(updatedCategory.new);
        } else {
          // Create new category
          const newCategory = await this.serviceCategories.save(categoryDoc);
          results.push(newCategory);
        }
        
        // Handle children (services)
        if (category.children && Array.isArray(category.children)) {
          await this.upsertServices(categoryKey, category.children, locale);
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error upserting categories:', error);
      throw error;
    }
  }
  
  /**
   * Create or update services for a category
   * @param {String} categoryKey - Category key
   * @param {Array} services - Array of service names
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} The created/updated services
   */
  async upsertServices(categoryKey, services, locale = 'en') {
    try {
      const results = [];
      const nameField = `name${locale.toUpperCase()}`;
      
      // Get existing services for this category
      const existingServicesQuery = aql`
        FOR edge IN categoryServices
          FILTER edge._from == ${'serviceCategories/' + categoryKey}
          FOR service IN services
            FILTER service._id == edge._to
            RETURN service
      `;
      
      const existingServicesCursor = await this.db.query(existingServicesQuery);
      const existingServices = await existingServicesCursor.all();
      
      // Create a map of existing services by name for quick lookup
      const existingServicesByName = {};
      existingServices.forEach(service => {
        existingServicesByName[service[nameField]] = service;
      });
      
      // Process each service
      for (let i = 0; i < services.length; i++) {
        const serviceName = services[i];
        const existing = existingServicesByName[serviceName];
        
        if (existing) {
          // Update existing service
          const updateData = {};
          updateData[nameField] = serviceName;
          updateData.order = i + 1;
          
          const updatedService = await this.services.update(
            existing._key,
            updateData,
            { returnNew: true }
          );
          
          results.push(updatedService.new);
        } else {
          // Create new service
          const serviceDoc = {
            _key: `service_${categoryKey}_${i + 1}`,
            categoryId: categoryKey,
            order: i + 1
          };
          
          serviceDoc[nameField] = serviceName;
          
          const newService = await this.services.save(serviceDoc);
          results.push(newService);
          
          // Create edge from category to service
          await this.categoryServices.save({
            _from: `serviceCategories/${categoryKey}`,
            _to: `services/${newService._key}`,
            order: i + 1
          });
        }
      }
      
      // Optionally: Remove services that are no longer in the list
      const serviceNamesToKeep = new Set(services);
      for (const existingService of existingServices) {
        if (!serviceNamesToKeep.has(existingService[nameField])) {
          // Remove the service and its edge
          try {
            await this.db.query(aql`
              FOR edge IN categoryServices
                FILTER edge._from == ${'serviceCategories/' + categoryKey}
                FILTER edge._to == ${existingService._id}
                REMOVE edge IN categoryServices
            `);
            
            await this.services.remove(existingService._key);
          } catch (error) {
            console.error(`Error removing service ${existingService._key}:`, error);
            // Continue despite error
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error(`Error upserting services for category ${categoryKey}:`, error);
      throw error;
    }
  }
  
  /**
   * Check if a category exists
   * @param {String} categoryKey - Category key
   * @returns {Promise<Boolean>} True if the category exists
   */
  async categoryExists(categoryKey) {
    try {
      await this.serviceCategories.document(categoryKey);
      return true;
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
      throw error;
    }
  }
  
  /**
   * Get all categories with their services
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} Categories with services
   */
  async getAllCategoriesWithServices(locale = 'en') {
    try {
      const nameField = `name${locale.toUpperCase()}`;
      
      const query = aql`
        FOR category IN serviceCategories
          SORT category.order ASC
          LET services = (
            FOR edge IN categoryServices
              FILTER edge._from == category._id
              FOR service IN services
                FILTER service._id == edge._to
                SORT edge.order ASC
                RETURN service[${nameField}]
          )
          RETURN {
            catKey: category._key,
            name: category[${nameField}],
            children: services
          }
      `;
      
      const cursor = await this.db.query(query);
      return await cursor.all();
    } catch (error) {
      console.error('Error getting all categories with services:', error);
      throw error;
    }
  }
  
  /**
   * Get category with services by key
   * @param {String} categoryKey - Category key
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Object>} Category with services
   */
  async getCategoryWithServices(categoryKey, locale = 'en') {
    try {
      const nameField = `name${locale.toUpperCase()}`;
      
      const query = aql`
        LET category = DOCUMENT(${`serviceCategories/${categoryKey}`})
        LET services = (
          FOR edge IN categoryServices
            FILTER edge._from == ${`serviceCategories/${categoryKey}`}
            FOR service IN services
              FILTER service._id == edge._to
              SORT edge.order ASC
              RETURN service[${nameField}]
        )
        RETURN {
          catKey: category._key,
          name: category[${nameField}],
          children: services
        }
      `;
      
      const cursor = await this.db.query(query);
      const result = await cursor.next();
      
      if (!result) {
        throw new Error(`Category ${categoryKey} not found`);
      }
      
      return result;
    } catch (error) {
      console.error(`Error getting category ${categoryKey} with services:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a category and its services
   * @param {String} categoryKey - Category key
   * @returns {Promise<Object>} Deletion result
   */
  async deleteCategory(categoryKey) {
    try {
      // Delete services associated with this category
      await this.db.query(aql`
        FOR edge IN categoryServices
          FILTER edge._from == ${`serviceCategories/${categoryKey}`}
          LET service = DOCUMENT(edge._to)
          REMOVE edge IN categoryServices
          REMOVE service IN services
      `);
      
      // Delete the category
      return await this.serviceCategories.remove(categoryKey);
    } catch (error) {
      console.error(`Error deleting category ${categoryKey}:`, error);
      throw error;
    }
  }
  
  /**
   * Search categories and services
   * @param {String} searchQuery - Search query string
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Object>} Search results
   */
  async searchCategoriesAndServices(searchQuery, locale = 'en') {
    try {
      const nameField = `name${locale.toUpperCase()}`;
      const lowerQuery = searchQuery.toLowerCase();
      
      const query = aql`
        LET matchingCategories = (
          FOR category IN serviceCategories
            FILTER LOWER(category[${nameField}]) LIKE ${'%' + lowerQuery + '%'}
            SORT category.order ASC
            RETURN {
              type: 'category',
              key: category._key,
              name: category[${nameField}]
            }
        )
        
        LET matchingServices = (
          FOR service IN services
            FILTER LOWER(service[${nameField}]) LIKE ${'%' + lowerQuery + '%'}
            LET category = DOCUMENT(CONCAT('serviceCategories/', service.categoryId))
            SORT service.order ASC
            RETURN {
              type: 'service',
              key: service._key,
              name: service[${nameField}],
              categoryKey: service.categoryId,
              categoryName: category[${nameField}]
            }
        )
        
        RETURN {
          categories: matchingCategories,
          services: matchingServices
        }
      `;
      
      const cursor = await this.db.query(query);
      return await cursor.next();
    } catch (error) {
      console.error(`Error searching categories and services for "${searchQuery}":`, error);
      return { categories: [], services: [] };
    }
  }
  
  /**
   * Initialize default categories and services for a new system
   * @returns {Promise<Object>} Initialization result
   */
  async initializeDefaultCategoriesAndServices() {
    try {
      // Check if we already have categories
      const existingCategories = await this.db.query(aql`
        FOR category IN serviceCategories
          COLLECT WITH COUNT INTO count
          RETURN count
      `);
      
      const count = await existingCategories.next();
      
      if (count > 0) {
        return { message: 'Categories already initialized', count };
      }
      
      // Default categories based on ServiceTreePanelComponent data
      const defaultCategories = [
        {
          catKey: 'cat1',
          name: 'Health & Social Services',
          children: ['Medical Services', 'Social Assistance', 'Healthcare Programs', 'Mental Health']
        },
        {
          catKey: 'cat2',
          name: 'Education & Learning',
          children: ['K-12 Schools', 'Higher Education', 'Adult Learning', 'Educational Resources']
        },
        {
          catKey: 'cat3',
          name: 'Business & Economy',
          children: ['Business Registration', 'Economic Development', 'Trade', 'Small Business Support']
        },
        {
          catKey: 'cat4',
          name: 'Environment & Resources',
          children: ['Natural Resources', 'Environmental Protection', 'Parks & Recreation', 'Wildlife']
        },
        {
          catKey: 'cat5',
          name: 'Transportation',
          children: ['Driver Services', 'Public Transit', 'Roads & Highways', 'Aviation']
        },
        {
          catKey: 'cat6',
          name: 'Public Safety & Law',
          children: ['Police Services', 'Courts', 'Legal Services', 'Emergency Services']
        },
        {
          catKey: 'cat7',
          name: 'Housing & Properties',
          children: ['Housing Programs', 'Property Assessment', 'Rental Assistance', 'Homeownership']
        },
        {
          catKey: 'cat8',
          name: 'Employment & Labor',
          children: ['Job Search', 'Labor Rights', 'Workplace Safety', 'Career Development']
        },
        {
          catKey: 'cat9',
          name: 'Culture & Recreation',
          children: ['Arts & Culture', 'Heritage', 'Sports & Recreation', 'Tourism']
        },
        {
          catKey: 'cat10',
          name: 'Taxes & Revenue',
          children: ['Income Tax', 'Sales Tax', 'Property Tax', 'Tax Credits']
        },
        {
          catKey: 'cat11',
          name: 'Government & Democracy',
          children: ['Elections', 'Government Agencies', 'Public Records', 'Civic Engagement']
        },
        {
          catKey: 'cat12',
          name: 'Immigration & Citizenship',
          children: ['Immigration Services', 'Citizenship Applications', 'Visas', 'Refugee Programs']
        }
      ];
      
      // Initialize all categories and their services
      const result = await this.upsertCategories(defaultCategories, 'en');
      
      return { 
        message: 'Successfully initialized categories and services',
        categoriesCreated: result.length
      };
    } catch (error) {
      console.error('Error initializing default categories and services:', error);
      throw error;
    }
  }
}

module.exports = ServiceCategoryService;
