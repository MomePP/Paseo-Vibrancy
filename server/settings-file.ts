/**
 * Reads and writes the live vibrancy settings file —
 * `~/Library/Application Support/Paseo/paseo-vibrancy.json` by default — which
 * `pv.js` (baked into the patched asar at build time) polls for live
 * updates. Writes are atomic (write `.tmp`, then rename) so `pv.js` never
 * observes a half-written file.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parseVibrancy } from "../shared/vibrancy.ts";
import type { VibrancySettings } from "../shared/vibrancy.ts";

export const DEFAULT_SETTINGS_FILE = join(homedir(), "Library", "Application Support", "Paseo", "paseo-vibrancy.json");

/** Missing or unparsable files fall back to `VIBRANCY_DEFAULTS` via `parseVibrancy`. */
export function readSettings(file: string = DEFAULT_SETTINGS_FILE): VibrancySettings {
  if (!existsSync(file)) {
    return parseVibrancy(undefined);
  }
  try {
    return parseVibrancy(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseVibrancy(undefined);
  }
}

/** Atomic write: `.tmp` in the same directory, then `renameSync` over the target. */
export function writeSettings(settings: VibrancySettings, file: string = DEFAULT_SETTINGS_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  renameSync(tmp, file);
}
