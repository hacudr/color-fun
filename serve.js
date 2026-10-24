// Tiny static server for trying the app locally: node serve.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8010;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(__dirname, path.normalize(urlPath === '/' ? '/index.html' : urlPath));
    if (!file.startsWith(__dirname)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Color Fun running at http://localhost:${PORT}`));
