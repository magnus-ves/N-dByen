'use strict';
/* ==========================================================================
   13e. RADIOENE – en Nødnett-terminal (TETRA) og en VHF-håndradio på skjermen, tegnet i SVG.
   Talegruppevelgeren/kanalvelgeren bytter hva du hører (Radio.setChannel). Skjermen viser talegruppe,
   dekning, klokke og hvem som snakker. Knappene virker: meny, skanning, PTT (snakk med en enhet),
   nødknapp, av/på og lydstyrke. Radioen kan flyttes ved å dra i toppen.
   Ingen produsentmerker – formen følger vanlige håndterminaler.
   ========================================================================== */
const RadioUI = {
  open: false, model: null, menu: false, menuIx: 0, rx: null, tx: false, emerg: 0, pos: null, timer: 0,
  VHF_CH: ['BRANN', 'POLITI', 'HELSE', 'REDNING', 'SENTRAL', 'NØDNETT'],
  init() {
    try { const st = JSON.parse(localStorage.getItem('nodbyen.radioui') || '{}'); RadioUI.open = !!st.open; RadioUI.pos = st.pos || null; RadioUI.model = st.model || null; } catch (e) { /* ignorer */ }
    const el = document.createElement('div'); el.id = 'radioDev'; el.className = 'hidden'; $('#hud').appendChild(el); RadioUI.el = el;
    Bus.on('radioRx', m => { RadioUI.rx = { who: m.who, msg: m.msg, tg: m.tg, t: performance.now(), live: true }; RadioUI.render(); });
    Bus.on('radioRxEnd', () => { if (RadioUI.rx) RadioUI.rx.live = false; RadioUI.render(); });
    Bus.on('log', e => { if (!S || !Radio.heard(e) || e.kind === 'quiet' && !e.tg) return; if (!RadioUI.rx || !RadioUI.rx.live) RadioUI.rx = { who: e.from, msg: e.msg, tg: e.tg, t: performance.now(), live: false }; });
    Bus.on('radioChannel', () => RadioUI.render());
    window.addEventListener('keydown', e => { if (Game.mode !== 'play' || /INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) return; if (e.key === '[') RadioUI.step(-1); else if (e.key === ']') RadioUI.step(1); });
  },
  save() { try { localStorage.setItem('nodbyen.radioui', JSON.stringify({ open: RadioUI.open, pos: RadioUI.pos, model: RadioUI.model })); } catch (e) { /* ignorer */ } },
  /** Hvilken radio som vises: VHF før Nødnett er kjøpt, ellers terminalen (kan byttes i toppen). */
  kind() { return RadioUI.model || (Net.vhf() ? 'vhf' : 'nod'); },
  toggle(on) {
    RadioUI.open = on == null ? !RadioUI.open : on; RadioUI.save(); RadioUI.build();
    $('#btnRadio').classList.toggle('on', RadioUI.open); if (RadioUI.open) { Radio.unlock(); if (S) S.flags.listened = 1; }
  },
  /* ---------- kanaler ---------- */
  list() { return RadioUI.kind() === 'vhf' ? RadioUI.VHF_CH.slice() : Radio.channels().map(c => c.id); },
  cityCode() { const id = (WORLD && WORLD.cfg && WORLD.cfg.id) || 'oslo'; return id === 'bergen' ? 'BGO' : id === 'oslo' ? 'OSL' : id.slice(0, 3).toUpperCase(); },
  tgName(id) {
    const c = RadioUI.cityCode();
    if (!id) return '—'; if (id.startsWith('SAMVIRKE')) return 'SAMV-' + c + '-' + id.split(' ')[1];
    return ({ BRANN: 'BRANN-' + c + '-1', POLITI: 'POLITI-' + c + '-OPS', HELSE: 'HELSE-AMK-' + c, REDNING: 'REDNING-' + c, SENTRAL: 'SENTRAL-' + c, 'NØDNETT': 'DRIFT-' + c })[id] || id;
  },
  vhfName(id) { return ({ BRANN: 'BRANN', POLITI: 'POLITI', HELSE: 'HELSE', REDNING: 'FRIVIL', SENTRAL: 'SENTRAL', 'NØDNETT': 'DRIFT' })[id] || '------'; },
  vhfIndex() { const i = RadioUI.VHF_CH.indexOf(Radio.channel); return i < 0 ? 0 : i; },
  step(d) {
    if (!S) return; const L = RadioUI.list(); if (!L.length) return;
    let i = L.indexOf(Radio.channel); i = i < 0 ? 0 : (i + d + L.length) % L.length;
    RadioUI.click(); Radio.unlock(); Radio.setChannel(L[i]); if (Radio.enabled) Radio.squelch(0.09, false); RadioUI.render();
  },
  /* ---------- lyder ---------- */
  click() { const c = Radio.ctx; if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = 2400; g.gain.setValueAtTime(0.025, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.025); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.03); },
  beep(f, len) { const c = Radio.ctx; if (!c || !Radio.enabled) return; const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f || 1900; g.gain.setValueAtTime(0.05, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + (len || 0.07)); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + (len || 0.07) + 0.02); },
  /* ---------- tegning ---------- */
  build() {
    const el = RadioUI.el; if (!el) return; if (!RadioUI.open || Game.mode !== 'play') { el.className = 'hidden'; el.innerHTML = ''; return; }
    const k = RadioUI.kind(); RadioUI.built = k; el.className = 'rdev ' + k;
    el.innerHTML = '<div class="rd-top" id="rdGrip"><button data-r="vhf" class="' + (k === 'vhf' ? 'on' : '') + '">VHF</button><button data-r="nod" class="' + (k === 'nod' ? 'on' : '') + '">Nødnett</button><span class="grow"></span><button data-r="close" aria-label="Skjul radioen">✕</button></div>'
      + '<div class="rd-wrap">' + (k === 'vhf' ? RadioUI.svgVhf() : RadioUI.svgNod()) + '<div class="rd-scr" id="rdScr"></div>' + RadioUI.hits(k) + '</div>';
    if (RadioUI.pos) { el.style.left = RadioUI.pos[0] + 'px'; el.style.top = RadioUI.pos[1] + 'px'; el.style.bottom = 'auto'; el.style.right = 'auto'; }
    RadioUI.bind(); RadioUI.render();
    clearInterval(RadioUI.timer); RadioUI.timer = setInterval(() => { if (RadioUI.open) RadioUI.render(); }, 400);
  },
  /** Usynlige trykkflater over knappene på tegningen (i prosent av radioen). */
  hits(k) {
    const z = (id, x, y, w, h, t) => '<button class="hz" data-h="' + id + '" title="' + (t || '') + '" style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%"></button>';
    if (k === 'vhf') return z('chL', 41, 23.6, 10, 10, 'Forrige kanal') + z('chR', 51, 23.6, 10, 10, 'Neste kanal') + z('volL', 67, 25, 8, 8.6, 'Lavere / av') + z('volR', 75, 25, 8, 8.6, 'Høyere / på')
      + z('emg', 85, 30.4, 10, 3.8, 'Nødknapp (hold)') + z('ptt', 0, 44, 8, 22, 'PTT – snakk') + z('k1', 23, 46.6, 15, 3.2, 'Skann') + z('k2', 42.5, 46.6, 15, 3.2, 'Forrige') + z('k3', 62, 46.6, 15, 3.2, 'Neste');
    let h = z('tgL', 40, 6, 8.5, 9, 'Forrige talegruppe') + z('tgR', 48.5, 6, 8.5, 9, 'Neste talegruppe') + z('emg', 66, 10.4, 20, 4.8, 'Nødknapp (hold)') + z('ptt', 0, 31, 8, 20, 'PTT – snakk')
      + z('sl', 16, 46.8, 18, 3.8, 'Meny') + z('sr', 66, 46.8, 18, 3.8, 'Skann') + z('up', 44, 46.2, 12, 3, 'Opp') + z('dn', 44, 53.6, 12, 3, 'Ned') + z('ok', 45, 49.2, 10, 4.4, 'OK')
      + z('grn', 16, 51.6, 18, 4, 'Svar') + z('red', 66, 51.6, 18, 4, 'Av/på') + z('vu', 93, 31.8, 6, 3.6, 'Lydstyrke opp') + z('vd', 93, 35.4, 6, 3.6, 'Lydstyrke ned');
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) h += z('n' + (r * 3 + c + 1), 19 + c * 21.5, 57.6 + r * 6.4, 19, 5.2, '');
    return h;
  },
  bind() {
    const el = RadioUI.el;
    $$('[data-r]', el).forEach(b => b.addEventListener('click', () => { const r = b.dataset.r; if (r === 'close') return RadioUI.toggle(false); RadioUI.model = r; RadioUI.menu = false; RadioUI.save(); RadioUI.build(); }));
    $$('.hz', el).forEach(b => {
      const h = b.dataset.h;
      if (h === 'ptt') { b.addEventListener('pointerdown', e => { e.preventDefault(); RadioUI.tx = true; Radio.unlock(); Radio.squelch(0.08, false); RadioUI.render(); }); const up = () => { if (!RadioUI.tx) return; RadioUI.tx = false; RadioUI.render(); RadioUI.ptt(); }; b.addEventListener('pointerup', up); b.addEventListener('pointerleave', () => { if (RadioUI.tx) { RadioUI.tx = false; RadioUI.render(); } }); return; }
      if (h === 'emg') { let t0 = 0, tm = 0; b.addEventListener('pointerdown', e => { e.preventDefault(); t0 = performance.now(); tm = setTimeout(() => RadioUI.emergency(), 1200); RadioUI.beep(1200, .05); }); const end = () => { clearTimeout(tm); }; b.addEventListener('pointerup', end); b.addEventListener('pointerleave', end); return; }
      b.addEventListener('click', e => { e.stopPropagation(); RadioUI.press(h); });
    });
    const wheelT = $('[data-h="tgR"]', el) || $('[data-h="chR"]', el), wheelL = $('[data-h="tgL"]', el) || $('[data-h="chL"]', el);
    for (const w of [wheelT, wheelL]) if (w) w.addEventListener('wheel', e => { e.preventDefault(); RadioUI.step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    // flytt radioen ved å dra i toppen
    const grip = $('#rdGrip', el); let d = null;
    grip.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); d = { x: e.clientX - r.left, y: e.clientY - r.top, px: p.left, py: p.top }; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', e => { if (!d) return; const p = el.parentElement.getBoundingClientRect(), x = clamp(e.clientX - d.px - d.x, 0, p.width - 60), y = clamp(e.clientY - d.py - d.y, 0, p.height - 60); el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.bottom = 'auto'; el.style.right = 'auto'; RadioUI.pos = [Math.round(x), Math.round(y)]; });
    grip.addEventListener('pointerup', () => { if (d) { d = null; RadioUI.save(); } });
  },
  press(h) {
    Radio.unlock(); const k = RadioUI.kind(), L = RadioUI.list();
    if (h === 'red') { Radio.enabled = !Radio.enabled; if (!Radio.enabled && 'speechSynthesis' in window) speechSynthesis.cancel(); Radio.queue = []; RadioUI.menu = false; RadioUI.beep(Radio.enabled ? 1600 : 900, .12); RadioUI.click(); return RadioUI.render(); }
    if (!Radio.enabled && h !== 'volR') return RadioUI.click();
    RadioUI.beep(2100, .04);
    switch (h) {
      case 'tgL': case 'chL': case 'k2': return RadioUI.step(-1);
      case 'tgR': case 'chR': case 'k3': return RadioUI.step(1);
      case 'volL': if (Radio.volume <= 0.15) { Radio.enabled = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); } Radio.volume = Math.max(0.1, +(Radio.volume - 0.15).toFixed(2)); Radio.save(); break;
      case 'volR': if (!Radio.enabled) { Radio.enabled = true; RadioUI.beep(1600, .1); } else Radio.volume = Math.min(1, +(Radio.volume + 0.15).toFixed(2)); Radio.save(); break;
      case 'vu': Radio.volume = Math.min(1, +(Radio.volume + 0.15).toFixed(2)); Radio.save(); break;
      case 'vd': Radio.volume = Math.max(0.1, +(Radio.volume - 0.15).toFixed(2)); Radio.save(); break;
      case 'k1': case 'sr': Radio.scan = !Radio.scan; Radio.save(); UI.dirty = true; break;
      case 'sl': RadioUI.menu = !RadioUI.menu; RadioUI.menuIx = Math.max(0, L.indexOf(Radio.channel)); break;
      case 'up': if (RadioUI.menu) RadioUI.menuIx = (RadioUI.menuIx - 1 + L.length) % L.length; else return RadioUI.step(-1); break;
      case 'dn': if (RadioUI.menu) RadioUI.menuIx = (RadioUI.menuIx + 1) % L.length; else return RadioUI.step(1); break;
      case 'ok': case 'grn': if (RadioUI.menu) { RadioUI.menu = false; Radio.setChannel(L[RadioUI.menuIx]); } else if (h === 'grn') RadioUI.ptt(); break;
      default: if (/^n\d+$/.test(h)) { const n = +h.slice(1); if (n >= 1 && n <= 9 && L[n - 1]) { RadioUI.menu = false; Radio.setChannel(L[n - 1]); Radio.squelch(0.09, false); } }   // hurtigvalg 1–9
    }
    RadioUI.render();
  },
  /** PTT: snakk med en enhet på kanalen (eller den valgte enheten). */
  ptt() {
    if (!S || !Radio.enabled) return; const sel = UI.sel && UI.sel.type === 'unit' && S.units[UI.sel.id];
    if (sel) return Radio.talk(sel.id);
    const on = Object.values(S.units).filter(u => !u.bistand && u.type !== 'livredder' && tgOf(u) === Radio.channel), list = on.length ? on : Object.values(S.units).filter(u => !u.bistand && u.status !== 'ledig');
    if (!list.length) return UI.toast('Ingen enheter svarer på ' + (RadioUI.kind() === 'vhf' ? 'kanal ' + (RadioUI.vhfIndex() + 1) : RadioUI.tgName(Radio.channel)), 'info');
    if (list.length === 1) return Radio.talk(list[0].id);
    UI.modal({ title: icon('radio') + ' Hvem vil du snakke med?', html: list.slice(0, 12).map(u => '<button class="opt" data-u="' + u.id + '"><div class="av" style="background:' + (AGENCIES[UT[u.type].org] || AGENCIES.bistand).farge + '">' + icon(AGENCIES[UT[u.type].org] ? AGENCIES[UT[u.type].org].ikon : 'radio') + '</div><div class="grow"><b class="sm">' + esc(u.name) + '</b><div class="xs muted">' + esc(UI.unitState(u)) + '</div></div></button>').join(''),
      buttons: [{ label: 'Avbryt', cls: 'ghost' }], init: h => $$('[data-u]', h.body).forEach(b => b.addEventListener('click', () => { h.close(); Radio.talk(b.dataset.u); })) });
  },
  emergency() {
    RadioUI.emerg = performance.now(); for (let i = 0; i < 4; i++) setTimeout(() => RadioUI.beep(i % 2 ? 1100 : 1500, .14), i * 160);
    if (S) Log.add('NØDNETT', 'Sentral', 'Nødkall fra operatørens terminal mottatt – øvelse, ingen fare', 'warn'); RadioUI.render();
  },
  bars() { if (RadioUI.kind() === 'vhf') return 3 + (Math.sin(performance.now() / 2300) > .6 ? 1 : 0); const f = S && S.covFrac != null ? S.covFrac : .9; return Math.max(1, Math.min(4, Math.round(f * 4.4))); },
  clock() { const c = Clock.cur; if (!c) return '--:--'; const h = Math.floor(c.hour), m = Math.floor((c.hour - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); },
  render() {
    if (RadioUI.open && RadioUI.built && RadioUI.built !== RadioUI.kind()) return RadioUI.build();   // byttet fra VHF til Nødnett
    const scr = RadioUI.el && $('#rdScr', RadioUI.el); if (!scr || !S) return; const k = RadioUI.kind(), on = Radio.enabled, now = performance.now();
    const knob = $('#rdKnobRidge', RadioUI.el), L = RadioUI.list(), ix = Math.max(0, L.indexOf(Radio.channel)); if (knob) knob.setAttribute('patternTransform', 'translate(' + (ix * 1.7) + ',0)');
    const led = $('#rdLed', RadioUI.el), rxOn = RadioUI.rx && RadioUI.rx.live && now - RadioUI.rx.t < 15000;
    if (led) led.setAttribute('fill', !on ? '#2a1d1d' : RadioUI.tx ? '#ff3b30' : rxOn ? (Math.floor(now / 250) % 2 ? '#39d353' : '#1f7a33') : '#1f3a26');
    if (!on) { scr.className = 'rd-scr off'; scr.innerHTML = ''; return; }
    const em = now - RadioUI.emerg < 5000, rx = RadioUI.rx && now - RadioUI.rx.t < 9000 ? RadioUI.rx : null, bars = RadioUI.bars();
    const barsH = '<span class="bars">' + [1, 2, 3, 4].map(b => '<i class="' + (b <= bars ? 'on' : '') + '"></i>').join('') + '</span>';
    const vol = '<span class="vol">' + [1, 2, 3, 4, 5, 6].map(v => '<i class="' + (v / 6 <= Radio.volume + .01 ? 'on' : '') + '"></i>').join('') + '</span>';
    if (k === 'vhf') {
      const ch = RadioUI.vhfIndex() + 1, vhfOk = Net.vhf() || ['SENTRAL', 'NØDNETT'].includes(Radio.channel);
      scr.className = 'rd-scr vhf';
      scr.innerHTML = '<div class="l1">' + barsH + (Radio.scan ? '<b class="tag">SCAN</b>' : '') + (RadioUI.tx ? '<b class="tag tx">TX</b>' : rx && rx.live ? '<b class="tag">RX</b>' : '') + '<span class="bat"></span></div>'
        + '<div class="l2"><span class="chn">CH' + String(ch).padStart(2, '0') + '</span><span class="nm">' + esc(RadioUI.vhfName(Radio.channel)) + '</span></div>'
        + '<div class="l3">' + (em ? 'NØDKALL SENDT' : !vhfOk ? 'INGEN TRAFIKK (NØDNETT)' : rx ? esc((rx.who || '') + ': ' + rx.msg) : 'Vol ' + Math.round(Radio.volume * 10)) + '</div>';
      return;
    }
    scr.className = 'rd-scr nod' + (em ? ' em' : '');
    const head = '<div class="sb">' + barsH + '<span class="net">' + (Net.vhf() ? 'Ingen nett' : 'Nødnett') + '</span><span class="tmo">TMO</span><span class="grow"></span><span class="clk">' + RadioUI.clock() + '</span><span class="bat"></span></div>';
    if (Net.vhf()) { scr.innerHTML = head + '<div class="mid"><div class="big dim">Ingen tilgang</div><div class="sub">Kjøp Nødnett i Butikk</div></div><div class="sk"><span>Meny</span><span>VHF</span></div>'; return; }
    if (em) { scr.innerHTML = head + '<div class="mid"><div class="big">NØDKALL</div><div class="sub">Sendt til operasjonssentralen</div></div><div class="sk"><span></span><span>Avslutt</span></div>'; return; }
    if (RadioUI.menu) {
      const start = clamp(RadioUI.menuIx - 2, 0, Math.max(0, L.length - 5));
      scr.innerHTML = head + '<div class="menu"><div class="mt">Talegrupper · ' + RadioUI.cityCode() + '</div>' + L.slice(start, start + 5).map((id, i) => '<div class="mi' + (start + i === RadioUI.menuIx ? ' on' : '') + (id === Radio.channel ? ' cur' : '') + '">' + (start + i + 1) + ' ' + esc(RadioUI.tgName(id)) + '</div>').join('') + '</div><div class="sk"><span>Tilbake</span><span>Velg</span></div>';
      return;
    }
    const busy = Net.samvActive && Radio.channel.startsWith('SAMVIRKE') ? Net.samvActive().some(i => i.tg === Radio.channel) : null;
    scr.innerHTML = head + '<div class="mid"><div class="lbl">Talegruppe ' + (ix + 1) + '/' + L.length + (Radio.scan ? ' · <b>SKANN</b>' : '') + '</div><div class="big">' + esc(RadioUI.tgName(Radio.channel)) + '</div>'
      + '<div class="sub">' + (RadioUI.tx ? '<b class="tx">● SENDER</b>' : busy != null ? (busy ? 'Samvirke i bruk' : 'Ledig samvirke') : 'Mappe ' + RadioUI.cityCode()) + ' ' + vol + '</div>'
      + '<div class="rx' + (rx && rx.live ? ' live' : '') + '">' + (rx ? '<b>' + esc(rx.who || '') + '</b> ' + esc(rx.msg) : '<span class="dim">Ingen samtale</span>') + '</div></div>'
      + '<div class="sk"><span>Meny</span><span>' + (Radio.scan ? 'Skann av' : 'Skann på') + '</span></div>';
  },
  /* ---------- tegningene ---------- */
  svgNod() {
    let keys = ''; const lab = ['1', '2 ABC', '3 DEF', '4 GHI', '5 JKL', '6 MNO', '7 PQRS', '8 TUV', '9 WXYZ', '✱', '0 ␣', '#'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { const x = 40 + c * 43, y = 272 + r * 30, t = lab[r * 3 + c].split(' ');
      keys += '<rect x="' + x + '" y="' + y + '" width="36" height="24" rx="9" fill="url(#nbKey)" stroke="#50585e" stroke-width=".8"/><text x="' + (x + 18) + '" y="' + (y + 14) + '" class="kt">' + t[0] + '</text>' + (t[1] ? '<text x="' + (x + 18) + '" y="' + (y + 21) + '" class="ks">' + t[1] + '</text>' : ''); }
    let grille = ''; for (let y = 404; y <= 444; y += 7) for (let x = 54 + ((y / 7) % 2) * 3.5; x <= 146; x += 7) grille += '<circle cx="' + x + '" cy="' + y + '" r="1.7"/>';
    let rid = ''; for (let y = 8; y < 64; y += 5) rid += '<rect x="28" y="' + y + '" width="22" height="2" rx="1" fill="#0a0b0c" opacity=".7"/>';
    return '<svg class="rd-svg" viewBox="0 0 200 470" aria-hidden="true"><defs>'
      + '<linearGradient id="nbBody" x1="0" x2="1"><stop offset="0" stop-color="#15181a"/><stop offset=".07" stop-color="#3a4044"/><stop offset=".5" stop-color="#24282b"/><stop offset=".93" stop-color="#3a4044"/><stop offset="1" stop-color="#131517"/></linearGradient>'
      + '<linearGradient id="nbFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#30363a"/><stop offset="1" stop-color="#1b1e21"/></linearGradient>'
      + '<linearGradient id="nbKey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#454c52"/><stop offset="1" stop-color="#2a2f33"/></linearGradient>'
      + '<linearGradient id="nbKnob" x1="0" x2="1"><stop offset="0" stop-color="#0d0e0f"/><stop offset=".3" stop-color="#5b6166"/><stop offset=".55" stop-color="#2a2e31"/><stop offset=".8" stop-color="#50565b"/><stop offset="1" stop-color="#0d0e0f"/></linearGradient>'
      + '<pattern id="rdKnobRidge" width="3.4" height="10" patternUnits="userSpaceOnUse"><rect width="1.6" height="10" fill="#050606"/></pattern>'
      + '<linearGradient id="nbOr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb04a"/><stop offset="1" stop-color="#e2620b"/></linearGradient>'
      + '<linearGradient id="nbGl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>'
      + '<rect x="24" y="2" width="30" height="80" rx="13" fill="#141618"/>' + rid + '<rect x="20" y="64" width="38" height="18" rx="5" fill="#25292c"/>'   // kort antenne
      + '<rect x="80" y="28" width="34" height="44" rx="6" fill="url(#nbKnob)"/><rect x="80" y="28" width="34" height="44" rx="6" fill="url(#rdKnobRidge)" opacity=".55"/><rect x="81" y="28" width="32" height="5" rx="2.5" fill="#7a8086"/>'   // talegruppevelger
      + '<rect x="134" y="49" width="38" height="22" rx="7" fill="url(#nbOr)" stroke="#9c4706"/><rect x="138" y="52" width="30" height="5" rx="2.5" fill="#ffd29a" opacity=".55"/>'   // nødknapp
      + '<path d="M14 82 Q14 68 28 68 L172 68 Q186 68 186 82 L190 438 Q190 464 166 466 L34 466 Q10 464 10 438 Z" fill="url(#nbBody)"/>'
      + '<rect x="3" y="146" width="11" height="96" rx="5" fill="#1a1d20" stroke="#3a4045"/>' + [0, 1, 2, 3, 4, 5, 6, 7].map(i => '<rect x="4" y="' + (154 + i * 10) + '" width="9" height="3" rx="1.5" fill="#0d0f10"/>').join('')   // PTT
      + '<rect x="186" y="148" width="10" height="36" rx="4" fill="#1a1d20" stroke="#3a4045"/><rect x="187" y="165" width="8" height="1.5" fill="#0d0f10"/>'   // lydstyrke
      + '<rect x="22" y="82" width="156" height="372" rx="18" fill="url(#nbFace)" stroke="#40474c"/>'
      + '<rect x="30" y="92" width="140" height="122" rx="11" fill="#07090a" stroke="#4b5257"/>'   // skjermramme
      + '<rect x="34" y="221" width="34" height="15" rx="7.5" fill="url(#nbKey)" stroke="#50585e" stroke-width=".8"/><rect x="132" y="221" width="34" height="15" rx="7.5" fill="url(#nbKey)" stroke="#50585e" stroke-width=".8"/>'
      + '<circle cx="100" cy="240" r="23" fill="#2c3135" stroke="#50585e"/><circle cx="100" cy="240" r="11" fill="url(#nbKey)" stroke="#5a636a"/><text x="100" y="243" class="ks" style="font-size:7px">OK</text>'
      + '<path d="M100 221 l-4 5 h8z M100 259 l-4 -5 h8z M81 240 l5 -4 v8z M119 240 l-5 -4 v8z" fill="#8c959c"/>'
      + '<rect x="34" y="243" width="34" height="17" rx="8.5" fill="url(#nbKey)" stroke="#50585e" stroke-width=".8"/><path d="M45 249 q6 7 12 0" stroke="#3ccf5a" stroke-width="2.6" fill="none" stroke-linecap="round"/>'
      + '<rect x="132" y="243" width="34" height="17" rx="8.5" fill="url(#nbKey)" stroke="#50585e" stroke-width=".8"/><path d="M143 254 q6 -7 12 0" stroke="#ef4a3c" stroke-width="2.6" fill="none" stroke-linecap="round"/>'
      + keys + '<g fill="#090a0b">' + grille + '</g>'
      + '<circle id="rdLed" cx="66" cy="76" r="3.2" fill="#1f3a26"/>'
      + '<text x="100" y="463" class="brand">TETRA</text>'
      + '<rect x="30" y="92" width="140" height="122" rx="11" fill="url(#nbGl)" pointer-events="none"/></svg>';
  },
  svgVhf() {
    let slots = ''; for (let y = 268; y <= 456; y += 10) slots += '<rect x="40" y="' + y + '" width="110" height="5" rx="2.5"/>';
    return '<svg class="rd-svg" viewBox="0 0 190 500" aria-hidden="true"><defs>'
      + '<linearGradient id="vhBody" x1="0" x2="1"><stop offset="0" stop-color="#141617"/><stop offset=".08" stop-color="#3b3f42"/><stop offset=".5" stop-color="#232628"/><stop offset=".92" stop-color="#3b3f42"/><stop offset="1" stop-color="#121314"/></linearGradient>'
      + '<linearGradient id="vhFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d3134"/><stop offset="1" stop-color="#1a1c1e"/></linearGradient>'
      + '<linearGradient id="vhKnob" x1="0" x2="1"><stop offset="0" stop-color="#0c0d0e"/><stop offset=".3" stop-color="#5a6065"/><stop offset=".55" stop-color="#272a2d"/><stop offset=".8" stop-color="#4c5257"/><stop offset="1" stop-color="#0c0d0e"/></linearGradient>'
      + '<pattern id="rdKnobRidge" width="3.4" height="10" patternUnits="userSpaceOnUse"><rect width="1.6" height="10" fill="#050606"/></pattern>'
      + '<linearGradient id="vhKey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#454b50"/><stop offset="1" stop-color="#26292c"/></linearGradient>'
      + '<linearGradient id="vhOr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb04a"/><stop offset="1" stop-color="#df600a"/></linearGradient></defs>'
      + '<path d="M44 150 L47 10 Q48 2 51 2 Q54 2 55 10 L58 150 Z" fill="#111314"/><circle cx="51" cy="6" r="5" fill="#1b1d1f"/>'   // lang antenne
      + '<rect x="34" y="138" width="34" height="30" rx="6" fill="#26292c"/>' + [0, 1, 2, 3].map(i => '<rect x="36" y="' + (142 + i * 6) + '" width="30" height="2" fill="#141617"/>').join('')
      + '<rect x="78" y="116" width="40" height="52" rx="7" fill="url(#vhKnob)"/><rect x="78" y="116" width="40" height="52" rx="7" fill="url(#rdKnobRidge)" opacity=".55"/><rect x="79" y="116" width="38" height="6" rx="3" fill="#7a8086"/>'   // kanalvelger
      + '<rect x="128" y="124" width="30" height="44" rx="7" fill="url(#vhKnob)"/><rect x="129" y="124" width="28" height="5" rx="2.5" fill="#7a8086"/>'   // lydstyrke / av-på
      + '<rect x="162" y="152" width="18" height="16" rx="5" fill="url(#vhOr)" stroke="#9c4706"/>'   // nødknapp
      + '<path d="M14 182 Q14 166 30 166 L162 166 Q178 166 178 182 L182 470 Q182 496 158 498 L36 498 Q10 496 10 470 Z" fill="url(#vhBody)"/>'
      + '<rect x="2" y="222" width="11" height="104" rx="5" fill="#1a1d20" stroke="#3a4045"/>' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => '<rect x="3" y="' + (230 + i * 10) + '" width="9" height="3" rx="1.5" fill="#0d0f10"/>').join('')   // PTT
      + '<rect x="2" y="334" width="10" height="20" rx="4" fill="#1a1d20" stroke="#3a4045"/><rect x="2" y="358" width="10" height="20" rx="4" fill="#1a1d20" stroke="#3a4045"/>'
      + '<rect x="22" y="178" width="146" height="310" rx="16" fill="url(#vhFace)" stroke="#40474c"/>'
      + '<rect x="32" y="186" width="126" height="44" rx="6" fill="#07090a" stroke="#4b5257"/>'   // skjermramme
      + '<rect x="44" y="233" width="28" height="14" rx="5" fill="url(#vhKey)" stroke="#50585e" stroke-width=".8"/><rect x="81" y="233" width="28" height="14" rx="5" fill="url(#vhKey)" stroke="#50585e" stroke-width=".8"/><rect x="118" y="233" width="28" height="14" rx="5" fill="url(#vhKey)" stroke="#50585e" stroke-width=".8"/>'
      + '<text x="58" y="243" class="ks">SCAN</text><text x="95" y="243" class="ks">◀</text><text x="132" y="243" class="ks">▶</text>'
      + '<g fill="#08090a">' + slots + '</g>'
      + '<circle id="rdLed" cx="148" cy="176" r="3.2" fill="#1f3a26"/>'
      + '<text x="95" y="492" class="brand">VHF · FM</text></svg>';
  }
};
