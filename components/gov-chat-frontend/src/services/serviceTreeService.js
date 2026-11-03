// src/services/serviceTreeService.js - Connect ServiceTreePanelComponent to backend
import httpService from './httpService';

// Both hierarchy fetches are BOUNDED: a request that never answers left the
// hierarchy 'loading' forever — the grid hidden, the spinner turning, the
// await unresolved, no error anywhere. A timeout turns it into the visible
// FAILED state the callers describe.
//
// The timeout goes in the THIRD argument of httpService.get — its axios
// options. The second argument is the query: it reads `params` from it and
// sends the rest as query parameters, so a timeout placed there is dropped
// on the floor and axios waits forever. The bound only exists if axios
// actually receives it.
const TREE_FETCH_TIMEOUT_MS = 15000;

/**
 * Converts a payload carrying translation rows in the read shape
 * ({lang, text} — what the GET endpoints return and the forms hold) into
 * the write contract ({languageCode, translation}) expected by the
 * create/update endpoints.
 *
 * A payload without a translations array is returned untouched: the backend
 * treats an omitted field as "leave the existing translations untouched" and
 * an empty array as clear-all. A row in any other shape is rejected by the
 * backend with a 400 naming the keys it received.
 * @param {Object} payload - { nameEN, translations: [{lang, text}] }.
 * @returns {Object} The wire payload with {languageCode, translation} rows.
 */
function toWritePayload(payload) {
  if (!Array.isArray(payload.translations)) {
    return payload;
  }
  return {
    ...payload,
    translations: payload.translations.filter(Boolean).map(({ lang, text }) => ({
      languageCode: lang,
      translation: text
    }))
  };
}

export default {
  /**
   * For the MAIN application sidebar.
   * Fetches all categories with their services.
   *
   * Every category and every child service carries BOTH spellings: `name`
   * (the display name — the localized translation, or the ENGLISH one when
   * the locale has no translation) and `nameEN` (the English name — the
   * English translation row, or the entity document's own `nameEN` when
   * there is no row; the SSOT the filter wire speaks, the localized name
   * never filters).
   *
   * @param {String} locale - Locale code (e.g., 'en')
   * @returns {Promise} Categories with their services.
   */
  async getAllCategories(locale = 'en') {
    try {
      // This points to the PUBLIC endpoint that returns simple data
      const response = await httpService.get(
        'services/categories',
        { params: { locale } },
        { timeout: TREE_FETCH_TIMEOUT_MS }
      );
      // The hierarchy is a LIST of categories. A body that is not one is a
      // broken answer (a proxy error page, an object), and a client that
      // walks it throws mid-render — the chat panel goes blank. It is a
      // FAILED load, not a hierarchy: the mobile casts the body the same
      // way and ends up in the same state.
      if (!Array.isArray(response.data)) {
        throw new Error('The knowledge hierarchy is not a list of categories');
      }
      return response.data;
    } catch (error) {
      console.error('Error fetching service categories:', error);
      throw error;
    }
  },

  /**
   * For the ADMIN dashboard ONLY.
   * Fetches all categories with a detailed array of service objects
   * ({_key, name, nameEN}).
   *
   * Every category and every child service carries BOTH spellings: `name`
   * (the LOCALIZED translation — the admin tree does NOT fall back to the
   * English name: the admin panel keys its label map by this one) and
   * `nameEN` (the English name — the English translation row, or the entity
   * document's own `nameEN` when there is no row; the SSOT the filter wire
   * speaks, the localized name never filters).
   *
   * @param {String} locale - Locale code (e.g., 'en')
   * @returns {Promise} Categories with detailed service objects.
   */
  async getAdminCategories(locale = 'en') {
    try {
      // This points to the ADMIN endpoint that returns detailed data
      const response = await httpService.get(
        'service-categories/categories/detailed',
        { params: { locale } },
        { timeout: TREE_FETCH_TIMEOUT_MS }
      );
      // The hierarchy is a LIST of categories — the same contract as the
      // public sibling. A body that is not one is a broken answer (a proxy
      // error page, an object), and a client that walks it throws
      // mid-render: it is a FAILED load, not a hierarchy.
      if (!Array.isArray(response.data)) {
        throw new Error('The knowledge hierarchy is not a list of categories');
      }
      return response.data;
    } catch (error) {
      console.error('Error fetching admin service categories:', error);
      throw error;
    }
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
   * Get all translations for a specific category
   * @param {String} categoryId - The ID of the category
   * @returns {Promise<Array>} A list of translation objects [{lang, text}]
   */
  async getCategoryTranslations(categoryId) {
    try {
      // This endpoint matches the one created in service-category-routes.js.
      // Bounded like every fetch in this file: a request that never answers
      // would leave the edit form 'loading' forever, Save disabled with it.
      const response = await httpService.get(
        `service-categories/${categoryId}/translations`,
        {},
        { timeout: TREE_FETCH_TIMEOUT_MS }
      );
      return response.data || [];
    } catch (error) {
      // A FAILED load must surface as a rejection, never as []: an empty
      // array would render an editable empty-rows form and the next save
      // would wipe every existing translation (the caller treats [] as
      // clear-all). The edit form catches the rejection and blocks the save.
      console.error(`Error fetching translations for category ${categoryId}:`, error);
      throw error;
    }
  },

  /**
   * Get all translations for a specific service
   * @param {String} serviceId - The ID of the service
   * @returns {Promise<Array>} A list of translation objects [{lang, text}]
   */
  async getServiceTranslations(serviceId) {
    try {
      // This endpoint matches the one created in service-category-routes.js.
      // Bounded like every fetch in this file.
      const response = await httpService.get(
        `service-categories/services/${serviceId}/translations`,
        {},
        { timeout: TREE_FETCH_TIMEOUT_MS }
      );
      return response.data || [];
    } catch (error) {
      // Same contract as getCategoryTranslations: a failed load rejects.
      console.error(`Error fetching translations for service ${serviceId}:`, error);
      throw error;
    }
  },

  /**
   * Creates a new category.
   * @param {Object} payload - The category data { nameEN, translations: [{lang, text}] }.
   * @returns {Promise<Object>} The newly created category.
   */
  async createCategory(payload) {
    try {
      // Send the payload directly to our new single-item creation endpoint
      const response = await httpService.post('service-categories', toWritePayload(payload));
      return response.data;
    } catch (error) {
      console.error('Error creating category:', error);
      throw error;
    }
  },

  /**
   * Updates an existing category.
   * @param {String} categoryId - The ID of the category to update.
   * @param {Object} payload - The category data { nameEN, translations: [{lang, text}] }.
   * @returns {Promise<Object>} The updated category.
   */
  async updateCategory(categoryId, payload) {
    try {
      // Assumes a PUT endpoint at /service-categories/:id
      const response = await httpService.put(`service-categories/${categoryId}`, toWritePayload(payload));
      return response.data;
    } catch (error) {
      console.error(`Error updating category ${categoryId}:`, error);
      throw error;
    }
  },

  /**
   * Creates a new service under a category.
   * @param {String} categoryId - The parent category ID.
   * @param {Object} payload - The service data { nameEN, translations: [{lang, text}] }.
   * @returns {Promise<Object>} The newly created service.
   */
  async createService(categoryId, payload) {
    try {
      // Assumes a POST endpoint at /service-categories/:id/services
      const response = await httpService.post(`service-categories/${categoryId}/services`, toWritePayload(payload));
      return response.data;
    } catch (error) {
      console.error(`Error creating service for category ${categoryId}:`, error);
      throw error;
    }
  },

  /**
   * Updates an existing service.
   * @param {String} serviceId - The ID of the service to update.
   * @param {Object} payload - The service data { nameEN, translations: [{lang, text}] }.
   * @returns {Promise<Object>} The updated service.
   */
  async updateService(serviceId, payload) {
    try {
      // Assumes a PUT endpoint at /service-categories/services/:id
      const response = await httpService.put(`service-categories/services/${serviceId}`, toWritePayload(payload));
      return response.data;
    } catch (error) {
      console.error(`Error updating service ${serviceId}:`, error);
      throw error;
    }
  },

  /**
   * Deletes a category.
   * @param {String} categoryId - The ID of the category to delete.
   * @returns {Promise<Object>} The response from the server.
   */
  async deleteCategory(categoryId) {
    try {
      // This endpoint matches the DELETE /:categoryId route in service-category-routes.js
      const response = await httpService.delete(`service-categories/${categoryId}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting category ${categoryId}:`, error);
      throw error; // Re-throw to be caught by the component
    }
  },

  /**
   * Deletes a service.
   * @param {String} serviceId - The ID of the service to delete.
   * @returns {Promise<Object>} The response from the server.
   */
  async deleteService(serviceId) {
    try {
      // This endpoint is based on the previously defined roadmap
      const response = await httpService.delete(`service-categories/services/${serviceId}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting service ${serviceId}:`, error);
      throw error;
    }
  }
};
