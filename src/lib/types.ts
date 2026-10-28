export type ActivityType = "run" | "hike" | "bike" | "ski";
export type ActivityStatus = "recording" | "completed";
export type Difficulty = "easy" | "moderate" | "hard" | "expert";
export type MapMode = "trail" | "ski";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  brief_bio: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Park {
  id: string;
  park_name: string;
  description: string;
  acreage: number;
  contact: string | null;
  country: string;
  state: string;
  latitude: number;
  longitude: number;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Trail {
  id: string;
  park_id: string;
  trail_name: string;
  description: string;
  difficulty: Difficulty;
  length_miles: number;
  elevation_ft: number;
  duration: string | null;
  route_type: string;
  latitude: number;
  longitude: number;
  image_url: string | null;
  avg_rating: number;
  review_count: number;
  community_difficulty?: Difficulty | null;
  difficulty_rating_count?: number;
  created_at: string;
  updated_at: string;
  geometry?: GeoLineString | null;
  /** Every mapped section of a trail merged from several source sections. */
  segments?: GeoLineString[] | null;
  start_latitude?: number | null;
  start_longitude?: number | null;
  end_latitude?: number | null;
  end_longitude?: number | null;
  elevation_loss_ft?: number | null;
  highest_point_ft?: number | null;
  lowest_point_ft?: number | null;
  trail_type?: string | null;
  surface?: string | null;
  allows_hiking?: boolean;
  allows_backpacking?: boolean;
  allows_biking?: boolean;
  allows_horseback?: boolean;
  allows_dogs?: boolean | null;
  seasonal_information?: string | null;
  official_source?: string | null;
  confidence_score?: ConfidenceLevel;
  elevation_profile?: ElevationSample[] | null;
  distance_m?: number;
  distance_km?: number;
  park?: Park;
}

export interface Review {
  id: string;
  trail_id: string;
  user_id: string;
  rating: number;
  /** Hiker-rated difficulty; averages into community_difficulty after 5 ratings. */
  difficulty?: Difficulty | null;
  body: string | null;
  review_date: string;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export type ConfidenceLevel =
  | "verified"
  | "source_reported"
  | "inferred"
  | "unknown";

export interface GeoLineString {
  type: "LineString";
  coordinates: [number, number, number?][];
  /**
   * Which stretches GPS didn't measure (see src/lib/route-provenance.ts). A GeoJSON "foreign member": readers that
   * don't know it still get a valid line, and routes saved before it existed have none (every stretch measured).
   */
  estimated?: RouteEstimates;
}

/** Estimated stretches of a recorded route: coordinate index ranges, and how much of the totals they make up. */
export interface RouteEstimates {
  version: 1;
  /** [from, to, kind]: the line from coordinates[from] to coordinates[to] was "trail" (placed along the followed
   * trail) or "direct" (two fixes joined in a straight line) instead of measured. */
  ranges: [number, number, "trail" | "direct"][];
  /** Estimated part of the saved distance, in meters, and of the climb, in feet. */
  meters: number;
  gainFt: number;
}

export interface ElevationSample {
  distance_m: number;
  elevation_m?: number;
  elevation_ft?: number;
}

export interface TrailPhoto {
  id: string;
  trail_id: string;
  url: string;
  thumbnail_url: string | null;
  caption: string | null;
  photographer: string | null;
  license: string;
  license_url: string | null;
  attribution: string;
  source_name: string;
  source_url: string | null;
  is_hero: boolean;
  is_disabled: boolean;
  sort_order: number;
}

export interface TrailPointOfInterest {
  id: string;
  name: string | null;
  latitude: number;
  longitude: number;
  confidence_score: ConfidenceLevel;
}

export interface Campsite extends TrailPointOfInterest {
  campsite_type: string | null;
  capacity: number | null;
  seasonal_information: string | null;
}

export interface WaterSource extends TrailPointOfInterest {
  water_type: string | null;
  seasonal_information: string | null;
  treatment_required: boolean | null;
}

export interface Trailhead extends TrailPointOfInterest {
  parking_info: string | null;
  fees: string | null;
  access_notes: string | null;
  restrooms: boolean | null;
  accessibility_notes: string | null;
}

export interface TrailFilters {
  q?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  difficulty?: Difficulty;
  minLengthMiles?: number;
  maxLengthMiles?: number;
  minElevationFt?: number;
  maxElevationFt?: number;
  dogFriendly?: boolean;
  limit?: number;
}

export interface Activity {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  status: ActivityStatus;
  title: string;
  distance_m: number;
  duration_sec: number;
  elevation_gain_ft: number;
  route_geojson: GeoLineString | null;
  trail_id: string | null;
  ski_area_id: string | null;
  ski_area_name: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  trail?: Trail;
}

export interface GpsPoint {
  lat: number;
  lng: number;
  altitude: number | null;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  /** The stretch arriving at this point wasn't measured by GPS (filled along the trail, or a direct join). */
  estimated?: "trail" | "direct";
}

export interface MapMarker {
  id: string;
  type: "park" | "trail" | "resort" | "trailhead";
  name: string;
  latitude: number;
  longitude: number;
  subtitle?: string;
  href: string;
  /** When set, render as a compact cluster pin instead of a trail pin. */
  clusterCount?: number;
}

export interface SearchResult {
  id: string;
  type: "park" | "trail" | "resort";
  name: string;
  subtitle: string;
  href: string;
}

export const ACTIVITY_ICONS: Record<ActivityType, string> = {
  run: "🏃",
  hike: "🥾",
  bike: "🚴",
  ski: "⛷",
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  run: "Run",
  hike: "Hike",
  bike: "Bike",
  ski: "Ski",
};
