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

  /* ---------- top bar ---------- */
  function syncSound() {
    const b = $('#sound');
    b.setAttribute('aria-pressed', LHAudio.enabled);
    b.textContent = LHAudio.enabled ? 'Sound on' : 'Sound off';
  }
  $('#sound').addEventListener('click', () => {
    progress.sound = LHAudio.setEnabled(!LHAudio.enabled); save(); syncSound();
  });
  $('#home').addEventListener('click', e => { e.preventDefault(); stopTimer(); menu(); });

  /* ================================================================
     MENU
     ================================================================ */
  function menu() {
    document.body.dataset.screen = 'menu';
    const bosses = DATA.bosses;
    const maxW = 25;
    const tiles = bosses.map(b => {
      const dom = DATA.blueprint.domains.find(d => d.id === b.domain);
      const best = progress.best[b.id];
      return `
      <button class="boss-tile ${b.available ? '' : 'locked'} ${b.domain === 'all' ? 'final' : ''}" data-boss="${b.id}" ${b.available ? '' : 'aria-disabled="true"'}>
        <span class="bt-domain">${b.domain === 'all' ? 'FINAL · ALL DOMAINS' : esc(b.domain + ' ' + (dom ? dom.name : ''))}</span>
        <span class="bt-name">${esc(b.name)}</span>
        <span class="bt-theme">${esc(b.theme)}</span>
        ${b.weight ? `<span class="bt-hp" aria-label="Blueprint weight ${b.weight}%"><span style="width:${(b.weight / maxW) * 100}%"></span></span>
        <span class="bt-weight">${b.weight}% of exam · ${b.weight * LH.HP_PER_WEIGHT} HP</span>` : '<span class="bt-weight">Adaptive</span>'}
        <span class="bt-status">${b.available ? (best ? (best.won ? `Defeated · best ${best.uptime}` : 'Attempted') : 'Ready') : 'Locked: question bank in progress'}</span>
      </button>`;
    }).join('');

    screen.innerHTML = `
      <section class="menu">
        <div class="menu-head">
          <p class="eyebrow">NOC · P1 incident · all hands</p>
          <h1>The backbone is failing.</h1>
          <p class="lede">You're the on-call engineer. Each boss is a failure mode that has taken over part of the network, one per CCNA 200-301 domain, with health sized to its exam weight. Right answers repair links. Wrong ones cost you nines.</p>
        </div>
        <div class="roster">${tiles}</div>
        <div class="menu-foot">
          <button class="btn ghost" id="to-mastery">Mastery map</button>
          <button class="btn ghost" disabled title="Unlocks when all six domain banks are written">Exam mode · 100 questions / 120 min (locked)</button>
          <p class="fine">Weights follow CCNA 200-301 ${esc(DATA.blueprint.version)}. Check Cisco's current exam topics before you rely on them.</p>
        </div>
      </section>`;
    $$('.boss-tile:not(.locked)').forEach(t => t.addEventListener('click', () => bossBrief(t.dataset.boss)));
    $('#to-mastery').addEventListener('click', mastery);
  }

  function bossBrief(id) {
    const b = DATA.bosses.find(x => x.id === id);
    const bank = DATA.banks[id];
    const rev = progress.revealed[id] || [];
    const counts = {};
    bank.forEach(q => { counts[q.type] = (counts[q.type] || 0) + 1; });
    screen.innerHTML = `
      <section class="brief">
        <button class="btn ghost back" id="back">← Roster</button>
        <p class="eyebrow">${esc(b.domain)} · ${b.weight}% of exam</p>
        <h1>${esc(b.name)}</h1>
        <blockquote>“${esc(b.lines.intro)}”</blockquote>
        <div class="brief-grid">
          <div>
            <h3>How the fight works</h3>
            <ul class="rules">
              <li><b>Pick an attack vector.</b> Each turn offers up to three questions. Heavier question types hit harder.</li>
              <li><b>Phases.</b> At 66% the questions get harder. At 33% a clock starts.</li>
              <li><b>Weak points.</b> ${b.weakPoints.length} hidden objectives deal critical damage. Land a hit to expose one.</li>
              <li><b>Uptime is your health.</b> Every miss costs half a nine. Below 90.000% the SLA is breached.</li>
              <li><b>Aftershocks.</b> Anything you miss comes back a few questions later.</li>
              <li><b>Convergence.</b> Consecutive right answers stack a damage multiplier up to ×2.0. A miss resets it.</li>
            </ul>
          </div>
          <div>
            <h3>Damage by question type</h3>
            <table class="dmg">
              ${Object.entries(TYPES).map(([k, t]) => `<tr><td>${t.label}</td><td>${t.tier}</td><td class="num">${counts[k] || 0} in bank</td></tr>`).join('')}
            </table>
            <h3>Weak points</h3>
            <div class="wp-list">${b.weakPoints.map(w => rev.includes(w)
              ? `<span class="wp found">${w} ${esc(objName(w))}</span>`
              : '<span class="wp">??? not yet exposed</span>').join('')}</div>
          </div>
        </div>
        <div class="brief-actions">
          <button class="btn primary" id="go-run">Start run</button>
          <button class="btn" id="go-practice">Practice: hints free, no clock, no uptime loss</button>
        </div>
      </section>`;
    $('#back').addEventListener('click', menu);
    $('#go-run').addEventListener('click', () => battle(id, 'run'));
    $('#go-practice').addEventListener('click', () => battle(id, 'practice'));
  }

  /* ================================================================
     BATTLE
     ================================================================ */
  let run, boss, current, timer = null, deadline = 0, eliminated = new Set(), hintShown = null;

  function battle(id, mode) {
    boss = DATA.bosses.find(x => x.id === id);
    run = new Run({ boss, questions: DATA.banks[id], mode, srs: progress.srs, revealed: progress.revealed[id] || [] });
    document.body.dataset.screen = 'battle';
    screen.innerHTML = `
      <section class="battle">
        <div class="hud">
          <div class="hud-uptime">
            <span class="label">Uptime${run.practice ? ' · practice' : ''}</span>
            <span class="uptime-val num" id="uptime"></span>
            <span class="nines" id="nines" aria-hidden="true"></span>
          </div>
          <div class="hud-streak">
            <span class="label">Convergence</span>
            <span class="num" id="mult"></span>
            <span class="sub" id="streak"></span>
          </div>
          <div class="hud-items" id="items"></div>
          <div class="hud-timer" id="timer" hidden><span class="label">Clock</span><span class="num" id="timer-val"></span></div>
        </div>
        <div class="arena-wrap">
          <svg id="arena" role="img" aria-label="Network topology. Your network on the left, the boss's corrupted side on the right."></svg>
          <div class="boss-panel">
            <div class="bp-row"><span class="bp-name">${esc(boss.name)}</span><span class="bp-phase" id="phase"></span></div>
            <div class="hpbar" role="progressbar" aria-label="Boss health" id="hpbar"><span class="hp-fill" id="hpfill"></span><i style="left:33.3%"></i><i style="left:66.6%"></i></div>
            <div class="bp-row small"><span class="num" id="hptext"></span><span id="wps"></span></div>
          </div>
          <div class="banner" id="banner" hidden></div>
          <div class="floaters" id="floaters" aria-live="polite"></div>
        </div>
        <div class="console" id="console"></div>
      </section>`;
    LHArena.mount($('#arena'));
    hud();
    say(boss.lines.intro, 3200);
    choose();
  }

  function hud() {
    $('#uptime').textContent = fmtUptime(run.nines);
    const n = $('#nines');
    n.innerHTML = Array.from({ length: START_NINES - FLOOR_NINES }, (_, i) => {
      const lvl = run.nines - FLOOR_NINES - i;
      return `<i class="${lvl >= 1 ? 'up' : lvl > 0 ? 'deg' : 'down'}"></i>`;
    }).join('');
    $('#mult').textContent = '×' + run.mult.toFixed(1);
    $('#streak').textContent = run.streak ? `${run.streak} in a row` : 'no streak';
    const pct = Math.max(0, run.hpFrac * 100);
    $('#hpfill').style.width = pct + '%';
    $('#hpbar').setAttribute('aria-valuenow', Math.round(pct));
    $('#hptext').textContent = `${Math.max(0, run.hp)} / ${run.maxHP} HP`;
    $('#phase').textContent = `Phase ${run.phase}${run.timed ? ' · on the clock' : ''}`;
    $('#wps').innerHTML = boss.weakPoints.map(w => run.revealed.has(w)
      ? `<span class="wp-chip found" title="${esc(objName(w))}">${w}</span>`
      : '<span class="wp-chip">?</span>').join('');
    const it = run.items, inf = v => v === Infinity ? '∞' : v;
    $('#items').innerHTML = `
      <span class="label">Items</span>
      <button class="item" id="it-pcap" ${it.pcap > 0 ? '' : 'disabled'} title="Eliminate wrong options">Packet Capture <b>${inf(it.pcap)}</b></button>
      <button class="item" id="it-tac" ${it.tac > 0 ? '' : 'disabled'} title="${run.practice ? 'Free in practice' : 'Costs 0.2 nines, and time on the clock'}">TAC Case <b>${inf(it.tac)}</b></button>
      <span class="item static" title="Undo one wrong answer. Offered right after a miss.">Reload in 5 <b>${run.practice ? '-' : it.reload}</b></span>`;
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

  function floater(text, cls) {
    const f = document.createElement('span');
    f.className = 'floater ' + cls;
    f.textContent = text;
    $('#floaters').appendChild(f);
    setTimeout(() => f.remove(), 1600);
  }

  const diffPips = d => '<span class="pips">' + [1, 2, 3].map(i => `<i class="${i <= d ? 'on' : ''}"></i>`).join('') + '</span>';

  /* ---------- choose an attack vector ---------- */
  function choose() {
    stopTimer();
    current = null;
    if (run.over) return results();
    const cards = run.draw();
    const c = $('#console');
    const forced = cards[0].aftershock;
    c.innerHTML = `
      <div class="con-head"><span>${forced ? 'Aftershock' : 'Select attack vector'}</span><span class="dim">turn ${run.turn + 1}</span></div>
      ${forced ? '<p class="note">You missed this one earlier. It came back, and you have to clear it.</p>' : ''}
      <div class="cards">${cards.map((k, i) => {
        const q = k.q, t = TYPES[q.type], weak = run.isWeak(q) && run.revealed.has(q.obj);
        return `<button class="card ${weak ? 'weak' : ''} ${k.aftershock ? 'after' : ''}" data-i="${i}">
          <span class="card-top"><span class="key">${i + 1}</span><span class="obj">${q.obj} ${esc(objName(q.obj))}</span></span>
          <span class="card-title">${esc(q.title)}</span>
          <span class="card-meta"><span>${t.label}</span><span>${t.tier} damage</span>${diffPips(q.diff)}</span>
          ${weak ? '<span class="card-weak">Weak point · critical</span>' : ''}
        </button>`;
      }).join('')}</div>`;
    $$('.card', c).forEach(b => b.addEventListener('click', () => { sfx.select(); ask(cards[+b.dataset.i]); }));
    c.scrollTop = 0;
    $('.card', c).focus({ preventScroll: true });
  }

  /* ---------- ask ---------- */
  function ask(card, retry) {
    current = { ...card, order: null, picked: null, seq: [] };
    eliminated = new Set();
    hintShown = null;
    const q = card.q, t = TYPES[q.type];
    const c = $('#console');
    c.innerHTML = `
      <div class="con-head"><span>${q.obj} · ${t.label}${card.aftershock ? ' · aftershock' : ''}${retry ? ' · reloaded' : ''}</span>${diffPips(q.diff)}</div>
      <p class="prompt">${esc(q.prompt)}</p>
      <div id="qbody"></div>
      <div id="hint" class="hint" hidden></div>`;
    renderBody();
    const limit = run.timeLimit(q);
    if (limit) startTimer(limit); else stopTimer();
    c.scrollTop = 0;
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
        `<div class="row"><button class="btn primary" id="flag" disabled>Flag this line</button><span class="dim small">Click the line that proves the fault, then flag it.</span></div>`;
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
        <p class="dim small" id="calc-msg">No multiple choice. Type it exactly.</p>`;
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
          return i === undefined ? `<li class="slot empty"><span class="key">${n + 1}</span><span class="dim">empty</span></li>`
            : `<li class="slot"><button class="seq-item" data-i="${i}"><span class="key">${n + 1}</span><span>${esc(q.items[i])}</span></button></li>`;
        }).join('')}</ol>
        <div class="pool">${current.pool.filter(i => !placed.has(i)).map(i =>
          `<button class="pool-item" data-i="${i}">${esc(q.items[i])}</button>`).join('')}</div>
        <div class="row"><button class="btn primary" id="commit" ${current.seq.length === q.items.length ? '' : 'disabled'}>Commit order</button>
        <span class="dim small">Click steps in order. Click a placed step to take it back.</span></div>`;
      $$('.pool-item', body).forEach(b => b.addEventListener('click', () => { current.seq.push(+b.dataset.i); sfx.select(); renderBody(); }));
      $$('.seq-item', body).forEach(b => b.addEventListener('click', () => { current.seq = current.seq.filter(x => x !== +b.dataset.i); renderBody(); }));
      $('#commit').addEventListener('click', () => submit(current.seq.every((v, n) => v === n), { seq: current.seq.slice() }));
    }
    if (hintShown) { const h = $('#hint'); h.hidden = false; h.innerHTML = `<b>TAC:</b> ${esc(hintShown)}`; }
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
    if (!current || $('#qbody') === null || current.done) return;
    const q = current.q;
    if (!(q.choices || q.type === 'output')) { flash('Packet Capture only works on multiple-choice and output questions.'); return; }
    const out = run.capture(q);
    if (!out) return;
    out.forEach(i => eliminated.add(i));
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
  function flash(msg) {
    const h = $('#hint'); if (!h) return;
    h.hidden = false; h.textContent = msg;
  }

  /* ---------- timer (phase 3) ---------- */
  function startTimer(sec) {
    stopTimer();
    deadline = Date.now() + sec * 1000;
    $('#timer').hidden = false;
    let lastWhole = sec + 1;
    timer = setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      const whole = Math.ceil(left / 1000);
      $('#timer-val').textContent = whole + 's';
      $('#timer').classList.toggle('low', whole <= 5);
      if (whole !== lastWhole && whole <= 5 && whole > 0) sfx.tick();
      lastWhole = whole;
      if (left <= 0) { stopTimer(); submit(false, { timeout: true }); }
    }, 200);
    $('#timer-val').textContent = sec + 's';
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    const t = $('#timer'); if (t) t.hidden = true;
  }

  /* ---------- resolve an answer ---------- */
  function submit(correct, detail) {
    if (!current || current.done) return;
    current.done = true;
    stopTimer();
    const q = current.q;
    const out = run.answer(q, correct, { aftershock: current.aftershock, timeout: detail.timeout });
    recordResult(progress, q, correct);
    if (out.revealed) {
      progress.revealed[boss.id] = [...new Set([...(progress.revealed[boss.id] || []), out.revealed])];
    }
    save();

    if (correct) {
      out.crit ? sfx.crit() : sfx.relay();
      LHArena.hit(out.crit);
      floater((out.crit ? 'CRITICAL −' : '−') + out.damage, out.crit ? 'crit' : 'dmg');
    } else {
      if (!run.practice) sfx.alarm();
      LHArena.taunt();
      floater(run.practice ? 'miss' : `−${out.uptimeLost} nines`, 'hurt');
    }
    hud();
    if (out.revealed) setTimeout(() => say(`${boss.lines.crit} Weak point exposed: ${out.revealed} ${objName(out.revealed)}.`, 3000, 'crit'), 300);
    if (out.phaseChanged && !run.over) {
      sfx.phase();
      setTimeout(() => say(out.phase === 2 ? boss.lines.phase2 : boss.lines.phase3, 3600, 'phase'), out.revealed ? 3200 : 400);
    }
    feedback(q, correct, out, detail);
  }

  function feedback(q, correct, out, detail) {
    const c = $('#console');
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
      if (detail.pick !== undefined && detail.pick !== null && !q.answer.includes(detail.pick)) marks[detail.pick] = 'wrong';
      const why = detail.pick !== undefined && detail.pick !== null && !q.answer.includes(detail.pick) && q.lineWhy && q.lineWhy[detail.pick];
      review = terminal(q, { marks }) + (why ? `<p class="why-line"><b>The line you flagged:</b> ${esc(why)}</p>` : '');
    } else if (q.type === 'calc') {
      review = `<div class="calc-review"><span>You typed <code>${esc(detail.typed !== undefined ? detail.typed : '(nothing)')}</code></span><span>Answer <code>${esc(q.answer)}</code></span></div>`;
    } else if (q.type === 'order') {
      const seq = detail.seq || [];
      review = `<ol class="order-review">${q.items.map((it, n) => {
        const ok = seq[n] === n;
        return `<li class="${detail.timeout ? '' : ok ? 'right' : 'wrong'}"><span>${esc(it)}</span>${!ok && seq[n] !== undefined ? `<span class="why">You placed: ${esc(q.items[seq[n]])}</span>` : ''}</li>`;
      }).join('')}</ol>`;
    }

    const canReload = !correct && !run.practice && run.items.reload > 0 && run.undo && !run.over;
    const head = correct
      ? `<span class="state up">Link up</span><span>${out.crit ? 'Critical hit' : 'Repair landed'} · ${out.damage} damage${run.streak > 1 ? ` · ×${run.mult.toFixed(1)} next` : ''}</span>`
      : `<span class="state down">Link down</span><span>${detail.timeout ? 'Out of time' : 'Wrong'}${run.practice ? '' : ` · uptime ${fmtUptime(run.nines)}`} · comes back as an aftershock</span>`;
    c.innerHTML = `
      <div class="con-head result ${correct ? 'ok' : 'bad'}">${head}</div>
      <p class="prompt small">${esc(q.prompt)}</p>
      ${review}
      <div class="explain"><b>Why</b> ${esc(q.explain)}</div>
      <div class="row">
        <button class="btn primary" id="next">${run.over ? 'See results' : 'Continue'}</button>
        ${canReload ? `<button class="btn" id="reload">Reload in 5: undo this miss and retry</button>` : ''}
      </div>`;
    c.scrollTop = 0;
    $('#next').focus({ preventScroll: true });
    $('#next').addEventListener('click', () => run.over ? results() : choose());
    if (canReload) $('#reload').addEventListener('click', () => {
      // A reloaded miss still counts in long-term mastery; only the in-run cost is rolled back.
      if (run.reload()) {
        sfx.relay(); hud();
        ask({ q, aftershock: current.aftershock }, true);
      }
    });
  }

  /* ================================================================
     RESULTS
     ================================================================ */
  function results() {
    stopTimer();
    document.body.dataset.screen = 'results';
    const s = run.summary();
    if (!run.practice) {
      const prev = progress.best[boss.id];
      if (!prev || (s.won && (!prev.won || s.nines > prev.nines))) progress.best[boss.id] = { won: s.won, uptime: s.uptime, nines: s.nines };
      save();
    }
    const objRows = Object.entries(s.byObj).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([o, v]) => `<li><span class="chip ${v.c === v.a ? 'up' : v.c ? 'deg' : 'down'}"></span><span>${o} ${esc(objName(o))}</span><span class="num">${v.c}/${v.a}</span></li>`).join('');
    const missed = s.missed.map(id => run.byId[id]).map(q => `
      <details class="missed"><summary><span class="obj">${q.obj}</span> ${esc(q.title)}</summary>
        <p>${esc(q.prompt)}</p>
        ${q.type === 'calc' ? `<p>Answer: <code>${esc(q.answer)}</code></p>` : ''}
        ${q.choices ? `<p>Answer: <b>${esc(q.choices[q.answer].t)}</b></p>` : ''}
        ${q.type === 'order' ? `<ol>${q.items.map(i => `<li>${esc(i)}</li>`).join('')}</ol>` : ''}
        ${q.type === 'output' ? `<p>Answer: <code>${esc(q.terminal.lines[q.answer[0]].trim())}</code></p>` : ''}
        <p class="dim">${esc(q.explain)}</p>
      </details>`).join('');

    screen.innerHTML = `
      <section class="results">
        <p class="eyebrow">${run.practice ? 'Practice' : 'Run'} complete · ${esc(boss.name)}</p>
        <h1 class="${s.won ? 'won' : 'lost'}">${s.won ? 'Boss down. Backbone restored.' : 'SLA breached.'}</h1>
        <blockquote>“${esc(s.won ? boss.lines.win : boss.lines.lose)}”</blockquote>
        <dl class="stats">
          <div><dt>Final uptime</dt><dd class="num">${run.practice ? 'n/a' : s.uptime}</dd></div>
          <div><dt>Accuracy</dt><dd class="num">${Math.round(s.accuracy * 100)}%<small> ${s.correct}/${s.answered}</small></dd></div>
          <div><dt>Best streak</dt><dd class="num">${s.maxStreak}</dd></div>
          <div><dt>Critical hits</dt><dd class="num">${s.crits}</dd></div>
          <div><dt>Boss HP left</dt><dd class="num">${Math.max(0, run.hp)}/${run.maxHP}</dd></div>
        </dl>
        <div class="res-grid">
          <div><h3>By objective, this run</h3><ul class="obj-list">${objRows}</ul></div>
          <div><h3>Review what you missed</h3>${missed || '<p class="dim">Nothing missed. Clean run.</p>'}
            <p class="dim small">Missed questions are weighted to come up first in your next run.</p></div>
        </div>
        <div class="row">
          <button class="btn primary" id="again">Run it again</button>
          <button class="btn" id="practice">Practice mode</button>
          <button class="btn ghost" id="m">Mastery map</button>
          <button class="btn ghost" id="r">Roster</button>
        </div>
      </section>`;
    $('#again').addEventListener('click', () => battle(boss.id, 'run'));
    $('#practice').addEventListener('click', () => battle(boss.id, 'practice'));
    $('#m').addEventListener('click', mastery);
    $('#r').addEventListener('click', menu);
  }

  /* ================================================================
     MASTERY MAP
     ================================================================ */
  function mastery() {
    stopTimer();
    document.body.dataset.screen = 'mastery';
    const label = { none: 'untested', down: 'weak', degraded: 'shaky', up: 'solid' };
    const cols = DATA.blueprint.domains.map(d => {
      const bossFor = DATA.bosses.find(b => b.domain === d.id);
      const live = bossFor && bossFor.available;
      return `<section class="dom ${live ? '' : 'locked'}">
        <h3><span>${d.id} ${esc(d.name)}</span><span class="num">${d.weight}%</span></h3>
        <p class="dim small">${esc(bossFor ? bossFor.name : '')}${live ? '' : ' · bank not written yet'}</p>
        <ul>${d.objectives.map(o => {
          const m = progress.mastery[o.id], st = masteryState(m);
          return `<li><span class="chip ${st}" title="${label[st]}"></span><span class="oid">${o.id}</span><span class="oname">${esc(o.name)}</span><span class="num dim">${m ? `${m.c}/${m.a}` : ''}</span></li>`;
        }).join('')}</ul></section>`;
    }).join('');
    screen.innerHTML = `
      <section class="mastery">
        <button class="btn ghost back" id="back">← Roster</button>
        <h1>Mastery map</h1>
        <p class="lede">Every blueprint objective, colored by your last eight answers on it. Green is 80% or better over at least three answers. Amber is 50% or better. Red is below that.</p>
        <div class="legend"><span><i class="chip up"></i>solid</span><span><i class="chip degraded"></i>shaky</span><span><i class="chip down"></i>weak</span><span><i class="chip none"></i>untested</span></div>
        <div class="doms">${cols}</div>
        <div class="row"><button class="btn ghost" id="reset">Reset all progress</button><span id="reset-confirm" hidden> Erase mastery, weak points and best runs? <button class="btn" id="reset-yes">Erase</button> <button class="btn ghost" id="reset-no">Keep</button></span></div>
      </section>`;
    $('#back').addEventListener('click', menu);
    $('#reset').addEventListener('click', () => { $('#reset-confirm').hidden = false; });
    $('#reset-no').addEventListener('click', () => { $('#reset-confirm').hidden = true; });
    $('#reset-yes').addEventListener('click', () => { const s = progress.sound; progress = blank(); progress.sound = s; save(); mastery(); });
  }

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[1-4]$/.test(k)) {
      const card = $$('.card')[+k - 1]; if (card) { card.click(); e.preventDefault(); return; }
    }
    if (/^[a-dA-D]$/.test(k)) {
      const ch = $$('.choice')['abcd'.indexOf(k.toLowerCase())]; if (ch && !ch.disabled) { ch.click(); e.preventDefault(); }
    }
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
    menu();
  }).catch(err => {
    screen.innerHTML = `<section class="menu"><h1>Couldn't load the question bank.</h1>
      <p class="lede">The game reads its questions as JSON, which browsers block when you open the file straight from disk. Serve the folder instead:</p>
      <pre class="term">cd last-hop && python3 -m http.server 8000</pre><p class="lede">Then open http://localhost:8000.</p>
      <p class="dim small">${esc(err.message)}</p></section>`;
  });
})();
