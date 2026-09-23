/*!
 * Bongo Cat – einbindbare Animation, keine Abhängigkeiten.
 *
 * Einbindung (fixiert unten rechts):
 *   <script src="bongo-cat.js" defer></script>
 *
 * In einem Container:
 *   <div id="cat"></div>
 *   <script src="bongo-cat.js" data-target="#cat" defer></script>
 *
 * Optionen (data-Attribute am <script>-Tag):
 *   data-target   CSS-Selektor eines Containers (ohne: fixiert am Bildschirmrand)
 *   data-position bottom-right | bottom-left | top-right | top-left   (Standard: bottom-right)
 *   data-size     Breite im fixierten Modus, z. B. "220" oder "15rem"  (Standard: 220)
 *   data-offset   Abstand zum Rand, z. B. "16"                         (Standard: 16)
 *   data-z-index  z-index im fixierten Modus                           (Standard: 9999)
 *   data-auto     "false" = nicht automatisch starten, stattdessen BongoCat.create({...})
 *
 * JS-API:
 *   var cat = BongoCat.create({ target: '#cat' });  // gleiche Optionen wie oben (camelCase)
 *   cat.destroy();
 *
 * Farben lassen sich per CSS-Variablen am Host-Element überschreiben, z. B.:
 *   .bongo-cat { --bc-fur: #fff8ee; --bc-cup: #7fb3ff; }
 */
(function (global) {
  'use strict';

  var currentScript = document.currentScript;

  // Datei mehrfach eingebunden (z. B. fixiert + Container): nur neue Instanz starten.
  if (global.BongoCat && typeof global.BongoCat.create === 'function') {
    autoInit(global.BongoCat, currentScript);
    return;
  }

  // ---------------------------------------------------------------------------
  // Geometrie (SVG-Koordinaten, viewBox 0 20 400 276)
  // ---------------------------------------------------------------------------
  var SHOULDER_L = { x: 135, y: 185 };
  var SHOULDER_R = { x: 265, y: 185 };

  var CUP_HELD = { x: 70, y: 190, a: 0 };
  var CUP_DRINK = { x: 168, y: 151, a: 35 };
  var CUP_TABLE = { x: 58, y: 250, a: 0 };
  var CUP_GRIP = { x: 21, y: 1 }; // Griffpunkt (Henkel) relativ zur Tassenmitte, in Tassen-Einheiten

  var PAW_REST_Y = 214; // Pfoten schweben über der Tastatur
  var PAW_REST_L = 150;
  var PAW_REST_R = 222;

  var MOUSE_MIN = { x: 301, y: 248 };
  var MOUSE_RANGE = { x: 62, y: 16 };
  var CUP_SCALE = 1.15;

  var KEY_W = 14, KEY_H = 9, KEY_GAP = 2.4, KEY_X0 = 105.2, ROW_Y0 = 233, ROW_STEP = 11;
  var SPACE = { x: 137, y: 233, w: 98, h: 9 }; // Leertaste oben – die Tastatur ist zur Katze gedreht

  // Zeitverhalten (ms)
  var KEY_IDLE = 2000;      // so lange ohne Taste -> zurück in den Maus-Modus
  var MOVE_GRACE = 400;     // Mausbewegungen direkt nach dem Tippen ignorieren
  var MOVE_SWITCH_PX = 30;  // so viel Mausbewegung schaltet in den Maus-Modus
  var PRESS_MS = 90;        // Dauer eines Tastenanschlags
  var SLOW_MS = 400;        // weiche Übergangsphase nach Moduswechsel

  // ---------------------------------------------------------------------------
  // Tastenzuordnung (event.code = physische Position, unabhängig vom Layout)
  // ---------------------------------------------------------------------------
  var ROWS = [
    ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
    ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
    ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']
  ];
  var CODE_MAP = {};
  var CHAR_MAP = {};
  ROWS.forEach(function (row, r) {
    row.forEach(function (code, c) {
      CODE_MAP[code] = [r, c];
      if (code.indexOf('Key') === 0) CHAR_MAP[code.charAt(3).toLowerCase()] = [r, c];
    });
  });
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']
    .forEach(function (code, c) { CODE_MAP[code] = [0, c]; });
  var EXTRA = {
    Escape: [0, 0], Backquote: [0, 0], Tab: [0, 0], CapsLock: [1, 0],
    ShiftLeft: [2, 0], ControlLeft: [2, 0], AltLeft: [2, 0], MetaLeft: [2, 0], IntlBackslash: [2, 0],
    Minus: [0, 9], Equal: [0, 9], BracketLeft: [0, 9], BracketRight: [0, 9], Backspace: [0, 9], Delete: [0, 9],
    Quote: [1, 9], Backslash: [1, 9], Enter: [1, 9], NumpadEnter: [1, 9],
    ShiftRight: [2, 9], ControlRight: [2, 9], AltRight: [2, 9], MetaRight: [2, 9],
    ArrowUp: [2, 9], ArrowDown: [2, 9], ArrowRight: [2, 9], ArrowLeft: [2, 8]
  };
  Object.keys(EXTRA).forEach(function (code) { CODE_MAP[code] = EXTRA[code]; });

  function lookupKey(e) {
    if (e.code === 'Space' || e.key === ' ') return 'space';
    if (e.code && CODE_MAP[e.code]) return CODE_MAP[e.code];
    var ch = typeof e.key === 'string' && e.key.length === 1 ? e.key.toLowerCase() : '';
    if (CHAR_MAP[ch]) return CHAR_MAP[ch];
    return [Math.floor(Math.random() * 3), Math.floor(Math.random() * 10)];
  }

  // Die Katze sitzt uns gegenüber, die Tastatur ist also um 180° gedreht:
  // Leertaste oben (bei der Katze), Q-Reihe unten, und links/rechts gespiegelt.
  function keyX(c) { return KEY_X0 + (9 - c) * (KEY_W + KEY_GAP); }
  function keyY(r) { return ROW_Y0 + (3 - r) * ROW_STEP; }

  function keyCenter(r, c) {
    return { x: keyX(c) + KEY_W / 2, y: keyY(r) + KEY_H / 2 };
  }

  // ---------------------------------------------------------------------------
  // Grafik
  // ---------------------------------------------------------------------------
  var CSS = [
    ':host{display:block;line-height:0;',
    '--bc-line:#1d1d22;--bc-fur:#ffffff;--bc-pink:#ffb3c7;--bc-mouth:#e0607e;',
    '--bc-table:#f3e5d0;--bc-kb:#d9dee7;--bc-key:#ffffff;--bc-key-hit:#ffcf5a;',
    '--bc-pad:#c7dcf4;--bc-mouse:#ffffff;--bc-mouse-hit:#8fb4e8;',
    '--bc-cup:#ff8f7e;--bc-coffee:#7a4a35;--bc-steam:#a4a9b0}',
    'svg{display:block;width:100%;height:auto;overflow:visible}',
    '.fur{fill:var(--bc-fur);stroke:var(--bc-line);stroke-width:3.5;stroke-linejoin:round}',
    '.ear{fill:var(--bc-pink)}',
    '.blush{fill:var(--bc-pink);opacity:.55}',
    '.eye{fill:var(--bc-line)}',
    '.happy path,.mouth,.cable,.toes{fill:none;stroke:var(--bc-line);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}',
    '.mouth-open{fill:var(--bc-mouth);stroke:var(--bc-line);stroke-width:2.5;stroke-linejoin:round}',
    '.table{fill:var(--bc-table);stroke:var(--bc-line);stroke-width:3.5}',
    '.kb{fill:var(--bc-kb);stroke:var(--bc-line);stroke-width:3}',
    '.key{fill:var(--bc-key);stroke:var(--bc-line);stroke-width:1.2;transition:fill .3s ease-out}',
    '.key.hit{fill:var(--bc-key-hit);transition:none}',
    '.pad{fill:var(--bc-pad);stroke:var(--bc-line);stroke-width:3}',
    '.cable{stroke-width:2.2}',
    '.mouse-body{fill:var(--bc-mouse);stroke:var(--bc-line);stroke-width:2.5}',
    '.mouse-btn{fill:transparent;transition:fill .2s ease-out}',
    '.mouse-btn.hit{fill:var(--bc-mouse-hit);transition:none}',
    '.mouse-line{fill:none;stroke:var(--bc-line);stroke-width:2;stroke-linecap:round}',
    '.cup-handle{fill:none;stroke:var(--bc-line);stroke-width:7.5;stroke-linecap:round}',
    '.cup-handle-in{fill:none;stroke:var(--bc-cup);stroke-width:3;stroke-linecap:round}',
    '.cup-body{fill:var(--bc-cup);stroke:var(--bc-line);stroke-width:3;stroke-linejoin:round}',
    '.coffee{fill:var(--bc-coffee)}',
    '.heart{fill:#fff}',
    '.steam path{fill:none;stroke:var(--bc-steam);stroke-width:2.2;stroke-linecap:round;',
    'animation:bc-steam 2.6s ease-in-out infinite}',
    '.steam path:nth-child(2){animation-delay:1.3s}',
    '@keyframes bc-steam{0%{opacity:0;transform:translateY(5px)}35%{opacity:.85}100%{opacity:0;transform:translateY(-9px)}}',
    '.arm-line{fill:none;stroke:var(--bc-line);stroke-width:24;stroke-linecap:round}',
    '.arm-fill{fill:none;stroke:var(--bc-fur);stroke-width:18;stroke-linecap:round}',
    '.shoulder{fill:var(--bc-fur)}',
    '.paw{fill:var(--bc-fur);stroke:var(--bc-line);stroke-width:3}',
    '.toes{stroke-width:2}',
    '@media (prefers-reduced-motion:reduce){.steam path{animation:none;opacity:.5}}'
  ].join('');

  function armMarkup(side) {
    return '<g data-p="arm' + side + '">' +
      '<path class="arm-line"/><path class="arm-fill"/><circle class="shoulder" r="12.5"/>' +
      '<circle class="paw" r="14"/><path class="toes"/></g>';
  }

  function keysMarkup() {
    var out = '';
    for (var r = 0; r < ROWS.length; r++) {
      for (var c = 0; c < 10; c++) {
        out += '<rect class="key" data-k="' + r + '-' + c + '" x="' + keyX(c).toFixed(1) +
          '" y="' + keyY(r) + '" width="' + KEY_W + '" height="' + KEY_H + '" rx="2"/>';
      }
    }
    out += '<rect class="key" data-k="space" x="' + SPACE.x + '" y="' + SPACE.y + '" width="' + SPACE.w +
      '" height="' + SPACE.h + '" rx="2"/>';
    return out;
  }

  var SVG =
    '<svg viewBox="0 20 400 276" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
      // Kopf / Körper (hinter dem Tisch)
      '<g data-p="head">' +
        '<path class="fur" d="M80 232C78 160 96 118 118 100L128 46Q131 38 138 44L170 72Q200 64 230 72L262 44Q269 38 272 46L282 100C304 118 322 160 320 232Z"/>' +
        '<path class="ear" d="M135 56L128 86L153 69Z"/><path class="ear" d="M265 56L272 86L247 69Z"/>' +
        '<ellipse class="blush" cx="150" cy="148" rx="11" ry="6"/><ellipse class="blush" cx="250" cy="148" rx="11" ry="6"/>' +
        '<ellipse class="eye" data-p="eyeL" cx="172" cy="130" rx="5.5" ry="7"/>' +
        '<ellipse class="eye" data-p="eyeR" cx="228" cy="130" rx="5.5" ry="7"/>' +
        '<g class="happy" data-p="happy" opacity="0"><path d="M164 132Q172 121 180 132"/><path d="M220 132Q228 121 236 132"/></g>' +
        '<path class="mouth-open" data-p="mouthOpen" d="M191 148Q200 164 209 148Z" opacity="0"/>' +
        '<path class="mouth" d="M189 145Q194.5 153 200 146Q205.5 153 211 145"/>' +
      '</g>' +
      // Tisch mit Tastatur und Maus
      '<rect class="table" x="8" y="212" width="384" height="80" rx="14"/>' +
      '<rect class="kb" x="100" y="228" width="172" height="53" rx="6"/>' +
      '<g data-p="keys">' + keysMarkup() + '</g>' +
      '<rect class="pad" x="285" y="228" width="95" height="54" rx="8"/>' +
      '<path class="cable" data-p="cable"/>' +
      '<g data-p="mouse">' +
        '<rect class="mouse-body" x="-13" y="-18" width="26" height="36" rx="13"/>' +
        '<path class="mouse-btn" data-p="mouseBtn" d="M0 6.2H-11.4A11.4 11.4 0 0 0 0 17.6Z"/>' +
        '<path class="mouse-line" d="M-12.6 5H12.6M0 5V18"/>' +
      '</g>' +
      // Linker Arm liegt hinter der Tasse, damit die Pfote den Henkel von hinten greift
      armMarkup('L') +
      // Tasse
      '<g class="steam" data-p="steam"><path d="M-5 0q-4 -5 0 -10q4 -5 0 -10"/><path d="M5 -3q-4 -5 0 -10q4 -5 0 -10"/></g>' +
      '<g data-p="cup">' +
        '<g data-p="handle">' +
          '<path class="cup-handle" d="M14 -8C26 -8 26 8 13 8"/>' +
          '<path class="cup-handle-in" d="M14 -8C26 -8 26 8 13 8"/>' +
        '</g>' +
        '<path class="cup-body" d="M-15 -16H15L13 13Q12.8 16 10 16H-10Q-12.8 16 -13 13Z"/>' +
        '<ellipse class="coffee" cx="0" cy="-13" rx="12" ry="2.4"/>' +
        '<path class="heart" data-p="heart1" d="M0 6C-7 1 -6 -5 -2.5 -4C-1 -3.6 0 -2.5 0 -2C0 -2.5 1 -3.6 2.5 -4C6 -5 7 1 0 6Z"/>' +
        '<path class="heart" data-p="heart2" d="M0 6C-7 1 -6 -5 -2.5 -4C-1 -3.6 0 -2.5 0 -2C0 -2.5 1 -3.6 2.5 -4C6 -5 7 1 0 6Z"/>' +
      '</g>' +
      // Rechter Arm (über Tastatur und Maus)
      armMarkup('R') +
    '</svg>';

  // ---------------------------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------------------------

  // Kritisch gedämpfte Feder: sanftes Anfahren und Abbremsen, framerate-unabhängig.
  function Spring(x, w) { this.x = x; this.v = 0; this.t = x; this.w = w; }
  Spring.prototype.step = function (dt) {
    var n = Math.ceil(dt / 0.008), h = dt / n, w = this.w;
    for (var i = 0; i < n; i++) {
      this.v += (w * w * (this.t - this.x) - 2 * w * this.v) * h;
      this.x += this.v * h;
    }
  };
  Spring.prototype.snap = function (x) { this.x = this.t = x; this.v = 0; };

  function Spring2(x, y, w) { this.x = new Spring(x, w); this.y = new Spring(y, w); }
  Spring2.prototype.to = function (x, y, w) {
    this.x.t = x; this.y.t = y;
    if (w) this.x.w = this.y.w = w;
  };
  Spring2.prototype.step = function (dt) { this.x.step(dt); this.y.step(dt); };
  Spring2.prototype.snap = function (x, y) { this.x.snap(x); this.y.snap(y); };

  function f(n) { return Math.round(n * 100) / 100; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }

  // spin = Drehung der Tasse um die Hochachse (0 = Henkel rechts, PI = Henkel links)
  function gripOf(x, y, deg, spin) {
    var a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    var gx = CUP_GRIP.x * Math.cos(spin || 0) * CUP_SCALE, gy = CUP_GRIP.y * CUP_SCALE;
    return { x: x + gx * cos - gy * sin, y: y + gx * sin + gy * cos };
  }

  function toCssLength(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    return /^-?\d+(\.\d+)?$/.test(String(v)) ? v + 'px' : String(v);
  }

  // Schreibt Attribute nur, wenn sich der Wert geändert hat (keine unnötigen DOM-Writes).
  function setAttr(el, name, value) {
    var cache = el.__bc || (el.__bc = {});
    if (cache[name] !== value) { cache[name] = value; el.setAttribute(name, value); }
  }

  // ---------------------------------------------------------------------------
  // Instanz
  // ---------------------------------------------------------------------------
  function create(options) {
    var opts = options || {};
    var target = opts.target || null;
    if (typeof target === 'string') {
      var found = document.querySelector(target);
      if (!found) console.warn('[BongoCat] Container "' + target + '" nicht gefunden – nutze fixierte Position.');
      target = found;
    }

    var host = document.createElement('div');
    host.className = 'bongo-cat';
    host.setAttribute('aria-hidden', 'true');

    if (target) {
      host.style.display = 'block';
      host.style.width = '100%';
    } else {
      var pos = String(opts.position || 'bottom-right').split('-');
      var vert = pos[0] === 'top' ? 'top' : 'bottom';
      var horiz = pos[1] === 'left' ? 'left' : 'right';
      var offset = toCssLength(opts.offset, '16px');
      host.style.position = 'fixed';
      host.style[vert] = offset;
      host.style[horiz] = offset;
      host.style.width = 'min(' + toCssLength(opts.size, '220px') + ', 45vw)';
      host.style.zIndex = String(opts.zIndex || 9999);
      host.style.pointerEvents = 'none';
    }

    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>' + SVG;
    (target || document.body).appendChild(host);

    function part(name) { return root.querySelector('[data-p="' + name + '"]'); }
    function armParts(side) {
      var g = part('arm' + side);
      return {
        line: g.querySelector('.arm-line'), fill: g.querySelector('.arm-fill'),
        shoulder: g.querySelector('.shoulder'), paw: g.querySelector('.paw'), toes: g.querySelector('.toes')
      };
    }
    var el = {
      head: part('head'), eyeL: part('eyeL'), eyeR: part('eyeR'), happy: part('happy'),
      mouthOpen: part('mouthOpen'), cable: part('cable'), mouse: part('mouse'), mouseBtn: part('mouseBtn'),
      steam: part('steam'), cup: part('cup'), handle: part('handle'), heart1: part('heart1'), heart2: part('heart2'), armL: armParts('L'), armR: armParts('R'), keys: {}
    };
    Array.prototype.forEach.call(root.querySelectorAll('[data-k]'), function (k) {
      el.keys[k.getAttribute('data-k')] = k;
    });
    setAttr(el.armL.shoulder, 'cx', SHOULDER_L.x); setAttr(el.armL.shoulder, 'cy', SHOULDER_L.y);
    setAttr(el.armR.shoulder, 'cx', SHOULDER_R.x); setAttr(el.armR.shoulder, 'cy', SHOULDER_R.y);

    // --- Zustand -------------------------------------------------------------
    var now0 = performance.now();
    var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = !!(mq && mq.matches);

    var mode = 'mouse';
    var leftState = 'holding'; // holding | placing | free | fetching
    var lastKey = -Infinity;
    var moveAccum = 0;
    var pointer = { nx: 0.5, ny: 0.5, px: null, py: null, down: false, downUntil: 0 };
    var drinking = false, drinkStart = 0, nextDrink = now0 + rand(5000, 9000);
    var nextBlink = now0 + rand(2500, 5000), blinkUntil = 0;
    var mouthUntil = 0;
    var spaceToggle = false;
    var lookX = 185;
    var hitKeys = [];

    var startMouse = { x: MOUSE_MIN.x + MOUSE_RANGE.x / 2, y: MOUSE_MIN.y + MOUSE_RANGE.y / 2 };
    var mouse = new Spring2(startMouse.x, startMouse.y, 20);
    var cup = new Spring2(CUP_HELD.x, CUP_HELD.y, 7);
    var cupA = new Spring(CUP_HELD.a, 7);
    var cupSpin = new Spring(0, 6);
    var grip0 = gripOf(CUP_HELD.x, CUP_HELD.y, CUP_HELD.a);
    var pawL = new Spring2(grip0.x, grip0.y, 12);
    var pawR = new Spring2(startMouse.x + 1, startMouse.y - 8, 40);
    pawL.press = { x: 0, y: 0, until: 0 }; pawL.restX = PAW_REST_L; pawL.slowUntil = 0;
    pawR.press = { x: 0, y: 0, until: 0 }; pawR.restX = PAW_REST_R; pawR.slowUntil = 0;
    var head = new Spring(0, 7);
    var eyes = new Spring2(0, 0, 10);
    var eyeOpen = new Spring(1, 40);
    var happy = new Spring(0, 14);
    var mouthS = new Spring(0, 32);
    var steam = new Spring(1, 8);

    function setMode(m, now) {
      if (mode === m) return;
      mode = m;
      pawR.slowUntil = now + SLOW_MS;
      if (leftState === 'free' || leftState === 'fetching') pawL.slowUntil = now + SLOW_MS;
      if (m === 'mouse') { moveAccum = 0; nextDrink = now + rand(4000, 9000); }
      else drinking = false;
    }

    function hitKey(keyEl, now) {
      if (!keyEl) return;
      keyEl.classList.add('hit');
      keyEl.__bcUntil = now + 110;
      if (hitKeys.indexOf(keyEl) < 0) hitKeys.push(keyEl);
    }

    // --- Events --------------------------------------------------------------
    function onKeyDown(e) {
      var now = performance.now();
      lastKey = now;
      moveAccum = 0;
      setMode('keyboard', now);

      var k = lookupKey(e), side, x, y, keyEl;
      if (k === 'space') {
        spaceToggle = !spaceToggle;
        side = spaceToggle ? 'L' : 'R';
        x = SPACE.x + SPACE.w / 2 + (side === 'L' ? -22 : 22);
        y = SPACE.y + SPACE.h / 2;
        keyEl = el.keys.space;
      } else {
        var c = keyCenter(k[0], k[1]);
        x = c.x; y = c.y;
        // Linke Tastaturhälfte der Katze liegt für uns rechts -> Pfote auf unserer rechten Seite
        side = k[1] < 5 ? 'R' : 'L';
        keyEl = el.keys[k[0] + '-' + k[1]];
      }
      // Linke Pfote hat noch die Tasse -> rechte Pfote springt ein.
      if (side === 'L' && leftState !== 'free') side = 'R';
      var paw = side === 'L' ? pawL : pawR;
      paw.press.x = x; paw.press.y = y; paw.press.until = now + PRESS_MS;
      paw.restX = x;
      lookX = x;
      mouthUntil = now + 120;
      head.v += side === 'L' ? -28 : 28; // kleiner Wackler pro Anschlag
      hitKey(keyEl, now);
      wake();
    }

    function onPointerMove(e) {
      var now = performance.now();
      var w = global.innerWidth || 1, h = global.innerHeight || 1;
      pointer.nx = clamp(e.clientX / w, 0, 1);
      pointer.ny = clamp(e.clientY / h, 0, 1);
      if (pointer.px !== null && mode === 'keyboard' && now - lastKey > MOVE_GRACE) {
        moveAccum += dist(e.clientX, e.clientY, pointer.px, pointer.py);
        if (moveAccum > MOVE_SWITCH_PX) setMode('mouse', now);
      }
      pointer.px = e.clientX; pointer.py = e.clientY;
      wake();
    }

    function onPointerDown() {
      var now = performance.now();
      pointer.down = true;
      pointer.downUntil = now + 140;
      if (now - lastKey > MOVE_GRACE) setMode('mouse', now);
      wake();
    }
    function onPointerUp() { pointer.down = false; }
    function onWheel() {
      var now = performance.now();
      if (now - lastKey > MOVE_GRACE) setMode('mouse', now);
      wake();
    }
    function onMotionChange() { reduced = !!(mq && mq.matches); if (reduced) drinking = false; }

    var listenOpts = { passive: true, capture: true };
    global.addEventListener('keydown', onKeyDown, listenOpts);
    global.addEventListener('pointermove', onPointerMove, listenOpts);
    global.addEventListener('pointerdown', onPointerDown, listenOpts);
    global.addEventListener('pointerup', onPointerUp, listenOpts);
    global.addEventListener('pointercancel', onPointerUp, listenOpts);
    global.addEventListener('wheel', onWheel, listenOpts);
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onMotionChange);
      else if (mq.addListener) mq.addListener(onMotionChange);
    }

    // --- Logik pro Frame -----------------------------------------------------
    function update(now, dt) {
      if (mode === 'keyboard' && now - lastKey > KEY_IDLE) setMode('mouse', now);

      // Maus auf dem Mauspad folgt dem Cursor
      mouse.to(MOUSE_MIN.x + pointer.nx * MOUSE_RANGE.x, MOUSE_MIN.y + pointer.ny * MOUSE_RANGE.y);
      mouse.step(dt);

      // Trinken planen / ablaufen lassen
      if (mode === 'mouse' && leftState === 'holding' && !drinking && !reduced && now >= nextDrink) {
        drinking = true; drinkStart = now;
      }
      var drinkT = drinking ? now - drinkStart : 0;
      if (drinking && drinkT > 1900) { drinking = false; nextDrink = now + rand(6000, 14000); }
      var sipping = drinking && drinkT > 350 && drinkT < 1750;

      // Linke Pfote + Tasse
      if (leftState === 'holding' && mode === 'keyboard') leftState = 'placing';
      else if (leftState === 'placing' && mode === 'mouse') leftState = 'holding';
      else if (leftState === 'free' && mode === 'mouse') leftState = 'fetching';
      else if (leftState === 'fetching' && mode === 'keyboard') leftState = 'free';

      if (leftState === 'holding') {
        // Bogenförmige Wege (Achsen unterschiedlich schnell), damit die Tasse nicht über die Schulter
        // wandert: beim Heben erst hoch, dann zum Mund – beim Absenken erst vom Gesicht weg, dann runter.
        if (drinking) {
          cup.to(CUP_DRINK.x, CUP_DRINK.y);
          cup.x.w = 4.5; cup.y.w = 9;
          cupA.t = CUP_DRINK.a + (drinkT > 700 ? 6 * Math.sin((drinkT - 700) / 140) : 0);
          cupA.w = 6;
        } else {
          cup.to(CUP_HELD.x, CUP_HELD.y);
          cup.x.w = 8; cup.y.w = 4.5;
          cupA.t = CUP_HELD.a; cupA.w = 7;
        }
      } else {
        cup.to(CUP_TABLE.x, CUP_TABLE.y, 8);
        cupA.t = CUP_TABLE.a; cupA.w = 8;
      }
      // Beim Trinken dreht sich die Tasse, damit der Henkel vom Mund weg zeigt
      cupSpin.t = leftState === 'holding' && drinking ? Math.PI : 0;
      cup.step(dt); cupA.step(dt); cupSpin.step(dt);

      if (leftState === 'placing' &&
          dist(cup.x.x, cup.y.x, CUP_TABLE.x, CUP_TABLE.y) < 1.5 && Math.abs(cupA.x - CUP_TABLE.a) < 1.5) {
        leftState = 'free';
        pawL.x.v = pawL.y.v = 0;
        pawL.slowUntil = now + SLOW_MS;
      }

      if (leftState === 'holding' || leftState === 'placing') {
        // Pfote hält die Tasse fest
        var g = gripOf(cup.x.x, cup.y.x, cupA.x, cupSpin.x);
        pawL.snap(g.x, g.y);
      } else if (leftState === 'fetching') {
        var gt = gripOf(CUP_TABLE.x, CUP_TABLE.y, CUP_TABLE.a);
        pawL.to(gt.x, gt.y, 11);
        pawL.step(dt);
        if (dist(pawL.x.x, pawL.y.x, gt.x, gt.y) < 1.5) {
          leftState = 'holding';
          cup.x.v = cup.y.v = 0;
          nextDrink = Math.max(nextDrink, now + 3000);
        }
      } else {
        typingTarget(pawL, now, 105, 200);
        pawL.step(dt);
      }

      // Rechte Pfote
      if (mode === 'mouse') {
        var pressed = pointer.down || now < pointer.downUntil;
        pawR.to(mouse.x.x + 1, mouse.y.x - 8 + (pressed ? 2.5 : 0), now < pawR.slowUntil ? 11 : 40);
      } else {
        typingTarget(pawR, now, 150, 268);
      }
      pawR.step(dt);

      // Kopf, Augen, Mund
      head.t = drinking ? -5 : mode === 'mouse' ? (pointer.nx - 0.5) * 5 : 0;
      head.step(dt);

      if (mode === 'mouse') eyes.to((pointer.nx - 0.5) * 7, (pointer.ny - 0.5) * 5);
      else eyes.to(clamp((lookX - 185) / 14, -3.5, 3.5), 3);
      eyes.step(dt);

      if (now >= nextBlink && !drinking) { blinkUntil = now + 120; nextBlink = now + rand(2500, 6000); }
      eyeOpen.t = sipping || now < blinkUntil ? 0 : 1;
      eyeOpen.step(dt);
      happy.t = sipping ? 1 : 0;
      happy.step(dt);

      mouthS.t = now < mouthUntil ? 1 : 0;
      mouthS.step(dt);

      steam.t = !drinking && Math.abs(cupA.x) < 6 ? 1 : 0;
      steam.step(dt);

      for (var i = hitKeys.length - 1; i >= 0; i--) {
        if (now >= hitKeys[i].__bcUntil) { hitKeys[i].classList.remove('hit'); hitKeys.splice(i, 1); }
      }
      el.mouseBtn.classList.toggle('hit', mode === 'mouse' && (pointer.down || now < pointer.downUntil));
    }

    function typingTarget(paw, now, minX, maxX) {
      var w = now < paw.slowUntil ? 11 : 45;
      if (now < paw.press.until) paw.to(paw.press.x, paw.press.y + 1, w);
      else paw.to(clamp(paw.restX, minX, maxX), PAW_REST_Y, w);
    }

    // --- Zeichnen ------------------------------------------------------------
    function drawArm(parts, S, px, py, side) {
      var dx = px - S.x, dy = py - S.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      if (nx * side < 0) { nx = -nx; ny = -ny; }
      var bend = Math.min(16, len * 0.12);
      var cx = (S.x + px) / 2 + nx * bend, cy = (S.y + py) / 2 + ny * bend;
      var d = 'M' + S.x + ' ' + S.y + 'Q' + f(cx) + ' ' + f(cy) + ' ' + f(px) + ' ' + f(py);
      setAttr(parts.line, 'd', d);
      setAttr(parts.fill, 'd', d);
      setAttr(parts.paw, 'cx', f(px));
      setAttr(parts.paw, 'cy', f(py));
      // Zehen am vorderen Ende der Pfote
      var tx = px - cx, ty = py - cy, tl = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tl; ty /= tl;
      var bx = px + tx * 6, by = py + ty * 6, qx = -ty * 4.5, qy = tx * 4.5;
      setAttr(parts.toes, 'd',
        'M' + f(bx + qx) + ' ' + f(by + qy) + 'l' + f(tx * 4) + ' ' + f(ty * 4) +
        'M' + f(bx - qx) + ' ' + f(by - qy) + 'l' + f(tx * 4) + ' ' + f(ty * 4));
    }

    // Motiv auf der Tassenoberfläche bei Azimut az: sichtbar nur auf der Vorderseite
    function drawPrint(node, az) {
      var front = -Math.sin(az);
      setAttr(node, 'opacity', front > 0.05 ? '0.9' : '0');
      setAttr(node, 'transform', 'translate(' + f(10 * Math.cos(az)) + ' 0) scale(' + f(Math.max(0, front)) + ' 1)');
    }

    function render() {
      setAttr(el.head, 'transform', 'rotate(' + f(head.x) + ' 200 215)');

      var open = clamp(eyeOpen.x, 0, 1);
      var ry = f(Math.max(0.6, 7 * open));
      setAttr(el.eyeL, 'cx', f(172 + eyes.x.x)); setAttr(el.eyeL, 'cy', f(130 + eyes.y.x)); setAttr(el.eyeL, 'ry', ry);
      setAttr(el.eyeR, 'cx', f(228 + eyes.x.x)); setAttr(el.eyeR, 'cy', f(130 + eyes.y.x)); setAttr(el.eyeR, 'ry', ry);
      var hp = clamp(happy.x, 0, 1);
      setAttr(el.happy, 'opacity', f(hp));
      setAttr(el.eyeL, 'opacity', f(1 - hp)); setAttr(el.eyeR, 'opacity', f(1 - hp));

      var mo = clamp(mouthS.x, 0, 1.2);
      setAttr(el.mouthOpen, 'opacity', mo > 0.04 ? '1' : '0');
      setAttr(el.mouthOpen, 'transform', 'translate(200 148) scale(1 ' + f(mo) + ') translate(-200 -148)');

      var mx = f(mouse.x.x), my = f(mouse.y.x);
      setAttr(el.mouse, 'transform', 'translate(' + mx + ' ' + my + ')');
      setAttr(el.cable, 'd', 'M' + mx + ' ' + f(my + 17) + 'C' + mx + ' ' + f(my + 30) + ' 372 276 391 280');

      var cx = f(cup.x.x), cy = f(cup.y.x);
      setAttr(el.cup, 'transform', 'translate(' + cx + ' ' + cy + ') rotate(' + f(cupA.x) + ') scale(' + CUP_SCALE + ')');
      // Pseudo-3D: Henkel läuft hinter der Tasse herum, das Herz-Motiv (vorne/hinten) dreht mit
      var spin = cupSpin.x;
      setAttr(el.handle, 'transform', 'scale(' + f(Math.cos(spin)) + ' 1)');
      drawPrint(el.heart1, spin - Math.PI / 2);
      drawPrint(el.heart2, spin + Math.PI / 2);
      setAttr(el.steam, 'transform', 'translate(' + cx + ' ' + f(cup.y.x - 22) + ')');
      setAttr(el.steam, 'opacity', f(clamp(steam.x, 0, 1)));

      drawArm(el.armL, SHOULDER_L, pawL.x.x, pawL.y.x, -1);
      drawArm(el.armR, SHOULDER_R, pawR.x.x, pawR.y.x, 1);
    }

    // --- Loop ----------------------------------------------------------------
    var raf = 0, last = 0, visible = true, destroyed = false;
    function frame(now) {
      raf = global.requestAnimationFrame(frame);
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      update(now, dt);
      render();
    }
    function wake() {
      if (!raf && visible && !destroyed) { last = performance.now(); raf = global.requestAnimationFrame(frame); }
    }
    function sleep() { if (raf) { global.cancelAnimationFrame(raf); raf = 0; } }

    // Nur animieren, solange die Katze sichtbar ist (z. B. Container weggescrollt).
    var io = null;
    if (global.IntersectionObserver) {
      io = new global.IntersectionObserver(function (entries) {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) wake(); else sleep();
      });
      io.observe(host);
    }

    render();
    wake();

    var instance = {
      element: host,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        sleep();
        if (io) io.disconnect();
        global.removeEventListener('keydown', onKeyDown, listenOpts);
        global.removeEventListener('pointermove', onPointerMove, listenOpts);
        global.removeEventListener('pointerdown', onPointerDown, listenOpts);
        global.removeEventListener('pointerup', onPointerUp, listenOpts);
        global.removeEventListener('pointercancel', onPointerUp, listenOpts);
        global.removeEventListener('wheel', onWheel, listenOpts);
        if (mq) {
          if (mq.removeEventListener) mq.removeEventListener('change', onMotionChange);
          else if (mq.removeListener) mq.removeListener(onMotionChange);
        }
        if (host.parentNode) host.parentNode.removeChild(host);
        var idx = api.instances.indexOf(instance);
        if (idx >= 0) api.instances.splice(idx, 1);
      }
    };
    api.instances.push(instance);
    return instance;
  }

  // ---------------------------------------------------------------------------
  // Auto-Init über data-Attribute am <script>-Tag
  // ---------------------------------------------------------------------------
  function autoInit(bongo, script) {
    if (!script || !script.dataset || script.dataset.auto === 'false') return;
    var d = script.dataset;
    var opts = { target: d.target || null, position: d.position, size: d.size, offset: d.offset, zIndex: d.zIndex };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { bongo.create(opts); });
    } else {
      bongo.create(opts);
    }
  }

  var api = { version: '1.0.0', create: create, instances: [] };
  global.BongoCat = api;
  autoInit(api, currentScript);
})(window);
