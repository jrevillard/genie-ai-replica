// auth-controller.js
const authService = require('../services/auth-service');

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
      const userData = req.body;
      
      // Validate required fields
      if (!userData.loginName || !userData.email || !userData.encPassword) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required fields: loginName, email, and encPassword are required' 
        });
      }
      
      const result = await authService.register(userData);
      
      // Return success without accessToken for email verification flow
      const { accessToken, ...userWithoutToken } = result;
      res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email to verify your account.',
        user: userWithoutToken
      });
    } catch (error) {
      console.error('Registration error:', error);
      
      // Handle specific errors
      if (error.message.includes('already exists')) {
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
      const { loginName, encPassword } = req.body;
      
      // Validate required fields
      if (!loginName || !encPassword) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required fields: loginName and encPassword are required' 
        });
      }
      
      const result = await authService.login(loginName, encPassword);
      res.json(result);
    } catch (error) {
      console.error('Login error:', error);
      
      // Handle specific errors
      if (error.message === 'User not found' || error.message === 'Invalid password') {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      } else if (error.message === 'Email not verified') {
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
      const userId = req.user.userId;
      
      if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }
      
      const result = await authService.logout(userId);
      res.json(result);
    } catch (error) {
      console.error('Logout error:', error);
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
      const { token } = req.params;
      
      if (!token) {
        return res.redirect('/login?verificationError=noToken');
      }
      
      const result = await authService.verifyEmail(token);
      
      if (result.success) {
        // Redirect to login with success message
        return res.redirect('/login?verified=true');
      } else {
        // Redirect with appropriate error
        let errorType = 'invalid';
        
        if (result.expired) {
          errorType = 'expired';
        } else if (result.used) {
          errorType = 'used';
        }
        
        return res.redirect(`/login?verificationError=${errorType}`);
      }
    } catch (error) {
      console.error('Email verification error:', error);
      res.redirect('/login?verificationError=unknown');
    }
  }

  /**
   * Resend verification email
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async resendVerificationEmail(req, res) {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }
      
      const result = await authService.resendVerificationEmail(email);
      res.json(result);
    } catch (error) {
      console.error('Resend verification email error:', error);
      
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
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }
      
      const result = await authService.initiatePasswordReset(email);
      res.json(result);
    } catch (error) {
      console.error('Password reset initiation error:', error);
      
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
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ success: false, message: 'Token is required' });
      }
      
      const result = await authService.validateResetToken(token);
      
      if (!result.valid) {
        // Different status codes for different validation errors
        if (result.expired) {
          return res.status(410).json({ success: false, ...result }); // Gone (410) for expired tokens
        }
        if (result.used) {
          return res.status(409).json({ success: false, ...result }); // Conflict (409) for used tokens
        }
        return res.status(400).json({ success: false, ...result }); // Bad Request (400) for invalid tokens
      }
      
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Token validation error:', error);
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
      const { token, newPassword } = req.body;
      
      if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Token and newPassword are required' });
      }
      
      const result = await authService.resetPassword(token, newPassword);
      
      if (!result.success) {
        // Different status codes for different errors
        if (result.expired) {
          return res.status(410).json({ success: false, ...result }); // Gone (410) for expired tokens
        }
        if (result.used) {
          return res.status(409).json({ success: false, ...result }); // Conflict (409) for used tokens
        }
        return res.status(400).json({ success: false, ...result }); // Bad Request (400) for invalid tokens
      }
      
      res.json(result);
    } catch (error) {
      console.error('Password reset error:', error);
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
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;
      
      if (!userId || !currentPassword || !newPassword) {
        return res.status(400).json({ 
          success: false, 
          message: 'User ID, currentPassword, and newPassword are required' 
        });
      }
      
      const result = await authService.changePassword(userId, currentPassword, newPassword);
      res.json(result);
    } catch (error) {
      console.error('Password change error:', error);
      
      // Handle specific errors
      if (error.message === 'Current password is incorrect') {
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
      const userId = req.user.userId;
      
      if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required' });
      }
      
      const user = await authService.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      // Remove sensitive information
      const { encPassword, ...userWithoutPassword } = user;
      
      res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
      console.error('Get current user error:', error);
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
      const result = await authService.cleanupExpiredTokens();
      res.json(result);
    } catch (error) {
      console.error('Cleanup expired tokens error:', error);
      res.status(500).json({ success: false, message: 'Failed to clean up expired tokens' });
    }
  }
}

module.exports = new AuthController();