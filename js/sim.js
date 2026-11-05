'use strict';

/* ==========================================================================
   6. ÅRSTIDER, TID OG VÆR  (+ spilltilstand, hendelsesbuss og samband-logg)
   ========================================================================== */
let S = null;        // aktiv spilltilstand – ren JSON, kan lagres direkte
let WORLD = null;    // generert by (bygges fra seed, lagres ikke)
const BASE_SPEED = 620;         // meter per spillminutt ≈ 37 km/t snitt i by (med blålys ≈ 45 km/t, hovedveier raskere)
const BISTAND_COST = { brann: 12000, politi: 9000, ambulanse: 10000, frivillig: 6000 };

const Bus = { l: {}, on(n, f) { (this.l[n] = this.l[n] || []).push(f); }, emit(n, d) { (this.l[n] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); } };

function newStats() {
  return { solved: 0, failed: 0, income: 0, costs: 0, grant: 0, falseAlarms: 0, lives: 0, lost: 0, bistand: 0, alarmsOk: 0, alarmsFail: 0, samv: 0,
    byAg: { brann: { n: 0, rt: 0, ok: 0 }, politi: { n: 0, rt: 0, ok: 0 }, ambulanse: { n: 0, rt: 0, ok: 0 }, frivillig: { n: 0, rt: 0, ok: 0 } }, days: {}, readyHist: [] };
}
function newState(cityId, first, startSeason) {
  const cfg = CITY_CONFIGS[cityId];
  const s = {
    v: 3, city: cityId, t: 0, startSeason: startSeason || 0, startHour: 7, money: cfg.startCash || 650000, xp: 0, level: 1, speed: 1, paused: true, first,
    agencies: { brann: false, politi: false, ambulanse: false }, ops: { brann: 1, politi: 1, ambulanse: 1 }, up: { brann: 0, politi: 0, ambulanse: 0 },
    stations: {}, units: {}, incidents: {}, occ: {}, done: [], nid: 1,
    vol: { rk: false, nf: false, rs: false, strand: false, bookings: [] }, staff: [], calls: [], beaches: {}, evAct: {},
    net: { masts: {}, termLevel: 0, alarms: [], tgPrio: { BRANN: 2, POLITI: 2, HELSE: 2, REDNING: 3, SAMVIRKE: 1 }, mobile: 0, samv: 0 },
    weather: { kind: 'klar', until: 0 }, stats: newStats(), perf: 0.75, volBonus: 0, log: [], nextSpawn: 4, flags: {}, settings: { auto: false, cover: false }, acc: 0, lastDay: -1
  };
  s.agencies[first] = true;
  return s;
}

/* ---------- logg (samband-logg i Nødnett-stil) ---------- */
const Log = {
  add(tg, from, msg, kind) {
    const e = { t: S.t, abs: Clock.abs(), tg, from, msg, kind: kind || 'info' };
    S.log.push(e); if (S.log.length > 320) S.log.splice(0, 80);
    Bus.emit('log', e); return e;
  },
  fmt(e) { return '[' + e.tg + '] ' + e.from + ': ' + e.msg; }
};

/* ---------- klokke, årstider og vær ---------- */
const Clock = {
  cur: null,
  abs() { return S.startSeason * DPS * MIN_DAY + S.startHour * 60 + S.t; },
  info() {
    const abs = this.abs(), day = Math.floor(abs / MIN_DAY), mod = abs % MIN_DAY, hour = mod / 60;
    const season = Math.floor(day / DPS) % 4, sun = SEASONS[season].sun;
    let dl = smooth(sun[0] - 0.9, sun[0] + 0.5, hour) * (1 - smooth(sun[1] - 0.5, sun[1] + 0.9, hour));
    if (season === 1) dl = Math.max(dl, 0.24);
    const dayNo = Math.floor((S.startHour * 60 + S.t) / MIN_DAY) + 1;
    this.cur = { abs, day, mod, hour, season, dis: day % DPS, year: Math.floor(day / (DPS * 4)), daylight: dl, sunrise: sun[0], sunset: sun[1], dayNo, sid: SEASONS[season].id };
    return this.cur;
  },
  tod(hour) { return (hour >= 22 || hour < 5) ? 'natt' : ((hour >= 7 && hour < 9.5) || (hour >= 15 && hour < 18)) ? 'rush' : (hour >= 18 && hour < 22) ? 'kveld' : 'dag'; },
  label() { const c = this.cur || this.info(); return SEASONS[c.season].navn + ' · dag ' + c.dayNo; },
  dayOfWeek() { return ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'][(this.cur ? this.cur.day : 0) % 7]; }
};
function updateWeather() {
  const info = Clock.cur;
  if (S.t < S.weather.until) return;
  const cw = (WORLD.cfg.weather || {})[info.sid] || {}, r = Math.random();
  const pS = cw.storm || 0, pN = cw['snø'] || 0, pR = cw.regn || 0;
  const kind = r < pS ? 'storm' : r < pS + pN ? 'snø' : r < pS + pN + pR ? 'regn' : 'klar';
  const changed = kind !== S.weather.kind;
  S.weather = { kind, until: S.t + rr(80, 260) };
  if (changed && S.t > 0) Bus.emit('toast', { msg: 'Været endrer seg: ' + WEATHER[kind].navn.toLowerCase(), kind: 'info' });
}
function tplMods(tpl, info) {
  let m = 1;
  if (tpl.hours && (info.hour < tpl.hours[0] || info.hour >= tpl.hours[1])) return 0;   // f.eks. strandhendelser bare på dagtid
  const sm = tpl.season && tpl.season[info.sid]; if (sm !== undefined) m *= sm;
  const tm = tpl.tod && tpl.tod[Clock.tod(info.hour)]; if (tm !== undefined) m *= tm;
  const wm = tpl.wx && tpl.wx[S.weather.kind]; if (wm !== undefined) m *= wm;
  for (const tg of (tpl.tags || [])) { const cm = WORLD.cfg.incidentMul[tg]; if (cm !== undefined) m *= cm; }
  return m;
}

/* ==========================================================================
   7. NØDNETT – basestasjoner (master), dekning, kapasitet, talegrupper, nødknapp og utfall
   ========================================================================== */
const TG_NAMES = { BRANN: 'Brann', POLITI: 'Politi', HELSE: 'Helse', REDNING: 'Frivillige / Redning' };
const BASE_RADIUS = 1150;       // meter
function tgOf(u) {
  const inc = u.job && S.incidents[u.job.inc];
  if (inc && inc.tg) return inc.tg;
  const o = u.org === 'bistand' ? UT[u.type].org : u.org;
  return (AGENCIES[o] || AGENCIES.brann).tg;
}
const Net = {
  dirty: true,
  /** Oppretter faste master fra byconfig. */
  init() {
    for (const m of WORLD.mastDefs) {
      const lot = WORLD.lotById.get(m.lotId);
      S.net.masts[m.id] = this.make({ id: m.id, navn: m.navn, lot, ground: true, rmul: m.rmul });
      S.occ[lot.id] = S.occ[lot.id] || 'mast';
    }
  },
  make(o) {
    const lot = o.lot;
    return { id: o.id, navn: o.navn, x: lot.x, z: lot.z, lotId: lot.id, baseY: 0, radius: BASE_RADIUS * (o.rmul || 1), cap: 8, level: 0, down: false, repairAt: 0, mobile: false, load: 0, calls: 0 };
  },
  weakMul(x, z) {
    let m = 1;
    for (const zn of WORLD.weak) { const d = zn.r - Math.hypot(x - zn.x, z - zn.z); if (d > -250) m *= lerp(1, zn.mul, smooth(-250, 250, d)); }
    return m;
  },
  signalAt(x, z) {
    let best = 0;
    for (const id in S.net.masts) {
      const m = S.net.masts[id]; if (m.down) continue;
      const d = Math.hypot(x - m.x, z - m.z); if (d >= m.radius) continue;
      const s = Math.pow(1 - d / m.radius, 0.85); if (s > best) best = s;
    }
    return best * this.weakMul(x, z);
  },
  servingMast(x, z) {
    let best = null, bs = 0;
    for (const id in S.net.masts) { const m = S.net.masts[id]; if (m.down) continue; const d = Math.hypot(x - m.x, z - m.z); if (d >= m.radius) continue; const s = 1 - d / m.radius; if (s > bs) { bs = s; best = m; } }
    return best;
  },
  quality(s) { return s >= 0.26 ? 'bra' : s >= 0.07 ? 'svak' : 'ingen'; },
  /** Ordre-forsinkelse i minutter avhenger av dekning og terminalnivå. */
  commDelay(u) {
    const f = [1.8, 1, 0.75, 0.55][S.net.termLevel] || 1, q = u.bistand ? 'bra' : (u.contact || 'bra');   // nivå 0 = analog VHF
    return f * (q === 'bra' ? 0.25 : q === 'svak' ? 1.1 : 3.4);
  },
  prio(tg) { return S.net.tgPrio[tg.startsWith('SAMVIRKE') ? 'SAMVIRKE' : tg] || 2; },
  groups() {
    const g = {}; for (const k of Object.keys(TG_NAMES)) g[k] = [];
    for (const id in S.units) { const u = S.units[id], tg = tgOf(u); if (u.vis === false) continue; (g[tg] = g[tg] || []).push(u); }
    return g;
  },
  samvMax() { let cap = 0; for (const id in S.net.masts) if (!S.net.masts[id].down) cap += S.net.masts[id].cap; return Math.max(1, Math.floor(cap / 9)); },
  samvActive() { return Object.values(S.incidents).filter(i => i.tg && i.state !== 'ferdig' && i.state !== 'feilet'); },
  /** Faste samvirke-talegrupper (SAMVIRKE 1 … n). Hendelser låner en ledig gruppe i stedet for å opprette nye. */
  samvFree() { const used = new Set(this.samvActive().map(i => i.tg)); for (let k = 1; k <= this.samvMax(); k++) if (!used.has('SAMVIRKE ' + k)) return 'SAMVIRKE ' + k; return null; },
  vhf() { return !S.net.termLevel; },
  techName() { return S.net.termLevel ? 'Nødnett (terminalnivå ' + S.net.termLevel + ')' : 'Analog VHF'; },
  /** Hovedoppdatering: utfall, kontakt og belastning. */
  update(dt) {
    const info = Clock.cur;
    // utfall og reparasjon
    for (const id in S.net.masts) {
      const m = S.net.masts[id];
      if (m.down && S.t >= m.repairAt) { m.down = false; this.dirty = true; Log.add('NØDNETT', 'Driftssentral', 'Basestasjon ' + m.navn + ' er reparert – dekning gjenopprettet', 'info'); Bus.emit('toast', { msg: 'Basestasjon ' + m.navn + ' er tilbake', kind: 'net' }); }
    }
    if (S.level >= 2 && S.t > 150 && !Object.values(S.net.masts).some(m => m.down)) {
      const sm = [1, 0.6, 3.2, 2.2][info.season] * (S.weather.kind === 'storm' ? 9 : 1);
      for (const id in S.net.masts) { const m = S.net.masts[id]; if (!m.mobile && Math.random() < 0.00004 * sm * dt) { this.outage(m, S.weather.kind === 'storm' ? 'storm' : 'strømbrudd'); break; } }
    }
    // kontakt per enhet
    for (const id in S.units) {
      const u = S.units[id]; if (u.vis === false || u.bistand) { u.contact = 'bra'; continue; }
      const sig = this.signalAt(u.x, u.z); u.sig = sig;
      let q = this.quality(sig);
      if (u.status === 'ledig' && (u.stationId || u.type === 'livredder')) q = 'bra';   // på stasjonen/tårnet: fast samband
      else if (u.dropUntil && u.dropUntil > S.t) q = 'ingen';
      else if (q === 'svak' && u.status !== 'ledig' && Math.random() < (S.net.termLevel >= 2 ? 0.003 : S.net.termLevel ? 0.011 : 0.03) * dt) { u.dropUntil = S.t + rr(1.5, 4); q = 'ingen'; }
      u.cong = false;
      u._q = q;
    }
    // belastning per mast, prioritering av talegrupper
    const calls = {};
    for (const id in S.net.masts) calls[id] = [];
    for (const id in S.units) {
      const u = S.units[id]; if (u.vis === false || u.bistand || u._q === 'ingen' || u.status === 'ledig' || u.status === 'ute') continue;
      const m = this.servingMast(u.x, u.z); if (m) calls[m.id].push({ u, p: this.prio(tgOf(u)) });
    }
    for (const inc of this.samvActive()) { const m = this.servingMast(inc.loc.x, inc.loc.z); if (m) { calls[m.id].push({ u: null, p: 0 }, { u: null, p: 0 }); } }
    for (const id in S.net.masts) {
      const m = S.net.masts[id], arr = calls[id]; m.calls = arr.length; m.load = m.down ? 0 : arr.length / m.cap;
      if (arr.length > m.cap) { arr.sort((a, b) => a.p - b.p); for (let i = m.cap; i < arr.length; i++) if (arr[i].u) { arr[i].u._q = 'ingen'; arr[i].u.cong = true; } }
    }
    for (const id in S.units) {
      const u = S.units[id]; if (u.vis === false || u.bistand) continue;
      const q = u._q || 'bra', prev = u.contact;
      u.contact = q; if (q !== 'ingen') u.lastKnown = { x: u.x, z: u.z };
      if (prev && prev !== q) {
        if (q === 'ingen') Log.add('NØDNETT', u.name, u.cong ? 'Mistet kontakt – nettet er overbelastet' : 'Mistet kontakt – ingen dekning', 'warn');
        else if (prev === 'ingen') Log.add('NØDNETT', u.name, 'Kontakt gjenopprettet', 'info');
      }
    }
    // nødknapp-frister
    for (const al of S.net.alarms) if (!al.done && S.t >= al.deadline) Sim.alarmFail(al);
    if (S.net.alarms.length > 30) S.net.alarms = S.net.alarms.filter(a => !a.done || S.t - a.t0 < 40);
  },
  outage(m, cause) {
    m.down = true; m.repairAt = S.t + rr(14, 26); this.dirty = true;
    Log.add('NØDNETT', 'Driftssentral', 'Basestasjon ' + m.navn + ' er utfallen (' + cause + ') – området mister dekning', 'alarm');
    Bus.emit('toast', { msg: 'Utfall: basestasjon ' + m.navn + ' er nede – ' + cause, kind: 'bad' });
  },
  fastRepair(m) {
    const cost = 12000; if (!m.down || S.money < cost) return false;
    S.money -= cost; S.stats.costs += cost; m.repairAt = S.t + (m.repairAt - S.t) * 0.35; return true;
  },
  status() {
    const ms = Object.values(S.net.masts), down = ms.filter(m => m.down).length, maxLoad = Math.max(0, ...ms.map(m => m.load));
    const lost = Object.values(S.units).filter(u => u.vis !== false && u.contact === 'ingen' && u.status !== 'ledig').length;
    if (down || maxLoad > 1 || lost > 1) return 'r';
    if (maxLoad > 0.75 || lost) return 'y';
    return 'g';
  },
  coverage() {  // andel av veinettet (prøvepunkter) med dekning
    const pts = WORLD.sample; let ok = 0;
    for (const p of pts) if (this.quality(this.signalAt(p.x, p.z)) !== 'ingen') ok++;
    return pts.length ? ok / pts.length : 0;
  },
  addMast(lotId) {
    const lot = WORLD.lotById.get(lotId), id = 'm' + (S.nid++);
    S.net.masts[id] = this.make({ id, navn: 'Ny mast ' + (Object.keys(S.net.masts).length + 1), lot, ground: true });
    S.net.masts[id].navn = (lot.name || (lot.addr || 'Ny mast').replace(/ \d+$/, ''));
    S.occ[lotId] = 'mast'; this.dirty = true; return id;
  },
  deployMobile(x, z) {
    const id = 'mm' + (S.nid++);
    S.net.masts[id] = { id, navn: 'Mobil basestasjon', x, z, lotId: null, baseY: Math.max(0, WORLD.heightAt(x, z)), radius: 520, cap: 4, level: 0, down: false, repairAt: 0, mobile: true, load: 0, calls: 0 };
    S.net.mobile--; this.dirty = true; return id;
  },
  recall(id) { const m = S.net.masts[id]; if (!m || !m.mobile) return; delete S.net.masts[id]; S.net.mobile++; this.dirty = true; },
  upgrade(id) { const m = S.net.masts[id]; if (!m || m.level >= 3) return false; m.level++; m.cap += 4; return true; },
  /** Nødknapp: mannskaper i fare utløser alarm med høyeste prioritet. */
  triggerAlarm(u, inc) {
    const al = { id: S.nid++, unitId: u.id, incId: inc.id, t0: S.t, deadline: S.t + 9, done: false, ok: false, helpers: [] };
    S.net.alarms.push(al);
    Log.add(tgOf(u), u.name, 'NØDKNAPP! Mannskap i fare ved ' + inc.loc.addr, 'alarm');
    Bus.emit('alarm', al); Bus.emit('toast', { msg: 'NØDKNAPP: ' + u.name + ' trenger hjelp!', kind: 'bad' });
    return al;
  }
};


/* ==========================================================================
   8. ENHETER OG STASJONER
   Status: Ledig → Utrykning → På stedet → Transport / Arrest → Retur → Ledig
   Frivillige: Varslet → Mobiliserer → Utrykning → På stedet → Retur
   ========================================================================== */
const Sim = {};
const STATUS_NAVN = { ledig: 'Ledig', varslet: 'Varslet', mobiliserer: 'Mobiliserer', utrykning: 'Utrykning', pastedet: 'På stedet', transport: 'Transport', arrest: 'Arrest', retur: 'Retur', ute: 'Utilgjengelig' };
const isFree = lot => !!lot && lot.free && !S.occ[lot.id];
const spend = c => { if (S.money < c) return false; S.money -= c; S.stats.capex = (S.stats.capex || 0) + c; return true; };
function dayStat(k, v) { const d = Clock.cur ? Clock.cur.dayNo : 1; const o = S.stats.days[d] || (S.stats.days[d] = { inc: 0, ok: 0, fail: 0, income: 0, cost: 0 }); o[k] += v; }
const isSummer = () => Clock.cur && Clock.cur.season === 1;
const ok_ = msg => ({ ok: true, msg }), fail_ = msg => ({ ok: false, msg });

Sim.freeLots = () => WORLD.lots.filter(isFree);
Sim.mastLots = () => WORLD.lots.filter(isFree);
Sim.stationList = org => Object.values(S.stations).filter(s => ST[s.type].org === org && (ST[s.type].rolle === 'etat' || ST[s.type].rolle === 'frivillig'));
Sim.stationCap = st => ST[st.type].cap + 2 * st.up.garasje;
Sim.unitsAt = id => Object.values(S.units).filter(u => u.stationId === id);
/** Finner ledig plass nær en vei ved (x,z): sidene av nærmeste vei, 12–30 m fra midtlinjen, uten bygg/vann. */
Sim.findSpot = function (x, z) {
  const nav = WORLD.nav, r = nav.nearestRP(x, z, true); if (!r || r.dist > 160) return null;
  const rp0 = { a: r.a, b: r.b, e: r.e, t: r.t }, e = nav.edgeFor(rp0), s0 = r.t * e.len, out = [];
  for (const ds of [0, -14, 14, -28, 28, -45, 45]) for (const off of [14, 19, 26, 34]) for (const side of [1, -1]) {
    const t = clamp((s0 + ds) / e.len, 0.05, 0.95), rp = { a: e.a, b: e.b, e: e.id, t }, c = nav.rpXZ(rp), d = nav.dirAt(rp), px = c.x - d[1] * off * side, pz = c.z + d[0] * off * side;
    out.push({ x: px, z: pz, w: Math.hypot(px - x, pz - z) + Math.abs(ds) * 0.3 });
  }
  out.sort((a, b) => a.w - b.w);
  for (const c of out) {
    const rr_ = nav.nearestRP(c.x, c.z, true); if (!rr_ || rr_.dist < 10) continue;                  // ikke oppå en annen vei
    if (WORLD.lots.some(l => (!l.free || (S && S.occ[l.id])) && Math.hypot(l.x - c.x, l.z - c.z) < 14)) continue;                 // ikke oppå sykehus, master, stasjoner eller andre bygg
    if (R.blockedAt(c.x, c.z, 7)) continue;
    return { x: c.x, z: c.z };
  }
  return null;
};
Sim.createLot = function (x, z) { const lot = WORLD.addLotDyn(x, z); if (lot) (S.dynLots = S.dynLots || []).push({ id: lot.id, x, z }); return lot; };
/** Fjerner en tomt som ble opprettet for et kjøp som ikke ble gjennomført. */
Sim.dropLot = function (id) { if (S.occ[id]) return; WORLD.dropLot(id); if (S.dynLots) S.dynLots = S.dynLots.filter(d => d.id !== id); };
Sim.stationLot = st => WORLD.lotById.get(st.lotId);

Sim.buildStation = function (type, lotId, opts) {
  opts = opts || {};
  const T = ST[type], lot = WORLD.lotById.get(lotId);
  if (!lot || (!opts.force && !isFree(lot))) return fail_('Tomten er ikke ledig.');
  if (!opts.free) {
    if (S.level < T.lvl) return fail_('Krever nivå ' + T.lvl + '.');
    if (['brann', 'politi', 'ambulanse'].includes(T.org) && T.rolle !== 'helse' && !S.agencies[T.org]) return fail_('Du har ikke ' + AGENCIES[T.org].kort.toLowerCase() + 'etaten ennå.');
    if ((type === 'rk_base' && !S.vol.rk) || (type === 'nf_base' && !S.vol.nf) || (type === 'rs_base' && !S.vol.rs)) return fail_('Krever samarbeidsavtale.');
    if ((T.rolle === 'helse' || type === 'helikopterbase') && !S.agencies.ambulanse) return fail_('Krever ambulanseetaten.');
    if (type === 'arrest' && !S.agencies.politi) return fail_('Krever politietaten.');
    if (!spend(T.cost)) return fail_('Du har ikke nok penger.');
  }
  const id = 's' + S.nid++, count = Object.values(S.stations).filter(s => s.type === type).length + 1;
  const st = { id, type, lotId, lx: lot.x, lz: lot.z, no: count, name: opts.name || (T.navn + ' ' + count), up: { garasje: 0, mannskap: 0 }, t: S.t };
  if (opts.free && T.rolle === 'helse') st.gift = true;
  S.stations[id] = st; S.occ[lotId] = id;
  Bus.emit('built', st);
  return { ok: true, msg: T.navn + ' er bygget.', st };
};
Sim.parkPos = function (st, k) {
  const lot = WORLD.lotById.get(st.lotId), nav = WORLD.nav;
  if (st.type === 'helikopterbase') return { x: lot.x, z: lot.z, h: 0 };
  const rp = lot.rp, P = nav.rpXZ(rp), d = nav.dirAt(rp), off = (k - 1) * 9;
  // parkert langs veikanten på siden mot tomta
  const sx = Math.sign((lot.x - P.x) * -d[1] + (lot.z - P.z) * d[0]) || 1;
  return { x: P.x + d[0] * off - d[1] * sx * 2.6, z: P.z + d[1] * off + d[0] * sx * 2.6, h: Math.atan2(d[0], d[1]) + (k % 2 ? Math.PI : 0) };
};
Sim.canHouse = (type, st) => {
  const T = UT[type], S_ = ST[st.type];
  if (T.org === 'ambulanse') return type === 'luftambulanse' ? st.type === 'helikopterbase' : st.type === 'ambulansestasjon';
  return S_.org === T.org && (S_.rolle === 'etat' || S_.rolle === 'frivillig') && st.type !== 'helikopterbase';
};
Sim.addUnit = function (type, stationId, opts) {
  opts = opts || {};
  const T = UT[type], st = S.stations[stationId], id = 'u' + S.nid++;
  const seq = Object.values(S.units).filter(u => u.stationId === stationId).length + 1;
  const park = Sim.parkPos(st, seq - 1);
  const u = { id, type, org: T.org, stationId, name: CALL[type] + ' ' + st.no + '-' + seq, status: 'ledig', x: park.x, z: park.z, h: park.h, path: [], pi: 0, job: null, wait: 0, contact: 'bra', lastKnown: { x: park.x, z: park.z }, vis: true, sig: 1, siren: false, alt: 0 };
  if (st.type === 'helikopterbase') u.alt = 0.3;
  if (T.boat) { const lot = WORLD.lotById.get(st.lotId), d = Sim.nearestPier(lot.x, lot.z); u.dock = { x: d.x + rr(-6, 6), z: d.z + rr(-6, 6) }; u.x = u.dock.x; u.z = u.dock.z; }   // båten ligger ved nærmeste kai
  if (!opts.noCrew) Staff.crewFor(u, !!opts.freeCrew);
  S.units[id] = u; Bus.emit('unitAdded', u); return u;
};
Sim.buyUnit = function (type, stationId) {
  const T = UT[type], st = S.stations[stationId];
  if (!st) return fail_('Velg en stasjon.');
  if (S.level < T.lvl) return fail_('Krever nivå ' + T.lvl + '.');
  if (!Sim.canHouse(type, st)) return fail_('Denne stasjonen kan ikke huse ' + T.navn.toLowerCase() + '.');
  if (T.org in S.vol && !S.vol[T.org]) return fail_('Krever samarbeidsavtale.');
  if (Sim.unitsAt(stationId).length >= Sim.stationCap(st)) return fail_('Stasjonen er full – utvid garasjen eller bygg ny stasjon.');
  if (T.boat && !(WORLD.piers || []).length) return fail_('Byen har ingen kai for båter.');
  if (!spend(T.cost + Staff.crewCost(type))) return fail_('Du har ikke nok penger (' + fmtKr(T.cost + Staff.crewCost(type)) + ' inkl. mannskap).');
  const u = Sim.addUnit(type, stationId);
  Log.add((AGENCIES[T.org] || AGENCIES.brann).tg, 'Sentral', u.name + ' er klar med Nødnett-terminal og meldt ledig', 'info');
  return { ok: true, msg: u.name + ' er kjøpt.', u };
};
Sim.callsign = u => u.name;
Sim.nearestPier = function (x, z) { let best = null, bd = 1e18; for (const p of (WORLD.piers || [])) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best || { x, z }; };
Sim.waterOK = inc => !!(inc.island || (inc.loc && inc.loc.water));   // båter kan bare brukes på sjøen

/* ---------- personell: mannskap på kjøretøyene (utrykningskompetanse kode 160) ----------
   En enhet kan bare rykke ut når den har nok mannskap (UT.cm) og nok med kode 160 (UT.k160). Ambulansen krever to med kode 160.
   Reserver på stasjonen tar over hvis noen blir skadet. Frivillige og livreddere har eget mannskap og trenger ikke ansettes. */
const FORNAVN = ['Ola', 'Kari', 'Lars', 'Ingrid', 'Ahmed', 'Sofie', 'Jonas', 'Maja', 'Erik', 'Nora', 'Henrik', 'Emma', 'Ali', 'Thea', 'Magnus', 'Ida', 'Sindre', 'Hanna', 'Mohammed', 'Silje', 'Anders', 'Ane', 'Kristian', 'Julie', 'Ole', 'Marte', 'Sander', 'Vilde', 'Tobias', 'Amalie', 'Fredrik', 'Linnea', 'Emil', 'Sara', 'Petter', 'Hedda'];
const ETTERNAVN = ['Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Pedersen', 'Nilsen', 'Kristiansen', 'Jensen', 'Karlsen', 'Berg', 'Haugen', 'Hagen', 'Eriksen', 'Bakken', 'Lie', 'Dahl', 'Lund', 'Moen', 'Strand', 'Solberg', 'Iversen', 'Ali', 'Nguyen', 'Khan', 'Holm', 'Myhre', 'Aas', 'Vik', 'Rød'];
const Staff = {
  HIRE: 15000, HIRE_K: 24000, COURSE: 18000, COURSE_T: 240, WAGE: 7, WAGE_K: 8,
  list() { return S.staff || (S.staff = []); },
  needs: u => { const T = UT[u.type]; return !u.bistand && !!T.cm; },
  of: u => Staff.list().filter(p => p.unitId === u.id),
  atStation: id => Staff.list().filter(p => p.stationId === id),
  ready(u) { if (!Staff.needs(u)) return true; const T = UT[u.type], c = Staff.of(u).filter(p => p.state === 'ok'); return c.length >= T.cm && c.filter(p => p.k160).length >= T.k160; },
  missing(u) { const T = UT[u.type], c = Staff.of(u).filter(p => p.state === 'ok'); return { n: Math.max(0, T.cm - c.length), k: Math.max(0, T.k160 - c.filter(p => p.k160).length) }; },
  make(org, stationId, k160) { const p = { id: 'p' + S.nid++, navn: pick(FORNAVN) + ' ' + pick(ETTERNAVN), org, k160: !!k160, stationId, unitId: null, state: 'ok', until: 0 }; Staff.list().push(p); return p; },
  crewCost: type => { const T = UT[type]; return T.cm ? T.k160 * Staff.HIRE_K + (T.cm - T.k160) * Staff.HIRE : 0; },
  /** Ansetter mannskapet en ny enhet trenger (gratis for første stasjon). */
  crewFor(u, free) { if (!Staff.needs(u)) return; const T = UT[u.type]; for (let i = 0; i < T.cm; i++) { const p = Staff.make(T.org, u.stationId, i < T.k160); p.unitId = u.id; } if (!free) S.stats.capex = (S.stats.capex || 0); },
  hire(stationId, k160) {
    const st = S.stations[stationId]; if (!st) return fail_('Ukjent stasjon.'); const c = k160 ? Staff.HIRE_K : Staff.HIRE;
    if (!spend(c)) return fail_('Du har ikke nok penger (' + fmtKr(c) + ').');
    const p = Staff.make(ST[st.type].org, stationId, k160); Staff.fill(stationId);
    Log.add((AGENCIES[ST[st.type].org] || AGENCIES.brann).tg, 'Sentral', p.navn + (k160 ? ' (kode 160)' : '') + ' er ansatt på ' + st.name, 'info');
    return ok_(p.navn + ' er ansatt' + (p.unitId ? ' og satt på ' + S.units[p.unitId].name : ' som reserve') + '.');
  },
  course(pid) {
    const p = Staff.list().find(x => x.id === pid); if (!p || p.k160 || p.course) return fail_('Ikke mulig.');
    if (!spend(Staff.COURSE)) return fail_('Du har ikke nok penger (' + fmtKr(Staff.COURSE) + ').');
    p.course = S.t + Staff.COURSE_T; return ok_(p.navn + ' er påmeldt kode 160-kurs (ferdig om ' + fmtDur(Staff.COURSE_T) + ').');
  },
  fire(pid) { const L = Staff.list(), i = L.findIndex(x => x.id === pid); if (i < 0) return fail_('Ikke funnet.'); const p = L[i]; L.splice(i, 1); Staff.fill(p.stationId); return ok_(p.navn + ' har sluttet.'); },
  /** Fyller opp enhetene på stasjonen med ledige reserver (de med kode 160 først der det trengs). */
  fill(stationId) {
    for (const u of Object.values(S.units)) {
      if (u.stationId !== stationId || !Staff.needs(u)) continue;
      let guard = 8; while (!Staff.ready(u) && guard--) {
        const m = Staff.missing(u), res = Staff.atStation(stationId).filter(p => !p.unitId && p.state === 'ok' && p.org === UT[u.type].org);
        const p = (m.k ? res.find(x => x.k160) : null) || (m.n ? res.find(x => !x.k160) || res[0] : null); if (!p) break;
        // en uten kode 160 som står i veien for en med kode 160 byttes ut
        if (m.k && !p.k160) break; p.unitId = u.id;
      }
    }
  },
  injure(u) {
    const c = Staff.of(u).filter(p => p.state === 'ok'); if (!c.length) return; const p = pick(c);
    p.state = 'skadet'; p.until = S.t + 240; p.unitId = null; Staff.fill(u.stationId);
    Log.add(tgOf(u), u.name, p.navn + ' er skadet og er ute i fire timer' + (Staff.ready(u) ? ' – reserve har tatt over' : ' – enheten mangler mannskap'), 'warn');
  },
  tick() {
    for (const p of Staff.list()) {
      if (p.state === 'skadet' && S.t >= p.until) { p.state = 'ok'; Staff.fill(p.stationId); }
      if (p.course && S.t >= p.course) { p.course = 0; p.k160 = true; Log.add('SENTRAL', 'Sentral', p.navn + ' har bestått kode 160-kurset', 'info'); Staff.fill(p.stationId); }
    }
  },
  wages() { let c = 0; for (const p of Staff.list()) c += p.k160 ? Staff.WAGE_K : Staff.WAGE; return c; }
};

/* ---------- bevegelse og statusmaskin ---------- */
Sim.unitRP = function (u) {
  if (u.status === 'ledig' && u.stationId && S.stations[u.stationId]) return WORLD.lotById.get(S.stations[u.stationId].lotId).rp;
  const r = WORLD.nav.nearestRP(u.x, u.z, true) || WORLD.nav.nearestRP(u.x, u.z, false); if (r) return { a: r.a, b: r.b, e: r.e, t: r.t };
  const st = u.stationId && S.stations[u.stationId], l = st && WORLD.lotById.get(st.lotId); return l ? l.rp : WORLD.lots[0].rp;   // utenfor kartet: bruk stasjonens veipunkt
};
Sim.turnoutOf = u => { const T = UT[u.type]; return (T.turnout || 0) * (1 - 0.15 * (S.up[T.org] || 0)); };
Sim.speedOf = function (u) {
  const T = UT[u.type], c = Clock.cur;
  let sp = BASE_SPEED * T.spd * (1 + 0.08 * (S.up[T.org] || 0));
  if (u.bistand) sp *= 0.85;
  sp *= SEASONS[c.season].speed * WEATHER[S.weather.kind].spd;
  const tod = Clock.tod(c.hour); sp *= tod === 'rush' ? 0.92 : tod === 'natt' ? 1.06 : 1;
  if (u.siren) sp *= 1.2;
  return sp;
};
Sim.opDelay = () => 0.2;   // køen i nødsentralen (Sim.callTick) står for ventetiden
Sim.moveUnit = function (u, dt) {
  if (u.hold > 0) { u.hold -= dt; return false; }
  const sp = Sim.speedOf(u); let left = dt;
  while (left > 1e-6 && u.pi < u.path.length) {
    const p = u.path[u.pi];
    if (p.f && u.boarded !== u.pi) { u.boarded = u.pi; if (p.hold) { u.hold = p.hold; u.onFerry = false; return false; } }
    u.onFerry = !!p.f;
    const dx = p.x - u.x, dz = p.z - u.z, d = Math.hypot(dx, dz), v = sp * (p.m || 1);
    if (d < 1e-4) { u.pi++; continue; }
    if (d / v <= left) { u.x = p.x; u.z = p.z; left -= d / v; u.h = Math.atan2(dx, dz); u.pi++; }
    else { u.x += dx / d * v * left; u.z += dz / d * v * left; u.h = Math.atan2(dx, dz); left = 0; }
  }
  if (UT[u.type].model === 'heli' && u.path.length) { // stige og lande
    const last = u.path[u.path.length - 1], dEnd = Math.hypot(last.x - u.x, last.z - u.z);
    u.alt = clamp(Math.min(u.flown || 0, dEnd) * 0.6, 0.3, 9); u.flown = (u.flown || 0) + sp * dt;
  }
  if (u.pi >= u.path.length) { u.onFerry = false; return true; }
  return false;
};
Sim.updateUnit = function (u, dt) {
  const T = UT[u.type];
  switch (u.status) {
    case 'ledig': case 'pastedet': return;
    case 'varslet':
      u.wait -= dt;
      if (u.wait <= 0) { u.status = 'mobiliserer'; u.wait = Vol.mobTime(u); Log.add(tgOf(u), u.name, 'Mottatt – mobiliserer mannskap', 'info'); }
      return;
    case 'mobiliserer': u.wait -= dt; if (u.wait <= 0) Sim.startDrive(u); return;
    case 'ute': u.wait -= dt; if (u.wait <= 0) Sim.recover(u); return;
  }
  switch (u.phase) {
    case 'await': u.wait -= dt; if (u.wait <= 0) Sim.startDrive(u); break;
    case 'walk': u.wait -= dt; if (u.wait <= 0) { const inc = S.incidents[u.job && u.job.inc]; if (inc) Sim.arrive(u, inc); else Sim.sendHome(u); } break;
    case 'handover': u.wait -= dt; if (u.wait <= 0) { Log.add(tgOf(u), u.name, u.status === 'arrest' ? 'Overlevert – ferdig, returnerer' : 'Pasient overlevert, returnerer', 'info'); Sim.sendHome(u); } break;
    case 'drive': if (Sim.moveUnit(u, dt)) Sim.onPathEnd(u); break;
  }
};
/** Setter en enhet i gang mot hendelsen: stifinning med A* langs veinettet. */
Sim.startDrive = function (u) {
  const inc = S.incidents[u.job && u.job.inc];
  if (!u.job || (u.job.inc && !inc)) { Sim.sendHome(u); return; }
  if (u.job.guard) return Sim.driveToGuard(u);
  const T = UT[u.type];
  u.status = 'utrykning'; u.phase = 'drive'; u.dest = 'inc'; u.siren = !T.foot; u.boarded = -1; u.flown = 0; u.walked = false;
  if (T.model === 'heli') {
    const lz = Sim.landingFor(inc); if (!lz) { Log.add(tgOf(u), u.name, 'Ingen egnet landingsplass – avbryter', 'warn'); Sim.detach(u); Sim.sendHome(u); return; }
    u.path = [{ x: lz.x, z: lz.z, m: 1 }]; u.pi = 0; u.alt = 0.5; return;
  }
  if (T.foot) { u.path = [{ x: inc.loc.x, z: inc.loc.z, m: 1 }]; u.pi = 0; return; }
  if (T.boat) { u.path = [{ x: inc.loc.x, z: inc.loc.z, m: 1 }]; u.pi = 0; return; }   // rett over vannet
  const r = WORLD.nav.route(Sim.unitRP(u), inc.loc.rp);
  if (!r.ok) { Log.add(tgOf(u), u.name, 'Finner ingen vei til stedet – avbryter', 'warn'); Sim.detach(u); Sim.sendHome(u); return; }
  u.path = r.pts; u.pi = 0;
};
Sim.sendHome = function (u) {
  const T = UT[u.type]; u.siren = false; u.job = null; u.onFerry = false;
  u.status = 'retur'; u.phase = 'drive'; u.dest = 'home'; u.boarded = -1; u.flown = 0;
  if (u.bistand && T.boat) { u.path = [{ x: u.dock.x, z: u.dock.z, m: 1 }]; u.pi = 0; u.dest = 'port'; return; }
  if (u.bistand) {
    const port = u.port; u.path = [{ x: port.x, z: port.z, m: 1 }]; u.dest = 'port';
    const r = WORLD.nav.route(Sim.unitRP(u), { a: port.id, b: port.id, t: 0 }); if (r.ok) u.path = r.pts; u.pi = 0; return;
  }
  const st = S.stations[u.stationId];
  if (T.foot) { const b = WORLD.beaches[u.beach]; u.path = [{ x: b.tower.x, z: b.tower.z, m: 1 }]; u.pi = 0; return; }
  if (T.model === 'heli') { const p = Sim.parkPos(st, 0); u.path = [{ x: p.x, z: p.z, m: 1 }]; u.pi = 0; return; }
  if (T.boat) { u.path = [{ x: u.dock.x, z: u.dock.z, m: 1 }]; u.pi = 0; return; }
  const r = WORLD.nav.route(Sim.unitRP(u), WORLD.lotById.get(st.lotId).rp);
  if (!r.ok) { const p = Sim.parkPos(st, 0); u.x = p.x; u.z = p.z; u.path = []; Sim.park(u); return; }
  u.path = r.pts; u.pi = 0;
};
Sim.park = function (u) {
  const st = S.stations[u.stationId], T = UT[u.type];
  u.status = 'ledig'; u.phase = null; u.job = null; u.path = []; u.pi = 0; u.siren = false; u.dest = null; u.onFerry = false;
  if (T.foot) { const b = WORLD.beaches[u.beach]; u.x = b.tower.x; u.z = b.tower.z; u.h = 0; return; }
  if (T.boat && u.dock) { u.x = u.dock.x; u.z = u.dock.z; return; }
  const k = Sim.unitsAt(u.stationId).sort((a, b) => a.id.localeCompare(b.id)).findIndex(x => x.id === u.id);
  const p = Sim.parkPos(st, Math.max(0, k)); u.x = p.x; u.z = p.z; u.h = p.h; u.alt = st.type === 'helikopterbase' ? 0.3 : 0;
};
Sim.recover = function (u) { u.vis = true; Sim.park(u); Log.add(tgOf(u), u.name, 'Mannskapet er tilbake i tjeneste', 'info'); };
Sim.detach = function (u) {
  const inc = u.job && u.job.inc && S.incidents[u.job.inc];
  if (inc) for (const s of inc.slots) { const i = s.units.indexOf(u.id); if (i >= 0) s.units.splice(i, 1); }
  u.job = null;
};
Sim.recall = function (u) {
  if (!u.job) return;
  Log.add(tgOf(u), 'Sentral', u.name + ' kalles tilbake', 'info');
  Sim.detach(u); if (u.status === 'pastedet' || u.status === 'utrykning' || u.status === 'varslet' || u.status === 'mobiliserer') Sim.sendHome(u);
};
Sim.onPathEnd = function (u) {
  const T = UT[u.type];
  switch (u.dest) {
    case 'inc': {
      const inc = S.incidents[u.job && u.job.inc];
      if (!inc) return Sim.sendHome(u);
      const ap = (inc.approach || 0) * (T.offroad ? 0.5 : 1) * (T.foot || T.model === 'heli' ? 0 : 1);
      if (ap > 0 && !u.walked) { u.walked = true; u.phase = 'walk'; u.wait = ap; u.siren = false; Log.add(tgOf(u), u.name, 'Fremme ved utgangspunkt – går inn i terrenget', 'info'); return; }
      Sim.arrive(u, inc); return; }
    case 'hosp': u.phase = 'handover'; u.wait = 3; u.siren = false; return;
    case 'arrest': u.phase = 'handover'; u.wait = u.arrestMin || 6; return;
    case 'guard': u.status = 'pastedet'; u.phase = null; u.siren = false; Log.add(tgOf(u), u.name, 'Sanitetsvakt etablert', 'info'); return;
    case 'home': Sim.park(u); return;
    case 'port': delete S.units[u.id]; return;
  }
  Sim.park(u);
};
Sim.arrive = function (u, inc) {
  u.status = 'pastedet'; u.phase = null; u.arrived = S.t; u.path = []; u.pi = 0; u.dest = null; u.walking = false; u.siren = inc.pri === 1 && !UT[u.type].foot;
  Log.add(tgOf(u), u.name, 'Fremme på stedet', 'info');
  if (!inc.arrivedAt) { inc.arrivedAt = S.t; inc.rt = S.t - inc.t0; }
  inc.onScene = true;
  // lifeguard: radio i Nødnett-stil
  if (u.type === 'livredder' && inc.tpl === 'strand_drukning' && !inc.quick && S.t - inc.t0 <= 4) {
    inc.quick = true; inc.transport = false; for (const s of inc.slots) if (!s.accepts.includes('livredder')) s.req = false;
    Log.add('REDNING', u.name, 'Personen er hentet opp raskt og puster selv – trenger ikke sykehus', 'info');
  } else if (u.type === 'livredder' && inc.slots.some(s => s.req && !s.accepts.includes('livredder') && s.units.length === 0))
    Log.add('REDNING', u.name, 'Har pasient, ber om ambulanse', 'warn');
  if (inc.island && !UT[u.type].boat && UT[u.type].model !== 'heli' && !UT[u.type].foot) Log.add(tgOf(u), u.name, 'Ved kaia – venter på båt fra øya', 'info');
  for (const al of S.net.alarms) if (!al.done && al.incId === inc.id && al.helpers.includes(u.id)) Sim.alarmResolve(al);
  if (inc.tpl === 'brannalarm' && !inc.revealed) Sim.reveal(inc);
};
Sim.reveal = function (inc) {
  inc.revealed = true; const tpl = TEMPLATES[inc.tpl];
  if (Math.random() < tpl.falseP) { inc.false = true; inc.work = 1.5; Log.add('BRANN', inc.slots[0].units[0] ? S.units[inc.slots[0].units[0]].name : 'Mannskap', 'Falsk alarm – ingen brann', 'info'); S.stats.falseAlarms++; }
  else {
    inc.pri = 1; inc.work = 12; inc.fx = 'fire'; inc.navn = 'Brann i bygning (utløst alarm)'; inc.rewardMul = 2.4; inc.danger = 0.35; inc.floors = inc.floors || 2;
    inc.slots.push(SL('tb', 'Tankbil', ACC.tank, 'brann'));
    Log.add('BRANN', S.units[inc.slots[0].units[0]].name, 'Reell brann – ber om tankbil', 'warn'); Bus.emit('toast', { msg: 'Alarmen var reell! Det brenner – send tankbil.', kind: 'warn' });
  }
};
Sim.landingFor = function (inc) {
  const L = inc.loc; let best = null, bd = 1e9;
  for (const p of WORLD.landing) { const d = Math.hypot(p.x - L.x, p.z - L.z); if (d < bd) { bd = d; best = p; } }
  return best && bd < 1500 ? { x: best.x, z: best.z, d: bd } : null;
};

/* ==========================================================================
   9. HENDELSER – generering, utsendelse, utfall og belønning
   ========================================================================== */
const ZONE_MUL = { sentrum: 0.9, by: 1.0, bolig: 1.15, strand: 1.15, fjell: 1.5, park: 1.1 };
Sim.active = () => Object.values(S.incidents).filter(i => i.state !== 'ferdig' && i.state !== 'feilet');
Sim.pickPlace = function (tpl) {
  const w = WORLD;
  switch (tpl.loc) {
    case 'bygg': case 'hjem': case 'natt': return w.randomAddress(tpl.loc);
    case 'vei': return w.randomRoadPlace();
    case 'park': { const p = pick(w.parks); return { x: p.x, z: p.z, rp: p.rp, addr: p.navn, zone: 'park', floors: 0, approach: p.approach }; }
    case 'vann': { const p = pick(w.waterfront); return { x: p.x, z: p.z, rp: p.rp, addr: p.navn + ' (kaikanten)', zone: 'by', floors: 0, water: true, approach: p.approach }; }
    case 'strand': {
      const ids = Object.keys(w.beaches), id = wpick(ids, i => w.beaches[i].crowd * (S.beaches[i] && S.beaches[i].staffed ? 1.1 : 1)), b = w.beaches[id], inWater = Math.random() < 0.6;
      return { x: inWater ? b.swim.x + rr(-8, 8) : b.tower.x + rr(-14, 14), z: inWater ? b.swim.z + rr(-8, 8) : b.tower.z + rr(-14, 14), rp: b.rp, addr: b.navn, zone: 'strand', beachId: id, floors: 0, water: inWater, island: b.island, approach: b.island ? 0 : b.approach }; }
    case 'oy': {
      const isl = Object.values(w.beaches).filter(b => b.island), b = pick(isl), a = rr(0, TAU), d = rr(80, 260);
      return { x: b.swim.x + Math.cos(a) * d, z: b.swim.z + Math.sin(a) * d, rp: b.rp, addr: 'Fjorden ved ' + b.navn, zone: 'strand', floors: 0, water: true, island: true, approach: 0 }; }
    case 'fjell': { const p = pick(w.mountain); return { x: p.x + rr(-60, 60), z: p.z + rr(-60, 60), rp: p.rp, addr: p.navn + ' (turløype)', zone: 'fjell', floors: 0, approach: 6 + p.approach }; }
    case 'arr': break;
  }
  return w.randomAddress('bygg');
};
Sim.waterfront = () => WORLD.waterfront;
Sim.hasFjell = () => WORLD.mountain.length > 0;
Sim.staffedBeaches = () => Object.keys(S.beaches).filter(id => S.beaches[id].staffed);

Sim.makeIncident = function (tplId, place, opts) {
  opts = opts || {};
  const tpl = TEMPLATES[tplId], zm = ZONE_MUL[place.zone] || 1;
  const lead = tpl.lead.find(a => S.agencies[a]) || tpl.lead[0];
  const inc = { id: 'i' + S.nid++, tpl: tplId, navn: tpl.navn, lead, pri: tpl.pri, ikon: tpl.ikon, fx: tpl.fx, loc: place, t0: opts.t0 != null ? opts.t0 : S.t, state: 'ny', caller: opts.caller || null,
    slots: tpl.slots.map(s => Object.assign({}, s, { units: [] })), work: tpl.work, progress: 0, target: tpl.target * zm, expire: tpl.expire, danger: tpl.danger || 0,
    floors: place.floors || 0, approach: place.approach || tpl.approach || 0, arrest: Math.random() < (tpl.arrest || 0), transport: Math.random() < (tpl.transportP === undefined ? 1 : tpl.transportP),
    tg: null, bistand: false, escalated: false, rewardMul: 1, onScene: false, rt: null, arrivedAt: null, beachId: place.beachId || null, ev: opts.ev || null, tri: !!tpl.tri, injured: false };
  if (inc.approach === 0 && place.zone === 'fjell') inc.approach = 6;
  if (place.island) {   // øyene i fjorden: bilene kommer bare til kaia – noen må hente med båt eller helikopter
    inc.island = true; inc.approach = 0;
    if (!inc.slots.some(s => s.accepts.includes('redningsbat'))) inc.slots.push(SL('bt', 'Båt eller helikopter (øy)', ACC.boat, 'brann'));
  }
  if (tpl.prep) tpl.prep(inc);
  if (tpl.inj && Math.random() < tpl.inj) {
    if (!inc.slots.some(s => s.ag === 'ambulanse' && s.req)) inc.slots.push(SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }));
    if (inc.lead === 'brann' && !inc.slots.some(s => s.ag === 'politi')) { inc.slots.push(SL('po', 'Politi (sperring)', ACC.patr, 'politi')); inc.tri = true; }
    inc.injured = true; inc.rewardMul *= 1.45; inc.navn += ' – personskade'; inc.pri = 1; inc.transport = true;
  }
  if (inc.slots.filter(s => s.req).map(s => s.ag).filter((a, i, arr) => arr.indexOf(a) === i).length >= 3) inc.tri = true;
  S.incidents[inc.id] = inc;
  dayStat('inc', 1);
  const ag = AGENCIES[inc.lead];
  Log.add('SENTRAL', ag.sentral || ag.navn, 'Ny hendelse: ' + inc.navn + ', ' + place.addr + (inc.tri ? ' – trippelvarsling' : ''), 'warn');
  Bus.emit('incident', inc);
  if (inc.beachId) Sim.autoLifeguard(inc);
  if (S.settings.auto) Sim.dispatchSuggested(inc, true);
  return inc;
};
/* ---------- nødsentraler (AMK 113, 110-sentral, operasjonssentral 112): anrop i kø → operatør svarer → hendelse ---------- */
const CENTRAL = { brann: '110-sentralen', politi: 'Operasjonssentralen', ambulanse: 'AMK' };
/** Et nytt nødanrop. Det blir en hendelse først når en operatør (eller du) har tatt samtalen. Responstiden regnes fra anropet. */
Sim.incomingCall = function (tplId, place, opts) {
  const tpl = TEMPLATES[tplId], ag = tpl.lead.find(a => S.agencies[a]);
  if (!ag) return Sim.makeIncident(tplId, place, opts);               // f.eks. strandlivreddere som ser hendelsen selv
  const lines = CALLER[tplId] || ['Jeg trenger hjelp – ' + tpl.navn.toLowerCase() + '.'];
  const c = { id: 'c' + S.nid++, tpl: tplId, place, ag, t0: S.t, state: 'ringer', op: null, end: 0, talk: rr(0.7, 1.8), wait: rr(0.15, 0.5), text: pick(lines), opts: opts || null };
  S.calls.push(c); Bus.emit('call', c); return c;
};
Sim.callsBusy = ag => S.calls.filter(c => c.ag === ag && c.state === 'samtale' && c.op === 'op').length;
Sim.callTick = function () {
  for (const ag of ETATER) {
    if (!S.agencies[ag]) continue; let free = S.ops[ag] - Sim.callsBusy(ag);
    for (const c of S.calls) if (c.ag === ag && c.state === 'ringer' && free > 0 && S.t - c.t0 >= c.wait) { c.state = 'samtale'; c.op = 'op'; c.end = S.t + c.talk; free--; }
  }
  for (const c of S.calls.slice()) if (c.state === 'samtale' && S.t >= c.end) Sim.closeCall(c);
};
Sim.closeCall = function (c) {
  S.calls = S.calls.filter(x => x !== c);
  const inc = Sim.makeIncident(c.tpl, c.place, Object.assign({}, c.opts || {}, { t0: c.t0, caller: c.text }));
  if (c.op === 'player') { inc.rewardMul *= 1.05; }
  return inc;
};
/** Du tar samtalen selv: rask avklaring, hendelsen kommer straks i listen. */
Sim.answerCall = function (id) { const c = S.calls.find(x => x.id === id); if (!c || c.state === 'samtale' && c.op === 'player') return null; c.state = 'samtale'; c.op = 'player'; c.end = S.t + 0.25; return c; };

/** Frekvens og valg av neste hendelse. */
/** Hendelser per spillminutt. Øker med etater og antall enheter: fra ca. ett anrop hvert 2.–3. minutt (ekte tid) til rundt to i minuttet for en stor organisasjon. */
Sim.rate = function () {
  const cfg = WORLD.cfg, base = { brann: 0.025, politi: 0.035, ambulanse: 0.04 };
  let lam = 0; for (const a of ETATER) if (S.agencies[a]) lam += base[a];
  if (lam) lam += 0.03 * Object.values(S.units).filter(u => !u.bistand && u.type !== 'livredder').length;
  if (!lam && Sim.staffedBeaches().length && isSummer()) lam = 0.05;
  return Math.min(0.67, lam * (cfg.incidentMul.total || 1) * (0.8 + 0.2 * cfg.diff) * (1 + 0.08 * (S.level - 1)));
};
Sim.pickTemplate = function () {
  const info = Clock.cur, groups = {};
  for (const id in TEMPLATES) {
    const tpl = TEMPLATES[id]; if (tpl.w <= 0 || tpl.lvl > S.level) continue;
    const leadOwned = tpl.lead.some(a => S.agencies[a]), beachOk = tpl.volLead && Sim.staffedBeaches().length && info.season === 1;
    if (!leadOwned && !beachOk) continue;
    if (!leadOwned && !tpl.slots.filter(x => x.req).every(x => x.accepts.includes('livredder'))) continue;
    if (tpl.loc === 'strand' && !Object.keys(WORLD.beaches).length) continue;
    if (tpl.loc === 'fjell' && !Sim.hasFjell()) continue;
    if (tpl.loc === 'vann' && !Sim.waterfront().length) continue;
    if (tpl.loc === 'park' && !WORLD.parks.length) continue;
    if (tpl.loc === 'oy' && !Object.values(WORLD.beaches).some(b => b.island)) continue;
    const m = tpl.w * tplMods(tpl, info); if (m <= 0.0001) continue;
    const key = leadOwned ? tpl.lead.find(a => S.agencies[a]) : 'strand';
    (groups[key] = groups[key] || []).push({ id, w: m });
  }
  const share = { brann: 1.0, politi: 1.15, ambulanse: 1.4, strand: 0.7 }, cand = [];
  for (const k in groups) { const sum = groups[k].reduce((a, c) => a + c.w, 0); for (const c of groups[k]) cand.push({ id: c.id, w: c.w / sum * share[k] }); }
  const c = wpick(cand, c => c.w); return c ? c.id : null;
};
Sim.spawnTick = function () {
  if (S.t < S.nextSpawn) return;
  const lam = Sim.rate(); if (lam <= 0) { S.nextSpawn = S.t + 20; return; }
  const maxActive = 3 + Math.round(S.level * 1.6 + Object.keys(S.units).length * 0.5);
  if (Sim.active().length + S.calls.length >= maxActive) { S.nextSpawn = S.t + 2; return; }
  const id = Sim.pickTemplate();
  if (id) { const tpl = TEMPLATES[id]; Sim.incomingCall(id, Sim.pickPlace(tpl)); }
  S.nextSpawn = S.t + Math.max(2.5, -Math.log(1 - Math.random()) / lam);
};
Sim.onScene = inc => inc.slots.flatMap(s => s.units).map(id => S.units[id]).filter(u => u && u.status === 'pastedet' && u.job && u.job.inc === inc.id);
Sim.slotArrived = (inc, s) => s.units.map(id => S.units[id]).filter(u => u && u.status === 'pastedet' && u.job && u.job.inc === inc.id).length;
Sim.slotAssigned = s => s.units.length;
Sim.agenciesOnScene = inc => { const set = new Set(); for (const u of Sim.onScene(inc)) set.add(u.org === 'bistand' ? UT[u.type].org : u.org); return set; };
Sim.escalate = function (inc, tpl) {
  const esc = tpl.esc; inc.escalated = true;
  if (esc.pri) inc.pri = Math.min(inc.pri, esc.pri);
  for (const s of (esc.add || [])) inc.slots.push(Object.assign({}, s, { units: [] }));
  for (const k of (esc.makeReq || [])) { const s = inc.slots.find(x => x.k === k); if (s) s.req = true; }
  inc.work *= esc.workMul || 1; inc.rewardMul *= esc.rewardMul || 1;
  Log.add('SENTRAL', 'Utrykningsleder', esc.msg + ' (' + inc.loc.addr + ')', 'alarm'); Bus.emit('toast', { msg: esc.msg, kind: 'warn' });
};
Sim.updateIncidents = function (dt) {
  for (const id in S.incidents) {
    const inc = S.incidents[id], tpl = TEMPLATES[inc.tpl];
    if (inc.state === 'ferdig' || inc.state === 'feilet') continue;
    const age = S.t - inc.t0;
    if (tpl.esc && !inc.escalated && age >= tpl.esc.at) Sim.escalate(inc, tpl);
    const on = Sim.onScene(inc); inc.onScene = on.length > 0;
    const anyAssigned = inc.slots.some(s => s.units.length);
    if (!inc.onScene) {
      if (age > inc.expire && !anyAssigned) { Sim.finish(inc, false); continue; }
      if (age > inc.expire * 1.8) { Sim.finish(inc, false); continue; }
      continue;
    }
    if (age > inc.expire * 3 + inc.work * 2) { Sim.finish(inc, false); continue; }
    // fremdrift: andel av påkrevde enheter på stedet
    let need = 0, have = 0;
    for (const s of inc.slots) if (s.req) { need += s.n; have += Math.min(s.n, Sim.slotArrived(inc, s)); }
    const frac = need ? have / need : 1;
    inc.frac = frac;
    if (frac <= 0) continue;
    let rate = frac;
    const opt = inc.slots.filter(s => !s.req && Sim.slotArrived(inc, s) > 0).length; rate *= 1 + 0.12 * Math.min(3, opt);
    const ags = Sim.agenciesOnScene(inc);
    if (ags.size >= 2) { rate *= inc.tg ? 1.25 : 0.8; if (!inc.tg && !inc.misu && Math.random() < 0.02 * dt) { inc.misu = true; Log.add('SENTRAL', 'Utrykningsleder', 'Misforståelse mellom etatene – ingen felles talegruppe (' + inc.loc.addr + ')', 'warn'); } }
    for (const u of on) { const st = S.stations[u.stationId]; if (st) rate *= 1 + 0.03 * st.up.mannskap / Math.max(1, on.length) * 3; }
    if (inc.beachId && S.beaches[inc.beachId]) { const up = S.beaches[inc.beachId].up; rate *= 1 + 0.08 * (up.livboye + up.brett) + 0.12 * up.bat; }
    const cap = frac >= 1 ? inc.work : inc.work * 0.96;
    inc.progress = Math.min(cap, inc.progress + rate * dt);
    // nødknapp
    if (inc.danger > 0 && S.t > 40 && !inc.alarmed) {
      if (Math.random() < inc.danger * 0.022 * dt) {
        const cands = on.filter(u => !u.bistand && ETATER.includes(u.org)); const u = cands.length ? pick(cands) : null;
        if (u && !S.net.alarms.some(a => !a.done && a.unitId === u.id)) {
          inc.alarmed = true;
          if (u.contact === 'ingen') { Log.add('NØDNETT', u.name, 'Mannskap skadet uten kontakt – ingen dekning!', 'alarm'); Sim.injure(u, inc); }
          else Net.triggerAlarm(u, inc);
        }
      }
    }
    if (inc.progress >= inc.work && frac >= 1) Sim.finish(inc, true);
  }
};
Sim.injure = function (u, inc) {
  Staff.injure(u);
  Sim.detach(u); u.status = 'ute'; u.wait = 18; u.vis = false; u.phase = null; u.siren = false; u.path = [];
  const pen = Math.min(Math.max(0, S.money), 8000); S.money -= pen; S.stats.costs += pen; dayStat('cost', pen); S.perf = lerp(S.perf, 0.25, 0.06); Bus.emit('toast', { msg: u.name + ': mannskap skadet', kind: 'bad' });
  if (inc && inc.state !== 'ferdig') inc.progress = Math.max(0, inc.progress - 2);
};
Sim.alarmResolve = function (al) {
  al.done = true; al.ok = true; S.stats.alarmsOk++; S.perf = lerp(S.perf, 1, 0.04); S.xp += 8;
  const u = S.units[al.unitId]; Log.add(u ? tgOf(u) : 'SENTRAL', u ? u.name : 'Enhet', 'Hjelp er fremme – nødknapp avsluttet', 'info'); Bus.emit('toast', { msg: 'Nødknapp-alarmen er avsluttet – hjelp er fremme', kind: 'good' });
};
Sim.alarmFail = function (al) {
  al.done = true; al.ok = false; S.stats.alarmsFail++;
  const u = S.units[al.unitId], inc = S.incidents[al.incId];
  if (u && u.status !== 'ute') { Log.add(tgOf(u), u.name, 'Mannskap skadet – hjelp kom for sent', 'alarm'); Sim.injure(u, inc); }
};
/** Send nærmeste ledige enhet som nødhjelp til en nødknapp-alarm. */
Sim.helperFor = function (al) {
  const u0 = S.units[al.unitId], inc = S.incidents[al.incId]; if (!u0 || !inc) return null;
  const org = u0.org, types = Object.keys(UT).filter(t => UT[t].org === org && !UT[t].foot && UT[t].model !== 'heli');
  let best = null, be = 1e9;
  for (const id in S.units) { const u = S.units[id]; if (!types.includes(u.type) || !Sim.available(u)) continue; const e = Sim.eta(u, inc); if (e < be) { be = e; best = u; } }
  return best ? { u: best, eta: be } : null;
};
Sim.sendHelp = function (al) {
  const h = Sim.helperFor(al), inc = S.incidents[al.incId]; if (!h || !inc) return fail_('Ingen ledig enhet å sende som nødhjelp.');
  let slot = inc.slots.find(s => s.k === 'nh'); if (!slot) { slot = SL('nh', 'Nødhjelp', Object.keys(UT), AGENCIES[h.u.org] ? h.u.org : 'politi', { req: false, n: 9 }); slot.units = []; inc.slots.push(slot); }
  Sim.assign(inc, slot, h.u, { urgent: true }); al.helpers.push(h.u.id);
  return ok_(h.u.name + ' sendes som nødhjelp (' + fmtDur(h.eta) + ').');
};
Sim.available = u => (u.status === 'ledig' || u.status === 'retur') && u.vis !== false && !u.job && !(u.type === 'livredder' && (!Vol.onDuty() || !S.beaches[u.beach].staffed)) && Staff.ready(u);
Sim.eta = function (u, inc) {
  const T = UT[u.type], key = 'e' + inc.id; u._eta = u._eta || {};
  const rt = Math.floor(performance.now() / 1500), ck = u._eta[key]; if (ck && ck.t === rt && ck.s === u.status) return ck.v;
  let v;
  const pre = Net.commDelay(u) + Sim.opDelay(inc.lead) + (T.mob && !u.bistand ? T.mob * 1.0 : Sim.turnoutOf(u));
  const sm = Sim.speedOf(u) * (u.siren ? 1 : 1.12);
  if (T.foot) v = u.beach === inc.beachId ? pre + Math.hypot(u.x - inc.loc.x, u.z - inc.loc.z) / sm : Infinity;
  else if (T.model === 'heli') { const lz = Sim.landingFor(inc); v = lz ? pre + Math.hypot(u.x - lz.x, u.z - lz.z) / sm + 2 : Infinity; }
  else if (T.boat) v = Sim.waterOK(inc) ? pre + Math.hypot(u.x - inc.loc.x, u.z - inc.loc.z) / sm : Infinity;
  else { const r = WORLD.nav.route(Sim.unitRP(u), inc.loc.rp); v = r.ok ? pre + r.cost / sm + (inc.approach || 0) * (T.offroad ? 0.5 : 1) : Infinity; }
  u._eta[key] = { t: rt, s: u.status, v }; return v;
};
Sim.candidates = function (inc, slot) {
  const out = [];
  for (const id in S.units) {
    const u = S.units[id]; if (!slot.accepts.includes(u.type) || !Sim.available(u)) continue;
    const e = Sim.eta(u, inc); if (isFinite(e)) out.push({ u, eta: e });
  }
  return out.sort((a, b) => a.eta - b.eta);
};
Sim.missing = (inc, slot) => Math.max(0, slot.n - slot.units.length);
/** Forslag: nærmeste ledige enhet til hver påkrevd rolle som mangler. */
Sim.suggest = function (inc, includeOptional) {
  const used = new Set(), out = [];
  for (const slot of inc.slots) {
    if (!slot.req && !includeOptional) continue;
    for (let k = 0; k < Sim.missing(inc, slot); k++) {
      const c = Sim.candidates(inc, slot).filter(x => !used.has(x.u.id))[0];
      if (!c) { out.push({ slot, u: null, eta: null }); break; }
      used.add(c.u.id); out.push({ slot, u: c.u, eta: c.eta });
    }
  }
  return out;
};
Sim.assign = function (inc, slot, u, opts) {
  opts = opts || {};
  if (u.job) Sim.detach(u);
  slot.units.push(u.id); u.job = { inc: inc.id, slot: slot.k };
  const T = UT[u.type], comm = Net.commDelay(u) + (u.bistand ? 0 : Sim.opDelay(inc.lead));
  u.path = []; u.pi = 0; u.arrived = null; u.walked = false; u.dest = null;
  if (T.foot) { u.status = 'utrykning'; u.phase = 'await'; u.wait = comm * 0.6 + 0.15; }
  else if (T.mob && !u.bistand) { u.status = 'varslet'; u.phase = null; u.wait = comm; }
  else { u.status = 'utrykning'; u.phase = 'await'; u.wait = opts.urgent ? comm * 0.5 : comm + (u.bistand ? 0 : Sim.turnoutOf(u)); }
  u.siren = false;
  const ag = inc.lead, line = u.type === 'livredder' ? 'Går til skadested' : T.mob && !u.bistand ? 'Varslet – samler mannskap' : 'Utrykning til ' + inc.loc.addr;
  Log.add(inc.tg || tgOf(u), (AGENCIES[ag] || {}).sentral || 'Sentral', u.name + ': ' + line + ' (' + inc.navn + ')', 'info');
  if (inc.state === 'ny') inc.state = 'underveis';
  Bus.emit('dispatch', { inc, u });
};
Sim.dispatchSuggested = function (inc, quiet) {
  const sug = Sim.suggest(inc, false); let n = 0, miss = [];
  for (const s of sug) { if (s.u) { Sim.assign(inc, s.slot, s.u); n++; } else miss.push(s.slot.label); }
  if (!quiet) {
    if (n && !miss.length) Bus.emit('toast', { msg: n + (n === 1 ? ' enhet' : ' enheter') + ' sendt til ' + inc.loc.addr, kind: 'good' });
    else if (n) Bus.emit('toast', { msg: n + ' sendt – mangler: ' + miss.join(', ') + '. Be om bistand?', kind: 'warn' });
    else if (miss.length) Bus.emit('toast', { msg: 'Ingen ledige enheter for: ' + miss.join(', ') + '. Be om bistand?', kind: 'warn' });
  }
  return { n, miss };
};
Sim.autoLifeguard = function (inc) {
  const b = S.beaches[inc.beachId]; if (!b || !b.staffed || !isSummer()) return;
  const lg = Object.values(S.units).filter(u => u.type === 'livredder' && u.beach === inc.beachId && Sim.available(u))[0]; if (!lg) return;
  const slot = inc.slots.find(s => s.accepts.includes('livredder') && s.units.length < s.n); if (!slot) return;
  Sim.assign(inc, slot, lg);
};
/** Bistand fra nabodistrikt: koster penger, kommer langsomt og gir lavere poengsum. */
Sim.requestBistand = function (inc, slot) {
  const cost = BISTAND_COST[slot.ag] || 9000; if (!spend(cost)) return fail_('Du har ikke råd til bistand (' + fmtKr(cost) + ').');
  const type = slot.accepts.find(t => UT[t].org === slot.ag) || slot.accepts.find(t => FRIVILLIGE.includes(UT[t].org) && t !== 'livredder') || slot.accepts[0];
  if (type === 'livredder') return fail_('Livredder kan ikke rekvireres fra nabodistriktet.');
  if (UT[type].boat) {   // båt fra nabodistriktet kommer sjøveien
    const T = UT[type], pier = Sim.nearestPier(inc.loc.x, inc.loc.z), id = 'u' + S.nid++, sx = pier.x + rr(-400, 400), sz = pier.z + rr(300, 700);
    const u = { id, type, org: 'bistand', bistand: true, dock: { x: sx, z: sz }, stationId: null, name: 'Bistand ' + CALL[type] + ' (nabodistrikt)', status: 'utrykning', x: sx, z: sz, h: 0, path: [], pi: 0, job: { inc: inc.id, slot: slot.k }, phase: 'await', wait: (WORLD.cfg.bistandDelay || 8) + rr(0, 3), dest: null, contact: 'bra', vis: true, siren: false, alt: 0, lastKnown: { x: sx, z: sz } };
    S.units[id] = u; slot.units.push(id); inc.bistand = true; S.stats.bistand++; if (inc.state === 'ny') inc.state = 'underveis';
    Log.add(inc.tg || 'SENTRAL', 'Sentral', 'Rekvirerer ' + T.navn.toLowerCase() + ' fra nabodistriktet til ' + inc.loc.addr + ' (' + fmtKr(cost) + ')', 'warn');
    return ok_('Bistand er på vei – kommer om ca. ' + fmtDur(u.wait + 4) + '.');
  }
  const ports = WORLD.ports; let port = ports[0], bd = 1e9;
  for (const p of ports) { const d = Math.hypot(p.x - inc.loc.x, p.z - inc.loc.z); if (d < bd) { bd = d; port = p; } }
  const id = 'u' + S.nid++, T = UT[type];
  const u = { id, type, org: 'bistand', bistand: true, port: { id: port.id, x: port.x, z: port.z }, stationId: null, name: 'Bistand ' + CALL[type] + ' (nabodistrikt)', status: 'utrykning', x: port.x, z: port.z, h: 0, path: [], pi: 0, job: null, wait: 0, contact: 'bra', vis: true, siren: false, alt: 0, lastKnown: { x: port.x, z: port.z } };
  S.units[id] = u;
  slot.units.push(id); u.job = { inc: inc.id, slot: slot.k }; u.phase = 'await'; u.wait = (WORLD.cfg.bistandDelay || 8) + rr(0, 3) + (T.mob ? 4 : 0); u.dest = null;
  inc.bistand = true; S.stats.bistand++; if (inc.state === 'ny') inc.state = 'underveis';
  Log.add(inc.tg || 'SENTRAL', 'Sentral', 'Rekvirerer ' + CALL[type].toLowerCase() + ' fra nabodistriktet til ' + inc.loc.addr + ' (' + fmtKr(cost) + ')', 'warn');
  return ok_('Bistand er på vei – kommer om ca. ' + fmtDur(u.wait + 4) + '.');
};
/** Samvirke-talegruppe: raskere arbeid og bonus – men tar kapasitet i Nødnett. */
Sim.createSamvirke = function (inc) {
  if (inc.tg) return fail_('Hendelsen bruker allerede ' + inc.tg + '.');
  if (Net.vhf()) return fail_('Samvirke-talegrupper krever Nødnett – oppgrader fra VHF under Butikk → Nødnett.');
  const tg = Net.samvFree(); if (!tg) return fail_('Alle samvirke-talegrupper er i bruk – vent til en hendelse er ferdig, eller bygg ut nettet.');
  inc.tg = tg; S.stats.samv++;
  Log.add(inc.tg, 'Sentral', 'Alle etater på ' + inc.navn + ' går over til ' + inc.tg, 'info');
  return ok_(inc.navn + ' bruker nå ' + inc.tg + '.');
};
Sim.canSamvirke = inc => !inc.tg && !Net.vhf() && !!Net.samvFree();

/** Avslutter en hendelse: belønning, poengsum, frigjøring av enheter. */
Sim.finish = function (inc, ok) {
  const tpl = TEMPLATES[inc.tpl], units = inc.slots.flatMap(s => s.units).map(id => S.units[id]).filter(Boolean);
  const onSc = units.filter(u => u.status === 'pastedet'), vols = onSc.filter(u => FRIVILLIGE.includes(u.org) || (u.org === 'bistand' && FRIVILLIGE.includes(UT[u.type].org))).length;
  const volShare = onSc.length ? vols / onSc.length : 0;
  let pay = 0, score = 0, summary = '';
  const agKey = FRIVILLIGE.includes(inc.lead) ? 'frivillig' : inc.lead;
  if (ok) {
    const rt = inc.rt == null ? inc.expire : inc.rt, ratio = rt / inc.target;
    const payF = ratio <= 0.6 ? 1.3 : ratio <= 1 ? 1.0 : ratio <= 1.5 ? 0.75 : ratio <= 2 ? 0.5 : 0.3;
    score = ratio <= 1 ? 1 : ratio <= 1.5 ? 0.7 : ratio <= 2 ? 0.45 : 0.2;
    let mult = payF;
    const opt = inc.slots.filter(s => !s.req && s.k !== 'nh'); if (opt.length) mult *= 1 + 0.15 * (opt.filter(s => s.units.length).length / opt.length);
    const multi = Sim.agenciesOnScene(inc).size >= 2 || inc.tri; if (multi && inc.tg) { mult *= 1.15; score = Math.min(1, score + 0.05); }
    if (inc.bistand) { mult *= 0.7; score *= 0.85; }
    mult *= 1 - 0.45 * volShare;
    let saved = null;
    if (tpl.med) {
      let surv = ratio <= 1 ? 0.92 : ratio <= 1.5 ? 0.72 : ratio <= 2 ? 0.45 : 0.2;
      if (inc.beachId && S.beaches[inc.beachId] && S.beaches[inc.beachId].staffed) surv += 0.04 * (S.beaches[inc.beachId].up.hjerte * 2 + S.beaches[inc.beachId].up.livboye);
      saved = inc.quick || Math.random() < Math.min(0.98, surv);
      if (saved) S.stats.lives++; else { S.stats.lost++; mult *= 0.5; score *= 0.45; }
    }
    pay = tpl.reward * 0.6 * inc.rewardMul * mult; if (inc.false) pay = tpl.reward * 0.35;
    S.money += pay; S.stats.income += pay; dayStat('income', pay); dayStat('ok', 1); S.stats.solved++;
    const a = S.stats.byAg[agKey]; if (a) { a.n++; a.rt += rt; if (ratio <= 1) a.ok++; }
    if (volShare > 0) { const f = S.stats.byAg.frivillig; f.n++; f.rt += rt; if (ratio <= 1) f.ok++; }
    S.perf = lerp(S.perf, score, 0.14); if (volShare > 0 && score >= 0.7) S.volBonus = Math.min(10, S.volBonus + 1.4);
    Eco.addXp(Math.round((tpl.xp || 10) * (0.5 + 0.5 * score) * (inc.injured ? 1.3 : 1)));
    summary = (inc.false ? 'Falsk alarm' : saved === false ? 'Pasienten døde' : saved ? 'Pasienten reddet' : 'Løst') + ' · responstid ' + fmtDur(rt) + ' (mål ' + fmtDur(inc.target) + ')';
    Log.add(inc.tg || 'SENTRAL', 'Sentral', inc.navn + ' ved ' + inc.loc.addr + ' avsluttet. ' + summary + ' · +' + fmtKr(pay), 'info');
    Bus.emit('toast', { msg: inc.navn + ' løst: +' + fmtKr(pay), kind: saved === false ? 'warn' : 'good' });
    inc.saved = saved;
  } else {
    pay = -tpl.reward * 0.3; S.money += pay; S.stats.costs -= pay; dayStat('cost', -pay); dayStat('fail', 1); S.stats.failed++;
    S.perf = lerp(S.perf, 0, 0.17); const a = S.stats.byAg[agKey]; if (a) a.n++;
    summary = 'Mislyktes – ingen enhet rakk frem i tide';
    Log.add('SENTRAL', 'Sentral', inc.navn + ' ved ' + inc.loc.addr + ' ble ikke håndtert i tide (' + fmtKr(pay) + ')', 'alarm');
    Bus.emit('toast', { msg: inc.navn + ' ble ikke håndtert i tide', kind: 'bad' });
  }
  inc.state = ok ? 'ferdig' : 'feilet'; inc.tEnd = S.t; inc.pay = pay; inc.summary = summary;
  // frigjør enheter: transport, arrest eller retur
  let transported = false, arrested = false;
  for (const u of units) {
    const slot = inc.slots.find(s => s.units.includes(u.id)), T = UT[u.type];
    u.job = null;
    if (!ok || u.status !== 'pastedet') { if (u.status === 'pastedet' || u.status === 'utrykning' || u.status === 'varslet' || u.status === 'mobiliserer') Sim.sendHome(u); else if (u.status === 'retur' || u.status === 'ledig') {} continue; }
    const canTrans = ['ambulanse', 'sanitetsbil', 'hjelpekorpsbil', 'luftambulanse'].includes(u.type);
    if (slot && slot.transport && inc.transport && canTrans) {
      if (Sim.sendToFacility(u, inc)) { transported = true; continue; }
    }
    if (inc.arrest && !arrested && u.org === 'politi' && (UT[u.type].org === 'politi') && Sim.sendToArrest(u)) { arrested = true; continue; }
    Sim.sendHome(u);
  }
  S.done.unshift({ id: inc.id, navn: inc.navn, addr: inc.loc.addr, ok, pay, summary, t: S.t, pri: inc.pri, lead: inc.lead });
  if (S.done.length > 14) S.done.length = 14;
  for (const al of S.net.alarms) if (al.incId === inc.id && !al.done) { al.done = true; al.ok = true; }
  delete S.incidents[inc.id]; Bus.emit('incidentDone', inc);
};
Sim.sendToFacility = function (u, inc) {
  const T = UT[u.type]; let best = null, bc = 1e9;
  for (const id in S.stations) {
    const st = S.stations[id]; if (ST[st.type].rolle !== 'helse') continue; if (st.type === 'legevakt' && inc.pri < 3) continue;
    const lot = WORLD.lotById.get(st.lotId);
    let c; if (T.model === 'heli') c = Math.hypot(lot.x - u.x, lot.z - u.z) / 3; else { const r = WORLD.nav.route(Sim.unitRP(u), lot.rp); c = r.ok ? r.cost : 1e9; }
    if (c < bc) { bc = c; best = { st, lot }; }
  }
  if (!best) return false;
  u.siren = inc.pri <= 2; u.status = 'transport'; u.phase = 'drive'; u.dest = 'hosp'; u.boarded = -1; u.flown = 0; u.onFerry = false;
  if (T.model === 'heli') u.path = [{ x: best.lot.x, z: best.lot.z, m: 1 }];
  else { const r = WORLD.nav.route(Sim.unitRP(u), best.lot.rp); if (!r.ok) return false; u.path = r.pts; }
  u.pi = 0; u.patient = true;
  Log.add(tgOf(u), u.name, 'Pasient om bord – kjører til ' + best.st.name, 'info'); return true;
};
Sim.sendToArrest = function (u) {
  let best = null, bc = 1e9;
  for (const id in S.stations) {
    const st = S.stations[id]; if (st.type !== 'politistasjon' && st.type !== 'arrest') continue;
    const lot = WORLD.lotById.get(st.lotId), r = WORLD.nav.route(Sim.unitRP(u), lot.rp);
    if (r.ok && r.cost < bc) { bc = r.cost; best = { st, lot, r }; }
  }
  if (!best) return false;
  u.siren = false; u.status = 'arrest'; u.phase = 'drive'; u.dest = 'arrest'; u.path = best.r.pts; u.pi = 0; u.boarded = -1; u.arrestMin = best.st.type === 'arrest' ? 3 : 6;
  Log.add('POLITI', u.name, 'Pågrepet person – kjører til ' + best.st.name, 'info');
  if (best.st.type === 'arrest') { S.money += 1500; S.stats.income += 1500; }
  return true;
};


/* ==========================================================================
   10. FRIVILLIGE – Røde Kors Hjelpekorps, Norsk Folkehjelp Sanitet, strandlivreddere, arrangementer
   De kalles ut via politiet (søk og redning) eller AMK (sanitet). Lavere kostnad, lengre mobiliseringstid.
   ========================================================================== */
const ORG_COST = { rk: 120000, nf: 100000, rs: 90000, strand: 80000 };
const BEACH_UP = { livboye: { navn: 'Livbøye', cost: 6000, tekst: 'Raskere redning av svømmere' }, brett: { navn: 'Redningsbrett', cost: 12000, tekst: 'Raskere innsats i vannet' },
  bat: { navn: 'Redningsbåt', cost: 35000, tekst: 'Når ut til folk langt fra land' }, hjerte: { navn: 'Hjertestarter', cost: 18000, tekst: 'Bedre overlevelse ved hjertestans' } };
const Vol = {
  /** Strandlivredderne er på jobb kl. 12–20 om sommeren. */
  onDuty() { const c = Clock.cur; return !!c && c.season === 1 && c.hour >= 12 && c.hour < 20; },
  mobTime(u) {
    const T = UT[u.type], tod = Clock.tod(Clock.cur.hour);
    return (T.mob || 0) * (tod === 'natt' ? 1.7 : tod === 'kveld' ? 1.2 : 1) * rr(0.85, 1.2);
  },
  sign(org) {
    if (S.vol[org]) return fail_('Du har allerede avtalen.');
    if (org === 'strand' && !Object.keys(WORLD.beaches).length) return fail_('Strandlivreddere finnes bare i byer med badestrender.');
    if (!spend(ORG_COST[org])) return fail_('Du har ikke nok penger.');
    S.vol[org] = true; Log.add('REDNING', 'Sentral', 'Samarbeidsavtale med ' + AGENCIES[org].navn + ' er på plass', 'info');
    return ok_('Samarbeidsavtale med ' + AGENCIES[org].navn + ' er signert.');
  },
  beach(id) { return S.beaches[id] || (S.beaches[id] = { staffed: false, n: 1, up: { livboye: 0, brett: 0, bat: 0, hjerte: 0 } }); },
  makeGuard(id, k) {
    const b = WORLD.beaches[id], uid = 'u' + S.nid++;
    const u = { id: uid, type: 'livredder', org: 'strand', beach: id, stationId: null, name: 'Livredder ' + b.navn + (k > 1 ? ' ' + k : ''), status: 'ledig', x: b.tower.x, z: b.tower.z, h: 0, path: [], pi: 0, job: null, wait: 0, contact: 'bra', lastKnown: { x: b.tower.x, z: b.tower.z }, vis: isSummer(), siren: false, alt: 0 };
    S.units[uid] = u; return u;
  },
  staff(id) {
    const bs = Vol.beach(id); if (!S.vol.strand) return fail_('Krever samarbeidsavtale med Strandlivredderne.');
    if (bs.staffed) return fail_('Stranden er allerede bemannet.');
    if (!spend(18000)) return fail_('Du har ikke nok penger.');
    bs.staffed = true; bs.n = 1; Vol.makeGuard(id, 1);
    Log.add('REDNING', 'Sentral', 'Livredder på plass på ' + WORLD.beaches[id].navn + ' med håndterminal', 'info'); return ok_(WORLD.beaches[id].navn + ' er bemannet.');
  },
  addGuard(id) {
    const bs = Vol.beach(id); if (!bs.staffed || bs.n >= 2) return fail_('Ikke mulig.'); if (!spend(10000)) return fail_('Du har ikke nok penger.');
    bs.n = 2; Vol.makeGuard(id, 2); return ok_('Ekstra livredder på ' + WORLD.beaches[id].navn + '.');
  },
  upgrade(id, key) {
    const bs = Vol.beach(id), U = BEACH_UP[key]; if (!bs.staffed) return fail_('Bemann stranden først.'); if (bs.up[key]) return fail_('Allerede kjøpt.');
    if (!spend(U.cost)) return fail_('Du har ikke nok penger.'); bs.up[key] = 1; return ok_(U.navn + ' er på plass.');
  },
  /** Lifeguard-enheter og tårnfigurer følger årstiden. */
  seasonSync() {
    const summer = isSummer(), duty = Vol.onDuty();
    for (const id in S.units) { const u = S.units[id]; if (u.type === 'livredder') { const on = !!(duty && S.beaches[u.beach] && S.beaches[u.beach].staffed); if (u.vis !== on && u.status === 'ledig') u.vis = on; } }
    if (R.ready && R.world) for (const id in WORLD.beaches) R.setGuard(id, !!(duty && S.beaches[id] && S.beaches[id].staffed));
    if (R.ready && R.world && R.summer !== summer) R.setBeachSeason(summer);
  },
  /* ---- arrangementer ---- */
  occurrence(e) {
    const yearLen = 4 * DPS * MIN_DAY, nowAbs = Clock.abs(), base = (e.sesong * DPS + e.dag) * MIN_DAY, y = Math.floor(nowAbs / yearLen);
    for (let k = 0; k < 2; k++) {
      const s = (y + k) * yearLen + base + e.fra * 60, en = (y + k) * yearLen + base + e.til * 60;
      if (en > nowAbs) return { ev: e, key: e.id + ':' + (y + k), tStart: S.t + (s - nowAbs), tEnd: S.t + (en - nowAbs) };
    }
    return null;
  },
  upcoming() { return WORLD.cfg.events.map(e => Vol.occurrence(e)).filter(Boolean).sort((a, b) => a.tStart - b.tStart); },
  venue(ev) { return WORLD.venue(ev); },
  booking(key) { return S.vol.bookings.find(b => b.key === key); },
  book(key, org) {
    const occ = Vol.upcoming().find(o => o.key === key); if (!occ) return fail_('Fant ikke arrangementet.');
    if (!S.vol[org]) return fail_('Krever samarbeidsavtale med ' + AGENCIES[org].navn + '.');
    if (Vol.booking(key)) return fail_('Sanitetsvakt er allerede booket.');
    const need = occ.ev.stor === 'Stort' ? 2 : 1, types = org === 'rk' ? ['sanitetslag_rk', 'hjelpekorpsbil'] : ['sanitetsbil', 'forstehjelpspost'];
    if (!Object.values(S.units).some(u => types.includes(u.type))) return fail_('Du har ingen sanitetsenheter hos ' + AGENCIES[org].kort + ' – kjøp enheter først.');
    S.vol.bookings.push({ key, org, evId: occ.ev.id, name: occ.ev.navn, need, types, tStart: occ.tStart, tEnd: occ.tEnd, units: [], state: 'planlagt' });
    Log.add('REDNING', 'Sentral', 'Sanitetsvakt booket: ' + AGENCIES[org].kort + ' til ' + occ.ev.navn, 'info');
    return ok_('Sanitetsvakt er booket for ' + occ.ev.navn + '.');
  },
  cancel(key) { const i = S.vol.bookings.findIndex(b => b.key === key); if (i < 0) return; const b = S.vol.bookings[i]; for (const id of b.units) { const u = S.units[id]; if (u && u.job && u.job.guard) { u.job = null; Sim.sendHome(u); } } S.vol.bookings.splice(i, 1); },
  update(dt) {
    // bemanning og avslutning av sanitetsvakter
    for (const b of S.vol.bookings) {
      if (b.state === 'planlagt' && S.t >= b.tStart - 55) {
        const ev = WORLD.cfg.events.find(e => e.id === b.evId), place = Vol.venue(ev);
        const idle = Object.values(S.units).filter(u => b.types.includes(u.type) && Sim.available(u)).sort((a, c) => Math.hypot(a.x - place.x, a.z - place.z) - Math.hypot(c.x - place.x, c.z - place.z));
        for (const u of idle.slice(0, b.need)) {
          u.job = { guard: b.key }; u.status = 'varslet'; u.phase = null; u.wait = Net.commDelay(u) + 0.3; u.guardPlace = place; b.units.push(u.id);
          Log.add('REDNING', u.name, 'Varslet til sanitetsvakt: ' + b.name, 'info');
        }
        b.state = b.units.length ? 'aktiv' : 'ubemannet';
        if (!b.units.length) Log.add('REDNING', 'Sentral', 'Ingen ledige enheter til sanitetsvakt på ' + b.name, 'warn');
      }
      if (b.state === 'aktiv' && S.t >= b.tEnd) {
        const hours = (b.tEnd - b.tStart) / 60, pay = Math.round(b.units.length * hours * 850);
        for (const id of b.units) { const u = S.units[id]; if (u && u.job && u.job.guard === b.key) { u.job = null; Sim.sendHome(u); } }
        S.money += pay; S.stats.income += pay; dayStat('income', pay); S.volBonus = Math.min(10, S.volBonus + 2); b.state = 'ferdig';
        Log.add('REDNING', 'Sentral', 'Sanitetsvakten på ' + b.name + ' er avsluttet · +' + fmtKr(pay), 'info'); Bus.emit('toast', { msg: 'Sanitetsvakt avsluttet: +' + fmtKr(pay), kind: 'good' });
      }
    }
    S.vol.bookings = S.vol.bookings.filter(b => !(b.state === 'ferdig' || b.state === 'ubemannet') || S.t - b.tEnd < 600);
    // hendelser på arrangementer
    for (const e of WORLD.cfg.events) {
      const o = Vol.occurrence(e); if (!o || S.t < o.tStart || S.t > o.tEnd) continue;
      const bk = Vol.booking(o.key), guarded = bk && bk.state === 'aktiv' && bk.units.some(id => S.units[id] && S.units[id].status === 'pastedet');
      if (Math.random() < (e.rate / 60) * dt * (guarded ? 0.45 : 1)) {
        const id = wpick([['arr_skade', 0.5], ['arr_besvimelse', 0.3], ['arr_rus', 0.2]], x => x[1])[0];
        const place = Vol.venue(e); place.x += rr(-3, 3); place.z += rr(-3, 3);
        if (guarded && Math.random() < 0.7) {
          const u = S.units[bk.units.find(i => S.units[i] && S.units[i].status === 'pastedet')];
          Log.add('REDNING', u.name, 'Sanitetsvakt behandler pasient på ' + e.navn + ' – situasjonen under kontroll', 'info'); S.money += 900; S.stats.income += 900; S.volBonus = Math.min(10, S.volBonus + 0.15); continue;
        }
        const inc = Sim.makeIncident(id, place, { ev: o.key });
        if (guarded) { inc.pri = Math.min(3, inc.pri + 1); inc.rewardMul *= 0.8; }
      }
    }
  }
};
Sim.driveToGuard = function (u) {
  const place = u.guardPlace; u.status = 'utrykning'; u.phase = 'drive'; u.dest = 'guard'; u.siren = false; u.boarded = -1;
  const r = WORLD.nav.route(Sim.unitRP(u), place.rp); if (!r.ok) { u.job = null; Sim.sendHome(u); return; }
  u.path = r.pts; u.pi = 0;
};

/* ==========================================================================
   11. ØKONOMI OG PROGRESJON – driftskostnader, tilskudd, nivåer og butikk
   ========================================================================== */
const Eco = {
  runCost() {
    let c = 0;
    for (const id in S.stations) { const st = S.stations[id]; if (st.gift) continue; c += ST[st.type].run + st.up.garasje * 4 + st.up.mannskap * 6; }
    for (const id in S.units) { const u = S.units[id]; if (u.bistand) continue; if (u.type === 'livredder' && u.vis === false) continue; c += UT[u.type].run; }
    for (const id in S.net.masts) { const m = S.net.masts[id]; c += (m.mobile ? 22 : 14) + 4 * m.level; }
    c += Math.max(0, S.net.termLevel - 1) * 10; for (const a of ETATER) if (S.agencies[a]) c += S.ops[a] * 9;   // operatører i nødsentralen
    return c + Staff.wages();
  },
  tick(dt) {
    S.acc += dt;
    while (S.acc >= 1) {
      S.acc -= 1; const c = this.runCost(), g = c * (0.5 + 0.5 * (S.ready || 70) / 100);
      S.money += g - c; S.stats.costs += c; S.stats.grant += g; dayStat('cost', c); dayStat('income', g);
    }
  },
  rank(level) { return RANKS[clamp(level, 1, RANKS.length) - 1]; },
  addXp(x) {
    S.xp += x;
    while (S.level < RANKS.length && S.xp >= RANKS[S.level].xp) {
      S.level++; Bus.emit('levelup', { level: S.level, rank: RANKS[S.level - 1], unlocks: Eco.unlocks(S.level) });
      Log.add('SENTRAL', 'Sentral', 'Nytt nivå: ' + RANKS[S.level - 1].navn, 'info');
    }
  },
  unlocks(lvl) {
    const out = [];
    for (const k in UT) if (UT[k].lvl === lvl && lvl > 1) out.push(UT[k].navn);
    for (const k in ST) if (ST[k].lvl === lvl && lvl > 1) out.push(ST[k].navn);
    for (const k in TEMPLATES) if (TEMPLATES[k].lvl === lvl && lvl > 1 && !TEMPLATES[k].ev) out.push('Hendelse: ' + TEMPLATES[k].navn);
    return out;
  },
  progress() { const r = RANKS[S.level - 1], n = RANKS[S.level]; return n ? clamp((S.xp - r.xp) / (n.xp - r.xp), 0, 1) : 1; }
};
Sim.guardsActive = () => S.vol.bookings.filter(b => b.state === 'aktiv' && b.units.some(id => S.units[id] && S.units[id].status === 'pastedet')).length;
Sim.readiness = function () {
  if (S._covT === undefined || S.t - S._covT > 20) { S.covFrac = Net.coverage(); S._covT = S.t; }
  const over = Sim.active().filter(i => !i.onScene && (S.t - i.t0) > i.target * 1.5).length;
  const vol = clamp(S.volBonus + (S.vol.rk ? 2 : 0) + (S.vol.nf ? 2 : 0) + (isSummer() ? Sim.staffedBeaches().length * 1.5 : 0) + Sim.guardsActive() * 1.2, 0, 15);
  return clamp(S.perf * 100 * 0.82 + (S.covFrac === undefined ? 0.7 : S.covFrac) * 14 + vol - Math.min(18, over * 3), 0, 100);
};

/** Butikken. Hver vare har id, kategori, pris, nivåkrav og en handling. */
const AGENCY_COST = { brann: 250000, politi: 260000, ambulanse: 240000 };
const SPEED_UP_COST = [60000, 110000, 180000];
const Shop = {
  cats: [{ id: 'etat', navn: 'Stasjoner', ikon: 'house' }, { id: 'kjoretoy', navn: 'Kjøretøy', ikon: 'truck' }, { id: 'oppg', navn: 'Oppgraderinger', ikon: 'wrench' },
    { id: 'frivillig', navn: 'Frivillige', ikon: 'hand' }, { id: 'nodnett', navn: 'Nødnett', ikon: 'mast' }],
  items(cat) {
    const out = [], lv = S.level;
    const add = o => out.push(Object.assign({ cat, lvl: 1, ok: true, reason: '', kind: 'instant' }, o));
    const gate = (it, cond, reason) => { if (!cond) { it.ok = false; it.reason = reason; } return it; };
    if (cat === 'etat') {
      for (const a of ETATER) if (!S.agencies[a]) {
        add({ id: 'agency:' + a, navn: 'Opprett ' + AGENCIES[a].navn.toLowerCase() + ' (' + AGENCIES[a].nr + ')', tekst: 'Gir deg ' + AGENCIES[a].sentral + ' og nye hendelser. Bygg stasjon og kjøp enheter etterpå.', ikon: AGENCIES[a].ikon, farge: AGENCIES[a].farge, cost: AGENCY_COST[a] });
      }
      for (const t of ['brannstasjon', 'politistasjon', 'ambulansestasjon', 'sykehus', 'legevakt', 'arrest', 'helikopterbase']) {
        const T = ST[t], it = { id: 'station:' + t, navn: T.navn, ikon: T.ikon, farge: AGENCIES[T.org].farge, cost: T.cost, lvl: T.lvl, kind: 'place',
          tekst: { brannstasjon: 'Bygges på en ledig tomt. Rommer ' + T.cap + ' kjøretøy.', politistasjon: 'Bygges på en ledig tomt. Rommer ' + T.cap + ' kjøretøy.', ambulansestasjon: 'Bygges på en ledig tomt. Rommer ' + T.cap + ' kjøretøy.',
            sykehus: 'Ekstra mottak for pasienter – kortere transport.', legevakt: 'Mottak for «vanlig» pasienter, kortere transport.', arrest: 'Politiet leverer pågrepne her (raskere og gir bonus).', helikopterbase: 'Hjemmebase for luftambulansen. Krever landingsplass ved hendelser.' }[t] };
        if (['brannstasjon', 'politistasjon', 'ambulansestasjon'].includes(t)) gate(it, S.agencies[T.org], 'Du har ikke ' + AGENCIES[T.org].kort.toLowerCase() + 'etaten ennå.');
        else if (t === 'arrest') gate(it, S.agencies.politi, 'Krever politietaten.'); else gate(it, S.agencies.ambulanse, 'Krever ambulanseetaten.');
        if (lv < T.lvl) { it.ok = false; it.reason = 'Krever nivå ' + T.lvl; } else if (it.ok && S.money < T.cost) { it.ok = false; it.reason = 'For lite penger'; }
        add(it);
      }
    }
    if (cat === 'kjoretoy') {
      for (const t in UT) {
        const T = UT[t]; if (!ETATER.includes(T.org)) continue; if (!S.agencies[T.org]) continue;
        const it = { id: 'unit:' + t, navn: T.navn, ikon: AGENCIES[T.org].ikon, farge: AGENCIES[T.org].farge, cost: T.cost + Staff.crewCost(t), lvl: T.lvl, kind: 'unit', tekst: 'Inkl. ' + (T.cm ? T.cm + ' ansatte' + (T.k160 ? ' (' + T.k160 + ' med kode 160)' : '') : 'mannskap') + ' og radioterminal · drift ' + T.run + ' kr/min' + (T.needs ? ' · krever helikopterbase' : '') + (T.boat ? ' · ligger ved nærmeste kai' : '') };
        const sts = Object.values(S.stations).filter(st => Sim.canHouse(t, st) && Sim.unitsAt(st.id).length < Sim.stationCap(st));
        if (lv < T.lvl) { it.ok = false; it.reason = 'Krever nivå ' + T.lvl; } else if (!sts.length) { it.ok = false; it.reason = T.needs ? 'Bygg helikopterbase først' : 'Ingen stasjon med ledig plass'; } else if (S.money < it.cost) { it.ok = false; it.reason = 'For lite penger'; }
        add(it);
      }
    }
    if (cat === 'oppg') {
      for (const a of ETATER) if (S.agencies[a]) {
        const l = S.up[a], it = { id: 'upg:' + a, navn: 'Raskere utrykning – ' + AGENCIES[a].kort, ikon: AGENCIES[a].ikon, farge: AGENCIES[a].farge, cost: SPEED_UP_COST[l] || 0, tekst: 'Nivå ' + l + ' av 3 · +8 % fart og kortere utrykningstid for alle enheter' };
        if (l >= 3) { it.ok = false; it.reason = 'Maks nivå'; it.cost = 0; } else if (S.money < it.cost) { it.ok = false; it.reason = 'For lite penger'; }
        add(it);
      }
      add({ id: 'info:station', navn: 'Stasjonsoppgraderinger', ikon: 'house', farge: '#9AA5A0', cost: 0, tekst: 'Større garasje og flere mannskaper kjøpes per stasjon under «Stasjoner».', kind: 'info', ok: false, reason: '' });
    }
    if (cat === 'frivillig') {
      for (const o of FRIVILLIGE) {
        if (o === 'strand' && !Object.keys(WORLD.beaches).length) continue;
        if (!S.vol[o]) add({ id: 'sign:' + o, navn: 'Samarbeidsavtale – ' + AGENCIES[o].navn, tekst: AGENCIES[o].tekst, ikon: AGENCIES[o].ikon, farge: AGENCIES[o].farge, cost: ORG_COST[o], ok: S.money >= ORG_COST[o], reason: 'For lite penger' });
      }
      for (const t of ['rk_base', 'nf_base', 'rs_base']) {
        const T = ST[t], o = T.org, it = { id: 'station:' + t, navn: T.navn + ' (' + AGENCIES[o].kort + ')', ikon: 'hand', farge: AGENCIES[o].farge, cost: T.cost, kind: 'place', tekst: 'Base for frivillige på en ledig tomt. Rommer ' + T.cap + ' enheter.' };
        gate(it, S.vol[o], 'Krever samarbeidsavtale'); if (it.ok && S.money < T.cost) { it.ok = false; it.reason = 'For lite penger'; } add(it);
      }
      for (const t in UT) {
        const T = UT[t]; if (!['rk', 'nf', 'rs'].includes(T.org) || !S.vol[T.org]) continue;
        const sts = Object.values(S.stations).filter(st => Sim.canHouse(t, st) && Sim.unitsAt(st.id).length < Sim.stationCap(st));
        const it = { id: 'unit:' + t, navn: T.navn + ' (' + AGENCIES[T.org].kort + ')', ikon: 'hand', farge: AGENCIES[T.org].farge, cost: T.cost, kind: 'unit', lvl: T.lvl, tekst: 'Mobiliseringstid ca. ' + T.mob + ' min · drift ' + T.run + ' kr/min · inkl. terminal' };
        if (lv < T.lvl) { it.ok = false; it.reason = 'Krever nivå ' + T.lvl; } else if (!sts.length) { it.ok = false; it.reason = 'Trenger base med ledig plass'; } else if (S.money < T.cost) { it.ok = false; it.reason = 'For lite penger'; }
        add(it);
      }
      if (Object.keys(WORLD.beaches).length) add({ id: 'beaches', navn: 'Strender: bemanning og utstyr', tekst: 'Bemann strendene om sommeren og oppgrader med livbøye, redningsbrett, båt og hjertestarter.', ikon: 'buoy', farge: AGENCIES.strand.farge, cost: 0, kind: 'beaches', ok: S.vol.strand, reason: 'Krever avtale med Strandlivredderne' });
    }
    if (cat === 'nodnett') {
      add({ id: 'mast:new', navn: 'Ny basestasjon (mast)', ikon: 'mast', farge: '#A99BCB', cost: 120000, kind: 'place', tekst: 'Utvider dekningen. Kan stå på ledige tomter, i parker og på øyer.', ok: S.money >= 120000, reason: 'For lite penger' });
      add({ id: 'mast:mobile', navn: 'Mobil basestasjon (' + S.net.mobile + ' på lager)', ikon: 'mast', farge: '#A99BCB', cost: 90000, tekst: 'Transportabel mast for store hendelser og utfall. Settes ut hvor som helst.', ok: S.money >= 90000, reason: 'For lite penger' });
      add({ id: 'mast:cap', navn: 'Kapasitetsoppgradering', ikon: 'signal', farge: '#A99BCB', cost: 45000, kind: 'pickmast', tekst: '+4 samtidige samtaler på en valgt basestasjon.', ok: S.money >= 45000, reason: 'For lite penger' });
      if (S.net.termLevel < 3) { const c = Shop.termCost(); add({ id: 'term', navn: S.net.termLevel ? 'Nødnett-terminaler → nivå ' + (S.net.termLevel + 1) : 'Bytt fra VHF til Nødnett-terminaler', ikon: 'radio', farge: '#A99BCB', cost: c, tekst: S.net.termLevel ? 'Raskere ordremottak og stabilere kontakt i svak dekning.' : 'Kryptert digitalt samband: talegrupper per etat, samvirke-grupper, nødknapp med posisjon og mye kortere ordretid.', ok: S.money >= c, reason: 'For lite penger' }); }
      for (const a of ETATER) if (S.agencies[a] && S.ops[a] < 4) add({ id: 'ops:' + a, navn: 'Operatørplass – ' + AGENCIES[a].sentral, ikon: AGENCIES[a].ikon, farge: AGENCIES[a].farge, cost: 40000, tekst: 'Nå ' + S.ops[a] + ' plass(er). Hver plass håndterer tre samtidige hendelser uten kø.', ok: S.money >= 40000, reason: 'For lite penger' });
    }
    return out;
  },
  /** Utfør kjøp. arg = lotId / stationId / mastId avhengig av vare. */
  exec(id, arg) {
    const [k, v] = id.split(':');
    switch (k) {
      case 'agency': if (!spend(AGENCY_COST[v])) return fail_('Du har ikke nok penger.'); S.agencies[v] = true; Log.add('SENTRAL', 'Sentral', AGENCIES[v].sentral + ' er opprettet', 'info'); return ok_(AGENCIES[v].sentral + ' er opprettet. Bygg nå en stasjon.');
      case 'station': return Sim.buildStation(v, arg);
      case 'unit': return Sim.buyUnit(v, arg);
      case 'upg': { const l = S.up[v]; if (l >= 3) return fail_('Maks nivå.'); if (!spend(SPEED_UP_COST[l])) return fail_('Du har ikke nok penger.'); S.up[v]++; return ok_('Raskere utrykning nivå ' + S.up[v] + ' for ' + AGENCIES[v].kort + '.'); }
      case 'sign': return Vol.sign(v);
      case 'mast': {
        if (v === 'new') { if (!isFree(WORLD.lotById.get(arg))) return fail_('Tomten er ikke ledig.'); if (!spend(120000)) return fail_('Du har ikke nok penger.'); const mid = Net.addMast(arg); Log.add('NØDNETT', 'Driftssentral', 'Ny basestasjon ' + S.net.masts[mid].navn + ' er i drift', 'info'); return ok_('Ny basestasjon er bygget.'); }
        if (v === 'mobile') { if (!spend(90000)) return fail_('Du har ikke nok penger.'); S.net.mobile++; return ok_('Mobil basestasjon er på lager. Sett den ut under Nødnett.'); }
        if (v === 'cap') { const m = S.net.masts[arg]; if (!m || m.level >= 3) return fail_('Basestasjonen har maks kapasitet.'); if (!spend(45000)) return fail_('Du har ikke nok penger.'); Net.upgrade(arg); return ok_('Kapasiteten på ' + m.navn + ' er økt.'); }
        break; }
      case 'term': { const c = Shop.termCost(); if (S.net.termLevel >= 3) return fail_('Maks nivå.'); if (!spend(c)) return fail_('Du har ikke nok penger.'); S.net.termLevel++; Log.add('NØDNETT', 'Driftssentral', S.net.termLevel === 1 ? 'Alle enheter har fått Nødnett-terminaler – VHF er faset ut' : 'Terminalene er oppgradert til nivå ' + S.net.termLevel, 'info'); return ok_(S.net.termLevel === 1 ? 'Dere bruker nå Nødnett!' : 'Terminalene er oppgradert til nivå ' + S.net.termLevel + '.'); }
      case 'ops': if (S.ops[v] >= 4) return fail_('Maks antall operatørplasser.'); if (!spend(40000)) return fail_('Du har ikke nok penger.'); S.ops[v]++; return ok_('Ny operatørplass i ' + AGENCIES[v].sentral + '.');
    }
    return fail_('Ukjent vare.');
  },
  termCost: () => [140000, 90000, 180000][S.net.termLevel] || 0,
  upgradeStation(stId, key) {
    const st = S.stations[stId]; if (!st) return fail_('Ukjent stasjon.');
    const lvl = st.up[key], max = key === 'garasje' ? 2 : 3, cost = (key === 'garasje' ? 70000 : 55000) * (lvl + 1);
    if (lvl >= max) return fail_('Maks nivå.'); if (!spend(cost)) return fail_('Du har ikke nok penger (' + fmtKr(cost) + ').');
    st.up[key]++; return ok_(key === 'garasje' ? 'Garasjen er utvidet med to plasser.' : 'Flere mannskaper på ' + st.name + '.');
  },
  stationUpCost(st, key) { const lvl = st.up[key], max = key === 'garasje' ? 2 : 3; return lvl >= max ? null : (key === 'garasje' ? 70000 : 55000) * (lvl + 1); }
};

/* ==========================================================================
   Simuleringstikk og nytt spill
   ========================================================================== */
Sim.tick = function (dt) {
  S.t += dt; Clock.info();
  updateWeather();
  Vol.seasonSync();
  Net.update(dt);
  Sim.spawnTick();
  Vol.update(dt);
  Sim.callTick(); Staff.tick();
  Sim.updateIncidents(dt);
  for (const id in S.units) { const u = S.units[id]; if (u) Sim.updateUnit(u, dt); }
  Eco.tick(dt);
  S.volBonus *= Math.exp(-dt / 2500);
  S.ready = Sim.readiness();
  if (Math.floor(S.t / 60) !== Math.floor((S.t - dt) / 60)) { S.stats.readyHist.push(Math.round(S.ready)); if (S.stats.readyHist.length > 48) S.stats.readyHist.shift(); }
};
/** Oppretter nytt spill: bygger by, tilstand, sykehus og master. */
Sim.newGame = function (cityId, first, startSeason, world) {
  WORLD = world; WORLD.clearDyn();                       // tomter fra en tidligere runde skal ikke bli med
  S = newState(cityId, first, startSeason);
  Clock.info(); Net.init();
  for (const h of WORLD.hospitalDefs) Sim.buildStation(h.type, h.lotId, { free: true, force: true, name: h.navn });
  Log.add('SENTRAL', 'Sentral', 'Velkommen til ' + CITY_CONFIGS[cityId].navn + ' – hold beredskapen oppe', 'info');
  S.ready = Sim.readiness();
  return S;
};
Sim.firstStation = function (lotId) {
  const type = STATION_FOR_ORG[S.first], r = Sim.buildStation(type, lotId, { free: true });
  if (!r.ok) return r;
  const ut = { brann: 'mannskapsbil', politi: 'patruljebil', ambulanse: 'ambulanse' }[S.first];
  const u = Sim.addUnit(ut, r.st.id, { freeCrew: true });
  Log.add(AGENCIES[S.first].tg, AGENCIES[S.first].sentral, r.st.name + ' er etablert. ' + u.name + ' er meldt ledig på Nødnett', 'info');
  S.paused = false; return r;
};
