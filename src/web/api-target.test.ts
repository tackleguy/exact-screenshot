import { test } from "node:test";
import { strict as assert } from "node:assert";
import { apiTarget } from "./api-target";
test("relative API requests retain encoded trail IDs and filters", () => {
  assert.equal(apiTarget("/api/trail-catalog/a%7Bb%7D?lat=42", "https://site.lovable.app", "https://service.example/"), "https://service.example/api/trail-catalog/a%7Bb%7D?lat=42");
});
test("unrelated external requests are never redirected", () => {
  assert.equal(apiTarget("https://outside.example/api/trails", "https://site.lovable.app", "https://service.example"), null);
});
test("missing backend is distinguished from a working endpoint", () => {
  assert.equal(apiTarget("/api/trails", "https://site.lovable.app", ""), "");
});