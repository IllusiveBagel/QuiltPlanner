/* The "New shape" dialog: build from a basic shape, or draw point to point on a grid. */
(function (Q) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const $ = (sel, root = document) => root.querySelector(sel);

  let dlg, tab = 'basic';
  let editing = null; // shape being edited, or null for a new one
  let nameTouched = false;

  const basic = { type: 'square', params: {} };
  const draw = { pts: [], closed: false, cursor: null, board: 12, snap: 0.25, dragIdx: -1 };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  const fmtIn = (v) => `${+v.toFixed(2)}″`;

  // Small SVG preview of a polygon, fitted into a box.
  function thumb(points, size = 44, cls = 'thumb') {
    const b = Q.geo.bounds(points);
    const pad = Math.max(b.w, b.h) * 0.08 || 1;
    const svg = el('svg', {
      class: cls,
      width: size,
      height: size,
      viewBox: `${b.minX - pad} ${b.minY - pad} ${b.w + pad * 2} ${b.h + pad * 2}`,
    });
    el('path', { d: Q.geo.polygonPath(points), 'vector-effect': 'non-scaling-stroke' }, svg);
    return svg;
  }

  function init() {
    dlg = $('#shape-dialog');
    for (const b of dlg.querySelectorAll('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
    $('#shape-name').addEventListener('input', () => (nameTouched = true));
    $('#shape-save').addEventListener('click', save);
    $('#shape-cancel').addEventListener('click', () => dlg.close());
    $('#shape-close').addEventListener('click', () => dlg.close());

    // Basic shape types
    const grid = $('#type-grid');
    for (const [key, def] of Object.entries(Q.geo.SHAPE_TYPES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'type-btn';
      b.dataset.type = key;
      b.title = def.label;
      b.append(thumb(Q.geo.buildShape(key, {}), 34));
      const span = document.createElement('span');
      span.textContent = def.label;
      b.append(span);
      b.addEventListener('click', () => selectType(key));
      grid.append(b);
    }

    // Drawing board
    const svg = $('#draw-svg');
    svg.addEventListener('pointermove', onDrawMove);
    svg.addEventListener('pointerdown', onDrawDown);
    svg.addEventListener('pointerup', () => (draw.dragIdx = -1));
    svg.addEventListener('pointerleave', () => {
      draw.cursor = null;
      renderDraw();
    });
    svg.addEventListener('dblclick', () => closeShape());
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    $('#draw-snap').addEventListener('change', (e) => (draw.snap = +e.target.value));
    $('#draw-board').addEventListener('change', (e) => {
      draw.board = +e.target.value;
      renderDraw();
    });
    $('#draw-undo').addEventListener('click', undoPoint);
    $('#draw-clear').addEventListener('click', () => {
      draw.pts = [];
      draw.closed = false;
      renderDraw();
    });
    $('#draw-close').addEventListener('click', closeShape);
    dlg.addEventListener('keydown', (e) => {
      if (tab !== 'draw' || e.target.tagName === 'INPUT') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        closeShape();
      } else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        undoPoint();
      }
    });
  }

  function open(shape) {
    editing = shape || null;
    nameTouched = !!shape;
    $('#shape-dialog-title').textContent = shape ? 'Edit shape' : 'New shape';
    $('#shape-save').textContent = shape ? 'Save changes' : 'Add to library';
    $('#shape-name').value = shape ? shape.name : '';
    if (shape && shape.type && Q.geo.SHAPE_TYPES[shape.type]) {
      basic.params = { ...shape.params };
      selectType(shape.type, true);
      setTab('basic');
    } else if (shape) {
      const b = Q.geo.bounds(shape.points);
      draw.board = [6, 12, 24, 48].find((s) => s >= Math.max(b.w, b.h) + 2) || 48;
      draw.pts = shape.points.map(([x, y]) => [x + 1, y + 1]);
      draw.closed = true;
      setTab('draw');
    } else {
      draw.pts = [];
      draw.closed = false;
      draw.board = 12;
      basic.params = {};
      selectType(basic.type);
      setTab('basic');
    }
    $('#draw-board').value = String(draw.board);
    $('#draw-snap').value = String(draw.snap);
    dlg.showModal();
    renderDraw();
  }

  function setTab(t) {
    tab = t;
    for (const b of dlg.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === t);
    for (const p of dlg.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== t;
    if (t === 'draw') {
      renderDraw();
      $('#draw-svg').focus({ preventScroll: true });
    }
    autoName();
    validate();
  }

  // ------------------------------------------------------------ basic shapes
  function selectType(key, keepParams) {
    basic.type = key;
    const def = Q.geo.SHAPE_TYPES[key];
    if (!keepParams) basic.params = Object.fromEntries(def.params.map((p) => [p.key, p.def]));
    for (const b of dlg.querySelectorAll('.type-btn')) b.classList.toggle('active', b.dataset.type === key);
    const form = $('#param-form');
    form.innerHTML = '';
    for (const prm of def.params) {
      const label = document.createElement('label');
      label.className = 'field';
      label.innerHTML = `<span>${prm.label}</span>`;
      const wrap = document.createElement('div');
      wrap.className = 'input-unit';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = prm.integer ? 3 : 0.125;
      input.step = prm.integer ? 1 : 0.125;
      input.value = basic.params[prm.key];
      input.addEventListener('input', () => {
        basic.params[prm.key] = input.value;
        renderBasic();
      });
      wrap.append(input);
      if (!prm.integer) {
        const u = document.createElement('em');
        u.textContent = 'in';
        wrap.append(u);
      }
      label.append(wrap);
      form.append(label);
    }
    renderBasic();
  }

  function basicPoints() {
    return Q.geo.buildShape(basic.type, basic.params);
  }

  function renderBasic() {
    const pts = basicPoints();
    const box = $('#basic-preview');
    box.innerHTML = '';
    box.append(thumb(pts, 220, 'preview'));
    const b = Q.geo.bounds(pts);
    $('#basic-dims').textContent = `${fmtIn(b.w)} wide × ${fmtIn(b.h)} tall`;
    autoName();
    validate();
  }

  // ------------------------------------------------------------ point-to-point drawing
  function boardPoint(e) {
    const svg = $('#draw-svg');
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const clamp = (v) => Math.max(0, Math.min(draw.board, v));
    let x = clamp(p.x), y = clamp(p.y);
    if (draw.snap > 0 && !e.altKey) {
      x = Math.round(x / draw.snap) * draw.snap;
      y = Math.round(y / draw.snap) * draw.snap;
    }
    return [Q.geo.round(x), Q.geo.round(y)];
  }

  const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const tolerance = () => draw.board / 60;

  function onDrawMove(e) {
    const p = boardPoint(e);
    if (draw.dragIdx >= 0) {
      draw.pts[draw.dragIdx] = p;
      validate();
    }
    draw.cursor = p;
    renderDraw();
  }

  function onDrawDown(e) {
    const p = boardPoint(e);
    const t = e.target;
    $('#draw-svg').setPointerCapture(e.pointerId);
    if (t.classList.contains('vertex')) {
      const i = +t.dataset.i;
      if (e.button === 2 || e.altKey) {
        if (draw.pts.length > 3 || !draw.closed) draw.pts.splice(i, 1);
        if (!draw.pts.length) draw.closed = false;
      } else if (!draw.closed && i === 0 && draw.pts.length >= 3) {
        closeShape();
      } else {
        draw.dragIdx = i;
      }
    } else if (t.classList.contains('midpoint')) {
      const i = +t.dataset.i;
      draw.pts.splice(i + 1, 0, p);
      draw.dragIdx = i + 1;
    } else if (e.button === 0 && !draw.closed) {
      const last = draw.pts[draw.pts.length - 1];
      if (!last || !near(last, p, 1e-6)) draw.pts.push(p);
    }
    renderDraw();
    validate();
  }

  function undoPoint() {
    if (draw.closed) draw.closed = false;
    else draw.pts.pop();
    renderDraw();
    validate();
  }

  function closeShape() {
    if (draw.pts.length >= 3) draw.closed = true;
    renderDraw();
    validate();
  }

  function renderDraw() {
    const svg = $('#draw-svg');
    if (!svg) return;
    const n = draw.board;
    const m = n * 0.04;
    svg.setAttribute('viewBox', `${-m} ${-m} ${n + m * 2} ${n + m * 2}`);
    svg.innerHTML = '';
    el('rect', { x: 0, y: 0, width: n, height: n, class: 'board' }, svg);
    let minor = '', major = '';
    const minorStep = n <= 12 ? 0.25 : n <= 24 ? 0.5 : 1;
    const majorStep = n <= 24 ? 1 : 2;
    for (let v = minorStep; v < n - 1e-6; v += minorStep) {
      const isMajor = Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6;
      const d = `M${v} 0V${n}M0 ${v}H${n}`;
      isMajor ? (major += d) : (minor += d);
    }
    el('path', { d: minor, class: 'board-minor', 'vector-effect': 'non-scaling-stroke' }, svg);
    el('path', { d: major, class: 'board-major', 'vector-effect': 'non-scaling-stroke' }, svg);
    const fs = n / 40;
    for (let v = majorStep; v < n; v += majorStep * (n > 12 ? 2 : 1)) {
      const t = el('text', { x: v, y: -m * 0.3, 'font-size': fs, class: 'board-label' }, svg);
      t.textContent = v;
      const t2 = el('text', { x: -m * 0.5, y: v + fs * 0.35, 'font-size': fs, class: 'board-label' }, svg);
      t2.textContent = v;
    }

    const pts = draw.pts;
    if (pts.length) {
      if (draw.closed) {
        el('path', { d: Q.geo.polygonPath(pts), class: 'draw-shape', 'vector-effect': 'non-scaling-stroke' }, svg);
      } else {
        const d = 'M' + pts.map((p) => p.join(' ')).join('L');
        el('path', { d, class: 'draw-line', 'vector-effect': 'non-scaling-stroke' }, svg);
        if (draw.cursor) {
          const last = pts[pts.length - 1];
          el('line', { x1: last[0], y1: last[1], x2: draw.cursor[0], y2: draw.cursor[1], class: 'draw-preview', 'vector-effect': 'non-scaling-stroke' }, svg);
          const len = Math.hypot(draw.cursor[0] - last[0], draw.cursor[1] - last[1]);
          if (len > 0) {
            const t = el('text', { x: draw.cursor[0] + fs * 0.8, y: draw.cursor[1] - fs * 0.8, 'font-size': fs * 1.1, class: 'draw-len' }, svg);
            t.textContent = fmtIn(len);
          }
        }
      }
      const r = n / 110;
      if (draw.closed) {
        pts.forEach((p, i) => {
          const q = pts[(i + 1) % pts.length];
          el('circle', { cx: (p[0] + q[0]) / 2, cy: (p[1] + q[1]) / 2, r: r * 0.8, class: 'midpoint', 'data-i': i }, svg);
        });
      }
      pts.forEach((p, i) => {
        const cls = 'vertex' + (i === 0 && !draw.closed ? ' first' : '');
        el('circle', { cx: p[0], cy: p[1], r: i === 0 && !draw.closed ? r * 1.5 : r * 1.2, class: cls, 'data-i': i }, svg);
      });
    }
    if (draw.cursor && !draw.closed) {
      el('circle', { cx: draw.cursor[0], cy: draw.cursor[1], r: n / 160, class: 'draw-cursor' }, svg);
    }

    const status = $('#draw-status');
    const c = draw.cursor ? `Cursor ${fmtIn(draw.cursor[0])}, ${fmtIn(draw.cursor[1])}` : '';
    let info;
    if (!pts.length) info = 'Click on the grid to place the first corner.';
    else if (!draw.closed) info = pts.length < 3 ? 'Keep clicking to add corners.' : 'Click the first point (or press Enter) to finish.';
    else {
      const b = Q.geo.bounds(pts);
      info = `${pts.length} corners · ${fmtIn(b.w)} × ${fmtIn(b.h)} · drag points to adjust, click a midpoint to add one, right-click a point to remove it`;
    }
    status.textContent = [info, c].filter(Boolean).join('   ·   ');
    $('#draw-close').disabled = draw.closed || pts.length < 3;
    $('#draw-undo').disabled = !pts.length;
  }

  // ------------------------------------------------------------ save
  function currentPoints() {
    if (tab === 'basic') return basicPoints();
    return draw.closed && draw.pts.length >= 3 ? Q.geo.normalize(draw.pts) : null;
  }

  function autoName() {
    if (nameTouched) return;
    let name = '';
    if (tab === 'basic') {
      const pts = basicPoints();
      const b = Q.geo.bounds(pts);
      name = `${Q.geo.SHAPE_TYPES[basic.type].label} ${+b.w.toFixed(2)}×${+b.h.toFixed(2)}`;
    } else {
      name = 'Custom shape';
    }
    $('#shape-name').value = name;
  }

  function validate() {
    const pts = currentPoints();
    const ok = pts && Q.geo.polygonArea(pts) > 1e-4;
    $('#shape-save').disabled = !ok;
    return ok;
  }

  function save() {
    if (!validate()) return;
    const points = currentPoints();
    const name = $('#shape-name').value.trim() || 'Shape';
    const data =
      tab === 'basic'
        ? { name, type: basic.type, params: Object.fromEntries(Object.entries(basic.params).map(([k, v]) => [k, +v])), points }
        : { name, type: 'custom', params: null, points };
    const st = Q.store.state;
    if (editing) {
      Object.assign(editing, data);
    } else {
      st.shapes.push({ id: Q.store.uid('shp'), ...data });
    }
    Q.store.commit('shapes');
    dlg.close();
    Q.ui.toast(editing ? 'Shape updated' : `“${name}” added to your library`);
  }

  Q.builder = { init, open, thumb };
})((window.Q = window.Q || {}));
