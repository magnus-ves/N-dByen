'use strict';
/* ==========================================================================
   5b. BYGNINGER I NÆRBILDE – tegnes av Three.js ut fra de ekte byggeomrissene i kartdataene
   Rundt kameraet bygges hvert hus med riktig høyde og etasjer (≈ 3 m), vindusfag (≈ 3,2 m),
   butikkfronter på gateplan i sentrum, flate tak med takkant eller saltak på småhus.
   Farger: byggets egen farge fra kartdataene der den finnes, ellers en typisk norsk bypalett.
   Lenger unna tegner MapLibre byggene som enkle blokker med vindusmønster.
   ========================================================================== */
const City = {
  mesh: null, busy: false, lastKey: '', night: 0,
  FLOOR: 3.0, BAY: 3.2,
  // fasadetyper: tekstur for ett vindusfag × én etasje
  STYLES: ['murgard', 'puss', 'glass', 'moderne', 'villa', 'industri', 'butikk', 'tak', 'tegltak'],
  PAL: {   // typiske fasadefarger
    murgard: ['#C9A27A', '#D8B98F', '#B9785C', '#E3CFA8', '#C98F6B', '#A86F55', '#D4B48C'],
    puss: ['#E9DFC8', '#EED9B5', '#DCC7A1', '#E8D2C2', '#CFD9C9', '#D9D2BF', '#F0E8D8', '#E6C9A8', '#C9D3D8'],
    glass: ['#9EB8C8', '#A9BFC2', '#8FA9B9', '#B5C4C9'],
    moderne: ['#D7D4CC', '#BFC3C2', '#9EA3A3', '#E4E0D6', '#8C8F8C'],
    villa: ['#F2EEE6', '#E8D9B8', '#C2D0D4', '#D99A82', '#B8C9AE', '#F0E2C0', '#9AA9B3', '#C4433A'],
    industri: ['#A9ADA8', '#B9B2A2', '#8E9592']
  },
  tex: {},
  makeTex(style) {
    const S_ = 256, c = document.createElement('canvas'); c.width = c.height = S_; const x = c.getContext('2d');
    const lit = document.createElement('canvas'); lit.width = lit.height = S_; const l = lit.getContext('2d'); l.fillStyle = '#000'; l.fillRect(0, 0, S_, S_);
    const noise = (a) => { for (let i = 0; i < 900; i++) { x.fillStyle = 'rgba(' + (Math.random() < .5 ? '0,0,0' : '255,255,255') + ',' + (Math.random() * a) + ')'; x.fillRect(Math.random() * S_, Math.random() * S_, 2, 2); } };
    const win = (px, py, w, h, frame, glass, sill) => {
      if (frame) { x.fillStyle = frame; x.fillRect(px - 5, py - 5, w + 10, h + 10); }
      const g = x.createLinearGradient(0, py, 0, py + h); g.addColorStop(0, glass[0]); g.addColorStop(1, glass[1]); x.fillStyle = g; x.fillRect(px, py, w, h);
      x.fillStyle = 'rgba(255,255,255,.22)'; x.beginPath(); x.moveTo(px, py); x.lineTo(px + w * .55, py); x.lineTo(px, py + h * .5); x.fill();
      if (frame) { x.fillStyle = frame; x.fillRect(px + w / 2 - 3, py, 6, h); x.fillRect(px, py + h * .33, w, 5); }
      if (sill) { x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(px - 8, py + h + 5, w + 16, 6); x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(px - 8, py + h + 4, w + 16, 3); }
      l.fillStyle = Math.random() < .55 ? 'rgba(255,205,130,1)' : 'rgba(255,225,170,.7)'; if (Math.random() < .7) l.fillRect(px, py, w, h);
    };
    const glassD = ['#5E7686', '#2E4250'];
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, S_, S_);   // grunnfarge hvit: tones med byggets farge (vertexColors)
    switch (style) {
      case 'murgard':   // bygård: pusset/murt fasade, høye vinduer med hvite karmer og gesims
        noise(.05); x.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < S_; y += 9) x.fillRect(0, y, S_, 1);
        win(78, 52, 100, 150, '#F4F0E6', glassD, true); x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, 0, S_, 10); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(0, 10, S_, 4); break;
      case 'puss':      // pusset leilighetsbygg
        noise(.04); win(70, 60, 116, 130, '#FBF8F2', glassD, true); x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, S_ - 8, S_, 8); break;
      case 'glass':     // glassfasade med spiler
        { const g = x.createLinearGradient(0, 0, S_, S_); g.addColorStop(0, '#E9F1F5'); g.addColorStop(1, '#B9CCD6'); x.fillStyle = g; x.fillRect(0, 0, S_, S_);
          x.fillStyle = 'rgba(40,60,75,.35)'; x.fillRect(0, 0, S_, S_); x.fillStyle = '#E4E8E8'; x.fillRect(0, 0, 8, S_); x.fillRect(0, 0, S_, 10); x.fillRect(S_ / 2 - 3, 0, 6, S_);
          x.fillStyle = 'rgba(255,255,255,.25)'; x.beginPath(); x.moveTo(10, 12); x.lineTo(120, 12); x.lineTo(10, 140); x.fill(); l.fillStyle = 'rgba(255,230,180,.8)'; if (Math.random() < .6) l.fillRect(10, 12, 240, 240); } break;
      case 'moderne':   // kledning med vindusbånd
        x.fillStyle = 'rgba(0,0,0,.07)'; for (let i = 0; i < S_; i += 32) x.fillRect(i, 0, 2, S_); win(24, 70, 208, 110, '#3A3F42', ['#7E95A2', '#3B5160'], false); break;
      case 'villa':     // trehus: liggende panel, to vinduer
        x.fillStyle = 'rgba(0,0,0,.10)'; for (let y = 0; y < S_; y += 14) x.fillRect(0, y, S_, 2); win(44, 70, 64, 96, '#FBF8F2', glassD, false); win(148, 70, 64, 96, '#FBF8F2', glassD, false);
        x.fillStyle = '#FBF8F2'; x.fillRect(0, 0, 10, S_); x.fillRect(S_ - 10, 0, 10, S_); break;
      case 'industri':  // bølgeblikk, høye smale vinduer
        for (let i = 0; i < S_; i += 12) { x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(i, 0, 5, S_); } win(98, 40, 60, 60, '#8A8F8C', glassD, false); break;
      case 'butikk':    // butikkfront: stort glass, markise og skilt
        x.fillStyle = '#3C3A36'; x.fillRect(0, 0, S_, S_); x.fillStyle = '#E8E1D2'; x.fillRect(0, 0, S_, 46);
        { const g = x.createLinearGradient(0, 70, 0, 250); g.addColorStop(0, '#A9C2CE'); g.addColorStop(1, '#40525C'); x.fillStyle = g; x.fillRect(16, 74, 224, 182); }
        x.fillStyle = 'rgba(255,255,255,.3)'; x.beginPath(); x.moveTo(16, 74); x.lineTo(130, 74); x.lineTo(16, 200); x.fill();
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(126, 74, 6, 182); l.fillStyle = 'rgba(255,220,160,1)'; l.fillRect(16, 74, 224, 182); l.fillRect(0, 0, S_, 46); break;
      case 'tak':       // flatt tak: grus/takpapp
        x.fillStyle = '#8D8E8A'; x.fillRect(0, 0, S_, S_); noise(.18); x.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < S_; i += 64) { x.fillRect(i, 0, 3, S_); x.fillRect(0, i, S_, 3); } break;
      case 'tegltak':   // takstein
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, S_, S_); for (let y = 0; y < S_; y += 16) for (let i = (y / 16) % 2 ? 0 : 16; i < S_; i += 32) { x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(i, y + 12, 30, 4); x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(i, y, 2, 16); } noise(.06); break;
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    const e = new THREE.CanvasTexture(lit); e.wrapS = e.wrapT = THREE.RepeatWrapping;
    return { map: t, lit: e };
  },
  mat(style) {
    if (City.tex[style]) return City.tex[style].m;
    const T = City.makeTex(style), m = new THREE.MeshLambertMaterial({ map: T.map, vertexColors: true, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: style === 'tak' || style === 'tegltak' ? null : T.lit, emissiveIntensity: 0 });
    City.tex[style] = { m, T }; return m;
  },
  setNight(n) { City.night = n; for (const k in City.tex) { const m = City.tex[k].m; m.emissiveIntensity = m.emissiveMap ? n * 0.85 : 0; } },
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; },
  /** Bygg (eller bygg om) husene rundt kartsenteret. */
  update() {
    const map = R.map, w = R.world; if (!map || !w || !R.ready || City.busy || !map.getSource('om')) return;
    const z = map.getZoom(); if (z < 15.2) { City.clear(); return; }
    const c = map.getCenter(), cp = w.proj.toXZ(c.lat, c.lng), rad = clamp(R.mpp * Math.max(R.w, R.h) * 0.9, 300, 1100);
    const key = Math.round(cp.x / 60) + ',' + Math.round(cp.z / 60) + ',' + Math.round(rad / 100);
    if (key === City.lastKey && City.mesh) return; City.busy = true;
    try {
      const feats = map.querySourceFeatures('om', { sourceLayer: 'building' }), seen = new Set(), B = {};
      const get = st => B[st] || (B[st] = { p: [], n: [], uv: [], c: [] });
      const col = new THREE.Color(), col2 = new THREE.Color();
      const quad = (st, a, b, h0, h1, u1, v0, v1, cr, nx, nz) => {   // én veggflate
        const g = get(st); g.p.push(a[0], h0, a[1], b[0], h0, b[1], b[0], h1, b[1], a[0], h0, a[1], b[0], h1, b[1], a[0], h1, a[1]);
        for (let k = 0; k < 6; k++) { g.n.push(nx, 0, nz); g.c.push(cr.r, cr.g, cr.b); }
        g.uv.push(0, v0, u1, v0, u1, v1, 0, v0, u1, v1, 0, v1);
      };
      let n = 0;
      for (const f of feats) {
        if (n > 4500) break;
        const pr = f.properties || {}; if (pr.hide_3d) continue;
        const g = f.geometry; if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
        for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)) {
          const ring = poly[0]; if (!ring || ring.length < 4) continue;
          const q0 = w.proj.toXZ(ring[0][1], ring[0][0]); if (Math.hypot(q0.x - cp.x, q0.z - cp.z) > rad + 60) continue;
          const pts = ring.slice(0, -1).map(q => { const p = w.proj.toXZ(q[1], q[0]); return [p.x, p.z]; });
          let cx = 0, cz = 0, area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const cr = a[0] * b[1] - b[0] * a[1]; area += cr; cx += (a[0] + b[0]) * cr; cz += (a[1] + b[1]) * cr; }
          if (Math.abs(area) < 8) continue; cx /= 3 * area; cz /= 3 * area;
          const k = (f.id || 0) + ':' + Math.round(cx) + ':' + Math.round(cz); if (seen.has(k)) continue; seen.add(k); n++;
          const H = Math.max(3, +pr.render_height || 6), H0 = Math.max(0, +pr.render_min_height || 0), A = Math.abs(area) / 2, hsh = City.hash(k), dens = w.dens(cx, cz);
          const ccw = area > 0;
          // fasadetype ut fra høyde, størrelse og sted
          let st = H >= 30 ? (hsh < .6 ? 'glass' : 'moderne') : H >= 12 ? (dens > .35 ? (hsh < .55 ? 'murgard' : hsh < .8 ? 'puss' : 'moderne') : (hsh < .5 ? 'puss' : 'moderne')) : A > 1500 && H < 12 ? 'industri' : H < 9 ? 'villa' : 'puss';
          const palette = City.PAL[st] || City.PAL.puss; col.set(palette[Math.floor(hsh * 97) % palette.length]);
          if (pr.colour && /^#[0-9a-f]{6}$/i.test(pr.colour) && pr.colour.toLowerCase() !== '#e0d8d0') { col2.set(pr.colour); col.lerp(col2, 0.6); }
          const shop = dens > .45 && H >= 9 && st !== 'glass' && st !== 'industri' && H0 < 1;
          const grow = 0.35, sc = (p) => { const dx = p[0] - cx, dz = p[1] - cz, d = Math.hypot(dx, dz) || 1; return [p[0] + dx / d * grow, p[1] + dz / d * grow]; };
          const P = pts.map(sc), floors = Math.max(1, Math.round((H - H0 - (shop ? 4 : 0)) / City.FLOOR));
          const white = { r: 1, g: 1, b: 1 };
          for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.4) continue;
            let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L; if (!ccw) { nx = -nx; nz = -nz; }
            const bays = Math.max(1, Math.round(L / City.BAY));
            if (shop) { quad('butikk', a, b, H0, H0 + 4, bays, 0, 1, white, nx, nz); quad(st, a, b, H0 + 4, H, bays, 0, floors, col, nx, nz); }
            else quad(st, a, b, H0, H, L < 2 ? 0.4 : bays, 0, floors, col, nx, nz);
          }
          // tak: saltak på små, tilnærmet rektangulære hus – ellers flatt tak med takkant
          const r = minRect(pts), short = Math.min(r.w, r.d), long = Math.max(r.w, r.d);
          if (H < 14 && short >= 4 && long <= 40 && polyArea(pts) / r.area > .82 && st !== 'industri') {
            const along = r.w >= r.d, ca = Math.cos(r.a), sa = Math.sin(r.a), hw = (along ? r.w : r.d) / 2 + .5, hd = (along ? r.d : r.w) / 2 + .5, rh = clamp(short * .35, 1.6, 5);
            const ax = along ? [ca, sa] : [-sa, ca], ay = along ? [-sa, ca] : [ca, sa];
            const Pt = (u, v) => [r.cx + ax[0] * u + ay[0] * v, r.cz + ax[1] * u + ay[1] * v];
            const roofCol = new THREE.Color(['#9A4A36', '#7E3E30', '#4E5256', '#5D4A42', '#A35A40', '#3E4448'][Math.floor(hsh * 61) % 6]);
            const g = get('tegltak'), tri = (p1, p2, p3, y1, y2, y3) => { g.p.push(p1[0], y1, p1[1], p2[0], y2, p2[1], p3[0], y3, p3[1]); for (let k = 0; k < 3; k++) { g.n.push(0, 1, 0); g.c.push(roofCol.r, roofCol.g, roofCol.b); } g.uv.push(p1[0] / 4, p1[1] / 4, p2[0] / 4, p2[1] / 4, p3[0] / 4, p3[1] / 4); };
            const a1 = Pt(-hw, -hd), a2 = Pt(hw, -hd), a3 = Pt(hw, hd), a4 = Pt(-hw, hd), r1 = Pt(-hw, 0), r2 = Pt(hw, 0), top = H + rh;
            tri(a1, a2, r2, H, H, top); tri(a1, r2, r1, H, top, top); tri(a4, r1, r2, H, top, top); tri(a4, r2, a3, H, top, H);
            const gw = get(st); for (const [p, q, sg] of [[a1, a4, -1], [a2, a3, 1]]) { gw.p.push(p[0], H, p[1], q[0], H, q[1], (p[0] + q[0]) / 2, top, (p[1] + q[1]) / 2); for (let k = 0; k < 3; k++) { gw.n.push(ax[0] * sg, 0, ax[1] * sg); gw.c.push(col.r, col.g, col.b); } gw.uv.push(0, 0, 1, 0, .5, rh / City.FLOOR); }   // gavler
          } else {
            const tris = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), []), g = get('tak'), tc = 0.85 + hsh * 0.15;
            for (const t of tris) for (const j of t) { g.p.push(P[j][0], H + .05, P[j][1]); g.n.push(0, 1, 0); g.c.push(tc, tc, tc * 0.98); g.uv.push(P[j][0] / 12, P[j][1] / 12); }
          }
        }
      }
      City.clear();
      const grp = new THREE.Group();
      for (const st in B) {
        const d = B[st]; if (!d.p.length) continue; const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(d.c, 3));
        const m = new THREE.Mesh(geo, City.mat(st)); m.frustumCulled = false; grp.add(m);
      }
      City.mesh = grp; R.scene.add(grp); City.lastKey = key; City.setNight(City.night);
      if (R.roofs && R.roofs.mesh) R.roofs.mesh.visible = false;   // saltakene over er nå en del av husene
    } catch (e) { console.warn('bygg', e); }
    City.busy = false;
  },
  clear() { if (City.mesh) { R.scene.remove(City.mesh); City.mesh.traverse(o => o.geometry && o.geometry.dispose()); City.mesh = null; } City.lastKey = ''; }
};
