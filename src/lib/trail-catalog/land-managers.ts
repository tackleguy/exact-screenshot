/**
 * The land manager of a trail and its official website. The trail's own record wins (officialUrl, the OSM route's
 * website, an agency record's page); otherwise the agency's official home page from the list below. Data publishers
 * that sources list as the "manager" (state GIS offices) are not land managers and are skipped.
 */
import type { CatalogTrail } from "./types";
import { GIS_PUBLISHER } from "./naming";

/** Official sites of the agencies that manage most catalog trails (matched against the manager or place name). */
const AGENCY_SITES: [RegExp, string, string][] = [
  [/national forests?\b|national grassland|forest service|\busfs\b/i, "U.S. Forest Service", "https://www.fs.usda.gov/"],
  [/national park service|\bnps\b|national (park|monument|seashore|lakeshore|recreation area|historical park|preserve|scenic trail)/i, "National Park Service", "https://www.nps.gov/"],
  [/bureau of land management|\bblm\b/i, "Bureau of Land Management", "https://www.blm.gov/"],
  [/fish and wildlife service|national wildlife refuge/i, "U.S. Fish and Wildlife Service", "https://www.fws.gov/"],
  [/parks canada/i, "Parks Canada", "https://parks.canada.ca/"],
  [/colorado parks and wildlife/i, "Colorado Parks and Wildlife", "https://cpw.state.co.us/"],
  [/vermont agency of natural resources/i, "Vermont Agency of Natural Resources", "https://anr.vermont.gov/"],
  [/new york (state )?department of environmental conservation/i, "NYS Department of Environmental Conservation", "https://dec.ny.gov/"],
  [/new york state parks/i, "New York State Parks", "https://parks.ny.gov/"],
  [/virginia department of conservation and recreation/i, "Virginia DCR", "https://www.dcr.virginia.gov/"],
  [/california department of parks and recreation|california state parks/i, "California State Parks", "https://www.parks.ca.gov/"],
  [/california coastal commission/i, "California Coastal Commission", "https://www.coastal.ca.gov/"],
  [/new jersey state park service/i, "New Jersey State Park Service", "https://dep.nj.gov/parksandforests/"],
  [/new jersey department of environmental protection/i, "New Jersey DEP", "https://dep.nj.gov/"],
  [/indiana department of natural resources/i, "Indiana DNR", "https://www.in.gov/dnr/"],
  [/florida department of environmental protection/i, "Florida DEP", "https://floridadep.gov/"],
  [/michigan department of natural resources/i, "Michigan DNR", "https://www.michigan.gov/dnr"],
  [/iowa department of natural resources/i, "Iowa DNR", "https://www.iowadnr.gov/"],
  [/texas parks and wildlife/i, "Texas Parks and Wildlife", "https://tpwd.texas.gov/"],
  [/minnesota department of natural resources/i, "Minnesota DNR", "https://www.dnr.state.mn.us/"],
  [/ohio department of natural resources/i, "Ohio DNR", "https://ohiodnr.gov/"],
  [/washington state parks/i, "Washington State Parks", "https://parks.wa.gov/"],
  [/pennsylvania department of conservation and natural resources/i, "Pennsylvania DCNR", "https://www.dcnr.pa.gov/"],
  [/pennsylvania game commission/i, "Pennsylvania Game Commission", "https://www.pgc.pa.gov/"],
  [/maryland (dnr|department of natural resources)/i, "Maryland DNR", "https://dnr.maryland.gov/"],
  [/connecticut department of energy and environmental protection/i, "Connecticut DEEP", "https://portal.ct.gov/deep"],
  [/north country trail association/i, "North Country Trail Association", "https://northcountrytrail.org/"],
  [/bruce trail conservancy/i, "Bruce Trail Conservancy", "https://brucetrail.org/"],
  [/delaware department of natural resources/i, "Delaware DNREC", "https://dnrec.delaware.gov/"],
  [/nc department of parks|north carolina (division|department) of parks/i, "North Carolina State Parks", "https://www.ncparks.gov/"],
  [/nebraska game and parks/i, "Nebraska Game and Parks", "https://outdoornebraska.gov/"],
  [/los angeles county department of parks|la county department of parks/i, "LA County Parks", "https://parks.lacounty.gov/"],
  [/kentucky state parks/i, "Kentucky State Parks", "https://parks.ky.gov/"],
  [/forest preserve district of cook county/i, "Forest Preserves of Cook County", "https://fpdcc.com/"],
  [/missouri department of conservation/i, "Missouri Department of Conservation", "https://mdc.mo.gov/"],
  [/arkansas game and fish/i, "Arkansas Game and Fish Commission", "https://www.agfc.com/"],
  [/alabama department of conservation/i, "Alabama DCNR", "https://www.outdooralabama.com/"],
  [/city of toronto/i, "City of Toronto", "https://www.toronto.ca/"],
];

export interface LandManager { name: string; url: string | null }

const http = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

/** Who manages the trail, with an official link when one is known; null when nothing reliable is recorded. */
export function landManager(t: Pick<CatalogTrail, "park" | "forest" | "blmArea" | "manager" | "officialUrl" | "sourceUrl" | "source" | "sourceType" | "osm">): LandManager | null {
  // "United States National Park Service;North Country Trail Association": the first is the land manager.
  const first = t.manager?.split(/\s*;\s*/)[0]?.trim();
  const manager = first && !GIS_PUBLISHER.test(first) ? first : null;
  const place = t.park ?? t.forest ?? (t.blmArea && !/^blm\s+[a-z]{2}$/i.test(t.blmArea) ? t.blmArea : null);
  const name = place ?? manager;
  const agencyRecord = t.sourceType === "NPS_OFFICIAL" || t.sourceType === "USFS_OFFICIAL" || t.sourceType === "BLM_OFFICIAL" ? http(t.sourceUrl) : null;
  const own = http(t.officialUrl) ?? http(t.osm?.website) ?? agencyRecord;
  if (name && own) return { name, url: own };
  for (const candidate of [manager, place]) {
    if (!candidate) continue;
    const hit = AGENCY_SITES.find(([re]) => re.test(candidate));
    // Name the agency the link goes to, not the forest, so the link says where it leads.
    if (hit) return { name: hit[1], url: hit[2] };
  }
  return name ? { name, url: null } : null;
}
