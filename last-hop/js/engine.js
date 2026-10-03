/* LAST HOP engine: answer checking, damage, phases, streaks, uptime, aftershocks.
   No DOM access, so it runs in the browser and in Node (tools/validate.js). */
(function (root) {
  'use strict';

  const TYPES = {
    recall:   { label: 'Recall',          base: 5,  tier: 'Bronze' },
    scenario: { label: 'Scenario',        base: 8,  tier: 'Silver' },
    order:    { label: 'Put in order',    base: 9,  tier: 'Silver' },
    calc:     { label: 'Calculate',       base: 10, tier: 'Gold' },
    output:   { label: 'Read the output', base: 12, tier: 'Gold' }
  };

  const START_NINES = 5;     // 99.999%
  const FLOOR_NINES = 1;     // 90.000% = SLA breached, run over
  const MISS_COST = 0.5;     // nines lost per wrong answer
  const HINT_COST = 0.2;     // nines lost per TAC case
  const CRIT_MULT = 1.8;
  const HP_PER_WEIGHT = 18;  // boss HP = blueprint weight x this
  const AFTERSHOCK_GAP = 3;  // questions until a miss comes back
  const TIMER = { calc: 45, output: 40, order: 40, scenario: 30, recall: 20 };

  const uptimePct = n => 100 * (1 - Math.pow(10, -n));
  const fmtUptime = n => uptimePct(Math.max(n, 0)).toFixed(3) + '%';
  const streakMult = s => Math.min(1 + 0.2 * s, 2);

  /* ---------- typed-answer normalizers ---------- */

  function parseIPv4(s) {
    const m = String(s).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const o = m.slice(1).map(Number);
    if (o.some(x => x > 255)) return null;
    return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
  }

  function parsePrefix(s) {
    s = String(s).trim();
    const m = s.match(/^\/?(\d{1,2})$/);
    if (m) { const n = +m[1]; return n <= 32 ? n : null; }
    const v = parseIPv4(s);
    if (v === null) return null;
    const bin = v.toString(2).padStart(32, '0');
    if (!/^1*0*$/.test(bin)) return null; // non-contiguous mask
    return bin.indexOf('0') === -1 ? 32 : bin.indexOf('0');
  }

  function expandIPv6(s) {
    s = String(s).trim().toLowerCase();
    if (!/^[0-9a-f:]+$/.test(s)) return null;
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    let groups;
    if (halves.length === 2) {
      const fill = 8 - left.length - right.length;
      if (fill < 1) return null;
      groups = left.concat(Array(fill).fill('0'), right);
    } else {
      groups = left;
    }
    if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map(g => g.padStart(4, '0')).join(':');
  }

  function hexGroups(s) {
    const g = String(s).trim().toLowerCase().split(/[:.\-]/);
    if (g.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return null;
    return g.map(x => x.padStart(4, '0')).join(':');
  }

  function normalize(kind, s) {
    switch (kind) {
      case 'ipv4':   return parseIPv4(s);
      case 'mask':   return parsePrefix(s);
      case 'ipv6':   return expandIPv6(s);
      case 'hex':    return hexGroups(s);
      case 'number': { const t = String(s).replace(/[,\s]/g, ''); return /^\d+$/.test(t) ? +t : null; }
      default:       return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
    }
  }

  /** Returns true, false, or null when the input can't be parsed for this kind. */
  function checkTyped(q, input) {
    const got = normalize(q.kind, input);
    if (got === null || got === '') return null;
    const accepted = [q.answer].concat(q.accept || []);
    return accepted.some(a => normalize(q.kind, a) === got);
  }

  // Placeholders. The examples deliberately match no answer in the bank.
  const INPUT_HELP = {
    ipv4: 'An address, like 10.0.0.1',
    mask: 'A prefix or mask, like /20 or 255.255.240.0',
    ipv6: 'An IPv6 address, like 2001:db8::1',
    hex: 'Four hex groups, like 1a2b:3cff:fe4d:5e6f',
    number: 'A whole number',
    text: 'Your answer'
  };
  // Shown when input can't be read as this kind of answer. It never costs uptime.
  const INPUT_ERROR = {
    ipv4: "That isn't an IPv4 address. Enter four numbers from 0 to 255 separated by dots.",
    mask: "That isn't a prefix or a mask. Enter something like /20 or 255.255.240.0.",
    ipv6: "That isn't an IPv6 address. Use eight hex groups, or shorten a run of zeros with ::.",
    hex: "That isn't four hex groups. Separate them with colons.",
    number: "That isn't a whole number.",
    text: 'Type an answer first.'
  };

  /* ---------- seeded RNG so runs are testable ---------- */

  function rng(seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- a single boss run ---------- */

  class Run {
    /**
     * @param {object} o
     * @param {object} o.boss      boss config (weight, weakPoints)
     * @param {object[]} o.questions
     * @param {'run'|'practice'} o.mode
     * @param {object} [o.srs]     { [qid]: { box } } from previous runs; box 0 = recently missed
     * @param {number} [o.seed]
     */
    constructor(o) {
      this.boss = o.boss;
      this.questions = o.questions;
      this.byId = Object.fromEntries(o.questions.map(q => [q.id, q]));
      this.mode = o.mode || 'run';
      this.srs = o.srs || {};
      this.rand = rng(o.seed || Date.now());
      this.maxHP = o.boss.weight * HP_PER_WEIGHT;
      this.hp = this.maxHP;
      this.nines = START_NINES;
      this.streak = 0;
      this.maxStreak = 0;
      this.turn = 0;
      this.asked = new Set();
      this.aftershocks = [];          // { id, due, tries }
      this.items = this.mode === 'practice'
        ? { reload: 0, pcap: Infinity, tac: Infinity }
        : { reload: 1, pcap: 2, tac: 3 };
      this.revealed = new Set(o.revealed || []);
      this.log = [];                  // { id, correct, damage, crit, aftershock }
      this.undo = null;
    }

    get practice() { return this.mode === 'practice'; }
    get hpFrac() { return this.hp / this.maxHP; }
    get phase() { return this.hpFrac > 2 / 3 ? 1 : this.hpFrac > 1 / 3 ? 2 : 3; }
    get timed() { return !this.practice && this.phase === 3; }
    get over() { return this.hp <= 0 || this.nines <= FLOOR_NINES; }
    get won() { return this.hp <= 0; }
    get mult() { return streakMult(this.streak); }

    timeLimit(q) { return this.timed ? TIMER[q.type] : 0; }
    isWeak(q) { return (this.boss.weakPoints || []).includes(q.obj); }

    damageFor(q, crit) {
      const base = TYPES[q.type].base * (0.7 + 0.3 * q.diff);
      return Math.max(1, Math.round(base * (crit ? CRIT_MULT : 1) * this.mult));
    }

    /** One forced aftershock, or up to three attack options to choose from. */
    draw() {
      const due = this.aftershocks.find(a => a.due <= this.turn);
      if (due) return [{ q: this.byId[due.id], aftershock: true }];

      const pending = new Set(this.aftershocks.map(a => a.id));
      let pool = this.questions.filter(q => !this.asked.has(q.id) && !pending.has(q.id));
      if (pool.length === 0) {
        // Bank exhausted: recycle everything except what's queued.
        this.asked.clear();
        pool = this.questions.filter(q => !pending.has(q.id));
      }
      const prefs = { 1: [1, 2, 3], 2: [2, 1, 3], 3: [3, 2, 1] }[this.phase];
      let cands = [];
      for (const d of prefs) {
        cands = cands.concat(pool.filter(q => q.diff === d));
        if (cands.length >= 3) break;
      }

      // Weighted pick: recently missed (from past runs) and unseen questions come up more.
      const weight = q => {
        const s = this.srs[q.id];
        return 1 + (!s ? 1 : s.box === 0 ? 3 : s.box === 1 ? 1.5 : 0);
      };
      const picks = [];
      const usedObj = new Set();
      let left = cands.slice();
      while (picks.length < 3 && left.length) {
        // Prefer distinct objectives so the choice is about where to aim.
        const fresh = left.filter(q => !usedObj.has(q.obj));
        const from = fresh.length ? fresh : left;
        const total = from.reduce((s, q) => s + weight(q), 0);
        let r = this.rand() * total, chosen = from[from.length - 1];
        for (const q of from) { r -= weight(q); if (r <= 0) { chosen = q; break; } }
        picks.push({ q: chosen, aftershock: false });
        usedObj.add(chosen.obj);
        left = left.filter(q => q !== chosen);
      }
      return picks;
    }

    /** Shuffled choice order for a multiple-choice question: array of original indexes. */
    choiceOrder(q) { return shuffle(q.choices.map((_, i) => i), this.rand); }

    /** Two wrong options to remove (Packet Capture). Indexes into q.choices or terminal lines. */
    capture(q) {
      if (this.items.pcap <= 0) return null;
      let wrong;
      if (q.type === 'output') {
        // Never strike the first line: it is the header or the interface status line the rest is read against.
        const first = q.terminal.lines.findIndex(l => l.trim());
        wrong = q.terminal.lines.map((l, i) => i).filter(i => i !== first && !q.answer.includes(i) && q.terminal.lines[i].trim());
      } else if (q.choices) {
        wrong = q.choices.map((_, i) => i).filter(i => i !== q.answer);
      } else return null;
      this.items.pcap--;
      const n = q.type === 'output' ? Math.min(wrong.length, Math.max(2, Math.floor(wrong.length / 2))) : 2;
      return shuffle(wrong, this.rand).slice(0, n);
    }

    tac(q) {
      if (this.items.tac <= 0) return null;
      this.items.tac--;
      if (!this.practice) this.nines -= HINT_COST;
      return q.hint || q.explain;
    }

    /**
     * Apply an answer. Returns an outcome the UI can animate.
     * @param {object} q
     * @param {boolean} correct
     * @param {object} [o] { aftershock, timeout }
     */
    answer(q, correct, o = {}) {
      const before = {
        hp: this.hp, nines: this.nines, streak: this.streak, maxStreak: this.maxStreak,
        aftershocks: this.aftershocks.map(a => ({ ...a })), revealed: new Set(this.revealed),
        asked: new Set(this.asked), turn: this.turn
      };
      const phaseBefore = this.phase;
      const out = { correct, damage: 0, crit: false, revealed: null, phaseChanged: false, uptimeLost: 0, timeout: !!o.timeout };

      this.turn++;
      this.asked.add(q.id);
      const pendingIdx = this.aftershocks.findIndex(a => a.id === q.id);

      if (correct) {
        out.crit = this.isWeak(q);
        out.damage = Math.min(this.hp, this.damageFor(q, out.crit));
        this.hp -= out.damage;
        this.streak++;
        this.maxStreak = Math.max(this.maxStreak, this.streak);
        if (out.crit && !this.revealed.has(q.obj)) { this.revealed.add(q.obj); out.revealed = q.obj; }
        if (pendingIdx >= 0) this.aftershocks.splice(pendingIdx, 1);
      } else {
        this.streak = 0;
        if (!this.practice) { this.nines -= MISS_COST; out.uptimeLost = MISS_COST; }
        if (pendingIdx >= 0) {
          const a = this.aftershocks[pendingIdx];
          a.tries++; a.due = this.turn + Math.max(2, AFTERSHOCK_GAP - a.tries + 1);
        } else {
          this.aftershocks.push({ id: q.id, due: this.turn + AFTERSHOCK_GAP, tries: 1 });
        }
      }

      out.phaseChanged = this.phase !== phaseBefore;
      out.phase = this.phase;
      this.log.push({ id: q.id, obj: q.obj, correct, damage: out.damage, crit: out.crit, aftershock: !!o.aftershock });
      this.undo = correct ? null : before;
      return out;
    }

    /** Reload in 5: roll back the last wrong answer so it can be retried. */
    reload() {
      if (!this.undo || this.items.reload <= 0) return false;
      const b = this.undo;
      Object.assign(this, { hp: b.hp, nines: b.nines, streak: b.streak, maxStreak: b.maxStreak, turn: b.turn });
      this.aftershocks = b.aftershocks;
      this.revealed = b.revealed;
      this.asked = b.asked;
      this.log.pop();
      this.items.reload--;
      this.undo = null;
      return true;
    }

    summary() {
      const n = this.log.length;
      const right = this.log.filter(l => l.correct).length;
      const byObj = {};
      for (const l of this.log) {
        const o = byObj[l.obj] || (byObj[l.obj] = { a: 0, c: 0 });
        o.a++; if (l.correct) o.c++;
      }
      return {
        won: this.won, answered: n, correct: right,
        accuracy: n ? right / n : 0, maxStreak: this.maxStreak,
        uptime: fmtUptime(this.nines), nines: this.nines,
        crits: this.log.filter(l => l.crit).length,
        missed: [...new Set(this.log.filter(l => !l.correct).map(l => l.id))],
        byObj
      };
    }
  }

  /* ---------- long-term progress (mastery + spaced repetition) ---------- */

  function recordResult(progress, q, correct) {
    const m = progress.mastery[q.obj] || (progress.mastery[q.obj] = { a: 0, c: 0, recent: [] });
    m.a++; if (correct) m.c++;
    m.recent.push(correct ? 1 : 0);
    if (m.recent.length > 8) m.recent.shift();
    const s = progress.srs[q.id] || { box: 1 };
    progress.srs[q.id] = { box: correct ? Math.min(s.box + 1, 4) : 0, seen: Date.now() };
  }

  const MIN_SAMPLE = 3;

  /** 'none' | 'few' | 'down' | 'degraded' | 'up', the same vocabulary as link state.
      'few' means fewer than three answers: too little to rate. */
  function masteryState(m) {
    if (!m || !m.a) return 'none';
    if (m.recent.length < MIN_SAMPLE) return 'few';
    const r = m.recent.reduce((s, x) => s + x, 0) / m.recent.length;
    if (r >= 0.8) return 'up';
    if (r >= 0.5) return 'degraded';
    return 'down';
  }

  /** 0-99 rating from the last eight answers, or null when there are fewer than three. */
  function masteryRating(m) {
    if (!m || m.recent.length < MIN_SAMPLE) return null;
    return Math.round((m.recent.reduce((s, x) => s + x, 0) / m.recent.length) * 99);
  }

  const api = {
    TYPES, TIMER, START_NINES, FLOOR_NINES, MISS_COST, HINT_COST, CRIT_MULT, HP_PER_WEIGHT, AFTERSHOCK_GAP, INPUT_HELP, INPUT_ERROR,
    uptimePct, fmtUptime, streakMult, parseIPv4, parsePrefix, expandIPv6, hexGroups,
    normalize, checkTyped, rng, shuffle, Run, recordResult, masteryState, masteryRating, MIN_SAMPLE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LH = api;
})(typeof window !== 'undefined' ? window : globalThis);
