// src/services/serviceTreeService.js - Connect ServiceTreePanelComponent to backend
import httpService from './httpService';

export default {
  /**
   * Fetch all service categories with their services
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise} Categories with services
   */
  async getAllCategories(locale = 'en') {
    try {
      const response = await httpService.get('services/categories', {
        params: { locale }
      });
      
      // Transform the response to match the expected format for the tree panel
      return this.transformCategoriesToTreeNodes(response.data, locale);
    } catch (error) {
      console.error('Error fetching service categories:', error);
      // Return fallback data structure in case of error
      return this.getFallbackCategories(locale);
    }
  },

  /**
   * Transform backend categories to tree panel format
   * @param {Array} categories - Categories from backend
   * @param {String} locale - Locale code
   * @returns {Array} Transformed nodes for tree panel
   */
  transformCategoriesToTreeNodes(categories, locale) {
    return categories.map(category => ({
      catKey: category.catKey,
      name: category.name,  // Preserve the name property!
      expanded: false,
      children: category.children || []
    }));
  },

  /**
   * Get services for a specific category
   * @param {String} categoryId - Category ID
   * @param {String} locale - Locale code
   * @returns {Promise} Category with services
   */
  async getCategoryServices(categoryId, locale = 'en') {
    try {
      const response = await httpService.get(`services/categories/${categoryId}`, {
        params: { locale }
      });
      
      return response.data.children || [];
    } catch (error) {
      console.error(`Error fetching services for category ${categoryId}:`, error);
      throw error;
    }
  },

  /**
   * Search for categories and services
   * @param {String} query - Search query
   * @param {String} locale - Locale code
   * @returns {Promise} Search results
   */
  async searchServices(query, locale = 'en') {
    try {
      const response = await httpService.get('services/search', {
        params: { query, locale }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error searching services:', error);
      return { categories: [], services: [] };
    }
  },

  /**
   * Get fallback categories in case of API failure
   * @param {String} locale - Locale code
   * @returns {Array} Fallback categories
   */
  getFallbackCategories(locale = 'en') {
    // These match the fallback data in ServiceTreePanelComponent
    const fallbackData = {
      en: [
        { catKey: 'cat1', expanded: false },
        { catKey: 'cat2', expanded: false },
        { catKey: 'cat3', expanded: false },
        { catKey: 'cat4', expanded: false },
        { catKey: 'cat5', expanded: false },
        { catKey: 'cat6', expanded: false },
        { catKey: 'cat7', expanded: false },
        { catKey: 'cat8', expanded: false },
        { catKey: 'cat9', expanded: false },
        { catKey: 'cat10', expanded: false },
        { catKey: 'cat11', expanded: false },
        { catKey: 'cat12', expanded: false }
      ],
      fr: [
        { catKey: 'cat1', expanded: false },
        { catKey: 'cat2', expanded: false },
        { catKey: 'cat3', expanded: false },
        { catKey: 'cat4', expanded: false },
        { catKey: 'cat5', expanded: false },
        { catKey: 'cat6', expanded: false },
        { catKey: 'cat7', expanded: false },
        { catKey: 'cat8', expanded: false },
        { catKey: 'cat9', expanded: false },
        { catKey: 'cat10', expanded: false },
        { catKey: 'cat11', expanded: false },
        { catKey: 'cat12', expanded: false }
      ],
      sw: [
        { catKey: 'cat1', expanded: false },
        { catKey: 'cat2', expanded: false },
        { catKey: 'cat3', expanded: false },
        { catKey: 'cat4', expanded: false },
        { catKey: 'cat5', expanded: false },
        { catKey: 'cat6', expanded: false },
        { catKey: 'cat7', expanded: false },
        { catKey: 'cat8', expanded: false },
        { catKey: 'cat9', expanded: false },
        { catKey: 'cat10', expanded: false },
        { catKey: 'cat11', expanded: false },
        { catKey: 'cat12', expanded: false }
      ]
    };
    
    return fallbackData[locale] || fallbackData.en;
  },

  /**
   * Save selected services to user preferences
   * @param {String} userId - User ID
   * @param {Array} selectedServices - Selected services
   * @returns {Promise} Save result
   */
  async saveSelectedServices(userId, selectedServices) {
    try {
      const response = await httpService.post(`users/${userId}/preferences/services`, {
        selectedServices
      });
      
      return response.data;
    } catch (error) {
      console.error('Error saving selected services:', error);
      throw error;
    }
  },

  /**
   * Get user's selected services
   * @param {String} userId - User ID
   * @returns {Promise} User's selected services
   */
  async getUserSelectedServices(userId) {
    try {
      const response = await httpService.get(`users/${userId}/preferences/services`);
      return response.data.selectedServices || [];
    } catch (error) {
      console.error('Error getting user selected services:', error);
      return [];
    }
  }
};