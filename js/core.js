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
/** Ikoner fra Lucide (lucide.dev, ISC-lisens), 24×24 strek. Ingen ekte logoer brukes. */
const ICONS = {
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />',
  pulse: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /> <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />',
  hand: '<path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16" /> <path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" /> <path d="m2 15 6 6" /> <path d="M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.73 2.73 0 0 0 16 4a2.78 2.78 0 0 0-5 1.8c0 1.2.8 2 1.5 2.8L16 12Z" />',
  buoy: '<circle cx="12" cy="12" r="10" /> <path d="m4.93 4.93 4.24 4.24" /> <path d="m14.83 9.17 4.24-4.24" /> <path d="m14.83 14.83 4.24 4.24" /> <path d="m9.17 14.83-4.24 4.24" /> <circle cx="12" cy="12" r="4" />',
  mast: '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" /> <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" /> <circle cx="12" cy="9" r="2" /> <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" /> <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" /> <path d="M9.5 18h5" /> <path d="m8 22 4-11 4 11" />',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /> <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" />',
  clock: '<circle cx="12" cy="12" r="10" /> <polyline points="12 6 12 12 16 14" />',
  coin: '<circle cx="8" cy="8" r="6" /> <path d="M18.09 10.37A6 6 0 1 1 10.34 18" /> <path d="M7 6h1v4" /> <path d="m16.71 13.88.7.71-2.82 2.82" />',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /> <path d="M15 18H9" /> <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /> <circle cx="17" cy="18" r="2" /> <circle cx="7" cy="18" r="2" />',
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /> <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /> <path d="M3 6h18" /> <path d="M16 10a4 4 0 0 1-8 0" />',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M18 17V9" /> <path d="M13 17V5" /> <path d="M8 17v-3" />',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" />',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /> <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /> <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />',
  plus: '<path d="M5 12h14" /> <path d="M12 5v14" />',
  x: '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
  check: '<path d="M20 6 9 17l-5-5" />',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1" /> <rect x="6" y="4" width="4" height="16" rx="1" />',
  play: '<polygon points="6 3 20 12 6 21 6 3" />',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z" />',
  wave: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />',
  sun: '<circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" />',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /> <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />',
  snow: '<line x1="2" x2="22" y1="12" y2="12" /> <line x1="12" x2="12" y1="2" y2="22" /> <path d="m20 16-4-4 4-4" /> <path d="m4 8 4 4-4 4" /> <path d="m16 4-4 4-4-4" /> <path d="m8 20 4-4 4 4" />',
  rain: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /> <path d="M16 14v6" /> <path d="M8 14v6" /> <path d="M12 16v6" />',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />',
  wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2" /> <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" /> <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <path d="M16 3.13a4 4 0 0 1 0 7.75" />',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /> <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /> <circle cx="12" cy="12" r="2" /> <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /> <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />',
  list: '<path d="M3 12h.01" /> <path d="M3 18h.01" /> <path d="M3 6h.01" /> <path d="M8 12h13" /> <path d="M8 18h13" /> <path d="M8 6h13" />',
  menu: '<line x1="4" x2="20" y1="12" y2="12" /> <line x1="4" x2="20" y1="6" y2="6" /> <line x1="4" x2="20" y1="18" y2="18" />',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /> <circle cx="7" cy="17" r="2" /> <path d="M9 17h6" /> <circle cx="17" cy="17" r="2" />',
  calendar: '<path d="M8 2v4" /> <path d="M16 2v4" /> <rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M3 10h18" />',
  up: '<path d="m18 15-6-6-6 6" />',
  down: '<path d="m6 9 6 6 6-6" />',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />',
  signal: '<path d="M2 20h.01" /> <path d="M7 20v-4" /> <path d="M12 20v-8" /> <path d="M17 20V8" /> <path d="M22 4v16" />',
  gauge: '<path d="m12 14 4-4" /> <path d="M3.34 19a10 10 0 1 1 17.32 0" />',
  bolt: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" />',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
  rotl: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /> <path d="M3 3v5h5" />',
  rotr: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />',
  home: '<line x1="2" x2="5" y1="12" y2="12" /> <line x1="19" x2="22" y1="12" y2="12" /> <line x1="12" x2="12" y1="2" y2="5" /> <line x1="12" x2="12" y1="19" y2="22" /> <circle cx="12" cy="12" r="7" /> <circle cx="12" cy="12" r="3" />',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />',
  tower: '<path d="M18.2 12.27 20 6H4l1.8 6.27a1 1 0 0 0 .95.73h10.5a1 1 0 0 0 .96-.73Z" /> <path d="M8 13v9" /> <path d="M16 22v-9" /> <path d="m9 6 1 7" /> <path d="m15 6-1 7" /> <path d="M12 6V2" /> <path d="M13 2h-2" />',
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /> <path d="M14 2v4a2 2 0 0 0 2 2h4" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" />',
  tools: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" /> <path d="m18 15 4-4" /> <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />',
  gas: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /> <path d="M16 17H7" /> <path d="M17 21H9" />',
  anchor: '<path d="M12 22V8" /> <path d="M5 12H2a10 10 0 0 0 20 0h-3" /> <circle cx="12" cy="5" r="3" />',
  bars: '<line x1="18" x2="18" y1="20" y2="10" /> <line x1="12" x2="12" y1="20" y2="4" /> <line x1="6" x2="6" y1="20" y2="14" />',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />',
  headset: '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" /> <path d="M21 16v2a4 4 0 0 1-4 4h-5" />',
  ambulance: '<path d="M10 10H6" /> <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /> <path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14" /> <path d="M8 8v4" /> <path d="M9 18h6" /> <circle cx="17" cy="18" r="2" /> <circle cx="7" cy="18" r="2" />',
  siren: '<path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" />',
  ship: '<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" /> <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" /> <path d="M12 10v4" /> <path d="M12 2v3" />',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /> <path d="M19 10v2a7 7 0 0 1-14 0v-2" /> <line x1="12" x2="12" y1="19" y2="22" />',
  user: '<circle cx="12" cy="8" r="5" /> <path d="M20 21a8 8 0 0 0-16 0" />',
  bike: '<circle cx="18.5" cy="17.5" r="3.5" /> <circle cx="5.5" cy="17.5" r="3.5" /> <circle cx="15" cy="5" r="1" /> <path d="M12 17.5V14l-3-3 4-3 2 3h2" />',
  flask: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" /> <path d="M8.5 2h7" /> <path d="M7 16h10" />',
  baby: '<path d="M9 12h.01" /> <path d="M15 12h.01" /> <path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" /> <path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" />',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /> <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /> <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /> <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /> <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /> <path d="M3.477 10.896a4 4 0 0 1 .585-.396" /> <path d="M19.938 10.5a4 4 0 0 1 .585.396" /> <path d="M6 18a4 4 0 0 1-1.967-.516" /> <path d="M19.967 17.484A4 4 0 0 1 18 18" />',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /> <path d="m8.5 8.5 7 7" />',
  heli: '<path d="M5 6.500h14M12 6.500v3"/><ellipse cx="11" cy="13" rx="5.500" ry="3.200"/><path d="M16.500 12.500H21M7 18.500h8"/>'
};
/** Lager en inline SVG med eget symbol. */
function icon(name, cls) {
  return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}
/** Frittstående SVG-streng for bruk som bilde (3D-sprites). */
function iconSvgString(name, color, size) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
}

/* ==========================================================================
   2. SPILLDATA
   ========================================================================== */
const SEA = 0;                   // havnivå (kartet er flatt; høyder tegnes av MapLibre)
const MIN_PER_SEC = 1 / 20;      // ekte tid: ett spillminutt varer 20 sekunder ved 1× (5× og 20× kan velges i toppen)
const SPEEDS = [1, 5, 20];
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
  ambulanse: { id: 'ambulanse', navn: 'Ambulanse',        kort: 'Ambulanse', nr: '113', sentral: 'AMK-sentral 113',         tg: 'HELSE',   farge: '#B3BE68', ikon: 'ambulance',  tekst: 'Akutt, haster, vanlig: hjertestans, fall, fødsel og drukningsulykker.' },
  rk:        { id: 'rk',        navn: 'Røde Kors Hjelpekorps',  kort: 'Hjelpekorps', nr: '', sentral: '', tg: 'REDNING', farge: '#D98A82', ikon: 'hand', tekst: 'Søk etter savnede, førstehjelp, sanitetsvakt og fjellredning.' },
  nf:        { id: 'nf',        navn: 'Norsk Folkehjelp Sanitet', kort: 'Folkehjelp', nr: '', sentral: '', tg: 'REDNING', farge: '#5E9B76', ikon: 'hand', tekst: 'Sanitetsvakt, søk og redning, støtte ved store ulykker.' },
  rs:        { id: 'rs',        navn: 'Redningsselskapet',      kort: 'RS', nr: '', sentral: '', tg: 'REDNING', farge: '#E0874A', ikon: 'anchor', tekst: 'Redningsskøyter i Oslofjorden – henter folk på øyene og på sjøen.' },
  strand:    { id: 'strand',    navn: 'Strandlivreddere',       kort: 'Livredder', nr: '', sentral: '', tg: 'REDNING', farge: '#E5A267', ikon: 'buoy', tekst: 'Faste livreddere på badestrendene i Oslo – om sommeren.' },
  bistand:   { id: 'bistand',   navn: 'Nabodistrikt (bistand)', kort: 'Bistand',   nr: '', sentral: '', tg: 'SENTRAL', farge: '#9AA5A0', ikon: 'people', tekst: '' }
};
const ETATER = ['brann', 'politi', 'ambulanse'];
const FRIVILLIGE = ['rk', 'nf', 'rs', 'strand'];

/** Enhetstyper. model = 3D-modell. cost/run i kr, spd = fartsfaktor, turnout = utrykningstid (min), mob = mobiliseringstid for frivillige (min). */
const UT = {
  mannskapsbil:    { navn: 'Mannskapsbil',          org: 'brann',     model: 'truck',    cost: 130000, run: 10, spd: 1.00, crew: 6, lvl: 1, turnout: 1.3, term: 'k', cm: 4, k160: 1 },
  tankbil:         { navn: 'Tankbil',               org: 'brann',     model: 'tanker',   cost: 150000, run: 11, spd: 0.92, crew: 3, lvl: 1, turnout: 1.4, term: 'k', cm: 2, k160: 1 },
  hoyderedskap:    { navn: 'Høyderedskap',          org: 'brann',     model: 'ladder',   cost: 380000, run: 18, spd: 0.85, crew: 3, lvl: 3, turnout: 1.6, term: 'k', cm: 2, k160: 1 },
  redningsbil:     { navn: 'Redningsbil',           org: 'brann',     model: 'rescue',   cost: 210000, run: 13, spd: 0.95, crew: 4, lvl: 2, turnout: 1.4, term: 'k', cm: 3, k160: 1 },
  rokdykker:       { navn: 'Røykdykkerlag',         org: 'brann',     model: 'van',      cost: 90000,  run: 8,  spd: 1.00, crew: 4, lvl: 2, turnout: 1.2, term: 'h', cm: 4, k160: 1 },
  patruljebil:     { navn: 'Patruljebil',           org: 'politi',    model: 'car',      cost: 70000,  run: 6,  spd: 1.15, crew: 2, lvl: 1, turnout: 0.6, term: 'k', cm: 2, k160: 1 },
  up:              { navn: 'UP-bil (trafikk)',      org: 'politi',    model: 'car',      cost: 85000,  run: 7,  spd: 1.25, crew: 2, lvl: 2, turnout: 0.6, term: 'k', stripe: '#E4C94E', cm: 2, k160: 1 },
  hundepatrulje:   { navn: 'Hundepatrulje',         org: 'politi',    model: 'van',      cost: 110000, run: 8,  spd: 1.05, crew: 2, lvl: 3, turnout: 0.9, term: 'k', cm: 1, k160: 1 },
  innsatsleder:    { navn: 'Innsatsleder politi',   org: 'politi',    model: 'suv',      cost: 120000, run: 9,  spd: 1.15, crew: 1, lvl: 4, turnout: 0.7, term: 'k', cm: 1, k160: 1 },
  beredskapstropp: { navn: 'Beredskapstropp (Delta)', org: 'politi',  model: 'armored',  cost: 600000, run: 30, spd: 1.05, crew: 6, lvl: 8, turnout: 1.0, term: 'k', cm: 4, k160: 1 },
  ambulanse:       { navn: 'Ambulanse',             org: 'ambulanse', model: 'ambulance', cost: 120000, run: 9, spd: 1.10, crew: 2, lvl: 1, turnout: 0.8, term: 'k', cm: 2, k160: 2 },
  legebil:         { navn: 'Legebil',               org: 'ambulanse', model: 'suv',      cost: 180000, run: 12, spd: 1.20, crew: 2, lvl: 3, turnout: 0.8, term: 'k', cm: 2, k160: 1 },
  luftambulanse:   { navn: 'Luftambulanse',         org: 'ambulanse', model: 'heli',     cost: 900000, run: 60, spd: 3.00, crew: 3, lvl: 6, turnout: 2.0, term: 'k', needs: 'helikopterbase', cm: 3, k160: 0 },
  redningsbat:     { navn: 'Redningsbåt (brann)',  org: 'brann',     model: 'boat',     cost: 160000, run: 12, spd: 1.25, crew: 3, lvl: 1, turnout: 1.5, term: 'k', boat: true, cm: 2, k160: 0 },
  hjelpekorpsbil:  { navn: 'Hjelpekorpsbil',        org: 'rk',        model: 'van',      cost: 55000,  run: 4,  spd: 0.95, crew: 4, lvl: 1, mob: 8,  term: 'k' },
  atv:             { navn: 'ATV / snøscooter',      org: 'rk',        model: 'atv',      cost: 40000,  run: 3,  spd: 0.85, crew: 2, lvl: 1, mob: 6,  term: 'k', offroad: true },
  sanitetslag_rk:  { navn: 'Sanitetslag',           org: 'rk',        model: 'van',      cost: 25000,  run: 2,  spd: 0.95, crew: 4, lvl: 1, mob: 10, term: 'h' },
  sokelag_rk:      { navn: 'Søkelag',               org: 'rk',        model: 'van',      cost: 20000,  run: 2,  spd: 0.95, crew: 6, lvl: 1, mob: 12, term: 'h' },
  sanitetsbil:     { navn: 'Sanitetsbil',           org: 'nf',        model: 'ambulance', cost: 55000, run: 4,  spd: 0.95, crew: 3, lvl: 1, mob: 8,  term: 'k' },
  sokelag_nf:      { navn: 'Søkelag (Folkehjelp)',  org: 'nf',        model: 'van',      cost: 20000,  run: 2,  spd: 0.95, crew: 6, lvl: 1, mob: 12, term: 'h' },
  forstehjelpspost: { navn: 'Førstehjelpspost',     org: 'nf',        model: 'trailer',  cost: 30000,  run: 2,  spd: 0.70, crew: 4, lvl: 2, mob: 12, term: 'h' },
  rs_skoyte:       { navn: 'Redningsskøyte',       org: 'rs',        model: 'boat',     cost: 70000,  run: 5,  spd: 1.15, crew: 4, lvl: 1, mob: 7,  term: 'k', boat: true },
  livredder:       { navn: 'Livredder',             org: 'strand',    model: 'foot',     cost: 0,      run: 3,  spd: 0.8, crew: 1, lvl: 1, mob: 0,  term: 'h', foot: true }
};
/** Kort navn til kallesignal. */
const CALL = { mannskapsbil: 'Brann', tankbil: 'Tank', hoyderedskap: 'Stige', redningsbil: 'Redning', rokdykker: 'Røyk', redningsbat: 'Brannbåt',
  patruljebil: 'Patrulje', up: 'UP', hundepatrulje: 'Hund', innsatsleder: 'Innsatsleder', beredskapstropp: 'Delta',
  ambulanse: 'Ambulanse', legebil: 'Legebil', luftambulanse: 'Luftambulanse', hjelpekorpsbil: 'Hjelpekorps', atv: 'ATV', sanitetslag_rk: 'Sanitet',
  sokelag_rk: 'Søk', sanitetsbil: 'NF Sanitet', sokelag_nf: 'NF Søk', forstehjelpspost: 'NF Post', rs_skoyte: 'RS', livredder: 'Livredder' };

/** Stasjonstyper (bygg på ledige tomter). */
const ST = {
  brannstasjon:     { navn: 'Brannstasjon',     org: 'brann',     cost: 200000, run: 25, cap: 3, lvl: 1, ikon: 'flame',  farge: '#C9785D', rolle: 'etat' },
  politistasjon:    { navn: 'Politistasjon',    org: 'politi',    cost: 190000, run: 24, cap: 3, lvl: 1, ikon: 'shield', farge: '#6F8FB5', rolle: 'etat' },
  ambulansestasjon: { navn: 'Ambulansestasjon', org: 'ambulanse', cost: 170000, run: 22, cap: 3, lvl: 1, ikon: 'ambulance',  farge: '#B3BE68', rolle: 'etat' },
  sykehus:          { navn: 'Sykehus',          org: 'ambulanse', cost: 600000, run: 45, cap: 0, lvl: 4, ikon: 'plus',   farge: '#F2EEE3', rolle: 'helse' },
  legevakt:         { navn: 'Legevakt',         org: 'ambulanse', cost: 220000, run: 20, cap: 0, lvl: 2, ikon: 'plus',   farge: '#DCE8D2', rolle: 'helse' },
  arrest:           { navn: 'Arrest',           org: 'politi',    cost: 150000, run: 15, cap: 0, lvl: 2, ikon: 'lock',   farge: '#9AA5B5', rolle: 'arrest' },
  helikopterbase:   { navn: 'Helikopterbase',   org: 'ambulanse', cost: 450000, run: 35, cap: 2, lvl: 5, ikon: 'heli',   farge: '#C9CF8A', rolle: 'etat' },
  rk_base:          { navn: 'Hjelpekorpsbase',  org: 'rk',        cost: 90000,  run: 8,  cap: 3, lvl: 1, ikon: 'hand',   farge: '#D98A82', rolle: 'frivillig' },
  rs_base:          { navn: 'Redningsstasjon',  org: 'rs',        cost: 85000,  run: 7,  cap: 2, lvl: 1, ikon: 'anchor', farge: '#E0874A', rolle: 'frivillig' },
  nf_base:          { navn: 'Sanitetsbase',     org: 'nf',        cost: 80000,  run: 7,  cap: 3, lvl: 1, ikon: 'hand',   farge: '#5E9B76', rolle: 'frivillig' }
};
const STATION_FOR_ORG = { brann: 'brannstasjon', politi: 'politistasjon', ambulanse: 'ambulansestasjon', rk: 'rk_base', nf: 'nf_base', rs: 'rs_base' };

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
  san: ['sanitetslag_rk', 'sanitetsbil', 'forstehjelpspost', 'hjelpekorpsbil'], boat: ['redningsbat', 'rs_skoyte', 'luftambulanse'], baat: ['redningsbat', 'rs_skoyte']
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
            SL('lv', 'Livredder', ACC.livr, 'frivillig', { req: false }), SL('bt', 'Redningsbåt', ACC.baat, 'brann', { req: false })],
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
  fodsel: { navn: 'Fødsel', lead: ['ambulanse'], tags: [], pri: 2, w: 0.5, lvl: 2, loc: 'hjem', ikon: 'baby', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('lg', 'Legebil', ACC.lege, 'ambulanse', { req: false })],
    work: 10, target: 30, reward: 9500, expire: 65, danger: 0, xp: 16, transportP: 1 },
  trafikkskade: { navn: 'Trafikkskade', lead: ['ambulanse'], tags: ['trafikk'], pri: 2, w: 0.9, lvl: 2, loc: 'vei', ikon: 'car', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('po', 'Politi (trafikk)', ACC.patr, 'politi')],
    work: 12, target: 20, reward: 12500, expire: 48, danger: 0.04, xp: 22, transportP: 1, season: { vinter: 1.8, host: 1.2 }, tod: { rush: 1.6 }, wx: { regn: 1.4, snø: 1.9 } },

  /* ------------------------------ STRAND (Oslo) ------------------------- */
  strand_drukning: { navn: 'Drukningsulykke', lead: ['ambulanse'], volLead: true, tags: ['strand'], pri: 1, w: 1.2, lvl: 1, loc: 'strand', ikon: 'buoy', fx: 'water',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('lv', 'Strandlivredder', ACC.livr, 'frivillig', { req: false }),
            SL('rb', 'Vannredning (brann)', ACC.redn, 'brann', { req: false })],
    work: 9, target: 12, reward: 20000, expire: 26, danger: 0, xp: 34, med: true, transportP: 1, beach: true, hours: [10, 21], wx: { klar: 1.3, regn: 0.25, storm: 0.05, 'snø': 0 },  season: { sommer: 4.5, var: 0.25, host: 0.1, vinter: 0 } },
  strand_barn: { navn: 'Savnet barn på stranden', lead: ['politi'], volLead: true, tags: ['strand'], pri: 2, w: 1.0, lvl: 1, loc: 'strand', ikon: 'buoy', fx: 'none',
    slots: [SL('fi', 'Livredder eller patrulje', ACC.finn, 'politi'), SL('hu', 'Hundepatrulje', ACC.hund, 'politi', { req: false })],
    work: 10, target: 15, reward: 7500, expire: 42, danger: 0, xp: 14, beach: true, hours: [10, 21], wx: { klar: 1.3, regn: 0.25, storm: 0.05, 'snø': 0 },  season: { sommer: 3.2, var: 0.2, host: 0, vinter: 0 } },
  strand_skade: { navn: 'Skade på stranden', lead: ['ambulanse'], volLead: true, tags: ['strand'], pri: 3, w: 1.3, lvl: 1, loc: 'strand', ikon: 'buoy', fx: 'none',
    slots: [SL('am', 'Livredder / sanitet / ambulanse', ACC.strandAmb, 'ambulanse', { transport: true })],
    work: 5, target: 30, reward: 3800, expire: 75, danger: 0, xp: 7, transportP: 0.4, beach: true, hours: [10, 21], wx: { klar: 1.3, regn: 0.25, storm: 0.05, 'snø': 0 },  season: { sommer: 4.0, var: 0.2, host: 0, vinter: 0 } },
  strand_heteslag: { navn: 'Heteslag', lead: ['ambulanse'], volLead: true, tags: ['strand'], pri: 2, w: 0.8, lvl: 1, loc: 'strand', ikon: 'sun', fx: 'none',
    slots: [SL('am', 'Livredder / sanitet / ambulanse', ACC.strandAmb, 'ambulanse', { transport: true })],
    work: 6, target: 20, reward: 5500, expire: 55, danger: 0, xp: 10, transportP: 0.6, beach: true, hours: [11, 19], season: { sommer: 3.0, var: 0, host: 0, vinter: 0 }, wx: { klar: 1.6, regn: 0.1, storm: 0, 'snø': 0 } },

  /* ------------------------------ FJELL (Bergen) ------------------------ */
  fjell_savnet: { navn: 'Savnet turgåer i fjellet', lead: ['politi'], tags: ['fjell'], pri: 2, w: 0.9, lvl: 2, loc: 'fjell', ikon: 'mountain', fx: 'none',
    slots: [SL('pa', 'Patruljebil (innsatsledelse)', ACC.patr, 'politi'), SL('fj', 'Fjellredning (frivillige)', ACC.fjell, 'frivillig'), SL('sk', 'Søkelag', ACC.sok, 'frivillig', { req: false })],
    work: 26, target: 45, reward: 18000, expire: 115, danger: 0.04, xp: 32, approach: 8, search: true, season: { sommer: 1.5, host: 1.4, vinter: 0.7 } },
  fjell_skade: { navn: 'Skadet turgåer i fjellet', lead: ['ambulanse'], tags: ['fjell'], pri: 2, w: 0.8, lvl: 2, loc: 'fjell', ikon: 'mountain', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('fj', 'Fjellredning (frivillige)', ACC.fjell, 'frivillig'), SL('lg', 'Luftambulanse', ['luftambulanse'], 'ambulanse', { req: false })],
    work: 20, target: 40, reward: 15000, expire: 100, danger: 0.04, xp: 26, approach: 6, transportP: 1, med: true, season: { sommer: 1.4, host: 1.3, vinter: 0.7 } },

  /* ------------------------- FLERE OPPDRAG (alle etater) ------------------------- */
  gressbrann: { navn: 'Gress- og krattbrann', lead: ['brann'], tags: [], pri: 2, w: 0.6, lvl: 1, loc: 'park', ikon: 'flame', fx: 'smoke',
    slots: [SL('mb', 'Slokkeenhet', ACC.slokk, 'brann'), SL('tb', 'Tankbil', ACC.tank, 'brann', { req: false })], work: 12, target: 15, reward: 8000, expire: 45, danger: 0.04, xp: 14,
    season: { var: 1.6, sommer: 2.2, host: 0.4, vinter: 0 }, wx: { klar: 1.5, regn: 0.2, 'snø': 0 } },
  pipebrann: { navn: 'Pipebrann', lead: ['brann'], tags: ['brann_bygg'], pri: 2, w: 0.5, lvl: 1, loc: 'hjem', ikon: 'flame', fx: 'smoke',
    slots: [SL('mb', 'Mannskapsbil', ACC.mb, 'brann'), SL('hr', 'Høyderedskap', ACC.stige, 'brann', { req: false })], work: 10, target: 15, reward: 7000, expire: 45, danger: 0.08, xp: 12,
    season: { var: 0.6, sommer: 0.1, host: 1.3, vinter: 2.4 }, tod: { kveld: 1.6 } },
  container: { navn: 'Brann i søppelcontainer', lead: ['brann'], tags: [], pri: 3, w: 0.8, lvl: 1, loc: 'natt', ikon: 'flame', fx: 'fire',
    slots: [SL('mb', 'Slokkeenhet', ACC.slokk, 'brann')], work: 5, target: 20, reward: 3500, expire: 60, danger: 0.02, xp: 6, tod: { natt: 2.2, kveld: 1.3 } },
  heis: { navn: 'Personer fast i heis', lead: ['brann'], tags: [], pri: 3, w: 0.6, lvl: 1, loc: 'bygg', ikon: 'people', fx: 'none',
    slots: [SL('mb', 'Mannskapsbil', ACC.mb, 'brann')], work: 9, target: 25, reward: 4200, expire: 70, danger: 0, xp: 8, tod: { dag: 1.4, rush: 1.4 } },
  kjemikalie: { navn: 'Kjemikalieutslipp', lead: ['brann'], tags: [], pri: 1, w: 0.2, lvl: 4, loc: 'vei', ikon: 'flask', fx: 'gas',
    slots: [SL('mb', 'Mannskapsbil', ACC.mb, 'brann'), SL('rd', 'Røykdykkerlag (kjemikaliedrakt)', ACC.rok, 'brann'), SL('po', 'Politi (sperring)', ACC.pol, 'politi'), SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { req: false })],
    work: 22, target: 12, reward: 30000, expire: 40, danger: 0.4, xp: 50, tri: true },
  bat_brann: { navn: 'Brann i båt ved kai', lead: ['brann'], tags: ['vann'], pri: 1, w: 0.25, lvl: 2, loc: 'vann', ikon: 'flame', fx: 'fire',
    slots: [SL('mb', 'Mannskapsbil', ACC.mb, 'brann'), SL('bt', 'Brannbåt', ACC.baat, 'brann', { req: false })], work: 14, target: 12, reward: 16000, expire: 40, danger: 0.3, xp: 26,
    season: { sommer: 1.8, var: 1.0, host: 0.8, vinter: 0.3 } },
  butikktyveri: { navn: 'Butikktyveri', lead: ['politi'], tags: [], pri: 4, w: 1.4, lvl: 1, loc: 'bygg', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi')], work: 7, target: 60, reward: 3000, expire: 130, danger: 0.02, xp: 5, arrest: 0.7, tod: { dag: 1.5, rush: 1.3, natt: 0.1 } },
  ruskjoring: { navn: 'Mistanke om ruspåvirket fører', lead: ['politi'], tags: ['trafikk'], pri: 2, w: 0.7, lvl: 1, loc: 'vei', ikon: 'car', fx: 'none',
    slots: [SL('pa', 'Patrulje / UP', ACC.patr, 'politi')], work: 9, target: 15, reward: 7000, expire: 30, danger: 0.08, xp: 12, arrest: 0.8, tod: { natt: 2.0, kveld: 1.3 } },
  husbrak: { navn: 'Husbråk – vold i nære relasjoner', lead: ['politi'], tags: [], pri: 1, w: 0.6, lvl: 1, loc: 'hjem', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi', { n: 2 }), SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { req: false, transport: true })], work: 12, target: 10, reward: 11000, expire: 35, danger: 0.3, xp: 20, arrest: 0.6, inj: 0.3,
    tod: { kveld: 1.8, natt: 1.6, dag: 0.5 } },
  demonstrasjon: { navn: 'Demonstrasjon blokkerer vei', lead: ['politi'], tags: [], pri: 3, w: 0.3, lvl: 3, loc: 'vei', ikon: 'people', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi', { n: 2 }), SL('il', 'Innsatsleder', ACC.il, 'politi')], work: 30, target: 30, reward: 13000, expire: 90, danger: 0.06, xp: 22, tod: { dag: 1.5, natt: 0.1 } },
  savnet_barn: { navn: 'Savnet barn', lead: ['politi'], tags: [], pri: 1, w: 0.35, lvl: 2, loc: 'park', ikon: 'people', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi', { n: 2 }), SL('hu', 'Hundepatrulje', ACC.hund, 'politi', { req: false }), SL('sk', 'Søkelag', ACC.sok, 'frivillig', { req: false })],
    work: 18, target: 10, reward: 15000, expire: 70, danger: 0, xp: 28, search: true, tod: { kveld: 1.4 } },
  hjerneslag: { navn: 'Hjerneslag', lead: ['ambulanse'], tags: [], pri: 1, w: 0.7, lvl: 1, loc: 'hjem', ikon: 'brain', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('lg', 'Legebil', ACC.lege, 'ambulanse', { req: false })], work: 7, target: 12, reward: 15000, expire: 28, danger: 0, xp: 26, med: true, transportP: 1 },
  brystsmerter: { navn: 'Brystsmerter', lead: ['ambulanse'], tags: [], pri: 1, w: 1.1, lvl: 1, loc: 'hjem', ikon: 'heart', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true })], work: 7, target: 12, reward: 11000, expire: 30, danger: 0, xp: 18, med: true, transportP: 0.9 },
  overdose: { navn: 'Overdose', lead: ['ambulanse'], tags: ['natteliv'], pri: 1, w: 0.6, lvl: 1, loc: 'natt', ikon: 'pill', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('pa', 'Politi', ACC.patr, 'politi', { req: false })], work: 6, target: 12, reward: 12000, expire: 26, danger: 0.05, xp: 20, med: true, transportP: 0.8, tod: { natt: 1.8, kveld: 1.3 } },
  allergi: { navn: 'Alvorlig allergisk reaksjon', lead: ['ambulanse'], tags: [], pri: 1, w: 0.4, lvl: 1, loc: 'bygg', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true })], work: 5, target: 12, reward: 10000, expire: 24, danger: 0, xp: 16, med: true, transportP: 1, season: { var: 1.6, sommer: 1.3 } },
  diabetes: { navn: 'Føling (diabetes)', lead: ['ambulanse'], tags: [], pri: 2, w: 0.7, lvl: 1, loc: 'hjem', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse eller sanitet', ACC.ambV, 'ambulanse', { transport: true })], work: 6, target: 30, reward: 5000, expire: 70, danger: 0, xp: 9, transportP: 0.3 },
  psykisk: { navn: 'Person i psykisk krise', lead: ['ambulanse'], tags: [], pri: 2, w: 0.5, lvl: 2, loc: 'hjem', ikon: 'heart', fx: 'none', tri: false,
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true }), SL('pa', 'Politi (bistand)', ACC.patr, 'politi')], work: 18, target: 25, reward: 9500, expire: 70, danger: 0.12, xp: 18, transportP: 0.8 },
  sykkel: { navn: 'Sykkelulykke', lead: ['ambulanse'], tags: ['trafikk'], pri: 2, w: 0.7, lvl: 1, loc: 'vei', ikon: 'bike', fx: 'none',
    slots: [SL('am', 'Ambulanse', ACC.amb, 'ambulanse', { transport: true })], work: 7, target: 20, reward: 6500, expire: 50, danger: 0.02, xp: 11, transportP: 0.8, season: { var: 1.3, sommer: 1.6, vinter: 0.3 }, tod: { rush: 1.8 } },
  bat_nod: { navn: 'Båt i nød i fjorden', lead: ['brann', 'ambulanse'], tags: ['vann', 'strand'], pri: 1, w: 0.35, lvl: 2, loc: 'oy', ikon: 'anchor', fx: 'water',
    slots: [SL('bt', 'Båt eller helikopter', ACC.boat, 'brann'), SL('am', 'Ambulanse (møter på kaia)', ACC.amb, 'ambulanse', { req: false, transport: true })],
    work: 12, target: 20, reward: 19000, expire: 50, danger: 0.08, xp: 30, med: true, season: { sommer: 2.2, var: 0.8, host: 1.0, vinter: 0.3 }, wx: { storm: 3.0, regn: 1.3 } },

  /* --------------------------- ARRANGEMENTER --------------------------- */
  arr_skade: { navn: 'Skade på arrangement', lead: ['ambulanse'], tags: [], pri: 3, w: 0, lvl: 1, loc: 'arr', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse eller sanitet', ACC.ambV, 'ambulanse', { transport: true })], work: 5, target: 25, reward: 3600, expire: 60, danger: 0, xp: 6, transportP: 0.4, ev: true },
  arr_besvimelse: { navn: 'Besvimelse på arrangement', lead: ['ambulanse'], tags: [], pri: 2, w: 0, lvl: 1, loc: 'arr', ikon: 'pulse', fx: 'none',
    slots: [SL('am', 'Ambulanse eller sanitet', ACC.ambV, 'ambulanse', { transport: true })], work: 6, target: 20, reward: 5000, expire: 50, danger: 0, xp: 9, transportP: 0.6, ev: true },
  arr_rus: { navn: 'Ordensforstyrrelse', lead: ['politi'], tags: ['natteliv'], pri: 3, w: 0, lvl: 1, loc: 'arr', ikon: 'shield', fx: 'none',
    slots: [SL('pa', 'Patruljebil', ACC.patr, 'politi')], work: 6, target: 25, reward: 4500, expire: 60, danger: 0.12, xp: 8, arrest: 0.4, ev: true }
};

/** Hva innringeren sier når nødsentralen svarer (brukes i samtalekøen og på radio). */
const CALLER = {
  brann_bygning: ['Det brenner i leiligheten over meg – det kommer røyk ut av vinduene!', 'Det står flammer ut av et vindu her, folk er fortsatt inne!'],
  bilbrann: ['En bil står i full fyr i veien!'], brannalarm: ['Brannalarmen går i bygget, vi vet ikke om det brenner.'],
  fastklemt: ['Det har vært et kraftig sammenstøt, sjåføren sitter fastklemt!'], gasslekkasje: ['Det lukter sterkt gass i oppgangen!'],
  vannredning: ['Noen har falt i vannet fra kaia og klarer ikke komme opp!'], innbrudd: ['Jeg hører noen bryte seg inn hos naboen.'],
  slagsmal: ['Det er et stort slagsmål utenfor utestedet, noen ligger nede!'], trafikk_pol: ['Det har vært en trafikkulykke, bilene sperrer veien.'],
  savnet: ['Moren min har ikke kommet hjem, hun er dement.'], ran: ['Vi er nettopp blitt ranet i butikken, han hadde kniv!'],
  trusler: ['En mann truer folk på gata.'], plivo: ['Det skytes! Folk løper!'], hjertestans: ['Mannen min har falt om og puster ikke!'],
  fall: ['Moren min har falt og får ikke reist seg.'], pustebesvar: ['Jeg får ikke puste ordentlig.'], fodsel: ['Kona mi skal føde – det går fort nå!'],
  trafikkskade: ['En fotgjenger er påkjørt!'], strand_drukning: ['Noen er dratt opp av vannet og er livløs!'], strand_barn: ['Jeg finner ikke barnet mitt på stranden!'],
  strand_skade: ['En gutt har kuttet foten på stranden.'], strand_heteslag: ['En kvinne har svimt av i varmen.'], fjell_savnet: ['Vennen min kom aldri ned fra fjellet.'],
  fjell_skade: ['Jeg har falt og skadet foten på stien.'], gressbrann: ['Det brenner i gresset, det sprer seg mot husene!'], pipebrann: ['Det står gnister og flammer ut av pipa!'],
  container: ['En container brenner i bakgården.'], heis: ['Vi sitter fast i heisen.'], kjemikalie: ['En tankbil lekker noe som lukter stikkende!'],
  bat_brann: ['En båt brenner ved kaia!'], butikktyveri: ['Vi har holdt igjen en butikktyv.'], ruskjoring: ['Bilen foran meg kjører i sikksakk.'],
  husbrak: ['Jeg hører skriking og slag fra leiligheten ved siden av!'], demonstrasjon: ['Demonstranter har satt seg i veibanen.'], savnet_barn: ['Datteren min på seks er borte!'],
  hjerneslag: ['Far snakker rart og den ene armen henger!'], brystsmerter: ['Jeg har sterke smerter i brystet.'], overdose: ['En mann ligger bevisstløs i portrommet, det ligger sprøyter der.'],
  allergi: ['Hun hovner opp i ansiktet etter å ha spist nøtter!'], diabetes: ['Mannen min er diabetiker og helt forvirret.'], psykisk: ['Broren min snakker om å ta livet sitt.'],
  sykkel: ['En syklist har kjørt over styret og blør fra hodet.'], bat_nod: ['En båt har kantret ute i fjorden, folk ligger i vannet!']
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
    beaches: [   // tårnposisjoner (lat, lon) – livredderne står her; retningen ut mot vannet finnes fra kartdataene
      { id: 'sorenga', navn: 'Sørenga sjøbad', lat: 59.9006614, lon: 10.7512228, crowd: 1.3, wdir: [-1, 0.2], fast: true },
      { id: 'opera', navn: 'Oprastranda', lat: 59.9065057, lon: 10.7528321, crowd: 1.0, wdir: [0, 1], fast: true },
      { id: 'paradisbukta', navn: 'Paradisbukta', lat: 59.9043, lon: 10.6934, crowd: 1.0, wdir: [1, 0] },
      { id: 'huk', navn: 'Huk', lat: 59.8951209, lon: 10.6760143, crowd: 1.2, wdir: [-0.8, 0.6], fast: true },
      { id: 'hovedoya', navn: 'Hovedøya', lat: 59.8934992, lon: 10.72728, crowd: 0.7, island: true, wdir: [-0.6, 0.8], fast: true },
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
