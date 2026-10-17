/* Project state, undo/redo history and browser persistence (IndexedDB). */
(function (Q) {
  'use strict';

  const uid = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  function defaultShapes() {
    const g = Q.geo;
    const mk = (name, type, params) => ({ id: uid('shp'), name, type, params, points: g.buildShape(type, params) });
    return [
      mk('Square', 'square', { size: 3 }),
      mk('Rectangle', 'rectangle', { w: 6, h: 3 }),
      mk('Half-square triangle', 'hst', { size: 3 }),
      mk('Quarter-square triangle', 'qst', { size: 6 }),
      mk('Flying geese', 'isoTriangle', { w: 6, h: 3 }),
      mk('Equilateral triangle', 'equilateral', { size: 4 }),
      mk('60° diamond', 'diamond', { w: 2, h: 3.4641 }),
      mk('Hexagon', 'hexagon', { side: 2 }),
      mk('Parallelogram', 'parallelogram', { w: 4, h: 2, slant: 2 }),
      mk('Quarter circle', 'quarterCircle', { r: 3 }),
      mk("Drunkard's path", 'drunkardsPath', { size: 3, r: 2 }),
      mk('Octagon', 'octagon', { side: 1.25 }),
    ];
  }

  const SOLIDS = [
    ['Cream', '#f3ead8'],
    ['Blush', '#e9b8b0'],
    ['Terracotta', '#c8664a'],
    ['Mustard', '#d9a441'],
    ['Sage', '#9fb393'],
    ['Teal', '#2f7f86'],
    ['Navy', '#22344f'],
    ['Charcoal', '#3a3a3c'],
  ];

  function defaultFabrics() {
    const solids = SOLIDS.map(([name, color]) => ({ id: uid('fab'), name, kind: 'color', color }));
    return solids.concat(Q.samples ? Q.samples.makeSampleFabrics(uid) : []);
  }

  function defaultQuilt() {
    return {
      width: 36,
      height: 36,
      background: '#fbfaf7',
      gridSize: 1,
      snapStep: 0.5,
      showGrid: true,
      snapGrid: true,
      snapPieces: true,
      seams: true,
      seamColor: '#2b2b2b',
    };
  }

  // ---------------- state ----------------
  const state = {
    name: 'Untitled quilt',
    quilt: defaultQuilt(),
    shapes: [],
    fabrics: [],
    pieces: [],
  };

  const listeners = new Set();
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emit(reason) {
    for (const fn of listeners) fn(reason);
  }

  const shapeById = (id) => state.shapes.find((s) => s.id === id);
  const fabricById = (id) => state.fabrics.find((f) => f.id === id);
  const pieceById = (id) => state.pieces.find((p) => p.id === id);

  // ---------------- fabric images ----------------
  // Each image fabric gets an object URL (cheap to reference from SVG) and a decoded Image.
  const fabricAssets = new Map(); // id -> { url, img, ready }

  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function fabricAsset(fabric) {
    if (!fabric || fabric.kind !== 'image') return null;
    let a = fabricAssets.get(fabric.id);
    if (!a) {
      const url = URL.createObjectURL(dataUrlToBlob(fabric.dataUrl));
      const img = new Image();
      a = { url, img, ready: null };
      a.ready = new Promise((res) => {
        img.onload = () => res(img);
        img.onerror = () => res(null);
      });
      img.src = url;
      fabricAssets.set(fabric.id, a);
    }
    return a;
  }

  function releaseFabricAsset(id) {
    const a = fabricAssets.get(id);
    if (a) URL.revokeObjectURL(a.url);
    fabricAssets.delete(id);
  }

  // ---------------- history ----------------
  // Fabrics are kept out of history (they can be large); everything else is undoable.
  const history = { past: [], future: [], limit: 150 };
  const snapshot = () =>
    JSON.stringify({ name: state.name, quilt: state.quilt, shapes: state.shapes, pieces: state.pieces });

  let lastSnap = null;
  function resetHistory() {
    history.past = [];
    history.future = [];
    lastSnap = snapshot();
  }

  // Call after any user-visible change that should be undoable.
  function commit(reason = 'change') {
    const snap = snapshot();
    if (snap === lastSnap) return;
    history.past.push(lastSnap);
    if (history.past.length > history.limit) history.past.shift();
    history.future = [];
    lastSnap = snap;
    scheduleSave();
    emit(reason);
  }

  function restore(snap) {
    const s = JSON.parse(snap);
    state.name = s.name;
    state.quilt = s.quilt;
    state.shapes = s.shapes;
    const fabricIds = new Set(state.fabrics.map((f) => f.id));
    state.pieces = s.pieces.map((p) => (p.fabricId && !fabricIds.has(p.fabricId) ? { ...p, fabricId: null } : p));
    lastSnap = snap;
    scheduleSave();
    emit('history');
  }

  function undo() {
    if (!history.past.length) return false;
    history.future.push(lastSnap);
    restore(history.past.pop());
    return true;
  }

  function redo() {
    if (!history.future.length) return false;
    history.past.push(lastSnap);
    restore(history.future.pop());
    return true;
  }

  // ---------------- persistence ----------------
  const DB_NAME = 'quilt-designer';
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            const d = req.result;
            d.createObjectStore('kv');
            d.createObjectStore('fabrics', { keyPath: 'id' });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  async function tx(storeName, mode, fn) {
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
      try {
        const t = d.transaction(storeName, mode);
        const result = fn(t.objectStore(storeName));
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : true);
        t.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProject, 400);
  }

  function saveProject() {
    const project = {
      name: state.name,
      quilt: state.quilt,
      shapes: state.shapes,
      pieces: state.pieces,
      fabricOrder: state.fabrics.map((f) => f.id),
    };
    return tx('kv', 'readwrite', (s) => s.put(project, 'project'));
  }

  function saveFabric(f) {
    return tx('fabrics', 'readwrite', (s) => s.put(f));
  }

  function deleteFabricRecord(id) {
    return tx('fabrics', 'readwrite', (s) => s.delete(id));
  }

  function replaceAllFabrics(fabrics) {
    return tx('fabrics', 'readwrite', (s) => {
      s.clear();
      for (const f of fabrics) s.put(f);
    });
  }

  async function load() {
    const project = await tx('kv', 'readonly', (s) => s.get('project'));
    const fabrics = await tx('fabrics', 'readonly', (s) => s.getAll());
    if (project && project.quilt) {
      const byId = new Map((fabrics || []).map((f) => [f.id, f]));
      const ordered = (project.fabricOrder || []).map((id) => byId.get(id)).filter(Boolean);
      for (const f of fabrics || []) if (!ordered.includes(f)) ordered.push(f);
      state.name = project.name || 'Untitled quilt';
      state.quilt = { ...defaultQuilt(), ...project.quilt };
      state.shapes = project.shapes || [];
      state.fabrics = ordered;
      state.pieces = project.pieces || [];
    } else {
      newProject(true);
    }
    resetHistory();
    emit('load');
  }

  function newProject(keepLibrary) {
    const shapes = keepLibrary && state.shapes.length ? state.shapes : defaultShapes();
    const fabrics = keepLibrary && state.fabrics.length ? state.fabrics : defaultFabrics();
    state.name = 'Untitled quilt';
    state.quilt = defaultQuilt();
    state.shapes = shapes;
    state.fabrics = fabrics;
    state.pieces = [];
    replaceAllFabrics(fabrics);
    saveProject();
    resetHistory();
    emit('load');
  }

  // ---------------- project files ----------------
  function exportProjectFile() {
    return JSON.stringify(
      {
        app: 'quilt-designer',
        version: 1,
        name: state.name,
        quilt: state.quilt,
        shapes: state.shapes,
        fabrics: state.fabrics,
        pieces: state.pieces,
      },
      null,
      1
    );
  }

  function importProjectFile(text) {
    const data = JSON.parse(text);
    if (!data || data.app !== 'quilt-designer' || !Array.isArray(data.pieces)) {
      throw new Error('This file is not a Quilt Designer project.');
    }
    for (const id of fabricAssets.keys()) releaseFabricAsset(id);
    state.name = data.name || 'Untitled quilt';
    state.quilt = { ...defaultQuilt(), ...data.quilt };
    state.shapes = data.shapes || [];
    state.fabrics = data.fabrics || [];
    state.pieces = data.pieces;
    replaceAllFabrics(state.fabrics);
    saveProject();
    resetHistory();
    emit('load');
  }

  // ---------------- mutations used by the UI ----------------
  function addFabric(fabric) {
    const f = { id: uid('fab'), ...fabric };
    state.fabrics.push(f);
    saveFabric(f);
    saveProject();
    emit('fabrics');
    return f;
  }

  function updateFabric(id, changes) {
    const f = fabricById(id);
    if (!f) return;
    Object.assign(f, changes);
    saveFabric(f);
    emit('fabrics');
  }

  function removeFabric(id) {
    state.fabrics = state.fabrics.filter((f) => f.id !== id);
    for (const p of state.pieces) if (p.fabricId === id) p.fabricId = null;
    releaseFabricAsset(id);
    deleteFabricRecord(id);
    commit('fabrics');
    saveProject();
    emit('fabrics');
  }

  function moveFabric(id, toIndex) {
    const i = state.fabrics.findIndex((f) => f.id === id);
    if (i < 0) return;
    const [f] = state.fabrics.splice(i, 1);
    state.fabrics.splice(Math.max(0, Math.min(toIndex, state.fabrics.length)), 0, f);
    saveProject();
    emit('fabrics');
  }

  Q.store = {
    state,
    uid,
    subscribe,
    emit,
    commit,
    undo,
    redo,
    canUndo: () => history.past.length > 0,
    canRedo: () => history.future.length > 0,
    load,
    newProject,
    exportProjectFile,
    importProjectFile,
    shapeById,
    fabricById,
    pieceById,
    fabricAsset,
    addFabric,
    updateFabric,
    removeFabric,
    moveFabric,
    defaultShapes,
  };
})((window.Q = window.Q || {}));
