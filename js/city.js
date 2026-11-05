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
  /* Fasadeteksturer: ett felt = 2 vindusfag × 3 etasjer, med variasjon per vindu (persienner, gardiner, lys inne)
     så mønsteret ikke gjentar seg. specularMap = glassmaske (glass speiler himmelen), lit = vinduer som lyser om natten. */
  COLS: { butikk: 2, tak: 1, tegltak: 1, sokkel: 1, gesims: 1, port: 1, portamb: 1, inngang: 1 }, ROWS: { butikk: 1, tak: 1, tegltak: 1, sokkel: 1, gesims: 1, port: 1, portamb: 1, inngang: 1 },
  cols: st => City.COLS[st] || 2, rows: st => City.ROWS[st] || 3,
  makeTex(style) {
    const CW = 256, cols = City.cols(style), rows = City.rows(style), W = CW * cols, H = CW * rows;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const c = mk(), x = c.getContext('2d'), lit = mk(), l = lit.getContext('2d'), spc = mk(), sp = spc.getContext('2d');
    l.fillStyle = '#000'; l.fillRect(0, 0, W, H); sp.fillStyle = '#000'; sp.fillRect(0, 0, W, H);
    let seed = style.length * 977 + 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const noise = (a, n) => { for (let i = 0; i < (n || 2600); i++) { x.fillStyle = 'rgba(' + (rnd() < .5 ? '0,0,0' : '255,255,255') + ',' + (rnd() * a) + ')'; x.fillRect(rnd() * W, rnd() * H, 2, 2); } };
    const GLASS = [['#9DB9CC', '#3E5868'], ['#B5CAD6', '#566F7E'], ['#7E98AA', '#2E4250'], ['#C9D8E0', '#6F8796'], ['#8FA6B3', '#3A4C58']];
    const win = (px, py, w, h, frame, sill, opt) => {
      opt = opt || {}; const gl = GLASS[Math.floor(rnd() * GLASS.length)];
      if (frame) { x.fillStyle = frame; x.fillRect(px - 5, py - 5, w + 10, h + 10); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(px - 5, py + h + 3, w + 10, 2); }
      const g = x.createLinearGradient(0, py, 0, py + h); g.addColorStop(0, gl[0]); g.addColorStop(1, gl[1]); x.fillStyle = g; x.fillRect(px, py, w, h);
      sp.fillStyle = '#d0d0d0'; sp.fillRect(px, py, w, h);
      const r = rnd();
      if (r < .22) { const bh = h * (.25 + rnd() * .5); x.fillStyle = '#E8E2D2'; x.fillRect(px, py, w, bh); x.fillStyle = 'rgba(0,0,0,.12)'; for (let yy = py + 4; yy < py + bh; yy += 5) x.fillRect(px, yy, w, 1); sp.fillStyle = '#202020'; sp.fillRect(px, py, w, bh); }
      else if (r < .42) { const cc = ['#B85A4A', '#E8E0C8', '#5E7B6A', '#C9A35A', '#7A6A8E'][Math.floor(rnd() * 5)]; x.fillStyle = cc; x.fillRect(px, py, w * .22, h); x.fillRect(px + w * .78, py, w * .22, h); sp.fillStyle = '#202020'; sp.fillRect(px, py, w * .22, h); sp.fillRect(px + w * .78, py, w * .22, h); }
      else if (r < .5) { x.fillStyle = 'rgba(255,214,150,.55)'; x.fillRect(px + 3, py + h * .4, w - 6, h * .6 - 3); }   // lys inne på dagtid
      x.fillStyle = 'rgba(255,255,255,.16)'; x.beginPath(); x.moveTo(px, py); x.lineTo(px + w * .5, py); x.lineTo(px, py + h * .45); x.fill();
      if (frame && !opt.noBars) { x.fillStyle = frame; x.fillRect(px + w / 2 - 3, py, 6, h); if (!opt.noTransom) x.fillRect(px, py + h * .3, w, 5); }
      if (sill) { x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(px - 8, py + h + 5, w + 16, 6); x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(px - 8, py + h + 4, w + 16, 3);
        const st = x.createLinearGradient(0, py + h + 10, 0, py + h + 60); st.addColorStop(0, 'rgba(0,0,0,.08)'); st.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = st; x.fillRect(px - 4, py + h + 10, w + 8, 50); }   // regnstriper
      if (rnd() < .6) { l.fillStyle = rnd() < .5 ? 'rgba(255,205,130,1)' : 'rgba(255,228,175,.75)'; l.fillRect(px, py, w, h); }
    };
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);   // grunnfarge hvit: tones med byggets farge (vertexColors)
    const cells = fn => { for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { x.save(); sp.save(); l.save(); for (const k of [x, sp, l]) k.translate(i * CW, j * CW); fn(i, j); x.restore(); sp.restore(); l.restore(); } };
    switch (style) {
      case 'murgard':   // bygård: pusset fasade med fuger, høye vinduer, gesims mellom etasjene
        noise(.05); x.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < H; y += 9) x.fillRect(0, y, W, 1);
        cells(() => { win(78, 56, 100, 148, '#F4F0E6', true); x.fillStyle = 'rgba(0,0,0,.13)'; x.fillRect(0, 0, CW, 9); x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(0, 9, CW, 4); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(70, 40, 116, 8); }); break;
      case 'puss':
        noise(.035); cells(() => { win(66, 60, 124, 132, '#FBF8F2', true); x.fillStyle = 'rgba(0,0,0,.06)'; x.fillRect(0, CW - 6, CW, 6); }); break;
      case 'glass':
        { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#B8CCD8'); g.addColorStop(1, '#6E8898'); x.fillStyle = g; x.fillRect(0, 0, W, H); sp.fillStyle = '#e0e0e0'; sp.fillRect(0, 0, W, H);
          cells(() => { x.fillStyle = '#D9DEE0'; x.fillRect(0, 0, 7, CW); x.fillRect(0, 0, CW, 12); x.fillRect(CW / 2 - 3, 0, 6, CW); sp.fillStyle = '#000'; sp.fillRect(0, 0, 7, CW); sp.fillRect(0, 0, CW, 12);
            if (rnd() < .3) { x.fillStyle = 'rgba(232,226,210,.55)'; x.fillRect(8, 13, CW - 9, 60); } if (rnd() < .55) { l.fillStyle = 'rgba(255,232,185,.85)'; l.fillRect(8, 13, CW - 9, CW - 14); } }); } break;
      case 'moderne':
        x.fillStyle = 'rgba(0,0,0,.06)'; for (let i = 0; i < W; i += 32) x.fillRect(i, 0, 2, H);
        cells(() => { win(22, 72, 212, 108, '#3A3F42', false, { noTransom: true }); x.fillStyle = 'rgba(0,0,0,.1)'; x.fillRect(0, 196, CW, 8); }); break;
      case 'villa':
        x.fillStyle = 'rgba(0,0,0,.10)'; for (let y = 0; y < H; y += 14) x.fillRect(0, y, W, 2);
        cells(() => { win(46, 72, 62, 94, '#FBF8F2', false); win(148, 72, 62, 94, '#FBF8F2', false); x.fillStyle = '#FBF8F2'; x.fillRect(0, 0, 8, CW); }); break;
      case 'industri':
        for (let i = 0; i < W; i += 12) { x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(i, 0, 5, H); } noise(.05);
        cells((i, j) => { if ((i + j) % 2 === 0) win(98, 44, 60, 60, '#8A8F8C', false); }); break;
      case 'butikk':
        x.fillStyle = '#3C3A36'; x.fillRect(0, 0, W, H);
        cells(() => { const aw = ['#2F5D50', '#8C2F2A', '#2B3F66', '#C9A35A', '#4A4A4A'][Math.floor(rnd() * 5)]; x.fillStyle = aw; x.fillRect(0, 0, CW, 44); x.fillStyle = 'rgba(255,255,255,.8)'; x.fillRect(30, 16, 120 + rnd() * 60, 12);
          const g = x.createLinearGradient(0, 64, 0, 250); g.addColorStop(0, '#B3C8D2'); g.addColorStop(1, '#3E4E58'); x.fillStyle = g; x.fillRect(14, 64, 228, 192); sp.fillStyle = '#c0c0c0'; sp.fillRect(14, 64, 228, 192);
          x.fillStyle = 'rgba(255,214,150,.35)'; x.fillRect(14, 150, 228, 106); x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(124, 64, 8, 192);
          l.fillStyle = 'rgba(255,220,160,1)'; l.fillRect(14, 64, 228, 192); l.fillRect(0, 0, CW, 44); }); break;
      case 'port':      // seksjonsport til garasje (tones med vertexColors, f.eks. rød på brannstasjonen)
      case 'portamb': { // hvit port med gult/grønt rutebånd (ambulanse)
        x.fillStyle = '#3A3B3C'; x.fillRect(0, 0, W, H); x.fillStyle = style === 'port' ? '#ffffff' : '#F2F1EC'; x.fillRect(14, 20, W - 28, H - 20);
        for (let k = 0; k < 6; k++) { const y = 20 + k * (H - 20) / 6; x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(14, y, W - 28, 3); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(14, y + 3, W - 28, 2); }
        for (let i = 0; i < 4; i++) { x.fillStyle = '#4A6372'; x.fillRect(30 + i * 52, 70, 40, 26); sp.fillStyle = '#c0c0c0'; sp.fillRect(30 + i * 52, 70, 40, 26); l.fillStyle = 'rgba(255,225,170,1)'; l.fillRect(30 + i * 52, 70, 40, 26); }
        if (style === 'portamb') for (let i = 0; i < 16; i++) for (let r = 0; r < 2; r++) { x.fillStyle = (i + r) % 2 ? '#0E7A3A' : '#F2D21B'; x.fillRect(14 + i * (W - 28) / 16, 150 + r * 10, (W - 28) / 16 + 1, 10); }
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(W - 40, 170, 14, 6); break; }
      case 'inngang':   // inngangsparti i glass med dør
        { const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#A9C2CE'); g.addColorStop(1, '#4A5C66'); x.fillStyle = g; x.fillRect(0, 0, W, H); sp.fillStyle = '#d0d0d0'; sp.fillRect(0, 0, W, H);
          x.fillStyle = '#E4E6E6'; x.fillRect(0, 0, W, 10); x.fillRect(0, 0, 8, H); x.fillRect(W - 8, 0, 8, H); x.fillRect(W / 2 - 4, 30, 8, H - 30); x.fillRect(60, 30, W - 120, 8);
          l.fillStyle = 'rgba(255,230,190,1)'; l.fillRect(8, 10, W - 16, H - 10); } break;
      case 'sokkel':
        x.fillStyle = '#8E8B85'; x.fillRect(0, 0, W, H); noise(.15, 1500); x.fillStyle = 'rgba(0,0,0,.15)'; for (let i = 0; i < W; i += 64) x.fillRect(i, 0, 2, H); break;
      case 'gesims':
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, H * .7, W, H * .3); x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(0, H * .1, W, H * .08); break;
      case 'tak':
        x.fillStyle = '#8D8E8A'; x.fillRect(0, 0, W, H); noise(.18); x.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < W; i += 64) { x.fillRect(i, 0, 3, H); x.fillRect(0, i, W, 3); } break;
      case 'tegltak':
        for (let y = 0; y < H; y += 16) for (let i = (y / 16) % 2 ? 0 : 16; i < W; i += 32) { x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(i, y + 12, 30, 4); x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(i, y, 2, 16); } noise(.06); break;
    }
    const tex = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
    return { map: tex(c), lit: tex(lit), spec: tex(spc) };
  },
  /** Himmel til speilinger i glass (enkel kube: blå himmel, lys horisont, mørkere by og bakke). */
  envMap() {
    if (City._env) return City._env;
    const face = (top) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      if (top === 1) { x.fillStyle = '#8DB8DF'; x.fillRect(0, 0, 128, 128); } else if (top === -1) { x.fillStyle = '#5E625E'; x.fillRect(0, 0, 128, 128); }
      else { const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#7FAEDB'); g.addColorStop(.45, '#CFE0EC'); g.addColorStop(.5, '#E9EEF0'); g.addColorStop(.52, '#7C8486'); g.addColorStop(1, '#4E5452'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
        x.fillStyle = 'rgba(70,78,82,.85)'; for (let i = 0; i < 128; i += 6) { const h = 4 + Math.random() * 14; x.fillRect(i, 64 - h, 5, h); }   // bysilhuett
        x.fillStyle = 'rgba(255,255,255,.55)'; for (let k = 0; k < 4; k++) { x.beginPath(); x.ellipse(Math.random() * 128, 18 + Math.random() * 30, 14 + Math.random() * 16, 4 + Math.random() * 4, 0, 0, TAU); x.fill(); } }
      return c; };
    const cube = new THREE.CubeTexture([face(0), face(0), face(1), face(-1), face(0), face(0)]); cube.needsUpdate = true; City._env = cube; return cube;
  },
  mat(style) {
    if (style === 'taksat') return SatAtlas.mat;
    if (City.tex[style]) return City.tex[style].m;
    const T = City.makeTex(style), roof = style === 'tak' || style === 'tegltak' || style === 'sokkel' || style === 'gesims';
    const m = new THREE.MeshLambertMaterial({ map: T.map, vertexColors: true, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: roof ? null : T.lit, emissiveIntensity: 0 });
    if (!roof) { m.envMap = City.envMap(); m.specularMap = T.spec; m.combine = THREE.MixOperation; m.reflectivity = style === 'glass' ? 0.75 : 0.6; }
    City.tex[style] = { m, T }; return m;
  },
  setNight(n) { City.night = n; for (const k in City.tex) { const m = City.tex[k].m; m.emissiveIntensity = m.emissiveMap ? n * 0.85 : 0; } },
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; },
  /* ---------- bygg som fjernes der spilleren har satt opp en stasjon ---------- */
  footprints() {
    if (typeof S === 'undefined' || !S || !R.world) return [];
    const out = []; for (const id in S.stations) { const st = S.stations[id], l = R.world.lotById.get(st.lotId), r = Stations.RADIUS[st.type]; if (l && r && !st.gift) out.push({ x: l.x, z: l.z, r }); }
    return out;
  },
  /** Treffer bygningsomrisset stasjonens tomt? (sentrum inne i bygget, eller bygget nær nok tomta) */
  hits(pts, cx, cz, fps) {
    for (const f of fps) {
      if (Math.hypot(cx - f.x, cz - f.z) < f.r) return true;
      let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > f.z) !== (b[1] > f.z) && f.x < (b[0] - a[0]) * (f.z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; }
      if (inside) return true;
      let near = 0; for (const p of pts) if (Math.hypot(p[0] - f.x, p[1] - f.z) < f.r * 0.85) near++; if (near >= Math.max(2, pts.length * 0.5)) return true;
    }
    return false;
  },
  removed: new Set(), removedKey: '',
  /** Skjuler de samme byggene i kartets egne 3D-bygg (via bygnings-id i kartflisene). */
  applyRemoved(ids) {
    const key = [...ids].sort().join(','); if (key === City.removedKey) return; City.removedKey = key; City.removed = new Set(ids);
    const map = R.map; if (!map) return; const list = [...ids].filter(v => v != null);
    for (const lid in R.bldBase) if (map.getLayer(lid)) map.setFilter(lid, list.length ? ['all', R.bldBase[lid], ['!', ['in', ['id'], ['literal', list]]]] : R.bldBase[lid]);
  },
  /** Finner byggene under stasjonene (kalles også når nærbildet ikke er aktivt). */
  removalPass(feats, w) {
    const fps = City.footprints(), ids = new Set(); if (!fps.length) { City.applyRemoved(ids); return fps; }
    for (const f of feats) {
      if (f.id == null || !f.geometry) continue; const g = f.geometry;
      for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])) {
        const q0 = w.proj.toXZ(poly[0][0][1], poly[0][0][0]); if (!fps.some(fp => Math.hypot(q0.x - fp.x, q0.z - fp.z) < fp.r + 120)) continue;
        const pts = poly[0].slice(0, -1).map(q => { const p = w.proj.toXZ(q[1], q[0]); return [p.x, p.z]; }); let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
        if (City.hits(pts, cx, cz, fps)) ids.add(f.id);
      }
    }
    City.applyRemoved(ids); return fps;
  },
  /** Bygg (eller bygg om) husene rundt kartsenteret. */
  update() {
    const map = R.map, w = R.world; if (!map || !w || !R.ready || City.busy || !map.getSource('om')) return;
    let fps = []; try { fps = City.removalPass(map.querySourceFeatures('om', { sourceLayer: 'building' }), w); } catch (e) { /* ignorer */ }
    const z = map.getZoom(); if (z < 14.3) { City.clear(); return; }
    const c = map.getCenter(), cp = w.proj.toXZ(c.lat, c.lng), rad = clamp(R.mpp * Math.max(R.w, R.h) * 1.1, 400, 1700);
    const key = Math.round(cp.x / 60) + ',' + Math.round(cp.z / 60) + ',' + Math.round(rad / 100) + '|' + fps.map(f => Math.round(f.x) + ':' + Math.round(f.z)).join(';');
    if (key === City.lastKey && City.mesh) return; City.busy = true;
    try {
      const feats = map.querySourceFeatures('om', { sourceLayer: 'building' }), seen = new Set(), B = {};
      const get = st => B[st] || (B[st] = { p: [], n: [], uv: [], c: [] });
      const col = new THREE.Color(), col2 = new THREE.Color();
      const quad = (st, a, b, h0, h1, u1, v0, v1, cr, nx, nz, ao) => {   // én veggflate (u1 = antall vindusfag, v = etasjer)
        const g = get(st), cu = City.cols(st), rw = City.rows(st), U = u1 / cu, V0 = v0 / rw, V1 = v1 / rw, d = ao ? 0.72 : 1;   // ao: mørkere nederst (skygge mot bakken)
        g.p.push(a[0], h0, a[1], b[0], h0, b[1], b[0], h1, b[1], a[0], h0, a[1], b[0], h1, b[1], a[0], h1, a[1]);
        for (const f of [d, d, 1, d, 1, 1]) { g.n.push(nx, 0, nz); g.c.push(cr.r * f, cr.g * f, cr.b * f); }
        g.uv.push(0, V0, U, V0, U, V1, 0, V0, U, V1, 0, V1);
      };
      const inst = { balk: [], rail: [], box: [] };   // detaljer som tegnes som instanser (balkonger, takbokser, piper)
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
          if (fps.length && City.hits(pts, cx, cz, fps)) continue;   // her står en av stasjonene dine
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
          const ground = H0 < 1, plinth = ground && !shop && st !== 'glass' && st !== 'industri', cornice = H - H0 > 7 && (st === 'murgard' || st === 'puss');
          const balc = (st === 'puss' || st === 'moderne') && H >= 9 && H < 45 && hsh > 0.35, corC = new THREE.Color().copy(col).multiplyScalar(0.92), stone = { r: .95, g: .94, b: .92 };
          for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.4) continue;
            let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L; if (!ccw) { nx = -nx; nz = -nz; }
            const bays = Math.max(1, Math.round(L / City.BAY)), off = (p, k) => [p[0] + nx * k, p[1] + nz * k];
            if (shop) { quad('butikk', a, b, H0, H0 + 4, bays, 0, 1, white, nx, nz, true); quad(st, a, b, H0 + 4, H, bays, 0, floors, col, nx, nz); }
            else quad(st, a, b, H0, H, L < 2 ? 0.4 : bays, 0, floors, col, nx, nz, ground);
            if (plinth && L > 1.5) quad('sokkel', off(a, .08), off(b, .08), 0, 0.85, L / 4, 0, 1, stone, nx, nz, true);
            if (cornice && L > 1.5) quad('gesims', off(a, .22), off(b, .22), H - .5, H - .05, L / 4, 0, 1, corC, nx, nz);
            // balkonger: annethvert vindusfag, fra 2. etasje
            if (balc && L >= 7 && inst.balk.length < 6000) {
              const f0 = shop ? 1 : 1, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, rot = Math.atan2(nx, nz);
              for (let k = 0; k < bays; k += 2) { const t = (k + .5) / bays, bx = a[0] + (b[0] - a[0]) * t, bz = a[1] + (b[1] - a[1]) * t;
                for (let fl = f0; fl < floors; fl++) { const y = H0 + (shop ? 4 : 0) + fl * (H - H0 - (shop ? 4 : 0)) / floors; inst.balk.push([bx + nx * .65, y, bz + nz * .65, rot]); inst.rail.push([bx + nx * 1.3, y + .55, bz + nz * 1.3, rot]); } }
            }
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
            if (hsh > 0.3) { const cpnt = Pt(hw * (hsh - .5) * 1.2, hd * .3); inst.box.push([cpnt[0], top - rh * .3 + .6, cpnt[1], .7, 1.6, .7, 0x8E5A48]); }   // pipe
            const gw = get(st); for (const [p, q, sg] of [[a1, a4, -1], [a2, a3, 1]]) { gw.p.push(p[0], H, p[1], q[0], H, q[1], (p[0] + q[0]) / 2, top, (p[1] + q[1]) / 2); for (let k = 0; k < 3; k++) { gw.n.push(ax[0] * sg, 0, ax[1] * sg); gw.c.push(col.r, col.g, col.b); } gw.uv.push(0, 0, 1, 0, .5, rh / City.FLOOR); }   // gavler
          } else {
            const tris = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), []), sat = atlas.uv(w, cx, cz), g = get(sat ? 'taksat' : 'tak'), tc = 0.85 + hsh * 0.15;
            for (const t of tris) for (const j of t) { g.p.push(P[j][0], H + .05, P[j][1]); g.n.push(0, 1, 0); g.c.push(tc, tc, tc * 0.98); const q = sat && atlas.uv(w, P[j][0], P[j][1]); if (q) g.uv.push(q[0], q[1]); else g.uv.push(P[j][0] / 12, P[j][1] / 12); }
            if (A > 220 && inst.box.length < 4000) {   // ventilasjon og trappehus
              const ca = Math.cos(r.a), sa = Math.sin(r.a), nb = 1 + Math.floor(hsh * 3);
              for (let q = 0; q < nb; q++) { const u = (City.hash(k + q) - .5) * r.w * .5, v = (City.hash(k + 'v' + q) - .5) * r.d * .5; inst.box.push([r.cx + ca * u - sa * v, H + .6, r.cz + sa * u + ca * v, 2.2, 1.2, 1.4, 0x9DA3A6, r.a]); }
              if (H > 12) inst.box.push([r.cx, H + 1.3, r.cz, 3.2, 2.6, 3.2, 0xB9B4AA, r.a]);
            }
            if (H - H0 > 6) { const gp = get('tak'); for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; gp.p.push(a[0], H, a[1], b[0], H, b[1], b[0], H + .7, b[1], a[0], H, a[1], b[0], H + .7, b[1], a[0], H + .7, a[1]); for (let k = 0; k < 6; k++) { gp.n.push(0, 1, 0); gp.c.push(col.r * .9, col.g * .9, col.b * .9); } gp.uv.push(0, 0, 1, 0, 1, .1, 0, 0, 1, .1, 0, .1); } }   // takkant
          }
        }
      }
      City.clear();
      const grp = new THREE.Group();
      City.trees(grp, w, cp, rad);
      // balkonger (betongplate + glassrekkverk) og takbokser som instanser
      const boxG = R.geo('box', () => new THREE.BoxGeometry(1, 1, 1)), addInst = (list, mat, sx, sy, sz) => {
        if (!list.length) return; const m = new THREE.InstancedMesh(boxG, mat, list.length), cc = new THREE.Color();
        list.forEach((it, i) => { _v3.set(it[0], it[1], it[2]); _q.setFromAxisAngle(_up, it[7] != null ? -it[7] : it[3] || 0); _s3.set(sx || it[3], sy || it[4], sz || it[5]); if (!sx) _q.setFromAxisAngle(_up, -(it[7] || 0)); _m4.compose(_v3, _q, _s3); m.setMatrixAt(i, _m4); if (!sx) { cc.setHex(it[6]); m.setColorAt(i, cc); } });
        m.frustumCulled = false; m.castShadow = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; grp.add(m);
      };
      addInst(inst.balk, R.mat(0xD9D6CE), 2.6, 0.2, 1.3);
      addInst(inst.rail, City.railMat || (City.railMat = new THREE.MeshLambertMaterial({ color: 0x9FB3BE, transparent: true, opacity: 0.55, side: THREE.DoubleSide })), 2.6, 1.0, 0.06);
      addInst(inst.box, City.boxMat || (City.boxMat = new THREE.MeshLambertMaterial({ color: 0xffffff })));
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
