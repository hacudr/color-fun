// Keeps the whole app on the device, so it plays with no internet.
// On the first visit every file is fetched and kept; after that everything is
// answered from the device. `node tools/release.js` changes VERSION whenever a
// file changes, and the browser then fetches the new set once it is online.
const VERSION = '9c0f55ebb0';
const CACHE = 'color-fun-' + VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'sound.js', 'pages.json', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const pages = await (await fetch('pages.json', { cache: 'reload' })).json();
      const files = [...SHELL];
      for (const shelf of pages) {
        for (const p of shelf.pages) {
          files.push(`pages/${p.slug}.webp`, `pages/line/${p.slug}.webp`, `pages/thumbs/${p.slug}.webp`, `pages/thumbs/${p.slug}-line.webp`);
        }
      }
      // a few at a time, so a slow connection is not swamped
      for (let i = 0; i < files.length; i += 8) {
        await Promise.all(
          files.slice(i, i + 8).map((f) =>
            fetch(f, { cache: 'reload' }).then((res) => res.ok && cache.put(f, res)).catch(() => {})
          )
        );
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        // offline and never seen: the app's own page is the best answer
        return (await cache.match('index.html')) || Response.error();
      }
    })()
  );
});
