/* The arena: an SVG topology. Left is your network; right is the boss's corrupted side.
   Link color is the only color in here, and it always means link state. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  const NODES = {
    pc1: { x: 58, y: 48, t: 'pc', l: 'SALES-1' },  pc2: { x: 58, y: 120, t: 'pc', l: 'SALES-2' },
    pc3: { x: 58, y: 196, t: 'pc', l: 'MKT-1' },   pc4: { x: 58, y: 268, t: 'pc', l: 'MKT-2' },
    pc5: { x: 58, y: 344, t: 'pc', l: 'HR-1' },    pc6: { x: 58, y: 416, t: 'pc', l: 'HR-2' },
    sw1: { x: 190, y: 84, t: 'sw', l: 'SW-SALES' }, sw2: { x: 190, y: 232, t: 'sw', l: 'SW-MKT' },
    sw3: { x: 190, y: 380, t: 'sw', l: 'SW-HR' },
    r1: { x: 330, y: 232, t: 'rt', l: 'R1' },
    ea: { x: 468, y: 120, t: 'rt', l: 'EDGE-A' }, eb: { x: 468, y: 344, t: 'rt', l: 'EDGE-B' },
    cx: { x: 590, y: 232, t: 'rt', l: 'ISP-CORE' }
  };
  // Your side, in the order the boss corrupts them (uplinks first: they hurt most).
  const MINE = [['sw2', 'r1'], ['pc5', 'sw3'], ['sw1', 'r1'], ['pc2', 'sw1'], ['sw3', 'r1'],
                ['pc4', 'sw2'], ['pc1', 'sw1'], ['pc6', 'sw3'], ['pc3', 'sw2']];
  // The boss's side, in the order you take it back (nearest to you first).
  const THEIRS = [['r1', 'ea'], ['r1', 'eb'], ['ea', 'eb'], ['ea', 'cx'], ['eb', 'cx'], ['cx', 'boss']];

  // The last octet of the mask it wears loosens each phase: /26, /25, /24.
  const LAST_OCTET = { 1: '192', 2: '128', 3: '0' };

  /* The Mask: a face plate whose visor is the subnet mask it wears. Flat shapes, no texture. */
  function maskFigure(octet) {
    const oct = ['255', '255', '255', octet || '192'];
    const visor = oct.map((v, i) => {
      const x = -74 + i * 38;
      return `<rect x="${x}" y="-94" width="34" height="26"/><text x="${x + 17}" y="-76" text-anchor="middle"${i === 3 ? ' class="last"' : ''}>${v}</text>`;
    }).join('');
    return `
      <path class="torso" d="M-118 170 L-104 72 C-90 46 -52 36 0 36 C52 36 90 46 104 72 L118 170 Z"/>
      <rect class="band" x="-106" y="98" width="212" height="28"/>
      <text class="band-text" x="0" y="117" text-anchor="middle">${oct.join('.')}</text>
      <rect class="neck" x="-20" y="16" width="40" height="26"/>
      <path class="plate" d="M0 -152 C58 -152 80 -116 80 -66 C80 -14 52 26 0 36 C-52 26 -80 -14 -80 -66 C-80 -116 -58 -152 0 -152 Z"/>
      <path class="seam" d="M0 -152 V-94 M0 -68 V36"/>
      <g class="visor">${visor}</g>
      <g class="cracks">
        <path class="crack c2" d="M-30 -60 L-38 -40 L-30 -28 L-44 -6"/>
        <path class="crack c2" d="M34 -62 L42 -44 L36 -26"/>
        <path class="crack c3 split" d="M0 -68 L-4 -50 L4 -34 L-3 -16 L4 4 L0 36"/>
        <text class="void" x="-30" y="12" text-anchor="middle">/0</text>
      </g>`;
  }

  /** Static portrait for menus and cards. */
  function portrait() {
    return `<svg viewBox="-140 -160 280 336" class="portrait" aria-hidden="true">${maskFigure('192')}</svg>`;
  }

  let svg, links = {}, bossG, glitchAnim = null, glitchOn = false, lastStates = {}, ro = null;

  function nodeShape(g, n) {
    const s = el('g', { transform: `translate(${n.x},${n.y})`, class: 'node' }, g);
    if (n.t === 'pc') {
      el('rect', { x: -15, y: -12, width: 30, height: 20 }, s);
      el('path', { d: 'M-7 13 H7 M0 8 V13' }, s);
    } else if (n.t === 'sw') {
      // Workgroup switch: crossing arrow pairs.
      el('rect', { x: -26, y: -13, width: 52, height: 26 }, s);
      el('path', { d: 'M-16 -5 H14 M10 -9 L14 -5 L10 -1 M16 5 H-14 M-10 1 L-14 5 L-10 9', class: 'glyph' }, s);
    } else {
      // Router: four diagonal arrows, two pointing in and two pointing out.
      el('circle', { r: 20 }, s);
      el('path', { d: 'M-13 -13 L-4 -4 M-4 -9 L-4 -4 L-9 -4 M13 13 L4 4 M4 9 L4 4 L9 4 M4 -4 L13 -13 M8 -13 L13 -13 L13 -8 M-4 4 L-13 13 M-8 13 L-13 13 L-13 8', class: 'glyph' }, s);
    }
    const ly = n.t === 'pc' ? 26 : n.t === 'sw' ? 28 : 34;
    el('text', { y: ly, class: `nlabel ${n.t}`, 'text-anchor': 'middle' }, s).textContent = n.l;
  }

  function bossFigure() {
    const defs = el('defs', {}, svg);
    const glitch = el('filter', { id: 'glitch', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    const turb = el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.02 0.4', numOctaves: 1, seed: 3, result: 'n' }, glitch);
    glitchAnim = el('animate', { attributeName: 'seed', values: '1;5;9;2;7', dur: '1.2s', repeatCount: 'indefinite', begin: 'indefinite' }, turb);
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 6 }, glitch);
    glitchOn = false;

    bossG = el('g', { transform: 'translate(810,236)', class: 'boss' }, svg);
    const body = el('g', { class: 'boss-body' }, bossG);
    body.innerHTML = maskFigure(LAST_OCTET[1]);
  }

  /** Keep labels near 11px on screen however small the arena gets. */
  function scaleLabels() {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const k = Math.max(1000 / r.width, 470 / r.height);
    svg.style.setProperty('--k', k.toFixed(3));
    svg.classList.toggle('compact', k > 1.9);
  }

  function mount(target) {
    svg = target;
    svg.setAttribute('viewBox', '0 0 1000 470');
    svg.innerHTML = '';
    const bg = el('g', { class: 'bg' }, svg);
    el('rect', { x: 400, y: 0, width: 600, height: 470, class: 'corrupt-zone' }, bg);
    el('line', { x1: 400, y1: 10, x2: 400, y2: 460, class: 'front' }, bg);
    el('text', { x: 16, y: 460, class: 'zone-label' }, bg).textContent = 'YOUR NETWORK';
    el('text', { x: 984, y: 460, class: 'zone-label', 'text-anchor': 'end' }, bg).textContent = 'CONTESTED';

    const lg = el('g', { class: 'links' }, svg);
    const ng = el('g', { class: 'nodes' }, svg);
    const pos = id => id === 'boss' ? { x: 760, y: 200 } : NODES[id];
    links = {};
    [...MINE, ...THEIRS].forEach(([a, b]) => {
      const A = pos(a), B = pos(b), key = a + '-' + b;
      const d = b === 'boss'
        ? `M${A.x} ${A.y} C${A.x + 60} ${A.y - 40} ${B.x - 70} ${B.y + 60} ${B.x} ${B.y}`
        : `M${A.x} ${A.y} L${B.x} ${B.y}`;
      links[key] = el('path', { d, class: 'link up' }, lg);
    });
    Object.values(NODES).forEach(n => nodeShape(ng, n));
    bossFigure();
    lastStates = {};
    if (ro) ro.disconnect();
    if (root.ResizeObserver) { ro = new ResizeObserver(scaleLabels); ro.observe(svg); }
    scaleLabels();
  }

  function setLink(key, state) {
    const p = links[key];
    if (!p) return;
    const prev = lastStates[key];
    if (prev === state) return;
    lastStates[key] = state;
    p.setAttribute('class', `link ${state}`);
    if (prev) {
      // Stepped flicker on change. Restart it if it was mid-flight.
      p.classList.remove('flicker'); void p.getBBox(); p.classList.add('flicker');
    }
  }

  /** Recompute every link from game state. */
  function update({ hpFrac, nines, phase, startNines = 5, floorNines = 1 }) {
    // Boss side: down links proportional to boss HP; the boundary link is degraded.
    const t = THEIRS.length * hpFrac;
    const healed = THEIRS.length - Math.ceil(t - 1e-9);
    THEIRS.forEach(([a, b], i) => {
      let s = 'down';
      if (i < healed) s = 'up';
      else if (i === healed && t % 1 > 0 && t % 1 < 0.5) s = 'deg';
      setLink(a + '-' + b, hpFrac <= 0 ? 'up' : s);
    });
    // Your side: corruption proportional to uptime lost.
    const lost = Math.max(0, Math.min(1, (startNines - nines) / (startNines - floorNines)));
    const bad = lost * MINE.length;
    MINE.forEach(([a, b], i) => {
      let s = 'up';
      if (i < Math.floor(bad)) s = 'down';
      else if (i < Math.ceil(bad)) s = 'deg';
      setLink(a + '-' + b, s);
    });
    if (!bossG) return;
    bossG.setAttribute('data-phase', phase);
    bossG.classList.toggle('defeated', hpFrac <= 0);
    const octet = hpFrac <= 0 ? '0' : LAST_OCTET[phase];
    const last = bossG.querySelector('.visor .last');
    if (last && last.textContent !== octet) {
      last.textContent = octet;
      bossG.querySelector('.band-text').textContent = `255.255.255.${octet}`;
    }
    if (phase === 3 && hpFrac > 0 && !glitchOn && glitchAnim && glitchAnim.beginElement) {
      glitchOn = true;
      try { glitchAnim.beginElement(); } catch (e) { /* SMIL unavailable: the filter still applies */ }
    }
  }

  function pulse(cls, ms) {
    if (!bossG) return;
    bossG.classList.remove(cls); void bossG.getBBox(); bossG.classList.add(cls);
    setTimeout(() => bossG.classList.remove(cls), ms);
  }

  root.LHArena = {
    portrait, mount, update,
    hit: crit => pulse(crit ? 'crit' : 'hit', crit ? 700 : 400),
    taunt: () => pulse('taunt', 900)
  };
})(window);
