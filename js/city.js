'use strict';
/* ==========================================================================
   5b. BYGNINGER I NÆRBILDE – tegnes av Three.js ut fra de ekte byggeomrissene i kartdataene
   Rundt kameraet bygges hvert hus med riktig høyde og etasjer (≈ 3 m), vindusfag (≈ 3,2 m),
   butikkfronter på gateplan i sentrum, flate tak med takkant eller saltak på småhus.
   Farger: byggets egen farge fra kartdataene der den finnes, ellers en typisk norsk bypalett.
   Lenger unna tegner MapLibre byggene som enkle blokker med vindusmønster.
   ========================================================================== */
/** Satellittbilder (samme som bakkekartet) samlet i én tekstur rundt kameraet, slik at takene viser de ekte takene. */
const SatAtlas = {
  z: 17, key: '', tex: null, mat: null, tx0: 0, ty0: 0, W: 1, H: 1, ok: false,
  mx(lon) { return (lon + 180) / 360 * Math.pow(2, this.z) * 256; },
  my(lat) { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, this.z) * 256; },
  ensure(w, cp, rad) {
    const R_ = Math.min(rad, 640), a = w.proj.toLL(cp.x - R_, cp.z - R_), b = w.proj.toLL(cp.x + R_, cp.z + R_);
    const tx0 = Math.floor(this.mx(a.lon) / 256), tx1 = Math.floor(this.mx(b.lon) / 256), ty0 = Math.floor(this.my(a.lat) / 256), ty1 = Math.floor(this.my(b.lat) / 256);
    const key = [tx0, ty0, tx1, ty1].join(','); if (key === this.key) return this;
    const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1; if (nx * ny > 100) { this.ok = false; return this; }
    this.key = key; this.tx0 = tx0; this.ty0 = ty0; this.W = nx * 256; this.H = ny * 256; this.ok = true;
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; const x = c.getContext('2d'); x.fillStyle = '#8D8E8A'; x.fillRect(0, 0, c.width, c.height);
    if (!this.tex) { this.tex = new THREE.CanvasTexture(c); this.tex.anisotropy = 8; this.mat = new THREE.MeshLambertMaterial({ map: this.tex, side: THREE.DoubleSide }); }
    else { this.tex.image = c; this.tex.needsUpdate = true; }
    const myKey = key;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { if (this.key !== myKey) return; x.drawImage(img, i * 256, j * 256); this.tex.needsUpdate = true; };
      img.src = SAT_URL.replace('{z}', this.z).replace('{x}', tx0 + i).replace('{y}', ty0 + j);
    }
    return this;
  },
  uv(w, x, z) { if (!this.ok) return null; const ll = w.proj.toLL(x, z), u = (this.mx(ll.lon) - this.tx0 * 256) / this.W, v = 1 - (this.my(ll.lat) - this.ty0 * 256) / this.H; return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v]; }
};

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
    if (style === 'taksat') return SatAtlas.mat;
    if (City.tex[style]) return City.tex[style].m;
    const T = City.makeTex(style), m = new THREE.MeshLambertMaterial({ map: T.map, vertexColors: true, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: style === 'tak' || style === 'tegltak' ? null : T.lit, emissiveIntensity: 0 });
    City.tex[style] = { m, T }; return m;
  },
  setNight(n) { City.night = n; for (const k in City.tex) { const m = City.tex[k].m; m.emissiveIntensity = m.emissiveMap ? n * 0.85 : 0; } },
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; },
  /** Bygg (eller bygg om) husene rundt kartsenteret. */
  update() {
    const map = R.map, w = R.world; if (!map || !w || !R.ready || City.busy || !map.getSource('om')) return;
    const z = map.getZoom(); if (z < 14.3) { City.clear(); return; }
    const c = map.getCenter(), cp = w.proj.toXZ(c.lat, c.lng), rad = clamp(R.mpp * Math.max(R.w, R.h) * 1.1, 400, 1700);
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
      let n = 0; const atlas = SatAtlas.ensure(w, cp, rad);
      for (const f of feats) {
        if (n > 9000) break;
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
            const sat = atlas.uv(w, r.cx, r.cz), g = get(sat ? 'taksat' : 'tegltak'), tri = (p1, p2, p3, y1, y2, y3) => { g.p.push(p1[0], y1, p1[1], p2[0], y2, p2[1], p3[0], y3, p3[1]); for (let k = 0; k < 3; k++) { g.n.push(0, 1, 0); g.c.push(roofCol.r, roofCol.g, roofCol.b); } for (const q of [p1, p2, p3]) { const t = sat && atlas.uv(w, q[0], q[1]); if (t) g.uv.push(t[0], t[1]); else g.uv.push(q[0] / 4, q[1] / 4); } };
            const a1 = Pt(-hw, -hd), a2 = Pt(hw, -hd), a3 = Pt(hw, hd), a4 = Pt(-hw, hd), r1 = Pt(-hw, 0), r2 = Pt(hw, 0), top = H + rh;
            tri(a1, a2, r2, H, H, top); tri(a1, r2, r1, H, top, top); tri(a4, r1, r2, H, top, top); tri(a4, r2, a3, H, top, H);
            const gw = get(st); for (const [p, q, sg] of [[a1, a4, -1], [a2, a3, 1]]) { gw.p.push(p[0], H, p[1], q[0], H, q[1], (p[0] + q[0]) / 2, top, (p[1] + q[1]) / 2); for (let k = 0; k < 3; k++) { gw.n.push(ax[0] * sg, 0, ax[1] * sg); gw.c.push(col.r, col.g, col.b); } gw.uv.push(0, 0, 1, 0, .5, rh / City.FLOOR); }   // gavler
          } else {
            const tris = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), []), sat = atlas.uv(w, cx, cz), g = get(sat ? 'taksat' : 'tak'), tc = 0.85 + hsh * 0.15;
            for (const t of tris) for (const j of t) { g.p.push(P[j][0], H + .05, P[j][1]); g.n.push(0, 1, 0); g.c.push(tc, tc, tc * 0.98); const q = sat && atlas.uv(w, P[j][0], P[j][1]); if (q) g.uv.push(q[0], q[1]); else g.uv.push(P[j][0] / 12, P[j][1] / 12); }
            if (H - H0 > 6) { const gp = get('tak'); for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; gp.p.push(a[0], H, a[1], b[0], H, b[1], b[0], H + .7, b[1], a[0], H, a[1], b[0], H + .7, b[1], a[0], H + .7, a[1]); for (let k = 0; k < 6; k++) { gp.n.push(0, 1, 0); gp.c.push(col.r * .9, col.g * .9, col.b * .9); } gp.uv.push(0, 0, 1, 0, 1, .1, 0, 0, 1, .1, 0, .1); } }   // takkant
          }
        }
      }
      City.clear();
      const grp = new THREE.Group();
      City.trees(grp, w, cp, rad);
      for (const st in B) {
        const d = B[st]; if (!d.p.length) continue; const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(d.c, 3));
        const m = new THREE.Mesh(geo, City.mat(st)); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = false; grp.add(m);
      }
      City.mesh = grp; R.scene.add(grp); City.lastKey = key; City.setNight(City.night);
      if (R.roofs && R.roofs.mesh) R.roofs.mesh.visible = false;   // saltakene over er nå en del av husene
    } catch (e) { console.warn('bygg', e); }
    City.busy = false;
  },
  /** Trær i parker og skog (fra kartdataene), farget etter årstid. */
  trees(grp, w, cp, rad) {
    const map = R.map, pts = [], R2 = Math.min(rad, 900);
    for (const [layer, filt, dens] of [['park', () => true, 1 / 260], ['landcover', p => p.class === 'wood', 1 / 140], ['landcover', p => p.class === 'grass', 1 / 1400]]) {
      let feats = []; try { feats = map.querySourceFeatures('om', { sourceLayer: layer }); } catch (e) { continue; }
      for (const f of feats) {
        if (!filt(f.properties || {}) || !f.geometry) continue; const g = f.geometry;
        for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])) {
          const ring = poly[0].map(q => { const p = w.proj.toXZ(q[1], q[0]); return [p.x, p.z]; }); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
          for (const q of ring) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
          x0 = Math.max(x0, cp.x - R2); x1 = Math.min(x1, cp.x + R2); z0 = Math.max(z0, cp.z - R2); z1 = Math.min(z1, cp.z + R2); if (x1 <= x0 || z1 <= z0) continue;
          let nT = Math.min(600, Math.round((x1 - x0) * (z1 - z0) * dens)), seed = Math.abs(Math.round(x0 * 13 + z0 * 7)) + 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
          for (let k = 0; k < nT && pts.length < 3500; k++) { const px = x0 + rnd() * (x1 - x0), pz = z0 + rnd() * (z1 - z0); let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pz) !== (b[1] > pz) && px < (b[0] - a[0]) * (pz - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } if (c) pts.push([px, pz, rnd(), rnd()]); }
        }
      }
    }
    if (!pts.length) return;
    const season = R.seasonIdx || 0, N = pts.length;
    const trunk = new THREE.InstancedMesh(R.geo('trunkT', () => new THREE.CylinderGeometry(0.18, 0.28, 1, 6)), R.mat(0x6B4F36), N);
    const crown = new THREE.InstancedMesh(R.geo('crownT', () => new THREE.IcosahedronGeometry(1, 1)), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), N);
    const cone = new THREE.InstancedMesh(R.geo('coneT', () => new THREE.ConeGeometry(1, 2.4, 7)), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), N);
    const cols = [['#8DBB5A', '#A3C96B', '#7FAE4E'], ['#4F7F3A', '#5D8C3F', '#46733A', '#66944A'], ['#D98A2B', '#E3B23C', '#B9542B', '#8F9A3E', '#C9772B'], ['#7A6A58', '#857463']][season];
    const c = new THREE.Color(); let nd = 0, nc = 0;
    for (const [x, z, r1, r2] of pts) {
      const h = 6 + r1 * 9, conifer = r2 < 0.28;
      _v3.set(x, h * 0.25, z); _q.identity(); _s3.set(1 + r1 * .4, h * 0.5, 1 + r1 * .4); _m4.compose(_v3, _q, _s3); trunk.setMatrixAt(nd + nc, _m4);
      if (conifer) { _v3.set(x, h * 0.62, z); _s3.set(1.8 + r1 * 1.4, h * 0.32, 1.8 + r1 * 1.4); _m4.compose(_v3, _q, _s3); cone.setMatrixAt(nc, _m4); c.set(season === 3 ? '#3E5C44' : '#355E3B').offsetHSL(0, 0, r1 * .06 - .03); cone.setColorAt(nc, c); nc++; }
      else { const cr = season === 3 ? 0.001 : 2.6 + r1 * 2.2; _v3.set(x, h * 0.7, z); _s3.set(cr, cr * 0.9, cr); _m4.compose(_v3, _q, _s3); crown.setMatrixAt(nd, _m4); c.set(cols[Math.floor(r2 * 97) % cols.length]).offsetHSL(0, 0, r1 * .08 - .04); crown.setColorAt(nd, c); nd++; }
    }
    crown.count = nd; cone.count = nc; trunk.count = Math.min(N, nd + nc);
    for (const m of [trunk, crown, cone]) { m.frustumCulled = false; m.castShadow = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; grp.add(m); }
  },
  /** Skygger fra sola: lyset følger kameraet, bakken under byen tar imot skygger. */
  shadows() {
    const r = R.renderer; if (!r || City.shadowInit) return; City.shadowInit = true;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const L = R.sun, ms = Game.lowGfx ? 1024 : 2048; L.castShadow = true; L.shadow.mapSize.set(ms, ms); L.shadow.bias = -0.0004; L.shadow.normalBias = 1.2; L.shadow.radius = 3;
    R.scene.add(L.target);
    // bakken som tar imot skygger: skyggen tones mykt ut mot kanten i stedet for å slutte med en skarp firkant
    const mat = new THREE.ShadowMaterial({ opacity: 0.28 }); mat.depthWrite = false;
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLoc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position.xy;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLoc;').replace(/}\s*$/, '  gl_FragColor.a *= 1.0 - smoothstep(0.32, 0.5, length(vLoc));\n}');
    };
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); g.rotation.x = -Math.PI / 2; g.position.y = 0.12; g.receiveShadow = true; g.frustumCulled = false; g.renderOrder = 1; City.ground = g; R.scene.add(g);
  },
  frame() {
    if (!R.renderer || !R.world) return; City.shadows();
    const L = R.sun, on = !Game.lowGfx && (R.env.daylight || 0) > 0.3 && R.map.getZoom() > 14.5 && !!R.sunDir; L.castShadow = on; City.ground.visible = on; if (!on) return;
    const span = clamp(R.mpp * Math.max(R.w, R.h) * 0.75, 120, 900), d = R.sunDir;
    // lyset følger kameraet i hele skyggepiksler, så skyggene ikke flimrer når kartet flyttes
    const texel = 2 * span / L.shadow.mapSize.x, tx = Math.round(R.cam.tx / texel) * texel, tz = Math.round(R.cam.tz / texel) * texel;
    L.target.position.set(tx, 0, tz); L.position.set(tx + d.x * 1500, d.y * 1500, tz + d.z * 1500);
    const sc = L.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 10; sc.far = 3500; sc.updateProjectionMatrix();
    City.ground.position.set(tx, 0.12, tz); City.ground.scale.set(span * 2, span * 2, 1);
  },
  clear() { if (City.mesh) { R.scene.remove(City.mesh); City.mesh.traverse(o => o.geometry && o.geometry.dispose()); City.mesh = null; } City.lastKey = ''; }
};
