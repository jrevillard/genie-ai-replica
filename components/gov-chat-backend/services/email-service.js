require('dotenv').config();
const nodemailer = require('nodemailer');
//const { logger } = require('../logger'); // Import logger from logger.js
const { logger } = require('shared-lib');

// Add debug flag - can be controlled via environment variable
const DEBUG = process.env.DEBUG_EMAIL !== 'false';

class EmailService {
  constructor() {
    // Validate required environment variables
    const requiredEnvVars = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_FROM'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingEnvVars.length > 0) {
      logger.warn('EmailService.missing_environment_variables', { missing: missingEnvVars });
    }

    // Log initialization details if DEBUG is enabled
    if (DEBUG) {
      logger.debug('EmailService.initializing', {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: process.env.EMAIL_SECURE === 'true',
        fromEmail: process.env.EMAIL_FROM,
        appName: process.env.APP_NAME,
        defaultFrontendUrl: process.env.FRONTEND_URL
      });
    }

    // Create a transporter with email provider settings
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'in-V3.mailjet.com',
      port: process.env.EMAIL_PORT || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    // Sender email address
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@huduma.com';

    // App name for email templates
    this.appName = process.env.APP_NAME || 'Huduma AI';

    // Default frontend URL for links in emails
    this.defaultFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:8090';

    // Test SMTP connection at startup
    this.verifyConnection();

    logger.info('EmailService.initialized');
  }

  /**
   * Verify SMTP connection is working
   */
  async verifyConnection() {
    const startTime = Date.now();
    try {
      if (DEBUG) {
        logger.debug('EmailService.verify_smtp_connection_start');
      }

      await this.transporter.verify();

      logger.info('EmailService.smtp_connection_verified', {
        durationMs: Date.now() - startTime
      });
    } catch (error) {
      logger.error('EmailService.smtp_connection_failed', {
        error: error.message,
        code: error.code,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });

      // Provide specific guidance for common errors
      if (error.code === 'EAUTH') {
        logger.error('EmailService.smtp_authentication_failed', {
          message: 'Check EMAIL_USER and EMAIL_PASSWORD in .env file.'
        });
      } else if (error.code === 'ESOCKET') {
        logger.error('EmailService.smtp_connection_error', {
          message: 'Check host, port, and firewall settings.'
        });
      } else if (error.code === 'ETIMEDOUT') {
        logger.error('EmailService.smtp_timeout_error', {
          message: 'SMTP server might be down or blocked.'
        });
      }

      if (DEBUG) {
        logger.debug('EmailService.smtp_connection_error_details', {
          error: error.message,
          code: error.code,
          response: error.response
        });
      }
    }
  }

  /**
   * Send a password reset email
   * @param {string} email - Recipient email
   * @param {string} token - Password reset token
   * @param {string} userName - User's name
   * @param {string} frontendUrl - Frontend URL for UI links
   * @returns {Promise<Object>} Send result
   */
  async sendPasswordResetEmail(email, token, userName, frontendUrl) {
    const startTime = Date.now();
    if (DEBUG) {
      logger.debug('EmailService.send_password_reset_email_start', {
        to: email,
        token: token ? `${token.substring(0, 10)}...` : 'undefined',
        userName,
        frontendUrl: frontendUrl || this.defaultFrontendUrl
      });
    }

    // Use provided frontend URL or fall back to default
    const baseUrl = frontendUrl || this.defaultFrontendUrl;
    const resetLink = `${baseUrl}/reset-password/${token}`;

    // Email content
    const mailOptions = {
      from: `"${this.appName}" <${this.fromEmail}>`,
      to: email,
      subject: `Password Reset Request - ${this.appName}`,
      text: `
Hello ${userName || ''},

You recently requested to reset your password for your ${this.appName} account. 
Use the following token to complete the process:

${token}

Alternatively, you can directly visit:
${resetLink}

This token is only valid for the next 5 minutes.

If you did not request a password reset, please ignore this email or contact support if you have concerns.

Thank you,
The ${this.appName} Team
      `,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4E97D1; color: white; padding: 10px 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .token { font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; padding: 10px; background-color: #eee; }
    .button { display: inline-block; padding: 10px 20px; background-color: #4E97D1; color: white; text-decoration: none; border-radius: 5px; }
    .footer { font-size: 12px; color: #999; text-align: center; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${this.appName}</h2>
    </div>
    <div class="content">
      <p>Hello ${userName || ''},</p>
      <p>You recently requested to reset your password for your ${this.appName} account. Use the following token to complete the process:</p>
      <div class="token">${token}</div>
      <p>Alternatively, you can click the button below:</p>
      <p style="text-align: center;">
        <a href="${resetLink}" class="button">Reset Password</a>
      </p>
      <p>This token is only valid for the next 5 minutes.</p>
      <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
    </div>
    <div class="footer">
      <p>Thank you,<br>The ${this.appName} Team</p>
    </div>
  </div>
</body>
</html>
      `
    };

    if (DEBUG) {
      logger.debug('EmailService.password_reset_email_content', {
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        textPreview: mailOptions.text.substring(0, 100) + '...'
      });
    }

    // Send email
    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info('EmailService.password_reset_email_sent', {
        to: email,
        messageId: info.messageId,
        durationMs: Date.now() - startTime
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('EmailService.password_reset_email_failed', {
        to: email,
        error: error.message,
        code: error.code,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });

      if (error.code === 'EAUTH') {
        logger.error('EmailService.smtp_authentication_failed', {
          message: 'Check EMAIL_USER and EMAIL_PASSWORD in .env file.'
        });
      } else if (error.code === 'ESOCKET') {
        logger.error('EmailService.smtp_connection_error', {
          message: 'Check host, port, and firewall settings.'
        });
      } else if (error.code === 'ETIMEDOUT') {
        logger.error('EmailService.smtp_timeout_error', {
          message: 'SMTP server might be down or blocked.'
        });
      }

      if (DEBUG) {
        logger.debug('EmailService.password_reset_email_error_details', {
          error: error.message,
          code: error.code,
          response: error.response,
          responseCode: error.responseCode
        });
      }

      throw error;
    }
  }

  /**
   * Send an email verification email
   * @param {string} email - Recipient email
   * @param {string} token - Verification token
   * @param {string} userName - User's name
   * @param {string} frontendUrl - Frontend URL for UI links
   * @param {string} verificationUrl - The complete verification URL to use (back-end endpoint)
   * @returns {Promise<Object>} Send result
   */
  async sendVerificationEmail(email, token, userName, frontendUrl, verificationUrl) {
    const startTime = Date.now();
    if (!email) {
      logger.error('EmailService.verification_email_missing_recipient', {
        token: token ? `${token.substring(0, 10)}...` : 'undefined',
        userName: userName || 'undefined',
        frontendUrl: frontendUrl || 'undefined',
        verificationUrl: verificationUrl || 'undefined'
      });
      throw new Error('Email recipient is required');
    }

    if (DEBUG) {
      logger.debug('EmailService.send_verification_email_start', {
        to: email,
        token: token ? `${token.substring(0, 10)}...` : 'undefined',
        userName,
        frontendUrl: frontendUrl || this.defaultFrontendUrl,
        verificationUrl: verificationUrl || 'not provided'
      });
    }

    // Use provided frontend URL or fall back to default
    const baseUrl = frontendUrl || this.defaultFrontendUrl;
    const verificationLink = verificationUrl || `${baseUrl}/api/auth/verify-email/${token}`;

    // Email content
    const mailOptions = {
      from: `"${this.appName}" <${this.fromEmail}>`,
      to: email,
      subject: `Verify Your Email - ${this.appName}`,
      text: `
Hello ${userName || ''},

Thank you for registering with ${this.appName}. 
Please verify your email address by using the following token:

${token}

Alternatively, you can directly visit:
${verificationLink}

This link will expire in 24 hours.

Thank you,
The ${this.appName} Team
      `,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4E97D1; color: white; padding: 10px 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .token { font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; padding: 10px; background-color: #eee; }
    .button { display: inline-block; padding: 10px 20px; background-color: #4E97D1; color: white; text-decoration: none; border-radius: 5px; }
    .footer { font-size: 12px; color: #999; text-align: center; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${this.appName}</h2>
    </div>
    <div class="content">
      <p>Hello ${userName || ''},</p>
      <p>Thank you for registering with ${this.appName}. Please verify your email address by using the following token:</p>
      <div class="token">${token}</div>
      <p>Alternatively, you can click the button below:</p>
      <p style="text-align: center;">
        <a href="${verificationLink}" class="button">Verify Email</a>
      </p>
      <p>This link will expire in 24 hours.</p>
    </div>
    <div class="footer">
      <p>Thank you,<br>The ${this.appName} Team</p>
    </div>
  </div>
</body>
</html>
      `
    };

    if (DEBUG) {
      logger.debug('EmailService.verification_email_content', {
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        textPreview: mailOptions.text.substring(0, 100) + '...'
      });
    }

    // Send email
    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info('EmailService.verification_email_sent', {
        to: email,
        messageId: info.messageId,
        durationMs: Date.now() - startTime
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('EmailService.verification_email_failed', {
        to: email,
        error: error.message,
        code: error.code,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });

      if (error.code === 'EAUTH') {
        logger.error('EmailService.smtp_authentication_failed', {
          message: 'Check EMAIL_USER and EMAIL_PASSWORD in .env file.'
        });
      } else if (error.code === 'ESOCKET') {
        logger.error('EmailService.smtp_connection_error', {
          message: 'Check host, port, and firewall settings.'
        });
      } else if (error.code === 'ETIMEDOUT') {
        logger.error('EmailService.smtp_timeout_error', {
          message: 'SMTP server might be down or blocked.'
        });
      }

      if (DEBUG) {
        logger.debug('EmailService.verification_email_error_details', {
          error: error.message,
          code: error.code,
          response: error.response,
          responseCode: error.responseCode
        });
      }

      throw error;
    }
  }
}

// Export a singleton instance
module.exports = new EmailService();