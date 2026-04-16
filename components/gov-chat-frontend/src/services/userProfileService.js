// src/services/userProfileService.js - Connect UserProfileComponent to backend
import httpService from './httpService';

/**
 * Service for managing detailed user profiles
 */
class UserProfileService {
  /**
   * Get user profile by ID
   * @param {String} userId - User ID
   * @returns {Promise} User profile data
   */
  async getProfile(userId) {
    try {
      const response = await httpService.get(`users/${userId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }
  }

  /**
 * Update an existing user profile
 * @param {String} userId - User ID
 * @param {Object} profileData - Updated profile data
 * @returns {Promise} Updated user profile
 */
  async updateProfile(userId, profileData) {
    try {
      console.log(`Updating user profile for ID: ${userId}`);
      console.log('Profile data:', profileData);

      // Check if there are any File objects in the profile data
      const hasFiles = this.checkForFiles(profileData);

      let response;
      if (hasFiles) {
        // Handle file uploads and form data
        const formData = this.prepareFormData(profileData);

        response = await httpService.put(`users/${userId}`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });
      } else {
        // No files, send as JSON
        response = await httpService.put(`users/${userId}`, profileData);
      }

      return response.data;
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  }

  /**
 * Check if the profile data contains any File objects
 * @param {Object} profileData - Profile data to check
 * @returns {Boolean} True if files are present
 */
  checkForFiles(profileData) {
    // Check for File objects in any section
    for (const section in profileData) {
      if (typeof profileData[section] === 'object' && profileData[section] !== null) {
        for (const field in profileData[section]) {
          if (profileData[section][field] instanceof File) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Prepare form data for file uploads
   * @param {Object} profileData - Profile data including files
   * @returns {FormData} Form data for submission
   */
  prepareFormData(profileData) {
    const formData = new FormData();
    
    // Clone the profile data to avoid modifying the original
    const dataToSend = JSON.parse(JSON.stringify(profileData));
    
    // Process each section that might have file uploads
    const sectionsWithFiles = [
      'personalIdentification',
      'civilRegistration',
      'addressResidency',
      'identityTravel',
      'healthMedical',
      'employment',
      'financialTax',
      'criminalLegal',
      'transportation'
    ];
    
    // Extract files and append them to form data
    sectionsWithFiles.forEach(section => {
      if (!dataToSend[section]) return;
      
      Object.keys(dataToSend[section]).forEach(field => {
        const value = dataToSend[section][field];
        
        // Check if it's a File object
        if (value instanceof File) {
          formData.append(`${section}-${field}`, value);
          // Remove the file from the data object
          delete dataToSend[section][field];
        }
      });
    });
    
    // Append the non-file data as JSON
    formData.append('data', JSON.stringify(dataToSend));
    
    return formData;
  }

}


export default new UserProfileService();