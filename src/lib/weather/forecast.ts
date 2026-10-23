import { fetchNwsForecast } from "./nws";
import { fetchOpenMeteoForecast } from "./open-meteo";
import type { WeatherForecast } from "./types";

/** NWS where it has coverage (U.S.), otherwise the global Open-Meteo model. */
/** Rough box around the U.S. and its territories, where the National Weather Service has forecasts. */
const inNwsArea = (lat: number, lng: number) => lat > 13 && lat < 72 && ((lng > -180 && lng < -64) || lng > 144);

export async function fetchTrailWeather(lat: number, lng: number): Promise<WeatherForecast> {
  if (!inNwsArea(lat, lng)) return fetchOpenMeteoForecast(lat, lng);
  try {
    return await fetchNwsForecast(lat, lng);
  } catch {
    return fetchOpenMeteoForecast(lat, lng);
  }
}
