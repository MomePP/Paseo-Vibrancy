/**
 * Ports the Ghostty-config terminal metrics logic from the former
 * paseo-repatch script (`read_ghostty`/`ghostty_metrics`, plus the
 * fallback constants and `GHOSTTY_FONT_STYLES` table, and the precedence its
 * `main()` applied when resolving `term`, minus the CLI-flag layer, which
 * this plugin has no equivalent of).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TermMetrics = {
  fontSize: number | null;
  lineHeight: number;
  padding: string;
  cursorStyle: string;
  fontFamily: string | null;
  fontWeight: number | string | null;
  fontWeightBold: number | string | null;
};

// xterm's own default is hardcoded to 1 with no setting behind it. Code size
// in Settings -> Appearance -> Fonts only accepts whole numbers and clamps at
// 22, so this is the only way to land a terminal-only 13.5pt.
export const FONT_SIZE: number | null = 13.5;

// Fallbacks for what the Ghostty config below normally supplies. Each is
// what Paseo ships, so with no Ghostty file present nothing changes but the
// size.
export const LINE_HEIGHT = 1.1;
export const PADDING = "0 0 0 10px"; // CSS shorthand; left only, by preference
export const CURSOR_STYLE = "bar";
export const FONT_FAMILY: string | null = null; // null keeps Settings -> Code font in charge

// Neither weight is reachable from Paseo: it never passes fontWeight or
// fontWeightBold, so the terminal sits on xterm's own defaults (400/700).
// 400/600 rather than stock's 400/700 — only the bold moves, since SGR 1 is
// most of what a git TUI paints and 700 against most monospace faces reads
// as too heavy relative to the regular weight.
export const FONT_WEIGHT: number | string | null = 400;
export const FONT_WEIGHT_BOLD: number | string | null = 600;

// Default Ghostty config location; a missing file is not an error, just the
// fallbacks above.
export const GHOSTTY_PATH = join(homedir(), ".config", "ghostty", "config");

// Ghostty names a face by its style; xterm names one by CSS weight. These are
// the style names font vendors actually ship, on the scale they correspond
// to. Ghostty's own sentinels (`default`, `false`) are deliberately absent —
// neither is a weight, and both fall through to the constants above.
export const GHOSTTY_FONT_STYLES: Record<string, number> = {
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  book: 400,
  normal: 400,
  regular: 400,
  text: 400,
  medium: 500,
  demibold: 600,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/** `key = value` lines into a dict of lists — Ghostty allows a key to repeat. */
export function readGhostty(path: string): Record<string, string[]> {
  const cfg: Record<string, string[]> = {};
  for (let line of readFileSync(path, "utf8").split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    (cfg[key] ??= []).push(value);
  }
  return cfg;
}

/** The subset of a Ghostty config xterm can honour, plus notes on the rest. */
export function ghosttyMetrics(
  cfg: Record<string, string[]>,
): { metrics: Partial<TermMetrics>; notes: string[] } {
  const metrics: Partial<TermMetrics> = {};
  const notes: string[] = [];

  if (cfg["cursor-style"]) {
    metrics.cursorStyle = cfg["cursor-style"].at(-1);
  }

  if (cfg["font-family"]) {
    metrics.fontFamily = cfg["font-family"].join(", ");
  }

  for (const [key, slot] of [
    ["font-style", "fontWeight"],
    ["font-style-bold", "fontWeightBold"],
  ] as const) {
    if (cfg[key]) {
      const raw = cfg[key].at(-1)!;
      const weight = GHOSTTY_FONT_STYLES[raw.toLowerCase().replace(/[\s_-]/g, "")];
      if (weight === undefined) {
        notes.push(`        ghostty ${key} '${raw}' has no CSS weight, using default`);
      } else {
        metrics[slot] = weight;
      }
    }
  }

  if (cfg["adjust-cell-height"]) {
    const raw = cfg["adjust-cell-height"].at(-1)!;
    // Only the percentage form is a ratio. Ghostty also takes `Npx` and
    // negatives, and neither converts to a line height without knowing the
    // cell height xterm will pick — so those fall back rather than guess.
    if (raw.endsWith("%")) {
      metrics.lineHeight = Math.round((1 + parseFloat(raw.slice(0, -1)) / 100) * 1000) / 1000;
    } else {
      notes.push(`        ghostty adjust-cell-height '${raw}' is not a %, using default`);
    }
  }

  return { metrics, notes };
}

/**
 * Resolves `TermMetrics`: the constants above, overridden by whatever the
 * Ghostty config supplies. Mirrors `main()`'s precedence (lines 1250-1264)
 * minus the CLI-flag layer, which this plugin has no equivalent of.
 */
export function resolveTerm(ghosttyPath: string = GHOSTTY_PATH): {
  term: TermMetrics;
  notes: string[];
} {
  const term: TermMetrics = {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    padding: PADDING,
    cursorStyle: CURSOR_STYLE,
    fontFamily: FONT_FAMILY,
    fontWeight: FONT_WEIGHT,
    fontWeightBold: FONT_WEIGHT_BOLD,
  };
  const notes: string[] = [];

  if (!existsSync(ghosttyPath)) {
    notes.push(`ok      ghostty config (not found at ${ghosttyPath}, using defaults)`);
    return { term, notes };
  }

  const { metrics, notes: extra } = ghosttyMetrics(readGhostty(ghosttyPath));
  Object.assign(term, metrics);
  notes.push(`ok      ghostty config (${Object.keys(metrics).length} keys from ${ghosttyPath})`);
  notes.push(...extra);
  return { term, notes };
}
