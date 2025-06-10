const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/appConfig');
const { logger } = require('../shared-lib/logger');
const fs = require('fs').promises;
const { scanFile, scanBuffer } = require('../utils/virusScanner');

class SecurityService {
  constructor() {
    this.jwtSecret = config.security.jwtSecret;
    this.jwtExpiration = config.security.jwtExpiration;
    this.bcryptRounds = config.security.bcryptRounds;
  }

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password) {
    try {
      const salt = await bcrypt.genSalt(this.bcryptRounds);
      return await bcrypt.hash(password, salt);
    } catch (error) {
      logger.error('Password hashing failed:', error);
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error('Password verification failed:', error);
      return false;
    }
  }

  /**
   * Generate JWT token
   */
  generateToken(payload, options = {}) {
    try {
      const tokenOptions = {
        expiresIn: options.expiresIn || this.jwtExpiration,
        issuer: 'document-repository',
        ...options
      };

      return jwt.sign(payload, this.jwtSecret, tokenOptions);
    } catch (error) {
      logger.error('Token generation failed:', error);
      throw new Error('Token generation failed');
    }
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      }
      logger.error('Token verification failed:', error);
      throw new Error('Token verification failed');
    }
  }

  /**
   * Generate API key
   */
  generateApiKey(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate secure random string
   */
  generateSecureRandom(length = 16) {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Hash API key for storage
   */
  async hashApiKey(apiKey) {
    try {
      return crypto.createHash('sha256').update(apiKey).digest('hex');
    } catch (error) {
      logger.error('API key hashing failed:', error);
      throw new Error('API key hashing failed');
    }
  }

  /**
   * Verify API key
   */
  async verifyApiKey(apiKey, hashedKey) {
    try {
      const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
      return hash === hashedKey;
    } catch (error) {
      logger.error('API key verification failed:', error);
      return false;
    }
  }

  /**
   * Sanitize filename to prevent path traversal
   */
  sanitizeFilename(filename) {
    // Remove path components and dangerous characters
    return filename
      .replace(/[\/\\]/g, '') // Remove path separators
      .replace(/[<>:"|?*]/g, '') // Remove Windows forbidden characters
      .replace(/^\./g, '') // Remove leading dots
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 255); // Limit length
  }

  /**
   * Validate file path to prevent directory traversal
   */
  validateFilePath(filePath, allowedDirectory) {
    try {
      const path = require('path');
      const normalizedPath = path.normalize(filePath);
      const resolvedPath = path.resolve(normalizedPath);
      const allowedPath = path.resolve(allowedDirectory);

      // Check if the resolved path starts with the allowed directory
      return resolvedPath.startsWith(allowedPath);
    } catch (error) {
      logger.error('File path validation failed:', error);
      return false;
    }
  }

  /**
   * Generate file checksum
   */
  generateFileChecksum(buffer, algorithm = 'sha256') {
    try {
      return crypto.createHash(algorithm).update(buffer).digest('hex');
    } catch (error) {
      logger.error('Checksum generation failed:', error);
      throw new Error('Checksum generation failed');
    }
  }

  /**
   * Verify file integrity using checksum
   */
  verifyFileIntegrity(buffer, expectedChecksum, algorithm = 'sha256') {
    try {
      const actualChecksum = this.generateFileChecksum(buffer, algorithm);
      return actualChecksum === expectedChecksum;
    } catch (error) {
      logger.error('File integrity verification failed:', error);
      return false;
    }
  }

  /**
   * Rate limiting key generator
   */
  generateRateLimitKey(req, identifier = 'ip') {
    switch (identifier) {
      case 'ip':
        return `rate_limit:${req.ip}`;
      case 'user':
        return `rate_limit:user:${req.user?.id || 'anonymous'}`;
      case 'api_key':
        return `rate_limit:api:${req.apiKey || 'unknown'}`;
      default:
        return `rate_limit:${req.ip}`;
    }
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(text, key = this.jwtSecret) {
    try {
      const algorithm = 'aes-256-gcm';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(algorithm, key);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      logger.error('Encryption failed:', error);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData, key = this.jwtSecret) {
    try {
      const algorithm = 'aes-256-gcm';
      const decipher = crypto.createDecipher(algorithm, key);
      
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption failed:', error);
      throw new Error('Decryption failed');
    }
  }

  /**
   * Generate session token
   */
  generateSessionToken() {
    return {
      token: this.generateSecureRandom(32),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };
  }

  /**
   * Validate input against common injection patterns
   */
  validateInput(input, type = 'general') {
    const patterns = {
      general: /[<>\"'%;()&+]/,
      filename: /[\/\\<>:"|?*\x00-\x1f]/,
      query: /[';\\-\\/\\*]/,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    };

    if (type === 'email') {
      return patterns.email.test(input);
    }

    return !patterns[type]?.test(input);
  }

  /**
   * Generate CSRF token
   */
  generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Verify CSRF token
   */
  verifyCSRFToken(token, sessionToken) {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token, 'hex'),
        Buffer.from(sessionToken, 'hex')
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Scan a file for viruses
   * @param {string} filePath - Path to the file to scan
   * @returns {Promise<Object>} Scan result
   */
  async scanFile(filePath) {
    try {
      const result = await scanFile(filePath);
      return {
        clean: result.isClean,
        scanned: true,
        virus: result.viruses ? result.viruses.join(', ') : null,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error scanning file: ${error.message}`);
      throw new Error(`Virus scan failed: ${error.message}`);
    }
  }

  /**
   * Scan a buffer for viruses
   * @param {Buffer} buffer - Buffer to scan
   * @param {string} filename - Name of the file (for logging)
   * @returns {Promise<Object>} Scan result
   */
  async scanBuffer(buffer, filename) {
    try {
      const result = await scanBuffer(buffer, filename);
      return {
        clean: result.isClean,
        scanned: true,
        virus: result.viruses ? result.viruses.join(', ') : null,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error scanning buffer: ${error.message}`);
      throw new Error(`Virus scan failed: ${error.message}`);
    }
  }
}

module.exports = new SecurityService();