#!/usr/bin/env node
/* Inlines CSS, JS and the question bank into one self-contained HTML file.
   Usage: node tools/bundle.js [out.html] [--fragment]
   --fragment omits <!doctype>/<html>/<head>/<body> for hosts that supply their own. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find(a => !a.startsWith('--')) || path.join(root, 'dist', 'last-hop.html');

const blueprint = JSON.parse(read('data/blueprint.json'));
const bosses = JSON.parse(read('data/bosses.json')).bosses;
const banks = {};
for (const b of bosses.filter(b => b.available)) banks[b.id] = JSON.parse(read(b.questions)).questions;
const data = JSON.stringify({ blueprint, bosses, banks }).replace(/<\//g, '<\\/');

const html = read('index.html');
const body = html.split('<!--BODY-->')[1].split('<!--/BODY-->')[0].trim();
// Fonts are self-hosted; inline them so the file needs no network at all.
const css = read('css/style.css').replace(/url\(\.\.\/fonts\/([^)]+\.woff2)\)/g, (m, f) =>
  `url(data:font/woff2;base64,${fs.readFileSync(path.join(root, 'fonts', f)).toString('base64')})`);
const scripts = ['js/engine.js', 'js/audio.js', 'js/arena.js', 'js/app.js']
  .map(f => `<script>\n${read(f).replace(/<\/script/g, '<\\/script')}\n</script>`).join('\n');

const head = `<title>LAST HOP</title>
<style>
${css}
</style>`;
const tail = `<script>window.LH_DATA = ${data};</script>\n${scripts}`;

const page = fragment
  ? `${head}\n<script>document.body.dataset.screen = 'menu';</script>\n${body}\n${tail}\n`
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body data-screen="menu">
${body}
${tail}
</body>
</html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
