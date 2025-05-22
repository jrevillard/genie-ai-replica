// Entry point for shared-lib
// This file re-exports selected shared modules.

import logger from './logger.js';

export { logger };

// To add a new module, import and export it like this:
// import auth from './auth.js';
// export { logger, auth };

