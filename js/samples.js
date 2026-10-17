/* A few procedurally drawn sample prints so a new project has fabrics to play with. */
(function (Q) {
  'use strict';

  function tile(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    draw(ctx, size);
    return c.toDataURL('image/png');
  }

  const prints = [
    {
      name: 'Gingham',
      widthIn: 1,
      draw(ctx, s) {
        ctx.fillStyle = '#fbf6ee';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(196, 72, 72, 0.45)';
        ctx.fillRect(0, 0, s / 2, s);
        ctx.fillRect(0, 0, s, s / 2);
      },
    },
    {
      name: 'Polka dot',
      widthIn: 1,
      draw(ctx, s) {
        ctx.fillStyle = '#26415e';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#f4ecdc';
        const r = s * 0.09;
        for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) {
          ctx.beginPath();
          ctx.arc(x * s, y * s, r, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    },
    {
      name: 'Ticking stripe',
      widthIn: 1.5,
      draw(ctx, s) {
        ctx.fillStyle = '#f2ead9';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#4c6a7d';
        ctx.fillRect(s * 0.1, 0, s * 0.12, s);
        ctx.fillRect(s * 0.3, 0, s * 0.03, s);
        ctx.fillRect(s * 0.62, 0, s * 0.12, s);
        ctx.fillRect(s * 0.82, 0, s * 0.03, s);
      },
    },
    {
      name: 'Chevron',
      widthIn: 1.5,
      draw(ctx, s) {
        ctx.fillStyle = '#f7f1e3';
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = '#d9a441';
        ctx.lineWidth = s * 0.14;
        ctx.lineJoin = 'miter';
        for (const y of [-0.5, 0, 0.5, 1]) {
          ctx.beginPath();
          ctx.moveTo(-0.1 * s, (y + 0.35) * s);
          ctx.lineTo(0.5 * s, (y + 0.1) * s);
          ctx.lineTo(1.1 * s, (y + 0.35) * s);
          ctx.stroke();
        }
      },
    },
    {
      name: 'Ditsy floral',
      widthIn: 2,
      draw(ctx, s) {
        ctx.fillStyle = '#a9bfa0';
        ctx.fillRect(0, 0, s, s);
        const flower = (x, y, r, petal, centre) => {
          ctx.fillStyle = petal;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.75, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = centre;
          ctx.beginPath();
          ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
          ctx.fill();
        };
        const spots = [
          [0.2, 0.2, '#fbf3e6'], [0.7, 0.35, '#f1c6bd'], [0.35, 0.72, '#f1c6bd'],
          [0.85, 0.85, '#fbf3e6'], [0.55, 0.05, '#fbf3e6'], [0.05, 0.55, '#fbf3e6'],
        ];
        for (const [x, y, c] of spots) {
          // Draw wrapped copies so the tile repeats seamlessly.
          for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) flower((x + dx) * s, (y + dy) * s, s * 0.035, c, '#d9a441');
        }
      },
    },
  ];

  function makeSampleFabrics(uid) {
    const size = 256;
    return prints.map((p) => ({
      id: uid('fab'),
      name: p.name,
      kind: 'image',
      dataUrl: tile(size, p.draw),
      imgW: size,
      imgH: size,
      widthIn: p.widthIn,
    }));
  }

  Q.samples = { makeSampleFabrics };
})((window.Q = window.Q || {}));
