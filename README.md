# Quilt Designer

A simple, browser-only quilt design tool. Draw or pick shapes, arrange them into a quilt,
fill each piece with a photo of your fabric, then export to PNG / JPEG / PDF or print.

No build step, no server, no dependencies — just open `index.html` in a modern browser
(Chrome, Edge, Firefox or Safari).

## Features

- **Shape library** – common quilting shapes (squares, HSTs, QSTs, flying geese, diamonds,
  hexagons, drunkard's path, …). Click a shape to add it next to the selected piece, or drag it
  onto the quilt.
- **New shapes** – build one from a basic shape with exact measurements, or draw it point to
  point on a snapping grid. Shapes can be edited later.
- **Arrange** – drag to move (snaps to the grid and to corners of other pieces), box-select,
  rotate (handle, buttons or `R`), mirror horizontally / vertically (`H` / `V`), duplicate,
  copy/paste, resize, undo/redo.
- **Lock layout** – the 🔒 button (or `L`) locks the arrangement once you are happy with it. Pieces
  can still be selected and given fabrics, but nothing can be moved, rotated, added or deleted until
  you unlock it. The lock is saved with the quilt.
- **Fabrics** – upload photos of your fabric (or add solid colours). Set how many inches of
  fabric the photo shows so prints appear at true scale, then fine-tune scale, angle and
  position per piece for fussy cutting.
- **Import pattern** – turn a picture of a grid-based quilt pattern (diagram, screenshot or flat
  photo) into pieces. The grid is detected automatically and can be adjusted. Each square becomes
  plain squares, half-square or quarter-square triangles, halves or four-patches, and the colours
  become solid fabrics. To swap one for your own fabric, use *Select every piece in this fabric*
  in the inspector, then click your fabric.
- **Export** – PNG, JPEG or a one-page PDF (Letter, Legal, Tabloid, A4, A3), plus direct printing.
- **Phones & tablets** – on small screens the panels become slide-up sheets opened from a bottom
  tab bar. Drag pieces with a finger, drag empty space to pan, pinch to zoom, and use the toolbar
  under a selected piece to rotate, mirror, duplicate or delete it (☑ selects several). Drawing a
  shape: touch, slide to aim and lift to place each corner. It can be added to your home screen and
  works offline once it has been opened from the hosted site.
- **Saving** – work is autosaved in the browser (IndexedDB). Use *Save* to download a
  `.quilt` file you can open again later or on another computer.

## Project layout

```
index.html        App shell and dialogs
css/styles.css    All styling
js/geometry.js    Matrices, shape generators, piece transforms
js/samples.js     Procedurally drawn sample prints
js/store.js       State, undo/redo, autosave, project files
js/editor.js      Quilt canvas: rendering, selection, drag/snap/rotate, zoom/pan
js/builder.js     New/edit shape dialog (basic shapes + point-to-point drawing)
js/export.js      Canvas renderer, PNG/JPEG/PDF export, printing
js/pattern-import.js  Import a quilt pattern image: grid detection, shape & colour analysis
js/app.js         UI wiring: libraries, inspector, toolbar, keyboard shortcuts
```

All measurements are in inches and are *finished* sizes (no seam allowance).

## Hosting on GitHub Pages

`.github/workflows/pages.yml` publishes the app (`index.html`, `css/`, `js/`, `icons/`, the web-app manifest and the offline service worker `sw.js`) whenever
`main` is pushed. One-time setup on GitHub: **Settings → Pages → Build and deployment → Source:
GitHub Actions**. The site is then served at `https://illusivebagel.github.io/QuiltPlanner/`.
You can also re-run the deploy by hand from the **Actions** tab ("Deploy to GitHub Pages" → *Run workflow*).
