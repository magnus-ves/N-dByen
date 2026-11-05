'use strict';
/* ==========================================================================
   5. KART OG 3D-RENDERING
   MapLibre GL JS tegner kart og 3D-bygg (OpenFreeMap-fliser, egen pastellstil).
   Et Three.js «custom layer» tegner kjøretøy, stasjoner, master, hendelsesmarkører og effekter oppå kartet.
   ========================================================================== */
const _m4c = new THREE.Matrix4(), _m4 = new THREE.Matrix4(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s3 = new THREE.Vector3(), _v4 = new THREE.Vector4();
const VS = 2.6, SS = 5.2, MS = 5;          // modellskala (meter per modellenhet)
const TILE_URL = 'https://tiles.openfreemap.org/planet';
// Satellittbilder (Esri World Imagery). Bytt URL/kreditering her om du bruker en annen leverandør (se README om vilkår).
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_CREDIT = 'Satellitt: Esri, Maxar, Earthstar Geographics og GIS-brukerfellesskapet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const SEASON_STYLE = [
  { bg: '#F1EBD8', grass: '#C4D9B2', wood: '#A8C596', water: '#8DB4C4', bld: '#EFE4CC' },
  { bg: '#EFE9D4', grass: '#B4D1A2', wood: '#94B982', water: '#80B0C2', bld: '#F0E5CD' },
  { bg: '#EFE4CC', grass: '#D6C992', wood: '#BFA968', water: '#88AAB6', bld: '#E4D2B4' },
  { bg: '#F2F4F2', grass: '#EAF0ED', wood: '#D6E0DB', water: '#9DB5C0', bld: '#EDEAE3' }
];
const R = { ready: false, world: null, S: null, time: 0, seasonIdx: 0, dpr: 1, w: 800, h: 600, mats: {}, geos: {}, env: { daylight: 1, night: 0, hour: 12, weather: 'klar', season: 0 },
  cam: { dist: 150, tx: 0, tz: 0, gdist: 150, gpitch: 0.9 }, mpp: 1, onTap: null, onHover: null, coverOn: false, insetR: 0, insetB: 0, placeMode: null, mvp: new THREE.Matrix4(), L: new THREE.Matrix4(), camPos: new THREE.Vector3(0, 500, 0), views: null, wxMode: '' };
R.mat = hex => R.mats['l' + hex] || (R.mats['l' + hex] = new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide }));
R.matB = hex => R.mats['b' + hex] || (R.mats['b' + hex] = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide }));
R.geo = (k, f) => R.geos[k] || (R.geos[k] = f());
R.box = (w, h, d, hex, x, y, z, basic) => { const m = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), basic ? R.matB(hex) : R.mat(hex)); m.scale.set(w, h, d); m.position.set(x || 0, y || 0, z || 0); return m; };

/** Kartstil i «organisk» pastellpalett. Bruker OpenMapTiles-skjemaet fra OpenFreeMap. offline = bare bakgrunn. */
R.bldBase = {};
R.style = function (offline) {
  const P = SEASON_STYLE[0], layers = [{ id: 'bg', type: 'background', paint: { 'background-color': P.bg } }];
  if (!offline) {
    layers.push({ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.1, 'raster-contrast': 0.05, 'raster-fade-duration': 150 } });
    const f = (id, src, type, filter, paint, extra) => layers.push(Object.assign({ id, type, source: 'om', 'source-layer': src, paint }, filter ? { filter } : {}, extra || {}));
    f('landcover-grass', 'landcover', 'fill', ['in', 'class', 'grass', 'farmland'], { 'fill-color': P.grass });
    f('landcover-wood', 'landcover', 'fill', ['==', 'class', 'wood'], { 'fill-color': P.wood, 'fill-opacity': 0.8 });
    f('park', 'park', 'fill', null, { 'fill-color': P.grass });
    f('landuse-res', 'landuse', 'fill', ['in', 'class', 'residential', 'suburb', 'neighbourhood'], { 'fill-color': '#EDE3CC', 'fill-opacity': 0.7 });
    f('landuse-com', 'landuse', 'fill', ['in', 'class', 'commercial', 'retail', 'industrial'], { 'fill-color': '#E7DAC0', 'fill-opacity': 0.7 });
    f('landuse-pitch', 'landuse', 'fill', ['in', 'class', 'pitch', 'playground', 'cemetery'], { 'fill-color': '#CFE0BC' });
    f('water', 'water', 'fill', null, { 'fill-color': P.water });
    f('water-fx', 'water', 'fill', null, { 'fill-pattern': 'water-anim', 'fill-opacity': 0.5 });   // animerte bølger oppå satellitt og kart
    f('waterway', 'waterway', 'line', null, { 'line-color': P.water, 'line-width': 1.4 });
    const road = (id, cls, w, col, casing) => { if (casing) f(id + '-c', 'transportation', 'line', ['all', ['in', 'class'].concat(cls), ['!=', 'brunnel', 'tunnel']], { 'line-color': '#CDBF9F', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, w * 0.6, 15, w * 1.9, 18, w * 5.2] }, { layout: { 'line-cap': 'round', 'line-join': 'round' } });
      f(id, 'transportation', 'line', ['all', ['in', 'class'].concat(cls), ['!=', 'brunnel', 'tunnel']], { 'line-color': col, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, w * 0.4, 15, w * 1.4, 18, w * 4.2] }, { layout: { 'line-cap': 'round', 'line-join': 'round' } }); };
    road('r-minor', ['minor', 'service', 'track'], 1.6, '#FBF7EC', true);
    road('r-tert', ['tertiary'], 2.2, '#FBF4E0', true);
    road('r-sec', ['secondary', 'primary'], 2.8, '#F6E6BC', true);
    road('r-trunk', ['motorway', 'trunk'], 3.2, '#EFD9A2', true);
    f('r-path', 'transportation', 'line', ['in', 'class', 'path', 'pedestrian'], { 'line-color': '#E4D7B8', 'line-width': 1, 'line-dasharray': [2, 2] });
    f('r-rail', 'transportation', 'line', ['==', 'class', 'rail'], { 'line-color': '#C9BFA8', 'line-width': 1.2, 'line-dasharray': [3, 2] });
    // 3D-bygg: vindusmønster på veggene (lages i kode, se R.makeWindows). Lave hus og høyhus får hvert sitt mønster.
    const ex = pat => ({ 'fill-extrusion-pattern': pat, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.97, 'fill-extrusion-vertical-gradient': true });
    // fem fasadevarianter per type, fordelt etter bygningens id (datadrevne mønstre støttes ikke godt, så hver variant er et eget lag)
    const vk = ['%', ['floor', ['to-number', ['coalesce', ['id'], ['*', ['to-number', ['get', 'render_height'], 6], 7]], 0]], 5];
    for (let k = 0; k < 5; k++) {
      R.bldBase['bld-low-' + k] = ['all', ['!=', ['get', 'hide_3d'], true], ['<', ['coalesce', ['get', 'render_height'], 6], 14], ['==', vk, k]];
      R.bldBase['bld-high-' + k] = ['all', ['!=', ['get', 'hide_3d'], true], ['>=', ['coalesce', ['get', 'render_height'], 6], 14], ['==', vk, k]];
      f('bld-low-' + k, 'building', 'fill-extrusion', R.bldBase['bld-low-' + k], ex('win-low-' + k), { minzoom: 14 });
      f('bld-high-' + k, 'building', 'fill-extrusion', R.bldBase['bld-high-' + k], ex('win-high-' + k), { minzoom: 14 });
    }
    const nm = ['coalesce', ['get', 'name:nb'], ['get', 'name']];
    layers.push({ id: 'water-name', type: 'symbol', source: 'om', 'source-layer': 'water_name', layout: { 'text-field': nm, 'text-font': ['Noto Sans Italic'], 'text-size': 12 }, paint: { 'text-color': '#5F8797', 'text-halo-color': '#F1EBD8', 'text-halo-width': 1 } });
    layers.push({ id: 'place', type: 'symbol', source: 'om', 'source-layer': 'place', filter: ['in', 'class', 'suburb', 'neighbourhood', 'quarter'], layout: { 'text-field': nm, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 }, paint: { 'text-color': '#7A8776', 'text-halo-color': '#F6F0E0', 'text-halo-width': 1.4 } });
    layers.push({ id: 'street-name', type: 'symbol', source: 'om', 'source-layer': 'transportation_name', minzoom: 15.5, layout: { 'text-field': nm, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'symbol-placement': 'line' }, paint: { 'text-color': '#7B7566', 'text-halo-color': '#FBF7EC', 'text-halo-width': 1.2 } });
  }
  const style = { version: 8, name: 'NødByen pastell', glyphs: GLYPHS, sky: { 'sky-color': '#8FBBE3', 'horizon-color': '#E6EEF2', 'fog-color': '#DCE5EA', 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0.8 }, sources: offline ? {} : { om: { type: 'vector', url: TILE_URL, attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap' }, sat: { type: 'raster', tiles: [SAT_URL], tileSize: 256, maxzoom: 18, attribution: SAT_CREDIT } }, layers, light: { anchor: 'viewport', color: '#fff6e6', intensity: 0.38, position: [1.2, 200, 38] } };
  return style;
};
R.setSeason = function (si) {
  R.seasonIdx = si; const map = R.map; if (!map || !R.ready) return; /* isStyleLoaded() er false så lenge fliser lastes, så R.ready brukes */ const P = SEASON_STYLE[si], set = (id, prop, v) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, v); };
  set('bg', 'background-color', P.bg); for (const id of ['landcover-grass', 'park']) set(id, 'fill-color', P.grass); set('landcover-wood', 'fill-color', P.wood); set('water', 'fill-color', P.water); set('waterway', 'line-color', P.water);
  // satellittbildet er statisk; vinter bleker det litt, høst varmer det
  set('sat', 'raster-saturation', [-0.1, -0.1, 0.0, -0.45][si]); set('sat', 'raster-brightness-max', [1, 1, 0.95, 1][si]); set('sat', 'raster-hue-rotate', [0, 0, -12, 0][si]); set('sat', 'raster-brightness-min', si === 3 ? 0.18 : 0);
};
/** Bunnkart: 'sat' = satellitt (standard), 'kart' = tegnet pastellkart. */
R.setBase = function (mode) {
  R.base = mode; const map = R.map; if (!map || !map.getLayer('sat')) return; const sat = mode === 'sat', vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
  vis('sat', sat); for (const id of ['landcover-grass', 'landcover-wood', 'park', 'landuse-res', 'landuse-com', 'landuse-pitch', 'water', 'waterway']) vis(id, !sat);
  for (const id of ['r-minor-c', 'r-tert-c', 'r-sec-c', 'r-trunk-c', 'r-minor', 'r-tert', 'r-sec', 'r-trunk', 'r-path', 'r-rail']) if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', sat ? (id.endsWith('-c') ? 0.35 : 0.62) : 1);
  for (const id of ['water-name', 'place', 'street-name']) if (map.getLayer(id)) { map.setPaintProperty(id, 'text-color', sat ? '#FFFFFF' : (id === 'water-name' ? '#5F8797' : id === 'place' ? '#7A8776' : '#7B7566')); map.setPaintProperty(id, 'text-halo-color', sat ? 'rgba(30,40,35,0.75)' : '#F6F0E0'); }
  const cr = $('#credit'); if (cr) { const x = cr.querySelector('.satc'); if (x) x.style.display = sat ? '' : 'none'; }
};
/** Vindusmønster for 3D-bygg (tegnes på canvas). hoy = høyhus med glass, natt = opplyste vinduer. */
/** Mønster per bygning: variant velges ut fra bygningens id, natt gir opplyste vinduer. */
const FACADE = {
  low: [{ wall: '#B4583F', mortar: true, win: '#40525E', frame: '#F1ECE2' }, { wall: '#E6CF9E', win: '#3E5260', frame: '#FAF6EC' }, { wall: '#F1ECE1', win: '#425765', frame: '#B9B2A5' },
    { wall: '#C9B496', win: '#3B4B57', frame: '#F4EFE4' }, { wall: '#9FB0AA', win: '#33434E', frame: '#EFF2EF' }],
  high: [{ wall: '#7FA3B8', glass: true, win: '#5D8299' }, { wall: '#93A79F', glass: true, win: '#6E8B84' }, { wall: '#CFCBC2', win: '#46596A', band: true },
    { wall: '#A9644B', mortar: true, win: '#3A4A56', frame: '#E8E2D6' }, { wall: '#E7E4DD', win: '#4A6070', band: true }]
};
R.makeWindows = function (name) {
  const hoy = name.indexOf('high') > 0, natt = /-n$/.test(name), k = (+(name.match(/-(\d)/) || [0, 0])[1]) % 5, F = (hoy ? FACADE.high : FACADE.low)[k];
  const S_ = 128, c = document.createElement('canvas'); c.width = c.height = S_; const x = c.getContext('2d');
  x.fillStyle = F.wall; x.fillRect(0, 0, S_, S_);
  if (F.mortar) { x.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < S_; y += 6) { x.fillRect(0, y, S_, 1); for (let xx = (y / 6) % 2 ? 0 : 7; xx < S_; xx += 14) x.fillRect(xx, y, 1, 6); } }
  if (F.glass) {   // glassfasade med spiler
    const g = x.createLinearGradient(0, 0, S_, S_); g.addColorStop(0, shade(F.win, 0.25)); g.addColorStop(1, shade(F.win, -0.2)); x.fillStyle = g; x.fillRect(0, 0, S_, S_);
    x.fillStyle = 'rgba(230,240,245,.55)'; for (let i = 0; i <= 4; i++) x.fillRect(i * 32 - 1, 0, 3, S_); for (let j = 0; j <= 4; j++) x.fillRect(0, j * 32 - 1, S_, 3);
    if (natt) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i * 5 + j * 3 + k) % 3) { x.fillStyle = 'rgba(255,214,140,.85)'; x.fillRect(i * 32 + 3, j * 32 + 3, 27, 27); }
  } else {
    const cols = hoy ? 4 : 3, rows = hoy ? 4 : 3, cw = S_ / cols, rh = S_ / rows;
    if (F.band) { x.fillStyle = 'rgba(0,0,0,.07)'; for (let j = 0; j < rows; j++) x.fillRect(0, j * rh + rh * .78, S_, rh * .1); }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const lit = natt && ((i * 7 + j * 5 + k) % 3 !== 0), px = i * cw + cw * (F.band ? .08 : .22), py = j * rh + rh * .2, w = cw * (F.band ? .84 : .56), h = rh * .52;
      if (F.frame) { x.fillStyle = F.frame; x.fillRect(px - 2, py - 2, w + 4, h + 4); }
      const g = x.createLinearGradient(0, py, 0, py + h); g.addColorStop(0, lit ? '#FFE3A6' : shade(F.win, 0.3)); g.addColorStop(1, lit ? '#F2B65C' : F.win); x.fillStyle = g; x.fillRect(px, py, w, h);
      x.fillStyle = F.frame || 'rgba(255,255,255,.4)'; x.fillRect(px + w / 2 - 1, py, 2, h); x.fillRect(px, py + h * .38, w, 2);
      x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(px - 2, py + h + 2, w + 4, 3);
    }
  }
  const d = x.getImageData(0, 0, S_, S_); return { width: S_, height: S_, data: new Uint8Array(d.data.buffer) };
};
/** Bølgemønster for vannet (tegnes på nytt noen ganger i sekundet). */
R.makeWater = function (t) {
  const S_ = 64, c = R._wc || (R._wc = document.createElement('canvas')); c.width = c.height = S_; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, S_, S_); g.addColorStop(0, '#2F6F8A'); g.addColorStop(1, '#245C78'); x.fillStyle = g; x.fillRect(0, 0, S_, S_);
  for (let i = 0; i < 9; i++) {
    const y0 = (i * 7.1 + t * 6) % S_, ph = i * 1.7 + t * 1.3; x.strokeStyle = 'rgba(210,235,245,' + (0.18 + 0.12 * Math.sin(ph)) + ')'; x.lineWidth = 1.2; x.beginPath();
    for (let xx = 0; xx <= S_; xx += 4) { const y = y0 + Math.sin((xx / S_) * TAU * 2 + ph) * 1.6; xx ? x.lineTo(xx, y) : x.moveTo(xx, y); } x.stroke();
  }
  const d = x.getImageData(0, 0, S_, S_); return { width: S_, height: S_, data: new Uint8Array(d.data.buffer) };
};
R.waterT = 0;
R.waterTick = function (dt) { const m = R.map; if (!m || !R.ready || !m.hasImage('water-anim')) return; R.waterT += dt; R._wAcc = (R._wAcc || 0) + dt; if (R._wAcc < 0.12) return; R._wAcc = 0; try { m.updateImage('water-anim', R.makeWater(R.waterT)); } catch (e) { /* ignorer */ } };


/* ---------- tak: saltak oppå lave hus, bygget fra byggeomrisset i vektorflisene ---------- */
const ROOF_COL = [0xB5694F, 0xA65F47, 0x6F6A68, 0x7A5F55, 0x8E5E4C, 0x5E6670, 0xC07A5A];
function gableGeo() {
  const A = [-.5, 0, -.5], B = [.5, 0, -.5], C = [.5, 0, .5], D = [-.5, 0, .5], R1 = [-.5, 1, 0], R2 = [.5, 1, 0], t = [].concat(D, C, R2, D, R2, R1, B, A, R1, B, R1, R2, A, D, R1, C, B, R2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(t, 3)); g.computeVertexNormals(); return g;
}
/** Minste omskrevne rektangel (roterende), returnerer {cx,cz,w,d,a} der w er langside, a vinkel i x/z-planet. */
function minRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], a = Math.atan2(q[1] - p[1], q[0] - p[0]), c = Math.cos(a), sn = Math.sin(a);
    let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
    for (const r of pts) { const u = r[0] * c + r[1] * sn, v = -r[0] * sn + r[1] * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v); }
    const area = (x1 - x0) * (z1 - z0); if (!best || area < best.area) best = { area, a, c, sn, x0, x1, z0, z1 };
  }
  const b = best, mu = (b.x0 + b.x1) / 2, mv = (b.z0 + b.z1) / 2, w = b.x1 - b.x0, d = b.z1 - b.z0;
  return { cx: mu * b.c - mv * b.sn, cz: mu * b.sn + mv * b.c, w, d, a: b.a, area: b.area };
}
function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; }
R.roofs = { mesh: null, keys: new Set(), items: [], busy: false };
R.updateRoofs = function () {
  const map = R.map, w = R.world; if (!map || !w || !map.getSource('om') || map.getZoom() < 16.2 || R.roofs.busy) return;
  R.roofs.busy = true;
  try {
    const c = map.getCenter(), cp = w.proj.toXZ(c.lat, c.lng), rad = clamp(R.mpp * Math.max(R.w, R.h) * 0.8, 250, 900), feats = map.querySourceFeatures('om', { sourceLayer: 'building' }), RR = R.roofs;
    let made = 0;
    for (const f of feats) {
      if (made > 700) break;
      const g = f.geometry; if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      const ring = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]); if (!ring || ring.length < 4 || ring.length > 24) continue;
      const h = (f.properties && f.properties.render_height) || 6; if (h >= 16) continue;
      { const q0 = w.proj.toXZ(ring[0][1], ring[0][0]); if (Math.hypot(q0.x - cp.x, q0.z - cp.z) > rad + 80) continue; }   // billig forhåndsfilter
      const pts = ring.slice(0, -1).map(q => { const p = w.proj.toXZ(q[1], q[0]); return [p.x, p.z]; });
      const r = minRect(pts); if (Math.hypot(r.cx - cp.x, r.cz - cp.z) > rad) continue;
      const short = Math.min(r.w, r.d), long = Math.max(r.w, r.d); if (short < 4 || long > 60 || polyArea(pts) / r.area < 0.8) continue;   // bare tilnærmet rektangulære hus
      const key = Math.round(r.cx / 1.5) + ',' + Math.round(r.cz / 1.5) + ',' + Math.round(h); if (RR.keys.has(key)) continue; RR.keys.add(key); made++;
      const ridgeAlongW = r.w >= r.d;
      RR.items.push({ x: r.cx, z: r.cz, y: (f.properties && f.properties.render_min_height ? 0 : 0) + h, sx: (ridgeAlongW ? r.w : r.d) + 0.8, sz: (ridgeAlongW ? r.d : r.w) + 0.8, rh: clamp(short * 0.34, 1.6, 5), a: ridgeAlongW ? r.a : r.a + Math.PI / 2, col: ROOF_COL[(Math.abs(Math.round(r.cx * 7 + r.cz * 13))) % ROOF_COL.length] });
    }
    if (RR.items.length > 6000) { RR.items.splice(0, RR.items.length - 6000); RR.keys = new Set(RR.items.map(it => Math.round(it.x / 1.5) + ',' + Math.round(it.z / 1.5) + ',' + Math.round(it.y))); }
    if (RR.mesh) { R.scene.remove(RR.mesh); RR.mesh.dispose(); RR.mesh = null; }
    const m = RR.mesh = new THREE.InstancedMesh(R.geo('gable', gableGeo), R.roofMat || (R.roofMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })), Math.max(1, RR.items.length)), col = new THREE.Color();
    RR.items.forEach((it, i) => { _v3.set(it.x, it.y, it.z); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -it.a); _s3.set(it.sx, it.rh, it.sz); _m4.compose(_v3, _q, _s3); m.setMatrixAt(i, _m4); col.setHex(it.col); m.setColorAt(i, col); });
    m.count = RR.items.length; m.frustumCulled = false; R.scene.add(m);
  } catch (e) { console.warn('tak', e); }
  R.roofs.busy = false;
};
R.clearRoofs = function () { const RR = R.roofs; if (RR.mesh) { R.scene.remove(RR.mesh); RR.mesh = null; } RR.keys.clear(); RR.items = []; };

/* ---------- initialisering ---------- */
R.init = function (container, opts) {
  opts = opts || {}; R.offline = !!opts.offline;
  return new Promise((resolve, reject) => {
    let map;
    try {
      map = new maplibregl.Map({ container, style: R.style(!!opts.offline), center: [10.752, 59.913], zoom: 14.5, pitch: 55, bearing: -18, maxPitch: 75, minZoom: 12.5, maxZoom: 19.5, attributionControl: false, antialias: true, dragRotate: true, pitchWithRotate: true, touchPitch: true, hash: false, fadeDuration: 150, localIdeographFontFamily: false });
    } catch (e) { reject(e); return; }
    R.map = map; map.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); R.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    map.touchZoomRotate.enableRotation();
    R.scene = new THREE.Scene(); R.camera = new THREE.Camera();
    R.hemi = new THREE.HemisphereLight(0xfaf3e2, 0xdadcc8, 0.9); R.sun = new THREE.DirectionalLight(0xfff1d6, 0.7); R.sun.position.set(60, 90, 40);
    R.scene.add(R.hemi, R.sun); R.dyn = new THREE.Group(); R.scene.add(R.dyn);
    R.layer = {
      id: 'game3d', type: 'custom', renderingMode: '3d',
      onAdd(m, gl) { R.renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true }); R.renderer.autoClear = false; },
      render(gl, matrix) {
        if (!R.world) return;
        R.mvp.fromArray(matrix).multiply(R.L);
        // ekte kameraposisjon (meter), så speilinger og lys i materialene følger synsvinkelen
        try { const cp = R.map.transform.getCameraPosition(), q = R.world.proj.toXZ(cp.lngLat.lat, cp.lngLat.lng); R.camPos.set(q.x, cp.altitude, q.z); } catch (e) { R.camPos.set(R.cam.tx, 500, R.cam.tz); }
        R.camera.position.copy(R.camPos); R.camera.updateMatrixWorld(true);
        R.camera.projectionMatrix.copy(R.mvp).multiply(_m4c.makeTranslation(R.camPos.x, R.camPos.y, R.camPos.z)); R.camera.projectionMatrixInverse.copy(R.camera.projectionMatrix).invert();
        R.renderer.resetState(); R.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); R.renderer.render(R.scene, R.camera);
      }
    };
    map.on('styleimagemissing', e => { if (map.hasImage(e.id)) return; if (/^win-/.test(e.id)) map.addImage(e.id, R.makeWindows(e.id), { pixelRatio: 2 }); else if (e.id === 'water-anim') map.addImage(e.id, R.makeWater(0), { pixelRatio: 1 }); });
    let done = false, errShown = false;
    map.on('error', e => { if (!errShown && e && e.error && /tile|fetch|Failed|NetworkError|AJAX/i.test(String(e.error.message || e.error))) { errShown = true; R.tileError = true; if (R.onTileError) R.onTileError(e.error); } });
    const addFacades = () => { for (const k of ['low', 'high']) for (let i = 0; i < 5; i++) for (const n of ['', '-n']) { const id = 'win-' + k + '-' + i + n; if (!map.hasImage(id)) map.addImage(id, R.makeWindows(id), { pixelRatio: 2 }); } if (!map.hasImage('water-anim')) map.addImage('water-anim', R.makeWater(0)); };
    map.on('style.load', addFacades);
    map.on('load', () => { addFacades(); map.addLayer(R.layer); R.ready = true; R.setBase(R.base || 'sat'); R.setSeason(R.seasonIdx); if (!done) { done = true; resolve(true); } });
    map.on('click', e => { if (R.onTap) R.onTap(e.point.x, e.point.y, !!(e.originalEvent && (e.originalEvent.pointerType === 'touch' || e.originalEvent.type === 'touchend'))); });
    map.on('resize', () => R.resize());
    let rt = 0, rLast = 0; const roofSoon = () => { clearTimeout(rt); const wait = performance.now() - rLast > 1500 ? 60 : 500; rt = setTimeout(() => { rLast = performance.now(); (window.requestIdleCallback ? requestIdleCallback(() => City.update(), { timeout: 1500 }) : City.update()); }, wait); }; map.on('moveend', roofSoon); ['dragstart', 'wheel', 'touchstart'].forEach(ev => map.on(ev, () => { R.follow = null; })); map.on('idle', () => { if (!City.mesh || City.lastKey === '') roofSoon(); R.fixBeaches(); });
    R.resize();
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 3500);
  });
};
R.resize = function () { if (!R.map) return; const c = R.map.getCanvas(); R.w = c.clientWidth || window.innerWidth; R.h = c.clientHeight || window.innerHeight; R.dpr = R.map.getPixelRatio ? R.map.getPixelRatio() : 1; };
R.setQuality = function (cap) { if (R.map) { R.map.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap)); R.resize(); } };
R.resize0 = null;
R.setPadding = function (right, bottom) {
  right = Math.round(right); bottom = Math.round(bottom);
  if (R._padSet && R.insetR === right && R.insetB === bottom) return;   // map.setPadding er en jumpTo: den avbryter pågående dra og animasjoner, så bare kall ved endring
  R.insetR = right; R.insetB = bottom; if (R.map) { R._padSet = true; R.map.setPadding({ top: 0, left: 0, right, bottom }); }
};

/* ---------- verden: opprinnelse for lokale meterkoordinater, dekningslag, strender ---------- */
R.clearWorld = function () {
  R.clearRoofs(); City.clear();
  if (R.roadDebug) { R.scene.remove(R.roadDebug); R.roadDebug = null; }
  while (R.dyn.children.length) R.dyn.remove(R.dyn.children[0]);
  if (R.coverMesh) { R.scene.remove(R.coverMesh); R.coverMesh = null; }
  if (R.beachGroup) { R.scene.remove(R.beachGroup); R.beachGroup = null; }
  R.selRing = null; R.placeRings = null; R.pathLine = null; R.placeMode = null; R.sel = null; R.views = { stations: {}, masts: {}, units: {}, incidents: {}, ghosts: {}, alarms: {} };
};
R.setWorld = function (world, opts) {
  R.clearWorld(); R.world = world; const c = world.cfg.center;
  const o = maplibregl.MercatorCoordinate.fromLngLat([c.lon, c.lat], 0), s = o.meterInMercatorCoordinateUnits();
  R.origin = o; R.metersToMerc = s;
  R.L.makeTranslation(o.x, o.y, o.z).scale(new THREE.Vector3(s, -s, s)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  buildCoverage(); buildBeaches(); R.fxInit(); R.ensureOverlay(); R.initTraffic(); if (R.glowPts) { R.scene.remove(R.glowPts); R.glow = null; }
  if (R.offline) { // testvisning uten fliser: tegn veinettet som linjer
    const pts = []; for (const e of world.edges) for (let i = 1; i < e.geom.length; i++) pts.push(e.geom[i - 1][0], 0.3, e.geom[i - 1][1], e.geom[i][0], 0.3, e.geom[i][1]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); R.roadDebug = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb9ad90 })); R.scene.add(R.roadDebug);
  }
  R.map.setMaxBounds([[world.cfg.bbox[0] - 0.02, world.cfg.bbox[1] - 0.015], [world.cfg.bbox[2] + 0.02, world.cfg.bbox[3] + 0.015]]);
  R.resetCamera(true); R.setSeason(R.seasonIdx); R.setEnv(R.env, true);
};
R.toLL = (x, z) => { const p = R.world.proj.toLL(x, z); return [p.lon, p.lat]; };
R.resetCamera = function (instant) {
  const cfg = R.world.cfg, o = { center: [cfg.center.lon, cfg.center.lat], zoom: cfg.zoom, pitch: cfg.pitch, bearing: cfg.bearing, duration: instant ? 0 : 1400 };
  if (instant) R.map.jumpTo(o); else R.map.flyTo(o);
};
R.focus = function (x, z, dist) {
  const zoom = clamp(18.4 - Math.log2(Math.max(30, dist || 90) / 40), 15.5, 18.4);
  R.map.easeTo({ center: R.toLL(x, z), zoom: Math.max(R.map.getZoom(), zoom), duration: 900 });
};
R.rotate = function (da) { R.map.easeTo({ bearing: R.map.getBearing() - da * 57.3, duration: 400 }); };
R.terrainPoint = function (px, py) { const ll = R.map.unproject([px, py]), p = R.world.proj.toXZ(ll.lat, ll.lng); return { x: p.x, z: p.z }; };
R.screenOf = function (x, y, z) {
  _v4.set(x, y, z, 1).applyMatrix4(R.mvp); if (_v4.w <= 0) return null;
  const nx = _v4.x / _v4.w, ny = _v4.y / _v4.w; if (_v4.z / _v4.w > 1) return null;
  return { x: (nx + 1) / 2 * R.w, y: (1 - ny) / 2 * R.h };
};
/** Er punktet (meter) opptatt av bygg (innenfor margin) eller vann ifølge kartdataene? Uten kartdata: aldri. */
R.blockedAt = function (x, z, margin) {
  const map = R.map, w = R.world; if (!map || !w || !map.getSource('om')) return false;
  // Byggeomriss og vann i nærheten leses ut av kartfliser (dyrt), så listen gjenbrukes for punkter nær hverandre i et par sekunder.
  const now = performance.now(), bc = R._blk;
  if (!bc || now - bc.t > 2500 || Math.hypot(bc.x - x, bc.z - z) > 120 || bc.w !== w) {
    const rings = []; let ok = true;
    for (const layer of ['building', 'water']) {
      let feats = []; try { feats = map.querySourceFeatures('om', { sourceLayer: layer }); } catch (e) { ok = false; break; }
      for (const f of feats) {
        const g = f.geometry; if (!g) continue; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        for (const poly of polys) {
          const o = poly[0]; if (!o || o.length < 4) continue;
          let near = false; const ring = o.map(q => { const p = w.proj.toXZ(q[1], q[0]); if (Math.abs(p.x - x) < 260 && Math.abs(p.z - z) < 260) near = true; return [p.x, p.z]; });
          if (near || layer === 'water') { let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18; for (const q of ring) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } if (x0 < x + 260 && x1 > x - 260 && z0 < z + 260 && z1 > z - 260) rings.push({ layer, ring, x0, x1, z0, z1 }); }
        }
      }
    }
    if (!ok) return false; R._blk = { t: now, x, z, w, rings };
  }
  const inPoly = (ring, px, pz) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pz) !== (b[1] > pz) && px < (b[0] - a[0]) * (pz - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const dSeg = (px, pz, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1e-9, t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / L, 0, 1); return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t); };
  for (const r of R._blk.rings) {
    if (x < r.x0 - margin || x > r.x1 + margin || z < r.z0 - margin || z > r.z1 + margin) continue;
    if (inPoly(r.ring, x, z)) return true;
    if (r.layer === 'building') for (let i = 1; i < r.ring.length; i++) if (dSeg(x, z, r.ring[i - 1], r.ring[i]) < margin) return true;
  }
  return false;
};
R.freeBounds = function () { if (R.map) R.map.setMaxBounds(null); };   // trengs før kameraet flyttes til en annen by
/** Fjerner kjøretøy, markører og effekter fra forrige runde (verden og dekningslaget beholdes). */
R.clearViews = function () {
  if (!R.dyn) return;
  while (R.dyn.children.length) R.dyn.remove(R.dyn.children[0]);
  R.selRing = null; R.placeRings = null; R.pathLine = null; R.placeMode = null; R.sel = null; R.views = { stations: {}, masts: {}, units: {}, incidents: {}, ghosts: {}, alarms: {} };
  if (R.fx) { R.fx.life.fill(0); R.fx.alpha.fill(0); R.fx.size.fill(0); }
  R.ensureOverlay();
};
R.updateCam = function () {
  const c = R.map.getCenter(), p = R.world.proj.toXZ(c.lat, c.lng), z = R.map.getZoom();
  R.mpp = 78271.517 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, z); R.cam.tx = p.x; R.cam.tz = p.z; R.cam.dist = R.mpp * 100; R.cam.gdist = R.cam.dist;
  R.res.set(R.w, R.h);
};

/* ---------- dekningslag (mykt felt på bakken) ---------- */
function buildCoverage() {
  const w = R.world, step = 70, nx = Math.ceil((w.X1 - w.X0) / step) + 1, nz = Math.ceil((w.Z1 - w.Z0) / step) + 1, n = nx * nz;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; pos[k * 3] = w.X0 + i * step; pos[k * 3 + 1] = 1.5; pos[k * 3 + 2] = w.Z0 + j * step; }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setIndex(idx);
  const m = R.coverMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 3; m.visible = false; m.frustumCulled = false; m.userData = { nx, nz, step }; R.scene.add(m);
}
R.updateCoverage = function (signalFn) {
  const m = R.coverMesh; if (!m) return; const col = m.geometry.attributes.color, pos = m.geometry.attributes.position, n = pos.count;
  for (let k = 0; k < n; k++) {
    const s = signalFn(pos.getX(k), pos.getZ(k)); let r, g, b, a;
    if (s >= 0.26) { r = 0.62; g = 0.55; b = 0.82; a = 0.3 + 0.1 * Math.min(1, (s - 0.26) / 0.5); } else if (s >= 0.07) { r = 0.82; g = 0.78; b = 0.9; a = 0.24; } else { r = 0.45; g = 0.46; b = 0.52; a = 0.16; }
    col.setXYZW(k, r, g, b, a);
  }
  col.needsUpdate = true;
};
R.showCoverage = function (on) { R.coverOn = !!on; if (R.coverMesh) R.coverMesh.visible = !!on; };

/* ---------- strender: sandflate, livredningstårn og livredder ---------- */
function buildBeaches() {
  const g = R.beachGroup = new THREE.Group(); R.beachViews = {}; R.scene.add(g);
  for (const id in R.world.beaches) {
    const b = R.world.beaches[id], grp = new THREE.Group(); grp.position.set(b.tower.x, 0, b.tower.z); grp.rotation.y = Math.atan2(b.wv[0], b.wv[1]); g.add(grp);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(22, 28), new THREE.MeshBasicMaterial({ color: 0xEBD9A8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.set(0, 0.6, 6); grp.add(disc);
    const tw = new THREE.Group(); tw.scale.setScalar(5.5);
    for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) tw.add(R.box(0.1, 1.5, 0.1, 0xC8A27A, sx, 0.75, sz));
    for (const sz of [-0.45, 0.45]) { const br = R.box(0.06, 1.25, 0.06, 0xB08B64, 0, 0.75, sz); br.rotation.z = 0.62; tw.add(br); }
    tw.add(R.box(1.3, 0.12, 1.5, 0xD9BE92, 0, 1.5, 0.08)); tw.add(R.box(1.1, 0.75, 1.0, 0xE2452F, 0, 1.94, -0.1)); tw.add(R.box(1.12, 0.12, 1.02, 0xF2D21B, 0, 1.86, -0.1));
    tw.add(R.box(1.5, 0.1, 1.4, 0xF4F1EA, 0, 2.38, -0.05)); tw.add(R.box(0.8, 0.3, 0.04, 0x2a3a46, 0, 2.02, 0.41));
    for (let i = 0; i < 6; i++) tw.add(R.box(0.5, 0.04, 0.1, 0xC8A27A, 0, 0.2 + i * 0.24, 0.9 - i * 0.07));   // trapp
    tw.add(R.box(0.03, 0.9, 0.03, 0xdddddd, 0.6, 2.85, -0.5)); tw.add(R.box(0.36, 0.22, 0.02, 0xE2452F, 0.78, 3.18, -0.5)); tw.add(R.box(0.36, 0.1, 0.021, 0xF2D21B, 0.78, 3.18, -0.5));
    const ring = new THREE.Mesh(R.geo('buoyr', () => new THREE.TorusGeometry(0.17, 0.05, 6, 14)), R.mat(0xE2452F)); ring.position.set(-0.56, 1.95, 0.25); ring.rotation.y = Math.PI / 2; tw.add(ring);
    const guard = new THREE.Group(); guard.position.set(0.3, 1.56, 0.45); guard.add(R.box(0.2, 0.32, 0.14, 0xE2452F, 0, 0.3, 0)); guard.add(R.box(0.21, 0.07, 0.15, 0xF2D21B, 0, 0.42, 0)); const hd = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 16, 12)), R.mat(0xE9C2A0)); hd.scale.setScalar(0.09); hd.position.y = 0.55; guard.add(hd); guard.add(R.box(0.16, 0.24, 0.12, 0x1E3A5F, 0, 0.06, 0)); guard.visible = false; tw.add(guard); grp.add(tw);
    // parasoller og håndklær
    for (let k = 0; k < 4; k++) { const px = [-14, -6, 8, 15][k], pz = [4, 10, 7, 2][k]; const pole = R.box(0.25, 6, 0.25, 0xdddddd, px, 3, pz); grp.add(pole); const top = new THREE.Mesh(R.geo('umb', () => new THREE.ConeGeometry(4, 1.6, 10)), R.mat([0xE2452F, 0x2D7FB8, 0xF2D21B, 0x5FAF6B][k])); top.position.set(px, 6.4, pz); grp.add(top); grp.add(R.box(3.5, 0.1, 1.6, [0xF4F1EA, 0xE58A6B, 0x7FB3D5, 0xF2D21B][k], px + 3, 0.7, pz + 2)); }
    R.beachViews[id] = { guard, grp };
  }
}
R.setBeachSeason = function (summer) { R.summer = !!summer; };
R.setGuard = function (id, on) { const v = R.beachViews && R.beachViews[id]; if (v) v.guard.visible = !!on; };
/* ---------- ikon-sprites (pin) ---------- */
R.pinCache = {};
/** Lysere (+) eller mørkere (−) variant av en hex-farge. */
function shade(hex, f) { const n = parseInt(String(hex).replace('#', ''), 16); if (isNaN(n)) return hex; const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))); return 'rgb(' + c.join(',') + ')'; }
R.pinMat = function (iconName, bg, ring) {
  const key = iconName + bg + (ring || '');
  if (R.pinCache[key]) return R.pinCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  const draw = img => {   // nål: myk skygge, fargegradient, hvit kant og ikon
    x.clearRect(0, 0, 128, 128);
    x.save(); x.shadowColor = 'rgba(20,30,25,0.45)'; x.shadowBlur = 10; x.shadowOffsetY = 4;
    x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 60, 54, 0, TAU); x.fill(); x.restore();
    const g = x.createLinearGradient(0, 14, 0, 110); g.addColorStop(0, shade(bg, 0.18)); g.addColorStop(1, shade(bg, -0.16));
    x.fillStyle = g; x.beginPath(); x.arc(64, 60, 47, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.22)'; x.beginPath(); x.ellipse(64, 40, 34, 18, 0, 0, TAU); x.fill();
    if (ring) { x.lineWidth = 6; x.strokeStyle = ring; x.beginPath(); x.arc(64, 60, 54, 0, TAU); x.stroke(); }
    if (img) { x.save(); x.shadowColor = 'rgba(0,0,0,0.25)'; x.shadowBlur = 3; x.drawImage(img, 32, 28, 64, 64); x.restore(); }
    tex.needsUpdate = true;
  };
  draw(null);
  const img = new Image(); img.onload = () => draw(img);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvgString(iconName, '#ffffff', 68));
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false });
  R.pinCache[key] = m; return m;
};
R.makePin = function (iconName, bg, size, ring) {
  const s = new THREE.Sprite(R.pinMat(iconName, bg, ring)); s.scale.set(size, size, 1); s.renderOrder = 20; s.userData.size = size; return s;
};

/* ---------- modeller: stasjoner ---------- */
function windowRow(g, n, y, z, w, col) { for (let i = 0; i < n; i++) g.add(R.box(0.42, 0.34, 0.05, col || 0x8fb0c0, (i - (n - 1) / 2) * 0.8, y, z)); }
/** Skilt med tekst (bare forsiden, så teksten aldri blir speilvendt). */
R.signMat = function (text, bg, fg) {
  const key = 'sign' + text + bg; if (R.mats[key]) return R.mats[key];
  const W = text.length > 12 ? 1024 : 512, c = document.createElement('canvas'); c.width = W; c.height = 96; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, W, 96); x.fillStyle = fg; let fs = 58; x.font = '900 ' + fs + 'px Nunito, Arial, sans-serif'; const tw = x.measureText(text).width; if (tw > W * .9) { fs = Math.floor(fs * W * .9 / tw); x.font = '900 ' + fs + 'px Nunito, Arial, sans-serif'; }
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, W / 2, 52);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return (R.mats[key] = new THREE.MeshBasicMaterial({ map: t }));
};
const SIGN = { brannstasjon: ['BRANNSTASJON', '#C8281E', '#fff'], politistasjon: ['POLITI', '#1F4E9B', '#fff'], ambulansestasjon: ['AMBULANSE', '#2E8B3E', '#fff'], sykehus: ['SYKEHUS', '#F4F1EA', '#2E8B3E'],
  legevakt: ['LEGEVAKT', '#F4F1EA', '#2E8B3E'], arrest: ['ARREST', '#5C6677', '#fff'], helikopterbase: ['LUFTAMBULANSE', '#E53935', '#fff'], rk_base: ['HJELPEKORPS', '#F4F1EA', '#C9302C'], nf_base: ['SANITET', '#F4F1EA', '#C9302C'], rs_base: ['REDNINGSSTASJON', '#E9701E', '#fff'] };
function tree(g, x, z, s) { const t = new THREE.Mesh(R.geo('trunk', () => new THREE.CylinderGeometry(.05, .07, .5, 6)), R.mat(0x7a5a3c)); t.position.set(x, .25 * s, z); t.scale.setScalar(s); g.add(t); const c = new THREE.Mesh(R.geo('crown', () => new THREE.IcosahedronGeometry(.32, 1)), R.mat(0x5E8C4E)); c.position.set(x, .72 * s, z); c.scale.setScalar(s); g.add(c); }
function stationModel(type) {
  const g = new THREE.Group(), T = ST[type];
  g.add(R.box(3.95, 0.16, 3.95, 0xe3dcc8, 0, 0.08, 0)); g.add(R.box(3.6, 0.02, 1.0, 0x8f949a, 0, 0.17, 1.4));   // asfalt foran
  for (let i = 0; i < 3; i++) g.add(R.box(0.04, 0.021, 0.6, 0xf4f1ea, -1.2 + i * 1.2, 0.18, 1.45));
  tree(g, -1.75, -1.6, 1.1); tree(g, 1.75, 1.75, 0.9);
  const sg = SIGN[type]; if (sg) { const p = new THREE.Mesh(R.geo('signq', () => new THREE.PlaneGeometry(1, 1)), R.signMat(sg[0], sg[1], sg[2])); p.scale.set(2.2, 0.4, 1); p.position.set(0, type === 'sykehus' ? 2.95 : 2.0, 1.06); p.renderOrder = 2; g.add(p); }
  const win = 0x8fb0c0;
  switch (type) {
    case 'brannstasjon':
      g.add(R.box(3.4, 2.0, 2.6, 0xc9785d, 0, 1.16, -0.35)); g.add(R.box(3.55, 0.22, 2.75, 0xf2ece0, 0, 2.27, -0.35));
      for (const x of [-1.1, 0, 1.1]) g.add(R.box(0.86, 1.25, 0.07, 0xf5efe3, x, 0.85, 0.97));
      g.add(R.box(0.85, 3.3, 0.85, 0xb86a50, 1.3, 1.8, -1.3)); g.add(R.box(0.95, 0.16, 0.95, 0xf2ece0, 1.3, 3.5, -1.3));
      windowRow(g, 3, 1.85, 0.97, 0, win); break;
    case 'politistasjon':
      g.add(R.box(3.3, 2.6, 2.6, 0x8fa6c2, 0, 1.4, -0.3)); g.add(R.box(3.45, 0.2, 2.75, 0xeef1f4, 0, 2.8, -0.3)); g.add(R.box(3.32, 0.22, 2.62, 0xeef1f4, 0, 1.05, -0.3));
      g.add(R.box(0.8, 1.2, 0.07, 0x5f7a9c, 0, 0.78, 1.02)); windowRow(g, 3, 1.85, 1.02, 0, win); windowRow(g, 3, 2.35, 1.02, 0, win);
      g.add(R.box(0.05, 1.6, 0.05, 0x9a8f80, -1.4, 3.6, 0.9)); g.add(R.box(0.6, 0.38, 0.04, 0xf4efe3, -1.12, 4.1, 0.9)); break;
    case 'ambulansestasjon':
      g.add(R.box(3.4, 1.7, 2.6, 0xf3ecc8, 0, 1.0, -0.3)); g.add(R.box(3.55, 0.2, 2.75, 0x98b889, 0, 1.95, -0.3)); g.add(R.box(3.42, 0.3, 2.62, 0xb3be68, 0, 1.35, -0.3));
      for (const x of [-0.9, 0.9]) g.add(R.box(1.15, 1.15, 0.07, 0xfaf6e8, x, 0.78, 1.02)); break;
    case 'sykehus':
      g.add(R.box(3.6, 3.3, 2.9, 0xf2eee3, 0, 1.8, -0.2)); g.add(R.box(3.75, 0.2, 3.05, 0xd9d2bf, 0, 3.55, -0.2));
      g.add(R.box(1.0, 0.18, 0.34, 0x98b889, 0, 3.75, -0.2)); g.add(R.box(0.34, 0.18, 1.0, 0x98b889, 0, 3.75, -0.2));
      g.add(R.box(1.3, 1.2, 0.5, 0xe6e0cf, 0, 0.75, 1.3)); windowRow(g, 4, 1.9, 1.27, 0, win); windowRow(g, 4, 2.6, 1.27, 0, win); break;
    case 'legevakt':
      g.add(R.box(3.3, 2.0, 2.6, 0xdce8d2, 0, 1.15, -0.3)); g.add(R.box(3.45, 0.2, 2.75, 0xf2eee3, 0, 2.2, -0.3));
      g.add(R.box(0.7, 0.16, 0.26, 0x98b889, 0, 2.4, -0.3)); g.add(R.box(0.26, 0.16, 0.7, 0x98b889, 0, 2.4, -0.3)); windowRow(g, 3, 1.5, 1.02, 0, win); break;
    case 'arrest':
      g.add(R.box(3.4, 2.0, 2.6, 0x9aa5b5, 0, 1.15, -0.3)); g.add(R.box(3.55, 0.2, 2.75, 0x7d8899, 0, 2.2, -0.3));
      for (let i = 0; i < 4; i++) g.add(R.box(0.3, 0.45, 0.05, 0x4c5666, (i - 1.5) * 0.8, 1.55, 1.02));
      g.add(R.box(0.8, 1.1, 0.07, 0x5c6677, 0, 0.72, 1.02)); break;
    case 'helikopterbase': {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.14, 24), R.mat(0xb9bdb6)); pad.position.set(-0.2, 0.22, 0.4); g.add(pad);
      g.add(R.box(0.2, 0.05, 1.1, 0xf5efe3, -0.7, 0.32, 0.4)); g.add(R.box(0.2, 0.05, 1.1, 0xf5efe3, 0.3, 0.32, 0.4)); g.add(R.box(1.0, 0.05, 0.2, 0xf5efe3, -0.2, 0.32, 0.4));
      g.add(R.box(1.5, 1.2, 1.2, 0xc9cf8a, 0.8, 0.8, -1.4)); g.add(R.box(1.6, 0.16, 1.3, 0xf3ecc8, 0.8, 1.45, -1.4)); break; }
    case 'rk_base': case 'nf_base': {
      const col = type === 'rk_base' ? 0xe3a39b : 0xd0877f;
      g.add(R.box(3.1, 1.8, 2.5, col, 0, 1.05, -0.3)); g.add(R.box(3.3, 0.24, 2.7, 0xf6efe6, 0, 2.05, -0.3)); g.add(R.box(3.12, 0.22, 2.52, 0xf6efe6, 0, 1.2, -0.3));
      g.add(R.box(1.3, 1.1, 0.07, 0xfaf4e8, -0.7, 0.75, 0.97)); g.add(R.box(0.6, 0.95, 0.07, 0xb06f68, 0.9, 0.7, 0.97)); windowRow(g, 2, 1.65, 0.97, 0, win); break; }
    default: g.add(R.box(3, 2, 2.6, 0xd9d2bf, 0, 1.1, -0.3));
  }
  return g;
}
/** Bjelke mellom to punkter (brukes til gittermaster). */
function beam(g, a, b, t, hex) { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), m = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), R.mat(hex)); m.scale.set(t, L, t); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(m); }
/** Nødnett-basestasjon i meter: gittermast med sektorantenner og radiolinje, teknisk skap og gjerde. Mobil: tilhenger med teleskopmast. */
function mastModel(mobile) {
  const g = new THREE.Group(), steel = 0xA7ACB0;
  if (mobile) {
    g.add(R.box(2.4, 1.6, 5, 0xE9E9E6, 0, 1.3, 0)); g.add(R.box(2.5, .15, 5.1, 0x3B3F42, 0, .5, 0)); for (const sx of [-1, 1]) { const wh = new THREE.Mesh(R.wheelGeo(), R.mat(0x1E2124)); wh.scale.setScalar(2.4); wh.position.set(sx * 1.25, .55, .4); g.add(wh); }
    g.add(R.box(2.42, .3, 5.02, 0xA99BCB, 0, 1.6, 0)); g.add(R.box(.15, .15, 1.8, 0x3B3F42, 0, .5, 3.3));
    for (const [r, y0, y1] of [[.16, 2.1, 7], [.12, 7, 11.5], [.09, 11.5, 15]]) { const c = new THREE.Mesh(R.geo('mcyl' + r, () => new THREE.CylinderGeometry(r, r, 1, 10)), R.mat(steel)); c.scale.y = y1 - y0; c.position.set(0, (y0 + y1) / 2, -1.5); g.add(c); }
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3, p = R.box(.32, 1.4, .12, 0xF2F2F0, Math.sin(a) * .35, 14, -1.5 + Math.cos(a) * .35); p.rotation.y = a; g.add(p); }
    const bc = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 16, 12)), new THREE.MeshBasicMaterial({ color: 0xff4040 })); bc.scale.setScalar(.15); bc.position.set(0, 15.2, -1.5); g.add(bc); g.userData.beacon = bc; return g;
  }
  const H = 34, b0 = 1.9, b1 = .65, leg = (sx, sz, y) => { const f = y / H, w = b0 + (b1 - b0) * f; return [sx * w, y, sz * w]; };
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(g, leg(sx, sz, 0), leg(sx, sz, H), .16, steel);
  const faces = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
  for (let y = 0; y < H - .1; y += 3.4) for (const [p, q] of faces) { beam(g, leg(p[0], p[1], y), leg(q[0], q[1], y + 3.4), .07, steel); beam(g, leg(q[0], q[1], y), leg(p[0], p[1], y + 3.4), .07, steel); beam(g, leg(p[0], p[1], y), leg(q[0], q[1], y), .07, steel); }
  // toppramme med tre sektorantenner, radiolinje-parabol og lynavleder
  g.add(R.box(2.4, .12, 2.4, steel, 0, H - 2.2, 0)); for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + .3, p = R.box(.45, 2.6, .18, 0xF2F2F0, Math.sin(a) * 1.15, H - .9, Math.cos(a) * 1.15); p.rotation.y = a; g.add(p); }
  const dish = new THREE.Mesh(R.geo('dish', () => { const c = new THREE.CylinderGeometry(.55, .4, .3, 18); c.rotateX(Math.PI / 2); return c; }), R.mat(0xEDEDEA)); dish.position.set(0, H - 4.5, 1.05); g.add(dish);
  g.add(R.box(.05, 3, .05, steel, 0, H + 1.5, 0));
  const beacon = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 16, 12)), new THREE.MeshBasicMaterial({ color: 0xff4040 })); beacon.scale.setScalar(.22); beacon.position.y = H + 3.1; g.add(beacon);
  // teknisk skap, kabelbru og gjerde
  g.add(R.box(2.6, 2.3, 1.8, 0xD9DCDA, 3.2, 1.15, 0)); g.add(R.box(2.7, .12, 1.9, 0x8E9496, 3.2, 2.36, 0)); beam(g, [2.2, 2.2, 0], [.9, 4.5, 0], .25, 0x6E7378);
  const fence = 0x9AA0A2, fs = 5.2; for (const [p, q] of [[[-fs, -fs], [fs, -fs]], [[fs, -fs], [fs, fs]], [[fs, fs], [-fs, fs]], [[-fs, fs], [-fs, -fs]]]) { g.add(R.box(Math.abs(q[0] - p[0]) + .05, 1.8, Math.abs(q[1] - p[1]) + .05, fence, (p[0] + q[0]) / 2, .9, (p[1] + q[1]) / 2)); }
  g.traverse(o => { if (o.isMesh && o.scale.y === 1.8) { o.material = R.fenceMat || (R.fenceMat = new THREE.MeshLambertMaterial({ color: 0x9AA0A2, transparent: true, opacity: .35, side: THREE.DoubleSide })); } });
  g.userData.beacon = beacon; return g;
}

/* ---------- modeller: kjøretøy ---------- */
/* Kjøretøy bygges av sideprofiler (ekstrudert i bredden) med lakkmønster som tekstur, hjul med felg, glass, lykter og lysbro.
   Modellene lages én gang per type og klones (delte geometrier og materialer). */
const LIVERY = {
  brann:     { base: '#C8281E', band: 'stripe', c1: '#F2D21B', c2: '#F4F1E8', roof: '#E9E4DA' },
  politi:    { base: '#F4F5F2', band: 'check', c1: '#1F4E9B', c2: '#F2D21B', roof: '#F4F5F2' },
  ambulanse: { base: '#F2D21B', band: 'check', c1: '#2E8B3E', c2: '#F2D21B', roof: '#F6F2E2' },
  rk:        { base: '#F4F1EC', band: 'stripe', c1: '#C9302C', c2: '#F4F1EC', roof: '#F4F1EC' },
  nf:        { base: '#F4F1EC', band: 'stripe', c1: '#00843D', c2: '#F4F1EC', roof: '#F4F1EC' },
  rs:        { base: '#E9701E', band: 'stripe', c1: '#F4F1EC', c2: '#1E3A5F', roof: '#F4F1EC' },
  strand:    { base: '#E2452F', band: 'none', c1: '#F2D21B', c2: '#F2D21B', roof: '#F2D21B' },
  bistand:   { base: '#B8C0BC', band: 'stripe', c1: '#7D8B96', c2: '#B8C0BC', roof: '#C9CFCB' },
  sivil:     { base: '#888888', band: 'none', c1: '#888', c2: '#888', roof: '#888' }
};
const VPROF = {   // sideprofil [lengde, høyde] (bak → foran), bredde, vinduer (andel av høyden), frontrute-segment
  car:     { p: [[0, .2], [2.05, .2], [2.05, .48], [1.68, .6], [1.3, .98], [.6, 1.0], [.18, .72], [0, .64]], w: 1.0, win: [.66, .93], ws: [3, 4], rw: [5, 6], cab: [.32, 1.62] },
  hatch:   { p: [[0, .2], [1.85, .2], [1.86, .5], [1.52, .62], [1.14, 1.0], [.22, 1.02], [0, .84]], w: .98, win: [.66, .94], ws: [3, 4], rw: [5, 6], cab: [.28, 1.45] },
  bus:     { p: [[0, .25], [4.6, .25], [4.64, .55], [4.6, 1.3], [4.48, 1.34], [0, 1.34]], w: .98, win: [.5, .9], ws: [2, 3], cab: [.25, 4.45], band: true },
  suv:     { p: [[0, .22], [2.15, .22], [2.15, .58], [1.85, .7], [1.55, 1.15], [.15, 1.17], [0, 1.0]], w: 1.06, win: [.72, .95], ws: [3, 4], rw: [5, 6], cab: [.2, 1.75] },
  van:     { p: [[0, .2], [2.45, .2], [2.45, .62], [2.25, .78], [1.98, 1.28], [1.85, 1.38], [0, 1.4]], w: 1.06, win: [.62, .86], ws: [3, 4], cab: [1.45, 2.2] },
  ambulance: { p: [[0.02, .22], [2.66, .22], [2.78, .34], [2.79, .6], [2.66, .7], [2.42, .76], [2.14, 1.2], [2.0, 1.36], [.06, 1.38], [0, 1.3], [0, .3]], w: 1.1, win: [.58, .82], ws: [6, 7], cab: [2.02, 2.42], side: [1.0, 1.86] },
  truck:   { p: [[0, .32], [3.15, .32], [3.15, 1.2], [3.05, 1.42], [2.3, 1.46], [2.3, 1.36], [0, 1.36]], w: 1.18, win: [.7, .92], ws: [2, 3], cab: [2.35, 3.05] },
  rescue:  { p: [[0, .32], [3.0, .32], [3.0, 1.2], [2.9, 1.42], [2.2, 1.46], [2.2, 1.5], [0, 1.5]], w: 1.18, win: [.7, .92], ws: [2, 3], cab: [2.25, 2.9] },
  tanker:  { p: [[0, .32], [3.3, .32], [3.3, 1.2], [3.2, 1.42], [2.5, 1.44], [2.5, .62], [0, .62]], w: 1.18, win: [.7, .92], ws: [2, 3], cab: [2.55, 3.2] },
  ladder:  { p: [[0, .32], [3.9, .32], [3.9, 1.2], [3.8, 1.42], [3.1, 1.44], [3.1, .95], [0, .95]], w: 1.18, win: [.7, .92], ws: [2, 3], cab: [3.15, 3.8] },
  armored: { p: [[0, .26], [2.6, .26], [2.6, .8], [2.3, 1.05], [2.1, 1.38], [0, 1.4]], w: 1.2, win: [.68, .86], ws: [3, 4], cab: [1.6, 2.2] },
  trailer: { p: [[0, .25], [1.8, .25], [1.8, 1.3], [0, 1.3]], w: 1.05, win: [.5, .7], ws: null, cab: null },
  atv:     { p: [[0, .3], [1.5, .3], [1.5, .55], [1.1, .7], [.4, .7], [0, .6]], w: .75, win: null, ws: null, cab: null }
};
/** Sidemerking (dekal) for én side av bilen: tegnes innenfor sideprofilen, teksten leses riktig vei på begge sider. */
const DECAL = {
  ambulanse: { base: '#E5DA1F', band: ['#0E7A3A', '#F7F7F2'], bandY: [.4, .47], text: 'AMBULANSE', tcol: '#0E7A3A', tY: .2, logo: '113', lcol: '#0E7A3A' },
  politi:    { base: '#F4F5F2', band: ['#1F4E9B', '#F2D21B'], bandY: [.38, .5], text: 'POLITI', tcol: '#1F4E9B', tY: .2, logo: '112', lcol: '#1F4E9B' },
  brann:     { base: '#C4241B', stripes: ['#F2D21B', '#F4F1E8'], bandY: [.36, .46], text: 'BRANN', tcol: '#F4F1E8', tY: .2, logo: '110', lcol: '#F2D21B' },
  rk:        { base: '#F4F1EC', stripes: ['#C9302C', '#C9302C'], bandY: [.38, .46], text: 'HJELPEKORPS', tcol: '#C9302C', tY: .2 },
  nf:        { base: '#F4F1EC', stripes: ['#00843D', '#00843D'], bandY: [.38, .46], text: 'SANITET', tcol: '#00843D', tY: .2 },
  bistand:   { base: '#B8C0BC', stripes: ['#7D8B96', '#E8ECEA'], bandY: [.38, .46], text: 'BISTAND', tcol: '#4E5A63', tY: .2 }
};
R.decalMat = function (org, type, model, frontRight) {
  const D = DECAL[org]; if (!D) return null; const key = 'dec' + org + type + frontRight; if (R.mats[key]) return R.mats[key];
  const pr = VPROF[model] || VPROF.car, L = Math.max(...pr.p.map(q => q[0])), H = Math.max(...pr.p.map(q => q[1]));
  const Wc = 1024, Hc = Math.round(1024 * H / L), c = document.createElement('canvas'); c.width = Wc; c.height = Hc; const x = c.getContext('2d');
  const X = v => (frontRight ? v / L : 1 - v / L) * Wc, Y = v => (1 - v / H) * Hc;
  x.beginPath(); pr.p.forEach((q, i) => (i ? x.lineTo(X(q[0]), Y(q[1])) : x.moveTo(X(q[0]), Y(q[1])))); x.closePath(); x.save(); x.clip();
  x.fillStyle = D.base; x.fillRect(0, 0, Wc, Hc);
  const sh = x.createLinearGradient(0, 0, 0, Hc); sh.addColorStop(0, 'rgba(255,255,255,.22)'); sh.addColorStop(.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.16)'); x.fillStyle = sh; x.fillRect(0, 0, Wc, Hc);
  const yA = Y(H * D.bandY[1]), yB = Y(H * D.bandY[0]), bh = yB - yA, front = pr.cab ? pr.cab[1] + .25 : L, x0 = Math.min(X(0), X(front)), x1 = Math.max(X(0), X(front));
  if (D.band) { const n = Math.round((x1 - x0) / (bh / 2)), cw = (x1 - x0) / n; for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { x.fillStyle = (i + r) % 2 ? D.band[0] : D.band[1]; x.fillRect(x0 + i * cw, yA + r * bh / 2, cw + .6, bh / 2 + .6); } }
  if (D.stripes) { x.fillStyle = D.stripes[0]; x.fillRect(0, yA, Wc, bh * .55); x.fillStyle = D.stripes[1]; x.fillRect(0, yA + bh * .66, Wc, bh * .3); }
  // vinduer: førerhus og sidevindu
  const glass = (a, b, y0, y1, light) => { const gx0 = Math.min(X(a), X(b)), gx1 = Math.max(X(a), X(b)); x.fillStyle = light ? '#A9C7DA' : '#15191C'; x.beginPath(); (x.roundRect || x.rect).call(x, gx0, Y(H * y1), gx1 - gx0, Y(H * y0) - Y(H * y1), 14); x.fill(); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(gx0 + 8, Y(H * y1) + 6, (gx1 - gx0) * .3, (Y(H * y0) - Y(H * y1)) * .3); x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 4; x.strokeRect(gx0, Y(H * y1), gx1 - gx0, Y(H * y0) - Y(H * y1)); };
  if (pr.cab && pr.win) glass(pr.cab[0] + .04, pr.cab[1] - .02, pr.win[0], pr.win[1], true);
  if (pr.side) glass(pr.side[0], pr.side[1], pr.win[0] + .02, pr.win[1] + .02, false);
  if (!pr.side && model !== 'truck' && model !== 'rescue' && model !== 'tanker' && model !== 'ladder' && pr.cab) glass(pr.cab[0] - (pr.cab[1] - pr.cab[0]) * .9, pr.cab[0] - .06, pr.win[0], pr.win[1], true);
  if (model === 'truck' || model === 'rescue' || model === 'tanker' || model === 'ladder') {   // rulleporter i aluminium på utstyrsrommene
    const end = pr.cab ? pr.cab[0] - .08 : L * .7, n = Math.max(2, Math.round(end / .7)), wd = (end - .1) / n;
    for (let i = 0; i < n; i++) { const a = .08 + i * wd, x0 = Math.min(X(a), X(a + wd - .05)), ww = Math.abs(X(a + wd - .05) - X(a)), y0 = Y(H * .93), hh = Y(H * .5) - y0;
      const g = x.createLinearGradient(x0, 0, x0 + ww, 0); g.addColorStop(0, '#C9CDD0'); g.addColorStop(.5, '#E9ECEE'); g.addColorStop(1, '#B9BDC0'); x.fillStyle = g; x.fillRect(x0, y0, ww, hh);
      x.fillStyle = 'rgba(0,0,0,.18)'; for (let yy = y0 + 6; yy < y0 + hh; yy += 7) x.fillRect(x0, yy, ww, 1.5); x.fillStyle = '#5B5F62'; x.fillRect(x0 + ww * .4, y0 + hh - 10, ww * .2, 5); x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 2; x.strokeRect(x0, y0, ww, hh); } }
  // dørlinjer, håndtak og sidemarkører
  x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = 3; const door = v => { x.beginPath(); x.moveTo(X(v), Y(H * .2)); x.lineTo(X(v), Y(H * .92)); x.stroke(); };
  if (pr.cab) door(pr.cab[0] - .02); if (pr.side) { door(pr.side[0] - .05); door(pr.side[1] + .08); }
  x.fillStyle = '#1A1A1A'; if (pr.cab) { x.fillRect(Math.min(X(pr.cab[0] + .05), X(pr.cab[0] + .2)), Y(H * .55), Math.abs(X(pr.cab[0] + .2) - X(pr.cab[0] + .05)), 7); }
  x.fillStyle = '#F28C1B'; for (const v of [.15, L * .5, L - .3]) x.fillRect(X(v) - 8, Y(H * .26), 16, 9);
  // tekst og nødnummer (aldri speilvendt)
  const fs = Math.round(Hc * .13); x.font = '900 ' + fs + 'px Arial Black, Arial, sans-serif'; x.fillStyle = D.tcol; x.textAlign = 'center'; x.textBaseline = 'middle';
  const label = type === 'legebil' ? 'LEGEBIL' : type === 'luftambulanse' ? 'LUFTAMBULANSE' : D.text, mid = (X(L * .45) + X(L * .45)) / 2;
  x.fillText(label, mid, Y(H * D.tY));
  if (D.logo) {
    const lx = X(L * (pr.side ? .2 : .25)), ly = Y(H * .7), r = Hc * .085; x.lineWidth = 6; x.strokeStyle = D.lcol; x.beginPath(); x.arc(lx - r * 2.6, ly, r, 0, TAU); x.stroke();
    x.font = '900 ' + Math.round(r * 1.2) + 'px Arial'; x.fillStyle = D.lcol; x.fillText('✆', lx - r * 2.6, ly + 2);
    for (let i = 0; i < 3; i++) { const bx = lx - r * 1.2 + i * r * 1.9; x.fillStyle = D.lcol; x.fillRect(bx - r * .8, ly - r * .9, r * 1.6, r * 1.8); x.fillStyle = D.base; x.font = '900 ' + Math.round(r * 1.4) + 'px Arial'; x.fillText(D.logo[i], bx, ly + 2); }
  }
  // hjulbuer
  x.restore(); x.globalCompositeOperation = 'destination-out'; for (const f of (model === 'ladder' || model === 'tanker' ? [.15, .3, .82] : model === 'truck' || model === 'rescue' ? [.17, .8] : [.18, .8])) { x.beginPath(); x.arc(X(L * f), Y(.27), Hc * .23 * (1.35 / H) * .95, 0, TAU); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
  return (R.mats[key] = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, transparent: false }));
};
R.livery = function (org, model, L, H, base) {
  const key = 'liv' + org + model + (base || ''); if (R.mats[key]) return R.mats[key];
  const P = Object.assign({}, LIVERY[org] || LIVERY.bistand), pr = VPROF[model]; if (base) P.base = base;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d'), X = v => v / L * 512, Y = v => (1 - v / H) * 256;
  x.fillStyle = P.base; x.fillRect(0, 0, 512, 256);
  // lakkglans øverst, skygge nederst
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.18)'); x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  const yb0 = Y(H * .32), yb1 = Y(H * .5), bh = yb0 - yb1;
  if (P.band === 'check') { const n = 18, cw = 512 / n; for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { x.fillStyle = (i + r) % 2 ? P.c1 : P.c2; x.fillRect(i * cw, yb1 + r * bh / 2, cw + 1, bh / 2 + 1); } }
  else if (P.band === 'stripe') { x.fillStyle = P.c1; x.fillRect(0, yb1, 512, bh * .55); x.fillStyle = P.c2; x.fillRect(0, yb1 + bh * .62, 512, bh * .22); }
  // vinduer
  if (pr && pr.win && pr.cab) { x.fillStyle = '#22303A'; const y0 = Y(H * pr.win[1]), y1 = Y(H * pr.win[0]); x.beginPath(); x.roundRect ? x.roundRect(X(pr.cab[0]), y0, X(pr.cab[1]) - X(pr.cab[0]), y1 - y0, 10) : x.rect(X(pr.cab[0]), y0, X(pr.cab[1]) - X(pr.cab[0]), y1 - y0); x.fill();
    x.fillStyle = 'rgba(160,200,225,.35)'; x.fillRect(X(pr.cab[0]) + 6, y0 + 4, (X(pr.cab[1]) - X(pr.cab[0])) * .35, (y1 - y0) * .35);
    if (model === 'ambulance' || model === 'van') { x.fillStyle = '#22303A'; x.fillRect(X(L * .12), Y(H * .86), X(L * .28), Y(H * .66) - Y(H * .86)); } }
  if (model === 'truck' || model === 'rescue') { x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 3; for (let i = 0; i < 3; i++) { const a = X(.12 + i * .7); x.strokeRect(a, Y(H * .9), X(.6), Y(H * .38) - Y(H * .9)); } }
  // dørkant, hjulbuer og lykter
  x.strokeStyle = 'rgba(0,0,0,.28)'; x.lineWidth = 2; if (pr && pr.cab) { x.beginPath(); x.moveTo(X(pr.cab[0]), Y(H * .25)); x.lineTo(X(pr.cab[0]), Y(H * .9)); x.stroke(); }
  x.fillStyle = '#1C1F22'; for (const f of [.2, .8]) { x.beginPath(); x.arc(X(L * f), 256, 46, Math.PI, 0); x.fill(); }
  x.fillStyle = '#FFF4C8'; x.fillRect(506, Y(H * .5), 6, 18); x.fillStyle = '#D7262B'; x.fillRect(0, Y(H * .55), 6, 22);
  const tex = new THREE.CanvasTexture(c); tex.repeat.set(1 / L, 1 / H); tex.anisotropy = 4;
  const m = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }); R.mats[key] = m; return m;
};
function profileGeo(pr) {
  const sh = new THREE.Shape(); pr.p.forEach((q, i) => (i ? sh.lineTo(q[0], q[1]) : sh.moveTo(q[0], q[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth: pr.w, bevelEnabled: true, bevelThickness: .07, bevelSize: .05, bevelSegments: 3, steps: 1 });
  g.rotateY(-Math.PI / 2); const L = Math.max(...pr.p.map(q => q[0])); g.translate(pr.w / 2, 0, -L / 2); g.computeVertexNormals(); return g;
}
R.wheelGeo = () => R.geo('tyre', () => { const g = new THREE.CylinderGeometry(.27, .27, .2, 18); g.rotateZ(Math.PI / 2); return g; });
R.rimGeo = () => R.geo('rim', () => { const g = new THREE.CylinderGeometry(.15, .15, .215, 12); g.rotateZ(Math.PI / 2); return g; });
function vehicleBase(type, org, modelOverride) {
  const T = UT[type] || { model: modelOverride }, model = T.model, g = new THREE.Group(), lights = [];
  const dark = 0x2A2E31, glassM = R.matG || (R.matG = new THREE.MeshPhongMaterial({ color: 0x22313b, shininess: 90, specular: 0x9fb8c8, side: THREE.DoubleSide }));
  const P = LIVERY[org] || LIVERY.bistand, roofHex = parseInt(P.roof.slice(1), 16);
  const blue = () => R.mats.blueL || (R.mats.blueL = new THREE.MeshBasicMaterial({ color: 0x3d7dff }));
  const bar = (x0, y, z, w) => { const base = R.box(w * 2 + .3, .07, .22, 0x2a2e31, 0, y - .04, z); g.add(base); for (const s of [-1, 1]) { const m = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), blue()); m.scale.set(.3, .13, .2); m.position.set(s * w, y + .05, z); g.add(m); lights.push(m); } };
  if (model === 'heli') {   // luftambulanse: kropp, glasskuppel, halebom med fenestron, meier og fire rotorblader
    const red = R.mat(0xD52B1E), white = R.mat(0xF4F2EE), darkM = R.mat(0x2F3335);
    const body = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 16, 12)), red); body.scale.set(.66, .62, 1.35); body.position.set(0, .95, .1); g.add(body);
    const belly = new THREE.Mesh(R.geo('ico'), white); belly.scale.set(.64, .3, 1.25); belly.position.set(0, .62, .1); g.add(belly);
    const nose = new THREE.Mesh(R.geo('ico'), glassM); nose.scale.set(.56, .44, .62); nose.position.set(0, 1.08, .85); g.add(nose);
    for (const sd of [-1, 1]) { const w = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), glassM); w.scale.set(.02, .3, .55); w.position.set(sd * .63, 1.08, .05); g.add(w); }
    const boom = new THREE.Mesh(R.geo('boom', () => { const c = new THREE.CylinderGeometry(.09, .2, 2.4, 10); c.rotateX(Math.PI / 2); return c; }), red); boom.position.set(0, 1.08, -1.95); g.add(boom);
    const fen = new THREE.Mesh(R.geo('fen', () => { const c = new THREE.CylinderGeometry(.34, .34, .14, 16); c.rotateZ(Math.PI / 2); return c; }), red); fen.position.set(0, 1.25, -3.15); g.add(fen);
    g.add(R.box(.06, .7, .5, 0xD52B1E, 0, 1.55, -3.2)); g.add(R.box(1.0, .05, .26, 0xF4F2EE, 0, 1.12, -2.75));
    for (const sd of [-1, 1]) { g.add(R.box(.07, .07, 2.1, 0x3b3f42, sd * .58, .12, .1)); for (const zz of [.6, -.4]) { const st = R.box(.05, .5, .05, 0x3b3f42, sd * .5, .36, zz); st.rotation.z = sd * .25; g.add(st); } }
    g.add(R.box(.5, .25, .7, 0xD52B1E, 0, 1.5, -.1));
    const rotor = new THREE.Group(); rotor.position.y = 1.72; for (let k = 0; k < 4; k++) { const bl = new THREE.Mesh(R.geo('box'), darkM); bl.scale.set(2.8, .03, .17); bl.position.x = 1.4; const arm = new THREE.Group(); arm.rotation.y = k * Math.PI / 2; arm.add(bl); rotor.add(arm); } rotor.add(R.box(.3, .2, .3, 0x3b3f42, 0, -.08, 0)); rotor.name = 'rotor'; g.add(rotor);
    const tr = new THREE.Group(); tr.position.set(.1, 1.25, -3.15); tr.add(R.box(.02, .6, .08, 0x3b3f42, 0, 0, 0)); tr.name = 'rotor2'; g.add(tr);
    bar(0, 1.6, -.6, .2); return { g, lights };
  }
  if (model === 'boat') return boatModel(org, glassM, lights);
  if (model === 'foot') {   // livredder: rød trøye, gule shorts, solhatt og redningsbøye
    const skin = R.mat(0xE3B48F); g.add(R.box(.38, .48, .22, 0xE2452F, 0, .86, 0)); g.add(R.box(.36, .22, .22, 0xF2D21B, 0, .55, 0));
    for (const sd of [-1, 1]) { g.add(R.box(.13, .46, .14, 0xE3B48F, sd * .1, .22, 0)); g.add(R.box(.1, .42, .1, 0xE3B48F, sd * .25, .82, 0)); g.add(R.box(.13, .05, .2, 0x2F3335, sd * .1, .02, .03)); }
    const hd = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 16, 12)), skin); hd.scale.setScalar(.14); hd.position.y = 1.24; g.add(hd);
    const hat = new THREE.Mesh(R.geo('hatb', () => new THREE.CylinderGeometry(.24, .24, .03, 16)), R.mat(0xF2D21B)); hat.position.y = 1.36; g.add(hat); g.add(R.box(.17, .1, .17, 0xF2D21B, 0, 1.41, 0));
    const tube = R.box(.12, .6, .08, 0xE2452F, .34, .62, .1); tube.rotation.z = .2; g.add(tube); return { g, lights };
  }
  const pr = VPROF[model] || VPROF.car, L = Math.max(...pr.p.map(q => q[0])), H = Math.max(...pr.p.map(q => q[1]));
  const civ = org === 'sivil';
  const D = !civ && DECAL[org], baseHex = D ? parseInt(D.base.slice(1), 16) : null;
  const bodyMats = D ? [R.mat(baseHex), R.mat(baseHex)] : civ ? [R.mat(0xffffff), R.mat(0xffffff)] : [R.livery(org, model, L, H), R.mat(roofHex)];
  const body = new THREE.Mesh(R.geo('vp' + model, () => profileGeo(pr)), bodyMats); g.add(body);
  if (D) for (const sd of [1, -1]) {   // sidemerking som egne flater, riktig vei på hver side
    const m = new THREE.Mesh(R.geo('decq', () => new THREE.PlaneGeometry(1, 1)), R.decalMat(org, type, model, sd < 0)); m.scale.set(L, H, 1); m.rotation.y = sd * Math.PI / 2; m.position.set(sd * (pr.w / 2 + .085), H / 2, 0); g.add(m);
  }
  // frontrute (skrå glassflate mellom to profilpunkter)
  if (pr.ws) { const a = pr.p[pr.ws[0]], b = pr.p[pr.ws[1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ws = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), glassM); ws.scale.set(pr.w * .9, .02, len * .86); ws.position.set(0, (a[1] + b[1]) / 2 + .02, (a[0] + b[0]) / 2 - L / 2 + .02); ws.rotation.x = ang; g.add(ws); }
  // støtfangere, grill, lykter
  g.add(R.box(pr.w + .06, .16, .1, dark, 0, pr.p[1][1] + .06, L / 2 + .03)); g.add(R.box(pr.w + .06, .16, .1, dark, 0, pr.p[0][1] + .06, -L / 2 - .03));
  for (const s of [-1, 1]) { g.add(R.box(.2, .1, .04, 0xFFF4C8, s * pr.w * .33, pr.p[1][1] + .22, L / 2 + .06, true)); g.add(R.box(.14, .14, .04, 0xD7262B, s * pr.w * .4, pr.p[0][1] + .28, -L / 2 - .06, true)); g.add(R.box(.04, .1, .14, dark, s * (pr.w / 2 + .07), H * .72, L / 2 - (model === 'truck' || model === 'rescue' || model === 'tanker' || model === 'ladder' ? .25 : .7))); }
  // detaljer: bakrute, sideruter på sivile biler, speil, nummerskilt, kjørelys
  const glassSeg = (i, j, inset) => { const a = pr.p[i], b = pr.p[j], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const m = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), glassM); m.scale.set(pr.w * .88, .02, len * (inset || .82)); m.position.set(0, (a[1] + b[1]) / 2 + .03, (a[0] + b[0]) / 2 - L / 2); m.rotation.x = ang; g.add(m); };
  if (pr.rw) glassSeg(pr.rw[0], pr.rw[1], .78);
  else if (model === 'van' || model === 'ambulance' || model === 'bus') for (const s of [-1, 1]) g.add(R.box(pr.w * .36, H * .25, .02, 0x22313b, s * pr.w * .21, H * .72, -L / 2 - .08));
  if (civ && pr.win && pr.cab) for (const s of [-1, 1]) {   // sideruter med stolper
    const y0 = H * pr.win[0], y1 = H * pr.win[1] - .04, len = pr.cab[1] - pr.cab[0];
    const gl = new THREE.Mesh(R.geo('box'), glassM); gl.scale.set(.02, y1 - y0, len); gl.position.set(s * (pr.w / 2 + .08), (y0 + y1) / 2, (pr.cab[0] + pr.cab[1]) / 2 - L / 2); g.add(gl);
    const posts = pr.band ? 8 : 2; for (let k = 1; k < posts; k++) g.add(R.box(.025, y1 - y0, .05, 0x1E2124, s * (pr.w / 2 + .085), (y0 + y1) / 2, pr.cab[0] + len * k / posts - L / 2));
  }
  if (pr.ws && model !== 'bus') { const a = pr.p[pr.ws[0]]; for (const s of [-1, 1]) { g.add(R.box(.16, .1, .05, 0x1E2124, s * (pr.w / 2 + .16), a[1] + .1, a[0] - L / 2 - .06)); g.add(R.box(.1, .03, .03, 0x1E2124, s * (pr.w / 2 + .08), a[1] + .08, a[0] - L / 2 - .06)); } }
  for (const zf of [1, -1]) { const y = pr.p[zf > 0 ? 1 : 0][1] + .2; g.add(R.box(.42, .11, .02, 0xF4F4F4, 0, y, zf * (L / 2 + .1), true)); g.add(R.box(.04, .11, .021, 0x1F4E9B, -.19, y, zf * (L / 2 + .1), true)); }
  for (const s of [-1, 1]) g.add(R.box(pr.w * .22, .03, .03, 0xFFFDF0, s * pr.w * .3, pr.p[1][1] + .32, L / 2 + .09, true));   // LED-kjørelys
  // hjul med felg og nav
  const rimM = R.mat(civ ? 0xA9AEB2 : 0xC9CDD0), tyreM = R.mat(0x1E2124), hubM = R.mat(0x6E7378), axles = model === 'ladder' || model === 'tanker' ? [.15, .3, .82] : model === 'truck' || model === 'rescue' ? [.17, .8] : model === 'bus' ? [.17, .78] : [.18, .8];
  for (const f of axles) for (const s of [-1, 1]) { const tyre = new THREE.Mesh(R.wheelGeo(), tyreM), rim = new THREE.Mesh(R.rimGeo(), rimM), hub = new THREE.Mesh(R.geo('hub', () => { const h = new THREE.CylinderGeometry(.06, .06, .23, 8); h.rotateZ(Math.PI / 2); return h; }), hubM); tyre.position.set(s * (pr.w / 2 + .03), .27, -L / 2 + f * L); rim.position.copy(tyre.position); hub.position.copy(tyre.position); g.add(tyre, rim, hub);
    g.add(R.box(.06, .06, .62, 0x1E2124, s * (pr.w / 2 + .06), .55, -L / 2 + f * L)); }   // hjulbue
  // påbygg per type
  if (model === 'tanker') { const tk = new THREE.Mesh(R.geo('cyl', () => new THREE.CylinderGeometry(.58, .58, 1, 20)), R.mat(0xC8281E)); tk.rotation.x = Math.PI / 2; tk.scale.set(1, 2.3, 1); tk.position.set(0, 1.05, -L / 2 + 1.25); g.add(tk); g.add(R.box(1.2, .05, 2.3, 0xF2D21B, 0, .78, -L / 2 + 1.25)); }
  if (model === 'ladder') { const tt = new THREE.Mesh(R.geo('turn', () => new THREE.CylinderGeometry(.42, .46, .22, 18)), R.mat(0x3B3F42)); tt.position.set(0, 1.07, -L / 2 + .55); g.add(tt);
    for (const s of [-1, 1]) g.add(R.box(.05, .1, 3.5, 0xD8D6D0, s * .17, 1.28, -.25)); for (let i = 0; i < 16; i++) g.add(R.box(.34, .025, .03, 0xB9B7B0, 0, 1.26, -1.95 + i * .22)); g.add(R.box(.5, .4, .3, 0xC4241B, 0, 1.22, 1.45)); }
  if (model === 'rescue' || model === 'truck') { g.add(R.box(pr.w * .8, .08, 1.6, 0xB9B7B0, 0, H + .04, -.4)); for (let i = 0; i < 4; i++) g.add(R.box(pr.w * .82, .02, .02, 0x8a8880, 0, H + .1, -1.1 + i * .45));
    g.add(R.box(.5, .08, 2.2, 0xD8D6D0, -pr.w * .2, H + .16, -.6)); for (const s of [-1, 1]) g.add(R.box(.1, .1, .1, 0x3d7dff, s * (pr.w / 2 + .02), H - .1, -L / 2 + .1, true)); }   // stige på taket og blålys bak
  if (model === 'armored') g.add(R.box(.5, .25, .5, 0x3b4450, 0, H + .12, -.2));
  if (!civ && org !== 'strand') { const top = pr.cab ? Math.max(...pr.p.filter(q => q[0] >= pr.cab[0] - .05 && q[0] <= pr.cab[1] + .05).map(q => q[1])) : H, zc = pr.cab ? (pr.cab[0] + pr.cab[1]) / 2 - L / 2 : 0; bar(0, top + .06, zc, model === 'car' || model === 'suv' ? .22 : .3); if (model === 'ambulance' || model === 'van') for (const s of [-1, 1]) { const m = new THREE.Mesh(R.geo('box'), blue()); m.scale.set(.12, .1, .12); m.position.set(s * .45, H + .02, -L / 2 + .1); g.add(m); lights.push(m); } }
  return { g, lights };
}
/* ---------- redningsbåt (RS-skøyte / brannbåt): skrog med V-bunn bygget av spant, lakk som tekstur, konsoll, hardtak, mast og påhengsmotor ---------- */
const BOAT = { L: 3.8, B: 1.22, D: .78, N: 16 };
function boatHullGeo() {
  const { L, B, D, N } = BOAT, pos = [], uv = [], groups = [];
  const hb = t => Math.max(.015, B / 2 * (t < .58 ? 1 - .06 * (1 - t / .58) : Math.sqrt(Math.max(0, 1 - Math.pow((t - .58) / .42, 2)))));
  const deck = t => D + .14 * t * t, keel = t => (t < .52 ? 0 : (t - .52) / .48 * .62);
  const sec = t => { const h = hb(t), k = keel(t), d = deck(t), c = k + (d - k) * .36; return [[h, d], [h * .9, c], [0, k], [-h * .9, c], [-h, d]]; };
  const st = []; for (let i = 0; i <= N; i++) { const t = i / N; st.push({ t, z: -L / 2 + t * L, p: sec(t) }); }
  const tri = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  const P3 = (s, j) => [s.p[j][0], s.p[j][1], s.z], UV = (s, j) => [s.t, (s.p[j][1]) / (D + .14)];
  const side = (j0, j1) => { for (let i = 0; i < N; i++) { const A = st[i], Bn = st[i + 1]; tri(P3(A, j0), P3(Bn, j0), P3(Bn, j1), UV(A, j0), UV(Bn, j0), UV(Bn, j1)); tri(P3(A, j0), P3(Bn, j1), P3(A, j1), UV(A, j0), UV(Bn, j1), UV(A, j1)); } };
  let n0 = 0; const grp = mi => { groups.push([n0, pos.length / 3 - n0, mi]); n0 = pos.length / 3; };
  side(0, 1); side(1, 2); grp(0);          // styrbord (x > 0)
  side(2, 3); side(3, 4); grp(1);          // babord
  for (let i = 0; i < N; i++) { const A = st[i], Bn = st[i + 1]; tri(P3(A, 0), P3(A, 4), P3(Bn, 4), [0, 0], [1, 0], [1, 1]); tri(P3(A, 0), P3(Bn, 4), P3(Bn, 0), [0, 0], [1, 1], [0, 1]); }
  const s0 = st[0]; tri(P3(s0, 0), P3(s0, 1), P3(s0, 2), [0, 0], [0, 0], [0, 0]); tri(P3(s0, 0), P3(s0, 2), P3(s0, 4), [0, 0], [0, 0], [0, 0]); tri(P3(s0, 2), P3(s0, 3), P3(s0, 4), [0, 0], [0, 0], [0, 0]); grp(2);   // dekk og akterspeil
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  for (const [st0, cnt, mi] of groups) g.addGroup(st0, cnt, mi); return g;
}
/** Skroglakk for én side. mirrorText: styrbord vises speilvendt, så teksten tegnes speilvendt der for å leses riktig. */
R.hullMat = function (org, mirrorText) {
  const key = 'hull' + org + mirrorText; if (R.mats[key]) return R.mats[key];
  const W = 1024, Hh = 256, c = document.createElement('canvas'); c.width = W; c.height = Hh; const x = c.getContext('2d'), rs = org !== 'brann';
  const base = rs ? '#F6F6F4' : '#C4241B', accent = rs ? '#E3352B' : '#F4F1E8', V = v => (1 - v) * Hh, U = u => u * W;
  x.fillStyle = base; x.fillRect(0, 0, W, Hh);
  x.fillStyle = '#2B2E31'; x.fillRect(0, V(.2), W, Hh);                                       // bunnstoff
  x.fillStyle = '#1E2124'; x.fillRect(0, V(.95), W, V(.83) - V(.95));                         // svart skvettlist
  x.fillStyle = accent; x.beginPath(); x.moveTo(U(.93), V(1.05)); x.lineTo(U(1.01), V(1.05)); x.lineTo(U(1.01), V(.25)); x.lineTo(U(.965), V(.25)); x.closePath(); x.fill();   // fender i baugen
  x.beginPath(); x.moveTo(0, V(.83)); x.lineTo(U(.46), V(.83)); x.lineTo(U(.5), V(.74)); x.lineTo(0, V(.74)); x.closePath(); x.fill();   // stripe akter
  x.beginPath(); x.moveTo(U(.1), V(.62)); x.lineTo(U(.28), V(.62)); x.lineTo(U(.33), V(.48)); x.lineTo(U(.28), V(.4)); x.lineTo(U(.24), V(.4)); x.lineTo(U(.27), V(.5)); x.lineTo(U(.13), V(.5)); x.closePath(); x.fill();
  x.save(); if (mirrorText) { x.translate(W, 0); x.scale(-1, 1); }
  const tx = mirrorText ? W - U(.66) : U(.66); x.fillStyle = rs ? '#1F3A8A' : '#F4F1E8'; x.font = '900 112px Arial Black, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(rs ? 'RS' : 'BRANN', tx, V(.5));
  x.restore();
  for (let i = 0; i < 4; i++) { x.fillStyle = '#2B2E31'; x.beginPath(); x.arc(U(.36 + i * .02), V(.36), 4, 0, TAU); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return (R.mats[key] = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
};
function boatModel(org, glassM, lights) {
  const g = new THREE.Group(), rs = org !== 'brann', { L, D } = BOAT, top = rs ? 0xE3352B : 0xC4241B, deckY = D + .02;
  const hull = new THREE.Mesh(R.geo('hullV', boatHullGeo), [R.hullMat(org, true), R.hullMat(org, false), R.mat(0xE8E6E1)]); hull.position.y = -.22; g.add(hull);
  const y0 = deckY - .2;
  // styrekonsoll med vinduer
  g.add(R.box(1.0, .62, 1.1, 0xF4F4F2, 0, y0 + .31, .05));
  const ws = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), glassM); ws.scale.set(.96, .5, .03); ws.position.set(0, y0 + .85, .6); ws.rotation.x = -.45; g.add(ws);
  for (const sd of [-1, 1]) { const w = new THREE.Mesh(R.geo('box'), glassM); w.scale.set(.02, .42, .95); w.position.set(sd * .5, y0 + .86, .02); g.add(w); }
  // hardtak: rødt over, hvitt under, svart kant, båret av stolper
  const ht = y0 + 1.13; g.add(R.box(1.18, .06, 1.75, top, 0, ht + .05, -.15)); g.add(R.box(1.16, .04, 1.72, 0xF4F4F2, 0, ht, -.15)); g.add(R.box(1.2, .03, .06, 0x1E2124, 0, ht + .05, .72));
  for (const sd of [-1, 1]) { g.add(R.box(.05, .6, .05, 0x1E2124, sd * .5, y0 + .85, .55)); g.add(R.box(.05, 1.1, .05, 0x1E2124, sd * .5, y0 + .6, -.9)); }
  g.add(R.box(.5, .1, .2, 0xF4F4F2, 0, ht + .13, -.35)); g.add(R.box(.36, .12, .26, 0xFFFFFF, -.25, ht + .14, .2));   // redningsflåte og søkelys
  // mast med radar, antenner og lys
  g.add(R.box(.07, .9, .07, 0x1E2124, 0, ht + .5, -.75)); g.add(R.box(.7, .05, .06, 0x1E2124, 0, ht + .78, -.75));
  g.add(R.box(.8, .07, .16, 0xF4F4F2, 0, ht + .98, -.75)); const dome = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 16, 12)), R.mat(0xF4F4F2)); dome.scale.set(.14, .1, .14); dome.position.set(.25, ht + .86, -.75); g.add(dome);
  for (const [xx, hh] of [[-.32, .55], [-.22, .4], [.32, .5]]) g.add(R.box(.02, hh, .02, 0xF4F4F2, xx, ht + .8 + hh / 2, -.75));
  const blue = R.mats.blueL || (R.mats.blueL = new THREE.MeshBasicMaterial({ color: 0x3d7dff })); for (const sd of [-1, 1]) { const m = new THREE.Mesh(R.geo('box'), blue); m.scale.set(.12, .08, .1); m.position.set(sd * .4, ht + .12, .66); g.add(m); lights.push(m); }
  // rekkverk på fordekket
  const rail = (a, b) => beam(g, a, b, .03, 0x2A2E31);
  for (const sd of [-1, 1]) { rail([sd * .5, deckY + .32, .7], [sd * .3, deckY + .38, 1.6]); for (const zz of [.75, 1.15, 1.5]) rail([sd * (zz > 1.4 ? .32 : .5), deckY - .18, zz], [sd * (zz > 1.4 ? .32 : .5), deckY + .34, zz]); }
  rail([-.3, deckY + .38, 1.6], [.3, deckY + .38, 1.6]);
  // påhengsmotor med rød kappe, vannscooter og flagg akter
  g.add(R.box(.42, .55, .4, 0x1E2124, 0, y0 + .2, -L / 2 - .2)); g.add(R.box(.44, .25, .42, 0xE3352B, 0, y0 + .52, -L / 2 - .2)); g.add(R.box(.14, .5, .14, 0x2B2E31, 0, y0 - .25, -L / 2 - .25));
  if (rs) { g.add(R.box(.42, .14, .9, 0x1E2124, .1, y0 + .05, -L / 2 + .55)); g.add(R.box(.36, .16, .7, 0xE3352B, .1, y0 + .19, -L / 2 + .5)); g.add(R.box(.3, .08, .3, 0x2B2E31, .1, y0 + .32, -L / 2 + .6)); }
  g.add(R.box(.02, .7, .02, 0xE8E8E8, -.4, y0 + .55, -L / 2 + .1)); g.add(R.box(.02, .22, .32, 0xC8102E, -.4, y0 + .8, -L / 2 - .07)); g.add(R.box(.021, .05, .32, 0xFFFFFF, -.4, y0 + .8, -L / 2 - .07)); g.add(R.box(.022, .022, .32, 0x00205B, -.4, y0 + .8, -L / 2 - .07));
  // SAR / BRANN på konsollen (egne flater, alltid riktig vei)
  for (const sd of [-1, 1]) { const p = new THREE.Mesh(R.geo('signq', () => new THREE.PlaneGeometry(1, 1)), R.signMat(rs ? 'SAR' : '110', '#F4F4F2', rs ? '#E3352B' : '#C4241B')); p.scale.set(.6, .14, 1); p.rotation.y = sd * Math.PI / 2; p.position.set(sd * .505, y0 + .45, -.25); g.add(p); }
  return { g, lights };
}
R._vcache = {};
function vehicleModel(type, org) {
  const key = type + '|' + org; let base = R._vcache[key]; if (!base) base = R._vcache[key] = vehicleBase(type, org);
  const g = base.g.clone(true), lights = [];
  const idx = new Set(base.lights.map(m => base.g.children.indexOf(m)));
  g.children.forEach((c, i) => { if (idx.has(i)) lights.push(c); if (c.name === 'rotor') g.userData.rotor = c; if (c.name === 'rotor2') g.userData.rotor2 = c; });
  g.userData.lights = lights; return g;
}


/* ---------- sivil trafikk: biler som kjører rundt på veinettet nær kameraet ---------- */
const CIV_COL = [0xE8E6E1, 0x23262A, 0x8A9096, 0x2D4E7A, 0x8C2A2A, 0xC9CDD0, 0x3F5B45, 0x5A4636, 0xD9D4C7, 0x1F3346];
/** Slår sammen en modellgruppe til én geometri med farger per hjørne (brukes til instanser av sivile biler og trær). */
R.mergeGroup = function (g) {
  g.updateMatrixWorld(true); const pos = [], nor = [], col = [], c = new THREE.Color(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  g.traverse(o => {
    if (!o.isMesh) return; const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, P = geo.attributes.position, N = geo.attributes.normal; nm.getNormalMatrix(o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material], groups = geo.groups.length ? geo.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
    for (const gr of groups) { const m = mats[gr.materialIndex] || mats[0]; if (m.map || !m.color) c.set(0xffffff); else c.copy(m.color);
      for (let i = gr.start; i < Math.min(P.count, gr.start + gr.count); i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); if (N) v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); else v.set(0, 1, 0); nor.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); } }
  });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return out;
};
const CIV_MODELS = [['car', .4], ['hatch', .22], ['suv', .18], ['van', .12], ['bus', .08]];
R.traffic = { cars: [], models: [] };
R.initTraffic = function () {
  R.clearTraffic(); const w = R.world; if (!w || !w.edges.length) return;
  const N = Game.lowGfx ? 45 : 130, T = R.traffic, col = new THREE.Color();
  T.cand = w.edges.filter(e => w.comp[e.a] === w.mainComp && HW_MUL[e.hw] >= 0.85 && e.len > 25);
  const mat = R.mats.civV || (R.mats.civV = new THREE.MeshLambertMaterial({ vertexColors: true }));
  T.models = CIV_MODELS.map(([m]) => ({ m, geo: R.geo('civ' + m, () => R.mergeGroup(vehicleBase(null, 'sivil', m).g)), mesh: null, list: [] }));
  for (let i = 0; i < N; i++) { let r = Math.random(), mi = 0; for (; mi < CIV_MODELS.length - 1; mi++) { r -= CIV_MODELS[mi][1]; if (r < 0) break; } const md = T.models[mi]; T.cars.push({ e: null, s: 0, dir: 1, sp: 0, mi, k: md.list.length }); md.list.push(i); }
  for (const md of T.models) {
    if (!md.list.length) continue; md.mesh = new THREE.InstancedMesh(md.geo, mat, md.list.length);
    md.list.forEach((ci, k) => { col.setHex(md.m === 'bus' ? 0xD6261E : CIV_COL[(ci * 7) % CIV_COL.length]); md.mesh.setColorAt(k, col); });
    md.mesh.frustumCulled = false; md.mesh.castShadow = true; md.mesh.instanceColor.needsUpdate = true; R.scene.add(md.mesh);
  }
};
R.clearTraffic = function () { const T = R.traffic; for (const md of (T.models || [])) if (md.mesh) R.scene.remove(md.mesh); T.cars = []; T.models = []; };
R.spawnCar = function (c) {
  const T = R.traffic, cx = R.cam.tx, cz = R.cam.tz, rad = clamp(R.mpp * Math.max(R.w, R.h) * 0.7, 300, 1600);
  for (let k = 0; k < 40; k++) { const e = T.cand[Math.floor(Math.random() * T.cand.length)], p = e.geom[e.geom.length >> 1]; if (Math.hypot(p[0] - cx, p[1] - cz) < rad || k === 39) { c.e = e; c.dir = Math.random() < 0.5 ? 1 : -1; c.s = Math.random() * e.len; c.sp = 430 * e.mul * rr(0.8, 1.1); return; } }
};
R.updateTraffic = function (dtGame) {
  const T = R.traffic, w = R.world; if (!T.models || !T.models.length || !w) return;
  const cx = R.cam.tx, cz = R.cam.tz, rad = clamp(R.mpp * Math.max(R.w, R.h) * 0.9, 400, 2000), nav = w.nav;
  for (let i = 0; i < T.cars.length; i++) {
    const c = T.cars[i]; if (!c.e) R.spawnCar(c);
    c.s += c.dir * c.sp * dtGame;
    if (c.s > c.e.len || c.s < 0) {   // neste veistrekning i krysset (ikke snu hvis mulig)
      const node = c.s > c.e.len ? c.e.b : c.e.a, opts = w.adj[node].filter(x => x.edge !== c.e && HW_MUL[x.edge.hw] >= 0.85);
      const nx = opts.length ? opts[Math.floor(Math.random() * opts.length)] : { edge: c.e };
      const ne = nx.edge; c.dir = ne.a === node ? 1 : -1; c.s = c.dir > 0 ? 0 : ne.len; c.e = ne; c.sp = 430 * ne.mul * rr(0.8, 1.1) * (CIV_MODELS[c.mi][0] === 'bus' ? .8 : 1);
    }
    const p = nav.pointAt(c.e, c.s), q = nav.pointAt(c.e, clamp(c.s + c.dir * 3, 0, c.e.len)), dx = q[0] - p[0], dz = q[1] - p[1], d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d, px = p[0] - uz * 1.9, pz = p[1] + ux * 1.9;   // høyre kjørefelt
    if (Math.hypot(px - cx, pz - cz) > rad) { c.e = null; R.spawnCar(c); }
    const h = Math.atan2(ux, uz); c.px = px; c.pz = pz; c.h = h;
    _q.setFromAxisAngle(_up, h); _v3.set(px, 0, pz); _s3.set(VS * 0.95, VS * 0.95, VS * 0.95); _m4.compose(_v3, _q, _s3); T.models[c.mi].mesh.setMatrixAt(c.k, _m4);
  }
  for (const md of T.models) if (md.mesh) md.mesh.instanceMatrix.needsUpdate = true;
};
const _up = new THREE.Vector3(0, 1, 0);

/* ---------- strender: finn strandkanten i kartdataene og flytt tårn, livredder og badeplass dit ---------- */
R.isWater = function (x, z) {
  if (!R.blockedAt(x, z, 0) || !R._blk) return false;
  const inPoly = (ring, px, pz) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pz) !== (b[1] > pz) && px < (b[0] - a[0]) * (pz - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  return R._blk.rings.some(r => r.layer === 'water' && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && inPoly(r.ring, x, z));
};
R.fixBeaches = function () {
  const w = R.world, map = R.map; if (!w || !map || !map.getSource('om') || !R.ready) return;
  const b0 = map.getBounds();
  for (const id in w.beaches) {
    const b = w.beaches[id]; if (b.fixed) continue; const ll = w.proj.toLL(b.tower.x, b.tower.z); if (!b0.contains([ll.lon, ll.lat])) continue;
    R._blk = null; b.tries = (b.tries || 0) + 1; if (b.tries >= 6) b.fixed = true; let dx, dz, shore = null;   // prøver igjen til kartflisene er lastet
    if (b.towerFixed) {
      // tårnet står der det er oppgitt: let i alle retninger etter nærmeste vann og legg badeplassen der
      let best = null;
      for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, ux = Math.cos(a), uz = Math.sin(a); for (let st = 1; st <= 45; st++) { const px = b.tower.x + ux * st * 4, pz = b.tower.z + uz * st * 4; if (R.isWater(px, pz)) { if (!best || st < best.st) best = { st, ux, uz, px, pz }; break; } } }
      if (!best) continue; dx = best.ux; dz = best.uz; shore = { x: best.px - dx * 3, z: best.pz - dz * 3 };
    } else {
      const road = w.nav.rpXZ(b.rp); dx = b.x - road.x; dz = b.z - road.z; let d = Math.hypot(dx, dz);
      if (d < 5 || b.island) { dx = b.wv[0]; dz = b.wv[1]; d = 1; }
      dx /= d; dz /= d; const start = b.island ? { x: b.x - dx * 120, z: b.z - dz * 120 } : road;
      for (let k = 0; k < 140; k++) { const px = start.x + dx * k * 4, pz = start.z + dz * k * 4; if (R.isWater(px, pz)) { shore = { x: px - dx * 4, z: pz - dz * 4 }; break; } }
      if (!shore) continue; b.tower = { x: shore.x - dx * 14, z: shore.z - dz * 14 };
    }
    b.fixed = true; b.shore = shore; b.swim = { x: shore.x + dx * 28, z: shore.z + dz * 28 }; b.x = (b.tower.x + shore.x) / 2; b.z = (b.tower.z + shore.z) / 2; b.wv = [dx, dz];
    const v = R.beachViews && R.beachViews[id]; if (v) { v.grp.position.set(b.tower.x, 0, b.tower.z); v.grp.rotation.y = Math.atan2(dx, dz); }
    if (typeof S !== 'undefined' && S) for (const u of Object.values(S.units)) if (u.type === 'livredder' && u.beach === id && u.status === 'ledig') { u.x = b.tower.x; u.z = b.tower.z; }
  }
};

/* ---------- lys om natten: frontlykter, baklys, blålys som lyser opp, gatelys (additive lyspunkter i meter) ---------- */
R.glowInit = function () {
  const N = 4000, g = new THREE.BufferGeometry(); R.glow = { N, pos: new Float32Array(N * 3), col: new Float32Array(N * 3), size: new Float32Array(N) };
  g.setAttribute('position', new THREE.BufferAttribute(R.glow.pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(R.glow.col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(R.glow.size, 1));
  R.glowMat = new THREE.ShaderMaterial({ uniforms: { uK: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aSize; attribute vec3 aColor; uniform float uK; varying vec3 vC; void main(){ vC = aColor; gl_PointSize = clamp(aSize * uK, 2.0, 220.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; float a = exp(-r * r * 4.0) + 0.6 * max(0.0, 1.0 - r * 6.0); gl_FragColor = vec4(vC * a, a); }' });
  const pts = new THREE.Points(g, R.glowMat); pts.frustumCulled = false; pts.renderOrder = 9; R.glowPts = pts; R.scene.add(pts);
};
R.glowFrame = function (S) {
  if (!R.glow) R.glowInit(); const G = R.glow, night = smooth(0.35, 0.8, 1 - (R.env.daylight == null ? 1 : R.env.daylight)); let n = 0;
  const add = (x, y, z, r, g, b, s) => { if (n >= G.N) return; G.pos[n * 3] = x; G.pos[n * 3 + 1] = y; G.pos[n * 3 + 2] = z; G.col[n * 3] = r; G.col[n * 3 + 1] = g; G.col[n * 3 + 2] = b; G.size[n] = s; n++; };
  const car = (x, z, h, L, W, k) => { const sx = Math.sin(h), sz = Math.cos(h), px = sz, pz = -sx;   // lykter foran (varmt hvitt) og bak (rødt)
    for (const sd of [-1, 1]) { add(x + sx * L + px * W * sd, 1.6, z + sz * L + pz * W * sd, .9 * night * k, .82 * night * k, .62 * night * k, 7); add(x - sx * L + px * W * sd, 1.6, z - sz * L + pz * W * sd, .6 * night * k, .05, .04, 3.5); } };
  if (S && R.views) for (const id in R.views.units) {
    const v = R.views.units[id], u = S.units[id]; if (!u || !v.grp.visible) continue; const T = UT[u.type];
    if (night > .02 && !T.foot && T.model !== 'heli') { const pr = VPROF[T.model] || VPROF.car, L = (pr.p ? Math.max(...pr.p.map(q => q[0])) : 2.5) / 2 * VS; car(v.grp.position.x, v.grp.position.z, v.h, L, .32 * VS, 1); }
    if (u.siren) for (const m of v.lights) if (m.visible) { m.getWorldPosition(_v3); add(_v3.x, _v3.y + .3, _v3.z, .15, .35, 1, 5 + 12 * night); }
  }
  if (night > .02) {
    const T = R.traffic; if (T && T.cars) for (const c of T.cars) if (c.px != null) car(c.px, c.pz, c.h, (CIV_MODELS[c.mi][0] === 'bus' ? 2.3 : 1.05) * VS, .3 * VS, .8);
    if (City.lamps) for (const l of City.lamps) { add(l[0], 6.6, l[1], 1 * night, .78 * night, .5 * night, 16); add(l[0], .5, l[1], .25 * night, .19 * night, .12 * night, 22); }
  }
  R.glowMat.uniforms.uK.value = R.dpr / R.mpp; const a = R.glowPts.geometry.attributes; a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = true; R.glowPts.geometry.setDrawRange(0, n);
};
/** Kameraet følger valgt enhet (stopper når spilleren drar i kartet). */
R.followFrame = function (S, dt) {
  if (!R.follow || !S) return; const u = S.units[R.follow]; if (!u || u.vis === false) { R.follow = null; return; }
  const c = R.map.getCenter(), t = R.toLL(u.x, u.z), k = Math.min(1, dt * 3); R.map.jumpTo({ center: [c.lng + (t[0] - c.lng) * k, c.lat + (t[1] - c.lat) * k] });
};

/* ---------- partikler: ild, røyk, gass, vannsprut (alt i meter) ---------- */
R.fxInit = function () {
  const N = 900, geo = new THREE.BufferGeometry();
  R.fx = { N, pos: new Float32Array(N * 3), col: new Float32Array(N * 3), size: new Float32Array(N), alpha: new Float32Array(N), life: new Float32Array(N), max: new Float32Array(N), vel: new Float32Array(N * 3), s0: new Float32Array(N), s1: new Float32Array(N), c0: new Float32Array(N * 3), c1: new Float32Array(N * 3), a0: new Float32Array(N), next: 0 };
  geo.setAttribute('position', new THREE.BufferAttribute(R.fx.pos, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(R.fx.col, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(R.fx.size, 1)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(R.fx.alpha, 1));
  R.fxMat = new THREE.ShaderMaterial({ uniforms: { uK: { value: 1 } }, transparent: true, depthWrite: false,
    vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uK; varying float vA; varying vec3 vC; void main(){ vA = aAlpha; vC = aColor; gl_PointSize = min(aSize * uK, 160.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vA; varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(vC, (1.0 - r * r) * vA); }' });
  const pts = R.fxPts = new THREE.Points(geo, R.fxMat); pts.frustumCulled = false; pts.renderOrder = 8; R.scene.add(pts);
  const M = 600, wg = new THREE.BufferGeometry(); R.wx = { M, pos: new Float32Array(M * 3), seed: new Float32Array(M) };
  for (let i = 0; i < M; i++) { R.wx.pos[i * 3] = (Math.random() - 0.5) * 2; R.wx.pos[i * 3 + 1] = Math.random(); R.wx.pos[i * 3 + 2] = (Math.random() - 0.5) * 2; R.wx.seed[i] = Math.random(); }
  wg.setAttribute('position', new THREE.BufferAttribute(R.wx.pos, 3));
  R.wxMat = new THREE.ShaderMaterial({ uniforms: { uStreak: { value: 1 }, uPx: { value: 14 }, uAlpha: { value: 0.5 }, uCol: { value: new THREE.Color(0xdfe9ee) } }, transparent: true, depthWrite: false,
    vertexShader: 'uniform float uPx; void main(){ gl_PointSize = uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uStreak; uniform float uAlpha; uniform vec3 uCol; void main(){ vec2 d = gl_PointCoord - 0.5; float a; if (uStreak > 0.5) { a = (1.0 - smoothstep(0.0, 0.07, abs(d.x))) * (1.0 - smoothstep(0.25, 0.5, abs(d.y))); } else { a = 1.0 - smoothstep(0.25, 0.5, length(d)); } gl_FragColor = vec4(uCol, a * uAlpha); }' });
  const wp = R.wxPts = new THREE.Points(wg, R.wxMat); wp.frustumCulled = false; wp.renderOrder = 9; wp.visible = false; R.scene.add(wp);
};
R.emit = function (x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0) {
  const F = R.fx, i = F.next; F.next = (F.next + 1) % F.N;
  F.pos[i * 3] = x; F.pos[i * 3 + 1] = y; F.pos[i * 3 + 2] = z; F.vel[i * 3] = vx; F.vel[i * 3 + 1] = vy; F.vel[i * 3 + 2] = vz;
  F.life[i] = life; F.max[i] = life; F.s0[i] = s0; F.s1[i] = s1; F.a0[i] = a0 == null ? 0.8 : a0;
  F.c0[i * 3] = c0[0]; F.c0[i * 3 + 1] = c0[1]; F.c0[i * 3 + 2] = c0[2]; F.c1[i * 3] = c1[0]; F.c1[i * 3 + 1] = c1[1]; F.c1[i * 3 + 2] = c1[2];
};
const FIRE0 = [1, 0.82, 0.38], FIRE1 = [0.88, 0.3, 0.14], SMK0 = [0.55, 0.55, 0.55], SMK1 = [0.82, 0.83, 0.84], GAS0 = [0.78, 0.82, 0.45], GAS1 = [0.85, 0.88, 0.62], SPL0 = [0.86, 0.95, 1], SPL1 = [0.7, 0.88, 0.98];
R.fxUpdate = function (dt, S) {
  const F = R.fx; if (!F) return; const K = 4, px = R.dpr / R.mpp;      // størrelser i meter → piksler
  R.fxMat.uniforms.uK.value = px;
  if (S && dt > 0) {
    for (const id in S.incidents) {
      const inc = S.incidents[id]; if (inc.state === 'ferdig' || inc.state === 'feilet' || !inc.fx || inc.fx === 'none') continue;
      const L = inc.loc, k = clamp(1 - 0.85 * (inc.progress / Math.max(1, inc.work)) * (inc.onScene ? 1 : 0.2), 0.12, 1);
      const rate = (inc.fx === 'fire' ? 34 : inc.fx === 'smoke' ? 10 : inc.fx === 'gas' ? 7 : 6) * k;
      let n = rate * dt; const whole = Math.floor(n); n = whole + (Math.random() < n - whole ? 1 : 0);
      for (let q = 0; q < n; q++) {
        const ox = (Math.random() - 0.5) * 12, oz = (Math.random() - 0.5) * 12, hgt = (inc.floors ? Math.min(40, 4 + inc.floors * 3.2) : 3);
        if (inc.fx === 'fire') {
          if (Math.random() < 0.55) R.emit(L.x + ox, hgt * (0.6 + Math.random() * 0.4), L.z + oz, 0, (2.8 + Math.random() * 1.8) * K, 0, 0.9 + Math.random() * 0.8, 2.7 * K * 1.4, 0.8 * K, FIRE0, FIRE1, 0.95);
          else R.emit(L.x + ox, hgt + 3, L.z + oz, 2.4, (1.9 + Math.random()) * K, 1.2, 3 + Math.random() * 2, 2.4 * K * 1.4, 7.5 * K * 1.4, SMK0, SMK1, 0.5);
        } else if (inc.fx === 'smoke') R.emit(L.x + ox, 3, L.z + oz, 1.6, 1.6 * K, 0.8, 2.2 + Math.random(), 1.2 * K * 1.4, 4.2 * K * 1.4, SMK0, SMK1, 0.4);
        else if (inc.fx === 'gas') R.emit(L.x + ox * 1.6, 4 + Math.random() * 6, L.z + oz * 1.6, (Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3, 3 + Math.random() * 1.5, 2.2 * K * 1.4, 6.5 * K * 1.4, GAS0, GAS1, 0.32);
        else if (inc.fx === 'water') R.emit(L.x + ox, 0.5, L.z + oz, (Math.random() - 0.5) * 3, (1.8 + Math.random()) * K, (Math.random() - 0.5) * 3, 0.9, 0.8 * K, 0.3 * K, SPL0, SPL1, 0.8);
      }
    }
  }
  for (let i = 0; i < F.N; i++) {
    if (F.life[i] > 0) {
      F.life[i] -= dt; const t = 1 - F.life[i] / F.max[i];
      if (F.life[i] <= 0) { F.alpha[i] = 0; F.size[i] = 0; continue; }
      F.pos[i * 3] += F.vel[i * 3] * dt; F.pos[i * 3 + 1] += F.vel[i * 3 + 1] * dt; F.pos[i * 3 + 2] += F.vel[i * 3 + 2] * dt; F.vel[i * 3 + 1] *= (1 - 0.35 * dt);
      F.size[i] = lerp(F.s0[i], F.s1[i], t); F.alpha[i] = F.a0[i] * (t < 0.12 ? t / 0.12 : 1 - smooth(0.4, 1, t));
      for (let k = 0; k < 3; k++) F.col[i * 3 + k] = lerp(F.c0[i * 3 + k], F.c1[i * 3 + k], t);
    } else { F.alpha[i] = 0; F.size[i] = 0; }
  }
  const g = R.fxPts.geometry; g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = true;
  // regn / snø rundt kartsenteret
  const W = R.wx, mode = R.wxMode; R.wxPts.visible = !!mode;
  if (mode) {
    const rain = mode !== 'snø', span = clamp(R.mpp * Math.max(R.w, R.h) * 0.75, 60, 3000), top = span * 0.55, sp = top * (rain ? 1.1 : 0.12);
    R.wxMat.uniforms.uStreak.value = rain ? 1 : 0; R.wxMat.uniforms.uPx.value = (rain ? 16 : 6) * R.dpr; R.wxMat.uniforms.uAlpha.value = rain ? 0.4 : 0.85; R.wxMat.uniforms.uCol.value.set(rain ? 0xcfdde6 : 0xffffff);
    for (let i = 0; i < W.M; i++) {
      let x = W.pos[i * 3], y = W.pos[i * 3 + 1], z = W.pos[i * 3 + 2];
      if (Math.abs(x) > 2 || y > 2) { x = (Math.random() - 0.5) * 2; y = Math.random(); z = (Math.random() - 0.5) * 2; }   // normaliserte koordinater
      y -= (sp / top) * dt * (0.8 + W.seed[i] * 0.4) * 1; if (y < 0) y = 1;
      W.pos[i * 3] = x; W.pos[i * 3 + 1] = y; W.pos[i * 3 + 2] = z;
    }
    // sett verdensposisjon: kartsenter ± span
    R.wxPts.position.set(R.cam.tx, 0, R.cam.tz); R.wxPts.scale.set(span, top, span);
    R.wxPts.geometry.attributes.position.needsUpdate = true;
  }
};

/* ---------- miljø: dag/natt (filter på kartet), vær, årstid ---------- */
R.setEnv = function (e, force) {
  R.env = e; if (!R.map) return;
  const dl = e.daylight, night = 1 - dl, wx = e.weather, wet = (wx === 'regn' || wx === 'storm') ? 1 : 0, snow = wx === 'snø' ? 1 : 0;
  R.hemi.intensity = lerp(0.5, 0.78, dl) * (wet ? 0.9 : 1); R.hemi.color.set(0x8E9CCB).lerp(new THREE.Color(0xFAF3E2), dl); R.hemi.groundColor.set(0x4A5476).lerp(new THREE.Color(0xDADCC8), dl);
  R.sun.intensity = lerp(0.18, 0.5, smooth(0.1, 0.9, dl)) * (wet ? 0.6 : 1); R.sun.color.set(0xA9BAF0).lerp(new THREE.Color(0xFFF1D6), smooth(0.15, 0.8, dl));
  const u = (e.hour - (e.sunrise || 6)) / ((e.sunset || 20) - (e.sunrise || 6));
  // sola går fra øst (morgen) via sør (midt på dagen) til vest (kveld); høyden følger årstiden, men holdes over ca. 22° så skyggene ikke blir urimelig lange
  { const a = clamp(u, 0, 1) * Math.PI, maxEl = [40, 52, 30, 20][e.season || 0] * Math.PI / 180, el = Math.max(22 * Math.PI / 180, maxEl * Math.sin(a));
    const az = Math.PI - a;   // 0 = øst … π = vest (x = øst, z = sør)
    R.sunDir = (R.sunDir || new THREE.Vector3()).set(Math.cos(az) * Math.cos(el) * -1, Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    R.sun.position.copy(R.sunDir).multiplyScalar(100); }
  const tw = Math.max(0, 1 - Math.abs(dl - 0.42) / 0.34), b = lerp(0.58, 1, smooth(0, 1, dl)) * (wet ? 0.92 : 1);
  R.map.getCanvas().style.filter = 'brightness(' + b.toFixed(3) + ') saturate(' + (lerp(0.75, 1, dl) * (wet ? 0.82 : 1)).toFixed(3) + ') sepia(' + (tw * 0.18).toFixed(3) + ') hue-rotate(' + (night * -12).toFixed(1) + 'deg)';
  const nightPat = night > 0.55 ? '-n' : ''; if (R.nightPat !== nightPat && R.map.getLayer('bld-low-0')) { R.nightPat = nightPat; for (let k = 0; k < 5; k++) for (const t of ['low', 'high']) R.map.setPaintProperty('bld-' + t + '-' + k, 'fill-extrusion-pattern', 'win-' + t + '-' + k + nightPat); }
  R.wxMode = wet ? (wx === 'storm' ? 'storm' : 'regn') : snow ? 'snø' : '';
  City.setNight(smooth(0.35, 0.75, night));
  if (R.map.setSky && R.ready) { const k = night, mix = (a, b) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString(); try { R.map.setSky({ 'sky-color': mix('#8FBBE3', '#141B33'), 'horizon-color': mix(wet ? '#C9D1D6' : '#E6EEF2', '#2B3350'), 'fog-color': mix(wet ? '#C3CBD0' : '#DCE5EA', '#1E2438'), 'fog-ground-blend': wet ? 0.35 : 0.55, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0.8 }); } catch (e) { /* eldre MapLibre */ } }
};

/* ---------- overlegg: valgring, rutelinje, plasseringsringer ---------- */
R.ensureOverlay = function () {
  if (R.selRing) return;
  R.selRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0x7b9a79, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
  R.selRing.rotation.x = -Math.PI / 2; R.selRing.renderOrder = 12; R.selRing.visible = false; R.dyn.add(R.selRing);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
  R.pathLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x3e4a3f, transparent: true, opacity: 0.8, depthTest: false })); R.pathLine.renderOrder = 11; R.pathLine.frustumCulled = false; R.pathLine.visible = false; R.dyn.add(R.pathLine);
  R.placeRings = new THREE.InstancedMesh(new THREE.RingGeometry(0.7, 1, 32), new THREE.MeshBasicMaterial({ color: 0x4f7a55, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, depthTest: false }), 600);
  R.placeRings.frustumCulled = false; R.placeRings.renderOrder = 13; R.placeRings.count = 0; R.dyn.add(R.placeRings);
};
R.setPlacement = function (mode) { R.ensureOverlay(); R.placeMode = mode; R.placeRings.count = mode && mode.lots ? Math.min(600, mode.lots.length) : 0; };
R.setSelection = function (sel) { R.sel = sel; };
const pinPx = { unit: 30, station: 34, mast: 30, inc: 54, ghost: 28 };
R.res = new THREE.Vector2(800, 600);
/** Skjermrettet ikon-«pin» med fast pikselstørrelse (virker i kartets custom layer). */
R.makePin = function (iconName, bg, size, ring) {
  const tex = R.pinMat(iconName, bg, ring).map;
  const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex }, uSize: { value: 30 }, uLift: { value: 0 }, uOp: { value: 1 }, uRes: { value: R.res } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; uniform vec2 uRes; uniform float uSize; uniform float uLift; void main(){ vUv = uv; vec4 c = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); vec2 o = position.xy * uSize + vec2(0.0, uLift); gl_Position = c + vec4(o * 2.0 / uRes * c.w, 0.0, 0.0); }',
    fragmentShader: 'varying vec2 vUv; uniform sampler2D map; uniform float uOp; void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb, t.a * uOp); }' });
  Object.defineProperty(mat, 'opacity', { get() { return this.uniforms.uOp.value; }, set(v) { this.uniforms.uOp.value = v; } });
  const m = new THREE.Mesh(R.geo('quad', () => new THREE.PlaneGeometry(1, 1)), mat); m.renderOrder = 20; m.frustumCulled = false; return m;
};
R.pinAt = (pin, x, y, z, px) => { pin.position.set(x, Math.min(y, 30), z); pin.material.uniforms.uSize.value = px; pin.material.uniforms.uLift.value = px * 0.62; };
R.addStationView = function (st) {
  const lot = R.world.lotById.get(st.lotId), T = ST[st.type], grp = new THREE.Group(), real = Stations.build(st);
  // ekte bygg i meter; ekte sykehus/legevakt i byen får bare nål (bygget står allerede i kartet)
  if (real) grp.add(real.grp);
  grp.rotation.y = lot.face || 0; grp.position.set(lot.x, 0, lot.z); R.dyn.add(grp);
  const pin = R.makePin(T.ikon, T.rolle === 'helse' ? '#8FB59A' : (AGENCIES[T.org] || AGENCIES.bistand).farge, 1); R.dyn.add(pin); R.views.stations[st.id] = { grp, pin, lot, h: real ? real.h + 6 : (st.type === 'sykehus' ? 30 : 18) };
};
R.addMastView = function (m) {
  const g = mastModel(m.mobile); g.position.set(m.x, 0, m.z); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); R.dyn.add(g);
  const pin = R.makePin('mast', '#A99BCB', 1); R.dyn.add(pin); R.views.masts[m.id] = { grp: g, pin, beacon: g.userData.beacon, h: (m.mobile ? 20 : 42) };
};
R.addUnitView = function (u) {
  const T = UT[u.type], org = u.org === 'bistand' ? 'bistand' : T.org, grp = new THREE.Group(), model = vehicleModel(u.type, org); grp.add(model); grp.scale.setScalar(VS);
  const col = (AGENCIES[org] || AGENCIES.bistand).farge, pin = R.makePin((AGENCIES[org] || AGENCIES.bistand).ikon, col, 1); let halo = null;
  if (org === 'rk' || org === 'nf' || org === 'strand') { halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.2; grp.add(halo); }
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  R.dyn.add(grp); R.dyn.add(pin); R.views.units[u.id] = { grp, model, pin, halo, lights: model.userData.lights || [], rotor: model.userData.rotor, rotor2: model.userData.rotor2, h: u.h || 0 };
};
R.addIncidentView = function (inc) {
  const col = PRI_COLOR[inc.pri] || '#8FA3B8', grp = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 36), new THREE.MeshBasicMaterial({ color: new THREE.Color(col), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.8; ring.renderOrder = 5; grp.add(ring);
  const late = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.25, 36), new THREE.MeshBasicMaterial({ color: 0xd9695a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })); late.rotation.x = -Math.PI / 2; late.position.y = 0.9; late.visible = false; grp.add(late);
  const spr = R.makePin(inc.ikon || 'bell', col, 1); R.dyn.add(spr); grp.position.set(inc.loc.x, 0, inc.loc.z); R.dyn.add(grp);
  R.views.incidents[inc.id] = { grp, ring, late, spr };
};

/* ---------- synkronisering av dynamiske objekter ---------- */
R.sync = function (S, dt) {
  R.ensureOverlay();
  const V = R.views, t = R.time, mpp = R.mpp, far = R.cam.dist;
  for (const id in S.stations) if (!V.stations[id]) R.addStationView(S.stations[id]);
  for (const id in V.stations) if (!S.stations[id]) { R.dyn.remove(V.stations[id].grp); R.dyn.remove(V.stations[id].pin); delete V.stations[id]; }
  for (const id in V.stations) { const v = V.stations[id]; v.pin.visible = far > 45; R.pinAt(v.pin, v.lot.x, v.h, v.lot.z, pinPx.station); }
  const masts = S.net.masts;
  for (const id in masts) if (!V.masts[id]) R.addMastView(masts[id]);
  for (const id in V.masts) if (!masts[id]) { R.dyn.remove(V.masts[id].grp); R.dyn.remove(V.masts[id].pin); delete V.masts[id]; }
  for (const id in V.masts) { const v = V.masts[id], m = masts[id]; v.pin.visible = far > 40; R.pinAt(v.pin, m.x, v.h, m.z, pinPx.mast); v.beacon.material.color.set(m.down ? 0x555555 : (Math.sin(t * 3 + id.length) > 0 ? 0xf2a0a0 : 0xa77878)); v.pin.material.opacity = m.down ? 0.45 : 1; }
  for (const id in S.units) if (!V.units[id]) R.addUnitView(S.units[id]);
  for (const id in V.units) if (!S.units[id]) { R.dyn.remove(V.units[id].grp); R.dyn.remove(V.units[id].pin); delete V.units[id]; if (V.ghosts[id]) { R.dyn.remove(V.ghosts[id]); delete V.ghosts[id]; } }
  const flash = Math.floor(t * 5) % 2;
  for (const id in V.units) {
    const v = V.units[id], u = S.units[id], T = UT[u.type], show = u.vis !== false && u.contact !== 'ingen';
    v.grp.visible = show;
    if (u.vis !== false && u.contact === 'ingen' && u.lastKnown) {
      let gh = V.ghosts[id]; if (!gh) { gh = V.ghosts[id] = R.makePin('signal', '#9AA0A0', 1, 'rgba(255,255,255,0.7)'); gh.material.opacity = 0.75; R.dyn.add(gh); }
      gh.visible = true; R.pinAt(gh, u.lastKnown.x, 6, u.lastKnown.z, pinPx.ghost);
    } else if (V.ghosts[id]) V.ghosts[id].visible = false;
    if (!show) { v.pin.visible = false; continue; }
    const hx = Math.sin(u.h || 0), hz = Math.cos(u.h || 0), lane = (u.status === 'ledig' || T.foot || (u.status === 'pastedet' && T.model !== 'heli')) ? 0 : 2.1;
    const px = u.x - hz * lane, pz = u.z + hx * lane, alt = (u.alt || 0) * 6;
    v.grp.position.set(px, alt, pz); v.h = lerpAngle(v.h, u.h || 0, 0.25); v.grp.rotation.y = v.h;
    const siren = u.siren && T.model !== 'foot';
    for (let i = 0; i < v.lights.length; i++) v.lights[i].visible = siren ? ((i + flash) % 2 === 0) : false;
    if (v.rotor) v.rotor.rotation.y += (u.status === 'ledig' ? 0 : 22) * dt;
    if (v.rotor2) v.rotor2.rotation.x += (u.status === 'ledig' ? 0 : 30) * dt;
    if (v.halo) { v.halo.rotation.z += dt * 1.2; v.halo.material.opacity = 0.6 + 0.3 * Math.sin(t * 4); }
    v.pin.visible = !!((u.status !== 'ledig' && far > 62) || (R.sel && R.sel.type === 'unit' && R.sel.id === id)); R.pinAt(v.pin, px, 8 + alt, pz, pinPx.unit); v.pin.material.opacity = u.status === 'ledig' ? 0.85 : 1;
  }
  for (const id in S.incidents) { const inc = S.incidents[id]; if (inc.state !== 'ferdig' && inc.state !== 'feilet' && !V.incidents[id]) R.addIncidentView(inc); }
  for (const id in V.incidents) {
    const inc = S.incidents[id], v = V.incidents[id];
    if (!inc || inc.state === 'ferdig' || inc.state === 'feilet') { R.dyn.remove(v.grp); R.dyn.remove(v.spr); delete V.incidents[id]; continue; }
    const age = S.t - inc.t0, urg = clamp(age / Math.max(1, inc.target), 0, 2.5), pulse = 0.5 + 0.5 * Math.sin(t * (2.2 + urg * 1.6)), base = Math.max(16, 22 * mpp);
    v.grp.scale.setScalar(base * (1 + 0.5 * pulse)); v.ring.material.opacity = 0.9 - 0.55 * pulse;
    v.late.visible = !inc.onScene && age > inc.target; R.pinAt(v.spr, inc.loc.x, 14, inc.loc.z, pinPx.inc * (1 + 0.05 * pulse)); v.spr.material.opacity = inc.onScene ? 0.85 : 1;
  }
  for (const al of S.net.alarms) {
    if (al.done) continue; let r = V.alarms[al.id];
    if (!r) { r = V.alarms[al.id] = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 28), new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, depthTest: false })); r.rotation.x = -Math.PI / 2; r.renderOrder = 15; R.dyn.add(r); }
    const u = S.units[al.unitId]; if (u) r.position.set(u.x, 1, u.z); const p = (Math.sin(t * 9) + 1) / 2; r.scale.setScalar(Math.max(14, 20 * mpp) * (1 + p * 0.8)); r.material.opacity = 0.35 + 0.6 * p;
  }
  for (const id in V.alarms) if (!S.net.alarms.find(a => a.id == id && !a.done)) { R.dyn.remove(V.alarms[id]); delete V.alarms[id]; }
  // valgring og rute for valgt enhet
  const sel = R.sel; let sx = null, sz = null, selUnit = null;
  if (sel) {
    if (sel.type === 'unit' && S.units[sel.id]) { const u = S.units[sel.id]; sx = u.x; sz = u.z; selUnit = u; } else if (sel.type === 'incident' && S.incidents[sel.id]) { sx = S.incidents[sel.id].loc.x; sz = S.incidents[sel.id].loc.z; }
    else if (sel.type === 'station' && V.stations[sel.id]) { sx = V.stations[sel.id].lot.x; sz = V.stations[sel.id].lot.z; } else if (sel.type === 'mast' && masts[sel.id]) { sx = masts[sel.id].x; sz = masts[sel.id].z; } else if (sel.type === 'beach' && R.world.beaches[sel.id]) { sx = R.world.beaches[sel.id].x; sz = R.world.beaches[sel.id].z; }
  }
  if (!Game.place) { R.selRing.visible = sx != null; if (sx != null) { R.selRing.position.set(sx, 1, sz); R.selRing.scale.setScalar(Math.max(22, 30 * mpp) * (1 + 0.06 * Math.sin(t * 5))); } }
  const pl = R.pathLine; pl.visible = false;
  if (selUnit && selUnit.path && selUnit.path.length > selUnit.pi && selUnit.status !== 'ledig') {
    const a = pl.geometry.attributes.position; let n = 0; a.setXYZ(n++, selUnit.x, 1.5, selUnit.z);
    for (let i = selUnit.pi; i < selUnit.path.length && n < 399; i++) a.setXYZ(n++, selUnit.path[i].x, 1.5, selUnit.path[i].z);
    pl.geometry.setDrawRange(0, n); a.needsUpdate = true; pl.visible = n > 1;
  }
  if (R.placeRings && R.placeRings.count && R.placeMode && R.placeMode.lots) {
    const k = Math.max(16, 20 * mpp) * (1 + 0.12 * Math.sin(t * 5)), list = R.placeMode.lots;
    for (let i = 0; i < R.placeRings.count; i++) { _v3.set(list[i].x, 1.2, list[i].z); _q.setFromEuler(_e.set(-Math.PI / 2, 0, 0)); _s3.set(k, k, k); _m4.compose(_v3, _q, _s3); R.placeRings.setMatrixAt(i, _m4); }
    R.placeRings.instanceMatrix.needsUpdate = true; R.placeRings.material.opacity = 0.7 + 0.3 * Math.sin(t * 5);
  }
};

/* ---------- plukking (skjermavstand – god for fingre) ---------- */
R.pickList = function (S) {
  const out = [], w = R.world;
  if (R.placeMode) { if (R.placeMode.lots) for (const l of R.placeMode.lots) out.push({ type: 'lot', id: l.id, x: l.x, y: 2, z: l.z, wt: 1 }); return out; }
  for (const id in S.incidents) { const i = S.incidents[id]; if (i.state === 'ferdig' || i.state === 'feilet') continue; out.push({ type: 'incident', id, x: i.loc.x, y: 14 + 30 * R.mpp * 0.6, z: i.loc.z, wt: 0.7 }); }
  for (const id in S.units) { const u = S.units[id]; if (u.vis === false) continue; const p = u.contact === 'ingen' && u.lastKnown ? u.lastKnown : u; out.push({ type: 'unit', id, x: p.x, y: 6, z: p.z, wt: 1 }); }
  for (const id in S.stations) { const l = w.lotById.get(S.stations[id].lotId); out.push({ type: 'station', id, x: l.x, y: 10, z: l.z, wt: 1.1 }); }
  for (const id in S.net.masts) { const m = S.net.masts[id]; out.push({ type: 'mast', id, x: m.x, y: 25, z: m.z, wt: 1.2 }); }
  for (const id in w.beaches) { const b = w.beaches[id]; out.push({ type: 'beach', id, x: b.x, y: 6, z: b.z, wt: 1.3 }); }
  return out;
};
R.pick = function (px, py, touch, S) {
  const lim = (touch ? 38 : 22) * (R.placeMode ? 2 : 1); let best = null, bd = 1e9;
  for (const c of R.pickList(S)) { const s = R.screenOf(c.x, c.y, c.z); if (!s) continue; const d = Math.hypot(s.x - px, s.y - py) * c.wt; if (d < lim && d < bd) { bd = d; best = c; } }
  return best;
};
/* ---------- DOM-etiketter (stedsnavn og valgt objekt) ---------- */
R.labels = [];
R.setLabels = function (list) { // list: [{key,text,x,y,z,cls,minDist,maxDist}]
  const root = $('#labels'); const keep = new Set();
  for (const L of list) {
    keep.add(L.key);
    let el = R.labelEls && R.labelEls[L.key];
    if (!el) { R.labelEls = R.labelEls || {}; el = R.labelEls[L.key] = document.createElement('div'); root.appendChild(el); }
    el.className = 'wl ' + (L.cls || ''); if (el.textContent !== L.text) el.textContent = L.text; el._L = L;
  }
  for (const k in (R.labelEls || {})) if (!keep.has(k)) { R.labelEls[k].remove(); delete R.labelEls[k]; }
};
R.updateLabels = function () {
  if (!R.labelEls) return;
  for (const k in R.labelEls) {
    const el = R.labelEls[k], L = el._L, s = R.screenOf(L.x, L.y, L.z);
    const d = R.cam.dist, vis = s && (L.minDist == null || d >= L.minDist) && (L.maxDist == null || d <= L.maxDist);
    el.style.display = vis ? '' : 'none';
    if (vis) el.style.transform = 'translate(' + (s.x | 0) + 'px,' + (s.y | 0) + 'px) translate(-50%,-100%)';
  }
};


/* ---------- bildeloop (kalles fra spillløkken; selve tegningen skjer i kartets custom layer) ---------- */
R.frame = function (dt, simDt, S) {
  if (!R.ready || !R.world) return;
  R.time += dt; R.updateCam();
  R.waterTick(dt); R.updateTraffic(S ? simDt : dt * MIN_PER_SEC); City.frame(); R.followFrame(S, dt);
  R._bfx = (R._bfx || 0) + dt; if (R._bfx > 2) { R._bfx = 0; R.fixBeaches(); }
  if (S) R.sync(S, dt);
  R.fxUpdate(dt, S); R.glowFrame(S); R.updateLabels();
  R.map.triggerRepaint();
};
