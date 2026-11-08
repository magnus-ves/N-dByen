'use strict';

/* ==========================================================================
   13. UI – topplinje, panel med faner, dialoger, startflyt og plassering
   Ingen alert/confirm/prompt: alle dialoger er egne (UI.modal / UI.ask).
   ========================================================================== */
const TABS = [
  { id: 'hendelser', navn: 'Hendelser', ikon: 'bell' }, { id: 'enheter', navn: 'Enheter', ikon: 'truck' }, { id: 'frivillige', navn: 'Frivillige', ikon: 'hand' },
  { id: 'nodnett', navn: 'Nødnett', ikon: 'mast' }, { id: 'stasjoner', navn: 'Stasjoner', ikon: 'house' }, { id: 'butikk', navn: 'Butikk', ikon: 'bag' }, { id: 'statistikk', navn: 'Statistikk', ikon: 'chart' }
];
const Game = { mode: 'boot', cityId: null, worldCity: null, place: null, saveTimer: 0, ultra: true, lowGfx: false };
// valgt grafikknivå huskes i nettleseren: ultra (standard, høyere oppløsning enn skjermen), høy eller lav
try { const g = localStorage.getItem('nodbyen.gfx'); if (g === 'høy') Game.ultra = false; else if (g === 'lav') { Game.ultra = false; Game.lowGfx = true; } } catch (e) { /* ignorer */ }
const UI = { seen: new Set(), tab: 'hendelser', sheet: 1, sel: null, dirty: true, lastHtml: '', lastTab: '', shopCat: 'etat', logFilter: 'ALLE', mc: 0, sug: {}, sugT: 0, openUnits: {}, tick: 0, season: 1 };

const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
const chip = (txt, cls) => '<span class="chip ' + (cls || '') + '">' + txt + '</span>';
const barHtml = (f, col) => '<div class="bar"><i style="width:' + Math.round(clamp(f, 0, 1) * 100) + '%;' + (col ? 'background:' + col : '') + '"></i></div>';
const avatar = (org, ic) => { const a = AGENCIES[org] || AGENCIES.bistand; return '<div class="av" style="background:' + a.farge + '">' + icon(ic || a.ikon) + '</div>'; };
const priChip = inc => { const lab = (PRI_LABEL[inc.lead] || PRI_LABEL.brann)[inc.pri] || ('P' + inc.pri); return chip(lab, 'p' + inc.pri); };

UI.init = function () {
  $$('[data-ic]').forEach(e => { e.innerHTML = icon(e.dataset.ic); });
  $('#tabs').innerHTML = TABS.map(t => '<button class="tab" data-tab="' + t.id + '">' + icon(t.ikon) + '<span>' + t.navn + '</span></button>').join('');
  // panel: handlinger utløses ved pointerup (tåler at innholdet tegnes på nytt)
  const body = $('#tabBody'); let down = null;
  body.addEventListener('pointerdown', e => { const b = e.target.closest('[data-act]'); down = b ? { act: b.dataset.act, id: b.dataset.id, k: b.dataset.k, x: e.clientX, y: e.clientY } : null; });
  body.addEventListener('pointerup', e => {
    if (!down) return; const b = e.target.closest('[data-act]');
    if (b && b.dataset.act === down.act && b.dataset.id === down.id && b.dataset.k === down.k && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) { UI.act(b.dataset.act, b.dataset); }
    down = null;
  });
  body.addEventListener('pointercancel', () => { down = null; });
  body.addEventListener('click', e => { if (e.detail === 0) { const b = e.target.closest('[data-act]'); if (b) UI.act(b.dataset.act, b.dataset); } });
  $('#tabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { if (UI.tab === t.dataset.tab && UI.sheet === 1 && window.innerWidth < 900) UI.setSheet(0); else { UI.setTab(t.dataset.tab); if (UI.sheet === 0) UI.setSheet(1); } } });
  $('#tbSpeed').addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (b) UI.setSpeed(+b.dataset.sp); });
  $('#btnMenu').addEventListener('click', () => UI.menu());
  $('#btnCover').addEventListener('click', () => UI.toggleCover());
  $('#btnRotL').addEventListener('click', () => R.rotate(0.5)); $('#btnRotR').addEventListener('click', () => R.rotate(-0.5));
  $('#btnHome').addEventListener('click', () => R.resetCamera(false));
  $('#tbReady').addEventListener('click', () => { UI.setTab('statistikk'); if (UI.sheet === 0) UI.setSheet(1); });
  $('#tbInc').addEventListener('click', () => { UI.setTab('hendelser'); if (UI.sheet === 0) UI.setSheet(1); });
  $('#tbNet').addEventListener('click', () => { UI.setTab('nodnett'); if (UI.sheet === 0) UI.setSheet(1); });
  // bunnskuff (mobil): dra i håndtaket
  const h = $('#sheetHandle'); let sy = null;
  h.addEventListener('pointerdown', e => { sy = e.clientY; h.setPointerCapture(e.pointerId); });
  h.addEventListener('pointerup', e => { if (sy == null) return; const dy = e.clientY - sy; sy = null; if (Math.abs(dy) < 8) UI.setSheet((UI.sheet + 1) % 3); else UI.setSheet(clamp(UI.sheet + (dy < 0 ? 1 : -1), 0, 2)); });
  window.addEventListener('keydown', UI.key);
  window.addEventListener('resize', () => UI.layout());
  Bus.on('toast', m => UI.toast(m.msg, m.kind));
  Bus.on('log', e => UI.pushMini(e));
  Bus.on('levelup', d => UI.levelUp(d));
  Radio.init(); Sound.init(); Grade.init(); RadioUI.init(); Bus.on('dayReport', r => { if (Game.mode === 'play') Goals.report(r); }); $('#btnRadio').classList.toggle('on', RadioUI.open);
  $('#btnRadio').addEventListener('click', () => RadioUI.toggle());   // vis/skjul radioen (av/på og lydstyrke sitter på selve radioen)
  Bus.on('incident', inc => { UI.dirty = true; if (Game.mode === 'play') UI.renderTab(true); if (UI.sheet === 0 && window.innerWidth < 900) UI.pulseTab('hendelser'); });
  Bus.on('alarm', al => { UI.dirty = true; UI.alarmBar(); R.focus(S.units[al.unitId].x, S.units[al.unitId].z, 80); });
  Bus.on('incidentDone', () => { UI.dirty = true; });
  Bus.on('built', () => setTimeout(() => { City.lastKey = ''; City.update(); }, 50));   // fjern bygget som sto på tomta
  Bus.on('call', c => { UI.dirty = true; if (Game.mode === 'play') { UI.renderTab(true); if (UI.sheet === 0 && window.innerWidth < 900) UI.pulseTab('hendelser'); } });
  UI.layout();
};
UI.layout = function () {
  const desk = window.innerWidth >= 900;
  const ph = $('#panel').classList.contains('hidden') ? 0 : ($('#panel').getBoundingClientRect().height + 8);
  if (R.map) R.setPadding(desk && !$('#panel').classList.contains('hidden') ? 432 : 0, desk ? 0 : Math.min(ph, window.innerHeight * 0.5));
  document.documentElement.style.setProperty('--sheetPeek', (desk ? 70 : Math.min(ph, 140)) + 'px');
  const tb = $('#topbar'); if (tb && !tb.classList.contains('hidden')) document.documentElement.style.setProperty('--topH', Math.ceil(tb.getBoundingClientRect().height + 10) + 'px'); else document.documentElement.style.setProperty('--topH', '24px');
};
UI.setSheet = function (n) {
  UI.sheet = n; const p = $('#panel'); p.classList.remove('s0', 's1', 's2'); p.classList.add('s' + n);
  setTimeout(UI.layout, 480); UI.layout(); UI.dirty = true;
};
UI.setTab = function (t) {
  UI.tab = t; $$('#tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  UI.dirty = true; UI.renderTab(true);
};
UI.pulseTab = function (t) { const b = $('#tabs [data-tab="' + t + '"]'); if (b) { b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 500 }); } };
UI.setSpeed = function (n) {
  if (!S) return;
  if (n === 0) S.paused = !S.paused; else { S.paused = false; S.speed = n; }
  UI.updateTop();
};
UI.toggleCover = function (on) {
  S.settings.cover = on === undefined ? !S.settings.cover : on; R.showCoverage(S.settings.cover); $('#btnCover').classList.toggle('on', S.settings.cover);
  if (S.settings.cover) { Net.dirty = true; }
};
UI.key = function (e) {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) return;
  if (e.key === 'Escape') { const m = $('#modalRoot .mback:last-child'); if (m) { m._close && m._close(); return; } if (Game.place) { UI.endPlacement(); return; } if (UI.sel) UI.select(null); return; }
  if (Game.mode !== 'play' || !S || UI.mc) return;
  if (e.key === ' ') { e.preventDefault(); UI.setSpeed(0); }
  else if (e.key === '1' || e.key === '2' || e.key === '3') UI.setSpeed(SPEEDS[+e.key - 1]);
  else if (e.key.toLowerCase() === 'm') UI.toggleCover();
  else if (e.key.toLowerCase() === 'h') R.resetCamera(false);
};

/* ---------- toasts og mini-logg ---------- */
UI.toast = function (msg, kind) {
  const root = $('#toasts'); while (root.children.length >= 3) root.firstChild.remove();
  root.style.marginTop = Game.place ? '112px' : '';
  const t = el('<div class="toast ' + (kind || '') + '">' + esc(msg) + '</div>'); root.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 600); }, 3800);
};
UI.pushMini = function (e) {
  const root = $('#miniLog'); if (Game.mode !== 'play') return;
  const tgc = e.tg.startsWith('SAMVIRKE') ? 'SAMVIRKE' : e.tg;
  const n = el('<div class="mlog"><span class="tg ' + tgc + '">' + esc(e.tg) + '</span>' + esc(e.from) + ': ' + esc(e.msg) + '</div>');
  root.appendChild(n); while (root.children.length > 4) root.firstChild.remove();
  setTimeout(() => { n.classList.add('old'); setTimeout(() => n.remove(), 900); }, 9000);
};
UI.alarmBar = function () {
  const bar = $('#alarmBar'); if (!S) return;
  const act = S.net.alarms.filter(a => !a.done);
  bar.innerHTML = act.map(al => { const u = S.units[al.unitId], inc = S.incidents[al.incId]; if (!u) return ''; return '<div class="alarm" data-al="' + al.id + '">' + icon('warn') + '<div><b>NØDKNAPP: ' + esc(u.name) + '</b><small>' + esc(inc ? inc.loc.addr : '') + ' · ' + Math.max(0, Math.ceil(al.deadline - S.t)) + ' min igjen</small></div><button class="btn xs" data-help="' + al.id + '">Send hjelp</button></div>'; }).join('');
  $$('[data-help]', bar).forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); const al = S.net.alarms.find(a => a.id == b.dataset.help); const r = Sim.sendHelp(al); UI.toast(r.msg, r.ok ? 'good' : 'bad'); UI.alarmBar(); }));
};

/* ---------- dialoger ---------- */
UI.modal = function (o) {
  const root = $('#modalRoot'), back = document.createElement('div'); back.className = 'mback';
  back.innerHTML = '<div class="modal glass"><h2>' + (o.title || '') + '</h2><div class="body">' + (o.html || '') + '</div><div class="btns"></div></div>';
  const h = { el: back, body: $('.body', back), closed: false, close() { if (h.closed) return; h.closed = true; back.remove(); UI.mc--; if (UI.mc === 0) { if (S && UI._wasPaused === false && Game.mode === 'play') S.paused = false; UI._wasPaused = null; } if (o.onClose) o.onClose(); } };
  back._close = () => h.close();
  const btns = $('.btns', back);
  (o.buttons || [{ label: 'Lukk' }]).forEach(b => {
    const bt = document.createElement('button'); bt.className = 'btn ' + (b.cls || ''); bt.innerHTML = b.label;
    bt.addEventListener('click', () => { if (b.fn && b.fn(h) === false) return; h.close(); }); btns.appendChild(bt);
  });
  back.addEventListener('pointerdown', e => { if (e.target === back && o.dismiss !== false) h.close(); });
  root.appendChild(back);
  if (UI.mc === 0) { UI._wasPaused = S && Game.mode === 'play' ? S.paused : null; if (S && Game.mode === 'play') S.paused = true; }
  UI.mc++; if (o.init) o.init(h);
  return h;
};
/** Bekreftelsesdialog (erstatter confirm). */
UI.ask = function (title, msg, ok, cancel, danger) {
  return new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    UI.modal({ title, html: '<p>' + msg + '</p>', onClose: () => fin(false), buttons: [{ label: cancel || 'Avbryt', cls: 'ghost', fn: () => { fin(false); } }, { label: ok || 'OK', cls: danger ? 'clay' : 'primary', fn: () => { fin(true); } }] });
  });
};
/** Liste-dialog: velg ett element. */
UI.choose = function (o) {
  const html = (o.intro ? '<p class="muted">' + o.intro + '</p>' : '') + o.items.map((it, i) => '<button class="opt' + (it.disabled ? ' dis' : '') + '" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '><div class="av" style="background:' + (it.color || '#7b9a79') + '">' + icon(it.ic || 'check') + '</div><div class="grow"><div class="b">' + it.label + '</div><div class="sm muted">' + (it.sub || '') + '</div></div>' + (it.right ? '<div class="price">' + it.right + '</div>' : '') + '</button>').join('');
  UI.modal({ title: o.title, html, buttons: [{ label: 'Avbryt', cls: 'ghost' }], init: h => { $$('.opt', h.body).forEach(b => b.addEventListener('click', () => { const it = o.items[+b.dataset.i]; h.close(); o.onPick(it.id); })); } });
};
UI.res = r => { UI.toast(r.msg, r.ok ? 'good' : 'bad'); UI.dirty = true; if (r.ok) Store.save(); return r; };

UI.levelUp = function (d) {
  const ul = d.unlocks.length ? '<p class="b">Låst opp:</p><div class="row wrap">' + d.unlocks.map(u => chip(esc(u), 'ok')).join('') + '</div>' : '';
  UI.modal({ title: 'Nytt nivå: ' + d.rank.navn, html: '<p>Du er nå <b>' + esc(d.rank.navn) + '</b> (nivå ' + d.level + '). Større hendelser og flere enheter er tilgjengelige.</p>' + ul, buttons: [{ label: 'Videre', cls: 'primary' }] });
};
UI.help = function () {
  UI.modal({ title: 'Slik spiller du', html:
    '<p><b>Mål:</b> Hold beredskapsnivået oppe ved å ta imot hendelser og sende riktige enheter raskt.</p>'
    + '<p><b>1.</b> Trykk på en hendelse (kart eller liste) og velg <i>Send enheter</i>. Nærmeste ledige enhet foreslås. <i>Velg selv</i> lar deg bestemme.</p>'
    + '<p><b>2.</b> Alvorlige hendelser (trippelvarsling) trenger flere etater. Har du ikke etaten, kan du <i>be om bistand</i> fra nabodistriktet mot betaling – det tar lengre tid.</p>'
    + '<p><b>3.</b> Alt går over <b>Nødnett</b>. Enheter uten dekning blir grå og får ordre senere. Bygg flere master, og opprett <i>samvirke-talegruppe</i> når flere etater jobber sammen.</p>'
    + '<p><b>Oppdrag og penger:</b> Antall oppdrag følger hvor mange enheter du har i hver etat, og de skjer mest i distriktet rundt stasjonene dine – likt på alle hastigheter. Kjøp flere enheter for flere oppdrag og mer inntekt. Driftstilskuddet dekker nesten alle faste kostnader når beredskapen er god.</p>'
    + '<p><b>4.</b> <b>Frivillige</b> (Røde Kors, Folkehjelp, strandlivreddere) er billigere, men bruker tid på å mobilisere. De gir bonus på beredskapsnivået. Book sanitetsvakt på arrangementer i kalenderen.</p>'
    + '<p><b>Styring:</b> dra for å flytte, klyp/hjul for å zoome, to fingre eller høyre museknapp for å rotere. Mellomrom = pause, 1/2/3 = fart, M = dekningslag.</p>', buttons: [{ label: 'Skjønner', cls: 'primary' }] });
};
UI.menu = function () {
  const cfg = WORLD.cfg;
  UI.modal({ title: 'Meny · ' + cfg.navn, html:
    '<div class="seg" style="flex-wrap:wrap"><button data-m="help">' + icon('doc') + ' Hjelp</button><button data-m="save">' + icon('check') + ' Lagre nå</button><button data-m="auto" class="' + (S.settings.auto ? 'on' : '') + '">Autodisponering: ' + (S.settings.auto ? 'på' : 'av') + '</button></div>'
    + '<div class="seg" style="flex-wrap:wrap"><button data-m="base">Bunnkart: ' + (R.base === 'kart' ? 'tegnet kart' : 'satellitt') + '</button><button data-m="gfx">Grafikk: ' + (Game.lowGfx ? 'lav' : Game.ultra ? 'ultra' : 'høy') + '</button><button data-m="filter">Filter: ' + (Grade.soft ? 'av (uten skjermkort)' : Grade.on && !Grade.paused ? 'realistisk' : 'av') + '</button><button data-m="lyd">Lyd: ' + (Sound.on ? 'på' : 'av') + '</button><button data-m="city">Bytt by</button><button data-m="new">Ny runde i ' + esc(cfg.navn) + '</button></div>'
    + '<p class="muted sm">Spillet lagres automatisk i nettleseren (egen lagring per by).</p>', buttons: [{ label: 'Fortsett', cls: 'primary' }],
    init: h => { $$('[data-m]', h.body).forEach(b => b.addEventListener('click', async () => {
      const m = b.dataset.m;
      if (m === 'help') { h.close(); UI.help(); }
      else if (m === 'save') { Store.save(true); UI.toast('Spillet er lagret', 'good'); }
      else if (m === 'auto') { S.settings.auto = !S.settings.auto; h.close(); UI.toast('Autodisponering ' + (S.settings.auto ? 'påslått – nærmeste enheter sendes automatisk' : 'avslått'), 'info'); }
      else if (m === 'base') { R.setBase(R.base === 'kart' ? 'sat' : 'kart'); h.close(); }
      else if (m === 'lyd') { const on = Sound.toggle(); h.close(); UI.toast('Lyd ' + (on ? 'på' : 'av'), 'info'); }
      else if (m === 'gfx') {   // ultra → høy → lav → ultra
        const next = Game.lowGfx ? 'ultra' : Game.ultra ? 'høy' : 'lav'; Game.ultra = next === 'ultra'; Game.lowGfx = next === 'lav'; City.lite = false; Game.slow = 0;
        try { localStorage.setItem('nodbyen.gfx', next); } catch (e) { /* ignorer */ }
        R.applyGfx(); R.initTraffic(); City.lastKey = ''; h.close(); UI.toast('Grafikk: ' + (next === 'lav' ? 'lav (sparer batteri)' : next === 'ultra' ? 'ultra (skarpest)' : 'høy'), 'info'); }
      else if (m === 'filter') { Grade.paused = false; const on = Grade.toggle(); h.close(); UI.toast('Realistisk bildefilter ' + (on ? 'på' : 'av'), 'info'); }
      else if (m === 'city') { h.close(); Store.save(true); Game.toMenu(); }
      else if (m === 'new') { h.close(); if (await UI.ask('Ny runde?', 'Dette starter på nytt i ' + esc(cfg.navn) + ' og overskriver lagringen.', 'Start på nytt', 'Avbryt', true)) { Store.clear(S.city); Game.toMenu(S.city); } }
    })); } });
};

/* ---------- startflyt: by → etat → første stasjon ---------- */
UI.showScreen = function (html) { $('#screens').innerHTML = html; };
UI.hideScreen = function () { $('#screens').innerHTML = ''; };
UI.showLoading = function (msg) { UI.showScreen('<div class="screen"><div class="inner" style="max-width:420px;text-align:center"><div class="logo"><h1>Nød<span>Byen</span></h1><p>' + esc(msg) + '</p></div><div class="bar"><i class="indet"></i></div><p class="muted sm" style="margin-top:12px">Første gang kan det ta litt tid. Neste gang går det raskere.</p></div></div>'); };
UI.screenCities = function (selectedCity) {
  Game.mode = 'menu'; $('#hud').classList.add('hidden'); $('#panel').classList.add('hidden'); $('#miniLog').innerHTML = ''; R.setLabels([]); R.setSelection(null); R.setPlacement(null); R.showCoverage(false);
  const cards = cityList().map(c => {
    const sv = Store.peek(c.id);
    return '<div class="ccard glass"><h2>' + esc(c.navn) + '</h2><div class="tag">' + esc(c.tagline) + ' · ' + 'ekte 3D-kart</div>'
      + '<div class="row wrap">' + chip(icon('gauge') + ' ' + c.vanskelighet, c.vanskelighet === 'Enkel' ? 'ok' : 'p2') + c.egenskaper.map(e => chip(esc(e), 'mute')).join('') + '</div>'
      + '<p>' + esc(c.beskrivelse) + '</p><div class="actions">'
      + (sv ? '<button class="btn primary" data-city="' + c.id + '" data-go="continue">Fortsett · dag ' + sv.day + ' · ' + fmtKr(sv.money) + '</button>' : '')
      + '<button class="btn ' + (sv ? '' : 'primary') + '" data-city="' + c.id + '" data-go="new">' + (sv ? 'Ny runde' : 'Spill ' + esc(c.navn)) + '</button></div></div>';
  }).join('');
  UI.showScreen('<div class="screen"><div class="inner"><div class="logo"><h1>Nød<span>Byen</span></h1><p>Hold beredskapen oppe – med 110, 112, 113, de frivillige og Nødnett.</p></div>'
    + '<div class="citycards">' + cards + '</div>'
    + '<div class="seg" id="seasonPick" style="margin:16px auto 0;width:max-content;max-width:100%"><span class="muted sm" style="align-self:center;padding:0 10px">Startårstid</span>' + SEASONS.map((s, i) => '<button data-season="' + i + '" class="' + (i === UI.season ? 'on' : '') + '">' + icon(s.ikon) + ' ' + s.navn + '</button>').join('') + '</div>'
    + '<p class="muted sm" style="text-align:center;margin-top:10px">Sommer gir strandlivreddere i Oslo. Vinter gir glatte veier og flere branner.</p></div></div>');
  $$('#screens [data-go]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.city;
    if (b.dataset.go === 'continue') { Game.continueCity(id); return; }
    if (Store.peek(id) && !(await UI.ask('Overskrive lagring?', 'Det finnes et lagret spill i ' + esc(CITY_CONFIGS[id].navn) + '. En ny runde overskriver det.', 'Start ny runde', 'Avbryt', true))) return;
    Store.clear(id); Game.pickAgency(id);
  }));
  $$('#screens [data-season]').forEach(b => b.addEventListener('click', () => { UI.season = +b.dataset.season; $$('#seasonPick [data-season]').forEach(x => x.classList.toggle('on', +x.dataset.season === UI.season)); }));
};
UI.screenAgency = function (cityId) {
  const cfg = CITY_CONFIGS[cityId];
  UI.showScreen('<div class="screen"><div class="inner"><div class="logo"><h1>' + esc(cfg.navn) + '</h1><p>Velg første etat. Du kan kjøpe de andre senere.</p></div>'
    + '<div class="agcards">' + ETATER.map(a => { const A = AGENCIES[a]; return '<button class="acard glass" data-ag="' + a + '"><div class="big" style="background:' + A.farge + '">' + icon(A.ikon) + '</div><div class="nr">' + A.nr + '</div><h3>' + A.navn + '</h3><div class="muted sm">' + A.sentral + '</div><p>' + A.tekst + '</p></button>'; }).join('')
    + '</div><div class="actions" style="justify-content:center;margin-top:16px"><button class="btn" data-back="1">' + icon('up') + ' Tilbake</button></div></div></div>');
  $$('#screens [data-ag]').forEach(b => b.addEventListener('click', () => Game.beginFirstStation(cityId, b.dataset.ag)));
  $('#screens [data-back]').addEventListener('click', () => UI.screenCities());
};

/* ---------- plassering av bygg på tomter ---------- */
UI.beginPlacement = function (o) {
  // o: {title, hint, lots | ground, costText, onConfirm(lotId|{x,z}), onCancel}
  Game.place = Object.assign({ sel: null }, o);
  Game.place.prevCover = !!S.settings.cover;
  if (Game.mode === 'play') { Game.place.wasPaused = S.paused; S.paused = true; }
  R.setPlacement(o.ground ? { ground: true } : { lots: o.lots });
  UI.toggleCover(true);
  UI.placeBar();
  $('#hud').classList.remove('hidden');
};
UI.placeBar = function () {
  const p = Game.place, bar = $('#placeBar'); if (!p) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const sel = p.sel;
  bar.innerHTML = '<div class="b">' + p.title + '</div><div class="sm muted">' + (sel ? esc(sel.addr) + ' · ' + (sel.cov || '') : p.hint) + '</div>'
    + '<div class="row">' + (sel ? '<button class="btn primary" id="pbOk">' + icon('check') + ' Bygg her' + (p.costText ? ' · ' + p.costText : '') + '</button>' : '') + '<button class="btn" id="pbCancel">Avbryt</button></div>';
  const ok = $('#pbOk'); if (ok) ok.addEventListener('click', UI.confirmPlacement);
  $('#pbCancel').addEventListener('click', () => UI.endPlacement(true));
};
UI.confirmPlacement = function () {
  const p = Game.place; if (!p || !p.sel) return;
  let made = null, arg;
  if (p.ground) arg = { x: p.sel.x, z: p.sel.z };
  else if (p.sel.dyn) { const lot = Sim.createLot(p.sel.x, p.sel.z); if (!lot) { UI.toast('Kan ikke bygge her – for langt fra en vei.', 'warn'); return; } made = lot.id; arg = lot.id; }
  else arg = p.sel.id;
  const done = p.onConfirm(arg);
  if (done === false) { if (made) Sim.dropLot(made); return; }       // kjøpet feilet: ikke la en ubrukt tomt bli liggende
  UI.endPlacement(false);
};
UI.endPlacement = function (cancelled) {
  const p = Game.place; if (!p) return; Game.place = null;
  R.setPlacement(null); R.setSelection(UI.sel); $('#placeBar').classList.add('hidden');
  if (S) UI.toggleCover(p.prevCover);
  if (window.innerWidth < 900 && UI._sheetBefore != null) { UI.setSheet(UI._sheetBefore); UI._sheetBefore = null; }
  if (S && Game.mode === 'play') S.paused = p.wasPaused === undefined ? S.paused : p.wasPaused;
  if (cancelled && p.onCancel) p.onCancel();
  UI.updateTop();
};
/** Tap under plassering: velg tomt (eller et punkt på bakken). */
UI.placeTap = function (px, py, touch) {
  const p = Game.place; if (!p) return;
  if (p.ground) {
    const g = R.terrainPoint(px, py); if (!g || !WORLD.landAt(g.x, g.z)) { UI.toast('Velg et punkt på land', 'warn'); return; }
    const sig = Net.quality(Net.signalAt(g.x, g.z));
    p.sel = { x: g.x, z: g.z, addr: 'Valgt punkt', cov: 'Dekning: ' + sig }; UI.placeBar(); UI.markPlace(g.x, g.z); return;
  }
  const hit = R.pick(px, py, touch, S || { incidents: {}, units: {}, stations: {}, net: { masts: {} } });
  if (!hit) {   // fri plassering: trykk hvor som helst nær en vei – spillet finner ledig plass ved siden av
    const g = R.terrainPoint(px, py), spot = g && Sim.findSpot(g.x, g.z), nr = spot && WORLD.nav.nearestRP(spot.x, spot.z, true);
    if (!spot || !nr) { UI.toast('Ingen plass her – prøv nærmere en vei, og ikke i vannet.', 'warn'); return; }
    const q = Net.quality(Net.signalAt(spot.x, spot.z));
    p.sel = { dyn: true, x: spot.x, z: spot.z, addr: WORLD.addrOf({ a: nr.a, b: nr.b, e: nr.e, t: nr.t }, 0), cov: 'Nødnett: ' + (q === 'bra' ? 'god dekning' : q === 'svak' ? 'svak dekning' : 'ingen dekning') };
    UI.markPlace(spot.x, spot.z); UI.placeBar(); return;
  }
  const lot = WORLD.lotById.get(hit.id); if (!lot) return;
  const q = Net.quality(Net.signalAt(lot.x, lot.z));
  p.sel = { id: lot.id, x: lot.x, z: lot.z, addr: lot.addr, cov: 'Nødnett: ' + (q === 'bra' ? 'god dekning' : q === 'svak' ? 'svak dekning' : 'ingen dekning') };
  UI.markPlace(lot.x, lot.z); UI.placeBar();
};
UI.markPlace = function (x, z) { R.ensureOverlay(); R.selRing.visible = true; R.selRing.position.set(x, 1.5, z); R.selRing.scale.setScalar(Math.max(26, 34 * R.mpp)); R.placeMark = { x, z }; };

/* ---------- valg i kartet og lister ---------- */
UI.select = function (sel, focus) {
  UI.sel = sel; R.setSelection(sel); UI.dirty = true;
  if (!sel) return;
  const tab = { incident: 'hendelser', unit: 'enheter', station: 'stasjoner', mast: 'nodnett', beach: 'frivillige' }[sel.type];
  if (tab) { UI.setTab(tab); if (UI.sheet === 0) UI.setSheet(1); }
  UI._scrollTo = sel.type + '-' + sel.id;
  if (focus) UI.focusSel(sel);
};
UI.focusSel = function (sel) {
  let x, z;
  if (sel.type === 'incident' && S.incidents[sel.id]) { x = S.incidents[sel.id].loc.x; z = S.incidents[sel.id].loc.z; }
  else if (sel.type === 'unit' && S.units[sel.id]) { const u = S.units[sel.id]; const p = u.contact === 'ingen' && u.lastKnown ? u.lastKnown : u; x = p.x; z = p.z; }
  else if (sel.type === 'station' && S.stations[sel.id]) { const l = WORLD.lotById.get(S.stations[sel.id].lotId); x = l.x; z = l.z; }
  else if (sel.type === 'mast' && S.net.masts[sel.id]) { x = S.net.masts[sel.id].x; z = S.net.masts[sel.id].z; }
  else if (sel.type === 'beach') { x = WORLD.beaches[sel.id].x; z = WORLD.beaches[sel.id].z; }
  if (x !== undefined) R.focus(x, z, sel.type === 'mast' ? 120 : 85);
};
UI.selLabel = function () {
  const sel = UI.sel; if (!sel || !S) return null;
  if (sel.type === 'incident' && S.incidents[sel.id]) { const i = S.incidents[sel.id]; return { text: i.navn + ' · ' + fmtDur(S.t - i.t0), x: i.loc.x, z: i.loc.z, y: 50 }; }
  if (sel.type === 'unit' && S.units[sel.id]) { const u = S.units[sel.id], p = u.contact === 'ingen' && u.lastKnown ? u.lastKnown : u; return { text: u.name + ' · ' + STATUS_NAVN[u.status] + (u.contact === 'ingen' ? ' (uten dekning)' : ''), x: p.x, z: p.z, y: 9 }; }
  if (sel.type === 'station' && S.stations[sel.id]) { const st = S.stations[sel.id], l = WORLD.lotById.get(st.lotId); return { text: st.name, x: l.x, z: l.z, y: 24 }; }
  if (sel.type === 'mast' && S.net.masts[sel.id]) { const m = S.net.masts[sel.id]; return { text: m.navn + ' · ' + Math.round(m.load * 100) + ' % belastet' + (m.down ? ' · utfall' : ''), x: m.x, z: m.z, y: 48 }; }
  if (sel.type === 'beach') { const b = WORLD.beaches[sel.id]; return { text: b.navn, x: b.x, z: b.z, y: 14 }; }
  return null;
};

/* ---------- topplinje ---------- */
UI.updateTop = function () {
  if (!S || !WORLD) return;
  const c = Clock.cur || Clock.info();
  $('#tbCity').textContent = WORLD.cfg.navn;
  $('#tbSeason').innerHTML = icon(SEASONS[c.season].ikon) + ' ' + Clock.label() + ' <span title="' + WEATHER[S.weather.kind].navn + '">' + icon(WEATHER[S.weather.kind].ikon) + '</span>';
  $('#tbTime').textContent = fmtClock(c.mod);
  const m = $('#tbMoneyV'); m.textContent = fmtKr(S.money); $('#tbMoney').classList.toggle('neg', S.money < 0);
  const r = Math.round(S.ready || 0); $('#tbReadyV').textContent = r + ' %';
  const ring = $('#tbRing'); ring.setAttribute('stroke-dasharray', (r / 100 * 56.55).toFixed(1) + ' 100'); ring.style.stroke = r > 70 ? '#7b9a79' : r > 45 ? '#E4AE4E' : '#D9695A';
  const act = Sim.active(), late = act.filter(i => !i.onScene && S.t - i.t0 > i.target).length;
  $('#tbIncV').textContent = act.length; $('#tbInc').className = 'tbc clickable' + (late ? ' hot' : act.length ? ' has' : '');
  const ns = Net.status(); $('#tbNetDot').className = 'dot ' + (ns === 'g' ? '' : ns);
  $$('#tbSpeed button').forEach(b => { const sp = +b.dataset.sp; b.classList.toggle('on', sp === 0 ? S.paused : (!S.paused && S.speed === sp)); });
  const badge = a => { const n = a; return n ? '<span class="badge' + (late ? '' : ' y') + '">' + n + '</span>' : ''; };
  const hb = $('#tabs [data-tab="hendelser"]'); if (hb) { const o = hb.querySelector('.badge'); if (o) o.remove(); if (act.length) hb.insertAdjacentHTML('beforeend', '<span class="badge' + (late ? '' : ' y') + '">' + act.length + '</span>'); }
  const nb = $('#tabs [data-tab="nodnett"]'); if (nb) { const o = nb.querySelector('.badge'); if (o) o.remove(); const al = S.net.alarms.filter(a => !a.done).length; if (al) nb.insertAdjacentHTML('beforeend', '<span class="badge">' + al + '</span>'); }
};
UI.update = function (dt) {
  UI.tick += dt;
  if (Game.mode !== 'play' || !S) return;
  if (UI.tick > 0.45) {
    UI.tick = 0; UI.updateTop(); UI.alarmBar(); UI.layout(); Radio.chatter();
    if (UI.mc === 0) UI.renderTab();
    // etiketter i kartet
    const labels = [], sl = UI.selLabel();
    if (R.cam.dist < 260) for (const id in WORLD.beaches) { const b = WORLD.beaches[id]; labels.push({ key: 'b' + id, text: b.navn, x: b.x, y: 14, z: b.z, cls: 'strandl', maxDist: 260 }); }
    for (const id in S.stations) { const st = S.stations[id], l = WORLD.lotById.get(st.lotId); if (ST[st.type].rolle === 'helse') labels.push({ key: 's' + id, text: st.name, x: l.x, y: 30, z: l.z, maxDist: 150 }); }
    if (sl) labels.push({ key: 'sel', text: sl.text, x: sl.x, y: sl.y, z: sl.z, cls: 'sel' });
    R.setLabels(labels);
  }
};


/* ---------- felles hjelpere for fanene ---------- */
UI.whenText = function (tStart, tEnd) {
  if (S.t >= tStart && S.t <= tEnd) return 'pågår nå';
  const d = tStart - S.t; return d < 60 ? 'om ' + Math.round(d) + ' min' : d < 1440 ? 'om ' + Math.floor(d / 60) + ' t ' + Math.round(d % 60) + ' min' : 'om ' + (d / 1440).toFixed(1).replace('.', ',') + ' døgn';
};
UI.remaining = function (u) {
  if (u.phase !== 'drive') return null;
  let d = 0, x = u.x, z = u.z;
  for (let i = u.pi; i < u.path.length; i++) { d += Math.hypot(u.path[i].x - x, u.path[i].z - z) / (u.path[i].m || 1); x = u.path[i].x; z = u.path[i].z; }
  return d / Sim.speedOf(u) + (u.hold > 0 ? u.hold : 0);
};
UI.unitState = function (u) {
  switch (u.status) {
    case 'ledig': return Staff.ready(u) ? 'Ledig' : 'Mangler mannskap';
    case 'varslet': return 'Varslet';
    case 'mobiliserer': return 'Mobiliserer · ca. ' + Math.max(1, Math.ceil(u.wait)) + ' min';
    case 'utrykning': { if (u.phase === 'walk') return 'Fremføring (båt/til fots) · ' + Math.ceil(u.wait) + ' min'; const r = UI.remaining(u); return r == null ? 'Utrykning' : 'Utrykning · fremme om ' + Math.max(1, Math.ceil(r)) + ' min'; }
    case 'pastedet': return 'På stedet';
    case 'transport': return u.phase === 'handover' ? 'Overleverer pasient' : 'Transport til sykehus';
    case 'arrest': return u.phase === 'handover' ? 'Leverer pågrepet' : 'Arrest · transport';
    case 'retur': { const r = UI.remaining(u); return 'Retur' + (r != null ? ' · ' + Math.max(1, Math.ceil(r)) + ' min' : ''); }
    case 'ute': return 'Utilgjengelig (mannskap skadet)';
  }
  return STATUS_NAVN[u.status];
};
UI.statusCls = st => ({ ledig: 'ok', varslet: 'p2', mobiliserer: 'p2', utrykning: 'p2', pastedet: 'brann', transport: 'ambulanse', arrest: 'politi', retur: 'mute', ute: 'bad' }[st] || 'mute');
UI.sigHtml = u => '<span class="sig ' + (u.contact || 'bra') + '" title="Dekning: ' + (u.contact || 'bra') + '"><i></i><i></i><i></i><i></i></span>';
UI.suggestFor = function (inc) {
  const now = performance.now(), key = inc.slots.map(s => s.units.length).join(','), c = UI.sug[inc.id];
  if (c && now - c.t < 1500 && c.key === key) return c.v;
  const v = Sim.suggest(inc, false); UI.sug[inc.id] = { t: now, v, key }; return v;
};
UI.optHint = function (inc, s) {
  const c = Sim.candidates(inc, s)[0]; return c ? c : null;
};
UI.slotChip = function (inc, s) {
  const arr = Sim.slotArrived(inc, s), asg = s.units.length, label = esc(s.label) + (s.n > 1 ? ' ×' + s.n : '');
  if (arr >= s.n) return '<span class="slot ok">' + icon('check') + ' ' + label + '</span>';
  if (asg > 0) {
    const u = S.units[s.units[0]], st = u ? (u.status === 'varslet' || u.status === 'mobiliserer' ? 'mobiliserer' : (UI.remaining(u) != null ? Math.max(1, Math.ceil(UI.remaining(u))) + ' min' : 'på vei')) : '';
    return '<span class="slot en">' + icon('truck') + ' ' + label + (s.n > 1 ? ' ' + arr + '/' + s.n : '') + ' · ' + st + '</span>';
  }
  if (!s.req) {
    const need = s.accepts.some(t => (UT[t].org === 'rk' && !S.vol.rk) || (UT[t].org === 'nf' && !S.vol.nf)) && !s.accepts.some(t => ETATER.includes(UT[t].org) && S.agencies[UT[t].org]);
    const c = need ? null : UI.optHint(inc, s);
    return '<button class="slot opt" data-act="addopt" data-id="' + inc.id + '" data-k="' + s.k + '">' + icon('plus') + ' ' + label + (c ? ' · ' + Math.ceil(c.eta) + ' min' : need ? ' · krever avtale' : ' · ingen ledig') + '</button>';
  }
  return '<span class="slot miss">' + icon('x') + ' ' + label + '</span>';
};
UI.incCard = function (inc) {
  const age = S.t - inc.t0, late = !inc.onScene && age > inc.target, sel = UI.sel && UI.sel.type === 'incident' && UI.sel.id === inc.id;
  const ags = [...new Set(inc.slots.filter(s => s.req).map(s => s.ag))];
  const col = age / inc.target < 0.7 ? '#7b9a79' : age / inc.target < 1 ? '#E4AE4E' : '#D9695A';
  const missing = inc.slots.filter(s => s.req && s.units.length < s.n), noneAssigned = missing.filter(s => s.units.length === 0);
  const fresh = !UI.seen.has(inc.id); UI.seen.add(inc.id);
  let h = '<div class="card p' + inc.pri + (late ? ' late' : '') + (sel ? ' sel' : '') + (fresh ? ' fresh' : '') + '" id="incident-' + inc.id + '" data-act="selinc" data-id="' + inc.id + '"><div class="stripe"></div>';
  h += '<div class="row"><div class="grow"><h4>' + esc(inc.navn) + '</h4><div class="addr">' + icon('pin') + ' ' + esc(inc.loc.addr) + (inc.island ? ' · øy – trenger båt eller helikopter' : '') + '</div>' + (inc.caller ? '<div class="xs muted" style="margin-top:2px">«' + esc(inc.caller) + '»</div>' : '') + '</div>' + priChip(inc) + '</div>';
  h += '<div class="row wrap" style="margin-top:6px">' + (inc.rt != null ? chip(icon('check') + ' Responstid ' + fmtDur(inc.rt), inc.rt <= inc.target ? 'ok' : 'bad') : chip(icon('clock') + ' ' + fmtDur(age) + ' siden varsling · mål ' + fmtDur(inc.target), late ? 'bad' : 'mute'))
    + (inc.tri ? chip('Trippelvarsling', 'net') : '') + ags.filter(a => a !== 'frivillig').map(a => chip(AGENCIES[a].kort, a)).join('') + (inc.tg ? chip(icon('radio') + ' ' + inc.tg, 'net') : chip(inc.lead === 'brann' ? 'BRANN' : inc.lead === 'politi' ? 'POLITI' : 'HELSE', 'mute')) + (inc.bistand ? chip('Bistand', 'mute') : '') + '</div>';
  if (!inc.onScene) h += '<div style="margin-top:8px">' + barHtml(age / inc.target, col) + '</div>';
  else h += '<div style="margin-top:8px" class="sm muted b">Arbeid pågår ' + Math.round(100 * inc.progress / inc.work) + ' %' + barHtml(inc.progress / inc.work, '#7b9a79') + '</div>';
  h += '<div class="slotline">' + inc.slots.map(s => UI.slotChip(inc, s)).join('') + '</div>';
  if (missing.length) {
    const sug = UI.suggestFor(inc), ok = sug.filter(x => x.u);
    if (ok.length) h += '<div class="xs muted">Foreslått: ' + ok.map(x => esc(x.u.name) + ' (' + Math.ceil(x.eta) + ' min)').join(', ') + '</div>';
    h += '<div class="actions">';
    if (ok.length) h += '<button class="btn primary sm" data-act="send" data-id="' + inc.id + '">' + icon('truck') + ' Send enheter · ' + Math.ceil(Math.max(...ok.map(x => x.eta))) + ' min</button><button class="btn sm" data-act="pick" data-id="' + inc.id + '">Velg selv</button>';
    if (sug.some(x => !x.u) || !ok.length) h += '<button class="btn warn sm" data-act="bistand" data-id="' + inc.id + '">Be om bistand</button>';
  } else h += '<div class="actions">';
  if (ags.length >= 2 && !inc.tg) { const free = Net.vhf() ? null : Net.samvFree(); h += '<button class="btn net sm' + (free ? '' : ' dis') + '" data-act="samv" data-id="' + inc.id + '">' + icon('radio') + (Net.vhf() ? ' Samvirke krever Nødnett' : free ? ' Bruk ' + free : ' Alle samvirke-grupper opptatt') + '</button>'; }
  h += '<button class="btn ghost sm" data-act="focusinc" data-id="' + inc.id + '">' + icon('pin') + ' Vis</button></div></div>';
  return h;
};
/** Nødsentralene (AMK 113, 110, 112): operatører, kø og innkommende anrop. */
UI.centrals = function () {
  let h = '<div class="card central"><div class="row wrap" style="gap:6px">';
  for (const a of ETATER) if (S.agencies[a]) { const q = S.calls.filter(c => c.ag === a && c.state === 'ringer').length, b = Sim.callsBusy(a); h += chip(icon(AGENCIES[a].ikon) + ' ' + CENTRAL[a] + ' ' + AGENCIES[a].nr + ' · ' + b + '/' + S.ops[a] + ' i samtale' + (q ? ' · ' + q + ' i kø' : ''), q ? 'p2' : 'mute'); }
  h += '</div>';
  for (const c of S.calls) {
    const T = TEMPLATES[c.tpl], ring = c.state === 'ringer', wait = S.t - c.t0;
    h += '<div class="call' + (ring ? ' ring' : '') + '"><div class="av" style="background:' + AGENCIES[c.ag].farge + '">' + icon(ring ? 'phone' : 'headset') + '</div><div class="grow"><b class="sm">' + (ring ? 'Anrop til ' + CENTRAL[c.ag] + ' · venter ' + fmtDur(wait) : (c.op === 'player' ? 'Du snakker med innringer' : 'Operatør snakker med innringer')) + '</b><div class="xs muted">«' + esc(c.text) + '» · ' + esc(c.place.addr) + '</div></div>'
      + (ring ? '<button class="btn primary xs" data-act="answer" data-id="' + c.id + '">Svar</button>' : '') + '</div>';
  }
  if (!S.calls.length) h += '<div class="xs muted" style="margin-top:6px">Ingen anrop i kø. Flere operatørplasser (Butikk → Nødnett) gir kortere ventetid når det er travelt.</div>';
  return h + '</div>';
};
UI.tabHendelser = function () {
  const act = Sim.active().sort((a, b) => a.pri - b.pri || a.t0 - b.t0);
  let h = UI.centrals() + Goals.card();
  if (!act.length) h += '<div class="empty">' + icon('shield') + 'Ingen aktive hendelser akkurat nå.<br>Bruk tiden til å bygge ut beredskapen i butikken.</div>';
  for (const inc of act) h += UI.incCard(inc);
  if (S.done.length) h += '<h3 class="sec">Nylig avsluttet</h3>' + S.done.slice(0, 5).map(d => '<div class="urow"><div class="av" style="background:' + (d.ok ? '#7b9a79' : '#D9695A') + '">' + icon(d.ok ? 'check' : 'x') + '</div><div class="grow"><b class="sm">' + esc(d.navn) + '</b><div class="xs muted">' + esc(d.addr) + ' · ' + esc(d.summary) + '</div></div><span class="price ' + (d.pay < 0 ? 'bad' : '') + '">' + (d.pay >= 0 ? '+' : '') + fmtKr(d.pay) + '</span></div>').join('');
  return h;
};

/* ---------- Enheter ---------- */
UI.unitRow = function (u) {
  const T = UT[u.type], org = u.bistand ? 'bistand' : T.org, sel = UI.sel && UI.sel.type === 'unit' && UI.sel.id === u.id;
  const inc = u.job && u.job.inc && S.incidents[u.job.inc];
  const job = inc ? esc(inc.navn) + ' · ' + esc(inc.loc.addr) : u.job && u.job.guard ? 'Sanitetsvakt' : '';
  const st = u.stationId && S.stations[u.stationId] ? S.stations[u.stationId].name : u.bistand ? 'Nabodistrikt' : u.beach ? WORLD.beaches[u.beach].navn : '';
  let h = '<div class="urow' + (sel ? ' sel' : '') + '" id="unit-' + u.id + '" data-act="selunit" data-id="' + u.id + '">' + avatar(org, T.model === 'heli' ? 'heli' : null);
  h += '<div class="grow"><b class="sm">' + esc(u.name) + '</b><div class="xs muted">' + chip(UI.unitState(u), UI.statusCls(u.status)) + (job ? ' ' + job : '') + '</div></div>' + UI.sigHtml(u) + '</div>';
  if (sel) {
    h += '<div class="card" style="margin:-2px 0 8px"><div class="kv"><span>Stasjon</span><span>' + esc(st) + '</span><span>Nødnett</span><span>' + ({ bra: 'God dekning', svak: 'Svak dekning', ingen: 'Ingen kontakt' }[u.contact || 'bra']) + (u.cong ? ' (overbelastet)' : '') + '</span><span>Samband</span><span>' + (Net.vhf() ? 'VHF-radio' : (T.term === 'h' ? 'Nødnett håndterminal' : 'Nødnett kjøretøyterminal') + ' nivå ' + S.net.termLevel) + '</span><span>Mannskap</span><span>' + (Staff.needs(u) ? Staff.of(u).map(p => esc(p.navn) + (p.k160 ? ' (160)' : '')).join(', ') || 'mangler' : T.crew + ' frivillige') + '</span></div>'
      + '<div class="actions"><button class="btn net sm" data-act="talk" data-id="' + u.id + '">' + icon('radio') + ' Snakk</button><button class="btn sm" data-act="follow" data-id="' + u.id + '">' + icon('eye') + (R.follow === u.id ? ' Følger' : ' Følg') + '</button>' + (u.job ? '<button class="btn sm" data-act="recall" data-id="' + u.id + '">Kall tilbake</button>' : '') + '<button class="btn ghost sm" data-act="focusunit" data-id="' + u.id + '">' + icon('pin') + ' Vis på kart</button></div></div>';
  }
  return h;
};
UI.tabEnheter = function () {
  const units = Object.values(S.units); let h = '';
  if (!units.length) return '<div class="empty">' + icon('truck') + 'Ingen enheter ennå. Kjøp enheter i butikken.</div>';
  const groups = [['brann', 'Brann og redning'], ['politi', 'Politi'], ['ambulanse', 'Ambulanse'], ['rk', 'Røde Kors Hjelpekorps'], ['nf', 'Norsk Folkehjelp Sanitet'], ['strand', 'Strandlivreddere'], ['bistand', 'Bistand fra nabodistriktet']];
  for (const [org, name] of groups) {
    const list = units.filter(u => (u.bistand ? 'bistand' : u.org) === org); if (!list.length) continue;
    h += '<h3 class="sec">' + name + ' · ' + list.filter(u => u.status === 'ledig').length + '/' + list.length + ' ledige</h3>' + list.map(UI.unitRow).join('');
  }
  return h;
};

/* ---------- Frivillige ---------- */
UI.tabFrivillige = function () {
  let h = '<h3 class="sec">Organisasjoner</h3>';
  for (const o of FRIVILLIGE) {
    if (o === 'strand' && !Object.keys(WORLD.beaches).length) continue;
    const A = AGENCIES[o], signed = S.vol[o], units = Object.values(S.units).filter(u => u.org === o);
    h += '<div class="card"><div class="row">' + avatar(o) + '<div class="grow"><h4>' + A.navn + '</h4><div class="sm muted">' + A.tekst + '</div></div></div>';
    if (!signed) h += '<div class="actions"><button class="btn primary sm" data-act="sign" data-id="' + o + '">Kjøp samarbeidsavtale · ' + fmtKr(ORG_COST[o]) + '</button></div>';
    else {
      h += '<div class="row wrap" style="margin-top:8px">' + chip('Avtale på plass', 'ok') + chip(units.length + ' enheter', 'mute') + (o !== 'strand' ? chip(Sim.stationList(o).length + ' baser', 'mute') : chip(Sim.staffedBeaches().length + ' bemannede strender', 'mute')) + '</div>';
      if (units.length) h += '<div class="slotline">' + units.map(u => '<span class="slot ' + (u.status === 'ledig' ? 'ok' : u.status === 'mobiliserer' || u.status === 'varslet' ? 'en' : '') + '">' + esc(u.name) + ' · ' + UI.unitState(u) + '</span>').join('') + '</div>';
      if (o !== 'strand') h += '<div class="actions"><button class="btn sm" data-act="buildbase" data-id="' + o + '">' + icon('house') + ' Bygg base · ' + fmtKr(ST[STATION_FOR_ORG[o]].cost) + '</button><button class="btn sm" data-act="shopcat" data-id="frivillig">' + icon('truck') + ' Kjøp utstyr</button></div>';
    }
    h += '</div>';
  }
  if (Object.keys(WORLD.beaches).length) {
    h += '<h3 class="sec">Badestrender' + (isSummer() ? '' : ' · sesongen er over') + '</h3>';
    for (const id in WORLD.beaches) {
      const b = WORLD.beaches[id], bs = S.beaches[id] || {}, sel = UI.sel && UI.sel.type === 'beach' && UI.sel.id === id;
      h += '<div class="urow' + (sel ? ' sel' : '') + '" id="beach-' + id + '" data-act="beach" data-id="' + id + '">' + avatar('strand') + '<div class="grow"><b class="sm">' + esc(b.navn) + '</b><div class="xs muted">' + (bs.staffed ? chip('Bemannet · ' + bs.n + ' livredder' + (bs.n > 1 ? 'e' : ''), 'ok') : chip('Ikke bemannet', 'mute')) + (b.island ? ' ' + chip('Øy · svak dekning', 'net') : '') + ' ' + Object.keys(BEACH_UP).filter(k => bs.up && bs.up[k]).map(k => chip(BEACH_UP[k].navn, 'strand')).join(' ') + '</div></div>' + icon('down') + '</div>';
    }
  }
  const up = Vol.upcoming();
  h += '<h3 class="sec">Kalender – kommende arrangementer</h3>';
  for (const o of up.slice(0, 5)) {
    const bk = Vol.booking(o.key), inProg = S.t >= o.tStart;
    h += '<div class="card"><div class="row"><div class="grow"><h4>' + icon('calendar') + ' ' + esc(o.ev.navn) + '</h4><div class="sm muted">' + (o.ev.stor) + ' arrangement · ' + SEASONS[o.ev.sesong].navn.toLowerCase() + ', dag ' + (o.ev.dag + 1) + ' · ' + fmtClock(o.ev.fra * 60) + '–' + fmtClock(o.ev.til * 60) + ' · ' + UI.whenText(o.tStart, o.tEnd) + '</div></div>' + chip(esc(WORLD.cfg.events.find(e => e.id === o.ev.id).type), 'mute') + '</div>';
    if (bk) h += '<div class="row wrap" style="margin-top:8px">' + chip('Sanitetsvakt: ' + AGENCIES[bk.org].kort + ' · ' + ({ planlagt: 'booket', aktiv: 'på vakt', ubemannet: 'ikke bemannet', ferdig: 'avsluttet' }[bk.state]), bk.state === 'ubemannet' ? 'bad' : 'ok') + (bk.state === 'planlagt' ? '<button class="btn ghost xs" data-act="unbook" data-id="' + o.key + '">Avbestill</button>' : '') + '</div>';
    else if (!inProg) h += '<div class="actions">' + ['rk', 'nf'].map(org => '<button class="btn sm' + (S.vol[org] ? '' : ' dis') + '" data-act="book" data-id="' + o.key + '" data-k="' + org + '">Book ' + AGENCIES[org].kort + '</button>').join('') + '</div><div class="xs muted" style="margin-top:6px">Med sanitetsvakt blir det færre og mildere hendelser. Du får vaktinntekt etterpå.</div>';
    h += '</div>';
  }
  return h;
};

/* ---------- Nødnett ---------- */
UI.mastRow = function (m) {
  const sel = UI.sel && UI.sel.type === 'mast' && UI.sel.id === m.id, ld = Math.min(1, m.load), col = m.down ? '#9AA0A0' : m.load > 1 ? '#D9695A' : m.load > 0.75 ? '#E4AE4E' : '#A99BCB';
  return '<div class="urow' + (sel ? ' sel' : '') + '" id="mast-' + m.id + '" data-act="selmast" data-id="' + m.id + '"><div class="pring"><svg viewBox="0 0 46 46"><circle class="bg" cx="23" cy="23" r="18"/><circle cx="23" cy="23" r="18" stroke="' + col + '" stroke-dasharray="' + (ld * 113.1).toFixed(1) + ' 200" style="transition:stroke-dasharray .6s"/></svg><b>' + (m.down ? '–' : Math.round(m.load * 100) + '%') + '</b></div>'
    + '<div class="grow"><b class="sm">' + esc(m.navn) + '</b><div class="xs muted">' + (m.down ? chip('UTFALL · reparasjon om ' + Math.max(1, Math.ceil(m.repairAt - S.t)) + ' min', 'bad') : chip(m.calls + ' / ' + m.cap + ' samtaler', m.load > 1 ? 'bad' : 'net')) + (m.mobile ? ' ' + chip('mobil', 'mute') : '') + (m.level ? ' ' + chip('kap. nivå ' + m.level, 'mute') : '') + '</div></div></div>';
};
UI.tabNodnett = function () {
  const ns = Net.status(), cov = Math.round((S.covFrac || 0) * 100);
  let h = '<div class="card"><div class="row"><i class="dot ' + (ns === 'g' ? '' : ns) + '"></i><div class="grow"><b>' + (ns === 'g' ? 'Nettet fungerer normalt' : ns === 'y' ? 'Høy belastning eller svak dekning' : 'Utfall eller overbelastning!') + '</b><div class="xs muted">' + Net.techName() + ' · god/svak dekning på ' + cov + ' % av landarealet</div></div><button class="btn sm' + (S.settings.cover ? ' net' : '') + '" data-act="cover">' + icon('layers') + ' Dekning</button></div></div>';
  const alarms = S.net.alarms.filter(a => !a.done);
  for (const al of alarms) { const u = S.units[al.unitId], inc = S.incidents[al.incId]; if (!u) continue; h += '<div class="card" style="background:#f6dcd5;border-color:#d9695a"><div class="row">' + icon('warn') + '<div class="grow"><b>NØDKNAPP: ' + esc(u.name) + '</b><div class="sm">' + esc(inc ? inc.loc.addr : '') + ' · ' + Math.max(0, Math.ceil(al.deadline - S.t)) + ' min igjen</div></div><button class="btn clay sm" data-act="sendhelp" data-id="' + al.id + '">Send hjelp</button></div></div>'; }
  h += '<h3 class="sec">Radio – kanal og skanneliste</h3><div class="card"><div class="row" style="margin-bottom:8px"><div class="grow"><div class="xs muted">' + (Net.vhf() ? 'VHF-kanal' : 'Valgt talegruppe') + '</div><b>' + esc(Net.vhf() ? 'Kanal ' + (RadioUI.vhfIndex() + 1) + ' · ' + RadioUI.vhfName(Radio.channel) : RadioUI.tgName(Radio.channel)) + '</b></div>'
    + '<button class="btn sm' + (Radio.scan ? ' net' : '') + '" data-act="rscan">Skann ' + (Radio.scan ? 'på' : 'av') + '</button><button class="btn sm primary" data-act="rshow">' + icon('radio') + ' Radio</button></div>'
    + Radio.channels().map(c => { const cur = c.id === Radio.channel, inL = Radio.listen.has(c.id); return '<div class="opt' + (cur ? ' on' : '') + '"><div class="av" style="background:' + (cur ? '#7b9a79' : inL ? '#A99BCB' : '#B7BDB8') + '">' + icon(cur ? 'headset' : 'radio') + '</div><div class="grow"><div class="b sm">' + esc(c.navn) + '</div><div class="xs muted">' + (cur ? 'Valgt kanal' : inL ? 'I skannelisten' : 'Ikke i skannelisten') + '</div></div>'
      + (cur ? '' : '<button class="btn xs" data-act="rch" data-id="' + esc(c.id) + '">Velg</button>') + '<button class="btn xs' + (inL ? ' net' : '') + '" data-act="listen" data-id="' + esc(c.id) + '">' + (inL ? 'Skann ✓' : 'Skann') + '</button></div>'; }).join('')
    + '<div class="xs muted" style="margin-top:6px">Du hører den valgte kanalen, og med skanning også kanalene i skannelisten. Bytt kanal med velgeren på toppen av radioen (eller [ og ]). PTT-knappen på siden lar deg snakke med en enhet. ' + ('speechSynthesis' in window ? '' : 'Nettleseren din støtter ikke talesyntese.') + '</div></div>';
  h += '<h3 class="sec">' + (Net.vhf() ? 'Kanaler' : 'Talegrupper') + '</h3>';
  const groups = Net.groups();
  for (const tg of ['BRANN', 'POLITI', 'HELSE', 'REDNING']) {
    const mem = groups[tg] || [], busy = mem.filter(u => u.status !== 'ledig').length, p = S.net.tgPrio[tg];
    h += '<div class="urow" style="flex-wrap:wrap"><span class="tg ' + tg + '">' + tg + '</span><div class="grow"><b class="sm">' + TG_NAMES[tg] + '</b><div class="xs muted">' + mem.length + (mem.length === 1 ? ' enhet' : ' enheter') + ' · ' + busy + (busy === 1 ? ' aktiv' : ' aktive') + '</div></div><div class="seg" style="margin:0;padding:2px">' + [1, 2, 3].map(n => '<button data-act="prio" data-id="' + tg + '" data-k="' + n + '" class="' + (p === n ? 'on' : '') + '" title="Prioritet ' + n + '">' + n + '</button>').join('') + '</div>'
      + '<div class="slotline" style="flex-basis:100%;margin:4px 0 0">' + (mem.slice(0, 8).map(u => '<span class="slot ' + (u.contact === 'ingen' ? 'miss' : u.status === 'ledig' ? '' : 'en') + '">' + esc(u.name) + '</span>').join('') + (mem.length > 8 ? '<span class="slot">+' + (mem.length - 8) + '</span>' : '') || '<span class="xs muted">Ingen medlemmer ennå</span>') + '</div></div>';
  }
  const sv = Net.samvActive();
  h += '<div class="xs muted" style="margin:-2px 4px 8px">Prioritet 1 holdes lengst når nettet er overbelastet. Samvirke-grupper: ' + sv.length + ' av ' + Net.samvMax() + ' mulige.</div>';
  for (const inc of sv) h += '<div class="urow" style="flex-wrap:wrap"><span class="tg SAMVIRKE">' + inc.tg + '</span><div class="grow"><b class="sm">' + esc(inc.navn) + '</b><div class="xs muted">' + esc(inc.loc.addr) + '</div></div><div class="slotline" style="flex-basis:100%;margin:4px 0 0">' + inc.slots.flatMap(s => s.units).map(id => S.units[id]).filter(Boolean).map(u => '<span class="slot en">' + esc(u.name) + '</span>').join('') + '</div></div>';
  h += '<h3 class="sec">Basestasjoner</h3>' + Object.values(S.net.masts).map(UI.mastRow).join('');
  const selm = UI.sel && UI.sel.type === 'mast' && S.net.masts[UI.sel.id];
  if (selm) h += '<div class="card" style="margin-top:-2px"><div class="actions">' + (selm.down ? '<button class="btn warn sm" data-act="repair" data-id="' + selm.id + '">Hurtigreparasjon · ' + fmtKr(12000) + '</button>' : '') + (selm.level < 3 ? '<button class="btn sm" data-act="capup" data-id="' + selm.id + '">Oppgrader kapasitet · ' + fmtKr(45000) + '</button>' : '') + (selm.mobile ? '<button class="btn sm" data-act="recallmast" data-id="' + selm.id + '">Hent inn</button>' : '') + '<button class="btn ghost sm" data-act="focusmast" data-id="' + selm.id + '">' + icon('pin') + ' Vis</button></div></div>';
  h += '<div class="actions" style="margin:6px 0"><button class="btn sm" data-act="shopcat" data-id="nodnett">' + icon('plus') + ' Ny basestasjon</button>' + (S.net.mobile > 0 ? '<button class="btn net sm" data-act="deploy">Sett ut mobil basestasjon (' + S.net.mobile + ')</button>' : '') + '</div>';
  // dekningsvarsler
  const lost = Object.values(S.units).filter(u => u.vis !== false && !u.bistand && (u.contact === 'ingen' || u.contact === 'svak'));
  if (lost.length) h += '<h3 class="sec">Dekningsvarsler</h3>' + lost.slice(0, 6).map(u => '<div class="urow" data-act="selunit" data-id="' + u.id + '">' + UI.sigHtml(u) + '<div class="grow"><b class="sm">' + esc(u.name) + '</b><div class="xs muted">' + (u.contact === 'ingen' ? (u.cong ? 'Mistet kontakt – nettet er overbelastet' : 'Uten dekning – siste kjente posisjon vises i grått') : 'Svak dekning – ordre går tregere') + '</div></div></div>').join('');
  // terminaler
  const un = Object.values(S.units).filter(u => !u.bistand);
  h += '<h3 class="sec">Terminaler og sentraler</h3><div class="grid2"><div class="tile"><b>' + un.filter(u => UT[u.type].term === 'k').length + '</b><span>Kjøretøyterminaler</span></div><div class="tile"><b>' + un.filter(u => UT[u.type].term === 'h').length + '</b><span>Håndterminaler</span></div><div class="tile"><b>' + ETATER.filter(a => S.agencies[a]).reduce((n, a) => n + S.ops[a], 0) + '</b><span>Operatørplasser</span></div><div class="tile"><b>' + (Net.vhf() ? 'VHF' : 'Nivå ' + S.net.termLevel) + '</b><span>Terminaler</span></div></div>';
  // logg
  const fl = UI.logFilter, flt = ['ALLE', 'BRANN', 'POLITI', 'HELSE', 'REDNING', 'SAMVIRKE', 'NØDNETT'];
  h += '<h3 class="sec">Samband-logg</h3><div class="seg">' + flt.map(f => '<button data-act="logf" data-id="' + f + '" class="' + (fl === f ? 'on' : '') + '">' + (f === 'ALLE' ? 'Alle' : f.charAt(0) + f.slice(1).toLowerCase()) + '</button>').join('') + '</div>';
  const rows = S.log.filter(e => fl === 'ALLE' || e.tg.startsWith(fl) || (fl === 'NØDNETT' && e.tg === 'NØDNETT')).slice(-70).reverse();
  h += rows.map(e => '<div class="logrow ' + (e.kind === 'warn' ? 'warn' : e.kind === 'alarm' ? 'alarm' : '') + '"><span class="tm">' + fmtClock(e.abs % 1440) + '</span><span class="tg ' + (e.tg.startsWith('SAMVIRKE') ? 'SAMVIRKE' : e.tg) + '">' + esc(e.tg) + '</span>' + esc(e.from) + ': ' + esc(e.msg) + '</div>').join('');
  return h;
};

/* ---------- Stasjoner ---------- */
UI.tabStasjoner = function () {
  const sts = Object.values(S.stations); let h = '';
  const groups = [['etat', 'Etatsstasjoner'], ['frivillig', 'Baser for frivillige'], ['helse', 'Sykehus, legevakt og arrest']];
  for (const [rolle, name] of groups) {
    const list = sts.filter(st => (ST[st.type].rolle === 'arrest' ? 'helse' : ST[st.type].rolle) === rolle); if (!list.length) continue;
    h += '<h3 class="sec">' + name + '</h3>';
    for (const st of list) {
      const T = ST[st.type], lot = WORLD.lotById.get(st.lotId), units = Sim.unitsAt(st.id), cap = Sim.stationCap(st), sel = UI.sel && UI.sel.type === 'station' && UI.sel.id === st.id;
      h += '<div class="card' + (sel ? ' sel' : '') + '" id="station-' + st.id + '" data-act="selst" data-id="' + st.id + '"><div class="row">' + avatar(T.org, T.ikon) + '<div class="grow"><h4>' + esc(st.name) + '</h4><div class="addr">' + esc(lot.addr) + '</div></div>' + (cap ? chip(units.length + '/' + cap + ' plasser', units.length >= cap ? 'bad' : 'mute') : chip(T.navn, 'mute')) + '</div>';
      if (cap && ETATER.includes(T.org) && st.type !== 'helikopterbase' || st.type === 'helikopterbase') {
        const staff = Staff.atStation(st.id), k = staff.filter(p => p.k160).length;
        h += '<div class="xs muted" style="margin-top:6px"><b>Personell:</b> ' + staff.length + ' ansatte, ' + k + ' med kode 160</div><div class="slotline">' + staff.map(p => '<span class="slot ' + (p.state !== 'ok' ? 'miss' : p.unitId ? 'en' : 'ok') + '" title="' + (p.unitId && S.units[p.unitId] ? 'På ' + esc(S.units[p.unitId].name) : 'Reserve') + '">' + esc(p.navn) + (p.k160 ? ' · 160' : p.course ? ' · på kurs' : '') + (p.state !== 'ok' ? ' · skadet' : '') + (!p.k160 && !p.course && p.state === 'ok' ? ' <a data-act="course" data-id="' + p.id + '">kurs</a>' : '') + '</span>').join('') + '</div>'
          + '<div class="actions"><button class="btn sm" data-act="hire" data-id="' + st.id + '" data-k="1">' + icon('plus') + ' Ansett med kode 160 · ' + fmtKr(Staff.HIRE_K) + '</button><button class="btn ghost sm" data-act="hire" data-id="' + st.id + '" data-k="0">Ansett uten · ' + fmtKr(Staff.HIRE) + '</button></div>';
      }
      if (cap) {
        h += '<div class="slotline">' + (units.map(u => '<span class="slot ' + (u.status === 'ledig' ? 'ok' : 'en') + '">' + esc(u.name) + '</span>').join('') || '<span class="slot opt">Ingen enheter</span>') + '</div><div class="actions">'
          + '<button class="btn primary sm" data-act="buyunit" data-id="' + st.id + '">' + icon('plus') + ' Kjøp enhet</button>';
        for (const k of ['garasje', 'mannskap']) { const c = Shop.stationUpCost(st, k); h += '<button class="btn sm' + (c == null ? ' dis' : '') + '" data-act="upgst" data-id="' + st.id + '" data-k="' + k + '">' + (k === 'garasje' ? 'Større garasje' : 'Flere mannskaper') + ' (' + st.up[k] + '/' + (k === 'garasje' ? 2 : 3) + ')' + (c != null ? ' · ' + fmtKr(c) : '') + '</button>'; }
        h += '</div>';
      } else h += '<div class="xs muted" style="margin-top:6px">' + ({ sykehus: 'Tar imot pasienter fra ambulanser og luftambulanse.', legevakt: 'Tar imot «vanlige» pasienter.', arrest: 'Politiet leverer pågrepne her.' }[st.type] || '') + (st.gift ? ' Del av byens helsevesen.' : '') + '</div>';
      h += '</div>';
    }
  }
  h += '<div class="actions"><button class="btn sm" data-act="shopcat" data-id="etat">' + icon('house') + ' Bygg ny stasjon</button></div>';
  return h;
};

/* ---------- Butikk ---------- */
UI.tabButikk = function () {
  let h = '<div class="seg">' + Shop.cats.map(c => '<button data-act="shopcat" data-id="' + c.id + '" class="' + (UI.shopCat === c.id ? 'on' : '') + '">' + c.navn + '</button>').join('') + '</div>';
  const items = Shop.items(UI.shopCat);
  if (!items.length) h += '<div class="empty">Ingenting å kjøpe her akkurat nå.</div>';
  for (const it of items) {
    const lock = !it.ok && it.kind !== 'info';
    h += '<div class="shopcard' + (lock ? ' lock' : '') + '"><div class="av" style="background:' + it.farge + '">' + icon(it.lvl > S.level ? 'lock' : it.ikon) + '</div><div class="grow"><b class="sm">' + esc(it.navn) + '</b><div class="xs muted">' + esc(it.tekst) + (it.lvl > 1 ? ' · nivå ' + it.lvl : '') + '</div>' + (lock && it.reason ? '<div class="xs" style="color:#9c3f33;font-weight:800">' + esc(it.reason) + '</div>' : '') + '</div>'
      + (it.kind === 'info' ? '' : '<div class="r">' + (it.cost ? '<div class="price">' + fmtKr(it.cost) + '</div>' : '') + '<button class="btn ' + (it.ok ? 'primary' : '') + ' xs' + (it.ok ? '' : ' dis') + '" data-act="buy" data-id="' + it.id + '">' + (it.kind === 'beaches' ? 'Åpne' : 'Kjøp') + '</button></div>') + '</div>';
  }
  return h;
};

/* ---------- Statistikk ---------- */
UI.tabStatistikk = function () {
  const st = S.stats, rk = Eco.rank(S.level), nx = RANKS[S.level], days = Object.keys(st.days).map(Number).sort((a, b) => a - b).slice(-6);
  const mx = Math.max(1, ...days.map(d => Math.max(st.days[d].income, st.days[d].cost)));
  const avg = k => { const a = st.byAg[k]; return a.n ? fmtDur(a.rt / Math.max(1, a.n)) : '–'; };
  let h = '<div class="card"><div class="row"><div class="pring"><svg viewBox="0 0 46 46"><circle class="bg" cx="23" cy="23" r="18"/><circle cx="23" cy="23" r="18" stroke="#7b9a79" stroke-dasharray="' + (Eco.progress() * 113.1).toFixed(1) + ' 200"/></svg><b>' + S.level + '</b></div><div class="grow"><h4>' + esc(rk.navn) + '</h4><div class="sm muted">' + (nx ? S.xp + ' / ' + nx.xp + ' poeng til ' + esc(nx.navn) : 'Høyeste rang!') + '</div></div></div></div>';
  h += '<div class="grid2"><div class="tile"><b>' + Math.round(S.ready) + ' %</b><span>Beredskapsnivå</span></div><div class="tile"><b>' + st.solved + '</b><span>Løste hendelser</span></div><div class="tile"><b>' + st.failed + '</b><span>Ikke håndtert i tide</span></div><div class="tile"><b>' + st.lives + '</b><span>Liv reddet</span></div>'
    + '<div class="tile"><b>' + fmtKr(st.income) + '</b><span>Inntekter fra oppdrag</span></div><div class="tile"><b>' + fmtKr(st.grant) + '</b><span>Kommunalt tilskudd</span></div><div class="tile"><b>' + fmtKr(st.costs) + '</b><span>Driftskostnader</span></div><div class="tile"><b>' + fmtKr(st.capex || 0) + '</b><span>Investeringer</span></div></div>';
  h += '<h3 class="sec">Responstid mot mål</h3>' + [['brann', 'Brann'], ['politi', 'Politi'], ['ambulanse', 'Ambulanse'], ['frivillig', 'Frivillige']].map(([k, n]) => { const a = st.byAg[k]; return '<div class="urow"><div class="grow"><b class="sm">' + n + '</b><div class="xs muted">' + a.n + ' oppdrag · snitt ' + avg(k) + '</div></div>' + chip(a.n ? Math.round(100 * a.ok / a.n) + ' % i mål' : '–', a.n && a.ok / a.n > 0.7 ? 'ok' : 'mute') + '</div>'; }).join('');
  h += '<div class="grid2" style="margin-top:8px"><div class="tile"><b>' + st.bistand + '</b><span>Bistand fra nabodistrikt</span></div><div class="tile"><b>' + st.samv + '</b><span>Samvirke-talegrupper</span></div><div class="tile"><b>' + st.falseAlarms + '</b><span>Falske alarmer</span></div><div class="tile"><b>' + st.alarmsOk + ' / ' + (st.alarmsOk + st.alarmsFail) + '</b><span>Nødknapper løst</span></div></div>';
  if (days.length) h += '<h3 class="sec">Økonomi per døgn</h3><div class="card"><div class="bars">' + days.map(d => '<div class="col"><div class="pair"><i style="height:' + Math.max(3, 100 * st.days[d].income / mx) + '%"></i><i class="neg" style="height:' + Math.max(3, 100 * st.days[d].cost / mx) + '%"></i></div><small>d' + d + '</small></div>').join('') + '</div><div class="xs muted">' + chip('Inntekt', 'ok') + ' ' + chip('Kostnad', 'bad') + '</div></div>';
  if (st.readyHist.length > 2) { const pts = st.readyHist.map((v, i) => (i / (st.readyHist.length - 1) * 100).toFixed(1) + ',' + (40 - v * 0.4).toFixed(1)).join(' '); h += '<h3 class="sec">Beredskapsnivå over tid</h3><div class="card"><svg viewBox="0 0 100 40" style="width:100%;height:70px" preserveAspectRatio="none"><polyline fill="none" stroke="#7b9a79" stroke-width="1.4" points="' + pts + '"/></svg></div>'; }
  h += Goals.list();
  h += '<div class="actions" style="margin-top:10px"><button class="btn sm" data-act="menu">' + icon('menu') + ' Meny</button><button class="btn sm" data-act="showhelp">' + icon('doc') + ' Hjelp</button></div>';
  return h;
};
UI.renderTab = function (force) {
  if (Game.mode !== 'play' || !S) return;
  const fn = { hendelser: UI.tabHendelser, enheter: UI.tabEnheter, frivillige: UI.tabFrivillige, nodnett: UI.tabNodnett, stasjoner: UI.tabStasjoner, butikk: UI.tabButikk, statistikk: UI.tabStatistikk }[UI.tab];
  const html = fn(); const body = $('#tabBody');
  if (!force && !UI.dirty && html === UI.lastHtml && UI.tab === UI.lastTab) return;
  if (html === UI.lastHtml && UI.tab === UI.lastTab && !UI._scrollTo) { UI.dirty = false; return; }
  const sc = UI.tab === UI.lastTab ? body.scrollTop : 0;
  body.innerHTML = html; body.scrollTop = sc; UI.lastHtml = html; UI.lastTab = UI.tab; UI.dirty = false;
  if (UI._scrollTo) { const t = document.getElementById(UI._scrollTo); if (t) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); UI._scrollTo = null; }
};

/* ---------- handlinger ---------- */
UI.act = function (act, d) {
  const id = d.id, inc = S.incidents[id];
  switch (act) {
    case 'selinc': UI.select({ type: 'incident', id }, true); break;
    case 'focusinc': UI.select({ type: 'incident', id }, true); break;
    case 'selunit': UI.select({ type: 'unit', id }, true); break;
    case 'focusunit': UI.focusSel({ type: 'unit', id }); break;
    case 'selst': UI.select({ type: 'station', id }, true); break;
    case 'selmast': UI.select({ type: 'mast', id }, true); break;
    case 'focusmast': UI.focusSel({ type: 'mast', id }); break;
    case 'send': if (inc) { Sim.dispatchSuggested(inc); UI.sug = {}; UI.dirty = true; } break;
    case 'pick': if (inc) UI.openDispatch(inc.id); break;
    case 'addopt': if (inc) { const s = inc.slots.find(x => x.k === d.k); const c = s && Sim.candidates(inc, s)[0]; if (c) { Sim.assign(inc, s, c.u); UI.toast(c.u.name + ' sendt (' + Math.ceil(c.eta) + ' min)', 'good'); } else UI.toast('Ingen ledig enhet – kjøp flere eller sjekk avtaler.', 'warn'); UI.sug = {}; UI.dirty = true; } break;
    case 'bistand': if (inc) UI.openBistand(inc); break;
    case 'samv': if (inc) UI.res(Sim.createSamvirke(inc)); break;
    case 'listen': Radio.toggle(id); UI.dirty = true; break;
    case 'rch': Radio.unlock(); Radio.setChannel(id); Radio.squelch(0.09, false); UI.dirty = true; break;
    case 'rscan': Radio.scan = !Radio.scan; Radio.save(); UI.dirty = true; RadioUI.render(); break;
    case 'rshow': RadioUI.toggle(true); break;
    case 'follow': if (R.follow === id) { R.follow = null; UI.toast('Slutter å følge', 'info'); } else { R.follow = id; UI.toast('Følger ' + S.units[id].name + ' – dra i kartet for å stoppe', 'info'); } UI.dirty = true; break;
    case 'talk': UI.mc || Radio.talk(id); break;
    case 'answer': { const c = Sim.answerCall(id); if (c) { UI.toast('Du snakker med innringer: «' + c.text + '»', 'info'); UI.dirty = true; } break; }
    case 'hire': UI.res(Staff.hire(id, d.k === '1')); break;
    case 'course': UI.res(Staff.course(id)); break;
    case 'recall': if (S.units[id]) { Sim.recall(S.units[id]); UI.dirty = true; } break;
    case 'shopcat': UI.shopCat = id; UI.setTab('butikk'); if (UI.sheet === 0) UI.setSheet(1); break;
    case 'buy': UI.buyItem(id); break;
    case 'upgst': UI.res(Shop.upgradeStation(id, d.k)); break;
    case 'buyunit': UI.buyUnitAt(id); break;
    case 'sign': UI.res(Vol.sign(id)); break;
    case 'buildbase': UI.buyItem('station:' + STATION_FOR_ORG[id]); break;
    case 'beach': UI.select({ type: 'beach', id }, true); UI.beachDialog(id); break;
    case 'book': UI.bookEvent(id, d.k); break;
    case 'unbook': Vol.cancel(id); UI.toast('Sanitetsvakt avbestilt', 'info'); UI.dirty = true; break;
    case 'cover': UI.toggleCover(); UI.dirty = true; break;
    case 'prio': S.net.tgPrio[id] = +d.k; UI.dirty = true; break;
    case 'repair': UI.res(Net.fastRepair(S.net.masts[id]) ? ok_('Hurtigreparasjon bestilt') : fail_('Ikke mulig (sjekk pengene).')); break;
    case 'capup': UI.res(Shop.exec('mast:cap', id)); break;
    case 'deploy': UI.deployMobile(); break;
    case 'recallmast': Net.recall(id); UI.toast('Mobil basestasjon er hentet inn', 'info'); UI.dirty = true; break;
    case 'sendhelp': { const al = S.net.alarms.find(a => a.id == id); if (al) UI.res(Sim.sendHelp(al)); UI.alarmBar(); break; }
    case 'logf': UI.logFilter = id; UI.dirty = true; break;
    case 'menu': UI.menu(); break;
    case 'showhelp': UI.help(); break;
  }
};
UI.openDispatch = function (incId) {
  const inc = S.incidents[incId]; if (!inc) return;
  const slots = inc.slots.filter(s => Sim.missing(inc, s) > 0), choice = {};
  const used = new Set();
  for (const s of slots) { choice[s.k] = []; for (const c of Sim.candidates(inc, s)) { if (choice[s.k].length >= Sim.missing(inc, s) || (!s.req && s.k !== 'nh')) break; if (!used.has(c.u.id)) { choice[s.k].push(c.u.id); used.add(c.u.id); } } }
  const render = h => {
    h.body.innerHTML = '<p class="muted">' + esc(inc.navn) + ' · ' + esc(inc.loc.addr) + '. Velg enheter for hver rolle.</p>' + slots.map(s => {
      const cs = Sim.candidates(inc, s).slice(0, 6);
      return '<h3 class="sec">' + esc(s.label) + (s.n > 1 ? ' ×' + Sim.missing(inc, s) : '') + (s.req ? '' : ' (valgfri)') + '</h3>' + (cs.length ? cs.map(c => '<button class="opt' + (choice[s.k].includes(c.u.id) ? ' on' : '') + '" data-k="' + s.k + '" data-u="' + c.u.id + '">' + avatar(c.u.org) + '<div class="grow"><div class="b sm">' + esc(c.u.name) + '</div><div class="xs muted">' + UI.unitState(c.u) + ' · ' + (UT[c.u.type].mob ? 'frivillig – mobiliserer først · ' : '') + 'dekning ' + c.u.contact + '</div></div><div class="price">' + Math.ceil(c.eta) + ' min</div></button>').join('') : '<div class="empty" style="padding:8px">Ingen ledige enheter</div>');
    }).join('');
    $$('.opt', h.body).forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.k, uid = b.dataset.u, s = slots.find(x => x.k === k), arr = choice[k], i = arr.indexOf(uid);
      if (i >= 0) arr.splice(i, 1); else { if (arr.length >= Sim.missing(inc, s)) arr.shift(); arr.push(uid); }
      render(h);
    }));
  };
  UI.modal({ title: 'Velg enheter', html: '', buttons: [{ label: 'Avbryt', cls: 'ghost' }, { label: icon('truck') + ' Send', cls: 'primary', fn: () => {
    let n = 0; for (const s of slots) for (const uid of choice[s.k]) { const u = S.units[uid]; if (u && Sim.available(u)) { Sim.assign(inc, s, u); n++; } }
    UI.toast(n ? n + ' enheter sendt' : 'Ingen enheter valgt', n ? 'good' : 'warn'); UI.sug = {}; UI.dirty = true; } }], init: render });
};
UI.openBistand = function (inc) {
  const slots = inc.slots.filter(s => Sim.missing(inc, s) > 0 && s.req && s.k !== 'nh' && !s.accepts.every(t => t === 'livredder'));
  if (!slots.length) { UI.toast('Ingenting mangler som kan rekvireres.', 'info'); return; }
  UI.choose({ title: 'Be om bistand', intro: 'Nabodistriktet kan sende enheter, men det tar lengre tid, koster penger og gir lavere poengsum.', items: slots.map(s => ({ id: s.k, label: s.label, sub: 'Ankommer om ca. ' + Math.round((WORLD.cfg.bistandDelay || 8) + 5) + ' min', ic: (AGENCIES[s.ag] || AGENCIES.bistand).ikon, color: (AGENCIES[s.ag] || AGENCIES.brann).farge, right: fmtKr(BISTAND_COST[s.ag] || 9000), disabled: S.money < (BISTAND_COST[s.ag] || 9000) })),
    onPick: k => { const s = inc.slots.find(x => x.k === k); UI.res(Sim.requestBistand(inc, s)); UI.sug = {}; } });
};
UI.buyUnitAt = function (stId) {
  const st = S.stations[stId], T = ST[st.type];
  const types = Object.keys(UT).filter(t => Sim.canHouse(t, st) && !UT[t].foot);
  UI.choose({ title: 'Kjøp enhet til ' + esc(st.name), items: types.map(t => { const U = UT[t], full = Sim.unitsAt(stId).length >= Sim.stationCap(st); return { id: t, label: U.navn, sub: U.crew + ' mannskap · drift ' + U.run + ' kr/min' + (U.mob ? ' · mobiliserer ca. ' + U.mob + ' min' : '') + (S.level < U.lvl ? ' · krever nivå ' + U.lvl : ''), ic: AGENCIES[U.org].ikon, color: AGENCIES[U.org].farge, right: fmtKr(U.cost + Staff.crewCost(t)), disabled: S.level < U.lvl || full || S.money < U.cost + Staff.crewCost(t) }; }),
    onPick: t => UI.res(Sim.buyUnit(t, stId)) });
};
UI.buyItem = function (id) {
  const [k, v] = id.split(':'), it = Shop.items(UI.shopCat).find(x => x.id === id) || Shop.items('etat').concat(Shop.items('frivillig'), Shop.items('nodnett')).find(x => x.id === id);
  if (!it) return;
  if (!it.ok) { UI.toast(it.reason || 'Ikke tilgjengelig akkurat nå.', 'warn'); return; }
  if (it.kind === 'place') {
    const isMast = id === 'mast:new', lots = isMast ? Sim.mastLots() : Sim.freeLots();
    UI.beginPlacement({ title: esc(it.navn) + ' · ' + fmtKr(it.cost), hint: isMast ? 'Trykk hvor som helst nær en vei der det er ledig plass for å bygge basestasjon' : 'Trykk hvor som helst nær en vei der det er ledig plass (grønne ringer er forslag)', lots, costText: fmtKr(it.cost),
      onConfirm: lotId => { const r = UI.res(Shop.exec(id, lotId)); return r.ok ? undefined : false; } });
    if (window.innerWidth < 900) { UI._sheetBefore = UI.sheet || 1; UI.setSheet(0); }
    return;
  }
  if (it.kind === 'unit') {
    const sts = Object.values(S.stations).filter(st => Sim.canHouse(v, st) && Sim.unitsAt(st.id).length < Sim.stationCap(st));
    if (sts.length === 1) { UI.res(Sim.buyUnit(v, sts[0].id)); return; }
    UI.choose({ title: 'Velg stasjon for ' + esc(UT[v].navn.toLowerCase()), items: sts.map(st => ({ id: st.id, label: st.name, sub: WORLD.lotById.get(st.lotId).addr + ' · ' + Sim.unitsAt(st.id).length + '/' + Sim.stationCap(st) + ' plasser', ic: ST[st.type].ikon, color: AGENCIES[ST[st.type].org].farge })), onPick: sid => UI.res(Sim.buyUnit(v, sid)) });
    return;
  }
  if (it.kind === 'pickmast') {
    UI.choose({ title: 'Oppgrader kapasitet', items: Object.values(S.net.masts).map(m => ({ id: m.id, label: m.navn, sub: 'Nå ' + m.cap + ' samtidige samtaler · nivå ' + m.level + '/3', ic: 'mast', color: '#A99BCB', disabled: m.level >= 3, right: fmtKr(it.cost) })), onPick: mid => UI.res(Shop.exec('mast:cap', mid)) });
    return;
  }
  if (it.kind === 'beaches') { UI.chooseBeach(); return; }
  UI.res(Shop.exec(id));
};
UI.chooseBeach = function () {
  UI.choose({ title: 'Velg strand', items: Object.keys(WORLD.beaches).map(id => { const b = WORLD.beaches[id], bs = S.beaches[id]; return { id, label: b.navn, sub: bs && bs.staffed ? 'Bemannet' : 'Ikke bemannet', ic: 'buoy', color: AGENCIES.strand.farge }; }), onPick: id => UI.beachDialog(id) });
};
UI.beachDialog = function (id) {
  const b = WORLD.beaches[id], bs = Vol.beach(id);
  const render = h => {
    h.body.innerHTML = '<p class="muted">' + (isSummer() ? 'Det er sommer – livredderne er på tårnet.' : 'Livredderne er bare på jobb om sommeren.') + (b.island ? ' Stranden ligger på en øy med svak dekning – vurder en egen basestasjon.' : '') + '</p>'
      + '<div class="kv"><span>Bemanning</span><span>' + (bs.staffed ? bs.n + ' livredder' + (bs.n > 1 ? 'e' : '') : 'Ikke bemannet') + '</span><span>Håndterminal</span><span>' + (bs.staffed ? 'Ja (Nødnett)' : 'Følger med bemanning') + '</span></div>'
      + '<div class="actions" style="margin:10px 0">' + (!S.vol.strand ? '<span class="chip bad">Krever samarbeidsavtale med Strandlivredderne</span>' : !bs.staffed ? '<button class="btn primary sm" data-a="staff">Bemann stranden · ' + fmtKr(18000) + '</button>' : (bs.n < 2 ? '<button class="btn sm" data-a="guard">Ekstra livredder · ' + fmtKr(10000) + '</button>' : '')) + '</div>'
      + (bs.staffed ? Object.keys(BEACH_UP).map(k => '<div class="shopcard"><div class="av" style="background:' + AGENCIES.strand.farge + '">' + icon('buoy') + '</div><div class="grow"><b class="sm">' + BEACH_UP[k].navn + '</b><div class="xs muted">' + BEACH_UP[k].tekst + '</div></div>' + (bs.up[k] ? chip('Kjøpt', 'ok') : '<button class="btn primary xs" data-up="' + k + '">' + fmtKr(BEACH_UP[k].cost) + '</button>') + '</div>').join('') : '');
    $$('[data-a]', h.body).forEach(x => x.addEventListener('click', () => { UI.res(x.dataset.a === 'staff' ? Vol.staff(id) : Vol.addGuard(id)); render(h); }));
    $$('[data-up]', h.body).forEach(x => x.addEventListener('click', () => { UI.res(Vol.upgrade(id, x.dataset.up)); render(h); }));
  };
  UI.modal({ title: icon('buoy') + ' ' + esc(b.navn), html: '', buttons: [{ label: 'Lukk', cls: 'primary' }], init: render });
};
UI.bookEvent = function (key, org) {
  UI.res(Vol.book(key, org));
};
UI.deployMobile = function () {
  UI.beginPlacement({ title: 'Sett ut mobil basestasjon', hint: 'Trykk på et punkt på land – for eksempel ved en stor hendelse', ground: true, costText: '',
    onConfirm: pt => { const id = Net.deployMobile(pt.x, pt.z); Log.add('NØDNETT', 'Driftssentral', 'Mobil basestasjon er satt ut og i drift', 'info'); UI.toast('Mobil basestasjon er i drift', 'net'); UI.dirty = true; } });
  if (window.innerWidth < 900) { UI._sheetBefore = UI.sheet || 1; UI.setSheet(0); }
};
