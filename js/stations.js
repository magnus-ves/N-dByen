'use strict';
/* ==========================================================================
   5c. STASJONSBYGG – brann-, politi- og ambulansestasjoner som ekte bygg i full størrelse (meter)
   Bygges av de samme fasadene som byen (City.mat), med garasjeporter, inngangsparti, skilt og oppstillingsplass.
   Lokale koordinater: +z vender mot veien (der bilene står), x på tvers.
   Bygget som sto på tomta fra før fjernes (se City.footprints / City.applyRemoved).
   ========================================================================== */
const Stations = {
  /** Fotavtrykk (radius i meter) brukt til å fjerne bygget som sto der fra før. */
  RADIUS: { brannstasjon: 22, politistasjon: 19, ambulansestasjon: 17, rk_base: 16, nf_base: 16, rs_base: 17, arrest: 15, helikopterbase: 20, sykehus: 36, legevakt: 18 },
  /** Vegger og flatt tak for én bygningskropp. o: {x,z,w,d,h,y0,style,col,front:{style,h,col,bays},parapet} */
  box(acc, o) {
    const get = st => acc[st] || (acc[st] = { p: [], n: [], uv: [], c: [] }), y0 = o.y0 || 0, y1 = y0 + o.h, col = new THREE.Color(o.col || '#ffffff');
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
    const quad = (st, a, b, h0, h1, bays, floors, c, nx, nz, ao) => {
      const g = get(st), U = bays / City.cols(st), V = floors / City.rows(st), d = ao ? 0.75 : 1;
      g.p.push(a[0], h0, a[1], b[0], h0, b[1], b[0], h1, b[1], a[0], h0, a[1], b[0], h1, b[1], a[0], h1, a[1]);
      for (const f of [d, d, 1, d, 1, 1]) { g.n.push(nx, 0, nz); g.c.push(c.r * f, c.g * f, c.b * f); }
      g.uv.push(0, 0, U, 0, U, V, 0, 0, U, V, 0, V);
    };
    const walls = [[[x0, z1], [x1, z1], 0, 1, 'front'], [[x1, z1], [x1, z0], 1, 0], [[x1, z0], [x0, z0], 0, -1], [[x0, z0], [x0, z1], -1, 0]];
    for (const [a, b, nx, nz, tag] of walls) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), bays = Math.max(1, Math.round(L / City.BAY));
      if (tag === 'front' && o.front) {
        const F = o.front, fc = new THREE.Color(F.col || '#ffffff'); quad(F.style, a, b, y0, y0 + F.h, F.bays || bays, 1, fc, nx, nz, true);
        if (o.h > F.h + 0.5) quad(o.style, a, b, y0 + F.h, y1, bays, Math.max(1, Math.round((o.h - F.h) / City.FLOOR)), col, nx, nz);
      } else quad(o.style, a, b, y0, y1, bays, Math.max(1, Math.round(o.h / City.FLOOR)), col, nx, nz, y0 < 1);
    }
    if (o.gable) {   // saltak (møne langs x), takstein tonet med o.gable.col
      const rh = o.gable.h || o.d * .3, rc = new THREE.Color(o.gable.col || '#8E3B2E'), gt = get('tegltak'), gw = get(o.style), ov = .6;
      const T3 = (a, b, c) => { gt.p.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) { gt.n.push(0, 1, 0); gt.c.push(rc.r, rc.g, rc.b); } gt.uv.push(a[0] / 4, a[2] / 4, b[0] / 4, b[2] / 4, c[0] / 4, c[2] / 4); };
      const A1 = [x0 - ov, y1, z0 - ov], A2 = [x1 + ov, y1, z0 - ov], A3 = [x1 + ov, y1, z1 + ov], A4 = [x0 - ov, y1, z1 + ov], R1 = [x0 - ov, y1 + rh, o.z], R2 = [x1 + ov, y1 + rh, o.z];
      T3(A1, A2, R2); T3(A1, R2, R1); T3(A4, R1, R2); T3(A4, R2, A3);
      for (const [xx, sg] of [[x0, -1], [x1, 1]]) { gw.p.push(xx, y1, z0, xx, y1, z1, xx, y1 + rh, o.z); for (let k = 0; k < 3; k++) { gw.n.push(sg, 0, 0); gw.c.push(col.r, col.g, col.b); } gw.uv.push(0, 0, o.d / City.BAY / City.cols(o.style), 0, o.d / City.BAY / City.cols(o.style) / 2, rh / City.FLOOR / City.rows(o.style)); }
      return;
    }
    // flatt tak med takkant
    const g = get('tak'), tc = 0.9; for (const [px, pz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) { g.p.push(px, y1 + .02, pz); g.n.push(0, 1, 0); g.c.push(tc, tc, tc); g.uv.push(px / 12, pz / 12); }
    if (o.parapet !== false) { const pc = col.clone().multiplyScalar(0.9); for (const [a, b, nx, nz] of walls) quad('gesims', a, b, y1, y1 + 0.6, 2, 1, pc, nx, nz); }
  },
  /** Gjør samlede flater om til meshes. */
  meshes(acc, grp) {
    for (const st in acc) {
      const d = acc[st]; if (!d.p.length) continue; const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(d.c, 3));
      const m = new THREE.Mesh(geo, City.mat(st)); m.castShadow = true; grp.add(m);
    }
  },
  sign(grp, text, bg, fg, x, y, z, w, h, ry) { const p = new THREE.Mesh(R.geo('signq', () => new THREE.PlaneGeometry(1, 1)), R.signMat(text, bg, fg)); p.scale.set(w, h, 1); p.position.set(x, y, z); if (ry) p.rotation.y = ry; grp.add(p); return p; },
  plate(grp, w, d, x, z, hex, y) { const m = new THREE.Mesh(R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), R.mat(hex)); m.scale.set(w, 0.12, d); m.position.set(x, (y || 0) + 0.06, z); m.receiveShadow = true; grp.add(m); return m; },
  /** Oppstillingsplass med gul skravering foran portene. */
  apron(grp, w, x, z0, z1, doors, dx0, dw) {
    Stations.plate(grp, w, z1 - z0, x, (z0 + z1) / 2, 0x7C8084);
    for (let i = 0; i < (doors || 0); i++) { const cx = dx0 + dw * (i + .5); for (let k = 0; k < 4; k++) { const s = R.box(0.35, 0.02, 3.2, 0xF2D21B, cx - 1.2 + k * 0.8, 0.14, z0 + 2.2, true); s.rotation.y = 0.6; grp.add(s); } }
  },
  flag(grp, x, z, h) { grp.add(R.box(0.15, h, 0.15, 0xE8E8E8, x, h / 2, z)); grp.add(R.box(1.6, 1.1, 0.04, 0xC8102E, x + 0.85, h - 0.7, z)); grp.add(R.box(1.6, 0.22, 0.045, 0xFFFFFF, x + 0.85, h - 0.7, z)); grp.add(R.box(0.22, 1.1, 0.045, 0xFFFFFF, x + 0.4, h - 0.7, z)); grp.add(R.box(1.6, 0.1, 0.05, 0x00205B, x + 0.85, h - 0.7, z)); grp.add(R.box(0.1, 1.1, 0.05, 0x00205B, x + 0.4, h - 0.7, z)); },
/* små detaljer rundt byggene */
  hedge(grp, x, z, w, d) { const m = R.box(w, 1.1, d, 0x4F7A45, x, .55, z); grp.add(m); },
  /** Fargede kanter rundt taket (brystning). */
  parapet(grp, x, z, w, d, y, hh, hex) { const t = .3; grp.add(R.box(w, hh, t, hex, x, y + hh / 2, z + d / 2 - t / 2)); grp.add(R.box(w, hh, t, hex, x, y + hh / 2, z - d / 2 + t / 2)); grp.add(R.box(t, hh, d, hex, x - w / 2 + t / 2, y + hh / 2, z)); grp.add(R.box(t, hh, d, hex, x + w / 2 - t / 2, y + hh / 2, z)); },
  bench(grp, x, z, ry) { const g = new THREE.Group(); g.add(R.box(1.8, .08, .45, 0x8A6A4A, 0, .45, 0)); g.add(R.box(1.8, .4, .06, 0x8A6A4A, 0, .7, -.2)); for (const s of [-1, 1]) g.add(R.box(.06, .45, .45, 0x3B3F42, s * .8, .22, 0)); g.position.set(x, 0, z); g.rotation.y = ry || 0; grp.add(g); },
  bollards(grp, x0, x1, z) { for (let x = x0; x <= x1; x += 1.6) grp.add(R.box(.18, .9, .18, 0x5B6064, x, .45, z)); },
  parking(grp, x, z, n, ry) { const g = new THREE.Group(); Stations.plate(g, n * 2.6 + .4, 5.2, 0, 0, 0x6E7276); for (let i = 0; i <= n; i++) g.add(R.box(.12, .02, 4.8, 0xF4F4F2, -n * 1.3 + i * 2.6, .14, 0, true)); g.position.set(x, 0, z); g.rotation.y = ry || 0; grp.add(g); },
  roofUnits(grp, x, z, y, n) { for (let i = 0; i < n; i++) grp.add(R.box(2.2, 1.2, 1.4, 0x9DA3A6, x - 3 + i * 3, y + .6, z)); },
  buoy(grp, x, y, z, ry) { const m = new THREE.Mesh(R.geo('buoyS', () => new THREE.TorusGeometry(.38, .1, 8, 18)), R.mat(0xE9701E)); m.position.set(x, y, z); m.rotation.y = ry || 0; grp.add(m); },
  container(grp, x, z, hex, ry) { const g = new THREE.Group(); g.add(R.box(6, 2.6, 2.4, hex, 0, 1.3, 0)); for (let i = 0; i < 10; i++) g.add(R.box(.04, 2.5, 2.42, 0x000000, -2.8 + i * .62, 1.3, 0)); g.children.slice(1).forEach(m => { m.material = R.mats.ribs || (R.mats.ribs = new THREE.MeshLambertMaterial({ color: 0x000000, transparent: true, opacity: .15 })); }); g.position.set(x, 0, z); g.rotation.y = ry || 0; grp.add(g); },
  atv(grp, x, z, hex) { const g = new THREE.Group(); g.add(R.box(1.1, .45, 2.0, hex, 0, .75, 0)); g.add(R.box(.6, .25, .7, 0x2F3335, 0, 1.05, -.2)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new THREE.Mesh(R.wheelGeo(), R.mat(0x1E2124)); w.scale.setScalar(1.6); w.position.set(sx * .62, .45, sz * .7); g.add(w); } g.add(R.box(1.0, .06, .5, 0x2F3335, 0, 1.15, .65)); g.position.set(x, 0, z); g.rotation.y = .4; grp.add(g); },
  canopy(grp, x, z, w, d, y, hex) { grp.add(R.box(w, .35, d, hex, x, y, z)); for (const sx of [-1, 1]) grp.add(R.box(.3, y, .3, 0xC9CDD0, x + sx * (w / 2 - .4), y / 2, z + d / 2 - .4)); },
  helipad(grp, x, z, y, r) { const pad = new THREE.Mesh(R.geo('padc' + r, () => new THREE.CylinderGeometry(r, r, .25, 40)), R.mat(0x6E7376)); pad.position.set(x, y + .12, z); grp.add(pad);
    const ring = new THREE.Mesh(R.geo('padr' + r, () => new THREE.RingGeometry(r * .8, r * .86, 40)), R.matB(0xF2D21B)); ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + .27, z); grp.add(ring);
    const k = r / 9; grp.add(R.box(.8 * k, .03, 5 * k, 0xffffff, x - 1.8 * k, y + .27, z, true)); grp.add(R.box(.8 * k, .03, 5 * k, 0xffffff, x + 1.8 * k, y + .27, z, true)); grp.add(R.box(3 * k, .03, .8 * k, 0xffffff, x, y + .27, z, true)); },
  /** Bygger stasjonen. Returnerer { grp, h } – eller null for ekte sykehus/legevakt som allerede står i kartet. */
  build(st) {
    const T = ST[st.type], navn = String(st.name || '').replace(/\s*\(ca\.\)/, '');
    const grp = new THREE.Group(), acc = {}, B = (o) => Stations.box(acc, o); let h = 12;
    switch (st.type) {
      case 'brannstasjon':
        // vognhall med fire røde porter, kontorfløy og øvingstårn
        B({ x: -5, z: -4, w: 24, d: 16, h: 8, style: 'murgard', col: '#A8553F', front: { style: 'port', h: 4.8, col: '#C4241B', bays: 4 } });
        B({ x: 12, z: -5, w: 10, d: 14, h: 11, style: 'moderne', col: '#E3DED3', front: { style: 'inngang', h: 3.2, bays: 2 } });
        B({ x: 15, z: -14.5, w: 4.5, d: 4.5, h: 21, style: 'murgard', col: '#93442F', parapet: false });
        Stations.apron(grp, 36, 2, 4, 13, 4, -17, 6);
        Stations.sign(grp, 'BRANNSTASJON', '#C4241B', '#ffffff', -5, 6.4, 4.05, 9, 1.2);
        Stations.sign(grp, '110', '#C4241B', '#ffffff', 12, 9.3, 2.05, 2.2, 1.1);
        Stations.flag(grp, 18.5, 6, 9); Stations.roofUnits(grp, -5, -8, 8.6, 2); Stations.bench(grp, 13, 3.6, 0); Stations.hedge(grp, 19, -6, 1, 12); Stations.parking(grp, 26, -4, 4, Math.PI / 2); h = 21; break;
      case 'politistasjon':
        // fire etasjer med glassinngang, blått bånd, vognport og sambandsmast
        B({ x: 1, z: -5, w: 26, d: 16, h: 14.5, style: 'moderne', col: '#CBD0D3', front: { style: 'inngang', h: 3.6, bays: 4 } });
        B({ x: -16, z: -7, w: 8, d: 12, h: 4.8, style: 'moderne', col: '#9EA6AD', front: { style: 'port', h: 4.2, col: '#D9DCDD', bays: 2 } });
        grp.add(R.box(26.2, 0.7, 0.35, 0x1F4E9B, 1, 3.95, 3.2, true));
        grp.add(R.box(9, 0.35, 3.4, 0xE4E6E6, 3, 3.75, 4.6)); for (const px of [-1, 7]) grp.add(R.box(0.25, 3.6, 0.25, 0xC9CDD0, px, 1.8, 6));
        grp.add(R.box(0.25, 8, 0.25, 0xB8BCBF, -8, 18.5, -9)); grp.add(R.box(1.6, 0.15, 0.15, 0xB8BCBF, -8, 21.5, -9));
        Stations.sign(grp, 'POLITI', '#1F4E9B', '#ffffff', 1, 12.4, 3.06, 7, 1.4);
        Stations.plate(grp, 34, 9, -2, 7.5, 0x7C8084); Stations.flag(grp, 14, 6.5, 9); Stations.roofUnits(grp, 2, -9, 15.1, 3); Stations.bollards(grp, -10, 12, 11.6); Stations.parking(grp, -3, -18.5, 8, 0); h = 22; break;
      case 'ambulansestasjon':
        // garasje med tre ambulanseporter og kontorfløy
        B({ x: -4, z: -3, w: 22, d: 14, h: 6.2, style: 'puss', col: '#ECEAE2', front: { style: 'portamb', h: 4.5, bays: 3 } });
        B({ x: 11.5, z: -4, w: 9, d: 12, h: 7.5, style: 'moderne', col: '#DDE3D6', front: { style: 'inngang', h: 3.2, bays: 2 } });
        Stations.apron(grp, 32, 1, 4, 12, 3, -15, 7.33);
        Stations.sign(grp, 'AMBULANSE', '#F2D21B', '#0E7A3A', -4, 5.3, 4.05, 7, 1.0);
        Stations.sign(grp, '113', '#0E7A3A', '#ffffff', 11.5, 5.8, 2.06, 2, 1); Stations.roofUnits(grp, -4, -6, 6.8, 2); Stations.bench(grp, 14, 4, 0); Stations.hedge(grp, 17, -5, 1, 11); h = 14; break;
      case 'rk_base': {   // Røde Kors Hjelpekorps: hvitt bygg, rødt bånd og røde porter (korset er et beskyttet kjennetegn og brukes ikke)
        B({ x: -2, z: -3, w: 20, d: 13, h: 7.6, style: 'puss', col: '#F6F4EF', front: { style: 'port', h: 4.4, col: '#D52B1E', bays: 3 } });
        B({ x: 12.5, z: -4, w: 9, d: 11, h: 7.6, style: 'moderne', col: '#F1EFEA', front: { style: 'inngang', h: 3.2, bays: 2 } });
        grp.add(R.box(29.2, 1.2, .3, 0xD52B1E, 2.5, 6.6, 3.62)); Stations.sign(grp, 'RØDE KORS HJELPEKORPS', '#D52B1E', '#ffffff', 2.5, 6.6, 3.8, 16, 1.0);
        Stations.apron(grp, 30, 0, 3.5, 11, 3, -12, 6.67); Stations.atv(grp, 13, 8, 0xD52B1E); Stations.container(grp, -16.5, -2, 0xD52B1E, Math.PI / 2);
        Stations.flag(grp, 17.5, 4.5, 8); Stations.hedge(grp, 17, -11, 1.2, 10); Stations.bench(grp, 15, 5.2, 0); h = 13; break; }
      case 'nf_base': {   // Norsk Folkehjelp Sanitet: hvitt bygg med grønne porter, grønt bånd og grønn sokkel
        B({ x: -2, z: -3, w: 20, d: 13, h: 7.2, style: 'moderne', col: '#F6F6F2', front: { style: 'port', h: 4.4, col: '#00843D', bays: 3 } });
        B({ x: 12.5, z: -4, w: 9, d: 11, h: 7.2, style: 'moderne', col: '#F6F6F2', front: { style: 'inngang', h: 3.2, bays: 2 } });
        grp.add(R.box(20.2, .8, 13.2, 0x00843D, -2, .4, -3)); grp.add(R.box(9.2, .8, 11.2, 0x00843D, 12.5, .4, -4));
        Stations.parapet(grp, -2, -3, 20.3, 13.3, 7.2, .6, 0x00843D); Stations.parapet(grp, 12.5, -4, 9.3, 11.3, 7.2, .6, 0x00843D);
        Stations.sign(grp, 'NORSK FOLKEHJELP', '#FFFFFF', '#00843D', -2, 6.1, 3.56, 12, 1.0); Stations.sign(grp, 'SANITET', '#00843D', '#FFFFFF', 12.5, 5.8, 1.56, 5, .9);
        Stations.apron(grp, 30, 0, 3.5, 11, 3, -12, 6.67); Stations.container(grp, -16.5, -2, 0x00843D, Math.PI / 2); Stations.flag(grp, 17.5, 4.5, 8); Stations.bench(grp, 15, 5.2, 0); Stations.hedge(grp, 17.5, -11, 1.2, 9); h = 13; break; }
      case 'rs_base': {   // Redningsselskapet: naust med saltak, blått skilt og oransje stripe, slipp, livbøyer og skøyte på henger
        B({ x: -1, z: -4, w: 18, d: 12, h: 6.5, style: 'villa', col: '#F4F1EC', front: { style: 'port', h: 5, col: '#F4F4F2', bays: 2 }, gable: { col: '#1F3A8A', h: 4.2 } });
        B({ x: 13, z: -5, w: 8, d: 10, h: 6.5, style: 'villa', col: '#E9701E', gable: { col: '#1F3A8A', h: 3 } });
        grp.add(R.box(18.2, .5, .25, 0xE9701E, -1, 5.6, 2.12)); Stations.sign(grp, 'REDNINGSSELSKAPET', '#1F3A8A', '#FFFFFF', -1, 6.25, 2.3, 13, 1.0);
        for (const bx of [-9.2, 7.2]) Stations.buoy(grp, bx, 3.2, 2.15, 0);
        const slip = Stations.plate(grp, 8, 14, -1, 9, 0x8E8B85); slip.rotation.x = -.06;
        const tr = new THREE.Group(); tr.add(R.box(2.2, .25, 7, 0x3B3F42, 0, .55, 0)); for (const sx of [-1, 1]) { const w = new THREE.Mesh(R.wheelGeo(), R.mat(0x1E2124)); w.scale.setScalar(2.2); w.position.set(sx * 1.2, .55, -.6); tr.add(w); }
        const bt = boatModel('rs', R.matG || (R.matG = new THREE.MeshPhongMaterial({ color: 0x22313b, shininess: 90, specular: 0x9fb8c8, side: THREE.DoubleSide })), []).g; bt.scale.setScalar(VS * .75); bt.position.y = 1.2; tr.add(bt); tr.position.set(12, 0, 7); tr.rotation.y = .25; grp.add(tr);
        Stations.flag(grp, -12, 6, 8); h = 14; break; }
      case 'arrest':
        B({ x: 0, z: -4, w: 20, d: 14, h: 8, style: 'moderne', col: '#A9AFB5', front: { style: 'inngang', h: 3.2, bays: 2 } });
        Stations.sign(grp, 'ARREST', '#5C6677', '#ffffff', 0, 6.3, 3.06, 5, 1); h = 14; break;
      case 'helikopterbase': {
        B({ x: 9, z: -5, w: 16, d: 14, h: 7.5, style: 'industri', col: '#C9CDD0', front: { style: 'port', h: 6, col: '#E8E8E8', bays: 2 } });
        const pad = new THREE.Mesh(R.geo('padc', () => new THREE.CylinderGeometry(9, 9, 0.25, 40)), R.mat(0x6E7376)); pad.position.set(-9, 0.12, 1); pad.receiveShadow = true; grp.add(pad);
        const ring = new THREE.Mesh(R.geo('padr', () => new THREE.RingGeometry(7.2, 7.8, 40)), R.matB(0xF2D21B)); ring.rotation.x = -Math.PI / 2; ring.position.set(-9, 0.27, 1); grp.add(ring);
        grp.add(R.box(0.8, 0.03, 5, 0xffffff, -10.8, 0.27, 1, true)); grp.add(R.box(0.8, 0.03, 5, 0xffffff, -7.2, 0.27, 1, true)); grp.add(R.box(3, 0.03, 0.8, 0xffffff, -9, 0.27, 1, true));
        Stations.sign(grp, 'LUFTAMBULANSE', '#E53935', '#ffffff', 9, 6.7, 2.06, 8, 1); h = 14; break; }
      case 'sykehus': {   // sykehus: høyblokk, lav fløy med helikopterplass på taket, akuttmottak med baldakin og ambulanseplasser
        B({ x: -6, z: -10, w: 30, d: 22, h: 31, style: 'moderne', col: '#E6E4DE', front: { style: 'inngang', h: 4.5, bays: 5 } });
        B({ x: 18, z: -6, w: 24, d: 26, h: 11, style: 'glass', col: '#B9CCD6', front: { style: 'inngang', h: 4, bays: 4 } });
        Stations.helipad(grp, 18, -8, 11.6, 8); Stations.roofUnits(grp, -6, -14, 31.6, 3);
        Stations.canopy(grp, 18, 10, 14, 6, 4.4, 0xE4E6E6); Stations.sign(grp, 'AKUTTMOTTAK', '#C8102E', '#FFFFFF', 18, 5.1, 13.06, 8, 1.1);
        Stations.sign(grp, (navn && navn.length < 26 ? navn : 'SYKEHUS').toUpperCase(), '#1F4E9B', '#FFFFFF', -6, 28, 1.06, 22, 2.2);
        Stations.parking(grp, -8, 9.5, 8, 0); Stations.hedge(grp, -6, 4.2, 26, 1); Stations.bench(grp, -18, 5.5, 0); Stations.bollards(grp, 10, 26, 13.8); h = 37; break; }
      case 'legevakt': {
        B({ x: 0, z: -4, w: 26, d: 16, h: 12, style: 'puss', col: '#EDEBE4', front: { style: 'inngang', h: 3.6, bays: 4 } });
        Stations.canopy(grp, 6, 7, 10, 5, 4, 0xE4E6E6); Stations.sign(grp, 'LEGEVAKT', '#0E7A3A', '#FFFFFF', 0, 10, 4.06, 9, 1.3);
        Stations.parking(grp, -10, 9, 5, 0); Stations.roofUnits(grp, -4, -6, 12.6, 2); Stations.bollards(grp, 1, 11, 9.8); h = 18; break; }
      default: return null;
    }
    Stations.meshes(acc, grp);
    if (st.type === 'sykehus') { tree(grp, -24, 2, 8); tree(grp, 34, 8, 7); } else { tree(grp, -19, -12, 8); tree(grp, 20, 9, 7); }   // trærne skal ikke stå under baldakinen
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { grp, h };
  }
};
