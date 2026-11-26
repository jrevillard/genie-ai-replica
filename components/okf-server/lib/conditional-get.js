// Explicit conditional GET (#2191).
//
// WHY THIS EXISTS: express's built-in freshness flow (res.send's req.fresh
// check) does not fire in this service — measured 2026-11-26 on the local
// build: every route answers 200 on a matched If-None-Match (the ETag header
// ships, but the 304 never does — health, concepts, repos all confirmed).
// The dashboard poll and the graph mounts need REAL 304s, so the two hot
// routes compare the validator explicitly. Uses the same `etag` package
// express itself uses, so the shipped header format is unchanged.
'use strict';

const etag = require('etag');

/**
 * Send `body` with an ETag; answer 304 when If-None-Match matches.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {*} body JSON-serializable
 */
module.exports = function sendConditional(req, res, body) {
  const json = JSON.stringify(body);
  const tag = etag(json, { weak: true }); // same wire format express stamps
  res.set('ETag', tag);
  const inm = req.headers['if-none-match'];
  const matches = inm === '*' || (typeof inm === 'string' && inm.split(',').some((c) => c.trim() === tag));
  if (matches) {
    res.status(304).end();
    return;
  }
  res.set('Content-Type', 'application/json');
  res.set('Content-Length', Buffer.byteLength(json));
  res.status(200).send(json);
};
