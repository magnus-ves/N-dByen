'use strict';
/* ==========================================================================
   13b. SAMBAND – lytt på talegruppene og snakk med enhetene
   Stemmene lages med nettleserens talesyntese (norsk der den finnes) og får radioklang:
   klikk og sus før og etter hver melding. Hver person/enhet får sin egen stemmehøyde og tempo.
   Ferdige lydfiler (f.eks. laget med ElevenLabs) kan legges i audio/radio/<nøkkel>.mp3 og brukes
   i stedet for talesyntese – se Radio.clips.
   ========================================================================== */
const Radio = {
  listen: new Set(), queue: [], speaking: false, ctx: null, voices: [], clips: {}, enabled: true,
  channel: null, scan: true, volume: 0.9,   // valgt kanal/talegruppe på radioen, skanning av skannelisten, lydstyrke
  init() {
    try { const saved = JSON.parse(localStorage.getItem('nodbyen.radio') || '[]'); saved.forEach(t => Radio.listen.add(t)); const st = JSON.parse(localStorage.getItem('nodbyen.radio2') || '{}'); if (st.channel) Radio.channel = st.channel; if (st.scan != null) Radio.scan = !!st.scan; if (st.volume != null) Radio.volume = st.volume; } catch (e) { /* ignorer */ }
    if ('speechSynthesis' in window) { const load = () => { Radio.voices = speechSynthesis.getVoices(); }; load(); speechSynthesis.onvoiceschanged = load; }
    Bus.on('log', e => Radio.onLog(e));
    Bus.on('dispatch', d => Radio.dispatchTalk(d.inc, d.u));
    Bus.on('arrive', d => Radio.arriveTalk(d.inc, d.u));
    // nettleseren krever et klikk før lyd og tale kan spilles av
    window.addEventListener('pointerdown', () => Radio.unlock(), { passive: true });
  },
  /** Ny runde: lytt på egne etaters talegrupper (og samvirke) hvis spilleren ikke har valgt noe selv. */
  defaults() {
    if (!Radio.channel) { const own = ETATER.find(a => S.agencies[a]); Radio.channel = own ? AGENCIES[own].tg : 'SENTRAL'; }
    if (Radio.listen.size) return;
    for (const a of ETATER) if (S.agencies[a]) Radio.listen.add(AGENCIES[a].tg);
    Radio.listen.add('REDNING'); for (let k = 1; k <= 6; k++) Radio.listen.add('SAMVIRKE ' + k); Radio.save();
  },
  save() { try { localStorage.setItem('nodbyen.radio', JSON.stringify([...Radio.listen])); localStorage.setItem('nodbyen.radio2', JSON.stringify({ channel: Radio.channel, scan: Radio.scan, volume: Radio.volume })); } catch (e) { /* ignorer */ } },
  /** Bytt kanal/talegruppe på radioen: bare den (og skannelisten hvis skanning er på) høres. */
  setChannel(tg) { if (!tg || tg === Radio.channel) return; Radio.channel = tg; Radio.queue = Radio.queue.filter(m => Radio.heard({ tg: m.tg })); if (Radio.speaking && 'speechSynthesis' in window) speechSynthesis.cancel(); Radio.save(); Bus.emit('radioChannel', tg); },
  /** Talegrupper som kan avlyttes (VHF har kanaler i stedet for talegrupper). */
  channels() {
    const vhf = Net.vhf(), list = [
      { id: 'BRANN', navn: vhf ? 'VHF kanal 1 – brann' : 'BRANN – brann og redning' }, { id: 'POLITI', navn: vhf ? 'VHF kanal 2 – politi' : 'POLITI – operativ' },
      { id: 'HELSE', navn: vhf ? 'VHF kanal 3 – helse' : 'HELSE – AMK og ambulanser' }, { id: 'REDNING', navn: vhf ? 'VHF kanal 4 – frivillige' : 'REDNING – frivillige og livreddere' },
      { id: 'SENTRAL', navn: 'Sentralene – nye hendelser' }, { id: 'NØDNETT', navn: vhf ? 'Driftsmeldinger' : 'NØDNETT – driftsmeldinger og nødknapp' }];
    if (!vhf) for (let k = 1; k <= Net.samvMax(); k++) list.push({ id: 'SAMVIRKE ' + k, navn: 'SAMVIRKE ' + k + (Net.samvActive().some(i => i.tg === 'SAMVIRKE ' + k) ? ' – i bruk' : ' – ledig') });
    return list;
  },
  toggle(tg) { if (Radio.listen.has(tg)) Radio.listen.delete(tg); else { Radio.listen.add(tg); Radio.unlock(); if (S) S.flags.listened = 1; } Radio.save(); },
  heard(e) { const tg = e.tg; if (!tg) return false; if (tg === Radio.channel) return true; return Radio.scan && (Radio.listen.has(tg) || (tg.startsWith('SAMVIRKE') && Radio.listen.has('SAMVIRKE*'))); },
  onLog(e) {
    if (!Radio.enabled || Game.mode !== 'play' || !Radio.heard(e) || e.kind === 'quiet') return;
    if (/^(Utrykning til|Varslet –|Går til skadested)|: (Utrykning til|Varslet|Går til)/.test(e.msg) || e.msg === 'Fremme på stedet') return;   // dekkes av dialogene under
    Radio.say(e.from, e.msg, e.tg, e.kind === 'alarm');
  },
  /** Radiodialog: flere replikker etter hverandre med hver sin stemme. Vises også i loggen. */
  dialog(tg, lines) {
    if (!S) return;
    const speak = Radio.enabled && Game.mode === 'play' && Radio.heard({ tg }) && 'speechSynthesis' in window;
    if (!speak) { lines.forEach(([who, msg], i) => setTimeout(() => { if (S) Log.add(tg, who, msg, 'quiet'); }, i * 400)); return; }
    Radio.queue.push({ tg, lines: lines.slice() }); if (Radio.queue.length > 8) Radio.queue.splice(0, Radio.queue.length - 8); Radio.next();
  },
  centralOf(inc) { const a = AGENCIES[inc.lead] || AGENCIES.brann; return inc.lead === 'ambulanse' ? 'AMK' : inc.lead === 'politi' ? 'Operasjonssentralen' : a.sentral || 'Sentralen'; },
  priText(inc) { const lab = (PRI_LABEL[inc.lead] || PRI_LABEL.brann)[inc.pri]; return inc.lead === 'politi' ? 'prioritet ' + lab : inc.lead === 'ambulanse' ? lab.toLowerCase() + ' oppdrag' : lab.toLowerCase() + ' prioritet'; },
  dispatchTalk(inc, u) {
    const tg = inc.tg || tgOf(u), c = Radio.centralOf(inc), T = UT[u.type];
    if (T.foot) return Radio.dialog(tg, [[u.name, c + ', ' + u.name + ', vi tar den. Løper ned til vannet.']]);
    const lines = [[c, u.name + ', ' + c + '.'], [u.name, c + ', ' + u.name + ', kom.'],
      [c, inc.navn + ', ' + inc.loc.addr + ', ' + Radio.priText(inc) + '.' + (inc.caller ? ' Innringer sier: ' + inc.caller : '')],
      [u.name, T.mob && !u.bistand ? 'Mottatt, vi varsler mannskapet og rykker ut så fort vi er samlet.' : inc.pri === 1 ? 'Mottatt, rykker ut med blålys.' : 'Mottatt, vi kjører.']];
    const crew = Staff.needs(u) ? Staff.of(u) : []; if (crew.length >= 2) lines.push([crew[0].navn.split(' ')[0], crew[1].navn.split(' ')[0] + ', du kjører. Jeg tar sambandet.']);
    if (inc.island && !T.boat && T.model !== 'heli') lines.push([c, 'Merk: stedet ligger på øya. Møt båten på kaia.']);
    Radio.dialog(tg, lines);
  },
  arriveTalk(inc, u) {
    const tg = inc.tg || tgOf(u), c = Radio.centralOf(inc), crew = Staff.needs(u) ? Staff.of(u).map(p => p.navn.split(' ')[0]) : [];
    const first = !inc.firstTalk; inc.firstTalk = true;
    const sit = { brann: ['Røykutvikling fra andre etasje, vi går inn med røykdykkere.', 'Brannen er avgrenset, vi starter slokking.', 'Vi har kontroll på stedet.'],
      politi: ['Situasjonen er rolig nå, vi snakker med de involverte.', 'Vi sikrer stedet.', 'Vi har kontakt med melder.'],
      ambulanse: ['Pasienten er våken og puster, vi undersøker.', 'Pasienten er dårlig, vi starter behandling.', 'Vi er hos pasienten.'] }[UT[u.type].org] || ['Vi er på stedet og har oversikt.'];
    const lines = [[u.name, c + ', ' + u.name + ' er fremme.' + (first ? ' ' + pick(sit) : '')], [c, 'Mottatt.']];
    if (crew.length >= 2) lines.push([crew[1], crew[0] + ', jeg henter ' + pick({ brann: ['slangen', 'røykdykkerutstyret', 'brekkjernet', 'lykta'], politi: ['sperrebåndet', 'lykta', 'førstehjelpsskrinet'], ambulanse: ['båren', 'sekken', 'hjertestarteren', 'oksygenet'] }[UT[u.type].org] || ['utstyret']) + '.'], [crew[0], 'Bra, jeg går foran.']);
    Radio.dialog(tg, lines);
  },
  /** Mannskap på stedet snakker sammen innimellom (kalles fra UI-løkken). */
  chatter() {
    if (!S || !Radio.enabled) return;
    for (const inc of Sim.active()) {
      if (!inc.onScene || (inc._chat && S.t - inc._chat < 6)) continue; inc._chat = S.t;
      const on = Sim.onScene(inc).filter(u => Staff.needs(u) && Staff.of(u).length >= 2); if (!on.length || Math.random() < 0.4) continue;
      const u = pick(on), n = Staff.of(u).map(p => p.navn.split(' ')[0]), pct = Math.round(100 * inc.progress / Math.max(1, inc.work)), tg = inc.tg || tgOf(u);
      const org = UT[u.type].org, A = n[0], B = n[1];
      const talk = { brann: [[A, B + ', hvordan ser det ut inne?'], [B, pct > 60 ? 'Nesten slukket, vi etterslukker.' : 'Fortsatt mye røyk, vi trenger mer vann.']],
        politi: [[A, B + ', ta personalia på vitnene.'], [B, 'Skal bli. Jeg snakker med dem nå.']],
        ambulanse: [[A, 'Blodtrykket er ' + (pct > 50 ? 'stabilt nå.' : 'lavt, vi gir væske.')], [B, pct > 50 ? 'Bra, vi gjør klar for transport.' : 'Mottatt, jeg legger inn venekanyle.']] }[org] || [[A, 'Alt under kontroll her.'], [B, 'Mottatt.']];
      if (pct > 85) talk.push([u.name, Radio.centralOf(inc) + ', ' + u.name + ', vi er snart ferdige her.']);
      Radio.dialog(tg, talk);
    }
  },
  /** Lydkontekst må startes av et klikk (nettleserregel). */
  unlock() { try { if (!Radio.ctx) Radio.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (Radio.ctx.state === 'suspended') Radio.ctx.resume(); } catch (e) { /* ingen lyd */ } },
  /** Kort radioklikk + sus (squelch). */
  squelch(len, loud) {
    const c = Radio.ctx; if (!c) return;
    const n = Math.floor(c.sampleRate * len), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { const env = i < 200 ? i / 200 : Math.max(0, 1 - (i - 200) / (n - 200)); d[i] = (Math.random() * 2 - 1) * env * (loud ? 0.35 : 0.22); }
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7; g.gain.value = 0.6;
    g.gain.value = 0.6 * Radio.volume; src.buffer = buf; src.connect(bp).connect(g).connect(c.destination); src.start();
    const o = c.createOscillator(), og = c.createGain(); o.frequency.value = loud ? 1400 : 1050; og.gain.setValueAtTime(0.06 * Radio.volume + 0.0001, c.currentTime); og.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.07); o.connect(og).connect(c.destination); o.start(); o.stop(c.currentTime + 0.08);
  },
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; },
  voiceFor(who) {
    const nb = Radio.voices.filter(v => /^(nb|no|nn)/i.test(v.lang)), pool = nb.length ? nb : Radio.voices.filter(v => /^(sv|da)/i.test(v.lang));
    const h = Radio.hash(who); return { voice: pool.length ? pool[Math.floor(h * pool.length)] : null, pitch: 0.75 + h * 0.6, rate: 1.05 + ((h * 7) % 1) * 0.2 };
  },
  /** Sier en melding på radioen (køes, maks fire ventende). */
  say(who, msg, tg, urgent) {
    if (!('speechSynthesis' in window)) return;
    Radio.queue.push({ who, msg, tg, urgent }); if (Radio.queue.length > 8) Radio.queue.splice(0, Radio.queue.length - 8);
    Radio.next();
  },
  next() {
    if (Radio.speaking || !Radio.queue.length) return;
    const m = Radio.queue[0];
    if (m.lines) {   // dialog: én replikk om gangen, samlet, og vist i loggen når den sies
      const [who, msg] = m.lines.shift(); if (!m.lines.length) Radio.queue.shift();
      if (S) Log.add(m.tg, who, msg, 'quiet');
      return Radio.speakOne({ who, msg, tg: m.tg, urgent: false });
    }
    Radio.queue.shift(); Radio.speakOne(m);
  },
  speakOne(m) {
    Radio.speaking = true; Radio.unlock(); Radio.squelch(0.12, m.urgent); Bus.emit('radioRx', m);
    const key = Radio.clipKey(m.msg), clip = key && Radio.clips[key];
    const done = () => { Radio.squelch(0.18, false); Radio.speaking = false; Bus.emit('radioRxEnd', m); setTimeout(Radio.next, 250); };
    if (clip) { const a = new Audio(clip); a.onended = done; a.onerror = done; a.play().catch(done); return; }
    const u = new SpeechSynthesisUtterance(m.who + '. ' + m.msg.replace(/–/g, ',').replace(/\(.*?\)/g, '')), v = Radio.voiceFor(m.who);
    u.lang = v.voice ? v.voice.lang : 'nb-NO'; if (v.voice) u.voice = v.voice; u.pitch = v.pitch; u.rate = m.urgent ? v.rate + 0.15 : v.rate; u.volume = Radio.volume;
    u.onend = done; u.onerror = done; setTimeout(() => speechSynthesis.speak(u), 130);
  },
  /** Nøkkel for ferdiginnspilte lydfiler (audio/radio/<nøkkel>.mp3) for faste fraser. */
  clipKey(msg) {
    const map = [['Fremme på stedet', 'fremme'], ['Mottatt – mobiliserer', 'mobiliserer'], ['Pasient overlevert', 'overlevert'], ['Mottatt', 'mottatt']];
    for (const [k, v] of map) if (msg.startsWith(k)) return v; return null;
  },

  /* ---------- snakk med enhetene ---------- */
  /** Svar fra en enhet på et spørsmål eller en ordre. Enkle nøkkelord forstås (status, hvor, tid, avbryt, blålys …). */
  command(u, text) {
    const t = text.toLowerCase(), tg = tgOf(u), inc = u.job && u.job.inc && S.incidents[u.job.inc];
    Log.add(tg, 'Sentral', u.name + ', ' + text, 'info'); S.flags.talked = 1;
    const street = () => { try { return WORLD.streetOf(Sim.unitRP(u)); } catch (e) { return 'ukjent sted'; } };
    let reply, delay = Net.commDelay(u);
    if (u.contact === 'ingen') { Bus.emit('toast', { msg: u.name + ' svarer ikke – ingen dekning', kind: 'warn' }); return; }
    if (/avbryt|returner|tilbake|kom hjem|dra hjem/.test(t)) { if (u.job) { Sim.recall(u); reply = 'Mottatt, avbryter og returnerer til stasjon.'; } else reply = 'Mottatt, vi har ikke noe oppdrag nå.'; }
    else if (/uten blålys|slå av|stopp sirene/.test(t)) { u.siren = false; reply = 'Mottatt, kjører uten blålys.'; }
    else if (/blålys|sirene|haster|fortere/.test(t)) { if (u.status === 'utrykning' || u.status === 'transport') { u.siren = true; reply = 'Mottatt, full utrykning.'; } else reply = 'Mottatt, vi er ikke i utrykning.'; }
    else if (/hvor|posisjon|sted/.test(t)) reply = 'Vi er ved ' + street() + '.';
    else if (/tid|eta|fremme|lenge/.test(t)) { const r = UI.remaining(u); reply = r != null ? 'Fremme om ca. ' + Math.max(1, Math.ceil(r)) + ' minutter.' : u.status === 'pastedet' ? 'Vi er på stedet.' : 'Vi er ' + UI.unitState(u).toLowerCase() + '.'; }
    else if (/situasjon|rapport|hvordan|status|melding/.test(t)) {
      if (inc && u.status === 'pastedet') reply = 'Situasjonsrapport fra ' + inc.loc.addr + ': arbeidet er ' + Math.round(100 * inc.progress / Math.max(1, inc.work)) + ' prosent ferdig.' + (inc.slots.some(s => s.req && s.units.length < s.n) ? ' Vi trenger flere ressurser.' : ' Vi har det vi trenger.');
      else reply = UI.unitState(u) + (inc ? ', oppdrag ' + inc.navn.toLowerCase() + ' på ' + inc.loc.addr : '') + '.';
    }
    else if (/mannskap|folk|hvem/.test(t)) reply = Staff.needs(u) ? 'Vi er ' + Staff.of(u).length + ' på bilen: ' + Staff.of(u).map(p => p.navn.split(' ')[0]).join(', ') + '.' : 'Vi er ' + UT[u.type].crew + ' mannskap.';
    else reply = pick(['Mottatt.', 'Mottatt, det tar vi.', 'Oppfattet.']);
    setTimeout(() => { if (S && S.units[u.id]) Log.add(tg, u.name, reply, 'info'); }, 900 + delay * 600);
    if (!Radio.heard({ tg })) Radio.setChannel(tg);   // radioen går over på enhetens talegruppe så svaret høres
  },
  /** Dialog for å snakke med en enhet: hurtigknapper, fritekst og mikrofon (talegjenkjenning der nettleseren støtter det). */
  talk(uid) {
    const u = S.units[uid]; if (!u) return; Radio.unlock();
    const quick = ['Status?', 'Hvor er dere?', 'Hvor lang tid til fremme?', 'Situasjonsrapport', 'Kjør med blålys', 'Avbryt og returner'];
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    UI.modal({ title: icon('radio') + ' Samband: ' + esc(u.name), html: '<p class="muted sm">' + esc(UI.unitState(u)) + ' · talegruppe ' + esc(tgOf(u)) + ' · ' + (Net.vhf() ? 'VHF' : 'Nødnett') + '</p>'
      + '<div class="row wrap" style="gap:6px">' + quick.map(q => '<button class="btn sm" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>'
      + '<div class="row" style="margin-top:10px;gap:6px"><input id="rTxt" class="inp grow" placeholder="Skriv en melding, f.eks. «Hvor er dere?»" autocomplete="off">' + (SR ? '<button class="btn" id="rMic" title="Snakk">' + icon('mic') + '</button>' : '') + '<button class="btn primary" id="rSend">Send</button></div>'
      + '<p class="xs muted" style="margin-top:8px">Radioen går over på enhetens talegruppe, så svaret høres.</p>',
      buttons: [{ label: 'Lukk', cls: 'ghost' }],
      init: h => {
        const send = txt => { if (!txt.trim()) return; Radio.command(u, txt.trim()); h.close(); };
        $$('[data-q]', h.body).forEach(b => b.addEventListener('click', () => send(b.dataset.q)));
        const inp = $('#rTxt', h.body); $('#rSend', h.body).addEventListener('click', () => send(inp.value)); inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(inp.value); });
        const mic = $('#rMic', h.body);
        if (mic) mic.addEventListener('click', () => { try { const r = new SR(); r.lang = 'nb-NO'; r.interimResults = false; mic.classList.add('on'); r.onresult = ev => { inp.value = ev.results[0][0].transcript; send(inp.value); }; r.onend = () => mic.classList.remove('on'); r.start(); } catch (e) { UI.toast('Mikrofonen er ikke tilgjengelig', 'warn'); } });
        setTimeout(() => inp.focus(), 50);
      } });
  }
};
