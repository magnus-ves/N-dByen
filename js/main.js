'use strict';

/* ==========================================================================
   12. LAGRING – localStorage (i try/catch), egen lagring per by
   ========================================================================== */
const Store = {
  key: id => 'nodbyen.v3.' + id,
  save() {
    if (!S || Game.mode !== 'play') return false;
    try { localStorage.setItem(Store.key(S.city), JSON.stringify(S, (k, v) => (k.charAt(0) === '_' ? undefined : v))); return true; } catch (e) { return false; }
  },
  load(id) {
    try { const raw = localStorage.getItem(Store.key(id)); if (!raw) return null; const o = JSON.parse(raw); return (o && o.v === 3 && o.city === id && o.stations) ? o : null; } catch (e) { return null; }
  },
  peek(id) { const o = Store.load(id); return o ? { day: Math.floor((o.startHour * 60 + o.t) / MIN_DAY) + 1, money: o.money, level: o.level } : null; },
  clear(id) { try { localStorage.removeItem(Store.key(id)); } catch (e) { /* ignorer */ } }
};

/* ==========================================================================
   14. SPILLFLYT, HOVEDLØKKE OG OPPSTART
   ========================================================================== */
Game.envFor = function (si) { const sun = SEASONS[si].sun; return { daylight: 1, hour: 13, season: si, weather: 'klar', sunrise: sun[0], sunset: sun[1] }; };
Game.applySeason = function (si) { R.setSeason(si); R.setBeachSeason(si === 1); };
Game.worlds = {};
/** Laster veinett (data/*.geojson, ellers Overpass) og bygger verden for en by. */
Game.loading = {};
Game.loadWorld = function (id) {
  if (Game.worlds[id]) return Promise.resolve(Game.worlds[id]);
  const cfg = CITY_CONFIGS[id];
  if (!Game.loading[id]) Game.loading[id] = (async () => {
    const t0 = performance.now(), [rd, sites] = await Promise.all([loadRoadData(cfg), loadSites(cfg)]), t1 = performance.now();
    const w = buildWorld(cfg, rd.gj, sites); w.kilde = rd.kilde; Game.worlds[id] = w;
    console.info('[NødByen]', cfg.navn, 'veinett fra', rd.kilde, w.stat, 'henting ' + Math.round(t1 - t0) + ' ms, bygging ' + Math.round(performance.now() - t1) + ' ms');
    if (rd.kilde === 'generert') setTimeout(() => UI.toast('Fikk ikke hentet ekte veidata – bruker et enkelt gatenett. Kjør npm run data og commit data/ for ekte kart.', 'warn'), 800);
    return w;
  })().then(w => { delete Game.loading[id]; return w; }, e => { delete Game.loading[id]; throw e; });
  return Game.loading[id];
};
/** Laster begge byene i bakgrunnen mens spilleren ser menyen. */
Game.prefetch = function () { const ids = Object.keys(CITY_CONFIGS); (function next(i) { if (i >= ids.length) return; Game.loadWorld(ids[i]).catch(() => {}).then(() => setTimeout(() => next(i + 1), 500)); })(0); };
Game.fail = function (e, retry) {
  console.error(e);
  const fil = location.protocol === 'file:' ? ' Du har åpnet siden som fil – start den via en webserver (<code>npm start</code>), ellers kan ikke veidata leses.' : '';
  UI.modal({ title: 'Kunne ikke laste kartdata', html: '<p>Spillet kunne ikke startes: ' + esc(String(e && e.message || e)) + '.' + fil + ' Sjekk nettforbindelsen. Eier du siden: kjør <code>npm run data</code> og legg <code>data/*.geojson</code> i repoet.</p>', buttons: [{ label: 'Prøv igjen', cls: 'primary', fn: () => { retry(); } }, { label: 'Lukk', cls: 'ghost' }] });
};
/** Viser (og laster ved behov) en by som bakgrunn i menyene. */
Game.showCity = async function (id, season) {
  const w = await Game.loadWorld(id); WORLD = w; Game.world = w;
  if (Game.worldCity !== id) { R.seasonIdx = season; R.setWorld(w); Game.worldCity = id; } else Game.applySeason(season);
  R.setEnv(Game.envFor(season), true);
};
Game.toMenu = function (cityId) {
  S = null; Game.mode = 'menu'; Game.place = null; UI.sel = null; $('#alarmBar').innerHTML = '';
  if (R.world) { R.clearViews(); R.showCoverage(false); } R.setLabels([]);
  UI.screenCities();
};
/** Etatvalg vises straks; veinettet lastes i bakgrunnen og avventes først når etat er valgt. */
Game.pickAgency = function (cityId) {
  const c = CITY_CONFIGS[cityId]; if (R.map) { R.freeBounds(); R.map.flyTo({ center: [c.center.lon, c.center.lat], zoom: c.zoom, pitch: c.pitch, bearing: c.bearing, duration: 1800 }); }   // grensene fra forrige by må vekk, ellers sperrer de flyturen
  UI.screenAgency(cityId); Game.loadWorld(cityId).catch(() => {});
};
Game.beginFirstStation = async function (cityId, agency) {
  if (Game.starting) return; Game.starting = true;
  const back = e => { Game.starting = false; UI.screenAgency(cityId); Game.fail(e, () => Game.beginFirstStation(cityId, agency)); };
  if (!Game.worlds[cityId]) UI.showLoading('Laster kart og veinett for ' + CITY_CONFIGS[cityId].navn + ' …');
  try { await Game.showCity(cityId, UI.season); } catch (e) { back(e); return; }
  try {
    Sim.newGame(cityId, agency, UI.season, Game.world);
    R.seasonIdx = S.startSeason; R.setWorld(WORLD); R.setEnv(Game.envFor(S.startSeason), true);
    Game.mode = 'place0'; UI.hideScreen();
    $('#hud').classList.remove('hidden'); $('#topbar').classList.add('hidden'); $('#mapTools').classList.add('hidden'); $('#miniLog').classList.add('hidden'); $('#panel').classList.add('hidden'); UI.layout();
    const lots = Sim.freeLots();
    UI.beginPlacement({ title: 'Plasser første stasjon (' + AGENCIES[agency].navn + ')', hint: 'Trykk hvor som helst nær en vei (grønne ringer er forslag). Bygget som står der rives. De lilla feltene viser dekning.', lots, costText: 'gratis',
      onConfirm: lotId => { const r = Sim.firstStation(lotId); if (!r.ok) { UI.toast(r.msg, 'bad'); return false; } Game.enterPlay(true); } });
    R.map.easeTo({ pitch: 50, duration: 600 });
    Game.starting = false;
  } catch (e) { console.error(e); S = null; Game.mode = 'menu'; $('#hud').classList.add('hidden'); back(e); }
};
Game.continueCity = async function (id) {
  const o = Store.load(id); if (!o) { Game.pickAgency(id); return; }
  if (Game.starting) return; Game.starting = true;
  if (!Game.worlds[id]) UI.showLoading('Laster kart og veinett for ' + CITY_CONFIGS[id].navn + ' …');
  try { await Game.showCity(id, o.startSeason); } catch (e) { Game.starting = false; UI.screenCities(); Game.fail(e, () => Game.continueCity(id)); return; }
  Game.starting = false;
  try {
    S = o; WORLD = Game.world; WORLD.clearDyn(); Clock.info();
    // Tomter spilleren har opprettet, og bygg som sto på dem. Kartdata kan ha endret seg siden lagringen, så posisjonen er fasit.
    const fix = (lotId, x, z) => { const l = WORLD.lotById.get(lotId); if (l && (x === undefined || Math.hypot(l.x - x, l.z - z) < 3)) return lotId; const n = x === undefined ? null : WORLD.addLotDyn(x, z); return n ? n.id : lotId; };
    const dyn = [];
    for (const d of (S.dynLots || [])) { const n = WORLD.addLotDyn(d.x, d.z, /^d\d+$/.test(d.id) ? d.id : undefined); if (n) dyn.push({ id: n.id, x: d.x, z: d.z }); }
    S.dynLots = dyn; S.occ = {};
    for (const sid in S.stations) { const st = S.stations[sid]; st.lotId = fix(st.lotId, st.lx, st.lz); if (!WORLD.lotById.get(st.lotId)) throw new Error('mangler tomt for ' + st.name); S.occ[st.lotId] = sid; }
    for (const m of Object.values(S.net.masts)) { if (m.lotId) { m.lotId = fix(m.lotId, m.x, m.z); if (WORLD.lotById.get(m.lotId)) S.occ[m.lotId] = S.occ[m.lotId] || 'mast'; } }
    R.seasonIdx = Clock.cur.season; R.setWorld(WORLD);
    Net.dirty = true; S.paused = true; S.settings = S.settings || { auto: false, cover: false };
    for (const u of Object.values(S.units)) { u.path = u.path || []; u._eta = {}; }
    // eldre lagringer: kø, personell og nye felter
    S.calls = S.calls || []; S.staff = S.staff || []; S.vol.rs = !!S.vol.rs;
    for (const u of Object.values(S.units)) if (Staff.needs(u) && !Staff.of(u).length) Staff.crewFor(u, true);
    Vol.seasonSync(); Game.enterPlay(false);
  } catch (e) {
    console.error(e); S = null; Game.mode = 'menu'; UI.screenCities();
    UI.modal({ title: 'Lagringen kunne ikke åpnes', html: '<p>Det lagrede spillet passer ikke med kartdataene (' + esc(String(e && e.message || e)) + '). Du kan starte en ny runde i byen.</p>', buttons: [{ label: 'Start ny runde', cls: 'primary', fn: () => { Store.clear(id); Game.pickAgency(id); } }, { label: 'Lukk', cls: 'ghost' }] });
  }
};
Game.enterPlay = function (isNew) {
  Game.mode = 'play'; UI.hideScreen(); UI.sel = null; UI.lastHtml = '';
  $('#hud').classList.remove('hidden'); $('#topbar').classList.remove('hidden'); $('#mapTools').classList.remove('hidden'); $('#miniLog').classList.remove('hidden'); $('#miniLog').innerHTML = ''; $('#panel').classList.remove('hidden');
  UI.setSheet(1); UI.setTab('hendelser'); UI.layout(); Radio.defaults();
  UI.toggleCover(!!S.settings.cover);
  Clock.info(); S.ready = Sim.readiness(); UI.updateTop(); UI.alarmBar();
  const st = Object.values(S.stations).find(x => ST[x.type].rolle === 'etat'), l = st && WORLD.lotById.get(st.lotId);
  if (l) R.focus(l.x, l.z, 120);
  if (isNew) { UI.toast('Velkommen, beredskapsleder! Første hendelse kommer snart.', 'good'); S.speed = 1; S.paused = false; }
  else { UI.toast('Velkommen tilbake! Spillet er satt på pause – trykk ▶ for å fortsette.', 'info'); S.paused = true; }
  Store.save(); Game.saveTimer = 0;
};

Bus.on('incident', inc => {
  if (!S || S.flags.hint1) return; S.flags.hint1 = 1;
  UI.setTab('hendelser'); if (UI.sheet === 0) UI.setSheet(1);
  UI.toast('Ny hendelse! Trykk «Send enheter» på kortet for å sende nærmeste ledige enhet.', 'warn');
});

Game.fpsT = 0; Game.fpsN = 0; Game.envT = 0; Game.covT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const raw = (now - Game.last) / 1000; Game.last = now;
  const rdt = Math.min(0.1, raw);
  let simDt = 0;
  try {
    if (Game.mode === 'play' && S && !S.paused) {
      simDt = rdt * S.speed * MIN_PER_SEC;
      let rem = simDt; while (rem > 1e-6) { const d = Math.min(rem, 0.25); Sim.tick(d); rem -= d; }
    }
    if (Game.mode === 'menu' && R.map && !R.map.isMoving()) R.map.setBearing(R.map.getBearing() + rdt * 2.5);
    const live = (Game.mode === 'play' || Game.mode === 'place0') && S;
    if (live) {
      Game.envT += rdt;
      if (Game.envT > 0.3) {
        Game.envT = 0; const c = Clock.cur || Clock.info();
        R.setEnv({ daylight: c.daylight, hour: c.hour, season: c.season, weather: S.weather.kind, sunrise: c.sunrise, sunset: c.sunset });
        if (c.season !== R.seasonIdx) { Game.applySeason(c.season); UI.toast('Ny årstid: ' + SEASONS[c.season].navn.toLowerCase() + (c.season === 1 && Object.keys(WORLD.beaches).length ? ' – badesesongen er i gang' : c.season === 3 ? ' – glatte veier og mørke dager' : ''), 'info'); }
      }
      if (Net.dirty) { Net.dirty = false; R.updateCoverage(Net.signalAt.bind(Net)); }
    }
    R.frame(rdt, simDt, live ? S : null);
    Sound.sirenFrame(live ? S : null, rdt); Game.sndT = (Game.sndT || 0) + rdt; if (Game.sndT > .5 && R.map) { Game.sndT = 0; Sound.bed(clamp((R.map.getZoom() - 14) / 4, 0, 1), S && (S.weather.kind === 'regn' || S.weather.kind === 'storm'), (R.env.daylight || 1) < .4); }
    UI.update(rdt);
    if (Game.mode === 'play') { Game.saveTimer += rdt; if (Game.saveTimer > 20) { Game.saveTimer = 0; Store.save(); } }
  } catch (e) { console.error(e); Game.errors = (Game.errors || 0) + 1; if (Game.errors > 50) { S && (S.paused = true); } }
  // enkel adaptiv kvalitet
  if (raw < 0.5) { Game.fpsT += raw; Game.fpsN++; if (Game.fpsT > 3) { const avg = Game.fpsT / Game.fpsN; if (avg > 0.05 && Game.mode === 'play') { Game.slow = (Game.slow || 0) + 1;   // trinnvis: lavere oppløsning/skygger/trafikk, deretter færre bygningsdetaljer
            if (!Game.lowGfx) { Game.lowGfx = true; R.setQuality(1); R.initTraffic(); City.lastKey = ''; UI.toast('Grafikken er senket for jevnere spilling (kan endres i menyen)', 'info'); }
            else if (Game.slow === 3) { City.lite = true; City.lastKey = ''; UI.toast('Færre detaljer langt unna for jevnere spilling', 'info'); } } Game.fpsT = 0; Game.fpsN = 0; } }
}
R.onTap = function (x, y, touch) {
  if (Game.mode === 'place0' || Game.place) { UI.placeTap(x, y, touch); return; }
  if (Game.mode !== 'play' || !S || UI.mc) return;
  const hit = R.pick(x, y, touch, S);
  if (!hit) { UI.select(null); return; }
  UI.select({ type: hit.type, id: hit.id }, false);
};
R.onHover = function (x, y) { /* reservert for markering ved hover */ };

function fatal(msg) {
  const el_ = $('#loadMsg'); if (el_) { el_.innerHTML = '<div><b style="font-size:20px">NødByen kunne ikke starte</b><br><br>' + msg + '</div>'; el_.classList.remove('hidden'); }
}
async function boot() {
  if (typeof THREE === 'undefined') { fatal('Kunne ikke laste 3D-biblioteket (Three.js). Sjekk nettforbindelsen og last siden på nytt.'); return; }
  if (typeof maplibregl === 'undefined') { fatal('Kunne ikke laste kartbiblioteket (MapLibre GL JS). Sjekk nettforbindelsen og last siden på nytt.'); return; }
  const hasGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
  if (!hasGL) { fatal('Nettleseren din støtter ikke WebGL, som trengs for 3D-kartet. Prøv en nyere nettleser.'); return; }
  const q = new URLSearchParams(location.search);
  UI.init();
  let initP; try { initP = R.init($('#view'), { offline: q.has('offline') }); } catch (e) { fatal('Kartet kunne ikke startes: ' + esc(String(e.message || e))); return; }   initP.catch(() => {}); // ikke vent på kartfliser – menyen vises straks
  R.onTileError = () => UI.toast('Fikk ikke kontakt med kartfliser (OpenFreeMap). Spillet virker, men bakgrunnskartet kan mangle.', 'warn');
  // menyen vises alltid med en gang; veinett lastes først når du velger by
  const c0 = CITY_CONFIGS.oslo; R.map.jumpTo({ center: [c0.center.lon, c0.center.lat], zoom: c0.zoom, pitch: c0.pitch, bearing: c0.bearing });
  $('#loadMsg').remove(); UI.screenCities(); setTimeout(Game.prefetch, 300);
  Game.last = performance.now(); requestAnimationFrame(loop);
  window.addEventListener('error', e => { try { UI.toast('Feil: ' + (e.message || 'ukjent'), 'bad'); } catch (x) { /* ignorer */ } });
  window.addEventListener('pagehide', () => Store.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) Store.save(); });
}
boot();
try { window.NB = { get S() { return S; }, get WORLD() { return WORLD; }, Sim, Net, Vol, Eco, Shop, Clock, Log, Bus, R, UI, Game, Store, CITY_CONFIGS, UT, ST, TEMPLATES, buildWorld }; } catch (e) { /* feilsøkingshåndtak – mangler hvis et bibliotek ikke lastet */ }
