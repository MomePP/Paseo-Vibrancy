import { test } from "node:test";
import assert from "node:assert/strict";

import { GLASS_DEFAULTS } from "../shared/glass.ts";
import { glassCssVars } from "../client/glass-css.ts";

test("glassCssVars maps defaults to a plain tint string and a transparent pane", () => {
  assert.deepEqual(glassCssVars({ ...GLASS_DEFAULTS }), {
    "--paseo-tint": "0.85",
    "--paseo-pane-bg": "transparent",
  });
});

test("glassCssVars falls back to the surface1 token when paneGlass is off", () => {
  assert.deepEqual(glassCssVars({ ...GLASS_DEFAULTS, paneGlass: false }), {
    "--paseo-tint": "0.85",
    "--paseo-pane-bg": "var(--colors-surface1)",
  });
});
