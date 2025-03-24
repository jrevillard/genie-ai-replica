// service-category-service.js
require('dotenv').config();
const { Database, aql } = require('arangojs');

// Initialize ArangoDB connection
const dbService = require('../utils/db-connect-service');

const initDB = dbService.getConnection();

class ServiceCategoryService {
  constructor() {
    this.db = initDB;
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
      console.log(`Upserting ${categories.length} categories for locale ${locale}`);
      const results = [];
      const nameField = `name${locale.toUpperCase()}`;

      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        console.log(`Processing category ${i + 1}/${categories.length}: ${category.name}`);
        
        // Skip invalid categories
        if (!category || typeof category !== 'object') {
          console.log(`Skipping invalid category at index ${i}`);
          continue;
        }
        
        // Prepare category document, omitting _key to let ArangoDB generate it
        const categoryDoc = {
          catCode: category.catKey || `cat${i + 1}`, // Use catCode instead of setting _key
          order: i + 1
        };
        
        // Set the locale-specific name
        categoryDoc[nameField] = category.name || `Category ${i + 1}`;
        
        console.log(`Creating category with name: ${categoryDoc[nameField]}`);
        try {
          // Let ArangoDB generate the _key
          const newCategory = await this.serviceCategories.save(categoryDoc);
          results.push(newCategory);
          console.log(`Category created successfully with key: ${newCategory._key}`);
          
          // Handle children (services)
          if (category.children && Array.isArray(category.children)) {
            console.log(`Processing ${category.children.length} services for category ${newCategory._key}`);
            
            try {
              await this.upsertServices(newCategory._key, category.children, locale);
              console.log(`Services for ${newCategory._key} processed successfully`);
            } catch (servicesError) {
              console.error(`Error processing services for ${newCategory._key}:`, servicesError);
            }
          } else {
            console.log(`No services to process for category ${newCategory._key}`);
          }
        } catch (categoryError) {
          console.error(`Error creating category ${category.name}:`, categoryError);
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
      console.log(`Starting upsertServices for category ${categoryKey} with ${services.length} services`);
      const results = [];
      const nameField = `name${locale.toUpperCase()}`;
      
      // Ensure we have a valid category key
      if (!categoryKey) {
        console.error('Invalid category key provided');
        return [];
      }
      
      // Ensure we have a valid services array
      if (!Array.isArray(services)) {
        console.error('Invalid services array:', services);
        return [];
      }
      
      // Process each service
      for (let i = 0; i < services.length; i++) {
        const serviceName = String(services[i] || '').trim();
        if (!serviceName) {
          console.log(`Skipping empty service at index ${i}`);
          continue;
        }
        
        console.log(`Processing service ${i + 1}/${services.length}: "${serviceName}"`);
        
        try {
          // Create service document without explicit _key
          const serviceDoc = {
            serviceCode: `service_${i + 1}`, // Use serviceCode instead of setting _key
            categoryId: categoryKey,
            order: i + 1
          };
          
          serviceDoc[nameField] = serviceName;
          
          console.log(`Creating service: ${serviceName}`);
          const newService = await this.services.save(serviceDoc);
          results.push(newService);
          console.log(`Service "${serviceName}" created with key ${newService._key}`);
          
          // Create edge from category to service
          const edgeDoc = {
            _from: `serviceCategories/${categoryKey}`,
            _to: `services/${newService._key}`,
            order: i + 1
          };
          
          console.log(`Creating edge for service "${serviceName}"`);
          await this.categoryServices.save(edgeDoc);
          console.log(`Edge created for service "${serviceName}"`);
        } catch (createError) {
          console.error(`Error creating service "${serviceName}":`, createError);
        }
      }
      
      console.log(`Processed ${results.length}/${services.length} services for category ${categoryKey}`);
      return results;
    } catch (error) {
      console.error(`Error upserting services for category ${categoryKey}:`, error);
      return [];
    }
  }
  
  /**
   * Check if a category exists
   * @param {String} categoryKey - Category key
   * @returns {Promise<Boolean>} True if the category exists
   */
  async categoryExists(categoryKey) {
    try {
      if (!categoryKey) return false;
      
      await this.serviceCategories.document(categoryKey);
      return true;
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
      console.error(`Error checking if category ${categoryKey} exists:`, error);
      return false;
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
            catCode: category.catCode,
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
      if (!categoryKey) {
        throw new Error('Invalid category key');
      }
      
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
          catCode: category.catCode,
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
      if (!categoryKey) {
        throw new Error('Invalid category key');
      }
      
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
      if (!searchQuery) {
        return { categories: [], services: [] };
      }
      
      const nameField = `name${locale.toUpperCase()}`;
      const lowerQuery = String(searchQuery).toLowerCase();
      
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
      console.log('=== Starting initialization of default categories and services ===');
      
      // Check if we already have categories
      let count = 0;
      try {
        const existingCategories = await this.db.query(aql`
          FOR category IN serviceCategories
            COLLECT WITH COUNT INTO count
            RETURN count
        `);
        
        count = await existingCategories.next();
        console.log(`Found ${count} existing categories`);
        
        if (count > 0) {
          console.log('Categories already exist, skipping initialization');
          return { message: 'Categories already initialized', count };
        }
      } catch (countError) {
        console.error('Error counting existing categories:', countError);
        // Continue with initialization even if count fails
      }
      
      // Define the categories with catCode instead of catKey
      const defaultCategories = [
        {
          catKey: 'identity', // This will be stored as catCode, not _key
          name: 'Identity & Civil Registration',
          children: ['Birth Registration', 'National ID Cards', 'Passport Services', 'Vital Records']
        },
        {
          catKey: 'health',
          name: 'Healthcare & Social Services',
          children: ['Medical Services', 'Social Assistance', 'Healthcare Programs', 'Mental Health']
        },
        {
          catKey: 'education',
          name: 'Education & Learning',
          children: ['K-12 Schools', 'Higher Education', 'Adult Learning', 'Educational Resources']
        },
        {
          catKey: 'employment',
          name: 'Employment & Labor Services',
          children: ['Job Search', 'Labor Rights', 'Workplace Safety', 'Career Development']
        },
        {
          catKey: 'taxes',
          name: 'Taxes & Revenue',
          children: ['Income Tax', 'Sales Tax', 'Property Tax', 'Tax Credits']
        },
        {
          catKey: 'safety',
          name: 'Public Safety & Justice',
          children: ['Police Services', 'Courts', 'Legal Services', 'Emergency Services']
        },
        {
          catKey: 'transport',
          name: 'Transportation & Mobility',
          children: ['Driver Services', 'Public Transit', 'Roads & Highways', 'Aviation']
        },
        {
          catKey: 'business',
          name: 'Business & Trade',
          children: ['Business Registration', 'Economic Development', 'Trade', 'Small Business Support']
        },
        {
          catKey: 'housing',
          name: 'Housing & Urban Development',
          children: ['Housing Programs', 'Property Assessment', 'Rental Assistance', 'Homeownership']
        },
        {
          catKey: 'environment',
          name: 'Utilities & Environment',
          children: ['Natural Resources', 'Environmental Protection', 'Parks & Recreation', 'Wildlife']
        },
        {
          catKey: 'culture',
          name: 'Culture & Recreation',
          children: ['Arts & Culture', 'Heritage', 'Sports & Recreation', 'Tourism']
        },
        {
          catKey: 'immigration',
          name: 'Immigration & Citizenship',
          children: ['Immigration Services', 'Citizenship Applications', 'Visas', 'Refugee Programs']
        },
        {
          catKey: 'social',
          name: 'Social Security & Pensions',
          children: ['Retirement Benefits', 'Pension Fund Management', 'Survivor Benefits', 'Disability Pensions']
        }
      ];
      
      console.log(`Initializing ${defaultCategories.length} categories with auto-generated keys`);
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