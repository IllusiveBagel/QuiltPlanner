/* Geometry helpers: matrices, shape generators and piece transforms.
 * All lengths are in inches. */
(function (Q) {
  'use strict';

  // ---- 2D affine matrices as [a, b, c, d, e, f] (same layout as SVG / DOMMatrix) ----
  const M = {
    identity: () => [1, 0, 0, 1, 0, 0],
    multiply(m, n) {
      return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
      ];
    },
    translate: (x, y) => [1, 0, 0, 1, x, y],
    scale: (sx, sy = sx) => [sx, 0, 0, sy, 0, 0],
    rotate(deg) {
      const r = (deg * Math.PI) / 180;
      const c = Math.cos(r), s = Math.sin(r);
      return [c, s, -s, c, 0, 0];
    },
    chain(...ms) {
      return ms.reduce((acc, m) => M.multiply(acc, m), M.identity());
    },
    apply(m, p) {
      return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
    },
    toSvg(m) {
      return `matrix(${m.map((v) => +v.toFixed(6)).join(' ')})`;
    },
  };

  // ---- Shape utilities ----
  function bounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // Shift points so the bounding box starts at 0,0 and round off float noise.
  function normalize(points) {
    const b = bounds(points);
    return points.map(([x, y]) => [round(x - b.minX), round(y - b.minY)]);
  }

  function round(v) {
    return Math.round(v * 10000) / 10000;
  }

  function polygonPath(points) {
    return 'M' + points.map((p) => `${+p[0].toFixed(4)} ${+p[1].toFixed(4)}`).join('L') + 'Z';
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function polygonArea(points) {
    let a = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
    }
    return Math.abs(a / 2);
  }

  // ---- Shape generators for the basic-shape builder ----
  const regular = (n, side, startDeg) => {
    const r = side / (2 * Math.sin(Math.PI / n));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  };

  const arc = (cx, cy, r, fromDeg, toDeg, steps) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  };

  // Each type: label, params [{key, label, def, integer}], build(params) -> points
  const SHAPE_TYPES = {
    square: {
      label: 'Square',
      params: [{ key: 'size', label: 'Size', def: 3 }],
      build: ({ size }) => [[0, 0], [size, 0], [size, size], [0, size]],
    },
    rectangle: {
      label: 'Rectangle',
      params: [{ key: 'w', label: 'Width', def: 6 }, { key: 'h', label: 'Height', def: 3 }],
      build: ({ w, h }) => [[0, 0], [w, 0], [w, h], [0, h]],
    },
    hst: {
      label: 'Half-square triangle',
      params: [{ key: 'size', label: 'Size', def: 3 }],
      build: ({ size }) => [[0, 0], [size, 0], [0, size]],
    },
    qst: {
      label: 'Quarter-square triangle',
      params: [{ key: 'size', label: 'Square size', def: 6 }],
      build: ({ size }) => [[0, 0], [size, 0], [size / 2, size / 2]],
    },
    rightTriangle: {
      label: 'Right triangle',
      params: [{ key: 'w', label: 'Base', def: 4 }, { key: 'h', label: 'Height', def: 3 }],
      build: ({ w, h }) => [[0, 0], [w, h], [0, h]],
    },
    isoTriangle: {
      label: 'Flying geese triangle',
      params: [{ key: 'w', label: 'Base', def: 6 }, { key: 'h', label: 'Height', def: 3 }],
      build: ({ w, h }) => [[0, h], [w / 2, 0], [w, h]],
    },
    equilateral: {
      label: 'Equilateral triangle',
      params: [{ key: 'size', label: 'Side', def: 4 }],
      build: ({ size }) => [[0, (size * Math.sqrt(3)) / 2], [size / 2, 0], [size, (size * Math.sqrt(3)) / 2]],
    },
    diamond: {
      label: 'Diamond',
      params: [{ key: 'w', label: 'Width', def: 3 }, { key: 'h', label: 'Height', def: 5 }],
      build: ({ w, h }) => [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]],
    },
    parallelogram: {
      label: 'Parallelogram',
      params: [
        { key: 'w', label: 'Width', def: 4 },
        { key: 'h', label: 'Height', def: 2 },
        { key: 'slant', label: 'Slant', def: 2 },
      ],
      build: ({ w, h, slant }) => [[slant, 0], [w + slant, 0], [w, h], [0, h]],
    },
    trapezoid: {
      label: 'Trapezoid',
      params: [
        { key: 'top', label: 'Top', def: 3 },
        { key: 'bottom', label: 'Bottom', def: 6 },
        { key: 'h', label: 'Height', def: 1.5 },
      ],
      build: ({ top, bottom, h }) => {
        const o = (bottom - top) / 2;
        return [[o, 0], [o + top, 0], [bottom, h], [0, h]];
      },
    },
    hexagon: {
      label: 'Hexagon',
      params: [{ key: 'side', label: 'Side', def: 2 }],
      build: ({ side }) => regular(6, side, 0),
    },
    octagon: {
      label: 'Octagon',
      params: [{ key: 'side', label: 'Side', def: 2 }],
      build: ({ side }) => regular(8, side, 22.5),
    },
    polygon: {
      label: 'Regular polygon',
      params: [
        { key: 'sides', label: 'Sides', def: 5, integer: true },
        { key: 'side', label: 'Side', def: 2 },
      ],
      build: ({ sides, side }) => regular(Math.max(3, Math.round(sides)), side, -90),
    },
    kite: {
      label: 'Kite',
      params: [
        { key: 'w', label: 'Width', def: 3 },
        { key: 'h', label: 'Height', def: 5 },
        { key: 'cross', label: 'Crossbar from top', def: 1.5 },
      ],
      build: ({ w, h, cross }) => [[w / 2, 0], [w, cross], [w / 2, h], [0, cross]],
    },
    star: {
      label: 'Star',
      params: [
        { key: 'points', label: 'Points', def: 5, integer: true },
        { key: 'outer', label: 'Outer radius', def: 3 },
        { key: 'inner', label: 'Inner radius', def: 1.3 },
      ],
      build: ({ points, outer, inner }) => {
        const n = Math.max(3, Math.round(points));
        const pts = [];
        for (let i = 0; i < n * 2; i++) {
          const r = i % 2 ? inner : outer;
          const a = ((-90 + (180 / n) * i) * Math.PI) / 180;
          pts.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return pts;
      },
    },
    circle: {
      label: 'Circle',
      params: [{ key: 'd', label: 'Diameter', def: 4 }],
      build: ({ d }) => arc(d / 2, d / 2, d / 2, 0, 360, 72).slice(0, -1),
    },
    quarterCircle: {
      label: 'Quarter circle',
      params: [{ key: 'r', label: 'Radius', def: 4 }],
      build: ({ r }) => [[0, 0], ...arc(0, 0, r, 0, 90, 24)],
    },
    drunkardsPath: {
      label: "Drunkard's path (L piece)",
      params: [
        { key: 'size', label: 'Square size', def: 4 },
        { key: 'r', label: 'Curve radius', def: 2.5 },
      ],
      build: ({ size, r }) => {
        const rr = Math.min(r, size);
        return [[rr, 0], [size, 0], [size, size], [0, size], [0, rr], ...arc(0, 0, rr, 90, 0, 24).slice(1, -1)];
      },
    },
  };

  function buildShape(type, params) {
    const def = SHAPE_TYPES[type];
    const p = {};
    for (const prm of def.params) {
      const v = Number(params[prm.key]);
      p[prm.key] = Number.isFinite(v) && v > 0 ? v : prm.def;
    }
    return normalize(def.build(p));
  }

  // ---- Pieces: a placed copy of a shape ----
  // piece: { x, y } = world position of the shape's bbox centre, rotation in degrees,
  // flipX / flipY = ±1, scale = uniform size multiplier.
  const boundsCache = new WeakMap();
  function shapeBounds(shape) {
    let b = boundsCache.get(shape.points);
    if (!b) {
      b = bounds(shape.points);
      boundsCache.set(shape.points, b);
    }
    return b;
  }

  function pieceMatrix(piece, shape) {
    const b = shapeBounds(shape);
    const s = piece.scale || 1;
    return M.chain(
      M.translate(piece.x, piece.y),
      M.rotate(piece.rotation || 0),
      M.scale((piece.flipX || 1) * s, (piece.flipY || 1) * s),
      M.translate(-b.w / 2, -b.h / 2)
    );
  }

  function pieceWorldPoints(piece, shape) {
    const m = pieceMatrix(piece, shape);
    return shape.points.map((p) => M.apply(m, p));
  }

  // Fabric pattern transform in the piece's local space. The fabric follows the piece's
  // rotation (like real cut fabric) but is not mirrored or resized when the piece is.
  function fabricMatrix(piece, shape) {
    const b = shapeBounds(shape);
    const s = piece.scale || 1;
    const f = piece.fill || {};
    return M.chain(
      M.translate(b.w / 2, b.h / 2),
      M.scale((piece.flipX || 1) / s, (piece.flipY || 1) / s),
      M.rotate(f.rotation || 0),
      M.translate(f.offsetX || 0, f.offsetY || 0)
    );
  }

  Q.M = M;
  Q.geo = {
    bounds,
    normalize,
    round,
    polygonPath,
    pointInPolygon,
    polygonArea,
    SHAPE_TYPES,
    buildShape,
    pieceMatrix,
    pieceWorldPoints,
    shapeBounds,
    fabricMatrix,
  };
})((window.Q = window.Q || {}));
