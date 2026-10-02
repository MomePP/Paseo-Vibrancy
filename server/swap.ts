/**
 * Detached swap-and-relaunch: moves a freshly built staging copy over the
 * live patched app and optionally relaunches it, surviving the moment Paseo
 * (and this plugin's own server subprocess, a child of Paseo's daemon) quits.
 *
 * `startSwap` spawns the generated POSIX sh script as its own process group
 * (`detached: true`, then `unref()`) so it keeps running after the daemon
 * that spawned it is gone, and the script itself ignores SIGHUP so the
 * group's controlling-terminal hangup on quit cannot cut it short either.
 *
 * Ports the quit/wait half of the former paseo-repatch script's
 * `quit_patched` and `running_pids`: `osascript` asks the running patched
 * copy to quit by bundle id, then the script polls `pgrep -f` on the bare
 * executable path (anchored, so it never matches a helper the app spawned
 * that is meant to outlive a quit) up to 20 s before giving up.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { STAMP_NAME } from "./build.ts";

export type SwapOpts = {
  staging: string;
  target: string;
  trashDir: string;
  quit: boolean;
  open: boolean;
};

/** How many 0.5s polls `swapScript` waits for the running app to quit — 20s total, matching `quit_patched`. */
const QUIT_WAIT_ATTEMPTS = 40;
const QUIT_WAIT_INTERVAL_SECONDS = "0.5";

/**
 * Quotes `s` as a single POSIX sh word by wrapping it in single quotes and
 * escaping any embedded single quote as `'\''` (close quote, literal quote,
 * reopen quote). Safe for any byte sequence, including spaces and `$`/`` ` ``.
 */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * Escapes POSIX extended-regular-expression metacharacters in `s` so it can
 * be embedded in a `pgrep -f` pattern and still match only itself. Without
 * this, a target path containing e.g. `(`, `)`, `+` or `.` would make the
 * pattern match something other than the literal executable path — or fail
 * to match it at all — and the script could swap out from under a still-live
 * Paseo process, or spin for the full 20 s grace period on a process that
 * already quit.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the POSIX sh script `startSwap` runs detached. With `quit`, it asks
 * the running patched copy to quit and waits up to 20 s for its process to
 * clear before touching anything; if it is still up after the grace period,
 * the script exits 1 and leaves `staging`/`target` untouched. Otherwise (or
 * once the old process has cleared) it trashes any existing `target`, moves
 * `staging` into place, and — if `open` — relaunches it.
 */
export function swapScript(opts: SwapOpts): string {
  const exe = join(opts.target, "Contents", "MacOS", "Paseo");
  const exePattern = `^${escapeRegex(exe)}$`;
  const trashed = join(opts.trashDir, `Paseo-Vibrancy-${Math.floor(Date.now() / 1000)}.app`);

  const lines = ["trap '' HUP"];

  if (opts.quit) {
    lines.push(
      `PATTERN=${shq(exePattern)}`,
      `osascript -e 'tell application id "sh.paseo.desktop" to quit' >/dev/null 2>&1 || true`,
      `i=0`,
      `while [ "$i" -lt ${QUIT_WAIT_ATTEMPTS} ]; do`,
      `  pgrep -f "$PATTERN" >/dev/null 2>&1 || break`,
      `  i=$((i + 1))`,
      `  sleep ${QUIT_WAIT_INTERVAL_SECONDS}`,
      `done`,
      `if pgrep -f "$PATTERN" >/dev/null 2>&1; then`,
      `  exit 1`,
      `fi`,
    );
  }

  // Each `mv` is checked: a failed trash-move stops before `staging` is ever
  // touched, and a failed staging-move (e.g. a dangling `staging` or a
  // read-only `target` parent) restores the trashed copy rather than leaving
  // the bundle half-swapped or the user with no app at all. `target` is never
  // left holding both the old and new bundle nested inside each other.
  lines.push(`TRASHED=${shq(trashed)}`);
  lines.push(
    `if [ -e ${shq(opts.target)} ]; then`,
    `  mv ${shq(opts.target)} "$TRASHED" || exit 1`,
    `fi`,
    `if ! mv ${shq(opts.staging)} ${shq(opts.target)}; then`,
    `  if [ -e "$TRASHED" ]; then`,
    `    mv "$TRASHED" ${shq(opts.target)}`,
    `  fi`,
    `  exit 1`,
    `fi`,
  );

  if (opts.open) {
    lines.push(`open -a ${shq(opts.target)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Validates `staging` carries a build stamp (a stamp ending in `missed` is
 * still swappable — MISSED patches are cosmetic, not a reason to block a
 * rebuild) and spawns `swapScript`'s output detached: own process group, no
 * inherited stdio, surviving both this process and Paseo's daemon exiting.
 */
export function startSwap(opts: Omit<SwapOpts, "trashDir"> & { trashDir?: string }): void {
  const stampPath = join(opts.staging, "Contents", "Resources", STAMP_NAME);
  if (!existsSync(stampPath)) {
    throw new Error("staging has no build stamp");
  }

  const trashDir = opts.trashDir ?? join(homedir(), ".Trash");
  const script = swapScript({ ...opts, trashDir });

  spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" }).unref();
}
