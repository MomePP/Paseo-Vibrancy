import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ghosttyMetrics, readGhostty, resolveTerm, GHOSTTY_FONT_STYLES } from "../server/ghostty.ts";
import { TERMINAL_DEFAULTS } from "../shared/vibrancy.ts";
import type { TerminalSettings } from "../shared/vibrancy.ts";

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

const FIXTURE = `${import.meta.dirname}/fixtures/ghostty-config`;
const SETTINGS: TerminalSettings = {
  ...TERMINAL_DEFAULTS,
  fontSize: 15,
  lineHeight: 1.3,
  fontWeight: 300,
  fontWeightBold: 700,
  cursorStyle: "underline",
  paddingLeft: 22,
  ansi: "paseo",
};

test("resolveTerm with followGhostty on lets Ghostty win and lists what it overrode", () => {
  const { term, overriddenByGhostty } = resolveTerm({ ...SETTINGS, followGhostty: true }, FIXTURE);
  assert.equal(term.fontFamily, "Maple Mono NF, Noto Sans Mono");
  assert.equal(term.cursorStyle, "block");
  assert.equal(term.lineHeight, 1.08);
  assert.deepEqual([...overriddenByGhostty].sort(), ["cursorStyle", "fontFamily", "lineHeight"]);
  // Not in the fixture: the saved settings stand.
  assert.equal(term.fontWeight, 300);
  assert.equal(term.fontWeightBold, 700);
  assert.equal(term.fontSize, 15);
  assert.equal(term.ansi, "paseo");
});

test("resolveTerm with followGhostty off ignores the file entirely", () => {
  const { term, overriddenByGhostty, notes } = resolveTerm({ ...SETTINGS, followGhostty: false }, FIXTURE);
  assert.equal(term.fontFamily, null);
  assert.equal(term.cursorStyle, "underline");
  assert.equal(term.lineHeight, 1.3);
  assert.deepEqual(overriddenByGhostty, []);
  assert.deepEqual(notes, []);
});

test("resolveTerm builds the padding string from paddingLeft and passes a null fontSize through", () => {
  const { term } = resolveTerm({ ...SETTINGS, followGhostty: false, paddingLeft: 7, fontSize: null }, FIXTURE);
  assert.equal(term.padding, "0 0 0 7px");
  assert.equal(term.fontSize, null);
});

test("resolveTerm with a missing Ghostty file uses the settings and overrides nothing", () => {
  const { term, overriddenByGhostty } = resolveTerm(TERMINAL_DEFAULTS, "/nonexistent/ghostty-config");
  assert.equal(term.lineHeight, 1.1);
  assert.equal(term.fontFamily, null);
  assert.deepEqual(overriddenByGhostty, []);
});

test("ghosttyMetrics maps block_hollow to block", () => {
  const { metrics, notes } = ghosttyMetrics({ "cursor-style": ["block_hollow"] });
  assert.equal(metrics.cursorStyle, "block");
  assert.deepEqual(notes, []);
});

test("an unsupported Ghostty cursor-style leaves the saved setting in control and is not an override", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibrancy-ghostty-"));
  try {
    const file = join(dir, "config");
    writeFileSync(file, "cursor-style = bogus\n");
    const { term, notes, overriddenByGhostty } = resolveTerm({ ...TERMINAL_DEFAULTS, cursorStyle: "underline" }, file);
    assert.equal(term.cursorStyle, "underline");
    assert.deepEqual(overriddenByGhostty, []);
    assert.equal(notes.filter((n) => n.includes("cursor-style 'bogus'")).length, 1);

    writeFileSync(file, "cursor-style = block_hollow\n");
    const hollow = resolveTerm({ ...TERMINAL_DEFAULTS, cursorStyle: "underline" }, file);
    assert.equal(hollow.term.cursorStyle, "block");
    assert.deepEqual(hollow.overriddenByGhostty, ["cursorStyle"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
