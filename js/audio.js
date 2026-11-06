'use strict';
/* ==========================================================================
   13c. LYD – sirener, telefonring ved nødanrop, byens bakgrunnslyd og regn
   Alt lages med Web Audio (ingen lydfiler). Lyd starter først etter et klikk (nettleserregel).
   Sirener: to-tone (brann/ambulanse) og ulende tone (politi), styrke og retning etter avstand til kameraet.
   ========================================================================== */
const Sound = {
  on: true, ctx: null, master: null, sirens: {}, ambient: null, rain: null, t: 0,
  init() {
    try { const v = localStorage.getItem('nodbyen.lyd'); if (v === '0') Sound.on = false; } catch (e) { /* ignorer */ }
    window.addEventListener('pointerdown', () => Sound.unlock(), { passive: true });
    Bus.on('call', () => Sound.ring());
    Bus.on('incidentDone', inc => Sound.chime(inc.state === 'ferdig'));
    Bus.on('alarm', () => Sound.alarm());
  },
  unlock() {
    try {
      if (!Sound.ctx) { Radio.unlock(); Sound.ctx = Radio.ctx || new (window.AudioContext || window.webkitAudioContext)(); Sound.master = Sound.ctx.createGain(); Sound.master.gain.value = Sound.on ? 0.8 : 0; Sound.master.connect(Sound.ctx.destination); }
      if (Sound.ctx.state === 'suspended') Sound.ctx.resume();
    } catch (e) { /* ingen lyd */ }
  },
  toggle() { Sound.on = !Sound.on; Sound.unlock(); if (Sound.master) Sound.master.gain.setTargetAtTime(Sound.on ? 0.8 : 0, Sound.ctx.currentTime, 0.05); try { localStorage.setItem('nodbyen.lyd', Sound.on ? '1' : '0'); } catch (e) { /* ignorer */ } return Sound.on; },
  ready() { return Sound.on && Sound.ctx && Sound.ctx.state === 'running'; },
  tone(freq, dur, type, vol, when) {
    if (!Sound.ready()) return; const c = Sound.ctx, t = c.currentTime + (when || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || .15, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(Sound.master); o.start(t); o.stop(t + dur + .05);
  },
  /** Telefonring i nødsentralen. */
  ring() { if (Game.mode !== 'play') return; for (let k = 0; k < 2; k++) for (let i = 0; i < 8; i++) { Sound.tone(440, .05, 'sine', .07, k * .45 + i * .05); Sound.tone(480, .05, 'sine', .07, k * .45 + i * .05); } },
  chime(ok) { if (Game.mode !== 'play') return; if (ok) { Sound.tone(660, .25, 'triangle', .08); Sound.tone(880, .35, 'triangle', .07, .12); } else { Sound.tone(330, .4, 'triangle', .08); Sound.tone(262, .5, 'triangle', .07, .18); } },
  alarm() { for (let i = 0; i < 6; i++) Sound.tone(i % 2 ? 1100 : 1400, .12, 'square', .06, i * .13); },
  noise(sec) { const c = Sound.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; },
  /** Bakgrunn: dempet byduring (nærmere = sterkere) og regn i regnvær. */
  bed(zoomNear, wet, night) {
    if (!Sound.ready()) return; const c = Sound.ctx;
    if (!Sound.ambient) {
      const src = c.createBufferSource(); src.buffer = Sound.noise(4); src.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; const g = c.createGain(); g.gain.value = 0;
      src.connect(lp).connect(g).connect(Sound.master); src.start(); Sound.ambient = g;
      const r = c.createBufferSource(); r.buffer = Sound.noise(3); r.loop = true; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200; const rg = c.createGain(); rg.gain.value = 0;
      r.connect(hp).connect(rg).connect(Sound.master); r.start(); Sound.rain = rg;
    }
    const t = c.currentTime; Sound.ambient.gain.setTargetAtTime(Game.mode === 'play' ? (0.02 + 0.07 * zoomNear) * (night ? .55 : 1) : 0.015, t, .6); Sound.rain.gain.setTargetAtTime(wet ? 0.035 : 0, t, .8);
  },
  /** Sirener: de tre nærmeste kjøretøyene med blålys høres. */
  sirenFrame(S, dt) {
    if (!Sound.ctx) return; const c = Sound.ctx, t = c.currentTime, live = Sound.ready() && S && !S.paused && Game.mode === 'play'; Sound.t += dt;
    const near = []; if (live) for (const id in S.units) { const u = S.units[id]; if (!u.siren || u.status === 'pastedet' || u.vis === false || UT[u.type].foot || UT[u.type].boat) continue; const d = Math.hypot(u.x - R.camPos.x, u.z - R.camPos.z, R.camPos.y); if (d < 900) near.push({ u, d }); }
    near.sort((a, b) => a.d - b.d); const keep = new Set(near.slice(0, 3).map(o => o.u.id));
    for (const id in Sound.sirens) if (!keep.has(id)) { const s = Sound.sirens[id]; s.g.gain.setTargetAtTime(0, t, .15); s.o.stop(t + .6); delete Sound.sirens[id]; }
    for (const { u, d } of near.slice(0, 3)) {
      let s = Sound.sirens[u.id];
      if (!s) { const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null; o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 2400; g.gain.value = 0; o.connect(f).connect(g); if (p) { g.connect(p); p.connect(Sound.master); } else g.connect(Sound.master); o.start(); s = Sound.sirens[u.id] = { o, g, p, pol: UT[u.type].org === 'politi' }; }
      const ph = Sound.t + (u.id.charCodeAt(u.id.length - 1) % 7) * .13;
      const fr = s.pol ? 700 + 450 * (0.5 + 0.5 * Math.sin(ph * 2.4)) : (Math.floor(ph * 1.6) % 2 ? 950 : 700);   // politi: ul, ellers to-tone
      s.o.frequency.setTargetAtTime(fr, t, s.pol ? .05 : .01);
      s.g.gain.setTargetAtTime(Math.min(.09, 12 / Math.max(40, d)), t, .1);
      if (s.p) { const sc = R.screenOf(u.x, 2, u.z); s.p.pan.setTargetAtTime(sc ? clamp((sc.x / R.w - .5) * 1.6, -1, 1) : 0, t, .1); }
    }
  }
};
