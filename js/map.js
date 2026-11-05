'use strict';
/* ==========================================================================
   5. KART OG 3D-RENDERING
   MapLibre GL JS tegner kart og 3D-bygg (OpenFreeMap-fliser, egen pastellstil).
   Et Three.js «custom layer» tegner kjøretøy, stasjoner, master, hendelsesmarkører og effekter oppå kartet.
   ========================================================================== */
const _m4 = new THREE.Matrix4(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s3 = new THREE.Vector3(), _v4 = new THREE.Vector4();
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
  cam: { dist: 150, tx: 0, tz: 0, gdist: 150, gpitch: 0.9 }, mpp: 1, onTap: null, onHover: null, coverOn: false, insetR: 0, insetB: 0, placeMode: null, mvp: new THREE.Matrix4(), L: new THREE.Matrix4(), views: null, wxMode: '' };
R.mat = hex => R.mats['l' + hex] || (R.mats['l' + hex] = new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide }));
R.matB = hex => R.mats['b' + hex] || (R.mats['b' + hex] = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide }));
R.geo = (k, f) => R.geos[k] || (R.geos[k] = f());
R.box = (w, h, d, hex, x, y, z, basic) => { const m = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), basic ? R.matB(hex) : R.mat(hex)); m.scale.set(w, h, d); m.position.set(x || 0, y || 0, z || 0); return m; };

/** Kartstil i «organisk» pastellpalett. Bruker OpenMapTiles-skjemaet fra OpenFreeMap. offline = bare bakgrunn. */
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
    f('bld-low', 'building', 'fill-extrusion', ['<', ['coalesce', ['get', 'render_height'], 6], 14], ex('win-low'), { minzoom: 14 });
    f('bld-high', 'building', 'fill-extrusion', ['>=', ['coalesce', ['get', 'render_height'], 6], 14], ex('win-high'), { minzoom: 14 });
    const nm = ['coalesce', ['get', 'name:nb'], ['get', 'name']];
    layers.push({ id: 'water-name', type: 'symbol', source: 'om', 'source-layer': 'water_name', layout: { 'text-field': nm, 'text-font': ['Noto Sans Italic'], 'text-size': 12 }, paint: { 'text-color': '#5F8797', 'text-halo-color': '#F1EBD8', 'text-halo-width': 1 } });
    layers.push({ id: 'place', type: 'symbol', source: 'om', 'source-layer': 'place', filter: ['in', 'class', 'suburb', 'neighbourhood', 'quarter'], layout: { 'text-field': nm, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 }, paint: { 'text-color': '#7A8776', 'text-halo-color': '#F6F0E0', 'text-halo-width': 1.4 } });
    layers.push({ id: 'street-name', type: 'symbol', source: 'om', 'source-layer': 'transportation_name', minzoom: 15.5, layout: { 'text-field': nm, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'symbol-placement': 'line' }, paint: { 'text-color': '#7B7566', 'text-halo-color': '#FBF7EC', 'text-halo-width': 1.2 } });
  }
  const style = { version: 8, name: 'NødByen pastell', glyphs: GLYPHS, sources: offline ? {} : { om: { type: 'vector', url: TILE_URL, attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap' }, sat: { type: 'raster', tiles: [SAT_URL], tileSize: 256, maxzoom: 18, attribution: SAT_CREDIT } }, layers, light: { anchor: 'viewport', color: '#fff6e6', intensity: 0.38, position: [1.2, 200, 38] } };
  return style;
};
R.setSeason = function (si) {
  R.seasonIdx = si; const map = R.map; if (!map || !map.isStyleLoaded()) return; const P = SEASON_STYLE[si], set = (id, prop, v) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, v); };
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
R.makeWindows = function (name) {
  const hoy = name.indexOf('high') > 0, natt = /-n$/.test(name), S_ = 64, c = document.createElement('canvas'); c.width = c.height = S_; const x = c.getContext('2d');
  x.fillStyle = hoy ? '#CFD6D9' : natt ? '#CBB9A0' : '#EADBC1'; x.fillRect(0, 0, S_, S_);
  const cols = hoy ? 3 : 2, rows = hoy ? 4 : 2, cw = S_ / cols, rh = S_ / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const lit = natt && ((i * 7 + j * 5 + name.length) % 3 !== 0), px = i * cw + cw * 0.18, py = j * rh + rh * 0.2, w = cw * 0.64, h = rh * (hoy ? 0.56 : 0.6);
    x.fillStyle = lit ? '#FFD58A' : hoy ? '#6F8FA6' : '#7C93A3'; x.fillRect(px, py, w, h);
    x.fillStyle = lit ? 'rgba(255,240,200,.7)' : 'rgba(255,255,255,.28)'; x.fillRect(px, py, w, h * 0.3);
    x.fillStyle = 'rgba(80,70,60,.35)'; x.fillRect(px, py + h, w, 2);
  }
  const d = x.getImageData(0, 0, S_, S_); return { width: S_, height: S_, data: new Uint8Array(d.data.buffer) };
};


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
    if (RR.items.length > 6000) RR.items.splice(0, RR.items.length - 6000);
    if (RR.mesh) { R.scene.remove(RR.mesh); RR.mesh.dispose(); }
    const m = RR.mesh = new THREE.InstancedMesh(R.geo('gable', gableGeo), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), Math.max(1, RR.items.length)), col = new THREE.Color();
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
        R.mvp.fromArray(matrix).multiply(R.L); R.camera.projectionMatrix.copy(R.mvp); R.camera.projectionMatrixInverse.copy(R.mvp).invert();
        R.renderer.resetState(); R.renderer.render(R.scene, R.camera);
      }
    };
    map.on('styleimagemissing', e => { if (/^win-/.test(e.id) && !map.hasImage(e.id)) map.addImage(e.id, R.makeWindows(e.id), { pixelRatio: 2 }); });
    let done = false, errShown = false;
    map.on('error', e => { if (!errShown && e && e.error && /tile|fetch|Failed|NetworkError|AJAX/i.test(String(e.error.message || e.error))) { errShown = true; R.tileError = true; if (R.onTileError) R.onTileError(e.error); } });
    map.on('load', () => { map.addLayer(R.layer); R.ready = true; R.setBase(R.base || 'sat'); if (!done) { done = true; resolve(true); } });
    map.on('click', e => { if (R.onTap) R.onTap(e.point.x, e.point.y, !!(e.originalEvent && (e.originalEvent.pointerType === 'touch' || e.originalEvent.type === 'touchend'))); });
    map.on('resize', () => R.resize());
    let rt = 0; const roofSoon = () => { clearTimeout(rt); rt = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(() => R.updateRoofs(), { timeout: 1500 }) : R.updateRoofs()), 900); }; map.on('moveend', roofSoon);
    R.resize();
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 3500);
  });
};
R.resize = function () { if (!R.map) return; const c = R.map.getCanvas(); R.w = c.clientWidth || window.innerWidth; R.h = c.clientHeight || window.innerHeight; R.dpr = R.map.getPixelRatio ? R.map.getPixelRatio() : 1; };
R.setQuality = function (cap) { if (R.map) { R.map.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap)); R.resize(); } };
R.resize0 = null;
R.setPadding = function (right, bottom) { R.insetR = right; R.insetB = bottom; if (R.map) R.map.setPadding({ top: 0, left: 0, right, bottom }); };

/* ---------- verden: opprinnelse for lokale meterkoordinater, dekningslag, strender ---------- */
R.clearWorld = function () {
  R.clearRoofs();
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
  buildCoverage(); buildBeaches(); R.fxInit(); R.ensureOverlay();
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
  const inPoly = (ring, px, pz) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pz) !== (b[1] > pz) && px < (b[0] - a[0]) * (pz - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const dSeg = (px, pz, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1e-9, t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / L, 0, 1); return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t); };
  const ll = w.proj.toLL(x, z), pt = map.project([ll.lon, ll.lat]), box = [[pt.x - 80, pt.y - 80], [pt.x + 80, pt.y + 80]];
  for (const layer of ['building', 'water']) {
    let feats = []; try { feats = map.querySourceFeatures('om', { sourceLayer: layer }); } catch (e) { return false; }
    for (const f of feats) {
      const g = f.geometry; if (!g) continue; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; 
      for (const poly of polys) {
        const ring = poly[0].map(q => { const p = w.proj.toXZ(q[1], q[0]); return [p.x, p.z]; });
        let near = false; for (const q of ring) if (Math.abs(q[0] - x) < 200 && Math.abs(q[1] - z) < 200) { near = true; break; } if (!near && !inPoly(ring, x, z)) continue;
        if (inPoly(ring, x, z)) return true;
        if (layer === 'building') for (let i = 1; i < ring.length; i++) if (dSeg(x, z, ring[i - 1], ring[i]) < margin) return true;
      }
    }
  }
  return false;
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
    const b = R.world.beaches[id], grp = new THREE.Group(); grp.position.set(b.x, 0, b.z); g.add(grp);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(34, 28), new THREE.MeshBasicMaterial({ color: 0xEBD9A8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.6; grp.add(disc);
    const tw = new THREE.Group(); tw.scale.setScalar(5.5);
    for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) tw.add(R.box(0.1, 1.5, 0.1, 0xf2ece0, sx, 0.75, sz));
    tw.add(R.box(1.3, 0.14, 1.3, 0xd9c9a6, 0, 1.5, 0)); tw.add(R.box(1.1, 0.8, 1.1, 0xf2ece0, 0, 1.97, 0)); tw.add(R.box(1.45, 0.14, 1.45, 0xe5a267, 0, 2.5, 0)); tw.add(R.box(0.7, 0.34, 0.06, 0x7fa8b8, 0, 2.0, 0.56));
    const guard = new THREE.Group(); guard.position.set(0, 1.6, 0.3); guard.add(R.box(0.28, 0.5, 0.2, 0xe5a267, 0, 0.4, 0)); guard.visible = false; tw.add(guard); grp.add(tw);
    R.beachViews[id] = { guard, grp };
  }
}
R.setBeachSeason = function (summer) { R.summer = !!summer; };
R.setGuard = function (id, on) { const v = R.beachViews && R.beachViews[id]; if (v) v.guard.visible = !!on; };
/* ---------- ikon-sprites (pin) ---------- */
R.pinCache = {};
R.pinMat = function (iconName, bg, ring) {
  const key = iconName + bg + (ring || '');
  if (R.pinCache[key]) return R.pinCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  const draw = img => {
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(40,50,40,0.28)'; x.beginPath(); x.arc(64, 70, 52, 0, TAU); x.fill();
    x.fillStyle = bg; x.beginPath(); x.arc(64, 64, 52, 0, TAU); x.fill();
    x.lineWidth = 8; x.strokeStyle = ring || 'rgba(255,255,255,0.96)'; x.stroke();
    if (img) x.drawImage(img, 30, 30, 68, 68);
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
function stationModel(type) {
  const g = new THREE.Group(), T = ST[type];
  g.add(R.box(3.95, 0.16, 3.95, 0xe3dcc8, 0, 0.08, 0));
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
function mastModel(mobile) {
  const g = new THREE.Group(), H = mobile ? 4.6 : 7;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.2, H, 6), R.mat(0x9a96a8)); pole.position.y = H / 2; g.add(pole);
  for (const [y, w] of [[H * 0.78, 1.1], [H * 0.88, 0.85], [H * 0.97, 0.6]]) g.add(R.box(w, 0.1, 0.1, 0xa99bcb, 0, y, 0));
  for (const s of [-1, 1]) g.add(R.box(0.14, 0.7, 0.12, 0xcfc6e6, s * 0.58, H * 0.86, 0));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe8a0a0 })); beacon.position.y = H + 0.25; g.add(beacon);
  if (mobile) { g.add(R.box(1.6, 0.3, 1.0, 0x6b706d, 0, 0.2, 0)); g.add(R.box(0.3, 0.3, 0.3, 0x2f3331, -0.7, 0.05, 0.5)); g.add(R.box(0.3, 0.3, 0.3, 0x2f3331, 0.7, 0.05, 0.5)); }
  else g.add(R.box(1.2, 0.3, 1.2, 0x8a8f8c, 0, 0.15, 0));
  g.userData.beacon = beacon; return g;
}

/* ---------- modeller: kjøretøy ---------- */
const VCOL = {
  brann: { body: 0xc9785d, trim: 0xf2ece0 }, politi: { body: 0xeef1f4, trim: 0x6f8fb5 }, ambulanse: { body: 0xf3ecc8, trim: 0x98b889 },
  rk: { body: 0xd98a82, trim: 0xf6efe6 }, nf: { body: 0xc97c74, trim: 0xf0e2c8 }, strand: { body: 0xe5a267, trim: 0xf6efe6 }, bistand: { body: 0xc4cbc6, trim: 0x8fa0b0 }
};
function vehicleModel(type, org) {
  const T = UT[type], C = VCOL[org] || VCOL.bistand, g = new THREE.Group(), lights = [];
  const dark = 0x3a3f3d, glass = 0x7d97a6, blue = 0x73a8ff;
  const wheels = (L, Wd) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(R.box(0.2, 0.5, 0.55, 0x2f3331, sx * (Wd / 2 + 0.01), 0.26, sz * L * 0.32)); };
  const bar = (y, z, w) => { const a = R.box(0.34, 0.15, 0.22, blue, -w, y, z, true), b = R.box(0.34, 0.15, 0.22, blue, w, y, z, true); g.add(a, b); lights.push(a, b); };
  const head = (y, z, Wd) => { for (const sx of [-1, 1]) g.add(R.box(0.2, 0.14, 0.05, 0xfff3c4, sx * Wd * 0.3, y, z, true)); };
  switch (T.model) {
    case 'truck': case 'rescue':
      g.add(R.box(1.15, 0.3, 2.9, dark, 0, 0.32, 0)); wheels(2.9, 1.2);
      g.add(R.box(1.2, T.model === 'rescue' ? 1.0 : 0.85, 1.75, C.body, 0, 0.95, -0.5)); g.add(R.box(1.2, 0.92, 0.95, C.body, 0, 0.98, 0.98));
      g.add(R.box(1.0, 0.32, 0.06, glass, 0, 1.15, 1.47)); g.add(R.box(1.22, 0.1, 2.9, C.trim, 0, 0.62, 0)); g.add(R.box(1.22, 0.1, 1.76, C.trim, 0, 1.45, -0.5));
      if (T.model === 'rescue') g.add(R.box(0.7, 0.2, 1.1, 0x9aa09c, 0, 1.58, -0.5));
      bar(1.55, 1.0, 0.3); head(0.62, 1.48, 1.2); break;
    case 'tanker': {
      g.add(R.box(1.15, 0.3, 3.2, dark, 0, 0.32, 0)); wheels(3.2, 1.2);
      const tank = new THREE.Mesh(R.geo('cyl', () => new THREE.CylinderGeometry(0.58, 0.58, 1, 12)), R.mat(C.body)); tank.rotation.x = Math.PI / 2; tank.scale.set(1, 2.1, 1); tank.position.set(0, 1.0, -0.55); g.add(tank);
      g.add(R.box(1.2, 0.92, 0.95, C.body, 0, 0.98, 1.1)); g.add(R.box(1.0, 0.32, 0.06, glass, 0, 1.15, 1.59)); g.add(R.box(1.22, 0.1, 3.2, C.trim, 0, 0.62, 0));
      bar(1.55, 1.1, 0.3); head(0.62, 1.6, 1.2); break; }
    case 'ladder':
      g.add(R.box(1.15, 0.3, 3.8, dark, 0, 0.32, 0)); wheels(3.8, 1.2);
      g.add(R.box(1.2, 0.7, 2.4, C.body, 0, 0.85, -0.7)); g.add(R.box(1.2, 0.92, 0.95, C.body, 0, 0.98, 1.4)); g.add(R.box(1.0, 0.32, 0.06, glass, 0, 1.15, 1.89));
      g.add(R.box(0.28, 0.14, 3.6, 0xd7d3c8, 0, 1.45, -0.2)); g.add(R.box(0.1, 0.5, 0.1, 0xd7d3c8, 0, 1.25, -1.6));
      g.add(R.box(1.22, 0.1, 3.8, C.trim, 0, 0.62, 0)); bar(1.55, 1.4, 0.3); head(0.62, 1.9, 1.2); break;
    case 'van':
      g.add(R.box(1.1, 0.25, 2.3, dark, 0, 0.3, 0)); wheels(2.3, 1.15);
      g.add(R.box(1.12, 0.95, 2.2, C.body, 0, 0.95, -0.05)); g.add(R.box(1.0, 0.34, 0.06, glass, 0, 1.15, 1.07)); g.add(R.box(1.14, 0.12, 2.2, C.trim, 0, 0.68, -0.05));
      bar(1.5, 0.5, 0.28); head(0.55, 1.12, 1.1); break;
    case 'car': case 'suv': {
      const tall = T.model === 'suv';
      g.add(R.box(1.0, 0.25, 2.1, dark, 0, 0.3, 0)); wheels(2.1, 1.05);
      g.add(R.box(1.04, tall ? 0.6 : 0.46, 2.1, C.body, 0, tall ? 0.72 : 0.62, 0)); g.add(R.box(0.94, tall ? 0.45 : 0.4, 1.15, C.body, 0, tall ? 1.2 : 1.0, -0.1));
      g.add(R.box(0.96, 0.3, 0.05, glass, 0, tall ? 1.2 : 1.0, 0.5)); g.add(R.box(1.06, 0.14, 1.7, org === 'ambulanse' ? 0x98b889 : (T.stripe ? 0xe4c94e : C.trim), 0, 0.68, 0));
      bar(tall ? 1.48 : 1.26, -0.1, 0.25); head(0.6, 1.06, 1.0); break; }
    case 'armored':
      g.add(R.box(1.2, 0.28, 2.5, dark, 0, 0.32, 0)); wheels(2.5, 1.25); g.add(R.box(1.25, 1.1, 2.4, 0x46505e, 0, 1.0, 0)); g.add(R.box(1.0, 0.3, 0.06, 0x95a3b0, 0, 1.3, 1.2));
      bar(1.62, 0.8, 0.3); head(0.6, 1.2, 1.2); break;
    case 'ambulance':
      g.add(R.box(1.15, 0.28, 2.7, dark, 0, 0.32, 0)); wheels(2.7, 1.2);
      g.add(R.box(1.2, 1.1, 1.75, C.body, 0, 1.0, -0.4)); g.add(R.box(1.2, 0.85, 0.85, C.body, 0, 0.9, 1.0)); g.add(R.box(1.0, 0.3, 0.06, glass, 0, 1.1, 1.43));
      g.add(R.box(1.22, 0.18, 2.6, C.trim, 0, 0.85, 0)); g.add(R.box(1.22, 0.1, 2.6, org === 'ambulanse' ? 0xe4d65a : C.trim, 0, 0.6, 0));
      bar(1.62, 0.9, 0.3); head(0.6, 1.44, 1.2); break;
    case 'atv':
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(R.box(0.22, 0.4, 0.4, 0x2f3331, sx * 0.4, 0.22, sz * 0.5));
      g.add(R.box(0.7, 0.3, 1.5, C.body, 0, 0.5, 0)); g.add(R.box(0.5, 0.15, 0.6, 0x3a3f3d, 0, 0.72, -0.1)); g.add(R.box(0.7, 0.08, 0.1, 0x3a3f3d, 0, 0.8, 0.35)); bar(0.95, 0.35, 0.18); break;
    case 'trailer':
      g.add(R.box(1.0, 0.2, 1.8, dark, 0, 0.3, 0)); g.add(R.box(1.1, 1.0, 1.6, C.body, 0, 0.95, 0)); g.add(R.box(1.14, 0.1, 1.64, C.trim, 0, 1.5, 0)); wheels(1.8, 1.1); bar(1.62, 0.4, 0.25); break;
    case 'heli': {
      const body = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 10, 8)), R.mat(0xe9e4a8)); body.scale.set(0.62, 0.55, 1.2); body.position.y = 0.9; g.add(body);
      g.add(R.box(0.16, 0.16, 2.2, 0xe9e4a8, 0, 1.0, -1.9)); g.add(R.box(0.1, 0.55, 0.45, 0xb3be68, 0, 1.25, -2.9));
      g.add(R.box(0.5, 0.18, 0.2, glass, 0, 1.12, 0.95)); g.add(R.box(0.08, 0.1, 1.8, 0x5c615e, -0.55, 0.28, 0)); g.add(R.box(0.08, 0.1, 1.8, 0x5c615e, 0.55, 0.28, 0));
      const rotor = new THREE.Group(); rotor.position.y = 1.55; rotor.add(R.box(5.2, 0.05, 0.22, 0x555a58, 0, 0, 0), R.box(0.22, 0.05, 5.2, 0x555a58, 0, 0, 0)); g.add(rotor); g.userData.rotor = rotor;
      bar(1.5, 0.6, 0.3); break; }
    case 'foot': {
      g.add(R.box(0.34, 0.6, 0.24, 0xe5a267, 0, 0.55, 0)); const hd = new THREE.Mesh(R.geo('ico', () => new THREE.SphereGeometry(1, 10, 8)), R.mat(0xf0cfae)); hd.scale.setScalar(0.17); hd.position.y = 1.0; g.add(hd);
      g.add(R.box(0.1, 0.36, 0.1, 0x6b7a8a, -0.1, 0.18, 0)); g.add(R.box(0.1, 0.36, 0.1, 0x6b7a8a, 0.1, 0.18, 0)); break; }
    default: g.add(R.box(1, 0.8, 2, C.body, 0, 0.6, 0));
  }
  g.userData.lights = lights; return g;
}

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
  if (u >= 0 && u <= 1) { const a = u * Math.PI; R.sun.position.set(Math.cos(a) * 95, Math.sin(a) * 85 + 12, 45); } else R.sun.position.set(-60, 75, -35);
  const tw = Math.max(0, 1 - Math.abs(dl - 0.42) / 0.34), b = lerp(0.58, 1, smooth(0, 1, dl)) * (wet ? 0.92 : 1);
  R.map.getCanvas().style.filter = 'brightness(' + b.toFixed(3) + ') saturate(' + (lerp(0.75, 1, dl) * (wet ? 0.82 : 1)).toFixed(3) + ') sepia(' + (tw * 0.18).toFixed(3) + ') hue-rotate(' + (night * -12).toFixed(1) + 'deg)';
  const nightPat = night > 0.55 ? '-n' : ''; if (R.nightPat !== nightPat && R.map.getLayer('bld-low')) { R.nightPat = nightPat; R.map.setPaintProperty('bld-low', 'fill-extrusion-pattern', 'win-low' + nightPat); R.map.setPaintProperty('bld-high', 'fill-extrusion-pattern', 'win-high' + nightPat); }
  R.wxMode = wet ? (wx === 'storm' ? 'storm' : 'regn') : snow ? 'snø' : '';
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
  const lot = R.world.lotById.get(st.lotId), T = ST[st.type], grp = new THREE.Group(); const model = stationModel(st.type); grp.add(model); grp.scale.setScalar(SS); grp.rotation.y = lot.face || 0; grp.position.set(lot.x, 0, lot.z); R.dyn.add(grp);
  const pin = R.makePin(T.ikon, T.rolle === 'helse' ? '#8FB59A' : (AGENCIES[T.org] || AGENCIES.bistand).farge, 1); R.dyn.add(pin); R.views.stations[st.id] = { grp, pin, lot, h: (st.type === 'sykehus' ? 24 : 16) };
};
R.addMastView = function (m) {
  const g = mastModel(m.mobile); g.scale.setScalar(MS * (m.mobile ? 0.7 : 1)); g.position.set(m.x, 0, m.z); R.dyn.add(g);
  const pin = R.makePin('mast', '#A99BCB', 1); R.dyn.add(pin); R.views.masts[m.id] = { grp: g, pin, beacon: g.userData.beacon, h: (m.mobile ? 24 : 40) };
};
R.addUnitView = function (u) {
  const T = UT[u.type], org = u.org === 'bistand' ? 'bistand' : T.org, grp = new THREE.Group(), model = vehicleModel(u.type, org); grp.add(model); grp.scale.setScalar(VS);
  const col = (AGENCIES[org] || AGENCIES.bistand).farge, pin = R.makePin((AGENCIES[org] || AGENCIES.bistand).ikon, col, 1); let halo = null;
  if (org === 'rk' || org === 'nf' || org === 'strand') { halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.2; grp.add(halo); }
  R.dyn.add(grp); R.dyn.add(pin); R.views.units[u.id] = { grp, model, pin, halo, lights: model.userData.lights || [], rotor: model.userData.rotor, h: u.h || 0 };
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
  if (S) R.sync(S, dt);
  R.fxUpdate(dt, S); R.updateLabels();
  R.map.triggerRepaint();
};
