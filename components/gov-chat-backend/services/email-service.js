require('dotenv').config();
const nodemailer = require('nodemailer');
const { URL } = require('url'); // Added
const { logger } = require('../shared-lib');

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
      logger.debug('EMAIL_HOST:' + process.env.EMAIL_HOST);
      logger.debug('EMAIL_PORT:' + process.env.EMAIL_PORT);
      logger.debug('EMAIL_SECURE:' + process.env.EMAIL_SECURE);
      logger.debug('EMAIL_USER:' + process.env.EMAIL_USER);
      logger.debug('EMAIL_PASSWORD:' + (process.env.EMAIL_PASSWORD ? '[REDACTED]' : 'undefined')); // Modified
    }

    // Create a transporter with email provider settings
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'in-V3.mailjet.com',
      port: parseInt(process.env.EMAIL_PORT) || 587, // Modified
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    // Sender email address
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@hud.email';

    // App name for email templates
    this.appName = process.env.APP_NAME || 'Huduma AI';

    // Default frontend URL for links, normalized
    this.defaultFrontendUrl = this.normalizeBaseUrl(process.env.FRONTEND_URL || 'http://localhost:8080'); // Modified

    // Test SMTP connection at startup
    this.verifyConnection();

    logger.info('EmailService.initialized');
  }

  /**
   * Normalize a base URL to remove trailing slashes and ensure proper format
   * @param {string} url - The URL to normalize
   * @returns {string} - Normalized URL
   */
  normalizeBaseUrl(url) { // Added
    try {
      const parsedUrl = new URL(url);
      parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
      return parsedUrl.toString();
    } catch (error) {
      logger.error('EmailService.invalid_base_url', {
        url,
        error: error.message
      });
      return 'http://localhost:8080';
    }
  }

  /**
   * Build a clean URL by combining base URL and path
   * @param {string} baseUrl - Base URL
   * @param {string} path - Path to append
   * @returns {string} - Clean, normalized URL
   */
  buildUrl(baseUrl, path) { // Added
    try {
      const normalizedBase = this.normalizeBaseUrl(baseUrl);
      const url = new URL(normalizedBase);
      url.pathname = `/${path.replace(/^\/+/, '')}`;
      const finalUrl = url.toString();
      if (DEBUG) {
        logger.debug('EmailService.build_url', { baseUrl, path, finalUrl });
      }
      return finalUrl;
    } catch (error) {
      logger.error('EmailService.url_build_failed', {
        baseUrl,
        path,
        error: error.message
      });
      return `${this.defaultFrontendUrl}/${path.replace(/^\/+/, '')}`;
    }
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
   * @returns {Promise} Send result
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
    const resetLink = this.buildUrl(frontendUrl || this.defaultFrontendUrl, `reset-password/${token}`); // Modified

    // Email content
    const mailOptions = {
      from: `"${this.appName}" <${this.fromEmail}>`, // Modified
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
  <meta charset="UTF-8">
  <title>${this.appName} Password Reset</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 20px; }
    .header img { max-width: 150px; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 5px; }
    .button { display: inline-block; padding: 10px 20px; background: #4E97D1; color: white !important; text-decoration: none; border-radius: 5px; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${this.appName}</h1>
    </div>
    <div class="content">
      <p>Hello ${userName || ''},</p>
      <p>You recently requested to reset your password for your ${this.appName} account. Use the following token to complete the process:</p>
      <p><strong>${token}</strong></p>
      <p>Alternatively, you can click the button below:</p>
      <p><a href="${resetLink}" class="button">Reset Password</a></p>
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
        textPreview: mailOptions.text.substring(0, 100) + '...',
        resetLink // Added
      });
    }

    // Send email
    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info('EmailService.password_reset_email_sent', {
        to: email,
        messageId: info.messageId,
        resetLink, // Added
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

  // The verification-email sender was deleted in A6: email verification is
  // Keycloak's own (VERIFY_EMAIL required action via keycloak-proxy-service, or
  // KC's Account API email change flow). Its last consumers (user-routes /email,
  // admin resend-verification, user-profile-service) were reworked onto the proxy.

  /**
   * Send a generic email with custom subject and HTML body
   * @param {string} to - Recipient email address
   * @param {string} subject - Email subject
   * @param {string} htmlBody - HTML content for the email body
   * @returns {Promise} Send result
   */
  async sendGenericEmail(to, subject, htmlBody) {
    const startTime = Date.now();
    if (!to) {
      logger.error('EmailService.generic_email_missing_recipient');
      throw new Error('Email recipient is required');
    }

    if (DEBUG) {
      logger.debug('EmailService.send_generic_email_start', { to, subject });
    }

    const mailOptions = {
      from: `"${this.appName}" <${this.fromEmail}>`,
      to,
      subject,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 20px; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 5px; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${this.appName}</h1>
    </div>
    <div class="content">
      ${htmlBody}
    </div>
    <div class="footer">
      <p>The ${this.appName} Team</p>
    </div>
  </div>
</body>
</html>
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info('EmailService.generic_email_sent', {
        to,
        subject,
        messageId: info.messageId,
        durationMs: Date.now() - startTime
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('EmailService.generic_email_failed', {
        to,
        subject,
        error: error.message,
        code: error.code,
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Send notification to all admin users about a new pending registration
   * @param {object} newUser - The newly registered user info
   * @returns {Promise} Send result (best-effort, does not throw)
   */
  async sendNewUserNotificationToAdmins(newUser) {
    try {
      const { dbService } = require('../shared-lib');
      const { aql } = require('arangojs');
      const db = await dbService.getConnection();

      // Find all admin users with email addresses.
      // A6 fix: roles are the JWT-claims array provisioned into Arango
      // ('admin' IN u.roles) — the scalar u.role == 'Admin' lookup matched
      // nothing after A5 (Arango role labels are display-only). Soft-deleted
      // admins are excluded (markUserAsDeleted preserves email+roles).
      const cursor = await db.query(aql`
        FOR u IN users
          FILTER 'admin' IN u.roles AND u.email != null AND u.email != ''
          FILTER u.disabled != true
          FILTER u.deleted != true
          RETURN { email: u.email, fullName: u.personalIdentification.fullName }
      `);
      const admins = await cursor.all();

      if (admins.length === 0) {
        logger.warn('EmailService.no_admins_to_notify');
        return { success: false, message: 'No admin users found to notify' };
      }

      const userName = newUser.fullName || newUser.loginName || 'Unknown';
      const userEmail = newUser.email || 'No email provided';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8090'; // compose default
      const appName = process.env.APP_NAME || 'GENIE.AI';

      const subject = `[${appName}] New User Registration Pending Approval`;
      const htmlBody = `
        <h2>New User Registration</h2>
        <p>A new user has registered and is waiting for your approval:</p>
        <table style="border-collapse: collapse; width: 100%; margin: 1rem 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Name</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${userName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${userEmail}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Registered At</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${new Date().toLocaleString()}</td>
          </tr>
        </table>
        <p>Please log in to the Admin Dashboard to approve or reject this registration:</p>
        <p><a href="${frontendUrl}" style="display: inline-block; padding: 10px 20px; background: #4E97D1; color: white; text-decoration: none; border-radius: 5px;">Open Admin Dashboard</a></p>
        <p style="color: #666; font-size: 0.9rem;">Go to Administration → User Management → Pending Users tab to review.</p>
      `;

      // Send to all admins
      const results = await Promise.allSettled(
        admins.map(admin => this.sendGenericEmail(admin.email, subject, htmlBody))
      );

      const sent = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logger.info('EmailService.admin_notification_sent', {
        totalAdmins: admins.length,
        sent,
        failed,
        newUser: userName
      });

      return { success: true, sent, failed };
    } catch (error) {
      logger.error('EmailService.admin_notification_failed', {
        error: error.message,
        stack: error.stack
      });
      return { success: false, message: error.message };
    }
  }
}

// Export a singleton instance
module.exports = new EmailService();