/* LAST HOP: screens and battle UI. Game rules live in engine.js. */
(function () {
  'use strict';
  const { Run, TYPES, fmtUptime, checkTyped, recordResult, masteryState, masteryRating, MIN_SAMPLE,
    INPUT_HELP, INPUT_ERROR, START_NINES, FLOOR_NINES, HINT_COST, MISS_COST, CRIT_MULT, AFTERSHOCK_GAP, TIMER, shuffle, rng } = LH;
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
  const TYPE_CODE = { recall: 'REC', scenario: 'SCN', order: 'ORD', calc: 'CAL', output: 'SHO' };
  const TIER_CLASS = { Bronze: 'bronze', Silver: 'silver', Gold: 'gold' };
  const BOSS_CODE = { mask: 'MSK', loop: 'LOP', blackhole: 'BHL', rogue: 'RGE', intruder: 'INT', script: 'SCR', outage: 'OTG' };
  const MODE_NAME = { run: 'Boss match', practice: 'Practice' };
  const pips = d => `<span class="pips" role="img" aria-label="Difficulty ${d} of 3">${[1, 2, 3].map(i => `<i class="${i <= d ? 'on' : ''}"></i>`).join('')}</span>`;
  const keys = list => list.map(k => `<kbd class="${k.length > 2 ? 'wide' : ''}">${esc(k)}</kbd>`).join('');

  /** One rating badge for every screen. m = { a, c, recent[] } */
  function badge(m) {
    const st = masteryState(m), r = masteryRating(m);
    const text = st === 'none' ? '' : st === 'few' ? `${m.c}/${m.a}` : r;
    const label = st === 'none' ? 'Not tested yet'
      : st === 'few' ? `${m.c} of ${m.a} correct. ${MIN_SAMPLE} answers are needed for a rating.`
      : `Rating ${r} from your last ${m.recent.length} answers`;
    return `<span class="rbadge ${st}" role="img" aria-label="${label}">${text}</span>`;
  }
  /** Average of the rated topics in a list, or null. */
  function groupRating(objs) {
    const r = objs.map(o => masteryRating(progress.mastery[o.id])).filter(x => x !== null);
    return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null;
  }
  const ratingState = r => r === null ? 'none' : r >= 80 ? 'up' : r >= 50 ? 'degraded' : 'down';
  const yourRating = obj => {
    const m = progress.mastery[obj], r = masteryRating(m);
    return r !== null ? r : m && m.a ? `${m.c}/${m.a}` : 'NEW';
  };

  /* ---------- top bar, prompt bar, navigation ---------- */
  function setPrompts(list) {
    $('#prompts').innerHTML = list.map(([k, label]) =>
      `<span class="prompt-hint"><span class="keys">${keys([].concat(k))}</span>${esc(label)}</span>`).join('');
  }
  function setTab(name) {
    $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === name ? 'page' : 'false'));
  }
  function show(name, html, prompts) {
    stopTimer();
    document.body.dataset.screen = name;
    screen.innerHTML = html;
    setPrompts(prompts);
    $('#match-ctl').innerHTML = '';
    window.scrollTo(0, 0);
  }
  function syncSound() {
    const b = $('#sound');
    b.setAttribute('aria-pressed', LHAudio.enabled);
    b.textContent = LHAudio.enabled ? 'Sound: On' : 'Sound: Off';
  }
  $('#sound').addEventListener('click', () => { progress.sound = LHAudio.setEnabled(!LHAudio.enabled); save(); syncSound(); });
  $('#home').addEventListener('click', e => { e.preventDefault(); if (document.body.dataset.screen === 'battle') confirmQuit(); else home(); });
  $$('.tab').forEach(t => t.addEventListener('click', () => { sfx.select(); go(t.dataset.tab); }));
  const TABS = ['home', 'match', 'mastery', 'guide'];
  function go(tab) {
    if (tab === 'home') home();
    else if (tab === 'match') setup('mask', setup.mode || 'run');
    else if (tab === 'mastery') mastery();
    else if (tab === 'guide') guide();
  }

  // One selection cursor: hovering a control moves focus to it, so mouse and keyboard never highlight two things.
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest('.btn, .tile, .ccard:not(.locked):not(.static), .choice, .tab, .item, .pool-item, .seq-item, button.tline, button.rule, .top-btn');
    const active = document.activeElement;
    if (!el || el === active || el.disabled) return;
    if (active && active.matches('input, textarea')) return;
    el.focus({ preventScroll: true });
  });

  /* ---------- collectible cards ---------- */
  function bossCard(b) {
    const bank = DATA.banks[b.id];
    const best = progress.best[b.id];
    const tier = !b.available ? 'locked' : best && best.won ? 'gold' : 'silver';
    const art = b.available
      ? `<span class="cc-art">${LHArena.portrait()}</span>`
      : `<span class="cc-log" aria-hidden="true">${(b.log || []).map(esc).join('<br>')}</span>`;
    const stats = b.available
      ? `<span><b>${b.weight * LH.HP_PER_WEIGHT}</b>HP</span><span><b>${bank.length}</b>QNS</span><span><b>${b.weakPoints.length}</b>WPT</span>`
      : `<span><b>${b.weight * LH.HP_PER_WEIGHT}</b>HP</span>`;
    const tag = b.available ? 'button' : 'div';
    return `<${tag} class="ccard ${tier}" ${b.available ? `data-boss="${b.id}"` : 'role="img"'} aria-label="${esc(b.name)}, ${b.weight}% of the exam${b.available ? '' : ', locked'}">
      <span class="cc-face">
        ${!b.available ? '<span class="cc-badge">Locked</span>' : best && best.won ? '<span class="cc-badge">Beaten</span>' : ''}
        <span class="cc-top"><span class="cc-rating">${b.weight}</span><span class="cc-unit">%</span></span>
        <span class="cc-pos">${esc(b.domain)}</span>
        ${art}
        <span class="cc-name">${esc(b.name.replace(/^The /, ''))}</span>
        <span class="cc-stats">${stats}</span>
      </span>
    </${tag}>`;
  }

  /* ================================================================
     HOME
     ================================================================ */
  function home() {
    const b = DATA.bosses.find(x => x.id === 'mask');
    const bank = DATA.banks.mask;
    const best = progress.best.mask;
    const found = (progress.revealed.mask || []).length;
    const objs = allObjectives();
    const tested = objs.filter(o => progress.mastery[o.id] && progress.mastery[o.id].a).length;
    const dom1 = DATA.blueprint.domains[0].objectives;
    const rated = dom1.map(o => ({ o, r: masteryRating(progress.mastery[o.id]) })).filter(x => x.r !== null).sort((x, y) => x.r - y.r);
    const weakest = rated[0];
    const strip = DATA.blueprint.domains.map(d => {
      const r = groupRating(d.objectives);
      const any = d.objectives.some(o => progress.mastery[o.id] && progress.mastery[o.id].a);
      return `<i class="${r === null ? (any ? 'few' : '') : ratingState(r)}" style="flex:${d.weight}" title="${esc(d.id + ' ' + d.name)}"></i>`;
    }).join('');
    const next = DATA.bosses.find(x => x.id === 'loop');
    const rest = DATA.bosses.filter(x => !x.available && x.id !== 'loop');

    show('home', `
      <section>
        <div class="hub">
          <button class="tile hero" id="t-play" aria-label="The Mask. Open match setup.">
            <span class="hero-copy">
              <span class="hero-title">${esc(b.name)}</span>
              <span class="statline">
                <span><b>${b.weight * LH.HP_PER_WEIGHT}</b><span class="label">HP</span></span>
                <span><b>${bank.length}</b><span class="label">Questions</span></span>
                <span><b>${found}/${b.weakPoints.length}</b><span class="label">Weak points found</span></span>
                ${best ? `<span><b>${best.uptime.replace('%', '')}</b><span class="label">Best uptime</span></span>` : ''}
              </span>
              <span class="tile-sub">Domain 1.0, ${b.weight}% of the exam: subnetting, IPv4 and IPv6 addressing, cabling faults, switching, TCP and UDP, wireless and virtualization.</span>
              <span class="hero-go">Match setup ›</span>
            </span>
            <span class="hero-art">${LHArena.portrait()}</span>
          </button>
          <button class="tile" id="t-practice">
            <span class="tile-title">Practice</span>
            <span class="tile-sub">Free hints, no clock, no uptime loss.</span>
            <span class="tile-foot small dim">${weakest ? `Weakest topic: ${weakest.o.id} ${esc(weakest.o.name)}, rated ${weakest.r}` : 'Ratings appear after three answers on a topic.'}</span>
          </button>
          <button class="tile" id="t-mastery">
            <span class="tile-title">Mastery</span>
            <span class="tile-sub">${tested} of ${objs.length} exam topics tested</span>
            <span class="tile-foot"><span class="domain-strip" aria-hidden="true">${strip}</span></span>
          </button>
          <button class="tile" id="t-guide">
            <span class="tile-title">How to play</span>
            <span class="tile-sub">Rules, card tiers and controls.</span>
            <span class="tile-foot keymap-art" aria-hidden="true">${keys(['Q', 'E', '1', '2', '3', 'A', 'B', 'C', 'D', 'X', 'H', 'R'])}</span>
          </button>
        </div>
        <div class="section-head"><h3>Bosses</h3><span class="small dim">Boss HP is the domain's exam weight × ${LH.HP_PER_WEIGHT}</span></div>
        <div class="roster">
          ${bossCard(b)}
          ${bossCard(next)}
          <div class="roster-more">
            <ul>
              ${rest.map(x => `<li><span class="mono muted">${x.domain === 'all' ? 'ALL' : esc(x.domain)}</span><span>${esc(x.name)}${x.weight ? `, ${x.weight}% of the exam` : `: ${esc(x.theme.toLowerCase())}`}</span><span class="lock">Locked</span></li>`).join('')}
              <li><span class="mono muted">EXAM</span><span>Exam mode: 100 questions in 120 minutes, scored by domain</span><span class="lock">Locked</span></li>
            </ul>
            <p class="small muted pad-top">The other bosses and Exam mode unlock as their questions are written.</p>
          </div>
        </div>
      </section>`,
      [['↵', 'Select'], [['↑', '↓'], 'Move'], [['Q', 'E'], 'Tabs']]);
    setTab('home');
    $('#t-play').addEventListener('click', () => setup('mask', 'run'));
    $('#t-practice').addEventListener('click', () => setup('mask', 'practice'));
    $('#t-mastery').addEventListener('click', mastery);
    $('#t-guide').addEventListener('click', guide);
    $$('.roster button.ccard').forEach(c => c.addEventListener('click', () => setup(c.dataset.boss, 'run')));
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
      <section class="setup">
        <div>
          <div class="versus">
            <div class="side you">
              <span class="crest">NOC</span>
              <span class="team-bar"></span>
              <span class="side-name">On-call</span>
              <span class="side-meta"><span>Uptime ${fmtUptime(START_NINES)}</span><span>${practice ? 'Unlimited TAC Case hints' : 'Packet Capture ×2, TAC Case ×3, Reload ×1'}</span></span>
            </div>
            <span class="vs" aria-hidden="true">VS</span>
            <div class="side boss">
              ${LHArena.portrait()}
              <span class="team-bar"></span>
              <span class="side-name">${esc(b.name)}</span>
              <span class="side-meta"><span>${b.weight * LH.HP_PER_WEIGHT} HP</span><span>Domain ${esc(b.domain)}, ${b.weight}% of the exam</span></span>
            </div>
          </div>
          <p class="boss-line"><b>${esc(b.name)}</b>${esc(b.lines.intro)}</p>
        </div>
        <div class="rules">
          <h3>Match rules</h3>
          <button class="rule" id="mode" aria-label="Mode: ${MODE_NAME[mode]}. Activate to switch.">
            <span class="rule-name">Mode<small>${practice ? 'Ratings still update. Best uptime is not saved.' : 'Counts toward best uptime. Drop below 90% and you lose.'}</small></span>
            <span class="rule-val stepper"><i aria-hidden="true">‹</i>${MODE_NAME[mode]}<i aria-hidden="true">›</i></span>
          </button>
          <div class="rule"><span class="rule-name">Clock<small>Starts when the boss drops below 33% HP</small></span><span class="rule-val">${practice ? 'Off' : 'Phase 3'}</span></div>
          <div class="rule"><span class="rule-name">Each miss<small>Uptime is your health</small></span><span class="rule-val">${practice ? 'Free' : `−${MISS_COST} nines`}</span></div>
          <div class="rule"><span class="rule-name">Harder questions<small>The boss changes phase twice</small></span><span class="rule-val">At 66% and 33%</span></div>
          <div class="rule"><span class="rule-name">Questions<small>From CCNA 200-301 domain ${esc(b.domain)}</small></span><span class="rule-val">${bank.length} on ${objCount} topics</span></div>
          <div class="rule"><span class="rule-name">Weak points<small>Four hidden topics take ×${CRIT_MULT} damage. Answer one correctly to reveal it.</small></span>
            <span class="wp-chips">${b.weakPoints.map(w => rev.includes(w) ? `<span class="wp-chip found">${w} ${esc(objName(w))}</span>` : '<span class="wp-chip" aria-label="hidden">?</span>').join('')}</span></div>
          <div class="setup-go">
            <button class="btn primary big" id="kickoff">Kick off</button>
            <button class="btn text" id="back">Back</button>
          </div>
        </div>
      </section>`,
      [['↵', 'Select'], [['←', '→'], 'Change mode'], ['Esc', 'Back']]);
    setTab('match');
    const flip = () => { sfx.select(); setup(id, practice ? 'run' : 'practice'); $('#mode').focus({ preventScroll: true }); };
    $('#mode').addEventListener('click', flip);
    $('#kickoff').addEventListener('click', () => battle(id, mode));
    $('#back').addEventListener('click', home);
    $('#kickoff').focus({ preventScroll: true });
  }

  /* ================================================================
     HOW TO PLAY
     ================================================================ */
  function guide() {
    const rows = [
      ['Start uptime', fmtUptime(START_NINES), 'Five nines. Uptime is your health.'],
      ['Each miss', `−${MISS_COST} nines`, 'A timeout counts as a miss.'],
      ['Match lost', `Below ${fmtUptime(FLOOR_NINES)}`, 'The SLA is breached.'],
      ['Streak bonus', '+0.2× per hit', 'Up to ×2.0. A miss resets it.'],
      ['Weak point hit', `×${CRIT_MULT} damage`, 'Four hidden topics per boss. Found ones stay found.'],
      ['Phase 2', 'At 66% HP', 'Harder questions.'],
      ['Phase 3', 'At 33% HP', `A clock on every question: Recall ${TIMER.recall}s, Scenario ${TIMER.scenario}s, Put in order ${TIMER.order}s, Read the output ${TIMER.output}s, Calculate ${TIMER.calc}s.`],
      ['Aftershock', `${AFTERSHOCK_GAP} turns later`, 'A missed question comes back and has to be cleared.'],
      ['Packet Capture', '×2 per match', 'Removes wrong options.'],
      ['TAC Case', '×3 per match', `A hint for ${HINT_COST} nines, and 10 seconds off the clock.`],
      ['Reload', '×1 per match', 'Undoes one miss so you can answer again. Named after reload in 5.']
    ];
    const tierCard = (cls, tier, types) => {
      const bases = types.map(t => TYPES[t].base);
      const range = bases.length > 1 ? `${Math.min(...bases)}-${Math.max(...bases)}` : bases[0];
      return `<span class="ccard ${cls} static" role="img" aria-label="${tier} card: ${types.map(t => TYPES[t].label).join(' and ')}, base damage ${range}">
        <span class="cc-face">
          <span class="cc-top"><span class="cc-rating">${range}</span><span class="cc-unit">base</span></span>
          <span class="cc-pos">${tier}</span>
          <span class="cc-title">${types.map(t => esc(TYPES[t].label)).join('<br>')}</span>
        </span></span>`;
    };
    show('guide', `
      <section class="manual">
        <div class="stack">
          <section>
            <h3>Controls</h3>
            <div class="keyrow"><span class="keys">${keys(['Q', 'E'])}</span><span>Previous and next tab</span></div>
            <div class="keyrow"><span class="keys">${keys(['↑', '↓'])}</span><span>Move through lists, answers and terminal lines</span></div>
            <div class="keyrow"><span class="keys">${keys(['↵'])}</span><span>Select, kick off, continue</span></div>
            <div class="keyrow"><span class="keys">${keys(['Esc'])}</span><span>Back</span></div>
            <div class="keyrow"><span class="keys">${keys(['1', '2', '3'])}</span><span>Pick a question card</span></div>
            <div class="keyrow"><span class="keys">${keys(['A', 'B', 'C', 'D'])}</span><span>Answer a multiple-choice question</span></div>
            <div class="keyrow"><span class="keys">${keys(['F'])}</span><span>Flag the selected terminal line</span></div>
            <div class="keyrow"><span class="keys">${keys(['L'])}</span><span>Lock in an order</span></div>
            <div class="keyrow"><span class="keys">${keys(['X', 'H'])}</span><span>Packet Capture, TAC Case</span></div>
            <div class="keyrow"><span class="keys">${keys(['R'])}</span><span>Reload, right after a miss</span></div>
          </section>
          <section>
            <h3>Card tiers</h3>
            <p class="small dim pad-bottom">The number on a card is the damage it deals if you answer correctly. It grows with difficulty, your streak and weak points.</p>
            <div class="tier-row">
              ${tierCard('bronze', 'Bronze', ['recall'])}
              ${tierCard('silver', 'Silver', ['scenario', 'order'])}
              ${tierCard('gold', 'Gold', ['calc', 'output'])}
            </div>
          </section>
        </div>
        <section class="rules">
          <h3>Rules</h3>
          ${rows.map(([n, v, d]) => `<div class="rule"><span class="rule-name">${n}<small>${esc(d)}</small></span><span class="rule-val">${esc(v)}</span></div>`).join('')}
        </section>
      </section>`,
      [[['Q', 'E'], 'Tabs'], ['Esc', 'Back']]);
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
          <div class="scoreboard" id="scoreboard" role="group" aria-label="Scoreboard">
            <div class="sb-cell you"><span class="sb-code">NOC</span><span class="sb-val" id="uptime"></span></div>
            <div class="sb-cell sb-mid" id="sb-mid"><span class="sb-small" id="clock-label"></span><span class="sb-clock" id="clock"></span></div>
            <div class="sb-cell boss"><span class="sb-val" id="hptext"></span><span class="sb-code">${BOSS_CODE[boss.id]}</span></div>
            <div class="sb-cell sb-extra"><span class="sb-small">Streak</span><b id="streak"></b></div>
            <div class="sb-bars" aria-hidden="true"><span class="sb-bar you"><span id="upbar"></span></span><span class="sb-bar boss"><span id="hpfill"></span></span></div>
          </div>
          <div class="hud-items" id="items"></div>
        </div>
        <div class="pitch">
          <div class="arena-wrap">
            <svg id="arena" role="img" aria-label="Network topology. Your network on the left, the boss's side on the right."></svg>
            <div class="event" id="event" hidden></div>
          </div>
          <div class="match-status"><span class="label" id="phase"></span><span class="bp-weak" id="wps"></span></div>
          <div class="lower-third" id="banner" aria-live="polite"><span class="who">${esc(boss.name)}</span><span class="what" id="banner-text"></span></div>
        </div>
        <div class="console" id="console"></div>
      </section>`, []);
    $('#match-ctl').innerHTML = '<button class="top-btn" id="quit">Quit match</button>';
    $('#quit').addEventListener('click', confirmQuit);
    LHArena.mount($('#arena'));
    hud();
    say(boss.lines.intro);
    choose();
  }

  function confirmQuit() {
    const ctl = $('#match-ctl');
    ctl.innerHTML = `<span class="quit-confirm">Leave this match? <button class="top-btn" id="quit-yes">Quit</button><button class="top-btn" id="quit-no">Keep playing</button></span>`;
    $('#quit-yes').addEventListener('click', home);
    $('#quit-no').addEventListener('click', () => {
      ctl.innerHTML = '<button class="top-btn" id="quit">Quit match</button>';
      $('#quit').addEventListener('click', confirmQuit);
    });
    $('#quit-no').focus({ preventScroll: true });
  }

  function hud() {
    $('#uptime').textContent = fmtUptime(run.nines).replace('%', '');
    $('#upbar').style.width = Math.max(0, (run.nines - FLOOR_NINES) / (START_NINES - FLOOR_NINES) * 100) + '%';
    $('#hptext').textContent = Math.max(0, run.hp);
    $('#hpfill').style.width = Math.max(0, run.hpFrac * 100) + '%';
    $('#phase').textContent = run.practice ? `Practice, phase ${run.phase}` : `Phase ${run.phase}`;
    if (!timer) {
      $('#clock-label').textContent = 'Turn';
      $('#clock').textContent = run.turn + 1;
      $('#sb-mid').classList.remove('low');
    }
    $('#streak').textContent = `${run.streak} ×${run.mult.toFixed(1)}`;
    $('#wps').innerHTML = '<span class="label">Weak points</span>' + boss.weakPoints.map(w => run.revealed.has(w)
      ? `<span class="wp-chip found">${w}</span>`
      : '<span class="wp-chip" aria-label="hidden">?</span>').join('');
    const it = run.items;
    $('#items').innerHTML = run.practice
      ? `<button class="item" id="it-pcap">Packet Capture <b>∞</b></button><button class="item" id="it-tac">TAC Case <b>∞</b></button>`
      : `<button class="item" id="it-pcap" ${it.pcap > 0 ? '' : 'disabled'}>Packet Capture <b>×${it.pcap}</b></button>
         <button class="item" id="it-tac" ${it.tac > 0 ? '' : 'disabled'}>TAC Case <b>×${it.tac}</b></button>
         <span class="item passive">Reload <b>×${it.reload}</b></span>`;
    $('#it-pcap').addEventListener('click', usePcap);
    $('#it-tac').addEventListener('click', useTac);
    LHArena.update({ hpFrac: run.hpFrac, nines: run.nines, phase: run.phase, startNines: START_NINES, floorNines: FLOOR_NINES });
  }

  function say(text, cls = '') {
    const b = $('#banner');
    if (!b) return;
    $('#banner-text').textContent = text;
    b.className = 'lower-third ' + cls;
    void b.offsetWidth;
    b.classList.add('show');
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
    const sb = $(cls === 'hurt' ? '#scoreboard .sb-cell.you' : '#scoreboard .sb-cell.boss');
    if (!sb) return;
    const f = document.createElement('span');
    f.className = 'floater ' + cls;
    f.textContent = text;
    sb.appendChild(f);
    setTimeout(() => f.remove(), 1500);
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
      <div class="con-head"><span class="con-title">${forced ? 'Aftershock' : 'Pick a card'}</span></div>
      ${forced ? '<p class="note">Missed earlier. Clear it to move on.</p>' : ''}
      <div class="cards ${cards.length === 1 ? 'one' : ''}">${cards.map((k, i) => {
        const q = k.q, t = TYPES[q.type];
        const weak = run.isWeak(q) && run.revealed.has(q.obj);
        const tier = k.aftershock ? 'special' : TIER_CLASS[t.tier];
        const dmg = run.damageFor(q, weak);
        return `<button class="ccard ${tier}" data-i="${i}" aria-label="${esc(q.title)}. ${t.label}, ${dmg} damage, difficulty ${q.diff}.">
          <span class="cc-face">
            ${weak ? '<span class="cc-badge">Weak pt</span>' : ''}
            <span class="cc-top"><span class="cc-rating">${dmg}</span><span class="cc-unit">dmg</span></span>
            <span class="cc-pos">${TYPE_CODE[q.type]}</span>
            <span class="cc-title">${esc(q.title)}</span>
            <span class="cc-obj">${q.obj} ${esc(objName(q.obj))}</span>
            <span class="cc-stats"><span><b>${q.diff}</b>LVL</span><span><b>${yourRating(q.obj)}</b>YOU</span></span>
          </span>
        </button>`;
      }).join('')}</div>`;
    $$('#console .ccard').forEach(b => b.addEventListener('click', () => { sfx.select(); ask(cards[+b.dataset.i]); }));
    $('#console').scrollTop = 0;
    $('#console .ccard').focus({ preventScroll: true });
    setPrompts([[cards.length > 1 ? ['1', '2', '3'] : ['1'], 'Pick card'], [['←', '→'], 'Move'], ['↵', 'Select']]);
  }

  /* ---------- ask ---------- */
  function ask(card, retry) {
    current = { ...card, order: null, picked: null, seq: [] };
    eliminated = new Set();
    hintShown = null;
    const q = card.q, t = TYPES[q.type];
    $('#console').innerHTML = `
      <div class="con-head">
        <span class="con-title">${t.label}${card.aftershock ? ': aftershock' : ''}${retry ? ': second try' : ''}</span>
        <span class="con-meta"><span class="obj-chip">${q.obj} ${esc(objName(q.obj))}</span>${pips(q.diff)}</span>
      </div>
      <p class="prompt-text">${esc(q.prompt)}</p>
      <div id="qbody"></div>
      <p id="hint" class="tac" hidden></p>`;
    renderBody();
    const limit = run.timeLimit(q);
    if (limit) startTimer(limit); else stopTimer();
    $('#console').scrollTop = 0;
    const legend = {
      recall: [[['A', 'B', 'C', 'D'], 'Answer']], scenario: [[['A', 'B', 'C', 'D'], 'Answer']],
      output: [[['↑', '↓'], 'Move'], ['↵', 'Select line'], ['F', 'Flag']],
      calc: [['↵', 'Submit']],
      order: [[['↑', '↓'], 'Move'], ['↵', 'Place step'], ['L', 'Lock in']]
    }[q.type];
    setPrompts([...legend, ['X', 'Packet Capture'], ['H', 'TAC Case']]);
  }

  function renderBody() {
    const q = current.q, body = $('#qbody');
    if (q.type === 'recall' || q.type === 'scenario') {
      current.order = current.order || run.choiceOrder(q);
      body.innerHTML = `<div class="list">${current.order.map((oi, n) => `
        <button class="choice" data-oi="${oi}" ${eliminated.has(oi) ? 'disabled aria-label="Removed by Packet Capture"' : ''}>
          <span class="slot-key">${'ABCD'[n]}</span><span>${esc(q.choices[oi].t)}</span></button>`).join('')}</div>`;
      $$('.choice', body).forEach(b => b.addEventListener('click', () => submit(+b.dataset.oi === q.answer, { pick: +b.dataset.oi })));
      const first = $('.choice:not(:disabled)', body); if (first) first.focus({ preventScroll: true });
    } else if (q.type === 'output') {
      body.innerHTML = terminal(q, { selectable: true }) +
        `<div class="row"><button class="btn primary" id="flag" ${current.picked === null ? 'disabled' : ''}>Flag line</button></div>`;
      if (current.picked !== null) { const sel = $(`.tline[data-i="${current.picked}"]`, body); if (sel) sel.classList.add('sel'); }
      $$('button.tline', body).forEach(b => b.addEventListener('click', () => {
        $$('.tline.sel', body).forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        current.picked = +b.dataset.i;
        $('#flag').disabled = false;
        sfx.select();
      }));
      $('#flag').addEventListener('click', flag);
    } else if (q.type === 'calc') {
      body.innerHTML = `
        <form class="calc" id="calc" autocomplete="off">
          <label for="calc-input" class="sr">Your answer</label>
          <span class="calc-prompt" aria-hidden="true">&gt;</span>
          <input id="calc-input" class="calc-input" spellcheck="false" autocapitalize="off" placeholder="${esc(INPUT_HELP[q.kind])}">
          <button class="btn primary">Submit</button>
        </form>
        <p class="calc-msg" id="calc-msg">Type your answer. Any valid format counts.</p>`;
      const input = $('#calc-input');
      input.focus({ preventScroll: true });
      $('#calc').addEventListener('submit', e => {
        e.preventDefault();
        const v = input.value;
        const ok = checkTyped(q, v);
        if (ok === null) {
          const msg = $('#calc-msg');
          msg.textContent = v.trim() ? `${INPUT_ERROR[q.kind] || INPUT_ERROR.text} No penalty.` : INPUT_ERROR.text;
          msg.className = 'calc-msg warn';
          return;
        }
        submit(ok, { typed: v });
      });
    } else if (q.type === 'order') {
      if (!current.pool) current.pool = shuffle(q.items.map((_, i) => i), rng(run.turn * 7919 + q.id.length));
      const placed = new Set(current.seq);
      const left = current.pool.filter(i => !placed.has(i));
      body.innerHTML = `
        <div class="list" aria-label="Your order">${q.items.map((_, n) => {
          const i = current.seq[n];
          return i === undefined
            ? `<div class="slot-empty"><span class="slot-key">${n + 1}</span>Empty</div>`
            : `<button class="seq-item" data-i="${i}" aria-label="Step ${n + 1}: ${esc(q.items[i])}. Activate to take it back."><span class="slot-key">${n + 1}</span><span>${esc(q.items[i])}</span></button>`;
        }).join('')}</div>
        ${left.length ? `<span class="label">Steps to place</span>
        <div class="list">${left.map(i => `<button class="pool-item" data-i="${i}">${esc(q.items[i])}</button>`).join('')}</div>` : ''}
        <div class="row"><button class="btn primary" id="commit" ${current.seq.length === q.items.length ? '' : 'disabled'}>Lock in order</button></div>`;
      $$('.pool-item', body).forEach(b => b.addEventListener('click', () => { current.seq.push(+b.dataset.i); sfx.select(); renderBody(); focusFirst('.pool-item', '#commit'); }));
      $$('.seq-item', body).forEach(b => b.addEventListener('click', () => { current.seq = current.seq.filter(x => x !== +b.dataset.i); renderBody(); focusFirst('.pool-item'); }));
      $('#commit').addEventListener('click', lockIn);
      if (!document.activeElement || document.activeElement === document.body) focusFirst('.pool-item');
    }
    if (hintShown) { const h = $('#hint'); h.hidden = false; h.innerHTML = `<b>TAC Case</b><span>${esc(hintShown)}</span>`; }
  }
  function focusFirst(...sels) {
    for (const s of sels) { const el = $(`#qbody ${s}:not(:disabled)`); if (el) { el.focus({ preventScroll: true }); return; } }
  }
  function flag() { if (current && !current.done && current.picked !== null) submit(current.q.answer.includes(current.picked), { pick: current.picked }); }
  function lockIn() { if (current && !current.done && current.seq.length === current.q.items.length) submit(current.seq.every((v, n) => v === n), { seq: current.seq.slice() }); }

  function terminal(q, o = {}) {
    const t = q.terminal;
    const lines = t.lines.map((l, i) => {
      const cls = ['tline'];
      const mark = o.marks && o.marks[i];
      if (mark) cls.push(mark);
      if (eliminated.has(i) && !o.marks) cls.push('elim');
      const gut = `<span class="gut" aria-hidden="true">${mark === 'right' ? '✓' : mark === 'wrong' ? '✗' : ''}</span>`;
      if (!l.trim()) return `<div class="tline blank"> </div>`;
      return o.selectable && !eliminated.has(i)
        ? `<button class="${cls.join(' ')}" data-i="${i}">${gut}${esc(l)}</button>`
        : `<div class="${cls.join(' ')}">${gut}${esc(l)}</div>`;
    }).join('');
    return `<div class="term" role="group" aria-label="Terminal output"><div class="tline cmd"><span class="gut"></span>${esc(t.prompt)}${esc(t.cmd)}</div>${lines}</div>`;
  }

  /* ---------- items ---------- */
  function usePcap() {
    if (!current || current.done) return;
    const q = current.q;
    if (!(q.choices || q.type === 'output')) { flash('Packet Capture works on multiple-choice and terminal questions.'); return; }
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
    $('#clock-label').textContent = 'Clock';
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const whole = Math.ceil(left / 1000);
      $('#clock').textContent = '0:' + String(whole).padStart(2, '0');
      $('#sb-mid').classList.toggle('low', whole <= 5);
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
    let delay = 1300;
    if (out.revealed) {
      say(boss.lines.crit, 'crit');
      setTimeout(() => eventBand(`Weak point ${out.revealed}`, 'crit'), delay);
      delay += 1300;
    }
    if (out.phaseChanged && !run.over) {
      sfx.phase();
      setTimeout(() => {
        eventBand(`Phase ${out.phase}`, 'phase');
        say(out.phase === 2 ? boss.lines.phase2 : boss.lines.phase3);
      }, delay);
    }
    feedback(q, correct, out, detail);
  }

  function feedback(q, correct, out, detail) {
    let review = '';
    if (q.choices) {
      const order = current.order || q.choices.map((_, i) => i);
      review = `<ul class="review">${order.map(oi => {
        const ch = q.choices[oi], right = oi === q.answer, picked = oi === detail.pick;
        const cls = right ? 'right' : picked ? 'wrong' : '';
        return `<li><span class="mark ${cls}" aria-label="${right ? 'Correct answer' : picked ? 'Your answer' : 'Other option'}">${right ? '✓' : picked ? '✗' : ''}</span>
          <span><b>${esc(ch.t)}</b>${right ? '' : `<span class="why">${esc(ch.why)}</span>`}</span></li>`;
      }).join('')}</ul>`;
    } else if (q.type === 'output') {
      const marks = {};
      q.answer.forEach(i => { marks[i] = 'right'; });
      const wrongPick = detail.pick !== undefined && detail.pick !== null && !q.answer.includes(detail.pick);
      if (wrongPick) marks[detail.pick] = 'wrong';
      const why = wrongPick && q.lineWhy && q.lineWhy[detail.pick];
      review = terminal(q, { marks }) + (why ? `<p class="small dim"><b>The line you flagged:</b> ${esc(why)}</p>` : '');
    } else if (q.type === 'calc') {
      review = `<p class="calc-review"><span>You typed <code>${esc(detail.typed !== undefined ? detail.typed : 'nothing')}</code></span><span>Answer <code>${esc(q.answer)}</code></span></p>`;
    } else if (q.type === 'order') {
      const seq = detail.seq || [];
      review = `<ul class="review">${q.items.map((it, n) => {
        const ok = seq[n] === n, cls = detail.timeout ? '' : ok ? 'right' : 'wrong';
        return `<li><span class="mark ${cls}">${n + 1}</span><span><b>${esc(it)}</b>${!ok && seq[n] !== undefined ? `<span class="why">You placed: ${esc(q.items[seq[n]])}</span>` : ''}</span></li>`;
      }).join('')}</ul>`;
    }

    const canReload = !correct && !run.practice && run.items.reload > 0 && run.undo && !run.over;
    const band = correct
      ? `<span class="state ${out.crit ? 'crit' : 'up'}">${out.crit ? 'Critical hit' : 'Link up'}</span><span class="result-meta">${out.damage} damage.${run.streak > 1 ? ` Your next hit does ×${run.mult.toFixed(1)}.` : ''}</span>`
      : `<span class="state down">${detail.timeout ? 'Out of time' : 'Link down'}</span><span class="result-meta">${run.practice ? 'Practice, so no uptime lost.' : `Uptime ${fmtUptime(run.nines)}.`} It returns as an aftershock.</span>`;
    $('#console').innerHTML = `
      <div class="result-band">${band}</div>
      <p class="prompt-text small">${esc(q.prompt)}</p>
      ${review}
      <p class="explain"><b>Why:</b> ${esc(q.explain)}</p>
      <div class="row">
        <button class="btn primary" id="next">${run.over ? 'Full time' : 'Continue'}</button>
        ${canReload ? `<button class="btn" id="reload">Undo miss (Reload ×${run.items.reload})</button>` : ''}
      </div>`;
    $('#console').scrollTop = 0;
    $('#next').focus({ preventScroll: true });
    $('#next').addEventListener('click', () => run.over ? results() : choose());
    if (canReload) $('#reload').addEventListener('click', doReload);
    setPrompts(canReload ? [['↵', run.over ? 'Full time' : 'Continue'], ['R', 'Undo miss']] : [['↵', run.over ? 'Full time' : 'Continue']]);
  }
  function doReload() {
    // A reloaded miss still counts in long-term mastery; only the in-match cost is rolled back.
    if (!current || !run.reload()) return;
    sfx.relay(); hud();
    ask({ q: current.q, aftershock: current.aftershock }, true);
  }

  /* ================================================================
     FULL TIME
     ================================================================ */
  function results() {
    const s = run.summary();
    const practice = run.practice;
    if (!practice) {
      const prev = progress.best[boss.id];
      if (!prev || (s.won && (!prev.won || s.nines > prev.nines))) progress.best[boss.id] = { won: s.won, uptime: s.uptime, nines: s.nines };
      save();
    }
    const dealt = run.maxHP - Math.max(0, run.hp);
    const keptPct = Math.round((s.nines - FLOOR_NINES) / (START_NINES - FLOOR_NINES) * 100);
    const fact = (name, l, lsub, r, rsub, lv, rv) => {
      const total = (lv + rv) || 1;
      return `<div class="fact"><span class="fact-name">${name}</span>
        <span class="fact-l">${l}<small>${lsub}</small></span>
        <span class="fact-bar" aria-hidden="true"><span style="flex:${lv / total}"></span><span style="flex:${rv / total}"></span></span>
        <span class="fact-r">${r}<small>${rsub}</small></span></div>`;
    };
    const single = (name, l, lsub, frac, r, rsub) => `<div class="fact single"><span class="fact-name">${name}</span>
        <span class="fact-l">${l}<small>${lsub}</small></span>
        <span class="fact-bar" aria-hidden="true"><span style="flex:${frac}"></span><span style="flex:${1 - frac}"></span></span>
        <span class="fact-r">${r}<small>${rsub}</small></span></div>`;
    // Ratings for this match only, through the same badge rules as the Mastery screen.
    const perObj = {};
    run.log.forEach(l => { const m = perObj[l.obj] || (perObj[l.obj] = { a: 0, c: 0, recent: [] }); m.a++; if (l.correct) m.c++; m.recent.push(l.correct ? 1 : 0); });
    const objRows = Object.entries(perObj).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([o, m]) => `<li>${badge(m)}<span>${o} ${esc(objName(o))}</span><span class="num muted">${masteryRating(m) !== null ? `${m.c}/${m.a}` : ''}</span></li>`).join('');
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
        <div class="ft-head">
          <div class="scoreboard" role="group" aria-label="Final score">
            <div class="sb-cell you"><span class="sb-code">NOC</span><span class="sb-val">${s.uptime.replace('%', '')}</span></div>
            <div class="sb-cell sb-mid"><span class="sb-small">${practice ? 'Practice' : s.won ? 'Won' : 'Lost'}</span><span class="sb-clock">FT</span></div>
            <div class="sb-cell boss"><span class="sb-val">${Math.max(0, run.hp)}</span><span class="sb-code">${BOSS_CODE[boss.id]}</span></div>
          </div>
          <h1>${s.won ? 'Boss down' : practice ? 'Practice over' : 'SLA breached'}</h1>
          <p class="boss-line"><b>${esc(boss.name)}</b>${esc(s.won ? boss.lines.win : boss.lines.lose)}</p>
        </div>
        <div class="facts">
          <h3>Match facts</h3>
          ${fact('Answers', s.correct, 'Right', s.answered - s.correct, 'Wrong', s.correct, s.answered - s.correct)}
          ${fact('Boss HP', dealt, 'Dealt', Math.max(0, run.hp), 'Left', dealt, Math.max(0, run.hp))}
          ${practice ? '' : fact('Uptime budget', `${keptPct}%`, 'Kept', `${100 - keptPct}%`, 'Spent', keptPct, 100 - keptPct)}
          ${fact('Hits', s.crits, 'Critical', s.correct - s.crits, 'Normal', s.crits, s.correct - s.crits)}
          ${single('Accuracy', `${Math.round(s.accuracy * 100)}%`, `${s.correct} of ${s.answered}`, s.accuracy, '', '')}
          ${single('Best streak', s.maxStreak, 'In a row', s.answered ? s.maxStreak / s.answered : 0, '', '')}
        </div>
        <div class="ratings">
          <h3>Ratings by topic</h3>
          <ul class="rating-list">${objRows}</ul>
          <h3 class="missed-head">Missed questions</h3>
          ${missed ? `${missed}<p class="small dim pad-top">These come up first in your next match.</p>` : '<p class="dim">No misses this match.</p>'}
        </div>
        <div class="ft-actions">
          <button class="btn primary big" id="again">${practice ? 'Practice again' : 'Rematch'}</button>
          <button class="btn" id="other">${practice ? 'Boss match' : 'Practice'}</button>
          <button class="btn" id="m">Mastery</button>
          <button class="btn text" id="r">Home</button>
        </div>
      </section>`,
      [['↵', practice ? 'Practice again' : 'Rematch'], ['Esc', 'Home']]);
    setTab('match');
    $('#again').addEventListener('click', () => battle(boss.id, practice ? 'practice' : 'run'));
    $('#other').addEventListener('click', () => setup(boss.id, practice ? 'run' : 'practice'));
    $('#m').addEventListener('click', mastery);
    $('#r').addEventListener('click', home);
    $('#again').focus({ preventScroll: true });
  }

  /* ================================================================
     MASTERY
     ================================================================ */
  function mastery() {
    const all = allObjectives();
    const ovr = groupRating(all);
    const tested = all.filter(o => progress.mastery[o.id] && progress.mastery[o.id].a).length;
    const solid = all.filter(o => masteryState(progress.mastery[o.id]) === 'up').length;
    const wins = Object.values(progress.best).filter(b => b.won).length;
    const objRow = o => {
      const m = progress.mastery[o.id];
      return `<li><span class="oid">${o.id}</span><span>${esc(o.name)}</span><span class="ocount">${masteryRating(m) !== null ? `${m.c}/${m.a}` : ''}</span>${badge(m)}</li>`;
    };
    const live = DATA.blueprint.domains.filter(d => DATA.bosses.some(b => b.domain === d.id && b.available));
    const locked = DATA.blueprint.domains.filter(d => !live.includes(d));
    const domBadge = d => { const r = groupRating(d.objectives); return `<span class="rbadge ${ratingState(r)}" role="img" aria-label="${r === null ? 'Not rated yet' : `Domain rating ${r}`}">${r === null ? '' : r}</span>`; };
    show('mastery', `
      <section class="attr">
        <div class="attr-side">
          <span class="ccard static ${ovr === null ? 'locked' : ovr >= 80 ? 'gold' : ovr >= 50 ? 'silver' : 'bronze'}" role="img" aria-label="Overall rating ${ovr === null ? 'not rated yet' : ovr}">
            <span class="cc-face">
              <span class="cc-top"><span class="cc-rating">${ovr === null ? 'NR' : ovr}</span><span class="cc-unit">OVR</span></span>
              <span class="cc-art"><span class="crest">NOC</span></span>
              <span class="cc-name">On-call</span>
              <span class="cc-stats"><span><b>${tested}</b>TST</span><span><b>${solid}</b>SLD</span><span><b>${wins}</b>WIN</span></span>
            </span>
          </span>
          <div>
            <p class="pad-bottom">Each topic is rated 0 to 99 from your last eight answers on it. Below ${MIN_SAMPLE} answers it shows your count instead.</p>
            <div class="legend">
              <span class="rbadge up">80</span><span>Solid: 80 or more</span>
              <span class="rbadge degraded">50</span><span>Shaky: 50 to 79</span>
              <span class="rbadge down">30</span><span>Needs work: under 50</span>
              <span class="rbadge few">1/2</span><span>Fewer than ${MIN_SAMPLE} answers</span>
              <span class="rbadge none"></span><span>Not tested</span>
            </div>
          </div>
        </div>
        <div>
          ${live.map(d => {
            const b = DATA.bosses.find(x => x.domain === d.id);
            return `<section class="dom-live">
              <div class="dom-head"><div><h2>${d.id} ${esc(d.name)}</h2><p>${d.weight}% of the exam. Boss: ${esc(b.name)}.</p></div>${domBadge(d)}</div>
              <ul class="obj-list">${d.objectives.map(objRow).join('')}</ul>
            </section>`;
          }).join('')}
          <section class="dom-more">
            <h3>Other domains</h3>
            ${locked.map(d => {
              const b = DATA.bosses.find(x => x.domain === d.id);
              return `<details class="dom-row"><summary><span class="oid">${d.id}</span><span class="dname">${esc(d.name)}</span><span class="small dim">${d.weight}%${b ? `, ${esc(b.name)}` : ''}</span><span class="lock">Locked</span></summary>
                <ul class="obj-list">${d.objectives.map(objRow).join('')}</ul></details>`;
            }).join('')}
          </section>
          <div class="reset-row"><button class="btn text" id="reset">Reset progress</button>
            <span id="reset-confirm" hidden>Erase ratings, weak points and best results? <button class="btn" id="reset-yes">Erase</button> <button class="btn text" id="reset-no">Keep</button></span></div>
        </div>
      </section>`,
      [[['Q', 'E'], 'Tabs'], ['Esc', 'Back']]);
    setTab('mastery');
    $('#reset').addEventListener('click', () => { $('#reset-confirm').hidden = false; $('#reset-no').focus({ preventScroll: true }); });
    $('#reset-no').addEventListener('click', () => { $('#reset-confirm').hidden = true; });
    $('#reset-yes').addEventListener('click', () => { const snd = progress.sound; progress = blank(); progress.sound = snd; save(); mastery(); });
  }

  /* ---------- keyboard: controller-style ---------- */
  const LIST_GROUPS = ['.choice', '.pool-item, .seq-item', 'button.tline', 'button.rule, #kickoff, #back', '.tile', '#console .ccard', '.roster button.ccard'];
  function moveFocus(dir) {
    const a = document.activeElement;
    const group = a && LIST_GROUPS.find(g => a.matches(g));
    if (!group) {
      const first = $(`#qbody .choice:not(:disabled), #qbody .pool-item, #qbody button.tline, #console .ccard`);
      if (first) { first.focus({ preventScroll: false }); return true; }
      return false;
    }
    const els = $$(group).filter(e => !e.disabled);
    const i = els.indexOf(a);
    const next = els[Math.max(0, Math.min(els.length - 1, i + dir))];
    if (next) next.focus();
    return true;
  }
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
    if (scr === 'setup' && (k === 'ArrowLeft' || k === 'ArrowRight')) { $('#mode').click(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp') { if (moveFocus(k === 'ArrowDown' ? 1 : -1)) e.preventDefault(); return; }
    if (scr !== 'battle') return;
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && document.activeElement && document.activeElement.matches('#console .ccard')) { moveFocus(k === 'ArrowRight' ? 1 : -1); e.preventDefault(); return; }
    if (/^[1-3]$/.test(k)) { const card = $$('#console .ccard')[+k - 1]; if (card) { card.click(); e.preventDefault(); return; } }
    if (/^[a-dA-D]$/.test(k)) { const ch = $$('.choice')['abcd'.indexOf(k.toLowerCase())]; if (ch && !ch.disabled) { ch.click(); e.preventDefault(); return; } }
    if (k === 'x' || k === 'X') { usePcap(); e.preventDefault(); }
    else if (k === 'h' || k === 'H') { useTac(); e.preventDefault(); }
    else if ((k === 'r' || k === 'R') && $('#reload')) { doReload(); e.preventDefault(); }
    else if (k === 'f' || k === 'F') { flag(); e.preventDefault(); }
    else if (k === 'l' || k === 'L') { lockIn(); e.preventDefault(); }
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
    screen.innerHTML = `<section class="notice"><h1>Couldn't load the questions</h1>
      <p class="dim">Browsers block the question files when the game is opened straight from disk. Serve the folder instead:</p>
      <pre class="term">  cd last-hop && python3 -m http.server 8000</pre><p class="dim">Then open http://localhost:8000.</p>
      <p class="small muted">${esc(err.message)}</p></section>`;
  });
})();
