// src/services/index.js - Export all services
import userProfileService from './userProfileService';
import serviceTreeService, { DOCUMENT_METATAGS_CAT_KEY } from './serviceTreeService';
import chatbotService from './chatbotService';
import fileService from './fileService';
import analyticsService from './analyticsService';

// Export individual services
export {
  userProfileService,
  serviceTreeService,
  chatbotService,
  fileService,
  analyticsService,
  DOCUMENT_METATAGS_CAT_KEY
};

// Export as a single services object
export default {
  userProfile: userProfileService,
  serviceTree: serviceTreeService,
  chatbot: chatbotService,
  file: fileService,
  analytics: analyticsService
};
