# NødByen

Et rolig beredskapsspill i **ekte 3D-kart** av Oslo og Bergen. Du er beredskapsleder: ta imot hendelser, send brann, politi, ambulanse og frivillige, hold Nødnett oppe og bygg ut beredskapen.

* **Kart:** [MapLibre GL JS](https://maplibre.org) med vektorfliser fra [OpenFreeMap](https://openfreemap.org) (`https://tiles.openfreemap.org/planet`, ingen API-nøkkel) og en egen pastellstil (salvie, krem, sand, dempet havblå). Bygg vises i 3D (`fill-extrusion` med `render_height` / `render_min_height`).
* **Spillobjekter:** kjøretøy, stasjoner, Nødnett-master, hendelsesmarkører, brann/røyk og dekningslag tegnes av et **Three.js custom layer** oppå kartet.
* **Veinett:** hentes fra OpenStreetMap via Overpass, lagres som GeoJSON i `data/` og brukes til **A\*-stifinning** – bilene følger ekte gater (med geometri, ikke bare rette linjer).
* **Steder:** badestrendene i Oslo (Sørenga sjøbad, Paradisbukta, Huk, Hovedøya, Langøyene), sykehus/legevakt, master og stasjoner ligger som punkter med ekte koordinater (`js/core.js`, `data/*-sites.geojson`).
* Startpunkt: Oslo sentrum (59.913, 10.752) og Bergen sentrum (60.393, 5.324), pitch ca. 55°.

## Kjøre lokalt

```bash
npm run data      # (valgfritt) hent veinett og stasjoner fra Overpass → data/*.geojson
npm start         # statisk server på http://localhost:8080  (eller: python3 -m http.server)
```

Spillet må serveres over http(s) (ikke `file://`). Uten `data/*.geojson` henter nettleseren veinettet direkte fra Overpass første gang. `?offline=1` i adressen starter uten karttiler (kun spillobjekter og veinett som linjer – nyttig til test).

## Publisere

* **GitHub Pages:** slå på Pages (kilde: *GitHub Actions*). Workflowen `.github/workflows/pages.yml` publiserer ved push. Kjør *Hent veidata fra OpenStreetMap* (Actions → Run workflow) én gang for å legge `data/*.geojson` inn i repoet.
* **Vercel:** importer repoet som «Other / static» uten byggekommando; `vercel.json` er klart.

## Struktur

```
index.html          sidens skall (laster three.js, MapLibre og js/*)
css/style.css       organisk app-stil
js/core.js          hjelpere, ikoner, spilldata (etater, enheter, hendelsesmaler) og byconfig (lat/lon)
js/geo.js           projeksjon, veigraf fra GeoJSON, A* (binær heap), romlig indeks, tomter/strender
js/map.js           kartstil, Three.js custom layer, modeller, effekter, plukking
js/sim.js           tid/årstider/vær, Nødnett, enheter, hendelser, frivillige, økonomi, butikk
js/ui.js            topplinje, faner, dialoger, plassering
js/main.js          lagring (localStorage per by), spillflyt, hovedløkke
scripts/fetch-data.mjs   Overpass → data/*.geojson
```

Ny by: legg til et objekt i `CITY_CONFIGS` (`js/core.js`) med senter, bbox, master, strender osv., og kjør `npm run data`.

## Kreditering

Kartdata © [OpenStreetMap-bidragsytere](https://www.openstreetmap.org/copyright) (ODbL), fliser fra [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org). Krediteringen vises nederst til venstre i spillet.
