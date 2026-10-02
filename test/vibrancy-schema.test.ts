import { test } from "node:test";
import assert from "node:assert/strict";

import { VIBRANCY_DEFAULTS, parseVibrancy } from "../shared/vibrancy.ts";

test("parseVibrancy({}) deep-equals VIBRANCY_DEFAULTS", () => {
  assert.deepEqual(parseVibrancy({}), VIBRANCY_DEFAULTS);
});

test("parseVibrancy clamps out-of-range numeric fields", () => {
  const result = parseVibrancy({ blurRadius: 200, tint: -1 });
  assert.equal(result.blurRadius, 60);
  assert.equal(result.tint, 0);
});

test("parseVibrancy falls back to default material for unknown values", () => {
  const result = parseVibrancy({ material: "bogus" });
  assert.equal(result.material, "none");
});

test("parseVibrancy never throws, returns defaults for non-object input", () => {
  assert.deepEqual(parseVibrancy("not json"), VIBRANCY_DEFAULTS);
});
