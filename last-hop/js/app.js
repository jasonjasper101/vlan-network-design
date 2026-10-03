/* LAST HOP: screens and battle UI. Game rules live in engine.js. */
(function () {
  'use strict';
  const { Run, TYPES, fmtUptime, checkTyped, recordResult, masteryState, INPUT_HELP, START_NINES, FLOOR_NINES, shuffle, rng } = LH;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const screen = $('#screen');
  const sfx = LHAudio.sfx;

  /* ---------- persistence (per-browser convenience only) ---------- */
  const KEY = 'lasthop.v1';
  const blank = () => ({ mastery: {}, srs: {}, revealed: {}, best: {}, sound: false });
  function load() { try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { return blank(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* storage unavailable */ } }
  let progress = load();

  /* ---------- data ---------- */
  let DATA = null;
  async function loadData() {
    if (window.LH_DATA) return window.LH_DATA;
    const get = p => fetch(p).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
    const [blueprint, bosses] = await Promise.all([get('data/blueprint.json'), get('data/bosses.json')]);
    const banks = {};
    for (const b of bosses.bosses.filter(b => b.available)) banks[b.id] = (await get(b.questions)).questions;
    return { blueprint, bosses: bosses.bosses, banks };
  }
  const objName = id => {
    for (const d of DATA.blueprint.domains) for (const o of d.objectives) if (o.id === id) return o.name;
    return id;
  };
  const allObjectives = () => DATA.blueprint.domains.flatMap(d => d.objectives);

  /* ---------- shared bits ---------- */
  const TYPE_CODE = { recall: 'REC', scenario: 'SCN', order: 'ORD', calc: 'CAL', output: 'OUT' };
  const TIER_CLASS = { Light: 'bronze', Medium: 'silver', Heavy: 'gold' };
  const BOSS_CODE = { mask: 'MSK', loop: 'LOP', blackhole: 'BHL', rogue: 'RGE', intruder: 'INT', script: 'SCR', outage: 'OUT' };
  const pips = d => '<span class="pips" aria-label="Difficulty ' + d + ' of 3">' + [1, 2, 3].map(i => `<i class="${i <= d ? 'on' : ''}"></i>`).join('') + '</span>';
  const rating = m => (m && m.a ? Math.round((m.recent.reduce((s, x) => s + x, 0) / m.recent.length) * 99) : null);

  function setPrompts(list) {
    $('#prompts').innerHTML = list.map(([k, label]) => `<span class="prompt-hint"><kbd class="${k.length > 2 ? 'wide' : ''}">${esc(k)}</kbd>${esc(label)}</span>`).join('');
  }
  function setTab(name) {
    $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === name ? 'page' : 'false'));
  }
  function show(name, html, prompts) {
    stopTimer();
    document.body.dataset.screen = name;
    screen.innerHTML = html;
    setPrompts(prompts);
    window.scrollTo(0, 0);
  }

  /* ---------- top bar ---------- */
  function syncSound() {
    const b = $('#sound');
    b.setAttribute('aria-pressed', LHAudio.enabled);
    b.textContent = LHAudio.enabled ? 'Sound on' : 'Sound off';
  }
  $('#sound').addEventListener('click', () => { progress.sound = LHAudio.setEnabled(!LHAudio.enabled); save(); syncSound(); });
  $('#home').addEventListener('click', e => { e.preventDefault(); go('home'); });
  $$('.tab').forEach(t => t.addEventListener('click', () => { sfx.select(); go(t.dataset.tab); }));
  const TABS = ['home', 'match', 'mastery', 'guide'];
  function go(tab) {
    if (tab === 'home') home();
    else if (tab === 'match') setup('mask', setup.mode || 'run');
    else if (tab === 'mastery') mastery();
    else if (tab === 'guide') guide();
  }

  /* ---------- collectible cards ---------- */
  function bossCard(b) {
    const bank = DATA.banks[b.id];
    const best = progress.best[b.id];
    const art = b.id === 'mask' ? LHArena.portrait() : LHArena.glyph(b.id);
    const tier = !b.available ? 'locked' : best && best.won ? 'gold' : 'silver';
    return `<button class="ccard ${tier}" data-boss="${b.id}" ${b.available ? '' : 'aria-disabled="true"'} aria-label="${esc(b.name)}${b.available ? '' : ', locked'}">
      ${b.available ? '' : '<span class="cc-badge">Locked</span>'}${best && best.won ? '<span class="cc-badge">Beaten</span>' : ''}
      <span class="cc-top"><span class="cc-rating">${b.weight || '??'}</span><span class="cc-pos">${b.domain === 'all' ? 'ALL' : esc(b.domain)}</span></span>
      <span class="cc-art">${art}</span>
      <span class="cc-name">${esc(b.name.replace(/^The /, ''))}</span>
      <span class="cc-stats">
        <span><b>${b.weight ? b.weight * LH.HP_PER_WEIGHT : '–'}</b>HP</span>
        <span><b>${bank ? bank.length : '–'}</b>QS</span>
        <span><b>${b.weakPoints ? b.weakPoints.length : '–'}</b>WK</span>
      </span>
    </button>`;
  }

  /* ================================================================
     HOME
     ================================================================ */
  function home() {
    const b = DATA.bosses.find(x => x.id === 'mask');
    const bank = DATA.banks.mask;
    const best = progress.best.mask;
    const objs = allObjectives();
    const tested = objs.filter(o => progress.mastery[o.id] && progress.mastery[o.id].a).length;
    const states = objs.map(o => masteryState(progress.mastery[o.id]));
    show('home', `
      <section>
        <div class="hub">
          <button class="tile hero" id="t-play">
            <span class="hero-art">${LHArena.portrait()}</span>
            <span class="hero-copy">
              <span class="tag accent">Boss 1 of 6 · ${esc(b.domain)} Network Fundamentals</span>
              <span class="tile-title">${esc(b.name)}</span>
              <span class="tile-sub">${esc(b.theme)}. Subnetting, IPv4 and IPv6 addressing, cabling faults and switching, on a failing campus network.</span>
              <span class="hero-stats">
                <span><b class="num">${b.weight * LH.HP_PER_WEIGHT}</b><span class="tag">Health</span></span>
                <span><b class="num">${bank.length}</b><span class="tag">Questions</span></span>
                <span><b class="num">${best ? best.uptime.replace('%', '') : '–'}</b><span class="tag">Best uptime</span></span>
              </span>
              <span class="tile-cta"><kbd>↵</kbd>Kick off</span>
            </span>
          </button>
          <button class="tile" id="t-practice">
            <span class="tile-icon">${LHArena.glyph('cone')}</span>
            <span class="tag">Training</span>
            <span class="tile-title">Practice</span>
            <span class="tile-sub">Hints are free. No clock and no uptime loss.</span>
          </button>
          <button class="tile" id="t-mastery">
            <span class="tile-icon">${LHArena.glyph('bars')}</span>
            <span class="tag">Progress</span>
            <span class="tile-title">Mastery</span>
            <span class="tile-sub">${tested} of ${objs.length} blueprint objectives tested</span>
            <span class="mini-states" aria-hidden="true">${states.map(s => `<i class="${s}"></i>`).join('')}</span>
          </button>
          <button class="tile" id="t-guide">
            <span class="tile-icon">${LHArena.glyph('board')}</span>
            <span class="tag">Rules</span>
            <span class="tile-title">How to play</span>
            <span class="tile-sub">Damage, phases, weak points, items and aftershocks.</span>
          </button>
          <div class="tile locked" aria-disabled="true">
            <span class="tile-icon">${LHArena.glyph('clock')}</span>
            <span class="tag">Locked</span>
            <span class="tile-title">Exam mode</span>
            <span class="tile-sub">100 questions on a 120-minute clock. Unlocks when all six domain banks are written.</span>
          </div>
        </div>
        <div class="rail-head"><h2>Season bosses</h2><span class="tag">Health sized to exam weight</span></div>
        <div class="rail">${DATA.bosses.map(bossCard).join('')}</div>
      </section>`,
      [['↵', 'Select'], ['Q', 'Prev tab'], ['E', 'Next tab']]);
    setTab('home');
    $('#t-play').addEventListener('click', () => setup('mask', 'run'));
    $('#t-practice').addEventListener('click', () => setup('mask', 'practice'));
    $('#t-mastery').addEventListener('click', mastery);
    $('#t-guide').addEventListener('click', guide);
    $$('.rail .ccard:not(.locked)').forEach(c => c.addEventListener('click', () => setup(c.dataset.boss, 'run')));
    $('#t-play').focus({ preventScroll: true });
  }

  /* ================================================================
     MATCH SETUP
     ================================================================ */
  function setup(id, mode) {
    setup.mode = mode;
    const b = DATA.bosses.find(x => x.id === id);
    const bank = DATA.banks[id];
    const rev = progress.revealed[id] || [];
    const practice = mode === 'practice';
    const objCount = new Set(bank.map(q => q.obj)).size;
    show('setup', `
      <section>
        <div class="screen-head"><div><span class="tag accent">Match setup</span><h1>${practice ? 'Practice' : 'Boss run'}</h1></div></div>
        <div class="setup">
          <div>
            <div class="versus">
              <div class="side you">
                <span class="crest">NOC</span>
                <span class="tag">Home</span>
                <span class="side-name">On-call</span>
                <span class="side-meta"><span>Uptime ${fmtUptime(START_NINES)}</span><span>${practice ? 'Unlimited hints' : 'Packet Capture ×2 · TAC ×3 · Reload ×1'}</span></span>
              </div>
              <span class="vs">VS</span>
              <div class="side boss">
                ${LHArena.portrait()}
                <span class="tag">Away</span>
                <span class="side-name">${esc(b.name)}</span>
                <span class="side-meta"><span>${b.weight * LH.HP_PER_WEIGHT} HP · ${b.weight}% of the exam</span><span>${esc(b.domain)} Network Fundamentals</span></span>
              </div>
            </div>
            <p class="quote" style="margin-top:var(--s3)">“${esc(b.lines.intro)}”</p>
          </div>
          <div class="settings">
            <div class="settings-head"><h3>Match settings</h3></div>
            <div class="set-row active">
              <span class="set-label">Mode<small>${practice ? 'Learn the bank without pressure' : 'Uptime is on the line'}</small></span>
              <span class="stepper"><button id="mode-prev" aria-label="Previous mode">‹</button><span>${practice ? 'Practice' : 'Boss run'}</span><button id="mode-next" aria-label="Next mode">›</button></span>
            </div>
            <div class="set-row"><span class="set-label">Clock<small>Starts when the boss drops below 33%</small></span><span class="set-val">${practice ? 'Off' : 'Phase 3'}</span></div>
            <div class="set-row"><span class="set-label">Cost of a miss<small>Below 90.000% the SLA is breached</small></span><span class="set-val">${practice ? 'None' : '0.5 nines'}</span></div>
            <div class="set-row"><span class="set-label">Phases<small>Questions get harder at 66% and 33%</small></span><span class="set-val">3</span></div>
            <div class="set-row"><span class="set-label">Question bank<small>Tagged to the CCNA 200-301 blueprint</small></span><span class="set-val">${bank.length} · ${objCount} objectives</span></div>
            <div class="set-row"><span class="set-label">Weak points<small>Land a critical hit to expose one</small></span>
              <span class="wp-chips">${b.weakPoints.map(w => rev.includes(w) ? `<span class="wp-chip found" title="${esc(objName(w))}">${w}</span>` : '<span class="wp-chip">?</span>').join('')}</span></div>
            <div class="setup-go">
              <button class="btn primary big" id="kickoff"><kbd>↵</kbd>Kick off</button>
              <button class="btn ghost" id="back"><kbd>Esc</kbd>Back</button>
            </div>
          </div>
        </div>
      </section>`,
      [['↵', 'Kick off'], ['←', 'Mode'], ['→', 'Mode'], ['Esc', 'Back']]);
    setTab('match');
    const flip = () => { sfx.select(); setup(id, practice ? 'run' : 'practice'); };
    $('#mode-prev').addEventListener('click', flip);
    $('#mode-next').addEventListener('click', flip);
    $('#kickoff').addEventListener('click', () => battle(id, mode));
    $('#back').addEventListener('click', home);
    $('#kickoff').focus({ preventScroll: true });
  }

  /* ================================================================
     GUIDE
     ================================================================ */
  function guide() {
    show('guide', `
      <section>
        <div class="screen-head"><div><span class="tag accent">Rules</span><h1>How to play</h1></div>
          <p>Each boss is one CCNA exam domain. Its health is sized to that domain's weight on the exam, so beating all six covers the exam in proportion.</p></div>
        <div class="guide">
          <div class="gcard"><span class="gnum">01</span><h2>Pick a card</h2><p>Each turn deals up to three question cards from different objectives. The big number is the damage it does if you answer correctly. Gold cards hit hardest.</p></div>
          <div class="gcard"><span class="gnum">02</span><h2>Answer it</h2><p>Typed answers accept any valid form: /26 or 255.255.255.192. Input that can't be read as an answer is rejected without costing you anything.</p></div>
          <div class="gcard"><span class="gnum">03</span><h2>Watch the phases</h2><p>At 66% health the questions get harder. At 33% a clock starts on every question, and running out counts as a miss.</p></div>
          <div class="gcard"><h2>Card tiers</h2>
            <table class="dtable"><thead><tr><th>Type</th><th>Code</th><th>Tier</th></tr></thead><tbody>
              ${Object.entries(TYPES).map(([k, t]) => `<tr><td>${t.label}</td><td class="mono">${TYPE_CODE[k]}</td><td><span class="tier ${TIER_CLASS[t.tier]}"></span>${t.tier}</td></tr>`).join('')}
            </tbody></table></div>
          <div class="gcard"><h2>Uptime is your health</h2><p>You start at 99.999%, which is five nines. Each miss costs half a nine. Drop below 90.000% and the run is over.</p></div>
          <div class="gcard"><h2>Convergence</h2><p>Every right answer in a row adds +0.2× damage, up to ×2.0. One miss resets it.</p></div>
          <div class="gcard"><h2>Weak points</h2><p>Each boss hides four objectives that take ×1.8 critical damage. Landing one exposes it for every future run, and its cards are marked.</p></div>
          <div class="gcard"><h2>Aftershocks</h2><p>A missed question comes back three turns later and has to be cleared. Questions you missed in earlier runs come up first.</p></div>
          <div class="gcard"><h2>Items</h2><p><b>Packet Capture</b> removes wrong options. <b>TAC Case</b> gives a hint for 0.2 nines and 10 seconds on the clock. <b>Reload in 5</b> undoes one miss.</p></div>
        </div>
      </section>`,
      [['Q', 'Prev tab'], ['E', 'Next tab'], ['Esc', 'Back']]);
    setTab('guide');
  }

  /* ================================================================
     BATTLE
     ================================================================ */
  let run, boss, current, timer = null, deadline = 0, eliminated = new Set(), hintShown = null;

  function battle(id, mode) {
    boss = DATA.bosses.find(x => x.id === id);
    run = new Run({ boss, questions: DATA.banks[id], mode, srs: progress.srs, revealed: progress.revealed[id] || [] });
    show('battle', `
      <section class="battle">
        <div class="hud">
          <div class="scoreboard" role="group" aria-label="Scoreboard">
            <div class="sb-team you"><span class="sb-code">NOC</span><span class="sb-val" id="uptime"></span></div>
            <div class="sb-mid"><span class="sb-phase" id="phase"></span><span class="sb-clock" id="clock"></span></div>
            <div class="sb-team boss"><span class="sb-val" id="hptext"></span><span class="sb-code">${BOSS_CODE[boss.id]}</span></div>
            <div class="sb-bars"><span class="sb-bar you"><span id="upbar"></span></span><span class="sb-bar boss"><span id="hpfill"></span></span></div>
          </div>
          <div class="chip-stat" id="mult-wrap"><span class="tag">Convergence</span><b id="mult"></b></div>
          <div class="chip-stat"><span class="tag">Streak</span><b id="streak"></b></div>
          <div class="hud-items" id="items"></div>
        </div>
        <div class="arena-wrap">
          <svg id="arena" role="img" aria-label="Network topology. Your network on the left, the boss's corrupted side on the right."></svg>
          <div class="boss-panel">
            <span class="bp-name">${esc(boss.name)}</span>
            <span class="bp-phases" id="bp-phases"></span>
            <span class="bp-weak" id="wps"></span>
          </div>
          <div class="event" id="event" hidden></div>
          <div class="banner" id="banner" hidden></div>
          <div class="floaters" id="floaters" aria-live="polite"></div>
        </div>
        <div class="console" id="console"></div>
      </section>`, []);
    LHArena.mount($('#arena'));
    hud();
    say(boss.lines.intro, 3200);
    choose();
  }

  function hud() {
    $('#uptime').textContent = fmtUptime(run.nines).replace('%', '');
    $('#upbar').style.width = Math.max(0, (run.nines - FLOOR_NINES) / (START_NINES - FLOOR_NINES) * 100) + '%';
    $('#hptext').textContent = Math.max(0, run.hp);
    $('#hpfill').style.width = Math.max(0, run.hpFrac * 100) + '%';
    $('#phase').textContent = run.practice ? `Practice · P${run.phase}` : `Phase ${run.phase}`;
    if (!timer) { $('#clock').textContent = 'T' + String(run.turn + 1).padStart(2, '0'); $('#clock').classList.remove('low'); }
    $('#mult').textContent = '×' + run.mult.toFixed(1);
    $('#mult-wrap').classList.toggle('hot', run.streak > 0);
    $('#streak').textContent = run.streak;
    const left = Math.ceil(run.hpFrac * 3 - 1e-9);
    $('#bp-phases').innerHTML = [0, 1, 2].map(i => `<i class="${i < left ? 'on' : ''}"></i>`).join('');
    $('#wps').innerHTML = '<span class="tag">Weak</span>' + boss.weakPoints.map(w => run.revealed.has(w)
      ? `<span class="wp-chip found" title="${esc(objName(w))}">${w}</span>`
      : '<span class="wp-chip">?</span>').join('');
    const it = run.items, inf = v => v === Infinity ? '∞' : v;
    $('#items').innerHTML = `
      <button class="item" id="it-pcap" ${it.pcap > 0 ? '' : 'disabled'} title="Remove wrong options"><kbd>X</kbd>Packet Capture <b>${inf(it.pcap)}</b></button>
      <button class="item" id="it-tac" ${it.tac > 0 ? '' : 'disabled'} title="${run.practice ? 'Free in practice' : 'Costs 0.2 nines, and 10 seconds on the clock'}"><kbd>H</kbd>TAC Case <b>${inf(it.tac)}</b></button>
      <span class="item static" title="Undo one wrong answer. Offered right after a miss."><kbd>R</kbd>Reload <b>${run.practice ? '–' : it.reload}</b></span>`;
    $('#it-pcap').addEventListener('click', usePcap);
    $('#it-tac').addEventListener('click', useTac);
    LHArena.update({ hpFrac: run.hpFrac, nines: run.nines, phase: run.phase, startNines: START_NINES, floorNines: FLOOR_NINES });
  }

  function say(text, ms = 2600, cls = '') {
    const b = $('#banner');
    if (!b) return;
    b.className = 'banner ' + cls;
    b.innerHTML = `<span class="who">${esc(boss.name)}</span><span>${esc(text)}</span>`;
    b.hidden = false;
    clearTimeout(say.t);
    say.t = setTimeout(() => { b.hidden = true; }, ms);
  }
  function eventBand(text, cls) {
    const e = $('#event');
    if (!e) return;
    e.className = 'event ' + cls;
    e.innerHTML = `<span>${esc(text)}</span>`;
    e.hidden = false;
    clearTimeout(eventBand.t);
    eventBand.t = setTimeout(() => { e.hidden = true; }, 1250);
  }
  function floater(text, cls) {
    const f = document.createElement('span');
    f.className = 'floater ' + cls;
    f.textContent = text;
    $('#floaters').appendChild(f);
    setTimeout(() => f.remove(), 1600);
  }

  /* ---------- choose a card ---------- */
  function choose() {
    stopTimer();
    current = null;
    if (run.over) return results();
    hud();
    const cards = run.draw();
    const forced = cards[0].aftershock;
    $('#console').innerHTML = `
      <div class="con-head">
        <span class="con-title"><small>Turn ${run.turn + 1}</small>${forced ? 'Aftershock' : 'Pick your card'}</span>
        <span class="tag">${forced ? 'Must clear' : '1 · 2 · 3'}</span>
      </div>
      ${forced ? '<p class="note">You missed this one earlier. It came back, and it has to be cleared.</p>' : ''}
      <div class="cards ${cards.length === 1 ? 'one' : ''}">${cards.map((k, i) => {
        const q = k.q, t = TYPES[q.type];
        const weak = run.isWeak(q) && run.revealed.has(q.obj);
        const tier = k.aftershock ? 'special' : TIER_CLASS[t.tier];
        return `<button class="ccard ${tier}" data-i="${i}" aria-label="${esc(q.title)}, ${t.label}, ${run.damageFor(q, weak)} damage">
          ${weak ? '<span class="cc-badge">Weak pt</span>' : ''}
          <span class="cc-top"><span class="cc-rating">${run.damageFor(q, weak)}</span><span class="cc-dmg">dmg</span></span>
          <span class="cc-pos">${TYPE_CODE[q.type]}</span>
          <span class="cc-title">${esc(q.title)}</span>
          <span class="cc-obj">${q.obj} ${esc(objName(q.obj))}</span>
          <span class="cc-stats"><span><b>${q.diff}</b>DIF</span><span><b>${t.base}</b>BASE</span><span><b>${i + 1}</b>KEY</span></span>
        </button>`;
      }).join('')}</div>`;
    $$('#console .ccard').forEach(b => b.addEventListener('click', () => { sfx.select(); ask(cards[+b.dataset.i]); }));
    $('#console').scrollTop = 0;
    $('#console .ccard').focus({ preventScroll: true });
    setPrompts([['1–3', 'Pick card'], ['↵', 'Select']]);
  }

  /* ---------- ask ---------- */
  function ask(card, retry) {
    current = { ...card, order: null, picked: null, seq: [] };
    eliminated = new Set();
    hintShown = null;
    const q = card.q, t = TYPES[q.type];
    $('#console').innerHTML = `
      <div class="con-head">
        <span class="con-title"><small>${q.obj} ${esc(objName(q.obj))}${card.aftershock ? ' · Aftershock' : ''}${retry ? ' · Reloaded' : ''}</small>${t.label}</span>
        ${pips(q.diff)}
      </div>
      <p class="prompt-text">${esc(q.prompt)}</p>
      <div id="qbody"></div>
      <div id="hint" class="hint" hidden></div>`;
    renderBody();
    const limit = run.timeLimit(q);
    if (limit) startTimer(limit); else stopTimer();
    $('#console').scrollTop = 0;
    const base = { recall: [['A–D', 'Answer']], scenario: [['A–D', 'Answer']], output: [['Click', 'Pick line'], ['↵', 'Flag']], calc: [['↵', 'Submit']], order: [['Click', 'Place step']] }[q.type];
    setPrompts([...base, ['X', 'Packet Capture'], ['H', 'TAC Case']]);
  }

  function renderBody() {
    const q = current.q, body = $('#qbody');
    if (q.type === 'recall' || q.type === 'scenario') {
      current.order = current.order || run.choiceOrder(q);
      body.innerHTML = `<div class="choices">${current.order.map((oi, n) => `
        <button class="choice" data-oi="${oi}" ${eliminated.has(oi) ? 'disabled aria-label="eliminated"' : ''}>
          <span class="key">${'ABCD'[n]}</span><span>${esc(q.choices[oi].t)}</span></button>`).join('')}</div>`;
      $$('.choice', body).forEach(b => b.addEventListener('click', () => submit(+b.dataset.oi === q.answer, { pick: +b.dataset.oi })));
    } else if (q.type === 'output') {
      body.innerHTML = terminal(q, { selectable: true }) +
        `<div class="row" style="margin-top:var(--s3)"><button class="btn primary" id="flag" ${current.picked === null ? 'disabled' : ''}><kbd>↵</kbd>Flag this line</button><span class="dim small">Click the line that proves the fault.</span></div>`;
      if (current.picked !== null) { const sel = $(`.tline[data-i="${current.picked}"]`, body); if (sel) sel.classList.add('sel'); }
      $$('.tline[data-i]', body).forEach(b => b.addEventListener('click', () => {
        $$('.tline.sel', body).forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        current.picked = +b.dataset.i;
        $('#flag').disabled = false;
        sfx.select();
      }));
      $('#flag').addEventListener('click', () => submit(q.answer.includes(current.picked), { pick: current.picked }));
    } else if (q.type === 'calc') {
      body.innerHTML = `
        <form class="calc" id="calc" autocomplete="off">
          <label for="calc-input" class="sr">Your answer</label>
          <span class="calc-prompt">&gt;</span>
          <input id="calc-input" class="calc-input" spellcheck="false" autocapitalize="off" placeholder="${esc(INPUT_HELP[q.kind])}">
          <button class="btn primary">Enter</button>
        </form>
        <p class="dim small" id="calc-msg" style="margin-top:var(--s2)">No multiple choice. Type it exactly.</p>`;
      const input = $('#calc-input');
      input.focus({ preventScroll: true });
      $('#calc').addEventListener('submit', e => {
        e.preventDefault();
        const v = input.value;
        const ok = checkTyped(q, v);
        if (ok === null) {
          $('#calc-msg').textContent = v.trim() ? `That isn't a valid ${INPUT_HELP[q.kind]}. Nothing lost, try again.` : 'Type an answer first.';
          $('#calc-msg').className = 'warn small';
          return;
        }
        submit(ok, { typed: v });
      });
    } else if (q.type === 'order') {
      if (!current.pool) current.pool = shuffle(q.items.map((_, i) => i), rng(run.turn * 7919 + q.id.length));
      const placed = new Set(current.seq);
      body.innerHTML = `
        <ol class="seq">${q.items.map((_, n) => {
          const i = current.seq[n];
          return i === undefined ? `<li class="slot empty"><span class="key">${n + 1}</span>Empty slot</li>`
            : `<li class="slot"><button class="seq-item" data-i="${i}"><span class="key">${n + 1}</span><span>${esc(q.items[i])}</span></button></li>`;
        }).join('')}</ol>
        <div class="pool" style="margin-top:var(--s3)">${current.pool.filter(i => !placed.has(i)).map(i =>
          `<button class="pool-item" data-i="${i}">${esc(q.items[i])}</button>`).join('')}</div>
        <div class="row" style="margin-top:var(--s3)"><button class="btn primary" id="commit" ${current.seq.length === q.items.length ? '' : 'disabled'}>Commit order</button>
        <span class="dim small">Click steps in order. Click a placed step to take it back.</span></div>`;
      $$('.pool-item', body).forEach(b => b.addEventListener('click', () => { current.seq.push(+b.dataset.i); sfx.select(); renderBody(); }));
      $$('.seq-item', body).forEach(b => b.addEventListener('click', () => { current.seq = current.seq.filter(x => x !== +b.dataset.i); renderBody(); }));
      $('#commit').addEventListener('click', () => submit(current.seq.every((v, n) => v === n), { seq: current.seq.slice() }));
    }
    if (hintShown) { const h = $('#hint'); h.hidden = false; h.innerHTML = `<b>TAC</b>${esc(hintShown)}`; }
  }

  function terminal(q, o = {}) {
    const t = q.terminal;
    const lines = t.lines.map((l, i) => {
      const cls = ['tline'];
      if (o.marks && o.marks[i]) cls.push(o.marks[i]);
      if (eliminated.has(i) && !o.marks) cls.push('elim');
      if (!l.trim()) return `<div class="tline blank"> </div>`;
      return o.selectable && !eliminated.has(i)
        ? `<button class="${cls.join(' ')}" data-i="${i}">${esc(l)}</button>`
        : `<div class="${cls.join(' ')}">${esc(l)}</div>`;
    }).join('');
    return `<div class="term" role="group" aria-label="Terminal output"><div class="tline cmd">${esc(t.prompt)}${esc(t.cmd)}</div>${lines}</div>`;
  }

  /* ---------- items ---------- */
  function usePcap() {
    if (!current || current.done) return;
    const q = current.q;
    if (!(q.choices || q.type === 'output')) { flash('Packet Capture only works on multiple-choice and output questions.'); return; }
    const out = run.capture(q);
    if (!out) return;
    out.forEach(i => eliminated.add(i));
    if (eliminated.has(current.picked)) current.picked = null;
    sfx.select();
    renderBody(); hud();
  }
  function useTac() {
    if (!current || current.done || hintShown) return;
    const h = run.tac(current.q);
    if (!h) return;
    hintShown = h;
    if (timer) deadline -= 10000;
    if (!run.practice) sfx.alarm();
    renderBody(); hud();
    if (run.over) { stopTimer(); results(); }
  }
  function flash(msg) { const h = $('#hint'); if (h) { h.hidden = false; h.textContent = msg; } }

  /* ---------- timer (phase 3) ---------- */
  function startTimer(sec) {
    stopTimer();
    deadline = Date.now() + sec * 1000;
    let lastWhole = sec + 1;
    const clock = $('#clock');
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const whole = Math.ceil(left / 1000);
      clock.textContent = '0:' + String(whole).padStart(2, '0');
      clock.classList.toggle('low', whole <= 5);
      if (whole !== lastWhole && whole <= 5 && whole > 0) sfx.tick();
      lastWhole = whole;
      if (left <= 0) { stopTimer(); submit(false, { timeout: true }); }
    };
    timer = setInterval(tick, 200);
    tick();
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /* ---------- resolve an answer ---------- */
  function submit(correct, detail) {
    if (!current || current.done) return;
    current.done = true;
    stopTimer();
    const q = current.q;
    const out = run.answer(q, correct, { aftershock: current.aftershock, timeout: detail.timeout });
    recordResult(progress, q, correct);
    if (out.revealed) progress.revealed[boss.id] = [...new Set([...(progress.revealed[boss.id] || []), out.revealed])];
    save();

    if (correct) {
      out.crit ? sfx.crit() : sfx.relay();
      LHArena.hit(out.crit);
      eventBand(out.crit ? 'Critical hit' : 'Link up', out.crit ? 'crit' : '');
      floater('−' + out.damage, out.crit ? 'crit' : 'dmg');
    } else {
      if (!run.practice) sfx.alarm();
      LHArena.taunt();
      eventBand(detail.timeout ? 'Out of time' : 'Link down', 'bad');
      if (!run.practice) floater(`−${out.uptimeLost} nines`, 'hurt');
    }
    hud();
    if (out.revealed) setTimeout(() => say(`${boss.lines.crit} Weak point exposed: ${out.revealed} ${objName(out.revealed)}.`, 3200, 'crit'), 500);
    if (out.phaseChanged && !run.over) {
      sfx.phase();
      setTimeout(() => {
        eventBand(`Phase ${out.phase}`, 'phase');
        say(out.phase === 2 ? boss.lines.phase2 : boss.lines.phase3, 3600);
      }, 1400);
    }
    feedback(q, correct, out, detail);
  }

  function feedback(q, correct, out, detail) {
    let review = '';
    if (q.choices) {
      const order = current.order || q.choices.map((_, i) => i);
      review = `<ul class="review">${order.map(oi => {
        const ch = q.choices[oi], right = oi === q.answer, picked = oi === detail.pick;
        return `<li class="${right ? 'right' : picked ? 'wrong' : ''}">
          <span class="mark">${right ? '✓' : picked ? '✗' : '·'}</span>
          <span><b>${esc(ch.t)}</b>${right ? '' : `<span class="why">${esc(ch.why)}</span>`}</span></li>`;
      }).join('')}</ul>`;
    } else if (q.type === 'output') {
      const marks = {};
      q.answer.forEach(i => { marks[i] = 'right'; });
      const wrongPick = detail.pick !== undefined && detail.pick !== null && !q.answer.includes(detail.pick);
      if (wrongPick) marks[detail.pick] = 'wrong';
      const why = wrongPick && q.lineWhy && q.lineWhy[detail.pick];
      review = terminal(q, { marks }) + (why ? `<p class="why-line"><b>The line you flagged:</b> ${esc(why)}</p>` : '');
    } else if (q.type === 'calc') {
      review = `<div class="calc-review"><span class="dim">You typed <code>${esc(detail.typed !== undefined ? detail.typed : '(nothing)')}</code></span><span class="dim">Answer <code>${esc(q.answer)}</code></span></div>`;
    } else if (q.type === 'order') {
      const seq = detail.seq || [];
      review = `<ol class="order-review">${q.items.map((it, n) => {
        const ok = seq[n] === n;
        return `<li class="${detail.timeout ? '' : ok ? 'right' : 'wrong'}"><span>${esc(it)}</span>${!ok && seq[n] !== undefined ? `<span class="why">You placed: ${esc(q.items[seq[n]])}</span>` : ''}</li>`;
      }).join('')}</ol>`;
    }

    const canReload = !correct && !run.practice && run.items.reload > 0 && run.undo && !run.over;
    const band = correct
      ? `<span class="state ${out.crit ? 'crit' : 'up'}">${out.crit ? 'Critical' : 'Link up'}</span><span class="result-meta">${out.damage} damage${run.streak > 1 ? ` · ×${run.mult.toFixed(1)} next` : ''}</span>`
      : `<span class="state down">${detail.timeout ? 'Time' : 'Link down'}</span><span class="result-meta">${run.practice ? 'Practice, no uptime lost' : `Uptime ${fmtUptime(run.nines)}`} · returns as an aftershock</span>`;
    $('#console').innerHTML = `
      <div class="result-band">${band}</div>
      <p class="prompt-text small">${esc(q.prompt)}</p>
      ${review}
      <div class="explain"><b>Why</b>${esc(q.explain)}</div>
      <div class="row">
        <button class="btn primary" id="next"><kbd>↵</kbd>${run.over ? 'Full time' : 'Continue'}</button>
        ${canReload ? `<button class="btn" id="reload"><kbd>R</kbd>Reload in 5: undo and retry</button>` : ''}
      </div>`;
    $('#console').scrollTop = 0;
    $('#next').focus({ preventScroll: true });
    $('#next').addEventListener('click', () => run.over ? results() : choose());
    if (canReload) $('#reload').addEventListener('click', doReload);
    setPrompts(canReload ? [['↵', 'Continue'], ['R', 'Reload in 5']] : [['↵', 'Continue']]);
  }
  function doReload() {
    // A reloaded miss still counts in long-term mastery; only the in-run cost is rolled back.
    if (!current || !run.reload()) return;
    sfx.relay(); hud();
    ask({ q: current.q, aftershock: current.aftershock }, true);
  }

  /* ================================================================
     FULL TIME
     ================================================================ */
  function results() {
    const s = run.summary();
    if (!run.practice) {
      const prev = progress.best[boss.id];
      if (!prev || (s.won && (!prev.won || s.nines > prev.nines))) progress.best[boss.id] = { won: s.won, uptime: s.uptime, nines: s.nines };
      save();
    }
    const dealt = run.maxHP - Math.max(0, run.hp);
    const lostPct = Math.round((START_NINES - s.nines) / (START_NINES - FLOOR_NINES) * 100);
    const fact = (label, l, r, lv, rv) => {
      const total = (lv + rv) || 1;
      return `<div class="fact"><span class="fact-label">${label}</span><span class="fact-l">${l}</span>
        <span class="fact-bar"><span style="flex:${lv / total}"></span><span style="flex:${rv / total}"></span></span><span class="fact-r">${r}</span></div>`;
    };
    const objRows = Object.entries(s.byObj).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([o, v]) => {
        const r = Math.round(v.c / v.a * 99), st = v.c === v.a ? 'up' : v.c / v.a >= 0.5 ? 'degraded' : 'down';
        return `<li><span class="rbadge ${st}">${r}</span><span>${o} ${esc(objName(o))}</span><span class="num dim">${v.c}/${v.a}</span></li>`;
      }).join('');
    const missed = s.missed.map(id => run.byId[id]).map(q => `
      <details class="missed"><summary><span class="obj">${q.obj}</span>${esc(q.title)}</summary>
        <p>${esc(q.prompt)}</p>
        ${q.type === 'calc' ? `<p>Answer: <code>${esc(q.answer)}</code></p>` : ''}
        ${q.choices ? `<p>Answer: <b>${esc(q.choices[q.answer].t)}</b></p>` : ''}
        ${q.type === 'order' ? `<ol>${q.items.map(i => `<li>${esc(i)}</li>`).join('')}</ol>` : ''}
        ${q.type === 'output' ? `<p>Answer: <code>${esc(q.terminal.lines[q.answer[0]].trim())}</code></p>` : ''}
        <p class="dim">${esc(q.explain)}</p>
      </details>`).join('');

    show('results', `
      <section class="fulltime">
        <div class="ft-top">
          <span class="tag accent">${run.practice ? 'Practice' : 'Full time'} · ${esc(boss.name)}</span>
          <div class="scoreboard" role="group" aria-label="Final score">
            <div class="sb-team you"><span class="sb-code">NOC</span><span class="sb-val">${run.practice ? '—' : s.uptime.replace('%', '')}</span></div>
            <div class="sb-mid"><span class="sb-phase">${s.won ? 'Won' : 'Lost'}</span><span class="sb-clock">FT</span></div>
            <div class="sb-team boss"><span class="sb-val">${Math.max(0, run.hp)}</span><span class="sb-code">${BOSS_CODE[boss.id]}</span></div>
          </div>
          <h1 class="${s.won ? 'won' : ''}">${s.won ? 'Boss down' : 'SLA breached'}</h1>
          <p class="quote">“${esc(s.won ? boss.lines.win : boss.lines.lose)}”</p>
        </div>
        <div class="facts">
          <h3>Match facts</h3>
          ${fact('Answers · right vs wrong', s.correct, s.answered - s.correct, s.correct, s.answered - s.correct)}
          ${fact('Boss health · dealt vs left', dealt, Math.max(0, run.hp), dealt, Math.max(0, run.hp))}
          ${run.practice ? '' : fact('Uptime budget · kept vs spent', `${100 - lostPct}%`, `${lostPct}%`, 100 - lostPct, lostPct)}
          ${fact('Hits · critical vs normal', s.crits, s.correct - s.crits, s.crits, s.correct - s.crits)}
          <div class="ft-tiles">
            <div><span class="tag">Accuracy</span><b>${Math.round(s.accuracy * 100)}%</b></div>
            <div><span class="tag">Best streak</span><b>${s.maxStreak}</b></div>
            <div><span class="tag">Questions</span><b>${s.answered}</b></div>
          </div>
        </div>
        <div class="ratings">
          <h3>Ratings by objective</h3>
          <ul class="rating-list">${objRows}</ul>
          <h3 style="margin-top:var(--s3)">Review what you missed</h3>
          ${missed || '<p class="dim">Nothing missed. Clean sheet.</p>'}
          <p class="faint small">Missed questions come up first in your next run.</p>
        </div>
        <div class="ft-actions">
          <button class="btn primary big" id="again"><kbd>↵</kbd>Rematch</button>
          <button class="btn" id="practice">Practice</button>
          <button class="btn" id="m">Mastery</button>
          <button class="btn ghost" id="r"><kbd>Esc</kbd>Home</button>
        </div>
      </section>`,
      [['↵', 'Rematch'], ['Esc', 'Home']]);
    setTab('match');
    $('#again').addEventListener('click', () => battle(boss.id, 'run'));
    $('#practice').addEventListener('click', () => setup(boss.id, 'practice'));
    $('#m').addEventListener('click', mastery);
    $('#r').addEventListener('click', home);
    $('#again').focus({ preventScroll: true });
  }

  /* ================================================================
     MASTERY
     ================================================================ */
  function mastery() {
    const avg = list => { const r = list.map(o => rating(progress.mastery[o.id])).filter(x => x !== null); return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null; };
    const stateOf = r => r === null ? 'none' : r >= 80 ? 'up' : r >= 50 ? 'degraded' : 'down';
    const all = allObjectives();
    const ovr = avg(all);
    const tested = all.filter(o => progress.mastery[o.id] && progress.mastery[o.id].a).length;
    const cols = DATA.blueprint.domains.map(d => {
      const bossFor = DATA.bosses.find(b => b.domain === d.id);
      const live = bossFor && bossFor.available;
      const dr = avg(d.objectives);
      return `<section class="dom ${live ? '' : 'locked'}">
        <div class="dom-head"><div><span class="tag">${d.weight}% · ${esc(bossFor ? bossFor.name : '')}${live ? '' : ' · locked'}</span><h2>${d.id} ${esc(d.name)}</h2></div>
          <span class="rbadge ${stateOf(dr)}">${dr === null ? '–' : dr}</span></div>
        <ul>${d.objectives.map(o => {
          const m = progress.mastery[o.id], st = masteryState(m), r = rating(m);
          return `<li title="${m ? `${m.c} of ${m.a} correct overall` : 'Not tested yet'}"><span class="oid">${o.id}</span><span class="oname">${esc(o.name)}</span><span class="rbadge ${st}">${r === null ? '–' : r}</span></li>`;
        }).join('')}</ul></section>`;
    }).join('');
    show('mastery', `
      <section>
        <div class="screen-head"><div><span class="tag accent">Progress</span><h1>Mastery</h1></div>
          <p>Every blueprint objective, rated from your last eight answers on it. A rating of 80 or more over at least three answers is solid.</p></div>
        <div class="attr">
          <div class="attr-card">
            <div class="ccard ${ovr === null ? 'locked' : ovr >= 80 ? 'gold' : ovr >= 50 ? 'silver' : 'bronze'}" role="img" aria-label="Overall rating ${ovr === null ? 'not set' : ovr}">
              <span class="cc-top"><span class="cc-rating">${ovr === null ? '–' : ovr}</span><span class="cc-pos">OVR</span></span>
              <span class="cc-art">${LHArena.glyph('outage')}</span>
              <span class="cc-name">On-call</span>
              <span class="cc-stats"><span><b>${tested}</b>TST</span><span><b>${all.length}</b>OBJ</span><span><b>${Object.values(progress.best).filter(b => b.won).length}</b>WIN</span></span>
            </div>
            <div class="legend">
              <span><span class="rbadge up">80+</span>Solid</span>
              <span><span class="rbadge degraded">50+</span>Shaky</span>
              <span><span class="rbadge down">&lt;50</span>Weak</span>
              <span><span class="rbadge none">–</span>Untested</span>
            </div>
          </div>
          <div>
            <div class="doms">${cols}</div>
            <div class="reset-row"><button class="btn ghost" id="reset">Reset progress</button>
              <span id="reset-confirm" hidden>Erase ratings, weak points and best runs? <button class="btn" id="reset-yes">Erase</button> <button class="btn ghost" id="reset-no">Keep</button></span></div>
          </div>
        </div>
      </section>`,
      [['Q', 'Prev tab'], ['E', 'Next tab'], ['Esc', 'Back']]);
    setTab('mastery');
    $('#reset').addEventListener('click', () => { $('#reset-confirm').hidden = false; });
    $('#reset-no').addEventListener('click', () => { $('#reset-confirm').hidden = true; });
    $('#reset-yes').addEventListener('click', () => { const s = progress.sound; progress = blank(); progress.sound = s; save(); mastery(); });
  }

  /* ---------- keyboard: controller-style ---------- */
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches('input, textarea')) return;
    const k = e.key, scr = document.body.dataset.screen;
    if (scr !== 'battle' && (k === 'q' || k === 'e' || k === 'Q' || k === 'E')) {
      const cur = Math.max(0, TABS.findIndex(t => $(`.tab[data-tab="${t}"]`).getAttribute('aria-current') === 'page'));
      const next = TABS[(cur + (k.toLowerCase() === 'e' ? 1 : TABS.length - 1)) % TABS.length];
      sfx.select(); go(next); e.preventDefault(); return;
    }
    if (k === 'Escape' && scr !== 'battle' && scr !== 'home') { home(); e.preventDefault(); return; }
    if (scr === 'setup' && (k === 'ArrowLeft' || k === 'ArrowRight')) { $('#mode-next').click(); e.preventDefault(); return; }
    if (scr !== 'battle') return;
    if (/^[1-3]$/.test(k)) { const card = $$('#console .ccard')[+k - 1]; if (card) { card.click(); e.preventDefault(); return; } }
    if (/^[a-dA-D]$/.test(k)) { const ch = $$('.choice')['abcd'.indexOf(k.toLowerCase())]; if (ch && !ch.disabled) { ch.click(); e.preventDefault(); return; } }
    if (k === 'x' || k === 'X') { usePcap(); e.preventDefault(); }
    else if (k === 'h' || k === 'H') { useTac(); e.preventDefault(); }
    else if ((k === 'r' || k === 'R') && $('#reload')) { doReload(); e.preventDefault(); }
    else if (k === 'Enter' && $('#flag') && !$('#flag').disabled && document.activeElement && !document.activeElement.matches('button')) { $('#flag').click(); e.preventDefault(); }
  });

  /* ---------- boot ---------- */
  loadData().then(d => {
    DATA = d;
    if (progress.sound) {
      // Browsers need a gesture before audio. Re-enable on the first click.
      const once = () => { LHAudio.setEnabled(true); syncSound(); document.removeEventListener('pointerdown', once); };
      document.addEventListener('pointerdown', once);
    }
    syncSound();
    home();
  }).catch(err => {
    screen.innerHTML = `<section class="notice"><h1>Couldn't load the question bank</h1>
      <p class="dim">The game reads its questions as JSON, which browsers block when you open the file straight from disk. Serve the folder instead:</p>
      <pre class="term">  cd last-hop && python3 -m http.server 8000</pre><p class="dim">Then open http://localhost:8000.</p>
      <p class="faint small">${esc(err.message)}</p></section>`;
  });
})();
