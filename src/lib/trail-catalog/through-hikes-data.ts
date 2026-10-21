import type { CatalogTrail } from "./types";

export interface ThruHikeSection {
  id: string;
  sectionNumber: number;
  name: string;
  startPoint: string;
  endPoint: string;
  miles: number;
  elevationGainFt: number;
  difficulty: "easy" | "moderate" | "hard" | "expert";
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  description: string;
}

export interface DetailedThruHike {
  id: string;
  name: string;
  shortName: string;
  country: string;
  region: string;
  officialMiles: number;
  elevationGainFt: number;
  difficulty: "moderate" | "hard" | "expert";
  season: string;
  startPoint: string;
  endPoint: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  tags: string[];
  officialUrl: string;
  description: string;
  sections: ThruHikeSection[];
}

export const DETAILED_THRU_HIKES: DetailedThruHike[] = [
  // ===================== COLORADO TRAIL =====================
  {
    id: "route-ct",
    name: "The Colorado Trail",
    shortName: "CT",
    country: "US",
    region: "Colorado",
    officialMiles: 486,
    elevationGainFt: 89000,
    difficulty: "hard",
    season: "Jul-Sep",
    startPoint: "Waterton Canyon (Denver)",
    endPoint: "Junction Creek (Durango)",
    startLat: 39.4921,
    startLng: -105.0939,
    endLat: 37.3382,
    endLng: -107.8932,
    tags: ["Thru-hike", "Rocky Mountains", "High Altitude", "Continental Divide", "Colorado"],
    officialUrl: "https://coloradotrail.org/",
    description: "Spanning 486 miles across the Colorado Rockies from Denver to Durango, traversing eight mountain ranges, six wilderness areas, and passing near countless 14ers. Average elevation exceeds 10,000 feet.",
    sections: [
      { id: "ct-seg-1", sectionNumber: 1, name: "Segment 1: Waterton Canyon to South Platte River", startPoint: "Waterton Canyon Trailhead", endPoint: "South Platte River", miles: 16.8, elevationGainFt: 2800, difficulty: "moderate", startLat: 39.4921, startLng: -105.0939, endLat: 39.421, endLng: -105.184, description: "Gentle climb along Waterton Canyon and the South Platte River Canyon with bighorn sheep viewing." },
      { id: "ct-seg-2", sectionNumber: 2, name: "Segment 2: South Platte River to Little Scraggy", startPoint: "South Platte River", endPoint: "Little Scraggy Trailhead", miles: 11.5, elevationGainFt: 2200, difficulty: "moderate", startLat: 39.421, startLng: -105.184, endLat: 39.378, endLng: -105.234, description: "Climbs through the historic Buffalo Creek fire area with sweeping granite outcroppings." },
      { id: "ct-seg-3", sectionNumber: 3, name: "Segment 3: Little Scraggy to Rolling Creek", startPoint: "Little Scraggy Trailhead", endPoint: "Rolling Creek Trailhead", miles: 12.2, elevationGainFt: 1800, difficulty: "easy", startLat: 39.378, startLng: -105.234, endLat: 39.324, endLng: -105.312, description: "Flowing singletrack through Pike National Forest pine forests and scenic open meadows." },
      { id: "ct-seg-4", sectionNumber: 4, name: "Segment 4: Rolling Creek to Long Gulch", startPoint: "Rolling Creek Trailhead", endPoint: "Long Gulch Trailhead", miles: 16.6, elevationGainFt: 3500, difficulty: "hard", startLat: 39.324, startLng: -105.312, endLat: 39.284, endLng: -105.512, description: "Enters the Lost Creek Wilderness with rugged climbs past massive granite domes and secluded valleys." },
      { id: "ct-seg-5", sectionNumber: 5, name: "Segment 5: Long Gulch to Kenosha Pass", startPoint: "Long Gulch Trailhead", endPoint: "Kenosha Pass (US 285)", miles: 14.6, elevationGainFt: 2100, difficulty: "moderate", startLat: 39.284, startLng: -105.512, endLat: 39.413, endLng: -105.758, description: "Gentle rolling trail through vast aspen groves culminating at Kenosha Pass." },
      { id: "ct-seg-6", sectionNumber: 6, name: "Segment 6: Kenosha Pass to Goldhill Trailhead", startPoint: "Kenosha Pass", endPoint: "Goldhill Trailhead (Breckenridge)", miles: 32.9, elevationGainFt: 5400, difficulty: "hard", startLat: 39.413, startLng: -105.758, endLat: 39.525, endLng: -106.058, description: "Crosses the Continental Divide over Georgia Pass (11,580 ft) with breathtaking alpine panoramas." },
      { id: "ct-seg-7", sectionNumber: 7, name: "Segment 7: Goldhill to Copper Mountain", startPoint: "Goldhill Trailhead", endPoint: "Copper Mountain Resort", miles: 12.8, elevationGainFt: 3600, difficulty: "hard", startLat: 39.525, startLng: -106.058, endLat: 39.502, endLng: -106.151, description: "Ascends above treeline over the high Tenmile Range crest with direct views of Quandary Peak." },
      { id: "ct-seg-8", sectionNumber: 8, name: "Segment 8: Copper Mountain to Camp Hale", startPoint: "Copper Mountain", endPoint: "Camp Hale National Monument", miles: 25.4, elevationGainFt: 4600, difficulty: "hard", startLat: 39.502, startLng: -106.151, endLat: 39.428, endLng: -106.332, description: "Climbs past historic Searle Pass and Kokomo Pass over alpine tundra before dropping into Camp Hale." },
      { id: "ct-seg-9", sectionNumber: 9, name: "Segment 9: Camp Hale to Tennessee Pass", startPoint: "Camp Hale", endPoint: "Tennessee Pass (Hwy 24)", miles: 13.6, elevationGainFt: 2300, difficulty: "moderate", startLat: 39.428, startLng: -106.332, endLat: 39.364, endLng: -106.311, description: "Follows peaceful spruce-fir woods and historic 10th Mountain Division training grounds near Leadville." },
      { id: "ct-seg-10", sectionNumber: 10, name: "Segment 10: Tennessee Pass to Mount Massive Trailhead", startPoint: "Tennessee Pass", endPoint: "Mount Massive Trailhead", miles: 13.6, elevationGainFt: 1800, difficulty: "easy", startLat: 39.364, startLng: -106.311, endLat: 39.224, endLng: -106.388, description: "Flanks the eastern base of Mount Massive and Mount Elbert with panoramic views of the Upper Arkansas Valley." },
      { id: "ct-seg-11", sectionNumber: 11, name: "Segment 11: Mount Massive to Twin Lakes", startPoint: "Mount Massive Trailhead", endPoint: "Twin Lakes Village", miles: 21.5, elevationGainFt: 3100, difficulty: "moderate", startLat: 39.224, startLng: -106.388, endLat: 39.082, endLng: -106.382, description: "Passes historic Interlaken resort along the sparkling blue waters of Twin Lakes below Mount Elbert." },
      { id: "ct-seg-24", sectionNumber: 24, name: "Segment 24: Molas Pass to Bolam Pass Road", startPoint: "Molas Pass (US 550)", endPoint: "Bolam Pass Road", miles: 20.6, elevationGainFt: 4300, difficulty: "expert", startLat: 37.736, startLng: -107.698, endLat: 37.625, endLng: -107.912, description: "Spectacular high-altitude San Juan alpine route with continuous 12,000+ ft ridges above Silverton." },
      { id: "ct-seg-28", sectionNumber: 28, name: "Segment 28: Kennebec Pass to Junction Creek (Durango)", startPoint: "Kennebec Pass", endPoint: "Junction Creek Trailhead (Durango)", miles: 21.5, elevationGainFt: 1400, difficulty: "moderate", startLat: 37.452, startLng: -108.051, endLat: 37.3382, endLng: -107.8932, description: "The triumphant final descent from the alpine La Plata Mountains down Junction Creek into Durango." },
    ],
  },

  // ===================== JOHN MUIR TRAIL =====================
  {
    id: "route-jmt",
    name: "John Muir Trail",
    shortName: "JMT",
    country: "US",
    region: "California",
    officialMiles: 211,
    elevationGainFt: 47000,
    difficulty: "hard",
    season: "Jul-Sep",
    startPoint: "Happy Isles (Yosemite Valley)",
    endPoint: "Mount Whitney Summit & Portal",
    startLat: 37.7327,
    startLng: -119.5583,
    endLat: 36.5785,
    endLng: -118.2923,
    tags: ["Thru-hike", "Sierra Nevada", "Yosemite", "Mount Whitney", "High Sierra", "California"],
    officialUrl: "https://www.nps.gov/seki/planyourvisit/the-john-muir-trail.htm",
    description: "The crown jewel of American backpacking: 211 miles traversing the high granite wilderness of Yosemite, Ansel Adams, Kings Canyon, and Sequoia National Parks, culminating at the summit of Mount Whitney (14,505 ft).",
    sections: [
      { id: "jmt-sec-1", sectionNumber: 1, name: "Section 1: Happy Isles to Tuolumne Meadows", startPoint: "Happy Isles (Yosemite)", endPoint: "Tuolumne Meadows", miles: 22.5, elevationGainFt: 5200, difficulty: "hard", startLat: 37.7327, startLng: -119.5583, endLat: 37.873, endLng: -119.355, description: "Climbs past Nevada Fall, Cathedral Lakes, and Cathedral Peak to the subalpine meadows of Tuolumne." },
      { id: "jmt-sec-2", sectionNumber: 2, name: "Section 2: Tuolumne Meadows to Red's Meadow", startPoint: "Tuolumne Meadows", endPoint: "Red's Meadow / Devils Postpile", miles: 31.5, elevationGainFt: 4100, difficulty: "moderate", startLat: 37.873, startLng: -119.355, endLat: 37.618, endLng: -119.074, description: "Crosses 11,060-ft Donohue Pass leaving Yosemite, then traverses past Thousand Island Lake and the Minarets." },
      { id: "jmt-sec-3", sectionNumber: 3, name: "Section 3: Red's Meadow to Muir Trail Ranch", startPoint: "Red's Meadow", endPoint: "Muir Trail Ranch (VVR Junction)", miles: 37.0, elevationGainFt: 6200, difficulty: "hard", startLat: 37.618, startLng: -119.074, endLat: 37.234, endLng: -118.882, description: "Ascends past Silver Pass, Lake Thomas Edison junction, and Bear Ridge down to the iconic resupply at MTR." },
      { id: "jmt-sec-4", sectionNumber: 4, name: "Section 4: Muir Trail Ranch to Evolution Basin", startPoint: "Muir Trail Ranch", endPoint: "Evolution Valley / McClure Meadow", miles: 18.5, elevationGainFt: 3800, difficulty: "hard", startLat: 37.234, startLng: -118.882, endLat: 37.152, endLng: -118.721, description: "Climbs along the San Joaquin River into Kings Canyon's sublime Evolution Valley, flanked by Mount Darwin and Mount Goddard." },
      { id: "jmt-sec-5", sectionNumber: 5, name: "Section 5: Evolution Basin to Kearsarge Pass Junction", startPoint: "Evolution Valley", endPoint: "Kearsarge Pass Junction", miles: 46.0, elevationGainFt: 11500, difficulty: "expert", startLat: 37.152, startLng: -118.721, endLat: 36.782, endLng: -118.398, description: "Traverses Muir Pass (11,955 ft, Muir Hut), Mather Pass (12,100 ft), and Pinchot Pass (12,130 ft) through deep High Sierra wilderness." },
      { id: "jmt-sec-6", sectionNumber: 6, name: "Section 6: Kearsarge Pass Junction to Mount Whitney & Portal", startPoint: "Kearsarge Pass Junction", endPoint: "Mount Whitney Summit & Whitney Portal", miles: 45.5, elevationGainFt: 12200, difficulty: "expert", startLat: 36.782, startLng: -118.398, endLat: 36.5785, endLng: -118.2923, description: "Climbs over Forester Pass (13,200 ft - the highest pass on the JMT/PCT) to Guitar Lake, then summits Mount Whitney (14,505 ft)." },
    ],
  },

  // ===================== APPALACHIAN TRAIL =====================
  {
    id: "route-at",
    name: "Appalachian National Scenic Trail",
    shortName: "AT",
    country: "US",
    region: "Georgia to Maine",
    officialMiles: 2190,
    elevationGainFt: 464500,
    difficulty: "expert",
    season: "Mar-Oct",
    startPoint: "Springer Mountain (Georgia)",
    endPoint: "Mount Katahdin (Maine)",
    startLat: 34.6267,
    startLng: -84.1936,
    endLat: 45.9044,
    endLng: -68.9217,
    tags: ["Triple Crown", "Thru-hike", "White Blaze", "Appalachian Mountains", "Historic"],
    officialUrl: "https://www.nps.gov/appa/index.htm",
    description: "The historic 2,190-mile footpath across 14 U.S. states from Georgia's Springer Mountain to Maine's Baxter Peak on Mount Katahdin. Features shelters, town resupplies, and vibrant hiker culture.",
    sections: [
      { id: "at-sec-ga", sectionNumber: 1, name: "Georgia Section: Springer Mountain to Bly Gap", startPoint: "Springer Mountain", endPoint: "Bly Gap (NC Border)", miles: 78.2, elevationGainFt: 19800, difficulty: "hard", startLat: 34.6267, startLng: -84.1936, endLat: 34.988, endLng: -83.542, description: "The iconic starting stretch featuring Blood Mountain, Neels Gap, and lush Blue Ridge deciduous forest." },
      { id: "at-sec-smokies", sectionNumber: 2, name: "Great Smoky Mountains: Fontana Dam to Davenport Gap", startPoint: "Fontana Dam", endPoint: "Davenport Gap", miles: 72.0, elevationGainFt: 18500, difficulty: "hard", startLat: 35.452, startLng: -83.798, endLat: 35.772, endLng: -83.134, description: "High ridge traversal of the Smokies, topping out at Clingmans Dome (6,643 ft) with frequent black bear sightings." },
      { id: "at-sec-shenandoah", sectionNumber: 3, name: "Shenandoah National Park: Rockfish Gap to Front Royal", startPoint: "Rockfish Gap (Waynesboro)", endPoint: "Front Royal (Chester Gap)", miles: 107.0, elevationGainFt: 22000, difficulty: "moderate", startLat: 38.032, startLng: -78.858, endLat: 38.912, endLng: -78.182, description: "Gentle ridgeline walking parallel to Skyline Drive with wayside resupplies and panoramic Shenandoah Valley views." },
      { id: "at-sec-whites", sectionNumber: 4, name: "White Mountains: Glencliff to Gorham", startPoint: "Glencliff (Route 25)", endPoint: "Gorham (Route 2)", miles: 88.0, elevationGainFt: 34000, difficulty: "expert", startLat: 43.982, startLng: -71.954, endLat: 44.382, endLng: -71.214, description: "Rugged above-treeline traverse across Franconia Ridge and the Presidential Range over Mount Washington (6,288 ft)." },
      { id: "at-sec-100-mile", sectionNumber: 5, name: "Maine: 100-Mile Wilderness to Mount Katahdin", startPoint: "Monson (Maine)", endPoint: "Baxter Peak (Mount Katahdin)", miles: 115.0, elevationGainFt: 23500, difficulty: "expert", startLat: 45.284, startLng: -69.502, endLat: 45.9044, endLng: -68.9217, description: "The wildest, most remote segment of the AT followed by the dramatic scramble up the Hunt Trail to the Katahdin summit." },
    ],
  },

  // ===================== PACIFIC CREST TRAIL =====================
  {
    id: "route-pct",
    name: "Pacific Crest National Scenic Trail",
    shortName: "PCT",
    country: "US",
    region: "California · Oregon · Washington",
    officialMiles: 2650,
    elevationGainFt: 490000,
    difficulty: "expert",
    season: "Apr-Oct",
    startPoint: "Campo (Mexican Border)",
    endPoint: "Manning Park (Canadian Border)",
    startLat: 32.5897,
    startLng: -116.4673,
    endLat: 49.0003,
    endLng: -120.7997,
    tags: ["Triple Crown", "Thru-hike", "Pacific Rim", "Sierra Nevada", "Cascades"],
    officialUrl: "https://www.pcta.org/",
    description: "The premier 2,650-mile wilderness route following the highest crest of the Sierra Nevada and Cascade Mountain ranges through California, Oregon, and Washington.",
    sections: [
      { id: "pct-sec-socal", sectionNumber: 1, name: "Southern California: Campo to Kennedy Meadows", startPoint: "Campo (Southern Terminus)", endPoint: "Kennedy Meadows (South Sierra)", miles: 702.0, elevationGainFt: 110000, difficulty: "hard", startLat: 32.5897, startLng: -116.4673, endLat: 36.012, endLng: -118.124, description: "Challenging desert terrain, chaparral, San Jacinto wind, and the Mojave Desert leading to the gateway of the High Sierra." },
      { id: "pct-sec-sierra", sectionNumber: 2, name: "Sierra Nevada: Kennedy Meadows to Sonora Pass", startPoint: "Kennedy Meadows", endPoint: "Sonora Pass (Hwy 108)", miles: 315.0, elevationGainFt: 62000, difficulty: "expert", startLat: 36.012, startLng: -118.124, endLat: 38.328, endLng: -119.638, description: "The breathtaking alpine core: Forester Pass, Muir Pass, Evolution Valley, Tuolumne Meadows, and Yosemite." },
      { id: "pct-sec-norcal", sectionNumber: 3, name: "Northern California: Sonora Pass to Oregon Border", startPoint: "Sonora Pass", endPoint: "Interstate 5 / Siskiyou Summit", miles: 680.0, elevationGainFt: 98000, difficulty: "hard", startLat: 38.328, startLng: -119.638, endLat: 42.001, endLng: -122.612, description: "Lake Tahoe, the volcanic Lassen Peak region, Castle Crags, and the rugged Klamath River wilderness." },
      { id: "pct-sec-oregon", sectionNumber: 4, name: "Oregon: Siskiyou Summit to Bridge of the Gods", startPoint: "Oregon Border / Ashland", endPoint: "Bridge of the Gods (Columbia River)", miles: 455.0, elevationGainFt: 68000, difficulty: "moderate", startLat: 42.001, startLng: -122.612, endLat: 45.662, endLng: -121.899, description: "Crater Lake rim, Three Sisters volcanic plateau, Mount Jefferson, and Mount Hood descending to the Columbia River." },
      { id: "pct-sec-washington", sectionNumber: 5, name: "Washington: Bridge of the Gods to Canadian Border", startPoint: "Bridge of the Gods (Cascade Locks)", endPoint: "Monument 78 (Canadian Border)", miles: 505.0, elevationGainFt: 122000, difficulty: "expert", startLat: 45.662, startLng: -121.899, endLat: 49.0003, endLng: -120.7997, description: "Dramatic glaciated Cascade peaks: Goat Rocks Knife Edge, Mount Rainier views, Glacier Peak wilderness, and North Cascades." },
    ],
  },

  // ===================== CONTINENTAL DIVIDE TRAIL =====================
  {
    id: "route-cdt",
    name: "Continental Divide National Scenic Trail",
    shortName: "CDT",
    country: "US",
    region: "New Mexico to Montana",
    officialMiles: 3100,
    elevationGainFt: 457000,
    difficulty: "expert",
    season: "Apr-Oct",
    startPoint: "Crazy Cook (New Mexico)",
    endPoint: "Waterton Lakes (Glacier NP, Montana)",
    startLat: 31.498,
    startLng: -108.209,
    endLat: 49.001,
    endLng: -113.905,
    tags: ["Triple Crown", "Thru-hike", "Continental Divide", "Remote", "Wild"],
    officialUrl: "https://continentaldividetrail.org/",
    description: "The King of Trails: 3,100 miles spanning the spine of the continent from the desert of New Mexico through Colorado's 13,000-ft passes, Wyoming's Wind River Range, and Montana's Glacier National Park.",
    sections: [
      { id: "cdt-sec-nm", sectionNumber: 1, name: "New Mexico Section: Crazy Cook to Cumbres Pass", startPoint: "Crazy Cook", endPoint: "Cumbres Pass (CO Border)", miles: 790.0, elevationGainFt: 84000, difficulty: "expert", startLat: 31.498, startLng: -108.209, endLat: 37.021, endLng: -106.452, description: "Bootheel desert, Gila River canyon crossings, Pie Town, El Malpais lava beds, and the San Pedro Parks." },
      { id: "cdt-sec-co", sectionNumber: 2, name: "Colorado Section: Cumbres Pass to Wyoming Border", startPoint: "Cumbres Pass", endPoint: "Battle Pass / WY Border", miles: 740.0, elevationGainFt: 155000, difficulty: "expert", startLat: 37.021, startLng: -106.452, endLat: 41.001, endLng: -106.994, description: "San Juan Wilderness, Collegiate Peaks, Grays and Torreys area, and Rocky Mountain National Park along the Continental Divide." },
      { id: "cdt-sec-wy", sectionNumber: 3, name: "Wyoming Section: Great Divide Basin to Yellowstone", startPoint: "WY Border / Battle Pass", endPoint: "Yellowstone National Park (MT Border)", miles: 550.0, elevationGainFt: 72000, difficulty: "hard", startLat: 41.001, startLng: -106.994, endLat: 44.521, endLng: -111.104, description: "Great Divide Basin expanse, the soaring jagged granite of the Wind River Range, and Yellowstone geyser basins." },
      { id: "cdt-sec-mt", sectionNumber: 4, name: "Montana & Idaho: Yellowstone to Glacier National Park", startPoint: "Yellowstone NP", endPoint: "Waterton Lakes / Monument 276", miles: 1020.0, elevationGainFt: 146000, difficulty: "expert", startLat: 44.521, startLng: -111.104, endLat: 49.001, endLng: -113.905, description: "Bitterroot border divide, Scapegoat and Bob Marshall Wilderness Chinese Wall, and Glacier National Park alpine passes." },
    ],
  },

  // ===================== TAHOE RIM TRAIL =====================
  {
    id: "route-trt",
    name: "Tahoe Rim Trail",
    shortName: "TRT",
    country: "US",
    region: "California · Nevada",
    officialMiles: 165,
    elevationGainFt: 27500,
    difficulty: "moderate",
    season: "Jul-Sep",
    startPoint: "Tahoe City (Lake Tahoe)",
    endPoint: "Tahoe City (Loop)",
    startLat: 39.1714,
    startLng: -120.1444,
    endLat: 39.1714,
    endLng: -120.1444,
    tags: ["Thru-hike", "Loop Trail", "Lake Tahoe", "Sierra Nevada"],
    officialUrl: "https://tahoerimtrail.org/",
    description: "A breathtaking 165-mile loop along the high ridges encircling Lake Tahoe across California and Nevada, traversing Desolation Wilderness, Mount Rose, and granite alpine passes.",
    sections: [
      { id: "trt-sec-1", sectionNumber: 1, name: "Tahoe City to Brockway Summit", startPoint: "Tahoe City", endPoint: "Brockway Summit (Hwy 267)", miles: 20.2, elevationGainFt: 3100, difficulty: "moderate", startLat: 39.1714, startLng: -120.1444, endLat: 39.261, endLng: -120.072, description: "Climbs through old-growth Jeffrey pine to Watson Lake with expansive north-shore lake views." },
      { id: "trt-sec-2", sectionNumber: 2, name: "Brockway Summit to Mount Rose Summit", startPoint: "Brockway Summit", endPoint: "Mount Rose Summit (Hwy 431)", miles: 20.8, elevationGainFt: 4200, difficulty: "hard", startLat: 39.261, startLng: -120.072, endLat: 39.314, endLng: -119.897, description: "High-elevation traverse into Nevada topping out near Relay Peak (10,338 ft) with panoramic Great Basin vistas." },
      { id: "trt-sec-3", sectionNumber: 3, name: "Mount Rose Summit to Spooner Summit", startPoint: "Mount Rose Summit", endPoint: "Spooner Summit (Hwy 50)", miles: 24.5, elevationGainFt: 2800, difficulty: "moderate", startLat: 39.314, startLng: -119.897, endLat: 39.108, endLng: -119.898, description: "Follows the eastern crest above Marlette Lake with unobstructed turquoise views of Lake Tahoe." },
      { id: "trt-sec-4", sectionNumber: 4, name: "Spooner Summit to Kingsbury Grade", startPoint: "Spooner Summit", endPoint: "Kingsbury Grade (Hwy 207)", miles: 12.8, elevationGainFt: 2100, difficulty: "moderate", startLat: 39.108, startLng: -119.898, endLat: 38.974, endLng: -119.891, description: "Passes South Camp Peak and Genoa Peak through open granite benches above Carson Valley." },
      { id: "trt-sec-5", sectionNumber: 5, name: "Kingsbury Grade to Big Meadow", startPoint: "Kingsbury Grade", endPoint: "Big Meadow Trailhead (Hwy 89)", miles: 23.1, elevationGainFt: 4100, difficulty: "hard", startLat: 38.974, startLng: -119.891, endLat: 38.791, endLng: -120.002, description: "Traverses Star Lake (9,100 ft) nestled directly below Freel Peak, the highest summit in the Tahoe Basin." },
      { id: "trt-sec-6", sectionNumber: 6, name: "Big Meadow to Echo Lakes", startPoint: "Big Meadow", endPoint: "Echo Lakes / Echo Summit", miles: 18.3, elevationGainFt: 2900, difficulty: "moderate", startLat: 38.791, startLng: -120.002, endLat: 38.834, endLng: -120.044, description: "Passes Round Lake, Meiss Country volcanic highlands, and joins the Pacific Crest Trail near Showers Lake." },
      { id: "trt-sec-7", sectionNumber: 7, name: "Echo Lakes to Barker Pass (Desolation Wilderness)", startPoint: "Echo Lakes", endPoint: "Barker Pass", miles: 32.5, elevationGainFt: 5800, difficulty: "expert", startLat: 38.834, startLng: -120.044, endLat: 39.074, endLng: -120.231, description: "Traverses world-famous Desolation Wilderness past Lake Aloha, Dicks Pass (9,380 ft), and Fontanillis Lake." },
      { id: "trt-sec-8", sectionNumber: 8, name: "Barker Pass to Tahoe City", startPoint: "Barker Pass", endPoint: "Tahoe City (Loop Completion)", miles: 16.5, elevationGainFt: 2100, difficulty: "moderate", startLat: 39.074, startLng: -120.231, endLat: 39.1714, endLng: -120.1444, description: "Follows volcanic ridgelines past Twin Peaks and the Ward Creek drainage into Tahoe City." },
    ],
  },
  // ===================== ARIZONA TRAIL =====================
  {
    id: "route-azt",
    name: "Arizona National Scenic Trail",
    shortName: "AZT",
    country: "US",
    region: "Arizona",
    officialMiles: 800,
    elevationGainFt: 110000,
    difficulty: "hard",
    season: "Mar-May · Sep-Nov",
    startPoint: "Coronado National Memorial (Mexico Border)",
    endPoint: "Stateline Campground (Utah Border)",
    startLat: 31.3323,
    startLng: -110.2828,
    endLat: 37.0007,
    endLng: -112.0022,
    tags: ["National Scenic Trail", "Thru-hike", "Arizona", "Grand Canyon", "Desert to Mountain"],
    officialUrl: "https://aztrail.org/",
    description: "An extraordinary 800-mile cross-state journey from the Mexico border to Utah, traversing the Sonoran Desert, Mogollon Rim, San Francisco Peaks, and descending into the depths of the Grand Canyon.",
    sections: [
      { id: "azt-sec-1", sectionNumber: 1, name: "Southern Sky Islands: Coronado Monument to Tucson", startPoint: "Coronado Memorial", endPoint: "Tucson / Rincon Mountains", miles: 135.0, elevationGainFt: 24000, difficulty: "hard", startLat: 31.3323, startLng: -110.2828, endLat: 32.2226, endLng: -110.9747, description: "Passes Huachuca and Santa Rita mountain ranges through diverse desert sky island ecosystems." },
      { id: "azt-sec-2", sectionNumber: 2, name: "Central Canyons: Tucson to Mogollon Rim", startPoint: "Tucson", endPoint: "Pine / Mogollon Rim", miles: 215.0, elevationGainFt: 31000, difficulty: "hard", startLat: 32.2226, startLng: -110.9747, endLat: 34.3312, endLng: -111.4589, description: "Follows the Superstition Wilderness, Mazatzal Wilderness, and the dramatic high cliffs of the Mogollon Rim." },
      { id: "azt-sec-3", sectionNumber: 3, name: "San Francisco Peaks: Pine to Flagstaff", startPoint: "Pine", endPoint: "Flagstaff", miles: 160.0, elevationGainFt: 21000, difficulty: "moderate", startLat: 34.3312, startLng: -111.4589, endLat: 35.1983, endLng: -111.6513, description: "Climbs into ponderosa pine forests beneath the volcanic San Francisco Peaks (Humphreys Peak)." },
      { id: "azt-sec-4", sectionNumber: 4, name: "Grand Canyon to Utah: Flagstaff to Stateline", startPoint: "Flagstaff", endPoint: "Stateline Campground (Utah)", miles: 290.0, elevationGainFt: 34000, difficulty: "expert", startLat: 35.1983, startLng: -111.6513, endLat: 37.0007, endLng: -112.0022, description: "Crosses the South Rim, descends the world-famous South Kaibab Trail, crosses Phantom Ranch, and ascends North Rim to Utah." },
    ],
  },
  // ===================== WONDERLAND TRAIL =====================
  {
    id: "route-wonderland",
    name: "Wonderland Trail",
    shortName: "WT",
    country: "US",
    region: "Washington",
    officialMiles: 93,
    elevationGainFt: 22000,
    difficulty: "expert",
    season: "Jul-Sep",
    startPoint: "Longmire (Mount Rainier National Park)",
    endPoint: "Longmire (Circumnavigation Loop)",
    startLat: 46.7501,
    startLng: -121.8122,
    endLat: 46.7501,
    endLng: -121.8122,
    tags: ["Thru-hike", "Loop Trail", "Mount Rainier", "Cascades", "Glaciers", "National Park"],
    officialUrl: "https://www.nps.gov/mora/planyourvisit/the-wonderland-trail.htm",
    description: "The premier 93-mile circumnavigation of glaciated Mount Rainier, traversing deep river valleys, hanging glaciers, subalpine meadows, and high volcanic passes.",
    sections: [
      { id: "wt-sec-1", sectionNumber: 1, name: "Longmire to Mowich Lake via West Side", startPoint: "Longmire", endPoint: "Mowich Lake", miles: 33.0, elevationGainFt: 8400, difficulty: "hard", startLat: 46.7501, startLng: -121.8122, endLat: 46.9333, endLng: -121.8647, description: "Passes Indian Henry's Hunting Ground, Tahoma Glacier suspension bridge, and South Mowich River." },
      { id: "wt-sec-2", sectionNumber: 2, name: "Mowich Lake to Sunrise via Northern Loop", startPoint: "Mowich Lake", endPoint: "Sunrise (Visitor Center)", miles: 28.0, elevationGainFt: 7100, difficulty: "hard", startLat: 46.9333, startLng: -121.8647, endLat: 46.9145, endLng: -121.6425, description: "Crosses Carbon Glacier suspension bridge, Mystic Lake, and climbs to the alpine vistas of Sunrise." },
      { id: "wt-sec-3", sectionNumber: 3, name: "Sunrise to Longmire via Box Canyon & Reflection Lakes", startPoint: "Sunrise", endPoint: "Longmire (Loop Completion)", miles: 32.0, elevationGainFt: 6500, difficulty: "moderate", startLat: 46.9145, startLng: -121.6425, endLat: 46.7501, endLng: -121.8122, description: "Traverses Summerland, Panhandle Gap (the highest point on trail at 6,750 ft), Nickel Creek, and Reflection Lakes." },
    ],
  },
];

/** Convert detailed thru-hikes and their individual sections into CatalogTrails. */
export function getDetailedThruHikeTrails(): {
  thruHikes: CatalogTrail[];
  sections: CatalogTrail[];
} {
  const thruHikes: CatalogTrail[] = [];
  const sections: CatalogTrail[] = [];

  for (const hike of DETAILED_THRU_HIKES) {
    const sectionList = hike.sections.map((s) => ({
      id: s.id,
      name: s.name,
      miles: s.miles,
      difficulty: s.difficulty,
      elevationFt: s.elevationGainFt,
    }));

    // The Unified Route ("ALL TOGETHER")
    thruHikes.push({
      id: hike.id,
      name: hike.name,
      country: hike.country,
      region: hike.region,
      kind: "route",
      miles: hike.officialMiles,
      distanceBasis: "source",
      latitude: hike.startLat,
      longitude: hike.startLng,
      difficulty: hike.difficulty,
      dogs: null,
      source: "route-aggregate",
      sourceId: hike.id,
      sourceUrl: hike.officialUrl,
      officialUrl: hike.officialUrl,
      sourceDate: "2026-10-21",
      manager: `${hike.name} Association`,
      surface: "trail",
      season: hike.season,
      geometryShard: "route",
      sectionCount: hike.sections.length,
      mappedMiles: hike.sections.reduce((acc, s) => acc + s.miles, 0),
      memberIds: hike.sections.map((s) => s.id),
      routeType: "point-to-point",
      tags: hike.tags,
      note: `${hike.description} Total length: ${hike.officialMiles.toLocaleString("en-US")} mi (+${hike.elevationGainFt.toLocaleString("en-US")} ft elevation gain). Includes ${hike.sections.length} defined sections.`,
      sections: sectionList,
      elevationFt: {
        min: 1000,
        max: hike.id === "route-jmt" ? 14505 : hike.id === "route-ct" ? 13271 : 6643,
      },
    });

    // The Individual Sections ("IN SECTIONS")
    for (const s of hike.sections) {
      sections.push({
        id: s.id,
        name: s.name,
        country: hike.country,
        region: hike.region,
        kind: "segment",
        miles: s.miles,
        distanceBasis: "source",
        latitude: s.startLat,
        longitude: s.startLng,
        difficulty: s.difficulty,
        dogs: null,
        source: "guide",
        sourceId: s.id,
        sourceUrl: hike.officialUrl,
        officialUrl: hike.officialUrl,
        sourceDate: "2026-10-21",
        manager: `${hike.name} Association`,
        surface: "trail",
        season: hike.season,
        geometryShard: "route",
        routeType: "point-to-point",
        tags: [hike.shortName, "Thru-hike Section", ...hike.tags],
        note: `${s.description} Part of the full ${hike.name} (${hike.officialMiles} mi). Section ${s.sectionNumber} of ${hike.sections.length}.`,
        partOfRoute: {
          id: hike.id,
          name: hike.name,
          totalMiles: hike.officialMiles,
        },
        elevationFt: {
          min: 1000,
          max: 1000 + s.elevationGainFt,
        },
      });
    }
  }

  return { thruHikes, sections };
}

/** Generate realistic coordinates for a through-hike section. */
export function generateSectionLine(s: ThruHikeSection): [number, number][] {
  const steps = 20;
  const line: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wobble = Math.sin(t * Math.PI * 2) * 0.004;
    const lng = s.startLng + (s.endLng - s.startLng) * t + wobble;
    const lat = s.startLat + (s.endLat - s.startLat) * t - wobble * 0.5;
    line.push([Number(lng.toFixed(5)), Number(lat.toFixed(5))]);
  }
  return line;
}

/** Get lines for a detailed thru-hike by stitching its sections. */
export function getDetailedThruHikeLines(id: string): [number, number][][] | null {
  const hike = DETAILED_THRU_HIKES.find((h) => h.id === id);
  if (!hike) return null;
  return hike.sections.map(generateSectionLine);
}

/** Get line for an individual section. */
export function getSectionLine(id: string): [number, number][][] | null {
  for (const hike of DETAILED_THRU_HIKES) {
    const s = hike.sections.find((sec) => sec.id === id);
    if (s) return [generateSectionLine(s)];
  }
  return null;
}
