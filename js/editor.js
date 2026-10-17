/* The quilt canvas: rendering, selection, dragging, snapping, rotation, zoom and pan. */
(function (Q) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const EMPTY_FILL = '#e4ded3';
  const ROTATE_HANDLE_PX = 28;

  const editor = {
    selection: new Set(),
    view: { x: 0, y: 0, scale: 12 }, // scale = screen pixels per inch
  };

  let stage, svg, defs, gridG, quiltRect, quiltLabel, piecesG, overlayG;
  let pieceEls = new Map();
  let drag = null;
  let spaceDown = false;
  let clipboard = null;

  const S = () => Q.store.state;
  const fmt = (v) => +v.toFixed(2);

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // ---------------------------------------------------------------- setup
  function init(stageEl) {
    stage = stageEl;
    svg = el('svg', { class: 'quilt-canvas', tabindex: '0' }, stage);
    defs = el('defs', {}, svg);
    const world = el('g', {}, svg);
    quiltRect = el('rect', { class: 'quilt-bg', x: 0, y: 0 }, world);
    gridG = el('g', { class: 'grid' }, world);
    piecesG = el('g', { class: 'pieces' }, world);
    el('rect', { class: 'quilt-edge', x: 0, y: 0, fill: 'none' }, world);
    quiltLabel = el('text', { class: 'quilt-label' }, world);
    overlayG = el('g', { class: 'overlay' }, world);

    new ResizeObserver(() => {
      if (!editor._fitted && stage.clientWidth > 0) {
        fit();
        editor._fitted = true;
      }
      updateViewBox();
    }).observe(stage);

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) {
        if (!spaceDown) stage.classList.add('can-pan');
        spaceDown = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        spaceDown = false;
        stage.classList.remove('can-pan');
      }
    });

    // Drag & drop from the shape and fabric libraries.
    stage.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('application/x-quilt-shape') || t.includes('application/x-quilt-fabric')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    stage.addEventListener('drop', (e) => {
      const shapeId = e.dataTransfer.getData('application/x-quilt-shape');
      const fabricId = e.dataTransfer.getData('application/x-quilt-fabric');
      if (shapeId) {
        e.preventDefault();
        addPiece(shapeId, clientToWorld(e));
      } else if (fabricId) {
        e.preventDefault();
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const g = hit && hit.closest('.piece');
        if (!g) return Q.ui && Q.ui.toast('Drop the fabric onto a piece');
        const id = g.dataset.id;
        applyFabric(fabricId, editor.selection.has(id) ? [...editor.selection] : [id]);
      }
    });

    Q.store.subscribe((reason) => {
      if (reason === 'load') {
        editor.selection.clear();
        fit();
      }
      if (reason === 'selection') return;
      const ids = new Set(S().pieces.map((p) => p.id));
      for (const id of [...editor.selection]) if (!ids.has(id)) editor.selection.delete(id);
      render();
    });
  }

  const isTyping = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };

  // ---------------------------------------------------------------- view
  function updateViewBox() {
    const { x, y, scale } = editor.view;
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    svg.setAttribute('viewBox', `${x} ${y} ${w / scale} ${h / scale}`);
    renderGrid();
    renderOverlay();
    if (editor.onViewChange) editor.onViewChange(editor.view);
  }

  function fit() {
    const q = S().quilt;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const pad = 64;
    const scale = Math.max(1, Math.min((w - pad * 2) / q.width, (h - pad * 2) / q.height));
    editor.view = { scale, x: q.width / 2 - w / 2 / scale, y: q.height / 2 - h / 2 / scale };
    updateViewBox();
  }

  function zoomAt(factor, clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const cx = clientX == null ? r.width / 2 : clientX - r.left;
    const cy = clientY == null ? r.height / 2 : clientY - r.top;
    const v = editor.view;
    const wx = v.x + cx / v.scale, wy = v.y + cy / v.scale;
    const scale = Math.min(400, Math.max(1, v.scale * factor));
    editor.view = { scale, x: wx - cx / scale, y: wy - cy / scale };
    updateViewBox();
  }

  function clientToWorld(e) {
    const r = stage.getBoundingClientRect();
    const v = editor.view;
    return [v.x + (e.clientX - r.left) / v.scale, v.y + (e.clientY - r.top) / v.scale];
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 40 || e.deltaMode !== 0) {
      // Mouse wheel or pinch: zoom around the cursor.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015) * (e.deltaMode === 1 ? 30 : 1));
      zoomAt(factor, e.clientX, e.clientY);
    } else {
      // Trackpad two-finger scroll: pan.
      editor.view.x += e.deltaX / editor.view.scale;
      editor.view.y += e.deltaY / editor.view.scale;
      updateViewBox();
    }
  }

  // ---------------------------------------------------------------- rendering
  function fillFor(piece, shape) {
    const fabric = piece.fabricId && Q.store.fabricById(piece.fabricId);
    if (!fabric) return { fill: EMPTY_FILL };
    if (fabric.kind === 'color') return { fill: fabric.color };
    const asset = Q.store.fabricAsset(fabric);
    const zoom = (piece.fill && piece.fill.zoom) || 1;
    const tw = (fabric.widthIn || 6) * zoom;
    const th = tw * (fabric.imgH / fabric.imgW);
    const pid = 'pf-' + piece.id;
    const pattern =
      `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${fmt4(tw)}" height="${fmt4(th)}" ` +
      `patternTransform="${Q.M.toSvg(Q.geo.fabricMatrix(piece, shape))}">` +
      `<image href="${fabric.dataUrl && asset ? asset.url : ''}" width="${fmt4(tw)}" height="${fmt4(th)}" preserveAspectRatio="none"/></pattern>`;
    return { fill: `url(#${pid})`, pattern };
  }
  const fmt4 = (v) => +v.toFixed(4);

  function render() {
    const st = S();
    const q = st.quilt;
    quiltRect.setAttribute('width', q.width);
    quiltRect.setAttribute('height', q.height);
    quiltRect.setAttribute('fill', q.background);
    const edge = quiltRect.parentNode.querySelector('.quilt-edge');
    edge.setAttribute('width', q.width);
    edge.setAttribute('height', q.height);

    let patterns = '';
    let html = '';
    const seam = q.seams ? `stroke="${q.seamColor}" stroke-width="1" vector-effect="non-scaling-stroke"` : 'stroke="none"';
    for (const p of st.pieces) {
      const shape = Q.store.shapeById(p.shapeId);
      if (!shape) continue;
      const f = fillFor(p, shape);
      if (f.pattern) patterns += f.pattern;
      html +=
        `<g class="piece" data-id="${p.id}" transform="${Q.M.toSvg(Q.geo.pieceMatrix(p, shape))}">` +
        `<path d="${shapePath(shape)}" fill="${f.fill}" ${seam} stroke-linejoin="round"/></g>`;
    }
    defs.innerHTML = patterns;
    piecesG.innerHTML = html;
    pieceEls = new Map([...piecesG.children].map((g) => [g.dataset.id, g]));
    renderGrid();
    renderOverlay();
  }

  const pathCache = new WeakMap();
  function shapePath(shape) {
    let d = pathCache.get(shape.points);
    if (!d) {
      d = Q.geo.polygonPath(shape.points);
      pathCache.set(shape.points, d);
    }
    return d;
  }

  function renderGrid() {
    if (!gridG) return;
    const q = S().quilt;
    gridG.innerHTML = '';
    const scale = editor.view.scale;
    quiltLabel.setAttribute('x', 0);
    quiltLabel.setAttribute('y', -8 / scale);
    quiltLabel.setAttribute('font-size', 12 / scale);
    quiltLabel.textContent = `${fmt(q.width)}″ × ${fmt(q.height)}″`;
    if (!q.showGrid) return;
    let step = q.gridSize;
    if (!(step > 0)) return;
    while (step * scale < 6) step *= 2; // keep lines at least 6px apart
    const major = step * 4;
    let minor = '', majorD = '';
    for (let x = step, i = 1; x < q.width - 1e-6; x += step, i++) {
      (i % 4 === 0 ? (s) => (majorD += s) : (s) => (minor += s))(`M${fmt4(x)} 0V${q.height}`);
    }
    for (let y = step, i = 1; y < q.height - 1e-6; y += step, i++) {
      (i % 4 === 0 ? (s) => (majorD += s) : (s) => (minor += s))(`M0 ${fmt4(y)}H${q.width}`);
    }
    void major;
    el('path', { d: minor, class: 'grid-minor', 'vector-effect': 'non-scaling-stroke' }, gridG);
    el('path', { d: majorD, class: 'grid-major', 'vector-effect': 'non-scaling-stroke' }, gridG);
  }

  function selectedPieces() {
    return S().pieces.filter((p) => editor.selection.has(p.id));
  }

  function worldPoints(p) {
    const shape = Q.store.shapeById(p.shapeId);
    return shape ? Q.geo.pieceWorldPoints(p, shape) : [];
  }

  function selectionBounds(pieces = selectedPieces()) {
    const pts = [];
    for (const p of pieces) pts.push(...worldPoints(p));
    return pts.length ? Q.geo.bounds(pts) : null;
  }

  function renderOverlay(extra) {
    if (!overlayG) return;
    overlayG.innerHTML = '';
    const scale = editor.view.scale;
    const sel = selectedPieces();
    for (const p of sel) {
      const d = Q.geo.polygonPath(worldPoints(p));
      el('path', { d, class: 'sel-halo', 'vector-effect': 'non-scaling-stroke' }, overlayG);
      el('path', { d, class: 'sel-outline', 'vector-effect': 'non-scaling-stroke' }, overlayG);
    }
    if (sel.length) {
      const b = selectionBounds(sel);
      const pad = 4 / scale;
      el(
        'rect',
        {
          x: b.minX - pad,
          y: b.minY - pad,
          width: b.w + pad * 2,
          height: b.h + pad * 2,
          class: 'sel-box',
          'vector-effect': 'non-scaling-stroke',
        },
        overlayG
      );
      if (!drag || drag.mode !== 'move') {
        const cx = b.minX + b.w / 2;
        const top = b.minY - pad;
        const hy = top - ROTATE_HANDLE_PX / scale;
        el('line', { x1: cx, y1: top, x2: cx, y2: hy, class: 'rot-stem', 'vector-effect': 'non-scaling-stroke' }, overlayG);
        const h = el('g', { class: 'rot-handle', transform: `translate(${cx} ${hy}) scale(${1 / scale})` }, overlayG);
        el('circle', { r: 9 }, h);
        el('path', { d: 'M-3.5 -1.5a4 4 0 1 0 4 -2.2M0.5 -6.2l0 2.6l-2.6 0', class: 'rot-icon' }, h);
      }
    }
    if (extra && extra.snapPoint) {
      el('circle', { cx: extra.snapPoint[0], cy: extra.snapPoint[1], r: 5 / scale, class: 'snap-dot' }, overlayG);
    }
    if (extra && extra.marquee) {
      const m = extra.marquee;
      el('rect', { ...m, class: 'marquee', 'vector-effect': 'non-scaling-stroke' }, overlayG);
    }
    if (extra && extra.angle != null) {
      const b = selectionBounds(sel);
      const t = el('text', { x: b.minX + b.w / 2, y: b.maxY + 24 / scale, 'font-size': 12 / scale, 'stroke-width': 3 / scale, class: 'angle-label' }, overlayG);
      t.textContent = `${Math.round(extra.angle)}°`;
    }
  }

  function updatePieceTransforms(pieces) {
    for (const p of pieces) {
      const g = pieceEls.get(p.id);
      const shape = Q.store.shapeById(p.shapeId);
      if (g && shape) g.setAttribute('transform', Q.M.toSvg(Q.geo.pieceMatrix(p, shape)));
    }
  }

  // ---------------------------------------------------------------- selection
  function setSelection(ids) {
    editor.selection = new Set(ids);
    renderOverlay();
    Q.store.emit('selection');
  }

  function selectAll() {
    setSelection(S().pieces.map((p) => p.id));
  }

  function clearSelection() {
    if (editor.selection.size) setSelection([]);
  }

  // ---------------------------------------------------------------- pointer interaction
  function onPointerDown(e) {
    svg.focus({ preventScroll: true });
    const world = clientToWorld(e);
    const target = e.target;

    if (e.button === 1 || (e.button === 0 && spaceDown) || e.button === 2) {
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: editor.view.x, vy: editor.view.y };
      stage.classList.add('panning');
    } else if (e.button !== 0) {
      return;
    } else if (target.closest('.rot-handle')) {
      const sel = selectedPieces();
      const b = selectionBounds(sel);
      const c = [b.minX + b.w / 2, b.minY + b.h / 2];
      drag = {
        mode: 'rotate',
        center: c,
        startAngle: Math.atan2(world[1] - c[1], world[0] - c[0]),
        start: sel.map((p) => ({ p, x: p.x, y: p.y, rotation: p.rotation || 0 })),
        changed: false,
      };
    } else if (target.closest('.piece')) {
      const id = target.closest('.piece').dataset.id;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) {
        const next = new Set(editor.selection);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelection(next);
      } else if (!editor.selection.has(id)) {
        setSelection([id]);
      }
      const sel = selectedPieces();
      if (sel.length) {
        const selIds = editor.selection;
        const movingPts = [];
        for (const p of sel) movingPts.push(...worldPoints(p));
        const staticPts = [];
        if (S().quilt.snapPieces) {
          for (const p of S().pieces) if (!selIds.has(p.id)) staticPts.push(...worldPoints(p));
          const q = S().quilt;
          staticPts.push([0, 0], [q.width, 0], [0, q.height], [q.width, q.height]);
        }
        drag = {
          mode: 'move',
          origin: world,
          start: sel.map((p) => ({ p, x: p.x, y: p.y })),
          movingPts: thin(movingPts),
          staticPts,
          bounds: Q.geo.bounds(movingPts),
          changed: false,
        };
      }
    } else {
      drag = { mode: 'marquee', origin: world, base: e.shiftKey ? new Set(editor.selection) : new Set() };
      if (!e.shiftKey) clearSelection();
    }
    if (drag) svg.setPointerCapture(e.pointerId);
  }

  // Curved shapes have many vertices; cap the number used for snapping.
  function thin(pts) {
    if (pts.length <= 400) return pts;
    const step = Math.ceil(pts.length / 400);
    return pts.filter((_, i) => i % step === 0);
  }

  function onPointerMove(e) {
    if (!drag) return;
    const world = clientToWorld(e);
    if (drag.mode === 'pan') {
      editor.view.x = drag.vx - (e.clientX - drag.sx) / editor.view.scale;
      editor.view.y = drag.vy - (e.clientY - drag.sy) / editor.view.scale;
      updateViewBox();
    } else if (drag.mode === 'move') {
      let dx = world[0] - drag.origin[0];
      let dy = world[1] - drag.origin[1];
      if (!drag.changed && Math.hypot(dx, dy) * editor.view.scale < 3) return;
      drag.changed = true;
      const snapped = e.altKey ? { dx, dy } : snapDelta(dx, dy, drag);
      for (const s of drag.start) {
        s.p.x = s.x + snapped.dx;
        s.p.y = s.y + snapped.dy;
      }
      updatePieceTransforms(drag.start.map((s) => s.p));
      renderOverlay(snapped);
    } else if (drag.mode === 'rotate') {
      const c = drag.center;
      const a = Math.atan2(world[1] - c[1], world[0] - c[0]);
      let deg = ((a - drag.startAngle) * 180) / Math.PI;
      deg = e.shiftKey ? Math.round(deg) : Math.round(deg / 15) * 15;
      drag.changed = deg !== 0;
      for (const s of drag.start) {
        const [nx, ny] = rotateAround([s.x, s.y], c, deg);
        s.p.x = nx;
        s.p.y = ny;
        s.p.rotation = normAngle(s.rotation + deg);
      }
      updatePieceTransforms(drag.start.map((s) => s.p));
      renderOverlay({ angle: drag.start.length === 1 ? drag.start[0].p.rotation : deg });
    } else if (drag.mode === 'marquee') {
      const [ox, oy] = drag.origin;
      const r = { x: Math.min(ox, world[0]), y: Math.min(oy, world[1]), width: Math.abs(world[0] - ox), height: Math.abs(world[1] - oy) };
      const ids = new Set(drag.base);
      for (const p of S().pieces) if (pieceHitsRect(p, r)) ids.add(p.id);
      editor.selection = ids;
      renderOverlay({ marquee: r });
      drag.changedSelection = true;
    }
  }

  function onPointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    stage.classList.remove('panning');
    if ((d.mode === 'move' || d.mode === 'rotate') && d.changed) {
      for (const s of d.start) {
        s.p.x = Q.geo.round(s.p.x);
        s.p.y = Q.geo.round(s.p.y);
      }
      Q.store.commit(d.mode);
      Q.store.emit('selection');
    } else if (d.mode === 'marquee') {
      setSelection(editor.selection);
    }
    renderOverlay();
  }

  function snapDelta(dx, dy, d) {
    const q = S().quilt;
    const thr = 10 / editor.view.scale;
    let best = null;
    if (q.snapPieces && d.staticPts.length) {
      let bestD = thr * thr;
      for (const m of d.movingPts) {
        const px = m[0] + dx, py = m[1] + dy;
        for (const s of d.staticPts) {
          const ex = s[0] - px, ey = s[1] - py;
          const dd = ex * ex + ey * ey;
          if (dd < bestD) {
            bestD = dd;
            best = { ex, ey, s };
          }
        }
      }
    }
    if (best) return { dx: dx + best.ex, dy: dy + best.ey, snapPoint: best.s };
    if (q.snapGrid && q.snapStep > 0) {
      const st = q.snapStep;
      const mx = d.bounds.minX + dx, my = d.bounds.minY + dy;
      dx += Math.round(mx / st) * st - mx;
      dy += Math.round(my / st) * st - my;
    }
    return { dx, dy };
  }

  function pieceHitsRect(p, r) {
    const pts = worldPoints(p);
    const b = Q.geo.bounds(pts);
    if (b.maxX < r.x || b.minX > r.x + r.width || b.maxY < r.y || b.minY > r.y + r.height) return false;
    const inR = ([x, y]) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    if (pts.some(inR)) return true;
    const corners = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]];
    return corners.some((c) => Q.geo.pointInPolygon(c, pts));
  }

  const normAngle = (a) => {
    a = Math.round(a * 1000) / 1000;
    return ((a % 360) + 360) % 360;
  };

  function rotateAround([x, y], [cx, cy], deg) {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  }

  // ---------------------------------------------------------------- placement
  function snapToGrid(v) {
    const st = S().quilt.snapStep || 0.25;
    return Math.round(v / st) * st;
  }

  // Shift a set of pieces so their combined bounding box starts at (left, top).
  function moveGroupTo(pieces, left, top) {
    const b = selectionBounds(pieces);
    const dx = left - b.minX, dy = top - b.minY;
    for (const p of pieces) {
      p.x = Q.geo.round(p.x + dx);
      p.y = Q.geo.round(p.y + dy);
    }
  }

  // Where to put new pieces: right after the reference group, wrapping to a new row at the
  // quilt's right edge. Falls back to the middle of the visible area.
  function placeNewGroup(pieces, after) {
    const q = S().quilt;
    const nb = selectionBounds(pieces);
    if (after) {
      let left = after.maxX, top = after.minY;
      if (left + nb.w > q.width + 1e-6) {
        left = 0;
        top = after.maxY;
      }
      moveGroupTo(pieces, left, top);
    } else if (!S().pieces.length) {
      moveGroupTo(pieces, 0, 0);
    } else {
      const v = editor.view;
      const g = q.gridSize || 1;
      const cx = v.x + stage.clientWidth / 2 / v.scale;
      const cy = v.y + stage.clientHeight / 2 / v.scale;
      moveGroupTo(pieces, Math.round((cx - nb.w / 2) / g) * g, Math.round((cy - nb.h / 2) / g) * g);
    }
  }

  function addPiece(shapeId, at) {
    const shape = Q.store.shapeById(shapeId);
    if (!shape) return;
    const piece = { id: Q.store.uid('pc'), shapeId, x: 0, y: 0, rotation: 0, flipX: 1, flipY: 1, scale: 1, fabricId: null, fill: {} };
    const b = Q.geo.shapeBounds(shape);
    if (at) {
      moveGroupTo([piece], snapToGrid(at[0] - b.w / 2), snapToGrid(at[1] - b.h / 2));
    } else {
      const sel = selectedPieces();
      placeNewGroup([piece], sel.length ? selectionBounds(sel) : null);
    }
    S().pieces.push(piece);
    editor.selection = new Set([piece.id]);
    Q.store.commit('add');
    Q.store.emit('selection');
    return piece;
  }

  function cloneGroup(pieces) {
    return pieces.map((p) => ({ ...JSON.parse(JSON.stringify(p)), id: Q.store.uid('pc') }));
  }

  function duplicateSelected() {
    const sel = selectedPieces();
    if (!sel.length) return;
    const copies = cloneGroup(sel);
    placeNewGroup(copies, selectionBounds(sel));
    S().pieces.push(...copies);
    editor.selection = new Set(copies.map((p) => p.id));
    Q.store.commit('duplicate');
    Q.store.emit('selection');
  }

  function copySelected() {
    const sel = selectedPieces();
    if (!sel.length) return false;
    clipboard = JSON.parse(JSON.stringify(sel));
    return true;
  }

  function cutSelected() {
    if (copySelected()) deleteSelected();
  }

  function paste() {
    if (!clipboard) return;
    const valid = clipboard.filter((p) => Q.store.shapeById(p.shapeId));
    if (!valid.length) return;
    const copies = cloneGroup(valid);
    const sel = selectedPieces();
    placeNewGroup(copies, sel.length ? selectionBounds(sel) : null);
    S().pieces.push(...copies);
    editor.selection = new Set(copies.map((p) => p.id));
    Q.store.commit('paste');
    Q.store.emit('selection');
  }

  function deleteSelected() {
    if (!editor.selection.size) return;
    S().pieces = S().pieces.filter((p) => !editor.selection.has(p.id));
    editor.selection.clear();
    Q.store.commit('delete');
    Q.store.emit('selection');
  }

  // ---------------------------------------------------------------- transforms
  function rotateSelected(deg) {
    const sel = selectedPieces();
    if (!sel.length) return;
    const b = selectionBounds(sel);
    const c = [b.minX + b.w / 2, b.minY + b.h / 2];
    for (const p of sel) {
      [p.x, p.y] = rotateAround([p.x, p.y], c, deg).map(Q.geo.round);
      p.rotation = normAngle((p.rotation || 0) + deg);
    }
    Q.store.commit('rotate');
  }

  function setRotation(deg) {
    const sel = selectedPieces();
    for (const p of sel) p.rotation = normAngle(deg);
    Q.store.commit('rotate');
  }

  // Mirror across the selection's vertical axis ('h') or horizontal axis ('v').
  function flipSelected(axis) {
    const sel = selectedPieces();
    if (!sel.length) return;
    const b = selectionBounds(sel);
    for (const p of sel) {
      if (axis === 'h') {
        p.x = Q.geo.round(2 * (b.minX + b.w / 2) - p.x);
        p.flipX = -(p.flipX || 1);
      } else {
        p.y = Q.geo.round(2 * (b.minY + b.h / 2) - p.y);
        p.flipY = -(p.flipY || 1);
      }
      p.rotation = normAngle(-(p.rotation || 0));
    }
    // Keep the group in place (mirroring can shift the bounding box of rotated shapes).
    moveGroupTo(sel, b.minX, b.minY);
    Q.store.commit('flip');
  }

  function setScale(scale) {
    if (!(scale > 0)) return;
    for (const p of selectedPieces()) p.scale = scale;
    Q.store.commit('scale');
  }

  function setPosition(left, top) {
    const sel = selectedPieces();
    if (!sel.length) return;
    const b = selectionBounds(sel);
    moveGroupTo(sel, left == null ? b.minX : left, top == null ? b.minY : top);
    Q.store.commit('move');
  }

  function nudge(dx, dy) {
    const sel = selectedPieces();
    if (!sel.length) return;
    for (const p of sel) {
      p.x = Q.geo.round(p.x + dx);
      p.y = Q.geo.round(p.y + dy);
    }
    Q.store.commit('move');
  }

  function reorder(where) {
    const st = S();
    const sel = st.pieces.filter((p) => editor.selection.has(p.id));
    const rest = st.pieces.filter((p) => !editor.selection.has(p.id));
    st.pieces = where === 'front' ? [...rest, ...sel] : [...sel, ...rest];
    Q.store.commit('order');
  }

  function applyFabric(fabricId, ids = [...editor.selection]) {
    if (!ids.length) return false;
    const set = new Set(ids);
    for (const p of S().pieces) if (set.has(p.id)) p.fabricId = fabricId;
    Q.store.commit('fabric');
    return true;
  }

  function setFill(changes) {
    for (const p of selectedPieces()) p.fill = { ...(p.fill || {}), ...changes };
    Q.store.commit('fill');
  }

  Object.assign(editor, {
    init,
    render,
    fit,
    zoomAt,
    zoomIn: () => zoomAt(1.25),
    zoomOut: () => zoomAt(0.8),
    selectedPieces,
    selectionBounds,
    setSelection,
    selectAll,
    clearSelection,
    addPiece,
    duplicateSelected,
    copySelected,
    cutSelected,
    paste,
    deleteSelected,
    rotateSelected,
    setRotation,
    flipSelected,
    setScale,
    setPosition,
    nudge,
    reorder,
    applyFabric,
    setFill,
    isTyping,
  });
  Q.editor = editor;
})((window.Q = window.Q || {}));
