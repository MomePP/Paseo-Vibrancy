import { test } from "node:test";
import assert from "node:assert/strict";

import { GLASS_DEFAULTS, parseGlass } from "../shared/glass.ts";

test("parseGlass({}) deep-equals GLASS_DEFAULTS", () => {
  assert.deepEqual(parseGlass({}), GLASS_DEFAULTS);
});

test("parseGlass clamps out-of-range numeric fields", () => {
  const result = parseGlass({ blurRadius: 200, tint: -1 });
  assert.equal(result.blurRadius, 60);
  assert.equal(result.tint, 0);
});

test("parseGlass falls back to default material for unknown values", () => {
  const result = parseGlass({ material: "bogus" });
  assert.equal(result.material, "none");
});

test("parseGlass never throws, returns defaults for non-object input", () => {
  assert.deepEqual(parseGlass("not json"), GLASS_DEFAULTS);
});
