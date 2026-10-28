import { recordedLine } from "@/lib/route-provenance";
import { formatMeters, formatPace as unitsPace, formatSpeed as unitsSpeed } from "@/lib/units";
import type { GeoLineString, GpsPoint } from "@/lib/types";

const M_TO_MI = 0.000621371;
const MPS_TO_MPH = 2.23694;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function metersToMiles(m: number): number {
  return m * M_TO_MI;
}

export function mpsToMph(mps: number): number {
  return mps * MPS_TO_MPH;
}

export function smoothSpeed(currentAvg: number, newSpeed: number): number {
  return currentAvg * 0.75 + newSpeed * 0.25;
}

export function computeTrackStats(points: GpsPoint[]) {
  let distanceM = 0;
  let elevationGainFt = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    distanceM += haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);

    if (prev.altitude !== null && curr.altitude !== null) {
      const deltaFt = (curr.altitude - prev.altitude) * 3.28084;
      if (deltaFt > 0) elevationGainFt += deltaFt;
    }
  }

  const durationSec =
    points.length >= 2
      ? Math.max(
          1,
          Math.round(
            (points[points.length - 1].timestamp - points[0].timestamp) / 1000,
          ),
        )
      : 0;

  return { distanceM, elevationGainFt: Math.round(elevationGainFt), durationSec };
}

/**
 * The recorded line to save. Stretches GPS didn't measure (a gap bridged while the page was in the background) are
 * listed in its `estimated` member; see src/lib/route-provenance.ts.
 */
export function pointsToGeoJSON(points: GpsPoint[], estimatedGainFt = 0): GeoLineString {
  return recordedLine(points, estimatedGainFt);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** A recorded distance in meters, in the visitor's units (src/lib/units.ts). */
export function formatDistance(meters: number): string {
  return formatMeters(meters) ?? "0 ft";
}

/** Pace per mile or per km, in the visitor's units. */
export function formatPace(distanceM: number, durationSec: number): string {
  return unitsPace(distanceM, durationSec) ?? "—";
}

export function formatSpeed(mph: number): string {
  return unitsSpeed(mph) ?? "—";
}

export function formatCoordinate(value: number, isLat: boolean): string {
  const dir = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(5)}° ${dir}`;
}

export function computeHeading(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function avgSpeedMph(distanceM: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  const hours = durationSec / 3600;
  return metersToMiles(distanceM) / hours;
}

export function positionToPoint(position: GeolocationPosition): GpsPoint {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    altitude: position.coords.altitude,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed,
    heading: position.coords.heading,
    timestamp: position.timestamp,
  };
}
