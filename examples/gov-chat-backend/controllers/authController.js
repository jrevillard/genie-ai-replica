const authService = require('../services/auth-service');
const { createLogger, format, transports } = require('winston'); // Import Winston

// Set up Winston logger (consistent with other files)
const logFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ],
});

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

      // Validate required fields
      if (!userData.loginName || !userData.email || !userData.encPassword) {
        logger.warn('Missing required fields: loginName, email, and encPassword are required');
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: loginName, email, and encPassword are required'
        });
      }

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
      logger.error('Registration error:', error);

      // Handle specific errors
      if (error.message.includes('already exists')) {
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
      logger.error('Login error:', error);

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
      logger.error('Logout error:', error);
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
      
      if (!token) {
        logger.warn('Token is required for email verification');
        return res.status(400).send(`
          <html>
            <head><meta http-equiv="refresh" content="0; URL='http://localhost:8090/login?error=noToken'" /></head>
            <body>Redirecting...</body>
          </html>
        `);
      }
      
      const result = await authService.verifyEmail(token);
      
      if (result.success) {
        logger.info('Email verified successfully');
        return res.status(200).send(`
          <html>
            <head><meta http-equiv="refresh" content="0; URL='http://localhost:8090/login?verified=true'" /></head>
            <body>Email verified successfully! Redirecting...</body>
          </html>
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
          <html>
            <head><meta http-equiv="refresh" content="0; URL='http://localhost:8090/login?verified=false&error=${errorType}'" /></head>
            <body>Verification failed. Redirecting...</body>
          </html>
        `);
      }
    } catch (error) {
      logger.error('Email verification error:', error);
      return res.status(500).send(`
        <html>
          <head><meta http-equiv="refresh" content="0; URL='http://localhost:8090/login?verified=false&error=unknown'" /></head>
          <body>An error occurred. Redirecting...</body>
        </html>
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

      if (!email) {
        logger.warn('Email is required for resending verification email');
        return res.status(400).json({ success: false, message: 'Email is required' });
      }

      const result = await authService.resendVerificationEmail(email);
      logger.info(`Verification email resent successfully for email: ${email}`);
      res.json(result);
    } catch (error) {
      logger.error('Resend verification email error:', error);

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

      if (!email) {
        logger.warn('Email is required for password reset initiation');
        return res.status(400).json({ success: false, message: 'Email is required' });
      }

      const result = await authService.initiatePasswordReset(email);
      logger.info(`Password reset initiated successfully for email: ${email}`);
      res.json(result);
    } catch (error) {
      logger.error('Password reset initiation error:', error);

      // For security, don't reveal specific errors
      res.status(500).json({
        success: false,
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
      logger.error('Token validation error:', error);
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
      logger.error('Password reset error:', error);
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
      logger.error('Password change error:', error);

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
      logger.error('Get current user error:', error);
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
      logger.error('Cleanup expired tokens error:', error);
      res.status(500).json({ success: false, message: 'Failed to clean up expired tokens' });
    }
  }
}

module.exports = new AuthController();