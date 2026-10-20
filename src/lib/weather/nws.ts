/**
 * NWS weather via api.weather.gov (no API key; User-Agent required). Covers the U.S. only.
 */
import type { WeatherForecast, WeatherPeriod } from "./types";

export type { WeatherForecast, WeatherPeriod } from "./types";

const NWS_BASE = "https://api.weather.gov";
const USER_AGENT = "Hyked-TrailPlatform/1.0 (https://github.com/tackleguy/health)";
const HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };

interface NwsPointsResponse {
  properties?: {
    forecast?: string;
    forecastGridData?: string;
  };
}

interface NwsPeriod {
  name?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  shortForecast?: string;
  probabilityOfPrecipitation?: { value?: number | null };
}

interface NwsForecastResponse {
  properties?: { periods?: NwsPeriod[] };
}

export async function fetchNwsForecast(lat: number, lng: number): Promise<WeatherForecast> {
  const roundedLat = Math.round(lat * 10000) / 10000;
  const roundedLng = Math.round(lng * 10000) / 10000;

  const pointsRes = await fetch(`${NWS_BASE}/points/${roundedLat},${roundedLng}`, {
    headers: HEADERS,
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(8000),
  });
  if (!pointsRes.ok) throw new Error(`NWS points lookup failed: ${pointsRes.status}`);

  const points = (await pointsRes.json()) as NwsPointsResponse;
  const forecastUrl = points.properties?.forecast;
  if (!forecastUrl) throw new Error("NWS did not return a forecast URL for this location");

  const forecastRes = await fetch(forecastUrl, {
    headers: HEADERS,
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(8000),
  });
  if (!forecastRes.ok) throw new Error(`NWS forecast fetch failed: ${forecastRes.status}`);

  const forecast = (await forecastRes.json()) as NwsForecastResponse;
  const periods = dailyPeriods(forecast.properties?.periods ?? []);
  if (periods.length === 0) throw new Error("NWS returned no forecast periods");

  return {
    source: "nws",
    gridPoint: { lat: roundedLat, lng: roundedLng },
    forecastUrl,
    periods,
    attribution: { label: "U.S. National Weather Service", url: "https://www.weather.gov" },
    disclaimer: "Verify at weather.gov before backcountry travel.",
  };
}

/** Pairs each NWS daytime period with the night after it, giving up to 7 days of high/low. */
function dailyPeriods(raw: NwsPeriod[]): WeatherPeriod[] {
  const days: WeatherPeriod[] = [];
  for (let i = 0; i < raw.length && days.length < 7; i++) {
    const period = raw[i];
    const temperature = period.temperatureUnit === "F" ? period.temperature : undefined;
    const chance = period.probabilityOfPrecipitation?.value ?? undefined;
    if (period.isDaytime === false) {
      days.push({ name: period.name ?? "Tonight", lowF: temperature, windMph: parseWindMph(period.windSpeed), precipitationChance: chance, shortForecast: period.shortForecast ?? "" });
      continue;
    }
    const night = raw[i + 1]?.isDaytime === false ? raw[++i] : undefined;
    const nightChance = night?.probabilityOfPrecipitation?.value ?? undefined;
    days.push({
      name: period.name ?? "Day",
      temperatureF: temperature,
      lowF: night?.temperatureUnit === "F" ? night.temperature : undefined,
      windMph: parseWindMph(period.windSpeed),
      precipitationChance: chance === undefined && nightChance === undefined ? undefined : Math.max(chance ?? 0, nightChance ?? 0),
      shortForecast: period.shortForecast ?? "",
    });
  }
  return days;
}

function parseWindMph(windSpeed?: string): number | undefined {
  if (!windSpeed) return undefined;
  const speeds = windSpeed.match(/\d+/g);
  return speeds ? Math.max(...speeds.map(Number)) : undefined;
}
