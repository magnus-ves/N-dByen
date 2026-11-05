'use strict';
/* ==========================================================================
   5c. STASJONSBYGG – brann-, politi- og ambulansestasjoner som ekte bygg i full størrelse (meter)
   Bygges av de samme fasadene som byen (City.mat), med garasjeporter, inngangsparti, skilt og oppstillingsplass.
   Lokale koordinater: +z vender mot veien (der bilene står), x på tvers.
   Bygget som sto på tomta fra før fjernes (se City.footprints / City.applyRemoved).
   ========================================================================== */
const Stations = {
  /** Fotavtrykk (radius i meter) brukt til å fjerne bygget som sto der fra før. */
  RADIUS: { brannstasjon: 22, politistasjon: 19, ambulansestasjon: 17, rk_base: 13, nf_base: 13, rs_base: 13, arrest: 15, helikopterbase: 20, sykehus: 30, legevakt: 17 },
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
  /** Bygger stasjonen. Returnerer { grp, h } – eller null for ekte sykehus/legevakt som allerede står i kartet. */
  build(st) {
    const T = ST[st.type]; if (st.gift) return null;
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
        Stations.flag(grp, 18.5, 6, 9); h = 21; break;
      case 'politistasjon':
        // fire etasjer med glassinngang, blått bånd, vognport og sambandsmast
        B({ x: 1, z: -5, w: 26, d: 16, h: 14.5, style: 'moderne', col: '#CBD0D3', front: { style: 'inngang', h: 3.6, bays: 4 } });
        B({ x: -16, z: -7, w: 8, d: 12, h: 4.8, style: 'moderne', col: '#9EA6AD', front: { style: 'port', h: 4.2, col: '#D9DCDD', bays: 2 } });
        grp.add(R.box(26.2, 0.7, 0.35, 0x1F4E9B, 1, 3.95, 3.2, true));
        grp.add(R.box(9, 0.35, 3.4, 0xE4E6E6, 3, 3.75, 4.6)); for (const px of [-1, 7]) grp.add(R.box(0.25, 3.6, 0.25, 0xC9CDD0, px, 1.8, 6));
        grp.add(R.box(0.25, 8, 0.25, 0xB8BCBF, -8, 18.5, -9)); grp.add(R.box(1.6, 0.15, 0.15, 0xB8BCBF, -8, 21.5, -9));
        Stations.sign(grp, 'POLITI', '#1F4E9B', '#ffffff', 1, 12.4, 3.06, 7, 1.4);
        Stations.plate(grp, 34, 9, -2, 7.5, 0x7C8084); Stations.flag(grp, 14, 6.5, 9); h = 22; break;
      case 'ambulansestasjon':
        // garasje med tre ambulanseporter og kontorfløy
        B({ x: -4, z: -3, w: 22, d: 14, h: 6.2, style: 'puss', col: '#ECEAE2', front: { style: 'portamb', h: 4.5, bays: 3 } });
        B({ x: 11.5, z: -4, w: 9, d: 12, h: 7.5, style: 'moderne', col: '#DDE3D6', front: { style: 'inngang', h: 3.2, bays: 2 } });
        Stations.apron(grp, 32, 1, 4, 12, 3, -15, 7.33);
        Stations.sign(grp, 'AMBULANSE', '#F2D21B', '#0E7A3A', -4, 5.3, 4.05, 7, 1.0);
        Stations.sign(grp, '113', '#0E7A3A', '#ffffff', 11.5, 5.8, 2.06, 2, 1); h = 14; break;
      case 'rk_base': case 'nf_base': case 'rs_base': {
        const rs = st.type === 'rs_base';
        B({ x: 0, z: -3, w: 16, d: 12, h: rs ? 7 : 6, style: rs ? 'villa' : 'puss', col: rs ? '#D9733A' : '#F1ECE4', front: { style: 'port', h: 4.2, col: rs ? '#F4F1EC' : '#C9302C', bays: 2 } });
        Stations.plate(grp, 20, 7, 0, 6.5, 0x7C8084);
        Stations.sign(grp, rs ? 'REDNINGSSTASJON' : st.type === 'rk_base' ? 'HJELPEKORPS' : 'SANITET', rs ? '#E0874A' : '#F4F1EA', rs ? '#ffffff' : '#C9302C', 0, 5.1, 3.06, 7, 0.9); h = 12; break; }
      case 'arrest':
        B({ x: 0, z: -4, w: 20, d: 14, h: 8, style: 'moderne', col: '#A9AFB5', front: { style: 'inngang', h: 3.2, bays: 2 } });
        Stations.sign(grp, 'ARREST', '#5C6677', '#ffffff', 0, 6.3, 3.06, 5, 1); h = 14; break;
      case 'helikopterbase': {
        B({ x: 9, z: -5, w: 16, d: 14, h: 7.5, style: 'industri', col: '#C9CDD0', front: { style: 'port', h: 6, col: '#E8E8E8', bays: 2 } });
        const pad = new THREE.Mesh(R.geo('padc', () => new THREE.CylinderGeometry(9, 9, 0.25, 40)), R.mat(0x6E7376)); pad.position.set(-9, 0.12, 1); pad.receiveShadow = true; grp.add(pad);
        const ring = new THREE.Mesh(R.geo('padr', () => new THREE.RingGeometry(7.2, 7.8, 40)), R.matB(0xF2D21B)); ring.rotation.x = -Math.PI / 2; ring.position.set(-9, 0.27, 1); grp.add(ring);
        grp.add(R.box(0.8, 0.03, 5, 0xffffff, -10.8, 0.27, 1, true)); grp.add(R.box(0.8, 0.03, 5, 0xffffff, -7.2, 0.27, 1, true)); grp.add(R.box(3, 0.03, 0.8, 0xffffff, -9, 0.27, 1, true));
        Stations.sign(grp, 'LUFTAMBULANSE', '#E53935', '#ffffff', 9, 6.7, 2.06, 8, 1); h = 14; break; }
      case 'sykehus':
        B({ x: 0, z: -8, w: 40, d: 26, h: 21, style: 'moderne', col: '#E6E4DE', front: { style: 'inngang', h: 4, bays: 6 } });
        grp.add(R.box(14, 0.4, 6, 0xE4E6E6, 8, 4.2, 7.5)); Stations.sign(grp, 'SYKEHUS', '#F4F1EA', '#0E7A3A', 0, 18.5, 5.06, 10, 1.6);
        Stations.plate(grp, 44, 9, 0, 9.5, 0x7C8084); h = 27; break;
      case 'legevakt':
        B({ x: 0, z: -4, w: 24, d: 16, h: 9.5, style: 'puss', col: '#EDEBE4', front: { style: 'inngang', h: 3.4, bays: 3 } });
        Stations.sign(grp, 'LEGEVAKT', '#F4F1EA', '#0E7A3A', 0, 7.8, 4.06, 7, 1.1); h = 15; break;
      default: return null;
    }
    Stations.meshes(acc, grp);
    tree(grp, -19, -12, 8); tree(grp, 20, 9, 7);
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { grp, h };
  }
};
