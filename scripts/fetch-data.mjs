#!/usr/bin/env node
/**
 * Henter veinett og stedsdata fra OpenStreetMap via Overpass og lagrer som GeoJSON i /data:
 *   data/<by>-roads.geojson   kjørbare veier (LineString, properties: highway, name)
 *   data/<by>-sites.geojson   brannstasjoner, politistasjoner og ambulansestasjoner (Point)
 * Bruk:  node scripts/fetch-data.mjs [oslo|bergen ...]     (Node 18+)
 * Byene, bbox og Overpass-spørringen hentes fra js/core.js og js/geo.js, så alt er definert ett sted.
 * Data © OpenStreetMap-bidragsytere (ODbL).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (await readFile(join(root, 'js/core.js'), 'utf8')) + '\n' + (await readFile(join(root, 'js/geo.js'), 'utf8'));
const api = vm.runInNewContext(code + '\n({ CITY_CONFIGS, overpassQuery, overpassToGeoJSON, OVERPASS, roadsFromVectorTiles });', { fetch, AbortSignal, TextDecoder, console });
const { CITY_CONFIGS, overpassQuery, overpassToGeoJSON, OVERPASS, roadsFromVectorTiles } = api;

async function overpass(query, label) {
  let last;
  for (let round = 0; round < 2; round++) {
    for (const url of OVERPASS) {
      try {
        process.stdout.write(`  ${label}: ${new URL(url).host} … `);
        const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(75000), headers: { 'User-Agent': 'NodByen-data-script/1.0 (+https://github.com/magnus-ves/n-dbyen)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json(); console.log('ok'); return j;
      } catch (e) { last = e; console.log('feilet (' + e.message + ')'); }
    }
    await new Promise(res => setTimeout(res, 4000));
  }
  throw last;
}
function sitesQuery(cfg) {
  const [w, s, e, n] = cfg.bbox, bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:90];(nwr["amenity"="fire_station"]${bb};nwr["amenity"="police"]${bb};nwr["emergency"="ambulance_station"]${bb};nwr["amenity"="ambulance_station"]${bb};);out center tags;`;
}
function sitesToGeoJSON(json) {
  const feats = [];
  for (const el of json.elements || []) {
    const c = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center; if (!c) continue;
    const t = el.tags || {}, kind = t.amenity === 'fire_station' ? 'brann' : t.amenity === 'police' ? 'politi' : 'ambulanse';
    feats.push({ type: 'Feature', properties: { name: t.name || '', kind }, geometry: { type: 'Point', coordinates: [Math.round(c.lon * 1e6) / 1e6, Math.round(c.lat * 1e6) / 1e6] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CITY_CONFIGS);
await mkdir(join(root, 'data'), { recursive: true });
for (const id of wanted) {
  const cfg = CITY_CONFIGS[id]; if (!cfg) { console.error('Ukjent by:', id); process.exitCode = 1; continue; }
  console.log(`\n${cfg.navn}:`);
  let roads;
  try { roads = overpassToGeoJSON(await overpass(overpassQuery(cfg), 'veier')); }
  catch (e) {
    console.log('  Overpass svarer ikke (' + e.message + ') – henter veiene fra OpenFreeMap-fliser i stedet …');
    roads = await roadsFromVectorTiles(cfg, { progress: (d, t) => process.stdout.write(`\r  fliser ${d}/${t}`) }); console.log('');
  }
  await writeFile(join(root, cfg.roads), JSON.stringify(roads));
  console.log(`  → ${cfg.roads}: ${roads.features.length} veistrekk`);
  try {
    const sites = sitesToGeoJSON(await overpass(sitesQuery(cfg), 'stasjoner'));
    await writeFile(join(root, cfg.sitesFile), JSON.stringify(sites));
    console.log(`  → ${cfg.sitesFile}: ${sites.features.length} steder`);
  } catch (e) { console.log('  Hoppet over stasjoner (' + e.message + ') – spillet bruker da stasjonene i js/core.js.'); }
}
console.log('\nFerdig. Legg filene i repoet:  git add data/*.geojson && git commit -m "Veidata" && git push');
