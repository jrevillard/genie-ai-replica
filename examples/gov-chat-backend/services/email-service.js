// email-service.js
require('dotenv').config();
const nodemailer = require('nodemailer');

// Add debug flag - can be controlled via environment variable
const DEBUG = process.env.DEBUG_EMAIL !== 'false';

// Helper function for debug logging
function debugLog(label, data) {
  if (!DEBUG) return;

  console.log('\n-----------------------------------------------------');
  console.log(`EMAIL SERVICE DEBUG [${label}] - ${new Date().toISOString()}`);
  console.log('-----------------------------------------------------');

  if (data) {
    if (typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
  }
  console.log('-----------------------------------------------------\n');
}

class EmailService {
  constructor() {
    debugLog('INITIALIZING EMAIL SERVICE', {
      host: process.env.EMAIL_HOST || 'in-V3.mailjet.com',
      port: process.env.EMAIL_PORT || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || 'fordendk@gmail.com',
        pass: '******' // Hide password in logs
      },
      fromEmail: process.env.EMAIL_FROM || 'noreply@huduma.com',
      appName: process.env.APP_NAME || 'Huduma AI',
      baseUrl: process.env.FRONTEND_URL || 'http://localhost:8080'
    });

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

    // Base URL for links in emails
    this.baseUrl = process.env.FRONTEND_URL || 'http://localhost:8080';

    // Test SMTP connection at startup
    this.verifyConnection();
  }

  /**
   * Verify SMTP connection is working
   */
  async verifyConnection() {
    try {
      debugLog('TESTING SMTP CONNECTION');
      const verification = await this.transporter.verify();
      debugLog('SMTP CONNECTION SUCCESSFUL', verification);
    } catch (error) {
      debugLog('SMTP CONNECTION FAILED', {
        error: error.message,
        code: error.code,
        stack: error.stack
      });

      // Log specific issues based on error code
      if (error.code === 'EAUTH') {
        debugLog('AUTHENTICATION ERROR',
          'SMTP authentication failed. Check username and password in .env file.'
        );
      } else if (error.code === 'ESOCKET') {
        debugLog('CONNECTION ERROR',
          'Could not connect to SMTP server. Check host, port, and firewall settings.'
        );
      } else if (error.code === 'ETIMEDOUT') {
        debugLog('TIMEOUT ERROR',
          'Connection to SMTP server timed out. Server might be down or blocked.'
        );
      }
    }
  }

  /**
   * Send a password reset email
   * @param {string} email - Recipient email
   * @param {string} token - Password reset token
   * @param {string} userName - User's name
   * @returns {Promise<Object>} Send result
   */
  async sendPasswordResetEmail(email, token, userName) {
    debugLog('PASSWORD RESET EMAIL REQUEST', {
      to: email,
      token: token.substring(0, 10) + '...', // Show only beginning of token for security
      userName
    });

    // Create reset password link
    const resetLink = `${this.baseUrl}/reset-password/${token}`;
    debugLog('RESET LINK', resetLink);

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

    debugLog('PASSWORD RESET EMAIL CONTENT', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      textPreview: mailOptions.text.substring(0, 100) + '...'
    });

    // Send email
    try {
      const info = await this.transporter.sendMail(mailOptions);
      debugLog('PASSWORD RESET EMAIL SENT', {
        messageId: info.messageId,
        response: info.response,
        envelope: info.envelope
      });
      console.log(`Password reset email sent to ${email}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      debugLog('PASSWORD RESET EMAIL ERROR', {
        error: error.message,
        code: error.code,
        command: error.command,
        responseCode: error.responseCode,
        response: error.response
      });
      console.error(`Error sending password reset email to ${email}:`, error);
      throw error;
    }
  }

  /**
   * Send an email verification email
   * @param {string} email - Recipient email
   * @param {string} token - Verification token
   * @param {string} userName - User's name
   * @returns {Promise<Object>} Send result
   */
  async sendVerificationEmail(email, token, userName) {

    if (!email) {
      debugLog('VERIFICATION EMAIL ERROR - MISSING RECIPIENT', {
        email: 'undefined or null',
        token: token ? `${token.substring(0, 10)}...` : 'undefined',
        userName: userName || 'undefined'
      });
      throw new Error('Email recipient is required');
    }

    debugLog('VERIFICATION EMAIL REQUEST', {
      to: email,
      token: token ? `${token.substring(0, 10)}...` : 'undefined',
      userName
    });

    // Create verification link
    const verificationLink = `${this.baseUrl}/verify-email/${token}`;
    debugLog('VERIFICATION LINK', verificationLink);

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

    debugLog('VERIFICATION EMAIL CONTENT', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      textPreview: mailOptions.text.substring(0, 100) + '...'
    });

    // Send email
    try {
      // Test SMTP connection before sending
      try {
        await this.transporter.verify();
        debugLog('SMTP CONNECTION VERIFIED BEFORE SENDING');
      } catch (verifyError) {
        debugLog('SMTP CONNECTION TEST FAILED', {
          error: verifyError.message,
          code: verifyError.code
        });
      }

      const info = await this.transporter.sendMail(mailOptions);
      debugLog('VERIFICATION EMAIL SENT', {
        messageId: info.messageId,
        response: info.response,
        envelope: info.envelope
      });
      console.log(`Verification email sent to ${email}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      debugLog('VERIFICATION EMAIL ERROR', {
        error: error.message,
        code: error.code,
        command: error.command,
        responseCode: error.responseCode,
        response: error.response,
        stack: error.stack
      });

      // Log specific issues based on error code
      if (error.code === 'EAUTH') {
        debugLog('GMAIL AUTH ISSUE', `
          Gmail requires either:
          1. An app password (if 2FA is enabled) - Create one at https://myaccount.google.com/apppasswords
          2. 'Less secure app access' enabled (not recommended) - https://myaccount.google.com/lesssecureapps
          3. Or use OAuth2 authentication
        `);
      }

      console.error(`Error sending verification email to ${email}:`, error);
      throw error;
    }
  }
}

// Export a singleton instance
module.exports = new EmailService();