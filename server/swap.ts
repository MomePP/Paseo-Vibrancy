/**
 * Detached swap-and-relaunch: moves a freshly built staging copy over the
 * live patched app and optionally relaunches it, surviving the moment Paseo
 * (and this plugin's own server subprocess, a child of Paseo's daemon) quits.
 *
 * `startSwap` spawns the generated POSIX sh script as its own process group
 * (`detached: true`, then `unref()`) so it keeps running after the daemon
 * that spawned it is gone, and the script itself ignores SIGHUP so the
 * group's controlling-terminal hangup on quit cannot cut it short either.
 * Every step is appended to `logPath` (`exec >>LOG 2>&1` at the top of the
 * script) since nothing else observes a detached, unref'd child's output —
 * a silent failure here otherwise just looks like Paseo never reopened.
 *
 * Ports the quit/wait half of the former paseo-repatch script's
 * `quit_patched` and `running_pids`: `osascript` asks the running patched
 * copy to quit by bundle id, then the script polls `pgrep -f` on the bare
 * executable path(s) (anchored, so it never matches a helper the app
 * spawned that is meant to outlive a quit) up to 60 s before giving up.
 * Bootstrapping from stock `/Applications/Paseo.app`, the *running* exe
 * differs from the *target* (`Paseo-Vibrancy.app`) exe the swap is about to
 * replace, so both are tracked: the wait only ends once neither matches.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { STAMP_NAME } from "./build.ts";

export type SwapOpts = {
  staging: string;
  target: string;
  /** The currently-running bundle's executable (may differ from `target`'s when bootstrapping from stock Paseo.app). */
  runningExe?: string;
  /** The app to reopen if the swap fails after quitting; defaults to `target`. Stock Paseo.app when bootstrapping. */
  previousApp?: string;
  trashDir: string;
  quit: boolean;
  open: boolean;
  logPath?: string;
};

export const DEFAULT_SWAP_LOG = join(homedir(), "Library", "Logs", "paseo-vibrancy-swap.log");

/** How many 0.5s polls `swapScript` waits for the running app to quit — 60s total. */
const QUIT_WAIT_ATTEMPTS = 120;
const QUIT_WAIT_INTERVAL_SECONDS = "0.5";

/** Shell expression for a timestamp, embedded in every logged step line. */
const SH_TIMESTAMP = "$(date '+%Y-%m-%dT%H:%M:%S%z')";

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
 * Paseo process, or spin for the full 60 s grace period on a process that
 * already quit.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the POSIX sh script `startSwap` runs detached. With `quit`, it asks
 * the running patched copy to quit and waits up to 60 s for both its own
 * process and (if `runningExe` differs — bootstrapping from stock Paseo.app)
 * the currently-running process to clear before touching anything; if
 * either is still up after the grace period, the script reopens the
 * previous app (when `open`) and exits 1, leaving `staging`/`target`
 * untouched. Otherwise (or once the old process has cleared) it trashes any
 * existing `target`, moves `staging` into place, and — if `open` —
 * relaunches it. Any failure after the quit request (timed-out wait, a
 * failed trash-move, a failed staging-move already rolled back) reopens
 * `previousApp` — the app that was running, which is `target` itself except
 * when bootstrapping from stock Paseo.app — when `open` is true.
 */
export function swapScript(opts: SwapOpts): string {
  const logPath = opts.logPath ?? DEFAULT_SWAP_LOG;
  const exe = join(opts.target, "Contents", "MacOS", "Paseo");
  const exePattern = `^${escapeRegex(exe)}$`;
  const runningPattern = opts.runningExe !== undefined ? `^${escapeRegex(opts.runningExe)}$` : null;
  const dualPattern = runningPattern !== null && runningPattern !== exePattern;
  const trashed = join(opts.trashDir, `Paseo-Vibrancy-${Math.floor(Date.now() / 1000)}.app`);

  const log = (message: string) => `echo "[${SH_TIMESTAMP}] swap: ${message}"`;
  const reopenOnFailure = opts.open
    ? [log("reopening previous app"), `open -a ${shq(opts.previousApp ?? opts.target)}`]
    : [];

  const lines = ["trap '' HUP", `exec >>${shq(logPath)} 2>&1`, log("starting")];

  if (opts.quit) {
    lines.push(`PATTERN=${shq(exePattern)}`);
    if (dualPattern) {
      lines.push(`RUNNING_PATTERN=${shq(runningPattern!)}`);
    }
    // `-a`: the script descends from the running Paseo (app -> supervisor ->
    // daemon -> plugin -> script), and macOS pgrep skips its own ancestors
    // without it — the wait would end at once while Paseo is still quitting.
    const stillRunning = dualPattern
      ? `pgrep -a -f "$PATTERN" >/dev/null 2>&1 || pgrep -a -f "$RUNNING_PATTERN" >/dev/null 2>&1`
      : `pgrep -a -f "$PATTERN" >/dev/null 2>&1`;
    lines.push(
      log("requesting quit"),
      `osascript -e 'tell application id "sh.paseo.desktop" to quit' >/dev/null 2>&1 || true`,
      `i=0`,
      `while [ "$i" -lt ${QUIT_WAIT_ATTEMPTS} ]; do`,
      `  ${stillRunning} || break`,
      `  i=$((i + 1))`,
      `  sleep ${QUIT_WAIT_INTERVAL_SECONDS}`,
      `done`,
      `if ${stillRunning}; then`,
      `  ${log("quit wait timed out")}`,
      ...reopenOnFailure.map((line) => `  ${line}`),
      `  exit 1`,
      `fi`,
    );
  }

  // Each `mv` is checked: a failed trash-move stops before `staging` is ever
  // touched, and a failed staging-move (e.g. a dangling `staging` or a
  // read-only `target` parent) restores the trashed copy rather than leaving
  // the bundle half-swapped or the user with no app at all. `target` is never
  // left holding both the old and new bundle nested inside each other. Either
  // failure reopens the previous app (see `previousApp`).
  lines.push(`TRASHED=${shq(trashed)}`);
  lines.push(
    `if [ -e ${shq(opts.target)} ]; then`,
    `  ${log("moving previous app to trash")}`,
    `  if ! mv ${shq(opts.target)} "$TRASHED"; then`,
    `    ${log("trash move failed")}`,
    ...reopenOnFailure.map((line) => `    ${line}`),
    `    exit 1`,
    `  fi`,
    `fi`,
    log("moving staging into place"),
    `if ! mv ${shq(opts.staging)} ${shq(opts.target)}; then`,
    `  ${log("staging move failed, restoring previous app")}`,
    `  if [ -e "$TRASHED" ]; then`,
    `    mv "$TRASHED" ${shq(opts.target)}`,
    `  fi`,
    ...reopenOnFailure.map((line) => `  ${line}`),
    `  exit 1`,
    `fi`,
  );

  lines.push(log("complete"));
  if (opts.open) {
    lines.push(log("opening updated app"), `open -a ${shq(opts.target)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * The environment for the swap script: everything but Electron's own
 * `ELECTRON_*` variables. This runs inside Paseo's daemon, which is Electron
 * with ELECTRON_RUN_AS_NODE=1, and `open` hands its environment to the app it
 * launches — a Paseo started with that variable runs as plain Node, finds no
 * script, and exits 0 before writing a log line or opening a window.
 */
export function launchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("ELECTRON_")));
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

  spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore", env: launchEnv(process.env) }).unref();
}
