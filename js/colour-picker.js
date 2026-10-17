/* A built-in colour picker: a grid of quilting colours, hue / saturation / lightness sliders and a
 * hex box. Used instead of <input type="color">, which shows an empty popup in some mobile
 * browsers (those built on Android's WebView). */
(function (Q) {
  'use strict';

  // ---------------------------------------------------------------- colour maths
  function hexToHsl(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, Math.round(l * 100)];
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }

  // Accepts "#abc", "abc", "#aabbcc" or "aabbcc"; returns "#aabbcc" or null.
  function normaliseHex(text) {
    let t = String(text).trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(t)) t = t.split('').map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/.test(t) ? '#' + t : null;
  }

  // ---------------------------------------------------------------- swatches
  const NEUTRALS = ['#ffffff', '#f3ead8', '#e4dccb', '#c9c4bb', '#8f8a83', '#4a4642', '#22201e', '#22344f'];
  const HUES = [355, 22, 44, 110, 175, 212, 265, 325]; // red, orange, mustard, green, teal, blue, purple, pink
  const TINTS = [[55, 88], [55, 72], [55, 52], [50, 32]]; // [saturation, lightness]
  const SWATCHES = [...NEUTRALS, ...TINTS.flatMap(([s, l]) => HUES.map((h) => hslToHex(h, s, l)))];

  // ---------------------------------------------------------------- picker UI
  // Builds a picker inside `container`. Returns { get(), set(hex) }.
  function mount(container, initial, onChange) {
    container.classList.add('colour-picker');
    container.innerHTML = `
      <div class="cp-swatches">${SWATCHES.map((c) => `<button type="button" class="cp-swatch" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
      <label class="cp-slider"><span>Hue</span><input type="range" min="0" max="359" data-k="h"></label>
      <label class="cp-slider"><span>Strength</span><input type="range" min="0" max="100" data-k="s"></label>
      <label class="cp-slider"><span>Lightness</span><input type="range" min="0" max="100" data-k="l"></label>
      <label class="field inline cp-hex"><span>Hex</span><input type="text" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off"></label>`;
    const hexInput = container.querySelector('.cp-hex input');
    const sliders = Object.fromEntries([...container.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i]));
    let hex = normaliseHex(initial) || '#7a9e9f';
    let hsl = hexToHsl(hex);

    function paint(fromHexBox) {
      sliders.h.value = hsl[0];
      sliders.s.value = hsl[1];
      sliders.l.value = hsl[2];
      sliders.h.style.background = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => hslToHex(h % 360, Math.max(hsl[1], 40), 50)).join(',')})`;
      sliders.s.style.background = `linear-gradient(to right, ${hslToHex(hsl[0], 0, hsl[2])}, ${hslToHex(hsl[0], 100, hsl[2])})`;
      sliders.l.style.background = `linear-gradient(to right, #000, ${hslToHex(hsl[0], hsl[1], 50)}, #fff)`;
      if (!fromHexBox) hexInput.value = hex;
      for (const b of container.querySelectorAll('.cp-swatch')) b.classList.toggle('active', b.dataset.c === hex);
    }

    function update(newHex, newHsl, fromHexBox) {
      hex = newHex;
      hsl = newHsl || hexToHsl(newHex);
      paint(fromHexBox);
      if (onChange) onChange(hex);
    }

    container.addEventListener('click', (e) => {
      const b = e.target.closest('.cp-swatch');
      if (b) update(b.dataset.c);
    });
    for (const input of Object.values(sliders)) {
      input.addEventListener('input', () => {
        const next = [+sliders.h.value, +sliders.s.value, +sliders.l.value];
        update(hslToHex(...next), next);
      });
    }
    hexInput.addEventListener('input', () => {
      const v = normaliseHex(hexInput.value);
      hexInput.classList.toggle('invalid', !v && hexInput.value.trim() !== '');
      if (v) update(v, null, true);
    });
    hexInput.addEventListener('blur', () => {
      hexInput.value = hex;
      hexInput.classList.remove('invalid');
    });

    paint();
    return {
      get: () => hex,
      set(v) {
        hex = normaliseHex(v) || hex;
        hsl = hexToHsl(hex);
        paint();
      },
    };
  }

  // Ask for a colour in a dialog. Resolves with "#rrggbb", or null if cancelled.
  function pick(initial, title = 'Choose a colour') {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'modal modal-sm colour-dialog';
      d.innerHTML = `
        <header class="modal-head"><h2></h2><button class="icon-btn" value="cancel" aria-label="Close"><svg><use href="#i-x"/></svg></button></header>
        <div class="modal-body stack"><div class="cp-preview"></div><div class="cp-mount"></div></div>
        <footer class="modal-foot"><span class="spacer"></span><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">Use colour</button></footer>`;
      d.querySelector('h2').textContent = title;
      document.body.append(d);
      const preview = d.querySelector('.cp-preview');
      const picker = mount(d.querySelector('.cp-mount'), initial, (c) => (preview.style.background = c));
      preview.style.background = picker.get();
      d.addEventListener('click', (e) => {
        const b = e.target.closest('button[value]');
        if (b) d.close(b.value);
      });
      d.addEventListener('close', () => {
        resolve(d.returnValue === 'ok' ? picker.get() : null);
        d.remove();
      });
      d.showModal();
    });
  }

  Q.colourPicker = { mount, pick, hexToHsl, hslToHex, normaliseHex };
})((window.Q = window.Q || {}));
