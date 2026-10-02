/**
 * Ports the Ghostty-config terminal metrics logic from the former
 * paseo-repatch script (`read_ghostty`/`ghostty_metrics`, the
 * `GHOSTTY_FONT_STYLES` table, and the precedence its
 * `main()` applied when resolving `term`, minus the CLI-flag layer, which
 * this plugin has no equivalent of).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { TerminalSettings } from "../shared/vibrancy.ts";

export type TermMetrics = {
  fontSize: number | null;
  lineHeight: number;
  padding: string;
  cursorStyle: string;
  fontFamily: string | null; // null keeps Settings -> Code font in charge
  fontWeight: number | string | null;
  fontWeightBold: number | string | null;
  ansi: TerminalSettings["ansi"];
};

// Default Ghostty config location; a missing file is not an error, just the
// saved settings.
export const GHOSTTY_PATH = join(homedir(), ".config", "ghostty", "config");

// Ghostty names a face by its style; xterm names one by CSS weight. These are
// the style names font vendors actually ship, on the scale they correspond
// to. Ghostty's own sentinels (`default`, `false`) are deliberately absent —
// neither is a weight, and both fall through to the saved setting.
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
    const raw = cfg["cursor-style"].at(-1)!;
    // Ghostty's `block_hollow` has no xterm equivalent; `block` is closest.
    // Anything else xterm would reject (typos included) is left to the setting.
    const style = raw === "block_hollow" ? "block" : raw;
    if (style === "bar" || style === "block" || style === "underline") {
      metrics.cursorStyle = style;
    } else {
      notes.push(`        ghostty cursor-style '${raw}' is not supported by xterm, using the saved setting`);
    }
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
        notes.push(`        ghostty ${key} '${raw}' has no CSS weight, using the saved setting`);
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
      notes.push(`        ghostty adjust-cell-height '${raw}' is not a %, using the saved setting`);
    }
  }

  return { metrics, notes };
}

/**
 * Resolves `TermMetrics` from the saved terminal settings. With
 * `followGhostty` on, whatever the Ghostty config supplies overrides the
 * matching setting and is named in `overriddenByGhostty`; with it off the
 * file is not read and the font family stays null (Paseo's Code font).
 */
export function resolveTerm(
  settings: TerminalSettings,
  ghosttyPath: string = GHOSTTY_PATH,
): {
  term: TermMetrics;
  notes: string[];
  overriddenByGhostty: string[];
} {
  const term: TermMetrics = {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    padding: `0 0 0 ${settings.paddingLeft}px`,
    cursorStyle: settings.cursorStyle,
    fontFamily: null,
    fontWeight: settings.fontWeight,
    fontWeightBold: settings.fontWeightBold,
    ansi: settings.ansi,
  };
  const notes: string[] = [];

  if (!settings.followGhostty) {
    return { term, notes, overriddenByGhostty: [] };
  }

  if (!existsSync(ghosttyPath)) {
    notes.push(`ok      ghostty config (not found at ${ghosttyPath}, using settings)`);
    return { term, notes, overriddenByGhostty: [] };
  }

  const { metrics, notes: extra } = ghosttyMetrics(readGhostty(ghosttyPath));
  Object.assign(term, metrics);
  notes.push(`ok      ghostty config (${Object.keys(metrics).length} keys from ${ghosttyPath})`);
  notes.push(...extra);
  return { term, notes, overriddenByGhostty: Object.keys(metrics) };
}
