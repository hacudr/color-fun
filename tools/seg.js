// Splits a line-art page into its enclosed regions, and paints them.
//
//   node tools/seg.js overlay <slug>    numbered regions, for choosing colours (build/<slug>-a.png, -b.png)
//   node tools/seg.js build <slug>|all  coloured page, line art and thumbnails from tools/spec/<slug>.txt
//
// The pages are listed in tools/sources.json (slug -> original file).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const PALETTE = require('./palette');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '..', 'minnie and friends');
const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));

const DARK = 165; // darker than this is a line
const SMALL = 40; // regions smaller than this are only specks between lines

function decode(file) {
  const info = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = info.split(',').map(Number);
  const g = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 });
  return { w, h, g };
}

function encode(buf, w, h, fmt, out, extra = []) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', fmt, '-s', `${w}x${h}`, '-i', '-', ...extra, out], { input: buf, maxBuffer: 1 << 28 });
}

// Crops to the page's drawn frame, leaving out the site's name printed under it.
function crop(img) {
  const { w, h, g } = img;
  const rowDark = (y) => { let n = 0; for (let x = 0; x < w; x++) if (g[y * w + x] < DARK) n++; return n; };
  // The site's name sits in a gap in the frame's bottom line: white it out and
  // draw the line on through.
  let yb = -1;
  for (let y = h - 1; y > h * 0.85; y--) if (rowDark(y) > w * 0.4) { yb = y; break; }
  if (yb > 0) {
    let ys = yb;
    while (ys > 0 && rowDark(ys - 1) > w * 0.4) ys--;
    const ym = (ys + yb) >> 1;
    const dark = (x) => g[ym * w + x] < DARK;
    let xs = -1;
    for (let x = Math.round(w * 0.3); x < w - 4; x++) if (!dark(x) && !dark(x + 1) && !dark(x + 2) && !dark(x + 3)) { xs = x; break; }
    let xr = w - 1;
    while (xr > w * 0.5 && !dark(xr)) xr--; // the frame's right side
    let xe = -1;
    for (let x = xr; x > xs; x--) if (!dark(x)) { xe = x; break; }
    if (xs > 0 && xe > xs && xe - xs < w * 0.6) {
      const y0 = Math.max(0, Math.round(ym - w * 0.03));
      for (let y = y0; y < h; y++) for (let x = xs; x <= xe; x++) g[y * w + x] = 255;
      for (let y = ys; y <= yb; y++) for (let x = xs; x <= xe; x++) g[y * w + x] = g[y * w + xs - 3];
    }
  }
  const colDark = (x) => { let n = 0; for (let y = 0; y < h; y++) if (g[y * w + x] < DARK) n++; return n; };
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  for (let y = 0; y < h * 0.12; y++) if (rowDark(y) > w * 0.5) { top = y; break; }
  for (let y = h - 1; y > h * 0.85; y--) if (rowDark(y) > w * 0.5) { bottom = y; break; }
  for (let x = 0; x < w * 0.12; x++) if (colDark(x) > h * 0.5) { left = x; break; }
  for (let x = w - 1; x > w * 0.88; x--) if (colDark(x) > h * 0.5) { right = x; break; }
  const m = 2;
  top = Math.max(0, top - m); left = Math.max(0, left - m);
  bottom = Math.min(h - 1, bottom + m); right = Math.min(w - 1, right + m);
  const nw = right - left + 1, nh = bottom - top + 1;
  const ng = Buffer.alloc(nw * nh);
  for (let y = 0; y < nh; y++) g.copy(ng, y * nw, (y + top) * w + left, (y + top) * w + left + nw);
  // white outside the frame's rounded corners, and anything left of the site's name
  return { w: nw, h: nh, g: ng };
}

function segment(img) {
  const { w, h, g } = img;
  const N = w * h;
  // lines, thickened by a pixel so that hairline gaps do not join two regions
  const line = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (g[i] < DARK) line[i] = 1;
  const wall = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!line[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) wall[Y * w + X] = 1;
    }
  }
  // the page's edge counts as a wall
  for (let x = 0; x < w; x++) wall[x] = wall[(h - 1) * w + x] = 1;
  for (let y = 0; y < h; y++) wall[y * w] = wall[y * w + w - 1] = 1;

  const label = new Int32Array(N);
  const areas = [0];
  const stack = new Int32Array(N);
  let next = 1;
  for (let s = 0; s < N; s++) {
    if (wall[s] || label[s]) continue;
    let sp = 0, area = 0;
    stack[sp++] = s; label[s] = next;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % w;
      if (x > 0 && !wall[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && !wall[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (p >= w && !wall[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (p < N - w && !wall[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    areas.push(area); next++;
  }
  // specks go back to the lines
  for (let i = 0; i < N; i++) if (label[i] && areas[label[i]] < SMALL) label[i] = 0;

  // poles: the point of each region farthest from its edge, for its number
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = label[i] ? 1e9 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!dist[i]) continue;
    let d = dist[i];
    if (x > 0) d = Math.min(d, dist[i - 1] + 1);
    if (y > 0) d = Math.min(d, dist[i - w] + 1);
    if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + 1.414);
    if (x < w - 1 && y > 0) d = Math.min(d, dist[i - w + 1] + 1.414);
    dist[i] = d;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!dist[i]) continue;
    let d = dist[i];
    if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
    if (y < h - 1) d = Math.min(d, dist[i + w] + 1);
    if (x < w - 1 && y < h - 1) d = Math.min(d, dist[i + w + 1] + 1.414);
    if (x > 0 && y < h - 1) d = Math.min(d, dist[i + w - 1] + 1.414);
    dist[i] = d;
  }
  const pole = new Map();
  for (let i = 0; i < N; i++) {
    const l = label[i]; if (!l) continue;
    const b = pole.get(l);
    if (!b || dist[i] > b.d) pole.set(l, { d: dist[i], x: i % w, y: (i / w) | 0 });
  }

  // every other pixel, lines included, joins the nearest region
  const full = label.slice();
  let queue = [];
  for (let i = 0; i < N; i++) if (full[i]) queue.push(i);
  while (queue.length) {
    const nq = [];
    for (const p of queue) {
      const x = p % w, l = full[p];
      if (x > 0 && !full[p - 1]) { full[p - 1] = l; nq.push(p - 1); }
      if (x < w - 1 && !full[p + 1]) { full[p + 1] = l; nq.push(p + 1); }
      if (p >= w && !full[p - w]) { full[p - w] = l; nq.push(p - w); }
      if (p < N - w && !full[p + w]) { full[p + w] = l; nq.push(p + w); }
    }
    queue = nq;
  }
  // which regions touch, and by how much
  const touch = new Map();
  const bump = (a, b) => {
    if (a === b) return;
    let m = touch.get(a); if (!m) touch.set(a, (m = new Map()));
    m.set(b, (m.get(b) || 0) + 1);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x < w - 1) { bump(full[i], full[i + 1]); bump(full[i + 1], full[i]); }
    if (y < h - 1) { bump(full[i], full[i + w]); bump(full[i + w], full[i]); }
  }
  const realArea = new Map();
  for (let i = 0; i < N; i++) if (label[i]) realArea.set(label[i], (realArea.get(label[i]) || 0) + 1);
  return { label, full, pole, touch, area: realArea };
}

/* ---------- numbered overlay ---------- */

const FONT = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

function hue(n) {
  // a steady, light colour for each region number
  const a = (n * 137.508) % 360;
  const c = (k) => { const v = (k + a / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(v - 3, 9 - v, 1)); };
  return [c(0), c(8), c(4)].map((v) => Math.round(150 + 105 * (1 - v)));
}

function overlay(slug, minArea) {
  const img = crop(decode(path.join(SRC, sources[slug])));
  const seg = segment(img);
  const { w, h, g } = img;
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const [r, gg, b] = seg.label[i] ? hue(seg.label[i]) : [255, 255, 255];
    const k = g[i] / 255;
    out[i * 3] = r * k; out[i * 3 + 1] = gg * k; out[i * 3 + 2] = b * k;
  }
  const S = 3;
  const put = (x, y, rgb) => { if (x >= 0 && y >= 0 && x < w && y < h) { const i = (y * w + x) * 3; out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; } };
  const text = (str, cx, cy) => {
    const tw = str.length * 4 * S - S, th = 5 * S;
    const x0 = Math.round(cx - tw / 2), y0 = Math.round(cy - th / 2);
    for (let y = -2; y < th + 2; y++) for (let x = -2; x < tw + 2; x++) put(x0 + x, y0 + y, [255, 255, 255]);
    [...str].forEach((ch, k) => FONT[ch].forEach((row, ry) => [...row].forEach((bit, rx) => {
      if (bit === '1') for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) put(x0 + k * 4 * S + rx * S + b, y0 + ry * S + a, [200, 0, 0]);
    })));
  };
  let shown = 0;
  for (const [l, p] of seg.pole) if (seg.area.get(l) >= minArea) { text(String(l), p.x, p.y); shown++; }
  const half = Math.ceil(h / 2) + 40;
  const top = out.subarray(0, half * w * 3);
  const bottom = out.subarray((h - half) * w * 3);
  encode(Buffer.from(top), w, half, 'rgb24', path.join(ROOT, 'build', `${slug}-a.png`));
  encode(Buffer.from(bottom), w, half, 'rgb24', path.join(ROOT, 'build', `${slug}-b.png`));
  console.log(`${slug}: ${seg.pole.size} regions, ${shown} numbered (>= ${minArea} px), ${w}x${h}; halves overlap 80 px, b starts at y=${h - half}`);
}

/* ---------- colouring ---------- */

function hex(c) {
  const v = PALETTE[c] || c;
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`unknown colour "${c}"`);
  return [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16));
}

// spec: one line per colour, "name 12 15 18", plus "default name"
function readSpec(slug) {
  const text = fs.readFileSync(path.join(__dirname, 'spec', `${slug}.txt`), 'utf8');
  const colour = new Map();
  const islands = [];
  const patches = [];
  let fallback = 'white';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const [name, ...ids] = line.split(/\s+/);
    if (name === 'default') { fallback = ids[0]; continue; }
    // "islands white 3 7": uncoloured regions that lie mostly against 3 or 7 are white
    // "patch red 3 10,10 40,10 40,40": pixels of region 3 inside that outline are red,
    // for an outline with a gap that let two parts run together
    if (name === 'patch') { hex(ids[0]); patches.push({ name: ids[0], region: +ids[1], poly: ids.slice(2).map((p) => p.split(',').map(Number)) }); continue; }
    if (name === 'islands') { hex(ids[0]); islands.push({ name: ids[0], around: new Set(ids.slice(1).map(Number)) }); continue; }
    hex(name);
    for (const id of ids) {
      const m = id.match(/^(\d+)-(\d+)$/);
      if (m) for (let k = +m[1]; k <= +m[2]; k++) colour.set(k, name);
      else colour.set(+id, name);
    }
  }
  return { colour, fallback, islands, patches };
}

function build(slug) {
  const img = crop(decode(path.join(SRC, sources[slug])));
  const seg = segment(img);
  const { colour, fallback, islands, patches } = readSpec(slug);
  const all0 = [...seg.pole.keys()];
  // an island may be made of several parts (a lantern's top and bottom), so
  // parts already made islands count as surroundings for the rest
  for (const { name, around } of islands) {
    const made = new Set();
    for (let pass = 0; pass < 4; pass++) for (const l of all0) {
      if (colour.has(l) || around.has(l)) continue;
      let inside = 0, edge = 0, loose = 0;
      for (const [n, k] of seg.touch.get(l) || []) {
        edge += k;
        if (around.has(n) || made.has(n)) inside += k;
        else if (!colour.has(n)) loose += k;
      }
      // mostly surrounded, or half surrounded with the rest still uncoloured parts
      if (edge && (inside / edge > 0.85 || (inside / edge > 0.45 && (inside + loose) / edge > 0.97))) { colour.set(l, name); made.add(l); }
    }
  }
  // regions given no colour take the colour of the neighbour they share most edge with
  const all = [...seg.pole.keys()];
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (const l of all) {
      if (colour.has(l)) continue;
      let best = null, most = 0;
      for (const [n, k] of seg.touch.get(l) || []) if (colour.has(n) && k > most) { most = k; best = n; }
      if (best !== null) { colour.set(l, colour.get(best)); changed = true; }
    }
    if (!changed) break;
  }
  const { w, h, g } = img;
  const out = Buffer.alloc(w * h * 3);
  const cache = new Map();
  const over = new Map();
  for (const { name, region, poly } of patches) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    for (let y = Math.max(0, Math.min(...ys)); y <= Math.min(h - 1, Math.max(...ys)); y++) {
      for (let x = Math.max(0, Math.min(...xs)); x <= Math.min(w - 1, Math.max(...xs)); x++) {
        if (seg.full[y * w + x] !== region) continue;
        let inside = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const [xa, ya] = poly[a], [xb, yb] = poly[b];
          if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
        }
        if (inside) over.set(y * w + x, name);
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const name = over.get(i) || colour.get(seg.full[i]) || fallback;
    let rgb = cache.get(name); if (!rgb) cache.set(name, (rgb = hex(name)));
    const k = g[i] / 255;
    out[i * 3] = rgb[0] * k; out[i * 3 + 1] = rgb[1] * k; out[i * 3 + 2] = rgb[2] * k;
  }
  const webp = ['-c:v', 'libwebp', '-quality', '82', '-compression_level', '6'];
  encode(out, w, h, 'rgb24', path.join(ROOT, 'pages', `${slug}.webp`), webp);
  encode(g, w, h, 'gray', path.join(ROOT, 'pages', 'line', `${slug}.webp`), ['-pix_fmt', 'yuv420p', ...webp]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(ROOT, 'pages', `${slug}.webp`), '-vf', 'scale=480:-2:flags=lanczos', ...webp, path.join(ROOT, 'pages', 'thumbs', `${slug}.webp`)]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(ROOT, 'pages', 'line', `${slug}.webp`), '-vf', 'scale=480:-2:flags=lanczos', ...webp, path.join(ROOT, 'pages', 'thumbs', `${slug}-line.webp`)]);
  const missing = [...seg.pole.keys()].filter((l) => !colour.has(l)).length;
  console.log(`${slug}: built ${w}x${h}${missing ? `, ${missing} regions fell back to ${fallback}` : ''}`);
}

const [cmd, arg, min] = process.argv.slice(2);
if (cmd === 'overlay') overlay(arg, +(min || 600));
else if (cmd === 'at') {
  // node tools/seg.js at <slug> x,y x,y ...  (pixels of the overlay)
  const img = crop(decode(path.join(SRC, sources[arg])));
  const seg = segment(img);
  for (const xy of process.argv.slice(4)) { const [x, y] = xy.split(',').map(Number); console.log(xy, '->', seg.full[y * img.w + x]); }
}
else if (cmd === 'build') (arg === 'all' ? Object.keys(sources).filter((s) => fs.existsSync(path.join(__dirname, 'spec', `${s}.txt`))) : [arg]).forEach(build);
else console.log('usage: node tools/seg.js overlay <slug> [minArea] | build <slug>|all');
