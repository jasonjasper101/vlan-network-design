/* The arena: an SVG topology. Left is your network; right is the boss's corrupted side.
   Link color is the only color, and it always means link state. */
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

  let svg, links = {}, bossG, faceG, crackG, octets = [], lastStates = {};

  function nodeShape(g, n) {
    const s = el('g', { transform: `translate(${n.x},${n.y})`, class: 'node' }, g);
    if (n.t === 'pc') {
      el('rect', { x: -15, y: -12, width: 30, height: 20, rx: 2 }, s);
      el('path', { d: 'M-7 13 H7 M0 8 V13' }, s);
    } else if (n.t === 'sw') {
      el('rect', { x: -26, y: -13, width: 52, height: 26, rx: 3 }, s);
      el('path', { d: 'M-16 -4 H14 M10 -8 L14 -4 L10 0 M16 4 H-14 M-10 0 L-14 4 L-10 8', class: 'glyph' }, s);
    } else {
      el('circle', { r: 20 }, s);
      el('path', { d: 'M-11 0 H11 M0 -11 V11 M7 -4 L11 0 L7 4 M-7 -4 L-11 0 L-7 4 M-4 -7 L0 -11 L4 -7 M-4 7 L0 11 L4 7', class: 'glyph' }, s);
    }
    const ly = n.t === 'pc' ? 26 : n.t === 'sw' ? 28 : 34;
    el('text', { y: ly, class: 'nlabel', 'text-anchor': 'middle' }, s).textContent = n.l;
  }

  function bossFigure(g) {
    bossG = el('g', { transform: 'translate(810,236)', class: 'boss' }, g);
    const defs = el('defs', {}, svg);

    // Cloak fabric: the mask itself, written over and over.
    const pat = el('pattern', { id: 'bits', width: 150, height: 13, patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { width: 150, height: 13, class: 'cloak-bg' }, pat);
    el('text', { x: 0, y: 10, class: 'bits' }, pat).textContent = '11111111.11111111.111111';
    const pat2 = el('pattern', { id: 'bits2', width: 150, height: 13, patternUnits: 'userSpaceOnUse', x: 37, y: 6 }, defs);
    el('text', { x: 0, y: 10, class: 'bits dim' }, pat2).textContent = '11000000.11100000.11110000';

    const glitch = el('filter', { id: 'glitch', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    const turb = el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.02 0.4', numOctaves: 1, seed: 3, result: 'n' }, glitch);
    el('animate', { attributeName: 'seed', values: '1;5;9;2;7', dur: '1.2s', repeatCount: 'indefinite' }, turb);
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 6 }, glitch);

    const body = el('g', { class: 'boss-body' }, bossG);
    const cloak = 'M-30 -96 C-70 -60 -96 40 -128 168 L128 168 C96 40 70 -60 30 -96 Z';
    el('path', { d: cloak, fill: 'url(#bits)', class: 'cloak' }, body);
    el('path', { d: cloak, fill: 'url(#bits2)', class: 'cloak-overlay' }, body);
    el('path', { d: 'M0 -150 C-56 -150 -70 -92 -66 -40 C-50 -70 50 -70 66 -40 C70 -92 56 -150 0 -150 Z', class: 'hood' }, body);

    faceG = el('g', { class: 'face' }, body);
    el('ellipse', { cx: 0, cy: -84, rx: 33, ry: 44, class: 'face-plate' }, faceG);
    el('path', { d: 'M0 -126 V-42', class: 'seam' }, faceG);
    crackG = el('g', { class: 'cracks' }, faceG);
    el('path', { d: 'M-4 -120 L-12 -100 L-6 -90 L-18 -70', class: 'crack c2' }, crackG);
    el('path', { d: 'M8 -112 L16 -96 L10 -80', class: 'crack c2' }, crackG);
    el('path', { d: 'M0 -126 L-3 -110 L4 -96 L-2 -80 L5 -62 L0 -42', class: 'crack c3 split' }, crackG);
    el('text', { x: 0, y: -78, class: 'void', 'text-anchor': 'middle' }, crackG).textContent = '/0';

    // Four floating octets of the mask it wears: 255.255.255.192
    // Animate the wrapper only: a CSS transform would override each octet's SVG translate.
    const octG = el('g', { class: 'octets' }, bossG);
    const ov = ['255', '255', '255', '192'];
    ov.forEach((v, i) => {
      const og = el('g', { class: 'octet', transform: `translate(${-108 + i * 72},${200})` }, octG);
      el('rect', { x: -30, y: -13, width: 60, height: 26, rx: 2 }, og);
      el('text', { y: 5, 'text-anchor': 'middle' }, og).textContent = v;
      octets.push(og);
    });
  }

  function mount(target) {
    svg = target;
    svg.setAttribute('viewBox', '0 0 1000 470');
    svg.innerHTML = '';
    const bg = el('g', { class: 'bg' }, svg);
    el('rect', { x: 400, y: 0, width: 600, height: 470, class: 'corrupt-zone' }, bg);
    el('line', { x1: 400, y1: 10, x2: 400, y2: 460, class: 'front' }, bg);
    el('text', { x: 16, y: 462, class: 'zone-label' }, bg).textContent = 'YOUR NETWORK';
    el('text', { x: 984, y: 462, class: 'zone-label', 'text-anchor': 'end' }, bg).textContent = 'CONTESTED';

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
    bossFigure(svg);
    lastStates = {};
  }

  function setLink(key, state) {
    const p = links[key];
    if (!p) return;
    const prev = lastStates[key];
    if (prev === state) return;
    lastStates[key] = state;
    p.setAttribute('class', `link ${state}`);
    if (prev) {
      // Flicker on change, then settle. Restart the animation if it was mid-flight.
      p.classList.remove('flicker'); void p.getBBox(); p.classList.add('flicker');
    }
  }

  /** Recompute every link from game state. */
  function update({ hpFrac, nines, phase, startNines = 5, floorNines = 1 }) {
    // Boss side: down links proportional to boss HP; the boundary link is degraded.
    const t = THEIRS.length * hpFrac;
    const healed = THEIRS.length - Math.ceil(t - 1e-9);
    THEIRS.forEach(([a, b], i) => {
      const key = a + '-' + b;
      let s = 'down';
      if (i < healed) s = 'up';
      else if (i === healed && t % 1 > 0 && t % 1 < 0.5) s = 'deg';
      setLink(key, hpFrac <= 0 ? 'up' : s);
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
    if (bossG) {
      bossG.setAttribute('data-phase', phase);
      bossG.classList.toggle('defeated', hpFrac <= 0);
      // The last octet loosens as phases go: 192 -> 128 -> 0 (the boundary dissolves).
      const last = octets[3] && octets[3].querySelector('text');
      if (last) last.textContent = hpFrac <= 0 ? '000' : phase === 1 ? '192' : phase === 2 ? '128' : '0';
    }
  }

  function pulse(cls, ms) {
    if (!bossG) return;
    bossG.classList.remove(cls); void bossG.getBBox(); bossG.classList.add(cls);
    setTimeout(() => bossG.classList.remove(cls), ms);
  }

  root.LHArena = {
    mount, update,
    hit: crit => pulse(crit ? 'crit' : 'hit', crit ? 700 : 400),
    taunt: () => pulse('taunt', 900)
  };
})(window);
