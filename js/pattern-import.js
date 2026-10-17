/* Import a quilt pattern from an image: line a grid up with the quilt, classify every grid
 * square (plain, half-square triangle, quarter-square triangle, halves, four-patch and their
 * mixes), reduce the colours to a palette and turn the result into pieces and solid fabrics.
 *
 * Each grid square is divided into 8 "atoms" — the triangles you get by cutting a square along
 * both diagonals and both midlines, numbered clockwise from the left edge's upper half:
 *
 *        1 | 2
 *     0  \ | /  3
 *     ----\|/----
 *     7   /|\   4
 *        / | \
 *        6 | 5
 *
 * Every supported cut of a square is a set of regions made of whole atoms, which lets us score
 * all the cuts from one pass over the pixels. */
(function (Q) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const NS = 'http://www.w3.org/2000/svg';
  const SAMPLES = 16; // samples per grid-square edge
  const EDGE = 0.1; // fraction of a square ignored next to cut lines (seams, outlines)

  // Cuts of a square, as lists of atom regions.
  const MODELS = [
    { name: 'square', family: 'any', regions: [[0, 1, 2, 3, 4, 5, 6, 7]] },
    { name: 'half-v', family: 'split', regions: [[6, 7, 0, 1], [2, 3, 4, 5]] },
    { name: 'half-h', family: 'split', regions: [[0, 1, 2, 3], [4, 5, 6, 7]] },
    { name: 'hst-a', family: 'tri', regions: [[1, 2, 3, 4], [5, 6, 7, 0]] },
    { name: 'hst-b', family: 'tri', regions: [[7, 0, 1, 2], [3, 4, 5, 6]] },
    { name: 'four', family: 'split', regions: [[0, 1], [2, 3], [4, 5], [6, 7]] },
    { name: 'qst', family: 'tri', regions: [[1, 2], [3, 4], [5, 6], [7, 0]] },
  ];

  // ------------------------------------------------------------------ colour helpers
  function srgbToLab(r, g, b) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const R = lin(r), G = lin(g), B = lin(b);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
    const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
    const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  // A friendly name like "Dark blue" for a colour.
  function colourName([r, g, b]) {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (max !== min) {
      const d = max - min, R = r / 255, G = g / 255, B = b / 255;
      h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    if (s < 0.12 || l > 0.95 || l < 0.08) {
      if (l > 0.9) return 'White';
      if (l > 0.75) return 'Light grey';
      if (l > 0.4) return 'Grey';
      if (l > 0.15) return 'Dark grey';
      return 'Black';
    }
    const hues = [[15, 'Red'], [40, 'Orange'], [65, 'Yellow'], [160, 'Green'], [195, 'Teal'], [255, 'Blue'], [290, 'Purple'], [340, 'Pink'], [360, 'Red']];
    let name = hues.find(([lim]) => h < lim)[1];
    if (name === 'Orange' && l < 0.35) name = 'Brown';
    if (name === 'Yellow' && s < 0.5 && l > 0.7) name = 'Cream';
    if (name === 'Blue' && l < 0.3) return 'Navy';
    if (l < 0.3) return 'Dark ' + name.toLowerCase();
    if (l > 0.75) return 'Light ' + name.toLowerCase();
    return name;
  }

  // ------------------------------------------------------------------ grid detection
  // Find the quilt inside the image (trim a plain border) and guess the number of columns/rows.
  function detectGrid(data, w, h) {
    const px = (x, y) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Background = median colour around the border, if the border is mostly that colour.
    const border = [];
    for (let x = 0; x < w; x += 2) border.push(px(x, 0), px(x, 1), px(x, h - 1), px(x, h - 2));
    for (let y = 0; y < h; y += 2) border.push(px(0, y), px(1, y), px(w - 1, y), px(w - 2, y));
    const median = (arr) => arr.slice().sort((a, b) => a - b)[arr.length >> 1];
    const bg = [0, 1, 2].map((c) => median(border.map((p) => p[c])));
    const diff = (c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
    const spread = median(border.map(diff));
    const tol = Math.max(48, spread * 3);
    let crop = { x: 0, y: 0, w, h };
    if (border.filter((c) => diff(c) < tol).length > border.length * 0.6) {
      const colHit = new Array(w).fill(0), rowHit = new Array(h).fill(0);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (diff(px(x, y)) > tol) {
            colHit[x]++;
            rowHit[y]++;
          }
        }
      }
      const first = (arr, n) => arr.findIndex((v) => v > n * 0.15);
      const last = (arr, n) => arr.length - 1 - [...arr].reverse().findIndex((v) => v > n * 0.15);
      const x0 = first(colHit, h), x1 = last(colHit, h), y0 = first(rowHit, w), y1 = last(rowHit, w);
      if (x0 >= 0 && y0 >= 0 && (x1 - x0) * (y1 - y0) > w * h * 0.15) {
        crop = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      }
    }

    // Edge-strength profiles along x and y inside the crop.
    const lum = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    };
    const profX = new Float32Array(crop.w), profY = new Float32Array(crop.h);
    for (let y = crop.y; y < crop.y + crop.h - 1; y++) {
      for (let x = crop.x; x < crop.x + crop.w - 1; x++) {
        const l = lum(x, y);
        profX[x - crop.x] += Math.abs(lum(x + 1, y) - l);
        profY[y - crop.y] += Math.abs(lum(x, y + 1) - l);
      }
    }
    const cx = lineScores(profX), cy = lineScores(profY);
    let cols = bestCount(cx), rows = bestCount(cy);
    // Quilt grids are nearly always square: if square cells fit the edges almost as well, use them.
    const squareFit = (scores, count) => {
      const s = scores.find((e) => e[0] === count);
      const best = Math.max(...scores.map((e) => e[1]));
      return s && s[1] >= best * 0.7;
    };
    const rowsSq = Math.round(crop.h / (crop.w / cols));
    const colsSq = Math.round(crop.w / (crop.h / rows));
    if (rowsSq !== rows && squareFit(cy, rowsSq)) rows = rowsSq;
    else if (colsSq !== cols && squareFit(cx, colsSq)) cols = colsSq;
    return { crop, cols, rows };
  }

  // For each possible number of equal divisions, how strongly its dividing lines sit on edges.
  function lineScores(prof) {
    const n = prof.length;
    const mean = prof.reduce((a, b) => a + b, 0) / n || 1;
    const peak = (x) => {
      const i = Math.round(x);
      let m = 0;
      for (let d = -2; d <= 2; d++) m = Math.max(m, prof[i + d] || 0);
      return m;
    };
    const scores = [];
    for (let k = 2; k <= Math.min(60, Math.floor(n / 6)); k++) {
      let s = 0;
      for (let j = 1; j < k; j++) s += peak((j * n) / k);
      scores.push([k, s / (k - 1) / mean]);
    }
    return scores;
  }

  // The number of divisions that best matches the edges. Among near-ties prefer more divisions
  // (a 4×4 grid also lines up with an 8×8 quilt's seams).
  function bestCount(scores) {
    if (!scores.length) return 4;
    const best = Math.max(...scores.map((s) => s[1]));
    if (best < 1.3) return 8; // no clear grid; a sensible starting point
    return scores.filter((s) => s[1] >= best * 0.88).pop()[0];
  }

  // ------------------------------------------------------------------ analysis
  // Precompute which atom each sample belongs to (or -1 when it's too close to a cut line).
  const ATOM_OF = (() => {
    const out = new Int8Array(SAMPLES * SAMPLES);
    const r2 = Math.SQRT1_2;
    for (let j = 0; j < SAMPLES; j++) {
      for (let i = 0; i < SAMPLES; i++) {
        const u = (i + 0.5) / SAMPLES, v = (j + 0.5) / SAMPLES;
        const dx = u - 0.5, dy = v - 0.5;
        const nearLine =
          u < EDGE || u > 1 - EDGE || v < EDGE || v > 1 - EDGE ||
          Math.abs(dx) < EDGE || Math.abs(dy) < EDGE ||
          Math.abs(dx - dy) * r2 < EDGE || Math.abs(dx + dy) * r2 < EDGE;
        const k = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4));
        out[j * SAMPLES + i] = nearLine ? -1 : Math.min(7, k);
      }
    }
    return out;
  })();

  function sampleImage(img, crop, cols, rows) {
    const c = document.createElement('canvas');
    c.width = cols * SAMPLES;
    c.height = rows * SAMPLES;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height).data;
  }

  // Per-cell atom statistics: count, Lab sums, sum of squares and RGB sums.
  function atomStats(data, cols, rows) {
    const width = cols * SAMPLES;
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const atoms = Array.from({ length: 8 }, () => ({ n: 0, lab: [0, 0, 0], sq: 0, rgb: [0, 0, 0] }));
        for (let j = 0; j < SAMPLES; j++) {
          for (let i = 0; i < SAMPLES; i++) {
            const a = ATOM_OF[j * SAMPLES + i];
            if (a < 0) continue;
            const p = ((row * SAMPLES + j) * width + col * SAMPLES + i) * 4;
            const r = data[p], g = data[p + 1], b = data[p + 2];
            const lab = srgbToLab(r, g, b);
            const t = atoms[a];
            t.n++;
            t.lab[0] += lab[0];
            t.lab[1] += lab[1];
            t.lab[2] += lab[2];
            t.sq += lab[0] * lab[0] + lab[1] * lab[1] + lab[2] * lab[2];
            t.rgb[0] += r;
            t.rgb[1] += g;
            t.rgb[2] += b;
          }
        }
        cells.push({ row, col, atoms });
      }
    }
    return cells;
  }

  function regionStats(atoms, region) {
    const s = { n: 0, lab: [0, 0, 0], sq: 0, rgb: [0, 0, 0] };
    for (const k of region) {
      const a = atoms[k];
      s.n += a.n;
      s.sq += a.sq;
      for (let c = 0; c < 3; c++) {
        s.lab[c] += a.lab[c];
        s.rgb[c] += a.rgb[c];
      }
    }
    const n = s.n || 1;
    s.sse = s.sq - (s.lab[0] ** 2 + s.lab[1] ** 2 + s.lab[2] ** 2) / n;
    s.meanLab = s.lab.map((v) => v / n);
    s.meanRgb = s.rgb.map((v) => v / n);
    return s;
  }

  // Choose the cut that explains the cell best. Extra pieces must earn their keep: each one has
  // to remove a good share of the colour variation, so busy prints don't get chopped up.
  function chooseModel(cell, models, detail) {
    const lambda = 12 * 4 ** ((50 - detail) / 25); // absolute penalty (Lab² per sample)
    const rel = 0.3 * 2 ** ((50 - detail) / 25); // relative penalty
    let best = null;
    for (const m of models) {
      const regions = m.regions.map((r) => regionStats(cell.atoms, r));
      const n = regions.reduce((a, r) => a + r.n, 0) || 1;
      const variance = regions.reduce((a, r) => a + r.sse, 0) / n;
      const extra = m.regions.length - 1;
      const score = variance * (1 + rel * extra) + lambda * extra;
      if (!best || score < best.score) best = { model: m, regions, score };
    }
    return best;
  }

  // Weighted k-means over region colours (Lab), seeded deterministically (k-means++ style).
  function kmeans(points, k) {
    k = Math.min(k, points.length);
    const centers = [points.reduce((a, p) => (p.w > a.w ? p : a)).lab.slice()];
    while (centers.length < k) {
      let far = null, farD = -1;
      for (const p of points) {
        const d = Math.min(...centers.map((c) => dist2(c, p.lab))) * p.w;
        if (d > farD) {
          farD = d;
          far = p;
        }
      }
      if (farD <= 0) break;
      centers.push(far.lab.slice());
    }
    const assign = new Int32Array(points.length);
    for (let iter = 0; iter < 20; iter++) {
      let moved = false;
      points.forEach((p, i) => {
        let bi = 0, bd = Infinity;
        centers.forEach((c, j) => {
          const d = dist2(c, p.lab);
          if (d < bd) {
            bd = d;
            bi = j;
          }
        });
        if (assign[i] !== bi) moved = true;
        assign[i] = bi;
      });
      const sums = centers.map(() => ({ w: 0, lab: [0, 0, 0] }));
      points.forEach((p, i) => {
        const s = sums[assign[i]];
        s.w += p.w;
        for (let c = 0; c < 3; c++) s.lab[c] += p.lab[c] * p.w;
      });
      sums.forEach((s, j) => s.w && (centers[j] = s.lab.map((v) => v / s.w)));
      if (!moved && iter) break;
    }
    return { centers, assign };
  }

  // Build the palette. With colourCount = 0 ("auto"), over-cluster and then merge colours that
  // are too close to tell apart.
  function buildPalette(points, colourCount) {
    const auto = !colourCount;
    let { centers, assign } = kmeans(points, auto ? 24 : colourCount);
    let groups = centers.map((c, j) => ({ lab: c, members: [] }));
    points.forEach((p, i) => groups[assign[i]].members.push(p));
    groups = groups.filter((g) => g.members.length);
    if (auto) {
      const MERGE = 14 ** 2;
      for (;;) {
        let bi = -1, bj = -1, bd = MERGE;
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            const d = dist2(groups[i].lab, groups[j].lab);
            if (d < bd) {
              bd = d;
              bi = i;
              bj = j;
            }
          }
        }
        if (bi < 0) break;
        const a = groups[bi], b = groups[bj];
        a.members.push(...b.members);
        const w = a.members.reduce((s, p) => s + p.w, 0);
        a.lab = [0, 1, 2].map((c) => a.members.reduce((s, p) => s + p.lab[c] * p.w, 0) / w);
        groups.splice(bj, 1);
      }
      // Fold away specks (under 0.5% of the quilt) into their nearest colour.
      const total = groups.reduce((s, g) => s + g.members.reduce((a, p) => a + p.w, 0), 0);
      const weight = (g) => g.members.reduce((a, p) => a + p.w, 0);
      for (const g of groups.slice().sort((a, b) => weight(a) - weight(b))) {
        if (groups.length < 3 || weight(g) >= total * 0.005) continue;
        groups.splice(groups.indexOf(g), 1);
        for (const p of g.members) {
          const near = groups.reduce((a, o) => (dist2(o.lab, p.lab) < dist2(a.lab, p.lab) ? o : a));
          near.members.push(p);
        }
      }
    }
    return groups
      .map((g) => {
        const w = g.members.reduce((s, p) => s + p.w, 0);
        const rgb = [0, 1, 2].map((c) => g.members.reduce((s, p) => s + p.rgb[c] * p.w, 0) / w);
        for (const p of g.members) p.group = g;
        g.rgb = rgb;
        g.hex = toHex(rgb);
        g.area = w;
        return g;
      })
      .sort((a, b) => b.area - a.area);
  }

  // Turn per-atom colours into pieces. Neighbouring atoms of one colour merge into arcs; each
  // arc becomes a whole square, a half-square triangle, a half rectangle, a quarter square or a
  // quarter-square triangle. Positions are in grid units (the cell's top-left is col,row).
  function cellPieces(col, row, atomColours) {
    if (atomColours.every((c) => c === atomColours[0])) {
      return [{ kind: 'square', cx: col + 0.5, cy: row + 0.5, rotation: 0, colour: atomColours[0] }];
    }
    let start = 0;
    while (atomColours[start] === atomColours[(start + 7) % 8]) start++;
    const pieces = [];
    let i = 0;
    while (i < 8) {
      const s = (start + i) % 8;
      let len = 1;
      while (i + len < 8 && atomColours[(s + len) % 8] === atomColours[s]) len++;
      // Split the arc into pieces of 4 and 2 atoms.
      let off = 0;
      while (off < len) {
        const take = len - off >= 4 ? 4 : 2;
        pieces.push(arcPiece(col, row, (s + off) % 8, take, atomColours[s]));
        off += take;
      }
      i += len;
    }
    return pieces;
  }

  function arcPiece(col, row, start, len, colour) {
    const c = (dx, dy, kind, rotation) => ({ kind, cx: col + dx, cy: row + dy, rotation, colour });
    if (len === 4) {
      if (start % 2) return { 7: c(0.5, 0.5, 'hst', 0), 1: c(0.5, 0.5, 'hst', 90), 3: c(0.5, 0.5, 'hst', 180), 5: c(0.5, 0.5, 'hst', 270) }[start];
      return { 0: c(0.5, 0.25, 'rect', 0), 2: c(0.75, 0.5, 'rect', 90), 4: c(0.5, 0.75, 'rect', 0), 6: c(0.25, 0.5, 'rect', 90) }[start];
    }
    if (start % 2) return { 1: c(0.5, 0.25, 'qst', 0), 3: c(0.75, 0.5, 'qst', 90), 5: c(0.5, 0.75, 'qst', 180), 7: c(0.25, 0.5, 'qst', 270) }[start];
    return { 0: c(0.25, 0.25, 'quad', 0), 2: c(0.75, 0.25, 'quad', 0), 4: c(0.75, 0.75, 'quad', 0), 6: c(0.25, 0.75, 'quad', 0) }[start];
  }

  function analyse(img, opts) {
    const { crop, cols, rows, colours, detail, triangles, splits } = opts;
    const models = MODELS.filter((m) => m.family === 'any' || (m.family === 'tri' && triangles) || (m.family === 'split' && splits));
    const data = sampleImage(img, crop, cols, rows);
    const cells = atomStats(data, cols, rows);
    const points = [];
    for (const cell of cells) {
      cell.choice = chooseModel(cell, models, detail);
      cell.choice.points = cell.choice.regions.map((r) => {
        const p = { lab: r.meanLab, rgb: r.meanRgb, w: r.n || 1 };
        points.push(p);
        return p;
      });
    }
    const palette = buildPalette(points, colours);
    palette.forEach((g, i) => (g.index = i));
    const pieces = [];
    for (const cell of cells) {
      const atomColours = new Array(8);
      cell.choice.model.regions.forEach((region, ri) => {
        for (const a of region) atomColours[a] = cell.choice.points[ri].group.index;
      });
      pieces.push(...cellPieces(cell.col, cell.row, atomColours));
    }
    const used = new Set(pieces.map((p) => p.colour));
    return { cols, rows, palette: palette.filter((g) => used.has(g.index)), allPalette: palette, pieces };
  }

  // ------------------------------------------------------------------ pieces → project
  const UNIT_SHAPES = {
    square: (c) => ['square', { size: c }],
    quad: (c) => ['square', { size: c / 2 }],
    rect: (c) => ['rectangle', { w: c, h: c / 2 }],
    hst: (c) => ['hst', { size: c }],
    qst: (c) => ['qst', { size: c }],
  };

  const unitShapeCache = new Map();
  function unitShape(kind) {
    if (!unitShapeCache.has(kind)) {
      const [type, params] = UNIT_SHAPES[kind](1);
      unitShapeCache.set(kind, { points: Q.geo.buildShape(type, params) });
    }
    return unitShapeCache.get(kind);
  }

  const samePoints = (a, b) =>
    a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-3 && Math.abs(p[1] - b[i][1]) < 1e-3);

  function findOrCreateShape(kind, size) {
    const [type, params] = UNIT_SHAPES[kind](size);
    const points = Q.geo.buildShape(type, params);
    const st = Q.store.state;
    let shape = st.shapes.find((s) => samePoints(s.points, points));
    if (!shape) {
      const b = Q.geo.bounds(points);
      const label = Q.geo.SHAPE_TYPES[type].label;
      shape = { id: Q.store.uid('shp'), name: `${label} ${+b.w.toFixed(2)}×${+b.h.toFixed(2)}`, type, params, points };
      st.shapes.push(shape);
    }
    return shape;
  }

  function findOrCreateFabric(group, takenNames) {
    for (const f of Q.store.state.fabrics) {
      if (f.kind === 'color' && dist2(srgbToLab(...hexToRgb(f.color)), group.lab) < 3 ** 2) return f;
    }
    let name = colourName(group.rgb);
    for (let i = 2; takenNames.has(name); i++) name = `${colourName(group.rgb)} ${i}`;
    takenNames.add(name);
    return Q.store.addFabric({ name, kind: 'color', color: group.hex });
  }

  function applyResult(result, cellSize, mode) {
    const st = Q.store.state;
    const takenNames = new Set(st.fabrics.map((f) => f.name));
    const fabricFor = new Map(result.palette.map((g) => [g.index, findOrCreateFabric(g, takenNames).id]));
    const shapeFor = {};
    const pieces = result.pieces.map((p) => {
      shapeFor[p.kind] = shapeFor[p.kind] || findOrCreateShape(p.kind, cellSize);
      return {
        id: Q.store.uid('pc'),
        shapeId: shapeFor[p.kind].id,
        x: Q.geo.round(p.cx * cellSize),
        y: Q.geo.round(p.cy * cellSize),
        rotation: p.rotation,
        flipX: 1,
        flipY: 1,
        scale: 1,
        fabricId: fabricFor.get(p.colour),
        fill: {},
      };
    });
    if (mode === 'replace') {
      st.pieces = pieces;
      st.quilt.width = Q.geo.round(result.cols * cellSize);
      st.quilt.height = Q.geo.round(result.rows * cellSize);
      if (st.quilt.gridSize > cellSize || (cellSize / st.quilt.gridSize) % 1) st.quilt.gridSize = cellSize;
    } else {
      st.pieces.push(...pieces);
    }
    Q.store.commit('import');
    Q.store.emit('shapes');
    Q.editor.setSelection(mode === 'replace' ? [] : pieces.map((p) => p.id));
    Q.editor.fit();
    return pieces.length;
  }

  // ------------------------------------------------------------------ dialog
  const ui = {
    img: null, // full-resolution image
    url: null,
    scale: 1, // analysis-canvas px → image px
    crop: null, // in image px
    cols: 8,
    rows: 8,
    result: null,
    drag: null,
  };
  let timer = null;

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function init() {
    const d = $('#import-dialog');
    $('#btn-import').addEventListener('click', open);
    $('#import-choose').addEventListener('click', () => $('#import-input').click());
    $('#import-change').addEventListener('click', () => $('#import-input').click());
    $('#import-input').addEventListener('change', (e) => {
      if (e.target.files[0]) loadFile(e.target.files[0]);
      e.target.value = '';
    });
    const drop = $('#import-drop');
    drop.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        drop.classList.add('drop-target');
      }
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('drop-target'));
    drop.addEventListener('drop', (e) => {
      drop.classList.remove('drop-target');
      const f = e.dataTransfer.files[0];
      if (f) {
        e.preventDefault();
        loadFile(f);
      }
    });
    document.addEventListener('paste', (e) => {
      if (!d.open) return;
      const item = [...(e.clipboardData || {}).items || []].find((i) => i.type.startsWith('image/'));
      if (item) loadFile(item.getAsFile());
    });

    for (const id of ['import-cols', 'import-rows']) {
      $('#' + id).addEventListener('input', (e) => {
        const v = Math.round(+e.target.value);
        if (v >= 1 && v <= 120) {
          ui[id === 'import-cols' ? 'cols' : 'rows'] = v;
          renderOverlay();
          schedule();
        }
      });
    }
    for (const id of ['import-cell', 'import-colours', 'import-detail', 'import-tri', 'import-split']) {
      $('#' + id).addEventListener('input', schedule);
      $('#' + id).addEventListener('change', schedule);
    }
    $('#import-auto').addEventListener('click', autoDetect);
    $('#import-go').addEventListener('click', () => {
      if (!ui.result) return;
      const mode = $('input[name=import-mode]:checked').value;
      const n = applyResult(ui.result, cellSize(), mode);
      d.close();
      Q.ui.toast(`Imported ${n} pieces in ${ui.result.palette.length} colours — swap in your fabrics any time`);
    });

    const svg = $('#import-svg');
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', () => {
      if (ui.drag) schedule();
      ui.drag = null;
    });
  }

  function open() {
    $('#import-dialog').showModal();
    setHasImage(!!ui.img);
    if (ui.img) {
      renderOverlay();
      schedule();
    }
  }

  function setHasImage(has) {
    $('#import-drop').hidden = has;
    $('#import-work').hidden = !has;
    $('#import-change').hidden = !has;
    $('#import-go').disabled = !has;
    for (const n of document.querySelectorAll('#import-dialog .import-controls input, #import-dialog .import-controls select, #import-dialog .import-controls button')) n.disabled = !has;
  }

  function loadFile(file) {
    if (!file.type.startsWith('image/')) return Q.ui.toast('That file is not an image');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (ui.url) URL.revokeObjectURL(ui.url);
      ui.img = img;
      ui.url = url;
      setHasImage(true);
      autoDetect();
    };
    img.onerror = () => Q.ui.toast("Couldn't read that image");
    img.src = url;
  }

  function autoDetect() {
    const img = ui.img;
    const max = 700;
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.filter = 'blur(1px)'; // calm photo noise and fabric texture
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const g = detectGrid(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    ui.crop = { x: g.crop.x / s, y: g.crop.y / s, w: g.crop.w / s, h: g.crop.h / s };
    ui.cols = g.cols;
    ui.rows = g.rows;
    $('#import-cols').value = ui.cols;
    $('#import-rows').value = ui.rows;
    renderOverlay();
    schedule();
  }

  const cellSize = () => Math.max(0.25, +$('#import-cell').value || 3);

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 60);
  }

  function run() {
    if (!ui.img || !ui.crop) return;
    const opts = {
      crop: ui.crop,
      cols: ui.cols,
      rows: ui.rows,
      colours: +$('#import-colours').value,
      detail: +$('#import-detail').value,
      triangles: $('#import-tri').checked,
      splits: $('#import-split').checked,
    };
    ui.result = analyse(ui.img, opts);
    renderPreview();
    const c = cellSize();
    $('#import-summary').textContent =
      `${ui.result.pieces.length} pieces · ${ui.result.palette.length} colours · quilt ${+(ui.cols * c).toFixed(2)}″ × ${+(ui.rows * c).toFixed(2)}″`;
    $('#import-go').textContent = `Import ${ui.result.pieces.length} pieces`;
  }

  // ---- image + grid overlay
  function renderOverlay() {
    const svg = $('#import-svg');
    const img = ui.img;
    if (!img) return;
    const W = img.naturalWidth, H = img.naturalHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    el('image', { href: ui.url, width: W, height: H }, svg);
    const box = svg.getBoundingClientRect();
    const k = Math.max(W / (box.width || 400), H / (box.height || 400)); // image px per screen px
    const { x, y, w, h } = ui.crop;
    // Dim outside the frame
    el('path', { d: `M0 0H${W}V${H}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`, class: 'import-dim', 'fill-rule': 'evenodd' }, svg);
    let d = '';
    for (let i = 1; i < ui.cols; i++) d += `M${x + (w * i) / ui.cols} ${y}V${y + h}`;
    for (let j = 1; j < ui.rows; j++) d += `M${x} ${y + (h * j) / ui.rows}H${x + w}`;
    el('path', { d, class: 'import-grid', 'vector-effect': 'non-scaling-stroke' }, svg);
    el('rect', { x, y, width: w, height: h, class: 'import-frame', 'data-h': 'move', 'vector-effect': 'non-scaling-stroke' }, svg);
    for (const [hx, hy, name] of [[x, y, 'tl'], [x + w, y, 'tr'], [x, y + h, 'bl'], [x + w, y + h, 'br']]) {
      el('circle', { cx: hx, cy: hy, r: 7 * k, class: 'import-handle', 'data-h': name, 'stroke-width': 2 * k }, svg);
    }
  }

  function svgPoint(e) {
    const svg = $('#import-svg');
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  function onDown(e) {
    const h = e.target.dataset && e.target.dataset.h;
    if (!h) return;
    $('#import-svg').setPointerCapture(e.pointerId);
    ui.drag = { h, start: svgPoint(e), crop: { ...ui.crop } };
  }

  function onMove(e) {
    if (!ui.drag) return;
    const [px, py] = svgPoint(e);
    const { h, start, crop } = ui.drag;
    const W = ui.img.naturalWidth, H = ui.img.naturalHeight;
    const dx = px - start[0], dy = py - start[1];
    let { x, y, w, h: hh } = crop;
    const min = 8;
    if (h === 'move') {
      x = Math.max(0, Math.min(W - w, x + dx));
      y = Math.max(0, Math.min(H - hh, y + dy));
    } else {
      let x0 = x, y0 = y, x1 = x + w, y1 = y + hh;
      if (h.includes('l')) x0 = Math.min(x1 - min, Math.max(0, x0 + dx));
      if (h.includes('r')) x1 = Math.max(x0 + min, Math.min(W, x1 + dx));
      if (h.includes('t')) y0 = Math.min(y1 - min, Math.max(0, y0 + dy));
      if (h.includes('b')) y1 = Math.max(y0 + min, Math.min(H, y1 + dy));
      x = x0;
      y = y0;
      w = x1 - x0;
      hh = y1 - y0;
    }
    ui.crop = { x, y, w, h: hh };
    renderOverlay();
  }

  // ---- result preview
  function renderPreview() {
    const svg = $('#import-preview');
    const r = ui.result;
    svg.setAttribute('viewBox', `${-0.05} ${-0.05} ${r.cols + 0.1} ${r.rows + 0.1}`);
    let html = '';
    for (const p of r.pieces) {
      const pts = Q.geo.pieceWorldPoints({ x: p.cx, y: p.cy, rotation: p.rotation }, unitShape(p.kind));
      html += `<path d="${Q.geo.polygonPath(pts)}" fill="${r.allPalette[p.colour].hex}"/>`;
    }
    svg.innerHTML = html;
    const pal = $('#import-palette');
    pal.innerHTML = r.palette.map((g) => `<i style="background:${g.hex}" title="${colourName(g.rgb)} ${g.hex}"></i>`).join('');
  }

  Q.patternImport = { init, analyse, detectGrid, colourName };
})((window.Q = window.Q || {}));
