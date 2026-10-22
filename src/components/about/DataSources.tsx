/** Every outside source Hyked shows, with its licence: linked from the "More" menu and the map attribution. */
const SOURCES: { name: string; url: string; use: string; licence: string; licenceUrl?: string }[] = [
  { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", use: "Trail lines and route relations, named paths, and hike features (water, campsites, shelters, trailheads, viewpoints, peaks, crossings)", licence: "Open Database License (ODbL) 1.0", licenceUrl: "https://opendatacommons.org/licenses/odbl/" },
  { name: "National Park Service", url: "https://www.nps.gov/", use: "Official trails and park boundaries", licence: "Public domain (U.S. federal government work)" },
  { name: "U.S. Forest Service", url: "https://data.fs.usda.gov/geodata/edw/", use: "National Forest System trails", licence: "Public domain (U.S. federal government work)" },
  { name: "Bureau of Land Management", url: "https://gbp-blm-egis.hub.arcgis.com/", use: "Trails from Ground Transportation Linear Features", licence: "Public domain (U.S. federal government work)" },
  { name: "USGS National Digital Trails", url: "https://www.usgs.gov/national-digital-trails", use: "Official trails compiled from federal, state and local agencies", licence: "Public domain (U.S. federal government work)" },
  { name: "Parks Canada", url: "https://open.canada.ca/", use: "Official trails in national parks", licence: "Open Government Licence – Canada", licenceUrl: "https://open.canada.ca/en/open-government-licence-canada" },
  { name: "Ontario Trail Network", url: "https://data.ontario.ca/", use: "Official trails in Ontario", licence: "Open Government Licence – Ontario", licenceUrl: "https://www.ontario.ca/page/open-government-licence-ontario" },
  { name: "Wikidata and Wikipedia", url: "https://www.wikidata.org/", use: "Trail descriptions (the Wikipedia lead paragraph) and matching", licence: "Wikidata CC0; Wikipedia text CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/", use: "Trail photos; each photo shows its author and licence", licence: "Per image (shown with the photo)" },
  { name: "OpenFreeMap and OpenMapTiles", url: "https://openfreemap.org/", use: "Topo and standard basemap tiles", licence: "Free for any use; map data © OpenStreetMap contributors, © OpenMapTiles", licenceUrl: "https://www.openmaptiles.org/" },
  { name: "AWS Terrain Tiles (Mapzen Terrarium)", url: "https://registry.opendata.aws/terrain-tiles/", use: "Elevation profiles, hillshading and contour lines (USGS 3DEP, SRTM and other public elevation data)", licence: "Open data; see the source attributions", licenceUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md" },
  { name: "Esri World Imagery", url: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9", use: "Satellite basemap", licence: "© Esri, Maxar, Earthstar Geographics; Esri terms of use" },
  { name: "OSRM (FOSSGIS public server)", url: "https://routing.openstreetmap.de/", use: "Optional road connectors in the route builder and driving directions; trail routing itself runs in your browser", licence: "Routing over © OpenStreetMap contributors (ODbL)" },
  { name: "National Weather Service", url: "https://www.weather.gov/", use: "7-day forecasts in the U.S.", licence: "Public domain (U.S. federal government work)" },
  { name: "Open-Meteo", url: "https://open-meteo.com/", use: "Forecasts outside the U.S.", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" },
  { name: "GeoNames", url: "https://www.geonames.org/", use: "Nearby towns", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" },
];

export function DataSources() {
  return (
    <section className="fieldbook-page data-sources">
      <h1>Data sources &amp; licences</h1>
      <p>
        Every trail, feature and fact in Hyked comes from the public sources below. Trails are shown only when an
        official agency or OpenStreetMap maps them, and missing facts are left out rather than filled in. We don’t use
        data from AllTrails, Hiking Project, Trailforks or any site whose terms prohibit it.
      </p>
      <ul className="data-sources-list">
        {SOURCES.map((s) => (
          <li key={s.name}>
            <a href={s.url} target="_blank" rel="noopener noreferrer"><strong>{s.name}</strong></a>
            <span>{s.use}.</span>
            <small>{s.licenceUrl ? <a href={s.licenceUrl} target="_blank" rel="noopener noreferrer">{s.licence}</a> : s.licence}</small>
          </li>
        ))}
      </ul>
      <p className="data-sources-note">Conditions change. Check closures, permits, water and access with the land manager before you go.</p>
    </section>
  );
}
