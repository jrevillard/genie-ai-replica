require('dotenv').config();
const nodemailer = require('nodemailer');
const { createLogger, format, transports } = require('winston'); // Import Winston

// Add debug flag - can be controlled via environment variable
const DEBUG = process.env.DEBUG_EMAIL !== 'false';

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

class EmailService {
  constructor() {
    // Log initialization details if DEBUG is enabled
    if (DEBUG) {
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [INITIALIZING EMAIL SERVICE] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(JSON.stringify({
        host: process.env.EMAIL_HOST || 'in-V3.mailjet.com',
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER || 'fordendk@gmail.com',
          pass: '******' // Hide password in logs
        },
        fromEmail: process.env.EMAIL_FROM || 'noreply@huduma.com',
        appName: process.env.APP_NAME || 'Huduma AI',
        defaultFrontendUrl: process.env.FRONTEND_URL || 'http://localhost:8090'
      }, null, 2));
      logger.info('-----------------------------------------------------');
    }

    // Create a transporter with your email provider settings
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'in-V3.mailjet.com',
      port: process.env.EMAIL_PORT || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || '187ad3288090609e6e282b07f359acd4',
        pass: process.env.EMAIL_PASSWORD || '6615d81ddd46faab7e69eb6710ac364a'
      }
    });

    // Sender email address
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@huduma.com';

    // App name for email templates
    this.appName = process.env.APP_NAME || 'Huduma AI';

    // Default frontend URL for links in emails - will be overridden by request origin if provided
    this.defaultFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:8090';

    // Test SMTP connection at startup
    this.verifyConnection();
  }

  /**
   * Verify SMTP connection is working
   */
  async verifyConnection() {
    try {
      if (DEBUG) {
        logger.info('-----------------------------------------------------');
        logger.info(`EMAIL SERVICE DEBUG [TESTING SMTP CONNECTION] - ${new Date().toISOString()}`);
        logger.info('-----------------------------------------------------');
      }

      const verification = await this.transporter.verify();

      if (DEBUG) {
        logger.info('-----------------------------------------------------');
        logger.info(`EMAIL SERVICE DEBUG [SMTP CONNECTION SUCCESSFUL] - ${new Date().toISOString()}`);
        logger.info('-----------------------------------------------------');
        logger.info(JSON.stringify(verification, null, 2));
        logger.info('-----------------------------------------------------');
      }
    } catch (error) {
      if (DEBUG) {
        logger.error('-----------------------------------------------------');
        logger.error(`EMAIL SERVICE DEBUG [SMTP CONNECTION FAILED] - ${new Date().toISOString()}`);
        logger.error('-----------------------------------------------------');
        logger.error(JSON.stringify({
          error: error.message,
          code: error.code,
          stack: error.stack
        }, null, 2));
        logger.error('-----------------------------------------------------');

        // Log specific issues based on error code
        if (error.code === 'EAUTH') {
          logger.error('-----------------------------------------------------');
          logger.error(`EMAIL SERVICE DEBUG [AUTHENTICATION ERROR] - ${new Date().toISOString()}`);
          logger.error('-----------------------------------------------------');
          logger.error('SMTP authentication failed. Check username and password in .env file.');
          logger.error('-----------------------------------------------------');
        } else if (error.code === 'ESOCKET') {
          logger.error('-----------------------------------------------------');
          logger.error(`EMAIL SERVICE DEBUG [CONNECTION ERROR] - ${new Date().toISOString()}`);
          logger.error('-----------------------------------------------------');
          logger.error('Could not connect to SMTP server. Check host, port, and firewall settings.');
          logger.error('-----------------------------------------------------');
        } else if (error.code === 'ETIMEDOUT') {
          logger.error('-----------------------------------------------------');
          logger.error(`EMAIL SERVICE DEBUG [TIMEOUT ERROR] - ${new Date().toISOString()}`);
          logger.error('-----------------------------------------------------');
          logger.error('Connection to SMTP server timed out. Server might be down or blocked.');
          logger.error('-----------------------------------------------------');
        }
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
    if (DEBUG) {
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [PASSWORD RESET EMAIL REQUEST] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(JSON.stringify({
        to: email,
        token: token.substring(0, 10) + '...', // Show only beginning of token for security
        userName,
        frontendUrl: frontendUrl || 'not provided'
      }, null, 2));
      logger.info('-----------------------------------------------------');
    }

    // Use provided frontend URL or fall back to default
    const baseUrl = frontendUrl || this.defaultFrontendUrl;
    
    if (DEBUG) {
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [USING BASE URL] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(`Using base URL for password reset email: ${baseUrl}`);
      logger.info('-----------------------------------------------------');
    }

    // Create reset password link
    const resetLink = `${baseUrl}/reset-password/${token}`;
    if (DEBUG) {
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [RESET LINK] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(resetLink);
      logger.info('-----------------------------------------------------');
    }

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
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [PASSWORD RESET EMAIL CONTENT] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(JSON.stringify({
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        textPreview: mailOptions.text.substring(0, 100) + '...'
      }, null, 2));
      logger.info('-----------------------------------------------------');
    }

    // Send email
    try {
      const info = await this.transporter.sendMail(mailOptions);
      if (DEBUG) {
        logger.info('-----------------------------------------------------');
        logger.info(`EMAIL SERVICE DEBUG [PASSWORD RESET EMAIL SENT] - ${new Date().toISOString()}`);
        logger.info('-----------------------------------------------------');
        logger.info(JSON.stringify({
          messageId: info.messageId,
          response: info.response,
          envelope: info.envelope
        }, null, 2));
        logger.info('-----------------------------------------------------');
      }
      logger.info(`Password reset email sent to ${email}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      if (DEBUG) {
        logger.error('-----------------------------------------------------');
        logger.error(`EMAIL SERVICE DEBUG [PASSWORD RESET EMAIL ERROR] - ${new Date().toISOString()}`);
        logger.error('-----------------------------------------------------');
        logger.error(JSON.stringify({
          error: error.message,
          code: error.code,
          command: error.command,
          responseCode: error.responseCode,
          response: error.response
        }, null, 2));
        logger.error('-----------------------------------------------------');
      }
      logger.error(`Error sending password reset email to ${email}:`, error);
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
    if (!email) {
      if (DEBUG) {
        logger.error('-----------------------------------------------------');
        logger.error(`EMAIL SERVICE DEBUG [VERIFICATION EMAIL ERROR - MISSING RECIPIENT] - ${new Date().toISOString()}`);
        logger.error('-----------------------------------------------------');
        logger.error(JSON.stringify({
          email: 'undefined or null',
          token: token ? `${token.substring(0, 10)}...` : 'undefined',
          userName: userName || 'undefined',
          frontendUrl: frontendUrl || 'undefined',
          verificationUrl: verificationUrl || 'undefined'
        }, null, 2));
        logger.error('-----------------------------------------------------');
      }
      throw new Error('Email recipient is required');
    }

    if (DEBUG) {
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [VERIFICATION EMAIL REQUEST] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(JSON.stringify({
        to: email,
        token: token ? `${token.substring(0, 10)}...` : 'undefined',
        userName,
        frontendUrl: frontendUrl || 'not provided',
        verificationUrl: verificationUrl || 'not provided'
      }, null, 2));
      logger.info('-----------------------------------------------------');
    }

    // Use provided frontend URL or fall back to default
    const baseUrl = frontendUrl || this.defaultFrontendUrl;
    
    if (DEBUG) {
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [USING BASE URL] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(`Using base URL for verification email UI links: ${baseUrl}`);
      logger.info('-----------------------------------------------------');
    }

    // Use the complete verification URL provided or construct a fallback
    // The verification URL should point to the backend API endpoint
    const verificationLink = verificationUrl || `${baseUrl}/api/auth/verify-email/${token}`;
    
    if (DEBUG) {
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [VERIFICATION LINK] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(`Using verification link: ${verificationLink}`);
      logger.info('-----------------------------------------------------');
    }

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
      logger.info('-----------------------------------------------------');
      logger.info(`EMAIL SERVICE DEBUG [VERIFICATION EMAIL CONTENT] - ${new Date().toISOString()}`);
      logger.info('-----------------------------------------------------');
      logger.info(JSON.stringify({
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        textPreview: mailOptions.text.substring(0, 100) + '...'
      }, null, 2));
      logger.info('-----------------------------------------------------');
    }

    // Send email
    try {
      // Test SMTP connection before sending
      try {
        await this.transporter.verify();
        if (DEBUG) {
          logger.info('-----------------------------------------------------');
          logger.info(`EMAIL SERVICE DEBUG [SMTP CONNECTION VERIFIED BEFORE SENDING] - ${new Date().toISOString()}`);
          logger.info('-----------------------------------------------------');
        }
      } catch (verifyError) {
        if (DEBUG) {
          logger.error('-----------------------------------------------------');
          logger.error(`EMAIL SERVICE DEBUG [SMTP CONNECTION TEST FAILED] - ${new Date().toISOString()}`);
          logger.error('-----------------------------------------------------');
          logger.error(JSON.stringify({
            error: verifyError.message,
            code: verifyError.code
          }, null, 2));
          logger.error('-----------------------------------------------------');
        }
      }

      const info = await this.transporter.sendMail(mailOptions);
      if (DEBUG) {
        logger.info('-----------------------------------------------------');
        logger.info(`EMAIL SERVICE DEBUG [VERIFICATION EMAIL SENT] - ${new Date().toISOString()}`);
        logger.info('-----------------------------------------------------');
        logger.info(JSON.stringify({
          messageId: info.messageId,
          response: info.response,
          envelope: info.envelope
        }, null, 2));
        logger.info('-----------------------------------------------------');
      }
      logger.info(`Verification email sent to ${email}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      if (DEBUG) {
        logger.error('-----------------------------------------------------');
        logger.error(`EMAIL SERVICE DEBUG [VERIFICATION EMAIL ERROR] - ${new Date().toISOString()}`);
        logger.error('-----------------------------------------------------');
        logger.error(JSON.stringify({
          error: error.message,
          code: error.code,
          command: error.command,
          responseCode: error.responseCode,
          response: error.response,
          stack: error.stack
        }, null, 2));
        logger.error('-----------------------------------------------------');

        // Log specific issues based on error code
        if (error.code === 'EAUTH') {
          logger.error('-----------------------------------------------------');
          logger.error(`EMAIL SERVICE DEBUG [GMAIL AUTH ISSUE] - ${new Date().toISOString()}`);
          logger.error('-----------------------------------------------------');
          logger.error(`
            Gmail requires either:
            1. An app password (if 2FA is enabled) - Create one at https://myaccount.google.com/apppasswords
            2. 'Less secure app access' enabled (not recommended) - https://myaccount.google.com/lesssecureapps
            3. Or use OAuth2 authentication
          `);
          logger.error('-----------------------------------------------------');
        }
      }

      logger.error(`Error sending verification email to ${email}:`, error);
      throw error;
    }
  }
}

// Export a singleton instance
module.exports = new EmailService();