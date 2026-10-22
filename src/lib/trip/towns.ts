import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseTowns, type Town } from "./towns-core";

export * from "./towns-core";
export { SERVICE_LABELS } from "./services";
export type { ServiceKey, TownServices } from "./services";

let townsPromise: Promise<Town[]> | null = null;
export function loadTowns() {
  townsPromise ??= readFile(path.join(process.cwd(), "data/towns/towns.json.gz"))
    .then((raw) => parseTowns(JSON.parse(gunzipSync(raw).toString())))
    .catch((error) => { townsPromise = null; throw error; });
  return townsPromise;
}
