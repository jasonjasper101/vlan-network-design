/* Server-room sound, synthesized with WebAudio. Starts only after a user gesture. */
(function (root) {
  'use strict';
  let ctx = null, master = null, hum = null, enabled = false;

  function init() {
    if (ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return buf; // brown-ish noise: fans and airflow
  }

  function startHum() {
    if (hum) return;
    const g = ctx.createGain(); g.gain.value = 0.16; g.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.connect(g);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    const o1g = ctx.createGain(); o1g.gain.value = 0.18; o1.connect(o1g).connect(lp);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 120;
    const o2g = ctx.createGain(); o2g.gain.value = 0.25; o2.connect(o2g).connect(lp);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(4); n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.5;
    const ng = ctx.createGain(); ng.gain.value = 0.35; n.connect(bp).connect(ng).connect(g);
    o1.start(); o2.start(); n.start();
    hum = { g };
  }

  function click(t, freq) {
    const len = 0.012;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = freq; hp.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0.9;
    s.connect(hp).connect(g).connect(master); s.start(t);
  }

  const sfx = {
    relay() { if (!ready()) return; const t = ctx.currentTime; click(t, 2400); click(t + 0.045, 1800); },
    crit() { if (!ready()) return; const t = ctx.currentTime; [0, 0.04, 0.08, 0.12].forEach((d, i) => click(t + d, 2000 + i * 300)); },
    select() { if (!ready()) return; click(ctx.currentTime, 3200); },
    alarm() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square';
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g).connect(master);
      [0, 0.18, 0.36].forEach(d => {
        o.frequency.setValueAtTime(880, t + d); o.frequency.setValueAtTime(660, t + d + 0.09);
        g.gain.setValueAtTime(0.09, t + d); g.gain.setValueAtTime(0, t + d + 0.16);
      });
      o.start(t); o.stop(t + 0.6);
    },
    phase() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'triangle';
      const g = ctx.createGain();
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 1.2);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      o.connect(g).connect(master); o.start(t); o.stop(t + 1.3);
    },
    tick() { if (!ready()) return; click(ctx.currentTime, 900); }
  };

  function ready() { return enabled && ctx && ctx.state === 'running'; }

  function setEnabled(on) {
    enabled = on;
    if (on) {
      init(); if (!ctx) return false;
      ctx.resume(); startHum();
      master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.3);
    } else if (ctx) {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
    return enabled;
  }

  root.LHAudio = { setEnabled, get enabled() { return enabled; }, sfx };
})(window);
