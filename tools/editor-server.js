// The colour editor: node tools/editor-server.js, then open
// http://localhost:8011/tools/editor.html
// Tap a region, give it a colour, and Save writes it into tools/spec/<slug>.txt
// and rebuilds the page. Runs on this computer only; it is not part of the app.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const seg = require('./seg');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8011;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png' };

// a page's regions take a second or two to work out, so keep the last few
const loaded = new Map();
function page(slug) {
  if (!seg.sources[slug]) throw new Error('no page ' + slug);
  if (!loaded.has(slug)) {
    if (loaded.size > 4) loaded.delete(loaded.keys().next().value);
    loaded.set(slug, seg.load(slug));
  }
  return loaded.get(slug);
}

const toHex = (name) => '#' + seg.hex(name).map((v) => v.toString(16).padStart(2, '0')).join('');

function info(slug) {
  const { img, seg: s } = page(slug);
  const { colour, fallback, chosen } = seg.resolve(slug, img, s);
  const colours = {};
  for (const id of s.pole.keys()) colours[id] = toHex(colour.get(id) || fallback);
  return { slug, w: img.w, h: img.h, colours, chosen: [...chosen].filter((id) => s.pole.has(id)) };
}

function pages() {
  const groups = JSON.parse(fs.readFileSync(path.join(__dirname, 'collections.json'), 'utf8'));
  return groups.map((g) => ({ name: g.name, pages: g.pages.map(([slug, title]) => ({ slug, title })) }));
}

// Your choices are added at the end of the spec, where they win over anything above.
function save(slug, body) {
  const byColour = new Map();
  for (const [id, hex] of Object.entries(body.assign || {})) {
    if (!/^#[0-9a-f]{6}$/i.test(hex) || !/^\d+$/.test(id)) throw new Error('bad colour ' + id + ' ' + hex);
    if (!byColour.has(hex)) byColour.set(hex, []);
    byColour.get(hex).push(id);
  }
  const lines = [`// chosen in the editor, ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`];
  for (const [hex, ids] of byColour) lines.push(`${hex} ${ids.join(' ')}`);
  for (const p of body.patches || []) {
    if (!/^#[0-9a-f]{6}$/i.test(p.hex) || !Number.isInteger(p.region)) throw new Error('bad patch');
    lines.push(`patch ${p.hex} ${p.region} ${p.poly.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ')}`);
  }
  if (lines.length === 1) return;
  const file = path.join(__dirname, 'spec', `${slug}.txt`);
  const before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, before.replace(/\s*$/, '\n') + '\n' + lines.join('\n') + '\n');
  seg.build(slug);
  execFileSync(process.execPath, [path.join(__dirname, 'release.js')], { stdio: 'inherit' });
}

function send(res, code, type, data) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    try {
      let m;
      if (url === '/api/pages') return send(res, 200, TYPES['.json'], JSON.stringify(pages()));
      if (url === '/api/palette') return send(res, 200, TYPES['.json'], JSON.stringify(seg.PALETTE));
      if ((m = url.match(/^\/api\/info\/([\w-]+)$/))) return send(res, 200, TYPES['.json'], JSON.stringify(info(m[1])));
      if ((m = url.match(/^\/api\/labels\/([\w-]+)$/))) {
        const full = page(m[1]).seg.full;
        const out = new Uint16Array(full.length);
        for (let i = 0; i < full.length; i++) out[i] = full[i];
        return send(res, 200, 'application/octet-stream', Buffer.from(out.buffer));
      }
      if ((m = url.match(/^\/api\/gray\/([\w-]+)$/))) return send(res, 200, 'application/octet-stream', page(m[1]).img.g);
      if ((m = url.match(/^\/api\/save\/([\w-]+)$/)) && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            save(m[1], JSON.parse(body));
            send(res, 200, TYPES['.json'], '{"ok":true}');
          } catch (err) {
            send(res, 400, TYPES['.json'], JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
      const file = path.join(ROOT, path.normalize(url === '/' ? '/tools/editor.html' : url));
      if (!file.startsWith(ROOT)) return send(res, 403, 'text/plain', 'no');
      fs.readFile(file, (err, data) => (err ? send(res, 404, 'text/plain', 'Not found') : send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', data)));
    } catch (err) {
      send(res, 500, 'text/plain', err.message);
    }
  })
  .listen(PORT, () => console.log(`Colour editor at http://localhost:${PORT}/tools/editor.html`));
