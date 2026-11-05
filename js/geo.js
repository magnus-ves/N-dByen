'use strict';
/* ==========================================================================
   4. KARTDATA OG VEINETT – projeksjon, veigraf fra OpenStreetMap (GeoJSON), A*-stifinning
   Veinettet hentes fra data/<by>-roads.geojson (laget av scripts/fetch-data.mjs fra Overpass).
   Mangler filen, hentes det direkte fra Overpass i nettleseren.
   Koordinatsystem i spillet: meter, x = øst, z = sør (z øker nordfra og sørover), y = opp.
   ========================================================================== */
const HW_MUL = { motorway: 1.45, motorway_link: 1.2, trunk: 1.4, trunk_link: 1.2, primary: 1.2, primary_link: 1.1, secondary: 1.05, secondary_link: 1.0, tertiary: 1.0, tertiary_link: 0.95, unclassified: 0.9, residential: 0.85, living_street: 0.6 };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

function makeProj(lat0, lon0) {
  const mLat = 111132, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return { lat0, lon0, mLat, mLon, toXZ: (lat, lon) => ({ x: (lon - lon0) * mLon, z: -(lat - lat0) * mLat }), toLL: (x, z) => ({ lat: lat0 - z / mLat, lon: lon0 + x / mLon }) };
}
/** Overpass-spørring: biler kan kjøre på alle klasser. Boligveier bare nær sentrum (holder datamengden nede). */
function overpassQuery(cfg, live) {
  const [w, s, e, n] = cfg.bbox, c = cfg.center;
  if (live) return '[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](around:' + (cfg.liveR || 2600) + ',' + c.lat + ',' + c.lon + ');out geom tags;';   // mindre utsnitt = raskere når data/ mangler
  return '[out:json][timeout:180];(' +
    'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](' + s + ',' + w + ',' + n + ',' + e + ');' +
    'way["highway"~"^(residential|living_street)$"](around:' + (cfg.innerR || 3000) + ',' + c.lat + ',' + c.lon + ');' +
    ');out geom tags;';
}
function overpassToGeoJSON(json) {
  const feats = [];
  for (const el of (json.elements || [])) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    feats.push({ type: 'Feature', properties: { highway: el.tags.highway, name: el.tags.name || el.tags.ref || '' }, geometry: { type: 'LineString', coordinates: el.geometry.map(g => [Math.round(g.lon * 1e6) / 1e6, Math.round(g.lat * 1e6) / 1e6]) } });
  }
  return { type: 'FeatureCollection', features: feats };
}
async function fetchOverpassLive(cfg) {
  // mellomlager i nettleseren (Cache Storage) så Overpass bare trengs første gang
  const ck = new Request(location.origin + '/__cache/overpass/' + cfg.id + '/v1');
  try { const c = await caches.open('nodbyen-data'), hit = await c.match(ck); if (hit) return await hit.json(); } catch (e) { /* ingen cache */ }
  if (cfg._opFail && Date.now() - cfg._opFail < 120000) throw new Error('Overpass utilgjengelig');   // ikke prøv på nytt rett etter feil
  const body = 'data=' + encodeURIComponent(overpassQuery(cfg, true));
  try {   // alle speil samtidig – første som svarer vinner
    const gj = await Promise.any(OVERPASS.map(async url => { const r = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined }); if (!r.ok) throw new Error('HTTP ' + r.status); return overpassToGeoJSON(await r.json()); }));
    try { (await caches.open('nodbyen-data')).put(ck, new Response(JSON.stringify(gj))); } catch (e) { /* ignorer */ }
    return gj;
  } catch (e) { cfg._opFail = Date.now(); throw new Error('Overpass utilgjengelig'); }
}
/* ---------- veinett fra OpenFreeMap-fliser (reserve når data/*.geojson mangler og Overpass er utilgjengelig) ----------
   Leser transportation-laget direkte fra vektorflisene (zoom 14) med en liten MVT-leser, uavhengig av hva kartet viser.
   Hver flis klippes til egen rute, og kryssinger i flisskjøtene slås sammen, så veinettet henger sammen over hele kartutsnittet. */
function pbfRead(u8, start, end, onField) {
  let p = start;
  const vi = () => { let r = 0, m = 1, b; do { b = u8[p++]; r += (b & 127) * m; m *= 128; } while ((b & 128) && p <= end); return r; };
  while (p < end) {
    const tag = vi(), f = Math.floor(tag / 8), w = tag & 7;
    if (w === 0) onField(f, w, vi());
    else if (w === 2) { const n = vi(); onField(f, w, p, p + n); p += n; }
    else if (w === 1) p += 8; else if (w === 5) p += 4; else throw new Error('Ugyldig kartflis');
  }
}
function pbfPacked(u8, s, e) { const out = []; let p = s; while (p < e) { let r = 0, m = 1, b; do { b = u8[p++]; r += (b & 127) * m; m *= 128; } while ((b & 128) && p <= e); out.push(r); } return out; }
const _utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
function pbfStr(u8, s, e) { return _utf8 ? _utf8.decode(u8.subarray(s, e)) : String.fromCharCode.apply(null, u8.subarray(s, e)); }
function mvtValue(u8, s, e) {
  let v = null;
  pbfRead(u8, s, e, (f, w, a, b) => { if (f === 1) v = pbfStr(u8, a, b); else if (f === 4 || f === 5) v = a; else if (f === 6) v = a % 2 ? -(a + 1) / 2 : a / 2; else if (f === 7) v = !!a; });
  return v;
}
/** Linjer i ønsket lag: [{p: {egenskaper}, lines: [[[x,y],…]]}] i flisens koordinater, pluss extent. */
function mvtLayerLines(buf, want) {
  const u8 = new Uint8Array(buf), res = { extent: 4096, feats: [] };
  pbfRead(u8, 0, u8.length, (f, w, s, e) => {
    if (f !== 3 || w !== 2) return;
    let name = '', extent = 4096; const keys = [], vals = [], fe = [];
    pbfRead(u8, s, e, (f2, w2, a, b) => { if (f2 === 1) name = pbfStr(u8, a, b); else if (f2 === 2) fe.push([a, b]); else if (f2 === 3) keys.push(pbfStr(u8, a, b)); else if (f2 === 4) vals.push(mvtValue(u8, a, b)); else if (f2 === 5) extent = a; });
    if (name !== want) return;
    res.extent = extent;
    for (const [fs, fend] of fe) {
      let type = 0, tags = [], geom = [];
      pbfRead(u8, fs, fend, (f3, w3, a, b) => { if (f3 === 3) type = a; else if (f3 === 2 && w3 === 2) tags = pbfPacked(u8, a, b); else if (f3 === 4 && w3 === 2) geom = pbfPacked(u8, a, b); });
      if (type !== 2) continue;                                   // bare linjer
      const props = {}; for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      const lines = []; let cur = null, x = 0, y = 0, i = 0;
      while (i < geom.length) {
        const c = geom[i++], cmd = c & 7, n = Math.floor(c / 8);
        for (let k = 0; k < n; k++) {
          if (cmd === 1 || cmd === 2) { const dx = geom[i++], dy = geom[i++]; x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1); if (cmd === 1) { cur = [[x, y]]; lines.push(cur); } else if (cur) cur.push([x, y]); }
        }
      }
      res.feats.push({ p: props, lines });
    }
  });
  return res;
}
/** Klipper en polylinje til flisens rute [0,E]² (Liang–Barsky). Returnerer delstrekk. */
function clipLineToTile(line, E) {
  const out = []; let cur = null;
  for (let i = 1; i < line.length; i++) {
    const ax = line[i - 1][0], ay = line[i - 1][1], bx = line[i][0], by = line[i][1], dx = bx - ax, dy = by - ay, P = [-dx, dx, -dy, dy], Q = [ax, E - ax, ay, E - ay];
    let t0 = 0, t1 = 1, ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      if (P[k] === 0) { if (Q[k] < 0) ok = false; }
      else { const t = Q[k] / P[k]; if (P[k] < 0) { if (t > t1) ok = false; else if (t > t0) t0 = t; } else { if (t < t0) ok = false; else if (t < t1) t1 = t; } }
    }
    if (!ok) { cur = null; continue; }
    const snap = v => (Math.abs(v) < 1e-6 ? 0 : Math.abs(v - E) < 1e-6 ? E : v);
    const p0 = [snap(ax + dx * t0), snap(ay + dy * t0)], p1 = [snap(ax + dx * t1), snap(ay + dy * t1)];
    if (!cur) { cur = [p0]; out.push(cur); }
    cur.push(p1);
    if (t1 < 1) cur = null;
  }
  return out;
}
/** Kobler sammen veier fra fliser. Flisene forenkler bort kryssnoder på rette strekninger, så (1) hjørner og endepunkter som ligger inntil en annen vei festes til den,
 *  og (2) veier som krysser hverandre får et felles knutepunkt (ikke bruer/tunneler). Koordinater i flisenheter (≈ 0,3 m). */
function planarizeLines(lines, TOL) {
  const C = 48, cellKey = (cx, cy) => cx * 1e7 + cy;
  const grid = () => {
    const g = new Map();
    lines.forEach((L, li) => { const p = L.pts; for (let i = 1; i < p.length; i++) {
      const x0 = Math.floor(Math.min(p[i - 1][0], p[i][0]) / C), x1 = Math.floor(Math.max(p[i - 1][0], p[i][0]) / C), y0 = Math.floor(Math.min(p[i - 1][1], p[i][1]) / C), y1 = Math.floor(Math.max(p[i - 1][1], p[i][1]) / C);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const k = cellKey(cx, cy); let a = g.get(k); if (!a) g.set(k, a = []); a.push(li, i - 1); }
    } });
    return g;
  };
  const applyCuts = cuts => {   // cuts: Map lineIndex → [{sj, t, p}]; p settes inn som felles punkt (samme array-objekt i begge veiene)
    for (const [li, arr] of cuts) {
      arr.sort((a, b) => a.sj - b.sj || a.t - b.t); const old = lines[li].pts, np = []; let ci = 0;
      for (let i = 0; i < old.length; i++) {
        np.push(old[i]);
        while (ci < arr.length && arr[ci].sj === i) {
          const q = arr[ci++].p, last = np[np.length - 1], nxt = old[i + 1];
          if (q === last || (nxt && q === nxt)) continue;
          if (Math.hypot(q[0] - last[0], q[1] - last[1]) <= 0.4) { q[0] = last[0]; q[1] = last[1]; continue; }
          if (nxt && Math.hypot(q[0] - nxt[0], q[1] - nxt[1]) <= 0.4) { q[0] = nxt[0]; q[1] = nxt[1]; continue; }
          np.push(q);
        }
      }
      lines[li].pts = np;
    }
  };
  const addCut = (cuts, li, sj, t, p) => { let a = cuts.get(li); if (!a) cuts.set(li, a = []); a.push({ sj, t, p }); };
  const r2 = v => Math.round(v * 100) / 100;
  // 1) hjørner/endepunkter som ligger inntil en annen vei
  { const g = grid(), cuts = new Map(), vk = q => q[0].toFixed(1) + ',' + q[1].toFixed(1), cnt = new Map();
    for (const L of lines) for (const q of L.pts) cnt.set(vk(q), (cnt.get(vk(q)) || 0) + 1);
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li], pts = L.pts;
      for (let k = 0; k < pts.length; k++) {
        const end = k === 0 || k === pts.length - 1; if (L.br && !end) continue;
        const V = pts[k]; if (cnt.get(vk(V)) > 1) continue;
        const cx = Math.floor(V[0] / C), cy = Math.floor(V[1] / C); let best = null, bd = TOL;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const a = g.get(cellKey(cx + dx, cy + dy)); if (!a) continue;
          for (let m = 0; m < a.length; m += 2) {
            const lj = a[m], sj = a[m + 1]; if (lj === li) continue; const T = lines[lj].pts, A = T[sj], B = T[sj + 1]; if (!B) continue;
            const abx = B[0] - A[0], aby = B[1] - A[1], L2 = abx * abx + aby * aby || 1e-9; let t = ((V[0] - A[0]) * abx + (V[1] - A[1]) * aby) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = A[0] + abx * t, py = A[1] + aby * t, d = Math.hypot(V[0] - px, V[1] - py);
            if (d < bd) { bd = d; best = { lj, sj, t, px, py, A, B }; }
          }
        }
        if (!best) continue;
        const dA = Math.hypot(best.px - best.A[0], best.py - best.A[1]), dB = Math.hypot(best.px - best.B[0], best.py - best.B[1]);
        if (dA <= TOL) { V[0] = best.A[0]; V[1] = best.A[1]; }
        else if (dB <= TOL) { V[0] = best.B[0]; V[1] = best.B[1]; }
        else if (!lines[best.lj].br) { V[0] = r2(best.px); V[1] = r2(best.py); addCut(cuts, best.lj, best.sj, best.t, V); }
      }
    }
    applyCuts(cuts); }
  // 2) kryssende veier uten felles node
  { const g = grid(), cuts = new Map();
    for (const [key, a] of g) {
      const cy = key % 1e7, cx = (key - cy) / 1e7;
      for (let m = 0; m < a.length; m += 2) for (let n = m + 2; n < a.length; n += 2) {
        const la = a[m], sa = a[m + 1], lb = a[n], sb = a[n + 1]; if (la === lb || lines[la].br || lines[lb].br) continue;
        const A = lines[la].pts[sa], B = lines[la].pts[sa + 1], Cc = lines[lb].pts[sb], D = lines[lb].pts[sb + 1]; if (!B || !D) continue;
        const r0 = B[0] - A[0], r1 = B[1] - A[1], s0 = D[0] - Cc[0], s1 = D[1] - Cc[1], den = r0 * s1 - r1 * s0; if (Math.abs(den) < 1e-9) continue;
        const qx = Cc[0] - A[0], qy = Cc[1] - A[1], u = (qx * s1 - qy * s0) / den, v = (qx * r1 - qy * r0) / den; if (u <= 1e-6 || u >= 1 - 1e-6 || v <= 1e-6 || v >= 1 - 1e-6) continue;
        const px = r2(A[0] + r0 * u), py = r2(A[1] + r1 * u); if (Math.floor(px / C) !== cx || Math.floor(py / C) !== cy) continue;   // behandles bare i cellen punktet ligger i
        const P = [px, py]; addCut(cuts, la, sa, u, P); addCut(cuts, lb, sb, v, P);
      }
    }
    applyCuts(cuts); }
}
const OMT_HW = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential' };
/** Veier fra OpenFreeMap-fliser som GeoJSON (samme form som overpassToGeoJSON). fetchFn/tileJsonUrl kan overstyres (brukes av scriptet og testene). */
async function roadsFromVectorTiles(cfg, opts) {
  opts = opts || {};
  const fetchFn = opts.fetch || fetch, tj = opts.tileJson || (typeof TILE_URL !== 'undefined' ? TILE_URL : 'https://tiles.openfreemap.org/planet');
  const tilejson = await (await fetchFn(tj, { signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined })).json();
  const tpl = tilejson.tiles && tilejson.tiles[0]; if (!tpl) throw new Error('Fant ikke flis-adressen');
  const Z = 14, N = Math.pow(2, Z), [w, s, e, n] = cfg.bbox, rad = Math.PI / 180;
  const tx = lon => Math.floor((lon + 180) / 360 * N), ty = lat => Math.floor((1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * N);
  const x0 = tx(w), x1 = tx(e), y0 = ty(n), y1 = ty(s), jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  const seams = new Map(), raw = []; let failed = 0, done = 0;
  const addSeam = (pt, key, along) => { let a = seams.get(key); if (!a) seams.set(key, a = []); a.push({ pt, along }); };
  async function one(x, y) {
    try {
      const r = await fetchFn(tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
      if (r.status === 404 || r.status === 204) return; if (!r.ok) throw new Error('HTTP ' + r.status);
      const L = mvtLayerLines(await r.arrayBuffer(), 'transportation'), E = L.extent;
      for (const f of L.feats) {
        const hw = OMT_HW[f.p.class]; if (!hw || f.p.class === 'minor' && f.p.subclass === 'pedestrian') continue;
        const hwx = f.p.ramp ? (hw === 'residential' ? hw : hw + '_link') : hw === 'residential' && f.p.subclass === 'living_street' ? 'living_street' : hw;
        for (const ln of f.lines) for (const sub of clipLineToTile(ln, E)) {
          if (sub.length < 2) continue;
          const pts = sub.map(q => [x * E + q[0], y * E + q[1]]);
          raw.push({ hw: hwx, name: f.p['name:nb'] || f.p.name || f.p.ref || '', br: f.p.brunnel === 'bridge' || f.p.brunnel === 'tunnel', pts });
          for (const end of [0, sub.length - 1]) { const q = sub[end], pt = pts[end]; if (q[0] === 0) addSeam(pt, 'V' + (x * E), 1); else if (q[0] === E) addSeam(pt, 'V' + ((x + 1) * E), 1); else if (q[1] === 0) addSeam(pt, 'H' + (y * E), 0); else if (q[1] === E) addSeam(pt, 'H' + ((y + 1) * E), 0); }
        }
      }
    } catch (err) { failed++; opts.log && opts.log('flis ' + x + '/' + y + ': ' + err.message); }
    done++; if (opts.progress) opts.progress(done, jobs.length);
  }
  let next = 0; await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, async () => { while (next < jobs.length) { const j = jobs[next++]; await one(j[0], j[1]); } }));
  if (failed > jobs.length * 0.3) throw new Error('Fikk ikke hentet kartfliser (' + failed + ' av ' + jobs.length + ' feilet)');
  // slå sammen punkter som møtes i flisskjøtene (samme vei klippet i to fliser, ≤ 3 enheter fra hverandre)
  for (const arr of seams.values()) {
    const ai = arr[0].along, key = o => o.pt[ai];   // langs skjøten: y for vertikal skjøt, x for horisontal
    arr.sort((a, b) => key(a) - key(b));
    for (let i = 0; i < arr.length;) {
      let j = i + 1, sum = key(arr[i]); while (j < arr.length && key(arr[j]) - key(arr[j - 1]) <= 3) { sum += key(arr[j]); j++; }
      const m = Math.round(sum / (j - i) * 100) / 100; for (let k = i; k < j; k++) arr[k].pt[ai] = m; i = j;
    }
  }
  planarizeLines(raw, 6);
  const W = 4096 * N, toLL = q => [Math.round((q[0] / W * 360 - 180) * 1e6) / 1e6, Math.round(Math.atan(Math.sinh(Math.PI * (1 - 2 * q[1] / W))) / rad * 1e6) / 1e6];
  const c = cfg.center, mLat = 111132, mLon = 111320 * Math.cos(c.lat * rad), feats = [];
  for (const r of raw) {
    const co = r.pts.map(toLL).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]); if (co.length < 2) continue;
    if (r.hw === 'residential' || r.hw === 'living_street') { const m = co[co.length >> 1]; if (Math.hypot((m[0] - c.lon) * mLon, (m[1] - c.lat) * mLat) > (cfg.innerR || 3200) * 1.15) continue; }   // boligveier bare nær sentrum (som Overpass-spørringen)
    feats.push({ type: 'Feature', properties: { highway: r.hw, name: r.name }, geometry: { type: 'LineString', coordinates: co } });
  }
  if (feats.length < 30) throw new Error('For få veier i kartflisene');
  return { type: 'FeatureCollection', features: feats };
}
/** Henter veier fra fliser med mellomlager i nettleseren (Cache Storage). */
async function roadsFromTiles(cfg) {
  const ck = new Request(location.origin + '/__cache/tiles/' + cfg.id + '/v1');
  try { const c = await caches.open('nodbyen-data'), hit = await c.match(ck); if (hit) return await hit.json(); } catch (e) { /* ingen cache */ }
  const gj = await roadsFromVectorTiles(cfg, { progress: (d, t) => { const m = document.querySelector('#screens .logo p'); if (m) m.textContent = 'Henter veier fra kartfliser ' + d + '/' + t + ' …'; } });
  try { (await caches.open('nodbyen-data')).put(ck, new Response(JSON.stringify(gj))); } catch (e) { /* ignorer */ }
  return gj;
}
async function loadRoadData(cfg) {
  try { const r = await fetch(cfg.roads, { cache: 'force-cache' }); if (r.ok) { const j = await r.json(); if (j.features && j.features.length) return { gj: j, kilde: 'fil' }; } } catch (e) { /* prøv fliser */ }
  const why = [];
  try { return { gj: await roadsFromTiles(cfg), kilde: 'kartfliser' }; } catch (e) { why.push('kartfliser: ' + e.message); console.info('[NødByen] veier fra kartfliser feilet:', e.message); }
  try { return { gj: await fetchOverpassLive(cfg), kilde: 'overpass' }; } catch (e) { why.push('Overpass: ' + e.message); }
  console.warn('[NødByen] ingen veidata tilgjengelig – bruker et generert gatenett', why);
  return { gj: gridRoads(cfg), kilde: 'generert', why };
}
/** Siste utvei når ingen veidata kan hentes: enkelt rutenett rundt sentrum, så spillet alltid kan spilles. */
function gridRoads(cfg) {
  const pr = makeProj(cfg.center.lat, cfg.center.lon), R_ = 3000, st = 150, feats = [], ll = (x, z) => { const q = pr.toLL(x, z); return [Math.round(q.lon * 1e6) / 1e6, Math.round(q.lat * 1e6) / 1e6]; };
  for (let k = -R_; k <= R_; k += st) {
    const hw = Math.abs(k / st) % 4 === 0 ? 'secondary' : 'residential', a = [], b = [];
    for (let m = -R_; m <= R_; m += st) { a.push(ll(m, k)); b.push(ll(k, m)); }
    feats.push({ type: 'Feature', properties: { highway: hw, name: 'Gate ' + (k / st + 21) }, geometry: { type: 'LineString', coordinates: a } });
    feats.push({ type: 'Feature', properties: { highway: hw, name: 'Allé ' + (k / st + 21) }, geometry: { type: 'LineString', coordinates: b } });
  }
  return { type: 'FeatureCollection', features: feats };
}
function _unused() {
  throw new Error('fant ingen data/' + cfg.id + '-roads.geojson, og henting fra kartfliser og Overpass feilet (' + why.join('; ') + ')');
}
async function loadSites(cfg) {
  try { const r = await fetch(cfg.sitesFile); if (r.ok) return (await r.json()).features || []; } catch (e) { /* bruker config */ }
  return [];
}

/* ---------- geometri-hjelpere ---------- */
function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const ax = pts[a][0], az = pts[a][1], dx = pts[b][0] - ax, dz = pts[b][1] - az, L = Math.hypot(dx, dz) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length; if (!n) return top;
    let i = 0; while (true) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
    k[i] = lk; v[i] = lv; return top;
  }
}

/* ---------- veigraf: knutepunkter ved kryss, kanter med polylinje-geometri ---------- */
function buildRoadGraph(feats, proj) {
  const key = c => Math.round(c[0] * 1e6) * 1e8 + Math.round(c[1] * 1e6), ways = [], cnt = new Map();   // numerisk nøkkel (raskere enn tekst)
  for (const f of feats) {
    if (!f.geometry || f.geometry.type !== 'LineString') continue;
    const hw = f.properties && f.properties.highway; if (!HW_MUL[hw] || f.geometry.coordinates.length < 2) continue;
    const pts = f.geometry.coordinates.map(c => { const p = proj.toXZ(c[1], c[0]); return { x: p.x, z: p.z, k: key(c) }; });
    ways.push({ hw, name: (f.properties.name || '').trim(), pts });
    pts.forEach((p, i) => cnt.set(p.k, (cnt.get(p.k) || 0) + (i === 0 || i === pts.length - 1 ? 2 : 1)));
  }
  const idx = new Map(), nodes = [], edges = [], adj = [];
  const nodeOf = p => { let i = idx.get(p.k); if (i === undefined) { i = nodes.length; nodes.push({ id: i, x: p.x, z: p.z, deg: 0 }); adj.push([]); idx.set(p.k, i); } return i; };
  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.pts.length; i++) {
      if (cnt.get(w.pts[i].k) >= 2 || i === w.pts.length - 1) {
        const seg = w.pts.slice(start, i + 1); start = i;
        const a = nodeOf(seg[0]), b = nodeOf(seg[seg.length - 1]); if (a === b) continue;
        const geom = simplifyLine(seg.map(p => [p.x, p.z]), 2.5), cum = [0];
        for (let q = 1; q < geom.length; q++) cum.push(cum[q - 1] + Math.hypot(geom[q][0] - geom[q - 1][0], geom[q][1] - geom[q - 1][1]));
        const len = cum[cum.length - 1]; if (len < 0.5) continue;
        const e = { id: edges.length, a, b, geom, cum, len, kind: 'vei', hw: w.hw, name: w.name, mul: HW_MUL[w.hw] };
        edges.push(e); adj[a].push({ to: b, edge: e }); adj[b].push({ to: a, edge: e }); nodes[a].deg++; nodes[b].deg++;
      }
    }
  }
  return { nodes, edges, adj };
}

/* ---------- navigasjon: veipunkt = {a, b, t, e}; t = andel av kantlengden fra a mot b ---------- */
function makeNav(world) {
  const { nodes, edges, adj } = world, N = nodes.length;
  const g = new Float32Array(N), prev = new Int32Array(N), closed = new Uint8Array(N), emap = new Map();
  for (const e of edges) { const k = e.a < e.b ? e.a * N + e.b : e.b * N + e.a, o = emap.get(k); if (!o || e.len < o.len) emap.set(k, e); }
  const edgeOf = (a, b) => emap.get(a < b ? a * N + b : b * N + a) || null;
  const edgeFor = rp => (rp.e != null ? edges[rp.e] : edgeOf(rp.a, rp.b));
  function pointAt(e, s) {
    s = clamp(s, 0, e.len); const c = e.cum; let i = 1; while (i < c.length - 1 && c[i] < s) i++;
    const f = (s - c[i - 1]) / Math.max(1e-9, c[i] - c[i - 1]); return [lerp(e.geom[i - 1][0], e.geom[i][0], f), lerp(e.geom[i - 1][1], e.geom[i][1], f)];
  }
  const sOf = (e, rp) => (rp.a === e.a ? rp.t : 1 - rp.t) * e.len;
  function rpXZ(rp) {
    if (rp.a === rp.b && rp.e == null) return { x: nodes[rp.a].x, z: nodes[rp.a].z };
    const e = edgeFor(rp), p = pointAt(e, sOf(e, rp)); return { x: p[0], z: p[1] };
  }
  /** Retning (enhetsvektor) langs veien i veipunktet. */
  function dirAt(rp) {
    const e = edgeFor(rp); if (!e) return [1, 0]; const s = sOf(e, rp), p = pointAt(e, Math.max(0, s - 3)), q = pointAt(e, Math.min(e.len, s + 3)), d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
  }
  function slice(e, s0, s1) {
    const out = [], c = e.cum;
    if (s1 >= s0) { for (let i = 0; i < e.geom.length; i++) if (c[i] > s0 + 1e-6 && c[i] < s1 - 1e-6) out.push(e.geom[i]); }
    else for (let i = e.geom.length - 1; i >= 0; i--) if (c[i] < s0 - 1e-6 && c[i] > s1 + 1e-6) out.push(e.geom[i]);
    out.push(pointAt(e, s1)); return out;
  }
  function ends(rp) {
    if (rp.a === rp.b && rp.e == null) return { e: null, s: 0, list: [{ n: rp.a, c: 0 }] };
    const e = edgeFor(rp), s = sOf(e, rp); return { e, s, list: [{ n: e.a, c: s / e.mul }, { n: e.b, c: (e.len - s) / e.mul }] };
  }
  /** A* mellom to veipunkter. Returnerer {pts:[{x,z,m}], cost} der cost er «meter ved fart 1». */
  function route(P, Q) {
    const S = ends(P), G = ends(Q), qq = rpXZ(Q);
    if (S.e && G.e && S.e === G.e) { return { pts: slice(S.e, S.s, G.s).map(p => ({ x: p[0], z: p[1], m: S.e.mul })), cost: Math.abs(S.s - G.s) / S.e.mul, ok: true }; }
    g.fill(1e12); prev.fill(-1); closed.fill(0);
    const goal = new Map(); for (const x of G.list) goal.set(x.n, x.c);
    const heap = new MinHeap(), h = n => Math.hypot(nodes[n].x - qq.x, nodes[n].z - qq.z) / 1.5;
    for (const s of S.list) if (s.c < g[s.n]) { g[s.n] = s.c; heap.push(s.c + h(s.n), s.n); }
    let best = 1e12, bn = -1;
    while (heap.size) {
      const f = heap.k[0], n = heap.pop(); if (f >= best) break; if (closed[n]) continue; closed[n] = 1;
      if (goal.has(n)) { const tot = g[n] + goal.get(n); if (tot < best) { best = tot; bn = n; } }
      const al = adj[n];
      for (let k = 0; k < al.length; k++) { const to = al[k].to, e = al[k].edge; if (closed[to]) continue; const c = g[n] + e.len / e.mul; if (c < g[to]) { g[to] = c; prev[to] = n; heap.push(c + h(to), to); } }
    }
    if (bn < 0) return { pts: [], cost: Infinity, ok: false };
    const seq = []; for (let n = bn; n !== -1; n = prev[n]) seq.push(n); seq.reverse();
    const pts = [], add = (arr, m) => { for (const p of arr) pts.push({ x: p[0], z: p[1], m }); };
    if (S.e) add(slice(S.e, S.s, seq[0] === S.e.a ? 0 : S.e.len), S.e.mul);
    for (let k = 1; k < seq.length; k++) { const u = seq[k - 1], v = seq[k]; let e = null, bl = 1e12; for (const a of adj[u]) if (a.to === v && a.edge.len / a.edge.mul < bl) { bl = a.edge.len / a.edge.mul; e = a.edge; } add(slice(e, u === e.a ? 0 : e.len, u === e.a ? e.len : 0), e.mul); }
    if (G.e) add(slice(G.e, seq[seq.length - 1] === G.e.a ? 0 : G.e.len, G.s), G.e.mul);
    return { pts, cost: best, ok: true };
  }
  /* romlig indeks for nærmeste vei */
  const CS = 150, grid = new Map(), gk = (i, j) => i * 100003 + j;
  for (const e of edges) {
    const seen = new Set();
    for (let q = 0; q < e.geom.length; q++) { const g0 = e.geom[q], i = Math.floor(g0[0] / CS), j = Math.floor(g0[1] / CS), k = gk(i, j); if (!seen.has(k)) { seen.add(k); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(e); } }
    for (let s = 60; s < e.len; s += 60) { const p = pointAt(e, s), i = Math.floor(p[0] / CS), j = Math.floor(p[1] / CS), k = gk(i, j); if (!seen.has(k)) { seen.add(k); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(e); } }
  }
  function nearestRP(x, z, mainOnly) {
    const ci = Math.floor(x / CS), cj = Math.floor(z / CS); let best = null, bd = 1e12;
    for (let r = 0; r < 40; r++) {
      if (best && (r - 1) * CS > bd) break;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const a = grid.get(gk(i, j)); if (!a) continue;
        for (const e of a) {
          if (mainOnly && world.comp[e.a] !== world.mainComp) continue;
          for (let q = 1; q < e.geom.length; q++) {
            const ax = e.geom[q - 1][0], az = e.geom[q - 1][1], dx = e.geom[q][0] - ax, dz = e.geom[q][1] - az, L2 = dx * dx + dz * dz || 1e-9;
            const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
            if (d < bd) { bd = d; best = { a: e.a, b: e.b, e: e.id, t: clamp((e.cum[q - 1] + Math.sqrt(L2) * t) / e.len, 0.02, 0.98), dist: d }; }
          }
        }
      }
    }
    return best;
  }
  return { rpXZ, dirAt, route, nearestRP, edgeOf, edgeFor, pointAt, hasRoute: (P, Q) => route(P, Q).ok };
}

/* ---------- verden: veinett + steder (tomter), strender, master, byområder ---------- */
function buildWorld(cfg, roadGJ, siteFeats) {
  const proj = makeProj(cfg.center.lat, cfg.center.lon), rnd = mulberry32(cfg.seed);
  const gr = buildRoadGraph(roadGJ.features, proj);
  if (gr.edges.length < 20) throw new Error('veinettet er tomt eller for lite (' + gr.edges.length + ' strekninger)');
  const world = { cfg, proj, nodes: gr.nodes, edges: gr.edges, adj: gr.adj, NN: gr.nodes.length };
  // sammenhengende komponenter – største er «hovednettet»
  const comp = new Int32Array(world.NN).fill(-1), sizes = []; let nc = 0;
  for (let s = 0; s < world.NN; s++) {
    if (comp[s] !== -1) continue; let n = 0; const st = [s]; comp[s] = nc;
    while (st.length) { const u = st.pop(); n++; for (const { to } of world.adj[u]) if (comp[to] === -1) { comp[to] = nc; st.push(to); } }
    sizes.push(n); nc++;
  }
  world.comp = comp; world.mainComp = sizes.indexOf(Math.max(...sizes));
  const nav = world.nav = makeNav(world);
  const [w0, s0, e0, n0] = cfg.bbox, a = proj.toXZ(n0, w0), b = proj.toXZ(s0, e0);
  world.X0 = a.x; world.Z0 = a.z; world.X1 = b.x; world.Z1 = b.z;
  world.heightAt = () => 0; world.surfaceY = () => 0;
  world.landAt = (x, z) => { const r = nav.nearestRP(x, z, true); return !!r && r.dist < 400; };
  const dens = (x, z) => clamp(1 - Math.hypot(x, z) / cfg.downtownR, 0, 1);
  world.dens = dens;
  for (const e of world.edges) { const p = e.geom[e.geom.length >> 1]; e.dens = dens(p[0], p[1]); }
  const main = world.edges.filter(e => comp[e.a] === world.mainComp);
  if (main.length < 20) throw new Error('veinettet henger ikke sammen (største del har bare ' + main.length + ' strekninger)');
  // adresse = gatenavn + husnummer (utledet fra posisjon langs gata)
  world.addrOf = (rp, side) => { const e = nav.edgeFor(rp); if (!e) return 'Ukjent veg'; const s = (rp.a === e.a ? rp.t : 1 - rp.t) * e.len; return (e.name || 'Veien') + ' ' + (2 * Math.floor(s / 14) + 1 + (side ? 1 : 0)); };
  world.streetOf = rp => { const e = nav.edgeFor(rp); return e && e.name ? e.name : 'Veien'; };

  /* tomter: navngitte steder (data eller config) + jevnt fordelte generiske tomter */
  const lots = [], lotById = new Map(), taken = []; let lotSeq = 0, dynSeq = 0;
  const addLot = (o) => {
    { const rr_ = nav.nearestRP(o.x, o.z, true); if (!rr_ || (o.real && rr_.dist > 400)) return null; }
    const lot = Object.assign({ id: 'l' + (lotSeq++), kind: 'tomt', free: true, floors: 0 }, o);
    const r = nav.nearestRP(lot.x, lot.z, true); lot.rp = { a: r.a, b: r.b, e: r.e, t: r.t }; lot.snap = r.dist;
    const rx = nav.rpXZ(lot.rp), dx = rx.x - lot.x, dz = rx.z - lot.z; lot.face = Math.atan2(dx, dz);
    lot.addr = lot.addr || world.addrOf(lot.rp, lot.x > rx.x ? 1 : 0); lot.dens = dens(lot.x, lot.z);
    lot.floors = lot.dens > 0.7 ? 8 : lot.dens > 0.4 ? 5 : lot.dens > 0.2 ? 3 : 2;
    lots.push(lot); lotById.set(lot.id, lot); taken.push([lot.x, lot.z]); return lot;
  };
  const siteList = siteFeats.length ? siteFeats.filter(f => f.geometry && f.geometry.type === 'Point').map(f => ({ navn: f.properties.name || (f.properties.kind === 'brann' ? 'Brannstasjon' : f.properties.kind === 'politi' ? 'Politistasjon' : 'Ambulansestasjon'), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], hint: f.properties.kind })) : cfg.sites;
  for (const s of siteList) { const p = proj.toXZ(s.lat, s.lon); if (p.x < world.X0 || p.x > world.X1 || p.z < world.Z0 || p.z > world.Z1) continue; addLot({ x: p.x, z: p.z, name: s.navn, hint: s.hint || null, real: true }); }
  const CELLG = 480, cellBest = new Map();
  for (const e of main) {
    if (e.len < 30 || !['residential', 'tertiary', 'secondary', 'unclassified', 'primary', 'living_street'].includes(e.hw)) continue;
    const p = nav.pointAt(e, e.len / 2), ci = Math.floor(p[0] / CELLG), cj = Math.floor(p[1] / CELLG), k = ci + ',' + cj, d = Math.hypot(p[0] - (ci + 0.5) * CELLG, p[1] - (cj + 0.5) * CELLG);
    if (p[0] < world.X0 || p[0] > world.X1 || p[1] < world.Z0 || p[1] > world.Z1) continue;
    const o = cellBest.get(k); if (!o || d < o.d) cellBest.set(k, { e, p, d });
  }
  for (const { e, p } of [...cellBest.values()].sort((u, v) => u.e.id - v.e.id)) {
    if (taken.some(t => Math.hypot(t[0] - p[0], t[1] - p[1]) < 170)) continue;
    const rp = { a: e.a, b: e.b, e: e.id, t: 0.5 }, d = nav.dirAt(rp), side = rnd() < 0.5 ? 1 : -1;
    addLot({ x: p[0] - d[1] * 17 * side, z: p[1] + d[0] * 17 * side });
  }
  // sykehus, legevakt (fast) og master
  world.hospitalDefs = [];
  for (const h of (cfg.hospitals || [])) { const p = proj.toXZ(h.lat, h.lon), lot = addLot({ x: p.x, z: p.z, kind: h.type || 'sykehus', free: false, name: h.navn }); if (lot) world.hospitalDefs.push({ id: h.id, navn: h.navn, lotId: lot.id, type: h.type || 'sykehus' }); }
  world.mastDefs = [];
  for (const m of (cfg.masts || [])) { const p = proj.toXZ(m.lat, m.lon), lot = addLot({ x: p.x, z: p.z, kind: 'mast', free: false, name: m.navn }); if (lot) world.mastDefs.push({ id: m.id, navn: m.navn, lotId: lot.id, ground: true, rmul: m.rmul || 1 }); }
  if (!world.mastDefs.length) { const p = nav.pointAt(main[0], main[0].len / 2), lot = addLot({ x: p[0] + 15, z: p[1], kind: 'mast', free: false, name: 'Basestasjon sentrum' }); if (lot) world.mastDefs.push({ id: 'm1', navn: lot.name, lotId: lot.id, ground: true, rmul: 1.4 }); }
  world.lots = lots; world.lotById = lotById;
  /** Oppretter en tomt der spilleren valgte (lagres i S.dynLots, se Sim.createLot). */
  world.addLotDyn = (x, z, id) => {
    if (id && lotById.has(id)) return lotById.get(id);
    if (id) { const m = /^d(\d+)$/.exec(id); if (m) dynSeq = Math.max(dynSeq, +m[1]); }
    return addLot({ x, z, dyn: true, id: id || 'd' + (++dynSeq) });
  };
  /** Fjerner én tomt spilleren har opprettet (f.eks. når kjøpet ikke ble gjennomført). */
  world.dropLot = id => { const l = lotById.get(id); if (!l || !l.dyn) return; lotById.delete(id); const i = lots.indexOf(l); if (i >= 0) lots.splice(i, 1); const j = taken.findIndex(t => t[0] === l.x && t[1] === l.z); if (j >= 0) taken.splice(j, 1); };
  /** Fjerner alle tomter spilleren har opprettet (ved ny runde eller når en lagring åpnes). */
  world.clearDyn = () => { for (const l of lots.filter(l => l.dyn)) world.dropLot(l.id); dynSeq = 0; };

  /* strender, parker, kaikanter, fjell – alle med ekte koordinater */
  const approachFor = (d, island) => (island ? 9 : 0) + Math.max(0, (d - 90) / 160);
  world.beaches = {};
  for (const bd of (cfg.beaches || [])) {
    const p = proj.toXZ(bd.lat, bd.lon), r = nav.nearestRP(p.x, p.z, true), wd = bd.wdir || [0, 1]; if (!r) continue;
    world.beaches[bd.id] = { id: bd.id, navn: bd.navn, x: p.x, z: p.z, island: !!bd.island, crowd: bd.crowd || 1, rp: { a: r.a, b: r.b, e: r.e, t: r.t }, snap: r.dist, wv: wd, addr: bd.navn,
      tower: { x: p.x, z: p.z }, shore: { x: p.x, z: p.z }, swim: { x: p.x + wd[0] * 26, z: p.z + wd[1] * 26 }, approach: approachFor(r.dist, bd.island) };
  }
  const pts = (arr, k) => (arr || []).map(o => { const p = proj.toXZ(o.lat, o.lon), r = nav.nearestRP(p.x, p.z, true); return r ? { navn: o.navn, x: p.x, z: p.z, rp: { a: r.a, b: r.b, e: r.e, t: r.t }, snap: r.dist, approach: approachFor(r.dist, false) } : null; }).filter(Boolean);
  world.parks = pts(cfg.parks); world.waterfront = pts(cfg.waterfront); world.mountain = pts(cfg.mountain);
  world.venue = ev => { const p = proj.toXZ(ev.lat, ev.lon), r = nav.nearestRP(p.x, p.z, true) || { ...world.randomRoadPlace().rp, dist: 0 }; return { x: p.x, z: p.z, rp: { a: r.a, b: r.b, e: r.e, t: r.t }, addr: ev.navn, zone: 'park', floors: 0, approach: approachFor(r.dist, false) }; };
  world.landing = [...world.parks, ...Object.values(world.beaches), ...world.mountain];
  world.weak = (cfg.weakZones || []).map(z => { const p = proj.toXZ(z.lat, z.lon); return { navn: z.navn, x: p.x, z: p.z, r: z.r, mul: z.mul }; });
  /* trekning av tilfeldige adresser og veipunkter (vektet etter tetthet) */
  const addrEdges = main.filter(e => ['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street'].includes(e.hw) && e.len > 20), roadEdges = main.filter(e => HW_MUL[e.hw] >= 0.9 && e.len > 20);
  if (!addrEdges.length) addrEdges.push(...main); if (!roadEdges.length) roadEdges.push(...main);
  const wpickE = (arr, wf) => { let tot = 0; const ws = arr.map(e => { const w = Math.max(0.0001, wf(e)); tot += w; return w; }); let r = Math.random() * tot; for (let i = 0; i < arr.length; i++) { r -= ws[i]; if (r <= 0) return arr[i]; } return arr[arr.length - 1]; };
  world.randomAddress = kind => {
    const e = wpickE(addrEdges, e => e.len * (kind === 'natt' ? e.dens * e.dens + 0.03 : kind === 'hjem' ? 0.5 + (1 - e.dens) : 0.3 + e.dens * 1.4)), t = rr(0.15, 0.85), rp = { a: e.a, b: e.b, e: e.id, t }, c = nav.rpXZ(rp), d = nav.dirAt(rp), side = Math.random() < 0.5 ? 1 : -1;
    const dn = dens(c.x, c.z);
    return { x: c.x - d[1] * 13 * side, z: c.z + d[0] * 13 * side, rp, addr: world.addrOf(rp, side > 0 ? 1 : 0), zone: dn > 0.6 ? 'sentrum' : dn > 0.3 ? 'by' : 'bolig', floors: dn > 0.7 ? 8 : dn > 0.4 ? 5 : dn > 0.2 ? 3 : 2, approach: 0 };
  };
  world.randomRoadPlace = () => {
    const e = wpickE(roadEdges, e => e.len * (0.25 + e.dens * 1.2 + (HW_MUL[e.hw] > 1.1 ? 0.6 : 0))), t = rr(0.2, 0.8), rp = { a: e.a, b: e.b, e: e.id, t }, c = nav.rpXZ(rp);
    return { x: c.x, z: c.z, rp, addr: world.streetOf(rp), zone: 'by', floors: 0, approach: 0 };
  };
  /* utgangspunkter for bistand (kanten av kartet), prøvenoder for dekningsprosent */
  const border = main.map(e => nav.pointAt(e, 0)).map((p, i) => ({ p, e: main[i] })).filter(o => Math.min(o.p[0] - world.X0, world.X1 - o.p[0], o.p[1] - world.Z0, world.Z1 - o.p[1]) < 300);
  world.ports = border.filter((_, i) => i % 6 === 0).slice(0, 40).map(o => world.nodes[o.e.a]);
  if (!world.ports.length) world.ports = [world.nodes[main[0].a]];
  world.sample = main.filter((_, i) => i % Math.max(1, Math.floor(main.length / 400)) === 0).map(e => { const p = nav.pointAt(e, e.len / 2); return { x: p[0], z: p[1] }; });
  world.stat = { noder: world.NN, kanter: world.edges.length, hovedkomp: sizes[world.mainComp], tomter: lots.length };
  return world;
}
