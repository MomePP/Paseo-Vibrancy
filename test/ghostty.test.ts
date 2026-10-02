import { test } from "node:test";
import assert from "node:assert/strict";

import { ghosttyMetrics, readGhostty, GHOSTTY_FONT_STYLES } from "../server/ghostty.ts";

test("ghosttyMetrics maps font-style-bold, adjust-cell-height and cursor-style", () => {
  const { metrics, notes } = ghosttyMetrics({
    "font-style-bold": ["SemiBold"],
    "adjust-cell-height": ["8%"],
    "cursor-style": ["block"],
  });
  assert.equal(metrics.fontWeightBold, 600);
  assert.equal(metrics.lineHeight, 1.08);
  assert.equal(metrics.cursorStyle, "block");
  assert.deepEqual(notes, []);
});

test("ghosttyMetrics falls back and notes a non-percentage adjust-cell-height", () => {
  const { metrics, notes } = ghosttyMetrics({ "adjust-cell-height": ["2px"] });
  assert.equal(metrics.lineHeight, undefined);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /adjust-cell-height '2px' is not a %/);
});

test("ghosttyMetrics notes an unmapped font-style without setting a weight", () => {
  const { metrics, notes } = ghosttyMetrics({ "font-style": ["ultra-condensed"] });
  assert.equal(metrics.fontWeight, undefined);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /font-style 'ultra-condensed' has no CSS weight/);
});

test("ghosttyMetrics joins repeated font-family entries", () => {
  const { metrics } = ghosttyMetrics({ "font-family": ["Maple Mono NF", "Noto Sans Mono"] });
  assert.equal(metrics.fontFamily, "Maple Mono NF, Noto Sans Mono");
});

test("GHOSTTY_FONT_STYLES maps every vendor style name Ghostty ships", () => {
  assert.equal(GHOSTTY_FONT_STYLES.semibold, 600);
  assert.equal(GHOSTTY_FONT_STYLES.bold, 700);
  assert.equal(GHOSTTY_FONT_STYLES.regular, 400);
});

test("readGhostty parses key = value lines, skipping blanks and comments, repeating keys", () => {
  const cfg = readGhostty(`${import.meta.dirname}/fixtures/ghostty-config`);
  assert.deepEqual(cfg["font-family"], ["Maple Mono NF", "Noto Sans Mono"]);
  assert.deepEqual(cfg["cursor-style"], ["block"]);
  assert.equal(cfg["# a comment line"], undefined);
});
