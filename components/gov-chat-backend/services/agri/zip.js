/**
 * Minimal ZIP reader for the FAOSTAT bulk archives.
 *
 * FAOSTAT zips are standard deflate containers of one or two large CSVs.
 * Dependency-free: parses the central directory, inflates entries with
 * zlib.inflateRawSync. Size-capped per entry (BMAD hardening — these are
 * third-party payloads; the big producer-price CSV is ~200 MB inflated,
 * so callers must stream-filter rather than materialize blindly).
 */
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CDFH_SIGNATURE = 0x02014b50;
const MAX_INFLATED_BYTES = 600 * 1024 * 1024; // 600 MB hard ceiling

/** Parse the ZIP central directory. @returns {Array<{name, compressedSize, method, localHeaderOffset}>} */
function readCentralDirectory(buffer) {
  // Find End Of Central Directory record (scan back — comment can follow)
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 65536; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end-of-central-directory not found');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = [];
  for (let n = 0; n < entryCount; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CDFH_SIGNATURE) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Extract one entry to a Buffer.
 * @param {Buffer} buffer - whole zip file
 * @param {string} name - entry filename (exact or suffix match)
 * @param {Object} [opts] - { maxBytes }
 * @returns {Promise<Buffer>} inflated content
 */
async function extractEntry(buffer, name, opts = {}) {
  const entries = readCentralDirectory(buffer);
  const entry = entries.find((e) => e.name === name) || entries.find((e) => e.name.endsWith(name));
  if (!entry) {
    throw new Error(`zip: entry not found: ${name} (have: ${entries.map((e) => e.name).join(', ')})`);
  }

  // Local file header: fixed 30 bytes + name + extra (extra length differs
  // from the central directory's — read it from the local header)
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error('zip: bad local header');
  }
  const localNameLen = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLen = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
  const compressed = buffer.slice(dataStart, dataStart + entry.compressedSize);

  const maxBytes = opts.maxBytes || MAX_INFLATED_BYTES;
  const inflated =
    entry.method === 8
      ? await new Promise((resolve, reject) =>
          zlib.inflateRaw(compressed, { maxOutputLength: maxBytes }, (err, out) => (err ? reject(err) : resolve(out)))
        )
      : compressed; // method 0 = stored

  if (inflated.length > maxBytes) {
    throw new Error(`zip: entry ${name} exceeds size cap (${inflated.length} > ${maxBytes})`);
  }
  return inflated;
}

module.exports = { readCentralDirectory, extractEntry };
