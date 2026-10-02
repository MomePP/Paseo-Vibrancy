/**
 * Reads and writes the live glass settings file —
 * `~/Library/Application Support/Paseo/paseo-glass.json` by default — which
 * `pg.js` (baked into the patched asar at build time) polls for live
 * updates. Writes are atomic (write `.tmp`, then rename) so `pg.js` never
 * observes a half-written file.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parseGlass } from "../shared/glass.ts";
import type { GlassSettings } from "../shared/glass.ts";

export const DEFAULT_GLASS_FILE = join(homedir(), "Library", "Application Support", "Paseo", "paseo-glass.json");

/** Missing or unparsable files fall back to `GLASS_DEFAULTS` via `parseGlass`. */
export function readGlass(file: string = DEFAULT_GLASS_FILE): GlassSettings {
  if (!existsSync(file)) {
    return parseGlass(undefined);
  }
  try {
    return parseGlass(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseGlass(undefined);
  }
}

/** Atomic write: `.tmp` in the same directory, then `renameSync` over the target. */
export function writeGlass(settings: GlassSettings, file: string = DEFAULT_GLASS_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  renameSync(tmp, file);
}
