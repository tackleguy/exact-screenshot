import test from "node:test";
import assert from "node:assert/strict";
import { joinNamedWays, namedRows, osmUses, relationRows, winterUseOfPiste, type Pt, type Tags } from "./osm-trails";

const line = (x0: number, y0: number, n = 20, step = 0.001): Pt[] => Array.from({ length: n }, (_, i) => [x0 + i * step, y0 + (i % 2) * 0.0002] as Pt);
const place = () => ({ country: "AT", region: "Tirol" });

test("same-name ways join when they touch; a piste never joins the summer path of the same name", () => {
  const ways: Record<string, Pt[]> = { 1: line(11, 47), 2: line(11.019, 47), 3: line(11, 47.1) };
  const trails: Record<string, Tags> = {
    1: { name: "Zirbenweg", highway: "path" },
    2: { name: "Zirbenweg", highway: "path" },
    3: { name: "Zirbenweg", "piste:type": "nordic" },
  };
  const joined = joinNamedWays(trails, ways, new Set());
  assert.equal(joined.length, 2);
  assert.deepEqual(joined.map((c) => c.wayIds.length).sort(), [1, 2]);
});

test("pistes become winter trails with their uses; named paths keep hiking", () => {
  assert.equal(winterUseOfPiste("sled", false), "downhill");
  assert.equal(winterUseOfPiste("nordic", false), "oversnow");
  assert.equal(winterUseOfPiste("nordic", true), "nordic");
  assert.deepEqual(osmUses([{ "piste:type": "sled", name: "Rodelbahn" }]), ["Sledding"]);
  assert.ok(osmUses([{ highway: "path", "piste:type": "hike" }]).includes("Hiking"));
  const rejected: string[] = [];
  const { rows } = namedRows({
    candidates: joinNamedWays({ 9: { name: "Rodelbahn Gaisberg", "piste:type": "sled" } }, { 9: line(11, 47, 40) }, new Set()),
    placeOf: place, reject: (r) => rejected.push(r), retrievedAt: "2026-01-01",
  });
  assert.equal(rows.length, 1, `rejected: ${rejected.join(",")}`);
  assert.equal(rows[0].winterUse, "downhill");
  assert.equal(rows[0].osmWay?.pisteType, "sled");
  assert.equal(rows[0].country, "AT");
});

test("relations measure along their member ways and keep their route type", () => {
  const relTags = new Map<number, Tags>([[5, { name: "Adlerweg", route: "hiking", type: "route" }], [6, { name: "Kanuroute", route: "canoe", type: "route" }]]);
  const relMembers = new Map<number, [string, number, string][]>([[5, [["w", 1, ""], ["w", 2, ""]]], [6, [["w", 3, ""]]]]);
  const memberWays = new Map<number, Pt[]>([[1, line(11, 47)], [2, line(11.019, 47)], [3, line(12, 47)]]);
  const { rows } = relationRows({ relTags, relMembers, memberWays, placeOf: place, reject: () => {}, retrievedAt: "2026-01-01" });
  const adler = rows.find((r) => r.id === "osm-r5")!;
  assert.ok(adler.miles! > 1.5 && adler.miles! < 3, `miles ${adler.miles}`);
  assert.equal(adler.tier, "verified");
  assert.deepEqual(rows.find((r) => r.id === "osm-r6")!.uses, ["Paddling"]);
});
