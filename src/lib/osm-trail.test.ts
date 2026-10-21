import test from "node:test";
import assert from "node:assert/strict";
import { osmDifficulty, osmSections } from "./osm-trail";

test("mtb:scale:imba 3 is difficult", () => assert.equal(osmDifficulty({ "mtb:scale:imba": 3 }), "difficult"));
test("unknown difficulty stays blank", () => assert.equal(osmDifficulty({ highway: "path" }), null));
test("foot=no is not hike & walk", () => assert.ok(!osmSections({ foot: "no" }).includes("foot")));
test("horse=designated is horseback", () => assert.ok(osmSections({ horse: "designated" }).includes("horse")));
test("bicycle on dirt is bike", () => assert.ok(osmSections({ bicycle: "yes", surface: "dirt" }).includes("bike")));
