require('dotenv').config();
const { Database, aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

class ServiceCategoryService {
  constructor() {
    logger.info('ServiceCategoryService constructor called');
    this.db = null;
    this.serviceCategories = null;
    this.services = null;
    this.categoryServices = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      logger.debug('ServiceCategoryService already initialized, skipping');
      return;
    }
    try {
      this.db = await dbService.getConnection('default');
      this.serviceCategories = this.db.collection('serviceCategories');
      this.services = this.db.collection('services');
      this.categoryServices = this.db.collection('categoryServices');
      this.initialized = true;
      logger.info('ServiceCategoryService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing ServiceCategoryService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Create or update service categories from the tree panel component
   * @param {Array} categories - Array of category objects
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} The created/updated categories
   */
  async upsertCategories(categories, locale = 'en') {
    try {
      logger.info(`Upserting ${categories.length} categories for locale ${locale}`);
      const results = [];
      const nameField = `name${locale.toUpperCase()}`;

      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        logger.info(`Processing category ${i + 1}/${categories.length}: ${category.name}`);
        
        // Skip invalid categories
        if (!category || typeof category !== 'object') {
          logger.warn(`Skipping invalid category at index ${i}`);
          continue;
        }
        
        // Prepare category document, omitting _key to let ArangoDB generate it
        const categoryDoc = {
          catCode: category.catKey || `cat${i + 1}`,
          order: i + 1
        };
        
        // Set the locale-specific name
        categoryDoc[nameField] = category.name || `Category ${i + 1}`;
        
        logger.info(`Creating category with name: ${categoryDoc[nameField]}`);
        try {
          const newCategory = await this.serviceCategories.save(categoryDoc);
          results.push(newCategory);
          logger.info(`Category created successfully with key: ${newCategory._key}`);
          
          // Handle children (services)
          if (category.children && Array.isArray(category.children)) {
            logger.info(`Processing ${category.children.length} services for category ${newCategory._key}`);
            
            try {
              await this.upsertServices(newCategory._key, category.children, locale);
              logger.info(`Services processed successfully for category ${newCategory._key}`);
            } catch (servicesError) {
              logger.error(`Error processing services for category ${newCategory._key}: ${servicesError.message}`, { stack: servicesError.stack });
            }
          } else {
            logger.info(`No services to process for category ${newCategory._key}`);
          }
        } catch (categoryError) {
          logger.error(`Error creating category ${category.name}: ${categoryError.message}`, { stack: categoryError.stack });
        }
      }
      
      logger.info(`Categories upserted successfully: ${results.length}/${categories.length} categories processed`);
      return results;
    } catch (error) {
      logger.error(`Error upserting categories: ${error.message}`, { stack: error.stack });
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
      logger.info(`Starting upsertServices for category ${categoryKey} with ${services.length} services`);
      const results = [];
      const nameField = `name${locale.toUpperCase()}`;
      
      if (!categoryKey) {
        logger.error('Invalid category key provided');
        return [];
      }
      
      if (!Array.isArray(services)) {
        logger.error(`Invalid services array: ${JSON.stringify(services)}`);
        return [];
      }
      
      for (let i = 0; i < services.length; i++) {
        const serviceName = String(services[i] || '').trim();
        if (!serviceName) {
          logger.warn(`Skipping empty service at index ${i}`);
          continue;
        }
        
        logger.info(`Processing service ${i + 1}/${services.length}: "${serviceName}"`);
        
        try {
          const serviceDoc = {
            serviceCode: `service_${i + 1}`,
            categoryId: categoryKey,
            order: i + 1
          };
          
          serviceDoc[nameField] = serviceName;
          
          logger.info(`Creating service: ${serviceName}`);
          const newService = await this.services.save(serviceDoc);
          results.push(newService);
          logger.info(`Service created successfully: "${serviceName}" with key ${newService._key}`);
          
          const edgeDoc = {
            _from: `serviceCategories/${categoryKey}`,
            _to: `services/${newService._key}`,
            order: i + 1
          };
          
          logger.info(`Creating edge for service "${serviceName}"`);
          await this.categoryServices.save(edgeDoc);
          logger.info(`Edge created successfully for service "${serviceName}"`);
        } catch (createError) {
          logger.error(`Error creating service "${serviceName}": ${createError.message}`, { stack: createError.stack });
        }
      }
      
      logger.info(`Services processed successfully for category ${categoryKey}: ${results.length}/${services.length} services`);
      return results;
    } catch (error) {
      logger.error(`Error upserting services for category ${categoryKey}: ${error.message}`, { stack: error.stack });
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
      logger.info(`Checking if category ${categoryKey} exists`);
      if (!categoryKey) {
        logger.warn('Invalid category key provided');
        return false;
      }
      
      await this.serviceCategories.document(categoryKey);
      logger.info(`Category existence check successful: ${categoryKey} exists`);
      return true;
    } catch (error) {
      if (error.code === 404) {
        logger.info(`Category existence check: ${categoryKey} does not exist`);
        return false;
      }
      logger.error(`Error checking if category ${categoryKey} exists: ${error.message}`, { stack: error.stack });
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
      logger.info(`Fetching all categories with services for locale ${locale}`);
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
      const categories = await cursor.all();
      logger.info(`Categories with services retrieved successfully: ${categories.length} categories`);
      return categories;
    } catch (error) {
      logger.error(`Error getting all categories with services: ${error.message}`, { stack: error.stack });
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
      logger.info(`Fetching category ${categoryKey} with services for locale ${locale}`);
      if (!categoryKey) {
        logger.warn('Invalid category key provided');
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
        logger.warn(`Category ${categoryKey} not found`);
        throw new Error(`Category ${categoryKey} not found`);
      }
      
      logger.info(`Category with services retrieved successfully: ${categoryKey}`);
      return result;
    } catch (error) {
      logger.error(`Error getting category ${categoryKey} with services: ${error.message}`, { stack: error.stack });
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
      logger.info(`Deleting category ${categoryKey}`);
      if (!categoryKey) {
        logger.warn('Invalid category key provided');
        throw new Error('Invalid category key');
      }
      
      await this.db.query(aql`
        FOR edge IN categoryServices
          FILTER edge._from == ${`serviceCategories/${categoryKey}`}
          LET service = DOCUMENT(edge._to)
          REMOVE edge IN categoryServices
          REMOVE service IN services
      `);
      logger.info(`Services and edges deleted successfully for category ${categoryKey}`);
      
      const result = await this.serviceCategories.remove(categoryKey);
      logger.info(`Category deleted successfully: ${categoryKey}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting category ${categoryKey}: ${error.message}`, { stack: error.stack });
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
      logger.info(`Searching categories and services for query "${searchQuery}" in locale ${locale}`);
      if (!searchQuery) {
        logger.info('No search query provided, returning empty results');
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
      const result = await cursor.next();
      logger.info(`Search completed successfully: ${result.categories.length} categories, ${result.services.length} services matching query`);
      return result;
    } catch (error) {
      logger.error(`Error searching categories and services for "${searchQuery}": ${error.message}`, { stack: error.stack });
      return { categories: [], services: [] };
    }
  }
  
  /**
   * Initialize default categories and services for a new system
   * @returns {Promise<Object>} Initialization result
   */
  async initializeDefaultCategoriesAndServices() {
    try {
      logger.info('Starting initialization of default categories and services');
      
      let count = 0;
      try {
        const existingCategories = await this.db.query(aql`
          FOR category IN serviceCategories
            COLLECT WITH COUNT INTO count
            RETURN count
        `);
        
        count = await existingCategories.next();
        logger.info(`Found ${count} existing categories`);
        
        if (count > 0) {
          logger.info('Categories already exist, skipping initialization');
          return { message: 'Categories already initialized', count };
        }
      } catch (countError) {
        logger.error(`Error counting existing categories: ${countError.message}`, { stack: countError.stack });
      }
      
      const defaultCategories = [
        {
          catKey: 'identity',
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
      
      logger.info(`Initializing ${defaultCategories.length} default categories`);
      const result = await this.upsertCategories(defaultCategories, 'en');
      
      logger.info(`Default categories and services initialized successfully: ${result.length} categories created`);
      return { 
        message: 'Successfully initialized categories and services',
        categoriesCreated: result.length
      };
    } catch (error) {
      logger.error(`Error initializing default categories and services: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
}

// Singleton instance
const instance = new ServiceCategoryService();
module.exports = instance;