import test from "node:test";
import assert from "node:assert/strict";
import { cellBounds, cellFile, cellKeyOf, cellRef, pinCell, rowShard, searchKey, SEARCH_STOPWORDS } from "./static-data";
import { countryName } from "./types";

test("cell refs name the U.S./Canada file and the per-country worldwide files", () => {
  const key = pinCell(11.39, 47.26); // Innsbruck
  assert.equal(key, "95_68");
  assert.deepEqual(cellBounds(key), [10, 46, 12, 48]);
  assert.equal(cellFile(key), "cell-95_68.json.gz");
  assert.equal(cellFile(cellRef(key, "AT")), "cell-95_68-AT.json.gz");
  assert.equal(cellKeyOf(cellRef(key, "AT")), key);
});

test("row shards are stable four-digit hex names", () => {
  assert.match(rowShard("osm-r123"), /^[0-9a-f]{4}$/);
  assert.equal(rowShard("osm-r123"), rowShard("osm-r123"));
  const shards = new Set(Array.from({ length: 60000 }, (_, i) => rowShard(`osm-w${i}`)));
  assert.ok(shards.size > 1900, "ids spread over the shards");
});

test("search files are keyed by a word's first three letters; common words are not keys", () => {
  assert.equal(searchKey("yosemite"), "yos");
  assert.equal(searchKey("mist"), "mis");
  assert.ok(SEARCH_STOPWORDS.has("trail"));
  assert.ok(!SEARCH_STOPWORDS.has("beach"));
});

test("every ISO country code gets an English name", () => {
  assert.equal(countryName("US"), "United States");
  assert.equal(countryName("DE"), "Germany");
  assert.equal(countryName("JP"), "Japan");
  assert.equal(countryName("??"), "??");
});
