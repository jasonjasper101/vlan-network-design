#!/usr/bin/env node
/* Validates every question file: schema, answer parsing, and an independent
   recomputation of the math answers. Run: node tools/validate.js */
'use strict';
const fs = require('fs');
const path = require('path');
const LH = require('../js/engine.js');

const root = path.join(__dirname, '..');
const blueprint = JSON.parse(fs.readFileSync(path.join(root, 'data/blueprint.json'), 'utf8'));
const bosses = JSON.parse(fs.readFileSync(path.join(root, 'data/bosses.json'), 'utf8')).bosses;
const objectives = new Set(blueprint.domains.flatMap(d => d.objectives.map(o => o.id)));

let errors = 0;
const fail = (id, msg) => { errors++; console.error(`  ✗ ${id}: ${msg}`); };

/* --- independent math, deliberately not reusing engine code --- */
const ip = s => s.split('.').reduce((a, o) => a * 256 + +o, 0);
const str = n => [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
const net = (a, p) => Math.floor(ip(a) / 2 ** (32 - p)) * 2 ** (32 - p);
const bcast = (a, p) => net(a, p) + 2 ** (32 - p) - 1;
function eui64(mac) {
  const h = mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const b0 = (parseInt(h.slice(0, 2), 16) ^ 0x02).toString(16).padStart(2, '0');
  const id = b0 + h.slice(2, 6) + 'fffe' + h.slice(6);
  return id.match(/.{4}/g).join(':');
}
const recompute = {
  'nf-001': () => String(2 ** 5 - 2),
  'nf-002': () => str(net('192.168.10.77', 26)),
  'nf-003': () => str(2 ** 32 - 2 ** 4),
  'nf-016': () => str(bcast('172.16.45.200', 21)),
  'nf-017': () => str(bcast('10.10.10.192', 27) - 1),
  'nf-018': () => { let p = 32; while (2 ** (32 - p) - 2 < 52) p--; return String(p); },
  'nf-019': () => str(ip('10.10.10.0') + 128 + 64),
  'nf-027': () => eui64('00E0.F71A.2B01'),
  'nf-029': () => String(2 ** (24 - 12)),
  'nf-038': () => String(2 ** 9 - 2),
  'nf-040': () => str(ip('192.168.50.0') + 4 * 16 + 1),
  'nf-041': () => str(net('10.47.139.201', 19)),
  'nf-042': () => str(bcast('172.20.99.14', 20) - 1),
  'nf-047': () => '2001:db8:cafe:1:' + eui64('0C1F.5A33.90D2'),
  'nf-048': () => String((64 / 4) * 2)
};

for (const boss of bosses.filter(b => b.available)) {
  const file = path.join(root, boss.questions);
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`${boss.name}: ${bank.questions.length} questions (${boss.questions})`);
  const ids = new Set();
  for (const q of bank.questions) {
    const id = q.id || '(no id)';
    if (ids.has(id)) fail(id, 'duplicate id'); ids.add(id);
    if (!objectives.has(q.obj)) fail(id, `unknown objective ${q.obj}`);
    if (!q.obj.startsWith(boss.domain.split('.')[0] + '.')) fail(id, `objective ${q.obj} outside domain ${boss.domain}`);
    if (!LH.TYPES[q.type]) fail(id, `unknown type ${q.type}`);
    if (![1, 2, 3].includes(q.diff)) fail(id, 'diff must be 1-3');
    for (const k of ['title', 'prompt', 'explain', 'hint']) if (!q[k]) fail(id, `missing ${k}`);

    if (q.type === 'recall' || q.type === 'scenario') {
      if (!Array.isArray(q.choices) || q.choices.length < 3) fail(id, 'needs 3+ choices');
      else {
        if (!(q.answer >= 0 && q.answer < q.choices.length)) fail(id, 'answer index out of range');
        q.choices.forEach((c, i) => { if (i !== q.answer && !c.why) fail(id, `choice ${i} has no explanation`); });
      }
    }
    if (q.type === 'output') {
      const lines = q.terminal && q.terminal.lines;
      if (!lines || !q.terminal.cmd) fail(id, 'output needs terminal.cmd and terminal.lines');
      else {
        if (!Array.isArray(q.answer) || !q.answer.every(i => lines[i] && lines[i].trim())) fail(id, 'answer must index non-empty lines');
        for (const k of Object.keys(q.lineWhy || {})) if (!lines[k]) fail(id, `lineWhy ${k} points at no line`);
      }
    }
    if (q.type === 'calc') {
      if (!LH.INPUT_HELP[q.kind]) fail(id, `unknown kind ${q.kind}`);
      if (LH.checkTyped(q, q.answer) !== true) fail(id, 'answer does not validate against itself');
      if (recompute[id]) {
        const exp = recompute[id]();
        if (LH.checkTyped(q, exp) !== true) fail(id, `recomputed ${exp}, bank says ${q.answer}`);
      } else console.warn(`  ! ${id}: no independent recompute`);
    }
    if (q.type === 'order' && (!Array.isArray(q.items) || q.items.length < 3)) fail(id, 'order needs 3+ items');
  }
  const counts = {};
  for (const q of bank.questions) counts[q.diff] = (counts[q.diff] || 0) + 1;
  console.log('  by difficulty:', counts);
  const weak = boss.weakPoints.filter(w => !bank.questions.some(q => q.obj === w));
  if (weak.length) fail(boss.id, `weak points with no questions: ${weak}`);
}

/* --- normalizer spot checks --- */
const t = (q, s, want) => { if (LH.checkTyped(q, s) !== want) fail('normalizer', `${q.kind} "${s}" expected ${want}`); };
t({ kind: 'ipv4', answer: '10.0.0.1' }, '010.0.0.001', true);
t({ kind: 'ipv4', answer: '10.0.0.1' }, '10.0.0.2', false);
t({ kind: 'mask', answer: '26' }, '255.255.255.192', true);
t({ kind: 'mask', answer: '26' }, '/26', true);
t({ kind: 'mask', answer: '26' }, '255.255.255.224', false);
t({ kind: 'mask', answer: '26' }, '255.0.255.0', null);
t({ kind: 'ipv6', answer: '2001:DB8::1' }, '2001:0db8:0:0:0:0:0:0001', true);
t({ kind: 'ipv6', answer: '2001:DB8::1' }, '2001:db8::1::1', null);
t({ kind: 'hex', answer: '02E0:F7FF:FE1A:2B01' }, '2e0:f7ff:fe1a:2b01', true);
t({ kind: 'number', answer: '4096' }, '4,096', true);

/* --- a simulated run reaches a result --- */
const bank = JSON.parse(fs.readFileSync(path.join(root, bosses[0].questions), 'utf8')).questions;
for (const acc of [1, 0.75, 0]) {
  const run = new LH.Run({ boss: bosses[0], questions: bank, seed: 42 });
  let guard = 0;
  while (!run.over && guard++ < 500) {
    const cards = run.draw();
    run.answer(cards[0].q, run.rand() < acc, { aftershock: cards[0].aftershock });
  }
  const s = run.summary();
  console.log(`  sim accuracy ${acc}: ${s.won ? 'won' : 'lost'} in ${s.answered} questions, uptime ${s.uptime}`);
  if (guard >= 500) fail('sim', 'run never ended');
}

if (errors) { console.error(`\n${errors} problem(s)`); process.exit(1); }
console.log('\nAll checks passed.');
