/**
 * Ports the window-transparency entry from the former paseo-repatch
 * script for the stock `app.asar`: a single length-preserving replace of the
 * opaque `backgroundColor` call with the glass hook, padded with spaces so
 * every byte offset inside the asar archive stays put.
 */

import { PatchCountError } from "./patch-engine.ts";

const LABEL = "window transparency";

export const ASAR_HOOK_ANCHOR =
  'backgroundColor: (0, window_manager_js_1.getWindowBackgroundColor)(systemTheme),';

export const ASAR_HOOK_LINE =
  'transparent:require(process.resourcesPath+"/pg.js"),visualEffectState:"active",';

export function patchAsar(data: Buffer): { data: Buffer; notes: string[] } {
  const notes: string[] = [];
  const anchor = Buffer.from(ASAR_HOOK_ANCHOR, "utf8");
  const hook = Buffer.from(ASAR_HOOK_LINE, "utf8");

  if (hook.length > anchor.length) {
    throw new Error(`${LABEL}: replacement longer than original — would shift asar offsets`);
  }

  let hits = 0;
  let at = -1;
  let index = data.indexOf(anchor);
  while (index !== -1) {
    if (at === -1) {
      at = index;
    }
    hits += 1;
    index = data.indexOf(anchor, index + anchor.length);
  }

  if (hits === 0) {
    notes.push(`MISSED  ${LABEL}: target not found`);
    return { data, notes };
  }
  if (hits !== 1) {
    throw new PatchCountError(LABEL, 1, hits);
  }

  const padded = Buffer.concat([hook, Buffer.alloc(anchor.length - hook.length, 0x20)]);
  const patched = Buffer.concat([data.subarray(0, at), padded, data.subarray(at + anchor.length)]);

  if (patched.length !== data.length) {
    throw new Error(`${LABEL}: length changed — asar offsets would break, refusing to write`);
  }

  notes.push(`ok      ${LABEL} (${hits}x)`);
  return { data: patched, notes };
}
