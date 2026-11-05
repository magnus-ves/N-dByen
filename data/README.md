# data/

Her ligger veinettet og stedene spillet bruker (GeoJSON, © OpenStreetMap-bidragsytere, ODbL):

| fil | innhold |
|---|---|
| `oslo-roads.geojson`, `bergen-roads.geojson` | kjørbare veier (LineString med `highway` og `name`) – brukes til A*-stifinning |
| `oslo-sites.geojson`, `bergen-sites.geojson` | brann-, politi- og ambulansestasjoner (Point) – vises som byggbare steder |

Filene lages av `scripts/fetch-data.mjs` (kjør `npm run data`, eller GitHub Action «Hent veidata fra OpenStreetMap»).
Mangler veifilen, henter spillet veinettet direkte fra Overpass i nettleseren (tregere første gang). Mangler stedsfilen, brukes de omtrentlige stedene i `js/core.js`.
Lagrede spill refererer til tomte-ID-er; hvis du genererer data på nytt kan eldre lagringer få andre tomter.
