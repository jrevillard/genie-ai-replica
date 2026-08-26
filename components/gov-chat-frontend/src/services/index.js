// src/services/index.js - Export all services
import userProfileService from './userProfileService';
import serviceTreeService from './serviceTreeService';
import chatbotService from './chatbotService';
import fileService from './fileService';
import analyticsService from './analyticsService';
import studioService from './studioService';
import repoOkfService from './repoOkfService';
import conceptService from './conceptService';

// Export individual services
export {
  userProfileService,
  serviceTreeService,
  chatbotService,
  fileService,
  analyticsService,
  studioService,
  repoOkfService,
  conceptService
};

// Export as a single services object
export default {
  userProfile: userProfileService,
  serviceTree: serviceTreeService,
  chatbot: chatbotService,
  file: fileService,
  analytics: analyticsService,
  studio: studioService,
  repoOkf: repoOkfService,
  concept: conceptService
};
