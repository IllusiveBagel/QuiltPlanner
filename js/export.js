/* Export the quilt to PNG / JPEG / PDF and print it. Everything is rendered with Canvas 2D
 * so it works offline and never taints the canvas. */
(function (Q) {
  'use strict';

  const MAX_SIDE = 12000;
  const MAX_PIXELS = 100e6;

  // Largest pixels-per-inch that keeps the canvas within browser limits.
  function maxDpi(quilt) {
    const bySide = MAX_SIDE / Math.max(quilt.width, quilt.height);
    const byArea = Math.sqrt(MAX_PIXELS / (quilt.width * quilt.height));
    return Math.floor(Math.min(bySide, byArea));
  }

  async function renderCanvas({ dpi = 100, seams = true, transparent = false } = {}) {
    const st = Q.store.state;
    const q = st.quilt;
    dpi = Math.max(10, Math.min(dpi, maxDpi(q)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(q.width * dpi);
    canvas.height = Math.round(q.height * dpi);
    const ctx = canvas.getContext('2d');
    if (!transparent) {
      ctx.fillStyle = q.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const base = Q.M.scale(dpi);

    // Make sure every fabric image is decoded before drawing.
    const used = new Set(st.pieces.map((p) => p.fabricId).filter(Boolean));
    const images = new Map();
    await Promise.all(
      [...used].map(async (id) => {
        const f = Q.store.fabricById(id);
        const a = f && Q.store.fabricAsset(f);
        if (a) images.set(id, await a.ready);
      })
    );

    const trace = (pts) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };

    for (const p of st.pieces) {
      const shape = Q.store.shapeById(p.shapeId);
      if (!shape) continue;
      const m = Q.M.multiply(base, Q.geo.pieceMatrix(p, shape));
      ctx.setTransform(...m);
      trace(shape.points);
      const fabric = p.fabricId && Q.store.fabricById(p.fabricId);
      const img = fabric && images.get(fabric.id);
      if (fabric && fabric.kind === 'image' && img) {
        const zoom = (p.fill && p.fill.zoom) || 1;
        const tw = (fabric.widthIn || 6) * zoom;
        const th = tw * (fabric.imgH / fabric.imgW);
        const pattern = ctx.createPattern(img, 'repeat');
        const pm = Q.M.multiply(Q.geo.fabricMatrix(p, shape), Q.M.scale(tw / img.naturalWidth, th / img.naturalHeight));
        pattern.setTransform(new DOMMatrix(pm));
        ctx.fillStyle = pattern;
      } else if (fabric && fabric.kind === 'color') {
        ctx.fillStyle = fabric.color;
      } else {
        ctx.fillStyle = '#e4ded3';
      }
      ctx.fill();
      // Hairline anti-aliasing gaps between neighbouring pieces: a matching stroke closes them.
      if (!seams) {
        ctx.setTransform(...base);
        trace(Q.geo.pieceWorldPoints(p, shape));
        ctx.lineWidth = 0.6 / dpi;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke();
      }
    }

    if (seams) {
      ctx.setTransform(...base);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = q.seamColor;
      ctx.lineWidth = Math.max(1, dpi / 70) / dpi;
      for (const p of st.pieces) {
        const shape = Q.store.shapeById(p.shapeId);
        if (!shape) continue;
        trace(Q.geo.pieceWorldPoints(p, shape));
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  const toBlob = (canvas, type, quality) => new Promise((res) => canvas.toBlob(res, type, quality));

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function safeFilename(name) {
    return (name || 'quilt').replace(/[\\/:*?"<>|]+/g, '').trim() || 'quilt';
  }

  async function exportImage({ format, dpi, seams }) {
    const transparent = false;
    const canvas = await renderCanvas({ dpi, seams, transparent });
    const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await toBlob(canvas, type, 0.92);
    download(blob, `${safeFilename(Q.store.state.name)}.${format === 'jpeg' ? 'jpg' : 'png'}`);
  }

  // ------------------------------------------------------------ minimal PDF writer
  const PAGE_SIZES = {
    letter: [612, 792],
    legal: [612, 1008],
    tabloid: [792, 1224],
    a4: [595.28, 841.89],
    a3: [841.89, 1190.55],
  };

  // PDF strings are Latin-1; replace anything else.
  function pdfText(s) {
    return String(s)
      .replace(/[″”“]/g, '"')
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/([\\()])/g, '\\$1');
  }

  async function buildPdf({ dpi, seams, pageSize = 'letter', caption = true }) {
    const st = Q.store.state;
    const q = st.quilt;
    const canvas = await renderCanvas({ dpi, seams });
    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());

    let [pw, ph] = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
    if (q.width > q.height) [pw, ph] = [ph, pw];
    const margin = 36;
    const captionH = caption ? 40 : 0;
    const availW = pw - margin * 2, availH = ph - margin * 2 - captionH;
    const s = Math.min(availW / q.width, availH / q.height);
    const iw = q.width * s, ih = q.height * s;
    const ix = (pw - iw) / 2, iy = margin + (availH - ih) / 2;

    let content = `q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im0 Do Q\n`;
    if (caption) {
      const title = pdfText(st.name || 'Quilt');
      const dims = pdfText(`${+q.width.toFixed(2)} in x ${+q.height.toFixed(2)} in  -  ${st.pieces.length} pieces`);
      const ty = ph - margin - 14;
      content += `BT /F1 16 Tf ${margin} ${ty.toFixed(2)} Td (${title}) Tj ET\n`;
      content += `BT /F1 10 Tf 0.4 g ${margin} ${(ty - 16).toFixed(2)} Td (${dims}) Tj ET\n`;
    }

    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let length = 0;
    const push = (x) => {
      const bytes = typeof x === 'string' ? enc.encode(x) : x;
      parts.push(bytes);
      length += bytes.length;
    };
    const obj = (n, body) => {
      offsets[n] = length;
      push(`${n} 0 obj\n`);
      for (const b of [].concat(body)) push(b);
      push('\nendobj\n');
    };

    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Contents 4 0 R ` +
        `/Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> >>`
    );
    obj(4, [`<< /Length ${enc.encode(content).length} >>\nstream\n`, content, '\nendstream']);
    obj(5, [
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ]);
    obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

    const xref = length;
    let x = `xref\n0 7\n0000000000 65535 f \n`;
    for (let i = 1; i <= 6; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x);
    push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function exportPdf(opts) {
    const blob = await buildPdf(opts);
    download(blob, `${safeFilename(Q.store.state.name)}.pdf`);
  }

  // ------------------------------------------------------------ print
  async function print({ dpi = 150, seams = true, caption = true } = {}) {
    const st = Q.store.state;
    const canvas = await renderCanvas({ dpi, seams });
    const url = URL.createObjectURL(await toBlob(canvas, 'image/png'));
    const area = document.getElementById('print-area');
    const q = st.quilt;
    area.innerHTML = '';
    if (caption) {
      const h = document.createElement('h1');
      h.textContent = st.name;
      const p = document.createElement('p');
      p.textContent = `${+q.width.toFixed(2)}″ × ${+q.height.toFixed(2)}″ · ${st.pieces.length} pieces`;
      area.append(h, p);
    }
    const img = new Image();
    img.src = url;
    area.appendChild(img);
    await img.decode().catch(() => {});

    const style = document.getElementById('print-page-style');
    style.textContent = `@page { size: ${q.width > q.height ? 'landscape' : 'portrait'}; margin: 12mm; }`;
    const cleanup = () => {
      area.innerHTML = '';
      URL.revokeObjectURL(url);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  Q.exporter = { renderCanvas, exportImage, exportPdf, print, maxDpi, download, safeFilename, PAGE_SIZES };
})((window.Q = window.Q || {}));
