// Writes pages.json (the collections, keeping only pages that have been built)
// and stamps sw.js with a version made from every file, so devices fetch the
// new set the next time they are online.  node tools/release.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const collections = JSON.parse(fs.readFileSync(path.join(__dirname, 'collections.json'), 'utf8'));
const built = (slug) => ['', 'line/', 'thumbs/'].every((d) => fs.existsSync(path.join(ROOT, 'pages', d, `${slug}.webp`)));

const out = collections
  .map((c) => ({ ...c, pages: c.pages.filter(([slug]) => built(slug)).map(([slug, title]) => ({ slug, title })) }))
  .filter((c) => c.pages.length);
fs.writeFileSync(path.join(ROOT, 'pages.json'), JSON.stringify(out, null, 1) + '\n');

const hash = crypto.createHash('sha1');
const files = ['index.html', 'style.css', 'app.js', 'sound.js', 'pages.json', 'manifest.webmanifest'];
for (const c of out) for (const p of c.pages) files.push(`pages/${p.slug}.webp`, `pages/line/${p.slug}.webp`, `pages/thumbs/${p.slug}.webp`, `pages/thumbs/${p.slug}-line.webp`);
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(ROOT, f)));
const version = hash.digest('hex').slice(0, 10);
const swPath = path.join(ROOT, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
const total = out.reduce((n, c) => n + c.pages.length, 0);
console.log(`pages.json: ${total} pages in ${out.length} collections; sw.js version ${version}`);
