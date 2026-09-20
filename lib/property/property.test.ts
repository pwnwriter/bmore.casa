import { test } from "node:test";
import assert from "node:assert/strict";
import { mappedGeometry, mapWays, parsePropertyRef } from "./context";
import { containsPoint, validateProposal } from "./types";

const geometry = [{ lon: -0.0001, lat: -0.0001 }, { lon: 0.0001, lat: -0.0001 }, { lon: 0.0001, lat: 0.0001 }, { lon: -0.0001, lat: 0.0001 }, { lon: -0.0001, lat: -0.0001 }];
test("direct map fallback assembles complete ways and rejects missing nodes", () => {
  const ways = mapWays([
    { type: "node", id: 1, lon: 1, lat: 2 }, { type: "node", id: 2, lon: 3, lat: 4 },
    { type: "way", id: 3, nodes: [1, 2], tags: { highway: "residential" } },
    { type: "way", id: 4, nodes: [1, 99], tags: { building: "yes" } },
  ]);
  assert.equal(ways.length, 1);
  assert.deepEqual(ways[0].geometry, [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }]);
});
test("property references cannot choose arbitrary data paths", () => {
  for (const value of [{ layer: "../secret", index: 0 }, { layer: "vacant", index: -1 }, { layer: "vacant", index: 0.1 }, { layer: "permit", index: 0, neighborhood: "../secret" }]) assert.throws(() => parsePropertyRef(value));
  assert.deepEqual(parsePropertyRef({ layer: "permit", index: 3, neighborhood: 7 }), { layer: "permit", index: 3, neighborhood: 7 });
});
test("mapped, levels-derived and assumed heights remain distinguishable", () => {
  const result = mappedGeometry([
    { id: 1, geometry, tags: { building: "yes", height: "30 ft" } },
    { id: 2, geometry, tags: { building: "yes", "building:levels": "2" } },
    { id: 3, geometry, tags: { building: "yes", height: "unknown" } },
  ], [0, 0]);
  assert.equal(result.buildings[0].height, 9.144);
  assert.equal(result.buildings[0].heightSource, "mapped");
  assert.equal(result.buildings[1].height, 6);
  assert.equal(result.buildings[1].heightSource, "levels");
  assert.equal(result.buildings[2].heightSource, "estimated");
  assert.equal(result.selectedId, null, "ambiguous overlapping footprints must not auto-select");
});
test("only a containing footprint is auto-selected; open ways are ignored", () => {
  const single = mappedGeometry([{ id: 10, geometry, tags: { building: "yes" } }], [0, 0]);
  assert.equal(single.selectedId, 10);
  assert.ok(containsPoint(single.buildings[0].outline, [0, 0]));
  assert.equal(mappedGeometry([{ id: 10, geometry, tags: { building: "yes" } }], [0.001, 0]).selectedId, null);
  assert.equal(mappedGeometry([{ id: 11, geometry: geometry.slice(0, 4), tags: { building: "yes" } }], [0, 0]).buildings.length, 0);
});
test("concept validation rejects malformed materials and oversized narration", () => {
  const valid = { title: "Facade study", summary: "A proposed exterior treatment.", narration: "This is a proposed concept.", changes: ["Green roof treatment"], facadeColor: "#aaaabb", trimColor: "#112233", roof: "green" };
  assert.deepEqual(validateProposal(valid), valid);
  for (const invalid of [{ ...valid, facadeColor: "url(secret)" }, { ...valid, roof: "tower" }, { ...valid, narration: "x".repeat(901) }, { ...valid, changes: [null] }]) assert.throws(() => validateProposal(invalid));
});
