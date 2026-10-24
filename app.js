'use strict';

const $ = (s) => document.querySelector(s);
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  drop(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

const DONE_AT = 0.9; // coloured this much, the rest fills itself in
const BRUSH = 44; // brush radius in screen points, before the grown-ups' setting

let shelves = [];
let colored = new Set(store.get('color.colored', []));
let stars = new Set(store.get('color.stars', []));
let brushScale = store.get('color.brush', 1.3);
let pieceCount = store.get('color.pieces', 9);
let current = null; // { shelf, page }

const saveSets = () => {
  store.set('color.colored', [...colored]);
  store.set('color.stars', [...stars]);
};

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== id));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
    img.onerror = () => reject(new Error('Could not load ' + src));
    img.src = src;
  });
}

const full = (p) => `pages/${p.slug}.webp`;
const line = (p) => `pages/line/${p.slug}.webp`;
const thumb = (p) => (colored.has(p.slug) ? `pages/thumbs/${p.slug}.webp` : `pages/thumbs/${p.slug}-line.webp`);

/* ---------- home and collections ---------- */

function renderHome() {
  const el = $('#shelves');
  el.textContent = '';
  for (const s of shelves) {
    const b = document.createElement('button');
    b.className = 'shelf-card';
    b.style.setProperty('--tint', s.tint);
    const cover = s.pages.find((p) => p.slug === s.cover) || s.pages[0];
    const done = s.pages.filter((p) => stars.has(p.slug)).length;
    b.innerHTML = `<div class="pic"><img src="pages/thumbs/${cover.slug}.webp" alt="" style="object-position:${s.focus || '50% 15%'}"></div>
      <div class="label"><span class="emoji">${s.emoji}</span><span>${s.name}</span>
      <span class="count"><b>★</b> ${done} / ${s.pages.length}</span></div>`;
    b.addEventListener('click', () => {
      sound.tap();
      openShelf(s);
    });
    el.append(b);
  }
}

function openShelf(s) {
  current = { shelf: s, page: null };
  $('#shelfName').textContent = `${s.emoji} ${s.name}`;
  const el = $('#cards');
  el.textContent = '';
  for (const p of s.pages) {
    const b = document.createElement('button');
    b.className = 'card';
    b.setAttribute('aria-label', p.title);
    const badge = stars.has(p.slug) ? '<span class="done">★</span>' : colored.has(p.slug) ? '<span class="dim">★</span>' : '';
    b.innerHTML = `<img src="${thumb(p)}" alt="" loading="lazy"><div class="badges">${badge}</div>`;
    b.addEventListener('click', () => {
      sound.tap();
      visit(p);
    });
    el.append(b);
  }
  show('shelf');
}

// A page not yet coloured is coloured; one that is asks which.
function visit(p) {
  current.page = p;
  if (!colored.has(p.slug)) return openColor(p);
  $('#chooseImg').src = `pages/thumbs/${p.slug}.webp`;
  $('#choose').hidden = false;
}
$('#chooseColor').addEventListener('click', () => {
  $('#choose').hidden = true;
  openColor(current.page, true);
});
$('#choosePuzzle').addEventListener('click', () => {
  $('#choose').hidden = true;
  openPuzzle(current.page);
});
$('#chooseClose').addEventListener('click', () => ($('#choose').hidden = true));

document.querySelectorAll('[data-go="home"]').forEach((b) =>
  b.addEventListener('click', () => {
    sound.tap();
    renderHome();
    show('home');
  })
);

/* ---------- colouring ---------- */

// The colours are already chosen: the finger paints the finished picture in,
// through a canvas whose brush is a pattern of it. The page is split into a
// grid of cells to count how much of it has been reached.
let paint = null;
const paintEl = $('#paint');
const pctx = paintEl.getContext('2d');
const sparkEl = $('#sparkles');
const sctx = sparkEl.getContext('2d');

async function openColor(p, fresh = false) {
  current.page = p;
  let img;
  try {
    img = await loadImage(full(p));
  } catch (err) {
    alert(err.message);
    return;
  }
  const w = img.naturalWidth, h = img.naturalHeight;
  const cell = Math.max(8, Math.round(Math.min(w, h) / 44));
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  paint = { p, img, w, h, cell, cols, rows, covered: new Uint8Array(cols * rows), count: 0, tenth: 0, done: false, fingers: new Map() };
  $('#lineImg').src = line(p);
  $('#fullImg').src = full(p);
  $('#fullImg').classList.remove('show');
  $('#page').classList.remove('glow');
  $('#meter').classList.remove('full');
  paintEl.width = w;
  paintEl.height = h;
  pctx.clearRect(0, 0, w, h);
  paint.pattern = pctx.createPattern(img, 'no-repeat');

  if (fresh) store.drop('color.paint.' + p.slug);
  const saved = store.get('color.paint.' + p.slug, null);
  if (saved && saved.length === cols * rows) {
    pctx.fillStyle = paint.pattern;
    pctx.beginPath();
    for (let i = 0; i < saved.length; i++) {
      if (saved[i] !== '1') continue;
      paint.covered[i] = 1;
      paint.count++;
      const cx = ((i % cols) + 0.5) * cell, cy = (Math.floor(i / cols) + 0.5) * cell;
      pctx.moveTo(cx + cell, cy);
      pctx.arc(cx, cy, cell, 0, Math.PI * 2);
    }
    pctx.fill();
    paint.tenth = Math.floor((10 * coverage()) / DONE_AT);
  }
  show('color');
  layoutColor();
  showMeter();
}

function layoutColor() {
  if (!paint || $('#color').hidden) return;
  const stage = $('#colorStage');
  const cs = getComputedStyle(stage);
  const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const aspect = paint.w / paint.h;
  const dw = Math.floor(Math.min(aw, ah * aspect));
  const dh = Math.floor(dw / aspect);
  $('#page').style.width = dw + 'px';
  $('#page').style.height = dh + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  sparkEl.width = stage.clientWidth * dpr;
  sparkEl.height = stage.clientHeight * dpr;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const coverage = () => paint.count / paint.covered.length;

function showMeter() {
  const f = Math.min(1, coverage() / DONE_AT);
  $('#meterFill').style.width = `calc((100% - 8px) * ${f.toFixed(3)})`;
  $('#meter').classList.toggle('full', f >= 1);
}

// marks every cell the brush reaches at (x, y), in picture pixels
function reach(x, y, r) {
  const { cell, cols, rows, covered } = paint;
  const near = r + cell * 0.4;
  const c0 = Math.max(0, Math.floor((x - near) / cell)), c1 = Math.min(cols - 1, Math.floor((x + near) / cell));
  const r0 = Math.max(0, Math.floor((y - near) / cell)), r1 = Math.min(rows - 1, Math.floor((y + near) / cell));
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      const i = rr * cols + cc;
      if (covered[i]) continue;
      const dx = (cc + 0.5) * cell - x, dy = (rr + 0.5) * cell - y;
      if (dx * dx + dy * dy <= near * near) {
        covered[i] = 1;
        paint.count++;
      }
    }
  }
}

function toPicture(e) {
  const rect = paintEl.getBoundingClientRect();
  const k = paint.w / rect.width;
  return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, k };
}

function stroke(from, to, r) {
  pctx.strokeStyle = paint.pattern;
  pctx.fillStyle = paint.pattern;
  pctx.lineCap = 'round';
  pctx.lineJoin = 'round';
  pctx.lineWidth = r * 2;
  pctx.beginPath();
  if (from.x === to.x && from.y === to.y) {
    pctx.arc(to.x, to.y, r, 0, Math.PI * 2);
    pctx.fill();
  } else {
    pctx.moveTo(from.x, from.y);
    pctx.lineTo(to.x, to.y);
    pctx.stroke();
  }
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(d / (paint.cell * 0.5)));
  for (let s = 0; s <= steps; s++) reach(from.x + ((to.x - from.x) * s) / steps, from.y + ((to.y - from.y) * s) / steps, r);
}

let meterQueued = false;
function progressed() {
  const tenth = Math.min(10, Math.floor((10 * coverage()) / DONE_AT));
  if (tenth > paint.tenth) {
    paint.tenth = tenth;
    sound.step(tenth);
  }
  if (!meterQueued) {
    meterQueued = true;
    requestAnimationFrame(() => {
      meterQueued = false;
      if (paint) showMeter();
    });
  }
  if (coverage() >= DONE_AT && !paint.done) finishColor();
}

const capture = (el, e) => {
  try { el.setPointerCapture(e.pointerId); } catch {}
};
const pageEl = $('#page');
pageEl.addEventListener('pointerdown', (e) => {
  if (!paint || paint.done) return;
  e.preventDefault();
  capture(pageEl, e);
  const pt = toPicture(e);
  const r = BRUSH * brushScale * pt.k;
  paint.fingers.set(e.pointerId, pt);
  stroke(pt, pt, r);
  sparkle(e.clientX, e.clientY);
  progressed();
});
pageEl.addEventListener('pointermove', (e) => {
  if (!paint || paint.done || !paint.fingers.has(e.pointerId)) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) {
    const pt = toPicture(ev);
    stroke(paint.fingers.get(e.pointerId), pt, BRUSH * brushScale * pt.k);
    paint.fingers.set(e.pointerId, pt);
  }
  sparkle(e.clientX, e.clientY);
  progressed();
});
function lift(e) {
  if (!paint || !paint.fingers.has(e.pointerId)) return;
  paint.fingers.delete(e.pointerId);
  if (!paint.done) savePaint();
}
pageEl.addEventListener('pointerup', lift);
pageEl.addEventListener('pointercancel', lift);

function savePaint() {
  let s = '';
  for (let i = 0; i < paint.covered.length; i++) s += paint.covered[i] ? '1' : '0';
  store.set('color.paint.' + paint.p.slug, s);
}

function finishColor() {
  paint.done = true;
  paint.fingers.clear();
  const p = paint.p;
  $('#fullImg').classList.add('show');
  $('#page').classList.add('glow');
  $('#meter').classList.add('full');
  $('#meterFill').style.width = 'calc(100% - 8px)';
  sound.sparkle();
  const rect = pageEl.getBoundingClientRect();
  confetti(rect.left + rect.width / 2, rect.top + rect.height / 3, 90);
  colored.add(p.slug);
  saveSets();
  store.drop('color.paint.' + p.slug);
  const mine = paint;
  setTimeout(() => {
    if (paint !== mine || $('#color').hidden) return;
    pctx.drawImage(mine.img, 0, 0);
    openPuzzle(p, true);
  }, 2600);
}

$('#colorBack').addEventListener('click', () => {
  sound.tap();
  if (paint && !paint.done) savePaint();
  paint = null;
  openShelf(current.shelf);
});

// sparkles that follow the finger
const sparks = [];
let sparking = false;
const SPARK_COLORS = ['#ffd93b', '#ff6fae', '#7fd0ee', '#ffffff', '#a66be0'];
function sparkle(cx, cy) {
  const rect = sparkEl.getBoundingClientRect();
  for (let i = 0; i < 2; i++) {
    sparks.push({
      x: cx - rect.left + (Math.random() - 0.5) * 40,
      y: cy - rect.top + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 1.2, vy: -0.6 - Math.random(),
      life: 1, size: 5 + Math.random() * 7,
      color: SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0],
    });
  }
  if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
  if (!sparking) {
    sparking = true;
    requestAnimationFrame(drawSparks);
  }
}
function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
function drawSparks() {
  sctx.clearRect(0, 0, sparkEl.width, sparkEl.height);
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.life -= 0.03;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    sctx.globalAlpha = s.life;
    sctx.fillStyle = s.color;
    starPath(sctx, s.x, s.y, s.size * (0.5 + s.life / 2));
    sctx.fill();
  }
  sctx.globalAlpha = 1;
  if (sparks.length) requestAnimationFrame(drawSparks);
  else sparking = false;
}

/* ---------- confetti ---------- */

const confEl = $('#confetti');
const cctx = confEl.getContext('2d');
const bits = [];
let confRunning = false;
const CONF_COLORS = ['#ff6fae', '#ffa23a', '#ffd93b', '#43c06b', '#3f9fe8', '#a66be0'];
function confetti(x, y, n = 120) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  confEl.width = innerWidth * dpr;
  confEl.height = innerHeight * dpr;
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    bits.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6,
      spin: Math.random() * 6, vs: (Math.random() - 0.5) * 0.4,
      w: 8 + Math.random() * 8, h: 5 + Math.random() * 5, star: Math.random() < 0.3,
      color: CONF_COLORS[i % CONF_COLORS.length], life: 1,
    });
  }
  if (!confRunning) {
    confRunning = true;
    requestAnimationFrame(drawConfetti);
  }
}
function drawConfetti() {
  cctx.clearRect(0, 0, innerWidth, innerHeight);
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.vy += 0.28;
    b.vx *= 0.99;
    b.x += b.vx;
    b.y += b.vy;
    b.spin += b.vs;
    b.life -= 0.006;
    if (b.y > innerHeight + 30 || b.life <= 0) {
      bits.splice(i, 1);
      continue;
    }
    cctx.save();
    cctx.translate(b.x, b.y);
    cctx.rotate(b.spin);
    cctx.fillStyle = b.color;
    if (b.star) {
      starPath(cctx, 0, 0, b.w * 0.8);
      cctx.fill();
    } else cctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    cctx.restore();
  }
  if (bits.length) requestAnimationFrame(drawConfetti);
  else {
    confRunning = false;
    cctx.clearRect(0, 0, innerWidth, innerHeight);
  }
}

/* ---------- puzzle ---------- */

// The grid of pieces nearest to square for the chosen count
function gridFor(n, aspect) {
  let best = null;
  for (let c = 1; c <= n; c++) {
    if (n % c) continue;
    const r = n / c;
    if (c < 2 && r < 2) continue;
    const off = Math.abs(Math.log((aspect * r) / c));
    if (!best || off < best.off) best = { cols: c, rows: r, off };
  }
  return best;
}

// One side of a piece, from (x0, y0) to (x1, y1), with a knob bulging out
// (s = 1), in (s = -1) or none (s = 0). The outward side is to the left of the
// direction of travel, which with the corners taken clockwise is outside.
function side(path, x0, y0, x1, y1, s, knob) {
  if (!s) return path.lineTo(x1, y1);
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = (dy / len) * knob * s, ny = (-dx / len) * knob * s;
  const P = (u, v) => [x0 + dx * u + nx * v, y0 + dy * u + ny * v];
  path.lineTo(...P(0.36, 0));
  path.bezierCurveTo(...P(0.42, 0), ...P(0.28, 0.95), ...P(0.5, 1));
  path.bezierCurveTo(...P(0.72, 0.95), ...P(0.58, 0), ...P(0.64, 0));
  path.lineTo(x1, y1);
}

let puzzle = null;
const tableEl = $('#table');
const boardEl = $('#board');
const ghostEl = $('#ghost');

async function openPuzzle(p, fromColor = false) {
  current.page = p;
  let img;
  try {
    img = await loadImage(full(p));
  } catch (err) {
    alert(err.message);
    return;
  }
  const { cols, rows } = gridFor(pieceCount, img.naturalWidth / img.naturalHeight);
  // which way each knob between two pieces points
  const across = [], down = [];
  for (let i = 0; i < cols * rows; i++) {
    across[i] = Math.random() < 0.5 ? 1 : -1; // between i and the piece to its right
    down[i] = Math.random() < 0.5 ? 1 : -1; // between i and the piece below
  }
  puzzle = { p, img, cols, rows, across, down, pieces: [], z: 10, drags: new Map(), won: false };
  show('puzzle');
  buildPuzzle(null);
  if (fromColor) {
    // the picture breaks apart from where it was
    puzzle.pieces.forEach((pc) => {
      pc.el.classList.remove('glide');
      setPos(pc, pc.hx, pc.hy);
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        puzzle.pieces.forEach((pc) => {
          pc.el.style.transition = 'transform 0.8s cubic-bezier(.3,1.3,.5,1)';
          setPos(pc, pc.sx, pc.sy);
          setTimeout(() => (pc.el.style.transition = ''), 850);
        })
      )
    );
    sound.pick();
  }
}

// Lays the board and pieces out for the table's size. `keep` carries the
// state across a change of size: which pieces are home, where the rest lie.
function buildPuzzle(keep) {
  const { img, cols, rows } = puzzle;
  const W = tableEl.clientWidth, H = tableEl.clientHeight;
  const aspect = img.naturalWidth / img.naturalHeight;
  const pad = 18;
  // board beside the pieces, or above them, whichever gives the larger board
  const fit = (bw, bh) => {
    const w = Math.min(bw, bh * aspect);
    return { w, h: w / aspect };
  };
  const wide = fit(W * 0.58 - pad * 2, H - pad * 2);
  const stack = fit(W - pad * 2, H * 0.6 - pad * 2);
  const beside = wide.w * wide.h >= stack.w * stack.h;
  const b = beside ? wide : stack;
  const bw = Math.floor(b.w / cols) * cols, bh = Math.floor(b.h / rows) * rows;
  const bx = beside ? pad + Math.floor((W * 0.58 - pad * 2 - bw) / 2) : Math.floor((W - bw) / 2);
  const by = beside ? Math.floor((H - bh) / 2) : pad;
  const tray = beside ? { x: W * 0.58, y: pad, w: W * 0.42 - pad, h: H - pad * 2 } : { x: pad, y: H * 0.6, w: W - pad * 2, h: H * 0.4 - pad };
  Object.assign(boardEl.style, { left: bx + 'px', top: by + 'px', width: bw + 'px', height: bh + 'px' });
  const pw = bw / cols, ph = bh / rows;
  const knob = Math.min(pw, ph) * 0.2;
  const m = Math.ceil(knob + 4);
  Object.assign(puzzle, { W, H, bx, by, bw, bh, pw, ph, m, knob, tray });

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  puzzle.pieces.forEach((pc) => pc.el.remove());
  puzzle.pieces = [];
  const n = cols * rows;
  for (let id = 0; id < n; id++) {
    const c = id % cols, r = Math.floor(id / cols);
    const top = r === 0 ? 0 : -puzzle.down[id - cols];
    const right = c === cols - 1 ? 0 : puzzle.across[id];
    const bottom = r === rows - 1 ? 0 : puzzle.down[id];
    const left = c === 0 ? 0 : -puzzle.across[id - 1];
    const path = new Path2D();
    path.moveTo(m, m);
    side(path, m, m, m + pw, m, top, knob);
    side(path, m + pw, m, m + pw, m + ph, right, knob);
    side(path, m + pw, m + ph, m, m + ph, bottom, knob);
    side(path, m, m + ph, m, m, left, knob);
    path.closePath();
    const el = document.createElement('canvas');
    el.className = 'piece';
    el.width = Math.ceil((pw + 2 * m) * dpr);
    el.height = Math.ceil((ph + 2 * m) * dpr);
    el.style.width = pw + 2 * m + 'px';
    el.style.height = ph + 2 * m + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.save();
    ctx.clip(path);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, m - c * pw, m - r * ph, bw, bh);
    ctx.restore();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke(path);
    const pc = { id, el, path, hx: bx + c * pw - m, hy: by + r * ph - m, home: false };
    puzzle.pieces.push(pc);
    tableEl.append(el);
  }

  // the faint picture and outlines on the board, to show where pieces go
  ghostEl.width = bw * dpr;
  ghostEl.height = bh * dpr;
  const g = ghostEl.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, bw, bh);
  g.globalAlpha = 0.22;
  g.drawImage(img, 0, 0, bw, bh);
  g.globalAlpha = 1;
  g.setLineDash([6, 6]);
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(122, 80, 160, 0.45)';
  for (const pc of puzzle.pieces) {
    g.save();
    g.translate(pc.hx - bx, pc.hy - by);
    g.stroke(pc.path);
    g.restore();
  }

  // deal the pieces out into the tray, in a loose grid
  const order = puzzle.pieces.slice().sort(() => Math.random() - 0.5);
  const fw = pw + 2 * m, fh = ph + 2 * m;
  const tc = Math.max(1, Math.round(Math.sqrt((n * tray.w * fh) / (tray.h * fw))));
  const tr = Math.ceil(n / tc);
  // pieces wait in the tray a little smaller, and grow when picked up
  puzzle.small = Math.min(1, (tray.w / tc - 14) / fw, (tray.h / tr - 14) / fh);
  order.forEach((pc, k) => {
    const sc = k % tc, sr = Math.floor(k / tc);
    const cx = tray.x + ((sc + 0.5) * tray.w) / tc + (Math.random() - 0.5) * 20;
    const cy = tray.y + ((sr + 0.5) * tray.h) / tr + (Math.random() - 0.5) * 20;
    pc.sx = clamp(cx - fw / 2, 0, W - fw);
    pc.sy = clamp(cy - fh / 2, 0, H - fh);
  });

  for (const pc of puzzle.pieces) {
    const was = keep && keep.get(pc.id);
    if (was && was.home) {
      pc.home = true;
      pc.el.classList.add('home');
      pc.el.style.zIndex = 1;
      setPos(pc, pc.hx, pc.hy);
    } else {
      if (was) {
        pc.sx = clamp(was.fx * W, 0, W - fw);
        pc.sy = clamp(was.fy * H, 0, H - fh);
      }
      pc.el.style.zIndex = ++puzzle.z;
      setPos(pc, pc.sx, pc.sy);
    }
  }
  boardEl.classList.toggle('won', puzzle.won);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function setPos(pc, x, y, big) {
  pc.x = x;
  pc.y = y;
  const t = puzzle.tray;
  const cx = x + puzzle.m + puzzle.pw / 2, cy = y + puzzle.m + puzzle.ph / 2;
  const inTray = cx > t.x && cy > t.y && cx < t.x + t.w && cy < t.y + t.h;
  pc.scale = big || pc.home || !inTray ? 1 : puzzle.small;
  pc.el.style.transform = `translate(${x}px, ${y}px) scale(${pc.scale})`;
}

const hit = document.createElement('canvas').getContext('2d');
function pieceAt(x, y) {
  const loose = puzzle.pieces.filter((pc) => !pc.home && !pc.dragged).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex);
  const { m, pw, ph } = puzzle;
  const local = (pc) => {
    const k = pc.scale || 1;
    const cx = pc.x + m + pw / 2, cy = pc.y + m + ph / 2;
    return [(x - cx) / k + m + pw / 2, (y - cy) / k + m + ph / 2];
  };
  for (const pc of loose) if (hit.isPointInPath(pc.path, ...local(pc))) return pc;
  // a small finger near a piece still picks it up
  for (const pc of loose) {
    const [lx, ly] = local(pc);
    if (lx > m / 2 && ly > m / 2 && lx < puzzle.pw + m * 1.5 && ly < puzzle.ph + m * 1.5) return pc;
  }
  return null;
}

function tablePoint(e) {
  const rect = tableEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

tableEl.addEventListener('pointerdown', (e) => {
  if (!puzzle || puzzle.won) return;
  const pt = tablePoint(e);
  const pc = pieceAt(pt.x, pt.y);
  if (!pc) return;
  e.preventDefault();
  capture(tableEl, e);
  pc.dragged = true;
  pc.el.classList.remove('glide');
  pc.el.classList.add('lifted');
  pc.el.style.zIndex = ++puzzle.z;
  // the piece grows about the finger, so keep the finger on the same spot of it
  const k = pc.scale || 1;
  const ox = pc.x + (puzzle.pw / 2 + puzzle.m) * (1 - k), oy = pc.y + (puzzle.ph / 2 + puzzle.m) * (1 - k);
  const fx = (pt.x - ox) / k, fy = (pt.y - oy) / k;
  pc.el.classList.add('glide');
  setPos(pc, pt.x - fx, pt.y - fy, true);
  setTimeout(() => pc.el.classList.remove('glide'), 250);
  puzzle.drags.set(e.pointerId, { pc, dx: fx, dy: fy });
  sound.pick();
});
tableEl.addEventListener('pointermove', (e) => {
  const d = puzzle && puzzle.drags.get(e.pointerId);
  if (!d) return;
  const pt = tablePoint(e);
  const fw = puzzle.pw + 2 * puzzle.m, fh = puzzle.ph + 2 * puzzle.m;
  setPos(d.pc, clamp(pt.x - d.dx, -fw / 3, puzzle.W - (fw * 2) / 3), clamp(pt.y - d.dy, -fh / 3, puzzle.H - (fh * 2) / 3), true);
});
function drop(e) {
  const d = puzzle && puzzle.drags.get(e.pointerId);
  if (!d) return;
  puzzle.drags.delete(e.pointerId);
  const pc = d.pc;
  pc.dragged = false;
  pc.el.classList.remove('lifted');
  const near = Math.min(puzzle.pw, puzzle.ph) * 0.42;
  if (Math.hypot(pc.x - pc.hx, pc.y - pc.hy) < near) {
    pc.home = true;
    pc.el.classList.add('glide', 'home');
    pc.el.style.zIndex = 1;
    setPos(pc, pc.hx, pc.hy);
    const placed = puzzle.pieces.filter((q) => q.home).length;
    sound.snap(placed);
    const rect = tableEl.getBoundingClientRect();
    burst(rect.left + pc.hx + puzzle.m + puzzle.pw / 2, rect.top + pc.hy + puzzle.m + puzzle.ph / 2);
    if (placed === puzzle.pieces.length) winPuzzle();
  } else {
    // back to tray size if it was put down in the tray
    pc.el.classList.add('glide');
    setPos(pc, pc.x, pc.y);
  }
}
tableEl.addEventListener('pointerup', drop);
tableEl.addEventListener('pointercancel', drop);

function burst(x, y) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!confRunning) {
    confEl.width = innerWidth * dpr;
    confEl.height = innerHeight * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    bits.push({ x, y, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5 - 2, spin: 0, vs: 0.2, w: 12, h: 12, star: true, color: '#ffd93b', life: 0.5 });
  }
  if (!confRunning) {
    confRunning = true;
    requestAnimationFrame(drawConfetti);
  }
}

function winPuzzle() {
  puzzle.won = true;
  const p = puzzle.p;
  stars.add(p.slug);
  colored.add(p.slug);
  saveSets();
  setTimeout(() => {
    if (!puzzle || puzzle.p !== p) return;
    boardEl.classList.add('won');
    const g = ghostEl.getContext('2d');
    g.clearRect(0, 0, puzzle.bw, puzzle.bh);
    g.drawImage(puzzle.img, 0, 0, puzzle.bw, puzzle.bh);
    puzzle.pieces.forEach((pc) => (pc.el.style.opacity = 0));
    sound.fanfare();
    confetti(innerWidth / 2, innerHeight / 3, 160);
  }, 350);
  setTimeout(() => {
    if (puzzle && puzzle.p === p) $('#yay').hidden = false;
  }, 2200);
}

$('#puzzleBack').addEventListener('click', () => {
  sound.tap();
  leavePuzzle();
  openShelf(current.shelf);
});
function leavePuzzle() {
  if (puzzle) puzzle.pieces.forEach((pc) => pc.el.remove());
  puzzle = null;
  boardEl.classList.remove('won');
}

$('#yayHome').addEventListener('click', () => {
  $('#yay').hidden = true;
  leavePuzzle();
  openShelf(current.shelf);
});
$('#yayAgain').addEventListener('click', () => {
  $('#yay').hidden = true;
  const p = current.page;
  leavePuzzle();
  openPuzzle(p);
});
$('#yayNext').addEventListener('click', () => {
  $('#yay').hidden = true;
  leavePuzzle();
  const list = current.shelf.pages;
  const at = list.indexOf(current.page);
  // the next page not yet coloured, or else simply the next
  const after = list.slice(at + 1).concat(list.slice(0, at + 1));
  const next = after.find((q) => !colored.has(q.slug)) || after[0];
  openShelf(current.shelf);
  visit(next);
});

/* ---------- grown-ups ---------- */

let holdTimer = null;
const gear = $('#gear');
gear.addEventListener('pointerdown', () => {
  gear.classList.add('holding');
  holdTimer = setTimeout(openGrown, 2000);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((t) =>
  gear.addEventListener(t, () => {
    gear.classList.remove('holding');
    clearTimeout(holdTimer);
  })
);

function showGrown() {
  $('#soundOn').checked = sound.on;
  document.querySelectorAll('#brushSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.brush === brushScale));
  document.querySelectorAll('#pieceSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.pieces === pieceCount));
}
function openGrown() {
  gear.classList.remove('holding');
  showGrown();
  $('#grown').hidden = false;
}
$('#soundOn').addEventListener('change', (e) => sound.set(e.target.checked));
$('#brushSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  brushScale = +b.dataset.brush;
  store.set('color.brush', brushScale);
  showGrown();
});
$('#pieceSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  pieceCount = +b.dataset.pieces;
  store.set('color.pieces', pieceCount);
  showGrown();
});
$('#resetAll').addEventListener('click', () => {
  if (!confirm('Forget every coloured picture and star?')) return;
  Object.keys(localStorage).filter((k) => k.startsWith('color.paint.')).forEach((k) => store.drop(k));
  colored = new Set();
  stars = new Set();
  saveSets();
  renderHome();
});
$('#grownClose').addEventListener('click', () => ($('#grown').hidden = true));

/* ---------- start ---------- */

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    layoutColor();
    if (puzzle && !$('#puzzle').hidden) {
      const keep = new Map(puzzle.pieces.map((pc) => [pc.id, { home: pc.home, fx: pc.x / puzzle.W, fy: pc.y / puzzle.H }]));
      buildPuzzle(keep);
    }
  }, 150);
});
// no pinching the whole page larger by accident
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

async function boot() {
  try {
    shelves = await (await fetch('pages.json')).json();
  } catch {
    document.body.textContent = 'Could not load the pictures.';
    return;
  }
  renderHome();
  show('home');
  if ('serviceWorker' in navigator && (location.hostname !== 'localhost' || location.search.includes('sw'))) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
