'use strict';

/**
 * Creates a mock ClamAV scanner instance.
 * @param {Object} options - Configuration options
 * @param {boolean} options.infected - Whether to simulate an infected file
 * @param {string[]} options.viruses - List of virus names to report
 * @returns {Object} Mock ClamAV scanner with scanStream method
 */
function createMockClamAV(options = {}) {
  const { infected = false, viruses = [] } = options;

  const scanResult = {
    isInfected: infected,
    viruses: infected ? viruses : []
  };

  return {
    scanStream: jest.fn().mockResolvedValue(scanResult),
    _scanResult: scanResult
  };
}

/**
 * Pre-built mock for clean (non-infected) scan results.
 */
const cleanClamAV = createMockClamAV({ infected: false });

/**
 * Pre-built mock for EICAR-infected scan results.
 */
const infectedClamAV = createMockClamAV({
  infected: true,
  viruses: ['EICAR-Test-Signature']
});

/**
 * Creates a mock NodeClam constructor that returns the given scanner.
 * @param {Object} scanner - Mock scanner instance (from createMockClamAV)
 * @returns {jest.Mock} Mock constructor
 */
function createMockNodeClamConstructor(scanner) {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(scanner)
  }));
}

module.exports = {
  createMockClamAV,
  cleanClamAV,
  infectedClamAV,
  createMockNodeClamConstructor
};
