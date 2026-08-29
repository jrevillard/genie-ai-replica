const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8090;
const DIST = path.join(__dirname, 'dist');
const CSP = process.env.VUE_APP_CSP_CONNECT_SRC || "'self'";
// API proxy target (Docker network hostname:internal_port)
// VUE_PROXY_HOST uses the host-mapped port (e.g. kong:8010), but container-to-container
// traffic must use the internal port (e.g. kong:8000). VUE_API_PROXY overrides this.
const API_PROXY = process.env.VUE_API_PROXY || process.env.VUE_PROXY_HOST || 'localhost:3000';
const [PROXY_HOST, PROXY_PORT] = API_PROXY.split(':');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

const CACHE_CONTROL = process.env.NODE_ENV === 'production'
  ? 'public, max-age=3600'
  : 'no-cache';

const CSP_HEADER = `default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src ${CSP}; font-src 'self' https://cdnjs.cloudflare.com data:; img-src 'self' data:;`;

function proxyRequest(req, res) {
  const options = {
    hostname: PROXY_HOST,
    port: PROXY_PORT || 80,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: API_PROXY },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Pass through status and headers
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // Proxy /api and /ws requests to the backend/gateway
  if (urlPath === '/api' || urlPath.startsWith('/api/') || urlPath === '/ws' || urlPath.startsWith('/ws/')) {
    return proxyRequest(req, res);
  }

  const filePath = path.join(DIST, urlPath);

  if (filePath.startsWith(DIST + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Security-Policy': CSP_HEADER,
      'Cache-Control': CACHE_CONTROL,
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback: serve index.html for all non-file routes
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP_HEADER,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
  }
}).listen(PORT, () => {
  console.log(`Frontend server running on port ${PORT}`);
  console.log(`API proxy: /api -> ${API_PROXY}`);
});
