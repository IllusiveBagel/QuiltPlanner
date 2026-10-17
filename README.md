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
- **Fabrics** – upload photos of your fabric (or add solid colours). Set how many inches of
  fabric the photo shows so prints appear at true scale, then fine-tune scale, angle and
  position per piece for fussy cutting.
- **Export** – PNG, JPEG or a one-page PDF (Letter, Legal, Tabloid, A4, A3), plus direct printing.
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
js/app.js         UI wiring: libraries, inspector, toolbar, keyboard shortcuts
```

All measurements are in inches and are *finished* sizes (no seam allowance).
