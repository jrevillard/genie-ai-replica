const authService = require('../services/auth-service');
//const { logger } = require('../logger'); // Import logger from logger.js
const { logger } = require('shared-lib');

/**
 * Get the frontend URL from environment variable, falling back to request headers
 * if environment variable is not set
 * @param {Object} req - Express request object
 * @returns {string} The frontend URL
 */
function getFrontendUrl(req) {
  // First try to get the URL from environment variable (highest priority)
  const envFrontendUrl = process.env.FRONTEND_URL;

  if (envFrontendUrl) {
    logger.info(`Using environment FRONTEND_URL: ${envFrontendUrl}`);
    return envFrontendUrl;
  }

  // If environment variable is not set, try to get from request headers
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // If we have an origin header, use it
  if (origin) {
    logger.info(`Using Origin header for frontend URL: ${origin}`);
    return origin;
  }

  // If we have a referer, extract the origin part
  if (referer) {
    try {
      const url = new URL(referer);
      const refererOrigin = `${url.protocol}//${url.host}`;
      logger.info(`Using Referer header for frontend URL: ${refererOrigin}`);
      return refererOrigin;
    } catch (error) {
      logger.warn(`Could not parse referer URL: ${referer}`, { stack: error.stack });
    }
  }

  // Last resort fallback (should be the same as in email-service.js)
  const fallbackUrl = 'http://localhost:8090';
  logger.info(`Using fallback URL: ${fallbackUrl}`);
  return fallbackUrl;
}

/**
 * Get the backend URL from the request
 * @param {Object} req - Express request object
 * @returns {string} The backend URL
 */
function getBackendUrl(req) {
  // Extract protocol (http/https)
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;

  // Get host from headers (includes port if specified)
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  const backendUrl = `${protocol}://${host}`;
  logger.info(`Backend URL: ${backendUrl}`);
  return backendUrl;
}

/**
 * Controller for authentication-related endpoints
 */
class AuthController {
  /**
   * User registration
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async register(req, res) {
    try {
      logger.info('Processing user registration');
      const userData = req.body;

      // Get both URLs
      const frontendUrl = getFrontendUrl(req);
      const backendUrl = getBackendUrl(req);

      logger.info(`Frontend URL for registration: ${frontendUrl}`);
      logger.info(`Backend URL for registration: ${backendUrl}`);

      // Validate required fields
      if (!userData.loginName || !userData.email || !userData.encPassword) {
        logger.warn('Missing required fields: loginName, email, and encPassword are required');
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: loginName, email, and encPassword are required'
        });
      }

      // Add both URLs to the registration data
      userData.frontendUrl = frontendUrl;  // For redirects in emails
      userData.backendUrl = backendUrl;    // For API calls in emails

      const result = await authService.register(userData);

      // Return success without accessToken for email verification flow
      const { accessToken, ...userWithoutToken } = result;
      logger.info(`User registration successful for email: ${userData.email}`);
      res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email to verify your account.',
        user: userWithoutToken
      });
    } catch (error) {
      logger.error(`Registration error: ${error.message}`, { stack: error.stack });

      // Handle specific errors
      if (error.message && error.message.includes('already exists')) {
        logger.warn(`Registration failed: ${error.message}`);
        return res.status(409).json({ success: false, message: error.message });
      }

      res.status(500).json({ success: false, message: 'Registration failed' });
    }
  }

  /**
   * User login
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async login(req, res) {
    try {
      logger.info('Processing user login');
      const { loginName, encPassword } = req.body;

      // Validate required fields
      if (!loginName || !encPassword) {
        logger.warn('Missing required fields: loginName and encPassword are required');
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: loginName and encPassword are required'
        });
      }

      const result = await authService.login(loginName, encPassword);
      logger.info(`User login successful for loginName: ${loginName}`);
      res.json(result);
    } catch (error) {
      logger.error(`Login error: ${error.message}`, { stack: error.stack });

      // Handle specific errors
      if (error.message === 'User not found' || error.message === 'Invalid password') {
        logger.warn('Login failed: Invalid credentials');
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      } else if (error.message === 'Email not verified') {
        logger.warn('Login failed: Email not verified');
        return res.status(403).json({
          success: false,
          message: 'Email not verified. Please check your email for verification instructions.',
          requiresVerification: true
        });
      }

      res.status(500).json({ success: false, message: 'Login failed' });
    }
  }

  /**
   * User logout
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async logout(req, res) {
    try {
      logger.info('Processing user logout');
      const userId = req.user.userId;

      if (!userId) {
        logger.warn('User ID is required for logout');
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }

      const result = await authService.logout(userId);
      logger.info(`User logout successful for userId: ${userId}`);
      res.json(result);
    } catch (error) {
      logger.error(`Logout error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  }

  /**
   * Verify email with token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async verifyEmail(req, res) {
    try {
      logger.info('Processing email verification');
      const { token } = req.params;

      // Get frontend URL for redirects
      const frontendUrl = getFrontendUrl(req);
      logger.info(`Frontend URL for verification redirect: ${frontendUrl}`);

      if (!token) {
        logger.warn('Token is required for email verification');
        return res.status(400).send(`
          Redirecting...
        `);
      }

      const result = await authService.verifyEmail(token);

      if (result.success) {
        logger.info('Email verified successfully');
        return res.status(200).send(`
          Email verified successfully! Redirecting...
        `);
      } else {
        let errorType = 'invalid';

        if (result.expired) {
          errorType = 'expired';
          logger.warn('Email verification failed: Token expired');
        } else if (result.used) {
          errorType = 'used';
          logger.warn('Email verification failed: Token already used');
        } else {
          logger.warn('Email verification failed: Invalid token');
        }

        return res.status(400).send(`
          Verification failed. Redirecting...
        `);
      }
    } catch (error) {
      logger.error(`Email verification error: ${error.message}`, { stack: error.stack });

      // Get frontend URL for redirects
      const frontendUrl = getFrontendUrl(req);

      return res.status(500).send(`
        An error occurred. Redirecting...
      `);
    }
  }

  /**
   * Resend verification email
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async resendVerificationEmail(req, res) {
    try {
      logger.info('Processing resend verification email');
      const { email } = req.body;

      // Get both URLs
      const frontendUrl = getFrontendUrl(req);
      const backendUrl = getBackendUrl(req);

      logger.info(`Frontend URL for verification email: ${frontendUrl}`);
      logger.info(`Backend URL for verification email: ${backendUrl}`);

      if (!email) {
        logger.warn('Email is required for resending verification email');
        return res.status(400).json({ success: false, message: 'Email is required' });
      }

      // Pass both URLs to the service
      const result = await authService.resendVerificationEmail(email, frontendUrl, backendUrl);
      logger.info(`Verification email resent successfully for email: ${email}`);
      res.json(result);
    } catch (error) {
      logger.error(`Resend verification email error: ${error.message}`, { stack: error.stack });

      // For security, don't reveal specific errors
      res.status(500).json({
        success: true,
        message: 'If your email exists in our system, a verification email has been sent'
      });
    }
  }

  /**
   * Initiate password reset process
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async initiatePasswordReset(req, res) {
    try {
      logger.info('Initiating password reset');
      const { email } = req.body;

      // Get both URLs
      const frontendUrl = getFrontendUrl(req);
      const backendUrl = getBackendUrl(req);

      logger.info(`Frontend URL for password reset email: ${frontendUrl}`);
      logger.info(`Backend URL for password reset email: ${backendUrl}`);

      if (!email) {
        logger.warn('Email is required for password reset initiation');
        return res.status(400).json({ success: false, message: 'Email is required' });
      }

      // Pass both URLs to the service
      const result = await authService.initiatePasswordReset(email, frontendUrl, backendUrl);
      logger.info(`Password reset initiated successfully for email: ${email}`);
      res.json(result);
    } catch (error) {
      logger.error(`Password reset initiation error: ${error.message}`, { stack: error.stack });

      // For security, don't reveal specific errors
      res.status(500).json({
        success: true,
        message: 'If your email exists in our system, a password reset link has been sent to your email'
      });
    }
  }

  /**
   * Validate a password reset token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async validateResetToken(req, res) {
    try {
      logger.info('Validating password reset token');
      const { token } = req.body;

      if (!token) {
        logger.warn('Token is required for validation');
        return res.status(400).json({ success: false, message: 'Token is required' });
      }

      const result = await authService.validateResetToken(token);

      if (!result.valid) {
        // Different status codes for different validation errors
        if (result.expired) {
          logger.warn('Token validation failed: Token expired');
          return res.status(410).json({ success: false, ...result }); // Gone (410) for expired tokens
        }
        if (result.used) {
          logger.warn('Token validation failed: Token already used');
          return res.status(409).json({ success: false, ...result }); // Conflict (409) for used tokens
        }
        logger.warn('Token validation failed: Invalid token');
        return res.status(400).json({ success: false, ...result }); // Bad Request (400) for invalid tokens
      }

      logger.info('Password reset token validated successfully');
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`Token validation error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Token validation failed' });
    }
  }

  /**
   * Reset password with token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async resetPassword(req, res) {
    try {
      logger.info('Processing password reset with token');
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        logger.warn('Token and newPassword are required for password reset');
        return res.status(400).json({ success: false, message: 'Token and newPassword are required' });
      }

      const result = await authService.resetPassword(token, newPassword);

      if (!result.success) {
        // Different status codes for different errors
        if (result.expired) {
          logger.warn('Password reset failed: Token expired');
          return res.status(410).json({ success: false, ...result }); // Gone (410) for expired tokens
        }
        if (result.used) {
          logger.warn('Password reset failed: Token already used');
          return res.status(409).json({ success: false, ...result }); // Conflict (409) for used tokens
        }
        logger.warn('Password reset failed: Invalid token');
        return res.status(400).json({ success: false, ...result }); // Bad Request (400) for invalid tokens
      }

      logger.info('Password reset successful');
      res.json(result);
    } catch (error) {
      logger.error(`Password reset error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Password reset failed' });
    }
  }

  /**
   * Change password for authenticated user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async changePassword(req, res) {
    try {
      logger.info('Processing password change for authenticated user');
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;

      if (!userId || !currentPassword || !newPassword) {
        logger.warn('User ID, currentPassword, and newPassword are required for password change');
        return res.status(400).json({
          success: false,
          message: 'User ID, currentPassword, and newPassword are required'
        });
      }

      const result = await authService.changePassword(userId, currentPassword, newPassword);
      logger.info(`Password changed successfully for userId: ${userId}`);
      res.json(result);
    } catch (error) {
      logger.error(`Password change error: ${error.message}`, { stack: error.stack });

      // Handle specific errors
      if (error.message === 'Current password is incorrect') {
        logger.warn('Password change failed: Current password is incorrect');
        return res.status(401).json({ success: false, message: error.message });
      }

      res.status(500).json({ success: false, message: 'Password change failed' });
    }
  }

  /**
   * Get current user info
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getCurrentUser(req, res) {
    try {
      logger.info('Fetching current user info');
      const userId = req.user.userId;

      if (!userId) {
        logger.warn('User ID is required to fetch user info');
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }

      const user = await authService.getUserById(userId);

      if (!user) {
        logger.warn(`User not found for userId: ${userId}`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Remove sensitive information
      const { encPassword, ...userWithoutPassword } = user;

      logger.info(`Current user info retrieved successfully for userId: ${userId}`);
      res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
      logger.error(`Get current user error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Failed to retrieve user information' });
    }
  }

  /**
   * Clean up expired tokens (admin endpoint)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async cleanupExpiredTokens(req, res) {
    try {
      logger.info('Cleaning up expired tokens');
      const result = await authService.cleanupExpiredTokens();
      logger.info('Expired tokens cleanup completed successfully');
      res.json(result);
    } catch (error) {
      logger.error(`Cleanup expired tokens error: ${error.message}`, { stack: error.stack });
      res.status(500).json({ success: false, message: 'Failed to clean up expired tokens' });
    }
  }
}

module.exports = new AuthController();