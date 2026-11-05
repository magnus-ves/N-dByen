'use strict';
/* ==========================================================================
   4. KARTDATA OG VEINETT – projeksjon, veigraf fra OpenStreetMap (GeoJSON), A*-stifinning
   Veinettet hentes fra data/<by>-roads.geojson (laget av scripts/fetch-data.mjs fra Overpass).
   Mangler filen, hentes det direkte fra Overpass i nettleseren.
   Koordinatsystem i spillet: meter, x = øst, z = sør (z øker nordfra og sørover), y = opp.
   ========================================================================== */
const HW_MUL = { motorway: 1.45, motorway_link: 1.2, trunk: 1.4, trunk_link: 1.2, primary: 1.2, primary_link: 1.1, secondary: 1.05, secondary_link: 1.0, tertiary: 1.0, tertiary_link: 0.95, unclassified: 0.9, residential: 0.85, living_street: 0.6 };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function makeProj(lat0, lon0) {
  const mLat = 111132, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return { lat0, lon0, mLat, mLon, toXZ: (lat, lon) => ({ x: (lon - lon0) * mLon, z: -(lat - lat0) * mLat }), toLL: (x, z) => ({ lat: lat0 - z / mLat, lon: lon0 + x / mLon }) };
}
/** Overpass-spørring: biler kan kjøre på alle klasser. Boligveier bare nær sentrum (holder datamengden nede). */
function overpassQuery(cfg) {
  const [w, s, e, n] = cfg.bbox, c = cfg.center;
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
  let lastErr;
  for (const url of OVERPASS) {
    try { const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(overpassQuery(cfg)) }); if (!r.ok) throw new Error('HTTP ' + r.status); return overpassToGeoJSON(await r.json()); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Overpass utilgjengelig');
}
async function loadRoadData(cfg) {
  try { const r = await fetch(cfg.roads, { cache: 'force-cache' }); if (r.ok) { const j = await r.json(); if (j.features && j.features.length) return { gj: j, kilde: 'fil' }; } } catch (e) { /* prøv Overpass */ }
  return { gj: await fetchOverpassLive(cfg), kilde: 'overpass' };
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
  const key = c => Math.round(c[0] * 1e6) + ',' + Math.round(c[1] * 1e6), ways = [], cnt = new Map();
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
    for (let s = 0; s <= e.len + 40; s += 40) { const p = pointAt(e, Math.min(s, e.len)), i = Math.floor(p[0] / CS), j = Math.floor(p[1] / CS), k = gk(i, j); if (!seen.has(k)) { seen.add(k); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(e); } }
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
  for (const e of world.edges) { const p = nav.pointAt(e, e.len / 2); e.dens = dens(p[0], p[1]); }
  const main = world.edges.filter(e => comp[e.a] === world.mainComp);
  // adresse = gatenavn + husnummer (utledet fra posisjon langs gata)
  world.addrOf = (rp, side) => { const e = nav.edgeFor(rp); if (!e) return 'Ukjent veg'; const s = (rp.a === e.a ? rp.t : 1 - rp.t) * e.len; return (e.name || 'Veien') + ' ' + (2 * Math.floor(s / 14) + 1 + (side ? 1 : 0)); };
  world.streetOf = rp => { const e = nav.edgeFor(rp); return e && e.name ? e.name : 'Veien'; };

  /* tomter: navngitte steder (data eller config) + jevnt fordelte generiske tomter */
  const lots = [], lotById = new Map(), taken = [];
  const addLot = (o) => {
    const lot = Object.assign({ id: 'l' + lots.length, kind: 'tomt', free: true, floors: 0 }, o);
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
  for (const h of (cfg.hospitals || [])) { const p = proj.toXZ(h.lat, h.lon), lot = addLot({ x: p.x, z: p.z, kind: h.type || 'sykehus', free: false, name: h.navn }); world.hospitalDefs.push({ id: h.id, navn: h.navn, lotId: lot.id, type: h.type || 'sykehus' }); }
  world.mastDefs = [];
  for (const m of (cfg.masts || [])) { const p = proj.toXZ(m.lat, m.lon), lot = addLot({ x: p.x, z: p.z, kind: 'mast', free: false, name: m.navn }); world.mastDefs.push({ id: m.id, navn: m.navn, lotId: lot.id, ground: true, rmul: m.rmul || 1 }); }
  world.lots = lots; world.lotById = lotById;

  /* strender, parker, kaikanter, fjell – alle med ekte koordinater */
  const approachFor = (d, island) => (island ? 9 : 0) + Math.max(0, (d - 90) / 160);
  world.beaches = {};
  for (const bd of (cfg.beaches || [])) {
    const p = proj.toXZ(bd.lat, bd.lon), r = nav.nearestRP(p.x, p.z, true), wd = bd.wdir || [0, 1];
    world.beaches[bd.id] = { id: bd.id, navn: bd.navn, x: p.x, z: p.z, island: !!bd.island, crowd: bd.crowd || 1, rp: { a: r.a, b: r.b, e: r.e, t: r.t }, snap: r.dist, wv: wd, addr: bd.navn,
      tower: { x: p.x, z: p.z }, shore: { x: p.x, z: p.z }, swim: { x: p.x + wd[0] * 26, z: p.z + wd[1] * 26 }, approach: approachFor(r.dist, bd.island) };
  }
  const pts = (arr, k) => (arr || []).map(o => { const p = proj.toXZ(o.lat, o.lon), r = nav.nearestRP(p.x, p.z, true); return { navn: o.navn, x: p.x, z: p.z, rp: { a: r.a, b: r.b, e: r.e, t: r.t }, snap: r.dist, approach: approachFor(r.dist, false) }; });
  world.parks = pts(cfg.parks); world.waterfront = pts(cfg.waterfront); world.mountain = pts(cfg.mountain);
  world.venue = ev => { const p = proj.toXZ(ev.lat, ev.lon), r = nav.nearestRP(p.x, p.z, true); return { x: p.x, z: p.z, rp: { a: r.a, b: r.b, e: r.e, t: r.t }, addr: ev.navn, zone: 'park', floors: 0, approach: approachFor(r.dist, false) }; };
  world.landing = [...world.parks, ...Object.values(world.beaches), ...world.mountain];
  world.weak = (cfg.weakZones || []).map(z => { const p = proj.toXZ(z.lat, z.lon); return { navn: z.navn, x: p.x, z: p.z, r: z.r, mul: z.mul }; });
  /* trekning av tilfeldige adresser og veipunkter (vektet etter tetthet) */
  const addrEdges = main.filter(e => ['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street'].includes(e.hw) && e.len > 20);
  const roadEdges = main.filter(e => HW_MUL[e.hw] >= 0.9 && e.len > 20);
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
  world.sample = main.filter((_, i) => i % Math.max(1, Math.floor(main.length / 500)) === 0).map(e => { const p = nav.pointAt(e, e.len / 2); return { x: p[0], z: p[1] }; });
  world.stat = { noder: world.NN, kanter: world.edges.length, hovedkomp: sizes[world.mainComp], tomter: lots.length };
  return world;
}
