/* UI wiring: libraries, inspector, toolbar, dialogs and keyboard shortcuts. */
(function (Q) {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const { store, editor } = Q;
  const S = () => store.state;
  const fmt = (v) => +(+v).toFixed(2);
  const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------------------------------------------------------------- small UI helpers
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function confirmDialog(message, okLabel = 'OK', danger = false) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'modal modal-sm';
      d.innerHTML = `<div class="modal-body"><p class="confirm-text">${esc(message)}</p></div>
        <footer class="modal-foot"><span class="spacer"></span><button class="btn" value="no">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" value="yes">${esc(okLabel)}</button></footer>`;
      document.body.append(d);
      d.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) d.close(b.value);
      });
      d.addEventListener('close', () => {
        resolve(d.returnValue === 'yes');
        d.remove();
      });
      d.showModal();
      d.querySelector('[value=yes]').focus();
    });
  }

  Q.ui = { toast, confirm: confirmDialog };

  // Tooltips from data-tip
  function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.append(tip);
    let timer;
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[data-tip]');
      clearTimeout(timer);
      if (!t) return tip.classList.remove('show');
      timer = setTimeout(() => {
        tip.textContent = t.dataset.tip;
        const r = t.getBoundingClientRect();
        tip.classList.add('show');
        const tw = tip.offsetWidth;
        const above = r.top > window.innerHeight - 80;
        tip.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
        tip.style.top = (above ? r.top - tip.offsetHeight - 8 : r.bottom + 8) + 'px';
      }, 350);
    });
    document.addEventListener('pointerdown', () => {
      clearTimeout(timer);
      tip.classList.remove('show');
    });
  }

  // ---------------------------------------------------------------- shape library
  function renderShapeLibrary() {
    const lib = $('#shape-library');
    lib.innerHTML = '';
    for (const shape of S().shapes) {
      const b = Q.geo.bounds(shape.points);
      const item = document.createElement('div');
      item.className = 'shape-item';
      item.draggable = true;
      item.tabIndex = 0;
      item.title = `Add ${shape.name}`;
      item.append(Q.builder.thumb(shape.points, 48));
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<strong>${esc(shape.name)}</strong><span>${fmt(b.w)}″ × ${fmt(b.h)}″</span>`;
      item.append(meta);
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      actions.innerHTML =
        `<button class="icon-btn xs" data-act="edit" data-tip="Edit shape">${icon('pencil')}</button>` +
        `<button class="icon-btn xs" data-act="delete" data-tip="Remove from library">${icon('trash')}</button>`;
      item.append(actions);

      item.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (act && act.dataset.act === 'edit') return Q.builder.open(shape);
        if (act && act.dataset.act === 'delete') return deleteShape(shape);
        editor.addPiece(shape.id);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          editor.addPiece(shape.id);
        }
      });
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-quilt-shape', shape.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      lib.append(item);
    }
  }

  async function deleteShape(shape) {
    const used = S().pieces.filter((p) => p.shapeId === shape.id).length;
    const msg = used
      ? `Remove “${shape.name}” from the library? ${used} piece${used > 1 ? 's' : ''} using it will also be removed from the quilt.`
      : `Remove “${shape.name}” from the library?`;
    if (!(await confirmDialog(msg, 'Remove', true))) return;
    S().shapes = S().shapes.filter((s) => s.id !== shape.id);
    S().pieces = S().pieces.filter((p) => p.shapeId !== shape.id);
    store.commit('shapes');
    toast('Shape removed — Ctrl+Z to undo');
  }

  // ---------------------------------------------------------------- fabric library
  function swatchStyle(f) {
    if (f.kind === 'color') return `background:${f.color}`;
    const a = store.fabricAsset(f);
    // Show the swatch at roughly real scale: a 64px tile ≈ 3 inches of fabric.
    const px = Math.max(12, Math.min(160, (f.widthIn || 6) * (64 / 3)));
    return `background-image:url(${a.url});background-size:${px}px auto`;
  }

  function renderFabricLibrary() {
    const lib = $('#fabric-library');
    const selFabrics = new Set(editor.selectedPieces().map((p) => p.fabricId));
    lib.innerHTML = '';
    for (const f of S().fabrics) {
      const item = document.createElement('div');
      item.className = 'fabric-item' + (selFabrics.has(f.id) ? ' active' : '');
      item.draggable = true;
      item.tabIndex = 0;
      item.title = f.name;
      item.innerHTML =
        `<div class="swatch" style="${swatchStyle(f)}"></div><span>${esc(f.name)}</span>` +
        `<button class="icon-btn xs edit" data-tip="Edit fabric">${icon('pencil')}</button>`;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.edit')) return openFabricDialog(f);
        if (!editor.applyFabric(f.id)) toast('Select one or more pieces first, then click a fabric');
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') editor.applyFabric(f.id) || toast('Select one or more pieces first');
      });
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-quilt-fabric', f.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      lib.append(item);
    }
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: c.toDataURL('image/jpeg', 0.88), imgW: c.width, imgH: c.height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Couldn't read ${file.name}`));
      };
      img.src = url;
    });
  }

  async function addFabricFiles(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    let added = 0;
    for (const file of images) {
      try {
        const data = await loadImageFile(file);
        const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Fabric';
        const f = store.addFabric({ name, kind: 'image', widthIn: 8, ...data });
        added++;
        if (editor.selection.size && images.length === 1) editor.applyFabric(f.id);
      } catch (err) {
        toast(err.message);
      }
    }
    if (added) toast(`${added} fabric${added > 1 ? 's' : ''} added — click ✎ to set the print scale`);
  }

  // ---------------------------------------------------------------- fabric dialog
  let fabricEditing = null;
  function openFabricDialog(f) {
    fabricEditing = f || null;
    const d = $('#fabric-dialog');
    const isColor = !f || f.kind === 'color';
    $('#fabric-dialog-title').textContent = f ? 'Edit fabric' : 'New solid fabric';
    $('#fabric-name').value = f ? f.name : 'Solid';
    $('#fabric-color').value = f && f.color ? f.color : '#7a9e9f';
    $('#fabric-width').value = f && f.widthIn ? f.widthIn : 8;
    $('#fabric-color-field').hidden = !isColor;
    $('#fabric-width-field').hidden = isColor;
    $('#fabric-width-hint').hidden = isColor;
    $('#fabric-delete').hidden = !f;
    updateFabricPreview();
    d.showModal();
  }

  function updateFabricPreview() {
    const f = fabricEditing;
    const box = $('#fabric-preview');
    if (!f || f.kind === 'color') {
      box.style.cssText = `background:${$('#fabric-color').value}`;
    } else {
      const a = store.fabricAsset(f);
      const w = Math.max(0.25, +$('#fabric-width').value || 8);
      // Preview box represents 12 inches of fabric.
      box.style.cssText = `background-image:url(${a.url});background-size:${(w / 12) * 100}% auto`;
    }
  }

  function initFabricDialog() {
    const d = $('#fabric-dialog');
    $('#fabric-color').addEventListener('input', updateFabricPreview);
    $('#fabric-width').addEventListener('input', updateFabricPreview);
    $('#fabric-save').addEventListener('click', () => {
      const name = $('#fabric-name').value.trim() || 'Fabric';
      if (fabricEditing) {
        const changes = { name };
        if (fabricEditing.kind === 'color') changes.color = $('#fabric-color').value;
        else changes.widthIn = Math.max(0.25, +$('#fabric-width').value || 8);
        store.updateFabric(fabricEditing.id, changes);
      } else {
        const f = store.addFabric({ name, kind: 'color', color: $('#fabric-color').value });
        if (editor.selection.size) editor.applyFabric(f.id);
      }
      d.close();
    });
    $('#fabric-delete').addEventListener('click', async () => {
      const f = fabricEditing;
      const used = S().pieces.filter((p) => p.fabricId === f.id).length;
      d.close();
      const msg = used ? `Delete “${f.name}”? ${used} piece${used > 1 ? 's' : ''} will lose this fabric.` : `Delete “${f.name}”?`;
      if (await confirmDialog(msg, 'Delete', true)) store.removeFabric(f.id);
    });
  }

  // ---------------------------------------------------------------- inspector
  function field(label, inner, cls = '') {
    return `<label class="field ${cls}"><span>${label}</span>${inner}</label>`;
  }
  const num = (id, value, attrs = '') =>
    `<div class="input-unit"><input type="number" id="${id}" value="${value}" ${attrs}><em>in</em></div>`;

  function shapeArea(p) {
    const shape = store.shapeById(p.shapeId);
    return shape ? Q.geo.polygonArea(shape.points) * (p.scale || 1) ** 2 : 0;
  }

  let inspectorStale = false;
  function renderInspector() {
    const box = $('#inspector');
    if (box.contains(document.activeElement) && document.activeElement.matches('input[type=number]')) {
      // Don't rebuild under the user's cursor while they're typing; catch up when they leave.
      inspectorStale = true;
      return;
    }
    inspectorStale = false;
    const sel = editor.selectedPieces();
    box.innerHTML = sel.length ? selectionHtml(sel) : quiltHtml();
    (sel.length ? bindSelection : bindQuilt)(sel);
  }

  function quiltHtml() {
    const q = S().quilt;
    const usage = new Map();
    for (const p of S().pieces) usage.set(p.fabricId || '', (usage.get(p.fabricId || '') || 0) + shapeArea(p));
    const usageRows = [...usage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, area]) => {
        const f = id && store.fabricById(id);
        const sw = f ? `<i class="mini-swatch" style="${swatchStyle(f)}"></i>` : '<i class="mini-swatch empty"></i>';
        return `<li>${sw}<span>${f ? esc(f.name) : 'No fabric yet'}</span><b>${fmt(area)} sq in</b></li>`;
      })
      .join('');
    const snapOpts = [[1, '1″'], [0.5, '½″'], [0.25, '¼″'], [0.125, '⅛″']]
      .map(([v, l]) => `<option value="${v}" ${q.snapStep === v ? 'selected' : ''}>${l}</option>`)
      .join('');
    return `
      <div class="insp-head"><h3>Quilt</h3><p>${S().pieces.length} piece${S().pieces.length === 1 ? '' : 's'}</p></div>
      <section class="insp-section">
        <h4>Finished size</h4>
        <div class="row gap">${field('Width', num('q-w', fmt(q.width), 'min="1" step="0.5"'))}${field('Height', num('q-h', fmt(q.height), 'min="1" step="0.5"'))}</div>
        <div class="presets">
          ${[['Baby', 36, 52], ['Throw', 50, 65], ['Twin', 70, 90], ['Queen', 90, 108], ['Mini', 24, 24]]
            .map(([n, w, h]) => `<button class="chip" data-size="${w}x${h}">${n}</button>`)
            .join('')}
        </div>
      </section>
      <section class="insp-section">
        <h4>Appearance</h4>
        <div class="row gap">
          ${field('Background', `<input type="color" id="q-bg" value="${q.background}">`)}
          ${field('Seam colour', `<input type="color" id="q-seam-color" value="${q.seamColor}">`)}
        </div>
        <label class="check"><input type="checkbox" id="q-seams" ${q.seams ? 'checked' : ''}> Show seam lines</label>
      </section>
      <section class="insp-section">
        <h4>Grid &amp; snapping</h4>
        <div class="row gap">
          ${field('Grid size', num('q-grid', fmt(q.gridSize), 'min="0.25" step="0.25"'))}
          ${field('Snap every', `<select id="q-snap">${snapOpts}</select>`)}
        </div>
        <label class="check"><input type="checkbox" id="q-snap-grid" ${q.snapGrid ? 'checked' : ''}> Snap to grid</label>
        <label class="check"><input type="checkbox" id="q-snap-pieces" ${q.snapPieces ? 'checked' : ''}> Snap corners to other pieces</label>
      </section>
      ${
        usageRows
          ? `<section class="insp-section"><h4>Fabric needed <small>(finished, no seam allowance)</small></h4><ul class="usage">${usageRows}</ul></section>`
          : ''
      }`;
  }

  function bindQuilt() {
    const q = () => S().quilt;
    const set = (changes) => {
      Object.assign(q(), changes);
      store.commit('quilt');
    };
    const onNum = (id, key, min) =>
      $('#' + id).addEventListener('change', (e) => {
        const v = +e.target.value;
        if (v >= min) set({ [key]: v });
        else e.target.value = q()[key];
      });
    onNum('q-w', 'width', 1);
    onNum('q-h', 'height', 1);
    onNum('q-grid', 'gridSize', 0.25);
    $('#q-snap').addEventListener('change', (e) => set({ snapStep: +e.target.value }));
    $('#q-bg').addEventListener('change', (e) => set({ background: e.target.value }));
    $('#q-seam-color').addEventListener('change', (e) => set({ seamColor: e.target.value }));
    $('#q-seams').addEventListener('change', (e) => set({ seams: e.target.checked }));
    $('#q-snap-grid').addEventListener('change', (e) => set({ snapGrid: e.target.checked }));
    $('#q-snap-pieces').addEventListener('change', (e) => set({ snapPieces: e.target.checked }));
    for (const b of $$('[data-size]')) {
      b.addEventListener('click', () => {
        const [w, h] = b.dataset.size.split('x').map(Number);
        set({ width: w, height: h });
        editor.fit();
      });
    }
  }

  function selectionHtml(sel) {
    const single = sel.length === 1 ? sel[0] : null;
    const shape = single && store.shapeById(single.shapeId);
    const b = editor.selectionBounds(sel);
    const fabricIds = new Set(sel.map((p) => p.fabricId || ''));
    const fabric = fabricIds.size === 1 && store.fabricById([...fabricIds][0]);
    const fill = (single || sel[0]).fill || {};
    const scales = new Set(sel.map((p) => p.scale || 1));
    const scale = scales.size === 1 ? Math.round([...scales][0] * 100) : '';

    let fabricBlock;
    if (fabric) {
      fabricBlock = `<div class="current-fabric"><i class="swatch" style="${swatchStyle(fabric)}"></i>
        <div><strong>${esc(fabric.name)}</strong><span>${fabric.kind === 'color' ? fabric.color : 'Print'}</span></div>
        <button class="icon-btn xs" id="s-same-fabric" data-tip="Select every piece in this fabric">${icon('select')}</button>
        <button class="icon-btn xs" id="s-clear-fabric" data-tip="Remove fabric">${icon('x')}</button></div>`;
      if (fabric.kind === 'image') {
        fabricBlock += `
          <label class="slider"><span>Print scale</span><output>${Math.round((fill.zoom || 1) * 100)}%</output><input type="range" id="s-zoom" min="0.25" max="4" step="0.05" value="${fill.zoom || 1}"></label>
          <label class="slider"><span>Print angle</span><output>${fill.rotation || 0}°</output><input type="range" id="s-frot" min="0" max="359" step="1" value="${fill.rotation || 0}"></label>
          <label class="slider"><span>Shift across</span><output>${fmt(fill.offsetX || 0)}″</output><input type="range" id="s-fx" min="-12" max="12" step="0.05" value="${fill.offsetX || 0}"></label>
          <label class="slider"><span>Shift down</span><output>${fmt(fill.offsetY || 0)}″</output><input type="range" id="s-fy" min="-12" max="12" step="0.05" value="${fill.offsetY || 0}"></label>
          <button class="link-btn" id="s-reset-fill">Reset print placement</button>`;
      }
    } else {
      fabricBlock = `<button class="btn block dashed" id="s-pick-fabric">${icon('fabric')}${
        fabricIds.size > 1 ? 'Mixed fabrics — choose one' : 'Choose a fabric'
      }</button>`;
    }

    return `
      <div class="insp-head">
        <h3>${single ? esc(shape ? shape.name : 'Piece') : `${sel.length} pieces`}</h3>
        <p>${fmt(b.w)}″ × ${fmt(b.h)}″</p>
      </div>
      <section class="insp-section"><h4>Fabric</h4>${fabricBlock}</section>
      <section class="insp-section">
        <h4>Rotate</h4>
        <div class="btn-row">
          <button class="btn sm" data-rot="-90" data-tip="Rotate 90° anticlockwise (Shift+R)">${icon('rot-ccw')}90°</button>
          <button class="btn sm" data-rot="-45">${icon('rot-ccw')}45°</button>
          <button class="btn sm" data-rot="45">${icon('rot-cw')}45°</button>
          <button class="btn sm" data-rot="90" data-tip="Rotate 90° clockwise (R)">${icon('rot-cw')}90°</button>
        </div>
        ${single ? field('Angle', `<div class="input-unit"><input type="number" id="s-angle" value="${fmt(single.rotation || 0)}" step="1"><em>°</em></div>`, 'inline') : ''}
      </section>
      <section class="insp-section">
        <h4>Mirror</h4>
        <div class="btn-row two">
          <button class="btn sm" data-flip="h" data-tip="Mirror left ↔ right (H)">${icon('flip-h')}Horizontal</button>
          <button class="btn sm" data-flip="v" data-tip="Mirror top ↕ bottom (V)">${icon('flip-v')}Vertical</button>
        </div>
      </section>
      <section class="insp-section">
        <h4>Size &amp; position</h4>
        <div class="row gap">
          ${field('Size', `<div class="input-unit"><input type="number" id="s-scale" value="${scale}" min="5" step="5" placeholder="mixed"><em>%</em></div>`)}
          ${field('Left', num('s-x', fmt(b.minX), 'step="0.25"'))}
          ${field('Top', num('s-y', fmt(b.minY), 'step="0.25"'))}
        </div>
      </section>
      <section class="insp-section">
        <div class="btn-row two">
          <button class="btn sm" id="s-dup" data-tip="Duplicate alongside (Ctrl+D)">${icon('copy')}Duplicate</button>
          <button class="btn sm danger-ghost" id="s-del" data-tip="Delete (Del)">${icon('trash')}Delete</button>
          <button class="btn sm" id="s-front">${icon('front')}To front</button>
          <button class="btn sm" id="s-back">${icon('back')}To back</button>
        </div>
      </section>`;
  }

  function bindSelection(sel) {
    for (const b of $$('[data-rot]')) b.addEventListener('click', () => editor.rotateSelected(+b.dataset.rot));
    for (const b of $$('[data-flip]')) b.addEventListener('click', () => editor.flipSelected(b.dataset.flip));
    const on = (id, ev, fn) => {
      const n = $('#' + id);
      if (n) n.addEventListener(ev, fn);
    };
    on('s-angle', 'change', (e) => editor.setRotation(+e.target.value || 0));
    on('s-scale', 'change', (e) => {
      const v = +e.target.value;
      if (v > 0) editor.setScale(v / 100);
    });
    on('s-x', 'change', (e) => editor.setPosition(+e.target.value, null));
    on('s-y', 'change', (e) => editor.setPosition(null, +e.target.value));
    on('s-dup', 'click', editor.duplicateSelected);
    on('s-del', 'click', editor.deleteSelected);
    on('s-front', 'click', () => editor.reorder('front'));
    on('s-back', 'click', () => editor.reorder('back'));
    on('s-pick-fabric', 'click', () => setSideTab('fabrics'));
    on('s-clear-fabric', 'click', () => editor.applyFabric(null));
    on('s-same-fabric', 'click', () => {
      const id = sel[0].fabricId;
      editor.setSelection(S().pieces.filter((p) => p.fabricId === id).map((p) => p.id));
      setSideTab('fabrics');
      toast('Now click a fabric to swap it in everywhere');
    });
    on('s-reset-fill', 'click', () => editor.setFill({ zoom: 1, rotation: 0, offsetX: 0, offsetY: 0 }));

    // Sliders preview live and commit (one undo step) on release.
    const slider = (id, key, label) => {
      const input = $('#' + id);
      if (!input) return;
      const out = input.previousElementSibling;
      input.addEventListener('input', () => {
        const v = +input.value;
        out.textContent = label(v);
        for (const p of sel) p.fill = { ...(p.fill || {}), [key]: v };
        editor.render();
      });
      input.addEventListener('change', () => store.commit('fill'));
    };
    slider('s-zoom', 'zoom', (v) => Math.round(v * 100) + '%');
    slider('s-frot', 'rotation', (v) => v + '°');
    slider('s-fx', 'offsetX', (v) => fmt(v) + '″');
    slider('s-fy', 'offsetY', (v) => fmt(v) + '″');
  }

  // ---------------------------------------------------------------- side tabs
  function setSideTab(name) {
    for (const b of $$('[data-side-tab]')) b.classList.toggle('active', b.dataset.sideTab === name);
    for (const p of $$('[data-side-pane]')) p.hidden = p.dataset.sidePane !== name;
  }

  // ---------------------------------------------------------------- export dialog
  function initExport() {
    const d = $('#export-dialog');
    let format = 'png';
    const update = () => {
      for (const b of $$('#export-format [data-format]')) b.classList.toggle('active', b.dataset.format === format);
      $('#export-page-field').hidden = format !== 'pdf';
      $('#export-caption-field').hidden = format !== 'pdf';
      const q = S().quilt;
      const want = +$('#export-dpi').value;
      const dpi = Math.min(want, Q.exporter.maxDpi(q));
      const px = `${Math.round(q.width * dpi)} × ${Math.round(q.height * dpi)} px`;
      $('#export-size').textContent =
        (format === 'pdf' ? `Quilt image ${px}, fitted to one page.` : `Image size ${px}.`) +
        (dpi < want ? ` (Reduced from ${want} px/in — this quilt is large.)` : '');
    };
    for (const b of $$('#export-format [data-format]')) {
      b.addEventListener('click', () => {
        format = b.dataset.format;
        update();
      });
    }
    $('#export-dpi').addEventListener('change', update);
    $('#export-go').addEventListener('click', async () => {
      const btn = $('#export-go');
      btn.disabled = true;
      btn.classList.add('busy');
      const opts = {
        format,
        dpi: +$('#export-dpi').value,
        seams: $('#export-seams').checked,
        pageSize: $('#export-page').value,
        caption: $('#export-caption').checked,
      };
      try {
        if (format === 'pdf') await Q.exporter.exportPdf(opts);
        else await Q.exporter.exportImage(opts);
        d.close();
        toast('Export ready');
      } catch (err) {
        console.error(err);
        toast('Export failed: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.classList.remove('busy');
      }
    });
    $('#btn-export').addEventListener('click', () => {
      update();
      d.showModal();
    });
  }

  // ---------------------------------------------------------------- toolbar & files
  function initToolbar() {
    $('#btn-undo').addEventListener('click', () => store.undo());
    $('#btn-redo').addEventListener('click', () => store.redo());
    $('#btn-new').addEventListener('click', async () => {
      const ok = await confirmDialog(
        'Start a new quilt? The current design will be cleared (your shape and fabric libraries are kept). Save a file first if you want to keep it.',
        'Start new'
      );
      if (ok) store.newProject(true);
    });
    $('#btn-save').addEventListener('click', () => {
      const blob = new Blob([store.exportProjectFile()], { type: 'application/json' });
      Q.exporter.download(blob, `${Q.exporter.safeFilename(S().name)}.quilt`);
      toast('Quilt file saved to your downloads');
    });
    $('#btn-open').addEventListener('click', () => $('#open-input').click());
    $('#open-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        store.importProjectFile(await file.text());
        toast(`Opened “${S().name}”`);
      } catch (err) {
        toast(err.message || 'Could not open that file');
      }
    });
    $('#btn-print').addEventListener('click', async () => {
      if (!S().pieces.length) return toast('Add some pieces first');
      await Q.exporter.print({ dpi: 150, seams: S().quilt.seams });
    });
    $('#btn-help').addEventListener('click', () => $('#help-dialog').showModal());

    const name = $('#project-name');
    name.addEventListener('change', () => {
      S().name = name.value.trim() || 'Untitled quilt';
      store.commit('name');
    });
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

    $('#btn-zoom-in').addEventListener('click', editor.zoomIn);
    $('#btn-zoom-out').addEventListener('click', editor.zoomOut);
    $('#btn-fit').addEventListener('click', editor.fit);
    $('#zoom-readout').addEventListener('click', editor.fit);
    $('#btn-grid').addEventListener('click', () => {
      S().quilt.showGrid = !S().quilt.showGrid;
      store.commit('quilt');
    });
    $('#btn-snap').addEventListener('click', () => {
      const q = S().quilt;
      const on = !(q.snapGrid || q.snapPieces);
      q.snapGrid = q.snapPieces = on;
      store.commit('quilt');
      toast(on ? 'Snapping on' : 'Snapping off');
    });
    editor.onViewChange = (v) => {
      $('#zoom-readout').textContent = Math.round((v.scale / 96) * 100) + '%';
    };

    for (const b of $$('[data-side-tab]')) b.addEventListener('click', () => setSideTab(b.dataset.sideTab));
    $('#btn-new-shape').addEventListener('click', () => Q.builder.open());
    $('#btn-upload-fabric').addEventListener('click', () => $('#fabric-input').click());
    $('#fabric-input').addEventListener('change', (e) => {
      addFabricFiles(e.target.files);
      e.target.value = '';
    });
    $('#btn-add-solid').addEventListener('click', () => openFabricDialog(null));

    const pane = $('[data-side-pane="fabrics"]');
    pane.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        pane.classList.add('drop-target');
      }
    });
    pane.addEventListener('dragleave', () => pane.classList.remove('drop-target'));
    pane.addEventListener('drop', (e) => {
      pane.classList.remove('drop-target');
      if (e.dataTransfer.files.length) {
        e.preventDefault();
        addFabricFiles(e.dataTransfer.files);
      }
    });

    for (const d of $$('dialog')) {
      d.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]') || e.target === d) d.close();
      });
    }
  }

  // ---------------------------------------------------------------- keyboard
  function initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (editor.isTyping(e) || document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const q = S().quilt;
      let handled = true;
      if (mod && k === 'z' && !e.shiftKey) store.undo();
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) store.redo();
      else if (mod && k === 'd') editor.duplicateSelected();
      else if (mod && k === 'c') editor.copySelected();
      else if (mod && k === 'x') editor.cutSelected();
      else if (mod && k === 'v') editor.paste();
      else if (mod && k === 'a') editor.selectAll();
      else if (mod && k === 's') $('#btn-save').click();
      else if (mod && k === 'p') $('#btn-print').click();
      else if (mod) handled = false;
      else if (k === 'delete' || k === 'backspace') editor.deleteSelected();
      else if (k === 'escape') editor.clearSelection();
      else if (k === 'r') editor.rotateSelected(e.shiftKey ? -90 : 90);
      else if (k === 'h') editor.flipSelected('h');
      else if (k === 'v') editor.flipSelected('v');
      else if (k === '+' || k === '=') editor.zoomIn();
      else if (k === '-' || k === '_') editor.zoomOut();
      else if (k === '0') editor.fit();
      else if (k.startsWith('arrow')) {
        const step = e.shiftKey ? 1 : q.snapStep || 0.25;
        const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
        editor.nudge(...d);
      } else handled = false;
      if (handled) e.preventDefault();
    });
  }

  // ---------------------------------------------------------------- boot
  function refresh(reason) {
    if (reason === 'load' || reason === 'history' || reason === 'shapes') renderShapeLibrary();
    if (reason !== 'selection') {
      $('#project-name').value = S().name;
      const q = S().quilt;
      $('#btn-grid').classList.toggle('on', q.showGrid);
      $('#btn-snap').classList.toggle('on', q.snapGrid || q.snapPieces);
    }
    renderFabricLibrary();
    renderInspector();
    $('#btn-undo').disabled = !store.canUndo();
    $('#btn-redo').disabled = !store.canRedo();
    $('#empty-hint').classList.toggle('hidden', S().pieces.length > 0);
  }

  async function boot() {
    initTooltips();
    editor.init($('#stage'));
    Q.builder.init();
    Q.patternImport.init();
    initFabricDialog();
    initExport();
    initToolbar();
    initKeyboard();
    store.subscribe(refresh);
    $('#inspector').addEventListener('focusout', () => setTimeout(() => inspectorStale && renderInspector()));
    await store.load();
    refresh('load');
  }

  boot();
})((window.Q = window.Q || {}));
