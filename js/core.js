'use strict';
/* NødByen – kjerne: hjelpere, ikoner og spilldata */
/* ==========================================================================
   NødByen – beredskapsspill i nettleseren (én selvstendig HTML-fil)

   Kodens seksjoner (fordelt på js/-filene):
     1.  Hjelpefunksjoner og ikoner
     2.  Spilldata: etater, enhetstyper, stasjonstyper, hendelsesmaler, årstider
     3.  Byconfig (én config per by – legg til flere byer her)
     4.  Byggenerering (verden, vei-nett, A*-stifinning)
     5.  3D-rendering (Three.js, kamera, modeller, effekter)
     6.  Årstider, tid og vær
     7.  Nødnett (terminaler, talegrupper, dekning, kapasitet, nødknapp, utfall)
     8.  Enheter og stasjoner
     9.  Hendelser (generering, utsendelse, utfall, belønning)
     10. Frivillige (Røde Kors, Folkehjelp, strandlivreddere, arrangementer)
     11. Økonomi og progresjon (butikk, driftskostnader, nivåer)
     12. Lagring (localStorage per by)
     13. UI (panel, kort, dialoger, startflyt)
     14. Hovedløkke og oppstart
   ========================================================================== */

/* ==========================================================================
   1. HJELPEFUNKSJONER OG IKONER
   ========================================================================== */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** Seedet tilfeldighetsgenerator (mulberry32) – gir lik by hver gang. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s || 0) | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
const rr = (a, b) => a + Math.random() * (b - a);                  // tilfeldig tall
const ri = (a, b) => Math.floor(rr(a, b + 1));                      // tilfeldig heltall (inkl.)
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function wpick(items, wf) {                                         // vektet valg
  let tot = 0; for (const it of items) tot += wf(it);
  if (tot <= 0) return null;
  let r = Math.random() * tot;
  for (const it of items) { r -= wf(it); if (r <= 0) return it; }
  return items[items.length - 1];
}
const pad2 = n => (n < 10 ? '0' : '') + n;
const fmtKr = n => (n < 0 ? '−' : '') + 'kr ' + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fmtNum = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fmtClock = m => pad2(Math.floor(m / 60) % 24) + ':' + pad2(Math.floor(m % 60));
const fmtDur = m => { m = Math.max(0, m); return m < 1 ? '< 1 min' : m < 60 ? Math.round(m) + ' min' : Math.floor(m / 60) + ' t ' + pad2(Math.round(m % 60)) + ' min'; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; };

/** Egne enkle symboler (24×24, strek). Ingen ekte logoer brukes. */
const ICONS = {
  flame: '<path d="M12 3c.6 3 4.6 4.8 4.6 9.2A4.6 4.6 0 0 1 12 17a4.6 4.6 0 0 1-4.6-4.8c0-1.9.9-3.1 1.9-4 .2 1.4.8 2.2 1.7 2.5C10.8 8.2 10.8 5.2 12 3z"/>',
  shield: '<path d="M12 3.2l7 2.6v5.4c0 4.2-2.9 7.6-7 9.6-4.1-2-7-5.4-7-9.6V5.8z"/><path d="M12 8.4l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z"/>',
  pulse: '<path d="M12 20.2s-7.2-4.4-7.2-10A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.2 2.6c0 5.6-7.2 10-7.2 10z"/><path d="M7.6 12h2.2l1.1-2.2 2 4.2 1.1-2h2.4"/>',
  hand: '<path d="M12 20s-7-4.2-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.800 12 20 12 20z"/><path d="M12 11.200v3.400M10.300 12.900h3.400"/>',
  buoy: '<circle cx="12" cy="12" r="8.200"/><circle cx="12" cy="12" r="3.600"/><path d="M6.200 6.200l3.200 3.200M17.800 6.200l-3.200 3.200M6.200 17.800l3.200-3.200M17.800 17.800l-3.200-3.200"/>',
  mast: '<path d="M12 11.500v9M8.500 20.500h7"/><circle cx="12" cy="9.200" r="1.700"/><path d="M8 5.600a5.800 5.800 0 0 0 0 7.200M16 5.600a5.800 5.800 0 0 1 0 7.200M5.200 3.400a9.600 9.600 0 0 0 0 11.600M18.800 3.400a9.600 9.600 0 0 1 0 11.600"/>',
  bell: '<path d="M6.500 16.500V11a5.500 5.500 0 0 1 11 0v5.500l1.500 1.800H5z"/><path d="M10 20.500a2 2 0 0 0 4 0"/>',
  warn: '<path d="M12 4.500l8.500 14.500h-17z"/><path d="M12 10.200v4M12 16.600v.4"/>',
  clock: '<circle cx="12" cy="12" r="8.400"/><path d="M12 7.200V12l3.200 2"/>',
  coin: '<circle cx="12" cy="12" r="8.400"/><path d="M14.600 9.400c-.4-1-1.400-1.500-2.600-1.500-1.500 0-2.600.8-2.600 1.900 0 2.500 5.400 1.200 5.400 3.900 0 1.100-1.200 2-2.800 2-1.300 0-2.400-.6-2.800-1.700M12 6.600v1.300M12 16.100v1.300"/>',
  truck: '<path d="M3 16.500V7.500h10.500v9M13.500 10.500h3.800l3.200 3.200v2.800h-7"/><circle cx="7.200" cy="17.600" r="1.700"/><circle cx="16.800" cy="17.600" r="1.700"/>',
  house: '<path d="M4 11.200L12 4.400l8 6.800V20H4z"/><path d="M9.800 20v-5.600h4.400V20"/>',
  bag: '<path d="M5.200 8.400h13.600l-1 11.600H6.200z"/><path d="M9 8.400a3 3 0 0 1 6 0"/>',
  chart: '<path d="M5.500 19.500v-8M12 19.500V5M18.500 19.500v-11"/>',
  pin: '<path d="M12 20.500s-6-5.400-6-10.200a6 6 0 0 1 12 0c0 4.800-6 10.200-6 10.200z"/><circle cx="12" cy="10.200" r="2.200"/>',
  layers: '<path d="M12 4l8.500 4.600L12 13.200 3.500 8.600z"/><path d="M3.500 12.600L12 17.200l8.500-4.600"/>',
  plus: '<path d="M12 5.500v13M5.500 12h13"/>',
  x: '<path d="M6.500 6.500l11 11M17.500 6.500l-11 11"/>',
  check: '<path d="M5.500 12.500l4.300 4.300L18.500 8"/>',
  pause: '<path d="M8.500 6.500v11M15.500 6.500v11"/>',
  play: '<path d="M8 5.800v12.400L18.400 12z"/>',
  mountain: '<path d="M3 19l6.200-10.500 3.800 6 2.200-3.200L21 19z"/>',
  wave: '<path d="M3 13c2.500 0 2.500-2.500 5-2.500s2.500 2.500 5 2.500 2.500-2.500 5-2.500M3 18c2.500 0 2.500-2.500 5-2.500s2.500 2.500 5 2.500 2.500-2.500 5-2.500"/>',
  sun: '<circle cx="12" cy="12" r="3.800"/><path d="M12 3.500v2.200M12 18.300v2.200M3.500 12h2.200M18.300 12h2.200M6 6l1.500 1.500M16.500 16.500L18 18M18 6l-1.500 1.500M7.500 16.500L6 18"/>',
  leaf: '<path d="M5 19c0-8 4.600-13 14-14 .5 9.400-5 14-12.500 13.400M5 19c2.500-4 5-6.500 8-8"/>',
  snow: '<path d="M12 3.500v17M4.600 7.800l14.800 8.400M19.400 7.800L4.600 16.200"/>',
  rain: '<path d="M7.500 14.500a4.200 4.200 0 0 1-.4-8.300 5.300 5.300 0 0 1 10 1.300 3.500 3.500 0 0 1-.1 7M9 17.500l-1 2.500M13 17.500l-1 2.500M17 17.500l-1 2.500"/>',
  cloud: '<path d="M7.500 18a4.300 4.300 0 0 1-.5-8.600 5.500 5.500 0 0 1 10.500 1.400A3.600 3.600 0 0 1 17 18z"/>',
  wind: '<path d="M3.500 9.500h10a2.500 2.500 0 1 0-2.400-3M3.500 14h14a2.800 2.800 0 1 1-2.600 3.800M3.500 11.800h7"/>',
  people: '<circle cx="9" cy="8.500" r="3"/><path d="M3.500 19c.3-3.300 2.600-5.200 5.500-5.200s5.200 1.900 5.500 5.200"/><circle cx="17.200" cy="9.400" r="2.300"/><path d="M16.800 14.200c2.200 0 3.700 1.400 3.900 3.800"/>',
  radio: '<rect x="8" y="8.500" width="8" height="12" rx="2.400"/><path d="M12 8.500V3.500M10 12.500h4M10 16h4"/>',
  list: '<path d="M8.500 7h11M8.500 12h11M8.500 17h11M4.600 7h.01M4.600 12h.01M4.600 17h.01"/>',
  menu: '<path d="M5 7.500h14M5 12h14M5 16.500h14"/>',
  car: '<path d="M4 15.500v-4l1.800-4.500h12.400L20 11.500v4zM4 15.500v2.500M20 15.500v2.500M4 11.500h16"/>',
  heli: '<path d="M5 6.500h14M12 6.500v3"/><ellipse cx="11" cy="13" rx="5.500" ry="3.200"/><path d="M16.500 12.500H21M7 18.500h8"/>',
  calendar: '<rect x="4" y="5.500" width="16" height="14.500" rx="3.200"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4"/>',
  up: '<path d="M6 14.500l6-6 6 6"/>',
  down: '<path d="M6 9.500l6 6 6-6"/>',
  lock: '<rect x="5.500" y="10.500" width="13" height="9.500" rx="2.800"/><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500"/>',
  signal: '<path d="M5.500 19v-3M10.200 19v-6M14.800 19V9.500M19.500 19V5.500"/>',
  gauge: '<path d="M4.500 16a7.800 7.800 0 1 1 15 0"/><path d="M12 16l3.500-5"/>',
  bolt: '<path d="M13 3.500L6.500 13H12l-1 7.500L17.500 11H12z"/>',
  eye: '<path d="M3 12s3.500-6 9-6 9 6 9 6-3.500 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.600"/>',
  star: '<path d="M12 4l2.400 5 5.400.7-4 3.800 1 5.400-4.800-2.700-4.800 2.700 1-5.400-4-3.800 5.400-.7z"/>',
  rotl: '<path d="M5.500 12a6.500 6.500 0 1 0 2-4.700"/><path d="M5 4.500v4h4"/>',
  rotr: '<path d="M18.500 12a6.500 6.500 0 1 1-2-4.700"/><path d="M19 4.500v4h-4"/>',
  home: '<circle cx="12" cy="12" r="7.500"/><path d="M12 3.500v3M12 17.500v3M3.500 12h3M17.500 12h3"/><circle cx="12" cy="12" r="1.400"/>',
  wrench: '<path d="M14.500 5.500a4 4 0 0 0-4.800 5L4.500 15.700a1.800 1.800 0 0 0 2.600 2.600l5.200-5.200a4 4 0 0 0 5-4.800l-2.400 2.400-2.300-.6-.6-2.300z"/>',
  tower: '<path d="M7 20.500l2-9M17 20.500l-2-9M8 15.500h8M6.500 11.500h11v-3h-11zM12 8.500V5M9.500 5h5"/>',
  doc: '<path d="M7 3.500h7.500L19 8v12.500H7z"/><path d="M14 3.500V8.500h5M9.800 13h5.500M9.800 16.500h5.500"/>',
  tools: '<path d="M4.500 19.500l7-7M13 6l5 5M14.500 4.500l5 5-2 2-5-5z"/>',
  heart: '<path d="M12 20s-7-4.200-7-9.600A3.900 3.900 0 0 1 12 8a3.900 3.900 0 0 1 7 2.400C19 15.800 12 20 12 20z"/>',
  gas: '<path d="M7.500 18a4.300 4.300 0 0 1-.5-8.600 5.500 5.500 0 0 1 10.500 1.400A3.600 3.600 0 0 1 17 18z"/><path d="M9 21h6"/>',
  anchor: '<circle cx="12" cy="6" r="2"/><path d="M12 8v12.500M7.500 12.500h9M5 15c.5 3 3.300 5.500 7 5.500s6.500-2.500 7-5.500"/>',
  bars: '<path d="M6 20V10M12 20V4M18 20v-7"/>'
};
/** Lager en inline SVG med eget symbol. */
function icon(name, cls) {
  return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}
/** Frittstående SVG-streng for bruk som bilde (3D-sprites). */
function iconSvgString(name, color, size) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
}

/* ==========================================================================
   2. SPILLDATA
   ========================================================================== */
const SEA = 0;                   // havnivå (kartet er flatt; høyder tegnes av MapLibre)
const MIN_PER_SEC = 1;           // 1 sekund virkelig tid = 1 spillminutt ved 1×
const DPS = 3;                   // dager per årstid
const MIN_DAY = 1440;

const SEASONS = [
  { id: 'var',    navn: 'Vår',    ikon: 'leaf', sun: [5.8, 20.6], speed: 1.0 },
  { id: 'sommer', navn: 'Sommer', ikon: 'sun',  sun: [4.2, 22.6], speed: 1.0 },
  { id: 'host',   navn: 'Høst',   ikon: 'wind', sun: [7.5, 18.2], speed: 0.97 },
  { id: 'vinter', navn: 'Vinter', ikon: 'snow', sun: [9.2, 15.3], speed: 0.86 }
];

/** Etater og organisasjoner (farger er dempet for å passe paletten). */
const AGENCIES = {
  brann:     { id: 'brann',     navn: 'Brann og redning', kort: 'Brann',     nr: '110', sentral: '110-sentral',            tg: 'BRANN',   farge: '#C9785D', ikon: 'flame',  tekst: 'Slukk branner, redd folk ut av vrakbiler og håndter gasslekkasjer.' },
  politi:    { id: 'politi',    navn: 'Politi',           kort: 'Politi',    nr: '112', sentral: 'Operasjonssentral 112',   tg: 'POLITI',  farge: '#6F8FB5', ikon: 'shield', tekst: 'Prioriter P1–P4, håndter innbrudd, slagsmål og savnede, og led søk og redning.' },
  ambulanse: { id: 'ambulanse', navn: 'Ambulanse',        kort: 'Ambulanse', nr: '113', sentral: 'AMK-sentral 113',         tg: 'HELSE',   farge: '#B3BE68', ikon: 'pulse',  tekst: 'Akutt, haster, vanlig: hjertestans, fall, fødsel og drukningsulykker.' },
  rk:        { id: 'rk',        navn: 'Røde Kors Hjelpekorps',  kort: 'Hjelpekorps', nr: '', sentral: '', tg: 'REDNING', farge: '#D98A82', ikon: 'hand', tekst: 'Søk etter savnede, førstehjelp, sanitetsvakt og fjellredning.' },
  nf:        { id: 'nf',        navn: 'Norsk Folkehjelp Sanitet', kort: 'Folkehjelp', nr: '', sentral: '', tg: 'REDNING', farge: '#C97C74', ikon: 'hand', tekst: 'Sanitetsvakt, søk og redning, støtte ved store ulykker.' },
  strand:    { id: 'strand',    navn: 'Strandlivreddere',       kort: 'Livredder', nr: '', sentral: '', tg: 'REDNING', farge: '#E5A267', ikon: 'buoy', tekst: 'Faste livreddere på badestrendene i Oslo – om sommeren.' },
  bistand:   { id: 'bistand',   navn: 'Nabodistrikt (bistand)', kort: 'Bistand',   nr: '', sentral: '', tg: 'SENTRAL', farge: '#9AA5A0', ikon: 'people', tekst: '' }
};
const ETATER = ['brann', 'politi', 'ambulanse'];
const FRIVILLIGE = ['rk', 'nf', 'strand'];

/** Enhetstyper. model = 3D-modell. cost/run i kr, spd = fartsfaktor, turnout = utrykningstid (min), mob = mobiliseringstid for frivillige (min). */
const UT = {
  mannskapsbil:    { navn: 'Mannskapsbil',          org: 'brann',     model: 'truck',    cost: 130000, run: 10, spd: 1.00, crew: 6, lvl: 1, turnout: 1.3, term: 'k' },
  tankbil:         { navn: 'Tankbil',               org: 'brann',     model: 'tanker',   cost: 150000, run: 11, spd: 0.92, crew: 3, lvl: 1, turnout: 1.4, term: 'k' },
  hoyderedskap:    { navn: 'Høyderedskap',          org: 'brann',     model: 'ladder',   cost: 380000, run: 18, spd: 0.85, crew: 3, lvl: 3, turnout: 1.6, term: 'k' },
  redningsbil:     { navn: 'Redningsbil',           org: 'brann',     model: 'rescue',   cost: 210000, run: 13, spd: 0.95, crew: 4, lvl: 2, turnout: 1.4, term: 'k' },
  rokdykker:       { navn: 'Røykdykkerlag',         org: 'brann',     model: 'van',      cost: 90000,  run: 8,  spd: 1.00, crew: 4, lvl: 2, turnout: 1.2, term: 'h' },
  patruljebil:     { navn: 'Patruljebil',           org: 'politi',    model: 'car',      cost: 70000,  run: 6,  spd: 1.15, crew: 2, lvl: 1, turnout: 0.6, term: 'k' },
  up:              { navn: 'UP-bil (trafikk)',      org: 'politi',    model: 'car',      cost: 85000,  run: 7,  spd: 1.25, crew: 2, lvl: 2, turnout: 0.6, term: 'k', stripe: '#E4C94E' },
  hundepatrulje:   { navn: 'Hundepatrulje',         org: 'politi',    model: 'van',      cost: 110000, run: 8,  spd: 1.05, crew: 2, lvl: 3, turnout: 0.9, term: 'k' },
  innsatsleder:    { navn: 'Innsatsleder politi',   org: 'politi',    model: 'suv',      cost: 120000, run: 9,  spd: 1.15, crew: 1, lvl: 4, turnout: 0.7, term: 'k' },
  beredskapstropp: { navn: 'Beredskapstropp (Delta)', org: 'politi',  model: 'armored',  cost: 600000, run: 30, spd: 1.05, crew: 6, lvl: 8, turnout: 1.0, term: 'k' },
  ambulanse:       { navn: 'Ambulanse',             org: 'ambulanse', model: 'ambulance', cost: 120000, run: 9, spd: 1.10, crew: 2, lvl: 1, turnout: 0.8, term: 'k' },
  legebil:         { navn: 'Legebil',               org: 'ambulanse', model: 'suv',      cost: 180000, run: 12, spd: 1.20, crew: 2, lvl: 3, turnout: 0.8, term: 'k' },
  luftambulanse:   { navn: 'Luftambulanse',         org: 'ambulanse', model: 'heli',     cost: 900000, run: 60, spd: 3.00, crew: 3, lvl: 6, turnout: 2.0, term: 'k', needs: 'helikopterbase' },
  hjelpekorpsbil:  { navn: 'Hjelpekorpsbil',        org: 'rk',        model: 'van',      cost: 55000,  run: 4,  spd: 0.95, crew: 4, lvl: 1, mob: 8,  term: 'k' },
  atv:             { navn: 'ATV / snøscooter',      org: 'rk',        model: 'atv',      cost: 40000,  run: 3,  spd: 0.85, crew: 2, lvl: 1, mob: 6,  term: 'k', offroad: true },
  sanitetslag_rk:  { navn: 'Sanitetslag',           org: 'rk',        model: 'van',      cost: 25000,  run: 2,  spd: 0.95, crew: 4, lvl: 1, mob: 10, term: 'h' },
  sokelag_rk:      { navn: 'Søkelag',               org: 'rk',        model: 'van',      cost: 20000,  run: 2,  spd: 0.95, crew: 6, lvl: 1, mob: 12, term: 'h' },
  sanitetsbil:     { navn: 'Sanitetsbil',           org: 'nf',        model: 'ambulance', cost: 55000, run: 4,  spd: 0.95, crew: 3, lvl: 1, mob: 8,  term: 'k' },
  sokelag_nf:      { navn: 'Søkelag (Folkehjelp)',  org: 'nf',        model: 'van',      cost: 20000,  run: 2,  spd: 0.95, crew: 6, lvl: 1, mob: 12, term: 'h' },
  forstehjelpspost: { navn: 'Førstehjelpspost',     org: 'nf',        model: 'trailer',  cost: 30000,  run: 2,  spd: 0.70, crew: 4, lvl: 2, mob: 12, term: 'h' },
  livredder:       { navn: 'Livredder',             org: 'strand',    model: 'foot',     cost: 0,      run: 3,  spd: 0.8, crew: 1, lvl: 1, mob: 0,  term: 'h', foot: true }
};
/** Kort navn til kallesignal. */
const CALL = { mannskapsbil: 'Mannskapsbil', tankbil: 'Tankbil', hoyderedskap: 'Høyderedskap', redningsbil: 'Redningsbil', rokdykker: 'Røykdykkerlag',
  patruljebil: 'Patrulje', up: 'UP', hundepatrulje: 'Hundepatrulje', innsatsleder: 'Innsatsleder politi', beredskapstropp: 'Beredskapstropp',
  ambulanse: 'Ambulanse', legebil: 'Legebil', luftambulanse: 'Luftambulanse', hjelpekorpsbil: 'Hjelpekorps', atv: 'ATV', sanitetslag_rk: 'Sanitetslag',
  sokelag_rk: 'Søkelag', sanitetsbil: 'Sanitet', sokelag_nf: 'Søkelag NF', forstehjelpspost: 'Førstehjelpspost', livredder: 'Livredder' };

/** Stasjonstyper (bygg på ledige tomter). */
const ST = {
  brannstasjon:     { navn: 'Brannstasjon',     org: 'brann',     cost: 200000, run: 25, cap: 3, lvl: 1, ikon: 'flame',  farge: '#C9785D', rolle: 'etat' },
  politistasjon:    { navn: 'Politistasjon',    org: 'politi',    cost: 190000, run: 24, cap: 3, lvl: 1, ikon: 'shield', farge: '#6F8FB5', rolle: 'etat' },
  ambulansestasjon: { navn: 'Ambulansestasjon', org: 'ambulanse', cost: 170000, run: 22, cap: 3, lvl: 1, ikon: 'pulse',  farge: '#B3BE68', rolle: 'etat' },
  sykehus:          { navn: 'Sykehus',          org: 'ambulanse', cost: 600000, run: 45, cap: 0, lvl: 4, ikon: 'plus',   farge: '#F2EEE3', rolle: 'helse' },
  legevakt:         { navn: 'Legevakt',         org: 'ambulanse', cost: 220000, run: 20, cap: 0, lvl: 2, ikon: 'plus',   farge: '#DCE8D2', rolle: 'helse' },
  arrest:           { navn: 'Arrest',           org: 'politi',    cost: 150000, run: 15, cap: 0, lvl: 2, ikon: 'lock',   farge: '#9AA5B5', rolle: 'arrest' },
  helikopterbase:   { navn: 'Helikopterbase',   org: 'ambulanse', cost: 450000, run: 35, cap: 2, lvl: 5, ikon: 'heli',   farge: '#C9CF8A', rolle: 'etat' },
  rk_base:          { navn: 'Hjelpekorpsbase',  org: 'rk',        cost: 90000,  run: 8,  cap: 3, lvl: 1, ikon: 'hand',   farge: '#D98A82', rolle: 'frivillig' },
  nf_base:          { navn: 'Sanitetsbase',     org: 'nf',        cost: 80000,  run: 7,  cap: 3, lvl: 1, ikon: 'hand',   farge: '#C97C74', rolle: 'frivillig' }
};
const STATION_FOR_ORG = { brann: 'brannstasjon', politi: 'politistasjon', ambulanse: 'ambulansestasjon', rk: 'rk_base', nf: 'nf_base' };

/** Rangstige (nivåer). */
const RANKS = [
  { lvl: 1,  xp: 0,    navn: 'Vaktleder' },
  { lvl: 2,  xp: 120,  navn: 'Operasjonsleder' },
  { lvl: 3,  xp: 320,  navn: 'Utrykningsleder' },
  { lvl: 4,  xp: 650,  navn: 'Beredskapskoordinator' },
  { lvl: 5,  xp: 1100, navn: 'Beredskapssjef' },
  { lvl: 6,  xp: 1800, navn: 'Distriktssjef' },
  { lvl: 7,  xp: 2800, navn: 'Regionsleder' },
  { lvl: 8,  xp: 4200, navn: 'Fylkesberedskapssjef' },
  { lvl: 9,  xp: 6200, navn: 'Direktør for samfunnssikkerhet' },
  { lvl: 10, xp: 9000, navn: 'Beredskapsdirektør' }
];

/** Grupper av enhetstyper som kan fylle en rolle (slot) i en hendelse. */
const ACC = {
  mb: ['mannskapsbil'], tank: ['tankbil'], slokk: ['mannskapsbil', 'tankbil'], stige: ['hoyderedskap'], redn: ['redningsbil'], rok: ['rokdykker'],
  patr: ['patruljebil', 'up'], pol: ['patruljebil', 'up', 'innsatsleder'], hund: ['hundepatrulje'], il: ['innsatsleder'], delta: ['beredskapstropp'],
  amb: ['ambulanse'], lege: ['legebil', 'luftambulanse'], ambV: ['ambulanse', 'sanitetsbil', 'hjelpekorpsbil'],
  sok: ['sokelag_rk', 'sokelag_nf', 'hundepatrulje'], fjell: ['atv', 'hjelpekorpsbil', 'sokelag_rk'],
  stotte: ['sanitetsbil', 'hjelpekorpsbil', 'sanitetslag_rk', 'forstehjelpspost'], livr: ['livredder'],
  strandAmb: ['livredder', 'ambulanse', 'sanitetsbil', 'hjelpekorpsbil'], finn: ['livredder', 'patruljebil', 'up', 'hundepatrulje'],
  san: ['sanitetslag_rk', 'sanitetsbil', 'forstehjelpspost', 'hjelpekorpsbil']
};
/** Roller i en hendelse: SL(id, etikett, aksepterte typer, etat for bistand, valg). */
const SL = (k, label, accepts, ag, o) => Object.assign({ k, label, accepts, ag, n: 1, req: true, units: [] }, o || {});

/** Prioritetsetiketter per etat. */
const PRI_LABEL = {
  brann:     { 1: 'Høy prioritet', 2: 'Middels', 3: 'Lav' },
  politi:    { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' },
  ambulanse: { 1: 'Akutt', 2: 'Haster', 3: 'Vanlig' }
};
const PRI_COLOR = { 1: '#D9695A', 2: '#E4AE4E', 3: '#8DB588', 4: '#8FA3B8' };

/**
 * Hendelsesmaler. Hver mal beskriver lokasjon, nødvendige ressurser (slots), arbeidstid,
 * responsmål (minutter), belønning, sesong- og døgnvekter og eventuelle varianter (prep).
 *  lead   = etater som kan «eie» hendelsen (må ha en av dem for at den skal dukke opp)
 *  tags   = brukes til byens vektjustering (incidentMul)
 *  loc    = hvor hendelsen skjer (bygg, hjem, vei, vann, strand, park, fjell, natt, arr)
 */
const TEMPLATES = {
  /* ---------------------------- BRANN (110) ---------------------------- */
  brann_bygning: { navn: 'Brann i bygning', lead: ['brann'], tags: ['brann_bygg'], pri: 1, w: 1.0, lvl: 1, loc: 'bygg', ikon: 'flame', fx: 'fire',
    slots: [SL('mb', 'Mannskapsbil', ACC.mb, 'brann'), SL('tb', 'Tankbil', ACC.tank, 'brann')],
    work: 14, target: 10, reward: 15000, expire: 32, danger: 0.55, xp: 28, inj: 0.28,
    season: { var: 0.8, sommer: 0.6, host: 1.3, vinter: 1.7 }, tod: { natt: 1.2, kveld: 1.3 },
    esc: { at: 17, msg: 'Brannen sprer seg – ekstra tankbil trengs', add: [SL('tb2', 'Ekstra tankbil', ACC.tank, 'brann')], workMul: 1.3, rewardMul: 1.3 },
    prep(inc) {
      if (inc.floors >= 6) inc.slots.push(SL('hr', 'Høyderedskap', ACC.stige, 'brann'));
      if (Math.random() < 0.12) inc.slots.push(SL('rd', 'Røykdykkerlag', ACC.rok, 'brann', { req: false }));
    } },
  bilbrann: { navn: 'Bilbrann', lead: ['brann'], tags: ['trafikk'], pri: 2, w: 0.9, lvl: 1, loc: 'vei', ikon: 'flame', fx: 'fire',
    slots: [SL('mb', 'Slokkeenhet', ACC.slokk, 'brann')], work: 6, target: 10, reward: 6500, expire: 28, danger: 0.05, xp: 12,
    season: { sommer: 1.2, vinter: 1.2 }, tod: { rush: 1.3 } },
  brannalarm: { navn: 'Automatisk brannalarm', lead: ['brann'], tags: [], pri: 3, w: 1.5, lvl: 1, loc: 'bygg', ikon: 'bell', fx: 'none',
    slots: [SL('mb', 'Mannskapsbil', ACC.mb, 'brann')], work: 4, target: 10, reward: 3200, expire: 35, danger: 0.02, xp: 6, falseP: 0.7,
    tod: { dag: 1.2 } },
  fastklemt: { navn: 'Trafikkulykke – fastklemt', lead: ['brann'], tags: ['trafikk'], pri: 1, w: 0.55, lvl: 2, loc: 'vei', ikon: 'car', fx: 'smoke',
    slots: [SL('rb', 'Redningsbil', ACC.redn, 'brann'), SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('po', 'Politi (sperring)', ACC.patr, 'politi'),
            SL('lb', 'Lege / luftambulanse', ACC.lege, 'ambulanse', { req: false })],
    work: 16, target: 10, reward: 24000, expire: 30, danger: 0.12, xp: 40, med: true,
    season: { sommer: 0.9, host: 1.2, vinter: 1.7 }, tod: { rush: 1.5 }, wx: { regn: 1.4, snø: 1.8 } },
  gasslekkasje: { navn: 'Gasslekkasje', lead: ['brann'], tags: [], pri: 2, w: 0.45, lvl: 2, loc: 'bygg', ikon: 'gas', fx: 'gas',
    slots: [SL('mb', 'Mannskapsbil', ACC.mb, 'brann'), SL('rd', 'Røykdykkerlag', ACC.rok, 'brann'), SL('po', 'Politi (sperring)', ACC.patr, 'politi'),
            SL('am', 'Ambulanse (standby)', ACC.amb, 'ambulanse', { req: false })],
    work: 12, target: 10, reward: 14500, expire: 30, danger: 0.6, xp: 26, season: { vinter: 1.4 } },
  vannredning: { navn: 'Vannredning', lead: ['brann'], tags: ['vann'], pri: 1, w: 0.4, lvl: 2, loc: 'vann', ikon: 'wave', fx: 'water',
    slots: [SL('rb', 'Redningsbil (vannredning)', ACC.redn, 'brann'), SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }),
            SL('lv', 'Livredder', ACC.livr, 'frivillig', { req: false })],
    work: 10, target: 10, reward: 17000, expire: 26, danger: 0.1, xp: 32, med: true, season: { sommer: 2.6, var: 1.0, host: 0.7, vinter: 0.3 } },

  /* ---------------------------- POLITI (112) --------------------------- */
  innbrudd: { navn: 'Innbrudd', lead: ['politi'], tags: [], pri: 3, w: 1.5, lvl: 1, loc: 'bygg', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi')], work: 8, target: 40, reward: 5200, expire: 95, danger: 0.04, xp: 8, arrest: 0.4,
    season: { vinter: 1.3 }, tod: { natt: 2.0 } },
  slagsmal: { navn: 'Slagsmål', lead: ['politi'], tags: ['natteliv'], pri: 2, w: 1.0, lvl: 1, loc: 'natt', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi', { n: 2 })], work: 8, target: 20, reward: 8500, expire: 50, danger: 0.28, xp: 16, arrest: 0.7, inj: 0.35,
    season: { sommer: 1.2 }, tod: { natt: 2.8, kveld: 1.4, dag: 0.3 } },
  trafikk_pol: { navn: 'Trafikkulykke', lead: ['politi'], tags: ['trafikk'], pri: 2, w: 1.2, lvl: 1, loc: 'vei', ikon: 'car', fx: 'none',
    slots: [SL('pa', 'Politi (trafikk)', ACC.patr, 'politi')], work: 10, target: 20, reward: 7500, expire: 50, danger: 0.04, xp: 14, inj: 0.5,
    season: { vinter: 2.0, host: 1.2 }, tod: { rush: 1.7 }, wx: { regn: 1.4, snø: 1.9 } },
  savnet: { navn: 'Savnet person', lead: ['politi'], tags: [], pri: 3, w: 0.7, lvl: 1, loc: 'park', ikon: 'pin', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi'), SL('hu', 'Hundepatrulje', ACC.hund, 'politi', { req: false }), SL('sk', 'Søkelag (frivillige)', ACC.sok, 'frivillig', { req: false })],
    work: 22, target: 40, reward: 11000, expire: 120, danger: 0.02, xp: 20, search: true,
    esc: { at: 34, msg: 'Søket utvides – frivillige søkelag trengs', pri: 2, makeReq: ['sk'], workMul: 1.0, rewardMul: 1.35 } },
  ran: { navn: 'Ran', lead: ['politi'], tags: [], pri: 1, w: 0.5, lvl: 3, loc: 'bygg', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi', { n: 2 }), SL('il', 'Innsatsleder', ACC.il, 'politi', { req: false })],
    work: 10, target: 10, reward: 16000, expire: 40, danger: 0.5, xp: 30, arrest: 0.6, tod: { kveld: 1.4, natt: 1.4 } },
  trusler: { navn: 'Trusler / uro', lead: ['politi'], tags: ['natteliv'], pri: 2, w: 0.8, lvl: 2, loc: 'bygg', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi'), SL('il', 'Innsatsleder', ACC.il, 'politi', { req: false })],
    work: 8, target: 20, reward: 7200, expire: 60, danger: 0.33, xp: 14, arrest: 0.5, tod: { natt: 1.6, kveld: 1.2 } },
  plivo: { navn: 'PLIVO – pågående livstruende vold', lead: ['politi'], tags: [], pri: 1, w: 0.12, lvl: 6, loc: 'bygg', ikon: 'shield', fx: 'none', tri: true,
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi', { n: 2 }), SL('il', 'Innsatsleder', ACC.il, 'politi'), SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { n: 2, transport: true }),
            SL('mb', 'Brann (støtte)', ACC.mb, 'brann'), SL('dt', 'Beredskapstropp (Delta)', ACC.delta, 'politi', { req: false })],
    work: 14, target: 10, reward: 42000, expire: 30, danger: 0.8, xp: 80, arrest: 0.8, med: true },

  /* --------------------------- AMBULANSE (113) -------------------------- */
  hjertestans: { navn: 'Hjertestans', lead: ['ambulanse'], tags: [], pri: 1, w: 1.0, lvl: 1, loc: 'hjem', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('lg', 'Legebil / luftambulanse', ACC.lege, 'ambulanse', { req: false }),
            SL('fr', 'Frivillig støtte', ACC.stotte, 'frivillig', { req: false })],
    work: 8, target: 12, reward: 16000, expire: 26, danger: 0, xp: 30, med: true, transportP: 1 },
  fall: { navn: 'Fall / skade', lead: ['ambulanse'], tags: [], pri: 3, w: 1.7, lvl: 1, loc: 'hjem', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse eller sanitet', ACC.ambV, 'ambulanse', { transport: true })],
    work: 6, target: 60, reward: 4200, expire: 130, danger: 0, xp: 7, transportP: 0.7, season: { vinter: 1.8 } },
  pustebesvar: { navn: 'Pustebesvær', lead: ['ambulanse'], tags: [], pri: 2, w: 1.0, lvl: 1, loc: 'hjem', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true })], work: 6, target: 30, reward: 7000, expire: 65, danger: 0, xp: 12, transportP: 0.85,
    season: { vinter: 1.3, var: 1.2 } },
  fodsel: { navn: 'Fødsel', lead: ['ambulanse'], tags: [], pri: 2, w: 0.5, lvl: 2, loc: 'hjem', ikon: 'heart', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('lg', 'Legebil', ACC.lege, 'ambulanse', { req: false })],
    work: 10, target: 30, reward: 9500, expire: 65, danger: 0, xp: 16, transportP: 1 },
  trafikkskade: { navn: 'Trafikkskade', lead: ['ambulanse'], tags: ['trafikk'], pri: 2, w: 0.9, lvl: 2, loc: 'vei', ikon: 'car', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('po', 'Politi (trafikk)', ACC.patr, 'politi')],
    work: 12, target: 20, reward: 12500, expire: 48, danger: 0.04, xp: 22, transportP: 1, season: { vinter: 1.8, host: 1.2 }, tod: { rush: 1.6 }, wx: { regn: 1.4, snø: 1.9 } },

  /* ------------------------------ STRAND (Oslo) ------------------------- */
  strand_drukning: { navn: 'Drukningsulykke', lead: ['ambulanse'], volLead: true, tags: ['strand'], pri: 1, w: 1.2, lvl: 1, loc: 'strand', ikon: 'buoy', fx: 'water',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('lv', 'Strandlivredder', ACC.livr, 'frivillig', { req: false }),
            SL('rb', 'Vannredning (brann)', ACC.redn, 'brann', { req: false })],
    work: 9, target: 12, reward: 20000, expire: 26, danger: 0, xp: 34, med: true, transportP: 1, beach: true, season: { sommer: 4.5, var: 0.25, host: 0.1, vinter: 0 } },
  strand_barn: { navn: 'Savnet barn på stranden', lead: ['politi'], volLead: true, tags: ['strand'], pri: 2, w: 1.0, lvl: 1, loc: 'strand', ikon: 'buoy', fx: 'none',
    slots: [SL('fi', 'Livredder eller patrulje', ACC.finn, 'politi'), SL('hu', 'Hundepatrulje', ACC.hund, 'politi', { req: false })],
    work: 10, target: 15, reward: 7500, expire: 42, danger: 0, xp: 14, beach: true, season: { sommer: 3.2, var: 0.2, host: 0, vinter: 0 } },
  strand_skade: { navn: 'Skade på stranden', lead: ['ambulanse'], volLead: true, tags: ['strand'], pri: 3, w: 1.3, lvl: 1, loc: 'strand', ikon: 'buoy', fx: 'none',
    slots: [SL('am', 'Livredder / sanitet / ambulanse', ACC.strandAmb, 'ambulanse', { transport: true })],
    work: 5, target: 30, reward: 3800, expire: 75, danger: 0, xp: 7, transportP: 0.4, beach: true, season: { sommer: 4.0, var: 0.2, host: 0, vinter: 0 } },
  strand_heteslag: { navn: 'Heteslag', lead: ['ambulanse'], volLead: true, tags: ['strand'], pri: 2, w: 0.8, lvl: 1, loc: 'strand', ikon: 'sun', fx: 'none',
    slots: [SL('am', 'Livredder / sanitet / ambulanse', ACC.strandAmb, 'ambulanse', { transport: true })],
    work: 6, target: 20, reward: 5500, expire: 55, danger: 0, xp: 10, transportP: 0.6, beach: true, season: { sommer: 3.0, var: 0, host: 0, vinter: 0 }, wx: { klar: 1.6, regn: 0.2 } },

  /* ------------------------------ FJELL (Bergen) ------------------------ */
  fjell_savnet: { navn: 'Savnet turgåer i fjellet', lead: ['politi'], tags: ['fjell'], pri: 2, w: 0.9, lvl: 2, loc: 'fjell', ikon: 'mountain', fx: 'none',
    slots: [SL('pa', 'Patruljebil (innsatsledelse)', ACC.patr, 'politi'), SL('fj', 'Fjellredning (frivillige)', ACC.fjell, 'frivillig'), SL('sk', 'Søkelag', ACC.sok, 'frivillig', { req: false })],
    work: 26, target: 45, reward: 18000, expire: 115, danger: 0.04, xp: 32, approach: 8, search: true, season: { sommer: 1.5, host: 1.4, vinter: 0.7 } },
  fjell_skade: { navn: 'Skadet turgåer i fjellet', lead: ['ambulanse'], tags: ['fjell'], pri: 2, w: 0.8, lvl: 2, loc: 'fjell', ikon: 'mountain', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('fj', 'Fjellredning (frivillige)', ACC.fjell, 'frivillig'), SL('lg', 'Luftambulanse', ['luftambulanse'], 'ambulanse', { req: false })],
    work: 20, target: 40, reward: 15000, expire: 100, danger: 0.04, xp: 26, approach: 6, transportP: 1, med: true, season: { sommer: 1.4, host: 1.3, vinter: 0.7 } },

  /* --------------------------- ARRANGEMENTER --------------------------- */
  arr_skade: { navn: 'Skade på arrangement', lead: ['ambulanse'], tags: [], pri: 3, w: 0, lvl: 1, loc: 'arr', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse eller sanitet', ACC.ambV, 'ambulanse', { transport: true })], work: 5, target: 25, reward: 3600, expire: 60, danger: 0, xp: 6, transportP: 0.4, ev: true },
  arr_besvimelse: { navn: 'Besvimelse på arrangement', lead: ['ambulanse'], tags: [], pri: 2, w: 0, lvl: 1, loc: 'arr', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse eller sanitet', ACC.ambV, 'ambulanse', { transport: true })], work: 6, target: 20, reward: 5000, expire: 50, danger: 0, xp: 9, transportP: 0.6, ev: true },
  arr_rus: { navn: 'Ordensforstyrrelse', lead: ['politi'], tags: ['natteliv'], pri: 3, w: 0, lvl: 1, loc: 'arr', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi')], work: 6, target: 25, reward: 4500, expire: 60, danger: 0.12, xp: 8, arrest: 0.4, ev: true }
};

/** Vær (vises i toppen og påvirker fart og hendelser). */
const WEATHER = { klar: { navn: 'Oppholdsvær', ikon: 'sun', spd: 1.0 }, regn: { navn: 'Regn', ikon: 'rain', spd: 0.93 }, snø: { navn: 'Snøvær', ikon: 'snow', spd: 0.8 }, storm: { navn: 'Storm', ikon: 'wind', spd: 0.88 } };

/* ==========================================================================
   3. BYCONFIG – én config per by. Legg til en ny by ved å lage et nytt objekt her
   (og legg veidata i data/<id>-roads.geojson, se scripts/fetch-data.mjs).
   Alle posisjoner er ekte koordinater (lat/lon, WGS84). Koordinater merket «ca.» bør kontrolleres.
   ========================================================================== */
const CITY_CONFIGS = {
  oslo: {
    id: 'oslo', navn: 'Oslo', tagline: 'Hovedstaden ved fjorden', vanskelighet: 'Middels', diff: 1.0, seed: 1814,
    beskrivelse: 'Ekte Oslo i 3D: tett sentrum, travle netter og mye trafikk. Oslofjorden med badestrender og øyer gir sommerjobb for strandlivredderne.',
    egenskaper: ['Flere hendelser', 'Strandlivreddere', 'Øyer med svak dekning'],
    center: { lat: 59.91333, lon: 10.73897 }, zoom: 14.9, pitch: 45, bearing: 0,   // utsnitt fra streets.gl-lenken (avstand 1500 m ≈ zoom 14,9)
    bbox: [10.665, 59.872, 10.800, 59.940],             // [vest, sør, øst, nord]
    downtownR: 2600, innerR: 3200,                      // meter fra sentrum (tetthet / detaljert veinett)
    roads: 'data/oslo-roads.geojson', sitesFile: 'data/oslo-sites.geojson',
    sites: [   // ca. posisjoner for byggbare steder dersom data/oslo-sites.geojson mangler
      { navn: 'Tomt ved Grønland', lat: 59.9125, lon: 10.7640 }, { navn: 'Tomt ved Majorstuen', lat: 59.9290, lon: 10.7160 }, { navn: 'Tomt på Aker Brygge', lat: 59.9105, lon: 10.7265 },
      { navn: 'Tomt ved Bjørvika', lat: 59.9085, lon: 10.7590 }, { navn: 'Tomt på Frogner', lat: 59.9190, lon: 10.7040 }, { navn: 'Tomt på Grünerløkka', lat: 59.9230, lon: 10.7580 },
      { navn: 'Tomt ved St. Hanshaugen', lat: 59.9255, lon: 10.7410 }, { navn: 'Tomt på Ekeberg', lat: 59.9060, lon: 10.7700 }
    ],
    hospitals: [{ id: 'h1', navn: 'Aker sykehus (ca.)', lat: 59.9356, lon: 10.7850 }, { id: 'h2', navn: 'Oslo legevakt, Storgata (ca.)', lat: 59.9163, lon: 10.7575, type: 'legevakt' }],
    masts: [{ id: 'm1', navn: 'Rådhusplassen', lat: 59.9117, lon: 10.7338 }, { id: 'm2', navn: 'Majorstuen', lat: 59.9295, lon: 10.7155 }, { id: 'm3', navn: 'Grønland', lat: 59.9125, lon: 10.7640 }],
    beaches: [
      { id: 'sorenga', navn: 'Sørenga sjøbad', lat: 59.9013, lon: 10.7518, crowd: 1.3, wdir: [0, 1] },
      { id: 'paradisbukta', navn: 'Paradisbukta', lat: 59.9043, lon: 10.6934, crowd: 1.0, wdir: [1, 0] },
      { id: 'huk', navn: 'Huk', lat: 59.9008, lon: 10.6775, crowd: 1.2, wdir: [0, 1] },
      { id: 'hovedoya', navn: 'Hovedøya', lat: 59.8925, lon: 10.7345, crowd: 0.7, island: true, wdir: [0, 1] },
      { id: 'langoyene', navn: 'Langøyene', lat: 59.8790, lon: 10.7285, crowd: 0.8, island: true, wdir: [-1, 0] }
    ],
    parks: [{ navn: 'Slottsparken', lat: 59.9170, lon: 10.7270 }, { navn: 'Frognerparken', lat: 59.9272, lon: 10.7040 }, { navn: 'Sofienbergparken', lat: 59.9232, lon: 10.7600 }, { navn: 'Botanisk hage', lat: 59.9170, lon: 10.7690 }, { navn: 'Ekebergparken', lat: 59.9040, lon: 10.7690 }],
    waterfront: [{ navn: 'Aker Brygge', lat: 59.9097, lon: 10.7262 }, { navn: 'Vippetangen', lat: 59.9040, lon: 10.7440 }, { navn: 'Bjørvika', lat: 59.9070, lon: 10.7560 }],
    mountain: [],
    weakZones: [{ navn: 'Øyene i Oslofjorden', lat: 59.884, lon: 10.731, r: 2400, mul: 0.5 }],
    bistandDelay: 7,
    incidentMul: { total: 1.2, trafikk: 1.4, natteliv: 1.5, brann_bygg: 1.0, fjell: 0, strand: 1.0, vann: 1.0 },
    weather: { var: { regn: 0.22 }, sommer: { regn: 0.2 }, host: { regn: 0.34, storm: 0.1 }, vinter: { regn: 0.1, snø: 0.5 } },
    events: [
      { id: '17mai', navn: '17. mai-feiring på Karl Johan', sesong: 0, dag: 2, fra: 9, til: 17, lat: 59.9140, lon: 10.7390, rate: 5.0, stor: 'Stort', type: 'tog' },
      { id: 'konsert', navn: 'Konsert i Frognerparken', sesong: 1, dag: 1, fra: 17, til: 23, lat: 59.9272, lon: 10.7040, rate: 4.0, stor: 'Stort', type: 'konsert' },
      { id: 'sorenga', navn: 'Sørenga-festivalen', sesong: 1, dag: 0, fra: 14, til: 22, lat: 59.9013, lon: 10.7518, rate: 3.5, stor: 'Middels', type: 'konsert' },
      { id: 'fotball', navn: 'Fotballkamp (Bislett)', sesong: 2, dag: 0, fra: 17.5, til: 20.5, lat: 59.9250, lon: 10.7330, rate: 4.5, stor: 'Stort', type: 'fotball' },
      { id: 'julemarked', navn: 'Julemarked i sentrum', sesong: 3, dag: 1, fra: 11, til: 19, lat: 59.9130, lon: 10.7480, rate: 2.5, stor: 'Middels', type: 'marked' }
    ]
  },
  bergen: {
    id: 'bergen', navn: 'Bergen', tagline: 'Byen mellom de syv fjell', vanskelighet: 'Enkel', diff: 0.8, seed: 1070,
    beskrivelse: 'Ekte Bergen i 3D: Vågen, Bryggen og trehusene, med fjellsiden som gir lange kjøreveier. Mer regn, flere bygningsbranner og fjellturer som går galt.',
    egenskaper: ['Færre hendelser', 'Lange kjøreveier i lia', 'Fjellredning'],
    center: { lat: 60.393, lon: 5.324 }, zoom: 15.4, pitch: 55, bearing: 20,
    bbox: [5.285, 60.365, 5.390, 60.415],
    downtownR: 1800, innerR: 2600,
    roads: 'data/bergen-roads.geojson', sitesFile: 'data/bergen-sites.geojson',
    sites: [
      { navn: 'Tomt på Nordnes', lat: 60.3990, lon: 5.3040 }, { navn: 'Tomt ved Møhlenpris', lat: 60.3850, lon: 5.3190 }, { navn: 'Tomt ved Danmarks plass', lat: 60.3790, lon: 5.3380 },
      { navn: 'Tomt ved Sandviken', lat: 60.4040, lon: 5.3290 }, { navn: 'Tomt ved Nygård', lat: 60.3890, lon: 5.3350 }, { navn: 'Tomt ved Minde', lat: 60.3700, lon: 5.3330 }
    ],
    hospitals: [{ id: 'h1', navn: 'Haraldsplass sykehus (ca.)', lat: 60.3840, lon: 5.3250 }, { id: 'h2', navn: 'Bergen legevakt (ca.)', lat: 60.3919, lon: 5.3207, type: 'legevakt' }],
    masts: [{ id: 'm1', navn: 'Torgallmenningen', lat: 60.3925, lon: 5.3235 }, { id: 'm2', navn: 'Møhlenpris', lat: 60.3830, lon: 5.3190 }, { id: 'm3', navn: 'Fløyen', lat: 60.3975, lon: 5.3335, rmul: 1.35 }],
    beaches: [],
    parks: [{ navn: 'Nygårdsparken', lat: 60.3875, lon: 5.3305 }, { navn: 'Byparken', lat: 60.3910, lon: 5.3255 }, { navn: 'Lungegårdsparken', lat: 60.3865, lon: 5.3235 }],
    waterfront: [{ navn: 'Bryggen', lat: 60.3977, lon: 5.3245 }, { navn: 'Strandkaien', lat: 60.3945, lon: 5.3225 }, { navn: 'Nordnes sjøbad', lat: 60.4010, lon: 5.3040 }],
    mountain: [{ navn: 'Fløyen', lat: 60.3995, lon: 5.3375 }, { navn: 'Skansemyren', lat: 60.3980, lon: 5.3430 }, { navn: 'Ulriken', lat: 60.3785, lon: 5.3705 }],
    weakZones: [{ navn: 'Fjellsiden', lat: 60.394, lon: 5.356, r: 1500, mul: 0.5 }],
    bistandDelay: 9,
    incidentMul: { total: 1.0, trafikk: 0.8, natteliv: 0.7, brann_bygg: 1.5, fjell: 2.2, strand: 0, vann: 1.0 },
    weather: { var: { regn: 0.45 }, sommer: { regn: 0.4 }, host: { regn: 0.62, storm: 0.12 }, vinter: { regn: 0.42, snø: 0.2 } },
    events: [
      { id: '17mai', navn: '17. mai – buekorpsene marsjerer', sesong: 0, dag: 2, fra: 9, til: 16, lat: 60.3915, lon: 5.3235, rate: 3.5, stor: 'Stort', type: 'tog' },
      { id: 'festspill', navn: 'Åpningskonsert på Festplassen', sesong: 1, dag: 1, fra: 18, til: 23, lat: 60.3912, lon: 5.3245, rate: 3.0, stor: 'Middels', type: 'konsert' },
      { id: 'fotball', navn: 'Fotballkamp (Brann stadion)', sesong: 2, dag: 2, fra: 17, til: 20, lat: 60.3685, lon: 5.3555, rate: 3.5, stor: 'Stort', type: 'fotball' },
      { id: 'julemarked', navn: 'Julemarked på Torgallmenningen', sesong: 3, dag: 0, fra: 11, til: 18, lat: 60.3925, lon: 5.3235, rate: 2.2, stor: 'Middels', type: 'marked' }
    ]
  }
};
function cityList() { return Object.keys(CITY_CONFIGS).map(k => CITY_CONFIGS[k]); }
