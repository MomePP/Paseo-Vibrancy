/**
 * Locates the running Paseo bundle from an executable path and reads its
 * build stamp, so `vibrancy.status` can report what the live copy is built
 * from without re-deriving the fingerprint logic owned by `server/build.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { STAMP_NAME } from "./build.ts";

/**
 * Walks `execPath` from the root and returns the outermost `*.app` bundle —
 * e.g. `.../Paseo-Vibrancy.app/Contents/Frameworks/Paseo Helper.app/...`
 * resolves to `.../Paseo-Vibrancy.app`, not the nested helper. `null` if no
 * path segment ends in `.app`.
 */
export function runningBundle(execPath: string = process.execPath): string | null {
  const parts = execPath.split("/");
  const appIndex = parts.findIndex((part) => part.endsWith(".app"));
  return appIndex === -1 ? null : parts.slice(0, appIndex + 1).join("/");
}

export function isGlassBuild(bundle: string): boolean {
  return existsSync(join(bundle, "Contents", "Resources", STAMP_NAME));
}

export type Stamp = { version: string; fingerprint: string };

/** Parses `<version>|glass=<fingerprint>` (optionally followed by `\nmissed`) out of `bundle`'s stamp file. */
export function readStamp(bundle: string): Stamp | null {
  const stampPath = join(bundle, "Contents", "Resources", STAMP_NAME);
  if (!existsSync(stampPath)) {
    return null;
  }
  const firstLine = readFileSync(stampPath, "utf8").split("\n")[0] ?? "";
  const match = firstLine.match(/^(.*)\|glass=(.*)$/);
  return match ? { version: match[1]!, fingerprint: match[2]! } : null;
}
