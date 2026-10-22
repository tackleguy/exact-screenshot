import test from "node:test";
import assert from "node:assert/strict";
import { cellBounds, cellFile, cellKeyOf, cellRef, lookupShard, pinCell } from "./static-data";
import { countryName } from "./types";

test("cell refs name the U.S./Canada file and the per-country worldwide files", () => {
  const key = pinCell(11.39, 47.26); // Innsbruck
  assert.equal(key, "95_68");
  assert.deepEqual(cellBounds(key), [10, 46, 12, 48]);
  assert.equal(cellFile(key), "cell-95_68.json.gz");
  assert.equal(cellFile(cellRef(key, "AT")), "cell-95_68-AT.json.gz");
  assert.equal(cellKeyOf(cellRef(key, "AT")), key);
});

test("lookup shards are stable two-digit hex names", () => {
  assert.match(lookupShard("osm-r123"), /^[0-9a-f]{2}$/);
  assert.equal(lookupShard("osm-r123"), lookupShard("osm-r123"));
  const shards = new Set(Array.from({ length: 2000 }, (_, i) => lookupShard(`osm-w${i}`)));
  assert.ok(shards.size > 200, "ids spread over the shards");
});

test("every ISO country code gets an English name", () => {
  assert.equal(countryName("US"), "United States");
  assert.equal(countryName("DE"), "Germany");
  assert.equal(countryName("JP"), "Japan");
  assert.equal(countryName("??"), "??");
});
