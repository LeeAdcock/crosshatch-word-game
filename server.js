// Minimal static file server for Crosshatch.
// No game logic lives here — it only serves files from ./public.
//
//   node server.js            # serves on http://localhost:8000
//   PORT=3000 node server.js  # override the port

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // Strip query string and decode, then map "/" to index.html.
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Resolve within ROOT and reject any path that escapes it (path traversal).
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fall back to index.html for unknown paths (single-page friendliness).
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
          if (e2) {
            res.writeHead(404);
            res.end('Not found');
          } else {
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(html);
          }
        });
        return;
      }
      res.writeHead(500);
      res.end('Server error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Crosshatch running at http://localhost:${PORT}`);
});
