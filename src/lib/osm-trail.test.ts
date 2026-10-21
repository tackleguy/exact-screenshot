import { describe, expect, it } from "vitest";
import { osmDifficulty, osmSections } from "./osm-trail";

describe("OSM trail classification", () => {
  it("mtb:scale:imba 3 is difficult", () => expect(osmDifficulty({ "mtb:scale:imba": 3 })).toBe("difficult"));
  it("unknown difficulty stays blank", () => expect(osmDifficulty({ highway: "path" })).toBeNull());
  it("foot=no is not hike & walk", () => expect(osmSections({ foot: "no" })).not.toContain("foot"));
  it("horse=designated is horseback", () => expect(osmSections({ horse: "designated" })).toContain("horse"));
  it("bicycle on dirt is bike", () => expect(osmSections({ bicycle: "yes", surface: "dirt" })).toContain("bike"));
});
