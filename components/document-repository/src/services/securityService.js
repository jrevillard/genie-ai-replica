const { logger } = require('../shared-lib/logger');
const net = require('net');


class SecurityService {
  constructor() {
    this.maxBufferSize = 1024 * 1024 * 10; // 10MB
  }

  /**
  * Creates a connection to ClamAV daemon
  * @returns {Promise<net.Socket>} Connected socket
  */
  async createConnection() {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      
      socket.setTimeout(60000);
      
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });

      socket.on('error', (error) => {
        reject(new Error(`ClamAV connection error: ${error.message}`));
      });

      socket.connect('3310', 'localhost', () => {
        resolve(socket);
      });
    });
  }

  /**
   * Sends command to ClamAV and receives response
   * @param {string} command - Command to send
   * @param {Buffer} data - Optional data to send
   * @returns {Promise<string>} Response from ClamAV
   */
  async sendCommand(command, data = null) {
    const socket = await this.createConnection();
    
    return new Promise((resolve, reject) => {
      let response = '';
      
      socket.on('data', (chunk) => {
        response += chunk.toString();
      });

      socket.on('end', () => {
        resolve(response.trim());
      });

      socket.on('error', (error) => {
        reject(new Error(`ClamAV communication error: ${error.message}`));
      });

      // Send command
      if (data) {
        // For INSTREAM command, send command + data length + data
        const dataLength = Buffer.alloc(4);
        dataLength.writeUInt32BE(data.length, 0);
        
        socket.write(command);
        socket.write(dataLength);
        socket.write(data);
        
        // Send zero-length chunk to indicate end of data
        const endChunk = Buffer.alloc(4);
        endChunk.writeUInt32BE(0, 0);
        socket.write(endChunk);
      } else {
        socket.write(command);
      }
      
      socket.end();
    });
  }

  /**
   * Scans a buffer for viruses using ClamAV
   * @param {Buffer} buffer - File buffer to scan
   * @returns {Promise<Object>} Scan result
   */
  async scanBuffer(buffer) {
    try {
      // Validate input
      if (!Buffer.isBuffer(buffer)) {
        throw new Error('Input must be a Buffer');
      }

      if (buffer.length === 0) {
        throw new Error('Buffer is empty');
      }

      if (buffer.length > this.maxBufferSize) {
        throw new Error(`Buffer size exceeds maximum allowed size of ${this.maxBufferSize} bytes`);
      }

      // Use INSTREAM command to scan buffer
      logger.debug(`[SECURITY-SERVICE] Scanning buffer of size ${buffer.length} bytes`);
      const response = await this.sendCommand('zINSTREAM\0', buffer);
      
      // Parse response
      if (response.includes('OK')) {
        return {
          isInfected: false,
          virus: null,
          message: 'File is clean'
        };
      } else if (response.includes('FOUND')) {
        const virusMatch = response.match(/stream: (.+) FOUND/);
        const virusName = virusMatch ? virusMatch[1] : 'Unknown virus';
        
        return {
          isInfected: true,
          virus: virusName,
          message: `Virus detected: ${virusName}`
        };
      } else {
        throw new Error(`Unexpected ClamAV response: ${response}`);
      }
    } catch (error) {
      throw new Error(`Buffer scan failed: ${error.message}`);
    }
  }

  /**
   * Performs health check on ClamAV connection and status
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      const startTime = Date.now();
      
      // Test basic connectivity with PING command
      const pingResponse = await this.sendCommand('zPING\0');
      
      if (!pingResponse.includes('PONG')) {
        throw new Error(`Unexpected ping response: ${pingResponse}`);
      }

      // Get ClamAV version
      const versionResponse = await this.sendCommand('zVERSION\0');
      
      // Get stats
      const statsResponse = await this.sendCommand('zSTATS\0');
      
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        connected: true,
        responseTime: responseTime,
        version: versionResponse.trim(),
        stats: this.parseStats(statsResponse),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

}

module.exports = new SecurityService();