# Color Fun

A coloring-and-puzzle app for a young child, made for one family's iPad and not for sale.
Plain HTML/CSS/JS with no build step. A finger paints each page in its chosen colors,
the page finishes itself at 90%, and then it becomes a 9-piece jigsaw.

- Run locally: `node serve.js`, then open http://localhost:8010
- Works offline: `sw.js` saves every file on the device on the first visit.
- After changing anything, run `node tools/release.js`. It rewrites `pages.json` and stamps
  `sw.js` with a new version, so devices pick up the change the next time they're online.

## Adding a page

1. Put the line drawing in `../minnie and friends/` and add it to `tools/sources.json`.
2. `node tools/seg.js overlay <slug>` writes numbered regions to `build/<slug>-a.png` and `-b.png`.
3. Write `tools/spec/<slug>.txt`: one line per colour (`elsaHair 12 14 20`). Colour names are in
   `tools/palette.js`, or use a hex code. `islands white 3` colours whatever lies inside region 3,
   and `patch red 3 x,y x,y ...` recolours part of a region inside an outline.
   `node tools/seg.js at <slug> x,y` tells you which region is at a point.
4. `node tools/seg.js build <slug>`, add the page to `tools/collections.json`, then `node tools/release.js`.
