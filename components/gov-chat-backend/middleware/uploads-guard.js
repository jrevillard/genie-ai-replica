const path = require('path');

/**
 * Folders under /Uploads that the public static route must not serve.
 * call-recordings: Audio-session WAVs from the voice bridge, named <sessionId>.wav,
 * so their URLs are easy to guess. The voice bridge keeps recording; only public
 * serving is closed.
 */
const PRIVATE_UPLOAD_DIRS = new Set(['call-recordings']);

/**
 * True when a path under the /Uploads mount points into a private folder.
 * Decodes and normalizes the path the way express.static does before it opens
 * the file, so encoded or dotted variants are caught too. A path that does not
 * decode counts as private.
 */
function isPrivateUploadPath(reqPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(reqPath);
  } catch {
    return true;
  }
  const [firstSegment = ''] = path.posix.normalize(decoded).split('/').filter(Boolean);
  return PRIVATE_UPLOAD_DIRS.has(firstSegment.toLowerCase());
}

/** Runs before express.static on /Uploads: the folder root and private folders get a 404. */
function uploadsGuard(req, res, next) {
  if (req.path === '/' || req.path === '' || isPrivateUploadPath(req.path)) {
    return res.status(404).json({ message: 'Not Found' });
  }
  return next();
}

module.exports = { uploadsGuard, isPrivateUploadPath };
