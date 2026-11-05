'use strict';
/* ==========================================================================
   11b. MÅL OG DØGNRAPPORT – en rekke mål som lærer deg spillet og gir belønning, og en rapport etter hvert spilldøgn
   ========================================================================== */
const Goals = {
  LIST: [
    { id: 'svar', navn: 'Svar på et nødanrop selv', tekst: 'Trykk «Svar» når det ringer i nødsentralen.', kr: 5000, xp: 10, ok: s => s.flags.answered },
    { id: 'send', navn: 'Send en enhet ut', tekst: 'Trykk «Send enheter» på en hendelse.', kr: 5000, xp: 10, ok: s => (s.flags.dispatched || 0) >= 1 },
    { id: 'lytt', navn: 'Lytt på sambandet', tekst: 'Velg en talegruppe under Nødnett → Radio.', kr: 3000, xp: 5, ok: s => s.flags.listened },
    { id: 'los3', navn: 'Løs 3 oppdrag', tekst: 'Få enhetene frem og la dem gjøre jobben.', kr: 15000, xp: 20, ok: s => s.stats.solved >= 3 },
    { id: 'snakk', navn: 'Snakk med en enhet', tekst: 'Enheter → velg en enhet → «Snakk».', kr: 3000, xp: 5, ok: s => s.flags.talked },
    { id: 'kjop', navn: 'Kjøp et nytt kjøretøy', tekst: 'Butikk → Kjøretøy. Mannskap følger med.', kr: 10000, xp: 15, ok: s => s.flags.bought },
    { id: 'k160', navn: 'Ansett en med kode 160', tekst: 'Stasjoner → «Ansett med kode 160» gir reserve når noen blir skadet.', kr: 8000, xp: 10, ok: s => s.flags.hired160 },
    { id: 'stasjon', navn: 'Bygg en ny stasjon', tekst: 'Kortere kjøretid til flere deler av byen.', kr: 25000, xp: 25, ok: s => Object.values(s.stations).filter(st => !st.gift).length >= 2 },
    { id: 'etat', navn: 'Opprett en etat til', tekst: 'Butikk → Stasjoner → Opprett. Flere etater gir flere oppdrag.', kr: 40000, xp: 30, ok: s => ETATER.filter(a => s.agencies[a]).length >= 2 },
    { id: 'nodnett', navn: 'Bytt fra VHF til Nødnett', tekst: 'Butikk → Nødnett. Gir samvirke og raskere ordre.', kr: 30000, xp: 25, ok: s => s.net.termLevel >= 1 },
    { id: 'frivillig', navn: 'Inngå avtale med frivillige', tekst: 'Røde Kors, Folkehjelpa, Redningsselskapet eller livreddere.', kr: 20000, xp: 20, ok: s => !!(s.vol.rk || s.vol.nf || s.vol.rs || s.vol.strand) },
    { id: 'samv', navn: 'Bruk en samvirke-talegruppe', tekst: 'Når flere etater jobber sammen på samme sted.', kr: 20000, xp: 25, ok: s => s.stats.samv >= 1 },
    { id: 'trippel', navn: 'Løs en trippelvarsling', tekst: 'Brann, politi og helse på samme hendelse.', kr: 35000, xp: 40, ok: s => s.flags.triSolved },
    { id: 'los25', navn: 'Løs 25 oppdrag', tekst: 'Bygg ut og hold responstiden nede.', kr: 60000, xp: 60, ok: s => s.stats.solved >= 25 },
    { id: 'beredskap', navn: 'Nå 85 % beredskap', tekst: 'Rask respons, god dekning og frivillige på plass.', kr: 50000, xp: 50, ok: s => (s.ready || 0) >= 85 },
    { id: 'liv', navn: 'Redd 20 liv', tekst: 'Hjertestans, drukning og alvorlige skader – tiden teller.', kr: 80000, xp: 80, ok: s => s.stats.lives >= 20 },
    { id: 'los100', navn: 'Løs 100 oppdrag', tekst: 'Byen er trygg i dine hender.', kr: 200000, xp: 150, ok: s => s.stats.solved >= 100 }
  ],
  done: id => !!(S.goals && S.goals[id]),
  active(n) { return Goals.LIST.filter(g => !Goals.done(g.id)).slice(0, n || 3); },
  count() { return Goals.LIST.filter(g => Goals.done(g.id)).length; },
  tick() {
    if (!S) return; S.goals = S.goals || {};
    for (const g of Goals.active(4)) if (g.ok(S)) {
      S.goals[g.id] = S.t; S.money += g.kr; S.stats.income += g.kr; Eco.addXp(g.xp);
      Log.add('SENTRAL', 'Sentral', 'Mål nådd: ' + g.navn + ' (+' + fmtKr(g.kr) + ')', 'info');
      Bus.emit('toast', { msg: 'Mål nådd: ' + g.navn + ' · +' + fmtKr(g.kr), kind: 'good' }); if (typeof Sound !== 'undefined') Sound.chime(true); UI.dirty = true;
    }
    // døgnrapport når et nytt spilldøgn starter
    const day = Clock.cur.dayNo; if (S.lastReport == null) S.lastReport = day;
    if (day !== S.lastReport) { const prev = S.lastReport; S.lastReport = day; Bus.emit('dayReport', { day: prev, d: S.stats.days[prev] || { inc: 0, ok: 0, fail: 0, income: 0, cost: 0 } }); }
  },
  card() {
    const act = Goals.active(3); if (!act.length) return '';
    return '<div class="card goals"><div class="row"><b class="sm grow">' + icon('star') + ' Neste mål</b><span class="xs muted">' + Goals.count() + ' av ' + Goals.LIST.length + ' fullført</span></div>'
      + act.map(g => '<div class="goal"><div class="grow"><div class="sm b">' + esc(g.navn) + '</div><div class="xs muted">' + esc(g.tekst) + '</div></div>' + chip('+' + fmtKr(g.kr), 'ok') + '</div>').join('') + '</div>';
  },
  list() { return '<h3 class="sec">Mål</h3>' + Goals.LIST.map(g => '<div class="urow"><div class="av" style="background:' + (Goals.done(g.id) ? '#7b9a79' : '#B7BDB8') + '">' + icon(Goals.done(g.id) ? 'check' : 'star') + '</div><div class="grow"><b class="sm">' + esc(g.navn) + '</b><div class="xs muted">' + esc(g.tekst) + '</div></div><span class="price">' + fmtKr(g.kr) + '</span></div>').join(''); },
  report(r) {
    const d = r.d, net = d.income - d.cost, byAg = S.stats.byAg, rows = ETATER.filter(a => S.agencies[a]).map(a => { const x = byAg[a]; return '<span>' + AGENCIES[a].kort + '</span><span>' + (x.n ? fmtDur(x.rt / x.n) + ' snitt · ' + Math.round(100 * x.ok / x.n) + ' % i mål' : '–') + '</span>'; }).join('');
    UI.modal({ title: icon('doc') + ' Døgnrapport · dag ' + r.day, html: '<div class="grid2"><div class="tile"><b>' + d.ok + '</b><span>Løste oppdrag</span></div><div class="tile"><b>' + d.fail + '</b><span>Ikke håndtert i tide</span></div><div class="tile"><b>' + fmtKr(d.income) + '</b><span>Inntekter</span></div><div class="tile"><b>' + fmtKr(d.cost) + '</b><span>Kostnader</span></div></div>'
      + '<p class="b" style="margin-top:10px">Resultat: <span style="color:' + (net >= 0 ? '#4E7A52' : '#9c3f33') + '">' + (net >= 0 ? '+' : '') + fmtKr(net) + '</span> · beredskap ' + Math.round(S.ready) + ' %</p>'
      + '<div class="kv">' + rows + '</div><p class="xs muted" style="margin-top:8px">' + (d.fail > d.ok ? 'Mange oppdrag ble ikke nådd i tide – vurder flere enheter, en ny stasjon eller flere operatørplasser.' : 'Bra jobbet! Neste mål: ' + ((Goals.active(1)[0] || {}).navn || 'alle mål er nådd')) + '</p>', buttons: [{ label: 'Fortsett', cls: 'primary' }] });
  }
};
